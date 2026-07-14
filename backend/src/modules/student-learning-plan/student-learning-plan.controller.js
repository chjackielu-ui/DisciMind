const { success } = require('../../utils/response');
const schemas = require('./student-learning-plan.schemas');
const service = require('./student-learning-plan.service');

const wrap = handler => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
const current = wrap(async (req, res) => success(res, await service.getCurrent(req.user, { repair: req.query.repair !== 'false' })));
const list = wrap(async (req, res) => success(res, await service.listPlans(req.user, schemas.parse(schemas.listSchema, req.query))));
const detail = wrap(async (req, res) => success(res, service.serialize(await service.ownedRecord(req.user.user_id, req.params.id))));
const create = wrap(async (req, res) => success(res, await service.createPlan(req.user, schemas.parse(schemas.createSchema, req.body)), '学习计划已创建'));
const rematchCurrent = wrap(async (req, res) => success(res, await service.rematchLegacy(req.user), '已按当前目标重新匹配学习流'));
const rematch = wrap(async (req, res) => success(res, await service.rematch(req.user, req.params.id), '已按当前目标重新匹配学习流'));
const transition = wrap(async (req, res) => { const input = schemas.parse(schemas.transitionSchema, req.body); return success(res, await service.transition(req.user, req.params.id, input.status), '学习计划状态已更新'); });
const prepare = wrap(async (req, res) => { const input = schemas.parse(schemas.operationSchema, req.body || {}); return success(res, await service.prepare(req.user, req.params.id, input.operationId), '学习准备任务已创建'); });
const start = wrap(async (req, res) => success(res, await service.start(req.user, req.params.id), '学习会话已就绪'));
const referenceMaterials = wrap(async (req, res) => success(res, await service.listReferenceMaterials(req.user, req.params.id)));

module.exports = { current, list, detail, create, rematchCurrent, rematch, transition, prepare, start, referenceMaterials };
