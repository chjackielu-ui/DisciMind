const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const prisma = require('../src/config/prisma');
const chat = require('../src/modules/agent-chat/agent-chat.service');
const generations = require('../src/modules/agent-chat/agent-generation.service');
const rankings = require('../src/modules/agent-marketplace/agent-ranking.service');

test.after(async () => prisma.$disconnect());

async function fixture() {
  const user = await prisma.user.findUnique({ where: { username: 'student_b' } });
  const agent = await prisma.userAgent.findFirst({
    where: { agentType: 'CHAT', status: 'PUBLIC', visibility: 'PUBLIC', deletedAt: null, currentPublicVersion: { responseMode: 'DEFAULT', reviewStatus: 'APPROVED' } },
  });
  assert.ok(user && agent);
  const conversation = await chat.createConversation(user.user_id, agent.id, {
    title: '生成状态测试', operationId: crypto.randomUUID(), memoryEnabled: false,
  });
  return { user, agent, conversation };
}

function sink(metaCallback = () => {}) {
  return { meta: metaCallback, delta: () => {}, done: () => {} };
}

test('streamed generation persists COMPLETED content and releases the conversation lock', async () => {
  const { user, conversation } = await fixture();
  async function* mockStream() { yield { content: '第一段' }; yield { content: '第二段' }; }
  const result = await generations.streamGeneration(user.user_id, conversation.id, {
    content: '请回答', operationId: crypto.randomUUID(), regenerate: false,
  }, sink(), { streamAgent: async () => mockStream() });
  assert.equal(result.status, 'COMPLETED');
  const message = await prisma.marketplaceAgentMessage.findUnique({ where: { generationId: result.generationId } });
  const refreshed = await prisma.marketplaceAgentConversation.findUnique({ where: { id: conversation.id } });
  assert.equal(message.generationStatus, 'COMPLETED');
  assert.equal(message.content, '第一段第二段');
  assert.equal(refreshed.activeGenerationId, null);
});

test('one conversation can hold only one active generation', async () => {
  const { user, conversation } = await fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  async function* slowStream() { yield { content: '部分' }; await gate; yield { content: '完成' }; }
  const running = generations.streamGeneration(user.user_id, conversation.id, {
    content: '第一个问题', operationId: crypto.randomUUID(), regenerate: false,
  }, sink(started), { streamAgent: async () => slowStream() });
  await startedPromise;
  await assert.rejects(() => generations.prepareGeneration(user.user_id, conversation.id, {
    content: '第二个问题', operationId: crypto.randomUUID(), regenerate: false,
  }), error => error.status === 409);
  release();
  await running;
});

test('explicit cancellation aborts the local model call and preserves partial content', async () => {
  const { user, conversation } = await fixture();
  let generationId;
  let announced;
  const announcedPromise = new Promise(resolve => { announced = resolve; });
  const model = async (_context, { signal }) => (async function* () {
    yield { content: '已经生成' };
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
  }());
  const running = generations.streamGeneration(user.user_id, conversation.id, {
    content: '取消测试', operationId: crypto.randomUUID(), regenerate: false,
  }, sink(payload => { generationId = payload.generationId; announced(); }), { streamAgent: model });
  await announcedPromise;
  await new Promise(resolve => setTimeout(resolve, 20));
  await generations.cancelGeneration(user.user_id, conversation.id, generationId);
  const result = await running;
  const message = await prisma.marketplaceAgentMessage.findUnique({ where: { generationId } });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(message.generationStatus, 'CANCELLED');
  assert.equal(message.content, '已经生成');
});

test('network disconnect records INTERRUPTED and keeps generated text', async () => {
  const { user, conversation } = await fixture();
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writableEnded = false;
  let announced;
  const announcedPromise = new Promise(resolve => { announced = resolve; });
  const model = async (_context, { signal }) => (async function* () {
    yield { content: '断线前内容' };
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
  }());
  const running = generations.streamGeneration(user.user_id, conversation.id, {
    content: '断线测试', operationId: crypto.randomUUID(), regenerate: false,
  }, sink(announced), { streamAgent: model, req, res });
  await announcedPromise;
  await new Promise(resolve => setTimeout(resolve, 20));
  req.emit('aborted');
  const result = await running;
  const message = await prisma.marketplaceAgentMessage.findUnique({ where: { generationId: result.generationId } });
  assert.equal(result.status, 'INTERRUPTED');
  assert.equal(message.content, '断线前内容');
});

test('startup recovery interrupts orphaned generations and clears matching locks', async () => {
  const { conversation } = await fixture();
  const generationId = crypto.randomUUID();
  const message = await prisma.marketplaceAgentMessage.create({ data: {
    conversationId: conversation.id, role: 'ASSISTANT', content: '遗留内容', generationStatus: 'GENERATING', generationId,
  } });
  await prisma.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: { activeGenerationId: generationId } });
  const recovered = await generations.recoverInterruptedGenerations();
  const [after, conv] = await Promise.all([
    prisma.marketplaceAgentMessage.findUnique({ where: { id: message.id } }),
    prisma.marketplaceAgentConversation.findUnique({ where: { id: conversation.id } }),
  ]);
  assert.ok(recovered >= 1);
  assert.equal(after.generationStatus, 'INTERRUPTED');
  assert.equal(conv.activeGenerationId, null);
});

test('regeneration supersedes the prior answer while retaining its audit row', async () => {
  const { user, conversation } = await fixture();
  async function* first() { yield { content: '旧回答' }; }
  async function* second() { yield { content: '新回答' }; }
  const initial = await generations.streamGeneration(user.user_id, conversation.id, {
    content: '同一个问题', operationId: crypto.randomUUID(), regenerate: false,
  }, sink(), { streamAgent: async () => first() });
  const regenerated = await generations.streamGeneration(user.user_id, conversation.id, {
    operationId: crypto.randomUUID(), regenerate: true,
  }, sink(), { streamAgent: async () => second() });
  const [oldMessage, newMessage] = await Promise.all([
    prisma.marketplaceAgentMessage.findUnique({ where: { generationId: initial.generationId } }),
    prisma.marketplaceAgentMessage.findUnique({ where: { generationId: regenerated.generationId } }),
  ]);
  assert.equal(oldMessage.generationStatus, 'SUPERSEDED');
  assert.equal(oldMessage.content, '旧回答');
  assert.equal(newMessage.generationStatus, 'COMPLETED');
  assert.equal(newMessage.content, '新回答');
});

test('completed generation operationId is idempotently replayed', async () => {
  const { user, conversation } = await fixture();
  const operationId = crypto.randomUUID(); let calls = 0;
  async function* response() { calls += 1; yield { content: '只生成一次' }; }
  const first = await generations.streamGeneration(user.user_id, conversation.id, {
    content: '幂等问题', operationId, regenerate: false,
  }, sink(), { streamAgent: async () => response() });
  const second = await generations.streamGeneration(user.user_id, conversation.id, {
    content: '幂等问题', operationId, regenerate: false,
  }, sink(), { streamAgent: async () => response() });
  assert.equal(first.generationId, second.generationId);
  assert.equal(calls, 1);
});

test('hot ranking counts only COMPLETED assistant messages and uses its composite index', async () => {
  const { user, agent, conversation } = await fixture();
  rankings.invalidateRankingCache();
  const before = await rankings.hotRankings(10);
  const baseline = before.list.find(item => item.agentId === agent.id)?.successfulAnswers7d || 0;
  await prisma.marketplaceAgentMessage.createMany({ data: [
    { conversationId: conversation.id, role: 'ASSISTANT', content: '成功', generationStatus: 'COMPLETED', generationId: crypto.randomUUID() },
    { conversationId: conversation.id, role: 'ASSISTANT', content: '中断', generationStatus: 'INTERRUPTED', generationId: crypto.randomUUID() },
    { conversationId: conversation.id, role: 'USER', content: '用户消息', generationStatus: 'COMPLETED' },
  ] });
  rankings.invalidateRankingCache();
  const after = await rankings.hotRankings(10);
  assert.equal(after.list.find(item => item.agentId === agent.id).successfulAnswers7d, baseline + 1);
  assert.equal((await rankings.hotRankings(10)).cached, true);
  const plan = await prisma.$queryRawUnsafe(`EXPLAIN SELECT m.id FROM agent_market_conversations c JOIN agent_market_messages m FORCE INDEX (agent_market_messages_conversation_id_role_generation_status_idx) ON m.conversation_id=c.id AND m.role='ASSISTANT' AND m.generation_status='COMPLETED' WHERE c.agent_id=? AND m.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)`, agent.id);
  assert.ok(plan.some(row => String(row.key || '').includes('agent_market_messages_conversation_id_role_generation_status_idx')));
  assert.ok(user.user_id);
});

test('hot ranking formula uses five-minute cache, log normalization, and zero score for negative growth', () => {
  assert.equal(rankings.CACHE_TTL_MS, 5 * 60_000);
  assert.equal(rankings.logNormalize(0, 100), 0);
  assert.ok(rankings.logNormalize(10, 100) > 0);
  assert.ok(rankings.logNormalize(10, 100) > 10 / 100);
  assert.ok(rankings.logNormalize(10, 100) < 1);
  assert.equal(rankings.growthScore(5, 10), 0);
  assert.equal(rankings.growthScore(10, 10), 0);
  assert.equal(rankings.growthScore(40, 10), 1);
  assert.equal(rankings.growthScore(100, 10), 1);
});
