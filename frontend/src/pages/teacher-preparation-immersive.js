import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { getMe } from '../api/auth.js'
import {
  getTeacherCourses, getTeachingClasses, getChapters,
  getPreparationPlans, createPreparationPlan, getPreparationPlan, savePreparationPlan,
  generatePreparationPlan, getPreparationStatus, streamPreparationEvents,
  getPreparationVersions, restorePreparationVersion, publishPreparationPlan, exportPreparationPlan,
  getAnalyticsWorkbench, getTeachingResources, refinePreparationStage,
  getEditableTeachingDocuments, createEditableTeachingDocument, getEditableTeachingDocument,
  saveEditableTeachingDocument, createEditableTeachingDocumentVersion,
  getEditableTeachingDocumentVersions, getEditableTeachingDocumentVersion,
  compareEditableTeachingDocumentVersions, restoreEditableTeachingDocumentVersion,
  importPreparationDocument, importPreparationPlatformFile, getPreparationSelectableResources,
  retryPreparationResourceConversion,
  syncEditableTeachingDocumentStage,
  exportEditableTeachingDocument, generateEditableStudentMaterial,
  createTeacherAiConversation, getTeacherAiMessages, streamTeacherAiMessage,
  uploadTeacherAiAttachment, clearTeacherAiConversation,
} from '../api/teacher.js'
import { getUser, getToken, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml, formatRelativeTime } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { normalizeWeakKnowledgePoints, normalizeKeywords, percent } from '../utils/analytics-contract.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js'
import { LearningPdfViewer } from '../services/learning-pdf-viewer.js'
import { BASE_URL } from '../api/request.js'

const WORKSPACE_KEY = 'discimind.preparationDocumentWorkspace.v1'
const LAYOUT_KEY_PREFIX = 'discimind.teacherPreparationLayout.v1'
const LAYOUT_VERSION = 1
const DRAFT_PREFIX = 'discimind.preparationDocumentDraft.'
const SAVE_DELAY = 1100
const ACCEPTED_FILES = new Set(['ppt', 'pptx', 'docx', 'pdf', 'md', 'txt'])
const DEFAULT_STEPS = [
  ['classProfile', '教学背景'], ['studentAnalytics', '学情诊断'], ['teachingObjectives', '教学目标'],
  ['keyAndDifficultPoints', '教学重难点'], ['timeAllocation', '教学流程'],
  ['lessonIntroduction', '课堂引入'], ['activities', '教学活动'], ['questions', '提问设计'],
  ['exercises', '例题和练习'], ['differentiatedInstruction', '分层教学'], ['assessments', '课堂评价'],
  ['homework', '作业设计'], ['resources', '教学资源'], ['reviewResult', '质量检查'],
]
const STEP_LABELS = Object.fromEntries(DEFAULT_STEPS)
const SECTION_STAGE = {
  教学背景: 'classProfile', 学情分析: 'studentAnalytics', 教学目标: 'teachingObjectives', 教学重点: 'keyPoints',
  教学难点: 'difficultPoints', 教学过程: 'timeAllocation', 课堂引入: 'lessonIntroduction', 教学活动: 'activities',
  提问设计: 'questions', 例题与练习: 'exercises', 分层教学: 'differentiatedInstruction', 课堂评价: 'assessments',
  作业设计: 'homework', 教学资源: 'resources',
}
const LESSON_TYPES = ['新授课', '复习课', '实验课', '研讨课', '项目式课程', '翻转课堂', '混合式教学', '任务驱动课', '概念课', '习题课']
const PANE_IDS = ['presentation', 'assistant', 'document']
const SLOT_IDS = ['leftTop', 'leftBottom', 'right']

function defaultLayout() {
  return {
    version: LAYOUT_VERSION,
    preset: 'all',
    horizontalRatio: 60,
    leftVerticalRatio: 61,
    slots: { leftTop: 'presentation', leftBottom: 'assistant', right: 'document' },
    panes: {
      presentation: { hidden: false, collapsed: false },
      assistant: { hidden: false, collapsed: false },
      document: { hidden: false, collapsed: false },
    },
    focus: null,
    compactPane: 'presentation',
  }
}

function normalizeLayout(value = {}) {
  const fallback = defaultLayout()
  if (Number(value.version) !== LAYOUT_VERSION) return fallback
  const used = new Set()
  const slots = {}
  SLOT_IDS.forEach(slot => {
    const pane = value.slots?.[slot]
    if (PANE_IDS.includes(pane) && !used.has(pane)) { slots[slot] = pane; used.add(pane) }
  })
  const remaining = PANE_IDS.filter(pane => !used.has(pane))
  SLOT_IDS.forEach(slot => { if (!slots[slot]) slots[slot] = remaining.shift() || fallback.slots[slot] })
  const panes = Object.fromEntries(PANE_IDS.map(pane => [pane, {
    hidden: value.panes?.[pane]?.hidden === true,
    collapsed: value.panes?.[pane]?.collapsed === true,
  }]))
  return {
    ...fallback,
    ...value,
    version: LAYOUT_VERSION,
    horizontalRatio: Math.min(72, Math.max(38, Number(value.horizontalRatio) || fallback.horizontalRatio)),
    leftVerticalRatio: Math.min(78, Math.max(30, Number(value.leftVerticalRatio) || fallback.leftVerticalRatio)),
    slots,
    panes,
    focus: PANE_IDS.includes(value.focus) ? value.focus : null,
    compactPane: PANE_IDS.includes(value.compactPane) ? value.compactPane : fallback.compactPane,
  }
}

const state = {
  userId: 'teacher', layout: defaultLayout(), layoutFrame: 0, draggedPane: null,
  courses: [], classes: [], plans: [], resources: [], selectable: [], editableDocuments: [],
  courseId: '', classId: '', plan: null, content: {}, locked: [], stepIndex: 0, versions: [],
  analytics: null, generation: null, eventAbort: null, pendingGeneration: null,
  document: null, tabs: [], activeTab: null, mode: 'edit', outlineOpen: true, currentSection: '', docZoom: 1, docZoomFrame: 0, docZoomHintTimer: 0, pendingDocZoom: null,
  saveTimer: 0, saveInFlight: false, savePromise: null, saveQueued: false, editEpoch: 0, pendingRevisionType: 'teacher_manual', pendingInstruction: '', conflict: null,
  savedRange: null, selection: { start: 0, end: 0, text: '' }, recovery: null,
  pdfViewer: null, pdfSource: null, pdfState: { pageNumber: 1, pageCount: 0, scale: 1, fitWidth: true },
  split: 62, dragState: 'default', pendingFile: null, resourcePoller: 0, pptPoller: 0,
  ppt: { resourceId: null, sourceKind: 'resource', slideIndex: 0, pageCount: 0, zoom: 1, localNotes: {}, status: 'default', objectUrl: null, pdfObjectUrl: null, viewer: null },
  ai: { conversationId: null, busy: false, collapsed: false, messages: [], drafts: [], attachments: [], controller: null, lastPrompt: '', pendingApply: null, autoFollow: true, unread: 0 },
  mobileSurface: 'ppt', mobileAiOpen: false,
  lifecycleAbort: null, disposed: false,
}

function uid(prefix = 'op') { return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}` }
function activeSteps() { const keys = state.plan?.input?.templateStages; return Array.isArray(keys) && keys.length ? keys.map(key => [key, STEP_LABELS[key] || key]) : DEFAULT_STEPS }
function activeStepKey() { return activeSteps()[state.stepIndex]?.[0] || activeSteps()[0][0] }
function activeLockKeys() { return activeStepKey() === 'keyAndDifficultPoints' ? ['keyPoints', 'difficultPoints'] : [activeStepKey()] }
function activeGenerationKeys() { return activeStepKey() === 'keyAndDifficultPoints' ? ['keyPoints', 'difficultPoints'] : activeStepKey() === 'differentiatedInstruction' ? ['exercises'] : [activeStepKey()] }
function allGenerationKeys() { return [...new Set(activeSteps().flatMap(([key]) => key === 'keyAndDifficultPoints' ? ['keyPoints', 'difficultPoints'] : key === 'differentiatedInstruction' ? ['exercises'] : [key]))] }

function readWorkspace() {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || '{}')
    state.split = Math.min(65, Math.max(58, Number(stored.split) || 62))
    state.tabs = Array.isArray(stored.tabs) ? stored.tabs.filter(tab => ['editable', 'pdf'].includes(tab.kind)).slice(0, 12) : []
    state.activeTab = stored.activeTab || null
    state.ppt = { ...state.ppt, ...(stored.ppt || {}), localNotes: stored.ppt?.localNotes || {}, objectUrl: null, status: 'default' }
    state.ai.conversationId = stored.aiConversationId || null
    state.ai.drafts = Array.isArray(stored.aiDrafts) ? stored.aiDrafts.slice(0, 30) : []
    state.pdfState = { ...state.pdfState, ...(stored.pdfState || {}) }
    state.pdfSource = stored.pdfSource || null
    state.currentSection = String(stored.currentSection || '')
    state.outlineOpen = stored.outlineOpen !== false
    state.docZoom = Math.min(2, Math.max(.5, Number(stored.docZoom) || 1))
    state.mobileSurface = stored.mobileSurface || 'ppt'
    state.mobileAiOpen = stored.mobileAiOpen === true
  } catch {}
}

function layoutStorageKey(planId = state.plan?.lesson_plan_id || 'default') {
  return `${LAYOUT_KEY_PREFIX}:${state.userId || 'teacher'}:${planId || 'default'}`
}

function readLayout(planId = state.plan?.lesson_plan_id || 'default') {
  try {
    const stored = JSON.parse(localStorage.getItem(layoutStorageKey(planId)) || 'null')
    state.layout = normalizeLayout(stored || { ...defaultLayout(), horizontalRatio: state.split })
  } catch {
    state.layout = defaultLayout()
  }
  state.split = state.layout.horizontalRatio
}

function persistLayout() {
  state.layout.horizontalRatio = state.split
  localStorage.setItem(layoutStorageKey(), JSON.stringify(state.layout))
}

function persistWorkspace() {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify({
    lessonPlanId: state.plan?.lesson_plan_id || null, currentDocumentId: state.document?.id || null,
    currentVersion: state.document?.current_version?.version_number || null,
    tabs: state.tabs.filter(tab => tab.sourceKind !== 'local').map(({ key, kind, id, title, sourceKind, pinned, dirty }) => ({ key, kind, id, title, sourceKind, pinned: Boolean(pinned), dirty: Boolean(dirty) })),
    activeTab: state.activeTab, ppt: { resourceId: state.ppt.resourceId, sourceKind: state.ppt.sourceKind, slideIndex: state.ppt.slideIndex, zoom: state.ppt.zoom, localNotes: state.ppt.localNotes },
    pdfSource: state.pdfSource?.source_kind === 'local' ? null : state.pdfSource, pdfState: state.pdfState, currentSection: state.currentSection,
    outlineOpen: state.outlineOpen, docZoom: state.docZoom, aiConversationId: state.ai.conversationId, aiDrafts: state.ai.drafts,
    mobileSurface: state.mobileSurface, mobileAiOpen: state.mobileAiOpen,
  }))
}

function paneLabel(pane) {
  return { presentation: 'PPT 课件', assistant: 'AI 助手', document: '教案文档' }[pane] || pane
}

function paneElement(pane) {
  return document.querySelector(`.prep-dock-pane[data-pane="${pane}"]`)
}

function slotForPane(pane) {
  return SLOT_IDS.find(slot => state.layout.slots[slot] === pane) || null
}

function renderHiddenPanes() {
  const host = document.getElementById('prep-hidden-panes')
  if (!host) return
  const hidden = PANE_IDS.filter(pane => state.layout.panes[pane].hidden)
  host.hidden = !hidden.length
  host.innerHTML = hidden.length ? `<span>已隐藏</span>${hidden.map(pane => `<button data-restore-pane="${pane}">恢复${paneLabel(pane)}</button>`).join('')}` : ''
}

function scheduleWorkspaceResize() {
  if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame)
  state.layoutFrame = requestAnimationFrame(() => {
    state.layoutFrame = 0
    window.dispatchEvent(new Event('resize'))
    const documentPane = paneElement('document')
    if (state.mode === 'compare' && documentPane && documentPane.getBoundingClientRect().width < 680) {
      showToast('教案区域宽度不足，已切回教案编辑；PDF 仍保留在标签中', 'warning')
      renderEditorView()
    }
  })
}

function applyDockLayout({ save = false, notify = true } = {}) {
  const root = document.querySelector('.preparation-immersive')
  const workspace = document.getElementById('prep-dock-workspace')
  if (!root || !workspace) return
  state.layout = normalizeLayout(state.layout)
  state.split = state.layout.horizontalRatio
  root.style.setProperty('--prep-left', `${state.layout.horizontalRatio}%`)
  root.style.setProperty('--prep-top', `${state.layout.leftVerticalRatio}%`)
  root.dataset.compactPane = state.layout.compactPane
  root.dataset.layoutPreset = state.layout.preset || 'custom'
  const store = document.getElementById('prep-hidden-pane-store')
  const focusHost = document.getElementById('prep-focus-host')
  SLOT_IDS.forEach(slot => {
    const host = workspace.querySelector(`[data-dock-slot="${slot}"]`)
    const pane = state.layout.slots[slot]
    const config = state.layout.panes[pane]
    const element = paneElement(pane)
    host.classList.toggle('is-pane-collapsed', Boolean(config?.collapsed))
    host.classList.toggle('is-pane-hidden', Boolean(config?.hidden))
    host.dataset.dockedPane = pane
    if (element && !config?.hidden) host.appendChild(element)
  })
  PANE_IDS.forEach(pane => {
    const config = state.layout.panes[pane]
    const element = paneElement(pane)
    element?.classList.toggle('is-pane-collapsed', config.collapsed)
    if (config.hidden && element) store.appendChild(element)
    element?.querySelectorAll(`[data-pane-action="collapse"][data-pane="${pane}"]`).forEach(button => { button.textContent = config.collapsed ? '展开' : '收起'; button.setAttribute('aria-expanded', String(!config.collapsed)) })
  })
  const aiCollapse = document.getElementById('prep-ai-collapse')
  if (aiCollapse) {
    aiCollapse.textContent = state.layout.panes.assistant.collapsed ? '展开' : '折叠'
    aiCollapse.setAttribute('aria-expanded', String(!state.layout.panes.assistant.collapsed))
  }
  const focus = state.layout.focus && !state.layout.panes[state.layout.focus].hidden ? state.layout.focus : null
  state.layout.focus = focus
  root.classList.toggle('has-pane-focus', Boolean(focus))
  root.dataset.focusPane = focus || ''
  if (focus) {
    focusHost.hidden = false
    focusHost.appendChild(paneElement(focus))
  } else {
    focusHost.hidden = true
  }
  const leftTop = state.layout.panes[state.layout.slots.leftTop]
  const leftBottom = state.layout.panes[state.layout.slots.leftBottom]
  const right = state.layout.panes[state.layout.slots.right]
  root.classList.toggle('prep-top-unavailable', leftTop.hidden)
  root.classList.toggle('prep-bottom-unavailable', leftBottom.hidden)
  root.classList.toggle('prep-top-collapsed', !leftTop.hidden && leftTop.collapsed)
  root.classList.toggle('prep-bottom-collapsed', !leftBottom.hidden && leftBottom.collapsed)
  root.classList.toggle('prep-right-unavailable', right.hidden)
  root.classList.toggle('prep-right-collapsed', !right.hidden && right.collapsed)
  renderHiddenPanes()
  document.querySelectorAll('[data-compact-pane]').forEach(button => button.classList.toggle('active', button.dataset.compactPane === state.layout.compactPane))
  if (save) persistLayout()
  if (notify) scheduleWorkspaceResize()
}

function setCompactPane(pane) {
  if (!PANE_IDS.includes(pane)) return
  state.layout.compactPane = pane
  state.layout.panes[pane].hidden = false
  state.layout.focus = null
  applyDockLayout({ save: true })
  if (pane === 'document' && state.document) renderEditorView()
}

function togglePaneAction(pane, action) {
  if (!PANE_IDS.includes(pane)) return
  const config = state.layout.panes[pane]
  if (action === 'hide') {
    config.hidden = true
    config.collapsed = false
    if (state.layout.focus === pane) state.layout.focus = null
  } else if (action === 'collapse') {
    config.hidden = false
    config.collapsed = !config.collapsed
  } else if (action === 'focus') {
    config.hidden = false
    config.collapsed = false
    state.layout.focus = state.layout.focus === pane ? null : pane
  }
  state.layout.preset = 'custom'
  applyDockLayout({ save: true })
}

function restorePane(pane) {
  if (!PANE_IDS.includes(pane)) return
  state.layout.panes[pane].hidden = false
  state.layout.panes[pane].collapsed = false
  state.layout.compactPane = pane
  state.layout.preset = 'custom'
  applyDockLayout({ save: true })
}

function dockPaneToSlot(pane, targetSlot) {
  if (!PANE_IDS.includes(pane) || !SLOT_IDS.includes(targetSlot)) return
  const sourceSlot = slotForPane(pane)
  if (!sourceSlot || sourceSlot === targetSlot) return
  const displaced = state.layout.slots[targetSlot]
  state.layout.slots[targetSlot] = pane
  state.layout.slots[sourceSlot] = displaced
  state.layout.panes[pane].hidden = false
  state.layout.panes[pane].collapsed = false
  state.layout.focus = null
  state.layout.preset = 'custom'
  applyDockLayout({ save: true })
}

function applyLayoutPreset(preset) {
  const next = defaultLayout()
  next.preset = preset === 'default' ? 'all' : preset
  if (preset === 'ppt-document') next.panes.assistant.hidden = true
  else if (preset === 'ai-document') next.panes.presentation.hidden = true
  else if (preset === 'ppt-ai') next.panes.document.hidden = true
  else if (preset.startsWith('focus-')) next.focus = preset.slice(6)
  state.layout = normalizeLayout(next)
  applyDockLayout({ save: true })
}

function shell() {
  return `<div class="preparation-page preparation-immersive teacher-workbench" style="--prep-left:${state.layout.horizontalRatio}%;--prep-top:${state.layout.leftVerticalRatio}%">
    <header class="prep-immersive-toolbar">
      <div class="prep-brand"><span>沉浸式智慧备课</span><b id="prep-title-bar">选择备课方案</b><em id="prep-save-state">未打开教案</em></div>
      <div class="prep-context-selects">
        <select id="prep-course" aria-label="课程"><option value="">选择课程</option></select>
        <select id="prep-class" aria-label="教学班"><option value="">选择教学班</option></select>
        <select id="prep-plan" aria-label="备课方案"><option value="">选择备课方案</option></select>
      </div>
      <div class="prep-toolbar-actions">
        <button class="teacher-btn teacher-btn--sm" id="prep-back-workbench">返回智慧备课</button><button class="teacher-btn teacher-btn--primary teacher-btn--sm" id="doc-new">新建教案</button><button class="teacher-btn teacher-btn--sm" id="doc-import">导入文件</button><button class="teacher-btn teacher-btn--sm" id="doc-platform">平台资源</button><button class="teacher-btn teacher-btn--sm" id="doc-export-main">导出教案</button>
        <details class="prep-layout-menu"><summary role="button" aria-haspopup="menu">布局</summary><div role="menu"><button data-layout-preset="all">完整工作区</button><button data-layout-preset="ppt-document">课件 + 教案</button><button data-layout-preset="ai-document">AI + 教案</button><button data-layout-preset="ppt-ai">课件 + AI</button><button data-layout-preset="focus-presentation">聚焦课件</button><button data-layout-preset="focus-document">聚焦教案</button><button data-layout-preset="focus-assistant">聚焦 AI</button><button data-layout-preset="default">恢复默认</button></div></details>
        <details class="prep-more-actions"><summary role="button" aria-haspopup="menu">更多操作</summary><div><button id="prep-new-plan">新建方案</button><button id="prep-stage-open">查看方案结构</button><button id="doc-version-create">保存新版本</button><button id="doc-student-open">学生材料</button></div></details>
        <button class="teacher-btn teacher-btn--sm" id="prep-exit-immersive">退出沉浸模式</button>
      </div>
    </header>
    <nav class="prep-mobile-surfaces" aria-label="紧凑工作区切换">
      <button data-compact-pane="presentation">PPT</button><button data-compact-pane="assistant">AI 助手</button><button data-compact-pane="document">教案</button><button data-mobile-surface="reference">PDF 参考</button>
    </nav>
    <div class="prep-hidden-panes" id="prep-hidden-panes" aria-live="polite"></div>
    <main class="prep-immersive-grid" id="prep-dock-workspace">
      <section class="prep-dock-left" id="prep-dock-left">
        <div class="prep-dock-slot" data-dock-slot="leftTop">
        <section class="prep-ppt-panel prep-dock-pane" data-pane="presentation">
          <header><div><span class="prep-pane-handle" role="button" tabindex="0" data-pane-drag="presentation" aria-label="拖动课件模块" title="拖动课件模块；Alt + 方向键可交换位置">⠿</span><b>PPT 演示预览</b><span id="ppt-context-state">未绑定课件</span></div><div><select id="ppt-resource"><option value="">选择平台课件</option></select><button id="ppt-platform-picker">平台文件</button><button id="ppt-local-picker">本地文件</button><button id="ppt-fit">适合</button><button id="ppt-zoom-out">−</button><span id="ppt-zoom">100%</span><button id="ppt-zoom-in">＋</button><span class="prep-pane-actions"><button data-pane-action="collapse" data-pane="presentation" title="收起课件">收起</button><button data-pane-action="focus" data-pane="presentation" title="聚焦课件">聚焦</button><button data-pane-action="hide" data-pane="presentation" title="隐藏课件">隐藏</button></span></div></header>
          <div class="prep-ppt-stage" id="ppt-stage">${pptEmptyHtml()}</div>
          <footer><button id="ppt-prev">上一页</button><label class="ppt-page-jump"><input id="ppt-page-input" type="number" min="1" value="1" aria-label="PPT 页码"><span id="ppt-page">/ —</span></label><button id="ppt-next">下一页</button><input id="ppt-note-draft" placeholder="当前页备注草稿（不会静默改写原 PPT）"><button id="ppt-download">原 PPT</button><button id="ppt-download-pdf">转换 PDF</button><button id="ppt-window">新窗口</button><button id="ppt-fullscreen">全屏</button></footer>
        </section>
        </div>
        <div class="prep-row-splitter" id="prep-row-splitter" role="separator" aria-orientation="horizontal" aria-label="调整课件与 AI 助手高度" tabindex="0"></div>
        <div class="prep-dock-slot" data-dock-slot="leftBottom">
        <section class="prep-ai-panel prep-dock-pane" data-pane="assistant">
          <header><div><span class="prep-pane-handle" role="button" tabindex="0" data-pane-drag="assistant" aria-label="拖动 AI 模块" title="拖动 AI 模块；Alt + 方向键可交换位置">⠿</span><b>AI 教学备课助手</b><span id="prep-ai-context-summary">等待教学上下文</span></div><div class="prep-ai-head-actions"><span id="prep-ai-selection">未选择教案文字</span><span class="prep-ai-unread" id="prep-ai-unread" hidden></span><button id="prep-ai-clear" type="button">清空</button><button id="prep-ai-expand" type="button">完整对话</button><button id="prep-ai-collapse" type="button" aria-expanded="true">折叠</button><span class="prep-pane-actions"><button data-pane-action="focus" data-pane="assistant">聚焦</button><button data-pane-action="hide" data-pane="assistant">隐藏</button></span></div></header>
          <div class="prep-ai-quick" id="prep-ai-quick">
            ${['生成当前页演讲稿', '将当前 PPT 内容插入教案', '补充当前章节', '修改当前选区', '检查 PPT 与教案一致性', '根据 PDF 补充教案', '生成课堂提问', '生成板书设计', '生成课堂任务单'].map(label => `<button data-ai-instruction="${label}">${label}</button>`).join('')}
          </div>
          <div class="prep-ai-messages" id="prep-ai-messages"><div class="prep-ai-empty">AI 结果会先进入预览卡片；只有教师点击插入、替换或追加后，才会修改教案。</div></div>
          <div class="prep-ai-files" id="prep-ai-files"></div>
          <form class="prep-ai-compose" id="prep-ai-form"><textarea id="prep-ai-input" maxlength="5000" rows="2" placeholder="输入教学问题；快捷操作只会预填，可继续编辑"></textarea><footer><div><label class="prep-ai-attach">附件<input id="prep-ai-file" type="file" hidden multiple accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp"></label><button id="prep-ai-voice" type="button">语音</button><span id="prep-ai-count">0 / 5000</span></div><button id="prep-ai-send" type="submit">发送</button></footer></form>
        </section>
        </div>
      </section>
      <div class="prep-splitter prep-col-splitter" id="prep-splitter" role="separator" aria-orientation="vertical" aria-label="调整左右工作区宽度" tabindex="0"></div>
      <div class="prep-dock-slot" data-dock-slot="right">
      <section class="prep-document-workspace prep-dock-pane" id="document-workspace" data-pane="document" data-surface="document">
        <header class="prep-document-pane-head"><div><span class="prep-pane-handle" role="button" tabindex="0" data-pane-drag="document" aria-label="拖动教案模块" title="拖动教案模块；Alt + 方向键可交换位置">⠿</span><b>教案文档工作区</b><span id="doc-pane-context">在线编辑与自动保存</span></div><div class="prep-pane-actions"><button data-pane-action="collapse" data-pane="document">收起</button><button data-pane-action="focus" data-pane="document">聚焦</button><button data-pane-action="hide" data-pane="document">隐藏</button></div></header>
        <div class="doc-tabs" id="doc-tabs"><span>尚未打开文档</span></div>
        <div class="doc-modebar">
          <div><button data-doc-mode="edit" class="active">教案编辑</button><button data-doc-mode="pdf">PDF 参考</button><button data-doc-mode="compare">对照模式</button><button data-doc-mode="versions">版本</button></div>
          <div><button id="doc-outline-toggle">大纲</button><button id="doc-sync-stage">同步阶段</button><button id="doc-fullscreen">全屏</button></div>
        </div>
        <div class="doc-toolbar" id="doc-toolbar" hidden>
          <select data-command="formatBlock" title="段落样式"><option value="p">正文</option><option value="h1">标题 1</option><option value="h2">标题 2</option><option value="h3">标题 3</option><option value="h4">标题 4</option></select>
          <span><button data-command="bold"><b>B</b></button><button data-command="italic"><i>I</i></button><button data-command="underline"><u>U</u></button><button data-command="strikeThrough"><s>S</s></button></span>
          <span><button data-command="insertUnorderedList">• 列表</button><button data-command="insertOrderedList">1. 列表</button><button data-command="formatBlock" data-value="blockquote">引用</button></span>
          <span><button data-command="justifyLeft">左</button><button data-command="justifyCenter">中</button><button data-command="justifyRight">右</button><button data-command="justifyFull">两端</button></span>
          <span><button data-command="undo">撤销</button><button data-command="redo">重做</button></span>
          <details class="doc-tool-more"><summary>更多</summary><div><span><button data-command="outdent">减少缩进</button><button data-command="indent">增加缩进</button></span><span><button id="doc-insert-table">表格</button><button id="doc-insert-image">图片</button><button id="doc-insert-rule">分隔线</button><button id="doc-insert-formula">公式</button></span><span><button id="doc-find">查找/替换</button></span></div></details>
        </div>
        <div class="doc-recovery" id="doc-recovery" hidden></div>
        <div class="doc-work-area" id="doc-work-area">${emptyWorkspaceHtml()}</div>
        <footer class="doc-statusbar"><span id="doc-drag-status">可拖入 DOCX / PDF / Markdown / TXT</span><span id="doc-word-count">0 字</span><span id="doc-version-state">—</span></footer>
        <div class="doc-drop-overlay" id="doc-drop-overlay"><b>释放文件以导入</b><span>正在校验文件类型、MIME、文件头和大小</span></div>
      </section>
      </div>
      <div class="prep-focus-host" id="prep-focus-host" hidden></div>
      <div class="prep-hidden-pane-store" id="prep-hidden-pane-store" hidden></div>
      <div class="prep-dock-overlay" id="prep-dock-overlay" hidden><button data-dock-target="leftTop">左上</button><button data-dock-target="leftBottom">左下</button><button data-dock-target="right">右侧</button></div>
    </main>
    <input type="file" id="ppt-file-input" accept=".ppt,.pptx" hidden><input type="file" id="doc-file-input" accept=".docx,.pdf,.md,.txt" hidden><input type="file" id="doc-image-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    ${dialogs()}
  </div>`
}

function stepButtons() {
  return activeSteps().map(([, label], index) => `<button data-step-index="${index}" class="${index === state.stepIndex ? 'active' : ''}"><i>${index + 1}</i>${escapeHtml(label)}</button>`).join('') + '<button data-step-action="export"><i>↗</i>导出方案</button>'
}

function pptEmptyHtml() {
  return '<div class="prep-workspace-empty prep-start-card"><i>PPT</i><b>打开本节课件</b><p>可从平台选择或本地上传 PPT/PPTX，也可直接拖入此区域。浏览器不会伪造原始课件预览。</p><div><button class="primary" data-ppt-picker="platform">选择平台课件</button><button data-ppt-picker="local">选择本地课件</button></div></div>'
}

function emptyWorkspaceHtml() {
  return `<div class="prep-workspace-empty prep-start-card"><i>DOC</i><b>开始编辑教案</b><p>在线编辑、自动保存和版本管理都在这里完成；也可直接导入 DOCX、PDF、Markdown 或 TXT。</p><div><button class="primary" data-empty-create="blank">新建空白教案</button><button data-empty-create="plan" ${state.plan ? '' : 'disabled'}>按当前方案生成</button></div><div class="prep-start-links"><button data-empty-action="import">导入本地文件</button><button data-empty-action="platform">打开平台资源</button></div></div>`
}

function dialogs() {
  return `<dialog id="prep-create-dialog" class="teacher-dialog"><form id="prep-create-form"><header><h3>创建备课方案</h3><button type="button" data-create-close>×</button></header><div class="teacher-form-grid">
    <label>课程<select name="course_id" required></select></label><label>教学班<select name="teaching_class_id" required></select></label>
    <label class="wide">授课主题<input name="topic" required maxlength="240"></label><label>授课日期<input name="teaching_date" type="date"></label><label>课时（分钟）<input name="duration_minutes" type="number" min="15" max="240" value="45"></label>
    <label>章节<select name="chapter_id"><option value="">不指定</option></select></label><label>课型模板<select name="lesson_type">${LESSON_TYPES.map(type => `<option>${type}</option>`).join('')}</select></label>
    <label>教学地点<input name="location"></label><label>教材<input name="textbook"></label><label>学情范围<select name="analytics_range"><option value="7d">最近 7 天</option><option value="30d" selected>最近 30 天</option><option value="semester">本学期</option></select></label>
    <label class="wide">学生基础<input name="student_foundation"></label>
    <fieldset class="wide"><legend>教学偏好</legend><label><input type="checkbox" name="use_case" checked> 案例</label><label><input type="checkbox" name="project_based"> 项目式</label><label><input type="checkbox" name="discussion" checked> 讨论</label><label><input type="checkbox" name="in_class_practice" checked> 随堂练习</label><label><input type="checkbox" name="include_homework" checked> 课后作业</label></fieldset>
    </div><footer><button type="button" data-create-close>取消</button><button class="primary" type="submit">创建</button></footer></form></dialog>
    <dialog id="prep-stage-dialog" class="teacher-dialog prep-stage-dialog"><header><div><h3 id="prep-stage-name">阶段设计</h3><span id="prep-stage-meta"></span></div><button data-stage-close>×</button></header><nav id="prep-stage-nav"></nav><div class="prep-stage-actions"><button id="prep-lock">锁定本阶段</button><button id="prep-generate-stage">生成本阶段</button><input id="prep-refine-instruction" maxlength="1000" placeholder="输入本阶段优化要求"><button id="prep-refine-stage">按要求优化</button></div><div id="prep-stage-editor" class="prep-stage-editor" contenteditable="true"></div><aside><section><b>学情摘要</b><div id="prep-analytics">选择方案后读取真实数据</div></section><section><b>Agent 执行 <span id="prep-progress">0%</span></b><div class="prep-progress-bar"><i id="prep-progress-fill"></i></div><div id="prep-agents"></div></section></aside><footer><button id="prep-plan-versions">方案版本</button><button id="prep-plan-publish">发布方案</button><button id="prep-generate-all">全部生成</button><button class="primary" id="prep-save-stage">保存阶段内容</button></footer></dialog>
    <dialog id="prep-version-dialog" class="teacher-dialog version-dialog"><header><h3>智慧备课版本</h3><button data-plan-version-close>×</button></header><div id="prep-version-list"></div></dialog>
    <dialog id="prep-confirm-dialog" class="teacher-dialog prep-confirm-dialog"><header><h3>确认 Agent 生成范围</h3><button data-confirm-close>×</button></header><div id="prep-confirm-summary"></div><p>确认后才会读取授权范围内的实时学情并启动 Agent；已锁定阶段不会被覆盖，右侧教案也不会被静默覆盖。</p><footer><button data-confirm-close>返回</button><button class="primary" id="prep-confirm-generate">确认并开始</button></footer></dialog>
    <dialog id="prep-ai-apply-dialog" class="teacher-dialog prep-ai-apply-dialog"><header><h3>确认应用 AI 内容</h3><button type="button" data-ai-apply-close>×</button></header><div id="prep-ai-apply-summary"></div><p>确认后才会写入当前教案，并立即创建修订记录和触发自动保存；原始 PPT 与 PDF 不会被修改。</p><footer><button type="button" data-ai-apply-close>返回预览</button><button type="button" class="primary" id="prep-ai-apply-confirm">确认应用</button></footer></dialog>
    <dialog id="doc-new-dialog" class="teacher-dialog doc-new-dialog"><header><h3>新建教案</h3><button data-doc-new-close>×</button></header><label>教案标题<input id="doc-new-title" maxlength="240" placeholder="请输入教案标题"></label><div>${[['blank','空白教案'],['plan','根据当前智慧备课方案生成初稿'],['ppt','根据当前 PPT 生成框架'],['template','按标准教案模板创建']].map(([mode,label]) => `<button data-create-document="${mode}">${label}</button>`).join('')}</div><p>创建后使用平台内部富文档格式编辑，不会直接覆盖原始 DOCX 或 PDF。</p></dialog>
    <dialog id="doc-resource-dialog" class="teacher-dialog doc-resource-dialog"><header><div><h3>打开平台文件</h3><span>只显示真实文件与任务状态</span></div><button data-resource-close>×</button></header><div class="doc-resource-filters"><input id="doc-resource-search" placeholder="搜索文件"><select id="doc-resource-group"><option value="">全部来源</option><option value="current_plan">当前备课方案</option><option value="generated">智慧备课产物</option><option value="my_lessons">我的教案</option><option value="teacher_resource">教师资源中心</option><option value="course_resource">课程资源</option><option value="class_resource">教学班资源</option><option value="knowledge_base">知识库文件</option><option value="recent">最近使用</option></select><select id="doc-resource-type"><option value="">全部类型</option><option value="internal">内部教案</option><option value="docx">DOCX</option><option value="pdf">PDF</option><option value="md">Markdown</option><option value="txt">TXT</option><option value="pptx">PPT/PPTX</option></select><button id="doc-resource-refresh">刷新</button></div><div id="doc-resource-list"></div></dialog>
    <dialog id="doc-pdf-choice" class="teacher-dialog"><header><h3>如何打开 PDF？</h3><button data-pdf-choice-close>×</button></header><p>原 PDF 始终保持不变。提取正文会创建一份新的可编辑教案副本。</p><footer><button data-pdf-action="reference">作为只读参考打开</button><button class="primary" data-pdf-action="extract">提取为可编辑副本</button></footer></dialog>
    <dialog id="doc-formula-dialog" class="teacher-dialog"><header><h3>插入 LaTeX 公式</h3><button data-formula-close>×</button></header><label>LaTeX<input id="doc-formula-input" placeholder="例如：\\sigma(z)=\\frac{1}{1+e^{-z}}"></label><div id="doc-formula-preview"></div><footer><button data-formula-close>取消</button><button class="primary" id="doc-formula-confirm">插入公式</button></footer></dialog>
    <dialog id="doc-find-dialog" class="teacher-dialog"><header><h3>查找与替换</h3><button data-find-close>×</button></header><label>查找<input id="doc-find-value"></label><label>替换为<input id="doc-replace-value"></label><footer><button id="doc-find-next">查找下一个</button><button class="primary" id="doc-replace-all">全部替换</button></footer></dialog>
    <dialog id="doc-export-dialog" class="teacher-dialog"><header><h3>导出教案</h3><button data-export-close>×</button></header><p>导出会创建真实任务和 GeneratedArtifact，完成后进入任务中心与产物中心。</p><div><button data-document-export="DOCX">导出 DOCX</button><button data-document-export="PDF">导出 PDF</button></div></dialog>
    <dialog id="doc-student-dialog" class="teacher-dialog doc-student-dialog"><header><h3>生成学生材料</h3><button data-student-close>×</button></header><div class="teacher-form-grid"><label>材料类型<select id="student-material-type"><option value="student_handout">学生课前讲义</option><option value="class_task_sheet">课堂任务单</option><option value="review_material">课后复习材料</option><option value="blackboard_outline">板书提纲</option><option value="practice">随堂练习</option><option value="homework">作业</option></select></label><label>格式<select id="student-material-format"><option>DOCX</option><option>PDF</option></select></label><label><input type="checkbox" id="student-include-answers"> 保留答案</label><label><input type="checkbox" id="student-publish"> 生成后下发当前教学班</label></div><div id="student-material-preview"></div><footer><button id="student-preview">预览学生版</button><button class="primary" id="student-generate">确认生成</button></footer></dialog>`
}

const FIELD_LABELS = { averageMastery: '平均掌握度', taskCompletionRate: '任务完成率', riskStudentCount: '风险学生', weakKnowledgePoints: '薄弱知识点', teachingObjectives: '教学目标', keyPoints: '教学重点', difficultPoints: '教学难点', teacherAction: '教师活动', studentAction: '学生活动', designIntent: '设计意图', minutes: '时间（分钟）', stage: '阶段', method: '方法', evidence: '学习证据', successCriteria: '达成标准', question: '问题', purpose: '设计目的', expectedEvidence: '预期表现', title: '标题', prompt: '任务内容', level: '层级', description: '说明', reason: '推荐理由' }
function naturalText(value) {
  if (value == null || value === '') return ''
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value)
  if (Array.isArray(value)) return value.map((item, index) => item && typeof item === 'object' ? `${item.title || item.stage || item.question || `第 ${index + 1} 项`}\n${Object.entries(item).filter(([key]) => !['title', 'stage', 'question'].includes(key)).map(([key, child]) => `${FIELD_LABELS[key] || key}：${naturalText(child)}`).join('\n')}` : `• ${naturalText(item)}`).join('\n\n')
  return Object.entries(value).filter(([key]) => key !== 'teacherNarratives').map(([key, child]) => `${FIELD_LABELS[key] || STEP_LABELS[key] || key}\n${naturalText(child)}`).join('\n\n')
}
function activeStepValue() { return activeStepKey() === 'keyAndDifficultPoints' ? { keyPoints: state.content.keyPoints || [], difficultPoints: state.content.difficultPoints || [] } : activeStepKey() === 'differentiatedInstruction' ? state.content.differentiatedInstruction || { studentLayers: state.content.studentAnalytics?.student_layers || [], layeredExercises: state.content.exercises || [] } : state.content[activeStepKey()] }
function syncStageEditor() { if (!state.plan) return; state.content.teacherNarratives = { ...(state.content.teacherNarratives || {}), [activeStepKey()]: document.getElementById('prep-stage-editor')?.innerText.trim() || '' } }

function renderStageDialog() {
  if (!state.plan) return
  const [, label] = activeSteps()[state.stepIndex]
  document.getElementById('prep-stage-name').textContent = `${state.stepIndex + 1}. ${label}`
  document.getElementById('prep-stage-meta').textContent = `${state.plan.topic} · V${state.plan.current_version || 0}`
  const nearby = [state.stepIndex - 1, state.stepIndex, state.stepIndex + 1].filter(index => index >= 0 && index < activeSteps().length)
  document.getElementById('prep-stage-nav').innerHTML = nearby.map(index => {
    const [, item] = activeSteps()[index]
    const relation = index < state.stepIndex ? '上一阶段' : index > state.stepIndex ? '下一阶段' : '当前阶段'
    return `<button data-dialog-step="${index}" class="${index === state.stepIndex ? 'active' : ''}"><small>${relation}</small><span>${index + 1}. ${escapeHtml(item)}</span></button>`
  }).join('')
  const editor = document.getElementById('prep-stage-editor')
  editor.innerText = state.content.teacherNarratives?.[activeStepKey()] || naturalText(activeStepValue())
  document.getElementById('prep-lock').textContent = activeLockKeys().every(key => state.locked.includes(key)) ? '取消锁定' : '锁定本阶段'
}

function renderPlanControls() {
  document.getElementById('prep-title-bar').textContent = state.plan ? state.plan.topic : '选择备课方案'
  const select = document.getElementById('prep-plan')
  select.innerHTML = '<option value="">选择备课方案</option>' + state.plans.map(plan => `<option value="${plan.lesson_plan_id}">${escapeHtml(plan.topic)} · ${escapeHtml(plan.status)}</option>`).join('')
  select.value = state.plan ? String(state.plan.lesson_plan_id) : ''
}

function renderAnalytics(data) {
  state.analytics = data
  const overview = data?.overview || {}
  const weak = normalizeWeakKnowledgePoints(data?.weak_knowledge_points).slice(0, 4)
  const keywords = normalizeKeywords(data?.dialogue?.keywords).slice(0, 3)
  const html = data ? `<div class="prep-metric-grid"><div><b>${overview.student_count || 0}</b><span>学生</span></div><div><b>${percent(overview.average_mastery)}</b><span>掌握度</span></div><div><b>${percent(overview.task_completion_rate)}</b><span>完成率</span></div><div><b>${data.risk_students?.length || 0}</b><span>风险学生</span></div></div><div class="prep-insight-list">${weak.map(item => `<p><span>${escapeHtml(item.name)}</span><i>${percent(item.mastery)}</i></p>`).join('')}${keywords.map(item => `<p><span>${escapeHtml(item.text)}</span><i>${item.questionCount}</i></p>`).join('')}</div>` : '暂无学情数据'
  const host = document.getElementById('prep-analytics'); if (host) host.innerHTML = html
  updateAiContextSummary()
}

function updateAiContextSummary() {
  const summary = document.getElementById('prep-ai-context-summary'); if (!summary) return
  const parts = []
  const overview = state.analytics?.overview || {}
  if (state.analytics) parts.push(`${overview.student_count || 0} 名学生`, `掌握度 ${percent(overview.average_mastery)}`)
  const resource = currentPptResource(); const slide = resource?.slides?.[state.ppt.slideIndex]
  if (resource) parts.push(`${resource.title} · 第 ${state.ppt.slideIndex + 1} 页${slide?.title ? ` ${slide.title}` : ''}`)
  if (state.pdfSource) parts.push(`${state.pdfSource.title} · PDF 第 ${state.pdfState.pageNumber || 1} 页`)
  if (state.currentSection) parts.push(`教案：${state.currentSection}`)
  summary.textContent = parts.join(' · ') || '等待教学上下文'
}

function renderGeneration(status) {
  state.generation = status
  const progress = Number(status?.progress || 0)
  document.getElementById('prep-progress').textContent = `${progress}%`
  document.getElementById('prep-progress-fill').style.width = `${progress}%`
  const labels = { running: '执行中', succeeded: '已完成', degraded: '降级完成', skipped: '已跳过', failed: '需重试', queued: '排队中' }
  document.getElementById('prep-agents').innerHTML = (status?.agents || []).map(item => `<div data-status="${escapeHtml(item.status)}"><i></i><span><b>${escapeHtml(item.agent)}</b><em>${escapeHtml(item.stage)}</em></span><strong>${labels[item.status] || item.status}</strong></div>`).join('') || '<span>尚未执行</span>'
}

async function loadCourses() {
  const result = await getTeacherCourses({ page_size: 100 }); state.courses = result.data?.list || []
  const html = '<option value="">选择课程</option>' + state.courses.map(item => `<option value="${item.course_id}">${escapeHtml(item.course_name)}</option>`).join('')
  document.getElementById('prep-course').innerHTML = html
  document.querySelector('#prep-create-form [name="course_id"]').innerHTML = html
}

async function loadClasses(courseId) {
  state.classes = courseId ? ((await getTeachingClasses(courseId, { page_size: 100 })).data?.list || []) : []
  const html = '<option value="">选择教学班</option>' + state.classes.map(item => `<option value="${item.teaching_class_id}">${escapeHtml(item.teaching_class_name)}</option>`).join('')
  document.getElementById('prep-class').innerHTML = html
  document.querySelector('#prep-create-form [name="teaching_class_id"]').innerHTML = html
}

async function loadPlans() {
  state.plans = state.courseId ? ((await getPreparationPlans({ course_id: state.courseId, ...(state.classId ? { teaching_class_id: state.classId } : {}) })).data?.list || []) : []
  renderPlanControls()
}

async function loadResources() {
  state.resources = state.courseId ? ((await getTeachingResources({ course_id: state.courseId, page_size: 100 })).data?.list || []) : []
  await refreshSelectable(false)
  renderPptSelector()
}

async function loadAnalytics() {
  if (!state.plan) return renderAnalytics(null)
  try { renderAnalytics((await getAnalyticsWorkbench({ course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id, range: state.plan.input?.analyticsRange || '30d' })).data) }
  catch { renderAnalytics(null) }
}

async function openPlan(id) {
  await flushSave()
  const result = await getPreparationPlan(id)
  state.plan = result.data; state.content = state.plan.content || {}; state.locked = state.plan.locked_blocks || []
  readLayout(state.plan.lesson_plan_id)
  applyDockLayout()
  state.courseId = String(state.plan.course_id); state.classId = String(state.plan.teaching_class_id || '')
  document.getElementById('prep-course').value = state.courseId
  await loadClasses(state.courseId); document.getElementById('prep-class').value = state.classId
  await Promise.all([loadPlans(), loadResources(), loadAnalytics(), loadGeneration()])
  renderPlanControls(); renderStageDialog()
  const docs = await getEditableTeachingDocuments({ lesson_plan_id: state.plan.lesson_plan_id })
  state.editableDocuments = docs.data?.list || []
  const persisted = state.tabs.find(tab => tab.key === state.activeTab && (tab.kind === 'pdf' || state.editableDocuments.some(doc => doc.id === tab.id)))
  if (persisted?.kind === 'pdf') await openPdfSource({ id: persisted.id, source_kind: persisted.sourceKind, title: persisted.title, file_ext: 'pdf' }, false)
  else if (persisted) await openEditableDocument(persisted.id)
  else if (state.editableDocuments[0]) await openEditableDocument(state.editableDocuments[0].id)
  else { state.activeTab = null; renderTabs(); renderEmptyWorkspace() }
  persistWorkspace()
}

async function loadGeneration() { if (state.plan) renderGeneration((await getPreparationStatus(state.plan.lesson_plan_id)).data) }

async function saveStageDraft(summary = '教师编辑保存') {
  if (!state.plan) return
  syncStageEditor()
  const result = await savePreparationPlan(state.plan.lesson_plan_id, { content: state.content, locked_blocks: state.locked, change_summary: summary })
  state.plan.current_version = result.data.version_number; showToast('智慧备课阶段已保存新版本', 'success'); renderStageDialog(); await loadPlans()
}

function showGenerationConfirmation(confirmation, targetSections) {
  state.pendingGeneration = { confirmation, targetSections }
  document.getElementById('prep-confirm-summary').innerHTML = `<dl><div><dt>课型模板</dt><dd>${escapeHtml(confirmation.summary?.lessonType || state.plan.lesson_type || '新授课')}</dd></div><div><dt>生成范围</dt><dd>${targetSections.map(key => STEP_LABELS[key] || key).join('、') || '全部阶段'}</dd></div><div><dt>已锁定</dt><dd>${(confirmation.summary?.lockedBlocks || []).map(key => STEP_LABELS[key] || key).join('、') || '无'}</dd></div></dl>`
  document.getElementById('prep-confirm-dialog').showModal()
}

async function monitorGeneration() {
  state.eventAbort?.abort(); state.eventAbort = new AbortController()
  try {
    await streamPreparationEvents(state.plan.lesson_plan_id, { signal: state.eventAbort.signal, onEvent: async (event, payload) => {
      if (event === 'snapshot') renderGeneration(payload)
      else if (event === 'progress' || event === 'agent') await loadGeneration()
      else if (event === 'complete') {
        showToast(payload.status === 'draft' ? payload.message || '生成中断，已保留草稿' : '智慧备课生成完成；右侧教案未被自动覆盖', payload.status === 'draft' ? 'warning' : 'success')
        await openPlan(state.plan.lesson_plan_id)
      } else if (event === 'failed') { showToast(payload.message || '生成暂时中断，可重试', 'warning'); await loadGeneration() }
    } })
  } catch (error) { if (error.name !== 'AbortError') showToast(error.message || 'Agent 状态连接中断', 'warning') }
}

async function startGeneration(targetSections) {
  if (!state.plan || state.plan.status === 'generating') return
  await saveStageDraft('Agent 生成前保存')
  const response = await generatePreparationPlan(state.plan.lesson_plan_id, { sections: targetSections, locked_blocks: state.locked })
  if (response.data?.status === 'awaiting_confirmation') return showGenerationConfirmation(response.data.confirmation, targetSections)
  await monitorGeneration()
}

async function confirmGeneration() {
  if (!state.pendingGeneration) return
  const { confirmation, targetSections } = state.pendingGeneration
  const response = await generatePreparationPlan(state.plan.lesson_plan_id, { sections: targetSections, locked_blocks: state.locked, confirmation_token: confirmation.token })
  if (response.data?.status !== 'generating') throw new Error('确认状态已过期，请重新发起')
  document.getElementById('prep-confirm-dialog').close(); state.pendingGeneration = null; await monitorGeneration()
}

async function refineCurrentStage() {
  const input = document.getElementById('prep-refine-instruction'); const instruction = input.value.trim()
  if (!instruction) return showToast('请先输入本阶段优化要求', 'warning')
  await saveStageDraft('局部优化前保存')
  const result = await refinePreparationStage(state.plan.lesson_plan_id, { stage_key: activeStepKey(), instruction })
  state.content.teacherNarratives = { ...(state.content.teacherNarratives || {}), [activeStepKey()]: result.data.narrative }
  state.plan.current_version = result.data.version_number; input.value = ''; renderStageDialog(); showToast('当前阶段已优化；右侧教案未自动覆盖', 'success')
}

async function showPlanVersions() {
  if (!state.plan) return
  state.versions = (await getPreparationVersions(state.plan.lesson_plan_id)).data?.list || []
  const host = document.getElementById('prep-version-list')
  host.innerHTML = state.versions.map(item => `<article><div><b>V${item.version_number}</b><span>${escapeHtml(item.change_summary || '无摘要')}</span><em>${escapeHtml(item.creator_name)} · ${formatRelativeTime(item.created_at)}</em></div><button data-restore-plan-version="${item.version_number}">恢复</button></article>`).join('') || '暂无版本'
  document.getElementById('prep-version-dialog').showModal()
}

async function exportCurrentPlan() {
  if (!state.plan) return showToast('请先选择备课方案', 'warning')
  try {
    const result = await exportPreparationPlan(state.plan.lesson_plan_id, 'DOCX')
    showToast(`方案导出任务 ${result.data.task_id} 已进入任务中心`, 'success')
  } catch (error) { showToast(error.message || '备课方案导出失败', 'error') }
}

function addTab(tab) {
  const existing = state.tabs.find(item => item.key === tab.key)
  if (existing) Object.assign(existing, tab)
  else state.tabs.push(tab)
  state.activeTab = tab.key; renderTabs(); persistWorkspace()
}

function renderTabs() {
  const host = document.getElementById('doc-tabs')
  host.innerHTML = state.tabs.length ? state.tabs.map(tab => `<button draggable="true" data-tab-key="${escapeHtml(tab.key)}" class="${state.activeTab === tab.key ? 'active' : ''}"><i>${tab.kind === 'pdf' ? 'PDF' : 'W'}</i><span>${escapeHtml(tab.title)}</span>${tab.dirty ? '<em>●</em>' : ''}<b data-tab-pin="${escapeHtml(tab.key)}" title="${tab.pinned ? '取消固定' : '固定'}">${tab.pinned ? '◆' : '◇'}</b><strong data-tab-close="${escapeHtml(tab.key)}">×</strong></button>`).join('') : '<span>尚未打开文档</span>'
}

function activeTab() { return state.tabs.find(tab => tab.key === state.activeTab) }
function editableTab(documentId = state.document?.id) { return state.tabs.find(tab => tab.kind === 'editable' && Number(tab.id) === Number(documentId)) }
function hasDirtyDocument() { return state.tabs.some(tab => tab.kind === 'editable' && tab.dirty) }
function setTabDirty(dirty) { const tab = editableTab(); if (tab) tab.dirty = dirty; renderTabs(); persistWorkspace() }

async function closeTab(key) {
  const tab = state.tabs.find(item => item.key === key); if (!tab) return
  if (tab.kind === 'editable' && tab.dirty) {
    const saved = await flushSave()
    if (!saved && !confirm('教案尚未保存到服务器，但本地恢复草稿仍会保留。仍要关闭此标签吗？')) return
  }
  state.tabs = state.tabs.filter(item => item.key !== key)
  if (state.activeTab === key) state.activeTab = state.tabs.at(-1)?.key || null
  renderTabs(); persistWorkspace()
  if (!state.activeTab) { state.document = null; state.pdfSource = null; await destroyPdf(); renderEmptyWorkspace(); return }
  await activateTab(state.activeTab)
}

async function activateTab(key) {
  if (state.activeTab !== key) await flushSave()
  const tab = state.tabs.find(item => item.key === key); if (!tab) return
  state.activeTab = key; renderTabs(); persistWorkspace()
  if (tab.kind === 'editable') await openEditableDocument(tab.id, false)
  else await openPdfSource({ id: tab.id, source_kind: tab.sourceKind, title: tab.title, file_ext: 'pdf', file: tab.file }, false)
}

async function openEditableDocument(id, add = true) {
  if (state.document?.id && Number(state.document.id) !== Number(id)) await flushSave()
  await destroyPdf()
  const result = await getEditableTeachingDocument(id); state.document = result.data; state.mode = 'edit'; state.editEpoch = 0
  if (add) addTab({ key: `editable:${id}`, kind: 'editable', id, title: state.document.title, sourceKind: 'editable', dirty: false })
  else { state.activeTab = `editable:${id}`; renderTabs() }
  renderEditorView(); persistWorkspace()
}

function cleanEditorHtml() {
  const editor = document.getElementById('document-editor'); if (!editor) return state.document?.current_version?.sanitized_html || '<p><br></p>'
  const clone = editor.cloneNode(true)
  clone.querySelectorAll('[data-formula]').forEach(node => { node.innerHTML = '' })
  clone.querySelectorAll('[contenteditable]').forEach(node => node.removeAttribute('contenteditable'))
  return DOMPurify.sanitize(clone.innerHTML, { USE_PROFILES: { html: true }, ADD_TAGS: ['table', 'thead', 'tbody', 'tr', 'th', 'td'], ADD_ATTR: ['data-formula', 'data-section-key', 'data-page-break', 'style', 'colspan', 'rowspan'] })
}

function renderFormulaElements(root = document) {
  root.querySelectorAll('[data-formula]').forEach(node => {
    const latex = node.dataset.formula || ''
    try { katex.render(latex, node, { displayMode: true, throwOnError: false }) } catch { node.textContent = '公式格式错误' }
    node.contentEditable = 'false'; node.setAttribute('title', latex)
  })
}

function outlineFromEditor() {
  return [...(document.getElementById('document-editor')?.querySelectorAll('h1,h2,h3,h4') || [])].map((heading, index) => {
    if (!heading.id) heading.id = `section-editor-${index + 1}`
    return { id: heading.id, level: Number(heading.tagName[1]), title: heading.textContent.trim() || `标题 ${index + 1}` }
  })
}

function renderOutline() {
  const host = document.getElementById('doc-outline'); if (!host) return
  const outline = outlineFromEditor()
  host.innerHTML = `<header><b>教案大纲</b><button data-outline-close>×</button></header>${outline.map(item => `<button data-outline-id="${escapeHtml(item.id)}" data-level="${item.level}" class="${state.currentSection === item.title ? 'active' : ''}">${escapeHtml(item.title)}</button>`).join('') || '<span>添加一至四级标题后自动生成大纲</span>'}`
}

function recoveryDraft() { try { return state.document ? JSON.parse(localStorage.getItem(`${DRAFT_PREFIX}${state.document.id}`) || 'null') : null } catch { return null } }
function renderRecovery() {
  const host = document.getElementById('doc-recovery')
  if (state.conflict?.documentId === state.document?.id) {
    host.hidden = false
    host.innerHTML = `<span>服务器已更新到 r${state.conflict.server?.revision || state.conflict.serverRevision || '?'}；当前编辑内容和本地草稿均未丢失。</span><button data-conflict-keep>保留我的内容并重试</button><button data-conflict-server>打开服务器版本对比</button>`
    return
  }
  const recovery = recoveryDraft(); const serverHtml = state.document?.current_version?.sanitized_html || ''
  state.recovery = recovery && recovery.html !== serverHtml ? recovery : null
  if (!state.recovery) { host.hidden = true; host.innerHTML = ''; return }
  host.hidden = false; host.innerHTML = `<span>发现 ${new Date(recovery.updatedAt).toLocaleString()} 的本地恢复草稿，服务器内容未被覆盖。</span><button data-recovery-restore>恢复到编辑器</button><button data-recovery-discard>放弃本地草稿</button>`
}

function renderEditorView() {
  if (!state.document?.current_version) return renderEmptyWorkspace()
  updateModeButtons('edit')
  const html = DOMPurify.sanitize(state.document.current_version.sanitized_html || '<p><br></p>', { USE_PROFILES: { html: true }, ADD_ATTR: ['data-formula', 'data-section-key', 'data-page-break', 'style'] })
  document.getElementById('doc-work-area').innerHTML = `<div class="doc-editor-layout ${state.outlineOpen ? '' : 'outline-closed'}"><aside class="doc-outline" id="doc-outline"></aside><div class="doc-editor-scroll"><article id="document-editor" class="document-editor" style="zoom:${state.docZoom}" contenteditable="true" spellcheck="true" aria-label="在线教案富文本编辑器">${html}</article><span class="doc-zoom-hint" data-doc-zoom-hint>${Math.round(state.docZoom * 100)}%</span></div></div>`
  renderFormulaElements(document.getElementById('document-editor')); renderOutline(); renderRecovery(); updateDocumentStatus(); updateAiContextSummary()
  document.querySelector('.prep-document-workspace').dataset.surface = 'document'
}

function renderEmptyWorkspace() {
  updateModeButtons('edit')
  document.getElementById('doc-work-area').innerHTML = emptyWorkspaceHtml()
  updateDocumentStatus()
}

function updateDocumentStatus(saveText) {
  const text = state.document?.current_version?.plain_text || document.getElementById('document-editor')?.innerText || ''
  document.getElementById('doc-word-count').textContent = `${text.replace(/\s/g, '').length} 字`
  document.getElementById('doc-version-state').textContent = state.document ? `V${state.document.current_version?.version_number || 0} · r${state.document.revision}` : '—'
  if (saveText) document.getElementById('prep-save-state').textContent = saveText
  else document.getElementById('prep-save-state').textContent = state.document ? '已保存' : '未打开教案'
  updateDocumentActions()
}

function updateDocumentActions() {
  const hasDocument = Boolean(state.document?.current_version)
  ;['doc-version-create', 'doc-student-open', 'doc-export-main', 'doc-outline-toggle', 'doc-sync-stage'].forEach(id => {
    const button = document.getElementById(id)
    if (button) button.disabled = !hasDocument
  })
  document.querySelector('[data-doc-mode="versions"]')?.toggleAttribute('disabled', !hasDocument)
  document.querySelector('[data-doc-mode="compare"]')?.toggleAttribute('disabled', !hasDocument || !state.pdfSource)
}

function markDirty(revisionType = 'teacher_manual', instruction = '') {
  if (!state.document) return
  state.editEpoch += 1
  state.pendingRevisionType = revisionType; state.pendingInstruction = instruction
  setTabDirty(true); updateDocumentStatus('等待保存')
  const html = cleanEditorHtml()
  localStorage.setItem(`${DRAFT_PREFIX}${state.document.id}`, JSON.stringify({ html, title: state.document.title, baseRevision: state.document.revision, updatedAt: Date.now() }))
  clearTimeout(state.saveTimer); state.saveTimer = setTimeout(() => void flushSave(), SAVE_DELAY)
}

async function flushSave() {
  clearTimeout(state.saveTimer)
  if (state.savePromise) {
    await state.savePromise
    if (editableTab()?.dirty && document.getElementById('document-editor') && navigator.onLine) return flushSave()
    return !editableTab()?.dirty
  }
  if (!state.document || !editableTab()?.dirty || !document.getElementById('document-editor')) return true
  state.saveInFlight = true; state.saveQueued = false; updateDocumentStatus('正在保存…')
  const documentId = state.document.id; const html = cleanEditorHtml(); const baseRevision = state.document.revision; const baseEditEpoch = state.editEpoch
  const revisionType = state.pendingRevisionType; const instruction = state.pendingInstruction
  state.savePromise = (async () => { try {
    const result = await saveEditableTeachingDocument(documentId, {
      revision: baseRevision, operation_id: uid('autosave'), title: state.document.title,
      sanitized_html: html, revision_type: revisionType, instruction,
      metadata: { currentSection: state.currentSection, pptResourceId: state.ppt.resourceId, slideIndex: state.ppt.slideIndex, pdfResourceId: state.pdfSource?.source_kind === 'resource' ? state.pdfSource.id : null, pdfPageNumber: state.pdfState.pageNumber },
      source_context: { pptResourceId: state.ppt.resourceId, slideIndex: state.ppt.slideIndex, pdfSource: state.pdfSource ? { kind: state.pdfSource.source_kind, id: state.pdfSource.id, page: state.pdfState.pageNumber } : null },
    })
    if (state.document?.id === documentId) {
      state.document = result.data
      state.conflict = null
      const unchanged = state.editEpoch === baseEditEpoch
      if (unchanged) {
        const editor = document.getElementById('document-editor')
        if (editor && cleanEditorHtml() !== html) {
          editor.innerHTML = DOMPurify.sanitize(result.data.current_version?.sanitized_html || html, { USE_PROFILES: { html: true }, ADD_ATTR: ['data-formula', 'data-section-key', 'data-page-break', 'style'] })
          renderFormulaElements(editor); renderOutline()
        }
        setTabDirty(false); localStorage.removeItem(`${DRAFT_PREFIX}${documentId}`); state.recovery = null; renderRecovery(); updateDocumentStatus('已保存'); state.pendingRevisionType = 'teacher_manual'; state.pendingInstruction = ''
      }
      else { state.saveQueued = true; updateDocumentStatus('有新修改待保存') }
    }
    return true
  } catch (error) {
    if (error.code === 40901) {
      const server = await getEditableTeachingDocument(documentId).then(result => result.data).catch(() => null)
      state.conflict = { documentId, serverRevision: server?.revision || error.data?.server_revision, server }
      updateDocumentStatus('保存冲突'); renderRecovery(); showToast('服务器已有新内容；当前编辑内容仍保留，请选择保留我的内容或查看服务器版本。', 'error')
    }
    else { updateDocumentStatus('保存失败，草稿已本地保留'); showToast(error.message || '自动保存失败', 'error') }
    return false
  } finally {
    state.saveInFlight = false
  } })()
  const saved = await state.savePromise
  state.savePromise = null
  if (state.saveQueued && navigator.onLine) { state.saveQueued = false; return flushSave() }
  return saved
}

async function createDocument(mode) {
  try {
    if (mode === 'ppt' && !state.ppt.resourceId) return showToast('请先在左侧选择 PPT/PPTX 课件页面', 'warning')
    const title = document.getElementById('doc-new-title').value.trim() || (state.plan ? `${state.plan.topic}教学设计` : '未命名教案')
    const result = await createEditableTeachingDocument({ title, creation_mode: mode, ...(state.plan ? { lesson_plan_id: state.plan.lesson_plan_id } : {}), ...(state.courseId ? { course_id: state.courseId } : {}), ...(state.classId ? { teaching_class_id: state.classId } : {}), ...(mode === 'ppt' ? { ppt_resource_id: state.ppt.resourceId, slide_index: state.ppt.slideIndex } : {}) })
    document.getElementById('doc-new-dialog').close(); await openEditableDocument(result.data.id); showToast(mode === 'ppt' ? '已根据服务端校验的当前 PPT 页面创建教案框架' : '教案草稿已创建', 'success')
  } catch (error) { showToast(error.message || '教案创建失败', 'error') }
}

async function validateLocalFile(file) {
  if (!file) throw new Error('请选择文件')
  const name = file.name.normalize('NFKC'); const extension = name.split('.').pop().toLowerCase()
  if (name.includes('/') || name.includes('\\') || !ACCEPTED_FILES.has(extension)) throw new Error('仅支持 PPT/PPTX、DOCX、PDF、Markdown 和 TXT')
  if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20MB 限制')
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  if (extension === 'docx' && !(header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04)) throw new Error('DOCX 文件头校验失败')
  if (extension === 'pptx' && !(header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04)) throw new Error('PPTX 文件头校验失败')
  if (extension === 'ppt' && !(header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0)) throw new Error('PPT 文件头校验失败')
  if (extension === 'pdf' && String.fromCharCode(...header) !== '%PDF-') throw new Error('PDF 文件头校验失败')
  if (header[0] === 0x4d && header[1] === 0x5a) throw new Error('不允许上传可执行文件')
  return extension
}

function setDragState(value, message) {
  state.dragState = value
  document.getElementById('document-workspace').dataset.dragState = value
  document.getElementById('doc-drag-status').textContent = message || ({ default: '可拖入 DOCX / PDF / Markdown / TXT', 'dragging-over': '释放文件以导入', validating: '正在校验文件…', uploading: '正在上传…', parsing: '正在解析并转换…', ready: '文件已打开', failed: '导入失败' }[value])
}

function setPptFileState(value, message) {
  state.ppt.status = value
  const panel = document.querySelector('.prep-ppt-panel')
  if (panel) panel.dataset.fileState = value
  const host = document.getElementById('ppt-context-state')
  if (host && message) host.textContent = message
}

function revokePptObjectUrl() {
  if (state.ppt.objectUrl) URL.revokeObjectURL(state.ppt.objectUrl)
  if (state.ppt.pdfObjectUrl) URL.revokeObjectURL(state.ppt.pdfObjectUrl)
  state.ppt.objectUrl = null
  state.ppt.pdfObjectUrl = null
}

async function destroyPptViewer() {
  if (state.ppt.viewer) await state.ppt.viewer.destroy().catch(() => {})
  state.ppt.viewer = null
  state.ppt.viewerResourceId = null
}

async function mountPptPdfPreview(resource) {
  const root = document.getElementById('ppt-pdf-viewer')
  const outputId = Number(resource.conversion?.output_resource_id)
  if (!root || !outputId) return
  if (state.ppt.viewer && state.ppt.viewerResourceId === outputId) return
  await destroyPptViewer()
  state.ppt.viewerResourceId = outputId
  state.ppt.viewer = new LearningPdfViewer(root, { onStateChange: next => {
    state.ppt.slideIndex = Math.max(0, Number(next.pageNumber || 1) - 1)
    state.ppt.pageCount = Number(next.pageCount || 0)
    state.ppt.zoom = Number(next.scale || 1)
    const page = document.getElementById('ppt-page'); if (page) page.textContent = `/ ${state.ppt.pageCount || '—'}`
    const input = document.getElementById('ppt-page-input'); if (input) { input.value = String(state.ppt.slideIndex + 1); input.max = String(Math.max(1, state.ppt.pageCount)) }
    const zoom = document.getElementById('ppt-zoom'); if (zoom) zoom.textContent = `${Math.round(state.ppt.zoom * 100)}%`
    const previous = document.getElementById('ppt-prev'); if (previous) previous.disabled = state.ppt.slideIndex <= 0
    const nextButton = document.getElementById('ppt-next'); if (nextButton) nextButton.disabled = !state.ppt.pageCount || state.ppt.slideIndex >= state.ppt.pageCount - 1
    updateAiContextSummary(); persistWorkspace()
  } })
  try {
    await state.ppt.viewer.load({ url: `/teacher/preparation/files/content?source_kind=resource&id=${outputId}`, name: `${resource.title}.pdf`, type: 'ppt_conversion' })
    await state.ppt.viewer.goTo(state.ppt.slideIndex + 1)
  } catch (error) { showToast(error.message || '转换 PDF 预览加载失败', 'error') }
}

function pollPptConversion() {
  clearInterval(state.pptPoller)
  const resourceId = Number(state.ppt.resourceId)
  if (!resourceId) return
  state.pptPoller = setInterval(async () => {
    try {
      await refreshSelectable(false)
      const resource = currentPptResource()
      if (!resource || Number(resource.id) !== resourceId) return clearInterval(state.pptPoller)
      renderPptSelector()
      if (resource.preview_status === 'ready' || resource.conversion?.status === 'failed') clearInterval(state.pptPoller)
    } catch {}
  }, 2500)
}

async function handlePptFile(file, knownExtension) {
  try {
    setPptFileState('validating', '正在校验课件文件…')
    const extension = knownExtension || await validateLocalFile(file)
    if (!['ppt', 'pptx'].includes(extension)) throw new Error('PPT 区域仅支持 PPT/PPTX 文件')
    setPptFileState('uploading', '正在上传并创建课件资源…')
    const result = await importPreparationDocument(file, { ...(state.plan ? { lesson_plan_id: state.plan.lesson_plan_id, course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id } : {}) })
    if (result.data.kind !== 'ppt' || !result.data.resource) throw new Error('服务端未返回有效课件资源')
    await refreshSelectable(false)
    const item = state.selectable.find(row => row.source_kind === 'resource' && Number(row.id) === Number(result.data.resource.id)) || result.data.resource
    state.ppt.resourceId = item.id; state.ppt.sourceKind = 'resource'; state.ppt.slideIndex = 0
    revokePptObjectUrl(); renderPptSelector(); renderPptPreview(); persistWorkspace()
    setPptFileState(item.preview_status === 'ready' ? 'ready' : 'converting', result.data.conversion?.message || result.data.message)
    showToast(result.data.message || 'PPT 课件已上传', item.preview_status === 'ready' ? 'success' : 'warning')
  } catch (error) {
    setPptFileState('failed', error.message || 'PPT 导入失败')
    showToast(error.message || 'PPT 导入失败', 'error')
  }
}

async function handleLocalFile(file, pdfAction) {
  try {
    setDragState('validating'); const extension = await validateLocalFile(file)
    if (['ppt', 'pptx'].includes(extension)) { setDragState('default'); return handlePptFile(file, extension) }
    if (extension === 'pdf' && !pdfAction) { state.pendingFile = file; document.getElementById('doc-pdf-choice').showModal(); return }
    if (extension === 'pdf' && pdfAction === 'reference') { await openLocalPdf(file); setDragState('ready'); showToast('PDF 已通过本地 Blob 只读打开，仅在当前会话有效', 'success'); return }
    setDragState('uploading')
    const result = await importPreparationDocument(file, { ...(state.plan ? { lesson_plan_id: state.plan.lesson_plan_id, course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id } : {}), ...(pdfAction ? { pdf_action: pdfAction } : {}) })
    setDragState('parsing')
    if (result.data.kind === 'pdf') await openPdfSource(result.data.resource)
    else await openEditableDocument(result.data.document.id)
    setDragState('ready'); showToast(result.data.format_notice || result.data.message || '文件已导入', 'success'); setTimeout(() => setDragState('default'), 1600)
  } catch (error) { setDragState('failed', error.message || '导入失败'); showToast(error.message || '导入失败', 'error'); setTimeout(() => setDragState('default'), 3000); await refreshSelectable(false) }
}

async function refreshSelectable(render = true) {
  try { state.selectable = (await getPreparationSelectableResources({ ...(state.plan ? { context_lesson_plan_id: state.plan.lesson_plan_id } : {}), ...(state.courseId ? { context_course_id: state.courseId } : {}), ...(state.classId ? { context_teaching_class_id: state.classId } : {}) })).data?.list || [] }
  catch { state.selectable = [] }
  if (render) renderResourceList()
}

function renderResourceList() {
  const query = document.getElementById('doc-resource-search').value.trim().toLowerCase(); const group = document.getElementById('doc-resource-group').value; const type = document.getElementById('doc-resource-type').value
  const rows = state.selectable.filter(item => (!query || item.title.toLowerCase().includes(query)) && (!group || item.group === group) && (!type || (type === 'internal' ? item.file_ext === 'internal' : type === 'pptx' ? ['ppt', 'pptx'].includes(item.file_ext) : item.file_ext === type)))
  const groupLabels = { current_plan: '当前备课方案', generated: '智慧备课产物', my_lessons: '我的教案', teacher_resource: '教师资源中心', course_resource: '课程资源', class_resource: '教学班资源', knowledge_base: '知识库文件', recent: '最近使用' }
  document.getElementById('doc-resource-list').innerHTML = rows.map(item => {
    const artifactReady = item.source_kind !== 'artifact' || (item.exports || []).some(entry => entry.status === 'ready')
    const ready = artifactReady && ['ready', 'content_ready', 'draft', 'published', 'active'].includes(item.status) && !['running', 'queued', 'generating', 'exporting'].includes(item.task_status)
    return `<button data-resource-item="${escapeHtml(item.source_kind)}:${item.id}" ${ready ? '' : 'disabled'}><i>${escapeHtml(item.file_ext.toUpperCase() || 'FILE')}</i><span><b>${escapeHtml(item.title)}</b><em>${escapeHtml(groupLabels[item.group] || item.group)} · ${ready ? '可打开' : `真实状态：${item.task_status || item.status}`}</em></span><strong>${ready ? '打开' : '等待'}</strong></button>`
  }).join('') || '<div class="prep-workspace-empty"><p>没有匹配的真实文件</p></div>'
}

async function openResourceItem(key) {
  const [kind, idText] = key.split(':'); const id = Number(idText); const item = state.selectable.find(row => row.source_kind === kind && row.id === id); if (!item) return
  if (['ppt', 'pptx'].includes(item.file_ext)) { await openPptItem(item); document.getElementById('doc-resource-dialog').close(); return }
  if (item.file_ext === 'internal') { await openEditableDocument(item.id); document.getElementById('doc-resource-dialog').close(); return }
  if (item.file_ext === 'pdf') { await openPdfSource(item); document.getElementById('doc-resource-dialog').close(); return }
  const payload = { ...(kind === 'artifact' ? { artifact_id: id, format: item.exports?.find(entry => entry.status === 'ready')?.format?.toUpperCase() } : { resource_id: id }), ...(state.plan ? { lesson_plan_id: state.plan.lesson_plan_id, course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id } : {}) }
  const result = await importPreparationPlatformFile(payload)
  if (result.data.kind === 'pdf') await openPdfSource(result.data.resource || result.data.artifact)
  else await openEditableDocument(result.data.document.id)
  document.getElementById('doc-resource-dialog').close(); showToast(result.data.message || '平台文件已转换为新的可编辑教案草稿', 'success')
}

async function destroyPdf() { if (state.pdfViewer) { await state.pdfViewer.destroy(); state.pdfViewer = null } }

function pdfMarkup(compact = false) {
  return `<section class="doc-pdf-viewer ${compact ? 'compact' : ''}" id="doc-pdf-viewer"><header><input id="pdf-search" placeholder="搜索 PDF 文本"><button id="pdf-search-button">查找</button><button id="pdf-prev">上一页</button><input id="pdf-page-input" type="number" min="1" value="1" aria-label="PDF 页码"><span id="pdf-page-state">/ 1</span><button id="pdf-next">下一页</button><button id="pdf-zoom-out">−</button><span id="pdf-zoom-state">100%</span><button id="pdf-zoom-in">＋</button><button id="pdf-fit">适合宽度</button><button id="pdf-download">下载</button><button id="pdf-window">新窗口</button><button id="pdf-extract-copy">提取为可编辑副本</button></header><div class="lws-pdf-viewport" data-pdf-viewport><div class="lws-pdf-pages" data-pdf-pages></div><span class="lws-pdf-zoom-hint" data-pdf-zoom-hint></span></div></section>`
}

async function mountPdfViewer() {
  const root = document.getElementById('doc-pdf-viewer'); if (!root || !state.pdfSource) return
  await destroyPdf()
  state.pdfViewer = new LearningPdfViewer(root, { onStateChange: next => {
    state.pdfState = { ...state.pdfState, ...next }
    const page = document.getElementById('pdf-page-state'); if (page) page.textContent = `/ ${next.pageCount || 1}`
    const pageInput = document.getElementById('pdf-page-input'); if (pageInput) { pageInput.value = String(next.pageNumber || 1); pageInput.max = String(next.pageCount || 1) }
    const zoom = document.getElementById('pdf-zoom-state'); if (zoom) zoom.textContent = `${Math.round((next.scale || 1) * 100)}%`
    persistWorkspace(); updateAiContextSummary()
  } })
  try {
    if (state.pdfSource.source_kind === 'local') await state.pdfViewer.load({ file: state.pdfSource.file, name: state.pdfSource.title, type: 'local' })
    else {
      const params = new URLSearchParams({ source_kind: state.pdfSource.source_kind, id: String(state.pdfSource.id), ...(state.pdfSource.format ? { format: state.pdfSource.format } : {}) })
      await state.pdfViewer.load({ url: `/teacher/preparation/files/content?${params}`, name: state.pdfSource.title, type: state.pdfSource.source_kind })
    }
    await state.pdfViewer.restoreView(state.pdfState)
  } catch (error) { showToast(error.message || 'PDF 加载失败', 'error') }
}

async function openPdfSource(item, add = true) {
  await flushSave()
  state.pdfSource = { id: item.id, source_kind: item.source_kind || 'resource', title: item.title || item.file_name || 'PDF 参考', format: item.format || 'PDF', ...(item.file ? { file: item.file } : {}) }
  state.mode = 'pdf'
  if (add) addTab({ key: `pdf:${state.pdfSource.source_kind}:${item.id}`, kind: 'pdf', id: item.id, sourceKind: state.pdfSource.source_kind, title: state.pdfSource.title, file: item.file, dirty: false })
  renderPdfView(); persistWorkspace(); updateAiContextSummary()
}

async function openLocalPdf(file) {
  const id = `local-${crypto.randomUUID?.() || Date.now()}`
  await openPdfSource({ id, source_kind: 'local', title: file.name, file_ext: 'pdf', file })
}

function renderPdfView() { updateModeButtons('pdf'); document.getElementById('doc-work-area').innerHTML = pdfMarkup(); void mountPdfViewer() }

function renderCompareView() {
  const documentPaneWidth = paneElement('document')?.getBoundingClientRect().width || 0
  if (window.innerWidth <= 1024 || documentPaneWidth < 680) { showToast('教案区域宽度不足；请扩大教案模块或使用教案/PDF 标签切换', 'warning'); return }
  if (!state.document || !state.pdfSource) { showToast('请先分别打开一份教案和一份 PDF 参考', 'warning'); return }
  state.mode = 'compare'; updateModeButtons('compare')
  const html = DOMPurify.sanitize(state.document.current_version.sanitized_html, { USE_PROFILES: { html: true }, ADD_ATTR: ['data-formula', 'data-section-key', 'data-page-break', 'style'] })
  document.getElementById('doc-work-area').innerHTML = `<div class="doc-compare-view"><div class="doc-editor-scroll"><article id="document-editor" class="document-editor compact" style="zoom:${state.docZoom}" contenteditable="true">${html}</article><span class="doc-zoom-hint" data-doc-zoom-hint>${Math.round(state.docZoom * 100)}%</span></div>${pdfMarkup(true)}</div>`
  renderFormulaElements(document.getElementById('document-editor')); void mountPdfViewer()
}

function applyDocumentZoom({ delta, clientX, clientY }) {
  const scroller = document.querySelector('.doc-editor-scroll')
  const editor = document.getElementById('document-editor')
  if (!scroller || !editor) return
  const oldZoom = state.docZoom
  const newZoom = Math.min(2, Math.max(.5, Math.round((oldZoom + (delta < 0 ? .1 : -.1)) * 10) / 10))
  if (newZoom === oldZoom) return
  const rect = scroller.getBoundingClientRect()
  const pointerX = Math.max(0, clientX - rect.left)
  const pointerY = Math.max(0, clientY - rect.top)
  const anchorX = scroller.scrollLeft + pointerX - editor.offsetLeft
  const anchorY = scroller.scrollTop + pointerY - editor.offsetTop
  state.docZoom = newZoom
  editor.style.zoom = String(newZoom)
  const ratio = newZoom / oldZoom
  requestAnimationFrame(() => {
    scroller.scrollLeft = Math.max(0, editor.offsetLeft + anchorX * ratio - pointerX)
    scroller.scrollTop = Math.max(0, editor.offsetTop + anchorY * ratio - pointerY)
  })
  const hint = scroller.querySelector('[data-doc-zoom-hint]')
  if (hint) {
    hint.textContent = `${Math.round(newZoom * 100)}%`
    hint.classList.add('is-visible')
    clearTimeout(state.docZoomHintTimer)
    state.docZoomHintTimer = setTimeout(() => hint.classList.remove('is-visible'), 800)
  }
  persistWorkspace()
}

function handleDocumentWheel(event) {
  if (!event.ctrlKey || !event.target.closest('.doc-editor-scroll')) return
  event.preventDefault()
  state.pendingDocZoom = { delta: event.deltaY, clientX: event.clientX, clientY: event.clientY }
  if (state.docZoomFrame) return
  state.docZoomFrame = requestAnimationFrame(() => {
    state.docZoomFrame = 0
    const pending = state.pendingDocZoom
    state.pendingDocZoom = null
    if (pending) applyDocumentZoom(pending)
  })
}

async function searchPdf(query) {
  const value = String(query || '').trim().toLowerCase(); if (!value || !state.pdfViewer?.document) return
  for (let pageNumber = 1; pageNumber <= state.pdfViewer.pageCount; pageNumber += 1) {
    const page = await state.pdfViewer.document.getPage(pageNumber); const content = await page.getTextContent(); const text = content.items.map(item => item.str).join(' ').toLowerCase()
    if (text.includes(value)) { await state.pdfViewer.goTo(pageNumber); showToast(`已定位到第 ${pageNumber} 页`, 'success'); return }
  }
  showToast('未找到匹配文字；扫描 PDF 可能没有文本层', 'warning')
}

async function extractCurrentPdf() {
  if (!state.pdfSource || !confirm('不会修改原 PDF。系统将提取文本层并创建一份新的可编辑教案副本，是否继续？')) return
  if (state.pdfSource.source_kind === 'local') {
    try {
      const result = await importPreparationDocument(state.pdfSource.file, { pdf_action: 'extract', ...(state.plan ? { lesson_plan_id: state.plan.lesson_plan_id, course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id } : {}) })
      await openEditableDocument(result.data.document.id); showToast('已上传并创建新的可编辑教案副本；本地 PDF 保持不变', 'success')
    } catch (error) { showToast(error.message || 'PDF 正文提取失败', 'error') }
    return
  }
  const payload = { ...(state.pdfSource.source_kind === 'artifact' ? { artifact_id: state.pdfSource.id, format: 'PDF' } : { resource_id: state.pdfSource.id }), pdf_action: 'extract', ...(state.plan ? { lesson_plan_id: state.plan.lesson_plan_id, course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id } : {}) }
  try { const result = await importPreparationPlatformFile(payload); await openEditableDocument(result.data.document.id); showToast('已创建新的可编辑教案副本；原 PDF 保持不变', 'success') }
  catch (error) { showToast(error.message || 'PDF 正文提取失败', 'error') }
}

function updateModeButtons(mode) { state.mode = mode; document.querySelectorAll('[data-doc-mode]').forEach(button => button.classList.toggle('active', button.dataset.docMode === mode)); document.getElementById('doc-toolbar').hidden = !state.document?.current_version || !['edit', 'compare'].includes(mode); updateDocumentActions() }

async function renderVersionsView() {
  if (!state.document) return showToast('请先打开教案', 'warning')
  await flushSave(); updateModeButtons('versions'); await destroyPdf()
  const versions = (await getEditableTeachingDocumentVersions(state.document.id)).data?.list || []
  document.getElementById('doc-work-area').innerHTML = `<section class="doc-versions"><header><div><b>教案版本</b><span>已发布版本不会被自动保存静默覆盖</span></div><span><button id="doc-version-create-inline">创建当前版本</button><button id="doc-version-publish-inline">发布当前版本</button></span></header><div class="doc-version-compare-controls"><select id="doc-version-from">${versions.map(item => `<option value="${item.id}">V${item.version_number}</option>`).join('')}</select><span>对比</span><select id="doc-version-to">${versions.map(item => `<option value="${item.id}">V${item.version_number}</option>`).join('')}</select><button id="doc-version-compare">开始对比</button></div><div id="doc-version-diff" class="doc-version-diff"></div><div class="doc-version-list">${versions.map(item => `<article><div><b>V${item.version_number}${item.id === state.document.current_version_id ? ' · 当前' : ''}</b><span>${escapeHtml(item.change_summary || '无变更摘要')}</span><em>${escapeHtml(item.creator_name || '')} · ${formatRelativeTime(item.created_at)}${item.published_at ? ' · 已发布' : ''}</em></div><button data-version-preview="${item.id}">查看</button><button data-version-restore="${item.id}">恢复为新版本</button><button data-version-export="${item.id}">导出</button></article>`).join('')}</div></section>`
}

async function compareDocumentVersions() {
  const from = document.getElementById('doc-version-from').value; const to = document.getElementById('doc-version-to').value
  if (!from || !to || from === to) return showToast('请选择两个不同版本', 'warning')
  const result = await compareEditableTeachingDocumentVersions(state.document.id, from, to)
  document.getElementById('doc-version-diff').innerHTML = `<b>差异 ${result.data.changes.length} 处</b>${result.data.changes.slice(0, 200).map(change => `<div><i>第 ${change.line} 行</i><del>${escapeHtml(change.before)}</del><ins>${escapeHtml(change.after)}</ins></div>`).join('') || '<p>文本内容一致</p>'}`
}

function captureSelection() {
  const editor = document.getElementById('document-editor'); const selection = window.getSelection()
  if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return
  const range = selection.getRangeAt(0); const before = range.cloneRange(); before.selectNodeContents(editor); before.setEnd(range.startContainer, range.startOffset)
  state.savedRange = range.cloneRange(); state.selection = { start: before.toString().length, end: before.toString().length + range.toString().length, text: range.toString() }
  const heading = range.startContainer.parentElement?.closest?.('h1,h2,h3,h4') || [...editor.querySelectorAll('h1,h2,h3,h4')].filter(item => (item.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) === 0).at(-1)
  state.currentSection = heading?.textContent.trim() || state.currentSection
  document.getElementById('prep-ai-selection').textContent = state.selection.text ? `已选择 ${state.selection.text.length} 字` : state.currentSection ? `当前章节：${state.currentSection}` : '未选择教案文字'
  renderOutline()
}

function teacherInputLength(value) { return Array.from(String(value || '').trim()).length }

function preparationAiContext() {
  const resource = currentPptResource()
  const slide = resource?.slides?.[state.ppt.slideIndex]
  const overview = state.analytics?.overview || {}
  return {
    surface: 'immersive_preparation',
    lesson_plan: state.plan ? { id: state.plan.lesson_plan_id, topic: state.plan.topic, current_version: state.plan.current_version, current_stage: activeStepKey(), locked_stages: state.locked } : null,
    teaching_document: state.document ? { id: state.document.id, version: state.document.current_version?.version_number, section: state.currentSection || null, selected_text: String(state.selection.text || '').slice(0, 4000) } : null,
    ppt: resource ? { source_kind: resource.source_kind, resource_id: resource.id, title: resource.title, page_number: state.ppt.slideIndex + 1, page_text: String(slide?.text || '').slice(0, 5000), speaker_notes: String(state.ppt.localNotes[state.ppt.slideIndex] || slide?.notes || '').slice(0, 2500) } : null,
    pdf: state.pdfSource ? { source_kind: state.pdfSource.source_kind, resource_id: state.pdfSource.id, title: state.pdfSource.title, page_number: state.pdfState.pageNumber || 1 } : null,
    class_summary: state.plan ? { course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id, student_count: overview.student_count || 0, average_mastery: overview.average_mastery || 0, weak_knowledge_points: normalizeWeakKnowledgePoints(state.analytics?.weak_knowledge_points).slice(0, 8).map(item => ({ name: item.name, mastery: item.mastery })) } : null,
  }
}

async function ensureImmersiveAiConversation() {
  if (state.ai.conversationId) return state.ai.conversationId
  const result = await createTeacherAiConversation({ mode: 'preparation', title: state.plan?.topic ? `${state.plan.topic} · 沉浸式备课` : '沉浸式备课', context: { course_id: state.plan?.course_id, teaching_class_id: state.plan?.teaching_class_id } })
  state.ai.conversationId = result.data.id
  persistWorkspace()
  return state.ai.conversationId
}

async function loadImmersiveAiHistory() {
  if (!state.ai.conversationId || state.ai.messages.length) return
  try {
    const result = await getTeacherAiMessages(state.ai.conversationId)
    const rows = result.data?.list || result.data?.messages || result.data || []
    state.ai.messages = (Array.isArray(rows) ? rows : []).map(item => ({ role: String(item.role || '').toLowerCase(), content: item.content || '', proposal: String(item.role || '').toLowerCase() === 'assistant', sources: item.sources || item.sources_json || [] }))
    renderAiMessages()
  } catch { state.ai.conversationId = null; persistWorkspace() }
}

function renderAiAttachments() {
  const host = document.getElementById('prep-ai-files'); if (!host) return
  host.innerHTML = state.ai.attachments.map(item => `<span>${escapeHtml(item.name || item.file_name || '附件')}<button type="button" data-remove-ai-file="${item.id}">×</button></span>`).join('')
}

async function askDocumentAi(instruction) {
  if (state.ai.busy) { state.ai.controller?.abort(); return }
  const content = String(instruction || '').trim()
  if (!content && !state.ai.attachments.length) return
  const chars = teacherInputLength(content)
  if (chars > 5000) return showToast(`当前输入 ${chars} 字，最多 5000 字；教学上下文不计入此限制`, 'warning')
  captureSelection()
  if (editableTab()?.dirty && !(await flushSave())) return showToast('当前教案尚未成功保存，暂不发送 AI 请求', 'warning')
  const attachments = [...state.ai.attachments]
  state.ai.attachments = []; renderAiAttachments()
  const userMessage = { role: 'user', content: content || attachments.map(item => item.name || item.file_name).join('、') }
  const assistant = { role: 'assistant', content: '', proposal: true, instruction: content, selectedText: state.selection.text, streaming: true }
  state.ai.messages.push(userMessage, assistant)
  state.ai.lastPrompt = content
  state.ai.busy = true
  state.ai.controller = new AbortController()
  renderAiMessages()
  try {
    const conversationId = await ensureImmersiveAiConversation()
    await streamTeacherAiMessage(conversationId, {
      content,
      attachments: attachments.map(item => item.id),
      context: { course_id: state.plan?.course_id, teaching_class_id: state.plan?.teaching_class_id, page: '/teacher/preparation/immersive' },
      preparation_context: preparationAiContext(),
      assistant_surface: 'immersive_preparation',
      client_request_id: uid('immersive-ai'),
    }, { signal: state.ai.controller.signal, onEvent(event, payload) {
      if (event === 'delta') {
        assistant.content += payload.content || ''
        if (!state.ai.autoFollow || state.layout.panes.assistant.hidden || state.layout.panes.assistant.collapsed) state.ai.unread += 1
        renderAiMessages(state.ai.autoFollow)
      }
      else if (event === 'done') { assistant.content = payload.assistant_message?.content || assistant.content; assistant.sources = payload.assistant_message?.sources || payload.sources || [] }
      else if (event === 'error') throw new Error(payload.message || 'AI 生成失败')
    } })
  } catch (error) {
    if (error.name === 'AbortError') assistant.stopped = true
    else { assistant.role = 'error'; assistant.content = error.message || 'AI 建议生成失败' }
  } finally {
    assistant.streaming = false
    state.ai.busy = false
    state.ai.controller = null
    persistWorkspace(); renderAiMessages()
  }
}

function renderAiMessages(scroll = true) {
  const host = document.getElementById('prep-ai-messages')
  const previousScrollTop = host.scrollTop
  host.innerHTML = state.ai.messages.length ? state.ai.messages.map((message, index) => message.role === 'assistant' ? `<article class="ai-proposal ${message.applied ? 'applied' : ''}"><header><b>${message.applied ? 'AI 回答 · 已应用' : 'AI 回答'}</b><span>${message.streaming ? '正在生成…' : message.stopped ? '已停止' : message.applied ? '已写入教案' : '等待教师确认'}</span></header><div class="message-markdown">${message.content ? renderMarkdownToHtml(message.content) : '<span class="prep-ai-loading">正在连接模型…</span>'}</div>${message.sources?.length ? `<details><summary>查看来源 ${message.sources.length}</summary>${message.sources.map(source => `<p>${escapeHtml(source.label || source.type || '上下文')}</p>`).join('')}</details>` : ''}<footer>${message.streaming ? '' : message.applied ? '<span class="ai-applied-state">已写入编辑器并进入自动保存与修订记录</span>' : `<button data-apply-ai="cursor" data-message-index="${index}">插入光标</button><button data-apply-ai="replace" data-message-index="${index}" ${message.selectedText ? '' : 'disabled'}>替换选区</button><button data-apply-ai="section" data-message-index="${index}">追加章节</button><button data-apply-ai="new-section" data-message-index="${index}">新建章节</button><button data-apply-ai="notes" data-message-index="${index}">保存页讲稿</button><button data-apply-ai="draft" data-message-index="${index}">备课草稿</button><button data-apply-ai="student" data-message-index="${index}">学生材料</button><button data-apply-ai="copy" data-message-index="${index}">复制</button><button data-apply-ai="discard" data-message-index="${index}">放弃</button>`}</footer></article>` : `<article class="ai-${message.role}"><b>${message.role === 'user' ? '教师' : '提示'}</b><div>${message.role === 'error' ? escapeHtml(message.content) : renderMarkdownToHtml(message.content)}</div></article>`).join('') : '<div class="prep-ai-empty">AI 结果会先进入预览卡片；教师确认后才会修改教案。</div>'
  renderMathInMarkdownElements(host)
  const send = document.getElementById('prep-ai-send'); if (send) { send.textContent = state.ai.busy ? '停止' : '发送'; send.classList.toggle('is-stop', state.ai.busy) }
  const unread = document.getElementById('prep-ai-unread')
  if (unread) { unread.hidden = !state.ai.unread; unread.textContent = state.ai.unread > 99 ? '99+' : String(state.ai.unread) }
  if (scroll && state.ai.autoFollow) {
    host.scrollTop = host.scrollHeight
    state.ai.unread = 0
    if (unread) unread.hidden = true
  } else host.scrollTop = previousScrollTop
}

function proposalFragment(content) {
  const wrapper = document.createElement('div'); wrapper.innerHTML = DOMPurify.sanitize(renderMarkdownToHtml(content), { USE_PROFILES: { html: true } }); const fragment = document.createDocumentFragment(); while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild); return fragment
}

const AI_APPLY_LABELS = { cursor: '插入当前光标', replace: '替换当前选区', section: '追加到当前章节', 'new-section': '新建为章节' }

function proposalSectionTitle(message) {
  const content = String(message?.content || '')
  const markdownHeading = content.match(/^#{1,4}\s+([^\n]{2,48})/m)?.[1]?.trim()
  if (markdownHeading) return markdownHeading
  const instruction = String(message?.instruction || '')
  const topic = ['课堂收束', '板书设计', '课堂提问', '课堂任务单', '演讲稿', '教学活动', '作业设计', '分层教学'].find(item => instruction.includes(item))
  if (topic === '课堂收束' && instruction.includes('出口卡')) return '课堂收束与出口卡'
  if (topic) return topic
  const compact = instruction.replace(/[；。！？].*$/, '').replace(/^(请|帮我|请基于[^，,]*[，,]?)/, '').trim()
  return compact ? compact.slice(0, 24) : 'AI 补充内容'
}

function requestAiProposalApply(index, mode) {
  const message = state.ai.messages[index]
  if (!message || message.applied) return
  if (!Object.hasOwn(AI_APPLY_LABELS, mode)) return applyAiProposal(index, mode)
  if (!state.document) return showToast('请先新建或打开一份教案，再应用 AI 内容', 'warning')
  state.ai.pendingApply = { index, mode }
  document.getElementById('prep-ai-apply-summary').innerHTML = `<b>${escapeHtml(AI_APPLY_LABELS[mode])}</b><span>${escapeHtml(message.instruction || 'AI 回答')}</span>`
  document.getElementById('prep-ai-apply-dialog').showModal()
}

function applyAiProposal(index, mode) {
  const message = state.ai.messages[index]; const editor = document.getElementById('document-editor'); if (!message || !editor || message.applied) return
  if (mode === 'discard') { state.ai.messages.splice(index, 1); renderAiMessages(); return }
  if (mode === 'copy') { navigator.clipboard?.writeText(message.content); showToast('AI 回答已复制', 'success'); return }
  if (mode === 'student') { document.getElementById('doc-student-dialog').showModal(); showToast('请确认学生材料类型后生成；AI 回答尚未改写教案', 'success'); return }
  if (mode === 'draft') { state.ai.drafts.push({ content: message.content, createdAt: Date.now() }); persistWorkspace(); showToast('已保存到本地 AI 草稿箱，未修改教案', 'success'); return }
  if (mode === 'notes') { if (!state.ppt.resourceId) return showToast('请先绑定 PPT 课件', 'warning'); state.ppt.localNotes[state.ppt.slideIndex] = message.content; document.getElementById('ppt-note-draft').value = message.content; persistWorkspace(); showToast('已保存为当前页备注草稿，未直接修改原 PPT', 'success'); return }
  const fragment = proposalFragment(message.content)
  if (mode === 'replace' && state.savedRange && editor.contains(state.savedRange.commonAncestorContainer)) { state.savedRange.deleteContents(); state.savedRange.insertNode(fragment) }
  else if (mode === 'cursor' && state.savedRange && editor.contains(state.savedRange.commonAncestorContainer)) { state.savedRange.collapse(false); state.savedRange.insertNode(fragment) }
  else if (mode === 'cursor') editor.append(fragment)
  else if (mode === 'section') {
    const headings = [...editor.querySelectorAll('h1,h2,h3,h4')]; const current = headings.find(item => item.textContent.trim() === state.currentSection) || headings.at(-1)
    const next = current ? headings.find(item => (current.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) : null
    if (next) next.before(fragment); else editor.append(fragment)
  } else { const heading = document.createElement('h2'); heading.textContent = proposalSectionTitle(message); editor.append(heading, fragment) }
  message.applied = true; message.appliedMode = mode
  markDirty(mode === 'replace' ? 'ai_replace' : 'ai_insert', message.instruction); renderAiMessages(); renderOutline(); void flushSave(); showToast('AI 内容已应用到编辑器，正在自动保存修订', 'success')
}

function execEditorCommand(command, value) {
  const editor = document.getElementById('document-editor'); if (!editor) return
  editor.focus(); if (state.savedRange) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(state.savedRange) }
  document.execCommand(command, false, value || null); captureSelection(); markDirty()
}

function insertHtml(html, revisionType = 'teacher_manual') { const editor = document.getElementById('document-editor'); if (!editor) return; editor.focus(); document.execCommand('insertHTML', false, DOMPurify.sanitize(html, { ADD_ATTR: ['data-formula', 'data-page-break', 'class'] })); markDirty(revisionType); renderOutline() }

function replaceAllText(find, replacement) {
  const editor = document.getElementById('document-editor'); if (!editor || !find) return 0
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode)
  let count = 0; nodes.forEach(node => { const matches = node.nodeValue.split(find).length - 1; if (matches) { node.nodeValue = node.nodeValue.split(find).join(replacement); count += matches } }); if (count) markDirty(); return count
}

async function createCurrentVersion(publish = false) {
  if (!state.document) return showToast('请先打开教案', 'warning')
  try {
    if (!(await flushSave())) return showToast('教案尚未成功保存，不能创建正式版本', 'warning')
    const result = await createEditableTeachingDocumentVersion(state.document.id, { change_summary: `${publish ? '教师发布' : '教师保存'}版本 ${new Date().toLocaleString()}`, source_type: 'teacher_manual', publish }); await openEditableDocument(state.document.id, false); showToast(`${publish ? '已发布' : '已创建'} V${result.data.version_number}`, 'success')
  } catch (error) { showToast(error.message || '版本创建失败', 'error') }
}

async function syncCurrentStage() {
  if (!state.document || !state.currentSection) return showToast('请先将光标放在可识别的教案章节中', 'warning')
  const stageKey = SECTION_STAGE[state.currentSection]; if (!stageKey) return showToast('当前章节暂未映射到智慧备课阶段', 'warning')
  try {
    if (!(await flushSave())) return showToast('教案尚未成功保存，不能同步到智慧备课阶段', 'warning')
    const preview = await syncEditableTeachingDocumentStage(state.document.id, { stage_key: stageKey, preview_only: true })
    if (!confirm(`将“${preview.data.stage_title}”同步回智慧备课方案 V${preview.data.affected_version}，会创建方案新版本，但不会覆盖已锁定阶段。是否继续？`)) return
    const result = await syncEditableTeachingDocumentStage(state.document.id, { stage_key: stageKey, preview_only: false })
    showToast(`已同步并创建智慧备课 V${result.data.lesson_plan_version}`, 'success'); await openPlan(state.plan.lesson_plan_id)
  } catch (error) { showToast(error.message || '同步失败', 'error') }
}

function renderPptSelector() {
  const pptResources = state.selectable.filter(item => ['ppt', 'pptx'].includes(item.file_ext))
  const select = document.getElementById('ppt-resource'); if (!select) return
  select.innerHTML = '<option value="">选择平台课件</option>' + pptResources.map(item => `<option value="${escapeHtml(item.source_kind)}:${item.id}">${escapeHtml(item.title)}</option>`).join('')
  select.value = state.ppt.resourceId ? `${state.ppt.sourceKind || 'resource'}:${state.ppt.resourceId}` : ''
  renderPptPreview()
}

function currentPptResource() { return state.selectable.find(item => item.source_kind === (state.ppt.sourceKind || 'resource') && item.id === Number(state.ppt.resourceId)) }

async function openPptItem(source) {
  let item = source
  if (source.source_kind === 'artifact') {
    setPptFileState('uploading', '正在把平台产物加入课件资源…')
    const result = await importPreparationPlatformFile({ artifact_id: source.id, format: source.file_ext.toUpperCase(), ...(state.plan ? { lesson_plan_id: state.plan.lesson_plan_id, course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id } : {}) })
    item = result.data.resource
    await refreshSelectable(false)
    item = state.selectable.find(row => row.source_kind === 'resource' && Number(row.id) === Number(item.id)) || item
    if (result.data.message) showToast(result.data.message, item.preview_status === 'ready' ? 'success' : 'warning')
  }
  state.ppt.resourceId = item.id
  state.ppt.sourceKind = item.source_kind || 'resource'
  state.ppt.slideIndex = 0
  revokePptObjectUrl()
  renderPptSelector(); renderPptPreview(); persistWorkspace()
}

function renderPptPreview() {
  const resource = currentPptResource(); const stage = document.getElementById('ppt-stage'); if (!stage) return
  if (!resource) { void destroyPptViewer(); stage.innerHTML = pptEmptyHtml(); document.getElementById('ppt-page').textContent = '/ —'; document.getElementById('ppt-page-input').value = '1'; document.getElementById('ppt-page-input').disabled = true; document.getElementById('ppt-context-state').textContent = '未绑定课件'; document.getElementById('ppt-download').disabled = true; document.getElementById('ppt-download-pdf').disabled = true; document.getElementById('ppt-window').disabled = true; updateAiContextSummary(); return }
  const slides = resource.slides || []; const index = Math.max(0, Math.min(slides.length - 1, state.ppt.slideIndex)); state.ppt.slideIndex = index
  const slide = slides[index]
  const converted = resource.preview_status === 'ready' && Number(resource.conversion?.output_resource_id)
  const failed = resource.conversion?.status === 'failed'
  if (converted) { stage.innerHTML = '<div class="ppt-pdf-preview" id="ppt-pdf-viewer"><div class="lws-pdf-viewport" data-pdf-viewport><div class="lws-pdf-pages" data-pdf-pages></div><span class="lws-pdf-zoom-hint" data-pdf-zoom-hint></span></div></div>'; void mountPptPdfPreview(resource) }
  else if (!slide) stage.innerHTML = `<div class="prep-workspace-empty prep-ppt-waiting"><i>PPT</i><b>${escapeHtml(resource.title)}</b><p>${escapeHtml(failed ? (resource.conversion?.error_message || 'PPT 转换失败，原文件仍可下载。') : '课件已真实上传并创建转换任务，正在等待服务器生成 PDF 预览。')}</p><div><button data-ppt-download-inline>下载原文件</button>${failed ? '<button data-ppt-retry>重试转换</button>' : ''}<button data-ppt-replace>更换课件</button></div></div>`
  else stage.innerHTML = `<div class="ppt-slide" style="transform:scale(${state.ppt.zoom})">${slide.image ? `<img src="${slide.image}" alt="${escapeHtml(slide.title)}">` : `<div><small>文本页预览</small><h2>${escapeHtml(slide.title)}</h2><p>${escapeHtml(slide.text)}</p></div>`}</div>`
  const pageCount = converted ? state.ppt.pageCount : slides.length
  document.getElementById('ppt-context-state').textContent = `${resource.title} · ${converted ? 'PDF 连续预览' : slides.length ? '页级上下文可用' : failed ? '转换失败' : '正在转换'}`
  document.getElementById('ppt-page').textContent = pageCount ? `/ ${pageCount}` : '/ ?'
  document.getElementById('ppt-page-input').value = String(state.ppt.slideIndex + 1); document.getElementById('ppt-page-input').max = String(Math.max(1, pageCount)); document.getElementById('ppt-page-input').disabled = !pageCount && !converted
  document.getElementById('ppt-zoom').textContent = `${Math.round(state.ppt.zoom * 100)}%`
  document.getElementById('ppt-note-draft').value = state.ppt.localNotes[index] || slide?.notes || ''
  document.getElementById('ppt-prev').disabled = !pageCount || state.ppt.slideIndex <= 0; document.getElementById('ppt-next').disabled = !pageCount || state.ppt.slideIndex >= pageCount - 1
  document.getElementById('ppt-download').disabled = false; document.getElementById('ppt-window').disabled = false
  document.getElementById('ppt-download-pdf').disabled = !converted
  setPptFileState(converted || slides.length ? 'ready' : failed ? 'failed' : 'converting')
  if (!converted && !failed && !slides.length) pollPptConversion()
  updateAiContextSummary()
}

async function ensurePptObjectUrl() {
  const resource = currentPptResource()
  if (!resource) throw new Error('请先选择课件')
  if (state.ppt.objectUrl) return state.ppt.objectUrl
  const params = new URLSearchParams({ source_kind: resource.source_kind || 'resource', id: String(resource.id), ...(resource.format ? { format: resource.format } : {}) })
  const response = await fetch(`${BASE_URL}/teacher/preparation/files/content?${params}`, { headers: { Authorization: `Bearer ${getToken()}` }, credentials: 'include' })
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message || '课件文件读取失败') }
  const blob = await response.blob()
  if (!blob.size) throw new Error('课件文件为空')
  state.ppt.objectUrl = URL.createObjectURL(blob)
  return state.ppt.objectUrl
}

async function downloadPpt(openWindow = false) {
  try {
    const url = await ensurePptObjectUrl()
    if (openWindow) { window.open(url, '_blank', 'noopener,noreferrer'); return }
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = currentPptResource()?.file_name || `${currentPptResource()?.title || '课件'}.${currentPptResource()?.file_ext || 'pptx'}`; document.body.appendChild(anchor); anchor.click(); anchor.remove()
  } catch (error) { showToast(error.message || '课件下载失败', 'error') }
}

async function ensurePptPdfObjectUrl() {
  const resource = currentPptResource(); const outputId = Number(resource?.conversion?.output_resource_id)
  if (!outputId) throw new Error('转换后的 PDF 尚未生成')
  if (state.ppt.pdfObjectUrl) return state.ppt.pdfObjectUrl
  const response = await fetch(`${BASE_URL}/teacher/preparation/files/content?source_kind=resource&id=${outputId}`, { headers: { Authorization: `Bearer ${getToken()}` }, credentials: 'include' })
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message || '转换 PDF 读取失败') }
  const blob = await response.blob(); if (!blob.size) throw new Error('转换 PDF 为空')
  state.ppt.pdfObjectUrl = URL.createObjectURL(blob); return state.ppt.pdfObjectUrl
}

async function downloadPptPdf(openWindow = false) {
  try {
    const url = await ensurePptPdfObjectUrl()
    if (openWindow) return void window.open(url, '_blank', 'noopener,noreferrer')
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${currentPptResource()?.title || '课件'}-预览.pdf`; document.body.appendChild(anchor); anchor.click(); anchor.remove()
  } catch (error) { showToast(error.message || '转换 PDF 下载失败', 'error') }
}

async function previewStudentMaterial() {
  if (!state.document) return showToast('请先打开教案', 'warning')
  try {
    if (!(await flushSave())) return showToast('教案尚未成功保存，无法生成可靠预览', 'warning')
    const result = await generateEditableStudentMaterial(state.document.id, { preview_only: true, material_type: document.getElementById('student-material-type').value, include_answers: document.getElementById('student-include-answers').checked })
    document.getElementById('student-material-preview').innerHTML = `<p>${escapeHtml(result.data.notice)}</p><article>${DOMPurify.sanitize(result.data.sanitized_html)}</article>`
  } catch (error) { showToast(error.message || '学生材料预览失败', 'error') }
}

async function generateStudentMaterial() {
  if (!state.document) return
  try {
    if (!(await flushSave())) return showToast('教案尚未成功保存，不能生成学生材料', 'warning')
    const result = await generateEditableStudentMaterial(state.document.id, { preview_only: false, material_type: document.getElementById('student-material-type').value, include_answers: document.getElementById('student-include-answers').checked, publish: document.getElementById('student-publish').checked, format: document.getElementById('student-material-format').value })
    document.getElementById('doc-student-dialog').close(); showToast(`学生材料任务 ${result.data.task_id} 已进入任务中心`, 'success')
  } catch (error) { showToast(error.message || '学生材料生成失败', 'error') }
}

function switchMobileSurface(surface) {
  state.mobileSurface = surface
  state.layout.compactPane = surface === 'ppt' ? 'presentation' : surface === 'ai' ? 'assistant' : 'document'
  state.layout.panes[state.layout.compactPane].hidden = false
  document.querySelector('.preparation-immersive').dataset.mobileSurface = surface
  applyDockLayout({ save: true })
  document.querySelectorAll('.prep-mobile-surfaces [data-mobile-surface]').forEach(button => button.classList.toggle('active', button.dataset.mobileSurface === surface))
  if (surface === 'document' && state.document) renderEditorView()
  if (surface === 'reference' && state.pdfSource) renderPdfView()
  persistWorkspace()
}

async function switchDocumentMode(mode) {
  if (mode === 'edit') {
    if (!state.document) return renderEmptyWorkspace()
    const key = `editable:${state.document.id}`
    if (state.tabs.some(tab => tab.key === key) && state.activeTab !== key) await activateTab(key)
    else renderEditorView()
  } else if (mode === 'pdf') {
    if (!state.pdfSource) return showToast('请先打开 PDF 参考', 'warning')
    const key = `pdf:${state.pdfSource.source_kind}:${state.pdfSource.id}`
    if (state.tabs.some(tab => tab.key === key) && state.activeTab !== key) await activateTab(key)
    else renderPdfView()
  } else if (mode === 'compare') {
    if (state.document) {
      state.activeTab = `editable:${state.document.id}`
      renderTabs(); persistWorkspace()
    }
    renderCompareView()
  } else await renderVersionsView()
}

function bindEvents() {
  const immersiveRoot = document.querySelector('.preparation-immersive')
  const dockOverlay = document.getElementById('prep-dock-overlay')
  const dockTargets = [...dockOverlay.querySelectorAll('[data-dock-target]')]
  const clearDockingState = () => {
    state.draggedPane = null
    dockOverlay.hidden = true
    dockTargets.forEach(target => target.classList.remove('is-target'))
    immersiveRoot.classList.remove('is-docking')
  }
  const dockTargetAt = (clientX, clientY) => document.elementFromPoint(clientX, clientY)?.closest?.('[data-dock-target]') || null
  document.querySelector('.prep-layout-menu').addEventListener('click', event => {
    const button = event.target.closest('[data-layout-preset]')
    if (!button) return
    applyLayoutPreset(button.dataset.layoutPreset)
    event.currentTarget.removeAttribute('open')
  })
  immersiveRoot.addEventListener('click', event => {
    const action = event.target.closest('[data-pane-action]')
    if (action) { togglePaneAction(action.dataset.pane, action.dataset.paneAction); return }
    const restore = event.target.closest('[data-restore-pane]')
    if (restore) { restorePane(restore.dataset.restorePane); return }
  })
  immersiveRoot.querySelectorAll('[data-pane-drag]').forEach(handle => {
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return
      event.preventDefault()
      const pane = handle.dataset.paneDrag
      const startX = event.clientX
      const startY = event.clientY
      let active = false
      const activate = () => {
        if (active) return
        active = true
        state.draggedPane = pane
        dockOverlay.hidden = false
        immersiveRoot.classList.add('is-docking')
      }
      const move = moveEvent => {
        if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return
        activate()
        const target = dockTargetAt(moveEvent.clientX, moveEvent.clientY)
        dockTargets.forEach(item => item.classList.toggle('is-target', item === target))
        moveEvent.preventDefault()
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', cancel)
      }
      const end = endEvent => {
        if (active) {
          const target = dockTargetAt(endEvent.clientX, endEvent.clientY)
          if (target) dockPaneToSlot(pane, target.dataset.dockTarget)
        }
        cleanup()
        clearDockingState()
      }
      const cancel = () => {
        cleanup()
        clearDockingState()
      }
      window.addEventListener('pointermove', move, { passive: false })
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', cancel)
    })
    handle.addEventListener('keydown', event => {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const pane = handle.dataset.paneDrag
      const sourceSlot = slotForPane(pane)
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1
      const sourceIndex = SLOT_IDS.indexOf(sourceSlot)
      const targetSlot = SLOT_IDS[(sourceIndex + direction + SLOT_IDS.length) % SLOT_IDS.length]
      dockPaneToSlot(pane, targetSlot)
      paneElement(pane)?.querySelector('[data-pane-drag]')?.focus()
      showToast(`${paneLabel(pane)}已移动到${targetSlot === 'leftTop' ? '左上' : targetSlot === 'leftBottom' ? '左下' : '右侧'}`, 'success')
    })
  })
  dockOverlay.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' })
  dockOverlay.addEventListener('drop', event => {
    event.preventDefault()
    const target = event.target.closest('[data-dock-target]')
    const pane = state.draggedPane || event.dataTransfer.getData('text/plain')
    if (target) dockPaneToSlot(pane, target.dataset.dockTarget)
    clearDockingState()
  })
  document.getElementById('prep-back-workbench').onclick = () => { const query = state.plan ? `?planId=${state.plan.lesson_plan_id}` : ''; window.location.hash = `#/teacher/preparation${query}` }
  document.getElementById('prep-exit-immersive').onclick = () => { window.location.hash = '#/teacher/dashboard' }
  document.getElementById('prep-course').addEventListener('change', async event => { state.courseId = event.target.value; state.classId = ''; state.plan = null; await Promise.all([loadClasses(state.courseId), loadPlans(), loadResources()]); renderPlanControls() })
  document.getElementById('prep-class').addEventListener('change', async event => { state.classId = event.target.value; state.plan = null; await loadPlans() })
  document.getElementById('prep-plan').addEventListener('change', event => { if (event.target.value) void openPlan(Number(event.target.value)) })
  document.getElementById('prep-new-plan').onclick = () => document.getElementById('prep-create-dialog').showModal()
  document.getElementById('prep-stage-open').onclick = () => state.plan ? (renderStageDialog(), document.getElementById('prep-stage-dialog').showModal()) : showToast('请先选择备课方案', 'warning')
  document.querySelector('.prep-more-actions').addEventListener('click', event => { if (event.target.closest('button')) event.currentTarget.removeAttribute('open') })
  document.querySelectorAll('[data-create-close]').forEach(button => button.onclick = () => document.getElementById('prep-create-dialog').close())
  document.getElementById('prep-create-form').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.target); const payload = Object.fromEntries(form.entries()); ['use_case', 'project_based', 'discussion', 'in_class_practice', 'include_homework'].forEach(key => payload[key] = form.has(key)); const result = await createPreparationPlan(payload); document.getElementById('prep-create-dialog').close(); await openPlan(result.data.lesson_plan_id); showToast('备课方案已创建', 'success') })
  document.querySelector('#prep-create-form [name="course_id"]').addEventListener('change', async event => { const [classes, chapters] = await Promise.all([getTeachingClasses(event.target.value, { page_size: 100 }), getChapters(event.target.value)]); document.querySelector('#prep-create-form [name="teaching_class_id"]').innerHTML = '<option value="">请选择教学班</option>' + (classes.data?.list || []).map(item => `<option value="${item.teaching_class_id}">${escapeHtml(item.teaching_class_name)}</option>`).join(''); document.querySelector('#prep-create-form [name="chapter_id"]').innerHTML = '<option value="">不指定</option>' + (chapters.data?.list || []).map(item => `<option value="${item.chapter_id}">${escapeHtml(item.chapter_name)}</option>`).join('') })
  document.querySelector('[data-stage-close]').onclick = () => document.getElementById('prep-stage-dialog').close()
  document.getElementById('prep-stage-nav').onclick = event => { const button = event.target.closest('[data-dialog-step]'); if (button) { syncStageEditor(); state.stepIndex = Number(button.dataset.dialogStep); renderStageDialog() } }
  document.getElementById('prep-lock').onclick = async () => { const keys = activeLockKeys(); const unlock = keys.every(key => state.locked.includes(key)); state.locked = unlock ? state.locked.filter(item => !keys.includes(item)) : [...new Set([...state.locked, ...keys])]; await saveStageDraft(unlock ? '取消锁定阶段' : '锁定阶段') }
  document.getElementById('prep-save-stage').onclick = () => void saveStageDraft()
  document.getElementById('prep-generate-stage').onclick = () => void startGeneration(activeGenerationKeys())
  document.getElementById('prep-generate-all').onclick = () => void startGeneration(allGenerationKeys())
  document.getElementById('prep-refine-stage').onclick = () => void refineCurrentStage()
  document.getElementById('prep-plan-versions').onclick = () => void showPlanVersions()
  document.getElementById('prep-plan-publish').onclick = async () => { if (state.plan) { await publishPreparationPlan(state.plan.lesson_plan_id); showToast('备课方案已发布', 'success'); await openPlan(state.plan.lesson_plan_id) } }
  document.querySelector('[data-plan-version-close]').onclick = () => document.getElementById('prep-version-dialog').close()
  document.getElementById('prep-version-list').onclick = async event => { const button = event.target.closest('[data-restore-plan-version]'); if (button) { await restorePreparationVersion(state.plan.lesson_plan_id, Number(button.dataset.restorePlanVersion)); document.getElementById('prep-version-dialog').close(); await openPlan(state.plan.lesson_plan_id) } }
  document.querySelectorAll('[data-confirm-close]').forEach(button => button.onclick = () => document.getElementById('prep-confirm-dialog').close())
  document.getElementById('prep-confirm-generate').onclick = () => void confirmGeneration().catch(error => showToast(error.message, 'error'))
  document.querySelectorAll('[data-ai-apply-close]').forEach(button => button.onclick = () => { state.ai.pendingApply = null; document.getElementById('prep-ai-apply-dialog').close() })
  document.getElementById('prep-ai-apply-confirm').onclick = () => {
    const pending = state.ai.pendingApply
    state.ai.pendingApply = null
    document.getElementById('prep-ai-apply-dialog').close()
    if (pending) applyAiProposal(pending.index, pending.mode)
  }

  document.getElementById('doc-new').onclick = () => document.getElementById('doc-new-dialog').showModal()
  document.querySelector('[data-doc-new-close]').onclick = () => document.getElementById('doc-new-dialog').close()
  document.querySelectorAll('[data-create-document]').forEach(button => button.onclick = () => void createDocument(button.dataset.createDocument))
  document.getElementById('doc-import').onclick = () => document.getElementById('doc-file-input').click()
  document.getElementById('doc-file-input').onchange = event => { const [file] = event.target.files; event.target.value = ''; if (file) void handleLocalFile(file) }
  document.getElementById('doc-platform').onclick = async () => { await refreshSelectable(); document.getElementById('doc-resource-dialog').showModal(); clearInterval(state.resourcePoller); state.resourcePoller = setInterval(() => void refreshSelectable(), 3000) }
  document.querySelector('[data-resource-close]').onclick = () => { clearInterval(state.resourcePoller); document.getElementById('doc-resource-dialog').close() }
  document.getElementById('doc-resource-dialog').addEventListener('close', () => clearInterval(state.resourcePoller))
  document.getElementById('doc-resource-refresh').onclick = () => void refreshSelectable()
  ;['doc-resource-search', 'doc-resource-group', 'doc-resource-type'].forEach(id => document.getElementById(id).addEventListener(id === 'doc-resource-search' ? 'input' : 'change', renderResourceList))
  document.getElementById('doc-resource-list').onclick = event => { const button = event.target.closest('[data-resource-item]'); if (button) void openResourceItem(button.dataset.resourceItem).catch(error => showToast(error.message, 'error')) }
  document.querySelector('[data-pdf-choice-close]').onclick = () => { state.pendingFile = null; document.getElementById('doc-pdf-choice').close(); setDragState('default') }
  document.querySelectorAll('[data-pdf-action]').forEach(button => button.onclick = () => { const file = state.pendingFile; state.pendingFile = null; document.getElementById('doc-pdf-choice').close(); if (file) void handleLocalFile(file, button.dataset.pdfAction) })

  const workspace = document.getElementById('document-workspace')
  ;['dragenter', 'dragover'].forEach(type => workspace.addEventListener(type, event => { event.preventDefault(); setDragState('dragging-over') }))
  workspace.addEventListener('dragleave', event => { if (!workspace.contains(event.relatedTarget)) setDragState('default') })
  workspace.addEventListener('drop', event => { event.preventDefault(); const [file] = event.dataTransfer.files; if (file) void handleLocalFile(file) })
  workspace.addEventListener('paste', event => { const editor = event.target.closest('#document-editor'); if (!editor) return; event.preventDefault(); const html = event.clipboardData.getData('text/html'); const text = event.clipboardData.getData('text/plain'); document.execCommand('insertHTML', false, html ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) : escapeHtml(text).replace(/\n/g, '<br>')); markDirty() })
  workspace.addEventListener('input', event => { if (event.target.closest('#document-editor')) { markDirty(); renderOutline() } })
  workspace.addEventListener('wheel', handleDocumentWheel, { passive: false })
  workspace.addEventListener('mouseup', captureSelection); workspace.addEventListener('keyup', captureSelection)
  workspace.addEventListener('click', event => {
    const outline = event.target.closest('[data-outline-id]'); if (outline) document.getElementById(outline.dataset.outlineId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (event.target.closest('[data-outline-close]')) { state.outlineOpen = false; document.querySelector('.doc-editor-layout')?.classList.add('outline-closed') }
    if (event.target.closest('[data-recovery-restore]') && state.recovery) { document.getElementById('document-editor').innerHTML = state.recovery.html; renderFormulaElements(document.getElementById('document-editor')); state.recovery = null; markDirty(); renderOutline(); document.getElementById('doc-recovery').hidden = true }
    if (event.target.closest('[data-recovery-discard]')) { localStorage.removeItem(`${DRAFT_PREFIX}${state.document.id}`); state.recovery = null; renderRecovery() }
    if (event.target.closest('[data-conflict-keep]') && state.conflict?.server) {
      state.document = state.conflict.server; state.conflict = null; markDirty(state.pendingRevisionType, state.pendingInstruction); renderRecovery(); void flushSave()
    }
    if (event.target.closest('[data-conflict-server]') && state.conflict?.server) {
      state.document = state.conflict.server; state.conflict = null; setTabDirty(false); renderEditorView(); showToast('已打开服务器版本；你的内容仍在本地恢复草稿中，可随时恢复。', 'success')
    }
    const empty = event.target.closest('[data-empty-create]'); if (empty && !empty.disabled) { document.getElementById('doc-new-title').value = state.plan ? `${state.plan.topic}教学设计` : ''; void createDocument(empty.dataset.emptyCreate) }
    const emptyAction = event.target.closest('[data-empty-action]')
    if (emptyAction?.dataset.emptyAction === 'import') document.getElementById('doc-file-input').click()
    if (emptyAction?.dataset.emptyAction === 'platform') void document.getElementById('doc-platform').click()
  })

  document.getElementById('doc-tabs').addEventListener('click', event => { const close = event.target.closest('[data-tab-close]'); const pin = event.target.closest('[data-tab-pin]'); const tab = event.target.closest('[data-tab-key]'); if (close) void closeTab(close.dataset.tabClose); else if (pin) { const item = state.tabs.find(row => row.key === pin.dataset.tabPin); if (item) { item.pinned = !item.pinned; renderTabs(); persistWorkspace() } } else if (tab) void activateTab(tab.dataset.tabKey) })
  let draggedTab = null
  document.getElementById('doc-tabs').addEventListener('dragstart', event => { draggedTab = event.target.closest('[data-tab-key]')?.dataset.tabKey || null })
  document.getElementById('doc-tabs').addEventListener('dragover', event => event.preventDefault())
  document.getElementById('doc-tabs').addEventListener('drop', event => { event.preventDefault(); const target = event.target.closest('[data-tab-key]')?.dataset.tabKey; if (!draggedTab || !target || draggedTab === target) return; const from = state.tabs.findIndex(item => item.key === draggedTab); const to = state.tabs.findIndex(item => item.key === target); const [item] = state.tabs.splice(from, 1); state.tabs.splice(to, 0, item); draggedTab = null; renderTabs(); persistWorkspace() })

  document.querySelectorAll('[data-doc-mode]').forEach(button => button.onclick = () => void switchDocumentMode(button.dataset.docMode))
  document.getElementById('doc-outline-toggle').onclick = () => { state.outlineOpen = !state.outlineOpen; document.querySelector('.doc-editor-layout')?.classList.toggle('outline-closed', !state.outlineOpen) }
  document.getElementById('doc-sync-stage').onclick = () => void syncCurrentStage()
  document.getElementById('doc-fullscreen').onclick = event => { const active = workspace.classList.toggle('fullscreen'); document.body.classList.toggle('prep-document-fullscreen', active); event.currentTarget.textContent = active ? '退出全屏' : '全屏' }
  document.getElementById('doc-version-create').onclick = () => void createCurrentVersion()
  document.getElementById('doc-student-open').onclick = () => state.document ? document.getElementById('doc-student-dialog').showModal() : showToast('请先打开教案', 'warning')
  document.getElementById('doc-version-create-inline')?.addEventListener('click', () => void createCurrentVersion())
  document.getElementById('doc-export-main').onclick = () => state.document ? document.getElementById('doc-export-dialog').showModal() : showToast('请先打开教案', 'warning')
  document.querySelector('[data-export-close]').onclick = () => document.getElementById('doc-export-dialog').close()
  document.querySelectorAll('[data-document-export]').forEach(button => button.onclick = async () => {
    if (!state.document) return showToast('请先打开教案', 'warning')
    try {
      if (!(await flushSave())) return showToast('教案尚未成功保存，不能导出旧内容', 'warning')
      const result = await exportEditableTeachingDocument(state.document.id, { format: button.dataset.documentExport }); document.getElementById('doc-export-dialog').close(); showToast(`导出任务 ${result.data.task_id} 已进入任务中心`, 'success')
    } catch (error) { showToast(error.message || '教案导出失败', 'error') }
  })

  document.getElementById('doc-toolbar').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault() })
  document.getElementById('doc-toolbar').addEventListener('click', event => { const button = event.target.closest('[data-command]'); if (button) execEditorCommand(button.dataset.command, button.dataset.value) })
  document.getElementById('doc-toolbar').addEventListener('change', event => { const select = event.target.closest('[data-command]'); if (select) execEditorCommand(select.dataset.command, select.value) })
  document.getElementById('doc-insert-table').onclick = () => insertHtml('<table class="document-table"><tbody>' + Array.from({ length: 3 }, (_, row) => `<tr>${Array.from({ length: 3 }, (_, column) => `<${row ? 'td' : 'th'}>${row ? `单元格 ${row},${column + 1}` : `表头 ${column + 1}`}</${row ? 'td' : 'th'}>`).join('')}</tr>`).join('') + '</tbody></table><p><br></p>')
  document.getElementById('doc-insert-rule').onclick = () => insertHtml('<hr><p><br></p>')
  document.getElementById('doc-insert-image').onclick = () => document.getElementById('doc-image-input').click()
  document.getElementById('doc-image-input').onchange = event => { const [file] = event.target.files; event.target.value = ''; if (!file || file.size > 5 * 1024 * 1024) return showToast('图片需为 PNG/JPEG/WebP/GIF 且不超过 5MB', 'warning'); const reader = new FileReader(); reader.onload = () => insertHtml(`<img src="${reader.result}" alt="${escapeHtml(file.name)}"><p><br></p>`); reader.readAsDataURL(file) }
  document.getElementById('doc-insert-formula').onclick = () => document.getElementById('doc-formula-dialog').showModal()
  document.querySelectorAll('[data-formula-close]').forEach(button => button.onclick = () => document.getElementById('doc-formula-dialog').close())
  document.getElementById('doc-formula-input').oninput = event => { try { katex.render(event.target.value, document.getElementById('doc-formula-preview'), { displayMode: true, throwOnError: false }) } catch {} }
  document.getElementById('doc-formula-confirm').onclick = () => { const latex = document.getElementById('doc-formula-input').value.trim(); if (!latex) return; insertHtml(`<span class="formula" data-formula="${escapeHtml(latex)}"></span><p><br></p>`); document.getElementById('doc-formula-dialog').close(); renderFormulaElements(document.getElementById('document-editor')) }
  document.getElementById('doc-find').onclick = () => document.getElementById('doc-find-dialog').showModal()
  document.querySelector('[data-find-close]').onclick = () => document.getElementById('doc-find-dialog').close()
  document.getElementById('doc-find-next').onclick = event => { event.preventDefault(); window.find?.(document.getElementById('doc-find-value').value) }
  document.getElementById('doc-replace-all').onclick = event => { event.preventDefault(); const count = replaceAllText(document.getElementById('doc-find-value').value, document.getElementById('doc-replace-value').value); showToast(`已替换 ${count} 处`, count ? 'success' : 'warning') }

  document.getElementById('doc-work-area').addEventListener('click', event => {
    if (event.target.id === 'pdf-prev') void state.pdfViewer?.goTo(state.pdfState.pageNumber - 1)
    else if (event.target.id === 'pdf-next') void state.pdfViewer?.goTo(state.pdfState.pageNumber + 1)
    else if (event.target.id === 'pdf-zoom-out') void state.pdfViewer?.zoomBy(-0.1)
    else if (event.target.id === 'pdf-zoom-in') void state.pdfViewer?.zoomBy(0.1)
    else if (event.target.id === 'pdf-fit') void state.pdfViewer?.fit()
    else if (event.target.id === 'pdf-download') state.pdfViewer?.download()
    else if (event.target.id === 'pdf-window') state.pdfViewer?.openWindow()
    else if (event.target.id === 'pdf-search-button') void searchPdf(document.getElementById('pdf-search').value)
    else if (event.target.id === 'pdf-extract-copy') void extractCurrentPdf()
    else if (event.target.id === 'doc-version-create-inline') void createCurrentVersion()
    else if (event.target.id === 'doc-version-publish-inline') void createCurrentVersion(true)
    else if (event.target.id === 'doc-version-compare') void compareDocumentVersions()
    else if (event.target.closest('[data-version-preview]')) void getEditableTeachingDocumentVersion(state.document.id, event.target.closest('[data-version-preview]').dataset.versionPreview).then(result => { document.getElementById('doc-version-diff').innerHTML = `<article class="version-preview">${DOMPurify.sanitize(result.data.sanitized_html)}</article>` })
    else if (event.target.closest('[data-version-restore]')) void restoreEditableTeachingDocumentVersion(state.document.id, event.target.closest('[data-version-restore]').dataset.versionRestore).then(async () => { await openEditableDocument(state.document.id, false); showToast('已从旧版本创建新的当前版本', 'success') })
    else if (event.target.closest('[data-version-export]')) void exportEditableTeachingDocument(state.document.id, { version_id: Number(event.target.closest('[data-version-export]').dataset.versionExport), format: 'DOCX' }).then(result => showToast(`版本导出任务 ${result.data.task_id} 已创建`, 'success'))
  })
  document.getElementById('doc-work-area').addEventListener('change', event => { if (event.target.id === 'pdf-page-input') void state.pdfViewer?.goTo(Number(event.target.value)) })
  document.getElementById('doc-work-area').addEventListener('keydown', event => { if (event.target.id === 'pdf-page-input' && event.key === 'Enter') { event.preventDefault(); void state.pdfViewer?.goTo(Number(event.target.value)) } })

  const aiInput = document.getElementById('prep-ai-input')
  const updateAiCount = () => { const count = teacherInputLength(aiInput.value); document.getElementById('prep-ai-count').textContent = `${count} / 5000`; document.getElementById('prep-ai-count').classList.toggle('is-over', count > 5000) }
  document.getElementById('prep-ai-quick').onclick = event => { const button = event.target.closest('[data-ai-instruction]'); if (button) { aiInput.value = button.dataset.aiInstruction; updateAiCount(); aiInput.focus() } }
  document.getElementById('prep-ai-form').onsubmit = event => { event.preventDefault(); if (state.ai.busy) { state.ai.controller?.abort(); return } const value = aiInput.value; if (value.trim() || state.ai.attachments.length) { aiInput.value = ''; updateAiCount(); void askDocumentAi(value) } }
  aiInput.addEventListener('input', updateAiCount)
  aiInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.getElementById('prep-ai-form').requestSubmit() } })
  document.getElementById('prep-ai-collapse').onclick = () => togglePaneAction('assistant', 'collapse')
  document.getElementById('prep-ai-expand').onclick = () => { window.location.hash = `#/teacher/ai${state.ai.conversationId ? `?conversationId=${state.ai.conversationId}` : ''}` }
  document.getElementById('prep-ai-clear').onclick = async () => { if (!state.ai.messages.length || confirm('确认清空此沉浸式备课会话？教案内容不会受影响。')) { if (state.ai.conversationId) await clearTeacherAiConversation(state.ai.conversationId).catch(() => {}); state.ai.messages = []; renderAiMessages(); persistWorkspace() } }
  document.getElementById('prep-ai-file').onchange = async event => { try { const conversationId = await ensureImmersiveAiConversation(); for (const file of [...event.target.files].slice(0, 8 - state.ai.attachments.length)) { const result = await uploadTeacherAiAttachment(file, conversationId); state.ai.attachments.push(result.data) } renderAiAttachments() } catch (error) { showToast(error.message || '附件上传失败', 'error') } finally { event.target.value = '' } }
  document.getElementById('prep-ai-files').onclick = event => { const button = event.target.closest('[data-remove-ai-file]'); if (button) { state.ai.attachments = state.ai.attachments.filter(item => String(item.id) !== button.dataset.removeAiFile); renderAiAttachments() } }
  document.getElementById('prep-ai-voice').onclick = () => { const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!Recognition) return showToast('当前浏览器未提供语音识别能力，请使用文字或系统听写', 'warning'); const recognition = new Recognition(); recognition.lang = 'zh-CN'; recognition.interimResults = true; recognition.onresult = event => { aiInput.value = [...event.results].map(item => item[0].transcript).join(''); updateAiCount() }; recognition.onerror = () => showToast('语音识别未完成，请检查麦克风权限', 'warning'); recognition.start() }
  document.getElementById('prep-ai-messages').onclick = event => { const button = event.target.closest('[data-apply-ai]'); if (button) requestAiProposalApply(Number(button.dataset.messageIndex), button.dataset.applyAi) }
  document.getElementById('prep-ai-messages').addEventListener('scroll', event => {
    const host = event.currentTarget
    state.ai.autoFollow = host.scrollHeight - host.scrollTop - host.clientHeight < 36
    if (state.ai.autoFollow && state.ai.unread) { state.ai.unread = 0; const unread = document.getElementById('prep-ai-unread'); if (unread) unread.hidden = true }
  }, { passive: true })

  document.getElementById('ppt-resource').onchange = event => { const [kind, id] = event.target.value.split(':'); const item = state.selectable.find(row => row.source_kind === kind && row.id === Number(id)); if (item) void openPptItem(item); else { state.ppt.resourceId = null; revokePptObjectUrl(); renderPptPreview(); persistWorkspace() } }
  document.getElementById('ppt-platform-picker').onclick = async () => { await refreshSelectable(); document.getElementById('doc-resource-type').value = 'pptx'; renderResourceList(); document.getElementById('doc-resource-dialog').showModal() }
  document.getElementById('ppt-local-picker').onclick = () => document.getElementById('ppt-file-input').click()
  document.getElementById('ppt-file-input').onchange = event => { const [file] = event.target.files; event.target.value = ''; if (file) void handlePptFile(file) }
  document.getElementById('ppt-prev').onclick = () => state.ppt.viewer ? void state.ppt.viewer.goTo(state.ppt.slideIndex) : (state.ppt.slideIndex = Math.max(0, state.ppt.slideIndex - 1), renderPptPreview(), persistWorkspace())
  document.getElementById('ppt-next').onclick = () => { if (state.ppt.viewer) return void state.ppt.viewer.goTo(state.ppt.slideIndex + 2); const count = currentPptResource()?.slides?.length || 0; state.ppt.slideIndex = Math.min(Math.max(0, count - 1), state.ppt.slideIndex + 1); renderPptPreview(); persistWorkspace() }
  document.getElementById('ppt-page-input').onchange = event => { if (state.ppt.viewer) return void state.ppt.viewer.goTo(Number(event.target.value)); const count = currentPptResource()?.slides?.length || 0; state.ppt.slideIndex = Math.max(0, Math.min(count - 1, Number(event.target.value) - 1 || 0)); renderPptPreview(); persistWorkspace() }
  document.getElementById('ppt-zoom-out').onclick = () => state.ppt.viewer ? void state.ppt.viewer.zoomBy(-.1) : (state.ppt.zoom = Math.max(.6, Math.round((state.ppt.zoom - .1) * 10) / 10), renderPptPreview(), persistWorkspace())
  document.getElementById('ppt-zoom-in').onclick = () => state.ppt.viewer ? void state.ppt.viewer.zoomBy(.1) : (state.ppt.zoom = Math.min(2, Math.round((state.ppt.zoom + .1) * 10) / 10), renderPptPreview(), persistWorkspace())
  document.getElementById('ppt-fit').onclick = () => state.ppt.viewer ? void state.ppt.viewer.fit() : (state.ppt.zoom = 1, renderPptPreview(), persistWorkspace())
  document.getElementById('ppt-download').onclick = () => void downloadPpt(false)
  document.getElementById('ppt-download-pdf').onclick = () => void downloadPptPdf(false)
  document.getElementById('ppt-window').onclick = () => currentPptResource()?.conversion?.output_resource_id ? void downloadPptPdf(true) : void downloadPpt(true)
  document.getElementById('ppt-fullscreen').onclick = event => { const panel = document.querySelector('.prep-ppt-panel'); const active = panel.classList.toggle('fullscreen'); event.currentTarget.textContent = active ? '退出全屏' : '全屏' }
  document.getElementById('ppt-note-draft').oninput = event => { state.ppt.localNotes[state.ppt.slideIndex] = event.target.value; persistWorkspace() }
  document.getElementById('ppt-stage').onclick = event => {
    if (event.target.closest('[data-ppt-download-inline]')) { void downloadPpt(false); return }
    if (event.target.closest('[data-ppt-retry]')) { const resource = currentPptResource(); if (resource) void retryPreparationResourceConversion(resource.id).then(async result => { showToast(result.data?.error_message || 'PPT 转换任务已重新提交', result.data?.status === 'failed' ? 'warning' : 'success'); await refreshSelectable(false); renderPptSelector() }).catch(error => showToast(error.message || '重新转换失败', 'error')); return }
    if (event.target.closest('[data-ppt-replace]')) { document.getElementById('ppt-file-input').click(); return }
    const action = event.target.closest('[data-ppt-picker]')?.dataset.pptPicker
    if (action === 'local') document.getElementById('ppt-file-input').click()
    if (action === 'platform') document.getElementById('ppt-platform-picker').click()
  }
  const pptStage = document.getElementById('ppt-stage')
  ;['dragenter', 'dragover'].forEach(type => pptStage.addEventListener(type, event => { event.preventDefault(); setPptFileState('dragging-over', '释放 PPT/PPTX 以上传') }))
  pptStage.addEventListener('dragleave', event => { if (!pptStage.contains(event.relatedTarget)) setPptFileState(currentPptResource() ? (currentPptResource().slides?.length ? 'ready' : 'converting') : 'default') })
  pptStage.addEventListener('drop', event => { event.preventDefault(); const [file] = event.dataTransfer.files; if (file) void handlePptFile(file) })

  const bindSplitter = (element, orientation) => {
    let resizing = null
    let pendingRatio = null
    let frame = 0
    const update = ratio => {
      if (orientation === 'vertical') {
        state.layout.horizontalRatio = ratio
        state.split = ratio
        immersiveRoot.style.setProperty('--prep-left', `${ratio}%`)
      } else {
        state.layout.leftVerticalRatio = ratio
        immersiveRoot.style.setProperty('--prep-top', `${ratio}%`)
      }
    }
    const finish = event => {
      if (!resizing || (event?.pointerId != null && event.pointerId !== resizing.id)) return
      if (frame) cancelAnimationFrame(frame)
      if (pendingRatio != null) update(pendingRatio)
      try { element.releasePointerCapture(resizing.id) } catch {}
      resizing = null
      pendingRatio = null
      frame = 0
      document.body.classList.remove('prep-is-resizing', 'prep-is-resizing-row')
      state.layout.preset = 'custom'
      persistLayout()
      scheduleWorkspaceResize()
    }
    element.addEventListener('pointerdown', event => {
      if (window.matchMedia('(max-width:1024px)').matches) return
      const target = orientation === 'vertical' ? document.getElementById('prep-dock-workspace') : document.getElementById('prep-dock-left')
      const rect = target.getBoundingClientRect()
      resizing = { id: event.pointerId, rect }
      element.setPointerCapture(event.pointerId)
      document.body.classList.add(orientation === 'vertical' ? 'prep-is-resizing' : 'prep-is-resizing-row')
      event.preventDefault()
    })
    element.addEventListener('pointermove', event => {
      if (!resizing || event.pointerId !== resizing.id) return
      const { rect } = resizing
      const size = orientation === 'vertical' ? rect.width : rect.height
      const position = orientation === 'vertical' ? event.clientX - rect.left : event.clientY - rect.top
      const minimum = orientation === 'vertical' ? Math.min(44, Math.max(32, 340 / Math.max(size, 1) * 100)) : Math.min(46, Math.max(26, 150 / Math.max(size, 1) * 100))
      const maximum = orientation === 'vertical' ? Math.max(56, Math.min(76, (size - 320) / Math.max(size, 1) * 100)) : Math.max(54, Math.min(82, (size - 150) / Math.max(size, 1) * 100))
      pendingRatio = Math.min(maximum, Math.max(minimum, position / Math.max(size, 1) * 100))
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(pendingRatio) })
    })
    element.addEventListener('pointerup', finish)
    element.addEventListener('pointercancel', finish)
    element.addEventListener('dblclick', () => { update(orientation === 'vertical' ? 60 : 61); state.layout.preset = 'custom'; persistLayout(); scheduleWorkspaceResize() })
    element.addEventListener('keydown', event => {
      const direction = orientation === 'vertical' ? (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0) : (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
      if (!direction) return
      event.preventDefault()
      const current = orientation === 'vertical' ? state.layout.horizontalRatio : state.layout.leftVerticalRatio
      update(Math.min(orientation === 'vertical' ? 72 : 78, Math.max(orientation === 'vertical' ? 38 : 30, current + direction * (event.shiftKey ? 5 : 2))))
      persistLayout(); scheduleWorkspaceResize()
    })
  }
  bindSplitter(document.getElementById('prep-splitter'), 'vertical')
  bindSplitter(document.getElementById('prep-row-splitter'), 'horizontal')
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (state.layout.focus) { state.layout.focus = null; applyDockLayout({ save: true }) }
    if (workspace.classList.contains('fullscreen')) { workspace.classList.remove('fullscreen'); document.body.classList.remove('prep-document-fullscreen'); document.getElementById('doc-fullscreen').textContent = '全屏' }
    const pptPanel = document.querySelector('.prep-ppt-panel.fullscreen'); if (pptPanel) { pptPanel.classList.remove('fullscreen'); document.getElementById('ppt-fullscreen').textContent = '全屏' }
  }, { signal: state.lifecycleAbort.signal })
  document.querySelectorAll('.prep-mobile-surfaces [data-compact-pane]').forEach(button => button.onclick = () => setCompactPane(button.dataset.compactPane))
  document.querySelectorAll('.prep-mobile-surfaces [data-mobile-surface]').forEach(button => button.onclick = () => switchMobileSurface(button.dataset.mobileSurface))
  document.querySelector('[data-student-close]').onclick = () => document.getElementById('doc-student-dialog').close()
  document.getElementById('student-preview').onclick = () => void previewStudentMaterial()
  document.getElementById('student-generate').onclick = () => void generateStudentMaterial()

  window.addEventListener('online', () => { if (hasDirtyDocument()) void flushSave() }, { passive: true, signal: state.lifecycleAbort.signal })
  window.addEventListener('beforeunload', event => { if (hasDirtyDocument()) { event.preventDefault(); event.returnValue = '' } }, { signal: state.lifecycleAbort.signal })
}

export async function renderTeacherPreparationImmersive(app) {
  state.lifecycleAbort?.abort()
  state.lifecycleAbort = new AbortController()
  state.disposed = false
  let user = getUser()
  try { const result = await getMe(); user = result.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }
  document.body.classList.remove('prep-document-fullscreen')
  state.userId = String(user?.user_id || user?.id || 'teacher')
  readWorkspace()
  readLayout()
  renderDashboardLayout(app, { title: '沉浸式智慧备课', menuItems: TEACHER_MENU_ITEMS, contentHTML: shell(), user })
  document.getElementById('teacher-ai-float')?.remove()
  bindEvents(); applyDockLayout({ notify: false }); renderTabs(); renderAiAttachments(); renderAiMessages(); void loadImmersiveAiHistory()
  try {
    await loadCourses()
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const routeDate = params.get('date'); const lessonPlanId = Number(params.get('planId') || params.get('lesson_plan_id'))
    if (lessonPlanId) await openPlan(lessonPlanId)
    else if (/^\d{4}-\d{2}-\d{2}$/.test(routeDate || '')) { document.querySelector('#prep-create-form [name="teaching_date"]').value = routeDate; document.getElementById('prep-create-dialog').showModal() }
    else {
      await refreshSelectable(false); renderPptSelector()
      const persisted = state.tabs.find(tab => tab.key === state.activeTab)
      if (persisted?.kind === 'pdf') await openPdfSource({ id: persisted.id, source_kind: persisted.sourceKind, title: persisted.title, file_ext: 'pdf' }, false)
      else if (persisted?.kind === 'editable') await openEditableDocument(persisted.id, false)
    }
  } catch (error) { showToast(error.message || '沉浸式备课初始化失败', 'error') }
  return async () => {
    if (state.disposed) return
    if (hasDirtyDocument()) await flushSave()
    state.disposed = true
    state.eventAbort?.abort()
    state.ai.controller?.abort()
    state.lifecycleAbort?.abort()
    clearInterval(state.resourcePoller)
    clearInterval(state.pptPoller)
    clearTimeout(state.saveTimer)
    clearTimeout(state.docZoomHintTimer)
    if (state.docZoomFrame) cancelAnimationFrame(state.docZoomFrame)
    if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame)
    revokePptObjectUrl()
    await destroyPptViewer()
    await destroyPdf()
    document.body.classList.remove('prep-document-fullscreen', 'prep-is-resizing', 'prep-is-resizing-row')
    persistWorkspace()
    persistLayout()
  }
}
