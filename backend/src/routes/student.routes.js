// 学生端路由
// 所有接口统一前缀：/api/student
// 需要登录（authMiddleware）+ 学生角色（roleMiddleware(['student'])）

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const studentController = require('../controllers/student.controller');

const router = Router();

// 所有学生端接口都需要登录且角色为学生
// 中间件在每条路由上单独挂载，保持清晰

// ========== Dashboard ==========
router.get(
  '/dashboard',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getDashboard,
);

// ========== 课程相关 ==========

// 课程列表
router.get(
  '/courses',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getCourses,
);

// 课程详情
router.get(
  '/courses/:course_id',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getCourseDetail,
);

// 课程章节列表
router.get(
  '/courses/:course_id/chapters',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getCourseChapters,
);

// 课程知识点列表
router.get(
  '/courses/:course_id/knowledge-points',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getCourseKnowledgePoints,
);

// 课程知识点掌握分布
router.get(
  '/courses/:course_id/mastery-distribution',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getCourseMasteryDistribution,
);

// 课程能力画像
router.get(
  '/courses/:course_id/ability-profile',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getCourseAbilityProfile,
);

// ========== 知识点 ==========

// 单个知识点详情
router.get(
  '/knowledge-points/:knowledge_point_id',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getKnowledgePointDetail,
);

// ========== 学习任务 ==========

// 任务列表
router.get(
  '/tasks',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getTasks,
);

// 任务详情
router.get(
  '/tasks/:task_id',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getTaskDetail,
);

// ========== 错题本 ==========

// 错题本列表
router.get(
  '/wrong-questions',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getWrongQuestions,
);

// 更新错题状态
router.patch(
  '/wrong-questions/:wrong_question_id/status',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.updateWrongQuestionStatus,
);

// ========== 推荐内容 ==========

// 推荐列表
router.get(
  '/recommendations',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getRecommendations,
);

// ========== 学习记录 ==========

// 学习记录列表
router.get(
  '/study-records',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getStudyRecords,
);

// 新增学习记录
router.post(
  '/study-records',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.createStudyRecord,
);

// ========== 学生画像 ==========

// 学生画像
router.get(
  '/portrait',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getPortrait,
);

module.exports = router;
