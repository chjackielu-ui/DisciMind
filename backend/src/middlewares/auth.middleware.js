// JWT 鉴权中间件
// 从请求头 Authorization: Bearer <token> 中解析用户信息
// 解析成功后将用户信息挂载到 req.user，失败则返回 401
// 如果 JWT 中包含 session_id，同时校验会话活性

const { verifyToken } = require('../utils/jwt');
const prisma = require('../config/prisma');

// 会话活性检查节流：同 session 同分钟内不重复查库
const sessionCheckCache = new Map();

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, val] of sessionCheckCache) {
    if (now - val.time > 120000) sessionCheckCache.delete(key);
  }
}
setInterval(cleanExpiredCache, 60000).unref();

async function authMiddleware(req, res, next) {
  // 获取 Authorization 头
  const authHeader = req.headers.authorization;

  // 没有 token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const authErrRes = {
      code: 40101,
      source: 'discimind',
      stage: 'local_jwt_authentication',
      message: '未登录或 token 缺失',
      data: null,
    };
    console.log(`[Agent][auth] failed stage=local_jwt_authentication status=401 reason=${authHeader ? 'invalid_header' : 'missing_header'}`);
    return res.status(401).json(authErrRes);
  }

  const token = authHeader.split(' ')[1];

  try {
    // 使用统一 JWT 工具验证并解析 access token
    const decoded = verifyToken(token);
    if (decoded.token_type && decoded.token_type !== 'access') {
      throw new Error('invalid token type');
    }

    const user = await prisma.user.findUnique({
      where: { user_id: Number(decoded.user_id) },
      select: { user_id: true, role: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({
        code: 40102,
        source: 'discimind',
        stage: 'local_jwt_authentication',
        message: '账号不存在或已被禁用，请重新登录',
        data: null,
      });
    }

    // 如果 JWT 中包含 session_id，校验会话活性
    if (decoded.session_id) {
      const now = Date.now();
      const cacheKey = `sess_${decoded.session_id}`;
      const cached = sessionCheckCache.get(cacheKey);

      // 节流：同 session 1 分钟内不重复查库
      if (!cached || now - cached.time > 60000) {
        const session = await prisma.authSession.findUnique({
          where: { session_id: Number(decoded.session_id) },
        });

        if (!session || session.revoked_at || new Date(session.expires_at) <= new Date()) {
          return res.status(401).json({
            code: 40102,
            source: 'discimind',
            stage: 'local_jwt_authentication',
            message: '登录会话已过期，请重新登录',
            data: null,
          });
        }

        sessionCheckCache.set(cacheKey, { time: now, valid: true });
      }
    }

    // 将解析出的用户信息挂载到 req 上，后续路由和中间件可以直接使用
    req.user = {
      ...decoded,
      user_id: user.user_id,
      role: String(user.role).toLowerCase(),
    };

    next();
  } catch (err) {
    // token 无效或已过期
    return res.status(401).json({
      code: 40102,
      source: 'discimind',
      stage: 'local_jwt_authentication',
      message: 'token 无效或已过期',
      data: null,
    });
  }
}

module.exports = authMiddleware;
