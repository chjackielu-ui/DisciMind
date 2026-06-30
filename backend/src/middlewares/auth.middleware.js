// JWT 鉴权中间件
// 从请求头 Authorization: Bearer <token> 中解析用户信息
// 解析成功后将用户信息挂载到 req.user，失败则返回 401

const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  // 获取 Authorization 头
  const authHeader = req.headers.authorization;

  // 没有 token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      code: 40101,
      message: '未登录或 token 缺失',
      data: null,
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 使用 JWT_SECRET 验证并解析 token
    const secret = process.env.JWT_SECRET || 'discimind-dev-secret';
    const decoded = jwt.verify(token, secret);

    // 将解析出的用户信息挂载到 req 上，后续路由和中间件可以直接使用
    req.user = decoded;

    next();
  } catch (err) {
    // token 无效或已过期
    return res.status(401).json({
      code: 40102,
      message: 'token 无效或已过期',
      data: null,
    });
  }
}

module.exports = authMiddleware;
