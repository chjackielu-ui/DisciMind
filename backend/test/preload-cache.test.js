const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../src/modules/learning-flow-preload/learning-flow-preload-cache.service');

test('stable preload hashing ignores object key insertion order', () => {
  assert.equal(cache.hash({ b: 2, a: { d: 4, c: 3 } }), cache.hash({ a: { c: 3, d: 4 }, b: 2 }));
});

test('preload cache is usable only for active READY/PARTIAL records within 24 hours', () => {
  const now = new Date('2026-07-12T00:00:00Z');
  assert.equal(cache.DEFAULT_TTL_MS, 24 * 60 * 60 * 1000);
  const preload = { preloadKey: 'x', activeKey: 'x', status: 'READY', deletedAt: null, expiresAt: new Date(now.getTime() + 1) };
  assert.equal(cache.isUsable(preload, now), true);
  assert.equal(cache.isUsable({ ...preload, status: 'FAILED' }, now), false);
  assert.equal(cache.isUsable({ ...preload, expiresAt: now }, now), false);
});
