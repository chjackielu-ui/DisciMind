const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const taskService = require('../src/modules/async-task/async-task.service');
const { signToken } = require('../src/utils/jwt');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});

async function post(path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

test('bulk task HTTP routes cannot be captured by the dynamic task id route', async () => {
  const user = await prisma.user.findUnique({ where: { username: 'student_demo' } });
  assert.ok(user, 'student_demo seed user is required');
  const token = signToken({ user_id: user.user_id, role: 'student' });
  const running = await taskService.createTask(user.user_id, {
    operationId: `http-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: 'HTTP 批量取消',
    status: 'RUNNING', stage: 'EXPORTING', progressMode: 'INDETERMINATE', cancellable: true,
  });
  const failed = await taskService.createTask(user.user_id, {
    operationId: `http-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: 'HTTP 批量删除',
    status: 'FAILED', stage: 'FAILED', progressMode: 'STAGE_ONLY', cancellable: true,
  });

  const cancelled = await post('/tasks/bulk/cancel', token, { ids: [running.id, failed.id] });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.payload.code, 0);
  assert.equal(cancelled.payload.data.affected, 1);
  assert.equal(JSON.stringify(cancelled.payload).includes('prisma.asyncTask.findFirst'), false);

  const deleted = await post('/tasks/bulk/delete', token, { ids: [running.id, failed.id] });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.payload.code, 0);
  assert.equal(deleted.payload.data.affected, 2);
  assert.equal(await prisma.asyncTask.count({ where: { id: { in: [running.id, failed.id] } } }), 0);
});
