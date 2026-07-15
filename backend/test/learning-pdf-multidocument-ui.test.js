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

test('unified task center stays viewport-anchored and independent from PDF width', async () => {
  const dashboardCss = await fs.readFile(path.resolve(__dirname, '../../frontend/src/styles/dashboard.css'), 'utf8');
  const centerCss = await fs.readFile(path.resolve(__dirname, '../../frontend/src/styles/unified-work-center.css'), 'utf8');
  assert.doesNotMatch(dashboardCss, /lws-page\.is-pdf-open[^}]*\.(?:global-task-center|unified-work-center)/s);
  assert.doesNotMatch(centerCss, /right:\s*calc\(var\(--lws-pdf-width/s);
  assert.match(centerCss, /\.unified-work-center\{[^}]*position:fixed/s);
});

test('learning actions stay in document flow and fullscreen study is available', async () => {
  const page = await fs.readFile(path.resolve(__dirname, '../../frontend/src/pages/student-learning-session.js'), 'utf8');
  const css = await fs.readFile(path.resolve(__dirname, '../../frontend/src/styles/student.css'), 'utf8');
  assert.match(page, /data-learning-action="immersive-toggle"/);
  assert.match(page, /requestFullscreen/);
  assert.match(css, /\.lws-bottom-bar\{position:sticky/);
  assert.match(css, /\.lws-page\.is-immersive/);
});
