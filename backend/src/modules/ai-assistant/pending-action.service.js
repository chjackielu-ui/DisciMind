const crypto = require('crypto');
const prisma = require('../../config/prisma');
const asyncTasks = require('../async-task/async-task.service');
const agentChatService = require('../agent-chat/agent-chat.service');
const fileRequirements = require('../file-generator/file-requirement.service');

function actionError(message, code = 40001, status = 400) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function stableKey(...parts) {
  return crypto.createHash('sha256').update(parts.map(value => String(value ?? '')).join(':')).digest('hex').slice(0, 32);
}

function examPatch(query, context, fileIntent) {
  const text = String(query || '');
  const count = Number(text.match(/(\d{1,2})\s*道/u)?.[1]);
  const total = Number(text.match(/(\d{2,3})\s*分/u)?.[1]);
  const duration = Number(text.match(/(\d{2,3})\s*分钟/u)?.[1]);
  const courseName = context.selectedCourse?.name || '课程';
  const examType = /期末/iu.test(text) ? 'FINAL' : /期中/iu.test(text) ? 'MIDTERM' : /模拟/iu.test(text) ? 'MOCK' : /测验|小测/iu.test(text) ? 'QUIZ' : 'CUSTOM';
  const questionCount = Number.isInteger(count) && count > 0 && count <= 50 ? count : 20;
  const totalScore = Number.isInteger(total) && total > 0 ? total : 100;
  const firstCount = Math.max(1, Math.floor(questionCount / 2));
  const secondCount = questionCount - firstCount;
  const firstScore = 3;
  const secondScore = secondCount ? (totalScore - firstCount * firstScore) / secondCount : totalScore / firstCount;
  const questionTypes = secondCount && secondScore > 0
    ? [{ type: 'SINGLE_CHOICE', count: firstCount, score: firstScore }, { type: 'SHORT_ANSWER', count: secondCount, score: secondScore }]
    : [{ type: 'SHORT_ANSWER', count: questionCount, score: totalScore / questionCount }];
  return {
    title: `${courseName}${examType === 'FINAL' ? '期末试卷' : examType === 'MIDTERM' ? '期中试卷' : '练习试卷'}`,
    examType, questionCount, totalScore,
    duration: Number.isInteger(duration) && duration > 0 ? duration : 90,
    questionTypes, includeAnswers: true, includeAnalysis: true, includeAnswerSheet: true,
    outputFormats: fileIntent.outputFormats?.length ? fileIntent.outputFormats : ['DOCX', 'PDF'],
  };
}

function handoutPatch(query, context, fileIntent) {
  const courseName = context.selectedCourse?.name || '课程';
  const pointName = context.selectedKnowledgePoint?.name;
  return {
    title: `${pointName || courseName}学习讲义`, targetAudience: '本科生', handoutLength: 'MEDIUM',
    learningObjectives: [`理解并能应用${pointName || courseName}的核心知识`],
    includeExamples: true, includeExercises: true, includeAnswers: false,
    outputFormats: fileIntent.outputFormats?.length ? fileIntent.outputFormats : ['DOCX', 'PDF'],
    specialRequirements: String(query || '').slice(0, 1000),
  };
}

async function ownedAiConversation(userId, aiConversationId) {
  const conversation = await prisma.aiConversation.findFirst({ where: { id: Number(aiConversationId), userId: Number(userId) } });
  if (!conversation) throw actionError('AI 对话不存在或无权操作', 40301, 403);
  return conversation;
}

async function systemFileAgent(artifactType) {
  const systemKey = artifactType === 'EXAM_PAPER' ? 'system_exam_paper_generator' : 'system_study_handout_generator';
  const agent = await prisma.userAgent.findFirst({
    where: { systemKey, isSystem: true, agentType: 'FILE_GENERATOR', status: 'PUBLIC', deletedAt: null },
    include: { currentPublicVersion: true },
  });
  if (!agent?.currentPublicVersion) throw actionError('系统文件生成助手尚未就绪', 50301, 503);
  return agent;
}

function summaryFromDraft(draft) {
  return {
    title: draft.title || '教育文件', artifactType: draft.artifactType,
    courseName: draft.courseName || null, knowledgePointNames: draft.knowledgePointNames || [],
    difficulty: draft.difficulty || null, questionCount: draft.questionCount || null,
    totalScore: draft.totalScore || null, duration: draft.duration || null,
    outputFormats: draft.outputFormats || [], includeAnswers: draft.includeAnswers,
    includeAnalysis: draft.includeAnalysis, readyForConfirmation: Boolean(draft.readyForConfirmation),
    questions: draft.questions || [],
  };
}

function serializePending(task, draft, extra = {}) {
  return {
    id: task.id, kind: 'FILE_GENERATION', status: task.status, stage: task.stage,
    requiresUserAction: task.requiresUserAction, taskId: task.id,
    sourceRunId: task.metadataJson?.sourceRunId || null,
    aiConversationId: Number(task.metadataJson?.aiConversationId) || null,
    fileConversationId: Number(task.metadataJson?.fileConversationId) || null,
    agentId: task.agentId || Number(task.metadataJson?.agentId) || null,
    summary: summaryFromDraft(draft || task.requestPayloadJson || {}),
    actions: task.status === 'WAITING_EXTERNAL' ? ['generate', 'preview', 'modify', 'cancel'] : [],
    createdAt: task.createdAt, updatedAt: task.updatedAt,
    ...extra,
  };
}

async function persistConversationState(userId, aiConversationId, pending) {
  const conversation = await ownedAiConversation(userId, aiConversationId);
  const state = { ...(conversation.agentRuntimeStateJson || {}), pendingAction: pending };
  await prisma.aiConversation.update({ where: { id: conversation.id }, data: { agentRuntimeStateJson: state } });
}

async function ensureForFileConversation(input) {
  const userId = Number(input.userId);
  const aiConversation = await ownedAiConversation(userId, input.aiConversationId);
  const fileConversation = await prisma.marketplaceAgentConversation.findFirst({
    where: { id: Number(input.fileConversationId), userId, deletedAt: null }, include: { agent: true },
  });
  if (!fileConversation || fileConversation.agent.agentType !== 'FILE_GENERATOR') throw actionError('文件需求会话不存在或无权操作', 40301, 403);
  const draft = await fileRequirements.getRequirements(userId, fileConversation.id);
  if (!draft.readyForConfirmation) return { needsInput: true, draft, questions: draft.questions || [] };
  const actionKey = stableKey(aiConversation.id, input.sourceMessageId || input.sourceRunId || input.query, fileConversation.id);
  const task = await asyncTasks.createTask(userId, {
    operationId: `pending-file-${actionKey}`, taskType: 'FILE_GENERATION',
    title: draft.title || '等待确认的文件生成', description: '确认文件范围、题量和输出格式后开始生成',
    status: 'WAITING_EXTERNAL', stage: '等待确认', progressMode: 'STAGE_ONLY',
    relatedResourceType: 'FILE_REQUIREMENT', relatedResourceId: String(fileConversation.id),
    cancellable: true, requiresUserAction: true, maxAttempts: 3,
    agentId: fileConversation.agentId, conversationId: fileConversation.id,
    dedupeKey: `file-confirm:${actionKey}`,
    metadataJson: {
      kind: 'FILE_CONFIRMATION', aiConversationId: aiConversation.id, fileConversationId: fileConversation.id,
      sourceRunId: input.sourceRunId || null, sourceMessageId: input.sourceMessageId || null,
      agentId: fileConversation.agentId, operationId: `confirmed-file-${actionKey}`,
    },
    requestPayloadJson: summaryFromDraft(draft),
  });
  const pending = serializePending({ ...task, metadataJson: {
    kind: 'FILE_CONFIRMATION', aiConversationId: aiConversation.id, fileConversationId: fileConversation.id,
    sourceRunId: input.sourceRunId || null, sourceMessageId: input.sourceMessageId || null,
    agentId: fileConversation.agentId, operationId: `confirmed-file-${actionKey}`,
  }, requestPayloadJson: summaryFromDraft(draft) }, draft);
  await persistConversationState(userId, aiConversation.id, { id: task.id, kind: 'FILE_GENERATION', status: 'WAITING_EXTERNAL' });
  return { needsInput: false, pendingAction: pending, draft };
}

async function createFileConfirmation(input) {
  const userId = Number(input.user?.user_id || input.userId);
  if (!Number.isInteger(userId)) throw actionError('认证用户上下文缺失', 40101, 401);
  const aiConversation = await ownedAiConversation(userId, input.aiConversationId);
  const context = input.userContext;
  if (!context?.selectedCourse?.id) return { needsInput: true, questions: [{ field: 'course', question: '请选择要生成文件的课程。' }] };
  const artifactType = input.fileIntent?.artifactType === 'STUDY_HANDOUT' ? 'STUDY_HANDOUT' : 'EXAM_PAPER';
  const agent = await systemFileAgent(artifactType);
  const conversation = await agentChatService.createConversation(userId, agent.id, {
    operationId: `ai-pending-${aiConversation.id}-${agent.id}`,
    title: `${agent.currentPublicVersion.name}：${String(input.query || '').slice(0, 40)}`,
    memoryEnabled: false,
  });
  let draft = await fileRequirements.prefillFromOrchestration(userId, conversation.id, {
    artifactType, aiConversationId: aiConversation.id, courseId: context.selectedCourse.id,
    knowledgePointId: context.selectedKnowledgePoint?.id || null,
    knowledgeBaseRefs: input.knowledgeBaseRefs || [], attachments: input.attachments || [],
    outputFormats: input.fileIntent?.outputFormats || ['DOCX', 'PDF'],
  });
  const patch = artifactType === 'EXAM_PAPER'
    ? examPatch(input.query, context, input.fileIntent || {})
    : handoutPatch(input.query, context, input.fileIntent || {});
  draft = await fileRequirements.patchRequirements(userId, conversation.id, patch);
  return ensureForFileConversation({
    userId, aiConversationId: aiConversation.id, fileConversationId: conversation.id,
    sourceRunId: input.sourceRunId, sourceMessageId: input.sourceMessageId, query: input.query,
  });
}

async function loadPending(userId, pendingId) {
  const task = await prisma.asyncTask.findFirst({ where: { id: Number(pendingId), userId: Number(userId), taskType: 'FILE_GENERATION', userVisible: true } });
  if (!task || task.metadataJson?.kind !== 'FILE_CONFIRMATION') throw actionError('确认请求不存在或无权操作', 40301, 403);
  const draft = task.metadataJson?.fileConversationId
    ? await fileRequirements.getRequirements(Number(userId), Number(task.metadataJson.fileConversationId))
    : task.requestPayloadJson || {};
  const artifact = await prisma.generatedArtifact.findFirst({
    where: { taskId: task.id, ownerUserId: Number(userId), deletedAt: null },
    include: { exports: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
  });
  const artifactSummary = artifact ? {
    id: artifact.id, title: artifact.title, status: artifact.status,
    previewUrl: `#/student/artifacts/${artifact.id}`,
    formats: (artifact.exports || []).map(item => ({
      format: item.format, status: item.status,
      downloadAvailable: item.status === 'READY' && Boolean(item.storagePath),
    })),
  } : null;
  return { task, draft, artifact, pendingAction: serializePending(task, draft, artifactSummary ? { artifact: artifactSummary } : {}) };
}

async function getConversationPending(userId, aiConversationId) {
  const conversation = await ownedAiConversation(userId, aiConversationId);
  const id = Number(conversation.agentRuntimeStateJson?.pendingAction?.id);
  if (!Number.isInteger(id)) return null;
  return (await loadPending(userId, id)).pendingAction;
}

async function updateConversationPendingState(userId, task, status, result = null) {
  const aiConversationId = Number(task.metadataJson?.aiConversationId);
  if (!Number.isInteger(aiConversationId)) return;
  const conversation = await ownedAiConversation(userId, aiConversationId);
  const state = { ...(conversation.agentRuntimeStateJson || {}), pendingAction: { id: task.id, kind: 'FILE_GENERATION', status, ...(result ? { result } : {}) } };
  await prisma.aiConversation.update({ where: { id: conversation.id }, data: { agentRuntimeStateJson: state } });
}

async function act(userId, pendingId, input = {}) {
  const { task, draft, pendingAction } = await loadPending(userId, pendingId);
  const action = String(input.action || '').toLowerCase();
  if (action === 'preview') return { pendingAction, preview: summaryFromDraft(draft) };
  if (action === 'modify') {
    if (task.status !== 'WAITING_EXTERNAL') throw actionError('该确认请求已经处理，不能再修改', 40901, 409);
    const updatedDraft = await fileRequirements.patchRequirements(Number(userId), Number(task.metadataJson.fileConversationId), input.patch || {});
    await prisma.asyncTask.update({ where: { id: task.id }, data: { title: updatedDraft.title || task.title, requestPayloadJson: summaryFromDraft(updatedDraft), updatedAt: new Date() } });
    const refreshed = await loadPending(userId, task.id);
    return { pendingAction: refreshed.pendingAction, draft: updatedDraft };
  }
  if (action === 'cancel') {
    if (task.status === 'CANCELLED') return { pendingAction };
    if (task.status !== 'WAITING_EXTERNAL') throw actionError('文件任务已经开始，不能再取消确认', 40901, 409);
    const cancelled = await asyncTasks.updateTask(task.id, { status: 'CANCELLED', stage: '已取消', requiresUserAction: false, cancellable: false, cancelledAt: new Date() });
    await updateConversationPendingState(userId, task, 'CANCELLED');
    return { pendingAction: serializePending({ ...task, ...cancelled, metadataJson: task.metadataJson }, draft) };
  }
  if (action === 'generate') {
    if (task.status !== 'WAITING_EXTERNAL') {
      const existing = await prisma.generatedArtifact.findFirst({ where: { taskId: task.id, ownerUserId: Number(userId), deletedAt: null } });
      if (existing) return { pendingAction: serializePending(task, draft), artifact: { id: existing.id, title: existing.title, status: existing.status }, duplicate: true };
      throw actionError('该确认请求已经处理', 40901, 409);
    }
    const confirmation = await fileRequirements.confirmRequirements(
      Number(userId), Number(task.metadataJson.fileConversationId), String(task.metadataJson.operationId), { pendingTaskId: task.id },
    );
    const refreshed = await prisma.asyncTask.findUnique({ where: { id: task.id } });
    await updateConversationPendingState(userId, task, 'QUEUED', { artifactId: confirmation.artifact.id, taskId: confirmation.task.id });
    return { pendingAction: (await loadPending(userId, refreshed.id)).pendingAction, ...confirmation };
  }
  throw actionError('不支持的确认操作');
}

module.exports = {
  stableKey, examPatch, handoutPatch, summaryFromDraft, serializePending,
  createFileConfirmation, ensureForFileConversation, getConversationPending, loadPending, act,
};
