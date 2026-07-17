// 管理员端看板控制器

const { success, fail } = require('../utils/response');
const dashboardService = require('../services/admin-dashboard.service');

async function getDashboard(req, res) {
  try {
    const data = await dashboardService.getDashboard();
    return success(res, data, '获取系统总览成功');
  } catch (err) {
    console.error('[admin-dashboard] getDashboard error:', err.message);
    return fail(res, 50001, '服务器错误');
  }
}

module.exports = { getDashboard };
