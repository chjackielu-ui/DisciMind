const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('quick-start keeps preload optional and isolates fallback errors', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/modules/learning-workflow/learning-workflow.controller.js'), 'utf8');
  assert.match(source, /preloadId, learningGoalId/);
  assert.match(source, /quick-start fallback/);
  assert.match(source, /preload: preloadResult/);
});

test('model cache adapter is a soft miss outside a learning session context', async () => {
  const adapter = require('../src/modules/learning-flow-preload/learning-flow-preload-model.adapter');
  assert.equal(await adapter.cachedModelResponse([{ role: 'system', content: 'Explainer Agent' }], { jsonMode: true }), null);
});
