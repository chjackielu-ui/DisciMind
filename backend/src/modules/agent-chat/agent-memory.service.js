const prisma = require('../../config/prisma');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');

const SENSITIVE = /(密码|口令|api\s*key|密钥|身份证|银行卡|手机号|电话|邮箱|住址|token)/i;
const MEMORY_TYPES = new Set(['USER_REQUEST', 'PREFERENCE', 'PROFILE', 'LEARNING_STYLE', 'GOAL', 'NOTE']);

function assertSafeMemory(content) {
  assert(!SENSITIVE.test(String(content || '')), '长期记忆不能保存密码、密钥、证件或联系方式等敏感内容');
}

async function ensureAgentAccess(userId, agentId) {
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), deletedAt: null, OR: [{ creatorUserId: userId }, { status: 'PUBLIC' }] } });
  assert(agent, '智能体不存在或无权访问', 40301, 403);
  return agent;
}

function serializeMemory(memory) {
  return {
    id: memory.id, agentId: memory.agentId, type: memory.type, title: memory.title, content: memory.content,
    enabled: memory.enabled, confirmed: memory.confirmed, sourceMessageId: memory.sourceMessageId,
    sourceConversation: memory.sourceMessage?.conversation ? {
      id: memory.sourceMessage.conversation.id, title: memory.sourceMessage.conversation.title,
    } : null,
    createdAt: memory.createdAt, updatedAt: memory.updatedAt, lastUsedAt: memory.lastUsedAt,
  };
}

async function listMemories(userId, agentId, query = {}) {
  await ensureAgentAccess(userId, agentId);
  const where = { userId, agentId: Number(agentId), deletedAt: null };
  if (query.enabled === 'true' || query.enabled === true) where.enabled = true;
  if (query.enabled === 'false' || query.enabled === false) where.enabled = false;
  const q = String(query.q || query.search || '').trim();
  if (q) where.OR = [{ title: { contains: q } }, { content: { contains: q } }];
  const records = await prisma.agentMemory.findMany({
    where, orderBy: { updatedAt: 'desc' },
    include: { sourceMessage: { include: { conversation: { select: { id: true, title: true } } } } },
  });
  return records.map(serializeMemory);
}

async function createMemory(userId, agentId, input) {
  await ensureAgentAccess(userId, agentId);
  assertSafeMemory(`${input.title} ${input.content}`);
  if (input.sourceMessageId) {
    const message = await prisma.marketplaceAgentMessage.findFirst({ where: { id: input.sourceMessageId, conversation: { userId, agentId: Number(agentId), deletedAt: null } } });
    assert(message, '来源消息不存在或无权访问', 40301, 403);
  }
  return serializeMemory(await prisma.agentMemory.create({ data: {
    userId, agentId: Number(agentId), type: input.type, title: input.title, content: input.content,
    sourceMessageId: input.sourceMessageId || null, confirmed: true, enabled: input.enabled !== false,
  }, include: { sourceMessage: { include: { conversation: { select: { id: true, title: true } } } } } }));
}

async function updateMemory(userId, agentId, memoryId, input) {
  const memory = await prisma.agentMemory.findFirst({ where: { id: Number(memoryId), userId, agentId: Number(agentId), deletedAt: null } });
  assert(memory, '记忆不存在或无权编辑', 40301, 403);
  assertSafeMemory(`${input.title || memory.title} ${input.content || memory.content}`);
  return serializeMemory(await prisma.agentMemory.update({ where: { id: memory.id }, data: {
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  }, include: { sourceMessage: { include: { conversation: { select: { id: true, title: true } } } } } }));
}

async function deleteMemory(userId, agentId, memoryId) {
  const result = await prisma.agentMemory.updateMany({ where: { id: Number(memoryId), userId, agentId: Number(agentId), deletedAt: null }, data: { deletedAt: new Date() } });
  assert(result.count > 0, '记忆不存在或无权删除', 40301, 403);
  return { deleted: true };
}

async function clearMemories(userId, agentId) {
  await ensureAgentAccess(userId, agentId);
  const result = await prisma.agentMemory.updateMany({ where: { userId, agentId: Number(agentId), deletedAt: null }, data: { deletedAt: new Date() } });
  return { deletedCount: result.count };
}

function detectMemoryCandidate(content) {
  if (!/(^|[。！？\n\s])(请记住|记住我的|帮我记住|记住)\s*[：,:，]?/i.test(String(content || '')) || SENSITIVE.test(content)) return null;
  const cleaned = String(content).replace(/^.*?(请|帮我)?记住(我的)?[：,:，\s]*/i, '').trim().slice(0, 1000);
  if (!cleaned) return null;
  return { type: 'USER_REQUEST', title: '用户主动保存', content: cleaned };
}

async function resolveMemoryCandidate(userId, agentId, messageId, action) {
  await ensureAgentAccess(userId, agentId);
  const message = await prisma.marketplaceAgentMessage.findFirst({
    where: { id: Number(messageId), conversation: { userId, agentId: Number(agentId), deletedAt: null } },
    select: { id: true },
  });
  assert(message, '来源消息不存在或无权访问', 40301, 403);
  const saved = await prisma.$transaction(async tx => {
    // Lock the source row so a double click or two open tabs cannot save one candidate twice.
    await tx.$queryRaw`SELECT id FROM agent_market_messages WHERE id = ${message.id} FOR UPDATE`;
    const locked = await tx.marketplaceAgentMessage.findUnique({ where: { id: message.id }, select: { metadataJson: true } });
    const metadata = locked?.metadataJson && typeof locked.metadataJson === 'object' && !Array.isArray(locked.metadataJson)
      ? { ...locked.metadataJson }
      : {};
    const candidate = metadata.memoryCandidate;
    assert(candidate && candidate.content, '该记忆候选已处理', 40901, 409);
    delete metadata.memoryCandidate;
    if (action === 'DISCARD') {
      await tx.marketplaceAgentMessage.update({ where: { id: message.id }, data: { metadataJson: metadata } });
      return null;
    }
    assertSafeMemory(`${candidate.title || ''} ${candidate.content}`);
    const memory = await tx.agentMemory.create({ data: {
      userId, agentId: Number(agentId), type: MEMORY_TYPES.has(candidate.type) ? candidate.type : 'USER_REQUEST',
      title: String(candidate.title || '用户主动保存').slice(0, 100),
      content: String(candidate.content).slice(0, 1000), sourceMessageId: message.id,
      confirmed: true, enabled: true,
    } });
    await tx.marketplaceAgentMessage.update({ where: { id: message.id }, data: { metadataJson: metadata } });
    return memory;
  });
  if (!saved) return { discarded: true, saved: false };
  return { saved: true, discarded: false, memory: serializeMemory(saved) };
}

async function markMemoriesUsed(ids) {
  if (!ids?.length) return;
  await prisma.agentMemory.updateMany({ where: { id: { in: ids }, enabled: true, confirmed: true, deletedAt: null }, data: { lastUsedAt: new Date() } });
}

// Backwards-compatible name: this now only returns a candidate and never writes it.
async function rememberExplicitRequest(_userId, _agentId, _userMessageId, content) {
  return detectMemoryCandidate(content);
}

module.exports = {
  SENSITIVE, assertSafeMemory, serializeMemory, listMemories, createMemory, updateMemory, deleteMemory,
  clearMemories, resolveMemoryCandidate, detectMemoryCandidate, markMemoriesUsed, rememberExplicitRequest,
};
