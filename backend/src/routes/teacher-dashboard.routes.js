// 教师端看板与学情分析路由
// 前缀：/api/teacher

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-dashboard.controller');

const router = Router();

// ---- 看板 ----
router.get(
  '/dashboard',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getDashboard,
);

// ---- 学情分析 ----
router.get(
  '/analytics/progress',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getProgress,
);

router.get(
  '/analytics/workbench',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getAnalyticsWorkbench,
);

router.get(
  '/analytics/dialogue-insights',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getDialogueInsights,
);

router.get(
  '/analytics/knowledge-heatmap',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getKnowledgeHeatmap,
);

router.get(
  '/analytics/score-distribution',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getScoreDistribution,
);

router.get(
  '/analytics/question-frequency',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getQuestionFrequency,
);

router.get(
  '/analytics/weak-knowledge-points',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getWeakKnowledgePoints,
);

router.get(
  '/analytics/student-radar/:student_user_id',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  controller.getStudentRadar,
);

module.exports = router;
