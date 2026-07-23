const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectLocalStorage, publicStorageHealth } = require('../src/config/storage');

test('local storage readiness creates and verifies both configured roots without exposing paths', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'discimind-storage-'));
  const roots = [
    { key: 'project_storage', absolutePath: path.join(temporary, 'project-storage') },
    { key: 'backend_storage', absolutePath: path.join(temporary, 'backend-storage') },
  ];
  try {
    const report = await inspectLocalStorage({ roots });
    assert.equal(report.provider, 'LOCAL');
    assert.equal(report.ready, true);
    assert.equal(report.roots.every((item) => item.writable), true);
    const publicReport = publicStorageHealth(report);
    assert.equal(JSON.stringify(publicReport).includes(temporary), false);
    assert.equal('freeBytes' in publicReport.roots[0], false);
    assert.equal('totalBytes' in publicReport.roots[0], false);
    for (const root of roots) assert.deepEqual(await fs.readdir(root.absolutePath), []);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('local storage readiness reports an invalid root as unavailable', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'discimind-storage-invalid-'));
  const invalidRoot = path.join(temporary, 'not-a-directory');
  await fs.writeFile(invalidRoot, 'occupied');
  try {
    const report = await inspectLocalStorage({ roots: [{ key: 'invalid_storage', absolutePath: invalidRoot }] });
    assert.equal(report.ready, false);
    assert.equal(report.status, 'unavailable');
    assert.equal(report.roots[0].writable, false);
    assert.ok(report.roots[0].errorCode);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
