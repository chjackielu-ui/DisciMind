const crypto = require('crypto');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const templateService = require('../learning-workflow/workflow-template.service');
const cache = require('./learning-flow-preload-cache.service');
const { getNarrationConfig } = require('../learning-narration/config');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');

function operationId() { return crypto.randomUUID(); }

function serialize(preload, task = null) {
  const expired = preload.status === 'EXPIRED' || new Date(preload.expiresAt).getTime() <= Date.now();
  return {
    id: preload.id,
    learningPlanId: preload.learningPlanId,
    workflowTemplateId: preload.workflowTemplateId,
    learningGoalId: preload.learningGoalId,
    learningSessionId: preload.learningSessionId,
    workflowVersion: preload.workflowVersion,
    status: expired ? 'EXPIRED' : preload.status,
    progress: expired ? 0 : preload.progress,
    stage: expired ? '准备内容已过期' : preload.stage,
    preloadReady: !expired && ['PARTIAL', 'READY'].includes(preload.status),
    manifest: preload.manifestJson,
    preparedNodeIds: preload.preparedNodeIdsJson || [],
    preparedContentCount: preload.preparedContentCount,
    preparedAudioCount: preload.preparedAudioCount,
    errorCode: preload.errorCode,
    errorMessage: preload.errorMessage,
    expiresAt: preload.expiresAt,
    startedAt: preload.startedAt,
    completedAt: preload.completedAt,
    createdAt: preload.createdAt,
    updatedAt: preload.updatedAt,
    task: task ? tasks.serialize(task) : null,
  };
}

async function latestTask(preloadId) {
  return prisma.asyncTask.findFirst({
    where: { relatedResourceType: 'LEARNING_FLOW_PRELOAD', relatedResourceId: String(preloadId), taskType: 'LEARNING_FLOW_PRELOAD' },
    orderBy: { createdAt: 'desc' },
  });
}

async function contextFor(userId, input) {
  const plan = input.learningPlanId ? await prisma.studentLearningPlan.findFirst({
    where: { id: Number(input.learningPlanId), studentUserId: Number(userId) },
  }) : null;
  if (input.learningPlanId) assert(plan, '学习计划不存在或无权访问', 40301, 403);
  const workflowTemplateId = plan?.workflowTemplateId || input.workflowTemplateId;
  const learningGoalId = plan?.learningGoalId || input.learningGoalId;
  assert(workflowTemplateId && learningGoalId, '学习计划缺少目标或工作流绑定', 40901, 409);
  const [template, goal, activeLearningContext] = await Promise.all([
    templateService.getTemplate(workflowTemplateId, userId),
    prisma.learningGoal.findFirst({
      where: { goal_id: Number(learningGoalId), student_user_id: userId },
      include: {
        course: { select: { course_id: true, course_name: true } },
        primary_knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true, description: true } },
      },
    }),
    prisma.studentLearningContext.findFirst({ where: { userId, isActive: true } }),
  ]);
  assert(goal, '学习目标不存在或无权访问', 40301, 403);
  assert(!template.course_id || template.course_id === goal.course_id, '学习目标与工作流课程不一致', 40001, 400);
  const relatedIds = Array.isArray(goal.related_knowledge_points) ? goal.related_knowledge_points.map(item => Number(item?.knowledgePointId)) : [];
  assert(!template.knowledge_point_id || !goal.primary_knowledge_point_id || template.knowledge_point_id === goal.primary_knowledge_point_id || relatedIds.includes(template.knowledge_point_id), '当前计划需要重新匹配学习流', 40901, 409);
  let session = null;
  if (input.learningSessionId) {
    session = await prisma.learningSession.findFirst({ where: { session_id: Number(input.learningSessionId), student_user_id: userId } });
    assert(session, '学习会话不存在或无权访问', 40301, 403);
    assert(!session.workflow_template_id || session.workflow_template_id === template.template_id, '学习会话与工作流不一致', 40001, 400);
    assert(!session.learning_goal_id || session.learning_goal_id === goal.goal_id, '学习会话与学习目标不一致', 40001, 400);
  }
  let version = plan?.workflowVersionId
    ? await prisma.learningWorkflowVersion.findFirst({ where: { version_id: plan.workflowVersionId, template_id: template.template_id } })
    : null;
  if (!version && goal.workflow_version_id) version = await prisma.learningWorkflowVersion.findFirst({ where: { version_id: goal.workflow_version_id, template_id: template.template_id } });
  if (!version) version = await prisma.learningWorkflowVersion.findFirst({ where: { template_id: template.template_id }, orderBy: { version_number: 'desc' } });
  assert(version, '工作流没有可用版本', 40002, 404);
  const [mastery, wrongCount, recentAnswers] = await Promise.all([
    goal.primary_knowledge_point_id ? prisma.studentMasteryRecord.findUnique({
      where: { student_user_id_course_id_knowledge_point_id: { student_user_id: userId, course_id: goal.course_id, knowledge_point_id: goal.primary_knowledge_point_id } },
      select: { mastery_score: true, updated_at: true },
    }) : null,
    prisma.wrongQuestion.count({ where: { student_user_id: userId, course_id: goal.course_id, ...(goal.primary_knowledge_point_id ? { knowledge_point_id: goal.primary_knowledge_point_id } : {}), status: 'UNRESOLVED' } }),
    prisma.answerRecord.findMany({ where: { student_user_id: userId, question: { course_id: goal.course_id, ...(goal.primary_knowledge_point_id ? { knowledge_point_id: goal.primary_knowledge_point_id } : {}) } }, orderBy: { created_at: 'desc' }, take: 10, select: { is_correct: true, created_at: true } }),
  ]);
  const graph = plan?.graphSnapshot || version.graph_json || {};
  const voice = getNarrationConfig();
  const hashes = {
    goalSnapshotHash: cache.hash({ id: goal.goal_id, updatedAt: goal.updated_at, snapshot: goal.goal_snapshot, title: goal.normalized_title, primaryKnowledgePointId: goal.primary_knowledge_point_id }),
    studentContextHash: cache.hash({
      mastery, wrongCount, recentAnswers,
      learningContextHash: activeLearningContext
        && activeLearningContext.workflowTemplateId === template.template_id
        && activeLearningContext.learningGoalId === goal.goal_id
        ? activeLearningContext.contextHash : null,
    }),
    agentConfigHash: cache.hash({ model: process.env.BAILIAN_MODEL || 'qwen3.7-plus', nodes: (graph.nodes || []).map((node) => ({ id: node.id, type: node.type, agentType: node.agentType, config: node.config })) }),
    systemPromptHash: cache.hash({ version: process.env.LEARNING_GUIDE_SYSTEM_PROMPT_VERSION || 'v1', model: process.env.BAILIAN_MODEL || 'qwen3.7-plus' }),
    voiceConfigHash: cache.hash({ model: voice.model, voice: activeLearningContext?.voiceConfigJson?.voice || voice.voice, speed: activeLearningContext?.voiceConfigJson?.speechRate || voice.speechRate, enabled: activeLearningContext?.voiceConfigJson?.enabled ?? voice.enabled, language: process.env.BAILIAN_TTS_LANGUAGE_TYPE || 'Chinese', format: voice.responseFormat, sampleRate: voice.sampleRate }),
  };
  const preloadKey = cache.hash({ userId, learningPlanId: plan?.id || null, workflowTemplateId: template.template_id, workflowVersion: version.version_number, graph, ...hashes });
  return { plan, template, goal, session, version, graph, mastery, wrongCount, recentAnswers, hashes, preloadKey };
}

async function ensureTask(userId, preload, rawOperationId, force = false) {
  const existing = await latestTask(preload.id);
  if (existing && (!force || ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'].includes(existing.status))) return existing;
  const created = await tasks.createTask(userId, {
    operationId: `learning-flow-preload-${preload.id}-${rawOperationId || operationId()}`,
    taskType: 'LEARNING_FLOW_PRELOAD', title: '学习资料准备中', description: '准备学习流基础包、首节点内容与学习引导语音',
    status: 'QUEUED', stage: '等待开始学习准备', progressMode: 'DETERMINATE', progress: 0,
    relatedResourceType: 'LEARNING_FLOW_PRELOAD', relatedResourceId: preload.id,
    resultType: 'LEARNING_FLOW_PRELOAD', resultId: preload.id,
    resultUrl: `#/student/learning-flows?flowId=${preload.workflowTemplateId}&preloadId=${preload.id}`,
    cancellable: false, maxAttempts: 3, metadataJson: { preloadId: preload.id },
  });
  return prisma.asyncTask.findUnique({ where: { id: created.id } });
}

async function createPreload(user, input) {
  const userId = Number(user.user_id);
  if (!input.learningPlanId && (!input.workflowTemplateId || !input.learningGoalId)) {
    const currentPlan = await prisma.studentLearningPlan.findFirst({ where: { studentUserId: userId, activeKey: `student:${userId}` } });
    if (currentPlan) input = { ...input, learningPlanId: currentPlan.id };
  }
  if (!input.learningPlanId && (!input.workflowTemplateId || !input.learningGoalId)) {
    const active = await prisma.studentLearningContext.findFirst({ where: { userId, isActive: true } });
    assert(active, '请先设置当前学习上下文', 40901, 409);
    input = { ...input, workflowTemplateId: input.workflowTemplateId || active.workflowTemplateId, learningGoalId: input.learningGoalId || active.learningGoalId };
  }
  await cache.expireDue();
  const context = await contextFor(userId, input);
  await prisma.learningFlowPreload.updateMany({
    where: { userId, workflowTemplateId: context.template.template_id, learningGoalId: context.goal.goal_id, activeKey: { not: null }, OR: [{ preloadKey: { not: context.preloadKey } }, { expiresAt: { lte: new Date() } }] },
    data: { status: 'EXPIRED', progress: 0, stage: '依赖配置已变化', activeKey: null },
  });
  let preload = await prisma.learningFlowPreload.findFirst({ where: { userId, activeKey: context.preloadKey, deletedAt: null } });
  if (!preload) {
    try {
      preload = await prisma.learningFlowPreload.create({ data: {
        learningPlanId: context.plan?.id || null,
        userId, workflowTemplateId: context.template.template_id, learningGoalId: context.goal.goal_id,
        learningSessionId: context.session?.session_id || null, workflowVersion: context.version.version_number,
        ...context.hashes, preloadKey: context.preloadKey, activeKey: context.preloadKey,
        status: 'QUEUED', progress: 0, stage: '等待开始学习准备', expiresAt: cache.expiresAt(),
      } });
    } catch (error) {
      if (error.code !== 'P2002') throw error;
      preload = await prisma.learningFlowPreload.findFirst({ where: { userId, activeKey: context.preloadKey, deletedAt: null } });
    }
  }
  const task = await ensureTask(userId, preload, input.operationId);
  return serialize(preload, task);
}

async function getPreload(user, preloadId) {
  await cache.expireDue();
  const preload = await prisma.learningFlowPreload.findFirst({ where: { id: Number(preloadId), userId: Number(user.user_id), deletedAt: null } });
  assert(preload, '学习准备记录不存在或无权访问', 40301, 403);
  return serialize(preload, await latestTask(preload.id));
}

async function listPreloads(user, query) {
  await cache.expireDue();
  const where = { userId: Number(user.user_id), deletedAt: null };
  for (const field of ['learningPlanId', 'workflowTemplateId', 'learningGoalId', 'status']) if (query[field] != null) where[field] = query[field];
  const [records, total] = await Promise.all([
    prisma.learningFlowPreload.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.learningFlowPreload.count({ where }),
  ]);
  return { list: records.map((item) => serialize(item)), total, page: query.page, pageSize: query.pageSize };
}

async function retryPreload(user, preloadId, operation) {
  const userId = Number(user.user_id);
  const preload = await prisma.learningFlowPreload.findFirst({ where: { id: Number(preloadId), userId, deletedAt: null } });
  assert(preload, '学习准备记录不存在或无权访问', 40301, 403);
  const current = await contextFor(userId, { learningPlanId: preload.learningPlanId, workflowTemplateId: preload.workflowTemplateId, learningGoalId: preload.learningGoalId, learningSessionId: preload.learningSessionId });
  if (current.preloadKey !== preload.preloadKey || new Date(preload.expiresAt) <= new Date()) {
    await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: { status: 'EXPIRED', activeKey: null, stage: '准备依赖已变化' } });
    return createPreload(user, { learningPlanId: preload.learningPlanId, workflowTemplateId: preload.workflowTemplateId, learningGoalId: preload.learningGoalId, learningSessionId: preload.learningSessionId, operationId: operation || operationId() });
  }
  const reset = await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: { status: 'QUEUED', progress: 0, stage: '等待重新准备', errorCode: null, errorMessage: null, expiresAt: cache.expiresAt() } });
  return serialize(reset, await ensureTask(userId, reset, operation || operationId(), true));
}

async function validateForQuickStart(userId, preloadId, { workflowTemplateId, learningGoalId }) {
  const preload = await prisma.learningFlowPreload.findFirst({ where: { id: Number(preloadId), userId: Number(userId), deletedAt: null } });
  if (!preload || preload.workflowTemplateId !== Number(workflowTemplateId) || preload.learningGoalId !== Number(learningGoalId) || !cache.isUsable(preload)) return null;
  const current = await contextFor(Number(userId), { learningPlanId: preload.learningPlanId, workflowTemplateId, learningGoalId, learningSessionId: preload.learningSessionId });
  if (current.preloadKey !== preload.preloadKey) {
    await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: { status: 'EXPIRED', activeKey: null, progress: 0, stage: '准备依赖已变化' } });
    return null;
  }
  return preload;
}

module.exports = { serialize, latestTask, contextFor, ensureTask, createPreload, getPreload, listPreloads, retryPreload, validateForQuickStart };
