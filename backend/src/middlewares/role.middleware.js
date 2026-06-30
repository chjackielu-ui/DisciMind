// 角色权限中间件
// 使用方式：router.get('/xxx', roleMiddleware(['admin', 'teacher']), controller.xxx)
// 依赖 auth.middleware.js 先执行，确保 req.user 存在

/**
 * 创建一个角色校验中间件
 * @param {string[]} allowedRoles - 允许访问的角色列表
 * @returns {import('express').RequestHandler}
 */
function roleMiddleware(allowedRoles) {
  return (req, res, next) => {
    // 必须先经过 auth 中间件，否则无法获取用户角色
    if (!req.user) {
      return res.status(401).json({
        code: 40101,
        message: '未登录或 token 缺失',
        data: null,
      });
    }

    const userRole = req.user.role;

    // 检查用户角色是否在允许列表中
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        code: 40301,
        message: '权限不足，无法访问该资源',
        data: null,
      });
    }

    next();
  };
}

module.exports = roleMiddleware;
