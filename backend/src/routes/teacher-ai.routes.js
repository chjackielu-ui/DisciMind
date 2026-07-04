// 教师端 AI 功能路由（占位）
// 前缀：/api/teacher

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-ai.controller');

const router = Router();

// AI 生成试题（占位）
router.post('/ai/generate-questions', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.generateQuestions);
// AI 资料总结（占位）
router.post('/ai/generate-summary', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.generateSummary);
// AI 视频生成（占位）
router.post('/ai/video-generation', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.videoGeneration);
// AI 学情分析（占位）
router.post('/ai/learning-analysis', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.learningAnalysis);

module.exports = router;
