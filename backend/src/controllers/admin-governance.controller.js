const { success, fail } = require('../utils/response');
const service = require('../services/admin-governance.service');

async function getOverview(req, res) {
  try { return success(res, await service.getOverview(req.params.module), '获取治理概览成功'); }
  catch (error) { return fail(res, error.code || 50001, error.message); }
}

async function getList(req, res) {
  try { return success(res, await service.listModule(req.params.module, req.query || {}), '获取治理列表成功'); }
  catch (error) { return fail(res, error.code || 50001, error.message); }
}

async function runAction(req, res) {
  try { return success(res, await service.runAction(req.params.module, req.params.action, req.body || {}, req), '治理操作执行成功'); }
  catch (error) { return fail(res, error.code || 50001, error.message); }
}

module.exports = { getOverview, getList, runAction };
