// 管理员端知识库管理控制器

const { success, fail } = require('../utils/response');
const knowledgeService = require('../services/admin-knowledge.service');

async function getDocumentList(req, res) {
  try {
    const data = await knowledgeService.getDocumentList(req.query || {});
    return success(res, data, '获取文档列表成功');
  } catch (err) {
    console.error('[admin-knowledge] getDocumentList error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

async function reviewDocument(req, res) {
  try {
    const documentId = parseInt(req.params.document_id, 10);
    if (!documentId || documentId < 1) {
      return fail(res, 40001, '文档 ID 不合法');
    }

    const { review_status, review_comment } = req.body;
    if (!review_status || !['approved', 'rejected'].includes(review_status)) {
      return fail(res, 40001, '审核状态不合法，仅支持 approved / rejected');
    }

    const data = await knowledgeService.reviewDocument(documentId, review_status, review_comment || null, req.user.user_id);
    return success(res, data, '文档审核完成');
  } catch (err) {
    console.error('[admin-knowledge] reviewDocument error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

module.exports = { getDocumentList, reviewDocument };
