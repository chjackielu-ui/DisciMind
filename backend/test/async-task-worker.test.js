const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const prisma = require('../src/config/prisma');
const tasks = require('../src/modules/async-task/async-task.service');
const { AsyncTaskWorker, delayForAttempt } = require('../src/modules/async-task/async-task.worker');

test.after(async () => prisma.$disconnect());

async function owner() {
  const user = await prisma.user.findUnique({ where: { username: 'student_demo' } });
  assert.ok(user);
  return user.user_id;
}

async function waitFor(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('worker condition timed out');
}

test('retry delay is bounded exponential backoff', () => {
  assert.equal(delayForAttempt(1), 1000);
  assert.equal(delayForAttempt(2), 2000);
  assert.equal(delayForAttempt(3), 4000);
  assert.equal(delayForAttempt(20), 60000);
});

test('two worker instances atomically claim a due task only once', async () => {
  const userId = await owner();
  const token = crypto.randomUUID();
  const taskType = 'VOICE_PRELOAD';
  const created = await tasks.createTask(userId, {
    operationId: `worker-${token}`, taskType, title: '原子认领测试',
    status: 'QUEUED', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  let executions = 0;
  const handler = async task => {
    executions += 1;
    await new Promise(resolve => setTimeout(resolve, 60));
    await tasks.updateTask(task.id, { status: 'SUCCEEDED', stage: 'READY' });
    return { terminal: true };
  };
  const a = new AsyncTaskWorker({ instanceId: `a-${crypto.randomUUID()}`, maxConcurrent: 1, operationIdContains: token }).register(taskType, handler);
  const b = new AsyncTaskWorker({ instanceId: `b-${crypto.randomUUID()}`, maxConcurrent: 1, operationIdContains: token }).register(taskType, handler);
  await Promise.all([a.scanLocal(), b.scanLocal()]);
  await waitFor(async () => (await prisma.asyncTask.findUnique({ where: { id: created.id } }))?.status === 'SUCCEEDED');
  const finished = await prisma.asyncTask.findUnique({ where: { id: created.id } });
  assert.equal(executions, 1);
  assert.equal(finished.attemptCount, 1);
  assert.equal(finished.lockedBy, null);
});

test('an expired lease can be recovered without a duplicate execution', async () => {
  const userId = await owner();
  const token = crypto.randomUUID();
  const taskType = 'LEARNING_FLOW_PRELOAD';
  const created = await tasks.createTask(userId, {
    operationId: `worker-${token}`, taskType, title: '过期锁恢复测试',
    status: 'RUNNING', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  await prisma.asyncTask.update({ where: { id: created.id }, data: {
    lockedBy: 'dead-instance', lockedAt: new Date(Date.now() - 120_000), nextRunAt: new Date(Date.now() - 1000),
    updatedAt: new Date(Date.now() - 6 * 60_000),
  } });
  let executions = 0;
  const worker = new AsyncTaskWorker({ instanceId: `recover-${crypto.randomUUID()}`, leaseMs: 60_000, operationIdContains: token }).register(taskType, async task => {
    executions += 1;
    await tasks.updateTask(task.id, { status: 'SUCCEEDED', stage: 'READY' });
    return { terminal: true };
  });
  await worker.scanLocal();
  await waitFor(async () => (await prisma.asyncTask.findUnique({ where: { id: created.id } }))?.status === 'SUCCEEDED');
  assert.equal(executions, 1);
});

test('a fresh leased running task is not recovered before its lease expires', async () => {
  const userId = await owner();
  const token = crypto.randomUUID();
  const taskType = 'VOICE_PRELOAD';
  const created = await tasks.createTask(userId, {
    operationId: `worker-${token}`, taskType, title: '活跃任务保护测试',
    status: 'RUNNING', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  await prisma.asyncTask.update({ where: { id: created.id }, data: { lockedBy: 'live-instance', lockedAt: new Date() } });
  let executions = 0;
  const worker = new AsyncTaskWorker({ instanceId: `fresh-${crypto.randomUUID()}`, operationIdContains: token }).register(taskType, async () => {
    executions += 1;
    return { status: 'RUNNING' };
  });
  await worker.scanLocal();
  await new Promise(resolve => setTimeout(resolve, 50));
  const untouched = await prisma.asyncTask.findUnique({ where: { id: created.id } });
  assert.equal(executions, 0);
  assert.equal(untouched.lockedBy, 'live-instance');
  await tasks.updateTask(created.id, { status: 'CANCELLED', stage: 'TEST_CLEANUP' });
});

test('an unleased running task is recovered immediately after a backend restart', async () => {
  const userId = await owner();
  const token = crypto.randomUUID();
  const taskType = 'VOICE_PRELOAD';
  const created = await tasks.createTask(userId, {
    operationId: `worker-${token}`, taskType, title: '重启恢复测试',
    status: 'RUNNING', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  let executions = 0;
  const worker = new AsyncTaskWorker({ instanceId: `restart-${crypto.randomUUID()}`, operationIdContains: token }).register(taskType, async task => {
    executions += 1;
    await tasks.updateTask(task.id, { status: 'SUCCEEDED', stage: 'READY' });
    return { terminal: true };
  });
  await worker.scanLocal();
  await waitFor(async () => (await prisma.asyncTask.findUnique({ where: { id: created.id } }))?.status === 'SUCCEEDED');
  assert.equal(executions, 1);
});

test('worker lease indexes exist in the live database', async () => {
  const indexes = await prisma.$queryRawUnsafe('SHOW INDEX FROM `async_tasks`');
  const names = new Set(indexes.map(row => row.Key_name));
  assert.ok(names.has('async_tasks_status_next_run_idx'));
  assert.ok(names.has('async_tasks_locked_at_idx'));
});

test('worker shutdown releases only leases owned by that instance', async () => {
  const userId = await owner();
  const created = await tasks.createTask(userId, {
    operationId: `worker-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: '关闭释放锁测试',
    status: 'RUNNING', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  const instanceId = `shutdown-${crypto.randomUUID()}`;
  await prisma.asyncTask.update({ where: { id: created.id }, data: { lockedBy: instanceId, lockedAt: new Date() } });
  const worker = new AsyncTaskWorker({ instanceId });
  worker.started = true;
  await worker.stop();
  const released = await prisma.asyncTask.findUnique({ where: { id: created.id } });
  assert.equal(released.lockedBy, null);
  assert.equal(released.lockedAt, null);
});

test('worker shutdown never releases another instance lease', async () => {
  const userId = await owner();
  const created = await tasks.createTask(userId, {
    operationId: `worker-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: '他实例锁保护测试',
    status: 'RUNNING', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  await prisma.asyncTask.update({ where: { id: created.id }, data: { lockedBy: 'other-live-instance', lockedAt: new Date() } });
  const worker = new AsyncTaskWorker({ instanceId: `shutdown-${crypto.randomUUID()}` });
  worker.started = true;
  await worker.stop();
  const untouched = await prisma.asyncTask.findUnique({ where: { id: created.id } });
  assert.equal(untouched.lockedBy, 'other-live-instance');
  await tasks.updateTask(created.id, { status: 'CANCELLED', stage: 'TEST_CLEANUP' });
});
