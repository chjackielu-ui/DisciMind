const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReadiness, startError, sessionStartAction } = require('../src/modules/student-learning-plan/student-learning-plan.service');

function plan(overrides = {}) {
  return {
    id: 4, status: 'READY', workflowVersionId: 4, currentNodeId: 'node_1',
    graphSnapshot: { entryNodeId: 'node_1', nodes: [{ id: 'node_1', type: 'concept_explanation', title: '首节点' }], edges: [] },
    preloads: [], ...overrides,
  };
}

test('partial preload with first-node text and failed TTS remains startable', () => {
  const readiness = buildReadiness(plan({ preloads: [{ id: 7, status: 'PARTIAL', preparedContentCount: 1, preparedAudioCount: 0, preparedNodeIdsJson: ['node_1'], errorCode: 'TTS_UPSTREAM_ERROR', errorMessage: 'TTS unavailable' }] }));
  assert.equal(readiness.canStart, true);
  assert.equal(readiness.required.firstNode, 'ready');
  assert.equal(readiness.optional.tts, 'degraded');
  assert.ok(readiness.degradedReasons.some(item => item.code === 'TTS_UPSTREAM_ERROR'));
});

test('valid graph can start with instant first-node generation and no preload', () => {
  const readiness = buildReadiness(plan());
  assert.equal(readiness.canStart, true);
  assert.equal(readiness.required.firstNode, 'instant');
  assert.equal(readiness.optional.tts, 'pending');
});

test('missing workflow snapshot and missing entry node return distinct blocking reasons', () => {
  const missingSnapshot = buildReadiness(plan({ workflowVersionId: null, graphSnapshot: { nodes: [], edges: [] }, currentNodeId: null }));
  assert.equal(missingSnapshot.canStart, false);
  assert.ok(missingSnapshot.blockingReasons.some(item => item.code === 'WORKFLOW_SNAPSHOT_MISSING'));
  assert.ok(missingSnapshot.blockingReasons.some(item => item.code === 'FIRST_NODE_NOT_READY'));
});

test('required preload failure blocks while non-critical preload failure degrades', () => {
  const blocked = buildReadiness(plan({ preloads: [{ status: 'FAILED', preparedContentCount: 0, preparedAudioCount: 0, errorCode: 'FIRST_NODE_CONTENT_FAILED' }] }));
  assert.equal(blocked.canStart, false);
  assert.equal(blocked.blockingReasons.at(-1).code, 'PRELOAD_REQUIRED_FAILED');
  const optional = buildReadiness(plan({ preloads: [{ status: 'FAILED', preparedContentCount: 0, preparedAudioCount: 0, errorCode: 'TTS_UPSTREAM_ERROR' }] }));
  assert.equal(optional.canStart, true);
});

test('learning start errors expose stable public codes and recovery details', () => {
  const error = startError('SESSION_CONFLICT', 'conflict', 409, { existingSessionId: 51, action: 'CONTINUE_EXISTING_SESSION' });
  assert.equal(error.publicCode, 'SESSION_CONFLICT');
  assert.equal(error.code, 40901);
  assert.equal(error.expose, true);
  assert.equal(error.details.existingSessionId, 51);
  assert.equal(sessionStartAction('COMPLETED'), 'results');
  assert.equal(sessionStartAction('PAUSED'), 'resume');
});

