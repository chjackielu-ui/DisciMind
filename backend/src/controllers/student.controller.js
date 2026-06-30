// 学生端控制器
// 负责接收请求、参数校验、调用服务层、返回统一响应

const { success, fail } = require('../utils/response');
const studentService = require('../services/student.service');

/**
 * GET /api/student/dashboard
 * 获取学生首页仪表盘综合数据
 */
async function getDashboard(req, res) {
  try {
    const userId = req.user.user_id;

    if (!userId) {
      return fail(res, 40101, '无法获取用户身份');
    }

    const data = await studentService.getDashboard(userId);
    return success(res, data, '获取仪表盘数据成功');
  } catch (err) {
    console.error('[student.controller] getDashboard 异常:', err.message);

    // 用户不存在
    if (err.code === 40401) {
      return fail(res, 40401, '用户不存在');
    }

    return fail(res, 50001, '服务器错误');
  }
}

module.exports = { getDashboard };
