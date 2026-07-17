const crypto = require('crypto');
const prisma = require('../../config/prisma');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { scopedOperationId } = require('../agent-marketplace/operation-id');
const { streamAgent } = require('./agent-runtime.service');
const memoryService = require('./agent-memory.service');
const registry = require('./generation-registry');
const { retrieve, FALLBACK_NOTICE, UNAVAILABLE_NOTICE } = require('./agent-chat.service');
const contextService = require('./agent-context.service');
const attachmentService = require('./agent-attachment.service');

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
  let persistedAttachments = [];
  let attachmentsCommitted = false;
  const occupied = await prisma.marketplaceAgentConversation.updateMany({
    where: { id: conversation.id, userId, deletedAt: null, activeGenerationId: null },
    data: { activeGenerationId: generationId },
  });
  assert(occupied.count === 1, '同一会话已有回答正在生成', 40902, 409);
  try {
    let question = String(input.content || '').trim();
    let userMessage = null;
    let generationAttachments = [];
    if (input.regenerate) {
      const latestUser = [...conversation.messages].reverse().find(item => item.role === 'USER');
      assert(latestUser, '没有可重新生成的用户问题');
      question = latestUser.content;
      generationAttachments = latestUser.attachmentsJson || [];
      await prisma.marketplaceAgentMessage.updateMany({
        where: { conversationId: conversation.id, role: 'ASSISTANT', generationStatus: 'COMPLETED', createdAt: { gt: latestUser.createdAt } },
        data: { generationStatus: 'SUPERSEDED' },
      });
      conversation.messages = conversation.messages.filter(item => !(item.role === 'ASSISTANT' && item.createdAt > latestUser.createdAt));
      input = {
        ...input,
        knowledgeBaseRefs: latestUser.knowledgeBaseRefsJson || input.knowledgeBaseRefs || [],
        agentRefs: latestUser.agentRefsJson || input.agentRefs || [],
      };
    } else {
      assert(question || input.images?.length, '消息内容不能为空');
      const operationId = scopedOperationId(userId, input.operationId, `send-user-message-${conversation.id}`);
      const [knowledgeBases, agentRefs] = await Promise.all([
        contextService.resolveKnowledgeBaseRefs(userId, input.knowledgeBaseRefs || []),
        contextService.resolveAgentRefs(userId, input.agentRefs || []),
      ]);
      const memoryCandidate = memoryService.detectMemoryCandidate(question);
      persistedAttachments = await attachmentService.persistImages(input.images || []);
      userMessage = await prisma.marketplaceAgentMessage.upsert({
        where: { operationId }, update: {},
        create: {
          conversationId: conversation.id, role: 'USER', content: question, operationId, generationStatus: 'COMPLETED',
          knowledgeBaseRefsJson: contextService.normalizedKnowledgeRefs(knowledgeBases),
          agentRefsJson: contextService.normalizedAgentRefs(agentRefs),
          attachmentsJson: persistedAttachments.length ? persistedAttachments : null,
          metadataJson: memoryCandidate ? { memoryCandidate } : null,
        },
      });
      attachmentsCommitted = true;
      generationAttachments = userMessage.attachmentsJson || persistedAttachments;
    }
    const assistant = await prisma.marketplaceAgentMessage.create({ data: {
      conversationId: conversation.id, role: 'ASSISTANT', content: '', generationId,
      generationStatus: GENERATING, operationId: assistantOperationId,
      metadataJson: { startedAt: new Date().toISOString() },
    } });
    const [resolvedKnowledgeBases, resolvedAgentRefs] = await Promise.all([
      contextService.resolveKnowledgeBaseRefs(userId, input.knowledgeBaseRefs || []),
      contextService.resolveAgentRefs(userId, input.agentRefs || []),
    ]);
    return {
      conversation, assistant, generationId, question, userMessage,
      knowledgeBaseRefs: contextService.normalizedKnowledgeRefs(resolvedKnowledgeBases),
      resolvedAgentRefs,
      imageDataUrls: await attachmentService.attachmentDataUrls(generationAttachments),
    };
  } catch (error) {
    if (persistedAttachments.length && !attachmentsCommitted) await attachmentService.removeAttachments(persistedAttachments);
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
       quote: item.content.slice(0, 800), score: item.score, externalUrl: item.externalUrl || null,
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
    const retrieval = await retrieve(context.conversation.agentVersion, context.question, {
      userId, knowledgeBaseRefs: context.knowledgeBaseRefs || [],
    });
    sink.source?.({
      status: retrieval.unavailable ? 'UNAVAILABLE' : retrieval.records.length ? 'READY' : 'EMPTY',
      knowledgeBases: contextService.normalizedKnowledgeRefs(retrieval.knowledgeBases || []),
      sources: retrieval.records.map(item => ({
        knowledgeBaseId: item.knowledgeBaseId, knowledgeBaseName: item.knowledgeBaseName,
        documentId: item.documentId, documentName: item.documentName, segmentId: item.segmentId,
        pageNumber: item.pageNumber, quote: item.content.slice(0, 800), score: item.score, externalUrl: item.externalUrl || null,
      })),
    });
    const memories = context.conversation.memoryEnabled ? await prisma.agentMemory.findMany({
      where: { userId, agentId: context.conversation.agentId, confirmed: true, enabled: true, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 20,
    }) : [];
    if (retrieval.fallback) {
      const notice = `${retrieval.unavailable ? UNAVAILABLE_NOTICE : FALLBACK_NOTICE}\n\n`;
      content += notice;
      sink.delta(notice);
    }
    const referencedTargets = context.resolvedAgentRefs || [];
    const targets = referencedTargets.length ? referencedTargets : [{ agent: context.conversation.agent, version: context.conversation.agentVersion }];
    const invocationIds = [];
    let completedTargetCount = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const startedAt = new Date();
      const invocation = await prisma.marketplaceAgentInvocation.create({ data: {
        userId, conversationId: context.conversation.id, sourceMessageId: context.userMessage?.id || null,
        agentId: target.agent.id, sequence: index, status: 'RUNNING', startedAt,
        inputJson: { content: context.question, knowledgeBaseRefs: context.knowledgeBaseRefs || [] },
      } });
      invocationIds.push(invocation.id);
      const agentName = target.version.name || `智能体 ${target.agent.id}`;
      sink.run?.({ invocationId: invocation.id, agentId: target.agent.id, agentName, sequence: index, status: 'RUNNING' });
      let invocationOutput = '';
      const sectionPrefix = referencedTargets.length ? `${content ? '\n\n' : ''}### ${agentName}\n\n` : '';
      if (sectionPrefix) { content += sectionPrefix; sink.delta(sectionPrefix); }
      try {
        const stream = await (options.streamAgent || streamAgent)({
          version: target.version, history: context.conversation.messages,
          memories, question: context.question, records: retrieval.records,
          images: context.imageDataUrls || [],
          conversation: context.conversation, userId,
        }, { signal: abortController.signal, onMetadata: metadata => {
          if (!metadata?.conversationId || target.agent.id !== context.conversation.agentId) return;
          context.conversation.difyConversationId = metadata.conversationId;
          prisma.marketplaceAgentConversation.updateMany({
            where: { id: context.conversation.id, userId }, data: { difyConversationId: metadata.conversationId },
          }).catch(() => null);
        } });
        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          const delta = chunkText(chunk);
          if (!delta) continue;
          invocationOutput += delta;
          content += delta;
          sink.delta(delta);
          if (content.length - lastPersistedLength >= 1024 || Date.now() - lastPersistedAt >= 500) {
            await Promise.all([
              persistPartial(context.assistant.id, context.generationId, content),
              prisma.marketplaceAgentInvocation.update({ where: { id: invocation.id }, data: { outputText: invocationOutput } }),
            ]);
            lastPersistedLength = content.length; lastPersistedAt = Date.now();
          }
        }
        if (abortController.signal.aborted) throw Object.assign(new Error('generation aborted'), { name: 'AbortError' });
        const durationMs = Date.now() - startedAt.getTime();
        await prisma.marketplaceAgentInvocation.update({ where: { id: invocation.id }, data: {
          status: 'COMPLETED', outputText: invocationOutput, durationMs, completedAt: new Date(),
        } });
        sink.run?.({ invocationId: invocation.id, agentId: target.agent.id, agentName, sequence: index, status: 'COMPLETED', durationMs });
        completedTargetCount += 1;
      } catch (error) {
        const cancelled = abortController.signal.aborted || error.name === 'AbortError';
        const durationMs = Date.now() - startedAt.getTime();
        await prisma.marketplaceAgentInvocation.update({ where: { id: invocation.id }, data: {
          status: cancelled ? 'CANCELLED' : 'FAILED', outputText: invocationOutput,
          errorMessage: cancelled ? '生成已停止' : '智能体调用失败，请稍后重试。', durationMs, completedAt: new Date(),
        } });
        sink.run?.({ invocationId: invocation.id, agentId: target.agent.id, agentName, sequence: index, status: cancelled ? 'CANCELLED' : 'FAILED', durationMs, errorMessage: cancelled ? '生成已停止' : '智能体调用失败，请稍后重试。' });
        if (cancelled || !referencedTargets.length) throw error;
        const failureText = '\n\n> 该智能体调用失败，已继续执行后续智能体。';
        content += failureText; sink.delta(failureText);
      }
    }
    if (abortController.signal.aborted) throw Object.assign(new Error('generation aborted'), { name: 'AbortError' });
    if (!completedTargetCount && referencedTargets.length) throw Object.assign(new Error('all referenced agents failed'), { code: 'ALL_AGENT_INVOCATIONS_FAILED' });
    await finishGeneration(context, 'COMPLETED', content, {
      answerSource: retrieval.records.length ? 'KNOWLEDGE' : 'GENERAL', knowledgeFallbackUsed: retrieval.fallback,
      records: retrieval.records, metadata: { invocationIds },
    });
    if (memories.length) await memoryService.markMemoriesUsed(memories.map(item => item.id));
    sink.done({ generationId: context.generationId, messageId: context.assistant.id, content, generationStatus: 'COMPLETED', invocationIds });
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
