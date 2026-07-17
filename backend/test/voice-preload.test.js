const test = require('node:test');
const assert = require('node:assert/strict');
const { logicalVoiceKey } = require('../src/modules/learning-flow-preload/voice-prewarm.service');

test('voice preload key changes with content, node, voice, speed and language material', () => {
  const preload = { workflowVersion: 4, goalSnapshotHash: 'g'.repeat(64) };
  const config = { voice: 'Cherry', speechRate: 1 };
  const base = logicalVoiceKey(preload, 'node_1', 'c'.repeat(64), config);
  assert.match(base, /^[a-f0-9]{64}$/);
  assert.notEqual(base, logicalVoiceKey(preload, 'node_2', 'c'.repeat(64), config));
  assert.notEqual(base, logicalVoiceKey(preload, 'node_1', 'd'.repeat(64), config));
  assert.notEqual(base, logicalVoiceKey(preload, 'node_1', 'c'.repeat(64), { ...config, speechRate: 1.25 }));
});
