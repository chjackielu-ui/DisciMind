const crypto = require('crypto');
const prisma = require('../../config/prisma');
const { bailianModelCall } = require('../learning-agent/adapters/bailian-model.adapter');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { operationKey } = require('../async-task/async-task.service');

const FIELD_PRIORITY = ['artifactType', 'courseKey', 'knowledgePointKeys', 'difficulty', 'questionCount', 'includeAnswers', 'includeAnalysis'];
const PUBLIC_FIELDS = ['artifactType', 'courseKey', 'knowledgePointKeys', 'title', 'difficulty', 'questionCount', 'includeAnswers', 'includeAnalysis', 'outputFormat', 'generationStyle', 'specialRequirements'];

function safeKey(prefix, ...parts) {
  return `${prefix}_${crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 12)}`;
}

function hasDatabaseIdInjection(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some(key => /(^|_)(course|knowledge.?point)?ids?$/i.test(key))
    || Object.values(value).some(item => hasDatabaseIdInjection(item));
}

function missingFields(draft) {
  return FIELD_PRIORITY.filter(field => {
    if (draft.artifactType === 'STUDY_HANDOUT' && ['questionCount', 'includeAnswers', 'includeAnalysis'].includes(field)) return false;
    const value = draft[field];
    return value === undefined || value === null || value === '' || Array.isArray(value) && value.length === 0;
  });
}

function buildQuestions(missing) {
  const labels = {
    artifactType: '需要生成试卷还是学习讲义？', courseKey: '请选择课程或主题。', knowledgePointKeys: '请选择需要覆盖的知识点。',
    difficulty: '希望采用基础、中等还是进阶难度？', questionCount: '需要生成多少道题（最多 50 道）？',
    includeAnswers: '是否包含答案？', includeAnalysis: '是否包含解析？',
  };
  return missing.slice(0, 2).map(field => ({ field, question: labels[field] }));
}

async function loadConversation(userId, conversationId) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({
    where: { id: Number(conversationId), userId, deletedAt: null },
    include: { agent: true, agentVersion: true },
  });
  assert(conversation, '对话不存在或无权访问', 40301, 403);
  assert(conversation.agent.agentType === 'FILE_GENERATOR', 'CHAT Agent 不能进入文件 Planner', 40903, 409);
  return conversation;
}

async function accessibleCandidates(userId) {
  const user = await prisma.user.findUnique({ where: { user_id: userId }, select: { role: true } });
  const courseWhere = user?.role === 'TEACHER'
    ? { status: 'ACTIVE', teacher_relations: { some: { teacher_user_id: userId } } }
    : { status: 'ACTIVE', enrollments: { some: { student_user_id: userId, enrollment_status: 'active' } } };
  const courses = await prisma.course.findMany({ where: courseWhere, include: { knowledge_points: { orderBy: { sort_order: 'asc' } } }, orderBy: { course_id: 'asc' } });
  const courseMap = new Map(); const knowledgeMap = new Map(); const publicCourses = []; const publicKnowledgePoints = [];
  for (const course of courses) {
    const courseKey = safeKey('course', course.course_id, course.course_code);
    courseMap.set(courseKey, course); publicCourses.push({ courseKey, courseName: course.course_name });
    for (const point of course.knowledge_points) {
      const knowledgePointKey = safeKey('kp', course.course_id, point.knowledge_point_id, point.knowledge_point_code);
      knowledgeMap.set(knowledgePointKey, point);
      publicKnowledgePoints.push({ courseKey, knowledgePointKey, knowledgePointName: point.knowledge_point_name });
    }
  }
  return { courseMap, knowledgeMap, publicCourses, publicKnowledgePoints };
}

function normalizePatch(raw) {
  assert(!hasDatabaseIdInjection(raw), 'Planner 输出包含不允许的数据库 ID 字段');
  const patch = {};
  for (const field of PUBLIC_FIELDS) if (raw?.[field] !== undefined) patch[field] = raw[field];
  if (patch.questionCount !== undefined) assert(Number.isInteger(Number(patch.questionCount)) && Number(patch.questionCount) <= 50 && Number(patch.questionCount) > 0, '题目数量必须为 1～50');
  if (patch.outputFormat !== undefined) assert(patch.outputFormat === 'DOCX', '当前仅支持 DOCX');
  return patch;
}

async function resolveAndPersist(userId, conversation, patch, { explicit = false } = {}) {
  const candidates = await accessibleCandidates(userId);
  const previous = conversation.requirementDraftJson || {};
  const confirmed = new Set(previous.confirmedFields || []);
  const next = { ...previous };
  for (const [field, value] of Object.entries(normalizePatch(patch))) {
    if (!explicit && confirmed.has(field)) continue;
    next[field] = value;
    if (explicit) confirmed.add(field);
  }
  next.outputFormat ||= 'DOCX';
  if (next.courseKey) {
    const course = candidates.courseMap.get(next.courseKey); assert(course, '非法或无权限的 courseKey', 40301, 403);
    next.courseId = course.course_id; next.courseName = course.course_name;
  }
  if (next.knowledgePointKeys?.length) {
    const points = next.knowledgePointKeys.map(key => { const point = candidates.knowledgeMap.get(key); assert(point, '非法或无权限的 knowledgePointKey', 40301, 403); return point; });
    assert(points.every(point => point.course_id === next.courseId), '知识点不属于所选课程');
    next.knowledgePointIds = points.map(point => point.knowledge_point_id);
    next.knowledgePointNames = points.map(point => point.knowledge_point_name);
  }
  next.confirmedFields = [...confirmed];
  const missing = missingFields(next); next.missingFields = missing; next.readyForConfirmation = missing.length === 0;
  const status = next.readyForConfirmation ? 'READY_TO_CONFIRM' : 'COLLECTING';
  await prisma.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: { requirementDraftJson: next, requirementStatus: status } });
  return serializeDraft(next, status);
}

function serializeDraft(draft, status) {
  const safe = {}; for (const field of PUBLIC_FIELDS) if (draft[field] !== undefined) safe[field] = draft[field];
  safe.courseName = draft.courseName || null; safe.knowledgePointNames = draft.knowledgePointNames || [];
  safe.missingFields = draft.missingFields || missingFields(draft); safe.questions = buildQuestions(safe.missingFields);
  safe.readyForConfirmation = Boolean(draft.readyForConfirmation); safe.status = status; return safe;
}

async function patchRequirements(userId, conversationId, patch) {
  const conversation = await loadConversation(userId, conversationId);
  return resolveAndPersist(userId, conversation, patch, { explicit: true });
}

async function planRequirements(userId, conversationId, message, options = {}) {
  const conversation = await loadConversation(userId, conversationId);
  const candidates = await accessibleCandidates(userId);
  const current = serializeDraft(conversation.requirementDraftJson || {}, conversation.requirementStatus);
  const prompt = `你是教育文件需求 Planner。只输出 JSON。禁止输出或猜测任何数据库 ID。\n当前草稿:${JSON.stringify(current)}\n课程候选:${JSON.stringify(candidates.publicCourses)}\n知识点候选:${JSON.stringify(candidates.publicKnowledgePoints)}\n用户补充:${message}\n仅输出可从用户文本确定的字段；courseKey 与 knowledgePointKeys 只能从候选选择。`;
  const modelCall = options.modelCall || bailianModelCall;
  const result = await modelCall([{ role: 'system', content: '使用 qwen3.7-plus JSON mode 提取受控文件需求，不得臆造字段。' }, { role: 'user', content: prompt }],
    { jsonMode: true, enableThinking: false, temperature: 0.1, maxTokens: 1000, timeoutMs: 120000 });
  let parsed; try { parsed = typeof result.content === 'string' ? JSON.parse(result.content.replace(/^```(?:json)?\s*|\s*```$/g, '')) : result.content; } catch { throw Object.assign(new Error('Planner 返回格式无效'), { code: 50002 }); }
  const planned = await resolveAndPersist(userId, conversation, parsed, { explicit: false });
  const assistantContent = planned.readyForConfirmation
    ? `需求已齐全，请确认生成：${planned.title || planned.courseName || '教育文件'}（${planned.outputFormat || 'DOCX'}）`
    : planned.questions.map(item => item.question).join('\n');
  await prisma.marketplaceAgentMessage.createMany({ data: [
    { conversationId: conversation.id, role: 'USER', content: message, generationStatus: 'COMPLETED', metadataJson: { kind: 'FILE_REQUIREMENT_INPUT' } },
    { conversationId: conversation.id, role: 'ASSISTANT', content: assistantContent, generationStatus: 'COMPLETED', metadataJson: { kind: 'FILE_REQUIREMENT_PLAN' } },
  ] });
  return planned;
}

async function getRequirements(userId, conversationId) {
  const conversation = await loadConversation(userId, conversationId);
  const candidates = await accessibleCandidates(userId);
  return { ...serializeDraft(conversation.requirementDraftJson || {}, conversation.requirementStatus), candidates: { courses: candidates.publicCourses, knowledgePoints: candidates.publicKnowledgePoints } };
}

function serializeConfirmation(artifact, task) {
  return {
    artifact: { id: artifact.id, artifactType: artifact.artifactType, title: artifact.title, fileFormat: artifact.fileFormat, status: artifact.status, createdAt: artifact.createdAt },
    task: { id: task.id, taskType: task.taskType, status: task.status, stage: task.stage, resultUrl: task.resultUrl },
  };
}

async function confirmRequirements(userId, conversationId, operationId) {
  const conversation = await loadConversation(userId, conversationId);
  const existing = await prisma.generatedArtifact.findUnique({ where: { ownerUserId_conversationId_operationId: { ownerUserId: userId, conversationId: conversation.id, operationId } }, include: { task: true } });
  if (existing) return serializeConfirmation(existing, existing.task);
  const draft = conversation.requirementDraftJson || {};
  assert(conversation.requirementStatus === 'READY_TO_CONFIRM' && draft.readyForConfirmation, '需求尚未确认完整', 40901, 409);
  assert(draft.outputFormat === 'DOCX', '当前仅支持 DOCX');
  const activeCount = await prisma.asyncTask.count({ where: { userId, taskType: 'FILE_GENERATION', status: { in: ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'] } } });
  assert(activeCount < Number(process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER || 2), '当前文件生成任务已达并发上限', 40902, 409);
  try {
    return await prisma.$transaction(async tx => {
      const artifact = await tx.generatedArtifact.create({ data: {
        ownerUserId: userId, agentId: conversation.agentId, conversationId: conversation.id, operationId,
        artifactType: draft.artifactType, title: draft.title || `${draft.courseName || '学习'}${draft.artifactType === 'EXAM_PAPER' ? '试卷' : '讲义'}`,
        courseId: draft.courseId || null, knowledgePointIdsJson: draft.knowledgePointIds || [], requirementsJson: draft,
        fileFormat: 'DOCX', status: 'GENERATING',
      } });
      const task = await tx.asyncTask.create({ data: {
        userId, operationId: operationKey('FILE_GENERATION', operationId), taskType: 'FILE_GENERATION', title: artifact.title,
        description: '生成结构化教育文件内容', status: 'QUEUED', stage: '正在分析需求', progressMode: 'DETERMINATE', progress: 0,
        relatedResourceType: 'GENERATED_ARTIFACT', relatedResourceId: String(artifact.id), resultType: 'ARTIFACT', resultId: String(artifact.id),
        resultUrl: `#/student/generated-artifacts/${artifact.id}`, cancellable: false, maxAttempts: 3,
        metadataJson: { conversationId: conversation.id, artifactId: artifact.id }, nextRunAt: new Date(),
      } });
      const linked = await tx.generatedArtifact.update({ where: { id: artifact.id }, data: { taskId: task.id } });
      await tx.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: { requirementStatus: 'CONFIRMED' } });
      return serializeConfirmation(linked, task);
    });
  } catch (error) {
    if (error.code === 'P2002') {
      const duplicate = await prisma.generatedArtifact.findUnique({ where: { ownerUserId_conversationId_operationId: { ownerUserId: userId, conversationId: conversation.id, operationId } }, include: { task: true } });
      if (duplicate) return serializeConfirmation(duplicate, duplicate.task);
    }
    throw error;
  }
}

module.exports = { FIELD_PRIORITY, safeKey, hasDatabaseIdInjection, missingFields, buildQuestions, accessibleCandidates, normalizePatch, patchRequirements, planRequirements, getRequirements, confirmRequirements, loadConversation };
