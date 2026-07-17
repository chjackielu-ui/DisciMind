import DOMPurify from 'dompurify'
import { getMe } from '../api/auth.js'
import {
  batchTeacherArtifacts, fetchPreparationWorkspaceFile, getTeacherArtifactDetail, getTeacherArtifacts,
  getTeacherCourses, getTeachingClasses, renameTeacherArtifact, retryPreparationResourceConversion,
  uploadKnowledgeDocument, downloadTeachingResource,
} from '../api/teacher.js'
import { downloadGeneratedArtifactExport } from '../api/marketplace.js'
import { getUser, getToken, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { LearningPdfViewer } from '../services/learning-pdf-viewer.js'

const state = {
  rows: [], total: 0, courses: [], classes: [], selected: new Set(), view: 'list', lifecycle: null,
  viewer: null, previewUrl: null, activePreview: null, loading: false, filtersOpen: false,
  filters: { category: 'all', q: '', course_id: '', source_type: '', status: '', file_ext: '', sort: 'updated_desc' },
}

const CATEGORY_TABS = [
  ['all', '全部'], ['uploads', '我的上传'], ['ai', 'AI 生成'], ['preparation', '智慧备课'], ['immersive', '沉浸式备课'],
  ['lesson', '教案'], ['handout', '学生讲义'], ['slides', '课件'], ['exam', '试卷'], ['report', '报告'], ['conversion', '转换文件'], ['failed', '失败任务'],
]

const STATUS_LABELS = { uploading: '上传中', parsing: '解析中', converting: '转换中', generating: '生成中', ready: '可用', partial_failed: '部分失败', failed: '失败', archived: '已归档', deleted: '已删除' }
const SOURCE_LABELS = { generated_artifact: 'AI / Agent', teacher_resource: '教学资源', editable_document: '教案文档' }
const ACTIVE_STATUS = new Set(['uploading', 'parsing', 'converting', 'generating'])

function formatDate(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }
function formatSize(value) { const bytes = Number(value || 0); return !bytes ? '—' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
function itemKey(item) { return `${item.source_type}:${item.source_id}` }
function payloadItem(item) { return { source_type: item.source_type, source_id: item.source_id } }
function iconText(item) { const ext = String(item.file_ext || '').toUpperCase(); return ext === 'DOC' ? 'DOC' : ext.slice(0, 4) || (item.source_type === 'editable_document' ? 'DOC' : 'FILE') }
function statusLabel(value) { return STATUS_LABELS[value] || value || '未知' }
function sanitizePreview(value) { return DOMPurify.sanitize(String(value || ''), { FORBID_TAGS: ['script', 'iframe', 'form', 'object', 'embed'], FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcdoc'] }) }

function shell() {
  return `<main class="teacher-artifact-center" data-drop-target>
    <header class="teacher-page-head artifact-head"><div><span class="teacher-eyebrow">文件与生成结果</span><h2>产物中心</h2><p>统一查看教师上传、智慧备课、沉浸式教案、AI / Agent 生成、导出与转换文件；资源审核仍保持独立。</p></div><div><input id="artifact-upload-input" type="file" multiple hidden accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.md,.png,.jpg,.jpeg,.webp,.gif"><button class="teacher-btn--secondary" id="artifact-refresh">刷新</button><button class="teacher-btn--primary" id="artifact-upload">上传文件</button></div></header>
    <section class="artifact-drop-note" id="artifact-drop-note"><b>可将文件拖到本页上传</b><span>PPT/PPTX 上传后会创建真实转换任务；未配置转换程序时保留原文件并显示可重试失败状态。</span></section>
    <nav class="artifact-category-tabs" id="artifact-category-tabs">${CATEGORY_TABS.map(([key, label]) => `<button data-category="${key}" class="${key === 'all' ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <button class="artifact-filter-toggle teacher-btn--secondary" id="artifact-filter-toggle" type="button" aria-expanded="false" aria-controls="artifact-filter-panel">筛选条件</button>
    <button class="artifact-filter-backdrop" id="artifact-filter-backdrop" type="button" aria-label="关闭筛选抽屉" hidden></button>
    <section class="artifact-filter-panel" id="artifact-filter-panel">
      <header class="artifact-filter-drawer-head"><b>筛选与排序</b><button class="teacher-btn--icon" id="artifact-filter-close" type="button" aria-label="关闭筛选">×</button></header>
      <label class="artifact-search"><span>搜索</span><input id="artifact-search" placeholder="名称、课程、来源"></label>
      <label><span>课程</span><select id="artifact-course"><option value="">全部课程</option></select></label>
      <label><span>来源</span><select id="artifact-source"><option value="">全部来源</option><option value="teacher_resource">教学资源</option><option value="generated_artifact">AI / Agent</option><option value="editable_document">教案文档</option></select></label>
      <label><span>状态</span><select id="artifact-status"><option value="">全部状态</option>${Object.entries(STATUS_LABELS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
      <label><span>文件</span><select id="artifact-file"><option value="">全部类型</option><option value="pdf">PDF</option><option value="docx">DOCX</option><option value="pptx">PPTX</option><option value="ppt">PPT</option><option value="md">Markdown</option><option value="txt">TXT</option><option value="image">图片</option></select></label>
      <label><span>排序</span><select id="artifact-sort"><option value="updated_desc">最近更新</option><option value="created_desc">最近创建</option><option value="title_asc">名称</option><option value="size_desc">文件大小</option></select></label>
      <div class="artifact-view-switch"><button class="active" data-view="list" aria-label="列表视图">列表</button><button data-view="card" aria-label="卡片视图">卡片</button></div>
    </section>
    <section class="artifact-summary" id="artifact-summary"></section>
    <section class="artifact-results" id="artifact-results"><div class="artifact-loading">正在读取真实产物…</div></section>
    <section class="artifact-batch-bar" id="artifact-batch-bar" hidden><span>已选 <b id="artifact-selected-count">0</b> 项</span><button data-batch="share">批量下发</button><button data-batch="retry">批量重试</button><button data-batch="archive">批量归档</button><button class="danger" data-batch="delete">批量删除</button><button data-clear-selection>取消选择</button></section>
    <dialog class="artifact-dialog artifact-preview-dialog" id="artifact-preview-dialog"><header><div><small id="artifact-preview-type">预览</small><h3 id="artifact-preview-title">产物预览</h3></div><button class="teacher-btn--icon" data-dialog-close aria-label="关闭">×</button></header><div class="artifact-preview-body" id="artifact-preview-body"></div><footer id="artifact-preview-footer"></footer></dialog>
    <dialog class="artifact-dialog artifact-share-dialog" id="artifact-share-dialog"><form method="dialog" id="artifact-share-form"><header><div><small>真实下发</small><h3>下发学生</h3></div><button class="teacher-btn--icon" value="cancel">×</button></header><div class="artifact-dialog-form"><label>课程<select id="artifact-share-course" required></select></label><label>教学班<select id="artifact-share-class" required><option value="">请选择教学班</option></select></label><label>下发用途<select id="artifact-share-type"><option value="course_material">课程资料</option><option value="pre_class_material">课前资料</option><option value="classroom_task">课堂任务</option><option value="homework_attachment">作业附件</option><option value="exam_attachment">考试附件</option></select></label><label>说明<textarea id="artifact-share-description" rows="3" placeholder="学生将看到这段说明"></textarea></label><p id="artifact-share-hint"></p></div><footer><button class="teacher-btn--secondary" value="cancel">取消</button><button class="teacher-btn--primary" id="artifact-share-submit" value="default">确认下发</button></footer></form></dialog>
  </main>`
}

function categoryMatch(item) {
  const category = state.filters.category; const type = String(item.artifact_type || '').toLowerCase(); const source = String(item.source_label || '').toLowerCase()
  if (category === 'all') return true
  if (category === 'uploads') return source.includes('上传')
  if (category === 'ai') return item.source_type === 'generated_artifact' || source.includes('ai') || source.includes('agent')
  if (category === 'preparation') return Boolean(item.lesson_plan_id) && item.source_type !== 'editable_document'
  if (category === 'immersive') return item.source_type === 'editable_document'
  if (category === 'lesson') return item.source_type === 'editable_document' || type.includes('lesson')
  if (category === 'handout') return type.includes('handout') || type.includes('讲义')
  if (category === 'slides') return ['ppt', 'pptx'].includes(item.file_ext) || type.includes('presentation') || type.includes('课件')
  if (category === 'exam') return type.includes('exam') || type.includes('paper') || type.includes('试卷')
  if (category === 'report') return type.includes('report') || type.includes('报告')
  if (category === 'conversion') return source.includes('转换') || type.includes('preview')
  if (category === 'failed') return item.status === 'failed' || item.status === 'partial_failed'
  return true
}

function visibleRows() {
  const imageTypes = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
  return state.rows.filter(item => categoryMatch(item) && (!state.filters.file_ext || (state.filters.file_ext === 'image' ? imageTypes.has(item.file_ext) : item.file_ext === state.filters.file_ext)))
}

function itemActions(item) {
  const active = ACTIVE_STATUS.has(item.status)
  return `<div class="artifact-actions"><button data-action="preview" ${item.previewable ? '' : 'disabled'}>预览</button>${item.downloadable ? '<button data-action="download">下载</button><button data-action="window">新窗口</button>' : ''}${item.source_type === 'editable_document' ? '<button data-action="edit">继续编辑</button>' : ''}<button data-action="rename">重命名</button><button data-action="share" ${active ? 'disabled' : ''}>下发</button>${item.status === 'failed' && item.source_type !== 'editable_document' ? '<button data-action="retry">重试</button>' : ''}<button data-action="archive">${item.status === 'archived' ? '取消归档' : '归档'}</button><button class="danger" data-action="delete" ${active ? 'disabled' : ''}>删除</button></div>`
}

function rowMarkup(item) {
  const key = itemKey(item); const selected = state.selected.has(key)
  return `<article class="artifact-row ${selected ? 'selected' : ''}" data-key="${escapeHtml(key)}"><label class="artifact-check"><input type="checkbox" data-select ${selected ? 'checked' : ''}><span></span></label><div class="artifact-file-icon is-${escapeHtml(item.file_ext || 'file')}">${escapeHtml(iconText(item))}</div><div class="artifact-main"><div><h3>${escapeHtml(item.title)}</h3><span class="artifact-status is-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></div><p>${escapeHtml([item.source_label, item.course_name, item.teaching_class_name, item.description].filter(Boolean).join(' · ') || '未关联上下文')}</p><small>V${item.version || 1} · ${formatSize(item.size_bytes)} · 更新于 ${formatDate(item.updated_at)}${item.distribution_count ? ` · 已下发 ${item.distribution_count} 次` : ''}</small></div><div class="artifact-type-meta"><b>${escapeHtml(item.file_ext?.toUpperCase() || 'DOC')}</b><span>${escapeHtml(SOURCE_LABELS[item.source_type] || item.source_label)}</span>${item.task_id ? `<a href="#/teacher/agent-tasks?task=${item.task_id}">任务 #${item.task_id}</a>` : ''}</div>${itemActions(item)}</article>`
}

function cardMarkup(item) {
  const key = itemKey(item); const selected = state.selected.has(key)
  return `<article class="artifact-card-v2 ${selected ? 'selected' : ''}" data-key="${escapeHtml(key)}"><header><label class="artifact-check"><input type="checkbox" data-select ${selected ? 'checked' : ''}><span></span></label><div class="artifact-file-icon is-${escapeHtml(item.file_ext || 'file')}">${escapeHtml(iconText(item))}</div><span class="artifact-status is-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></header><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml([item.source_label, item.course_name, item.teaching_class_name].filter(Boolean).join(' · ') || '未关联上下文')}</p><dl><div><dt>类型</dt><dd>${escapeHtml(item.file_ext?.toUpperCase() || '教案')}</dd></div><div><dt>版本</dt><dd>V${item.version || 1}</dd></div><div><dt>大小</dt><dd>${formatSize(item.size_bytes)}</dd></div><div><dt>下发</dt><dd>${item.distribution_count || 0}</dd></div></dl><small>${formatDate(item.updated_at)}</small>${itemActions(item)}</article>`
}

function renderRows() {
  const rows = visibleRows(); const root = document.getElementById('artifact-results'); if (!root) return
  document.getElementById('artifact-summary').innerHTML = `<span><b>${rows.length}</b> 当前结果</span><span><b>${state.rows.filter(item => item.status === 'ready').length}</b> 可用</span><span><b>${state.rows.filter(item => ACTIVE_STATUS.has(item.status)).length}</b> 处理中</span><span><b>${state.rows.filter(item => item.status === 'failed').length}</b> 失败</span><span><b>${state.rows.reduce((sum, item) => sum + Number(item.distribution_count || 0), 0)}</b> 下发记录</span>`
  root.className = `artifact-results is-${state.view}`
  root.innerHTML = rows.length ? (state.view === 'card' ? `<div class="artifact-card-grid">${rows.map(cardMarkup).join('')}</div>` : `<div class="artifact-list">${rows.map(rowMarkup).join('')}</div>`) : '<div class="artifact-empty"><b>没有匹配的产物</b><p>调整筛选，或上传真实文件。资源审核申请不会显示在这里。</p></div>'
  root.querySelectorAll('[data-key]').forEach(node => bindItem(node, state.rows.find(item => itemKey(item) === node.dataset.key)))
  updateBatchBar()
}

function updateBatchBar() {
  const bar = document.getElementById('artifact-batch-bar'); if (!bar) return
  bar.hidden = state.selected.size === 0; document.getElementById('artifact-selected-count').textContent = String(state.selected.size)
}

function setFilterDrawer(open) {
  state.filtersOpen = Boolean(open)
  const center = document.querySelector('.teacher-artifact-center')
  const panel = document.getElementById('artifact-filter-panel')
  const backdrop = document.getElementById('artifact-filter-backdrop')
  const toggle = document.getElementById('artifact-filter-toggle')
  center?.classList.toggle('filters-open', state.filtersOpen)
  document.getElementById('teacher-assistant-root')?.classList.toggle('overlay-suppressed', state.filtersOpen)
  panel?.classList.toggle('is-open', state.filtersOpen)
  if (backdrop) backdrop.hidden = !state.filtersOpen
  toggle?.setAttribute('aria-expanded', String(state.filtersOpen))
}

function queryParams() {
  return { page_size: 100, q: state.filters.q, course_id: state.filters.course_id, source_type: state.filters.source_type, status: state.filters.status, sort: state.filters.sort }
}

async function loadRows({ silent = false } = {}) {
  if (state.loading) return; state.loading = true
  const root = document.getElementById('artifact-results'); if (!silent && root) root.innerHTML = '<div class="artifact-loading">正在聚合教师产物、资源与教案版本…</div>'
  try {
    const response = await getTeacherArtifacts(queryParams()); state.rows = response.data?.list || []; state.total = response.data?.total || state.rows.length
    for (const key of [...state.selected]) if (!state.rows.some(item => itemKey(item) === key)) state.selected.delete(key)
    renderRows()
  } catch (error) { if (root) root.innerHTML = `<div class="artifact-empty error"><b>产物读取失败</b><p>${escapeHtml(error.message || '请稍后重试')}</p><button class="teacher-btn--secondary" data-retry-load>重试</button></div>`; root?.querySelector('[data-retry-load]')?.addEventListener('click', () => loadRows()) }
  finally { state.loading = false }
}

function setBusy(button, busy, text = '处理中…') { if (!button) return; if (busy) { button.dataset.label = button.textContent; button.textContent = text; button.disabled = true } else { button.textContent = button.dataset.label || button.textContent; button.disabled = false } }

async function cleanupPreview() {
  if (state.viewer) { await state.viewer.destroy().catch(() => {}); state.viewer = null }
  if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null }
  state.activePreview = null
}

function viewerMarkup() {
  return `<section class="artifact-pdf-viewer" id="artifact-pdf-viewer"><header><button data-pdf-prev>上一页</button><input data-pdf-page type="number" min="1" value="1"><span data-pdf-total>/ 1</span><button data-pdf-next>下一页</button><button data-pdf-out>−</button><span data-pdf-scale>100%</span><button data-pdf-in>＋</button><button data-pdf-fit>适合宽度</button><button data-pdf-download>下载</button><button data-pdf-window>新窗口</button></header><div class="lws-pdf-viewport" data-pdf-viewport><div class="lws-pdf-pages" data-pdf-pages></div><span class="lws-pdf-zoom-hint" data-pdf-zoom-hint></span></div></section>`
}

async function fetchItemFile(item, { preferPdf = false } = {}) {
  if (item.source_type === 'editable_document') throw new Error('教案请在沉浸式工作区继续编辑或导出')
  if (item.source_type === 'generated_artifact') {
    const format = preferPdf && item.formats?.includes('PDF') ? 'PDF' : item.formats?.includes('PDF') ? 'PDF' : item.formats?.[0] || 'DOCX'
    return fetchPreparationWorkspaceFile('artifact', item.source_id, { format, fallbackName: `${item.title}.${format.toLowerCase()}` })
  }
  const resourceId = preferPdf && item.output_resource_id ? item.output_resource_id : item.source_id
  return fetchPreparationWorkspaceFile('resource', resourceId, { fallbackName: item.title })
}

async function openPreview(item) {
  const dialog = document.getElementById('artifact-preview-dialog'); const body = document.getElementById('artifact-preview-body')
  await cleanupPreview(); state.activePreview = item
  document.getElementById('artifact-preview-title').textContent = item.title; document.getElementById('artifact-preview-type').textContent = `${SOURCE_LABELS[item.source_type] || '产物'} · ${statusLabel(item.status)}`
  document.getElementById('artifact-preview-footer').innerHTML = `<span>${escapeHtml(item.source_label || '')} · V${item.version || 1} · ${formatSize(item.size_bytes)}</span><div>${item.downloadable ? '<button class="teacher-btn--secondary" data-preview-download>下载</button>' : ''}${item.source_type === 'editable_document' ? '<button class="teacher-btn--primary" data-preview-edit>继续编辑</button>' : ''}</div>`
  body.innerHTML = '<div class="artifact-loading">正在加载受权限保护的预览…</div>'; dialog.showModal()
  try {
    const detail = (await getTeacherArtifactDetail(item.source_type, item.source_id)).data || {}
    if (detail.preview_html) body.innerHTML = `<article class="artifact-rich-preview">${sanitizePreview(detail.preview_html)}</article>`
    else if ((item.file_ext === 'pdf' || item.output_resource_id || item.formats?.includes('PDF'))) {
      const file = await fetchItemFile(item, { preferPdf: true }); body.innerHTML = viewerMarkup(); const root = document.getElementById('artifact-pdf-viewer')
      state.viewer = new LearningPdfViewer(root, { onStateChange(next) { root.querySelector('[data-pdf-page]').value = String(next.pageNumber || 1); root.querySelector('[data-pdf-page]').max = String(next.pageCount || 1); root.querySelector('[data-pdf-total]').textContent = `/ ${next.pageCount || 1}`; root.querySelector('[data-pdf-scale]').textContent = `${Math.round((next.scale || 1) * 100)}%` } })
      await state.viewer.load({ file: file.blob, name: file.filename, type: item.source_type })
      root.querySelector('[data-pdf-prev]').onclick = () => state.viewer.goTo(state.viewer.pageNumber - 1); root.querySelector('[data-pdf-next]').onclick = () => state.viewer.goTo(state.viewer.pageNumber + 1); root.querySelector('[data-pdf-page]').onchange = event => state.viewer.goTo(event.target.value); root.querySelector('[data-pdf-out]').onclick = () => state.viewer.zoomBy(-.1); root.querySelector('[data-pdf-in]').onclick = () => state.viewer.zoomBy(.1); root.querySelector('[data-pdf-fit]').onclick = () => state.viewer.fit(); root.querySelector('[data-pdf-download]').onclick = () => state.viewer.download(); root.querySelector('[data-pdf-window]').onclick = () => state.viewer.openWindow()
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(item.file_ext)) {
      const file = await fetchItemFile(item); state.previewUrl = URL.createObjectURL(file.blob); body.innerHTML = `<div class="artifact-image-preview"><img src="${state.previewUrl}" alt="${escapeHtml(item.title)}"></div>`
    } else if (['txt', 'md'].includes(item.file_ext)) {
      const file = await fetchItemFile(item); body.innerHTML = `<pre class="artifact-text-preview">${escapeHtml(await file.blob.text())}</pre>`
    } else body.innerHTML = `<div class="artifact-empty"><b>该格式暂不支持安全内嵌预览</b><p>可以下载原文件，或在沉浸式教案工作区打开 DOCX / PPTX。</p></div>`
    document.querySelector('[data-preview-download]')?.addEventListener('click', event => downloadItem(item, event.currentTarget))
    document.querySelector('[data-preview-edit]')?.addEventListener('click', () => { window.location.hash = `#/teacher/preparation/immersive?document_id=${item.source_id}` })
  } catch (error) { body.innerHTML = `<div class="artifact-empty error"><b>预览失败</b><p>${escapeHtml(error.message || '文件暂不可预览')}</p></div>` }
}

async function downloadItem(item, button) {
  setBusy(button, true, '下载中…')
  try {
    if (item.source_type === 'generated_artifact') { const format = item.formats?.includes('PDF') ? 'PDF' : item.formats?.[0] || 'DOCX'; await downloadGeneratedArtifactExport(item.source_id, format, `${item.title}.${format.toLowerCase()}`) }
    else if (item.source_type === 'teacher_resource') await downloadTeachingResource(item.source_id, item.title)
    else throw new Error('请先在教案工作区导出 DOCX 或 PDF')
  } catch (error) { showToast(error.message || '下载失败', 'error') } finally { setBusy(button, false) }
}

async function openWindow(item, button) {
  setBusy(button, true, '打开中…')
  try { const file = await fetchItemFile(item, { preferPdf: true }); const url = URL.createObjectURL(file.blob); window.open(url, '_blank', 'noopener,noreferrer'); setTimeout(() => URL.revokeObjectURL(url), 60000) }
  catch (error) { showToast(error.message || '无法打开文件', 'error') } finally { setBusy(button, false) }
}

async function runSingle(item, action, button) {
  if (action === 'preview') return openPreview(item)
  if (action === 'download') return downloadItem(item, button)
  if (action === 'window') return openWindow(item, button)
  if (action === 'edit') { window.location.hash = `#/teacher/preparation/immersive?document_id=${item.source_id}`; return }
  if (action === 'share') return openShareDialog([item])
  if (action === 'rename') { const title = prompt('输入新的产物名称', item.title); if (!title?.trim() || title.trim() === item.title) return; setBusy(button, true); try { await renameTeacherArtifact(item.source_type, item.source_id, title.trim()); showToast('产物已重命名', 'success'); await loadRows({ silent: true }) } catch (error) { showToast(error.message || '重命名失败', 'error') } finally { setBusy(button, false) }; return }
  if (action === 'delete' && !confirm(`删除“${item.title}”？已下发版本不会被静默覆盖或移除。`)) return
  const operation = action === 'archive' && item.status === 'archived' ? 'unarchive' : action
  setBusy(button, true)
  try { const result = await batchTeacherArtifacts(operation, [payloadItem(item)]); const failed = result.data?.failedItems || []; if (failed.length) throw new Error(failed[0].message); showToast(operation === 'delete' ? '产物已删除' : operation === 'retry' ? '重试任务已创建' : operation === 'archive' ? '产物已归档' : '已取消归档', 'success'); await loadRows({ silent: true }) }
  catch (error) { showToast(error.message || '操作失败', 'error') } finally { setBusy(button, false) }
}

function bindItem(node, item) {
  if (!item) return
  node.querySelector('[data-select]').onchange = event => { const key = itemKey(item); event.target.checked ? state.selected.add(key) : state.selected.delete(key); node.classList.toggle('selected', event.target.checked); updateBatchBar() }
  node.querySelectorAll('[data-action]').forEach(button => button.onclick = () => runSingle(item, button.dataset.action, button))
}

async function loadClasses(courseId) {
  const select = document.getElementById('artifact-share-class'); select.innerHTML = '<option value="">正在读取教学班…</option>'
  if (!courseId) { select.innerHTML = '<option value="">请先选择课程</option>'; return }
  try { const response = await getTeachingClasses(courseId, { page_size: 100 }); state.classes = response.data?.list || response.data || []; select.innerHTML = '<option value="">请选择教学班</option>' + state.classes.map(item => `<option value="${item.teaching_class_id}">${escapeHtml(item.teaching_class_name)}</option>`).join('') }
  catch (error) { select.innerHTML = `<option value="">${escapeHtml(error.message || '教学班加载失败')}</option>` }
}

function selectedItems() { return state.rows.filter(item => state.selected.has(itemKey(item))) }

async function openShareDialog(items) {
  if (!items.length) return; const dialog = document.getElementById('artifact-share-dialog'); dialog.dataset.items = JSON.stringify(items.map(payloadItem))
  const preferredCourse = items.every(item => Number(item.course_id) === Number(items[0].course_id)) ? items[0].course_id : ''
  const course = document.getElementById('artifact-share-course'); course.innerHTML = '<option value="">请选择课程</option>' + state.courses.map(item => `<option value="${item.course_id}">${escapeHtml(item.course_name)}</option>`).join(''); course.value = preferredCourse || ''
  document.getElementById('artifact-share-hint').textContent = `将对 ${items.length} 项逐项校验权限；一个失败不会影响其他产物。`; await loadClasses(course.value); dialog.showModal()
}

async function submitShare(event) {
  event.preventDefault(); const button = document.getElementById('artifact-share-submit'); const dialog = document.getElementById('artifact-share-dialog'); const items = JSON.parse(dialog.dataset.items || '[]'); const classId = Number(document.getElementById('artifact-share-class').value)
  if (!classId) { showToast('请选择教学班', 'warning'); return }
  setBusy(button, true, '下发中…')
  try { const result = await batchTeacherArtifacts('share', items, { teaching_class_id: classId, distribution_type: document.getElementById('artifact-share-type').value, description: document.getElementById('artifact-share-description').value.trim(), operation_id: crypto.randomUUID() }); const failed = result.data?.failedItems || []; const succeeded = result.data?.successIds?.length || 0; dialog.close(); showToast(failed.length ? `成功 ${succeeded} 项，失败 ${failed.length} 项：${failed[0].message}` : `已下发 ${succeeded} 项，学生端和通知已更新`, failed.length ? 'warning' : 'success'); state.selected.clear(); await loadRows({ silent: true }) }
  catch (error) { showToast(error.message || '下发失败', 'error') } finally { setBusy(button, false) }
}

async function runBatch(action, button) {
  const items = selectedItems(); if (!items.length) return
  if (action === 'share') return openShareDialog(items)
  if (action === 'delete' && !confirm(`逐项删除选中的 ${items.length} 个产物？运行中任务会被拒绝。`)) return
  setBusy(button, true)
  try { const result = await batchTeacherArtifacts(action, items.map(payloadItem)); const failed = result.data?.failedItems || []; const success = result.data?.successIds?.length || 0; showToast(failed.length ? `成功 ${success} 项，失败 ${failed.length} 项：${failed[0].message}` : `已完成 ${success} 项操作`, failed.length ? 'warning' : 'success'); state.selected.clear(); await loadRows({ silent: true }) }
  catch (error) { showToast(error.message || '批量操作失败', 'error') } finally { setBusy(button, false) }
}

async function uploadFiles(files) {
  const accepted = [...files].filter(file => file.size > 0); if (!accepted.length) return
  const button = document.getElementById('artifact-upload'); setBusy(button, true, `上传 0/${accepted.length}`); let success = 0; const failures = []
  for (const file of accepted) {
    try { const form = new FormData(); form.append('file', file); form.append('title', file.name.replace(/\.[^.]+$/, '')); form.append('scope_type', 'personal'); form.append('visibility', 'private'); form.append('is_teaching_resource', 'true'); form.append('resource_kind', file.name.split('.').pop()?.toLowerCase() || 'file'); form.append('resource_category', '我的上传'); const response = await uploadKnowledgeDocument(form); const id = response.data?.document_id; if (/\.pptx?$/i.test(file.name) && id) await retryPreparationResourceConversion(id); success += 1; button.textContent = `上传 ${success}/${accepted.length}` } catch (error) { failures.push(`${file.name}：${error.message}`) }
  }
  setBusy(button, false); showToast(failures.length ? `上传成功 ${success} 个，失败 ${failures.length} 个：${failures[0]}` : `已上传 ${success} 个文件`, failures.length ? 'warning' : 'success'); await loadRows({ silent: true })
}

function bind() {
  state.lifecycle?.abort(); state.lifecycle = new AbortController(); const signal = state.lifecycle.signal
  document.getElementById('artifact-category-tabs').addEventListener('click', event => { const button = event.target.closest('[data-category]'); if (!button) return; state.filters.category = button.dataset.category; document.querySelectorAll('[data-category]').forEach(item => item.classList.toggle('active', item === button)); renderRows() }, { signal })
  let searchTimer; document.getElementById('artifact-search').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.filters.q = event.target.value.trim(); loadRows() }, 260) }, { signal })
  for (const [id, key] of [['artifact-course', 'course_id'], ['artifact-source', 'source_type'], ['artifact-status', 'status'], ['artifact-sort', 'sort']]) document.getElementById(id).addEventListener('change', event => { state.filters[key] = event.target.value; loadRows() }, { signal })
  document.getElementById('artifact-file').addEventListener('change', event => { state.filters.file_ext = event.target.value; renderRows() }, { signal })
  document.querySelector('.artifact-view-switch').addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (!button) return; state.view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button)); renderRows() }, { signal })
  document.getElementById('artifact-filter-toggle').addEventListener('click', () => setFilterDrawer(!state.filtersOpen), { signal })
  document.getElementById('artifact-filter-close').addEventListener('click', () => setFilterDrawer(false), { signal })
  document.getElementById('artifact-filter-backdrop').addEventListener('click', () => setFilterDrawer(false), { signal })
  document.getElementById('artifact-refresh').addEventListener('click', () => loadRows(), { signal }); document.getElementById('artifact-upload').addEventListener('click', () => document.getElementById('artifact-upload-input').click(), { signal }); document.getElementById('artifact-upload-input').addEventListener('change', event => { uploadFiles(event.target.files); event.target.value = '' }, { signal })
  const dropTarget = document.querySelector('[data-drop-target]'); dropTarget.addEventListener('dragover', event => { event.preventDefault(); dropTarget.classList.add('is-dragging') }, { signal }); dropTarget.addEventListener('dragleave', event => { if (!dropTarget.contains(event.relatedTarget)) dropTarget.classList.remove('is-dragging') }, { signal }); dropTarget.addEventListener('drop', event => { event.preventDefault(); dropTarget.classList.remove('is-dragging'); uploadFiles(event.dataTransfer.files) }, { signal })
  document.getElementById('artifact-batch-bar').addEventListener('click', event => { const button = event.target.closest('[data-batch]'); if (button) runBatch(button.dataset.batch, button); if (event.target.closest('[data-clear-selection]')) { state.selected.clear(); renderRows() } }, { signal })
  document.querySelectorAll('[data-dialog-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close(), { signal })); document.getElementById('artifact-preview-dialog').addEventListener('close', () => cleanupPreview(), { signal }); document.getElementById('artifact-share-course').addEventListener('change', event => loadClasses(event.target.value), { signal }); document.getElementById('artifact-share-form').addEventListener('submit', submitShare, { signal })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.filtersOpen) setFilterDrawer(false) }, { signal })
  window.addEventListener('hashchange', () => { if (!window.location.hash.startsWith('#/teacher/artifacts')) { state.lifecycle?.abort(); cleanupPreview() } }, { signal })
}

async function loadCourses() {
  try { const response = await getTeacherCourses({ page_size: 100 }); state.courses = response.data?.list || []; document.getElementById('artifact-course').innerHTML = '<option value="">全部课程</option>' + state.courses.map(item => `<option value="${item.course_id}">${escapeHtml(item.course_name)}</option>`).join('') } catch { state.courses = [] }
}

export async function renderTeacherArtifacts(app) {
  let user = getUser(); try { const response = await getMe(); user = response.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }
  state.selected.clear(); renderDashboardLayout(app, { title: '产物中心', menuItems: TEACHER_MENU_ITEMS, contentHTML: shell(), user }); bind(); await Promise.all([loadCourses(), loadRows()])
}

const GENERATED_DETAIL_STATUS = {
  DRAFT: '准备中', GENERATING: '生成中', CONTENT_READY: '内容已生成', EXPORTING: '导出中', READY: '可下载',
  FAILED: '生成失败', EXPIRED: '已过期', DELETING: '删除中', DELETED: '已删除', DOWNLOADABLE: '可下载', CANCELLED: '已取消',
}

function detailStatus(artifact) {
  return GENERATED_DETAIL_STATUS[artifact.publicStatus] || GENERATED_DETAIL_STATUS[artifact.status] || artifact.status || '处理中'
}

function detailMeta(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd></div>`
}

function artifactDetailMarkup(artifact) {
  const exports = artifact.exports || []
  const readyExports = exports.filter(item => item.downloadAvailable && item.status === 'READY')
  const requirements = artifact.requirements || {}
  const points = artifact.knowledgePoints?.map(item => item.name || item.title).filter(Boolean)
    || requirements.knowledgePointNames || []
  const active = ['DRAFT', 'GENERATING', 'CONTENT_READY', 'EXPORTING'].includes(artifact.status)
    || ['QUEUED', 'RUNNING'].includes(artifact.sourceTask?.status)
  const failed = artifact.status === 'FAILED' || artifact.publicStatus === 'FAILED'
  const aiHash = artifact.sourceAiConversationId ? `#/teacher/ai?conversationId=${artifact.sourceAiConversationId}` : '#/teacher/ai'
  const formatNames = exports.length ? exports.map(item => item.format).join('、') : requirements.outputFormats?.join('、') || artifact.fileFormat || '待生成'
  const requirementText = requirements.specialRequirements || requirements.prompt || requirements.request || artifact.description || '按当前课程与知识范围生成'
  return `<main class="teacher-artifact-detail-page" data-artifact-id="${escapeHtml(artifact.id)}">
    <nav class="teacher-artifact-detail-breadcrumb" aria-label="面包屑"><a href="#/teacher/artifacts">产物中心</a><span>/</span><span>AI 生成详情</span></nav>
    <section class="teacher-artifact-detail-hero">
      <div><span class="teacher-eyebrow">TEACHING ARTIFACT</span><h2>${escapeHtml(artifact.title || '未命名产物')}</h2><p>教师端生成结果与导出状态，仅展示本次任务的数据。</p></div>
      <div class="teacher-artifact-detail-actions">
        <span class="artifact-status is-${active ? 'generating' : failed ? 'failed' : 'ready'}">${escapeHtml(detailStatus(artifact))}</span>
        <a class="teacher-btn--secondary" href="${escapeHtml(aiHash)}">返回教师 AI</a>
        ${artifact.taskId ? `<a class="teacher-btn--secondary" href="#/teacher/agent-tasks?task=${artifact.taskId}">查看任务</a>` : ''}
        ${failed ? '<button class="teacher-btn--secondary" type="button" data-detail-retry>重新生成</button>' : ''}
        <button class="teacher-btn--secondary danger" type="button" data-detail-delete ${active ? 'disabled' : ''}>删除</button>
      </div>
    </section>
    <section class="teacher-artifact-detail-grid">
      <article class="teacher-artifact-detail-panel teacher-artifact-detail-overview"><header><div><span>任务信息</span><h3>本次生成上下文</h3></div></header><dl>
        ${detailMeta('产物类型', artifact.artifactType === 'EXAM_PAPER' ? '试卷' : artifact.artifactType === 'STUDY_HANDOUT' ? '教学讲义' : artifact.artifactType)}
        ${detailMeta('课程', artifact.course?.name)}
        ${detailMeta('知识范围', points.length ? points.join('、') : '课程范围')}
        ${detailMeta('来源助手', artifact.sourceAgent?.name || '系统文件生成助手')}
        ${detailMeta('输出格式', formatNames)}
        ${detailMeta('创建时间', formatDate(artifact.createdAt))}
      </dl></article>
      <article class="teacher-artifact-detail-panel teacher-artifact-detail-exports"><header><div><span>文件导出</span><h3>可下载版本</h3></div></header>
        ${exports.length ? `<div class="teacher-artifact-export-list">${exports.map(item => `<div><span class="teacher-artifact-format">${escapeHtml(item.format)}</span><div><b>${escapeHtml(item.status === 'READY' && item.downloadAvailable ? '已就绪' : item.status === 'FAILED' ? '导出失败' : '处理中')}</b><small>${item.fileSizeBytes ? formatSize(item.fileSizeBytes) : '服务器生成文件'}</small></div>${item.status === 'READY' && item.downloadAvailable ? `<button type="button" data-detail-download="${escapeHtml(item.format)}">下载</button>` : ''}</div>`).join('')}</div>` : `<div class="teacher-artifact-detail-empty"><b>${active ? '正在生成文件' : '暂无导出文件'}</b><p>${active ? '页面会自动刷新任务状态。' : '可在任务失败后重新生成。'}</p></div>`}
      </article>
    </section>
    <section class="teacher-artifact-detail-panel teacher-artifact-detail-request"><header><div><span>生成指令</span><h3>本次任务要求</h3></div></header><p>${escapeHtml(requirementText)}</p></section>
    <section class="teacher-artifact-detail-panel teacher-artifact-detail-preview"><header><div><span>安全预览</span><h3>生成内容</h3></div><small>已过滤脚本、表单和嵌入内容</small></header>
      ${artifact.preview_html ? `<article class="artifact-rich-preview">${sanitizePreview(artifact.preview_html)}</article>` : `<div class="teacher-artifact-detail-empty"><b>${active ? '预览正在生成' : failed ? '本次生成未完成' : '暂无可预览内容'}</b><p>${active ? '生成完成后将自动显示。' : failed ? '可点击重新生成继续处理。' : '请从可下载版本获取文件。'}</p></div>`}
    </section>
  </main>`
}

function artifactDetailLoading() {
  return `<main class="teacher-artifact-detail-page"><nav class="teacher-artifact-detail-breadcrumb"><a href="#/teacher/artifacts">产物中心</a><span>/</span><span>生成详情</span></nav><div class="artifact-loading">正在读取教师产物与任务状态…</div></main>`
}

function bindArtifactDetail(app, artifact, user) {
  const root = document.querySelector('.teacher-artifact-detail-page')
  const rerender = () => renderTeacherArtifactDetail(app, { id: String(artifact.id) })
  root?.querySelectorAll('[data-detail-download]').forEach(button => button.addEventListener('click', async () => {
    setBusy(button, true, '下载中…')
    try { await downloadGeneratedArtifactExport(artifact.id, button.dataset.detailDownload, `${artifact.title}.${button.dataset.detailDownload.toLowerCase()}`) }
    catch (error) { showToast(error.message || '下载失败', 'error') }
    finally { setBusy(button, false) }
  }))
  root?.querySelector('[data-detail-retry]')?.addEventListener('click', async event => {
    setBusy(event.currentTarget, true, '提交中…')
    try { await batchTeacherArtifacts('retry', [{ source_type: 'generated_artifact', source_id: artifact.id }]); showToast('重新生成任务已创建', 'success'); await rerender() }
    catch (error) { showToast(error.message || '重试失败', 'error'); setBusy(event.currentTarget, false) }
  })
  root?.querySelector('[data-detail-delete]')?.addEventListener('click', async event => {
    if (!window.confirm(`确认删除“${artifact.title}”？`)) return
    setBusy(event.currentTarget, true, '删除中…')
    try { await batchTeacherArtifacts('delete', [{ source_type: 'generated_artifact', source_id: artifact.id }]); showToast('产物已删除', 'success'); window.location.hash = '#/teacher/artifacts' }
    catch (error) { showToast(error.message || '删除失败', 'error'); setBusy(event.currentTarget, false) }
  })
  const active = ['DRAFT', 'GENERATING', 'CONTENT_READY', 'EXPORTING'].includes(artifact.status)
    || ['QUEUED', 'RUNNING'].includes(artifact.sourceTask?.status)
  if (active) {
    const timer = window.setTimeout(() => {
      if (window.location.hash === `#/teacher/artifacts/${artifact.id}`) rerender()
    }, 2500)
    window.addEventListener('hashchange', () => window.clearTimeout(timer), { once: true })
  }
}

export async function renderTeacherArtifactDetail(app, params) {
  let user = getUser()
  try { const response = await getMe(); user = response.data.user; setAuth(getToken(), user) }
  catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }
  renderDashboardLayout(app, { title: '产物详情', menuItems: TEACHER_MENU_ITEMS, contentHTML: artifactDetailLoading(), user })
  try {
    const artifact = (await getTeacherArtifactDetail('generated_artifact', params.id)).data || {}
    renderDashboardLayout(app, { title: '产物详情', menuItems: TEACHER_MENU_ITEMS, contentHTML: artifactDetailMarkup(artifact), user })
    bindArtifactDetail(app, artifact, user)
  } catch (error) {
    const root = document.querySelector('.teacher-artifact-detail-page')
    if (root) root.innerHTML = `<nav class="teacher-artifact-detail-breadcrumb"><a href="#/teacher/artifacts">产物中心</a><span>/</span><span>读取失败</span></nav><div class="artifact-empty error"><b>无法打开此教师产物</b><p>${escapeHtml(error.message || '产物不存在或无权访问')}</p><a class="teacher-btn--secondary" href="#/teacher/artifacts">返回产物中心</a></div>`
  }
}
