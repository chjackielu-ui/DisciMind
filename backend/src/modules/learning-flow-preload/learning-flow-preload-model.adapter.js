const { AsyncLocalStorage } = require('async_hooks');
const prisma = require('../../config/prisma');
const runtimeAdapter = require('./learning-flow-preload-runtime.adapter');

const storage = new AsyncLocalStorage();

function runWithSession(context, work) {
  return storage.run({ userId: Number(context.userId), sessionId: Number(context.sessionId) }, work);
}

async function cachedModelResponse(messages, options = {}) {
  const context = storage.getStore();
  if (!context || options.jsonMode !== true) return null;
  const joined = (messages || []).map((item) => String(item.content || '')).join('\n');
  if (!/Explainer Agent|讲解者|讲解请求/.test(joined)) return null;
  const session = await prisma.learningSession.findFirst({
    where: { session_id: context.sessionId, student_user_id: context.userId },
    select: { current_node_id: true },
  });
  if (!session?.current_node_id) return null;
  const preload = await prisma.learningFlowPreload.findFirst({
    where: { userId: context.userId, learningSessionId: context.sessionId, activeKey: { not: null }, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });
  const cached = await runtimeAdapter.cachedNode(preload, session.current_node_id);
  if (!cached || String(cached.nodeId) !== String(session.current_node_id) || !cached.content || typeof cached.content !== 'object') return null;
  return {
    content: JSON.stringify(cached.content),
    usage: { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 },
    timing: { totalMs: 0, firstTokenMs: 0 },
    preloadCacheHit: true,
  };
}

module.exports = { runWithSession, cachedModelResponse };
