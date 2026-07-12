const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('next-node trigger skips undetermined and unsafe branches before generation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/modules/learning-flow-preload/learning-flow-preload-trigger.service.js'), 'utf8');
  assert.match(source, /NEXT_NODE_UNDETERMINED/);
  assert.match(source, /NEXT_NODE_NOT_SAFE/);
  assert.match(source, /setImmediate/);
  assert.doesNotMatch(source, /checkpoint|learning-flow\.graph|resumeGraph/);
});
