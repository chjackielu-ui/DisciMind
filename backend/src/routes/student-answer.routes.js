// 学生端在线答题路由
// 前缀：/api/student

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/student-answer.controller');

const router = Router();

// 开始答题
router.post(
  '/tasks/:task_id/start',
  authMiddleware,
  roleMiddleware(['student']),
  controller.startQuiz,
);

// 保存答案草稿
router.put(
  '/task-submissions/:submission_id/answers',
  authMiddleware,
  roleMiddleware(['student']),
  controller.saveAnswers,
);

// 提交答案并自动批改
router.post(
  '/tasks/:task_id/submit',
  authMiddleware,
  roleMiddleware(['student']),
  controller.submitTask,
);

// 查看提交详情
router.get(
  '/task-submissions/:submission_id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getSubmission,
);

// 查看题目解析
router.get(
  '/questions/:question_id/analysis',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getQuestionAnalysis,
);

module.exports = router;
