const { Router } = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-ai.controller');

const router = Router();
const teacherOnly = [authMiddleware, roleMiddleware(['teacher', 'admin'])];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.AI_CHAT_ATTACHMENT_MAX_MB || 20) * 1024 * 1024, files: 1 } });

router.post('/ai/attachments', ...teacherOnly, upload.single('file'), controller.uploadAttachment);
router.get('/ai/context-options', ...teacherOnly, controller.getContextOptions);
router.post('/ai/conversations', ...teacherOnly, controller.createConversation);
router.get('/ai/conversations', ...teacherOnly, controller.listConversations);
router.get('/ai/conversations/:conversationId/messages', ...teacherOnly, controller.getMessages);
router.post('/ai/conversations/:conversationId/messages', ...teacherOnly, controller.sendMessage);
router.post('/ai/conversations/:conversationId/messages/retry-save', ...teacherOnly, controller.retrySave);
router.post('/ai/conversations/:conversationId/stream', ...teacherOnly, controller.streamMessage);
router.patch('/ai/conversations/:conversationId', ...teacherOnly, controller.rename);
router.delete('/ai/conversations/:conversationId/messages', ...teacherOnly, controller.clear);
router.delete('/ai/conversations/:conversationId', ...teacherOnly, controller.remove);
router.get('/ai/conversations/:conversationId/messages/:messageId/attachments/:attachmentId', ...teacherOnly, controller.getAttachment);

router.post('/ai/generate-questions', ...teacherOnly, controller.generateQuestions);
router.post('/ai/generate-summary', ...teacherOnly, controller.generateSummary);
router.post('/ai/video-generation', ...teacherOnly, controller.videoGeneration);
router.post('/ai/learning-analysis', ...teacherOnly, controller.learningAnalysis);

module.exports = router;
