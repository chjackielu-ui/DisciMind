// 学科答疑小助手路由
// 前缀：/api/ai-chat

const { Router } = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/ai-chat.controller');
const subjectChatRoutes = require('../modules/subject-chat/subject-chat.routes');

const router = Router();
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.AI_CHAT_ATTACHMENT_MAX_MB || 20) * 1024 * 1024, files: 1 } });

router.use(authMiddleware);
router.use(roleMiddleware(['student']));

// 学科专属助手运行工作台；复用本路由已有 JWT 与学生角色校验。
router.use('/subject-chat', subjectChatRoutes);

// Attachments are uploaded independently; messages only carry opaque attachment IDs.
router.post('/attachments', attachmentUpload.single('file'), controller.uploadAttachment);

// 创建新会话
router.post('/conversations', controller.createConversation);

// 事务化批量删除或清空消息
router.post('/conversations/bulk', controller.bulkManageConversations);

// 获取会话列表
router.get('/conversations', controller.listConversations);

// 获取当前模式下的建议提问
router.get('/starter-questions', controller.getStarterQuestions);

// 获取某个会话消息
router.get('/conversations/:conversationId/messages', controller.getMessages);

// 重命名会话
router.patch('/conversations/:conversationId', controller.renameConversation);

// 会话图片需要身份和归属校验，不通过静态目录公开。
router.get('/conversations/:conversationId/messages/:messageId/attachments/:attachmentId', controller.getAttachment);

// 普通非流式发送消息
router.post('/conversations/:conversationId/messages', controller.sendMessage);

// 流式发送消息
router.post('/conversations/:conversationId/stream', controller.streamMessage);

// 清空当前会话
router.delete('/conversations/:conversationId/messages', controller.clearMessages);

// 删除会话
router.delete('/conversations/:conversationId', controller.deleteConversation);

module.exports = router;
