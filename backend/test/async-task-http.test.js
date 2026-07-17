const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const tasks = require('../src/modules/async-task/async-task.service');

let server;
let base;

test.before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});

async function request(method, route, token, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  return { response, json };
}

async function login(account) {
  const { response, json } = await request('POST', '/auth/login', null, { account, password: '123456' });
  assert.equal(response.status, 200);
  return { token: json.data.accessToken || json.data.token, user: json.data.user };
}

test('task HTTP endpoints isolate owners and expose list, active and detail', async () => {
  const [a, b] = await Promise.all([login('student_demo'), login('student_b')]);
  const own = await tasks.createTask(a.user.user_id, {
    operationId: `http-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: 'HTTP A',
    status: 'RUNNING', progressMode: 'INDETERMINATE', cancellable: true,
  });
  const other = await tasks.createTask(b.user.user_id, {
    operationId: `http-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: 'HTTP B',
    status: 'RUNNING', progressMode: 'INDETERMINATE', cancellable: true,
  });
  const list = await request('GET', '/tasks?pageSize=50', a.token);
  assert.equal(list.response.status, 200);
  assert.ok(list.json.data.list.some(item => item.id === own.id));
  assert.ok(!list.json.data.list.some(item => item.id === other.id));
  const active = await request('GET', '/tasks/active?pageSize=50', a.token);
  assert.ok(active.json.data.list.some(item => item.id === own.id));
  const detail = await request('GET', `/tasks/${own.id}`, a.token);
  assert.equal(detail.json.data.id, own.id);
  const denied = await request('GET', `/tasks/${other.id}`, a.token);
  assert.equal(denied.response.status, 403);
});

test('task HTTP cancel and dismiss preserve their separate meanings', async () => {
  const a = await login('student_demo');
  const running = await tasks.createTask(a.user.user_id, {
    operationId: `http-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: '关闭分离测试',
    status: 'RUNNING', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  const activeDismiss = await request('POST', `/tasks/${running.id}/dismiss`, a.token, {});
  assert.equal(activeDismiss.response.status, 409);
  const cancelled = await request('POST', `/tasks/${running.id}/cancel`, a.token, {});
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.json.data.status, 'CANCELLED');
  const dismissed = await request('POST', `/tasks/${running.id}/dismiss`, a.token, {});
  assert.equal(dismissed.response.status, 200);
  assert.ok(dismissed.json.data.dismissedAt);
  const audit = await prisma.asyncTask.findUnique({ where: { id: running.id } });
  assert.ok(audit);
  assert.equal(audit.status, 'CANCELLED');
});
