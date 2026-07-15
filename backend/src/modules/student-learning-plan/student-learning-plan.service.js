const crypto = require('crypto');
const prisma = require('../../config/prisma');
const templateService = require('../learning-workflow/workflow-template.service');
const { sanitizeGraphJson, sanitizeSettingsJson, validateGraphJson } = require('../learning-workflow/workflow-schema');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { loadUserScope, canAccessKnowledgeBase } = require('../agent-chat/agent-context.service');

const ACTIVE_STATUSES = ['DRAFT', 'READY', 'RUNNING', 'PAUSED', 'FAILED'];
const STATUS_TRANSITIONS = Object.freeze({
  DRAFT: ['READY', 'ARCHIVED'], READY: ['RUNNING', 'ARCHIVED'], RUNNING: ['PAUSED', 'COMPLETED', 'FAILED'],
  PAUSED: ['RUNNING', 'ARCHIVED'], FAILED: ['READY', 'RUNNING', 'ARCHIVED'], COMPLETED: ['ARCHIVED'], ARCHIVED: [],
});
const STARTABLE_PLAN_STATUSES = new Set(['READY', 'PAUSED', 'FAILED', 'RUNNING', 'COMPLETED']);
const RESUMABLE_SESSION_STATUSES = new Set(['CREATED', 'RUNNING', 'PAUSED', 'FAILED']);
const TERMINAL_SESSION_STATUSES = new Set(['COMPLETED', 'ABANDONED']);
const BLOCKING_PRELOAD_CODES = new Set(['PRELOAD_REQUIRED_FAILED', 'FIRST_NODE_CONTENT_FAILED', 'FIRST_NODE_NOT_READY']);
const startLocks = new Map();

class LearningStartError extends Error {
  constructor(publicCode, message, status = 409, details = {}, options = {}) {
    super(message);
    this.name = 'LearningStartError';
    this.publicCode = publicCode;
    this.status = status;
    this.code = status === 403 ? 40301 : status === 404 ? 40401 : status === 409 ? 40901 : status >= 500 ? 50001 : 40001;
    this.details = details;
    this.expose = true;
    this.retryable = options.retryable === true;
  }
}

function startError(code, message, status = 409, details = {}, options = {}) {
  return new LearningStartError(code, message, status, details, options);
}

function withStartLock(key, factory) {
  const normalized = String(key);
  if (startLocks.has(normalized)) return startLocks.get(normalized);
  const promise = Promise.resolve().then(factory).finally(() => { if (startLocks.get(normalized) === promise) startLocks.delete(normalized); });
  startLocks.set(normalized, promise);
  return promise;
}

function sessionStartAction(status) {
  return ({ RUNNING: 'reuse', PAUSED: 'resume', CREATED: 'start', FAILED: 'resume', COMPLETED: 'results', ABANDONED: 'new_round' })[String(status || '').toUpperCase()] || 'invalid';
}
const INCLUDE = {
  course: { select: { course_id: true, course_name: true } },
  knowledgePoint: { select: { knowledge_point_id: true, knowledge_point_name: true } },
  learningGoal: { select: { goal_id: true, normalized_title: true, status: true } },
  workflowTemplate: { select: { template_id: true, title: true, template_key: true } },
  workflowVersion: { select: { version_id: true, version_number: true, created_at: true } },
  learningSession: { select: { session_id: true, status: true, current_node_id: true, updated_at: true } },
  preloads: { where: { deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 1 },
  resourceLinks: { where: { deletedAt: null }, select: { id: true, artifactId: true, resourceRole: true, createdAt: true } },
};

function enumValue(value) { return String(value || '').trim().replace(/-/g, '_').toUpperCase(); }
function completionMode(value) {
  return ['WORKFLOW_COMPLETE', 'FLOW_COMPLETE', 'flow_complete'].includes(String(value || '')) ? 'flow_complete' : 'mastery_target';
}
function json(value, fallback = {}) { return value == null ? fallback : JSON.parse(JSON.stringify(value)); }
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function activeKey(userId) { return `student:${Number(userId)}`; }
function relatedPointIds(goal) {
  const related = Array.isArray(goal.related_knowledge_points) ? goal.related_knowledge_points : [];
  return [...new Set([goal.primary_knowledge_point_id, ...related.map(item => Number(item?.knowledgePointId))].map(Number).filter(id => Number.isInteger(id) && id > 0))];
}
function goalSnapshot(goal) {
  return json(goal.goal_snapshot, {
    version: 1, goalId: goal.goal_id, courseId: goal.course_id,
    normalizedTitle: goal.normalized_title, focusQuestion: goal.focus_question,
    primaryKnowledgePointId: goal.primary_knowledge_point_id,
    relatedKnowledgePoints: goal.related_knowledge_points || [], targetMastery: goal.target_mastery,
    estimatedMinutes: goal.estimated_minutes, capturedAt: new Date().toISOString(),
  });
}
function planStatusFromSession(session) {
  return ({ CREATED: 'READY', RUNNING: 'RUNNING', PAUSED: 'PAUSED', COMPLETED: 'COMPLETED', FAILED: 'FAILED', ABANDONED: 'ARCHIVED' })[session?.status] || 'READY';
}

function buildReadiness(record) {
  const graph = record?.graphSnapshot || {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const entryNodeId = String(record?.currentNodeId || graph.entryNodeId || '');
  const firstNode = nodes.find(node => String(node?.id) === entryNodeId) || null;
  const graphValidation = validateGraphJson(graph);
  const preload = record?.preloads?.[0] || null;
  const preloadStatus = String(preload?.status || 'NOT_STARTED').toUpperCase();
  const contentReady = Number(preload?.preparedContentCount || 0) > 0;
  const audioReady = Number(preload?.preparedAudioCount || 0) > 0;
  const blockingReasons = [];
  if (!record || !STARTABLE_PLAN_STATUSES.has(String(record.status))) blockingReasons.push({ code: 'LEARNING_PLAN_NOT_READY', message: '学习计划状态不能开始学习', action: 'REFRESH_PLAN' });
  if (!record?.workflowVersionId || !graphValidation.valid) blockingReasons.push({ code: 'WORKFLOW_SNAPSHOT_MISSING', message: graphValidation.errors?.[0] || '学习流快照不存在或无效', action: 'REMATCH_WORKFLOW' });
  if (!entryNodeId || !firstNode) blockingReasons.push({ code: 'FIRST_NODE_NOT_READY', message: '学习流首节点不存在或不属于当前快照', action: 'REPREPARE' });
  if (preloadStatus === 'FAILED' && BLOCKING_PRELOAD_CODES.has(String(preload?.errorCode || '')) && !contentReady) {
    blockingReasons.push({ code: 'PRELOAD_REQUIRED_FAILED', message: preload.errorMessage || '首节点必需内容准备失败', action: 'REPREPARE' });
  }
  return {
    canStart: blockingReasons.length === 0,
    required: {
      plan: record && STARTABLE_PLAN_STATUSES.has(String(record.status)) ? 'ready' : 'blocked',
      workflowSnapshot: record?.workflowVersionId && graphValidation.valid ? 'ready' : 'blocked',
      firstNode: firstNode ? (contentReady ? 'ready' : 'instant') : 'blocked',
    },
    optional: {
      tts: audioReady ? 'ready' : ['QUEUED', 'PRELOADING'].includes(preloadStatus) ? 'generating' : preload?.errorCode === 'TTS_UPSTREAM_ERROR' ? 'degraded' : 'pending',
      nextNode: (preload?.preparedNodeIdsJson || []).length > 1 ? 'ready' : 'pending',
      cards: preload?.manifestJson?.cards?.status || 'pending',
      pdfPreview: 'optional',
    },
    blockingReasons,
    degradedReasons: [
      ...(!audioReady && preload?.errorCode === 'TTS_UPSTREAM_ERROR' ? [{ code: 'TTS_UPSTREAM_ERROR', message: '语音暂不可用，将使用文本开始学习' }] : []),
      ...(preloadStatus === 'PARTIAL' ? [{ code: 'PRELOAD_PARTIAL', message: '非关键内容仍在准备，不阻止首节点学习' }] : []),
    ],
    firstNode: firstNode ? { id: String(firstNode.id), type: firstNode.type || null, title: firstNode.title || null } : null,
    preload: preload ? { id: preload.id, status: preloadStatus, contentReady, audioReady, errorCode: preload.errorCode || null } : null,
  };
}

function serialize(record, extra = {}) {
  if (!record) return null;
  const preload = record.preloads?.[0] || null;
  return {
    id: record.id, courseId: record.courseId, knowledgePointId: record.knowledgePointId,
    knowledgePointIds: record.knowledgePointIdsJson || [], learningGoalId: record.learningGoalId,
    goalSnapshot: record.goalSnapshot || {}, workflowTemplateId: record.workflowTemplateId,
    workflowVersionId: record.workflowVersionId, graphSnapshot: record.graphSnapshot || {}, settingsSnapshot: record.settingsSnapshot || {},
    creationMode: String(record.creationMode).toLowerCase(), status: String(record.status).toLowerCase(),
    currentNodeId: record.currentNodeId, progress: record.progress, targetMastery: record.targetMastery,
    completionMode: record.completionMode, estimatedMinutes: record.estimatedMinutes,
    learningSessionId: record.learningSessionId, isCurrent: Boolean(record.activeKey),
    error: record.errorCode ? { code: record.errorCode, message: record.errorMessage } : null,
    course: record.course ? { id: record.course.course_id, name: record.course.course_name } : null,
    knowledgePoint: record.knowledgePoint ? { id: record.knowledgePoint.knowledge_point_id, name: record.knowledgePoint.knowledge_point_name } : null,
    learningGoal: record.learningGoal ? { id: record.learningGoal.goal_id, title: record.learningGoal.normalized_title, status: record.learningGoal.status } : null,
    workflow: record.workflowTemplate ? { id: record.workflowTemplate.template_id, title: record.workflowTemplate.title, key: record.workflowTemplate.template_key, versionId: record.workflowVersionId, version: record.workflowVersion?.version_number } : null,
    session: record.learningSession ? { id: record.learningSession.session_id, status: String(record.learningSession.status).toLowerCase(), currentNodeId: record.learningSession.current_node_id, updatedAt: record.learningSession.updated_at } : null,
    preload: preload ? { id: preload.id, status: preload.status, progress: preload.progress, stage: preload.stage, preparedContentCount: preload.preparedContentCount, preparedAudioCount: preload.preparedAudioCount, preparedNodeIds: preload.preparedNodeIdsJson || [], errorCode: preload.errorCode, errorMessage: preload.errorMessage, expiresAt: preload.expiresAt } : null,
    readiness: buildReadiness(record),
    resourceCount: record.resourceLinks?.length || 0, resourceLinks: record.resourceLinks || [],
    readyAt: record.readyAt, startedAt: record.startedAt, pausedAt: record.pausedAt,
    completedAt: record.completedAt, archivedAt: record.archivedAt, createdAt: record.createdAt, updatedAt: record.updatedAt,
    ...extra,
  };
}

async function assertCourseScope(userId, courseId, knowledgePointId) {
  const [enrollment, point] = await Promise.all([
    prisma.studentCourseEnrollment.findFirst({ where: { student_user_id: Number(userId), course_id: Number(courseId), enrollment_status: 'active' }, select: { enrollment_id: true } }),
    prisma.knowledgePoint.findFirst({ where: { knowledge_point_id: Number(knowledgePointId), course_id: Number(courseId) }, select: { knowledge_point_id: true } }),
  ]);
  assert(enrollment, '当前课程未选修或已失效', 40301, 403);
  assert(point, '知识点不属于所选课程', 40001, 400);
}

async function ensureSyntheticGoal(userId, input) {
  if (input.learningGoalId) {
    const goal = await prisma.learningGoal.findFirst({ where: { goal_id: Number(input.learningGoalId), student_user_id: Number(userId) } });
    assert(goal, '学习目标不存在或无权访问', 40301, 403);
    return goal;
  }
  const raw = String(input.goalText || '').trim();
  const operationId = `learning-plan:${hash({ userId, courseId: input.courseId, knowledgePointId: input.knowledgePointId, raw }).slice(0, 48)}`;
  const existing = await prisma.learningGoal.findFirst({ where: { student_user_id: Number(userId), operation_id: operationId } });
  if (existing) return existing;
  const snapshot = {
    version: 1, normalizedTitle: raw.slice(0, 255), focusQuestion: raw,
    primaryKnowledgePointId: Number(input.knowledgePointId), relatedKnowledgePoints: [],
    targetMastery: input.targetMastery || 80, estimatedMinutes: input.estimatedMinutes || 25,
    creationMode: input.creationMode, capturedAt: new Date().toISOString(),
  };
  return prisma.learningGoal.create({ data: {
    student_user_id: Number(userId), course_id: Number(input.courseId), raw_goal: raw,
    normalized_goal_hash: hash(`${input.courseId}:${raw.toLowerCase()}`), normalized_title: raw.slice(0, 255),
    focus_question: raw, goal_type: 'DIRECT_MATCH', status: 'CONFIRMED', operation_id: operationId,
    primary_knowledge_point_id: Number(input.knowledgePointId), related_knowledge_points: [],
    target_depth: 'basic', target_mastery: input.targetMastery || 80, estimated_minutes: input.estimatedMinutes || 25,
    coverage_status: 'partial', goal_snapshot: snapshot, confirmed_at: new Date(),
  } });
}

async function resolveWorkflow(userId, input, goal) {
  let templateId = Number(input.workflowTemplateId || goal.workflow_template_id || 0) || null;
  let version = null;
  if (input.workflowVersionId) {
    version = await prisma.learningWorkflowVersion.findUnique({ where: { version_id: Number(input.workflowVersionId) }, include: { template: true } });
    assert(version, '学习流版本不存在', 40002, 404);
    templateId ||= version.template_id;
    assert(version.template_id === templateId, '学习流版本不属于所选模板', 40001, 400);
  }
  assert(templateId, '学习计划缺少工作流，请重新匹配', 40901, 409);
  const template = await templateService.getTemplate(templateId, userId);
  assert(!template.course_id || template.course_id === Number(input.courseId), '工作流与课程范围不兼容', 40901, 409);
  assert(!template.knowledge_point_id || template.knowledge_point_id === Number(input.knowledgePointId), '工作流与知识点范围不兼容', 40901, 409);
  if (!version && goal.workflow_version_id) {
    version = await prisma.learningWorkflowVersion.findFirst({ where: { version_id: goal.workflow_version_id, template_id: templateId } });
  }
  if (!version) version = await prisma.learningWorkflowVersion.findFirst({ where: { template_id: templateId }, orderBy: { version_number: 'desc' } });
  assert(version, '工作流没有可用版本', 40002, 404);
  const graph = sanitizeGraphJson(version.graph_json || {});
  const validation = validateGraphJson(graph);
  assert(validation.valid, `学习流快照无效：${validation.errors.join('；')}`, 40901, 409);
  return { template, version, graph, settings: sanitizeSettingsJson(version.settings_json || {}) };
}

async function syncLegacyContext(tx, userId, plan, workflow, goal) {
  const snapshot = {
    version: 2, capturedAt: new Date().toISOString(), learningPlanId: plan.id,
    scope: { courseId: plan.courseId, knowledgePointId: plan.knowledgePointId, learningGoalId: goal.goal_id, workflowTemplateId: workflow.template.template_id, workflowVersionId: workflow.version.version_id },
    labels: { learningGoal: goal.normalized_title, workflowTemplate: workflow.template.title },
  };
  return tx.studentLearningContext.upsert({
    where: { userId: Number(userId) },
    create: { userId: Number(userId), courseId: plan.courseId, knowledgePointId: plan.knowledgePointId, learningGoalId: goal.goal_id, workflowTemplateId: workflow.template.template_id, targetMastery: plan.targetMastery, completionMode: plan.completionMode || 'MASTERY_TARGET', learningPreferenceJson: {}, voiceConfigJson: {}, contextSnapshotJson: snapshot, contextHash: hash(snapshot), isActive: true },
    update: { courseId: plan.courseId, knowledgePointId: plan.knowledgePointId, learningGoalId: goal.goal_id, workflowTemplateId: workflow.template.template_id, targetMastery: plan.targetMastery, completionMode: plan.completionMode || 'MASTERY_TARGET', contextSnapshotJson: snapshot, contextHash: hash(snapshot), isActive: true },
  });
}

async function createPlan(user, input, options = {}) {
  const userId = Number(user.user_id || user);
  await assertCourseScope(userId, input.courseId, input.knowledgePointId);
  const goal = await ensureSyntheticGoal(userId, input);
  assert(goal.course_id === Number(input.courseId), '学习目标与课程范围冲突', 40901, 409);
  const ids = relatedPointIds(goal);
  assert(!goal.primary_knowledge_point_id || ids.includes(Number(input.knowledgePointId)), '学习目标与知识点范围冲突', 40901, 409);
  const workflow = await resolveWorkflow(userId, input, goal);
  const current = options.makeCurrent === false ? null : await prisma.studentLearningPlan.findFirst({
    where: { studentUserId: userId, activeKey: activeKey(userId) }, include: INCLUDE,
  });
  if (current && current.courseId === Number(input.courseId)
    && current.knowledgePointId === Number(input.knowledgePointId)
    && current.learningGoalId === goal.goal_id
    && current.workflowVersionId === workflow.version.version_id
    && ACTIVE_STATUSES.includes(current.status)) return serialize(current, { idempotentReplay: true });
  const status = enumValue(input.status || 'ready');
  const pointIds = [...new Set([...(input.knowledgePointIds || []), ...ids, Number(input.knowledgePointId)].map(Number).filter(Number.isInteger))];
  const data = {
    studentUserId: userId, courseId: Number(input.courseId), knowledgePointId: Number(input.knowledgePointId), knowledgePointIdsJson: pointIds,
    learningGoalId: goal.goal_id, goalSnapshot: goalSnapshot(goal), workflowTemplateId: workflow.template.template_id,
    workflowVersionId: workflow.version.version_id, graphSnapshot: workflow.graph, settingsSnapshot: workflow.settings,
    creationMode: enumValue(input.creationMode), status, currentNodeId: workflow.graph.entryNodeId || null, progress: 0,
    targetMastery: input.targetMastery ?? goal.target_mastery ?? workflow.settings.target_mastery ?? 80,
    completionMode: completionMode(input.completionMode || workflow.settings.completion_mode),
    estimatedMinutes: input.estimatedMinutes ?? goal.estimated_minutes ?? workflow.settings.estimated_minutes ?? 25,
    activeKey: options.makeCurrent === false ? null : activeKey(userId), readyAt: status === 'READY' ? new Date() : null,
  };
  const created = await prisma.$transaction(async (tx) => {
    if (data.activeKey) {
      await tx.studentLearningPlan.updateMany({
        where: { studentUserId: userId, activeKey: { not: null }, status: { in: ['DRAFT', 'READY', 'FAILED'] } },
        data: { activeKey: null, status: 'ARCHIVED', archivedAt: new Date() },
      });
      await tx.studentLearningPlan.updateMany({
        where: { studentUserId: userId, activeKey: { not: null }, status: { in: ['RUNNING', 'PAUSED', 'COMPLETED', 'ARCHIVED'] } },
        data: { activeKey: null },
      });
    }
    const plan = await tx.studentLearningPlan.create({ data });
    await tx.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { workflow_template_id: workflow.template.template_id, workflow_version_id: workflow.version.version_id, ...(goal.status === 'CONFIRMED' ? { status: 'WORKFLOW_READY' } : {}) } });
    await syncLegacyContext(tx, userId, plan, workflow, goal);
    return plan;
  });
  const hydrated = await prisma.studentLearningPlan.findUnique({ where: { id: created.id }, include: INCLUDE });
  setImmediate(() => require('../learning-flow-preload/learning-flow-preload.service').createPreload(
    { user_id: userId, role: 'student' }, { learningPlanId: created.id, operationId: `plan-created-${created.id}` },
  ).catch(error => console.warn('[student-learning-plan] background preload skipped', { planId: created.id, code: error.code || 'PRELOAD_CREATE_FAILED' })));
  return serialize(hydrated);
}

async function ownedRecord(userId, planId) {
  const record = await prisma.studentLearningPlan.findFirst({ where: { id: Number(planId), studentUserId: Number(userId) }, include: INCLUDE });
  assert(record, '学习计划不存在或无权访问', 40301, 403);
  return record;
}

async function materializeLegacy(user) {
  const userId = Number(user.user_id || user);
  const context = await prisma.studentLearningContext.findFirst({ where: { userId, isActive: true }, include: { learningGoal: true } });
  if (!context) return { plan: null, needsCreation: true, message: '请从三种方式中选择一种创建学习计划' };
  const goal = context.learningGoal;
  if (!goal) return { plan: null, needsRematch: true, message: '历史学习目标已失效，请重新选择学习目标' };
  const sessions = await prisma.learningSession.findMany({ where: { student_user_id: userId, OR: [{ learning_goal_id: goal.goal_id }, { workflow_template_id: context.workflowTemplateId, course_id: context.courseId, knowledge_point_id: context.knowledgePointId }] }, orderBy: { updated_at: 'desc' }, take: 3 });
  let version = null;
  const candidateVersionIds = [goal.workflow_version_id, ...sessions.map(item => item.workflow_version_id)].filter(Boolean);
  for (const versionId of candidateVersionIds) {
    const candidate = await prisma.learningWorkflowVersion.findUnique({ where: { version_id: Number(versionId) }, include: { template: true } });
    if (candidate && (!candidate.template.course_id || candidate.template.course_id === context.courseId) && (!candidate.template.knowledge_point_id || candidate.template.knowledge_point_id === context.knowledgePointId)) { version = candidate; break; }
  }
  if (!version) return { plan: null, needsRematch: true, message: '历史记录缺少固定工作流版本，请确认后重新匹配' };
  try {
    const plan = await createPlan(user, {
      courseId: context.courseId, knowledgePointId: context.knowledgePointId, learningGoalId: goal.goal_id,
      workflowTemplateId: version.template_id, workflowVersionId: version.version_id, creationMode: 'goal_based',
      status: 'ready', targetMastery: context.targetMastery, completionMode: context.completionMode,
    });
    const session = sessions.find(item => item.workflow_version_id === version.version_id) || sessions[0];
    if (session) {
      const status = planStatusFromSession(session);
      await prisma.studentLearningPlan.update({ where: { id: plan.id }, data: { status, learningSessionId: session.session_id, currentNodeId: session.current_node_id, progress: status === 'COMPLETED' ? 100 : 0, startedAt: session.started_at, pausedAt: session.paused_at, completedAt: session.completed_at } });
    }
    return { plan: serialize(await prisma.studentLearningPlan.findUnique({ where: { id: plan.id }, include: INCLUDE })), repaired: true, message: '已按稳定 ID 和历史工作流版本恢复计划' };
  } catch (error) {
    return { plan: null, needsRematch: true, message: '当前计划需要重新匹配学习流', reason: error.message };
  }
}

async function getCurrent(user, { repair = true } = {}) {
  const userId = Number(user.user_id || user);
  let record = await prisma.studentLearningPlan.findFirst({ where: { studentUserId: userId, activeKey: activeKey(userId) }, include: INCLUDE });
  if (!record) {
    record = await prisma.studentLearningPlan.findFirst({ where: { studentUserId: userId, status: { in: ACTIVE_STATUSES } }, include: INCLUDE, orderBy: { updatedAt: 'desc' } });
    if (record) record = await prisma.studentLearningPlan.update({ where: { id: record.id }, data: { activeKey: activeKey(userId) }, include: INCLUDE });
  }
  if (record) return { plan: serialize(record), repaired: false };
  return repair ? materializeLegacy(user) : { plan: null, needsCreation: true };
}

async function listPlans(user, query) {
  const where = { studentUserId: Number(user.user_id) };
  if (query.status) where.status = enumValue(query.status);
  if (query.creationMode) where.creationMode = enumValue(query.creationMode);
  if (query.courseId) where.courseId = Number(query.courseId);
  const [rows, total] = await Promise.all([
    prisma.studentLearningPlan.findMany({ where, include: INCLUDE, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.studentLearningPlan.count({ where }),
  ]);
  return { list: rows.map(serialize), total, page: query.page, pageSize: query.pageSize };
}

async function rematchLegacy(user) {
  const userId = Number(user.user_id);
  const context = await prisma.studentLearningContext.findFirst({ where: { userId, isActive: true }, include: { learningGoal: true } });
  assert(context?.learningGoal, '历史学习目标已失效，请重新选择学习目标', 40901, 409);
  const result = await templateService.listTemplates({
    userId,
    courseId: context.courseId,
    knowledgePointId: context.knowledgePointId,
    learningGoalId: context.learningGoal.goal_id,
    page: 1,
    pageSize: 48,
  });
  const candidate = result.items?.find(item => item.latestVersion?.version_id);
  assert(candidate, '没有找到与当前目标兼容的学习流，请先创建自定义学习流', 40901, 409);
  const plan = await createPlan(user, {
    courseId: context.courseId,
    knowledgePointId: context.knowledgePointId,
    learningGoalId: context.learningGoal.goal_id,
    workflowTemplateId: candidate.template_id,
    workflowVersionId: candidate.latestVersion.version_id,
    creationMode: 'goal_based',
    status: 'ready',
    targetMastery: context.targetMastery,
    completionMode: context.completionMode,
  });
  return { plan, repaired: true, reason: candidate.recommendationReason || '已按当前目标重新匹配固定工作流版本' };
}

async function rematch(user, planId) {
  const current = await ownedRecord(user.user_id, planId);
  assert(!current.learningSessionId && ['DRAFT', 'READY', 'FAILED'].includes(current.status), '已开始的学习计划不能更换工作流版本，请继续或完成当前学习', 40901, 409);
  const result = await templateService.listTemplates({ userId: user.user_id, courseId: current.courseId, knowledgePointId: current.knowledgePointId, learningGoalId: current.learningGoalId, page: 1, pageSize: 48 });
  const candidate = result.items?.find(item => item.latestVersion?.version_id);
  assert(candidate, '没有找到与当前目标兼容的学习流，请先创建自定义学习流', 40901, 409);
  if (Number(candidate.latestVersion.version_id) === Number(current.workflowVersionId)) {
    return { plan: serialize(current), replacedPlanId: null, unchanged: true, reason: '当前计划已使用最匹配的固定版本' };
  }
  const replacement = await createPlan(user, {
    courseId: current.courseId, knowledgePointId: current.knowledgePointId, knowledgePointIds: current.knowledgePointIdsJson,
    learningGoalId: current.learningGoalId, workflowTemplateId: candidate.template_id, workflowVersionId: candidate.latestVersion.version_id,
    creationMode: String(current.creationMode).toLowerCase(), status: 'ready', targetMastery: current.targetMastery,
    completionMode: current.completionMode, estimatedMinutes: current.estimatedMinutes,
  });
  await prisma.studentLearningPlan.update({ where: { id: current.id }, data: { status: 'ARCHIVED', activeKey: null, archivedAt: new Date() } });
  return { plan: replacement, replacedPlanId: current.id, reason: candidate.recommendationReason || '按当前目标重新匹配' };
}

async function transition(user, planId, requestedStatus) {
  const record = await ownedRecord(user.user_id, planId);
  const next = enumValue(requestedStatus);
  assert((STATUS_TRANSITIONS[record.status] || []).includes(next), `学习计划不能从 ${String(record.status).toLowerCase()} 变为 ${String(next).toLowerCase()}`, 40901, 409);
  const now = new Date();
  const data = { status: next, ...(next === 'READY' ? { readyAt: now, errorCode: null, errorMessage: null } : {}), ...(next === 'RUNNING' ? { startedAt: record.startedAt || now, pausedAt: null } : {}), ...(next === 'PAUSED' ? { pausedAt: now } : {}), ...(next === 'COMPLETED' ? { completedAt: now, progress: 100 } : {}), ...(next === 'ARCHIVED' ? { archivedAt: now, activeKey: null } : {}) };
  return serialize(await prisma.studentLearningPlan.update({ where: { id: record.id }, data, include: INCLUDE }));
}

async function prepare(user, planId, operationId) {
  const plan = await ownedRecord(user.user_id, planId);
  assert(['READY', 'RUNNING', 'PAUSED', 'FAILED'].includes(plan.status), '当前计划状态不能进行学习准备', 40901, 409);
  return require('../learning-flow-preload/learning-flow-preload.service').createPreload(user, { learningPlanId: plan.id, operationId });
}

async function findGoalSession(plan, userId, db = prisma) {
  if (!plan.learningGoalId) return null;
  return db.learningSession.findFirst({
    where: { learning_goal_id: Number(plan.learningGoalId), student_user_id: Number(userId) },
    include: { learning_plan: { select: { id: true, studentUserId: true, status: true } } },
    orderBy: { updated_at: 'desc' },
  });
}

async function ensurePlanRoundGoal(plan, userId) {
  const operationId = `learning-plan-round:${Number(plan.id)}`;
  let roundGoal = await prisma.learningGoal.findFirst({ where: { student_user_id: Number(userId), operation_id: operationId } });
  if (!roundGoal) {
    const source = await prisma.learningGoal.findFirst({ where: { goal_id: Number(plan.learningGoalId), student_user_id: Number(userId) } });
    if (!source) throw startError('LEARNING_PLAN_NOT_FOUND', '学习计划关联的目标不存在', 404, { learningPlanId: plan.id, action: 'RECREATE_PLAN' });
    const snapshot = {
      ...json(source.goal_snapshot, {}),
      sourceGoalId: source.goal_id,
      learningPlanId: plan.id,
      roundKey: operationId,
      capturedAt: new Date().toISOString(),
    };
    try {
      roundGoal = await prisma.learningGoal.create({ data: {
        student_user_id: Number(userId), course_id: source.course_id, raw_goal: source.raw_goal,
        normalized_goal_hash: source.normalized_goal_hash, normalized_title: source.normalized_title,
        focus_question: source.focus_question, goal_type: source.goal_type, status: 'WORKFLOW_READY', operation_id: operationId,
        primary_knowledge_point_id: source.primary_knowledge_point_id,
        related_knowledge_points: source.related_knowledge_points, sub_goals: source.sub_goals,
        prerequisite_goals: source.prerequisite_goals, clarification_options: source.clarification_options,
        target_depth: source.target_depth, target_mastery: source.target_mastery,
        estimated_minutes: source.estimated_minutes, coverage_status: source.coverage_status,
        coverage_score: source.coverage_score, coverage_details: source.coverage_details,
        resolver_snapshot: source.resolver_snapshot, planner_snapshot: source.planner_snapshot,
        goal_snapshot: snapshot, workflow_template_id: plan.workflowTemplateId,
        workflow_version_id: plan.workflowVersionId, confirmed_at: source.confirmed_at || new Date(),
      } });
    } catch (error) {
      if (error.code !== 'P2002') throw error;
      roundGoal = await prisma.learningGoal.findFirst({ where: { student_user_id: Number(userId), operation_id: operationId } });
      if (!roundGoal) throw error;
    }
  }
  await prisma.studentLearningPlan.updateMany({
    where: { id: Number(plan.id), studentUserId: Number(userId), learningSessionId: null },
    data: { learningGoalId: roundGoal.goal_id, goalSnapshot: goalSnapshot(roundGoal) },
  });
  return ownedRecord(userId, plan.id);
}

async function preparePlanForSession(plan, userId) {
  if (plan.learningSessionId) return plan;
  const goalSession = await findGoalSession(plan, userId);
  if (!goalSession) return plan;
  const owner = goalSession.learning_plan || await prisma.studentLearningPlan.findFirst({ where: { learningSessionId: goalSession.session_id }, select: { id: true, studentUserId: true, status: true } });
  if (RESUMABLE_SESSION_STATUSES.has(String(goalSession.status)) && owner && Number(owner.id) !== Number(plan.id)) {
    throw startError('SESSION_CONFLICT', '同一学习目标已有其他计划的进行中会话，请继续原会话或先结束它。', 409, {
      learningPlanId: plan.id, existingPlanId: owner.id, existingSessionId: goalSession.session_id,
      existingSessionStatus: String(goalSession.status).toLowerCase(), action: 'CONTINUE_EXISTING_SESSION',
    });
  }
  if (TERMINAL_SESSION_STATUSES.has(String(goalSession.status))) return ensurePlanRoundGoal(plan, userId);
  return plan;
}

async function resolveSessionForPlan(plan, userId, runtime, db = prisma) {
  if (plan.learningSessionId) return runtime.getSession(plan.learningSessionId, userId);
  const goalSession = await findGoalSession(plan, userId, db);
  if (goalSession) return runtime.getSession(goalSession.session_id, userId);
  try {
    return await runtime.createSession({
      userId, courseId: plan.courseId, knowledgePointId: plan.knowledgePointId,
      templateId: plan.workflowTemplateId, versionId: plan.workflowVersionId,
      graphSnapshot: plan.graphSnapshot, settingsSnapshot: plan.settingsSnapshot,
      completionMode: plan.completionMode, targetMastery: plan.targetMastery,
      estimatedMinutes: plan.estimatedMinutes, learningGoalId: plan.learningGoalId, goalSnapshot: plan.goalSnapshot,
    });
  } catch (error) {
    // A learning goal owns one session. Concurrent starts can reach the unique
    // key before the plan has been linked; recover that session instead.
    if (error.code !== 'P2002' || !plan.learningGoalId) throw error;
    const raced = await findGoalSession(plan, userId, db);
    if (!raced) throw error;
    return runtime.getSession(raced.session_id, userId);
  }
}

async function syncPlanToSession(plan, session) {
  const graph = session.workflow_snapshot_json || session.runtime_graph_json || plan.graphSnapshot || {};
  const totalNodes = Array.isArray(session.runtime_graph_json?.nodes)
    ? session.runtime_graph_json.nodes.length
    : Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  const completedNodes = new Set((session.node_runs || [])
    .filter(item => ['COMPLETED', 'SKIPPED'].includes(item.status))
    .map(item => String(item.node_id))).size;
  const status = planStatusFromSession(session);
  const version = session.workflow_version_id
    ? await prisma.learningWorkflowVersion.findUnique({
      where: { version_id: Number(session.workflow_version_id) },
      select: { settings_json: true },
    })
    : null;
  const owner = await prisma.studentLearningPlan.findFirst({ where: { learningSessionId: session.session_id }, select: { id: true, studentUserId: true } });
  if (owner && Number(owner.id) !== Number(plan.id)) throw startError('SESSION_CONFLICT', '该学习会话已绑定到其他学习计划。', 409, { learningPlanId: plan.id, existingPlanId: owner.id, existingSessionId: session.session_id, action: 'CONTINUE_EXISTING_SESSION' });
  const data = {
      learningSessionId: session.session_id,
      workflowTemplateId: session.workflow_template_id || plan.workflowTemplateId,
      workflowVersionId: session.workflow_version_id || plan.workflowVersionId,
      graphSnapshot: json(graph),
      settingsSnapshot: version?.settings_json ? sanitizeSettingsJson(version.settings_json) : plan.settingsSnapshot,
      status,
      currentNodeId: session.current_node_id,
      progress: status === 'COMPLETED' ? 100 : (totalNodes ? Math.min(99, Math.round((completedNodes / totalNodes) * 100)) : 0),
      targetMastery: session.target_mastery || plan.targetMastery,
      completionMode: completionMode(session.completion_mode || plan.completionMode),
      estimatedMinutes: session.estimated_minutes || plan.estimatedMinutes,
      startedAt: session.started_at || plan.startedAt,
      pausedAt: session.paused_at,
      completedAt: session.completed_at,
      ...(status !== 'FAILED' ? { errorCode: null, errorMessage: null } : {}),
  };
  try {
    return await prisma.studentLearningPlan.update({ where: { id: plan.id }, data, include: INCLUDE });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const winner = await prisma.studentLearningPlan.findFirst({ where: { learningSessionId: session.session_id }, include: INCLUDE });
    if (winner && Number(winner.id) === Number(plan.id)) return winner;
    throw startError('SESSION_CONFLICT', '学习会话绑定发生并发冲突，请继续已创建的会话。', 409, { learningPlanId: plan.id, existingPlanId: winner?.id || null, existingSessionId: session.session_id, action: winner?.studentUserId === plan.studentUserId ? 'CONTINUE_EXISTING_SESSION' : 'RETRY' });
  }
}

async function startUnlocked(user, planId, options = {}) {
  const userId = Number(user.user_id);
  let plan = await prisma.studentLearningPlan.findFirst({ where: { id: Number(planId), studentUserId: userId }, include: INCLUDE });
  if (!plan) throw startError('LEARNING_PLAN_FORBIDDEN', '学习计划不存在或无权访问', 403, { learningPlanId: Number(planId), action: 'REFRESH_PLAN', requestId: options.requestId || null });
  if (!STARTABLE_PLAN_STATUSES.has(String(plan.status))) throw startError('INVALID_SESSION_STATE', `当前计划状态 ${String(plan.status).toLowerCase()} 不能开始学习`, 409, { learningPlanId: plan.id, planStatus: String(plan.status).toLowerCase(), action: 'REFRESH_PLAN' });
  const readiness = buildReadiness(plan);
  if (!readiness.canStart) {
    const first = readiness.blockingReasons[0] || {};
    throw startError(first.code || 'PRELOAD_REQUIRED_FAILED', first.message || '学习计划尚未满足启动条件', 409, { learningPlanId: plan.id, readiness, action: first.action || 'REPREPARE' });
  }
  const runtime = require('../learning-workflow/workflow-runtime.service');
  try {
    if (plan.learningSessionId) {
      let linked = await runtime.getSession(plan.learningSessionId, userId);
      if (linked.status === 'COMPLETED') return { plan: serialize(plan), session: await runtime.getPublicSession(linked.session_id, userId), readiness, idempotentReplay: true, navigation: 'results' };
      if (linked.status === 'ABANDONED') throw startError('INVALID_SESSION_STATE', '当前计划的学习会话已废弃，请创建新计划。', 409, { learningPlanId: plan.id, sessionId: linked.session_id, action: 'CREATE_NEW_PLAN' });
      if (['CREATED', 'PAUSED', 'FAILED'].includes(linked.status)) linked = await runtime.startSession(linked.session_id, userId);
      plan = await syncPlanToSession(plan, linked);
      return { plan: serialize(plan), session: await runtime.getPublicSession(linked.session_id, userId), readiness, idempotentReplay: true, navigation: 'session' };
    }

    plan = await preparePlanForSession(plan, userId);
    let session = await resolveSessionForPlan(plan, userId, runtime);
    if (session.status === 'ABANDONED') {
      plan = await ensurePlanRoundGoal(plan, userId);
      session = await resolveSessionForPlan(plan, userId, runtime);
    }
    plan = await syncPlanToSession(plan, session);
    if (['CREATED', 'PAUSED', 'FAILED'].includes(session.status)) {
      session = await runtime.startSession(session.session_id, userId);
      plan = await syncPlanToSession(plan, session);
    }
    if (session.status === 'COMPLETED') return { plan: serialize(plan), session: await runtime.getPublicSession(session.session_id, userId), readiness, idempotentReplay: true, navigation: 'results' };
    require('../learning-flow-preload/knowledge-card.service').fireAndRecord({
      userId, sessionId: session.session_id, nodeId: session.current_node_id, reason: 'learning_plan_start',
    });
    return { plan: serialize(plan), session: await runtime.getPublicSession(session.session_id, userId), readiness, idempotentReplay: false, navigation: 'session' };
  } catch (error) {
    if (error instanceof LearningStartError) throw error;
    const code = String(error.publicCode || error.code || '');
    if (['VERSION_NOT_FOUND', 'TEMPLATE_NOT_FOUND', 'INVALID_GRAPH_SNAPSHOT'].includes(code)) throw startError('WORKFLOW_SNAPSHOT_MISSING', '当前学习流快照不可用，请重新匹配学习流。', 409, { learningPlanId: plan.id, causeCode: code, action: 'REMATCH_WORKFLOW' });
    if (['NODE_NOT_FOUND', 'NO_CURRENT_NODE'].includes(code)) throw startError('FIRST_NODE_NOT_READY', '学习流首节点尚不可用，请重新准备。', 409, { learningPlanId: plan.id, causeCode: code, action: 'REPREPARE' });
    if (/timeout|timed out/i.test(String(error.message || '')) || code === 'P2028') throw startError('LEARNING_START_TIMEOUT', '学习会话启动超时，请重试；重复请求不会创建新会话。', 504, { learningPlanId: plan.id, causeCode: code || null, action: 'RETRY' }, { retryable: true });
    throw startError('SESSION_CREATE_FAILED', '学习会话暂时无法创建，请重试；已有计划和准备内容已保留。', 503, { learningPlanId: plan.id, causeCode: code || null, action: 'RETRY' }, { retryable: true });
  }
}

function start(user, planId, options = {}) {
  return withStartLock(`student:${Number(user.user_id)}:plan:${Number(planId)}`, () => startUnlocked(user, planId, options));
}

async function listReferenceMaterials(user, planId) {
  const userId = Number(user.user_id || user);
  const plan = await ownedRecord(userId, planId);
  const [links, recentArtifacts, scope, knowledgeBases] = await Promise.all([
    prisma.learningFlowResourceLink.findMany({
      where: {
        ownerUserId: userId,
        deletedAt: null,
        OR: [
          { learningPlanId: plan.id },
          ...(plan.learningSessionId ? [{ learningSessionId: plan.learningSessionId }] : []),
          ...(plan.learningGoalId ? [{ learningGoalId: plan.learningGoalId }] : []),
        ],
      },
      include: { artifact: { include: { exports: { where: { format: 'PDF', status: 'READY', deletedAt: null } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.generatedArtifact.findMany({
      where: { ownerUserId: userId, courseId: plan.courseId, deletedAt: null, status: 'READY' },
      include: { exports: { where: { format: 'PDF', status: 'READY', deletedAt: null } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    loadUserScope(userId),
    prisma.knowledgeBase.findMany({
      where: { deleted_at: null, status: 'active' },
      include: {
        teaching_class: { select: { course_id: true } },
        documents: { where: { deleted_at: null, file_ext: '.pdf', mime_type: 'application/pdf' }, orderBy: { updated_at: 'desc' } },
      },
      orderBy: { updated_at: 'desc' },
      take: 200,
    }),
  ]);

  const records = [];
  const seen = new Set();
  const addArtifact = (artifact, role = 'REFERENCE_MATERIAL', linkId = null) => {
    const pdf = artifact?.exports?.find(item => item.storagePath);
    if (!pdf || seen.has(`artifact:${artifact.id}`)) return;
    seen.add(`artifact:${artifact.id}`);
    const group = role === 'PRE_CLASS_HANDOUT' ? 'pre_class' : 'generated_artifact';
    const url = `/generated-artifacts/${artifact.id}/exports/PDF/download`;
    records.push({
      id: `artifact:${artifact.id}`, sourceType: 'generated_artifact', group,
      title: artifact.title, fileName: artifact.fileName || `${artifact.title}.pdf`, mimeType: 'application/pdf',
      artifactId: artifact.id, resourceLinkId: linkId, createdAt: artifact.updatedAt,
      previewable: true, downloadable: true, previewUrl: url, downloadUrl: url,
    });
  };
  links.forEach(link => addArtifact(link.artifact, link.resourceRole, link.id));
  recentArtifacts.forEach((artifact) => {
    const prefill = artifact.requirementsJson?.learningFlowPrefill || artifact.requirementsJson?.learning_flow_prefill || {};
    if (Number(prefill.learningPlanId || prefill.learning_plan_id) === plan.id) addArtifact(artifact);
  });

  knowledgeBases.filter(kb => canAccessKnowledgeBase(kb, userId, scope)).forEach((kb) => {
    kb.documents.forEach((doc) => {
      const key = `knowledge:${kb.knowledge_base_id}:${doc.document_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const url = `/knowledge-bases/${kb.knowledge_base_id}/documents/${doc.document_id}/preview`;
      records.push({
        id: key, sourceType: 'knowledge_base', group: 'knowledge', title: doc.title || doc.original_filename,
        fileName: doc.original_filename, mimeType: doc.mime_type, knowledgeBaseId: kb.knowledge_base_id,
        knowledgeBaseName: kb.name, documentId: doc.document_id, createdAt: doc.updated_at,
        previewable: true, downloadable: true, previewUrl: url, downloadUrl: url,
      });
    });
  });

  return {
    learningPlanId: plan.id,
    learningSessionId: plan.learningSessionId,
    groups: [
      { id: 'pre_class', label: '课前预习资料' },
      { id: 'generated_artifact', label: '学习计划产物' },
      { id: 'knowledge', label: '有权限的知识库 PDF' },
    ],
    list: records,
  };
}

module.exports = {
  ACTIVE_STATUSES, STATUS_TRANSITIONS, STARTABLE_PLAN_STATUSES, RESUMABLE_SESSION_STATUSES,
  LearningStartError, startError, withStartLock, sessionStartAction, buildReadiness, serialize, createPlan, ownedRecord,
  getCurrent, listPlans, materializeLegacy, rematchLegacy, rematch, transition, prepare,
  findGoalSession, ensurePlanRoundGoal, preparePlanForSession, resolveSessionForPlan, syncPlanToSession,
  startUnlocked, start, listReferenceMaterials,
};
