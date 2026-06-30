// Auth Controller — 认证接口请求处理层
// 负责解析请求参数、调用 service、返回统一格式响应

const authService = require('../services/auth.service');
const { success, fail } = require('../utils/response');

/**
 * POST /api/auth/register — 用户注册
 */
async function register(req, res, next) {
  try {
    const {
      username,
      password,
      role,
      phone,
      email,
      real_name,
      gender,
      student_no,
      teacher_no,
      college,
      major,
      grade,
      admin_class_id,
      avatar_url,
    } = req.body;

    // admin_class_id 如果传了字符串数字，转为整数
    const profileData = {
      username,
      password,
      role,
      phone,
      email,
      real_name,
      gender,
      student_no,
      teacher_no,
      college,
      major,
      grade,
      admin_class_id: admin_class_id != null ? Number(admin_class_id) : undefined,
      avatar_url,
    };

    const user = await authService.register(profileData);

    return success(res, { user }, '注册成功');
  } catch (err) {
    return fail(res, err.code || 40001, err.message);
  }
}

/**
 * POST /api/auth/login — 用户登录
 */
async function login(req, res, next) {
  try {
    const { account, password } = req.body;

    const result = await authService.login({ account, password });

    return success(res, result, '登录成功');
  } catch (err) {
    return fail(res, err.code || 40001, err.message);
  }
}

/**
 * GET /api/auth/me — 获取当前登录用户信息
 * 依赖 auth.middleware 解析 token 并将 user 信息挂载到 req.user
 */
async function getMe(req, res, next) {
  try {
    const { user_id } = req.user;

    const user = await authService.getMe(user_id);

    return success(res, { user });
  } catch (err) {
    return fail(res, err.code || 40001, err.message);
  }
}

module.exports = { register, login, getMe };
