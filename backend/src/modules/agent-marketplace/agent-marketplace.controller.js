const { success } = require('../../utils/response');
const service = require('./agent-marketplace.service');
const rankings = require('./agent-ranking.service');
const { agentInputSchema, ratingSchema, reportSchema, parse } = require('./agent-marketplace.schemas');

function handleError(res, error) {
  const status = Number(error.status || (error.code === 40301 ? 403 : error.code === 40002 ? 404 : 400));
  return res.status(status).json({ code: Number(error.code || 50001), message: error.message || '服务器错误', data: error.details || null });
}

const wrap = (handler) => async (req, res) => {
  try { return await handler(req, res); } catch (error) { return handleError(res, error); }
};

const list = wrap(async (req, res) => success(res, await service.listAgents(req.user.user_id, req.query, 'public')));
const mine = wrap(async (req, res) => success(res, await service.listAgents(req.user.user_id, req.query, 'mine')));
const favorites = wrap(async (req, res) => success(res, await service.listAgents(req.user.user_id, req.query, 'favorites')));
const availableChat = wrap(async (req, res) => success(res, await service.listAvailableChatAgents(req.user.user_id)));
const callable = wrap(async (req, res) => success(res, await service.listCallableAgents(req.user.user_id, req.query)));
const hotRankings = wrap(async (req, res) => success(res, await rankings.hotRankings(req.query.limit)));
const detail = wrap(async (req, res) => success(res, await service.getAgent(req.user.user_id, req.params.id)));
const create = wrap(async (req, res) => success(res, await service.createAgent(req.user.user_id, parse(agentInputSchema, req.body)), '智能体创建成功'));
const update = wrap(async (req, res) => success(res, await service.updateAgent(req.user.user_id, req.params.id, parse(agentInputSchema, req.body)), '保存修改成功'));
const remove = wrap(async (req, res) => success(res, await service.deleteAgent(req.user.user_id, req.params.id), '删除成功'));
const applyPublic = wrap(async (req, res) => success(res, await service.applyPublic(req.user.user_id, req.params.id, String(req.body.operationId || '')), '已提交审核'));
const copy = wrap(async (req, res) => success(res, await service.copyAgent(req.user.user_id, req.params.id, String(req.body.operationId || '')), '复制成功'));
const favorite = wrap(async (req, res) => success(res, await service.favorite(req.user.user_id, req.params.id, true), '已收藏'));
const unfavorite = wrap(async (req, res) => success(res, await service.favorite(req.user.user_id, req.params.id, false), '已取消收藏'));
const rating = wrap(async (req, res) => success(res, await service.rate(req.user.user_id, req.params.id, parse(ratingSchema, req.body).rating), '评分已保存'));
const report = wrap(async (req, res) => success(res, await service.report(req.user.user_id, req.params.id, parse(reportSchema, req.body)), '举报已提交'));

module.exports = { list, mine, favorites, availableChat, callable, hotRankings, detail, create, update, remove, applyPublic, copy, favorite, unfavorite, rating, report, handleError };
