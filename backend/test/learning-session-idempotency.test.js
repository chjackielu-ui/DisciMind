const test = require('node:test');
const assert = require('node:assert/strict');

const { withStartLock, resolveSessionForPlan, sessionStartAction } = require('../src/modules/student-learning-plan/student-learning-plan.service');

const plan = {
  id: 88, learningSessionId: null, learningGoalId: 188, courseId: 1, knowledgePointId: 4,
  workflowTemplateId: 5, workflowVersionId: 5, graphSnapshot: { entryNodeId: 'node_1', nodes: [{ id: 'node_1' }], edges: [] },
  settingsSnapshot: {}, completionMode: 'mastery_target', targetMastery: 80, estimatedMinutes: 25, goalSnapshot: {},
};

test('concurrent starts for the same user and plan share one in-process promise', async () => {
  let calls = 0;
  const factory = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 15)); return { sessionId: 51 }; };
  const results = await Promise.all(Array.from({ length: 8 }, () => withStartLock('student:3:plan:88', factory)));
  assert.equal(calls, 1);
  assert.deepEqual(new Set(results.map(item => item.sessionId)), new Set([51]));
});

test('an existing plan-linked session is always reused', async () => {
  let createCalls = 0;
  const runtime = { getSession: async id => ({ session_id: id, status: 'RUNNING' }), createSession: async () => { createCalls += 1; } };
  const result = await resolveSessionForPlan({ ...plan, learningSessionId: 51 }, 3, runtime, { learningSession: { findFirst: async () => null } });
  assert.equal(result.session_id, 51);
  assert.equal(createCalls, 0);
});

test('an unlinked paused goal session is reused and resumed by the state machine', async () => {
  const runtime = { getSession: async id => ({ session_id: id, status: 'PAUSED' }), createSession: async () => assert.fail('must not create') };
  const db = { learningSession: { findFirst: async () => ({ session_id: 52, status: 'PAUSED', learning_plan: null }) } };
  const result = await resolveSessionForPlan(plan, 3, runtime, db);
  assert.equal(result.session_id, 52);
  assert.equal(sessionStartAction(result.status), 'resume');
});

test('a unique-goal race recovers the winning session instead of creating duplicates', async () => {
  let lookups = 0; let creates = 0;
  const db = { learningSession: { findFirst: async () => (++lookups === 1 ? null : { session_id: 53, status: 'CREATED', learning_plan: null }) } };
  const runtime = { getSession: async id => ({ session_id: id, status: 'CREATED' }), createSession: async () => { creates += 1; throw Object.assign(new Error('duplicate'), { code: 'P2002' }); } };
  const result = await resolveSessionForPlan(plan, 3, runtime, db);
  assert.equal(result.session_id, 53);
  assert.equal(creates, 1);
  assert.equal(lookups, 2);
});

test('completed and abandoned states have explicit product actions', () => {
  assert.equal(sessionStartAction('COMPLETED'), 'results');
  assert.equal(sessionStartAction('ABANDONED'), 'new_round');
  assert.equal(sessionStartAction('RUNNING'), 'reuse');
  assert.equal(sessionStartAction('unknown'), 'invalid');
});

