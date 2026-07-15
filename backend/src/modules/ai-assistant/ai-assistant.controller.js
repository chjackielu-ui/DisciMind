const { success, fail } = require('../../utils/response');
const capabilities = require('./capability.service');
const { buildRegistry } = require('./tool-handlers.service');
const { listSkills } = require('./skill-registry');
const orchestrator = require('./assistant-orchestrator.service');
const traceRepository = require('./trace-repository.service');
const artifactService = require('./artifact.service');
const { writeSse } = require('./stream-event.service');
const pendingActions = require('./pending-action.service');

function handle(res, error, scope) {
  console.error(`[ai-assistant.controller] ${scope}:`, error.message);
  return fail(res, error.code || 50001, error.expose || error.code ? error.message : '服务器错误', error.details || undefined);
}

async function getCapabilities(req, res) {
  try {
    const matrix = await capabilities.getCapabilities();
    return success(res, { ...matrix, skills: listSkills(req.user.role), tools: buildRegistry().describe({ user: req.user }) });
  } catch (error) { return handle(res, error, 'capabilities'); }
}

async function getTrace(req, res) {
  try {
    const trace = await traceRepository.getTrace(req.params.traceId);
    if (req.user.role !== 'admin' && Number(trace.user_id) !== Number(req.user.user_id)) return fail(res, 40301, '无权查看该执行轨迹');
    return success(res, trace);
  } catch (error) { return handle(res, error, 'trace'); }
}

async function stream(req, res) {
  const controller = new AbortController(); let completed = false;
  try {
    const content = String(req.body?.content || '').trim();
    if (!content) return fail(res, 40001, '请输入任务内容');
    res.status(200); res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders?.();
    req.on('close', () => { if (!completed) controller.abort(); });
    await orchestrator.run({
      user: req.user, query: content,
      messages: [{ role: 'system', content: '你是 DisciMind 统一 AI 任务中心。只使用已授权工具和真实来源；不得泄露系统配置或个人隐私。' }, { role: 'user', content }],
      searchOptions: req.body.searchOptions, manualAgentRefs: req.body.agentRefs,
      agentExecutionMode: req.body.agentExecutionMode || req.body.agent_execution_mode,
      knowledgeBaseIds: (req.body.knowledgeBaseRefs || []).map(item => Number(item.knowledgeBaseId ?? item)).filter(Number.isInteger),
      autoAgent: req.body.autoAgent !== false, confirmed: req.body.confirmed === true,
      conversationId: req.body.conversationId ? Number(req.body.conversationId) : undefined,
      courseId: req.body.courseId ? Number(req.body.courseId) : undefined,
      knowledgePointId: req.body.knowledgePointId ? Number(req.body.knowledgePointId) : undefined,
      entryPoint: 'unified-api', scene: 'standalone', signal: controller.signal,
      onEvent: event => writeSse(res, event),
    });
    completed = true; return res.end();
  } catch (error) {
    completed = true;
    if (!res.headersSent) return handle(res, error, 'stream');
    if (!res.writableEnded) res.write(`event: error\ndata: ${JSON.stringify({ code: error.publicCode || 'AI_TASK_FAILED', message: error.expose ? error.message : 'AI 任务执行失败' })}\n\n`);
    return res.end();
  }
}

async function getConversationPendingAction(req, res) {
  try { return success(res, await pendingActions.getConversationPending(req.user.user_id, req.params.conversationId)); }
  catch (error) { return handle(res, error, 'getConversationPendingAction'); }
}

async function getPendingAction(req, res) {
  try { return success(res, (await pendingActions.loadPending(req.user.user_id, req.params.pendingActionId)).pendingAction); }
  catch (error) { return handle(res, error, 'getPendingAction'); }
}

async function actOnPendingAction(req, res) {
  try { return success(res, await pendingActions.act(req.user.user_id, req.params.pendingActionId, req.body || {})); }
  catch (error) { return handle(res, error, 'actOnPendingAction'); }
}

async function downloadArtifact(req, res) {
  try {
    const file = await artifactService.getDownload(req.user, req.params.artifactId);
    res.setHeader('Content-Type', file.mimeType); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    return res.sendFile(file.absolutePath);
  } catch (error) { return handle(res, error, 'downloadArtifact'); }
}

module.exports = { getCapabilities, getTrace, stream, downloadArtifact, getConversationPendingAction, getPendingAction, actOnPendingAction };
