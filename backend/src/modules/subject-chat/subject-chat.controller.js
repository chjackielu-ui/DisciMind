const { success, fail } = require('../../utils/response');
const aiChatService = require('../../services/ai-chat.service');
const eventService = require('./subject-chat-event.service');
const runService = require('./subject-chat-run.service');
const orchestrator = require('./subject-chat-orchestrator.service');
const { isTerminalRunStatus } = require('./subject-chat-state-machine');
const { createPlan } = require('../ai-assistant/workflow-planner');
const prisma = require('../../config/prisma');
const agentContextService = require('../agent-chat/agent-context.service');

function handleError(res, error, scope) {
  console.error(`[subject-chat.controller] ${scope}:`, error.message);
  return fail(res, error.code || 50001, error.code ? error.message : '服务器错误', error.runId ? { runId: error.runId } : undefined);
}

function userId(req) {
  return Number(req.user?.user_id);
}

function conversationId(req) {
  const id = Number(req.body?.conversationId || req.params.conversationId);
  if (!Number.isInteger(id) || id < 1) throw Object.assign(new Error('conversationId 参数不合法'), { code: 40001 });
  return id;
}

function buildExecutionPlan(req, turn) {
  const question = orchestrator.extractQuestion(turn).trim();
  const knowledgeBaseIds = (turn.knowledgeBaseRefs || []).map(item => Number(item?.knowledgeBaseId ?? item)).filter(Number.isInteger);
  const plan = createPlan({
    query: question,
    role: req.user?.role || 'student',
    searchOptions: turn.searchOptions,
    manualAgentRefs: turn.resolvedAgentRefs || [],
    knowledgeBaseIds,
    attachments: turn.userMessage?.attachments || [],
  });
  turn.executionPlan = plan;
  turn.requestId = req.id || null;
  return plan;
}

async function enrichNaturalKnowledgeRefs(uid, req, turn) {
  if ((turn.knowledgeBaseRefs || []).length || (turn.resolvedKnowledgeBases || []).length) return turn;
  const question = orchestrator.extractQuestion(turn).trim();
  if (!agentContextService.mentionedKnowledgeTerms(question).length) return turn;
  const inferred = await agentContextService.inferKnowledgeBaseRefs(uid, question, {
    courseId: req.body?.courseId || req.body?.course_id || req.body?.learningContext?.courseId,
  });
  if (!inferred.length) return turn;
  const refs = agentContextService.normalizedKnowledgeRefs(inferred);
  turn.resolvedKnowledgeBases = inferred;
  turn.knowledgeBaseRefs = refs;
  const messageId = turn.userMessage?.id || (await prisma.aiMessage.findFirst({
    where: { conversationId: turn.conversation.id, role: 'USER' },
    orderBy: { id: 'desc' },
    select: { id: true },
  }))?.id;
  if (messageId) {
    await prisma.aiMessage.update({ where: { id: messageId }, data: { knowledgeBaseRefsJson: refs } });
    if (turn.userMessage) turn.userMessage.knowledgeBaseRefsJson = refs;
  }
  return turn;
}

async function createRun(req, res) {
  try {
    const uid = userId(req);
    const conversation = conversationId(req);
    await runService.assertNoActiveRun(uid, conversation);
    const turn = await aiChatService.prepareTurn(uid, conversation, req.body || {});
    await enrichNaturalKnowledgeRefs(uid, req, turn);
    const plan = buildExecutionPlan(req, turn);
    const run = await runService.createRun(uid, turn, plan);
    const response = {
      ...run,
      conversation: aiChatService.toApiConversation(turn.conversation),
      userMessage: turn.userMessage ? aiChatService.toApiMessage(turn.userMessage) : null,
    };
    success(res, response, '运行任务已创建');
    setImmediate(() => orchestrator.execute(run.runId, uid, turn).catch((error) => {
      console.error('[subject-chat] 未捕获的编排异常:', error.message);
    }));
  } catch (error) {
    handleError(res, error, 'createRun');
  }
}

async function getRun(req, res) {
  try {
    return success(res, await runService.getOwnedRun(userId(req), req.params.runId));
  } catch (error) {
    return handleError(res, error, 'getRun');
  }
}

async function getLatestRun(req, res) {
  try {
    return success(res, await runService.getLatestForConversation(userId(req), conversationId(req)));
  } catch (error) {
    return handleError(res, error, 'getLatestRun');
  }
}

async function getEvents(req, res) {
  try {
    await runService.getOwnedRun(userId(req), req.params.runId);
    const list = await eventService.list(req.params.runId, req.query.after || 0);
    return success(res, { list });
  } catch (error) {
    return handleError(res, error, 'getEvents');
  }
}

function writeSse(res, event) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`id: ${event.sequence}\n`);
  res.write(`event: ${event.eventType}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  return true;
}

async function streamRun(req, res) {
  let owned;
  try {
    owned = await runService.getOwnedRun(userId(req), req.params.runId);
  } catch (error) {
    return handleError(res, error, 'streamRun.authorize');
  }
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let lastSequence = Math.max(0, Number(req.query.after || req.get('Last-Event-ID')) || 0);
  let replaying = true;
  const buffered = [];
  const onEvent = (event) => {
    if (replaying) buffered.push(event);
    else if (event.sequence > lastSequence && writeSse(res, event)) {
      lastSequence = event.sequence;
      if (['run_completed', 'run_failed', 'run_cancelled', 'run_stalled'].includes(event.eventType)) {
        setImmediate(() => {
          cleanup();
          if (!res.writableEnded) res.end();
        });
      }
    }
  };
  const unsubscribe = eventService.subscribe(req.params.runId, onEvent);
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 4000);
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);

  try {
    const replay = await eventService.list(req.params.runId, lastSequence);
    for (const event of replay) {
      if (event.sequence > lastSequence && writeSse(res, event)) lastSequence = event.sequence;
    }
    replaying = false;
    for (const event of buffered.sort((a, b) => a.sequence - b.sequence)) {
      if (event.sequence > lastSequence && writeSse(res, event)) lastSequence = event.sequence;
    }
    owned = await runService.getOwnedRun(userId(req), req.params.runId);
    if (isTerminalRunStatus(owned.status)) {
      cleanup();
      res.end();
    }
  } catch (error) {
    cleanup();
    if (!res.writableEnded) res.end();
  }
}

async function cancelRun(req, res) {
  try {
    return success(res, await orchestrator.cancel(userId(req), req.params.runId), '运行任务已取消');
  } catch (error) {
    return handleError(res, error, 'cancelRun');
  }
}

async function retryTask(req, res) {
  try {
    const uid = userId(req);
    const owned = await runService.getOwnedRun(uid, req.params.runId);
    const turn = await aiChatService.prepareTurn(uid, owned.conversationId, { regenerate: true });
    await enrichNaturalKnowledgeRefs(uid, req, turn);
    const plan = buildExecutionPlan(req, turn);
    await runService.resetForRetry(uid, req.params.runId, req.params.taskId, { plan });
    const run = await runService.getOwnedRun(uid, req.params.runId);
    success(res, run, '已重新启动运行任务');
    setImmediate(() => orchestrator.execute(run.runId, uid, turn).catch((error) => {
      console.error('[subject-chat] 重试编排异常:', error.message);
    }));
  } catch (error) {
    handleError(res, error, 'retryTask');
  }
}

module.exports = { createRun, getRun, getLatestRun, getEvents, streamRun, cancelRun, retryTask, buildExecutionPlan, enrichNaturalKnowledgeRefs };
