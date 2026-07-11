const prisma = require('../../config/prisma');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');

const SENSITIVE = /(密码|口令|api\s*key|密钥|身份证|银行卡|手机号|电话|邮箱|住址|token)/i;

function assertSafeMemory(content) {
  assert(!SENSITIVE.test(String(content || '')), '长期记忆不能保存密码、密钥、证件或联系方式等敏感内容');
}

async function ensureAgentAccess(userId, agentId) {
  const agent = await prisma.userAgent.findFirst({ where: { id: Number(agentId), deletedAt: null, OR: [{ creatorUserId: userId }, { status: 'PUBLIC' }] } });
  assert(agent, '智能体不存在或无权访问', 40301, 403);
  return agent;
}

async function listMemories(userId, agentId) {
  await ensureAgentAccess(userId, agentId);
  return prisma.agentMemory.findMany({ where: { userId, agentId: Number(agentId), deletedAt: null }, orderBy: { updatedAt: 'desc' } });
}

async function createMemory(userId, agentId, input) {
  await ensureAgentAccess(userId, agentId);
  assertSafeMemory(`${input.title} ${input.content}`);
  if (input.sourceMessageId) {
    const message = await prisma.marketplaceAgentMessage.findFirst({ where: { id: input.sourceMessageId, conversation: { userId, agentId: Number(agentId), deletedAt: null } } });
    assert(message, '来源消息不存在或无权访问', 40301, 403);
  }
  return prisma.agentMemory.create({ data: { userId, agentId: Number(agentId), type: input.type, title: input.title, content: input.content, sourceMessageId: input.sourceMessageId || null, confirmed: true } });
}

async function updateMemory(userId, agentId, memoryId, input) {
  const memory = await prisma.agentMemory.findFirst({ where: { id: Number(memoryId), userId, agentId: Number(agentId), deletedAt: null } });
  assert(memory, '记忆不存在或无权编辑', 40301, 403);
  assertSafeMemory(`${input.title} ${input.content}`);
  return prisma.agentMemory.update({ where: { id: memory.id }, data: { type: input.type, title: input.title, content: input.content } });
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

async function rememberExplicitRequest(userId, agentId, userMessageId, content) {
  if (!/(请记住|记住我的|帮我记住)/.test(content) || SENSITIVE.test(content)) return null;
  const cleaned = content.replace(/^(请|帮我)?记住(我的)?[：,:，\s]*/i, '').trim().slice(0, 1000);
  if (!cleaned) return null;
  return prisma.agentMemory.create({ data: { userId, agentId, type: 'USER_REQUEST', title: '用户主动保存', content: cleaned, sourceMessageId: userMessageId, confirmed: true } });
}

module.exports = { SENSITIVE, assertSafeMemory, listMemories, createMemory, updateMemory, deleteMemory, clearMemories, rememberExplicitRequest };
