// 学生端视频推荐路由
// 前缀：/api/student

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/student-video.controller');
const { MAX_VIDEO_BYTES } = require('../services/student-learning-media.service');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const videoUploadDir = path.resolve(__dirname, '../../storage/generated-artifacts/tmp-video-uploads');
fs.mkdirSync(videoUploadDir, { recursive: true });
const videoUpload = multer({
  dest: videoUploadDir,
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    if (file.mimetype !== 'video/mp4') return callback(Object.assign(new Error('仅支持MP4视频'), { code: 40001 }));
    return callback(null, true);
  },
});

const router = Router();

// B 站封面代理：供 <img> 直接访问，控制器会做图片域名白名单校验。
router.get(
  '/videos/cover-proxy',
  controller.proxyVideoCover,
);

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

// 搜索视频（按关键词检索，返回带 embed_url 的结果）
router.post(
  '/videos/search',
  authMiddleware,
  roleMiddleware(['student']),
  controller.searchVideos,
);

// 学生课程PPT与Remotion视频生成。复用现有PPT、TTS、任务和视频资源模型。
router.post('/courses/:course_id/ppt/generate', authMiddleware, roleMiddleware(['student']), controller.generateCoursePpt);
router.get('/ppt/tasks/:task_id', authMiddleware, roleMiddleware(['student']), controller.getCoursePptTask);
router.post('/videos/generation-tasks', authMiddleware, roleMiddleware(['student']), controller.createVideoGenerationTask);
router.get('/videos/generation-tasks/:task_id', authMiddleware, roleMiddleware(['student']), controller.getVideoGenerationTask);
router.get('/videos/generation-tasks/:task_id/audio/:page', authMiddleware, roleMiddleware(['student']), controller.getGeneratedSlideAudio);
router.post('/videos/generation-tasks/:task_id/complete', authMiddleware, roleMiddleware(['student']), videoUpload.single('video'), controller.completeVideoGeneration);
router.get('/videos/generated/:task_id/media', authMiddleware, roleMiddleware(['student']), controller.getGeneratedVideo);

// 单知识点五类学习资源包：讲义、PPT、知识卡片、试卷与浏览器端视频。
router.post('/courses/:course_id/knowledge-points/:knowledge_point_id/resource-packages', authMiddleware, roleMiddleware(['student']), controller.createKnowledgeResourcePackage);
router.get('/resource-packages/:task_id', authMiddleware, roleMiddleware(['student']), controller.getKnowledgeResourcePackage);
router.post('/resource-packages/:task_id/retry', authMiddleware, roleMiddleware(['student']), controller.retryKnowledgeResourcePackage);

module.exports = router;
