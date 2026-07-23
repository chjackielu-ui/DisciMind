const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../../config/prisma');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { scopedOperationId } = require('../agent-marketplace/operation-id');
const asyncTasks = require('../async-task/async-task.service');
const knowledgeProvider = require('./knowledge-provider.service');
const knowledgeStorage = require('./knowledge-storage.service');
const {
  normalizeUploadFileName,
  maxAutomaticIndexingRetries,
} = require('./knowledge-ingestion.utils');

const STORAGE_ROOT = knowledgeStorage.STORAGE_ROOT;
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

function textIntegrity(value) {
  const text = String(value || '');
  return /\uFFFD|锟斤拷|\?{3,}|(?:Ã.|Â.|â€|ðŸ)/u.test(text) ? 'damaged' : 'ok';
}

function serializeDocument(doc) {
  return {
    id: doc.document_id,
    originalName: doc.original_filename,
    mimeType: doc.mime_type,
    sizeBytes: doc.file_size_bytes,
    status: doc.marketplace_status,
    processingState: doc.processing_state,
    parseStatus: doc.parse_status,
    errorCode: doc.error_code,
    errorStage: doc.error_stage,
    errorMessage: doc.error_message,
    retryable: doc.retryable,
    failedAt: doc.failed_at,
    attemptCount: doc.attempt_count,
    pageCount: doc.page_count,
    chunkCount: doc._count?.chunks || 0,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

function serializeKnowledgeBase(kb, userId, detail = false) {
  const nameIntegrity = textIntegrity(kb.name);
  const data = {
    id: kb.knowledge_base_id,
    name: kb.name,
    nameIntegrity,
    nameRepairRequired: nameIntegrity === 'damaged',
    description: kb.description || '',
    visibility: kb.marketplace_visibility,
    status: kb.marketplace_status,
    source: kb.ownership_mode === 'REMOTE_BOUND' ? 'REMOTE_MIGRATION_REQUIRED' : 'LOCAL',
    provider: kb.provider || knowledgeProvider.config().provider,
    ownershipMode: kb.ownership_mode || 'LOCAL_MANAGED',
    remoteStatus: kb.remote_status,
    remoteDocumentCount: kb.remote_document_count,
    lastSyncedAt: kb.last_synced_at,
    syncError: kb.sync_error,
    category: kb.category?.name || null,
    documentCount: kb.document_count,
    availableDocumentCount: (kb.documents || []).filter((doc) => doc.marketplace_status === 'READY').length,
    failedDocumentCount: (kb.documents || []).filter((doc) => doc.marketplace_status === 'FAILED').length,
    totalSizeBytes: Number(kb.total_size_bytes || 0),
    boundAgentCount: kb._count?.agent_bindings || 0,
    owner: safeOwner(kb.owner),
    isOwner: Number(kb.owner_user_id) === Number(userId),
    createdAt: kb.created_at,
    updatedAt: kb.updated_at,
  };
  if (detail) {
    data.documents = (kb.documents || []).map(serializeDocument);
    data.remoteDocuments = Array.isArray(kb.remote_documents_json) ? kb.remote_documents_json : [];
  }
  return data;
}

function validateUpload(file, submittedOriginalName = '') {
  assert(file, '请选择要上传的文件');
  assert(file.size > 0 && file.size <= MAX_FILE_BYTES, `单个文件不能超过 ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const original = normalizeUploadFileName(submittedOriginalName || file.originalname);
  assert(original.length > 0 && original.length <= 255, '文件名长度不合法');
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
  try {
    const category = input.category ? await prisma.agentCategory.findUnique({ where: { name: input.category } }) : null;
    const kb = await prisma.knowledgeBase.create({ data: {
      name: input.name, description: input.description, scope_type: 'PERSONAL', owner_user_id: userId,
      status: 'active', dify_dataset_id: null, provider: knowledgeProvider.config().provider, ownership_mode: 'LOCAL_MANAGED',
      remote_status: null, last_synced_at: null, marketplace_visibility: 'PRIVATE', marketplace_status: 'EMPTY',
      category_id: category?.id || null, operation_id: operationId,
    }, include: { owner: { include: { profile: true } }, category: true, _count: { select: { agent_bindings: true } } } });
    return serializeKnowledgeBase(kb, userId);
  } catch (error) {
    if (error.code) throw error;
    const wrapped = new Error('暂时无法创建知识库，请稍后重试。');
    wrapped.code = 50003;
    wrapped.status = 502;
    throw wrapped;
  }
}

const listInclude = {
  owner: { include: { profile: true } }, category: true,
  documents: { where: { deleted_at: null }, select: { marketplace_status: true } },
  _count: { select: { agent_bindings: true } },
};

async function listKnowledgeBases(userId, query = {}) {
  const isPublic = query.scope === 'public';
  const where = isPublic
    ? { marketplace_visibility: 'PUBLIC', marketplace_status: 'PUBLIC', deleted_at: null }
    : { owner_user_id: userId, deleted_at: null };
  const records = await prisma.knowledgeBase.findMany({ where, include: listInclude, orderBy: { updated_at: 'desc' } });
  return { list: records.map((kb) => serializeKnowledgeBase(kb, userId)) };
}

async function getKnowledgeBase(userId, id) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(id), deleted_at: null }, include: { ...listInclude, documents: { where: { deleted_at: null }, orderBy: { created_at: 'desc' }, include: { _count: { select: { chunks: true } } } } } });
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

async function uploadDocument(userId, kbId, file, rawOperationId, submittedOriginalName = '') {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null } });
  assert(kb, '知识库不存在或无权上传', 40301, 403);
  assert(!['DELETING', 'DELETED', 'OFFLINE'].includes(kb.marketplace_status), '知识库当前不可上传文件');
  assert(String(rawOperationId || '').length >= 8, 'operationId 不合法');
  const currentCount = await prisma.knowledgeDocument.count({ where: { knowledge_base_id: kb.knowledge_base_id, deleted_at: null } });
  assert(currentCount < MAX_FILES, `单个知识库最多上传 ${MAX_FILES} 个文件`);
  const checked = validateUpload(file, submittedOriginalName);
  const operationId = scopedOperationId(userId, rawOperationId, `upload-kb-${kb.knowledge_base_id}`);
  const existing = await prisma.knowledgeDocument.findUnique({ where: { operation_id: operationId } });
  if (existing) return serializeDocument(existing);
  const duplicate = await prisma.knowledgeDocument.findFirst({ where: { knowledge_base_id: kb.knowledge_base_id, file_checksum: checked.checksum, deleted_at: null } });
  assert(!duplicate, '检测到重复文件；可以跳过该文件，或在失败任务中选择重新处理。', 40901, 409, {
    duplicateDocumentId: duplicate?.document_id, duplicateStatus: duplicate?.marketplace_status,
  });

  const stored = await knowledgeStorage.storeUpload({
    userId,
    knowledgeBaseId: kb.knowledge_base_id,
    buffer: file.buffer,
    extension: checked.ext,
    mimeType: file.mimetype,
  });

  let document;
  try {
    document = await prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeDocument.create({ data: {
        knowledge_base_id: kb.knowledge_base_id, title: checked.original, original_filename: checked.original,
        file_ext: checked.ext, file_size_bytes: file.size, mime_type: file.mimetype, storage_type: stored.storageType,
        file_url: stored.fileUrl, storage_key: stored.storageKey, storage_bucket: stored.storageBucket,
        storage_etag: stored.storageEtag, storage_version_id: stored.storageVersionId,
        scope_type: 'PERSONAL', visibility: 'PRIVATE', owner_user_id: userId,
        parse_status: 'UPLOADED', processing_state: 'uploaded', review_status: 'APPROVED', dify_dataset_id: null,
        file_checksum: checked.checksum, marketplace_status: 'UPLOADED', operation_id: operationId,
      } });
      await tx.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: {
        document_count: { increment: 1 }, total_size_bytes: { increment: BigInt(file.size) }, marketplace_status: 'PROCESSING',
      } });
      return created;
    });
    await asyncTasks.createTask(userId, {
      operationId: `knowledge-indexing-${operationId}`,
      taskType: 'KNOWLEDGE_INDEXING', title: `正在处理 ${checked.original}`,
      description: `知识库“${kb.name}”将依次完成校验、解析、分片和向量索引。`,
      status: 'QUEUED', stage: 'VALIDATING',
      progressMode: 'STAGE_ONLY',
      relatedResourceType: 'KNOWLEDGE_DOCUMENT',
      relatedResourceId: document.document_id,
      resultType: 'KNOWLEDGE_BASE',
      resultId: kb.knowledge_base_id,
      resultUrl: '#/student/agents/knowledge',
      cancellable: true,
      maxAttempts: maxAutomaticIndexingRetries() + 1,
      metadataJson: { knowledgeBaseId: kb.knowledge_base_id, originalName: checked.original },
    });
    return serializeDocument(document);
  } catch (error) {
    if (document) await prisma.$transaction([
      prisma.knowledgeDocument.deleteMany({ where: { document_id: document.document_id } }),
      prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: {
        document_count: { decrement: 1 }, total_size_bytes: { decrement: BigInt(file.size) },
      } }),
    ]).catch(() => {});
    await knowledgeStorage.deleteDocumentObject(document || {
      storage_type: stored.storageType,
      file_url: stored.fileUrl,
      storage_key: stored.storageKey,
      storage_bucket: stored.storageBucket,
      storage_version_id: stored.storageVersionId,
    }).catch(() => {});
    if (error.status) throw error;
    throw Object.assign(new Error('上传记录创建失败，文件未进入处理队列。'), { code: 50003, status: 500 });
  }
}

async function listDifyDatasets(userId) {
  void userId;
  return {
    list: [],
    migrationRequired: true,
    message: 'Dify Dataset 直连已停用。请从原平台导出源文件后，在“我的知识库”重新上传建立索引。',
  };
}

async function syncDifyBinding(userId, kbId) {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { knowledge_base_id: Number(kbId), owner_user_id: Number(userId), deleted_at: null },
  });
  assert(kb, '知识库不存在或无权同步', 40301, 403);
  throw Object.assign(new Error('Dify 远程同步已停用。历史知识库需要导出源文件后重新上传，才能迁移到当前向量服务。'), {
    code: 40903, status: 409, details: { migrationRequired: true, knowledgeBaseId: kb.knowledge_base_id },
  });
}

async function bindDifyDatasets(userId, datasetIds) {
  void userId;
  void datasetIds;
  throw Object.assign(new Error('Dify Dataset 绑定已停用。请导出原始文件后上传到当前知识库。'), {
    code: 40903, status: 409, details: { migrationRequired: true },
  });
}

async function refreshStatus(userId, kbId, options = {}) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null }, include: { documents: { where: { deleted_at: null } } } });
  assert(kb, '知识库不存在或无权查看', 40301, 403);
  if (kb.ownership_mode === 'REMOTE_BOUND' && !kb.documents.length) {
    await prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: {
      remote_status: 'MIGRATION_REQUIRED',
      sync_error: '历史 Dify 知识库缺少本地源文件，请导出后重新上传。',
    } });
    if (options.throwOnSyncError) {
      throw Object.assign(new Error('历史 Dify 知识库缺少本地源文件，请导出后重新上传。'), { code: 40903, status: 409 });
    }
  }
  const docs = kb.documents;
  const readyCount = docs.filter((doc) => doc.marketplace_status === 'READY').length;
  const failedCount = docs.filter((doc) => doc.marketplace_status === 'FAILED').length;
  let status = !docs.length ? 'EMPTY'
    : readyCount === docs.length ? 'READY'
      : readyCount > 0 && failedCount > 0 ? 'PARTIAL'
        : failedCount === docs.length ? 'FAILED' : 'PROCESSING';
  if (kb.marketplace_visibility !== 'PRIVATE') status = kb.marketplace_status;
  await prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: {
    marketplace_status: status,
    remote_status: kb.ownership_mode === 'REMOTE_BOUND' ? 'MIGRATION_REQUIRED' : null,
    sync_error: kb.ownership_mode === 'REMOTE_BOUND' ? '历史 Dify 知识库需要从源文件重新建立索引。' : null,
    last_synced_at: new Date(),
  } });
  return getKnowledgeBase(userId, kb.knowledge_base_id);
}

async function deleteDocument(userId, kbId, documentId) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null } });
  assert(kb, '知识库不存在或无权删除文档', 40301, 403);
  const doc = await prisma.knowledgeDocument.findFirst({ where: { document_id: Number(documentId), knowledge_base_id: kb.knowledge_base_id, deleted_at: null } });
  assert(doc, '文档不存在', 40002, 404);
  await knowledgeProvider.deleteDocumentVectors(doc.document_id);
  await knowledgeStorage.deleteDocumentObject(doc);
  await prisma.knowledgeDocument.update({ where: { document_id: doc.document_id }, data: { deleted_at: new Date(), marketplace_status: 'DELETED' } });
  const [remainingCount, remainingSize] = await Promise.all([
    prisma.knowledgeDocument.count({ where: { knowledge_base_id: kb.knowledge_base_id, deleted_at: null } }),
    prisma.knowledgeDocument.aggregate({ where: { knowledge_base_id: kb.knowledge_base_id, deleted_at: null }, _sum: { file_size_bytes: true } }),
  ]);
  await prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: {
    document_count: remainingCount,
    total_size_bytes: BigInt(remainingSize._sum.file_size_bytes || 0),
    marketplace_status: remainingCount ? 'PROCESSING' : 'EMPTY',
  } });
  if (remainingCount) await refreshStatus(userId, kb.knowledge_base_id).catch(() => {});
  return { deleted: true, id: doc.document_id };
}

async function getDocumentPreview(userId, kbId, documentId) {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { knowledge_base_id: Number(kbId), deleted_at: null },
    include: { teaching_class: { select: { course_id: true } } },
  });
  assert(kb, '知识库不存在', 40002, 404);
  const agentContext = require('../agent-chat/agent-context.service');
  const scope = await agentContext.loadUserScope(userId);
  const canRead = agentContext.canAccessKnowledgeBase(kb, userId, scope);
  assert(canRead, '无权预览该知识库文件', 40301, 403);
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { document_id: Number(documentId), knowledge_base_id: kb.knowledge_base_id, deleted_at: null },
  });
  assert(doc, '文档不存在', 40002, 404);
  assert(doc.file_ext === '.pdf' && doc.mime_type === 'application/pdf', '仅支持预览 PDF 文件', 40001, 400);
  let materialized;
  let handle;
  try {
    materialized = await knowledgeStorage.materializeDocument(doc);
    const { absolutePath } = materialized;
    const stat = await fs.stat(absolutePath);
    assert(stat.isFile() && stat.size > 5 && stat.size <= MAX_FILE_BYTES, 'PDF 文件不存在或已失效', 40002, 404);
    handle = await fs.open(absolutePath, 'r');
    const header = Buffer.alloc(5);
    await handle.read(header, 0, 5, 0);
    assert(header.toString('ascii') === '%PDF-', 'PDF 文件内容无效', 40901, 409);
    return { absolutePath, size: stat.size, fileName: doc.original_filename, cleanup: materialized.cleanup };
  } catch (error) {
    await materialized?.cleanup?.();
    if (error.status) throw error;
    assert(false, 'PDF 文件不存在或已失效', 40002, 404);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function retryDocument(userId, kbId, documentId) {
  const document = await prisma.knowledgeDocument.findFirst({
    where: { document_id: Number(documentId), knowledge_base_id: Number(kbId), owner_user_id: Number(userId), deleted_at: null },
  });
  assert(document, '文档不存在或无权重试', 40301, 403);
  assert(['FAILED', 'CANCELLED'].includes(document.marketplace_status), '只有失败或已取消的文档可以重试', 40901, 409);
  const task = await prisma.asyncTask.findFirst({
    where: { userId: Number(userId), taskType: 'KNOWLEDGE_INDEXING', relatedResourceType: 'KNOWLEDGE_DOCUMENT', relatedResourceId: String(document.document_id) },
    orderBy: { createdAt: 'desc' },
  });
  assert(task, '未找到可重试的知识库任务', 40002, 404);
  return asyncTasks.retryTask(userId, task.id);
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
  const result = await knowledgeProvider.retrieveFromDataset(kb.knowledge_base_id, query, { topK: 5, scoreThreshold: 0.55 });
  return { records: result.records.map((item) => ({ documentName: item.documentName, segmentId: item.segmentId, quote: item.content.slice(0, 500), hasPageNumber: Number.isInteger(item.metadata?.page_number) })) };
}

async function deleteKnowledgeBase(userId, kbId) {
  const kb = await prisma.knowledgeBase.findFirst({ where: { knowledge_base_id: Number(kbId), owner_user_id: userId, deleted_at: null }, include: { _count: { select: { agent_bindings: true } }, documents: { where: { deleted_at: null } } } });
  assert(kb, '知识库不存在或无权删除', 40301, 403);
  assert(kb._count.agent_bindings === 0, `该知识库正在被 ${kb._count.agent_bindings} 个智能体使用，请先解除绑定。`, 40001, 400, { boundAgentCount: kb._count.agent_bindings });
  await prisma.knowledgeBase.update({ where: { knowledge_base_id: kb.knowledge_base_id }, data: { marketplace_status: 'DELETING' } });
  try {
    await knowledgeProvider.deleteKnowledgeBaseVectors(kb.knowledge_base_id);
    for (const document of kb.documents) await knowledgeStorage.deleteDocumentObject(document);
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
  STORAGE_ROOT, MAX_FILE_BYTES, MAX_FILES, textIntegrity, validateUpload, serializeKnowledgeBase, serializeDocument,
  createKnowledgeBase, listKnowledgeBases, getKnowledgeBase, updateKnowledgeBase, uploadDocument,
  listDifyDatasets, bindDifyDatasets, syncDifyBinding,
  refreshStatus, deleteDocument, getDocumentPreview, retryDocument, applyPublic, testRetrieval, deleteKnowledgeBase,
};
