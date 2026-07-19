const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const roleMiddleware = require('../../middlewares/role.middleware');
const controller = require('./learning-workflow.controller');

const router = Router();

// ========== 学生端路由 (需要 STUDENT 角色) ==========
router.use(authMiddleware);
router.use(roleMiddleware(['student']));

// Templates
router.get('/templates', controller.listTemplates);
router.get('/templates/:id', controller.getTemplate);
router.post('/templates', controller.createTemplate);
router.put('/templates/:id', controller.updateTemplate);
router.delete('/templates/:id', controller.deleteTemplate);
router.post('/templates/batch-delete', controller.batchDeleteTemplates);
router.post('/templates/:id/copy', controller.copyTemplate);
router.get('/templates/:id/versions', controller.listVersions);
router.post('/templates/:id/restore', controller.restoreVersion);

// Teacher-specific (student can also publish if they're teacher)
router.post('/templates/:id/publish', controller.publishTemplate);
router.post('/templates/:id/set-default', controller.setDefaultTemplate);

// AI generation
router.post('/generate-draft', controller.generateDraft);
router.get('/generation/:jobId', controller.getGenerationStatus);

// Recommendation & quick start
router.get('/recommend', controller.recommendTemplate);
router.post('/quick-start', controller.quickStart);
router.post('/quick-start-check', controller.quickStartCheck);

// Sessions
router.post('/sessions', controller.createSession);
router.get('/sessions/:id', controller.getSession);
router.post('/sessions/:id/start', controller.startSession);
router.post('/sessions/:id/pause', controller.pauseSession);
router.post('/sessions/:id/resume', controller.startSession);
router.post('/sessions/:id/execute-current', controller.executeCurrentNode);
router.post('/sessions/:id/submit', controller.submitNodeAnswer);
router.post('/sessions/:id/skip', controller.skipNode);
router.post('/sessions/:id/retry', controller.retryNode);
router.post('/sessions/:id/insert-node', controller.insertNode);
router.post('/sessions/:id/apply-adjustment', controller.applyAdjustment);
router.post('/sessions/:id/reject-adjustment', controller.rejectAdjustment);
router.post('/sessions/:id/complete', controller.completeSession);
router.get('/sessions/:id/summary', controller.getSummary);
router.get('/sessions/:id/node/:nodeId/status', controller.getNodeStatus);

// Global assistant (SSE)
router.post('/sessions/:id/assistant/chat', controller.assistantChat);

// Learning guide (Bailian SSE)
router.post('/sessions/:id/guide/stream', controller.streamLearningGuide);

// Save node result (called by frontend after Dify completes)
router.post('/sessions/:id/complete-node', controller.completeNodeResult);

// Save guide data without overwriting formal agent result
router.post('/sessions/:id/save-guide', controller.saveGuideOnly);

// Multimodal file upload (for learning session images)
const multer = require('multer');
const path = require('path');
const imageTypes = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.bmp', 'image/bmp'],
]);

const SESSION_IMAGE_EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

const sessionFileUpload = multer({
<<<<<<< Updated upstream
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (imageTypes.get(extension) === String(file.mimetype || '').toLowerCase()) cb(null, true);
    else cb(new Error('图片扩展名与 MIME 类型不一致或不受支持'));
=======
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cb(null, `learning_${unique}${SESSION_IMAGE_EXTENSION_BY_MIME[file.mimetype] || '.png'}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (SESSION_IMAGE_EXTENSION_BY_MIME[file.mimetype]) cb(null, true);
    else cb(new Error(`不支持的文件类型: ${file.mimetype}`));
>>>>>>> Stashed changes
  },
});

router.get('/sessions/:id/files/:filename', controller.downloadSessionFile);

router.post('/sessions/:id/files',
  (req, res, next) => {
    sessionFileUpload.array('files', 3)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ code: 400, message: '文件超过 10MB 限制', data: null });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ code: 400, message: '最多上传 3 张图片', data: null });
        }
        return res.status(400).json({ code: 400, message: err.message, data: null });
      }
      next();
    });
  },
  controller.uploadSessionFiles,
);

module.exports = router;
