const service = require('./file-requirement.service');
const schemas = require('./file-requirement.schemas');
const { success } = require('../../utils/response');

function sendError(res, error) { return res.status(Number(error.status || 400)).json({ code: Number(error.code || 50001), message: error.message, data: null }); }
const wrap = handler => async (req, res) => { try { return await handler(req, res); } catch (error) { return sendError(res, error); } };

const get = wrap(async (req, res) => success(res, await service.getRequirements(req.user.user_id, req.params.conversationId)));
const plan = wrap(async (req, res) => success(res, await service.planRequirements(req.user.user_id, req.params.conversationId, schemas.parse(schemas.planSchema, req.body).message)));
const patch = wrap(async (req, res) => success(res, await service.patchRequirements(req.user.user_id, req.params.conversationId, schemas.parse(schemas.requirementPatchSchema, req.body))));
const confirm = wrap(async (req, res) => { const input = schemas.parse(schemas.confirmSchema, req.body); return success(res, await service.confirmRequirements(req.user.user_id, req.params.conversationId, input.operationId)); });
const prefill = wrap(async (req, res) => success(res, await service.prefillRequirements(req.user.user_id, req.params.conversationId, schemas.parse(schemas.prefillSchema, req.body)), '课前讲义需求已安全预填'));

module.exports = { get, plan, patch, confirm, prefill };
