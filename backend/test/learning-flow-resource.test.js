const test = require('node:test');
const assert = require('node:assert/strict');
const { makeLinkKey, USABLE_ARTIFACT_STATUSES } = require('../src/modules/learning-flow-resource/learning-flow-resource.service');
const schemas = require('../src/modules/learning-flow-resource/learning-flow-resource.schemas');

test('resource link key is deterministic and covers every nullable scope field', () => {
  const input = { artifactId: 43, courseId: 1, knowledgePointId: 2, learningGoalId: null, workflowTemplateId: 3, learningSessionId: null, resourceRole: 'PRE_CLASS_HANDOUT' };
  assert.equal(makeLinkKey(input), makeLinkKey({ ...input }));
  assert.notEqual(makeLinkKey(input), makeLinkKey({ ...input, learningSessionId: 9 }));
  assert.match(makeLinkKey(input), /^[a-f0-9]{64}$/);
});

test('resource input requires a target and course for knowledge point', () => {
  assert.equal(schemas.createSchema.safeParse({ resourceRole: 'REFERENCE_MATERIAL' }).success, false);
  assert.equal(schemas.createSchema.safeParse({ knowledgePointId: 2, resourceRole: 'REFERENCE_MATERIAL' }).success, false);
  assert.equal(schemas.createSchema.safeParse({ courseId: 1, knowledgePointId: 2, resourceRole: 'REFERENCE_MATERIAL' }).success, true);
  assert.deepEqual(USABLE_ARTIFACT_STATUSES, ['CONTENT_READY', 'EXPORTING', 'READY', 'FAILED']);
});
