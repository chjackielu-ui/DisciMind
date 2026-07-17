const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const chat = require('../src/modules/agent-chat/agent-chat.service');

let server; let base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); });

async function request(method, route, token, body) {
  const response = await fetch(`${base}${route}`, { method, headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
  }, body: body ? JSON.stringify(body) : undefined });
  return { response, json: await response.json() };
}
async function login(account) {
  const result = await request('POST', '/auth/login', null, { account, password: '123456' });
  return { token: result.json.data.accessToken || result.json.data.token, user: result.json.data.user };
}

test('generation cancel endpoint enforces conversation ownership and clears the active lock', async () => {
  const [a, b] = await Promise.all([login('student_demo'), login('student_b')]);
  const agent = await prisma.userAgent.findFirst({ where: { status: 'PUBLIC', currentPublicVersionId: { not: null }, deletedAt: null } });
  const conversation = await chat.createConversation(a.user.user_id, agent.id, { title: 'HTTP 取消测试', operationId: crypto.randomUUID() });
  const generationId = crypto.randomUUID();
  await prisma.marketplaceAgentMessage.create({ data: { conversationId: conversation.id, role: 'ASSISTANT', content: '部分', generationStatus: 'GENERATING', generationId } });
  await prisma.marketplaceAgentConversation.update({ where: { id: conversation.id }, data: { activeGenerationId: generationId } });
  const denied = await request('POST', `/agent-conversations/${conversation.id}/generations/${generationId}/cancel`, b.token, {});
  assert.equal(denied.response.status, 403);
  const cancelled = await request('POST', `/agent-conversations/${conversation.id}/generations/${generationId}/cancel`, a.token, {});
  assert.equal(cancelled.response.status, 200);
  const [message, updated] = await Promise.all([
    prisma.marketplaceAgentMessage.findUnique({ where: { generationId } }),
    prisma.marketplaceAgentConversation.findUnique({ where: { id: conversation.id } }),
  ]);
  assert.equal(message.generationStatus, 'CANCELLED');
  assert.equal(updated.activeGenerationId, null);
});

test('unified CHAT conversation list is owner isolated', async () => {
  const [a, b] = await Promise.all([login('student_demo'), login('student_b')]);
  const own = await request('GET', '/agent-conversations?agentType=CHAT', a.token);
  const other = await request('GET', '/agent-conversations?agentType=CHAT', b.token);
  assert.equal(own.response.status, 200);
  assert.ok(own.json.data.list.every(item => !other.json.data.list.some(candidate => candidate.id === item.id)));
});
