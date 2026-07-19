const { success, fail } = require('../utils/response');
const service = require('../services/admin-ai-safety.service');

async function getOverview(req, res) {
  try { return success(res, await service.getOverview(), '获取 AI 安全治理概览成功'); }
  catch (error) { return fail(res, error.code || 50001, error.message); }
}

async function syncStandards(req, res) {
  try { return success(res, await service.syncStandards(req), '标准安全规范同步成功'); }
  catch (error) { return fail(res, error.code || 50001, error.message); }
}

async function setRuleEnabled(req, res) {
  try { return success(res, await service.setRuleEnabled(req.params.rule_id, req.body?.enabled, req), '安全规则状态已更新'); }
  catch (error) { return fail(res, error.code || 50001, error.message); }
}

module.exports = { getOverview, syncStandards, setRuleEnabled };
