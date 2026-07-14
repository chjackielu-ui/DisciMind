const prisma = require('../../config/prisma');
const dify = require('../learning-agent/adapters/dify-knowledge.adapter');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { scopedOperationId } = require('../agent-marketplace/operation-id');
const { runAgent } = require('./agent-runtime.service');
const memoryService = require('./agent-memory.service');
const contextService = require('./agent-context.service');
const generationRegistry = require('./generation-registry');
const attachmentService = require('./agent-attachment.service');
const iconService = require('../agent-marketplace/agent-icon.service');

const FALLBACK_NOTICE = '当前知识库中未找到直接依据，以下内容由 AI 通用知识生成，仅供参考。';
const UNAVAILABLE_NOTICE = '知识库暂时不可用，本次回答由 AI 通用知识生成。';

async function resolveAgentVersion(userId, agentId) {
  const agent = await prisma.userAgent.findFirst({
    where: { id: Number(agentId), deletedAt: null },
    include: { currentDraftVersion: true, currentPublicVersion: true },
  });
  assert(agent, '智能体不存在', 40002, 404);
  const own = agent.creatorUserId === userId;
  assert(own || agent.status === 'PUBLIC', '无权使用该智能体', 40301, 403);
  const version = own ? (agent.currentDraftVersion || agent.currentPublicVersion) : agent.currentPublicVersion;
  assert(version, '智能体当前没有可用版本');
  return { agent, version };
}

function serializeConversation(conversation, detail = false) {
  const data = {
    id: conversation.id, agentId: conversation.agentId, agentVersionId: conversation.agentVersionId,
    title: conversation.title, memoryEnabled: conversation.memoryEnabled, activeGenerationId: conversation.activeGenerationId,
    difyConversationId: conversation.difyConversationId || null, mode: conversation.mode || 'AGENT', subject: conversation.subject || null,
    createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
  };
  if (detail) data.messages = (conversation.messages || []).map((message) => ({
    id: message.id, role: message.role, content: message.content, answerSource: message.answerSource,
    knowledgeFallbackUsed: message.knowledgeFallbackUsed, generationStatus: message.generationStatus,
    generationId: message.generationId, createdAt: message.createdAt,
    metadata: message.metadataJson || null,
    knowledgeBaseRefs: message.knowledgeBaseRefsJson || [], agentRefs: message.agentRefsJson || [],
    attachments: attachmentService.serializeAttachments(message),
    invocations: (message.invocations || []).map(item => ({
      id: item.id, agentId: item.agentId, agentName: item.agent?.currentDraftVersion?.name || item.agent?.currentPublicVersion?.name || '智能体',
      agent: item.agent ? {
        id: item.agent.id,
        agentType: item.agent.agentType,
        icon: iconService.resolveAgentIcon(item.agent, item.agent.currentDraftVersion || item.agent.currentPublicVersion),
      } : null,
      sequence: item.sequence, status: item.status, output: item.outputText, errorMessage: item.errorMessage,
      durationMs: item.durationMs, taskIds: item.taskIdsJson || [], artifactIds: item.artifactIdsJson || [],
      startedAt: item.startedAt, completedAt: item.completedAt,
    })),
    sources: (message.sources || []).map((source) => ({
      id: source.id, knowledgeBaseId: source.knowledgeBaseId, knowledgeBaseName: source.knowledgeBase?.name || '',
      documentId: source.documentId, documentName: source.documentName, segmentId: source.segmentId, pageNumber: source.pageNumber,
      quote: source.quote, score: source.score, externalUrl: source.externalUrl || null,
    })),
  }));
  if (detail) data.artifacts = (conversation.generatedArtifacts || []).map(item => ({
    id: item.id, taskId: item.taskId, artifactType: item.artifactType, title: item.title, status: item.status,
    fileFormat: item.fileFormat, fileSizeBytes: item.fileSizeBytes == null ? null : Number(item.fileSizeBytes),
    createdAt: item.createdAt, updatedAt: item.updatedAt,
  }));
  return data;
}

async function createConversation(userId, agentId, input) {
  const operationId = scopedOperationId(userId, input.operationId, `create-conversation-${agentId}`);
  const existing = await prisma.marketplaceAgentConversation.findUnique({ where: { operationId } });
  if (existing) return serializeConversation(existing);
  const { agent, version } = await resolveAgentVersion(userId, agentId);
  const conversation = await prisma.marketplaceAgentConversation.create({ data: {
    userId, agentId: agent.id, agentVersionId: version.id, title: input.title,
    memoryEnabled: input.memoryEnabled ?? version.memoryEnabledByDefault, operationId,
  } });
  return serializeConversation(conversation);
}

async function listConversations(userId, agentId) {
  await resolveAgentVersion(userId, agentId);
  const records = await prisma.marketplaceAgentConversation.findMany({ where: { userId, agentId: Number(agentId), deletedAt: null }, orderBy: { updatedAt: 'desc' } });
  return { list: records.map((item) => serializeConversation(item)) };
}

async function listUserConversations(userId, query = {}) {
  const where = { userId, deletedAt: null };
  if (query.agentType && query.agentType !== 'ALL') where.agent = { agentType: query.agentType };
  if (query.agentId) where.agentId = Number(query.agentId);
  if (query.mode) where.mode = String(query.mode).toUpperCase();
  if (query.subject) where.subject = String(query.subject).slice(0, 64);
  const q = String(query.q || query.search || '').trim();
  if (q) where.title = { contains: q };
  if (query.dateFrom || query.dateTo) where.updatedAt = {
    ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
    ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
  };
  const records = await prisma.marketplaceAgentConversation.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100 });
  return { list: records.map(item => serializeConversation(item)) };
}

async function getConversation(userId, conversationId) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({
    where: { id: Number(conversationId), userId, deletedAt: null },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, include: {
        sources: { include: { knowledgeBase: true } },
        invocations: { orderBy: { sequence: 'asc' }, include: { agent: { include: { currentDraftVersion: true, currentPublicVersion: true } } } },
      } },
      generatedArtifacts: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
    },
  });
  assert(conversation, '对话不存在或无权查看', 40301, 403);
  const data = serializeConversation(conversation, true);
  const artifactService = require('../file-generator/generated-artifact.service');
  data.artifacts = await Promise.all((conversation.generatedArtifacts || []).map(async item => {
    const detail = await artifactService.getArtifact({ user_id: userId, role: 'student' }, item.id);
    return {
      id: detail.id, taskId: detail.taskId, artifactType: detail.artifactType, artifactRole: detail.artifactRole,
      title: detail.title, status: detail.status, publicStatus: detail.publicStatus,
      downloadAvailable: Boolean(detail.downloadAvailable), exports: detail.exports,
      fileFormat: detail.fileFormat, fileSizeBytes: detail.fileSizeBytes,
      createdAt: detail.createdAt, updatedAt: detail.updatedAt,
    };
  }));
  return data;
}

async function updateConversation(userId, conversationId, input) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({ where: { id: Number(conversationId), userId, deletedAt: null } });
  assert(conversation, '对话不存在或无权编辑', 40301, 403);
  const updated = await prisma.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: input });
  return serializeConversation(updated);
}

async function quiesceActiveGenerations(records) {
  const activeIds = records.map(item => item.activeGenerationId).filter(Boolean);
  if (!activeIds.length) return;
  await prisma.marketplaceAgentMessage.updateMany({
    where: { generationId: { in: activeIds }, generationStatus: 'GENERATING' },
    data: { generationStatus: 'CANCELLED' },
  });
  activeIds.forEach(id => generationRegistry.cancel(id));
  const conversationIds = records.map(item => item.id);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const stillActive = await prisma.marketplaceAgentConversation.count({
      where: { id: { in: conversationIds }, activeGenerationId: { not: null } },
    });
    if (!stillActive) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(false, '对话正在停止生成，请稍后重试该操作', 40901, 409);
}

async function deleteConversation(userId, conversationId) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({
    where: { id: Number(conversationId), userId, deletedAt: null },
    include: {
      generatedArtifacts: { where: { deletedAt: null }, select: { id: true } },
      messages: { select: { attachmentsJson: true } },
    },
  });
  assert(conversation, '对话不存在或无权删除', 40301, 403);
  await quiesceActiveGenerations([conversation]);
  const result = await prisma.$transaction(async tx => {
    await tx.marketplaceAgentInvocation.deleteMany({ where: { conversationId: conversation.id } });
    const messages = await tx.marketplaceAgentMessage.deleteMany({ where: { conversationId: conversation.id } });
    await tx.asyncTask.updateMany({ where: { conversationId: conversation.id, userId }, data: { conversationId: null } });
    await tx.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: { deletedAt: new Date(), activeGenerationId: null } });
    return { deleted: true, deletedMessageCount: messages.count, preservedArtifactCount: conversation.generatedArtifacts.length };
  });
  await attachmentService.removeAttachments(conversation.messages.flatMap(item => Array.isArray(item.attachmentsJson) ? item.attachmentsJson : []));
  return result;
}

async function clearConversationMessages(userId, conversationId) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({ where: { id: Number(conversationId), userId, deletedAt: null } });
  assert(conversation, '对话不存在或无权清空', 40301, 403);
  await quiesceActiveGenerations([conversation]);
  const attachments = await prisma.marketplaceAgentMessage.findMany({ where: { conversationId: conversation.id }, select: { attachmentsJson: true } });
  const result = await prisma.$transaction(async tx => {
    await tx.marketplaceAgentInvocation.deleteMany({ where: { conversationId: conversation.id } });
    const deleted = await tx.marketplaceAgentMessage.deleteMany({ where: { conversationId: conversation.id } });
    await tx.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: { activeGenerationId: null, updatedAt: new Date() } });
    return deleted.count;
  });
  await attachmentService.removeAttachments(attachments.flatMap(item => Array.isArray(item.attachmentsJson) ? item.attachmentsJson : []));
  return { cleared: true, clearedMessageCount: result };
}

async function bulkManageConversations(userId, input) {
  const records = await prisma.marketplaceAgentConversation.findMany({
    where: { id: { in: input.conversationIds }, userId, deletedAt: null },
    include: {
      generatedArtifacts: { where: { deletedAt: null }, select: { id: true } },
      messages: { select: { attachmentsJson: true } },
    },
  });
  assert(records.length === input.conversationIds.length, '部分会话不存在或无权操作', 40301, 403);
  await quiesceActiveGenerations(records);
  const artifactIds = records.flatMap(item => item.generatedArtifacts.map(artifact => artifact.id));
  const attachments = records.flatMap(item => item.messages).flatMap(item => Array.isArray(item.attachmentsJson) ? item.attachmentsJson : []);
  if (input.action === 'DELETE' && input.deleteArtifacts) {
    const artifacts = require('../file-generator/generated-artifact.service');
    for (const artifactId of artifactIds) await artifacts.deleteArtifact({ user_id: userId, role: 'student' }, artifactId);
  }
  const result = await prisma.$transaction(async tx => {
    await tx.marketplaceAgentInvocation.deleteMany({ where: { conversationId: { in: input.conversationIds } } });
    if (input.action === 'CLEAR_MESSAGES') {
      const messages = await tx.marketplaceAgentMessage.deleteMany({ where: { conversationId: { in: input.conversationIds } } });
      await tx.marketplaceAgentConversation.updateMany({ where: { id: { in: input.conversationIds }, userId }, data: { activeGenerationId: null, updatedAt: new Date() } });
      return { affectedCount: records.length, clearedMessageCount: messages.count };
    }
    await tx.marketplaceAgentMessage.deleteMany({ where: { conversationId: { in: input.conversationIds } } });
    await tx.asyncTask.updateMany({ where: { conversationId: { in: input.conversationIds }, userId }, data: { conversationId: null } });
    const deleted = await tx.marketplaceAgentConversation.updateMany({
      where: { id: { in: input.conversationIds }, userId, deletedAt: null }, data: { deletedAt: new Date(), activeGenerationId: null },
    });
    return { affectedCount: deleted.count, preservedArtifactCount: input.deleteArtifacts ? 0 : artifactIds.length };
  });
  await attachmentService.removeAttachments(attachments);
  return { action: input.action, deleteArtifacts: input.deleteArtifacts, ...result };
}

function actualPageNumber(metadata) {
  const value = metadata?.page_number ?? metadata?.page ?? null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function retrieve(version, question, options = {}) {
  if (options.userId) return contextService.resolveRetrieval(options.userId, version, question, options.knowledgeBaseRefs || []);
  if (version.responseMode !== 'KNOWLEDGE_FIRST') return { records: [], fallback: false, unavailable: false };
  const bindings = await prisma.agentKnowledgeBase.findMany({
    where: { agentVersionId: version.id },
    include: { knowledgeBase: { include: { documents: { where: { deleted_at: null } } } } }, orderBy: { priority: 'asc' },
  });
  const usable = bindings.filter((item) => item.knowledgeBase.dify_dataset_id && !['DELETING', 'DELETED', 'DISABLED', 'OFFLINE'].includes(item.knowledgeBase.marketplace_status));
  if (!usable.length) return { records: [], fallback: true, unavailable: false };
  try {
    const result = await dify.retrieveFromMultipleDatasets(usable.map((item) => item.knowledgeBase.dify_dataset_id), question, { topK: version.topK, scoreThreshold: version.scoreThreshold, maxContextChars: 8000 });
    const byDataset = new Map(usable.map((item) => [item.knowledgeBase.dify_dataset_id, item.knowledgeBase]));
    const records = result.records.map((item) => {
      const kb = byDataset.get(item.datasetId);
      const doc = kb?.documents.find((record) => record.dify_document_id === item.documentId || record.original_filename === item.documentName);
      return {
        knowledgeBaseId: kb?.knowledge_base_id, knowledgeBaseName: kb?.name || '', documentId: doc?.document_id || null,
        documentName: item.documentName || doc?.original_filename || '未命名文档', segmentId: item.segmentId || null,
        pageNumber: actualPageNumber(item.metadata), content: String(item.content || '').slice(0, 1200), score: item.score,
      };
    }).filter((item) => item.knowledgeBaseId && item.content);
    return { records, fallback: records.length === 0, unavailable: false };
  } catch (error) {
    console.error('[AgentChat] knowledge retrieval degraded', { agentVersionId: version.id, error: error.message });
    return { records: [], fallback: true, unavailable: true };
  }
}

async function sendMessage(userId, conversationId, input) {
  const operationId = scopedOperationId(userId, input.operationId, `send-message-${conversationId}`);
  const previous = await prisma.marketplaceAgentMessage.findUnique({ where: { operationId }, include: { sources: { include: { knowledgeBase: true } } } });
  if (previous) return { message: {
    id: previous.id, role: previous.role, content: previous.content, answerSource: previous.answerSource,
    knowledgeFallbackUsed: previous.knowledgeFallbackUsed, sources: previous.sources.map((source) => ({ knowledgeBaseName: source.knowledgeBase.name, documentName: source.documentName, segmentId: source.segmentId, pageNumber: source.pageNumber, quote: source.quote })),
  } };
  const conversation = await prisma.marketplaceAgentConversation.findFirst({
    where: { id: Number(conversationId), userId, deletedAt: null },
    include: { agentVersion: true, messages: { orderBy: { createdAt: 'asc' }, take: 40 } },
  });
  assert(conversation, '对话不存在或无权发送消息', 40301, 403);
  const userOperationId = scopedOperationId(userId, input.operationId, `send-user-message-${conversationId}`);
  const userMessage = await prisma.marketplaceAgentMessage.upsert({
    where: { operationId: userOperationId },
    update: {},
    create: { conversationId: conversation.id, role: 'USER', content: input.content, operationId: userOperationId },
  });
  const resolvedAgentRefs = await contextService.resolveAgentRefs(userId, input.agentRefs || []);
  const retrieval = await retrieve(conversation.agentVersion, input.content, { userId, knowledgeBaseRefs: input.knowledgeBaseRefs || [] });
  const normalizedKnowledgeRefs = contextService.normalizedKnowledgeRefs(retrieval.knowledgeBases || []);
  const normalizedAgentRefs = contextService.normalizedAgentRefs(resolvedAgentRefs);
  const memoryCandidate = memoryService.detectMemoryCandidate(input.content);
  await prisma.marketplaceAgentMessage.update({ where: { id: userMessage.id }, data: {
    knowledgeBaseRefsJson: normalizedKnowledgeRefs, agentRefsJson: normalizedAgentRefs,
    metadataJson: memoryCandidate ? { memoryCandidate } : undefined,
  } });
  const memories = conversation.memoryEnabled
      ? await prisma.agentMemory.findMany({ where: { userId, agentId: conversation.agentId, confirmed: true, enabled: true, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 20 }) : [];
  let result;
  try {
    result = await runAgent({ version: conversation.agentVersion, history: conversation.messages, memories, question: input.content, records: retrieval.records });
  } catch (error) {
    const wrapped = new Error('智能体暂时无法回答，请稍后重试。');
    wrapped.code = 50002;
    wrapped.status = 502;
    throw wrapped;
  }
  let content = String(result.content || '').trim();
  if (retrieval.fallback) content = `${retrieval.unavailable ? UNAVAILABLE_NOTICE : FALLBACK_NOTICE}\n\n${content}`;
  const assistant = await prisma.$transaction(async (tx) => {
    const message = await tx.marketplaceAgentMessage.create({ data: {
      conversationId: conversation.id, role: 'ASSISTANT', content,
      answerSource: retrieval.records.length ? 'KNOWLEDGE' : 'GENERAL', knowledgeFallbackUsed: retrieval.fallback,
      tokenUsageJson: result.usage || null, operationId,
    } });
    if (retrieval.records.length) await tx.agentMessageSource.createMany({ data: retrieval.records.map((item) => ({
      messageId: message.id, knowledgeBaseId: item.knowledgeBaseId, documentId: item.documentId,
      documentName: item.documentName, segmentId: item.segmentId, pageNumber: item.pageNumber,
       quote: item.content.slice(0, 800), score: item.score, externalUrl: item.externalUrl || null,
    })) });
    await tx.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date(), title: conversation.title === '新对话' ? input.content.slice(0, 50) : conversation.title } });
    await tx.userAgent.update({ where: { id: conversation.agentId }, data: { usageCount: { increment: 1 } } });
    return message;
  });
  if (memories.length) await memoryService.markMemoriesUsed(memories.map(item => item.id));
  return {
    message: {
      id: assistant.id, role: assistant.role, content: assistant.content, answerSource: assistant.answerSource,
      knowledgeFallbackUsed: assistant.knowledgeFallbackUsed,
       sources: retrieval.records.map((item) => ({ knowledgeBaseId: item.knowledgeBaseId, knowledgeBaseName: item.knowledgeBaseName, documentId: item.documentId, documentName: item.documentName, segmentId: item.segmentId, pageNumber: item.pageNumber, quote: item.content.slice(0, 800), score: item.score, externalUrl: item.externalUrl })),
    },
  };
}

module.exports = {
  FALLBACK_NOTICE, UNAVAILABLE_NOTICE, resolveAgentVersion, createConversation, listConversations, listUserConversations,
  getConversation, updateConversation, deleteConversation, clearConversationMessages, bulkManageConversations,
  retrieve, sendMessage, actualPageNumber,
};
