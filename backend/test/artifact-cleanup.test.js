const test = require('node:test');
const assert = require('node:assert/strict');
const { cutoffDate, NON_CLEANABLE_STATUSES, DEFAULT_RETENTION_DAYS } = require('../src/modules/file-generator/artifact-cleanup.service');

test('artifact cleanup cutoff defaults to exactly 90 days', () => {
  const now = new Date('2026-07-12T00:00:00.000Z');
  assert.equal(DEFAULT_RETENTION_DAYS, 90);
  assert.equal(cutoffDate(now).toISOString(), '2026-04-13T00:00:00.000Z');
});

test('active generation, export and terminal deletion states are never cleanup candidates', () => {
  for (const status of ['DRAFT', 'GENERATING', 'EXPORTING', 'DELETING', 'DELETED', 'EXPIRED']) assert.ok(NON_CLEANABLE_STATUSES.includes(status));
  assert.equal(NON_CLEANABLE_STATUSES.includes('READY'), false);
});
