const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const prisma = require('../src/config/prisma');
const tasks = require('../src/modules/async-task/async-task.service');

test.after(async () => {
  await prisma.$disconnect();
});

async function users() {
  const [a, b] = await Promise.all([
    prisma.user.findUnique({ where: { username: 'student_demo' } }),
    prisma.user.findUnique({ where: { username: 'student_b' } }),
  ]);
  assert.ok(a && b, 'seed users are required');
  return { a, b };
}

test('async task creation is idempotent and stage-only progress is never fabricated', async () => {
  const { a } = await users();
  const operationId = `test-${crypto.randomUUID()}`;
  const input = {
    operationId, taskType: 'KNOWLEDGE_INDEXING', title: '索引测试', status: 'WAITING_EXTERNAL',
    stage: 'INDEXING', progressMode: 'STAGE_ONLY', progress: 67,
    relatedResourceType: 'KNOWLEDGE_DOCUMENT', relatedResourceId: operationId,
  };
  const first = await tasks.createTask(a.user_id, input);
  const second = await tasks.createTask(a.user_id, input);
  assert.equal(first.id, second.id);
  assert.equal(first.progressMode, 'STAGE_ONLY');
  assert.equal(first.progress, null);
});

test('active task listing and task detail are isolated by owner', async () => {
  const { a, b } = await users();
  const task = await tasks.createTask(a.user_id, {
    operationId: `test-${crypto.randomUUID()}`, taskType: 'FILE_GENERATION', title: '生成测试',
    status: 'RUNNING', stage: 'GENERATING', progressMode: 'DETERMINATE', progress: 12, cancellable: true,
  });
  const active = await tasks.listTasks(a.user_id, {}, true);
  assert.ok(active.list.some((item) => item.id === task.id));
  await assert.rejects(() => tasks.getTask(b.user_id, task.id), /无权查看/);
  await assert.rejects(() => tasks.cancelTask(b.user_id, task.id), /无权取消/);
});

test('cancel is explicit and dismiss never cancels an active task', async () => {
  const { a } = await users();
  const task = await tasks.createTask(a.user_id, {
    operationId: `test-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: '导出测试',
    status: 'RUNNING', stage: 'EXPORTING', progressMode: 'INDETERMINATE', cancellable: true,
  });
  await assert.rejects(() => tasks.dismissTask(a.user_id, task.id), /本地隐藏/);
  const cancelled = await tasks.cancelTask(a.user_id, task.id);
  assert.equal(cancelled.status, 'CANCELLED');
  const dismissed = await tasks.dismissTask(a.user_id, task.id);
  assert.ok(dismissed.dismissedAt);
});

test('queued and waiting external tasks can be cancelled when explicitly enabled', async () => {
  const { a } = await users();
  for (const status of ['QUEUED', 'WAITING_EXTERNAL']) {
    const task = await tasks.createTask(a.user_id, {
      operationId: `test-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: `${status} 取消测试`,
      status, stage: status, progressMode: 'STAGE_ONLY', cancellable: true,
    });
    const cancelled = await tasks.cancelTask(a.user_id, task.id);
    assert.equal(cancelled.status, 'CANCELLED');
  }
});

test('non-cancellable and terminal tasks return a conflict instead of pretending to cancel', async () => {
  const { a } = await users();
  const external = await tasks.createTask(a.user_id, {
    operationId: `test-${crypto.randomUUID()}`, taskType: 'KNOWLEDGE_INDEXING', title: '外部不可取消任务',
    status: 'WAITING_EXTERNAL', stage: 'INDEXING', progressMode: 'STAGE_ONLY', cancellable: false,
  });
  await assert.rejects(() => tasks.cancelTask(a.user_id, external.id), error => error.status === 409);
  const terminal = await tasks.createTask(a.user_id, {
    operationId: `test-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: '终态取消测试',
    status: 'SUCCEEDED', stage: 'READY', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  await assert.rejects(() => tasks.cancelTask(a.user_id, terminal.id), error => error.status === 409);
});

test('task actions reject malformed route ids before Prisma and bulk actions process eligible records', async () => {
  const { a } = await users();
  await assert.rejects(
    () => tasks.cancelTask(a.user_id, 'bulk'),
    error => error.status === 400 && error.message === '任务 ID 不合法',
  );
  const active = await tasks.createTask(a.user_id, {
    operationId: `test-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: '批量取消测试',
    status: 'RUNNING', stage: 'EXPORTING', progressMode: 'INDETERMINATE', cancellable: true,
  });
  const failed = await tasks.createTask(a.user_id, {
    operationId: `test-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: '批量删除测试',
    status: 'FAILED', stage: 'FAILED', progressMode: 'STAGE_ONLY', cancellable: true,
  });
  const cancelled = await tasks.bulkCancel(a.user_id, [active.id, failed.id]);
  assert.equal(cancelled.affected, 1);
  assert.equal(cancelled.results.find(item => item.id === active.id)?.ok, true);
  assert.equal(cancelled.results.find(item => item.id === failed.id)?.ok, false);
  const removed = await tasks.bulkDelete(a.user_id, [active.id, failed.id]);
  assert.equal(removed.affected, 2);
  assert.equal(await prisma.asyncTask.count({ where: { id: { in: [active.id, failed.id] } } }), 0);
});

test('determinate progress accepts real values and terminal results persist', async () => {
  const { a } = await users();
  const knowledgeBase = await prisma.knowledgeBase.findFirst({ where: { owner_user_id: a.user_id, deleted_at: null } });
  assert.ok(knowledgeBase, 'an owned knowledge base is required');
  const task = await tasks.createTask(a.user_id, {
    operationId: `test-${crypto.randomUUID()}`, taskType: 'FILE_GENERATION', title: '讲义测试',
    status: 'RUNNING', stage: 'GENERATING', progressMode: 'DETERMINATE', progress: 10,
  });
  const nearComplete = await tasks.updateTask(task.id, { status: 'RUNNING', stage: 'EXPORTING', progressMode: 'DETERMINATE', progress: 90 });
  assert.equal(nearComplete.progress, 90);
  const complete = await tasks.updateTask(task.id, { status: 'SUCCEEDED', stage: 'READY', resultType: 'KNOWLEDGE_BASE', resultId: knowledgeBase.knowledge_base_id, resultUrl: '#/student/agents/knowledge' });
  assert.equal(complete.status, 'SUCCEEDED');
  assert.ok(complete.completedAt);
  assert.equal(complete.resultUrl, '#/student/agents/knowledge');
});

test('task serialization strips unsafe result URLs and private metadata', async () => {
  const { a } = await users();
  const created = await tasks.createTask(a.user_id, {
    operationId: `test-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: '序列化安全测试',
    status: 'RUNNING', progressMode: 'STAGE_ONLY', resultUrl: 'https://evil.example/result',
    metadataJson: { datasetId: 'secret-dataset', storagePath: 'C:/secret/file.docx' },
  });
  assert.equal(created.resultUrl, null);
  assert.equal(Object.hasOwn(created, 'metadataJson'), false);
  assert.equal(JSON.stringify(created).includes('secret-dataset'), false);
});

test('task serialization never exposes internal stack traces or filesystem paths', () => {
  const serialized = tasks.serialize({
    id: 1, taskType: 'DOCUMENT_EXPORT', title: '安全错误', description: null,
    status: 'FAILED', stage: 'FAILED', progress: null, progressMode: 'STAGE_ONLY',
    relatedResourceType: null, relatedResourceId: null, resultType: null, resultId: null, resultUrl: null,
    errorCode: 'INTERNAL', errorMessage: 'Invalid `prisma.item.findUnique()` at E:\\DisciMind\\backend\\src\\worker.js:10:2',
    cancellable: false, requiresUserAction: false, attemptCount: 1, maxAttempts: 3,
    dismissedAt: null, startedAt: null, completedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal(serialized.errorMessage, '后台任务执行失败，可以稍后重试。');
  assert.equal(JSON.stringify(serialized).includes('E:\\DisciMind'), false);
});

test('all terminal statuses may be dismissed without deleting audit rows', async () => {
  const { a } = await users();
  for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED']) {
    const created = await tasks.createTask(a.user_id, {
      operationId: `test-${crypto.randomUUID()}`, taskType: 'DOCUMENT_EXPORT', title: `${status} dismiss`,
      status, progressMode: 'STAGE_ONLY',
    });
    const dismissed = await tasks.dismissTask(a.user_id, created.id);
    assert.ok(dismissed.dismissedAt);
    assert.ok(await prisma.asyncTask.findUnique({ where: { id: created.id } }));
  }
});
