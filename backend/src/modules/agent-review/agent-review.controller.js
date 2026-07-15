const { success } = require('../../utils/response');
const service = require('./agent-review.service');
const schemas = require('./agent-review.schemas');

function handle(res, error) {
  return res.status(Number(error.status || (error.code === 40301 ? 403 : error.code === 40002 ? 404 : 400))).json({ code: Number(error.code || 50001), message: error.message || '审核失败', data: null });
}
const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (error) { return handle(res, error); } };

const listAgentReviews = wrap(async (req, res) => success(res, await service.listAgentReviews()));
const getAgentReview = wrap(async (req, res) => success(res, await service.getAgentReview(req.params.id)));
const approveAgent = wrap(async (req, res) => success(res, await service.approveAgent(req.user.user_id, req.params.id, schemas.parse(schemas.operationSchema, req.body).operationId), '审核通过'));
const rejectAgent = wrap(async (req, res) => success(res, await service.rejectAgent(req.user.user_id, req.params.id, schemas.parse(schemas.rejectSchema, req.body)), '已驳回'));
const offlineAgent = wrap(async (req, res) => {
  const input = schemas.parse(schemas.offlineSchema, req.body);
  return success(res, await service.offlineAgent(req.user.user_id, req.params.id, input.operationId, input.reason), '已下架');
});
const listKnowledgeReviews = wrap(async (req, res) => success(res, await service.listKnowledgeReviews()));
const getKnowledgeReview = wrap(async (req, res) => success(res, await service.getKnowledgeReview(req.params.id)));
const approveKnowledge = wrap(async (req, res) => success(res, await service.reviewKnowledge(req.user.user_id, req.params.id, schemas.parse(schemas.operationSchema, req.body), true), '知识库审核通过'));
const rejectKnowledge = wrap(async (req, res) => success(res, await service.reviewKnowledge(req.user.user_id, req.params.id, schemas.parse(schemas.rejectSchema, req.body), false), '知识库已驳回'));
const listReports = wrap(async (req, res) => success(res, await service.listReports()));
const resolveReport = wrap(async (req, res) => success(res, await service.resolveReport(req.user.user_id, req.params.id, schemas.parse(schemas.resolveReportSchema, req.body)), '举报已处理'));

module.exports = { listAgentReviews, getAgentReview, approveAgent, rejectAgent, offlineAgent, listKnowledgeReviews, getKnowledgeReview, approveKnowledge, rejectKnowledge, listReports, resolveReport, handle };
