// 教师端智能教案生成路由
// 前缀：/api/teacher

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-lesson-plan.controller');

const router = Router();

router.get('/lesson-plan/keywords', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getKeywords);
router.post('/lesson-plan/generate', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.generate);
router.post('/lesson-plan/export', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.exportDocx);
router.get('/lesson-plan/download', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.download);
router.post('/lesson-plan/create-task', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createTask);
router.get('/lesson-plan/task/:taskId', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getTaskStatus);

module.exports = router;
