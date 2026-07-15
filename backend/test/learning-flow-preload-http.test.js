const test = require('node:test');
const assert = require('node:assert/strict');

test('learning preload router exposes preload and session knowledge-card actions only', () => {
  const router = require('../src/modules/learning-flow-preload/learning-flow-preload.routes');
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`).sort();
  assert.deepEqual(routes, [
    'GET /',
    'GET /:id',
    'GET /sessions/:sessionId/cards',
    'POST /',
    'POST /:id/retry',
    'POST /sessions/:sessionId/cards/:cardId/save',
    'POST /sessions/:sessionId/cards/:cardId/state',
    'POST /sessions/:sessionId/cards/regenerate',
  ]);
});

test('learning preload schema accepts optional operation and session identifiers', () => {
  const { createSchema } = require('../src/modules/learning-flow-preload/learning-flow-preload.schemas');
  assert.equal(createSchema.safeParse({ workflowTemplateId: 2, learningGoalId: 3, operationId: 'operation-123' }).success, true);
  assert.equal(createSchema.safeParse({ workflowTemplateId: 0, learningGoalId: 3 }).success, false);
});
