// Auth Routes — 认证模块路由
// 挂载前缀：/api/auth

const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// POST /api/auth/register — 用户注册
router.post('/register', authController.register);

// POST /api/auth/login — 用户登录
router.post('/login', authController.login);

// GET /api/auth/me — 获取当前登录用户（需要登录）
router.get('/me', authMiddleware, authController.getMe);

module.exports = router;
