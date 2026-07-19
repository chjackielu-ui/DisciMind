// Auth Routes — 认证模块路由
// 挂载前缀：/api/auth

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const { rateLimit } = require('../middlewares/rate-limit.middleware');

function positiveEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: positiveEnv('AUTH_REGISTER_RATE_LIMIT_MAX', 5),
  keyPrefix: 'auth-register',
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: positiveEnv('AUTH_LOGIN_RATE_LIMIT_MAX', 20),
  keyPrefix: 'auth-login',
});
const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: positiveEnv('AUTH_REFRESH_RATE_LIMIT_MAX', 60),
  keyPrefix: 'auth-refresh',
});

const avatarDir = path.join(__dirname, '../../../storage/uploads/avatars');
fs.mkdirSync(avatarDir, { recursive: true });
const AVATAR_EXTENSION_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const AVATAR_FORMATS = new Map([
  ['image/png', { extension: '.png', accepted: new Set(['.png']) }],
  ['image/jpeg', { extension: '.jpg', accepted: new Set(['.jpg', '.jpeg']) }],
  ['image/webp', { extension: '.webp', accepted: new Set(['.webp']) }],
  ['image/gif', { extension: '.gif', accepted: new Set(['.gif']) }],
]);

function avatarValidationError(message) {
  const error = new Error(message);
  error.code = 40001;
  error.expose = true;
  return error;
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => {
<<<<<<< Updated upstream
      const format = AVATAR_FORMATS.get(String(file.mimetype || '').toLowerCase());
      cb(null, `avatar-${req.user.user_id}-${Date.now()}${format?.extension || '.bin'}`);
=======
      const ext = AVATAR_EXTENSION_BY_MIME[file.mimetype] || '.png';
      cb(null, `avatar-${req.user.user_id}-${Date.now()}${ext}`);
>>>>>>> Stashed changes
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
<<<<<<< Updated upstream
    const format = AVATAR_FORMATS.get(String(file.mimetype || '').toLowerCase());
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (format?.accepted.has(extension)) {
=======
    if (AVATAR_EXTENSION_BY_MIME[file.mimetype]) {
>>>>>>> Stashed changes
      cb(null, true);
      return;
    }
    cb(avatarValidationError('头像扩展名必须与 PNG、JPG、WEBP 或 GIF 文件类型一致'));
  },
});

// POST /api/auth/register — 用户注册
router.post('/register', registerLimiter, authController.register);

// POST /api/auth/login — 用户登录
router.post('/login', loginLimiter, authController.login);

// POST /api/auth/refresh — 使用 Refresh Token 续期
router.post('/refresh', refreshLimiter, authController.refresh);

// POST /api/auth/logout — 退出登录并撤销当前 Refresh Token
router.post('/logout', authController.logout);

// POST /api/auth/session/refresh — 兼容旧前端路径，但必须同时持有 HttpOnly Refresh Token Cookie
router.post('/session/refresh', refreshLimiter, authController.sessionRefresh);

// GET /api/auth/me — 获取当前登录用户（需要登录）
router.get('/me', authMiddleware, authController.getMe);

// PATCH /api/auth/me — 更新当前登录用户资料（需要登录）
router.patch('/me', authMiddleware, authController.updateMe);

// POST /api/auth/me/avatar — 上传头像（需要登录）
router.post('/me/avatar', authMiddleware, avatarUpload.single('avatar'), authController.updateAvatar);

// POST /api/auth/me/password — 重置密码（需要登录）
router.post('/me/password', authMiddleware, authController.changePassword);

module.exports = router;
