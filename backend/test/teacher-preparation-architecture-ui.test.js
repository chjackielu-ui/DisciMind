const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const frontend = (...parts) => path.resolve(__dirname, '../../frontend/src', ...parts);

test('wisdom preparation and immersive preparation are independent routes and modules', async () => {
  const router = await fs.readFile(frontend('utils/router.js'), 'utf8');
  const workbench = await fs.readFile(frontend('pages/teacher-preparation.js'), 'utf8');
  const immersive = await fs.readFile(frontend('pages/teacher-preparation-immersive.js'), 'utf8');
  const navigation = await fs.readFile(frontend('components/teacher-secondary-nav.js'), 'utf8');
  assert.match(router, /'\/teacher\/preparation':\s*\{\s*render:\s*renderTeacherPreparation/);
  assert.match(router, /'\/teacher\/preparation\/immersive':\s*\{\s*render:\s*renderTeacherPreparationImmersive/);
  assert.match(workbench, /class="preparation-page preparation-workbench teacher-workbench"/);
  assert.doesNotMatch(workbench, /prep-ppt-panel|doc-pdf-viewer|document-editor/);
  assert.match(immersive, /class="preparation-page preparation-immersive teacher-workbench"/);
  assert.match(navigation, /沉浸式备课/);
});

test('stage selection stays in the workbench and document readers use continuous anchored zoom', async () => {
  const workbench = await fs.readFile(frontend('pages/teacher-preparation.js'), 'utf8');
  const immersive = await fs.readFile(frontend('pages/teacher-preparation-immersive.js'), 'utf8');
  const viewer = await fs.readFile(frontend('services/learning-pdf-viewer.js'), 'utf8');
  assert.match(workbench, /function switchStep\(index\)/);
  assert.doesNotMatch(workbench, /prep-stage-dialog/);
  assert.match(immersive, /handleDocumentWheel/);
  assert.match(immersive, /pointerX/);
  assert.match(immersive, /style\.zoom/);
  assert.match(viewer, /IntersectionObserver/);
  assert.match(viewer, /RENDER_RADIUS = 3/);
  assert.match(viewer, /requestAnimationFrame\(\(\) => \{/);
  assert.match(viewer, /restoreAnchor\(anchor, next \/ previous\)/);
});

test('PPT import exposes real upload states and an honest conversion boundary', async () => {
  const immersive = await fs.readFile(frontend('pages/teacher-preparation-immersive.js'), 'utf8');
  const backend = await fs.readFile(path.resolve(__dirname, '../src/services/teacher-preparation-document.service.js'), 'utf8');
  const conversion = await fs.readFile(path.resolve(__dirname, '../src/services/document-conversion.service.js'), 'utf8');
  assert.match(immersive, /dragging-over/);
  assert.match(immersive, /handlePptFile/);
  assert.match(immersive, /正在等待服务器生成 PDF 预览/);
  assert.match(immersive, /data-ppt-retry/);
  assert.match(backend, /preview_unavailable/);
  assert.match(backend, /documentConversionService\.startConversion/);
  assert.match(conversion, /--headless/);
  assert.match(conversion, /-env:UserInstallation=/);
  assert.match(conversion, /pathToFileURL\(userInstallation\)\.href/);
  assert.match(conversion, /spawn\(executable, args,/);
  assert.doesNotMatch(conversion, /shell:\s*true/);
  assert.match(conversion, /buffer\.subarray\(0, 5\)\.toString\(\) !== '%PDF-'/);
  assert.match(conversion, /PPT_CONVERTER_UNAVAILABLE/);
  assert.match(conversion, /lockedBy:\s*null/);
  assert.match(conversion, /attemptCount:\s*0/);
  const asyncWorker = await fs.readFile(path.resolve(__dirname, '../src/modules/async-task/async-task.worker.js'), 'utf8');
  assert.match(asyncWorker, /PPT_CONVERSION_OPERATION_PREFIX\s*=\s*'DOCUMENT_EXPORT:ppt-convert-'/);
  assert.match(asyncWorker, /NOT:\s*\{\s*operationId:\s*\{\s*startsWith:\s*PPT_CONVERSION_OPERATION_PREFIX/);
  assert.match(backend, /PPTX 文件头校验失败/);
  assert.match(backend, /file_checksum/);
});

test('compact workspace and dock layout keep three panes stateful without a mobile overlay', async () => {
  const immersive = await fs.readFile(frontend('pages/teacher-preparation-immersive.js'), 'utf8');
  const styles = await fs.readFile(frontend('styles/teacher-workbench.css'), 'utf8');
  assert.match(immersive, /const PANE_IDS = \['presentation', 'assistant', 'document'\]/);
  assert.match(immersive, /id="prep-row-splitter"/);
  assert.match(immersive, /id="prep-splitter"/);
  assert.match(immersive, /function applyDockLayout/);
  assert.match(immersive, /function dockPaneToSlot/);
  assert.match(immersive, /addEventListener\('pointerdown'/);
  assert.match(immersive, /document\.elementFromPoint\(clientX, clientY\)/);
  assert.match(immersive, /Alt \+ 方向键可交换位置/);
  assert.match(immersive, /layoutStorageKey\(planId/);
  assert.match(immersive, /querySelectorAll\('\.prep-mobile-surfaces \[data-compact-pane\]'\)/);
  assert.match(immersive, /querySelectorAll\('\.prep-mobile-surfaces \[data-mobile-surface\]'\)/);
  assert.doesNotMatch(immersive, /mobile-ai-open/);
  assert.match(styles, /\.doc-editor-layout\.outline-closed \{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.match(styles, /\.doc-editor-layout\.outline-closed \.doc-outline \{ display:none;/);
  assert.match(styles, /touch-action:none/);
  assert.match(styles, /button\.is-target/);
});

test('stage refinement is previewed before a teacher applies and versions it', async () => {
  const workbench = await fs.readFile(frontend('pages/teacher-preparation.js'), 'utf8');
  const styles = await fs.readFile(frontend('styles/teacher-workbench.css'), 'utf8');
  const service = await fs.readFile(path.resolve(__dirname, '../src/services/teacher-preparation.service.js'), 'utf8');
  assert.match(workbench, /id="prep-refine-dialog"/);
  assert.match(workbench, /preview_only: true/);
  assert.match(workbench, /function applyRefinementPreview\(\)/);
  assert.match(workbench, /AI 局部优化：\$\{pending\.stageLabel\}/);
  assert.match(service, /body\.preview_only === true/);
  assert.match(service, /status: 'preview_ready'/);
  assert.match(service, /aiChatService\.createCompletionStream/);
  assert.match(service, /teacherAnalyticsService\.buildWorkbench/);
  assert.match(styles, /body:has\(\.preparation-workbench\) \.teacher-ai-float\{display:none\}/);
  assert.match(styles, /\.preparation-workbench \.prep-center-scroll\{display:grid/);
  assert.match(styles, /\.preparation-workbench \.prep-plan-actions\{position:static/);
  assert.match(styles, /\.preparation-workbench \.prep-center-actions\{position:static/);
});
