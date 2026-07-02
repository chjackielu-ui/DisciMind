// 学生自主练习路由
// 前缀：/api/practice

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/practice.controller');

const router = Router();

router.post(
  '/start',
  authMiddleware,
  roleMiddleware(['student']),
  controller.startPractice,
);

router.post(
  '/submit',
  authMiddleware,
  roleMiddleware(['student']),
  controller.submitPractice,
);

router.post(
  '/question/:questionId/ask-ai',
  authMiddleware,
  roleMiddleware(['student']),
  controller.askAiForQuestion,
);

router.post(
  '/question/:questionId/ask-ai/stream',
  authMiddleware,
  roleMiddleware(['student']),
  controller.streamAskAiForQuestion,
);

router.post(
  '/question/:questionId/generate-analysis',
  authMiddleware,
  roleMiddleware(['student']),
  controller.generateAnalysis,
);

router.get(
  '/wrong-questions',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getWrongQuestions,
);

router.post(
  '/wrong-questions/:id/master',
  authMiddleware,
  roleMiddleware(['student']),
  controller.markWrongQuestionMastered,
);

router.post(
  '/wrong-questions/:id/similar',
  authMiddleware,
  roleMiddleware(['student']),
  controller.startSimilarPractice,
);

module.exports = router;
