const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('artifact routes expose learning-flow link creation behind existing auth router', () => {
  const router = require('../src/modules/file-generator/generated-artifact.routes');
  const route = router.stack.find((layer) => layer.route?.path === '/:id/learning-flow-links');
  assert.ok(route);
  assert.equal(route.route.methods.post, true);
});

test('artifact deletion keeps the locked 409 message and restores status on unlink failure', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/modules/file-generator/generated-artifact.service.js'), 'utf8');
  assert.match(source, /该资料仍被学习流使用，请先解除关联后再删除。/);
  assert.match(source, /status: originalStatus/);
  assert.match(source, /FILE_DELETE_FAILED/);
});
