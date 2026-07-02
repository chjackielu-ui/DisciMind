// 教师端练习统计路由
// 前缀：/api/teacher/practice

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-practice.controller');

const router = Router();

router.get(
  '/overview',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getOverview,
);

router.get(
  '/classes/:classId',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getClassAnalytics,
);

router.get(
  '/students/:studentId',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getStudentAnalytics,
);

router.get(
  '/questions/analytics',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getQuestionAnalytics,
);

router.get(
  '/ai-questions',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getAiQuestions,
);

router.patch(
  '/questions/:questionId/status',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.updateQuestionStatus,
);

module.exports = router;
