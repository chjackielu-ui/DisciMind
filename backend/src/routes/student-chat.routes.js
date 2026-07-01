// 学生端 AI 问答路由
// 前缀：/api/student/chat

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/student-chat.controller');

const router = Router();

// 创建会话
router.post(
  '/chat/conversations',
  authMiddleware,
  roleMiddleware(['student']),
  controller.createConversation,
);

// 获取会话列表
router.get(
  '/chat/conversations',
  authMiddleware,
  roleMiddleware(['student']),
  controller.listConversations,
);

// 发送消息
router.post(
  '/chat/conversations/:conversation_id/messages',
  authMiddleware,
  roleMiddleware(['student']),
  controller.sendMessage,
);

// 获取会话消息
router.get(
  '/chat/conversations/:conversation_id/messages',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getMessages,
);

// 删除会话
router.delete(
  '/chat/conversations/:conversation_id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.deleteConversation,
);

module.exports = router;
