const test = require('node:test');
const assert = require('node:assert/strict');
const { SAFE_NODE_TYPES, normalizeType, firstNode } = require('../src/modules/learning-flow-preload/learning-flow-preload.processor');

test('only answer-independent first node types are preload safe', () => {
  assert.deepEqual([...SAFE_NODE_TYPES].sort(), ['analogy_explanation', 'concept_explanation', 'socratic_questioning', 'worked_example_analysis']);
  for (const blocked of ['basic_practice', 'adaptive_practice', 'wrong_question_repair', 'mastery_gate', 'learning_summary']) assert.equal(SAFE_NODE_TYPES.has(blocked), false);
});

test('first node selection follows entryNodeId and normalizes enum forms', () => {
  const graph = { entryNodeId: 'b', nodes: [{ id: 'a', type: 'basic_practice' }, { id: 'b', type: 'ConceptExplanation' }] };
  assert.equal(firstNode(graph).id, 'b');
  assert.equal(normalizeType('CONCEPT_EXPLANATION'), 'concept_explanation');
  assert.equal(normalizeType('worked-example-analysis'), 'worked_example_analysis');
});
