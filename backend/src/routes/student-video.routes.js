// 学生端视频推荐路由
// 前缀：/api/student

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/student-video.controller');

const router = Router();

// 获取视频推荐
router.get(
  '/videos/recommendations',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getVideoRecommendations,
);

// 获取知识点视频
router.get(
  '/knowledge-points/:knowledge_point_id/videos',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getKnowledgePointVideos,
);

// 记录视频学习行为
router.post(
  '/videos/:video_id/watch-record',
  authMiddleware,
  roleMiddleware(['student']),
  controller.recordWatch,
);

module.exports = router;
