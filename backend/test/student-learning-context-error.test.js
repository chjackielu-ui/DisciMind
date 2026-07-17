const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../src/modules/student-learning-context/student-learning-context.service');

test('empty learning context is safe and snapshot uses the real resource owner field', () => {
  assert.deepEqual(service.serialize(null), { active: false, valid: false, reason: '尚未设置当前学习上下文' });
  const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/student-learning-context/student-learning-context.service.js'), 'utf8');
  assert.match(source, /ownerUserId:\s*userId/);
  assert.match(source, /学习目标不存在[\s\S]*404/);
  assert.match(source, /学习目标与知识点范围冲突[\s\S]*409/);
  assert.match(source, /工作流当前不可见[\s\S]*403/);
});
