// 作业模块路由
// 前缀：/api/teacher/homework

const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const roleMiddleware = require('../../middlewares/role.middleware');
const controller = require('./homework.controller');

const router = Router();

// 作业 CRUD
router.post('/create', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.create);
router.put('/:id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.update);
router.put('/:id/publish', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.publish);
router.put('/:id/close', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.close);
router.post('/:id/import-question', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.importQuestion);
router.get('/list', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.list);
router.get('/:id/detail', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.detail);

// 提交与批改
router.get('/:id/submissions', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.submissions);
router.post('/:id/batch-ai-mark', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.batchAiMark);
router.post('/submission/:subId/ai-mark', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.aiMark);
router.put('/submission/:subId/manual-mark', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.manualMark);

// 成绩统计
router.get('/:id/score-stat', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.scoreStat);

module.exports = router;
