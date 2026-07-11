// 学科答疑小助手路由
// 前缀：/api/ai-chat

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/ai-chat.controller');

const router = Router();

router.use(authMiddleware);
router.use(roleMiddleware(['student']));

// 创建新会话
router.post('/conversations', controller.createConversation);

// 获取会话列表
router.get('/conversations', controller.listConversations);

// 获取当前模式下的建议提问
router.get('/starter-questions', controller.getStarterQuestions);

// 获取某个会话消息
router.get('/conversations/:conversationId/messages', controller.getMessages);

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
