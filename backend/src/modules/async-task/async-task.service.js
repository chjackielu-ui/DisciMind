const crypto = require('crypto');
const prisma = require('../../config/prisma');

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'];
const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
const CANCELLABLE_STATUSES = ['RUNNING'];
const TASK_TYPES = ['KNOWLEDGE_INDEXING', 'FILE_GENERATION', 'DOCUMENT_EXPORT', 'LEARNING_FLOW_PRELOAD', 'VOICE_PRELOAD'];
const PROGRESS_MODES = ['DETERMINATE', 'INDETERMINATE', 'STAGE_ONLY'];

function taskError(message, code = 40001, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function operationKey(taskType, operationId) {
  const raw = `${taskType}:${String(operationId || '').trim()}`;
  if (raw.length <= 128) return raw;
  return `${taskType}:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

function normalizeProgress(progressMode, progress) {
  if (progressMode !== 'DETERMINATE') return null;
  const value = Number(progress);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw taskError('任务进度必须是 0 到 100 的真实数值');
  return Math.round(value);
}

const RESULT_URL_PATTERNS = [
  /^#\/student\/agents(?:\/knowledge|\/\d+(?:\/.*)?)?$/,
  /^#\/student\/generated-artifacts(?:\/\d+)?(?:\?.*)?$/,
  /^#\/student\/learning-flows(?:\?.*)?$/,
  /^#\/student\/learning\/session\/\d+$/,
];

function sanitizeResultUrl(value) {
  if (!value) return null;
  const url = String(value).trim();
  return RESULT_URL_PATTERNS.some((pattern) => pattern.test(url)) ? url : null;
}

function sanitizeErrorMessage(value) {
  if (!value) return null;
  const message = String(value);
  const looksInternal = /(?:Invalid `?prisma\.|PrismaClient|[A-Z]:[\\/]|node_modules[\\/]|\bat\s+\S+\s*\([^)]*:\d+:\d+\))/i.test(message);
  return looksInternal ? '后台任务执行失败，可以稍后重试。' : message.slice(0, 1000);
}

function serialize(task) {
  return {
    id: task.id,
    taskType: task.taskType,
    title: task.title,
    description: task.description,
    status: task.status,
    stage: task.stage,
    progress: task.progress,
    progressMode: task.progressMode,
    relatedResourceType: task.relatedResourceType,
    relatedResourceId: task.relatedResourceId,
    resultType: task.resultType,
    resultId: task.resultId,
    resultUrl: sanitizeResultUrl(task.resultUrl),
    errorCode: task.errorCode,
    errorMessage: sanitizeErrorMessage(task.errorMessage),
    cancellable: task.cancellable,
    requiresUserAction: task.requiresUserAction,
    attemptCount: task.attemptCount,
    maxAttempts: task.maxAttempts,
    dismissedAt: task.dismissedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function assertResultAccess(userId, task) {
  if (!sanitizeResultUrl(task.resultUrl)) return;
  if (!task.resultId || !task.resultType) throw taskError('任务结果缺少可验证的资源关联', 40001, 400);
  if (task.resultType === 'KNOWLEDGE_BASE') {
    const owned = await prisma.knowledgeBase.findFirst({
      where: { knowledge_base_id: Number(task.resultId), owner_user_id: Number(userId), deleted_at: null },
      select: { knowledge_base_id: true },
    });
    if (!owned) throw taskError('任务结果不存在或无权访问', 40301, 403);
    return;
  }
  if (task.resultType === 'ARTIFACT' && prisma.generatedArtifact) {
    const owned = await prisma.generatedArtifact.findFirst({
      where: { id: Number(task.resultId), ownerUserId: Number(userId), deletedAt: null },
      select: { id: true },
    });
    if (!owned) throw taskError('任务结果不存在或无权访问', 40301, 403);
    return;
  }
  throw taskError('任务结果类型不受支持', 40001, 400);
}

async function createTask(userId, input) {
  if (!TASK_TYPES.includes(input.taskType)) throw taskError('任务类型不合法');
  if (!String(input.operationId || '').trim()) throw taskError('operationId 不能为空');
  const progressMode = PROGRESS_MODES.includes(input.progressMode) ? input.progressMode : 'STAGE_ONLY';
  const key = operationKey(input.taskType, input.operationId);
  const existing = await prisma.asyncTask.findUnique({ where: { userId_operationId: { userId, operationId: key } } });
  if (existing) return serialize(existing);
  const status = input.status || 'QUEUED';
  const now = new Date();
  const safeResultUrl = sanitizeResultUrl(input.resultUrl);
  if (safeResultUrl) await assertResultAccess(userId, { resultUrl: safeResultUrl, resultType: input.resultType, resultId: input.resultId });
  const task = await prisma.asyncTask.create({ data: {
    userId,
    operationId: key,
    taskType: input.taskType,
    title: String(input.title || '后台任务').slice(0, 200),
    description: input.description || null,
    status,
    stage: input.stage || null,
    progressMode,
    progress: normalizeProgress(progressMode, input.progress),
    relatedResourceType: input.relatedResourceType || null,
    relatedResourceId: input.relatedResourceId == null ? null : String(input.relatedResourceId),
    resultType: input.resultType || null,
    resultId: input.resultId == null ? null : String(input.resultId),
    resultUrl: safeResultUrl,
    cancellable: Boolean(input.cancellable),
    requiresUserAction: Boolean(input.requiresUserAction),
    maxAttempts: Math.max(1, Math.min(10, Number(input.maxAttempts || 3))),
    metadataJson: input.metadataJson || null,
    nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : now,
    startedAt: ['RUNNING', 'WAITING_EXTERNAL'].includes(status) ? now : null,
    completedAt: TERMINAL_STATUSES.includes(status) ? now : null,
  } });
  return serialize(task);
}

async function listTasks(userId, query = {}, activeOnly = false) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const where = { userId };
  if (activeOnly) where.status = { in: ACTIVE_STATUSES };
  else if (query.status) where.status = query.status;
  if (query.taskType) where.taskType = query.taskType;
  if (!query.includeDismissed) where.dismissedAt = null;
  const [items, total] = await Promise.all([
    prisma.asyncTask.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.asyncTask.count({ where }),
  ]);
  return { list: items.map(serialize), total, page, pageSize };
}

async function getTask(userId, id) {
  const task = await prisma.asyncTask.findFirst({ where: { id: Number(id), userId } });
  if (!task) throw taskError('任务不存在或无权查看', 40301, 403);
  await assertResultAccess(userId, task);
  return serialize(task);
}

async function updateTask(id, patch) {
  const existing = await prisma.asyncTask.findUnique({ where: { id: Number(id) } });
  if (!existing) throw taskError('任务不存在', 40002, 404);
  const status = patch.status || existing.status;
  const progressMode = patch.progressMode || existing.progressMode;
  if (patch.resultUrl !== undefined && sanitizeResultUrl(patch.resultUrl)) {
    await assertResultAccess(existing.userId, {
      resultUrl: patch.resultUrl,
      resultType: patch.resultType ?? existing.resultType,
      resultId: patch.resultId ?? existing.resultId,
    });
  }
  const data = {
    ...patch,
    progressMode,
    progress: patch.progress !== undefined ? normalizeProgress(progressMode, patch.progress) : (progressMode === 'DETERMINATE' ? existing.progress : null),
  };
  if (['RUNNING', 'WAITING_EXTERNAL'].includes(status) && !existing.startedAt) data.startedAt = new Date();
  if (TERMINAL_STATUSES.includes(status)) data.completedAt = patch.completedAt || new Date();
  if (!TERMINAL_STATUSES.includes(status)) data.completedAt = null;
  if (patch.resultUrl !== undefined) data.resultUrl = sanitizeResultUrl(patch.resultUrl);
  if (patch.resultId !== undefined) data.resultId = patch.resultId == null ? null : String(patch.resultId);
  if (patch.relatedResourceId !== undefined) data.relatedResourceId = patch.relatedResourceId == null ? null : String(patch.relatedResourceId);
  if (TERMINAL_STATUSES.includes(status)) {
    data.lockedBy = null;
    data.lockedAt = null;
  }
  delete data.operationId;
  delete data.taskType;
  delete data.userId;
  return serialize(await prisma.asyncTask.update({ where: { id: existing.id }, data }));
}

async function updateRelatedTask(userId, relatedResourceType, relatedResourceId, patch) {
  const task = await prisma.asyncTask.findFirst({
    where: { userId, relatedResourceType, relatedResourceId: String(relatedResourceId) },
    orderBy: { createdAt: 'desc' },
  });
  return task ? updateTask(task.id, patch) : null;
}

async function cancelTask(userId, id) {
  const task = await prisma.asyncTask.findFirst({ where: { id: Number(id), userId } });
  if (!task) throw taskError('任务不存在或无权取消', 40301, 403);
  if (!CANCELLABLE_STATUSES.includes(task.status) || !task.cancellable) throw taskError('该任务当前不可取消', 40901, 409);
  return updateTask(task.id, { status: 'CANCELLED', stage: 'CANCELLED', errorCode: null, errorMessage: null });
}

async function dismissTask(userId, id) {
  const task = await prisma.asyncTask.findFirst({ where: { id: Number(id), userId } });
  if (!task) throw taskError('任务不存在或无权关闭', 40301, 403);
  if (!TERMINAL_STATUSES.includes(task.status)) throw taskError('运行中的任务卡只能在本地隐藏，不能从任务记录中关闭', 40901, 409);
  return serialize(await prisma.asyncTask.update({ where: { id: task.id }, data: { dismissedAt: new Date() } }));
}

module.exports = {
  ACTIVE_STATUSES, TERMINAL_STATUSES, CANCELLABLE_STATUSES, TASK_TYPES, PROGRESS_MODES,
  operationKey, sanitizeResultUrl, sanitizeErrorMessage, serialize,
  createTask, listTasks, getTask, updateTask, updateRelatedTask, cancelTask, dismissTask,
};
