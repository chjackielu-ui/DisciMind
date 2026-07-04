// 管理员端操作日志控制器

const { success, fail } = require('../utils/response');
const logService = require('../services/admin-log.service');

async function getOperationLogs(req, res) {
  try {
    const data = await logService.getOperationLogs(req.query || {});
    return success(res, data, '获取操作日志成功');
  } catch (err) {
    console.error('[admin-log] getOperationLogs error:', err.message);
    return fail(res, err.code || 50001, err.message);
  }
}

module.exports = { getOperationLogs };
