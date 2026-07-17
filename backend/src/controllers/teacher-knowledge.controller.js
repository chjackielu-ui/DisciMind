// 教师端知识库管理控制器

const { success, fail } = require('../utils/response');
const teacherKnowledgeService = require('../services/teacher-knowledge.service');
const path = require('path');
const fs = require('fs');

function hasValidUploadSignature(filename, buffer) {
  const ext = path.extname(filename || '').toLowerCase();
  const starts = (...bytes) => bytes.every((value, index) => buffer[index] === value);
  if (ext === '.pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (['.docx', '.pptx', '.xlsx'].includes(ext)) return starts(0x50, 0x4b) && [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([a, b]) => buffer[2] === a && buffer[3] === b);
  if (['.doc', '.ppt', '.xls'].includes(ext)) return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  if (ext === '.png') return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (['.jpg', '.jpeg'].includes(ext)) return starts(0xff, 0xd8, 0xff);
  if (ext === '.gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (ext === '.webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (['.txt', '.md'].includes(ext)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return !buffer.includes(0); } catch { return false; }
  }
  return false;
}

async function removeUploadedFile(file) {
  if (!file?.path) return;
  await fs.promises.unlink(file.path).catch(() => {});
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    const err = new Error(`${name} 参数不合法`);
    err.code = 40001;
    throw err;
  }
  return parsed;
}

function handleError(res, scope, err) {
  console.error(`[teacher-knowledge.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

async function listDocuments(req, res) {
  try {
    const data = await teacherKnowledgeService.listDocuments(req.user, req.query || {});
    return success(res, data, '获取文档列表成功');
  } catch (err) {
    return handleError(res, 'listDocuments', err);
  }
}

async function getDocument(req, res) {
  try {
    const documentId = parsePositiveInt(req.params.document_id, 'document_id');
    const data = await teacherKnowledgeService.getDocument(req.user, documentId);
    return success(res, data, '获取文档详情成功');
  } catch (err) {
    return handleError(res, 'getDocument', err);
  }
}

async function reviewDocument(req, res) {
  try {
    const documentId = parsePositiveInt(req.params.document_id, 'document_id');
    const data = await teacherKnowledgeService.reviewDocument(req.user, documentId, req.body || {});
    return success(res, data, '审核文档成功');
  } catch (err) {
    return handleError(res, 'reviewDocument', err);
  }
}

async function uploadDocument(req, res) {
  try {
    if (!req.file) return fail(res, 40001, '请选择要上传的文件');
    const content = await fs.promises.readFile(req.file.path);
    if (!hasValidUploadSignature(req.file.originalname, content)) {
      await removeUploadedFile(req.file);
      return fail(res, 40001, '文件内容与扩展名不一致');
    }
    const data = await teacherKnowledgeService.uploadDocument(req.user, req.file, req.body || {});
    return success(res, data, '上传成功');
  } catch (err) {
    await removeUploadedFile(req.file);
    return handleError(res, 'uploadDocument', err);
  }
}

async function createExternalResource(req, res) {
  try {
    return success(res, await teacherKnowledgeService.createExternalResource(req.user, req.body || {}), '创建链接资源成功');
  } catch (err) { return handleError(res, 'createExternalResource', err); }
}

async function updateResource(req, res) {
  try {
    const documentId = parsePositiveInt(req.params.document_id, 'document_id');
    return success(res, await teacherKnowledgeService.updateResource(req.user, documentId, req.body || {}), '更新资源成功');
  } catch (err) { return handleError(res, 'updateResource', err); }
}

async function deleteResource(req, res) {
  try {
    const documentId = parsePositiveInt(req.params.document_id, 'document_id');
    return success(res, await teacherKnowledgeService.deleteResource(req.user, documentId), '删除资源成功');
  } catch (err) { return handleError(res, 'deleteResource', err); }
}

async function shareResource(req, res) {
  try {
    const documentId = parsePositiveInt(req.params.document_id, 'document_id');
    return success(res, await teacherKnowledgeService.shareResource(req.user, documentId, req.body || {}), '资源已发送');
  } catch (err) { return handleError(res, 'shareResource', err); }
}

async function getResourceDistributionStats(req, res) {
  try {
    const documentId = parsePositiveInt(req.params.document_id, 'document_id');
    return success(res, await teacherKnowledgeService.getResourceDistributionStats(req.user, documentId), '获取资源下发状态成功');
  } catch (err) { return handleError(res, 'getResourceDistributionStats', err); }
}

async function downloadResource(req, res) {
  try {
    const documentId = parsePositiveInt(req.params.document_id, 'document_id');
    const doc = await teacherKnowledgeService.getDocument(req.user, documentId);
    if (doc.file_url?.startsWith('http://') || doc.file_url?.startsWith('https://')) return res.redirect(doc.file_url);
    const projectStorageRoot = path.resolve(__dirname, '../../../storage');
    const backendStorageRoot = path.resolve(__dirname, '../../storage');
    const relative = String(doc.file_url || '').replace(/^\/+/, '').replace(/\//g, path.sep);
    const candidates = [
      path.resolve(projectStorageRoot, relative),
      path.resolve(backendStorageRoot, relative),
    ];
    const absolute = candidates.find((candidate) => (
      (candidate.startsWith(`${projectStorageRoot}${path.sep}`) || candidate.startsWith(`${backendStorageRoot}${path.sep}`))
      && fs.existsSync(candidate)
    ));
    if (!absolute) return fail(res, 40002, '文件不存在');
    return res.download(absolute, doc.original_filename);
  } catch (err) { return handleError(res, 'downloadResource', err); }
}

async function listKnowledgeBaseApplications(req, res) {
  try {
    return success(res, await teacherKnowledgeService.listKnowledgeBaseApplications(req.user, req.query || {}), '获取知识库申请成功');
  } catch (err) { return handleError(res, 'listKnowledgeBaseApplications', err); }
}

async function reviewKnowledgeBaseApplication(req, res) {
  try {
    const reviewId = parsePositiveInt(req.params.review_id, 'review_id');
    return success(res, await teacherKnowledgeService.reviewKnowledgeBaseApplication(req.user, reviewId, req.body || {}), '知识库审核完成');
  } catch (err) { return handleError(res, 'reviewKnowledgeBaseApplication', err); }
}

async function batchReviewKnowledgeBaseApplications(req, res) {
  try {
    return success(res, await teacherKnowledgeService.batchReviewKnowledgeBaseApplications(req.user, req.body || {}), '批量审核完成');
  } catch (err) { return handleError(res, 'batchReviewKnowledgeBaseApplications', err); }
}

async function revokeKnowledgeBasePublic(req, res) {
  try {
    const knowledgeBaseId = parsePositiveInt(req.params.knowledge_base_id, 'knowledge_base_id');
    return success(res, await teacherKnowledgeService.revokeKnowledgeBasePublic(req.user, knowledgeBaseId, req.body || {}), '已撤销公开');
  } catch (err) { return handleError(res, 'revokeKnowledgeBasePublic', err); }
}

module.exports = {
  listDocuments,
  getDocument,
  reviewDocument,
  uploadDocument,
  createExternalResource,
  updateResource,
  deleteResource,
  shareResource,
  getResourceDistributionStats,
  downloadResource,
  listKnowledgeBaseApplications,
  reviewKnowledgeBaseApplication,
  batchReviewKnowledgeBaseApplications,
  revokeKnowledgeBasePublic,
};
