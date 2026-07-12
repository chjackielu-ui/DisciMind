const { success } = require('../../utils/response');
const schemas = require('./learning-flow-preload.schemas');
const service = require('./learning-flow-preload.service');

function fail(res, error) { return res.status(Number(error.status || 400)).json({ code: Number(error.code || 50001), message: error.message, data: null }); }
const wrap = (handler) => async (req, res) => { try { return await handler(req, res); } catch (error) { return fail(res, error); } };
const create = wrap(async (req, res) => success(res, await service.createPreload(req.user, schemas.parse(schemas.createSchema, req.body)), '学习准备任务已创建'));
const detail = wrap(async (req, res) => success(res, await service.getPreload(req.user, req.params.id)));
const list = wrap(async (req, res) => success(res, await service.listPreloads(req.user, schemas.parse(schemas.listSchema, req.query))));
const retry = wrap(async (req, res) => success(res, await service.retryPreload(req.user, req.params.id, req.body?.operationId), '已重新开始学习准备'));
module.exports = { create, detail, list, retry };
