import { learningWorkflowApi } from '../api/learning-workflows.js';
import { learningGoalApi } from '../api/learning-goals.js';
import { getStudentCourses, getStudentCourseChapters, getStudentCourseKnowledgePoints } from '../api/student.js';
import { navigateTo } from '../utils/router.js';
import { renderDashboardLayout } from '../utils/dashboard.js';
import { getUser, getToken } from '../utils/auth.js';
import { showToast } from '../utils/toast.js';
import {
  listAgents, listMyAgents, createAgentConversation, prefillFileRequirements,
  listLearningFlowResources, unlinkLearningFlowResource, downloadGeneratedArtifact,
} from '../api/marketplace.js';
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js';
import { studentLearningContextApi } from '../api/student-learning-context.js';
import {
  FLOW_DRAFT_STORAGE_KEY, LEARNING_FLOW_CATEGORIES, getNodeCategory, getNodeType, isSupportedGraph,
} from '../config/learning-flow.js';

const ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/><path d="m16.5 3.5 4 4L12 16l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M9 6V4h6v2m-9 0 1 15h10l1-15"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8Z"/></svg>',
};
const icon = (name, size = 16) => `<span class="lf-icon" style="width:${size}px;height:${size}px">${ICONS[name] || ''}</span>`;
const escapeHtml = (value) => { const node = document.createElement('div'); node.textContent = String(value ?? ''); return node.innerHTML; };
const responseData = (response) => response?.data ?? response;
const sourceLabel = (flow) => flow.source_type === 'SYSTEM' ? '系统内置' : flow.source_type === 'TEACHER' ? '教师推荐' : '我的学习流';
const sourceClass = (flow) => flow.source_type === 'SYSTEM' ? 'system' : flow.source_type === 'TEACHER' ? 'teacher' : 'mine';
const formatDate = (value) => value ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)) : '刚刚';
let state = {};

export function renderStudentLearningFlows(app) {
  const params = new URLSearchParams((window.location.hash.split('?')[1] || ''));
  state = {
    tab: ['all', 'system', 'mine', 'teacher'].includes(params.get('tab')) ? params.get('tab') : 'all',
    search: params.get('search') || '',
    courseId: params.get('courseId') || '',
    knowledgePointId: params.get('knowledgePointId') || '',
    knowledgePointName: params.get('knowledgePointName') || '',
    items: [], counts: { all: 0, system: 0, mine: 0, teacher: 0 }, loading: true, error: '', batchMode: false, selected: new Set(),
    resources: [], resourcesLoading: true, activeFlowId: Number(params.get('flowId')) || null, learningContext: null,
    contextLoading: true, contextError: '', planCourses: [],
  };
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, user: getUser(), contentHTML: pageHtml() });
  bindPage();
  bootstrapLearningContext(params);
}

async function bootstrapLearningContext(params) {
  try {
    const context = responseData(await studentLearningContextApi.get()); state.learningContext = context?.active ? context : null
    if (state.learningContext && (params.get('context') === 'active' || (!state.courseId && !state.knowledgePointId))) {
      state.courseId = String(context.courseId); state.knowledgePointId = String(context.knowledgePointId); state.knowledgePointName = context.knowledgePoint?.name || ''; state.activeFlowId ||= Number(context.workflowTemplateId)
    }
  } catch (error) { state.learningContext = null; state.contextError = error.message || '当前学习计划读取失败' }
  finally { state.contextLoading = false; renderLearningPlanSummary() }
  loadFlows(); loadResources(); loadLearningGoalAvailability(); if (state.courseId && state.knowledgePointId) loadRecommendation()
  const pendingFlowId = Number(params.get('flowId')); if (Number.isInteger(pendingFlowId) && pendingFlowId > 0 && !params.has('resources') && !params.has('preloadId') && !state.learningContext) setTimeout(() => openLearningPlanWizard({ preferredTemplateId: pendingFlowId }), 0)
  if (params.get('panel') === 'learning-plan') setTimeout(() => openLearningPlanWizard(), 0)
}

function pageHtml() {
  return `<main class="lf-page">
    <section class="lf-hero">
      <div><p class="lf-eyebrow">PERSONAL LEARNING PATH</p><h1>学习流中心</h1><p>通过系统推荐、教师推荐或自主编排，创建适合自己的学习路径。</p></div>
      <div class="lf-hero-right"><div class="lf-stat"><b id="lf-stat-total">—</b><span>学习流</span></div><div class="lf-stat"><b id="lf-stat-mine">—</b><span>我的学习流</span></div><button class="lf-button secondary lf-goal-create" id="lf-goal-create" hidden>${icon('target')}按学习目标生成</button><button class="lf-button primary lf-ai-create" id="lf-create">${icon('spark')}AI 生成学习流</button></div>
    </section>
    <section class="lf-plan-summary" id="lf-plan-summary" aria-live="polite"><div class="lf-loading"><i></i>正在读取学习目标与准备…</div></section>
    <section class="lf-recommendation" id="lf-recommendation"><div class="lf-recommendation-icon">${icon('spark', 24)}</div><div class="lf-recommendation-copy"><h2>智能学习推荐</h2><p>选择课程和知识点后，系统会结合你的掌握度为你推荐合适的学习流。</p></div><button class="lf-button secondary" id="lf-choose-context">选择课程与知识点</button></section>
    <section class="lf-resource-panel"><header><div><p class="lf-eyebrow">PRE-CLASS MATERIALS</p><h2>课前学习资料</h2><p>这里的资料独立于学习会话和 checkpoint，可随时预览、下载或解除关联。</p></div><button class="lf-button primary" id="lf-generate-handout">${icon('spark')}生成课前讲义</button></header><div id="lf-resource-list"><div class="lf-loading"><i></i>正在加载课前资料…</div></div></section>
    <section class="lf-toolbar"><div class="lf-tabs" id="lf-tabs"></div><div class="lf-toolbar-actions"><label class="lf-search">${icon('search')}<input id="lf-search" value="${escapeHtml(state.search)}" placeholder="搜索学习流名称"></label><button class="lf-button ghost" id="lf-batch">批量管理</button></div></section>
    <section class="lf-batch-bar" id="lf-batch-bar" hidden></section>
    <section class="lf-grid" id="lf-grid" aria-live="polite"><div class="lf-loading"><i></i>正在加载学习流…</div></section>
  </main>`;
}

function contextIsReady() {
  const context = state.learningContext
  return Boolean(context?.active && context?.valid && context.courseId && context.knowledgePointId && context.learningGoalId && context.workflowTemplateId)
}

function currentPreloadState() {
  const context = state.learningContext
  const flow = state.items.find(item => Number(item.template_id) === Number(context?.workflowTemplateId))
  return flow || { preloadStatus: 'NOT_STARTED', preloadProgress: 0 }
}

function renderLearningPlanSummary() {
  const root = document.getElementById('lf-plan-summary'); if (!root) return
  if (state.contextLoading) { root.innerHTML = '<div class="lf-loading"><i></i>正在读取学习目标与准备…</div>'; return }
  const context = state.learningContext
  const ready = contextIsReady()
  const preload = currentPreloadState()
  const preloadLabel = ({ NOT_STARTED: '未准备', QUEUED: '准备中', PRELOADING: '准备中', PARTIAL: '部分完成', READY: '准备完成', FAILED: '准备失败', EXPIRED: '已过期' }[preload.preloadStatus] || '未准备')
  const reason = state.contextError || (!context?.active ? '完成三个简单步骤后，学习准备、讲义生成与智能推荐都会自动复用。' : context.reason)
  root.innerHTML = `<header><div><p class="lf-eyebrow">LEARNING GOAL & READINESS</p><h2>学习目标与准备</h2><p>${escapeHtml(ready ? '当前学习计划已同步，后续操作无需重复选择。' : reason || '当前学习计划需要调整。')}</p></div><span class="lf-plan-valid ${ready ? 'is-ready' : ''}">${ready ? '计划有效' : '待完善'}</span></header>
    <div class="lf-plan-facts">
      <div><small>当前课程</small><b>${escapeHtml(context?.course?.name || '未选择')}</b></div>
      <div><small>当前知识点</small><b>${escapeHtml(context?.knowledgePoint?.name || '未选择')}</b></div>
      <div><small>当前学习目标</small><b>${escapeHtml(context?.learningGoal?.title || '未选择')}</b></div>
      <div><small>当前工作流</small><b>${escapeHtml(context?.workflowTemplate?.title || '未选择')}</b></div>
      <div><small>准备状态</small><b class="is-${String(preload.preloadStatus || 'NOT_STARTED').toLowerCase()}">${preloadLabel}${['QUEUED', 'PRELOADING'].includes(preload.preloadStatus) ? ` ${preload.preloadProgress || 0}%` : ''}</b></div>
    </div>
    <footer><button class="lf-button secondary" data-plan-action="adjust">调整目标</button><button class="lf-button secondary" data-plan-action="prepare">学习准备</button><button class="lf-button secondary" data-plan-action="handout">生成课前讲义</button><button class="lf-button compact primary" data-plan-action="start">${icon('play', 13)}开始学习</button></footer>`
  root.querySelector('[data-plan-action="adjust"]').onclick = () => openLearningPlanWizard()
  root.querySelector('[data-plan-action="prepare"]').onclick = () => prepareCurrentLearningPlan()
  root.querySelector('[data-plan-action="handout"]').onclick = () => generateHandoutFromContext()
  root.querySelector('[data-plan-action="start"]').onclick = () => startCurrentLearningPlan()
}

function requireLearningPlan(missingStep = 1) {
  if (contextIsReady()) return true
  showToast('请先完善学习范围、目标和工作流。', 'warning')
  openLearningPlanWizard({ missingStep })
  return false
}

async function prepareCurrentLearningPlan() {
  if (!requireLearningPlan(1)) return
  const context = state.learningContext
  const flow = currentPreloadState()
  if (['QUEUED', 'PRELOADING'].includes(flow.preloadStatus)) { showToast(`学习准备中（${flow.preloadProgress || 0}%）`, 'info'); return }
  try {
    const operationId = globalThis.crypto?.randomUUID?.() || `preload_${Date.now()}`
    const result = flow.preloadId && ['FAILED', 'EXPIRED', 'PARTIAL'].includes(flow.preloadStatus)
      ? responseData(await learningWorkflowApi.retryPreload(flow.preloadId, operationId))
      : responseData(await learningWorkflowApi.createPreload({ workflowTemplateId: context.workflowTemplateId, learningGoalId: context.learningGoalId, operationId }))
    showToast(result.status === 'READY' ? '学习准备已完成' : '学习准备任务已创建', 'success')
    await loadFlows()
  } catch (error) { showToast(error.message || '学习准备失败，仍可直接学习。', 'error') }
}

function startCurrentLearningPlan() {
  if (!requireLearningPlan(1)) return
  const context = state.learningContext
  startFlow(context.workflowTemplateId, context.courseId, context.knowledgePointId)
}

async function generateHandoutFromContext() {
  if (!requireLearningPlan(1)) return
  await generateHandout(state.learningContext.workflowTemplateId)
}

async function openLearningPlanWizard({ missingStep = 1, preferredTemplateId = null } = {}) {
  const current = state.learningContext || {}
  const wizard = {
    step: Math.max(1, Math.min(3, Number(missingStep) || 1)), busy: false,
    courses: [], points: [], goals: [], workflows: [],
    courseId: current.courseId || Number(state.courseId) || '',
    knowledgePointId: current.knowledgePointId || Number(state.knowledgePointId) || '',
    learningGoalId: current.learningGoalId || '',
    workflowTemplateId: preferredTemplateId || current.workflowTemplateId || '',
    targetMastery: current.targetMastery || 80,
    completionMode: current.completionMode || 'MASTERY_TARGET',
    learningPreference: { explanationStyle: 'DETAILED', practiceIntensity: 'STANDARD', includeExamples: true, ...(current.learningPreference || {}) },
    voiceConfig: { enabled: false, speechRate: 1, ...(current.voiceConfig || {}) },
    advancedOpen: false, goalText: '', error: '',
  }
  const overlay = modal('<div class="lf-wizard lf-plan-wizard" id="lf-plan-wizard"></div>')
  const host = overlay.querySelector('#lf-plan-wizard')
  const close = () => overlay.remove()

  const selectedCourse = () => wizard.courses.find(item => Number(item.course_id) === Number(wizard.courseId))
  const selectedPoint = () => wizard.points.find(item => Number(item.knowledge_point_id) === Number(wizard.knowledgePointId))

  async function loadCourses() {
    if (!state.planCourses.length) state.planCourses = responseData(await getStudentCourses())?.list || []
    wizard.courses = state.planCourses
  }
  async function loadPoints() {
    wizard.points = wizard.courseId ? (responseData(await getStudentCourseKnowledgePoints(wizard.courseId))?.list || []) : []
    if (!wizard.points.some(item => Number(item.knowledge_point_id) === Number(wizard.knowledgePointId))) wizard.knowledgePointId = ''
  }
  async function loadGoals() {
    if (!wizard.courseId || !wizard.knowledgePointId) { wizard.goals = []; return }
    wizard.goals = responseData(await learningGoalApi.list({ courseId: wizard.courseId, knowledgePointId: wizard.knowledgePointId, availableOnly: true, pageSize: 50 }))?.items || []
    if (current.learningGoalId && Number(current.courseId) === Number(wizard.courseId) && Number(current.knowledgePointId) === Number(wizard.knowledgePointId) && !wizard.goals.some(item => Number(item.goalId) === Number(current.learningGoalId))) {
      wizard.goals.unshift({ goalId: current.learningGoalId, normalizedTitle: current.learningGoal?.title || '当前学习目标', targetMastery: current.targetMastery })
    }
    if (!wizard.goals.some(item => Number(item.goalId) === Number(wizard.learningGoalId))) wizard.learningGoalId = ''
  }
  async function loadWorkflows() {
    if (!wizard.learningGoalId) { wizard.workflows = []; return }
    const result = responseData(await learningWorkflowApi.listTemplates({ source: 'ALL', courseId: wizard.courseId, knowledgePointId: wizard.knowledgePointId, learningGoalId: wizard.learningGoalId, pageSize: 48 }))
    wizard.workflows = result?.items || []
    if (!wizard.workflows.some(item => Number(item.template_id) === Number(wizard.workflowTemplateId))) wizard.workflowTemplateId = wizard.workflows[0]?.template_id || ''
  }

  function stepOneHtml() {
    return `<div class="lf-plan-step-copy"><b>第一步 · 学习范围</b><span>知识点只显示当前课程下的内容。</span></div><div class="lf-plan-scope-grid"><label class="lf-field">课程<select id="lf-plan-course"><option value="">请选择课程</option>${wizard.courses.map(item => `<option value="${item.course_id}" ${Number(item.course_id) === Number(wizard.courseId) ? 'selected' : ''}>${escapeHtml(item.course_name)}</option>`).join('')}</select></label><label class="lf-field">知识点<select id="lf-plan-point" ${wizard.courseId ? '' : 'disabled'}><option value="">请选择知识点</option>${wizard.points.map(item => `<option value="${item.knowledge_point_id}" ${Number(item.knowledge_point_id) === Number(wizard.knowledgePointId) ? 'selected' : ''}>${escapeHtml(item.knowledge_point_name)}</option>`).join('')}</select></label></div>${selectedPoint() ? `<div class="lf-plan-scope-note">${escapeHtml(selectedCourse()?.course_name)} · ${escapeHtml(selectedPoint()?.knowledge_point_name)} · 当前掌握度 ${Math.round(selectedPoint()?.mastery_score || 0)}%</div>` : ''}`
  }
  function stepTwoHtml() {
    const choices = wizard.goals.length ? `<div class="lf-plan-goal-list">${wizard.goals.map((item, index) => `<button class="lf-plan-option ${Number(item.goalId) === Number(wizard.learningGoalId) ? 'selected' : ''}" data-plan-goal="${item.goalId}"><span><b>${escapeHtml(item.normalizedTitle)}</b><small>${index === 0 ? '最近使用或最匹配' : '适用于当前范围'} · 目标 ${item.targetMastery || 80}%</small></span><em>${item.status === 'CONFIRMED' ? '已确认' : '可用'}</em></button>`).join('')}</div>` : '<div class="lf-plan-empty">还没有适用于当前范围的学习目标。</div>'
    return `<div class="lf-plan-step-copy"><b>第二步 · 学习目标</b><span>选择已有目标，或复用现有分析能力创建新目标。</span></div>${choices}<div class="lf-plan-create-goal"><label class="lf-field">创建学习目标<textarea id="lf-plan-goal-text" rows="3" maxlength="300" placeholder="例如：我想理解逻辑回归为什么适合分类，并完成基础练习。">${escapeHtml(wizard.goalText)}</textarea></label><button class="lf-button secondary" data-create-plan-goal>${icon('spark')}分析并创建</button></div>`
  }
  function stepThreeHtml() {
    const options = wizard.workflows.length ? wizard.workflows.map((item, index) => `<button class="lf-plan-option ${Number(item.template_id) === Number(wizard.workflowTemplateId) ? 'selected' : ''}" data-plan-workflow="${item.template_id}"><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.recommendationReason || (index === 0 ? '系统推荐' : '适用于当前目标'))}</small></span><em>${index === 0 ? '推荐' : sourceLabel(item)}</em></button>`).join('') : '<div class="lf-plan-empty">当前范围暂时没有可用工作流。</div>'
    const pref = wizard.learningPreference; const voice = wizard.voiceConfig
    return `<div class="lf-plan-step-copy"><b>第三步 · 学习工作流</b><span>已按范围、目标、掌握度和可见性排序，可随时更换。</span></div><div class="lf-plan-workflow-list">${options}</div><details class="lf-plan-advanced" ${wizard.advancedOpen ? 'open' : ''}><summary>高级配置</summary><div class="lf-plan-advanced-grid"><label>目标掌握度<input id="lf-plan-mastery" type="number" min="1" max="100" value="${wizard.targetMastery}"></label><label>完成方式<select id="lf-plan-completion"><option value="MASTERY_TARGET" ${wizard.completionMode === 'MASTERY_TARGET' ? 'selected' : ''}>达到目标掌握度</option><option value="WORKFLOW_COMPLETE" ${wizard.completionMode === 'WORKFLOW_COMPLETE' ? 'selected' : ''}>完成流程即可</option><option value="TIME_BOXED" ${wizard.completionMode === 'TIME_BOXED' ? 'selected' : ''}>按时长完成</option></select></label><label>回答风格<select id="lf-plan-style"><option value="DETAILED" ${pref.explanationStyle === 'DETAILED' ? 'selected' : ''}>详细讲解</option><option value="CONCISE" ${pref.explanationStyle === 'CONCISE' ? 'selected' : ''}>简洁直达</option><option value="SOCRATIC" ${pref.explanationStyle === 'SOCRATIC' ? 'selected' : ''}>启发提问</option></select></label><label>练习强度<select id="lf-plan-intensity"><option value="STANDARD" ${pref.practiceIntensity === 'STANDARD' ? 'selected' : ''}>标准</option><option value="LIGHT" ${pref.practiceIntensity === 'LIGHT' ? 'selected' : ''}>轻量</option><option value="INTENSIVE" ${pref.practiceIntensity === 'INTENSIVE' ? 'selected' : ''}>强化</option></select></label><label>语速<input id="lf-plan-rate" type="number" min="0.5" max="2" step="0.1" value="${voice.speechRate || 1}"></label><label class="lf-plan-check"><input id="lf-plan-examples" type="checkbox" ${pref.includeExamples !== false ? 'checked' : ''}>讲解包含示例</label><label class="lf-plan-check"><input id="lf-plan-voice" type="checkbox" ${voice.enabled ? 'checked' : ''}>启用语音</label></div></details>`
  }

  function rememberAdvanced() {
    wizard.targetMastery = Number(host.querySelector('#lf-plan-mastery')?.value) || wizard.targetMastery
    wizard.completionMode = host.querySelector('#lf-plan-completion')?.value || wizard.completionMode
    wizard.learningPreference = { explanationStyle: host.querySelector('#lf-plan-style')?.value || wizard.learningPreference.explanationStyle, practiceIntensity: host.querySelector('#lf-plan-intensity')?.value || wizard.learningPreference.practiceIntensity, includeExamples: host.querySelector('#lf-plan-examples')?.checked ?? wizard.learningPreference.includeExamples }
    wizard.voiceConfig = { ...wizard.voiceConfig, enabled: host.querySelector('#lf-plan-voice')?.checked ?? wizard.voiceConfig.enabled, speechRate: Number(host.querySelector('#lf-plan-rate')?.value) || wizard.voiceConfig.speechRate }
    wizard.advancedOpen = Boolean(host.querySelector('.lf-plan-advanced')?.open)
  }

  function render() {
    const titles = ['学习范围', '学习目标', '学习工作流']
    const body = wizard.busy ? '<div class="lf-wizard-state"><i></i>正在加载适用选项…</div>' : wizard.step === 1 ? stepOneHtml() : wizard.step === 2 ? stepTwoHtml() : stepThreeHtml()
    host.innerHTML = `<header class="lf-modal-head"><div><span class="lf-wizard-step">步骤 ${wizard.step}/3</span><h2>${titles[wizard.step - 1]}</h2><p>课程与知识点 → 学习目标 → 学习工作流</p></div><button class="lf-icon-button" data-close>${icon('close')}</button></header><div class="lf-plan-progress"><i class="${wizard.step >= 1 ? 'active' : ''}">1</i><span></span><i class="${wizard.step >= 2 ? 'active' : ''}">2</i><span></span><i class="${wizard.step >= 3 ? 'active' : ''}">3</i></div><div class="lf-modal-body">${wizard.error ? `<p class="lf-plan-error">${escapeHtml(wizard.error)}</p>` : ''}${body}</div><footer class="lf-modal-foot"><button class="lf-button secondary" data-close>取消</button>${wizard.step > 1 ? '<button class="lf-button ghost" data-plan-back>上一步</button>' : ''}<button class="lf-button primary" data-plan-next>${wizard.step === 3 ? '保存学习计划' : '下一步'}</button></footer>`
    host.querySelectorAll('[data-close]').forEach(button => { button.onclick = close })
    host.querySelector('[data-plan-back]')?.addEventListener('click', () => { rememberAdvanced(); wizard.error = ''; wizard.step -= 1; render() })
    host.querySelector('#lf-plan-course')?.addEventListener('change', async event => { wizard.courseId = Number(event.target.value) || ''; wizard.knowledgePointId = ''; wizard.learningGoalId = ''; wizard.workflowTemplateId = ''; wizard.error = ''; wizard.busy = true; render(); try { await loadPoints() } catch (error) { wizard.error = error.message } finally { wizard.busy = false; render() } })
    host.querySelector('#lf-plan-point')?.addEventListener('change', event => { wizard.knowledgePointId = Number(event.target.value) || ''; wizard.learningGoalId = ''; wizard.workflowTemplateId = ''; wizard.error = ''; render() })
    host.querySelectorAll('[data-plan-goal]').forEach(button => button.onclick = () => { wizard.learningGoalId = Number(button.dataset.planGoal); wizard.workflowTemplateId = ''; render() })
    host.querySelectorAll('[data-plan-workflow]').forEach(button => button.onclick = () => { rememberAdvanced(); wizard.workflowTemplateId = Number(button.dataset.planWorkflow); render() })
    host.querySelector('[data-create-plan-goal]')?.addEventListener('click', async () => {
      wizard.goalText = host.querySelector('#lf-plan-goal-text')?.value.trim() || ''
      if (wizard.goalText.length < 2) { wizard.error = '请用一句话描述学习目标。'; render(); return }
      wizard.busy = true; wizard.error = ''; render()
      try {
        let goal = responseData(await learningGoalApi.resolve({ courseId: wizard.courseId, goalText: wizard.goalText, preferences: { targetMastery: wizard.targetMastery, targetDepth: 'basic', availableMinutes: 30 } }))
        if (Number(goal.primaryKnowledgePoint?.knowledgePointId) !== Number(wizard.knowledgePointId)) throw new Error('分析结果与当前知识点不一致，请调整目标描述或学习范围。')
        if (goal.status === 'RESOLVED') goal = responseData(await learningGoalApi.confirm(goal.goalId))
        if (!['CONFIRMED', 'WORKFLOW_READY', 'RESOLVED'].includes(goal.status)) throw new Error(goal.message || '该目标还需要进一步澄清，暂不能用于当前学习计划。')
        await loadGoals(); wizard.learningGoalId = goal.goalId; wizard.targetMastery = goal.targetMastery || wizard.targetMastery
      } catch (error) { wizard.error = error.message || '学习目标创建失败' }
      finally { wizard.busy = false; render() }
    })
    host.querySelector('[data-plan-next]').onclick = async () => {
      rememberAdvanced(); wizard.error = ''
      if (wizard.step === 1 && (!wizard.courseId || !wizard.knowledgePointId)) { wizard.error = '请先选择课程和知识点。'; render(); return }
      if (wizard.step === 2 && !wizard.learningGoalId) { wizard.error = '请选择或创建一个学习目标。'; render(); return }
      if (wizard.step === 3 && !wizard.workflowTemplateId) { wizard.error = '当前没有已选择的适用工作流。'; render(); return }
      wizard.busy = true; render()
      try {
        if (wizard.step === 1) { await loadGoals(); wizard.step = 2 }
        else if (wizard.step === 2) { await loadWorkflows(); wizard.step = 3 }
        else {
          state.learningContext = responseData(await studentLearningContextApi.update({ courseId: wizard.courseId, knowledgePointId: wizard.knowledgePointId, learningGoalId: wizard.learningGoalId, workflowTemplateId: wizard.workflowTemplateId, targetMastery: wizard.targetMastery, completionMode: wizard.completionMode, learningPreference: wizard.learningPreference, voiceConfig: wizard.voiceConfig }))
          state.courseId = String(wizard.courseId); state.knowledgePointId = String(wizard.knowledgePointId); state.knowledgePointName = selectedPoint()?.knowledge_point_name || ''; state.activeFlowId = Number(wizard.workflowTemplateId)
          close(); persistListRoute(); renderLearningPlanSummary(); await Promise.all([loadFlows(), loadResources(), loadRecommendation()]); showToast('学习计划已保存，后续操作会自动复用。', 'success'); return
        }
      } catch (error) { wizard.error = error.message || '加载失败' }
      finally { wizard.busy = false; render() }
    }
  }

  wizard.busy = true; render()
  try { await loadCourses(); await loadPoints(); if (wizard.step >= 2) await loadGoals(); if (wizard.step >= 3 && wizard.learningGoalId) await loadWorkflows() } catch (error) { wizard.error = error.message || '学习计划加载失败' }
  finally { wizard.busy = false; render() }
}

const resourceRoleLabel = value => ({ PRE_CLASS_HANDOUT: '课前讲义', REFERENCE_MATERIAL: '参考资料', PRACTICE_PAPER: '练习试卷', REVIEW_MATERIAL: '复习资料' }[value] || value)
async function loadResources() {
  state.resourcesLoading = true; renderResources()
  try {
    const params = { pageSize: 100 }
    if (state.courseId) params.courseId = Number(state.courseId)
    if (state.knowledgePointId) params.knowledgePointId = Number(state.knowledgePointId)
    if (state.activeFlowId) params.workflowTemplateId = state.activeFlowId
    state.resources = responseData(await listLearningFlowResources(params))?.list || []
  } catch (error) { state.resourceError = error.message || '课前资料加载失败'; state.resources = [] }
  finally { state.resourcesLoading = false; renderResources() }
}
function renderResources() {
  const target = document.getElementById('lf-resource-list'); if (!target) return
  if (state.resourcesLoading) { target.innerHTML = '<div class="lf-loading"><i></i>正在加载课前资料…</div>'; return }
  if (state.resourceError) { target.innerHTML = `<div class="lf-empty"><p>${escapeHtml(state.resourceError)}</p><button class="lf-button compact secondary" data-resource-retry>重试</button></div>`; target.querySelector('[data-resource-retry]').onclick = loadResources; return }
  if (!state.resources.length) { target.innerHTML = '<div class="lf-empty"><p>当前学习流还没有课前资料。</p></div>'; return }
  target.innerHTML = `<div class="lf-resource-grid">${state.resources.map(item => `<article class="lf-resource-card"><div><span class="lf-source system">${resourceRoleLabel(item.resourceRole)}</span><small>${formatDate(item.artifact?.createdAt)}</small></div><h3>${escapeHtml(item.artifact?.title || '学习资料')}</h3><p>${escapeHtml(item.course?.name || '未限定课程')} · ${escapeHtml(item.knowledgePoint?.name || '全部知识点')}</p><p>${item.artifact?.artifactType === 'STUDY_HANDOUT' ? '学习讲义' : '练习试卷'} · ${escapeHtml(item.artifact?.status || '')}</p><footer><a class="lf-button compact secondary" href="#/student/artifacts/${item.artifactId}">预览</a><button class="lf-button compact primary" data-resource-download="${item.artifactId}" data-title="${escapeHtml(item.artifact?.title || '学习资料')}">下载</button><button class="lf-button compact ghost" data-resource-unlink="${item.id}">解除关联</button></footer></article>`).join('')}</div>`
  target.querySelectorAll('[data-resource-download]').forEach(button => button.onclick = async () => { try { await downloadGeneratedArtifact(button.dataset.resourceDownload, `${button.dataset.title}.docx`) } catch (error) { showToast(error.message, 'error') } })
  target.querySelectorAll('[data-resource-unlink]').forEach(button => button.onclick = async () => { if (!confirm('只解除学习流关联，原文件仍会保留。确定继续吗？')) return; button.disabled = true; try { await unlinkLearningFlowResource(button.dataset.resourceUnlink); showToast('已解除资料关联', 'success'); await loadResources() } catch (error) { button.disabled = false; showToast(error.message, 'error') } })
}

async function loadFlows() {
  state.loading = true; state.error = ''; renderGrid();
  try {
    // Map frontend tab names to backend source_type values
    const sourceMap = { all: 'ALL', system: 'SYSTEM', mine: 'STUDENT', teacher: 'TEACHER' };
    const data = responseData(await learningWorkflowApi.listTemplates({
      source: sourceMap[state.tab] || 'ALL',
      search: state.search,
      pageSize: 48,
    }));
    state.items = data.items || [];
    state.counts = data.counts || state.counts;
  } catch (error) {
    state.error = error.message || '学习流加载失败'; state.items = [];
  } finally {
    state.loading = false; renderCounts(); renderTabs(); renderGrid(); renderLearningPlanSummary();
  }
}

async function loadRecommendation() {
  const container = document.getElementById('lf-recommendation');
  if (!container) return;
  container.classList.add('loading');
  try {
    const result = responseData(await learningWorkflowApi.recommendTemplate({ courseId: state.courseId, knowledgePointId: state.knowledgePointId }));
    const mastery = result.masteryScore == null ? '暂无记录' : `${Math.round(result.masteryScore)}%`;
    container.innerHTML = `<div class="lf-recommendation-icon">${icon('spark', 24)}</div><div class="lf-recommendation-copy"><h2>智能学习推荐</h2><p><b>${escapeHtml(state.knowledgePointName || '已选知识点')}</b> · 当前掌握度 ${mastery} · ${escapeHtml(result.reason || '为你匹配了推荐学习流')}</p><div class="lf-recommendation-meta">推荐：${escapeHtml(result.template?.title || '标准学习流')} · 近期错题 ${result.wrongCount || 0} 道</div></div><button class="lf-button primary" id="lf-recommend-start" data-id="${result.template?.id || ''}">${icon('play')}进入学习</button><button class="lf-button secondary" id="lf-choose-context">重新选择</button>`;
    container.querySelector('#lf-recommend-start')?.addEventListener('click', async () => { if (await syncRecommendedContext(result.template?.id)) startFlow(result.template?.id, Number(state.courseId), Number(state.knowledgePointId)); });
    container.querySelector('#lf-choose-context')?.addEventListener('click', () => openLearningPlanWizard());
  } catch (error) {
    container.innerHTML = `<div class="lf-recommendation-icon">${icon('spark', 24)}</div><div class="lf-recommendation-copy"><h2>智能学习推荐</h2><p>暂时无法加载推荐，可先选择课程和知识点后使用任意学习流。</p></div><button class="lf-button secondary" id="lf-choose-context">重新选择</button>`;
    container.querySelector('#lf-choose-context')?.addEventListener('click', () => openLearningPlanWizard());
  }
}

async function syncRecommendedContext(templateId) {
  if (state.learningContext && Number(state.learningContext.workflowTemplateId) === Number(templateId) && Number(state.learningContext.knowledgePointId) === Number(state.knowledgePointId)) return true
  try {
    const goals = responseData(await learningGoalApi.list({ courseId: Number(state.courseId), knowledgePointId: Number(state.knowledgePointId), availableOnly: true, pageSize: 50 }))?.items || []
    const goal = goals.find(item => Number(item.primaryKnowledgePoint?.knowledgePointId || item.primaryKnowledgePointId) === Number(state.knowledgePointId))
    if (!goal) { showToast('当前范围还没有可用学习目标，请先完善学习计划。', 'warning'); openLearningPlanWizard({ missingStep: 2, preferredTemplateId: templateId }); return false }
    state.learningContext = responseData(await studentLearningContextApi.update({ courseId: Number(state.courseId), knowledgePointId: Number(state.knowledgePointId), learningGoalId: goal.goalId, workflowTemplateId: Number(templateId), targetMastery: state.learningContext?.targetMastery || goal.targetMastery || 80, completionMode: state.learningContext?.completionMode || 'MASTERY_TARGET', learningPreference: state.learningContext?.learningPreference || { explanationStyle: 'DETAILED', practiceIntensity: 'STANDARD', includeExamples: true }, voiceConfig: state.learningContext?.voiceConfig || { enabled: false } }))
    state.activeFlowId = Number(templateId); renderLearningPlanSummary(); showToast('智能推荐已同步到当前学习计划', 'success'); return true
  } catch (error) { showToast(error.message || '无法同步当前学习上下文', 'error'); return false }
}

function renderCounts() {
  document.getElementById('lf-stat-total').textContent = state.counts.all ?? 0;
  document.getElementById('lf-stat-mine').textContent = state.counts.mine ?? 0;
}
function renderTabs() {
  const target = document.getElementById('lf-tabs'); if (!target) return;
  const tabs = [['all', '全部'], ['system', '系统内置'], ['mine', '我的'], ['teacher', '教师推荐']];
  target.innerHTML = tabs.map(([key, label]) => `<button class="lf-tab ${state.tab === key ? 'active' : ''}" data-tab="${key}">${label}<span>${state.counts[key] ?? 0}</span></button>`).join('');
  target.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    persistListRoute();
    renderTabs();
    loadFlows();
  }));
}
function renderGrid() {
  const target = document.getElementById('lf-grid'); if (!target) return;
  if (state.loading) { target.innerHTML = '<div class="lf-loading"><i></i>正在加载学习流…</div>'; return; }
  if (state.error) { target.innerHTML = `<div class="lf-empty"><h3>加载失败</h3><p>${escapeHtml(state.error)}</p><button class="lf-button primary" id="lf-retry">重新加载</button></div>`; target.querySelector('#lf-retry').onclick = loadFlows; return; }
  if (!state.items.length) {
    const message = state.tab === 'teacher' ? '当前课程暂无教师推荐学习流' : state.tab === 'mine' ? '还没有自己的学习流' : '暂无可用学习流';
    target.innerHTML = `<div class="lf-empty"><h3>${message}</h3><p>你可以从系统模板复制，或让 AI 按自然语言目标生成一条学习路径。</p>${state.tab === 'mine' ? '<button class="lf-button primary" id="lf-empty-create">AI 生成学习流</button>' : ''}</div>`;
    target.querySelector('#lf-empty-create')?.addEventListener('click', () => openScopeWizard(null, 'ai')); return;
  }
  target.innerHTML = state.items.map(flowCard).join('');
  target.querySelectorAll('[data-flow-action]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation(); const { flowAction: action, flowId: id } = button.dataset;
    if (action === 'start') openScopeWizard(Number(id));
    if (action === 'preview') openPreview(Number(id));
    if (action === 'copy') copyFlow(Number(id));
    if (action === 'edit') navigateTo(`#/student/learning-flow/editor/${id}`);
    if (action === 'delete') confirmDelete([Number(id)]);
    if (action === 'preload') prepareFlow(Number(id), false);
    if (action === 'retry-preload') prepareFlow(Number(id), true);
    if (action === 'handout') generateHandout(Number(id));
  }));
  target.querySelectorAll('[data-flow-check]').forEach((check) => check.addEventListener('change', () => {
    const id = Number(check.dataset.flowCheck); check.checked ? state.selected.add(id) : state.selected.delete(id); renderBatchBar();
  }));
  target.querySelectorAll('.lf-flow-card').forEach((card) => card.addEventListener('click', () => openPreview(Number(card.dataset.flowId))));
}
function flowCard(flow) {
  const nodes = flow.latestVersion?.graph_json?.nodes || [];
  const tags = nodes.slice(0, 4).map((node) => { const c = LEARNING_FLOW_CATEGORIES[getNodeCategory(node.type)]; return `<span style="color:${c.color};background:${c.background}">${escapeHtml(getNodeType(node.type)?.short || node.type)}</span>`; }).join('');
  const settings = flow.latestVersion?.settings_json || {};
  const owned = Boolean(flow.can_edit);
  const preloadLabel = ({ NOT_STARTED: '未准备', QUEUED: '准备中', PRELOADING: '准备中', PARTIAL: '部分完成', READY: '准备完成', FAILED: '准备失败', EXPIRED: '已过期' }[flow.preloadStatus] || '未准备');
  const preloadAction = ['QUEUED', 'PRELOADING'].includes(flow.preloadStatus)
    ? `<button class="lf-button compact secondary" data-flow-action="preload" data-flow-id="${flow.template_id}">查看准备进度 ${flow.preloadProgress || 0}%</button>`
    : ['FAILED', 'EXPIRED', 'PARTIAL'].includes(flow.preloadStatus)
      ? `<button class="lf-button compact secondary" data-flow-action="retry-preload" data-flow-id="${flow.template_id}">重新准备</button>`
      : flow.preloadStatus === 'READY'
        ? '' : `<button class="lf-button compact secondary" data-flow-action="preload" data-flow-id="${flow.template_id}">学习准备</button>`;
  return `<article class="lf-flow-card" data-flow-id="${flow.template_id}">
    ${state.batchMode && owned ? `<label class="lf-check" title="选择学习流"><input type="checkbox" data-flow-check="${flow.template_id}" ${state.selected.has(flow.template_id) ? 'checked' : ''}><span></span></label>` : ''}
    <header><span class="lf-source ${sourceClass(flow)}">${sourceLabel(flow)}</span><time>${formatDate(flow.updated_at)} 更新</time></header>
    <h3>${escapeHtml(flow.title)}</h3><p class="lf-description">${escapeHtml(flow.description || '尚未填写学习流简介')}</p>
    <div class="lf-node-tags">${tags}${nodes.length > 4 ? `<span class="more">+${nodes.length - 4}</span>` : ''}</div>
    <div class="lf-card-meta"><span>${icon('clock', 14)} ${settings.estimated_minutes || 25} 分钟</span><span>${icon('target', 14)} ${settings.completion_mode === 'flow_complete' ? '按流程完成' : `目标 ${settings.target_mastery || 80}%`}</span></div>
    <div class="lf-preload-state is-${String(flow.preloadStatus || 'NOT_STARTED').toLowerCase()}"><b>${preloadLabel}</b><span>${escapeHtml(flow.preloadStage || (flow.preloadStatus === 'FAILED' ? '学习准备未完成，仍可直接开始学习。' : '可提前准备首节点内容和语音'))}</span>${preloadAction}</div>
    <div class="lf-card-foot"><small>${nodes.length} 个节点 · 已使用 ${flow.usage_count || 0} 次</small><div class="lf-card-actions"><button class="lf-button compact secondary" data-flow-action="handout" data-flow-id="${flow.template_id}">生成课前讲义</button><button class="lf-button compact secondary" data-flow-action="preview" data-flow-id="${flow.template_id}">预览</button><button class="lf-button compact primary" data-flow-action="start" data-flow-id="${flow.template_id}">${icon('play', 13)}${['PARTIAL','READY'].includes(flow.preloadStatus) ? '前往学习' : '直接学习'}</button>${owned ? `<button class="lf-icon-button" title="编辑" data-flow-action="edit" data-flow-id="${flow.template_id}">${icon('edit')}</button><button class="lf-icon-button danger" title="删除" data-flow-action="delete" data-flow-id="${flow.template_id}">${icon('trash')}</button>` : `<button class="lf-icon-button" title="复制为我的学习流" data-flow-action="copy" data-flow-id="${flow.template_id}">${icon('copy')}</button>`}</div></div>
  </article>`;
}

function renderBatchBar() {
  const bar = document.getElementById('lf-batch-bar'); if (!bar) return;
  bar.hidden = !state.batchMode;
  if (!state.batchMode) return;
  const ownIds = state.items.filter((flow) => flow.can_delete).map((flow) => flow.template_id);
  bar.innerHTML = `<span>已选择 <b>${state.selected.size}</b> 个学习流</span><div><button class="lf-button compact secondary" id="lf-select-page">全选当前页</button><button class="lf-button compact ghost" id="lf-clear-selection">取消选择</button><button class="lf-button compact danger-button" id="lf-delete-selected" ${state.selected.size ? '' : 'disabled'}>${icon('trash', 13)}批量删除</button></div>`;
  bar.querySelector('#lf-select-page').onclick = () => { ownIds.forEach((id) => state.selected.add(id)); renderGrid(); renderBatchBar(); };
  bar.querySelector('#lf-clear-selection').onclick = () => { state.selected.clear(); renderGrid(); renderBatchBar(); };
  bar.querySelector('#lf-delete-selected').onclick = () => confirmDelete([...state.selected]);
}

function bindPage() {
  document.getElementById('lf-create').addEventListener('click', () => openScopeWizard(null, 'ai'));
  document.getElementById('lf-goal-create')?.addEventListener('click', () => openLearningGoalWizard());
  document.getElementById('lf-choose-context').addEventListener('click', () => openLearningPlanWizard());
  document.getElementById('lf-batch').addEventListener('click', () => { state.batchMode = !state.batchMode; state.selected.clear(); document.getElementById('lf-batch').textContent = state.batchMode ? '完成管理' : '批量管理'; renderGrid(); renderBatchBar(); });
  document.getElementById('lf-generate-handout')?.addEventListener('click', () => generateHandout(state.activeFlowId || state.items[0]?.template_id));
  let timer;
  document.getElementById('lf-search').addEventListener('input', (event) => { clearTimeout(timer); timer = setTimeout(() => {
    state.search = event.target.value.trim(); persistListRoute(); loadFlows();
  }, 260); });
}

async function findGoalForFlow(flow) {
  if (state.learningContext && Number(state.learningContext.workflowTemplateId) === Number(flow.template_id)) return state.learningContext.learningGoalId
  if (flow.preloadLearningGoalId) return flow.preloadLearningGoalId
  if (!state.courseId) return null
  const goals = responseData(await learningGoalApi.list({ courseId: Number(state.courseId), pageSize: 50 }))?.items || []
  return goals.find(goal => Number(goal.workflowTemplateId || goal.workflow?.templateId) === Number(flow.template_id))?.goalId
    || goals.find(goal => Number(goal.primaryKnowledgePoint?.knowledgePointId || goal.primaryKnowledgePointId) === Number(state.knowledgePointId))?.goalId
    || null
}

async function prepareFlow(templateId, retry) {
  const flow = state.items.find(item => Number(item.template_id) === Number(templateId)); if (!flow) return
  if (!contextIsReady() || Number(state.learningContext.workflowTemplateId) !== Number(templateId)) { openLearningPlanWizard({ missingStep: contextIsReady() ? 3 : 1, preferredTemplateId: templateId }); return }
  if (['QUEUED', 'PRELOADING'].includes(flow.preloadStatus) && flow.preloadId) { showToast(`${flow.preloadStage || '学习准备中'}（${flow.preloadProgress || 0}%）`, 'info'); return }
  const goalId = state.learningContext.learningGoalId
  try {
    const result = retry && flow.preloadId
      ? responseData(await learningWorkflowApi.retryPreload(flow.preloadId, globalThis.crypto?.randomUUID?.() || `preload_${Date.now()}`))
      : responseData(await learningWorkflowApi.createPreload({ workflowTemplateId: templateId, learningGoalId: goalId, operationId: globalThis.crypto?.randomUUID?.() || `preload_${Date.now()}` }))
    showToast(result.status === 'READY' ? '学习流已准备完成' : '学习准备任务已创建', 'success'); await loadFlows()
  } catch (error) { showToast(error.message || '学习准备失败，仍可直接学习。', 'error') }
}

async function enterFileGenerator(agent, prefill) {
  const created = responseData(await createAgentConversation(agent.id, { title: '课前讲义', operationId: globalThis.crypto?.randomUUID?.() || `handout_${Date.now()}` }))
  await prefillFileRequirements(created.id, prefill)
  navigateTo(`#/student/agents/${agent.id}/chat/${created.id}`)
}

async function generateHandout(templateId) {
  let flow = state.items.find(item => Number(item.template_id) === Number(templateId))
  if (!flow && templateId) flow = responseData(await learningWorkflowApi.getTemplate(templateId).catch(() => null))
  if (!flow) { showToast('请先选择一个学习流', 'warning'); return }
  const context = state.learningContext && Number(state.learningContext.workflowTemplateId) === Number(flow.template_id) ? state.learningContext : null
  const courseId = Number(context?.courseId || state.courseId || flow.course_id); const knowledgePointId = Number(context?.knowledgePointId || state.knowledgePointId || flow.knowledge_point_id)
  if (!contextIsReady() || !context || !courseId || !knowledgePointId) { showToast('请先完善当前学习计划', 'warning'); openLearningPlanWizard({ missingStep: 1, preferredTemplateId: templateId }); return }
  const learningGoalId = await findGoalForFlow(flow).catch(() => null)
  if (!learningGoalId) { showToast('请先确认当前学习目标，再生成课前讲义。', 'warning'); return }
  try {
    const [publicResult, mineResult] = await Promise.all([listAgents({ agentType: 'FILE_GENERATOR', pageSize: 30 }), listMyAgents({ agentType: 'FILE_GENERATOR', pageSize: 30 })])
    const map = new Map(); [...(responseData(publicResult)?.list || []), ...(responseData(mineResult)?.list || [])].filter(item => item.agentType === 'FILE_GENERATOR').forEach(item => map.set(item.id, item))
    const agents = [...map.values()].sort((a, b) => Number(b.systemKey === 'system_study_handout_generator') - Number(a.systemKey === 'system_study_handout_generator'))
    if (!agents.length) { showToast('还没有可用的文件生成型智能体，请先创建一个。', 'warning'); navigateTo('#/student/agents/create'); return }
    const prefill = { artifactType: 'STUDY_HANDOUT', courseId, knowledgePointId, learningGoalId, workflowTemplateId: flow.template_id, targetMastery: context.targetMastery, learningPreference: context.learningPreference, contextHash: context.contextHash, resourceRole: 'PRE_CLASS_HANDOUT' }
    if (agents.length === 1) { await enterFileGenerator(agents[0], prefill); return }
    const overlay = modal(`<header class="lf-modal-head"><div><span class="lf-wizard-step">生成课前讲义</span><h2>选择文件生成器</h2><p>需求会安全预填，仍需在生成器内确认生成。</p></div><button class="lf-icon-button" data-close>${icon('close')}</button></header><div class="lf-modal-body"><div class="lf-choice-grid">${agents.map(agent => `<button class="lf-choice" data-generator="${agent.id}"><b>${escapeHtml(agent.version?.name || '文件生成器')}</b><span>${escapeHtml(agent.version?.shortDescription || '')}</span></button>`).join('')}</div></div>`)
    overlay.querySelector('[data-close]').onclick = () => overlay.remove(); overlay.querySelectorAll('[data-generator]').forEach(button => button.onclick = async () => { button.disabled = true; try { await enterFileGenerator(map.get(Number(button.dataset.generator)), prefill); overlay.remove() } catch (error) { button.disabled = false; showToast(error.message, 'error') } })
  } catch (error) { showToast(error.message || '无法打开文件生成器', 'error') }
}

async function loadLearningGoalAvailability() {
  try {
    const config = responseData(await learningGoalApi.getConfig());
    const button = document.getElementById('lf-goal-create');
    if (button) button.hidden = config?.enabled !== true;
  } catch {
    // Feature discovery is optional; the stable fixed-knowledge-point entry remains available.
  }
}
function persistListRoute() {
  const query = new URLSearchParams();
  if (state.tab !== 'all') query.set('tab', state.tab);
  if (state.search) query.set('search', state.search);
  if (state.courseId) query.set('courseId', state.courseId);
  if (state.knowledgePointId) query.set('knowledgePointId', state.knowledgePointId);
  if (state.knowledgePointName) query.set('knowledgePointName', state.knowledgePointName);
  const hash = `#/student/learning-flows${query.toString() ? `?${query}` : ''}`;
  history.replaceState(null, '', hash);
}
function setHash({ tab = state.tab, search = state.search }) {
  const query = new URLSearchParams(); if (tab !== 'all') query.set('tab', tab); if (search) query.set('search', search); if (state.courseId) query.set('courseId', state.courseId); if (state.knowledgePointId) query.set('knowledgePointId', state.knowledgePointId); if (state.knowledgePointName) query.set('knowledgePointName', state.knowledgePointName);
  navigateTo(`#/student/learning-flows${query.toString() ? `?${query}` : ''}`);
}

function modal(content) {
  const overlay = document.createElement('div'); overlay.className = 'lf-modal-overlay'; overlay.innerHTML = `<section class="lf-modal" role="dialog" aria-modal="true">${content}</section>`;
  document.body.appendChild(overlay); overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
  return overlay;
}
async function openPreview(id) {
  try {
    const flow = responseData(await learningWorkflowApi.getTemplate(id)); const nodes = flow.latestVersion?.graph_json?.nodes || [];
    const overlay = modal(`<header class="lf-modal-head"><div><span class="lf-source ${sourceClass(flow)}">${sourceLabel(flow)}</span><h2>${escapeHtml(flow.title)}</h2></div><button class="lf-icon-button" data-close>${icon('close')}</button></header><div class="lf-modal-body"><p>${escapeHtml(flow.description || '暂无简介')}</p><ol class="lf-preview-path">${nodes.map((node) => `<li><b>${escapeHtml(getNodeType(node.type)?.label || node.type)}</b><span>${escapeHtml(node.title || '')} · ${node.config?.estimatedMinutes || getNodeType(node.type)?.minutes || 5} 分钟</span></li>`).join('')}</ol></div><footer class="lf-modal-foot"><button class="lf-button secondary" data-close>关闭</button>${flow.can_edit ? `<button class="lf-button primary" data-edit>编辑学习流</button>` : `<button class="lf-button primary" data-copy>复制并编辑</button>`}</footer>`);
    overlay.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => overlay.remove());
    overlay.querySelector('[data-edit]')?.addEventListener('click', () => navigateTo(`#/student/learning-flow/editor/${id}`));
    overlay.querySelector('[data-copy]')?.addEventListener('click', () => { overlay.remove(); copyFlow(id); });
  } catch (error) { showToast(error.message || '无法加载学习流详情', 'error'); }
}
async function copyFlow(id) {
  try { const flow = responseData(await learningWorkflowApi.copyTemplate(id)); showToast('已复制到“我的学习流”', 'success'); navigateTo(`#/student/learning-flow/editor/${flow.template_id}`); } catch (error) { showToast(error.message || '复制失败', 'error'); }
}
function confirmDelete(ids) {
  const overlay = modal(`<div class="lf-confirm"><div class="lf-confirm-icon">${icon('trash', 23)}</div><h2>删除学习流？</h2><p>将删除 ${ids.length} 个我的学习流。已有学习记录会保留为历史快照，无法从列表恢复。</p><div><button class="lf-button secondary" data-cancel>取消</button><button class="lf-button danger-button" data-confirm>确认删除</button></div></div>`);
  overlay.querySelector('[data-cancel]').onclick = () => overlay.remove();
  overlay.querySelector('[data-confirm]').onclick = async (event) => {
    event.currentTarget.disabled = true; event.currentTarget.textContent = '正在删除…';
    try { const result = responseData(await learningWorkflowApi.batchDeleteTemplates(ids)); showToast(`已删除 ${result.deletedCount} 个学习流`, 'success'); state.selected.clear(); overlay.remove(); loadFlows(); } catch (error) { event.currentTarget.disabled = false; event.currentTarget.textContent = '确认删除'; showToast(error.message || '删除失败', 'error'); }
  };
}

async function openLearningGoalWizard() {
  const wizard = {
    courses: [], courseId: state.courseId || '', goalText: '', targetDepth: 'basic',
    targetMastery: 80, availableMinutes: 25, goal: null, preview: null,
    phase: 'input', busy: false, destroyed: false, stageIndex: 0,
  };
  const overlay = modal('<div class="lf-wizard lf-goal-wizard" id="lf-goal-wizard"></div>');
  const host = overlay.querySelector('#lf-goal-wizard');
  const close = () => { wizard.destroyed = true; overlay.remove(); };
  const coverageLabels = { sufficient: '充足', partial: '部分覆盖', insufficient: '不足', unavailable: '不可用' };
  const depthLabels = { introductory: '入门', basic: '基础', intermediate: '进阶', advanced: '高级', review: '复习' };

  function rememberInput() {
    wizard.courseId = host.querySelector('#lg-course')?.value || wizard.courseId;
    wizard.goalText = host.querySelector('#lg-text')?.value || wizard.goalText;
    wizard.targetDepth = host.querySelector('#lg-depth')?.value || wizard.targetDepth;
    wizard.targetMastery = Number(host.querySelector('#lg-mastery')?.value) || wizard.targetMastery;
    wizard.availableMinutes = Number(host.querySelector('#lg-minutes')?.value) || wizard.availableMinutes;
  }

  function inputHtml() {
    const examples = ['我想理解逻辑回归为什么用于分类', '我想比较决策树和随机森林', '我想掌握准确率、精确率和召回率', '我想学习支持向量机的核函数'];
    return `<div class="lg-intro"><span>${icon('target', 24)}</span><div><b>告诉 AI 你想学什么</b><p>系统只会匹配当前课程已有知识点，并先检查课程资料覆盖。</p></div></div>
      <label class="lf-field">选择课程<select id="lg-course"><option value="">请选择已加入课程</option>${wizard.courses.map((course) => `<option value="${course.course_id}" ${String(wizard.courseId) === String(course.course_id) ? 'selected' : ''}>${escapeHtml(course.course_name)}</option>`).join('')}</select></label>
      <label class="lf-field">自然语言学习目标<textarea id="lg-text" maxlength="300" rows="4" placeholder="例如：我想弄懂支持向量机为什么需要核函数，并完成基础练习。">${escapeHtml(wizard.goalText)}</textarea></label>
      <div class="lg-examples">${examples.map((text) => `<button type="button" data-lg-example="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join('')}</div>
      <div class="lf-wizard-settings lg-settings"><label>学习深度<select id="lg-depth"><option value="introductory" ${wizard.targetDepth === 'introductory' ? 'selected' : ''}>入门</option><option value="basic" ${wizard.targetDepth === 'basic' ? 'selected' : ''}>基础</option><option value="intermediate" ${wizard.targetDepth === 'intermediate' ? 'selected' : ''}>进阶</option><option value="advanced" ${wizard.targetDepth === 'advanced' ? 'selected' : ''}>高级</option><option value="review" ${wizard.targetDepth === 'review' ? 'selected' : ''}>复习</option></select></label><label>目标掌握度<input id="lg-mastery" type="number" min="60" max="95" value="${wizard.targetMastery}"> %</label><label>可用时间<input id="lg-minutes" type="number" min="10" max="120" value="${wizard.availableMinutes}"> 分钟</label></div>`;
  }

  function loadingHtml() {
    const stages = [
      ['正在分析学习范围', '判断目标是否明确且属于当前课程'],
      ['正在匹配课程知识点', '从后端候选白名单中选择主知识点'],
      ['正在检查课程资料', '并行检索当前课程允许的知识库'],
      ['正在规划学习子目标', '拆分子目标、前置知识与学习深度'],
    ];
    const stage = stages[Math.min(wizard.stageIndex, stages.length - 1)];
    return `<div class="lg-loading"><i></i><h3>${stage[0]}</h3><p>${stage[1]}</p><ol>${stages.map(([title], index) => `<li class="${index <= wizard.stageIndex ? 'active' : ''}">${title}</li>`).join('')}</ol></div>`;
  }

  function analysisHtml() {
    const goal = wizard.goal || {};
    if (goal.status === 'OUT_OF_SCOPE') return `<div class="lg-blocked out"><span>当前范围不支持</span><h3>${escapeHtml(goal.normalizedTitle || '该学习目标')}</h3><p>${escapeHtml(goal.message || '当前课程知识库暂不包含该主题，无法保证学习内容的可靠性。')}</p><div class="lg-suggestions">${(goal.suggestions || ['重新选择课程', '输入当前课程相关目标']).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div></div>`;
    if (goal.status === 'INSUFFICIENT_COVERAGE') return `<div class="lg-blocked insufficient"><span>课程资料${coverageLabels[goal.knowledgeBaseCoverage?.status] || '不足'}</span><h3>${escapeHtml(goal.normalizedTitle)}</h3><p>${escapeHtml(goal.message || '当前课程资料不足，暂不生成需要高可信内容的正式学习流。')}</p>${goal.knowledgeBaseCoverage ? `<div class="lg-coverage ${goal.knowledgeBaseCoverage.status}">覆盖评分 ${Math.round((goal.knowledgeBaseCoverage.score || 0) * 100)}% · ${goal.knowledgeBaseCoverage.coveredSubGoalCount}/${goal.knowledgeBaseCoverage.totalSubGoalCount} 个子目标</div>` : ''}</div>`;
    if (goal.status === 'NEEDS_CLARIFICATION') return `<div class="lg-blocked clarify"><span>${goal.goalType === 'TOO_BROAD' ? '目标范围较大' : '需要澄清'}</span><h3>${escapeHtml(goal.message || '请选择一个更明确的学习方向')}</h3>${goal.clarificationQuestion ? `<p>${escapeHtml(goal.clarificationQuestion)}</p>` : ''}<div class="lg-option-grid">${(goal.clarificationOptions || []).map((item) => `<button data-lg-clarify="${escapeHtml(item.goalText)}"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.goalText)}</small></button>`).join('')}</div></div>`;
    const coverage = goal.knowledgeBaseCoverage || {};
    return `<div class="lg-analysis-head"><span>AI 理解结果</span><h3>${escapeHtml(goal.normalizedTitle)}</h3><p>${escapeHtml(goal.focusQuestion || goal.rawGoal)}</p></div>
      <div class="lg-facts"><div><small>主要知识点</small><b>${escapeHtml(goal.primaryKnowledgePoint?.name || '—')}</b></div><div><small>学习深度</small><b>${depthLabels[goal.targetDepth] || goal.targetDepth}</b></div><div><small>目标掌握度</small><b>${goal.targetMastery}%</b></div><div><small>预计时间</small><b>${goal.estimatedMinutes} 分钟</b></div></div>
      <section class="lg-analysis-section"><h4>子目标</h4><ol>${(goal.subGoals || []).map((item) => `<li><span>${escapeHtml(item.title)}</span><em>${item.type === 'practice' ? '练习' : item.type === 'review' ? '前置复习' : '概念'}</em></li>`).join('')}</ol></section>
      ${(goal.prerequisites || []).length ? `<section class="lg-analysis-section"><h4>前置知识</h4><div class="lg-chips">${goal.prerequisites.map((item) => `<span>${escapeHtml(item.title)}${item.required ? ' · 必要' : ''}</span>`).join('')}</div></section>` : ''}
      ${(goal.relatedKnowledgePoints || []).length ? `<section class="lg-analysis-section"><h4>相关知识点</h4><div class="lg-chips">${goal.relatedKnowledgePoints.map((item) => `<span>${escapeHtml(item.name)}</span>`).join('')}</div></section>` : ''}
      <div class="lg-coverage ${coverage.status || 'unavailable'}"><b>知识库覆盖：${coverageLabels[coverage.status] || '未检查'}</b><span>${Math.round((coverage.score || 0) * 100)}% · 已覆盖 ${coverage.coveredSubGoalCount || 0}/${coverage.totalSubGoalCount || 0} 个子目标</span></div>
      ${(goal.warnings || []).map((warning) => `<p class="lg-warning">${escapeHtml(warning)}</p>`).join('')}`;
  }

  function previewHtml() {
    const nodes = wizard.preview?.graph?.nodes || [];
    const edges = wizard.preview?.graph?.edges || [];
    const settings = wizard.preview?.settings || {};
    return `<div class="lg-analysis-head"><span>安全学习流预览</span><h3>${escapeHtml(wizard.goal?.normalizedTitle)}</h3><p>已复用现有工作流生成器并通过节点、条件和 DAG 校验。</p></div><div class="lf-ai-goal-row"><span>${nodes.length} 个节点</span><span>约 ${settings.estimated_minutes || wizard.goal?.estimatedMinutes} 分钟</span><span>目标 ${settings.target_mastery || wizard.goal?.targetMastery}%</span></div><ol class="lf-preview-path">${nodes.map((node) => { const conditions = edges.filter((edge) => edge.source === node.id && edge.condition?.type !== 'always').map((edge) => edge.label || edge.condition.type).join(' / '); return `<li><b>${escapeHtml(getNodeType(node.type)?.label || node.type)}</b><span>${escapeHtml(node.title || '')}${conditions ? ` · 条件：${escapeHtml(conditions)}` : ''}</span></li>`; }).join('')}</ol><p class="lf-ai-note">只有点击“开始学习”后才会创建并启动现有 LangGraph 学习会话。</p>`;
  }

  function render() {
    if (wizard.destroyed) return;
    let body = wizard.busy ? loadingHtml() : wizard.phase === 'preview' ? previewHtml() : wizard.phase === 'analysis' ? analysisHtml() : inputHtml();
    let footer = '<button class="lf-button secondary" data-close>取消</button>';
    if (!wizard.busy && wizard.phase === 'input') footer += '<button class="lf-button primary" data-lg-analyze>分析学习目标</button>';
    if (!wizard.busy && wizard.phase === 'analysis') {
      footer += '<button class="lf-button ghost" data-lg-edit>修改目标</button>';
      if (wizard.goal?.status === 'RESOLVED') footer += '<button class="lf-button primary" data-lg-confirm>确认并生成学习流</button>';
      if (wizard.goal?.status === 'CONFIRMED' || wizard.goal?.status === 'GENERATING_WORKFLOW') footer += '<button class="lf-button primary" data-lg-confirm>重新生成学习流</button>';
      if (wizard.goal?.status === 'STARTED' && wizard.goal.learningSession?.sessionId) footer += '<button class="lf-button primary" data-lg-continue>继续学习</button>';
    }
    if (!wizard.busy && wizard.phase === 'preview') footer += `<button class="lf-button ghost" data-lg-edit>返回修改</button><button class="lf-button primary" data-lg-start>${wizard.goal?.status === 'STARTED' ? '继续学习' : '开始学习'}</button>`;
    host.innerHTML = `<header class="lf-modal-head"><div><span class="lf-wizard-step">目标驱动学习流</span><h2>${wizard.phase === 'input' ? '告诉 AI 你想学什么' : wizard.phase === 'preview' ? '确认学习流预览' : '确认目标分析结果'}</h2><p>自然语言目标 → 课程知识点 → 资料覆盖 → 安全学习流</p></div><button class="lf-icon-button" data-close>${icon('close')}</button></header><div class="lf-modal-body">${body}</div><footer class="lf-modal-foot">${footer}</footer>`;
    host.querySelectorAll('[data-close]').forEach((button) => { button.onclick = close; });
    host.querySelectorAll('[data-lg-example]').forEach((button) => { button.onclick = () => { const textarea = host.querySelector('#lg-text'); if (textarea) textarea.value = button.dataset.lgExample; }; });
    host.querySelector('[data-lg-analyze]')?.addEventListener('click', analyze);
    host.querySelectorAll('[data-lg-edit]').forEach((button) => { button.onclick = () => { wizard.goalText = wizard.goal?.rawGoal || wizard.goalText; wizard.phase = 'input'; render(); }; });
    host.querySelectorAll('[data-lg-clarify]').forEach((button) => { button.onclick = () => clarify(button.dataset.lgClarify); });
    host.querySelector('[data-lg-confirm]')?.addEventListener('click', confirmAndPreview);
    host.querySelector('[data-lg-start]')?.addEventListener('click', start);
    host.querySelector('[data-lg-continue]')?.addEventListener('click', () => navigateTo(`#/student/learning/session/${wizard.goal.learningSession.sessionId}`));
  }

  async function waitForResolution(goal) {
    let current = goal;
    for (let attempt = 0; attempt < 30 && current?.status === 'RESOLVING'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current = responseData(await learningGoalApi.get(current.goalId));
    }
    return current;
  }

  async function analyze() {
    rememberInput();
    if (!wizard.courseId) { showToast('请先选择课程', 'warning'); return; }
    if (!wizard.goalText.trim()) { showToast('请输入学习目标', 'warning'); return; }
    wizard.busy = true; wizard.stageIndex = 0; render();
    const timer = setInterval(() => { wizard.stageIndex = Math.min(3, wizard.stageIndex + 1); render(); }, 1800);
    try {
      let goal = responseData(await learningGoalApi.resolve({
        courseId: Number(wizard.courseId), goalText: wizard.goalText.trim(),
        operationId: globalThis.crypto?.randomUUID?.() || `goal_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        preferences: { targetDepth: wizard.targetDepth, targetMastery: wizard.targetMastery, availableMinutes: wizard.availableMinutes },
      }));
      goal = await waitForResolution(goal);
      wizard.goal = goal; wizard.phase = 'analysis';
    } catch (error) { showToast(error.message || '学习目标分析失败', 'error'); }
    finally { clearInterval(timer); wizard.busy = false; render(); }
  }

  async function clarify(goalText) {
    wizard.busy = true; wizard.stageIndex = 0; render();
    try {
      wizard.goal = responseData(await learningGoalApi.update(wizard.goal.goalId, { clarificationGoalText: goalText }));
      wizard.goalText = goalText; wizard.courseId = wizard.goal.course?.courseId || wizard.courseId; wizard.phase = 'analysis';
    } catch (error) { showToast(error.message || '重新分析失败', 'error'); }
    finally { wizard.busy = false; render(); }
  }

  async function confirmAndPreview() {
    wizard.busy = true; wizard.stageIndex = 3; render();
    try {
      wizard.goal = responseData(await learningGoalApi.confirm(wizard.goal.goalId));
      const result = responseData(await learningGoalApi.workflowPreview(wizard.goal.goalId));
      wizard.goal = result.goal; wizard.preview = result.preview; wizard.phase = 'preview';
    } catch (error) {
      // 保留分析结果，回到分析就绪状态，让用户可以重试
      wizard.phase = 'analysis';
      const backendMessage = error.message || '';
      const isInternalError = backendMessage.includes('暂时失败') || !backendMessage;
      showToast(
        isInternalError ? '学习目标分析已完成，但学习流程生成失败，请重新生成。' : backendMessage,
        'error',
      );
    } finally { wizard.busy = false; render(); }
  }

  async function start() {
    wizard.busy = true; wizard.stageIndex = 3; render();
    try {
      const result = responseData(await learningGoalApi.start(wizard.goal.goalId));
      const sessionId = result.session?.session_id || result.goal?.learningSession?.sessionId;
      if (!sessionId) throw new Error('学习会话创建失败');
      close(); navigateTo(`#/student/learning/session/${sessionId}`);
    } catch (error) { wizard.busy = false; render(); showToast(error.message || '无法开始学习', 'error'); }
  }

  try {
    wizard.courses = responseData(await getStudentCourses()).list || [];
  } catch (error) { showToast(error.message || '课程加载失败', 'error'); }
  render();
}

async function openScopeWizard(templateId = null, purpose = templateId ? 'start' : 'recommend') {
  const wizard = { templateId, purpose, courseId: state.courseId, knowledgePointId: state.knowledgePointId, chapterId: '', courses: [], chapters: [], points: [], step: 1, method: purpose === 'ai' ? 'ai' : 'manual', draft: null, loading: false, title: '', description: '', prompt: '', estimatedMinutes: 30, targetMastery: 80, advancing: false, destroyed: false, existingSession: null };
  const overlay = modal('<div class="lf-wizard" id="lf-wizard"></div>'); const host = overlay.querySelector('#lf-wizard');
  const close = () => { wizard.destroyed = true; overlay.remove(); };
  let advanceTimer = null;
  async function fetchCourses() { wizard.loading = true; render(); try { wizard.courses = responseData(await getStudentCourses()).list || []; } catch (error) { showToast(error.message || '课程加载失败', 'error'); } finally { if (!wizard.destroyed) { wizard.loading = false; render(); } } }
  async function fetchPoints() { wizard.loading = true; render(); try { const [chapters, points] = await Promise.all([getStudentCourseChapters(Number(wizard.courseId)), getStudentCourseKnowledgePoints(Number(wizard.courseId))]); wizard.chapters = responseData(chapters).list || []; wizard.points = responseData(points).list || []; } catch (error) { showToast(error.message || '知识点加载失败', 'error'); } finally { if (!wizard.destroyed) { wizard.loading = false; render(); } } }

  // Check for existing incomplete session when entering via "learn" button
  async function checkExistingSession() {
    if (!templateId || !wizard.courseId || !wizard.knowledgePointId) return;
    try {
      const result = responseData(await learningWorkflowApi.listTemplates({ source: 'ALL', pageSize: 1 }));
      // We check via quickStart which handles session reuse
      const sessionCheck = await fetch(`/api/learning-workflows/quick-start-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({ templateId, courseId: Number(wizard.courseId), knowledgePointId: Number(wizard.knowledgePointId) }),
      });
      if (sessionCheck.ok) {
        const checkData = await sessionCheck.json();
        wizard.existingSession = checkData.data?.existingSession || null;
        render();
      }
    } catch { /* ignore - not critical for wizard flow */ }
  }

  function stepTitle() {
    if (templateId) return ['选择课程', '选择知识点', '确认开始'][wizard.step - 1];
    if (purpose === 'ai') return ['选择课程', '选择知识点', '描述学习目标'][wizard.step - 1];
    return ['选择课程', '选择知识点', '确认推荐范围'][wizard.step - 1];
  }

  async function autoAdvanceTo(targetStep) {
    if (wizard.advancing || wizard.destroyed) return;
    wizard.advancing = true;
    if (advanceTimer) clearTimeout(advanceTimer);
    advanceTimer = setTimeout(async () => {
      if (wizard.destroyed) { wizard.advancing = false; return; }
      wizard.step = targetStep;
      // Step 2 always loads knowledge points and renders
      if (targetStep === 2) { await fetchPoints(); render(); }
      if (targetStep === 3 && !templateId) { render(); }
      if (targetStep === 3 && templateId) {
        await checkExistingSession();
        render();
      }
      wizard.advancing = false;
    }, 200);
  }

  function renderStep3ForStart() {
    // Scenario B: Start learning - show confirmation with learning flow info
    const course = wizard.courses.find(c => String(c.course_id) === String(wizard.courseId));
    const point = wizard.points.find(p => String(p.knowledge_point_id) === String(wizard.knowledgePointId));
    const chapter = wizard.chapters.find(c => String(c.chapter_id) === String(point?.chapter_id));
    const courseName = course?.course_name || '—';
    const chapterName = chapter?.chapter_name || '—';
    const pointName = point?.knowledge_point_name || '—';
    const mastery = point?.mastery_score != null ? Math.round(point.mastery_score) + '%' : '暂无数据';

    return `<div class="lf-start-confirm">
      <div class="lf-start-icon">${icon('play', 32)}</div>
      <h3>准备开始学习</h3>
      <div class="lf-start-info">
        <div class="lf-start-row"><span class="lf-start-label">课程</span><span>${escapeHtml(courseName)}</span></div>
        <div class="lf-start-row"><span class="lf-start-label">章节</span><span>${escapeHtml(chapterName)}</span></div>
        <div class="lf-start-row"><span class="lf-start-label">知识点</span><span>${escapeHtml(pointName)}</span></div>
        <div class="lf-start-row"><span class="lf-start-label">当前掌握度</span><span class="lf-start-mastery">${mastery}</span></div>
        ${wizard.existingSession ? `<div class="lf-start-existing"><span>${icon('clock', 16)}</span><span>检测到未完成的学习会话，可继续上次学习</span></div>` : ''}
      </div>
    </div>`;
  }

  function renderStep3ForRecommendation() {
    const course = wizard.courses.find(c => String(c.course_id) === String(wizard.courseId));
    const point = wizard.points.find(p => String(p.knowledge_point_id) === String(wizard.knowledgePointId));
    return `<div class="lf-start-confirm"><div class="lf-start-icon">${icon('spark', 30)}</div><h3>为你匹配学习流</h3><div class="lf-start-info"><div class="lf-start-row"><span class="lf-start-label">课程</span><span>${escapeHtml(course?.course_name || '—')}</span></div><div class="lf-start-row"><span class="lf-start-label">知识点</span><span>${escapeHtml(point?.knowledge_point_name || '—')}</span></div><div class="lf-start-row"><span class="lf-start-label">当前掌握度</span><span class="lf-start-mastery">${Math.round(point?.mastery_score || 0)}%</span></div></div><p class="lf-ai-note">系统会根据掌握度、近期错题和学习流目标推荐现有流程，不会创建重复模板。</p></div>`;
  }

  function render() {
    if (wizard.destroyed) return;
    const total = templateId ? 3 : 3;
    let body = '';
    if (wizard.loading) body = '<div class="lf-wizard-state"><i></i>正在加载…</div>';
    else if (wizard.step === 1) body = wizard.courses.length ? `<div class="lf-choice-grid">${wizard.courses.map((course) => `<button class="lf-choice ${String(wizard.courseId) === String(course.course_id) ? 'selected' : ''}" data-course="${course.course_id}"><b>${escapeHtml(course.course_name)}</b><span>${escapeHtml(course.course_code || '课程')} · 学习进度 ${course.learning_progress ?? course.progress ?? 0}%</span></button>`).join('')}</div>` : '<div class="lf-wizard-state">暂未加入课程，请先到课程中心加入课程。</div>';
    else if (wizard.step === 2) { const visiblePoints = wizard.chapterId ? wizard.points.filter((point) => String(point.chapter_id) === String(wizard.chapterId)) : wizard.points; body = `<div class="lf-chapter-filter"><button class="${!wizard.chapterId ? 'selected' : ''}" data-chapter="">全部章节</button>${wizard.chapters.map((chapter) => `<button class="${String(wizard.chapterId) === String(chapter.chapter_id) ? 'selected' : ''}" data-chapter="${chapter.chapter_id}">${escapeHtml(chapter.chapter_name)}</button>`).join('')}</div><label class="lf-wizard-search">${icon('search')}<input id="lf-point-search" placeholder="搜索知识点"></label><div class="lf-point-list">${visiblePoints.map((point) => `<button class="lf-point ${String(wizard.knowledgePointId) === String(point.knowledge_point_id) ? 'selected' : ''}" data-point="${point.knowledge_point_id}"><span><b>${escapeHtml(point.knowledge_point_name)}</b><small>${escapeHtml(point.chapter_name || '未分章节')} · ${escapeHtml(point.knowledge_point_code || '')}</small></span><em>掌握度 ${Math.round(point.mastery_score || 0)}%</em></button>`).join('') || '<div class="lf-wizard-state">该章节暂无可选知识点。</div>'}</div>`; }
    else if (wizard.step === 3 && templateId) body = renderStep3ForStart();
    else if (wizard.step === 3 && purpose === 'recommend') body = renderStep3ForRecommendation();
    else body = createAiMethodHtml(wizard);

    // Footer: step 1 only cancel; step 2 cancel + back; step 3 cancel + back + action
    let footer = '';
    if (wizard.step === 1) {
      footer = `<button class="lf-button secondary" data-close>取消</button>`;
    } else if (wizard.step === 2) {
      footer = `<button class="lf-button secondary" data-close>取消</button><button class="lf-button ghost" data-back>上一步</button>`;
    } else if (templateId) {
      // Step 3 for "start learning"
      const btnLabel = wizard.existingSession ? '继续上次学习' : '正式开始学习';
      footer = `<button class="lf-button secondary" data-close>取消</button><button class="lf-button ghost" data-back>上一步</button><button class="lf-button primary" data-start>${btnLabel}</button>`;
    } else if (purpose === 'recommend') {
      footer = '<button class="lf-button secondary" data-close>取消</button><button class="lf-button ghost" data-back>上一步</button><button class="lf-button primary" data-apply-context>查看推荐</button>';
    } else {
      footer = '<button class="lf-button secondary" data-close>取消</button><button class="lf-button ghost" data-back>上一步</button><button class="lf-button primary" data-next>AI 生成预览</button>';
    }

    host.innerHTML = `<header class="lf-modal-head"><div><span class="lf-wizard-step">步骤 ${wizard.step}/${total}</span><h2>${stepTitle()}</h2><p>${templateId ? '为本次学习确定课程与知识点。' : purpose === 'ai' ? 'AI 会将自然语言目标转换成可编辑的节点与达成条件。' : '只选择推荐范围，不会新建重复学习流。'}</p></div><button class="lf-icon-button" data-close>${icon('close')}</button></header><div class="lf-modal-body">${body}</div><footer class="lf-modal-foot">${footer}</footer>`;

    host.querySelectorAll('[data-close]').forEach((button) => button.onclick = close);
    host.querySelector('[data-back]')?.addEventListener('click', () => {
      if (advanceTimer) clearTimeout(advanceTimer);
      wizard.advancing = false;
      wizard.step -= 1;
      if (wizard.step === 1) { wizard.knowledgePointId = ''; wizard.chapterId = ''; }
      render();
    });

    // Step 1: course selection - auto advance on click
    host.querySelectorAll('[data-course]').forEach((button) => button.addEventListener('click', () => {
      if (wizard.advancing || wizard.destroyed) return;
      wizard.courseId = button.dataset.course;
      wizard.knowledgePointId = '';
      wizard.chapterId = '';
      render();
      autoAdvanceTo(2);
    }));

    // Step 2: chapter filter
    host.querySelectorAll('[data-chapter]').forEach((button) => button.addEventListener('click', () => {
      wizard.chapterId = button.dataset.chapter;
      wizard.knowledgePointId = '';
      render();
    }));

    // Step 2: knowledge point selection - auto advance on click
    host.querySelectorAll('[data-point]').forEach((button) => button.addEventListener('click', () => {
      if (wizard.advancing || wizard.destroyed) return;
      wizard.knowledgePointId = button.dataset.point;
      render();
      autoAdvanceTo(3);
    }));

    host.querySelector('#lf-point-search')?.addEventListener('input', (event) => { const query = event.target.value.toLowerCase(); host.querySelectorAll('[data-point]').forEach((item) => { item.hidden = !item.textContent.toLowerCase().includes(query); }); });

    host.querySelector('[data-apply-context]')?.addEventListener('click', () => {
      const point = wizard.points.find((item) => String(item.knowledge_point_id) === String(wizard.knowledgePointId));
      state.courseId = String(wizard.courseId);
      state.knowledgePointId = String(wizard.knowledgePointId);
      state.knowledgePointName = point?.knowledge_point_name || '';
      close(); persistListRoute(); loadRecommendation();
    });

    // Step 3 for "new flow": method selection
    host.querySelectorAll('[data-method]').forEach((button) => button.addEventListener('click', () => {
      if (wizard.advancing || wizard.destroyed) return;
      rememberMethodFields(host, wizard);
      wizard.method = button.dataset.method;
      render();
    }));

    // Step 3 "next" for new flow creation
    host.querySelector('[data-next]')?.addEventListener('click', async () => {
      if (wizard.advancing || wizard.destroyed) return;
      wizard.advancing = true;
      try {
        if (wizard.method === 'manual') {
          const title = host.querySelector('#lf-new-title')?.value.trim();
          if (!title) { showToast('请填写学习流名称', 'warning'); wizard.advancing = false; return; }
          sessionStorage.setItem(FLOW_DRAFT_STORAGE_KEY, JSON.stringify({ title, courseId: Number(wizard.courseId), knowledgePointId: Number(wizard.knowledgePointId), description: host.querySelector('#lf-new-description')?.value.trim() || '', settings: readWizardSettings(host) }));
          close(); navigateTo('#/student/learning-flow/editor/new'); return;
        }
        await generateAiPreview(wizard, host, close);
      } finally { wizard.advancing = false; }
    });

    // Step 3 "start" for learning
    host.querySelector('[data-start]')?.addEventListener('click', async () => {
      if (wizard.advancing || wizard.destroyed) return;
      wizard.advancing = true;
      const btn = host.querySelector('[data-start]');
      btn.disabled = true;
      btn.textContent = '正在创建学习会话…';
      try {
        await startFlow(templateId, Number(wizard.courseId), Number(wizard.knowledgePointId), close);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = wizard.existingSession ? '继续上次学习' : '正式开始学习';
        wizard.advancing = false;
      }
    });
  }
  await fetchCourses();
}
function createAiMethodHtml(wizard) {
  return `<div class="lf-ai-builder-intro"><span>${icon('spark', 22)}</span><div><b>用一句话描述你想怎么学</b><p>AI 会选择讲解、提问、练习、诊断和总结节点，并自动设置分支条件。</p></div></div><label class="lf-field">学习流名称<input id="lf-new-title" maxlength="200" value="${escapeHtml(wizard.title)}" placeholder="例如：逻辑回归薄弱点修复"></label><label class="lf-field">学习目标与偏好<textarea id="lf-ai-prompt" rows="5" placeholder="例如：我想在 25 分钟内理解逻辑回归，先用例子讲解，再做 3 道题；如果正确率低于 70% 就加入错因修复，掌握度达到 85% 后总结。">${escapeHtml(wizard.prompt)}</textarea></label><label class="lf-field">补充说明（可选）<textarea id="lf-new-description" maxlength="1000" placeholder="可填写考试时间、当前困难或希望避免的学习方式">${escapeHtml(wizard.description)}</textarea></label><div class="lf-wizard-settings"><label>预计时长<input id="lf-ai-minutes" type="number" min="5" max="120" value="${wizard.estimatedMinutes}"> 分钟</label><label>目标掌握度<input id="lf-ai-mastery" type="number" min="60" max="100" value="${wizard.targetMastery}"> %</label></div>`;
}
function rememberMethodFields(host, wizard) { wizard.title = host.querySelector('#lf-new-title')?.value || wizard.title; wizard.description = host.querySelector('#lf-new-description')?.value || wizard.description; wizard.prompt = host.querySelector('#lf-ai-prompt')?.value || wizard.prompt; wizard.estimatedMinutes = Number(host.querySelector('#lf-ai-minutes')?.value) || wizard.estimatedMinutes; wizard.targetMastery = Number(host.querySelector('#lf-ai-mastery')?.value) || wizard.targetMastery; }
function readWizardSettings(host) { return { completion_mode: 'mastery_target', target_mastery: Number(host.querySelector('#lf-ai-mastery')?.value) || 80, adjustment_mode: 'ask_before_adjust', estimated_minutes: Number(host.querySelector('#lf-ai-minutes')?.value) || 30 }; }
async function generateAiPreview(wizard, host, close) {
  const title = host.querySelector('#lf-new-title')?.value.trim(); const prompt = host.querySelector('#lf-ai-prompt')?.value.trim();
  const description = host.querySelector('#lf-new-description')?.value.trim() || '';
  const wizardSettings = readWizardSettings(host);
  if (!title || !prompt) { showToast('请填写学习流名称和学习需求', 'warning'); return; }
  const button = host.querySelector('[data-next]'); button.disabled = true; button.textContent = 'AI 正在编排…';
  const body = host.querySelector('.lf-modal-body');
  const progress = document.createElement('div');
  progress.className = 'lf-ai-generating-status';
  progress.innerHTML = '<i></i><div><b>正在理解你的学习目标</b><span>接下来会匹配节点、达成条件并校验流程可执行性</span></div>';
  body?.appendChild(progress);
  const stages = [
    ['正在匹配学习节点', '根据目标选择讲解、提问、练习与诊断节点'],
    ['正在设置达成条件', '把掌握度、正确率和补救规则转换成流程分支'],
    ['正在校验学习流', '检查结束节点、分支可达性与执行安全'],
  ];
  let stageIndex = 0;
  const stageTimer = setInterval(() => {
    const stage = stages[Math.min(stageIndex++, stages.length - 1)];
    const text = progress.querySelector('div');
    if (text) text.innerHTML = `<b>${stage[0]}</b><span>${stage[1]}</span>`;
  }, 1800);
  try {
    const constrainedPrompt = `${prompt}\n\n硬性偏好：预计总时长约 ${wizardSettings.estimated_minutes} 分钟，目标掌握度 ${wizardSettings.target_mastery}%。`;
    const result = responseData(await learningWorkflowApi.generateDraft({ inputText: constrainedPrompt, courseId: Number(wizard.courseId), knowledgePointId: Number(wizard.knowledgePointId) })); const draft = result.draft;
    if (!isSupportedGraph(draft?.graph)) throw new Error('AI 返回的学习流结构无效，请重试或改用手动编排');
    const overview = draft.graph.nodes.map((node) => {
      const conditions = (draft.graph.edges || []).filter((edge) => edge.source === node.id && edge.condition?.type !== 'always').map((edge) => edge.label || edge.condition.type).join(' / ');
      return `<li>${escapeHtml(getNodeType(node.type)?.label || node.type)}<span>${escapeHtml(node.title || '')}${conditions ? ` · 条件：${escapeHtml(conditions)}` : ''}</span></li>`;
    }).join('');
    const generatedBadge = draft.aiGenerated === false ? '<span class="lf-ai-fallback">安全草稿</span>' : '<span class="lf-ai-success">AI 实时生成</span>';
    host.innerHTML = `<header class="lf-modal-head"><div><span class="lf-wizard-step">AI 预览 ${generatedBadge}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(result.matchedReason || draft.matchedReason || '已生成可编辑学习流')}</p></div><button class="lf-icon-button" data-close>${icon('close')}</button></header><div class="lf-modal-body"><div class="lf-ai-goal-row"><span>目标 ${draft.settings?.target_mastery || wizardSettings.target_mastery}%</span><span>约 ${draft.settings?.estimated_minutes || wizardSettings.estimated_minutes} 分钟</span><span>${draft.graph.nodes.length} 个节点</span></div><ol class="lf-preview-path">${overview}</ol><p class="lf-ai-note">确认后保存为“我的学习流”，仍可进入编辑器微调节点和条件。</p></div><footer class="lf-modal-foot"><button class="lf-button secondary" data-close>取消</button><button class="lf-button ghost" data-manual>进入编辑器微调</button><button class="lf-button primary" data-save-ai>使用此流程</button></footer>`;
    host.querySelector('[data-close]').onclick = close;
    host.querySelector('[data-manual]').onclick = () => { sessionStorage.setItem(FLOW_DRAFT_STORAGE_KEY, JSON.stringify({ title, courseId: Number(wizard.courseId), knowledgePointId: Number(wizard.knowledgePointId), description, settings: wizardSettings })); close(); navigateTo('#/student/learning-flow/editor/new'); };
    host.querySelector('[data-save-ai]').onclick = async (event) => { event.currentTarget.disabled = true; event.currentTarget.textContent = '正在保存…'; try { const created = responseData(await learningWorkflowApi.createTemplate({ title, description: description || prompt, course_id: Number(wizard.courseId), knowledge_point_id: Number(wizard.knowledgePointId), graph_json: draft.graph, settings_json: draft.settings })); close(); navigateTo(`#/student/learning-flow/editor/${created.template_id}`); } catch (error) { event.currentTarget.disabled = false; event.currentTarget.textContent = '使用此流程'; showToast(error.message || '保存失败', 'error'); } };
  } catch (error) { button.disabled = false; button.textContent = '重新生成'; progress.remove(); showToast(error.message || 'AI 生成失败，可改用手动编排', 'error'); }
  finally { clearInterval(stageTimer); }
}
async function startFlow(templateId, courseId, knowledgePointId, done) {
  if (!templateId) { showToast('没有可用的学习流模板', 'warning'); return; }
  const flow = state.items.find(item => Number(item.template_id) === Number(templateId));
  const context = state.learningContext && Number(state.learningContext.workflowTemplateId) === Number(templateId) ? state.learningContext : null;
  const prepared = flow?.preloadReady ? { preloadId: flow.preloadId, learningGoalId: flow.preloadLearningGoalId } : context ? { learningGoalId: context.learningGoalId } : {};
  try { const result = responseData(await learningWorkflowApi.quickStart({ templateId, courseId, knowledgePointId, ...prepared })); const session = result.session; if (!session?.session_id) throw new Error('学习会话创建失败'); if (result.preload?.cachedFirstNode) sessionStorage.setItem(`discimind:preload:${session.session_id}`, JSON.stringify(result.preload)); done?.(); navigateTo(`#/student/learning/session/${session.session_id}`); } catch (error) { showToast(error.message || '无法开始学习', 'error'); }
}
