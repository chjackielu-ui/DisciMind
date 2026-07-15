const { success, fail } = require('../utils/response');
const service = require('../services/teacher-ai.service');
const attachmentService = require('../services/ai-chat-attachment.service');
const questionService = require('../services/teacher-question.service');
const analyticsService = require('../services/teacher-analytics-workbench.service');
const { sseError } = require('../utils/public-error');

function handle(res, scope, error) {
  console.error(`[teacher-ai.controller] ${scope}:`, error.message);
  return fail(res, error.code || 50001, error.code ? error.message : '服务器错误');
}

function conversationId(req) {
  const id = Number(req.params.conversationId);
  if (!Number.isInteger(id) || id < 1) throw Object.assign(new Error('conversationId 参数不合法'), { code: 40001 });
  return id;
}

function writeSse(res, event, data) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function createConversation(req, res) { try { return success(res, await service.createConversation(req.user, req.body || {})); } catch (error) { return handle(res, 'createConversation', error); } }
async function getContextOptions(req, res) { try { return success(res, await service.getContextOptions(req.user)); } catch (error) { return handle(res, 'getContextOptions', error); } }
async function listConversations(req, res) { try { return success(res, await service.listConversations(req.user, req.query || {})); } catch (error) { return handle(res, 'listConversations', error); } }
async function getMessages(req, res) { try { return success(res, await service.getMessages(req.user, conversationId(req))); } catch (error) { return handle(res, 'getMessages', error); } }
async function sendMessage(req, res) { try { return success(res, await service.sendMessage(req.user, conversationId(req), req.body || {})); } catch (error) { return handle(res, 'sendMessage', error); } }
async function retrySave(req, res) { try { return success(res, await service.retrySave(req.user, conversationId(req), req.body || {})); } catch (error) { return handle(res, 'retrySave', error); } }
async function rename(req, res) { try { return success(res, await service.rename(req.user, conversationId(req), req.body?.title)); } catch (error) { return handle(res, 'rename', error); } }
async function clear(req, res) { try { return success(res, await service.clear(req.user, conversationId(req))); } catch (error) { return handle(res, 'clear', error); } }
async function remove(req, res) { try { return success(res, await service.remove(req.user, conversationId(req))); } catch (error) { return handle(res, 'remove', error); } }

async function streamMessage(req, res) {
  const abortController = new AbortController();
  let completed = false;
  try {
    const turn = await service.buildTurn(req.user, conversationId(req), req.body || {});
    req.on('close', () => { if (!completed) abortController.abort(); });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    writeSse(res, 'meta', { user_message: service.toMessage(turn.userMessage), context: turn.context, charts: turn.charts });
    const result = await service.completeTurn(
      turn,
      abortController.signal,
      (delta) => writeSse(res, 'delta', { content: delta }),
      (event) => writeSse(res, event.type, event),
    );
    completed = true;
    if (!result.persistence?.saved) writeSse(res, 'save_error', { ...result.persistence, requestId: req.id });
    writeSse(res, 'done', { assistant_message: service.toMessage({ ...result.assistantMessage, sourcesJson: result.sources }), charts: result.charts, artifacts: result.artifacts, trace_id: result.traceId, confirmation_required: result.confirmationRequired, context: turn.context, provider: result.provider, persistence: result.persistence });
    return res.end();
  } catch (error) {
    completed = true;
    if (!res.headersSent) return handle(res, 'streamMessage', error);
    writeSse(res, 'error', sseError(error, req, 'AI 生成暂时不可用，请稍后重试'));
    return res.end();
  }
}

async function uploadAttachment(req, res) { try { return success(res, await attachmentService.upload(req.user.user_id, req.file, req.body?.conversationId)); } catch (error) { return handle(res, 'uploadAttachment', error); } }
async function getAttachment(req, res) {
  try {
    const file = await service.getAttachment(req.user, conversationId(req), req.params.messageId, req.params.attachmentId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return res.sendFile(file.filePath);
  } catch (error) { return handle(res, 'getAttachment', error); }
}

async function generateQuestions(req, res) {
  try {
    const preview = await questionService.previewAiQuestions?.(req.user, req.body || {});
    if (!preview) throw Object.assign(new Error('请使用题库 AI 生成入口创建并审核题目'), { code: 40001 });
    return success(res, preview);
  } catch (error) { return handle(res, 'generateQuestions', error); }
}
async function generateSummary(req, res) { try { return success(res, await service.sendMessage(req.user, Number(req.body?.conversation_id), { ...req.body, content: req.body?.content || '请总结所附教学资料。' })); } catch (error) { return handle(res, 'generateSummary', error); } }
async function videoGeneration(req, res) { return fail(res, 40001, '当前文件生成链路暂不支持视频产物'); }
async function learningAnalysis(req, res) { try { return success(res, await analyticsService.buildWorkbench(req.user, req.body || {})); } catch (error) { return handle(res, 'learningAnalysis', error); } }

module.exports = { createConversation, getContextOptions, listConversations, getMessages, sendMessage, retrySave, streamMessage, rename, clear, remove, uploadAttachment, getAttachment, generateQuestions, generateSummary, videoGeneration, learningAnalysis };
