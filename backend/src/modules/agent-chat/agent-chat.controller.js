const { success } = require('../../utils/response');
const chat = require('./agent-chat.service');
const generations = require('./agent-generation.service');
const memories = require('./agent-memory.service');
const schemas = require('./agent-chat.schemas');
const attachments = require('./agent-attachment.service');

function handle(res, error) {
  return res.status(Number(error.status || (error.code === 40301 ? 403 : error.code === 40002 ? 404 : 400))).json({ code: Number(error.code || 50001), message: error.message || '服务器错误', data: null });
}
const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (error) { return handle(res, error); } };

const createConversation = wrap(async (req, res) => success(res, await chat.createConversation(req.user.user_id, req.params.id, schemas.parse(schemas.createConversationSchema, req.body)), '对话已创建'));
const listConversations = wrap(async (req, res) => success(res, await chat.listConversations(req.user.user_id, req.params.id)));
const listUserConversations = wrap(async (req, res) => success(res, await chat.listUserConversations(req.user.user_id, req.query)));
const getConversation = wrap(async (req, res) => success(res, await chat.getConversation(req.user.user_id, req.params.conversationId)));
const updateConversation = wrap(async (req, res) => success(res, await chat.updateConversation(req.user.user_id, req.params.conversationId, schemas.parse(schemas.updateConversationSchema, req.body)), '对话设置已保存'));
const deleteConversation = wrap(async (req, res) => success(res, await chat.deleteConversation(req.user.user_id, req.params.conversationId), '对话已删除'));
const clearConversationMessages = wrap(async (req, res) => success(res, await chat.clearConversationMessages(req.user.user_id, req.params.conversationId), '当前会话消息已清空'));
const bulkManageConversations = wrap(async (req, res) => success(res, await chat.bulkManageConversations(
  req.user.user_id, schemas.parse(schemas.bulkConversationSchema, req.body),
), '批量操作已完成'));
const sendMessage = wrap(async (req, res) => success(res, await generations.generateComplete(req.user.user_id, req.params.conversationId, schemas.parse(schemas.generationSchema, req.body))));
const generateMessage = sendMessage;

const getAttachment = wrap(async (req, res) => {
  const attachment = await attachments.getAttachment(
    req.user.user_id, req.params.conversationId, req.params.messageId, req.params.attachmentId,
  );
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.name || 'image')}`);
  return res.sendFile(attachment.filePath);
});

function writeSse(res, event, payload) {
  if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function streamMessage(req, res) {
  try {
    const input = schemas.parse(schemas.generationSchema, req.body);
    const prepared = await generations.prepareGeneration(req.user.user_id, req.params.conversationId, input);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    await generations.streamGeneration(req.user.user_id, req.params.conversationId, input, {
      meta: payload => writeSse(res, 'meta', payload),
      delta: delta => writeSse(res, 'delta', { delta }),
      run: payload => writeSse(res, 'run', payload),
      source: payload => writeSse(res, 'source', payload),
      done: payload => writeSse(res, 'done', payload),
    }, { req, res, prepared });
    if (!res.writableEnded && !res.destroyed) res.end();
  } catch (error) {
    if (res.headersSent) {
      writeSse(res, 'error', { code: Number(error.code || 50001), message: error.message || '生成失败' });
      if (!res.writableEnded && !res.destroyed) res.end();
      return;
    }
    return handle(res, error);
  }
}

const cancelGeneration = wrap(async (req, res) => success(res, await generations.cancelGeneration(
  req.user.user_id, req.params.conversationId, req.params.generationId,
), '生成已取消'));

const listMemories = wrap(async (req, res) => success(res, { list: await memories.listMemories(req.user.user_id, req.params.id, req.query) }));
const createMemory = wrap(async (req, res) => success(res, await memories.createMemory(req.user.user_id, req.params.id, schemas.parse(schemas.memorySchema, req.body)), '记忆已保存'));
const updateMemory = wrap(async (req, res) => success(res, await memories.updateMemory(req.user.user_id, req.params.id, req.params.memoryId, schemas.parse(schemas.memoryUpdateSchema, req.body)), '记忆已更新'));
const deleteMemory = wrap(async (req, res) => success(res, await memories.deleteMemory(req.user.user_id, req.params.id, req.params.memoryId), '记忆已删除'));
const clearMemories = wrap(async (req, res) => success(res, await memories.clearMemories(req.user.user_id, req.params.id), '记忆已清空'));
const resolveMemoryCandidate = wrap(async (req, res) => success(res, await memories.resolveMemoryCandidate(
  req.user.user_id, req.params.id, req.params.messageId,
  schemas.parse(schemas.memoryCandidateDecisionSchema, req.body).action,
), '记忆候选已处理'));

module.exports = { createConversation, listConversations, listUserConversations, getConversation, updateConversation, deleteConversation, clearConversationMessages, bulkManageConversations,
  sendMessage, generateMessage, getAttachment, streamMessage, cancelGeneration,
  listMemories, createMemory, updateMemory, deleteMemory, clearMemories, resolveMemoryCandidate, handle };
