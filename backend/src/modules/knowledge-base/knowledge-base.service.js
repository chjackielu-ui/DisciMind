const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../../config/prisma');
const dify = require('../learning-agent/adapters/dify-knowledge.adapter');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { scopedOperationId } = require('../agent-marketplace/operation-id');
const asyncTasks = require('../async-task/async-task.service');

const STORAGE_ROOT = path.resolve(__dirname, '../../../storage/agent-knowledge');
const MAX_KNOWLEDGE_BASES = Number(process.env.USER_MAX_KNOWLEDGE_BASES || 10);
const MAX_FILES = Number(process.env.KNOWLEDGE_BASE_MAX_FILES || 20);
const MAX_FILE_BYTES = Number(process.env.KNOWLEDGE_FILE_MAX_MB || 30) * 1024 * 1024;
const EXTENSIONS = new Set(['.pdf', '.docx', '.md', '.txt']);
const MIME_BY_EXT = {
  '.pdf': new Set(['application/pdf']),
  '.docx': new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  '.md': new Set(['text/markdown', 'text/x-markdown', 'text/plain']),
  '.txt': new Set(['text/plain']),
};

function safeOwner(owner) {
  return owner ? { id: owner.user_id, username: owner.username, name: owner.profile?.real_name || owner.username } : null;
}

function serializeDocument(doc) {
  return {
    id: doc.document_id,
    originalName: doc.original_filename,
    mimeType: doc.mime_type,
    sizeBytes: doc.file_size_bytes,
    status: doc.marketplace_status,
    errorMessage: doc.error_message,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

function serializeKnowledgeBase(kb, userId, detail = false) {
  const data = {
    id: kb.knowledge_base_id,
    name: kb.name,
    description: kb.description || '',
    visibility: kb.marketplace_visibility,
    status: kb.marketplace_status,
    category: kb.category?.name || null,
    documentCount: kb.document_count,
    totalSizeBytes: Number(kb.total_size_bytes || 0),
    boundAgentCount: kb._count?.agent_bindings || 0,
    owner: safeOwner(kb.owner),
    isOwner: Number(kb.owner_user_id) === Number(userId),
    createdAt: kb.created_at,
    updatedAt: kb.updated_at,
  };
  if (detail) data.documents = (kb.documents || []).map(serializeDocument);
  return data;
}

function validateUpload(file) {
  assert(file, '请选择要上传的文件');
  assert(file.size > 0 && file.size <= MAX_FILE_BYTES, `单个文件不能超过 ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const original = String(file.originalname || '').normalize('NFKC');
  assert(original === path.basename(original) && !/[\x00-\x1f<>:"|?*]/.test(original), '文件名不安全');
  const ext = path.extname(original).toLowerCase();
  assert(EXTENSIONS.has(ext), '仅支持 PDF、DOCX、MD、TXT 文件');
  assert(MIME_BY_EXT[ext].has(String(file.mimetype || '').toLowerCase()), '文件 MIME 类型与扩展名不匹配');
  const buffer = file.buffer;
  let headerValid = false;
  if (ext === '.pdf') headerValid = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  else if (ext === '.docx') headerValid = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  else headerValid = !buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
  assert(headerValid, '文件实际内容与扩展名不匹配');
  return { original, ext, checksum: crypto.createHash('sha256').update(buffer).digest('hex') };
}

async function createKnowledgeBase(userId, input) {
  const operationId = scopedOperationId(userId, input.operationId, 'create-knowledge-base');
  const existing = await prisma.knowledgeBase.findUnique({ where: { operation_id: operationId }, include: { owner: { include: { profile: true } }, category: true, _count: { select: { agent_bindings: true } } } });
  if (existing) return serializeKnowledgeBase(existing, userId);
  const count = await prisma.knowledgeBase.count({ where: { owner_user_id: userId, deleted_at: null } });
  assert(count < MAX_KNOWLEDGE_BASES, `每个用户最多创建 ${MAX_KNOWLEDGE_BASES} 个知识库`);
  let dataset;
  try {
    dataset = await dify.createDataset({ name: `${input.name}-${userId}-${Date.now()}`, description: input.description });
    assert(dataset.id, 'Dify 未返回 Dataset ID', 50003, 502);
    const category = input.category ? await prisma.agentCategory.findUnique({ where: { name: input.category } }) : null;
    const kb = await prisma.knowledgeBase.create({ data: {
      name: input.name, description: input.description, scope_type: 'PERSONAL', owner_user_id: userId,
      status: 'active', dify_dataset_id: dataset.id, marketplace_visibility: 'PRIVATE', marketplace_status: 'EMPTY',
      category_id: category?.id || null, operation_id: operationId,
    }, include: { owner: { include: { profile: true } }, category: true, _count: { select: { agent_bindings: true } } } });
    return serializeKnowledgeBase(kb, userId);
  } catch (error) {
    if (dataset?.id) await dify.deleteDataset(dataset.id).catch(() => null);
    if (error.code) throw error;
    const wrapped = new Error('暂时无法创建知识库，请稍后重试。');
    wrapped.code = 50003;
    wrapped.status = 502;
    throw wrapped;
  }
}

const listInclude = { owner: { include: { profile: true } }, category: true, _count: { select: { agent_bindings: true } } };

async function listKnowledgeBases(userId, query = {}) {
  const isPublic = query.scope === 'public';
  const where = isPublic
    ? { marketplace_visibility: 'PUBLIC', marketplace_status: 'PUBLIC', deleted_at: null }
    : { owner_user_id: userId, deleted_at: null };
  const records = await prisma.knowledgeBase.findMany({ where, include: listInclude, orderBy: { updated_at: 'desc' } });
  return { list: records.map((kb) => serializeKnowledgeBase(kb, userId)) };
}

async function getKnowledgeBase(userId, id) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(id), deleted_at: null }, include: { ...listInclude, documents: { where: { deleted_at: null }, orderBy: { created_at: 'desc' } } } });
  assert(kb, '知识库不存在', 40002, 404);
  assert(kb.owner_user_id === userId || (kb.marketplace_visibility === 'PUBLIC' && kb.marketplace_status === 'PUBLIC'), '无权查看该知识库', 40301, 403);
  return serializeKnowledgeBase(kb, userId, true);
}

async function updateKnowledgeBase(userId, id, input) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(id), owner_user_id: userId, deleted_at: null } });
  assert(kb, '知识库不存在或无权编辑', 40301, 403);
  const updated = await prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { name: input.name, description: input.description }, include: { ...listInclude, documents: { where: { deleted_at: null } } } });
  return serializeKnowledgeBase(updated, userId, true);
}

async function uploadDocument(userId, kbId, file, rawOperationId) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null } });
  assert(kb, '知识库不存在或无权上传', 40301, 403);
  assert(!['DELETING', 'DELETED', 'OFFLINE'].includes(kb.marketplace_status), '知识库当前不可上传文件');
  assert(String(rawOperationId || '').length >= 8, 'operationId 不合法');
  const currentCount = await prisma.knowledgeDocument.count({ where: { knowledge_base_id: kb.knowledge_base_id, deleted_at: null } });
  assert(currentCount < MAX_FILES, `单个知识库最多上传 ${MAX_FILES} 个文件`);
  const checked = validateUpload(file);
  const operationId = scopedOperationId(userId, rawOperationId, `upload-kb-${kb.knowledge_base_id}`);
  const existing = await prisma.knowledgeDocument.findUnique({ where: { operation_id: operationId } });
  if (existing && existing.marketplace_status !== 'FAILED') return serializeDocument(existing);
  if (existing) {
    const failedPath = path.resolve(__dirname, '../../..', existing.file_url);
    if (failedPath.startsWith(`${STORAGE_ROOT}${path.sep}`)) await fs.unlink(failedPath).catch(() => null);
    await prisma.knowledgeDocument.delete({ where: { document_id: existing.document_id } });
  }
  const duplicate = await prisma.knowledgeDocument.findFirst({ where: { knowledge_base_id: kb.knowledge_base_id, file_checksum: checked.checksum, deleted_at: null } });
  assert(!duplicate, '该文件已经上传过，请勿重复提交');

  const dir = path.resolve(STORAGE_ROOT, String(userId), String(kb.knowledge_base_id));
  assert(dir.startsWith(`${STORAGE_ROOT}${path.sep}`), '上传路径不安全');
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${crypto.randomUUID()}${checked.ext}`;
  const absolutePath = path.resolve(dir, storedName);
  assert(absolutePath.startsWith(`${dir}${path.sep}`), '上传路径不安全');
  await fs.writeFile(absolutePath, file.buffer, { flag: 'wx' });
  const relativeStoragePath = path.relative(path.resolve(__dirname, '../../..'), absolutePath).replace(/\\/g, '/');

  let document = await prisma.knowledgeDocument.create({ data: {
    knowledge_base_id: kb.knowledge_base_id, title: checked.original, original_filename: checked.original,
    file_ext: checked.ext, file_size_bytes: file.size, mime_type: file.mimetype, storage_type: 'LOCAL',
    file_url: relativeStoragePath, scope_type: 'PERSONAL', visibility: 'PRIVATE', owner_user_id: userId,
    parse_status: 'UPLOADED', review_status: 'APPROVED', dify_dataset_id: kb.dify_dataset_id,
    file_checksum: checked.checksum, marketplace_status: 'UPLOADING', operation_id: operationId,
  } });
  let indexingTask = null;
  try {
    indexingTask = await asyncTasks.createTask(userId, {
      operationId: `knowledge-indexing-${operationId}`,
      taskType: 'KNOWLEDGE_INDEXING',
      title: `正在处理 ${checked.original}`,
      description: `知识库“${kb.name}”正在上传并建立向量索引。`,
      status: 'RUNNING',
      stage: 'UPLOADING',
      progressMode: 'STAGE_ONLY',
      relatedResourceType: 'KNOWLEDGE_DOCUMENT',
      relatedResourceId: document.document_id,
      resultType: 'KNOWLEDGE_BASE',
      resultId: kb.knowledge_base_id,
      resultUrl: '#/student/agents/knowledge',
      cancellable: false,
    });
  } catch (taskError) {
    console.error('[AgentKnowledge] task center create failed', { documentId: document.document_id, message: taskError.message });
  }
  try {
    const remote = await dify.uploadDocumentFile(kb.dify_dataset_id, { filePath: absolutePath, fileName: checked.original, mimeType: file.mimetype });
    document = await prisma.$transaction(async (tx) => {
      const updated = await tx.knowledgeDocument.update({ where: { document_id: document.document_id }, data: {
        dify_document_id: remote.documentId, dify_batch_id: remote.batchId, parse_status: 'EMBEDDING', marketplace_status: 'INDEXING',
      } });
      await tx.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: {
        document_count: { increment: 1 }, total_size_bytes: { increment: BigInt(file.size) }, marketplace_status: 'INDEXING',
      } });
      return updated;
    });
    if (indexingTask) await asyncTasks.updateTask(indexingTask.id, {
      status: 'WAITING_EXTERNAL', stage: 'INDEXING', progressMode: 'STAGE_ONLY',
    }).catch((taskError) => console.error('[AgentKnowledge] task center update failed', { documentId: document.document_id, message: taskError.message }));
    return serializeDocument(document);
  } catch (error) {
    console.error('[AgentKnowledge] Dify upload/index start failed', { knowledgeBaseId: kb.knowledge_base_id, code: error.code || null, message: error.message });
    await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { marketplace_status: 'FAILED', parse_status: 'FAILED', error_message: '文档解析或索引失败，可以重新处理。' } });
    if (indexingTask) await asyncTasks.updateTask(indexingTask.id, {
      status: 'FAILED', stage: 'FAILED', errorCode: error.code || 'KNOWLEDGE_INDEXING_FAILED',
      errorMessage: '知识库处理失败，可以重新上传或重新建立索引。',
    }).catch(() => null);
    const wrapped = new Error('文档解析或索引失败，可以重新处理。');
    wrapped.code = 50003;
    wrapped.status = 502;
    throw wrapped;
  }
}

function mapIndexStatus(status) {
  const value = String(status || '').toLowerCase();
  if (['completed', 'available', 'ready'].includes(value)) return 'READY';
  if (['error', 'failed', 'paused'].includes(value)) return 'FAILED';
  if (['parsing', 'cleaning', 'splitting'].includes(value)) return 'PARSING';
  return 'INDEXING';
}

async function refreshStatus(userId, kbId, options = {}) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null }, include: { documents: { where: { deleted_at: null } } } });
  assert(kb, '知识库不存在或无权查看', 40301, 403);
  const syncErrors = [];
  for (const doc of kb.documents.filter((item) => item.dify_batch_id && !['READY', 'FAILED'].includes(item.marketplace_status))) {
    try {
      const states = await dify.getDocumentIndexingStatus(kb.dify_dataset_id, doc.dify_batch_id);
      const remote = states.find((item) => item.id === doc.dify_document_id) || states[0];
      const status = mapIndexStatus(remote?.indexing_status || remote?.status);
      await prisma.knowledgeDocument.update({ where: { document_id: doc.document_id }, data: { marketplace_status: status, parse_status: status === 'READY' ? 'EMBEDDED' : status === 'FAILED' ? 'FAILED' : status === 'PARSING' ? 'PARSING' : 'EMBEDDING', error_message: status === 'FAILED' ? (remote?.error || '文档解析或索引失败，可以重新处理。') : null } });
      const taskPatch = status === 'READY'
        ? { status: 'SUCCEEDED', stage: 'READY', progressMode: 'STAGE_ONLY', errorCode: null, errorMessage: null }
        : status === 'FAILED'
          ? { status: 'FAILED', stage: 'FAILED', progressMode: 'STAGE_ONLY', errorCode: 'KNOWLEDGE_INDEXING_FAILED', errorMessage: '知识库处理失败，可以重新上传或重新建立索引。' }
          : { status: 'WAITING_EXTERNAL', stage: status, progressMode: 'STAGE_ONLY' };
      await asyncTasks.updateRelatedTask(userId, 'KNOWLEDGE_DOCUMENT', doc.document_id, taskPatch)
        .catch((taskError) => console.error('[AgentKnowledge] task center sync failed', { documentId: doc.document_id, message: taskError.message }));
    } catch (error) {
      console.error('[AgentKnowledge] indexing status refresh failed', { knowledgeBaseId: kb.knowledge_base_id, documentId: doc.document_id, error: error.message });
      syncErrors.push(error);
    }
  }
  if (options.throwOnSyncError && syncErrors.length) throw syncErrors[0];
  const docs = await prisma.knowledgeDocument.findMany({ where: { knowledge_base_id: kb.knowledge_base_id, deleted_at: null } });
  let status = docs.length && docs.every((doc) => doc.marketplace_status === 'READY') ? 'READY' : docs.some((doc) => doc.marketplace_status === 'FAILED') ? 'FAILED' : docs.length ? 'INDEXING' : 'EMPTY';
  if (kb.marketplace_visibility !== 'PRIVATE') status = kb.marketplace_status;
  await prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { marketplace_status: status } });
  return getKnowledgeBase(userId, kb.knowledge_base_id);
}

async function deleteDocument(userId, kbId, documentId) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null } });
  assert(kb, '知识库不存在或无权删除文档', 40301, 403);
  const doc = await prisma.knowledgeDocument.findFirst({ where: { document_id: Number(documentId), knowledge_base_id: kb.knowledge_base_id, deleted_at: null } });
  assert(doc, '文档不存在', 40002, 404);
  if (doc.dify_document_id) await dify.deleteDatasetDocument(kb.dify_dataset_id, doc.dify_document_id);
  const absolute = path.resolve(__dirname, '../../..', doc.file_url);
  if (absolute.startsWith(`${STORAGE_ROOT}${path.sep}`)) await fs.unlink(absolute).catch(() => null);
  const counted = Boolean(doc.dify_document_id);
  await prisma.$transaction([
    prisma.knowledgeDocument.update({ where: { document_id: doc.document_id }, data: { deleted_at: new Date(), marketplace_status: 'DELETED' } }),
    prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { document_count: { decrement: counted ? 1 : 0 }, total_size_bytes: { decrement: counted ? BigInt(doc.file_size_bytes || 0) : 0n } } }),
  ]);
  return { deleted: true, id: doc.document_id };
}

async function applyPublic(userId, kbId, rawOperationId) {
  assert(String(rawOperationId || '').length >= 8, 'operationId 不合法');
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null }, include: { documents: { where: { deleted_at: null } } } });
  assert(kb, '知识库不存在或无权申请公开', 40301, 403);
  assert(kb.documents.length > 0 && kb.documents.every((doc) => doc.marketplace_status === 'READY'), '知识库文档尚未全部完成索引，暂时不能申请公开。');
  const operationId = scopedOperationId(userId, rawOperationId, `apply-kb-${kb.knowledge_base_id}`);
  const existing = await prisma.knowledgeBaseReviewRecord.findUnique({ where: { operationId } });
  if (!existing) await prisma.$transaction([
    prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { marketplace_visibility: 'PUBLIC_PENDING', marketplace_status: 'PUBLIC_PENDING' } }),
    prisma.knowledgeBaseReviewRecord.create({ data: { knowledgeBaseId: kb.knowledge_base_id, action: 'SUBMITTED', operationId } }),
  ]);
  return getKnowledgeBase(userId, kb.knowledge_base_id);
}

async function testRetrieval(userId, kbId, query) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null } });
  assert(kb, '知识库不存在或无权检索', 40301, 403);
  assert(!['DELETING', 'DELETED', 'DISABLED'].includes(kb.marketplace_status), '知识库当前不可用');
  const result = await dify.retrieveFromDataset(kb.dify_dataset_id, query, { topK: 5, scoreThreshold: 0.55 });
  return { records: result.records.map((item) => ({ documentName: item.documentName, segmentId: item.segmentId, quote: item.content.slice(0, 500), hasPageNumber: Number.isInteger(item.metadata?.page_number) })) };
}

async function deleteKnowledgeBase(userId, kbId) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null }, include: { _count: { select: { agent_bindings: true } }, documents: { where: { deleted_at: null } } } });
  assert(kb, '知识库不存在或无权删除', 40301, 403);
  assert(kb._count.agent_bindings === 0, `该知识库正在被 ${kb._count.agent_bindings} 个智能体使用，请先解除绑定。`, 40001, 400, { boundAgentCount: kb._count.agent_bindings });
  await prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { marketplace_status: 'DELETING' } });
  try {
    await dify.deleteDataset(kb.dify_dataset_id);
    const dir = path.resolve(STORAGE_ROOT, String(userId), String(kb.knowledge_base_id));
    if (dir.startsWith(`${STORAGE_ROOT}${path.sep}`)) await fs.rm(dir, { recursive: true, force: true });
    await prisma.$transaction([
      prisma.knowledgeDocument.updateMany({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { deleted_at: new Date(), marketplace_status: 'DELETED' } }),
      prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { deleted_at: new Date(), marketplace_status: 'DELETED', marketplace_visibility: 'PRIVATE' } }),
      prisma.operationLog.create({ data: { user_id: userId, role: 'STUDENT', operation_type: 'DELETE_AGENT_KNOWLEDGE_BASE', target_type: 'knowledge_base', target_id: kb.knowledge_base_id } }),
    ]);
    return { deleted: true, id: kb.knowledge_base_id };
  } catch (error) {
    await prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { marketplace_status: 'FAILED' } });
    const wrapped = new Error('知识库删除未完成，系统已保留记录以便重试。');
    wrapped.code = 50003;
    wrapped.status = 502;
    throw wrapped;
  }
}

module.exports = {
  STORAGE_ROOT, MAX_FILE_BYTES, MAX_FILES, validateUpload, serializeKnowledgeBase, serializeDocument,
  createKnowledgeBase, listKnowledgeBases, getKnowledgeBase, updateKnowledgeBase, uploadDocument,
  refreshStatus, deleteDocument, applyPublic, testRetrieval, deleteKnowledgeBase,
};
