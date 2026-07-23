const crypto = require('crypto');
const fs = require('fs/promises');
const prisma = require('../../config/prisma');

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'];
const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELLED'];
const CANCELLABLE_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'];
const TASK_TYPES = ['KNOWLEDGE_INDEXING', 'FILE_GENERATION', 'DOCUMENT_EXPORT', 'ARTIFACT_CLEANUP', 'LEARNING_FLOW_PRELOAD', 'VOICE_PRELOAD', 'LESSON_PLAN_GENERATION'];
const PROGRESS_MODES = ['DETERMINATE', 'INDETERMINATE', 'STAGE_ONLY'];

function taskError(message, code = 40001, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeTaskId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw taskError('任务 ID 不合法');
  return id;
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
  /^#\/student\/artifacts(?:\/\d+)?(?:\?.*)?$/,
  /^#\/teacher\/artifacts(?:\/\d+)?(?:\?.*)?$/,
  /^#\/artifacts(?:\/\d+)?(?:\?.*)?$/,
  /^#\/student\/learning-flows(?:\?.*)?$/,
  /^#\/student\/learning\/session\/\d+$/,
  /^#\/student\/courses\/\d+(?:\?.*)?$/,
  /^#\/teacher\/lesson-plan(?:\?.*)?$/,
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

function publicTaskMetadata(task) {
  if (!task?.metadataJson || typeof task.metadataJson !== 'object' || Array.isArray(task.metadataJson)) return null;
  if (task.taskType === 'LESSON_PLAN_GENERATION') {
    const safe = {};
    for (const key of ['result_json', 'docx_file_name', 'docx_size_bytes']) {
      if (task.metadataJson[key] !== undefined) safe[key] = task.metadataJson[key];
    }
    return Object.keys(safe).length ? safe : null;
  }
  if (task.taskType === 'ARTIFACT_CLEANUP') {
    const safe = {};
    for (const key of ['scanned', 'expired', 'failed']) {
      if (Number.isFinite(Number(task.metadataJson[key]))) safe[key] = Number(task.metadataJson[key]);
    }
    return Object.keys(safe).length ? safe : null;
  }
  if (task.taskType === 'LEARNING_FLOW_PRELOAD' && task.metadataJson.kind === 'LEARNING_CARD') {
    const safe = {};
    for (const key of ['kind', 'scope', 'priority', 'reason', 'sessionId', 'nodeId', 'cardCount', 'fallback']) {
      if (task.metadataJson[key] !== undefined) safe[key] = task.metadataJson[key];
    }
    return safe;
  }
  if (task.taskType === 'LEARNING_FLOW_PRELOAD' && task.metadataJson.kind === 'KNOWLEDGE_RESOURCE_PACKAGE') {
    const safe = {
      kind: 'KNOWLEDGE_RESOURCE_PACKAGE',
      packageStatus: String(task.metadataJson.packageStatus || ''),
      courseId: Number(task.metadataJson.courseId) || null,
      courseName: String(task.metadataJson.courseName || '').slice(0, 200) || null,
      knowledgePointId: Number(task.metadataJson.knowledgePointId) || null,
      knowledgePointName: String(task.metadataJson.knowledgePointName || '').slice(0, 200) || null,
      resources: {},
    };
    for (const key of ['handout', 'ppt', 'cards', 'exam', 'video']) {
      const value = task.metadataJson.resources?.[key] || {};
      safe.resources[key] = {
        status: String(value.status || 'pending'),
        artifactId: Number(value.artifactId) || null,
        taskId: Number(value.taskId) || null,
        videoTaskId: Number(value.videoTaskId) || null,
        cardCount: Number(value.cardCount) || 0,
        fallback: Boolean(value.fallback),
        errorMessage: value.errorMessage ? sanitizeErrorMessage(value.errorMessage) : null,
      };
    }
    return safe;
  }
  return null;
}

function serialize(task) {
  const data = {
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
    agentId: task.agentId || null,
    conversationId: task.conversationId || null,
    parentTaskId: task.parentTaskId || null,
    rootTaskId: task.rootTaskId || null,
    taskGroupId: task.taskGroupId || null,
    sourceAgent: task.agent ? {
      id: task.agent.id,
      name: task.agent.currentDraftVersion?.name || task.agent.currentPublicVersion?.name || '智能体',
      icon: require('../agent-marketplace/agent-icon.service').resolveAgentIcon(task.agent, task.agent.currentDraftVersion || task.agent.currentPublicVersion),
    } : null,
    artifactDownloads: task.artifactDownloads || [],
    dismissedAt: task.dismissedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    cancelledAt: task.cancelledAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
  const metadataJson = publicTaskMetadata(task);
  if (metadataJson) data.metadataJson = metadataJson;
  return data;
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
  if (task.resultType === 'LEARNING_FLOW_PRELOAD' && prisma.learningFlowPreload) {
    const owned = await prisma.learningFlowPreload.findFirst({
      where: { id: Number(task.resultId), userId: Number(userId), deletedAt: null },
      select: { id: true },
    });
    if (!owned) throw taskError('任务结果不存在或无权访问', 40301, 403);
    return;
  }
  if (task.resultType === 'LEARNING_CARDS') {
    const owned = await prisma.learningSession.findFirst({
      where: { session_id: Number(task.resultId), student_user_id: Number(userId) }, select: { session_id: true },
    });
    if (!owned) throw taskError('知识卡片结果不存在或无权访问', 40301, 403);
    return;
  }
  if (task.resultType === 'KNOWLEDGE_RESOURCE_PACKAGE') {
    const owned = await prisma.asyncTask.findFirst({
      where: {
        id: Number(task.resultId),
        userId: Number(userId),
        relatedResourceType: 'KNOWLEDGE_RESOURCE_PACKAGE',
      },
      select: { id: true },
    });
    if (!owned) throw taskError('学习资源包结果不存在或无权访问', 40301, 403);
    return;
  }
  if (task.resultType === 'LESSON_PLAN') {
    const owned = await prisma.courseTeacherRelation.findFirst({
      where: { course_id: Number(task.resultId), teacher_user_id: Number(userId) },
      select: { relation_id: true },
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
  const dedupeKey = input.dedupeKey ? String(input.dedupeKey).trim().slice(0, 128) : null;
  if (dedupeKey) {
    const duplicate = await prisma.asyncTask.findFirst({ where: { userId, taskType: input.taskType, dedupeKey, status: { in: ACTIVE_STATUSES } }, orderBy: { createdAt: 'desc' } });
    if (duplicate) return serialize(duplicate);
  }
  const existing = await prisma.asyncTask.findUnique({ where: { userId_operationId: { userId, operationId: key } } });
  if (existing) return serialize(existing);
  const status = input.status || 'QUEUED';
  const now = new Date();
  const safeResultUrl = sanitizeResultUrl(input.resultUrl);
  if (safeResultUrl) await assertResultAccess(userId, { resultUrl: safeResultUrl, resultType: input.resultType, resultId: input.resultId });
  try {
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
      requestPayloadJson: input.requestPayload || input.requestPayloadJson || null,
      agentId: input.agentId ? Number(input.agentId) : null,
      conversationId: input.conversationId ? Number(input.conversationId) : null,
      parentTaskId: input.parentTaskId ? Number(input.parentTaskId) : null,
      rootTaskId: input.rootTaskId ? Number(input.rootTaskId) : null,
      taskGroupId: input.taskGroupId ? String(input.taskGroupId).slice(0, 64) : null,
      dedupeKey,
      userVisible: input.userVisible !== false,
      nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : now,
      startedAt: ['RUNNING', 'WAITING_EXTERNAL'].includes(status) ? now : null,
      completedAt: TERMINAL_STATUSES.includes(status) ? now : null,
    } });
    return serialize(task);
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const raced = await prisma.asyncTask.findUnique({ where: { userId_operationId: { userId, operationId: key } } });
    if (!raced) throw error;
    return serialize(raced);
  }
}

async function listTasks(userId, query = {}, activeOnly = false) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const where = { userId, userVisible: true };
  if (activeOnly) where.status = { in: ACTIVE_STATUSES };
  else if (query.status) where.status = query.status;
  if (query.taskType) where.taskType = query.taskType;
  if (query.agentId) where.agentId = Number(query.agentId);
  if (query.conversationId) where.conversationId = Number(query.conversationId);
  if (query.q) where.OR = [{ title: { contains: query.q } }, { description: { contains: query.q } }, { stage: { contains: query.q } }];
  if (query.dateFrom || query.dateTo) where.createdAt = {
    ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
    ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
  };
  if (!query.includeDismissed) where.dismissedAt = null;
  const [items, total] = await Promise.all([
    prisma.asyncTask.findMany({ where, include: { agent: { include: { currentDraftVersion: true, currentPublicVersion: true } } }, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.asyncTask.count({ where }),
  ]);
  const artifactIds = [...new Set(items.filter(item => item.resultType === 'ARTIFACT').map(item => Number(item.resultId)).filter(Number.isInteger))];
  if (artifactIds.length) {
    const artifacts = await prisma.generatedArtifact.findMany({
      where: { id: { in: artifactIds }, ownerUserId: Number(userId), deletedAt: null },
      select: { id: true, exports: { where: { status: 'READY', deletedAt: null }, select: { format: true, storagePath: true } } },
    });
    const downloads = new Map();
    const { resolveStoredPath } = require('../file-generator/document-export.service');
    await Promise.all(artifacts.map(async artifact => {
      const formats = [];
      for (const record of artifact.exports) {
        try {
          const stat = await fs.stat(resolveStoredPath(record.storagePath));
          if (stat.isFile() && stat.size > 0) formats.push(record.format);
        } catch {}
      }
      downloads.set(artifact.id, formats);
    }));
    items.forEach(item => {
      const artifactId = Number(item.resultId);
      item.artifactDownloads = (downloads.get(artifactId) || []).map(format => ({ artifactId, format }));
    });
  }
  return { list: items.map(serialize), total, page, pageSize };
}

async function getTask(userId, id) {
  const taskId = normalizeTaskId(id);
  const task = await prisma.asyncTask.findFirst({ where: { id: taskId, userId, userVisible: true }, include: { agent: { include: { currentDraftVersion: true, currentPublicVersion: true } } } });
  if (!task) throw taskError('任务不存在或无权查看', 40301, 403);
  await assertResultAccess(userId, task);
  return serialize(task);
}

async function updateTask(id, patch) {
  const existing = await prisma.asyncTask.findUnique({ where: { id: Number(id) } });
  if (!existing) throw taskError('任务不存在', 40002, 404);
  if (existing.status === 'CANCELLED' && patch.status && patch.status !== 'CANCELLED') return serialize(existing);
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
  const taskId = normalizeTaskId(id);
  const task = await prisma.asyncTask.findFirst({ where: { id: taskId, userId, userVisible: true } });
  if (!task) throw taskError('任务不存在或无权取消', 40301, 403);
  if (!CANCELLABLE_STATUSES.includes(task.status) || !task.cancellable) throw taskError('该任务当前不可取消', 40901, 409);
  const updated = await updateTask(task.id, { status: 'CANCELLED', stage: 'CANCELLED', errorCode: null, errorMessage: null, cancelledAt: new Date(), lockedBy: null, lockedAt: null });
  if (task.taskType === 'KNOWLEDGE_INDEXING' && task.relatedResourceId) {
    const doc = await prisma.knowledgeDocument.updateMany({
      where: { document_id: Number(task.relatedResourceId), owner_user_id: Number(userId), deleted_at: null },
      data: { processing_state: 'cancelled', marketplace_status: 'CANCELLED' },
    });
    if (doc.count) {
      const record = await prisma.knowledgeDocument.findUnique({ where: { document_id: Number(task.relatedResourceId) }, select: { knowledge_base_id: true } });
      if (record?.knowledge_base_id) await require('../knowledge-base/knowledge-document-pipeline.service').recalculateKnowledgeBaseStatus(record.knowledge_base_id).catch(() => {});
    }
  }
  return updated;
}

async function retryTask(userId, id) {
  const taskId = normalizeTaskId(id);
  const task = await prisma.asyncTask.findFirst({ where: { id: taskId, userId, userVisible: true } });
  if (!task) throw taskError('任务不存在或无权重试', 40301, 403);
  if (!['FAILED', 'CANCELLED'].includes(task.status)) throw taskError('只有失败或已取消任务可以重试', 40901, 409);
  const updated = await prisma.asyncTask.update({ where: { id: task.id }, data: {
    status: 'QUEUED', stage: '等待重试', progress: task.progressMode === 'DETERMINATE' ? 0 : null,
    errorCode: null, errorMessage: null, attemptCount: 0, nextRunAt: new Date(),
    maxAttempts: task.taskType === 'KNOWLEDGE_INDEXING'
      ? Math.max(task.maxAttempts, Math.max(1, Math.min(9, Number(process.env.KNOWLEDGE_INDEXING_AUTO_RETRIES || 3))) + 1)
      : task.maxAttempts,
    startedAt: null, completedAt: null, cancelledAt: null, dismissedAt: null, lockedBy: null, lockedAt: null,
    metadataJson: { ...(task.metadataJson || {}), manuallyRetriedAt: new Date().toISOString() },
  } });
  if (task.taskType === 'FILE_GENERATION' && task.relatedResourceId) {
    await prisma.generatedArtifact.updateMany({
      where: { id: Number(task.relatedResourceId), ownerUserId: userId, deletedAt: null },
      data: { status: 'GENERATING', errorCode: null },
    });
  }
  if (task.taskType === 'KNOWLEDGE_INDEXING' && task.relatedResourceId) {
    const document = await prisma.knowledgeDocument.findFirst({
      where: { document_id: Number(task.relatedResourceId), owner_user_id: Number(userId), deleted_at: null },
      select: { document_id: true, knowledge_base_id: true, cleaned_text: true, chunks: { take: 1, select: { chunk_id: true } } },
    });
    if (document) {
      const resumeState = document.chunks.length ? 'chunked' : document.cleaned_text ? 'parsed' : 'uploaded';
      await prisma.$transaction([
        prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { processing_state: resumeState, marketplace_status: 'PROCESSING' } }),
        prisma.knowledgeBase.update({ where: { knowledge_base_id: document.knowledge_base_id }, data: { marketplace_status: 'PROCESSING' } }),
      ]);
    }
  }
  return serialize(updated);
}

async function dismissTask(userId, id) {
  const taskId = normalizeTaskId(id);
  const task = await prisma.asyncTask.findFirst({ where: { id: taskId, userId, userVisible: true } });
  if (!task) throw taskError('任务不存在或无权关闭', 40301, 403);
  if (!TERMINAL_STATUSES.includes(task.status)) throw taskError('运行中的任务卡只能在本地隐藏，不能从任务记录中关闭', 40901, 409);
  return serialize(await prisma.asyncTask.update({ where: { id: task.id }, data: { dismissedAt: new Date() } }));
}

async function dismissTerminalTasks(userId, statuses = TERMINAL_STATUSES) {
  const selected = [...new Set(statuses)].filter(status => TERMINAL_STATUSES.includes(status));
  if (!selected.length) throw taskError('至少选择一种终态任务');
  const result = await prisma.asyncTask.updateMany({
    where: { userId: Number(userId), userVisible: true, status: { in: selected }, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
  return { dismissedCount: result.count };
}

async function bulkCancel(userId, ids = []) {
  const selected = [...new Set(ids.map(Number).filter(Number.isInteger))].slice(0, 100);
  const results = [];
  for (const id of selected) {
    try { results.push({ id, ok: true, task: await cancelTask(userId, id) }); }
    catch (error) { results.push({ id, ok: false, message: error.message }); }
  }
  return { affected: results.filter(item => item.ok).length, results };
}

async function bulkDismiss(userId, ids = []) {
  const selected = [...new Set(ids.map(Number).filter(Number.isInteger))].slice(0, 100);
  return prisma.$transaction(async tx => {
    const owned = await tx.asyncTask.findMany({ where: { id: { in: selected }, userId: Number(userId), userVisible: true }, select: { id: true, status: true } });
    const byId = new Map(owned.map(task => [task.id, task]));
    const allowed = owned.filter(task => TERMINAL_STATUSES.includes(task.status)).map(task => task.id);
    if (allowed.length) await tx.asyncTask.updateMany({ where: { id: { in: allowed } }, data: { dismissedAt: new Date() } });
    const results = selected.map(id => {
      const task = byId.get(id);
      if (!task) return { id, ok: false, message: '任务不存在或无权操作' };
      if (!TERMINAL_STATUSES.includes(task.status)) return { id, ok: false, message: '运行中的任务不能隐藏' };
      return { id, ok: true };
    });
    return { affected: allowed.length, results };
  });
}

async function bulkDelete(userId, ids = []) {
  const selected = [...new Set(ids.map(Number).filter(Number.isInteger))].slice(0, 100);
  return prisma.$transaction(async tx => {
    const owned = await tx.asyncTask.findMany({
      where: { id: { in: selected }, userId: Number(userId), userVisible: true },
      select: { id: true, status: true, generatedArtifact: { select: { id: true } } },
    });
    const byId = new Map(owned.map(task => [task.id, task]));
    const allowed = owned.filter(task => TERMINAL_STATUSES.includes(task.status)).map(task => task.id);
    if (allowed.length) await tx.asyncTask.deleteMany({ where: { id: { in: allowed } } });
    const results = selected.map(id => {
      const task = byId.get(id);
      if (!task) return { id, ok: false, message: '任务不存在或无权操作' };
      if (!TERMINAL_STATUSES.includes(task.status)) return { id, ok: false, message: '运行中的任务必须先取消，不能直接删除' };
      return { id, ok: true, artifactPreserved: Boolean(task.generatedArtifact?.id), artifactId: task.generatedArtifact?.id || null };
    });
    return { affected: allowed.length, results, artifactsPreserved: results.filter(item => item.ok && item.artifactPreserved).length };
  });
}

module.exports = {
  ACTIVE_STATUSES, TERMINAL_STATUSES, CANCELLABLE_STATUSES, TASK_TYPES, PROGRESS_MODES,
  operationKey, sanitizeResultUrl, sanitizeErrorMessage, publicTaskMetadata, serialize, normalizeTaskId,
  createTask, listTasks, getTask, updateTask, updateRelatedTask, cancelTask, retryTask, dismissTask, dismissTerminalTasks, bulkCancel, bulkDismiss, bulkDelete,
};
