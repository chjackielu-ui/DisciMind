const prisma = require('../../config/prisma');
const dify = require('../learning-agent/adapters/dify-knowledge.adapter');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');
const { scopedOperationId } = require('../agent-marketplace/operation-id');
const { runAgent } = require('./agent-runtime.service');
const memoryService = require('./agent-memory.service');

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
    createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
  };
  if (detail) data.messages = (conversation.messages || []).map((message) => ({
    id: message.id, role: message.role, content: message.content, answerSource: message.answerSource,
    knowledgeFallbackUsed: message.knowledgeFallbackUsed, generationStatus: message.generationStatus,
    generationId: message.generationId, createdAt: message.createdAt,
    sources: (message.sources || []).map((source) => ({
      id: source.id, knowledgeBaseId: source.knowledgeBaseId, knowledgeBaseName: source.knowledgeBase?.name || '',
      documentName: source.documentName, segmentId: source.segmentId, pageNumber: source.pageNumber, quote: source.quote,
    })),
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
  assert(!query.agentType || query.agentType === 'CHAT', '当前仅支持 CHAT 会话');
  const where = { userId, deletedAt: null, agent: { agentType: 'CHAT' } };
  if (query.agentId) where.agentId = Number(query.agentId);
  const records = await prisma.marketplaceAgentConversation.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100 });
  return { list: records.map(item => serializeConversation(item)) };
}

async function getConversation(userId, conversationId) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({
    where: { id: Number(conversationId), userId, deletedAt: null },
    include: { messages: { orderBy: { createdAt: 'asc' }, include: { sources: { include: { knowledgeBase: true } } } } },
  });
  assert(conversation, '对话不存在或无权查看', 40301, 403);
  return serializeConversation(conversation, true);
}

async function updateConversation(userId, conversationId, input) {
  const conversation = await prisma.marketplaceAgentConversation.findFirst({ where: { id: Number(conversationId), userId, deletedAt: null } });
  assert(conversation, '对话不存在或无权编辑', 40301, 403);
  const updated = await prisma.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: input });
  return serializeConversation(updated);
}

async function deleteConversation(userId, conversationId) {
  const result = await prisma.marketplaceAgentConversation.updateMany({ where: { id: Number(conversationId), userId, deletedAt: null }, data: { deletedAt: new Date() } });
  assert(result.count > 0, '对话不存在或无权删除', 40301, 403);
  return { deleted: true };
}

function actualPageNumber(metadata) {
  const value = metadata?.page_number ?? metadata?.page ?? null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function retrieve(version, question) {
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
  const retrieval = await retrieve(conversation.agentVersion, input.content);
  const memories = conversation.memoryEnabled
    ? await prisma.agentMemory.findMany({ where: { userId, agentId: conversation.agentId, confirmed: true, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 20 }) : [];
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
      quote: item.content.slice(0, 800), score: item.score,
    })) });
    await tx.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date(), title: conversation.title === '新对话' ? input.content.slice(0, 50) : conversation.title } });
    await tx.userAgent.update({ where: { id: conversation.agentId }, data: { usageCount: { increment: 1 } } });
    return message;
  });
  if (conversation.memoryEnabled) await memoryService.rememberExplicitRequest(userId, conversation.agentId, userMessage.id, input.content);
  return {
    message: {
      id: assistant.id, role: assistant.role, content: assistant.content, answerSource: assistant.answerSource,
      knowledgeFallbackUsed: assistant.knowledgeFallbackUsed,
      sources: retrieval.records.map((item) => ({ knowledgeBaseId: item.knowledgeBaseId, knowledgeBaseName: item.knowledgeBaseName, documentName: item.documentName, segmentId: item.segmentId, pageNumber: item.pageNumber, quote: item.content.slice(0, 800) })),
    },
  };
}

module.exports = { FALLBACK_NOTICE, UNAVAILABLE_NOTICE, resolveAgentVersion, createConversation, listConversations, listUserConversations, getConversation, updateConversation, deleteConversation, retrieve, sendMessage, actualPageNumber };
