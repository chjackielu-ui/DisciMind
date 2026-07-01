// 学生端知识库文档控制器

const { success, fail } = require('../utils/response');
const studentDocumentService = require('../services/student-document.service');

function getUserId(req) {
  return req.user?.user_id;
}

// ========================
// 1. 上传文档
// ========================

async function uploadDocument(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    if (!req.file) {
      return fail(res, 40001, '请选择要上传的文件');
    }

    const data = await studentDocumentService.uploadDocument(userId, req.file, req.body);
    return success(res, data, '上传成功');
  } catch (err) {
    console.error('[student-document.controller] uploadDocument 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 2. 解析文档
// ========================

async function parseDocument(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const documentId = parseInt(req.params.document_id, 10);
    if (isNaN(documentId) || documentId < 1) {
      return fail(res, 40001, 'document_id 参数不合法');
    }

    const data = await studentDocumentService.parseDocument(userId, documentId);
    return success(res, data, '解析成功');
  } catch (err) {
    console.error('[student-document.controller] parseDocument 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 3. 获取文档列表
// ========================

async function listDocuments(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await studentDocumentService.listDocuments(userId, req.query);
    return success(res, data, '获取文档列表成功');
  } catch (err) {
    console.error('[student-document.controller] listDocuments 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 4. 获取文档详情
// ========================

async function getDocument(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const documentId = parseInt(req.params.document_id, 10);
    if (isNaN(documentId) || documentId < 1) {
      return fail(res, 40001, 'document_id 参数不合法');
    }

    const data = await studentDocumentService.getDocument(userId, documentId);
    return success(res, data, '获取文档详情成功');
  } catch (err) {
    console.error('[student-document.controller] getDocument 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 5. 删除文档
// ========================

async function deleteDocument(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const documentId = parseInt(req.params.document_id, 10);
    if (isNaN(documentId) || documentId < 1) {
      return fail(res, 40001, 'document_id 参数不合法');
    }

    const data = await studentDocumentService.deleteDocument(userId, documentId);
    return success(res, data, '删除成功');
  } catch (err) {
    console.error('[student-document.controller] deleteDocument 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

module.exports = {
  uploadDocument,
  parseDocument,
  listDocuments,
  getDocument,
  deleteDocument,
};
