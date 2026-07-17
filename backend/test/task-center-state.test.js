const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let state;
test.before(async () => {
  state = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/components/task-center-state.js')).href);
});

function task(patch = {}) {
  return {
    id: 1, status: 'RUNNING', progressMode: 'DETERMINATE', progress: 20,
    resultUrl: null, requiresUserAction: false, ...patch,
  };
}

test('corrupt persisted card state safely degrades to an empty state', () => {
  assert.deepEqual(state.parseTaskCardState('{broken'), {});
  assert.deepEqual(state.parseTaskCardState([]), {});
});

test('a task without a dismissal snapshot is visible', () => {
  assert.equal(state.shouldShowTask(task(), null), true);
});

test('updatedAt changes alone do not restore a hidden card', () => {
  const original = task({ updatedAt: '2026-07-11T00:00:00.000Z' });
  const hidden = state.snapshotTask(original);
  assert.equal(state.shouldShowTask({ ...original, updatedAt: '2026-07-11T00:01:00.000Z' }, hidden), false);
});

test('non-terminal active status changes do not restore a hidden card', () => {
  const hidden = state.snapshotTask(task({ status: 'QUEUED', progressMode: 'STAGE_ONLY', progress: null }));
  assert.equal(state.shouldShowTask(task({ status: 'WAITING_EXTERNAL', progressMode: 'STAGE_ONLY', progress: null }), hidden), false);
});

test('progress changes above the threshold do not repeatedly restore a card', () => {
  const hidden = state.snapshotTask(task({ progress: 91 }));
  assert.equal(state.shouldShowTask(task({ progress: 92 }), hidden), false);
});

test('external and malformed result URLs are ignored', () => {
  const hidden = state.snapshotTask(task());
  assert.equal(state.shouldShowTask(task({ resultUrl: 'https://evil.example/result' }), hidden), false);
  assert.equal(state.shouldShowTask(task({ resultUrl: 'javascript:alert(1)' }), hidden), false);
});

test('task card storage keys isolate different users', () => {
  assert.notEqual(state.taskStateStorageKey(1), state.taskStateStorageKey(2));
  assert.match(state.taskStateStorageKey(1), /\.1$/);
});

test('dismissal snapshots contain every required observation field', () => {
  const snapshot = state.snapshotTask(task({ progress: 89, resultUrl: '#/student/agents', requiresUserAction: true }), new Date('2026-07-11T00:00:00.000Z'));
  assert.deepEqual(Object.keys(snapshot).sort(), ['dismissedAt', 'lastSeenNeedsAction', 'lastSeenProgress', 'lastSeenResultUrl', 'lastSeenStatus', 'taskId'].sort());
  assert.equal(snapshot.lastSeenProgress, 89);
  assert.equal(snapshot.lastSeenNeedsAction, true);
});

test('result URL whitelist accepts supported student and role-aware artifact routes', () => {
  assert.equal(state.validResultUrl('#/student/agents/knowledge'), '#/student/agents/knowledge');
  assert.equal(state.validResultUrl('#/student/learning-flows?preload=1'), '#/student/learning-flows?preload=1');
  assert.equal(state.validResultUrl('#/artifacts/696?format=DOCX'), '#/artifacts/696?format=DOCX');
  assert.equal(state.validResultUrl('#/teacher/artifacts/696'), '#/teacher/artifacts/696');
  assert.equal(state.validResultUrl('/etc/passwd'), '');
});

test('dismissed cards reappear once at the 90 percent threshold', () => {
  const hiddenAt89 = state.snapshotTask(task({ progress: 89 }));
  assert.equal(state.shouldShowTask(task({ progress: 90 }), hiddenAt89), true);
  const hiddenAt90 = state.snapshotTask(task({ progress: 90 }));
  assert.equal(state.shouldShowTask(task({ progress: 91 }), hiddenAt90), false);
});

test('terminal transitions reappear and a second terminal dismissal stays hidden', () => {
  for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED']) {
    const running = state.snapshotTask(task());
    const terminal = task({ status, progressMode: 'STAGE_ONLY', progress: null });
    assert.equal(state.shouldShowTask(terminal, running), true);
    assert.equal(state.shouldShowTask(terminal, state.snapshotTask(terminal)), false);
  }
});

test('needs-action and result URL changes are important events only once', () => {
  const hidden = state.snapshotTask(task());
  const action = task({ requiresUserAction: true });
  assert.equal(state.shouldShowTask(action, hidden), true);
  assert.equal(state.shouldShowTask(action, state.snapshotTask(action)), false);
  const firstResult = task({ resultUrl: '#/student/agents/knowledge' });
  assert.equal(state.shouldShowTask(firstResult, hidden), true);
  assert.equal(state.shouldShowTask(firstResult, state.snapshotTask(firstResult)), false);
  assert.equal(state.shouldShowTask(task({ resultUrl: '#/student/learning-flows' }), state.snapshotTask(firstResult)), true);
});

test('poller stops without active tasks and schedules one active-task poll', async () => {
  const scheduled = [];
  const poller = state.createTaskPoller({
    sync: async () => ({ hasActive: false }),
    schedule: (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; },
    cancelSchedule: () => {},
  });
  await poller.start();
  assert.equal(poller.hasTimer(), false);
  const activePoller = state.createTaskPoller({
    sync: async () => ({ hasActive: true }),
    schedule: (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; },
    cancelSchedule: () => {},
  });
  await activePoller.start();
  assert.equal(scheduled.at(-1).delay, 3000);
  activePoller.stop();
});

test('poller retries exactly three times and manual sync can recover', async () => {
  const scheduled = [];
  let failing = true;
  let exhausted = 0;
  let recovered = 0;
  const poller = state.createTaskPoller({
    sync: async () => { if (failing) throw new Error('offline'); return { hasActive: false }; },
    onData: () => { recovered += 1; },
    onExhausted: () => { exhausted += 1; },
    schedule: (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; },
    cancelSchedule: () => {},
  });
  await poller.start();
  for (let index = 0; index < 3; index += 1) {
    assert.equal(scheduled[index].delay, [1000, 2000, 4000][index]);
    scheduled[index].fn();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(exhausted, 1);
  failing = false;
  await poller.syncNow({ manual: true });
  assert.equal(recovered, 1);
  assert.equal(poller.hasTimer(), false);
});

test('task island collapses locally and never imports task mutation endpoints', async () => {
  const fs = require('node:fs/promises');
  const source = await fs.readFile(path.resolve(__dirname, '../../frontend/src/components/task-center.js'), 'utf8');
  assert.match(source, /collapseNow\(\)/);
  assert.match(source, /AUTO_COLLAPSE_MS\s*=\s*2500/);
  assert.match(source, /onOutsidePointer/);
  assert.match(source, /discimind:task-island:intro:/);
  assert.doesNotMatch(source, /firstPayload/);
  assert.doesNotMatch(source, /\|\| changed\).*expand/);
  assert.doesNotMatch(source, /import\s*\{[^}]*cancelTask/);
  assert.doesNotMatch(source, /import\s*\{[^}]*dismissTask/);
});
