import { learningWorkflowApi } from '../api/learning-workflows.js';
import { getStudentCourses, getStudentCourseChapters, getStudentCourseKnowledgePoints } from '../api/student.js';
import { navigateTo } from '../utils/router.js';
import { renderDashboardLayout } from '../utils/dashboard.js';
import { getUser, getToken } from '../utils/auth.js';
import { showToast } from '../utils/toast.js';
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js';
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
  };
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, user: getUser(), contentHTML: pageHtml() });
  bindPage();
  loadFlows();
  if (state.courseId && state.knowledgePointId) loadRecommendation();
  const pendingFlowId = Number(params.get('flowId'));
  if (Number.isInteger(pendingFlowId) && pendingFlowId > 0) setTimeout(() => openScopeWizard(pendingFlowId), 0);
}

function pageHtml() {
  return `<main class="lf-page">
    <section class="lf-hero">
      <div><p class="lf-eyebrow">PERSONAL LEARNING PATH</p><h1>学习流中心</h1><p>通过系统推荐、教师推荐或自主编排，创建适合自己的学习路径。</p></div>
      <div class="lf-hero-right"><div class="lf-stat"><b id="lf-stat-total">—</b><span>学习流</span></div><div class="lf-stat"><b id="lf-stat-mine">—</b><span>我的学习流</span></div><button class="lf-button primary" id="lf-create">${icon('plus')}新建学习流</button></div>
    </section>
    <section class="lf-recommendation" id="lf-recommendation"><div class="lf-recommendation-icon">${icon('spark', 24)}</div><div class="lf-recommendation-copy"><h2>智能学习推荐</h2><p>选择课程和知识点后，系统会结合你的掌握度为你推荐合适的学习流。</p></div><button class="lf-button secondary" id="lf-choose-context">选择课程与知识点</button></section>
    <section class="lf-toolbar"><div class="lf-tabs" id="lf-tabs"></div><div class="lf-toolbar-actions"><label class="lf-search">${icon('search')}<input id="lf-search" value="${escapeHtml(state.search)}" placeholder="搜索学习流名称"></label><button class="lf-button ghost" id="lf-batch">批量管理</button></div></section>
    <section class="lf-batch-bar" id="lf-batch-bar" hidden></section>
    <section class="lf-grid" id="lf-grid" aria-live="polite"><div class="lf-loading"><i></i>正在加载学习流…</div></section>
  </main>`;
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
    state.loading = false; renderCounts(); renderTabs(); renderGrid();
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
    container.querySelector('#lf-recommend-start')?.addEventListener('click', () => startFlow(result.template?.id, Number(state.courseId), Number(state.knowledgePointId)));
    container.querySelector('#lf-choose-context')?.addEventListener('click', () => openScopeWizard());
  } catch (error) {
    container.innerHTML = `<div class="lf-recommendation-icon">${icon('spark', 24)}</div><div class="lf-recommendation-copy"><h2>智能学习推荐</h2><p>暂时无法加载推荐，可先选择课程和知识点后使用任意学习流。</p></div><button class="lf-button secondary" id="lf-choose-context">重新选择</button>`;
    container.querySelector('#lf-choose-context')?.addEventListener('click', () => openScopeWizard());
  }
}

function renderCounts() {
  document.getElementById('lf-stat-total').textContent = state.counts.all ?? 0;
  document.getElementById('lf-stat-mine').textContent = state.counts.mine ?? 0;
}
function renderTabs() {
  const target = document.getElementById('lf-tabs'); if (!target) return;
  const tabs = [['all', '全部'], ['system', '系统内置'], ['mine', '我的'], ['teacher', '教师推荐']];
  target.innerHTML = tabs.map(([key, label]) => `<button class="lf-tab ${state.tab === key ? 'active' : ''}" data-tab="${key}">${label}<span>${state.counts[key] ?? 0}</span></button>`).join('');
  target.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => setHash({ tab: button.dataset.tab, search: state.search })));
}
function renderGrid() {
  const target = document.getElementById('lf-grid'); if (!target) return;
  if (state.loading) { target.innerHTML = '<div class="lf-loading"><i></i>正在加载学习流…</div>'; return; }
  if (state.error) { target.innerHTML = `<div class="lf-empty"><h3>加载失败</h3><p>${escapeHtml(state.error)}</p><button class="lf-button primary" id="lf-retry">重新加载</button></div>`; target.querySelector('#lf-retry').onclick = loadFlows; return; }
  if (!state.items.length) {
    const message = state.tab === 'teacher' ? '当前课程暂无教师推荐学习流' : state.tab === 'mine' ? '还没有自己的学习流' : '暂无可用学习流';
    target.innerHTML = `<div class="lf-empty"><h3>${message}</h3><p>你可以从系统模板复制，或新建一条适合自己的学习路径。</p>${state.tab === 'mine' ? '<button class="lf-button primary" id="lf-empty-create">新建学习流</button>' : ''}</div>`;
    target.querySelector('#lf-empty-create')?.addEventListener('click', () => openScopeWizard()); return;
  }
  target.innerHTML = state.items.map(flowCard).join('');
  target.querySelectorAll('[data-flow-action]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation(); const { flowAction: action, flowId: id } = button.dataset;
    if (action === 'start') openScopeWizard(Number(id));
    if (action === 'preview') openPreview(Number(id));
    if (action === 'copy') copyFlow(Number(id));
    if (action === 'edit') navigateTo(`#/student/learning-flow/editor/${id}`);
    if (action === 'delete') confirmDelete([Number(id)]);
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
  return `<article class="lf-flow-card" data-flow-id="${flow.template_id}">
    ${state.batchMode && owned ? `<label class="lf-check" title="选择学习流"><input type="checkbox" data-flow-check="${flow.template_id}" ${state.selected.has(flow.template_id) ? 'checked' : ''}><span></span></label>` : ''}
    <header><span class="lf-source ${sourceClass(flow)}">${sourceLabel(flow)}</span><time>${formatDate(flow.updated_at)} 更新</time></header>
    <h3>${escapeHtml(flow.title)}</h3><p class="lf-description">${escapeHtml(flow.description || '尚未填写学习流简介')}</p>
    <div class="lf-node-tags">${tags}${nodes.length > 4 ? `<span class="more">+${nodes.length - 4}</span>` : ''}</div>
    <div class="lf-card-meta"><span>${icon('clock', 14)} ${settings.estimated_minutes || 25} 分钟</span><span>${icon('target', 14)} ${settings.completion_mode === 'flow_complete' ? '按流程完成' : `目标 ${settings.target_mastery || 80}%`}</span></div>
    <div class="lf-card-foot"><small>${nodes.length} 个节点 · 已使用 ${flow.usage_count || 0} 次</small><div class="lf-card-actions"><button class="lf-button compact secondary" data-flow-action="preview" data-flow-id="${flow.template_id}">预览</button><button class="lf-button compact primary" data-flow-action="start" data-flow-id="${flow.template_id}">${icon('play', 13)}学习</button>${owned ? `<button class="lf-icon-button" title="编辑" data-flow-action="edit" data-flow-id="${flow.template_id}">${icon('edit')}</button><button class="lf-icon-button danger" title="删除" data-flow-action="delete" data-flow-id="${flow.template_id}">${icon('trash')}</button>` : `<button class="lf-icon-button" title="复制为我的学习流" data-flow-action="copy" data-flow-id="${flow.template_id}">${icon('copy')}</button>`}</div></div>
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
  document.getElementById('lf-create').addEventListener('click', () => openScopeWizard());
  document.getElementById('lf-choose-context').addEventListener('click', () => openScopeWizard());
  document.getElementById('lf-batch').addEventListener('click', () => { state.batchMode = !state.batchMode; state.selected.clear(); document.getElementById('lf-batch').textContent = state.batchMode ? '完成管理' : '批量管理'; renderGrid(); renderBatchBar(); });
  let timer;
  document.getElementById('lf-search').addEventListener('input', (event) => { clearTimeout(timer); timer = setTimeout(() => setHash({ tab: state.tab, search: event.target.value.trim() }), 260); });
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

async function openScopeWizard(templateId = null) {
  const wizard = { templateId, courseId: state.courseId, knowledgePointId: state.knowledgePointId, chapterId: '', courses: [], chapters: [], points: [], step: 1, method: 'manual', draft: null, loading: false, title: '', description: '', prompt: '', estimatedMinutes: 30, targetMastery: 80, advancing: false, destroyed: false, existingSession: null };
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
    return ['选择课程', '选择知识点', '创建方式'][wizard.step - 1];
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

  function render() {
    if (wizard.destroyed) return;
    const total = templateId ? 3 : 3;
    let body = '';
    if (wizard.loading) body = '<div class="lf-wizard-state"><i></i>正在加载…</div>';
    else if (wizard.step === 1) body = wizard.courses.length ? `<div class="lf-choice-grid">${wizard.courses.map((course) => `<button class="lf-choice ${String(wizard.courseId) === String(course.course_id) ? 'selected' : ''}" data-course="${course.course_id}"><b>${escapeHtml(course.course_name)}</b><span>${escapeHtml(course.course_code || '课程')} · 学习进度 ${course.learning_progress ?? course.progress ?? 0}%</span></button>`).join('')}</div>` : '<div class="lf-wizard-state">暂未加入课程，请先到课程中心加入课程。</div>';
    else if (wizard.step === 2) { const visiblePoints = wizard.chapterId ? wizard.points.filter((point) => String(point.chapter_id) === String(wizard.chapterId)) : wizard.points; body = `<div class="lf-chapter-filter"><button class="${!wizard.chapterId ? 'selected' : ''}" data-chapter="">全部章节</button>${wizard.chapters.map((chapter) => `<button class="${String(wizard.chapterId) === String(chapter.chapter_id) ? 'selected' : ''}" data-chapter="${chapter.chapter_id}">${escapeHtml(chapter.chapter_name)}</button>`).join('')}</div><label class="lf-wizard-search">${icon('search')}<input id="lf-point-search" placeholder="搜索知识点"></label><div class="lf-point-list">${visiblePoints.map((point) => `<button class="lf-point ${String(wizard.knowledgePointId) === String(point.knowledge_point_id) ? 'selected' : ''}" data-point="${point.knowledge_point_id}"><span><b>${escapeHtml(point.knowledge_point_name)}</b><small>${escapeHtml(point.chapter_name || '未分章节')} · ${escapeHtml(point.knowledge_point_code || '')}</small></span><em>掌握度 ${Math.round(point.mastery_score || 0)}%</em></button>`).join('') || '<div class="lf-wizard-state">该章节暂无可选知识点。</div>'}</div>`; }
    else if (wizard.step === 3 && templateId) body = renderStep3ForStart();
    else body = createMethodHtml(wizard);

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
    } else {
      // Step 3 for "new flow"
      footer = `<button class="lf-button secondary" data-close>取消</button><button class="lf-button ghost" data-back>上一步</button><button class="lf-button primary" data-next>${wizard.method === 'ai' ? '生成预览' : '进入编辑器'}</button>`;
    }

    host.innerHTML = `<header class="lf-modal-head"><div><span class="lf-wizard-step">步骤 ${wizard.step}/${total}</span><h2>${stepTitle()}</h2><p>${templateId ? '为本次学习确定课程与知识点。' : '新建流程只会在最后保存时写入数据库。'}</p></div><button class="lf-icon-button" data-close>${icon('close')}</button></header><div class="lf-modal-body">${body}</div><footer class="lf-modal-foot">${footer}</footer>`;

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
function createMethodHtml(wizard) {
  return `<div class="lf-methods"><button class="lf-method ${wizard.method === 'manual' ? 'selected' : ''}" data-method="manual"><b>手动编排</b><span>从空白画布开始，按需拖入九类学习节点。</span></button><button class="lf-method ${wizard.method === 'ai' ? 'selected' : ''}" data-method="ai"><b>${icon('spark', 15)} AI 智能生成</b><span>根据课程、知识点、掌握度和偏好生成可编辑的结构化流程。</span></button></div><label class="lf-field">学习流名称<input id="lf-new-title" maxlength="200" value="${escapeHtml(wizard.title)}" placeholder="例如：逻辑回归薄弱点修复"></label><label class="lf-field">学习流简介<textarea id="lf-new-description" maxlength="1000" placeholder="说明本次学习的目标（可选）">${escapeHtml(wizard.description)}</textarea></label>${wizard.method === 'ai' ? `<label class="lf-field">学习需求<textarea id="lf-ai-prompt" placeholder="例如：先通过例题理解逻辑回归，再练习，答错后修复，最后判断掌握度。">${escapeHtml(wizard.prompt)}</textarea></label><div class="lf-wizard-settings"><label>预计时长<input id="lf-ai-minutes" type="number" min="5" max="120" value="${wizard.estimatedMinutes}"> 分钟</label><label>目标掌握度<input id="lf-ai-mastery" type="number" min="60" max="100" value="${wizard.targetMastery}"> %</label></div>` : ''}`;
}
function rememberMethodFields(host, wizard) { wizard.title = host.querySelector('#lf-new-title')?.value || wizard.title; wizard.description = host.querySelector('#lf-new-description')?.value || wizard.description; wizard.prompt = host.querySelector('#lf-ai-prompt')?.value || wizard.prompt; wizard.estimatedMinutes = Number(host.querySelector('#lf-ai-minutes')?.value) || wizard.estimatedMinutes; wizard.targetMastery = Number(host.querySelector('#lf-ai-mastery')?.value) || wizard.targetMastery; }
function readWizardSettings(host) { return { completion_mode: 'mastery_target', target_mastery: Number(host.querySelector('#lf-ai-mastery')?.value) || 80, adjustment_mode: 'ask_before_adjust', estimated_minutes: Number(host.querySelector('#lf-ai-minutes')?.value) || 30 }; }
async function generateAiPreview(wizard, host, close) {
  const title = host.querySelector('#lf-new-title')?.value.trim(); const prompt = host.querySelector('#lf-ai-prompt')?.value.trim();
  const description = host.querySelector('#lf-new-description')?.value.trim() || '';
  const wizardSettings = readWizardSettings(host);
  if (!title || !prompt) { showToast('请填写学习流名称和学习需求', 'warning'); return; }
  const button = host.querySelector('[data-next]'); button.disabled = true; button.textContent = '正在生成…';
  try {
    const result = responseData(await learningWorkflowApi.generateDraft({ inputText: prompt, courseId: Number(wizard.courseId), knowledgePointId: Number(wizard.knowledgePointId) })); const draft = result.draft;
    if (!isSupportedGraph(draft?.graph)) throw new Error('AI 返回的学习流结构无效，请重试或改用手动编排');
    const overview = draft.graph.nodes.map((node) => `<li>${escapeHtml(getNodeType(node.type)?.label || node.type)}<span>${escapeHtml(node.title || '')}</span></li>`).join('');
    host.innerHTML = `<header class="lf-modal-head"><div><span class="lf-wizard-step">AI 预览</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(result.matchedReason || '已生成可编辑学习流')}</p></div><button class="lf-icon-button" data-close>${icon('close')}</button></header><div class="lf-modal-body"><ol class="lf-preview-path">${overview}</ol><p class="lf-ai-note">确认后才会创建正式学习流；生成失败时可返回改为手动编排。</p></div><footer class="lf-modal-foot"><button class="lf-button secondary" data-close>取消</button><button class="lf-button ghost" data-manual>改用手动编排</button><button class="lf-button primary" data-save-ai>使用此流程</button></footer>`;
    host.querySelector('[data-close]').onclick = close;
    host.querySelector('[data-manual]').onclick = () => { sessionStorage.setItem(FLOW_DRAFT_STORAGE_KEY, JSON.stringify({ title, courseId: Number(wizard.courseId), knowledgePointId: Number(wizard.knowledgePointId), description, settings: wizardSettings })); close(); navigateTo('#/student/learning-flow/editor/new'); };
    host.querySelector('[data-save-ai]').onclick = async (event) => { event.currentTarget.disabled = true; event.currentTarget.textContent = '正在保存…'; try { const created = responseData(await learningWorkflowApi.createTemplate({ title, description: description || prompt, course_id: Number(wizard.courseId), knowledge_point_id: Number(wizard.knowledgePointId), graph_json: draft.graph, settings_json: draft.settings })); close(); navigateTo(`#/student/learning-flow/editor/${created.template_id}`); } catch (error) { event.currentTarget.disabled = false; event.currentTarget.textContent = '使用此流程'; showToast(error.message || '保存失败', 'error'); } };
  } catch (error) { button.disabled = false; button.textContent = '重新生成'; showToast(error.message || 'AI 生成失败，可改用手动编排', 'error'); }
}
async function startFlow(templateId, courseId, knowledgePointId, done) {
  if (!templateId) { showToast('没有可用的学习流模板', 'warning'); return; }
  try { const result = responseData(await learningWorkflowApi.quickStart({ templateId, courseId, knowledgePointId })); const session = result.session; if (!session?.session_id) throw new Error('学习会话创建失败'); done?.(); navigateTo(`#/student/learning/session/${session.session_id}`); } catch (error) { showToast(error.message || '无法开始学习', 'error'); }
}
