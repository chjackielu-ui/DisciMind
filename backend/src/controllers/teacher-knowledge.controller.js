// 教师端知识库管理控制器

const { success, fail } = require('../utils/response');
const teacherKnowledgeService = require('../services/teacher-knowledge.service');

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
    const data = await teacherKnowledgeService.uploadDocument(req.user, req.file, req.body || {});
    return success(res, data, '上传成功');
  } catch (err) {
    return handleError(res, 'uploadDocument', err);
  }
}

module.exports = {
  listDocuments,
  getDocument,
  reviewDocument,
  uploadDocument,
};
