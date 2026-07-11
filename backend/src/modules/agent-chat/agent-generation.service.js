const crypto = require('crypto');
const prisma = require('../../config/prisma');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { scopedOperationId } = require('../agent-marketplace/operation-id');
const { streamAgent } = require('./agent-runtime.service');
const memoryService = require('./agent-memory.service');
const registry = require('./generation-registry');
const { retrieve, FALLBACK_NOTICE, UNAVAILABLE_NOTICE } = require('./agent-chat.service');

const GENERATING = 'GENERATING';
const TERMINAL = ['COMPLETED', 'INTERRUPTED', 'CANCELLED', 'FAILED', 'SUPERSEDED'];

function chunkText(chunk) {
  if (typeof chunk?.content === 'string') return chunk.content;
  if (Array.isArray(chunk?.content)) return chunk.content.map(item => item?.text || '').join('');
  return '';
}

async function loadConversation(userId, conversationId) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({
    where: { id: Number(conversationId), userId, deletedAt: null },
    include: { agent: true, agentVersion: true, messages: { orderBy: { createdAt: 'asc' }, take: 40 } },
  });
  assert(conversation, '对话不存在或无权生成', 40301, 403);
  assert(conversation.agent.agentType === 'CHAT', 'FILE_GENERATOR 必须使用受控需求收集与文件生成流程', 40903, 409);
  return conversation;
}

async function prepareGeneration(userId, conversationId, input) {
  const conversation = await loadConversation(userId, conversationId);
  const assistantOperationId = scopedOperationId(userId, input.operationId, `generate-assistant-${conversation.id}`);
  const existing = await prisma.marketplaceAgentMessage.findUnique({ where: { operationId: assistantOperationId } });
  if (existing) {
    assert(existing.conversationId === conversation.id, 'operationId 已被其他操作使用', 40901, 409);
    assert(existing.generationStatus !== GENERATING, '同一会话已有回答正在生成', 40902, 409);
    return { conversation, assistant: existing, generationId: existing.generationId, existing: true };
  }
  const generationId = crypto.randomUUID();
  const occupied = await prisma.marketplaceAgentConversation.updateMany({
    where: { id: conversation.id, userId, deletedAt: null, activeGenerationId: null },
    data: { activeGenerationId: generationId },
  });
  assert(occupied.count === 1, '同一会话已有回答正在生成', 40902, 409);
  try {
    let question = String(input.content || '').trim();
    let userMessage = null;
    if (input.regenerate) {
      const latestUser = [...conversation.messages].reverse().find(item => item.role === 'USER');
      assert(latestUser, '没有可重新生成的用户问题');
      question = latestUser.content;
      await prisma.marketplaceAgentMessage.updateMany({
        where: { conversationId: conversation.id, role: 'ASSISTANT', generationStatus: 'COMPLETED', createdAt: { gt: latestUser.createdAt } },
        data: { generationStatus: 'SUPERSEDED' },
      });
      conversation.messages = conversation.messages.filter(item => !(item.role === 'ASSISTANT' && item.createdAt > latestUser.createdAt));
    } else {
      assert(question, '消息内容不能为空');
      const operationId = scopedOperationId(userId, input.operationId, `send-user-message-${conversation.id}`);
      userMessage = await prisma.marketplaceAgentMessage.upsert({
        where: { operationId }, update: {},
        create: { conversationId: conversation.id, role: 'USER', content: question, operationId, generationStatus: 'COMPLETED' },
      });
    }
    const assistant = await prisma.marketplaceAgentMessage.create({ data: {
      conversationId: conversation.id, role: 'ASSISTANT', content: '', generationId,
      generationStatus: GENERATING, operationId: assistantOperationId,
      metadataJson: { startedAt: new Date().toISOString() },
    } });
    return { conversation, assistant, generationId, question, userMessage };
  } catch (error) {
    await prisma.marketplaceAgentConversation.updateMany({ where: { id: conversation.id, activeGenerationId: generationId }, data: { activeGenerationId: null } });
    throw error;
  }
}

async function persistPartial(messageId, generationId, content, status = GENERATING, metadata = undefined) {
  await prisma.marketplaceAgentMessage.updateMany({
    where: { id: messageId, generationId, generationStatus: status === GENERATING ? GENERATING : { in: [GENERATING, 'CANCELLED'] } },
    data: { content, ...(status === GENERATING ? {} : { generationStatus: status }), ...(metadata === undefined ? {} : { metadataJson: metadata }) },
  });
}

async function finishGeneration(context, status, content, extra = {}) {
  await prisma.$transaction(async (tx) => {
    await tx.marketplaceAgentMessage.updateMany({
      where: { id: context.assistant.id, generationId: context.generationId, generationStatus: { in: [GENERATING, 'CANCELLED'] } },
      data: { content, generationStatus: status, answerSource: extra.answerSource || null,
        knowledgeFallbackUsed: Boolean(extra.knowledgeFallbackUsed), tokenUsageJson: extra.usage || null,
        metadataJson: { ...(extra.metadata || {}), finishedAt: new Date().toISOString() } },
    });
    if (status === 'COMPLETED' && extra.records?.length) await tx.agentMessageSource.createMany({ data: extra.records.map(item => ({
      messageId: context.assistant.id, knowledgeBaseId: item.knowledgeBaseId, documentId: item.documentId,
      documentName: item.documentName, segmentId: item.segmentId, pageNumber: item.pageNumber,
      quote: item.content.slice(0, 800), score: item.score,
    })) });
    await tx.marketplaceAgentConversation.updateMany({ where: { id: context.conversation.id, activeGenerationId: context.generationId }, data: {
      activeGenerationId: null, updatedAt: new Date(),
      ...(status === 'COMPLETED' && context.conversation.title === '新对话' ? { title: context.question.slice(0, 50) } : {}),
    } });
    if (status === 'COMPLETED') await tx.userAgent.update({ where: { id: context.conversation.agentId }, data: { usageCount: { increment: 1 } } });
  });
  if (status === 'COMPLETED') require('../agent-marketplace/agent-ranking.service').invalidateRankingCache();
}

async function streamGeneration(userId, conversationId, input, sink, options = {}) {
  const context = options.prepared || await prepareGeneration(userId, conversationId, input);
  if (context.existing) {
    sink.meta({ generationId: context.generationId, messageId: context.assistant.id, replayed: true });
    sink.done({ generationId: context.generationId, messageId: context.assistant.id, content: context.assistant.content, generationStatus: context.assistant.generationStatus, replayed: true });
    return { generationId: context.generationId, status: context.assistant.generationStatus };
  }
  const abortController = new AbortController();
  const unregister = registry.register(context.generationId, abortController);
  let content = '';
  let lastPersistedLength = 0;
  let lastPersistedAt = Date.now();
  let explicitStatus = null;
  let disconnected = false;
  const markDisconnected = () => { disconnected = true; abortController.abort(); };
  options.req?.once('aborted', markDisconnected);
  options.res?.once('close', () => { if (!options.res.writableEnded) markDisconnected(); });
  const cancellationWatch = setInterval(async () => {
    const row = await prisma.marketplaceAgentMessage.findUnique({ where: { id: context.assistant.id }, select: { generationStatus: true } }).catch(() => null);
    if (row?.generationStatus === 'CANCELLED') { explicitStatus = 'CANCELLED'; abortController.abort(); }
  }, 500);
  cancellationWatch.unref?.();
  try {
    sink.meta({ generationId: context.generationId, messageId: context.assistant.id, userMessage: context.userMessage });
    const retrieval = await retrieve(context.conversation.agentVersion, context.question);
    const memories = context.conversation.memoryEnabled ? await prisma.agentMemory.findMany({
      where: { userId, agentId: context.conversation.agentId, confirmed: true, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 20,
    }) : [];
    const stream = await (options.streamAgent || streamAgent)({
      version: context.conversation.agentVersion, history: context.conversation.messages,
      memories, question: context.question, records: retrieval.records,
    }, { signal: abortController.signal });
    for await (const chunk of stream) {
      if (abortController.signal.aborted) break;
      const delta = chunkText(chunk);
      if (!delta) continue;
      content += delta;
      sink.delta(delta);
      if (content.length - lastPersistedLength >= 1024 || Date.now() - lastPersistedAt >= 500) {
        await persistPartial(context.assistant.id, context.generationId, content);
        lastPersistedLength = content.length; lastPersistedAt = Date.now();
      }
    }
    if (abortController.signal.aborted) throw Object.assign(new Error('generation aborted'), { name: 'AbortError' });
    if (retrieval.fallback) content = `${retrieval.unavailable ? UNAVAILABLE_NOTICE : FALLBACK_NOTICE}\n\n${content}`;
    await finishGeneration(context, 'COMPLETED', content, {
      answerSource: retrieval.records.length ? 'KNOWLEDGE' : 'GENERAL', knowledgeFallbackUsed: retrieval.fallback,
      records: retrieval.records,
    });
    if (context.conversation.memoryEnabled && context.userMessage) await memoryService.rememberExplicitRequest(userId, context.conversation.agentId, context.userMessage.id, context.question);
    sink.done({ generationId: context.generationId, messageId: context.assistant.id, content, generationStatus: 'COMPLETED' });
    return { generationId: context.generationId, status: 'COMPLETED' };
  } catch (error) {
    const current = await prisma.marketplaceAgentMessage.findUnique({ where: { id: context.assistant.id }, select: { generationStatus: true } }).catch(() => null);
    const status = explicitStatus || (current?.generationStatus === 'CANCELLED' ? 'CANCELLED' : disconnected ? 'INTERRUPTED' : error.name === 'AbortError' ? 'INTERRUPTED' : 'FAILED');
    await finishGeneration(context, status, content, { metadata: status === 'FAILED' ? { errorCode: 'MODEL_GENERATION_FAILED' } : {} });
    if (!disconnected) sink.done({ generationId: context.generationId, messageId: context.assistant.id, content, generationStatus: status });
    return { generationId: context.generationId, status };
  } finally {
    clearInterval(cancellationWatch);
    unregister();
    options.req?.off('aborted', markDisconnected);
  }
}

async function cancelGeneration(userId, conversationId, generationId) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({ where: { id: Number(conversationId), userId, deletedAt: null } });
  assert(conversation, '对话不存在或无权取消', 40301, 403);
  const updated = await prisma.marketplaceAgentMessage.updateMany({
    where: { conversationId: conversation.id, generationId: String(generationId), generationStatus: GENERATING },
    data: { generationStatus: 'CANCELLED' },
  });
  assert(updated.count === 1, '该生成已结束或不存在', 40901, 409);
  await prisma.marketplaceAgentConversation.updateMany({
    where: { id: conversation.id, activeGenerationId: String(generationId) }, data: { activeGenerationId: null },
  });
  registry.cancel(generationId);
  return { generationId, generationStatus: 'CANCELLED' };
}

async function generateComplete(userId, conversationId, input, options = {}) {
  let completed = null;
  await streamGeneration(userId, conversationId, input, {
    meta: () => {}, delta: () => {}, done: payload => { completed = payload; },
  }, options);
  return { message: completed ? { id: completed.messageId, role: 'ASSISTANT', ...completed } : null };
}

async function recoverInterruptedGenerations() {
  const stale = await prisma.marketplaceAgentMessage.findMany({ where: { generationStatus: GENERATING }, select: { id: true, conversationId: true, generationId: true } });
  for (const message of stale) await prisma.$transaction([
    prisma.marketplaceAgentMessage.update({ where: { id: message.id }, data: { generationStatus: 'INTERRUPTED' } }),
    prisma.marketplaceAgentConversation.updateMany({ where: { id: message.conversationId, activeGenerationId: message.generationId }, data: { activeGenerationId: null } }),
  ]);
  return stale.length;
}

module.exports = { TERMINAL, chunkText, prepareGeneration, streamGeneration, generateComplete, cancelGeneration, recoverInterruptedGenerations };
