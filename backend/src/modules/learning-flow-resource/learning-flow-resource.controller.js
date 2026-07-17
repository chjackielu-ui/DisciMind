const { success } = require('../../utils/response');
const schemas = require('./learning-flow-resource.schemas');
const service = require('./learning-flow-resource.service');

function fail(res, error) {
  return res.status(Number(error.status || 400)).json({ code: Number(error.code || 50001), message: error.message, data: null });
}
const wrap = (handler) => async (req, res) => { try { return await handler(req, res); } catch (error) { return fail(res, error); } };

const create = wrap(async (req, res) => success(res, await service.createLink(req.user, req.params.id, schemas.parse(schemas.createSchema, req.body)), '资料已加入学习流。'));
const list = wrap(async (req, res) => success(res, await service.listResources(req.user, schemas.parse(schemas.listSchema, req.query))));
const detail = wrap(async (req, res) => success(res, await service.getResource(req.user, req.params.id)));
const remove = wrap(async (req, res) => success(res, await service.unlink(req.user, req.params.id), '已解除资料关联'));

module.exports = { create, list, detail, remove };
