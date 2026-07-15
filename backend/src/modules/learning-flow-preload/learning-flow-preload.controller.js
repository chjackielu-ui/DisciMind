const { success } = require('../../utils/response');
const schemas = require('./learning-flow-preload.schemas');
const service = require('./learning-flow-preload.service');

function fail(res, error) { return res.status(Number(error.status || 400)).json({ code: Number(error.code || 50001), message: error.message, data: null }); }
const wrap = (handler) => async (req, res) => { try { return await handler(req, res); } catch (error) { return fail(res, error); } };
const create = wrap(async (req, res) => success(res, await service.createPreload(req.user, schemas.parse(schemas.createSchema, req.body)), '学习准备任务已创建'));
const detail = wrap(async (req, res) => success(res, await service.getPreload(req.user, req.params.id)));
const list = wrap(async (req, res) => success(res, await service.listPreloads(req.user, schemas.parse(schemas.listSchema, req.query))));
const retry = wrap(async (req, res) => success(res, await service.retryPreload(req.user, req.params.id, req.body?.operationId), '已重新开始学习准备'));
const cards = wrap(async (req, res) => success(res, await require('./knowledge-card.service').getSessionCards(req.user, req.params.sessionId, schemas.parse(schemas.cardQuerySchema, req.query))));
const updateCardState = wrap(async (req, res) => success(res, await require('./knowledge-card.service').updateCardState(req.user, req.params.sessionId, req.params.cardId, schemas.parse(schemas.cardStateSchema, req.body))));
const saveCard = wrap(async (req, res) => success(res, await require('./knowledge-card.service').saveCardArtifact(req.user, req.params.sessionId, req.params.cardId, req.body || {}), '知识卡片已保存到成果中心'));
const regenerateCards = wrap(async (req, res) => success(res, await require('./knowledge-card.service').regenerate(req.user, req.params.sessionId, schemas.parse(schemas.regenerateCardsSchema, req.body || {})), '知识卡片正在后台刷新'));
module.exports = { create, detail, list, retry, cards, updateCardState, saveCard, regenerateCards };
