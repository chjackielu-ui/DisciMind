const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('learning PDF workspace supports multiple tabs, multi-file selection and drag-drop', async () => {
  const page = await fs.readFile(path.resolve(__dirname, '../../frontend/src/pages/student-learning-session.js'), 'utf8');
  const viewer = await fs.readFile(path.resolve(__dirname, '../../frontend/src/services/learning-pdf-viewer.js'), 'utf8');
  assert.match(page, /id="lws-pdf-local"[^>]*multiple/);
  assert.match(page, /id="lws-pdf-tabs"/);
  assert.match(page, /pdfOpenDocuments/);
  assert.match(page, /data-pdf-document-close/);
  assert.match(page, /addEventListener\('dragover'/);
  assert.match(page, /addEventListener\('drop'/);
  assert.match(page, /addLocalPdfFiles\(event\.dataTransfer\?\.files/);
  assert.match(viewer, /snapshotView\(\)/);
  assert.match(viewer, /async restoreView\(state = \{\}\)/);
});

test('task island remains viewport-right while the PDF panel is open', async () => {
  const css = await fs.readFile(path.resolve(__dirname, '../../frontend/src/styles/dashboard.css'), 'utf8');
  assert.doesNotMatch(css, /\.global-task-center\s*\{[^}]*right:\s*calc\(var\(--lws-pdf-width/s);
  assert.match(css, /body:has\(\.lws-page\.is-pdf-open\) \.global-task-center \{ top: 96px; right: 22px !important; \}/);
});
