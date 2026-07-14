// 学科答疑小助手控制器

const { success, fail } = require('../utils/response');
const aiChatService = require('../services/ai-chat.service');
const attachmentService = require('../services/ai-chat-attachment.service');
const { sseError } = require('../utils/public-error');

function getUserId(req) {
  return req.user?.user_id;
}

function parseConversationId(req) {
  const conversationId = parseInt(req.params.conversationId, 10);
  if (Number.isNaN(conversationId) || conversationId < 1) {
    throw Object.assign(new Error('conversationId 参数不合法'), { code: 40001 });
  }
  return conversationId;
}

function handleError(res, err, scope) {
  console.error(`[ai-chat.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

function writeSse(res, event, data) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  return true;
}

async function createConversation(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await aiChatService.createConversation(userId, req.body);
    return success(res, data, '创建会话成功');
  } catch (err) {
    return handleError(res, err, 'createConversation');
  }
}

async function listConversations(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await aiChatService.listConversations(userId, req.query);
    return success(res, data, '获取会话列表成功');
  } catch (err) {
    return handleError(res, err, 'listConversations');
  }
}

async function getStarterQuestions(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const data = await aiChatService.generateStarterQuestions(userId, req.query);
    return success(res, data, '获取建议问题成功');
  } catch (err) {
    return handleError(res, err, 'getStarterQuestions');
  }
}

async function getMessages(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const conversationId = parseConversationId(req);
    const data = await aiChatService.getMessages(userId, conversationId);
    return success(res, data, '获取消息成功');
  } catch (err) {
    return handleError(res, err, 'getMessages');
  }
}

async function sendMessage(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const conversationId = parseConversationId(req);
    const data = await aiChatService.sendMessage(userId, conversationId, req.body);
    return success(res, data, '发送成功');
  } catch (err) {
    return handleError(res, err, 'sendMessage');
  }
}

async function streamMessage(req, res) {
  const userId = getUserId(req);
  if (!userId) return fail(res, 40101, '无法获取用户身份');

  let conversationId;
  let turn;
  try {
    conversationId = parseConversationId(req);
    aiChatService.getBailianConfig();
    turn = await aiChatService.prepareTurn(userId, conversationId, req.body);
  } catch (err) {
    return handleError(res, err, 'streamMessage.prepare');
  }

  const abortController = new AbortController();
  let clientClosed = false;
  let completed = false;
  let fullContent = '';
  let truncated = false;

  req.on('close', () => {
    if (!completed) {
      clientClosed = true;
      abortController.abort();
    }
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  writeSse(res, 'meta', {
    conversation: aiChatService.toApiConversation(turn.conversation),
    user_message: aiChatService.toApiMessage(turn.userMessage),
  });
  writeSse(res, 'status', { message: '正在思考中...' });

  try {
    const stream = await aiChatService.createCompletionStream(turn.messages, abortController.signal, turn);

    for await (const chunk of stream) {
      if (clientClosed) break;
      const choice = chunk.choices?.[0] || {};
      if (choice.finish_reason === 'length') truncated = true;
      const delta = choice.delta?.content || '';
      if (!delta) continue;
      fullContent += delta;
      writeSse(res, 'delta', { content: delta });
    }

    if (truncated && turn.assistantSurface === 'floating') {
      const notice = '\n\n> 回答较长，可进入完整对话继续查看。';
      fullContent += notice;
      writeSse(res, 'delta', { content: notice });
    }
    const result = await aiChatService.finalizeAssistantMessage(conversationId, fullContent);
    completed = true;

    if (!clientClosed) {
      writeSse(res, 'done', {
        assistant_message: result.assistantMessage,
        conversation: result.conversation,
        truncated,
      });
      res.end();
    }
  } catch (err) {
    if (abortController.signal.aborted || clientClosed) {
      completed = true;
      if (fullContent.trim()) {
        await aiChatService.finalizeAssistantMessage(conversationId, fullContent).catch((saveErr) => {
          console.error('[ai-chat.controller] 保存中断回复失败:', saveErr.message);
        });
      }
      return;
    }

    console.error('[ai-chat.controller] streamMessage 异常:', err.message);
    completed = true;
    writeSse(res, 'error', sseError(err, req, 'AI 生成失败，请稍后再试'));
    res.end();
  }
}

async function clearMessages(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const conversationId = parseConversationId(req);
    const data = await aiChatService.clearMessages(userId, conversationId);
    return success(res, data, '清空会话成功');
  } catch (err) {
    return handleError(res, err, 'clearMessages');
  }
}

async function deleteConversation(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const conversationId = parseConversationId(req);
    const data = await aiChatService.deleteConversation(userId, conversationId);
    return success(res, data, '删除会话成功');
  } catch (err) {
    return handleError(res, err, 'deleteConversation');
  }
}

async function uploadAttachment(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await attachmentService.upload(userId, req.file, req.body?.conversationId);
    return success(res, data, '附件上传成功');
  } catch (err) {
    return handleError(res, err, 'uploadAttachment');
  }
}

async function renameConversation(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await aiChatService.renameConversation(userId, parseConversationId(req), req.body?.title);
    return success(res, data, '会话已重命名');
  } catch (err) {
    return handleError(res, err, 'renameConversation');
  }
}

async function bulkManageConversations(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const data = await aiChatService.bulkManageConversations(userId, req.body || {});
    return success(res, data, '批量操作完成');
  } catch (err) {
    return handleError(res, err, 'bulkManageConversations');
  }
}

async function getAttachment(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');
    const conversationId = parseConversationId(req);
    const attachment = await aiChatService.getAttachment(
      userId,
      conversationId,
      req.params.messageId,
      req.params.attachmentId,
    );
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.name || 'image')}`);
    return res.sendFile(attachment.filePath);
  } catch (err) {
    return handleError(res, err, 'getAttachment');
  }
}

module.exports = {
  createConversation,
  listConversations,
  getStarterQuestions,
  getMessages,
  sendMessage,
  streamMessage,
  clearMessages,
  deleteConversation,
  renameConversation,
  bulkManageConversations,
  getAttachment,
  uploadAttachment,
};
