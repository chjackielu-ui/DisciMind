// Auth Controller — 认证接口请求处理层
// 负责解析请求参数、调用 service、返回统一格式响应

const authService = require('../services/auth.service');
const fs = require('fs/promises');
const path = require('path');
const { success, fail } = require('../utils/response');

const AVATAR_DIR = path.resolve(__dirname, '../../../storage/uploads/avatars');

function hasExpectedAvatarSignature(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mimetype === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimetype === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/gif') return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (mimetype === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

async function removeUploadedAvatar(file) {
  if (!file?.path) return;
  const resolved = path.resolve(file.path);
  if (path.dirname(resolved) !== AVATAR_DIR) return;
  await fs.unlink(resolved).catch(() => {});
}

function getRequestIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 64);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return cookies;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function getRefreshToken(req) {
  return parseCookies(req)[authService.REFRESH_TOKEN_COOKIE_NAME] || '';
}

function getRefreshCookieOptions(maxAge = authService.REFRESH_TOKEN_TTL_MS) {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSite = (process.env.REFRESH_TOKEN_SAME_SITE || 'lax').toLowerCase();
  const secure = process.env.REFRESH_TOKEN_COOKIE_SECURE
    ? process.env.REFRESH_TOKEN_COOKIE_SECURE === 'true'
    : (isProd || sameSite === 'none');
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/api/auth',
    maxAge,
  };
}

function setRefreshCookie(res, token, expiresAt) {
  res.cookie(authService.REFRESH_TOKEN_COOKIE_NAME, token, {
    ...getRefreshCookieOptions(),
    expires: expiresAt,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(authService.REFRESH_TOKEN_COOKIE_NAME, getRefreshCookieOptions(0));
}

function authMeta(req) {
  return {
    deviceInfo: req.headers['user-agent'] || '',
    ipAddress: getRequestIp(req),
  };
}

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

    const result = await authService.login({ account, password, ...authMeta(req) });
    if (result.refreshToken) {
      setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiresAt);
      delete result.refreshToken;
      delete result.refreshTokenExpiresAt;
    }

    return success(res, result, '登录成功');
  } catch (err) {
    return fail(res, err.code || 40001, err.message);
  }
}

/**
 * POST /api/auth/refresh — 使用 HttpOnly Cookie 中的 Refresh Token 续期
 */
async function refresh(req, res, next) {
  try {
    const result = await authService.refreshSession(getRefreshToken(req), authMeta(req));
    return success(res, result, '登录状态已恢复');
  } catch (err) {
    clearRefreshCookie(res);
    return fail(res, err.code || 40102, err.message);
  }
}

/**
 * POST /api/auth/logout — 主动退出并撤销当前 Refresh Token
 */
async function logout(req, res, next) {
  try {
    await authService.logout(getRefreshToken(req));
    clearRefreshCookie(res);
    return success(res, null, '已退出登录');
  } catch (err) {
    clearRefreshCookie(res);
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

/**
 * PATCH /api/auth/me — 更新当前登录用户资料
 */
async function updateMe(req, res, next) {
  try {
    const { user_id } = req.user;
    const user = await authService.updateMe(user_id, req.body || {});
    return success(res, { user }, '个人资料已更新');
  } catch (err) {
    return fail(res, err.code || 40001, err.message);
  }
}

/**
 * POST /api/auth/me/avatar — 上传并更新头像
 */
async function updateAvatar(req, res, next) {
  try {
    const { user_id } = req.user;

    if (!req.file) {
      return fail(res, 40001, '请选择要上传的头像图片');
    }

    const signature = await fs.readFile(req.file.path).then((buffer) => buffer.subarray(0, 16));
    if (!hasExpectedAvatarSignature(signature, req.file.mimetype)) {
      await removeUploadedAvatar(req.file);
      return fail(res, 40001, '头像文件内容与声明的图片类型不一致');
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const user = await authService.updateAvatar(user_id, avatarUrl);
    return success(res, { user, avatar_url: avatarUrl }, '头像已更新');
  } catch (err) {
    await removeUploadedAvatar(req.file);
    return fail(res, err.code || 40001, err.message);
  }
}

/**
 * POST /api/auth/me/password — 重置当前登录用户密码
 */
async function changePassword(req, res, next) {
  try {
    const { user_id } = req.user;
    await authService.changePassword(user_id, req.body || {});
    return success(res, null, '密码已重置');
  } catch (err) {
    return fail(res, err.code || 40001, err.message);
  }
}

/**
 * POST /api/auth/session/refresh — 兼容旧前端刷新路径
 * sessionId 不是凭证；必须使用 HttpOnly Cookie 中的 Refresh Token 续期。
 */
async function sessionRefresh(req, res, next) {
  try {
    const result = await authService.refreshSession(getRefreshToken(req), authMeta(req));
    return success(res, result, '会话已恢复');
  } catch (err) {
    clearRefreshCookie(res);
    return fail(res, err.code || 40102, err.message);
  }
}

module.exports = { register, login, refresh, logout, getMe, updateMe, updateAvatar, changePassword, sessionRefresh };
