const { success, fail } = require('../utils/response');
const service = require('../services/teacher-profile.service');

function handle(res, scope, error) {
  console.error(`[teacher-profile.controller] ${scope}:`, error.message);
  return fail(res, error.code || 50001, error.code ? error.message : '服务器错误');
}

async function getProfile(req, res) { try { return success(res, await service.getProfile(req.user)); } catch (error) { return handle(res, 'getProfile', error); } }
async function updateProfile(req, res) { try { return success(res, await service.updateProfile(req.user, req.body || {}), '教师资料已更新'); } catch (error) { return handle(res, 'updateProfile', error); } }

module.exports = { getProfile, updateProfile };
