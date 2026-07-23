const test = require('node:test');
const assert = require('node:assert/strict');
const icons = require('../src/modules/agent-marketplace/agent-icon.service');
const memories = require('../src/modules/agent-chat/agent-memory.service');

test('agent icon catalog has at least 24 unique stable SVG keys and matching color pairs', () => {
  assert.ok(icons.ICON_KEYS.length >= 24);
  assert.equal(new Set(icons.ICON_KEYS).size, icons.ICON_KEYS.length);
  assert.equal(icons.ICON_COLORS.length, icons.ICON_BACKGROUNDS.length);
  const first = icons.resolveAgentIcon({ id: 42, agentType: 'CHAT' }, { name: '稳定智能体' });
  const second = icons.resolveAgentIcon({ id: 42, agentType: 'CHAT' }, { name: '稳定智能体' });
  assert.deepEqual(first, second);
  assert.equal(icons.resolveAgentIcon({ id: 1, agentType: 'FILE_GENERATOR' }, { name: '考试试卷生成' }).key, 'exam');
});

test('memory requests become confirmation candidates and sensitive values are never proposed', () => {
  assert.equal(memories.detectMemoryCandidate('记住：我喜欢先看例题').content, '我喜欢先看例题');
  assert.equal(memories.detectMemoryCandidate('记住：我的密码是 abc123'), null);
  assert.equal(memories.detectMemoryCandidate('我喜欢先看例题'), null);
});

test('composer agent command trigger does not collide with LaTeX, code or escaped slashes', async () => {
  const { activeComposerMention } = await import('../../frontend/src/components/unified-composer.js');
  assert.equal(activeComposerMention('\\讲义生成', 5)?.type, 'agent');
  assert.equal(activeComposerMention('请用 \\讲义生成', 8)?.type, 'agent');
  assert.equal(activeComposerMention('\\frac{a}{b}', 11), null);
  assert.equal(activeComposerMention('$$\\sum_{i=1}^{n}x_i$$', 8), null);
  assert.equal(activeComposerMention('`\\讲义生成`', 6), null);
  assert.equal(activeComposerMention('```python\npath = "\\\\test"\n```', 26), null);
  assert.equal(activeComposerMention('\\\\test', 6), null);
});
