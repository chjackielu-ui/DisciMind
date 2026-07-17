const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { resolveSessionForPlan } = require('../src/modules/student-learning-plan/student-learning-plan.service');

const plan = {
  id: 7,
  learningSessionId: null,
  learningGoalId: 17,
  courseId: 1,
  knowledgePointId: 4,
  workflowTemplateId: 1,
  workflowVersionId: 1,
  graphSnapshot: { entryNodeId: 'node_1', nodes: [], edges: [] },
  settingsSnapshot: {},
  completionMode: 'mastery_target',
  targetMastery: 85,
  estimatedMinutes: 25,
  goalSnapshot: { goalId: 17 },
};

describe('student learning plan session recovery', () => {
  it('reuses the one-to-one learning-goal session before creating another session', async () => {
    let createCalls = 0;
    const db = { learningSession: { findFirst: async () => ({ session_id: 42 }) } };
    const runtime = {
      getSession: async (id, userId) => ({ session_id: id, student_user_id: userId, status: 'PAUSED' }),
      createSession: async () => { createCalls += 1; return null; },
    };
    const result = await resolveSessionForPlan(plan, 3, runtime, db);
    assert.equal(result.session_id, 42);
    assert.equal(result.student_user_id, 3);
    assert.equal(createCalls, 0);
  });

  it('recovers the winning session when concurrent starts hit the unique goal key', async () => {
    let lookupCalls = 0;
    const db = { learningSession: { findFirst: async () => (++lookupCalls === 1 ? null : { session_id: 43 }) } };
    const runtime = {
      getSession: async id => ({ session_id: id, status: 'CREATED' }),
      createSession: async () => { throw Object.assign(new Error('unique collision'), { code: 'P2002' }); },
    };
    const result = await resolveSessionForPlan(plan, 3, runtime, db);
    assert.equal(result.session_id, 43);
    assert.equal(lookupCalls, 2);
  });

  it('does not hide unrelated session creation failures', async () => {
    const db = { learningSession: { findFirst: async () => null } };
    const runtime = {
      getSession: async () => null,
      createSession: async () => { throw Object.assign(new Error('database unavailable'), { code: 'P1001' }); },
    };
    await assert.rejects(() => resolveSessionForPlan(plan, 3, runtime, db), /database unavailable/);
  });
});
