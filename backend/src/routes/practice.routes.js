// 学生自主练习路由
// 前缀：/api/practice

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/practice.controller');

const router = Router();

// ========================
// 练习会话
// ========================

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

router.get(
  '/active',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getActiveAttempt,
);

router.get(
  '/sessions',
  authMiddleware,
  roleMiddleware(['student']),
  controller.listPracticeSessions,
);

router.get(
  '/sessions/:sessionId',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getPracticeSession,
);

router.post(
  '/sessions/:sessionId/abandon',
  authMiddleware,
  roleMiddleware(['student']),
  controller.abandonPracticeSession,
);

router.put(
  '/sessions/:sessionId/items/:itemId/answer',
  authMiddleware,
  roleMiddleware(['student']),
  controller.savePracticeAnswer,
);

router.post(
  '/sessions/:sessionId/items/:itemId/submit',
  authMiddleware,
  roleMiddleware(['student']),
  controller.submitPracticeItem,
);

router.post(
  '/sessions/:sessionId/submit',
  authMiddleware,
  roleMiddleware(['student']),
  controller.submitPracticeSession,
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

// ========================
// 错题本（原有兼容 + 全新升级）
// ========================

// 概览和分类树
router.get(
  '/wrong-questions/overview',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getWrongQuestionOverview,
);

router.get(
  '/wrong-questions/taxonomy',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getWrongQuestionTaxonomy,
);

// 标签管理
router.get(
  '/wrong-questions/tags',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getWrongQuestionTags,
);

router.post(
  '/wrong-questions/tags',
  authMiddleware,
  roleMiddleware(['student']),
  controller.createWrongQuestionTag,
);

router.put(
  '/wrong-questions/tags/:id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.updateWrongQuestionTag,
);

router.delete(
  '/wrong-questions/tags/:id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.deleteWrongQuestionTag,
);

// 错题 + 标签关联
router.post(
  '/wrong-questions/:id/tags',
  authMiddleware,
  roleMiddleware(['student']),
  controller.addTagToWrongQuestion,
);

router.delete(
  '/wrong-questions/:id/tags/:tagId',
  authMiddleware,
  roleMiddleware(['student']),
  controller.removeTagFromWrongQuestion,
);

// 错题系列管理
router.get(
  '/wrong-questions/collections',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getWrongQuestionCollections,
);

router.get(
  '/wrong-questions/collections/:id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getWrongQuestionCollectionDetail,
);

router.post(
  '/wrong-questions/collections',
  authMiddleware,
  roleMiddleware(['student']),
  controller.createWrongQuestionCollection,
);

router.put(
  '/wrong-questions/collections/:id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.updateWrongQuestionCollection,
);

router.delete(
  '/wrong-questions/collections/:id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.deleteWrongQuestionCollection,
);

// 批量更新
router.patch(
  '/wrong-questions/batch',
  authMiddleware,
  roleMiddleware(['student']),
  controller.batchUpdateWrongQuestions,
);

// AI 生成任务
router.post(
  '/wrong-questions/ai-generation',
  authMiddleware,
  roleMiddleware(['student']),
  controller.createAiGenerationJob,
);

router.get(
  '/wrong-questions/ai-generation/:jobId',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getAiGenerationJob,
);

router.post(
  '/wrong-questions/ai-generation/:jobId/retry',
  authMiddleware,
  roleMiddleware(['student']),
  controller.retryAiGenerationJob,
);

router.post(
  '/wrong-questions/ai-generation/:jobId/cancel',
  authMiddleware,
  roleMiddleware(['student']),
  controller.cancelAiGenerationJob,
);

// 单条错题操作（注意：这些路由必须在 /wrong-questions/batch 等具体路由之后）
router.get(
  '/wrong-questions',
  authMiddleware,
  roleMiddleware(['student']),
  controller.queryWrongQuestions,
);

router.get(
  '/wrong-questions/:id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getWrongQuestionDetail,
);

router.patch(
  '/wrong-questions/:id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.updateWrongQuestion,
);

// 原有兼容端点
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

// 错题练习入口（原题/打乱重做）
router.post(
  '/wrong-questions/start-practice',
  authMiddleware,
  roleMiddleware(['student']),
  controller.startWrongQuestionPractice,
);

// 教师任务 attempt 入口（复用统一答题体系）
router.post(
  '/task-attempt',
  authMiddleware,
  roleMiddleware(['student']),
  controller.startTaskAttempt,
);

module.exports = router;
