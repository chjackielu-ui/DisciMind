// 学生端 AI 问答控制器

const { success, fail } = require('../utils/response');
const studentChatService = require('../services/student-chat.service');

function getUserId(req) {
  return req.user?.user_id;
}

// ========================
// 1. 创建 AI 会话
// ========================

async function createConversation(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await studentChatService.createConversation(userId, req.body);
    return success(res, data, '创建会话成功');
  } catch (err) {
    console.error('[student-chat.controller] createConversation 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 2. 获取 AI 会话列表
// ========================

async function listConversations(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await studentChatService.listConversations(userId, req.query);
    return success(res, data, '获取会话列表成功');
  } catch (err) {
    console.error('[student-chat.controller] listConversations 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 3. 发送消息并获取 AI 回答
// ========================

async function sendMessage(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const conversationId = parseInt(req.params.conversation_id, 10);
    if (isNaN(conversationId) || conversationId < 1) {
      return fail(res, 40001, 'conversation_id 参数不合法');
    }

    const data = await studentChatService.sendMessage(userId, conversationId, req.body);
    return success(res, data, '发送成功');
  } catch (err) {
    console.error('[student-chat.controller] sendMessage 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 4. 获取会话消息
// ========================

async function getMessages(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const conversationId = parseInt(req.params.conversation_id, 10);
    if (isNaN(conversationId) || conversationId < 1) {
      return fail(res, 40001, 'conversation_id 参数不合法');
    }

    const data = await studentChatService.getMessages(userId, conversationId, req.query);
    return success(res, data, '获取消息成功');
  } catch (err) {
    console.error('[student-chat.controller] getMessages 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 5. 删除会话
// ========================

async function deleteConversation(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const conversationId = parseInt(req.params.conversation_id, 10);
    if (isNaN(conversationId) || conversationId < 1) {
      return fail(res, 40001, 'conversation_id 参数不合法');
    }

    const data = await studentChatService.deleteConversation(userId, conversationId);
    return success(res, data, '删除会话成功');
  } catch (err) {
    console.error('[student-chat.controller] deleteConversation 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

module.exports = {
  createConversation,
  listConversations,
  sendMessage,
  getMessages,
  deleteConversation,
};
