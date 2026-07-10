// 学习驾驶舱 v4 — DisciMind 学生端
// 架构：DeepSeek 引导老师 + Dify 教学 Agent 并行执行
// 核心改进：JSON 解析渲染、统一状态管理、事件委托、语句块引导

import { learningWorkflowApi } from '../api/learning-workflows.js';
import { explainerApi } from '../api/agent.js';
import { streamLearningGuide } from '../api/learning-guide.js';
import { apiUrl, authFetchOptions } from '../api/stream-request.js';
import { navigateTo } from '../utils/router.js';
import { renderDashboardLayout } from '../utils/dashboard.js';
import { getUser, getToken } from '../utils/auth.js';
import { showToast } from '../utils/toast.js';
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js';
import { getNodeType } from '../config/learning-flow.js';
import { normalizeLearningAgentResult, getSectionConfig } from '../utils/learning-agent-result.js';
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js';

// ========================
// 常量
// ========================

const NODE_LABELS = {
  concept_explanation: '概念讲解', analogy_explanation: '类比讲解',
  worked_example_analysis: '例题分析', socratic_questioning: '苏格拉底提问',
  basic_practice: '基础练习', adaptive_practice: '自适应练习',
  wrong_question_repair: '错题修复', mastery_gate: '掌握度判断',
  learning_summary: '学习总结',
};

const PHASE = {
  IDLE: 'idle', LOADING: 'loading', PREPARING: 'preparing',
  REQUESTING: 'requesting', HTTP_CONNECTED: 'http_connected',
  STREAMING: 'streaming', COMPLETED: 'completed', FAILED: 'failed',
  PAUSED: 'paused',
};

// ========================
// 统一状态
// ========================

let state = null;
let guideAbortCtrl = null;
let formalAbortCtrl = null;
let guideActive = false;
let formalActive = false;
let currentRequestId = null;

function initState(sessionId) {
  return {
    sessionId,
    nodeId: null,
    sessionPhase: 'LOADING',
    guide: { phase: PHASE.IDLE, requestId: '', blocks: [], error: null },
    formalAgent: {
      phase: PHASE.IDLE, requestId: '', agentName: '', agentType: '',
      workflowConnected: false, result: null, resultAnswer: null,
      error: null,
      // Timer state machine
      startedAtMs: null,
      completedAtMs: null,
      pausedAtMs: null,
      elapsedMs: 0,
      timerId: null,
    },
    action: { type: null, submitting: false },
    nodeRuns: [],
    execution: { nodeId: null, nodeRunId: null, version: 0, requestVersion: 0, invalidated: false },
  };
}

let executionSequence = 0;
function beginExecution(node) {
  const currentRun = S?.currentNodeRun || (S?.node_runs || []).find((run) => (
    String(run.node_id) === String(node.id) && ['PENDING', 'RUNNING'].includes(run.status)
  ));
  const execution = {
    nodeId: String(node.id),
    nodeRunId: currentRun?.node_run_id || null,
    version: currentRun?.execution_version || 1,
    requestVersion: ++executionSequence,
    invalidated: false,
  };
  state.execution = execution;
  return execution;
}

function invalidateExecution() {
  if (state?.execution) state.execution.invalidated = true;
}

function isExecutionCurrent(execution) {
  return Boolean(state && execution && !execution.invalidated
    && state.sessionId === Number(S?.session_id || state.sessionId)
    && state.execution?.requestVersion === execution.requestVersion
    && String(state.nodeId) === String(execution.nodeId));
}

function applySessionSnapshot(snapshot) {
  if (!snapshot) return;
  S = snapshot.data || snapshot;
  state.sessionPhase = S.status;
  state.nodeRuns = S.node_runs || [];
}

function setGuidePhase(phase, info = {}) {
  if (!state) return;
  state.guide = { ...state.guide, phase, ...info };
  renderGuideStatus();
}

function setFormalPhase(phase, info = {}) {
  if (!state) return;
  const fa = state.formalAgent;
  const prevPhase = fa.phase;

  // Timer management
  if (info.startedAtMs !== undefined) {
    fa.startedAtMs = info.startedAtMs;
  } else if (info.startedAt !== undefined) {
    fa.startedAtMs = info.startedAt;
  }

  if (info.completedAtMs !== undefined) {
    fa.completedAtMs = info.completedAtMs;
  } else if (info.completedAt !== undefined) {
    fa.completedAtMs = info.completedAt;
  }

  // Transition TO an active phase → start timer
  if (phase === PHASE.PREPARING || phase === PHASE.REQUESTING ||
      phase === PHASE.HTTP_CONNECTED || phase === PHASE.STREAMING) {
    if (!fa.startedAtMs) {
      fa.startedAtMs = Date.now();
    }
    if (prevPhase !== phase && prevPhase !== PHASE.PREPARING &&
        prevPhase !== PHASE.REQUESTING && prevPhase !== PHASE.HTTP_CONNECTED &&
        prevPhase !== PHASE.STREAMING) {
      startFormalAgentTimer();
    }
  }

  // Transition TO completed/failed/paused → stop timer
  if (phase === PHASE.COMPLETED || phase === PHASE.FAILED) {
    if (!fa.completedAtMs) {
      fa.completedAtMs = Date.now();
    }
    clearFormalAgentTimer();
    if (fa.startedAtMs) {
      fa.elapsedMs = fa.completedAtMs - fa.startedAtMs;
    }
    renderAgentStatus();
  }

  state.formalAgent = { ...fa, phase, ...info };
  renderAgentStatus();
  updateActionButtons();
}

function setAction(type, submitting) {
  if (!state) return;
  state.action = { type, submitting };
  updateActionButtons();
}

// ========================
// 入口
// ========================

export function renderStudentLearningSession(app, params) {
  const sessionId = Number(params.sessionId);
  const user = getUser();
  sessionEventCleanup?.();
  sessionEventCleanup = null;
  state = initState(sessionId);

  const html = buildPageShell();
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: html, user });

  setTimeout(() => bindEvents(), 50);
  initSession(sessionId);
}

function buildPageShell() {
  return `<div class="lws-page" id="lws-page">
    <div class="lws-sticky-shell" id="lws-sticky-shell">
      <div class="lws-topbar" id="lws-topbar">
        <button class="lws-back-btn" data-learning-action="return">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>返回学习流中心
        </button>
        <div class="lws-topbar-info">
          <h2 class="lws-flow-title" id="lws-flow-title">加载中…</h2>
          <div class="lws-topbar-meta">
            <span id="lws-course-name">—</span><span class="lws-dot">·</span>
            <span id="lws-kp-name">—</span><span class="lws-dot">·</span>
            <span id="lws-node-progress">节点 —/—</span>
          </div>
        </div>
        <div class="lws-topbar-right">
          <span class="lws-save-status" id="lws-save-status"></span>
          <span class="lws-agent-badge" id="lws-agent-badge" style="display:none"></span>
          <button class="lws-btn lws-btn-outline lws-btn-sm" data-learning-action="pause" id="lws-pause-btn">暂停</button>
        </div>
      </div>
      <div class="lws-progress-nav" id="lws-progress-nav" style="display:none"></div>
    </div>
    <div class="lws-main" id="lws-main">
      <div class="lws-skeleton" id="lws-skeleton">
        <div class="lws-skel-topbar"></div>
        <div class="lws-skel-card"><div class="lws-skel-line w60"></div><div class="lws-skel-line w80"></div><div class="lws-skel-line w40"></div></div>
        <div class="lws-skel-card"><div class="lws-skel-line w50"></div><div class="lws-skel-line w90"></div><div class="lws-skel-line w30"></div></div>
      </div>
      <div class="lws-kp-overview" id="lws-kp-overview" style="display:none"></div>
      <div class="lws-guide-panel" id="lws-guide-panel" style="display:none">
        <div class="lws-guide-header">
          <span class="lws-guide-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </span>
          <span class="lws-guide-name">学习引导老师</span>
          <span class="lws-guide-status" id="lws-guide-status"></span>
        </div>
        <div class="lws-guide-blocks" id="lws-guide-blocks"></div>
      </div>
      <div class="lws-agent-status-bar" id="lws-agent-status-bar" style="display:none"></div>
       <div class="lws-content-area" id="lws-content-area" style="display:none">
         <div class="lws-node-history" id="lws-node-history"></div>
         <div class="lws-teaching-result" id="lws-teaching-result"></div>
      </div>
      <div class="lws-error-state" id="lws-error-state" style="display:none"></div>
      <div class="lws-paused-state" id="lws-paused-state" style="display:none"></div>
    </div>
    <div class="lws-bottom-bar" id="lws-bottom-bar" style="display:none">
      <button class="lws-btn lws-btn-ghost" data-learning-action="retry" id="lws-btn-retry" style="display:none">重新尝试</button>
      <div class="lws-bottom-spacer"></div>
      <button class="lws-btn lws-btn-outline" data-learning-action="skip" id="lws-btn-skip">跳过</button>
      <button class="lws-btn lws-btn-primary" data-learning-action="next" id="lws-btn-next" disabled>等待完成…</button>
    </div>
    <div class="lws-modal-overlay" id="lws-modal-overlay" style="display:none">
      <div class="lws-modal" id="lws-modal"></div>
    </div>
  </div>`;
}

// ========================
// 事件委托（DOM-dataset 守卫，只绑定一次）
// ========================

let sessionEventCleanup = null;

function bindEvents() {
  const root = document.getElementById('lws-page');
  if (!root) return;

  // DOM-dataset guard — survives module-level flag issues after re-renders
  if (root.dataset.learningEventsBound === 'true') return;
  root.dataset.learningEventsBound = 'true';

  const handler = async (e) => {
    const actionEl = e.target.closest('[data-learning-action]');
    if (!actionEl) return;
    // Only handle events inside the session root
    if (!root.contains(actionEl)) return;

    const action = actionEl.dataset.learningAction;

    // Synchronous lock check — prevent any action while another is in flight
    if (state && state.action.submitting && action !== 'return') {
      // Don't spam toasts for every duplicate click — dedup handles this
      showToast('操作进行中，请稍候', 'warning');
      return;
    }

    switch (action) {
      case 'pause': await handlePauseResume(); break;
      case 'next': await handleNext(); break;
      case 'skip': await handleSkip(); break;
      case 'retry': await handleRetry(); break;
      case 'return': await handleReturn(); break;
    }
  };

  root.addEventListener('click', handler);

  // Modal overlay — bind once per DOM, use named function for cleanup
  const modalOverlay = document.getElementById('lws-modal-overlay');
  const modalClickHandler = (e) => {
    if (e.target === e.currentTarget) closeModal();
  };
  if (modalOverlay) {
    modalOverlay.addEventListener('click', modalClickHandler);
  }

  // beforeunload cleanup
  const beforeUnloadHandler = () => cleanup();
  window.addEventListener('beforeunload', beforeUnloadHandler);

  sessionEventCleanup = () => {
    root.removeEventListener('click', handler);
    delete root.dataset.learningEventsBound;
    if (modalOverlay) {
      modalOverlay.removeEventListener('click', modalClickHandler);
    }
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    cleanup();
  };
}

function cleanup() {
  invalidateExecution();
  // Abort active requests
  if (guideAbortCtrl) { guideAbortCtrl.abort(); guideAbortCtrl = null; }
  if (formalAbortCtrl) { formalAbortCtrl.abort(); formalAbortCtrl = null; }
  guideActive = false;
  formalActive = false;

  // Clear all timers
  clearFormalAgentTimer();
  clearGuideTimer();

  // Clear sticky observer
  if (stickyObserver) { stickyObserver.disconnect(); stickyObserver = null; }
  const sentinel = document.getElementById('lws-sticky-sentinel');
  if (sentinel) sentinel.remove();
}

// Timer cleanup helpers
let guideTimerId = null;
function clearGuideTimer() {
  if (guideTimerId) { clearInterval(guideTimerId); guideTimerId = null; }
}

function clearFormalAgentTimer() {
  if (state && state.formalAgent && state.formalAgent.timerId) {
    clearInterval(state.formalAgent.timerId);
    state.formalAgent.timerId = null;
  }
}

function abortBoth() {
  invalidateExecution();
  if (guideAbortCtrl) { guideAbortCtrl.abort(); guideAbortCtrl = null; }
  if (formalAbortCtrl) { formalAbortCtrl.abort(); formalAbortCtrl = null; }
  guideActive = false;
  formalActive = false;
}

function clearNodeTimers() {
  // Clear any pending timeouts attached to the current node
  // (guide block animation timers, etc.)
  // The highest timeout ID is tracked implicitly; we use a brute-force approach
  // for small ID ranges commonly used by setTimeout in this module.
  for (let i = 1; i < 1000; i++) {
    clearTimeout(i);
  }
}

function resetCurrentNodeState() {
  // Reset formal agent state but preserve guide blocks
  // Guide blocks are saved per-node and restored from DB on refresh
  state.formalAgent = {
    phase: PHASE.IDLE, requestId: '', agentName: '', agentType: '',
    workflowConnected: false, result: null, resultAnswer: null,
    error: null, startedAtMs: null, completedAtMs: null,
    elapsedMs: 0, timerId: null,
  };
  currentRequestId = null;

  clearFormalAgentTimer();

  const teachingEl = document.getElementById('lws-teaching-result');
  if (teachingEl) teachingEl.innerHTML = '';

  hideEl('lws-agent-status-bar');
  updateActionButtons();
}

function archiveCurrentWorkspace(node, label = '已完成') {
  const source = document.getElementById('lws-teaching-result');
  const history = document.getElementById('lws-node-history');
  if (!source || !history || !source.childElementCount) return;
  const nodeId = String(node?.id || state?.nodeId || 'unknown');
  if ([...history.children].some((item) => item.dataset.historyNode === nodeId)) return;
  const details = document.createElement('details');
  details.className = 'lws-history-card';
  details.dataset.historyNode = nodeId;
  details.innerHTML = `<summary>${escHtml(node?.title || NODE_LABELS[node?.type] || '已完成节点')} · ${escHtml(label)}</summary>`;
  const content = document.createElement('div');
  content.className = 'lws-history-content';
  content.innerHTML = source.innerHTML;
  details.appendChild(content);
  history.appendChild(details);
}

function restorePersistedHistory() {
  const history = document.getElementById('lws-node-history');
  if (!history || !Array.isArray(S?.completedTrainerHistory)) return;
  const graphNodes = S.runtime_graph_json?.nodes || [];
  for (const item of S.completedTrainerHistory) {
    if (!item.trainer || [...history.children].some((el) => el.dataset.historyNode === String(item.nodeId))) continue;
    const node = graphNodes.find((candidate) => String(candidate.id) === String(item.nodeId));
    const questions = (item.trainer.completedQuestions || []).map((entry, index) => {
      const question = entry.question || {};
      const answer = entry.answerResult || {};
      return `<article class="lws-timeline-card"><div class="lws-timeline-card-header"><span class="lws-timeline-badge question">第 ${index + 1} 题</span><span class="lws-timeline-badge ${answer.isCorrect ? 'correct' : 'incorrect'}">${answer.isCorrect ? '正确' : '错误'}</span></div><div class="lws-timeline-card-body"><div class="lws-question-stem">${escHtml(question.stem || '')}</div><p>你的答案：${escHtml(answer.selectedOption || '')}</p><p>正确答案：${escHtml(answer.correctOption || '')}</p>${answer.explanation ? `<p class="lws-eval-analysis">${escHtml(answer.explanation)}</p>` : ''}</div></article>`;
    }).join('');
    const details = document.createElement('details');
    details.className = 'lws-history-card';
    details.dataset.historyNode = String(item.nodeId);
    details.innerHTML = `<summary>${escHtml(node?.title || '应用练习')} · ${item.status === 'SKIPPED' ? '已跳过' : '已完成'}</summary><div class="lws-history-content">${questions || '<p>该练习尚无已提交题目。</p>'}</div>`;
    history.appendChild(details);
  }
}

// ========================
// 会话初始化
// ========================

let S = null, knowledgePointData = null;

async function initSession(sessionId) {
  try {
    let res;
    try { res = await learningWorkflowApi.getSession(sessionId); } catch {
      res = await learningWorkflowApi.getSession(sessionId);
    }
    S = res.data || res;
    if (!S) { showGlobalError('会话加载失败', true); return; }

    state.sessionId = sessionId;
    state.sessionPhase = S.status;
    state.nodeId = S.current_node_id;
    state.nodeRuns = S.node_runs || [];

    updateTopbar();
    hideSkeleton();
    renderProgressNav();
    renderKnowledgePointOverview();
    restorePersistedHistory();

    // 恢复已有的 guide 内容
    restoreGuideFromNodeRun();

    if (S.status === 'PAUSED') { showPaused(); return; }
    if (S.status === 'COMPLETED') { navigateTo('#/student/learning/session/' + sessionId + '/summary'); return; }
    if (S.status === 'CREATED') {
      const started = await learningWorkflowApi.startSession(sessionId);
      applySessionSnapshot(started);
      state.sessionPhase = 'RUNNING';
      state.nodeId = S.current_node_id;
    }

    await loadKnowledgePointData();
    await execCurrentNode(sessionId);
  } catch (e) {
    showGlobalError('加载失败: ' + escHtml(e.message || ''), true);
  }
}

async function loadKnowledgePointData() {
  if (!S || !S.knowledge_point_id) return;
  try {
    const r = await fetch(apiUrl(`/student/knowledge-points/${S.knowledge_point_id}`), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (r.ok) { const data = await r.json(); knowledgePointData = data.data || data; }
  } catch { /* non-critical */ }
}

function restoreGuideFromNodeRun() {
  if (!state || !state.nodeId) return;
  // Search ALL node runs for current node, not just completed ones
  const nodeRun = (S.node_runs || []).find(r => String(r.node_id) === String(state.nodeId));
  if (!nodeRun) return;

  const output = (nodeRun.output_summary_json && typeof nodeRun.output_summary_json === 'object')
    ? nodeRun.output_summary_json
    : (typeof nodeRun.output_summary_json === 'string'
      ? (() => { try { return JSON.parse(nodeRun.output_summary_json); } catch { return {}; } })()
      : {});

  const guide = output.guide;
  if (guide && guide.blocks && guide.blocks.length > 0) {
    // Normalize blocks: backend may store as {index, text} without blockId
    const blocks = guide.blocks.map((b, i) => ({
      index: b.index || i + 1,
      text: b.text || '',
      blockId: b.blockId || `guide-block-${b.index || i + 1}`,
    }));
    state.guide = {
      phase: S.status === 'PAUSED' ? PHASE.PAUSED : PHASE.COMPLETED,
      requestId: guide.requestId || '',
      blocks,
      error: null,
    };
    renderGuideBlocks(blocks, true);
    showGuidePanel();
    setGuidePhase(state.guide.phase, { blocks });
  }
}

// ========================
// UI 渲染
// ========================

// IntersectionObserver for sticky shell
let stickyObserver = null;

function initStickyObserver() {
  if (stickyObserver) stickyObserver.disconnect();
  const shell = document.getElementById('lws-sticky-shell');
  if (!shell) return;

  // Use a sentinel placed right after the sticky shell
  const sentinel = document.createElement('div');
  sentinel.id = 'lws-sticky-sentinel';
  sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;pointer-events:none';
  shell.parentNode.insertBefore(sentinel, shell);

  stickyObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        shell.classList.remove('is-stuck');
      } else {
        shell.classList.add('is-stuck');
      }
    },
    { threshold: [0] }
  );

  stickyObserver.observe(sentinel);
}

function updateTopbar() {
  if (!S) return;
  setText('lws-flow-title', S.workflow_template?.title || '学习会话');
  setText('lws-course-name', S.course?.course_name || '—');
  setText('lws-kp-name', S.knowledge_point?.knowledge_point_name || '—');
  const graph = S.runtime_graph_json || {};
  const total = (graph.nodes || []).length;
  const completed = S.completedNodeCount || 0;
  setText('lws-node-progress', `节点 ${completed + 1}/${total}`);
}

function hideSkeleton() {
  hideEl('lws-skeleton');
  showEl('lws-progress-nav');
  showEl('lws-bottom-bar');
  showEl('lws-kp-overview');
  initStickyObserver();
}

function renderProgressNav() {
  const el = document.getElementById('lws-progress-nav');
  if (!el || !S) return;
  showEl('lws-progress-nav');
  const graph = S.runtime_graph_json || {};
  const nodes = graph.nodes || [];
  const nodeRuns = S.node_runs || [];
  const completedIds = new Set(nodeRuns.filter(r => r.status === 'COMPLETED' || r.status === 'SKIPPED').map(r => r.node_id));
  const failedIds = new Set(nodeRuns.filter(r => r.status === 'FAILED').map(r => r.node_id));

  el.innerHTML = `<div class="lws-progress-track">${nodes.map((node, i) => {
    let cls = 'lws-progress-node';
    if (node.id === S.current_node_id) cls += ' current';
    else if (completedIds.has(node.id)) {
      const skipped = nodeRuns.find(r => r.node_id === node.id && r.status === 'SKIPPED');
      cls += skipped ? ' skipped' : ' completed';
    } else if (failedIds.has(node.id)) cls += ' failed';
    else cls += ' waiting';

    const info = getNodeType(node.type);
    return `<div class="${cls}" title="${escAttr(node.title || NODE_LABELS[node.type] || node.type)}">
      <span class="lws-progress-dot">${i + 1}</span>
      <span class="lws-progress-label">${escHtml(node.title || NODE_LABELS[node.type] || node.type)}</span>
      <span class="lws-progress-agent">${escHtml(info?.agent || '')}</span>
    </div>`;
  }).join('')}</div>`;
}

function renderKnowledgePointOverview() {
  const el = document.getElementById('lws-kp-overview');
  if (!el || !S) return;
  showEl('lws-kp-overview');
  const kpName = S.knowledge_point?.knowledge_point_name || '知识点';
  const courseName = S.course?.course_name || '—';
  const chapterName = knowledgePointData?.chapter?.chapter_name || '—';
  const mastery = S.mastery_current != null ? Math.round(S.mastery_current) : null;

  const graph = S.runtime_graph_json || {};
  const node = (graph.nodes || []).find(n => n.id === S.current_node_id);
  const nodeLabel = node ? (node.title || NODE_LABELS[node.type] || node.type) : '—';
  const info = node ? getNodeType(node.type) : null;

  let defHtml = '';
  if (knowledgePointData?.definition) {
    defHtml = `<div class="lws-kp-definition"><span class="lws-kp-label">定义</span><p>${escHtml(knowledgePointData.definition)}</p></div>`;
  }

  el.innerHTML = `<div class="lws-kp-card">
    <div class="lws-kp-header"><span class="lws-kp-tag">知识点概览</span><h3>${escHtml(kpName)}</h3></div>
    <div class="lws-kp-meta"><span>课程: ${escHtml(courseName)}</span><span>章节: ${escHtml(chapterName)}</span>${mastery != null ? `<span>当前掌握度: <b>${mastery}%</b></span>` : ''}</div>
    ${defHtml}
    <div class="lws-kp-current-task"><span class="lws-kp-label">当前节点</span>
      <div class="lws-kp-task-info"><span class="lws-kp-task-name">${escHtml(nodeLabel)}</span><span class="lws-kp-task-type">${escHtml(info?.label || '')}</span></div>
      <p class="lws-kp-task-goal">${escHtml(node?.description || `完成 ${nodeLabel}`)}</p>
    </div>
  </div>`;
}

// ========================
// 引导面板
// ========================

function showGuidePanel() {
  showEl('lws-guide-panel');
}

function renderGuideBlocks(blocks, isRestore = false) {
  const el = document.getElementById('lws-guide-blocks');
  if (!el) return;
  showGuidePanel();

  for (const block of blocks) {
    const blockId = block.blockId || `guide-block-${block.index}`;
    const existingEl = document.getElementById(blockId);
    if (existingEl) continue;

    const guideEl = document.createElement('div');
    guideEl.className = 'lws-guide-block';
    guideEl.id = blockId;
    guideEl.innerHTML = `<div class="lws-guide-bubble">${escHtml(block.text)}</div>`;
    el.appendChild(guideEl);

    if (isRestore) {
      // Restore: show immediately, no animation delay
      guideEl.classList.add('lws-guide-block-visible');
    } else {
      // Live streaming: use short staggered animation (180-280ms per block)
      const delay = Math.min((block.index - 1) * 220, 280);
      setTimeout(() => {
        guideEl.classList.add('lws-guide-block-visible');
      }, delay);
    }

    el.scrollTop = el.scrollHeight;
  }
}

function renderGuideStatus() {
  const el = document.getElementById('lws-guide-status');
  if (!el) return;
  const guide = state?.guide;
  if (!guide) return;

  if (guide.phase === PHASE.STREAMING) {
    el.textContent = '正在引导学习';
    el.className = 'lws-guide-status active';
  } else if (guide.phase === PHASE.COMPLETED) {
    el.textContent = '引导完成';
    el.className = 'lws-guide-status completed';
  } else if (guide.error) {
    el.textContent = '引导暂不可用';
    el.className = 'lws-guide-status error';
  } else {
    el.textContent = '';
    el.className = 'lws-guide-status';
  }
}

// ========================
// Agent 状态栏
// ========================

function renderAgentStatus() {
  const el = document.getElementById('lws-agent-status-bar');
  if (!el) return;
  const fa = state?.formalAgent;
  if (!fa || fa.phase === PHASE.IDLE) { hideEl('lws-agent-status-bar'); return; }
  showEl('lws-agent-status-bar');

  const phaseLabels = {
    [PHASE.PREPARING]: '正在准备学习上下文',
    [PHASE.REQUESTING]: '正在连接教学 Agent',
    [PHASE.HTTP_CONNECTED]: 'Agent 已响应',
    [PHASE.STREAMING]: '正在接收教学内容',
    [PHASE.COMPLETED]: '内容生成完成',
    [PHASE.FAILED]: 'Agent 执行失败',
  };

  const phaseLabel = phaseLabels[fa.phase] || fa.phase;
  let elapsedHtml = '';

  // Use state machine: if timer is active, elapsedMs is updated by interval
  if (fa.phase === PHASE.COMPLETED && fa.completedAtMs && fa.startedAtMs) {
    const elapsed = ((fa.completedAtMs - fa.startedAtMs) / 1000).toFixed(1);
    elapsedHtml = `<span class="lws-agent-elapsed">生成耗时 ${elapsed} 秒</span>`;
  } else if (fa.phase === PHASE.FAILED && fa.startedAtMs) {
    const elapsed = ((fa.completedAtMs || Date.now()) - fa.startedAtMs) / 1000;
    elapsedHtml = `<span class="lws-agent-elapsed">失败前已等待 ${elapsed.toFixed(1)} 秒</span>`;
  } else if (fa.phase === PHASE.PAUSED && fa.elapsedMs > 0) {
    elapsedHtml = `<span class="lws-agent-elapsed">已暂停，本次已运行 ${(fa.elapsedMs / 1000).toFixed(1)} 秒</span>`;
  } else if (fa.startedAtMs && fa.phase !== PHASE.COMPLETED && fa.phase !== PHASE.FAILED) {
    // Timer is active — elapsedMs is updated by the interval tick
    const elapsed = fa.elapsedMs > 0 ? (fa.elapsedMs / 1000).toFixed(1) : '0.0';
    elapsedHtml = `<span class="lws-agent-elapsed">已等待 ${elapsed} 秒</span>`;
  }

  el.innerHTML = `<div class="lws-agent-status-inner ${fa.phase}">
    <span class="lws-agent-name">${escHtml(fa.agentName || '教学 Agent')}</span>
    <span class="lws-agent-state-label">${phaseLabel}</span>
    ${elapsedHtml}
    ${fa.requestId ? `<span class="lws-agent-reqid">${escHtml(String(fa.requestId).slice(-8))}</span>` : ''}
  </div>`;
}

function startFormalAgentTimer() {
  clearFormalAgentTimer();
  if (!state) return;
  state.formalAgent.timerId = setInterval(() => {
    if (!state || !state.formalAgent.startedAtMs) return;
    if (state.formalAgent.phase === PHASE.COMPLETED || state.formalAgent.phase === PHASE.FAILED) {
      clearFormalAgentTimer();
      return;
    }
    state.formalAgent.elapsedMs = Date.now() - state.formalAgent.startedAtMs;
    renderAgentStatus();
  }, 200);
}

function stopFormalAgentTimer(finalElapsedMs) {
  clearFormalAgentTimer();
  if (state && state.formalAgent) {
    state.formalAgent.elapsedMs = finalElapsedMs;
  }
}

function updateActionButtons() {
  if (!state) return;

  const nextBtn = document.getElementById('lws-btn-next');
  const skipBtn = document.getElementById('lws-btn-skip');
  const retryBtn = document.getElementById('lws-btn-retry');
  const fa = state.formalAgent;
  const submitting = state.action.submitting;

  // Next button
  if (nextBtn) {
    nextBtn.disabled = submitting;
    if (fa.phase === PHASE.FAILED) {
      nextBtn.disabled = true;
      nextBtn.textContent = '请先处理错误';
    } else if (fa.phase === PHASE.COMPLETED) {
      nextBtn.disabled = submitting;
      nextBtn.textContent = '继续下一步';
    } else if (submitting) {
      nextBtn.textContent = '处理中…';
    } else {
      nextBtn.disabled = true;
      nextBtn.textContent = '等待完成…';
    }
  }

  // Skip button
  if (skipBtn) {
    skipBtn.disabled = submitting || fa.phase === PHASE.COMPLETED;
  }

  // Retry button
  if (retryBtn) {
    const showRetry = fa.phase === PHASE.FAILED && fa.error?.retryable !== false;
    retryBtn.style.display = showRetry ? '' : 'none';
    retryBtn.disabled = submitting;
  }
}

// ========================
// 节点执行（核心）
// ========================

async function execCurrentNode(sessionId) {
  if (!S || !S.current_node_id) {
    // No current node — try completing the session
    await completeAndGo(sessionId);
    return;
  }

  const graph = S.runtime_graph_json || {};
  const node = (graph.nodes || []).find(n => String(n.id) === String(S.current_node_id));
  if (!node) {
    console.error('[LearningSession] Node not found in graph: ' + S.current_node_id);
    showToast('节点数据异常，请返回学习流中心', 'error');
    return;
  }
  state.nodeId = String(node.id);
  const execution = beginExecution(node);

  // Check if already completed (has output content we can restore)
  const existingRun = (S.node_runs || []).find(
    r => String(r.node_id) === String(node.id) && r.status === 'COMPLETED'
  );

  // If completed with valid output, just restore display
  if (existingRun) {
    const output = existingRun.output_summary_json || {};
    const rawResult = output.result || existingRun.output_content;

    if (rawResult) {
      const normalized = normalizeLearningAgentResult(rawResult);

      // normalized.result is the canonical teaching payload with sections
      if (normalized.success && normalized.result && normalized.result.sections?.length > 0) {
        renderTeachingResult(normalized.result, existingRun);
        setFormalPhase(PHASE.COMPLETED, {
          agentName: getNodeType(node.type)?.agent || 'Agent',
          completedAtMs: existingRun.completed_at ? new Date(existingRun.completed_at).getTime() : Date.now(),
          startedAtMs: existingRun.started_at ? new Date(existingRun.started_at).getTime() : null,
          result: normalized.result,
        });
        showEl('lws-content-area');
      } else if (existingRun.output_content) {
        renderLegacyContent(existingRun.output_content, node);
        setFormalPhase(PHASE.COMPLETED, {
          agentName: getNodeType(node.type)?.agent || 'Agent',
          completedAtMs: existingRun.completed_at ? new Date(existingRun.completed_at).getTime() : Date.now(),
          startedAtMs: existingRun.started_at ? new Date(existingRun.started_at).getTime() : null,
        });
        showEl('lws-content-area');
      }
    }

    // Restore guide
    if (state.guide.blocks.length === 0 && output.guide?.blocks) {
      renderGuideBlocks(output.guide.blocks);
      setGuidePhase(PHASE.COMPLETED, { blocks: output.guide.blocks });
    }

    updateTopbar();
    renderProgressNav();
    updateActionButtons();
    return;
  }

  // Node is not completed — check if PAUSED with partial data
  const runningRun = (S.node_runs || []).find(
    r => String(r.node_id) === String(node.id) && r.status === 'RUNNING'
  );

  // Node is not completed — start execution
  showEl('lws-content-area');
  const info = getNodeType(node.type);
  const agentName = info?.agent || 'Agent';
  const agentType = info?.agent || '';

  currentRequestId = 'lw_' + sessionId + '_' + node.id + '_' + execution.requestVersion;

  console.log('[LearningSession][session=' + sessionId + '] executing node=' + node.id
    + ' type=' + node.type + ' agent=' + agentName);

  // Restore timer from running node run if page was refreshed
  if (runningRun && runningRun.started_at) {
    const startedMs = new Date(runningRun.started_at).getTime();
    setFormalPhase(PHASE.PREPARING, {
      agentName, agentType,
      startedAtMs: startedMs,
      requestId: currentRequestId,
    });
    // Timer will sync via interval
  } else {
    setFormalPhase(PHASE.PREPARING, {
      agentName, agentType,
      startedAtMs: Date.now(),
      requestId: currentRequestId,
    });
  }

  // Parallel: DeepSeek Guide + Dify Formal Agent
  const guidePromise = startGuideAgent(node, 'enter', null, execution);
  const formalPromise = startFormalAgent(node, sessionId, execution);

  await Promise.allSettled([guidePromise, formalPromise]);

  // Refresh session data after both complete
  try {
    if (!isExecutionCurrent(execution)) return;
    const r = await learningWorkflowApi.getSession(sessionId);
    applySessionSnapshot(r);
  } catch {}
  updateTopbar();
  renderProgressNav();
}

// ========================
// DeepSeek 学习引导 (多阶段)
// ========================

// Guide phase triggers for Trainer flow:
//   'enter' → node_enter (called from execCurrentNode)
//   'before_question' → before student answers a question (called from appendTrainerQuestionToTimeline)
//   'after_answer_correct' → after correct answer (called from handleTrainerSubmit)
//   'after_answer_wrong' → after wrong answer (called from handleTrainerSubmit)
//   'node_complete' → all questions done (called after Trainer completion)

async function startGuideAgent(node, phase = 'enter', extraContext = null, execution = state?.execution) {
  if (guideAbortCtrl) guideAbortCtrl.abort();
  const controller = new AbortController();
  guideAbortCtrl = controller;

  const requestId = `guide_${state.sessionId}_${node.id}_${phase}_${Date.now()}`;
  const boundContext = {
    ...(extraContext || {}),
    nodeExecutionId: execution?.nodeRunId || null,
    requestVersion: execution?.requestVersion || null,
  };

  // For 'enter' phase only: skip if guide blocks already exist
  if (phase === 'enter' && state.guide.blocks.length > 0) {
    if (guideAbortCtrl === controller) guideAbortCtrl = null;
    return;
  }

  setGuidePhase(PHASE.STREAMING, { requestId });
  showGuidePanel();

  try {
    guideActive = true;
    const result = await streamLearningGuide(
      state.sessionId,
      node.id,
      phase,
      controller.signal,
      {
        onGuideStart: (data) => {
          if (!guideActive || !isExecutionCurrent(execution)) return;
        },
        onBlock: (block) => {
          if (!guideActive || !isExecutionCurrent(execution)) return;
          // Append guide block as timeline card if phase is not 'enter'
          if (phase !== 'enter') {
            appendGuideToTimeline(block, phase);
          }
          // Also render in guide panel
          renderGuideBlocks([block]);
        },
        onGuideDone: () => {
          if (isExecutionCurrent(execution)) setGuidePhase(PHASE.COMPLETED);
        },
        onGuideError: (err, blocks) => {
          if (!isExecutionCurrent(execution)) return;
          if (blocks.length > 0) {
            setGuidePhase(PHASE.COMPLETED);
          } else {
            setGuidePhase(PHASE.IDLE, { error: err.message });
          }
        },
      },
      boundContext
    );
  } catch (e) {
    if (e.name === 'AbortError' || !isExecutionCurrent(execution)) return;
    console.error('[LearningGuide] error for phase ' + phase + ':', e.message);
  } finally {
    if (guideAbortCtrl === controller) guideAbortCtrl = null;
    if (isExecutionCurrent(execution)) guideActive = false;
  }
}

// Append guide block to the main timeline
function appendGuideToTimeline(block, phase) {
  const timeline = document.getElementById('lws-timeline');
  if (!timeline) return;

  const phaseLabels = {
    before_question: '答题提示',
    after_answer_correct: '学习引导',
    after_answer_wrong: '学习引导',
    node_complete: '阶段总结',
    round_summary: '阶段小结',
  };

  const card = document.createElement('div');
  card.className = 'lws-timeline-card lws-timeline-guide';
  card.innerHTML = `<div class="lws-timeline-card-header">
    <span class="lws-timeline-badge guide">💬 ${escHtml(phaseLabels[phase] || '学习引导')}</span>
  </div>
  <div class="lws-timeline-card-body">
    <div class="lws-guide-bubble-timeline">${escHtml(block.text || '')}</div>
  </div>`;
  timeline.appendChild(card);
  timeline.scrollTop = timeline.scrollHeight;
}

// Trigger guide for a specific phase in the Trainer flow
function triggerGuideForPhase(phase, extraContext) {
  if (!state || !state.nodeId) return;
  const graph = S.runtime_graph_json || {};
  const node = (graph.nodes || []).find(n => String(n.id) === String(state.nodeId));
  if (node) {
    startGuideAgent(node, phase, {
      phase,
      courseName: S.course?.course_name || '',
      knowledgePointName: S.knowledge_point?.knowledge_point_name || '',
      nodeName: node.title || '应用练习',
      ...extraContext,
    }, state.execution);
  }
}

// ========================
// Dify 正式教学 Agent
// ========================

async function startFormalAgent(node, sessionId, execution = state?.execution) {
  if (formalAbortCtrl) formalAbortCtrl.abort();
  const controller = new AbortController();
  formalAbortCtrl = controller;

  const isExplainer = ['concept_explanation', 'analogy_explanation', 'worked_example_analysis', 'socratic_questioning'].includes(node.type);
  const isTrainer = ['basic_practice', 'adaptive_practice'].includes(node.type);

  if (!isExplainer && !isTrainer) {
    return runNonInteractiveNode(node, sessionId, execution, controller);
  }

  if (isExplainer) {
    return runExplainerNode(node, sessionId, execution, controller);
  }

  if (isTrainer) {
    return runTrainerNode(node, sessionId, execution, controller);
  }
}

async function runExplainerNode(node, sessionId, execution, controller) {
  const requestId = currentRequestId;
  const contentEl = document.getElementById('lws-teaching-result');
  if (contentEl) {
    contentEl.innerHTML = `<div class="lws-stream-loading">
      <div class="lws-loading-steps">
        <div class="lws-loading-step active" id="lws-step-prepare">正在整理学习上下文</div>
        <div class="lws-loading-step" id="lws-step-request">正在连接 Explainer Agent</div>
        <div class="lws-loading-step" id="lws-step-stream">正在接收讲解内容</div>
      </div></div>`;
  }

  try {
    formalActive = true;
    const result = await explainerApi.streamChat(
      {
        knowledgePointId: S.knowledge_point_id,
        message: node.config?.prompt || ('请讲解: ' + (node.title || '知识点')),
        strategyHint: node.config?.strategy || 'auto',
        depth: node.config?.depth || 'moderate',
        newConversation: true,
        learningSessionId: String(sessionId),
      },
      controller.signal,
      {
        onConnected: () => {
          if (!formalActive || !isExecutionCurrent(execution)) return;
          setFormalPhase(PHASE.HTTP_CONNECTED, {
            agentName: 'Explainer', requestId,
            startedAt: state.formalAgent.startedAt,
          });
          updateLoadingStep('lws-step-request');
        },
        onStreamStart: () => {
          if (!formalActive || !isExecutionCurrent(execution)) return;
          setFormalPhase(PHASE.STREAMING, {
            agentName: 'Explainer', requestId,
            startedAt: state.formalAgent.startedAt,
            workflowConnected: true,
          });
          updateLoadingStep('lws-step-stream');
        },
        onDelta: (text, fullText) => {
          if (!formalActive || !isExecutionCurrent(execution)) return;
          // Explainer may return JSON, don't show raw streaming
        },
        onResult: (answer) => {
          if (!formalActive || !isExecutionCurrent(execution)) return;
          // workflow_finished answer received
          processExplainerAnswer(answer, node);
        },
        onDone: (info) => {
          if (!formalActive || state.nodeId !== node.id) return;
          // Only process answer if not already handled by onResult
          const alreadyHaveResult = !!(state.formalAgent.result && state.formalAgent.result.sections?.length > 0);
          if (!alreadyHaveResult) {
            const fallback = info.resultAnswer || info.fullText || '';
            if (fallback) {
              processExplainerAnswer(fallback, node);
            }
          }

          setFormalPhase(PHASE.COMPLETED, {
            agentName: 'Explainer',
            completedAtMs: Date.now(),
            requestId,
          });

          // Save node result AFTER phase is set (so result is available)
          saveNodeResult(sessionId, node.id, null, execution);
        },
        onError: (err) => {
          // handled in catch
        },
      }
    );

    // streamChat returned — if phase still not completed (edge case), mark as done
    // BUT do NOT call saveNodeResult again — onDone already saved it
    if (isExecutionCurrent(execution) && state.formalAgent.phase !== PHASE.COMPLETED && state.formalAgent.phase !== PHASE.FAILED) {
      setFormalPhase(PHASE.COMPLETED, { completedAtMs: Date.now() });
      // Only save if we didn't already save in onDone (result was set after onDone)
      if (state.formalAgent.result) {
        saveNodeResult(sessionId, node.id, null, execution);
      }
    }
  } catch (e) {
    if (e.name === 'AbortError' || !isExecutionCurrent(execution)) return;
    handleFormalAgentError(e, node, sessionId);
  } finally {
    if (formalAbortCtrl === controller) formalAbortCtrl = null;
    if (isExecutionCurrent(execution)) formalActive = false;
  }
}

function processExplainerAnswer(rawAnswer, node) {
  if (!rawAnswer) return;

  const normalized = normalizeLearningAgentResult(rawAnswer);

  // ALWAYS set state.formalAgent.result — even if sections are empty,
  // the normalizer now wraps content in a fallback section.
  // This ensures saveNodeResult can always persist data.
  state.formalAgent.result = normalized.result;
  state.formalAgent.resultAnswer = typeof rawAnswer === 'string' ? rawAnswer : JSON.stringify(rawAnswer);

  if (normalized.result && normalized.result.sections && normalized.result.sections.length > 0) {
    renderTeachingResult(normalized.result, node);
    console.log('[LearningSession] Explainer result rendered: sections=' + normalized.result.sections.length
      + ' strategy=' + (normalized.result.strategy?.code || 'unknown'));
  } else {
    // Fallback: the normalizer should have created at least 1 section, but if not,
    // render the raw answer as markdown (not raw JSON)
    console.warn('[LearningSession] Result has no sections, using fallback rendering');
    renderLegacyContent(typeof rawAnswer === 'string' ? rawAnswer : JSON.stringify(rawAnswer), node);
  }
}

function updateLoadingStep(stepId) {
  const steps = ['lws-step-prepare', 'lws-step-request', 'lws-step-stream'];
  for (const id of steps) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id === stepId);
  }
}

function renderTeachingResult(teachingData, nodeOrRun) {
  const el = document.getElementById('lws-teaching-result');
  if (!el) return;

  const nodeRun = nodeOrRun?.node_run_id ? nodeOrRun : null;
  const node = nodeOrRun?.id ? nodeOrRun : null;

  const sections = teachingData.sections || [];
  const strategy = teachingData.strategy || {};
  const sources = teachingData.knowledgeSources || [];
  const estimatedMinutes = teachingData.estimatedReadingMinutes || 5;

  let sectionsHtml = '';
  for (const section of sections) {
    const config = getSectionConfig(section.type);
    const rendered = renderMarkdownToHtml(section.content || '');
    const isWarning = section.type === 'misconception_guard';

    sectionsHtml += `<div class="lws-section-card ${isWarning ? 'lws-section-warning' : ''}">
      <div class="lws-section-header">
        <span class="lws-section-icon">${config.icon}</span>
        <span class="lws-section-title">${escHtml(section.title || config.label)}</span>
        <span class="lws-section-type-tag" style="background:${config.color}15;color:${config.color}">${config.label}</span>
      </div>
      <div class="lws-section-body message-markdown">${rendered}</div>
    </div>`;
  }

  // 知识库来源
  let sourcesHtml = '';
  if (sources.length > 0) {
    sourcesHtml = `<details class="lws-sources-details">
      <summary class="lws-sources-summary">📚 参考知识库 (${sources.length} 份文档)</summary>
      <div class="lws-sources-list">
        ${sources.map(s => `<div class="lws-source-item">
          <span class="lws-source-name">${escHtml(s.name || '未知文档')}</span>
          ${s.matchPercent != null ? `<span class="lws-source-score">匹配度 ${s.matchPercent}%</span>` : ''}
        </div>`).join('')}
      </div>
    </details>`;
  }

  el.innerHTML = `<div class="lws-teaching-header">
    <div class="lws-teaching-meta">
      <span class="lws-teaching-strategy">📋 ${escHtml(strategy.name || '教学策略')}</span>
      <span class="lws-teaching-time">⏱ 预计阅读 ${estimatedMinutes} 分钟</span>
      ${strategy.reason ? `<span class="lws-teaching-reason" title="${escAttr(strategy.reason)}">💬 ${escHtml(strategy.reason)}</span>` : ''}
    </div>
  </div>
  <div class="lws-sections-container">${sectionsHtml}</div>
  ${sourcesHtml}`;

  // 渲染数学公式
  if (typeof renderMathInMarkdownElements === 'function') {
    setTimeout(() => renderMathInMarkdownElements(el), 100);
  } else if (window.renderMathInElement) {
    setTimeout(() => {
      el.querySelectorAll('.message-markdown').forEach(child => {
        try {
          window.renderMathInElement(child);
        } catch {}
      });
    }, 100);
  }
}

function renderLegacyContent(content, node) {
  const el = document.getElementById('lws-teaching-result');
  if (!el) return;

  // If content is a plain text string (not JSON), render it as markdown
  if (typeof content === 'string') {
    // Check if it looks like raw JSON — if so, try to prettify it
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      // It's JSON — try to parse and extract readable content
      try {
        const parsed = JSON.parse(trimmed);
        const extracted = extractReadableText(parsed);
        if (extracted) {
          const rendered = renderMarkdownToHtml(extracted);
          el.innerHTML = `<div class="lws-legacy-content">
            <div class="lws-section-card">
              <div class="lws-section-body message-markdown">${rendered}</div>
            </div></div>`;
          return;
        }
      } catch {}
      // If JSON can't be parsed, show a fallback message — NEVER dump raw JSON
      el.innerHTML = `<div class="lws-legacy-content">
        <div class="lws-section-card">
          <div class="lws-section-body">
            <p class="lws-fallback-text">教学内容已生成，但格式暂时无法识别。</p>
            <div class="lws-fallback-actions" style="margin-top:12px;display:flex;gap:8px;">
              <button class="lws-btn lws-btn-outline" data-learning-action="retry">重新尝试</button>
              <button class="lws-btn lws-btn-outline" data-learning-action="skip">跳过节点</button>
              <button class="lws-btn lws-btn-ghost" data-learning-action="return">返回学习流中心</button>
            </div>
          </div>
        </div>
      </div>`;
      // Dev-only: collapsed raw view
      if (import.meta.env.DEV) {
        const diagnostic = document.createElement('details');
        diagnostic.className = 'lws-dev-raw';
        diagnostic.style.cssText = 'margin-top:12px;opacity:0.5;font-size:12px;';
        diagnostic.innerHTML = `<summary>开发者：查看原始输出</summary>
          <pre style="max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;">${escHtml(content.slice(0, 5000))}</pre>`;
        el.appendChild(diagnostic);
      }
      return;
    }

    // Plain text / markdown
    const rendered = renderMarkdownToHtml(content);
    el.innerHTML = `<div class="lws-legacy-content">
      <div class="lws-section-card">
        <div class="lws-section-body message-markdown">${rendered}</div>
      </div>
    </div>`;
    return;
  }

  // For non-string content, show clean fallback
  el.innerHTML = `<div class="lws-legacy-content">
    <div class="lws-section-card">
      <div class="lws-section-body">
        <p class="lws-fallback-text">教学内容已生成，但结果格式暂时无法识别。可以重新尝试本节点。</p>
        <div class="lws-fallback-actions" style="margin-top:12px;display:flex;gap:8px;">
          <button class="lws-btn lws-btn-outline" data-learning-action="retry">重新尝试</button>
          <button class="lws-btn lws-btn-outline" data-learning-action="skip">跳过节点</button>
          <button class="lws-btn lws-btn-ghost" data-learning-action="return">返回学习流中心</button>
        </div>
      </div>
    </div>
  </div>`;
}

// Extract readable text from any JSON object
function extractReadableText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  // Recursively search for text-like fields
  const parts = [];
  function walk(o, depth) {
    if (depth > 5 || !o || typeof o !== 'object') return;
    for (const key of ['explanation', 'summary', 'content', 'text', 'output', 'answer', 'description', 'message']) {
      if (o[key] && typeof o[key] === 'string' && o[key].trim().length > 20) {
        parts.push(o[key].trim());
      }
    }
    for (const val of Object.values(o)) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        walk(val, depth + 1);
      }
    }
  }
  walk(obj, 0);
  return parts.join('\n\n');
}

async function saveNodeResult(sessionId, nodeId, clientActionId, execution = state?.execution) {
  if (execution && !isExecutionCurrent(execution)) return null;
  try {
    const result = state.formalAgent.result;
    const guide = state.guide;

    // Always save if we have result OR guide blocks
    if (!result && !(guide && guide.blocks.length > 0)) {
      console.log('[LearningSession] saveNodeResult skipped: no result or guide to save');
      return null;
    }

    const resp = await fetch(apiUrl(`/learning-workflows/sessions/${sessionId}/complete-node`), {
      ...authFetchOptions('POST', {
        nodeId,
        result: result || {},
        guide: guide && guide.blocks.length > 0 ? {
          agent: 'learning_guide',
          model: import.meta.env.VITE_DEEPSEEK_MODEL || 'deepseek-v4-pro',
          requestId: guide.requestId,
          phase: 'enter',
          blocks: guide.blocks.map((b, i) => ({ index: i + 1, text: b.text })),
          createdAt: new Date().toISOString(),
        } : null,
        clientActionId: clientActionId || `save_${sessionId}_${nodeId}_${Date.now()}`,
        expectedNodeExecutionId: execution?.nodeRunId || null,
      }),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      console.error('[LearningSession] Save node result failed:', resp.status, errData.message || '');
      return null;
    }

    const resultData = await resp.json();
    // Backend wraps response as { code, data: { completedNodeId, nextNodeId, isFlowCompleted, session } }
    const responseData = resultData.data || resultData;
    if (responseData.discarded) return null;
    // Extract the actual session object — critical: don't return the wrapper
    const session = responseData.session || responseData;
    console.log('[LearningSession][session=' + sessionId + '] complete_node before=' + nodeId
      + ' after=' + (session.current_node_id || session.currentNodeId || '?'));
    return session;
  } catch (e) {
    console.error('[LearningSession] Save node result error:', e.message);
    return null;
  }
}

function handleFormalAgentError(e, node, sessionId) {
  const httpStatus = e.httpStatus || 0;
  const isLocalAuthFailure = e.source === 'discimind' && e.stage === 'local_jwt_authentication';
  const isDifyAuthFailure = e.source === 'dify' && e.stage === 'dify_authentication';
  const isDifyUnreachable = e.source === 'network' && e.stage === 'dify_connection';
  const retryable = e.retryable !== false && !isLocalAuthFailure && !isDifyAuthFailure;

  let errMessage = e.message || 'Agent 请求失败';
  if (isLocalAuthFailure) errMessage = '登录状态已失效，请重新登录。';
  else if (isDifyAuthFailure) errMessage = 'Explainer Agent 服务鉴权失败，请检查讲解者应用的 Service API Key。';
  else if (isDifyUnreachable) errMessage = '无法连接本地 Dify 服务，请确认 Docker 服务和端口映射正常。';

  setFormalPhase(PHASE.FAILED, {
    agentName: 'Explainer',
    completedAt: Date.now(),
    error: { code: e.code, message: errMessage, retryable },
  });

  // 显示错误
  const el = document.getElementById('lws-teaching-result');
  if (el) {
    const nodeLabel = node.title || NODE_LABELS[node.type] || node.type;
    el.innerHTML = `<div class="lws-error-card">
      <div class="lws-error-icon">!</div>
      <div class="lws-error-info">
        <div class="lws-error-title">${escHtml(nodeLabel)} 执行失败</div>
        <div class="lws-error-message">${escHtml(errMessage)}</div>
        ${e.code ? `<div class="lws-error-code">错误码: ${escHtml(e.code)}</div>` : ''}
      </div>
      <div class="lws-error-actions">
        ${retryable ? `<button class="lws-btn lws-btn-primary" data-learning-action="retry">重新尝试</button>` : ''}
        <button class="lws-btn lws-btn-outline" data-learning-action="skip">跳过节点</button>
        <button class="lws-btn lws-btn-ghost" data-learning-action="return">返回学习流中心</button>
      </div>
    </div>`;
  }
}

// ========================
// Trainer 节点 (时间线追加模式)
// ========================

let trainerState = {
  session: null,
  currentNode: null,
  currentQuestion: null,
  answeredQuestions: [],
  submitting: false,
  loadingNext: false,
  nodeRunId: null,
  practiceConfig: null,
  progress: null,
  currentMastery: null,
  hintLevel: 0,
};

async function runTrainerNode(node, sessionId, execution, controller) {
  const el = document.getElementById('lws-teaching-result');
  if (el) el.innerHTML = '';

  ensureTimelineContainer(el);

  try {
    formalActive = true;
    const response = await fetch(apiUrl(`/learning-workflows/sessions/${sessionId}/execute-current`), {
      ...authFetchOptions('POST'),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Object.assign(new Error(error.message || '训练师会话初始化失败'), {
        code: error.code,
        httpStatus: response.status,
      });
    }
    const payload = await response.json();
    if (!isExecutionCurrent(execution)) return;
    const data = payload.data || payload;
    if (data.cancelled || data.discarded) return;
    const trainerData = data.trainerSession || data;

    trainerState.session = trainerData.session || trainerData;
    trainerState.nodeRunId = execution.nodeRunId;
    trainerState.practiceConfig = trainerData.practiceConfig || {};
    trainerState.progress = trainerData.progress || null;
    trainerState.currentMastery = trainerData.currentMastery ?? S.mastery_current ?? null;

    if (!trainerState.session?.sessionId) {
      setFormalPhase(PHASE.FAILED, {
        agentName: 'Trainer',
        error: { code: 'TRAINER_NO_QUESTIONS', message: '暂无可用题目', retryable: true },
      });
      return;
    }

    restoreTrainerHistory(trainerData, node, sessionId);
    if (!trainerData.completion?.shouldComplete) {
      setFormalPhase(PHASE.STREAMING, { agentName: 'Trainer', workflowConnected: true });
    }
  } catch (e) {
    if (e.name === 'AbortError' || !isExecutionCurrent(execution)) return;
    setFormalPhase(PHASE.FAILED, {
      agentName: 'Trainer',
      error: { code: e.code, message: e.message, retryable: e.httpStatus !== 404 },
    });
    if (el) {
      appendToTimeline('error', { text: '训练师加载失败: ' + (e.message || '') });
    }
  } finally {
    if (formalAbortCtrl === controller) formalAbortCtrl = null;
    if (isExecutionCurrent(execution)) formalActive = false;
  }
}

function restoreTrainerHistory(trainerData, node, sessionId) {
  trainerState.session = trainerData.session || trainerData;
  trainerState.answeredQuestions = [];
  trainerState.progress = trainerData.progress || trainerState.progress;
  trainerState.practiceConfig = trainerData.practiceConfig || trainerState.practiceConfig || {};
  renderTrainerProgress();

  // Restore completed questions
  const completed = trainerData.completedQuestions || [];
  for (const item of completed) {
    appendToTimeline('question_card', {
      question: item.question,
      node,
      sessionId,
      session: trainerState.session,
    });
    if (item.answerResult) {
      trainerState.answeredQuestions.push({
        questionKey: item.question?.questionKey,
        isCorrect: item.answerResult.isCorrect,
      });
      appendToTimeline('student_answer', {
        answer: item.answerResult.selectedOption || item.answerResult.answer,
      });
      appendToTimeline('evaluation', {
        isCorrect: item.answerResult.isCorrect,
        correctAnswer: item.answerResult.correctOption || item.answerResult.correctAnswer,
        analysis: item.answerResult.explanation || item.answerResult.analysis || '',
      });
    }
  }

  // Show current question if any
  if (trainerData.currentQuestion && !trainerData.completion?.shouldComplete) {
    appendTrainerQuestionToTimeline(trainerData.currentQuestion, trainerState.session, sessionId, node);
  }

  // Check completion
  if (trainerData.completion?.shouldComplete) {
    appendToTimeline('info', { text: '本轮练习已完成，可查看总结后进入下一节点。' });
    setFormalPhase(PHASE.COMPLETED, { agentName: 'Trainer' });
    state.formalAgent.result = buildTrainerResultPayload(node);
  }

  updateActionButtons();
}

function appendTrainerQuestionToTimeline(question, trainerSession, sessionId, node) {
  trainerState.currentQuestion = question;
  trainerState.currentNode = node;
  trainerState.hintLevel = 0;

  const qId = question.questionKey || question.question_key || question.id || 'q_' + Date.now();

  // Append question card to timeline
  appendToTimeline('question_card', {
    id: qId,
    question,
    session: trainerSession,
    sessionId,
    node,
  });

  // Trigger guide: before_question (no answer info!)
  const graph = S.runtime_graph_json || {};
  const currentNode = (graph.nodes || []).find(n => String(n.id) === String(state.nodeId));
  if (currentNode) {
    startGuideAgent(currentNode, 'before_question', {
      question: {
        sequence: (trainerState.answeredQuestions.length + 1),
        type: question.type || 'single_choice',
        stem: question.stem || '',
        options: (question.options || []).map(o => ({ key: o.key, text: o.text || o.content })),
        difficulty: question.difficulty || 'medium',
      },
      progress: {
        answeredCount: trainerState.progress?.completedCount ?? trainerState.answeredQuestions.length,
        correctCount: trainerState.progress?.correctCount ?? 0,
        plannedQuestionCount: trainerState.practiceConfig?.targetQuestionCount || trainerState.progress?.totalCount || 0,
        minQuestionCount: trainerState.practiceConfig?.minQuestionCount || null,
        maxQuestionCount: trainerState.practiceConfig?.maxQuestionCount || null,
        targetMastery: trainerState.practiceConfig?.targetMastery || null,
      },
      courseName: S.course?.course_name || '',
      knowledgePointName: S.knowledge_point?.knowledge_point_name || '',
      nodeName: currentNode.title || '应用练习',
    });
  }

  // Add interactive answer area
  const timelineEl = document.getElementById('lws-timeline');
  if (!timelineEl) return;

  const opts = question.options || [];
  const isChoice = (question.type || '').includes('choice');

  const answerCard = document.createElement('div');
  answerCard.className = 'lws-timeline-card lws-timeline-answer';
  answerCard.id = 'lws-answer-' + qId;
  answerCard.innerHTML = `<div class="lws-timeline-card-body">
    ${isChoice ? `<div class="lws-question-options">${opts.map(o => `<label class="lws-option-label"><input type="radio" name="lws-ans-${qId}" value="${escAttr(o.key || '')}"><span class="lws-option-key">${escHtml(o.key || '')}</span><span>${escHtml(o.text || o.content || '')}</span></label>`).join('')}</div>`
      : `<textarea id="lws-trainer-answer-${qId}" class="lws-textarea" rows="3" placeholder="输入你的答案..."></textarea>`}
    <div class="lws-answer-actions"><button class="lws-btn lws-btn-primary lws-submit-btn" id="lws-submit-${qId}" ${trainerState.submitting ? 'disabled' : ''}>提交答案</button><button class="lws-btn lws-btn-ghost" id="lws-hint-${qId}" type="button">获取提示</button></div>
    <span class="lws-submit-status" id="lws-submit-status-${qId}" style="display:none"></span>
  </div>`;
  timelineEl.appendChild(answerCard);
  timelineEl.scrollTop = timelineEl.scrollHeight;

  // Bind submit
  const submitBtn = document.getElementById('lws-submit-' + qId);
  if (submitBtn) {
    submitBtn.onclick = () => handleTrainerSubmit(qId, question, trainerSession, sessionId, node);
  }
  const hintBtn = document.getElementById('lws-hint-' + qId);
  if (hintBtn) {
    hintBtn.onclick = () => {
      if (!isExecutionCurrent(state.execution) || trainerState.submitting) return;
      trainerState.hintLevel += 1;
      hintBtn.textContent = trainerState.hintLevel === 1 ? '再给一点提示' : '换个角度提示';
      startGuideAgent(node, 'before_question', {
        hintLevel: trainerState.hintLevel,
        question: {
          sequence: (trainerState.progress?.completedCount || trainerState.answeredQuestions.length) + 1,
          type: question.type || 'single_choice',
          stem: question.stem || '',
          options: (question.options || []).map((option) => ({ key: option.key, text: option.text || option.content })),
          difficulty: question.difficulty || 'medium',
        },
        progress: trainerState.progress || {},
      }, state.execution);
    };
  }
}

function renderTrainerProgress() {
  const timeline = document.getElementById('lws-timeline');
  if (!timeline) return;
  let card = document.getElementById('lws-trainer-progress');
  if (!card) {
    card = document.createElement('div');
    card.id = 'lws-trainer-progress';
    card.className = 'lws-trainer-progress';
    timeline.prepend(card);
  }
  const progress = trainerState.progress || {};
  const config = trainerState.practiceConfig || {};
  const completed = Number(progress.completedCount || 0);
  const correct = Number(progress.correctCount || 0);
  const target = Number(config.targetQuestionCount || progress.totalCount || 0);
  const max = Number(config.maxQuestionCount || target || 0);
  const accuracy = completed ? Math.round((correct / completed) * 100) : 0;
  const mastery = trainerState.currentMastery;
  const percent = target ? Math.min(100, Math.round((completed / target) * 100)) : 0;
  card.innerHTML = `<div class="lws-trainer-progress-head"><b>应用练习</b><span>第 ${Math.min(completed + 1, target)} / ${target} 题</span></div>
    <div class="lws-trainer-progress-track"><i style="width:${percent}%"></i></div>
    <div class="lws-trainer-progress-stats"><span>已完成 ${completed} 题</span><span>答对 ${correct} 题</span><span>正确率 ${accuracy}%</span><span>剩余 ${Math.max(0, target - completed)} 题</span>${mastery != null ? `<span>掌握度 ${Math.round(mastery)}%</span>` : ''}</div>
    <small>完成条件：完成 ${target} 题；或至少 ${config.minQuestionCount ?? '—'} 题后掌握度达到 ${config.targetMastery ?? '—'}% / 连续答对 ${config.consecutiveCorrectToFinish ?? '—'} 题。最多 ${max} 题。</small>`;
}

async function handleTrainerSubmit(qId, question, trainerSession, sessionId, node) {
  const execution = state?.execution;
  if (trainerState.submitting || trainerState.loadingNext || !isExecutionCurrent(execution)) return;

  let answer;
  const sel = document.querySelector(`input[name="lws-ans-${qId}"]:checked`);
  if (sel) answer = sel.value;
  else {
    const textarea = document.getElementById('lws-trainer-answer-' + qId);
    if (textarea) answer = textarea.value.trim();
  }
  if (!answer) { showToast('请选择或输入你的答案', 'warning'); return; }

  // Lock submission
  trainerState.submitting = true;
  setAction('submit-answer', true);
  const submitBtn = document.getElementById('lws-submit-' + qId);
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中…'; }
  const statusEl = document.getElementById('lws-submit-status-' + qId);
  if (statusEl) { statusEl.style.display = ''; statusEl.textContent = '正在批改…'; }

  try {
    const resp = await learningWorkflowApi.submitAnswer(sessionId, {
      questionKey: question.questionKey || question.question_key,
      selectedOption: answer,
      confidenceLevel: 'medium',
      timeSpentSeconds: 30,
      requestId: 'lw_a_' + sessionId + '_' + qId + '_' + Date.now(),
      expectedNodeExecutionId: execution.nodeRunId,
      operationId: `answer_${sessionId}_${execution.nodeRunId}_${qId}`,
    });
    const data = resp.data || resp;
    if (!isExecutionCurrent(execution)) return;

    // Append student answer to timeline
    appendToTimeline('student_answer', { id: qId, answer, submittedAt: new Date().toISOString() });

    // Append evaluation to timeline
    if (data.answerResult) {
      appendToTimeline('evaluation', {
        id: qId,
        isCorrect: data.answerResult.isCorrect,
        correctAnswer: data.answerResult.correctOption || data.answerResult.correctAnswer,
        studentAnswer: answer,
        analysis: data.answerResult.explanation || data.answerResult.analysis || '',
        errorType: data.answerResult.errorType || null,
      });
    }

    // Remove the answer interaction card (already submitted)
    const answerCard = document.getElementById('lws-answer-' + qId);
    if (answerCard) answerCard.remove();

    // Record answered question
    trainerState.answeredQuestions.push({
      questionKey: question.questionKey || question.question_key,
      answer,
      isCorrect: data.answerResult?.isCorrect,
    });
    trainerState.currentQuestion = null;
    trainerState.submitting = false;
    trainerState.progress = data.sessionProgress || trainerState.progress;
    if (data.session?.trainerSession) {
      trainerState.currentMastery = data.session.trainerSession.currentMastery ?? trainerState.currentMastery;
    }
    renderTrainerProgress();

    // Check completion
    if (data.completion?.shouldComplete) {
      appendToTimeline('info', {
        text: '本轮练习已完成！共完成 ' + (data.completion.answeredCount || 0) + ' 道题，正确率 ' + Math.round((data.completion.accuracy || 0) * 100) + '%。',
        reason: data.completion.reason,
      });
      // Trigger guide: node_complete
      triggerGuideForPhase('node_complete', {
        answeredCount: data.completion.answeredCount || 0,
        correctCount: data.completion.correctCount || 0,
        accuracy: data.completion.accuracy || 0,
        reason: data.completion.reason || 'completed',
      });
      setFormalPhase(PHASE.COMPLETED, { agentName: 'Trainer' });
      state.formalAgent.result = buildTrainerResultPayload(node);
      state.formalAgent.serverAdvanced = true;
      if (data.session) applySessionSnapshot(data.session);
      return;
    }

    // Trigger guide: after_answer
    const guidePhase = data.answerResult?.isCorrect ? 'after_answer_correct' : 'after_answer_wrong';
    triggerGuideForPhase(guidePhase, {
      questionSummary: (question.stem || '').slice(0, 100),
      studentAnswer: answer,
      correctAnswer: data.answerResult?.correctOption || data.answerResult?.correctAnswer || '',
      isCorrect: data.answerResult?.isCorrect,
      analysisSummary: (data.answerResult?.explanation || '').slice(0, 200),
      errorType: data.answerResult?.errorType || null,
      progress: {
        answeredCount: data.completion?.answeredCount || (trainerState.answeredQuestions.length + 1),
        correctCount: data.completion?.correctCount || 0,
        accuracy: data.completion?.accuracy || 0,
      },
    });

    // 题目已由后端在确认未达到退出条件后生成；前端只展示它，不自行追加 Agent 请求。
    if (data.nextQuestion) {
      trainerState.loadingNext = true;
      setTimeout(() => {
        if (!isExecutionCurrent(execution)) return;
        trainerState.loadingNext = false;
        appendTrainerQuestionToTimeline(data.nextQuestion, trainerSession, sessionId, node);
      }, 1200);
    } else {
      // No more questions but not marked complete — try to get next
      appendToTimeline('info', { text: '练习完成！' });
      setFormalPhase(PHASE.COMPLETED, { agentName: 'Trainer' });
      state.formalAgent.result = buildTrainerResultPayload(node);
      state.formalAgent.serverAdvanced = true;
    }
  } catch (e) {
    if (!isExecutionCurrent(execution)) return;
    trainerState.submitting = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '重新提交'; }
    if (statusEl) { statusEl.style.display = 'none'; }
    showToast('提交失败: ' + (e.message || ''), 'error');
  }
  finally {
    trainerState.submitting = false;
    setAction(null, false);
  }
}

function buildTrainerResultPayload(node) {
  return {
    strategy: { code: 'practice', name: '练习完成' },
    sections: [{
      type: 'practice',
      title: node.title || '练习',
      content: '本节点共完成 ' + trainerState.answeredQuestions.length + ' 道练习题。',
      order: 1,
    }],
    estimatedReadingMinutes: 1,
    knowledgeSources: [],
  };
}

// ========================
// 时间线渲染 (统一追加方法)
// ========================

function ensureTimelineContainer(parentEl) {
  let timeline = document.getElementById('lws-timeline');
  if (!timeline) {
    parentEl.innerHTML = '';
    timeline = document.createElement('div');
    timeline.id = 'lws-timeline';
    timeline.className = 'lws-timeline';
    parentEl.appendChild(timeline);
  }
  return timeline;
}

function appendToTimeline(type, data) {
  const timeline = document.getElementById('lws-timeline');
  if (!timeline) return;

  const card = document.createElement('div');
  card.className = 'lws-timeline-card lws-timeline-' + type;
  card.dataset.timelineType = type;

  switch (type) {
    case 'question_card': {
      const q = data.question || {};
      const opts = (q.options || []).map(o =>
        `<span class="lws-option-display"><b>${escHtml(o.key || '')}.</b> ${escHtml(o.text || o.content || '')}</span>`
      ).join('');
      card.innerHTML = `<div class="lws-timeline-card-header">
        <span class="lws-timeline-badge question">题目 ${data.question?.sequence || (trainerState.answeredQuestions.length + 1)}</span>
        <span class="lws-timeline-difficulty">${escHtml(q.difficulty || 'medium')}</span>
      </div>
      <div class="lws-timeline-card-body">
        <div class="lws-question-stem">${escHtml(q.stem || q.content || '')}</div>
        ${opts ? `<div class="lws-question-options-display">${opts}</div>` : ''}
      </div>`;
      break;
    }
    case 'student_answer': {
      card.innerHTML = `<div class="lws-timeline-card-header">
        <span class="lws-timeline-badge answer">你的答案</span>
        <span class="lws-timeline-time">${escHtml(data.submittedAt ? new Date(data.submittedAt).toLocaleTimeString() : '')}</span>
      </div>
      <div class="lws-timeline-card-body">
        <div class="lws-student-answer-text">${escHtml(data.answer || '')}</div>
      </div>`;
      break;
    }
    case 'evaluation': {
      const isCorrect = data.isCorrect;
      card.innerHTML = `<div class="lws-timeline-card-header">
        <span class="lws-timeline-badge ${isCorrect ? 'correct' : 'incorrect'}">${isCorrect ? '✓ 正确' : '✗ 错误'}</span>
      </div>
      <div class="lws-timeline-card-body">
        ${!isCorrect ? `<div class="lws-eval-row"><span class="lws-eval-label">正确答案:</span> <b>${escHtml(data.correctAnswer || '')}</b></div>` : ''}
        <div class="lws-eval-analysis">${escHtml(data.analysis || '')}</div>
        ${data.errorType ? `<div class="lws-eval-error-type">错误类型: ${escHtml(data.errorType)}</div>` : ''}
      </div>`;
      break;
    }
    case 'info': {
      card.innerHTML = `<div class="lws-timeline-card-body">
        <div class="lws-timeline-info-text">${escHtml(data.text || '')}</div>
      </div>`;
      break;
    }
    case 'error': {
      card.className += ' lws-timeline-error';
      card.innerHTML = `<div class="lws-timeline-card-body">
        <div class="lws-error-message">${escHtml(data.text || '发生错误')}</div>
      </div>`;
      break;
    }
    default: {
      card.innerHTML = `<div class="lws-timeline-card-body">${escHtml(JSON.stringify(data))}</div>`;
    }
  }

  timeline.appendChild(card);
  timeline.scrollTop = timeline.scrollHeight;
}

// ========================
// 非交互式节点
// ========================

async function runNonInteractiveNode(node, sessionId, execution, controller) {
  const el = document.getElementById('lws-teaching-result');
  if (el) el.innerHTML = `<div class="lws-stream-loading"><p>正在处理 ${escHtml(NODE_LABELS[node.type] || node.type)}…</p></div>`;

  try {
    formalActive = true;
    const r = await fetch(apiUrl(`/learning-workflows/sessions/${sessionId}/execute-current`), {
      ...authFetchOptions('POST'),
      signal: controller?.signal,
    });

    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw Object.assign(new Error(errData.message || `节点执行失败 (${r.status})`), { httpStatus: r.status });
    }

    const result = await r.json();
    if (!isExecutionCurrent(execution)) return;
    const data = result.data || result;

    if (data.nodeCompleted || data.sessionCompleted) {
      // Always set a result payload so saveNodeResult can persist
      state.formalAgent.result = data.result || {
        strategy: { code: 'auto', name: '节点完成' },
        sections: [{ type: 'text', title: NODE_LABELS[node.type] || '处理', content: data.message || '节点已完成。', order: 1 }],
        estimatedReadingMinutes: 1,
        knowledgeSources: [],
      };
      setFormalPhase(PHASE.COMPLETED, { agentName: data.agentName || 'Agent' });
      if (el) el.innerHTML = `<p class="lws-info-text">${escHtml(NODE_LABELS[node.type] || '处理')}已完成。</p>`;
      saveNodeResult(sessionId, node.id, null, execution);

      if (data.sessionCompleted) {
        await completeAndGo(sessionId);
        return;
      }
    } else {
      state.formalAgent.result = data.result || {
        strategy: { code: 'auto', name: '节点完成' },
        sections: [{ type: 'text', title: NODE_LABELS[node.type] || '处理', content: '节点已完成。', order: 1 }],
        estimatedReadingMinutes: 1,
        knowledgeSources: [],
      };
      setFormalPhase(PHASE.COMPLETED, { agentName: data.agentName || 'Agent' });
      saveNodeResult(sessionId, node.id, null, execution);
    }
  } catch (e) {
    if (e.name === 'AbortError' || !isExecutionCurrent(execution)) return;
    setFormalPhase(PHASE.FAILED, {
      error: { code: e.code, message: e.message, retryable: e.httpStatus !== 404 },
    });
    if (el) el.innerHTML = `<div class="lws-error-card"><div class="lws-error-message">${escHtml(e.message || '节点处理失败')}</div></div>`;
  } finally {
    if (formalAbortCtrl === controller) formalAbortCtrl = null;
    if (isExecutionCurrent(execution)) formalActive = false;
  }
}

// ========================
// 操作处理
// ========================

async function handlePauseResume() {
  if (!S) return;

  if (S.status === 'PAUSED' || state.sessionPhase === 'PAUSED') {
    // Resume
    setAction('resume', true);
    try {
      hideEl('lws-paused-state');
      await learningWorkflowApi.resumeSession(S.session_id);
      S.status = 'RUNNING';
      state.sessionPhase = 'RUNNING';
      showEl('lws-content-area');
      showEl('lws-guide-panel');
      updateTopbar();
      renderProgressNav();
      renderKnowledgePointOverview();

      const pauseBtn = document.getElementById('lws-pause-btn');
      if (pauseBtn) { pauseBtn.textContent = '暂停'; pauseBtn.className = 'lws-btn lws-btn-outline lws-btn-sm'; }

      // Don't clear existing guide blocks on resume
      // Only start guide if there are NO existing blocks at all
      if (!state.guide.blocks.length) {
        state.guide.phase = PHASE.IDLE;
        const graph = S.runtime_graph_json || {};
        const node = (graph.nodes || []).find(n => n.id === state.nodeId);
        if (node) startGuideAgent(node);
      }

      await execCurrentNode(S.session_id);
    } catch (e) {
      showToast('恢复失败: ' + escHtml(e.message || ''), 'error');
    } finally {
      setAction(null, false);
    }
  } else {
    // Pause
    setAction('pause', true);
    try {
      abortBoth();

      // Save current guide blocks to backend before pausing
      const guideBlocks = state.guide.blocks || [];
      if (guideBlocks.length > 0 && state.nodeId) {
        try {
          await saveGuideToBackend(S.session_id, state.nodeId, guideBlocks, state.guide);
        } catch (saveErr) {
          console.error('[Pause] Failed to save guide before pause:', saveErr.message);
        }
      }

      await learningWorkflowApi.pauseSession(S.session_id);
      S.status = 'PAUSED';
      state.sessionPhase = 'PAUSED';
      showPaused();
    } catch (e) {
      showToast('暂停失败: ' + escHtml(e.message || ''), 'error');
    } finally {
      setAction(null, false);
    }
  }
}

// Save guide data to backend without overwriting formal agent result
async function saveGuideToBackend(sessionId, nodeId, blocks, guideState) {
  // Get existing output first, then merge
  let existingOutput = {};
  try {
    const r = await fetch(apiUrl(`/learning-workflows/sessions/${sessionId}/node/${nodeId}/status`), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (r.ok) {
      const d = await r.json();
      existingOutput = (d.data && d.data.outputSummary) || {};
    }
  } catch {}

  const guideData = {
    ...existingOutput,
    guide: {
      status: 'PAUSED',
      phase: guideState.phase || 'enter',
      requestId: guideState.requestId || '',
      blocks: blocks.map((b, i) => ({ index: b.index || i + 1, text: b.text || '' })),
      updatedAt: new Date().toISOString(),
    },
  };

  await fetch(apiUrl(`/learning-workflows/sessions/${sessionId}/save-guide`), {
    ...authFetchOptions('POST', { nodeId, guide: guideData.guide }),
  });
}

async function handleNext() {
  if (!S) return;
  if (state.formalAgent.phase !== PHASE.COMPLETED) {
    showToast('当前学习内容尚未准备完成', 'warning');
    return;
  }

  // Synchronous lock — guards against double-clicks BEFORE the async work starts
  if (state.action.submitting) return;

  setAction('next', true);
  const nextBtn = document.getElementById('lws-btn-next');
  if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = '正在进入下一节点…'; }

  const previousNodeId = String(state.nodeId);
  const previousNode = (S.runtime_graph_json?.nodes || []).find((item) => String(item.id) === previousNodeId);
  const clientActionId = `next_${S.session_id}_${previousNodeId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log('[Next][clientActionId=' + clientActionId + '] click_received');

  try {
    // Trainer 完成由后端 submit 接口原子推进；此处只切换工作区，不能再保存旧节点一次。
    if (state.formalAgent.serverAdvanced) {
      const nextNodeId = String(S.current_node_id || '');
      if (!nextNodeId || S.status === 'COMPLETED') {
        await showFlowCompleted();
        return;
      }
      archiveCurrentWorkspace(previousNode, '练习已完成');
      abortBoth();
      state.nodeId = nextNodeId;
      state.guide = { phase: PHASE.IDLE, requestId: '', blocks: [], error: null };
      document.getElementById('lws-guide-blocks').innerHTML = '';
      resetCurrentNodeState();
      updateTopbar();
      renderProgressNav();
      await execCurrentNode(S.session_id);
      return;
    }
    // 正在切换前停止流，但保留本 execution 到 complete-node 返回，避免把本次合法完成误判为旧响应。
    if (guideAbortCtrl) { guideAbortCtrl.abort(); guideAbortCtrl = null; }
    if (formalAbortCtrl) { formalAbortCtrl.abort(); formalAbortCtrl = null; }
    guideActive = false;
    formalActive = false;
    clearNodeTimers();
    clearFormalAgentTimer();

    // Save current node result and advance — get back the session directly
    const saved = await saveNodeResult(S.session_id, previousNodeId, clientActionId);

    console.log('[Next][clientActionId=' + clientActionId + '] request_started session=' + S.session_id + ' node=' + previousNodeId);

    // Update S from saveNodeResult response (which is now the session directly)
    if (saved && saved.session_id) {
      S = saved;
    } else {
      // Fallback: refresh from server
      let r;
      try { r = await learningWorkflowApi.getSession(S.session_id); } catch {
        r = await learningWorkflowApi.getSession(S.session_id);
      }
      S = r.data || r;
    }

    state.sessionPhase = S.status;
    state.nodeRuns = S.node_runs || [];

    const nextNodeId = String(S.current_node_id || '');

    console.log('[Next][clientActionId=' + clientActionId + '] frontend_state_updated');
    console.log('[Next][clientActionId=' + clientActionId + '] nextNodeId=' + nextNodeId + ' previousNodeId=' + previousNodeId);

    // Handle session completion — stay on page, let user see result first
    if (S.status === 'COMPLETED' || !nextNodeId || nextNodeId === 'null' || nextNodeId === 'undefined') {
      // Flow is complete — show completion on current page, don't auto-navigate
      await showFlowCompleted();
      return; // finally will still run because we're inside try
    }

    // Validate advancement — nextNodeId must differ from previousNodeId
    if (nextNodeId === previousNodeId) {
      console.error('[Next][clientActionId=' + clientActionId + '] failed: nextNodeId equals previousNodeId=' + previousNodeId);
      showToast('学习进度未能推进，请稍后重试', 'error');
      // Refresh state from server
      try {
        const r = await learningWorkflowApi.getSession(S.session_id);
        S = r.data || r;
        state.nodeRuns = S.node_runs || [];
        state.nodeId = String(S.current_node_id || previousNodeId);
      } catch {}
      updateTopbar();
      renderProgressNav();
      return; // finally will still run
    }

    // Transition to new node — URL stays the same (#/student/learning/session/:sessionId)
    archiveCurrentWorkspace(previousNode, '已完成');
    state.nodeId = nextNodeId;

    // Reset formal agent state for new node (guide is cleared and regenerated)
    state.guide = { phase: PHASE.IDLE, requestId: '', blocks: [], error: null };
    const guideBlocksEl = document.getElementById('lws-guide-blocks');
    if (guideBlocksEl) guideBlocksEl.innerHTML = '';
    state.formalAgent = {
      phase: PHASE.IDLE, requestId: '', agentName: '', agentType: '',
      workflowConnected: false, result: null, resultAnswer: null,
      error: null, startedAtMs: null, completedAtMs: null,
      elapsedMs: 0, timerId: null,
    };
    currentRequestId = null;

    const teachingEl = document.getElementById('lws-teaching-result');
    if (teachingEl) teachingEl.innerHTML = '';
    hideEl('lws-agent-status-bar');

    updateTopbar();
    renderProgressNav();
    renderKnowledgePointOverview();

    // Scroll to content top
    const mainEl = document.getElementById('lws-main');
    if (mainEl) mainEl.scrollIntoView({ behavior: 'smooth' });

    // Execute the new current node
    await execCurrentNode(S.session_id);
  } catch (e) {
    console.error('[NextAction] error:', e.message);
    showToast('操作失败: ' + escHtml(e.message || ''), 'error');
    // Refresh state from server on error
    try {
      const r = await learningWorkflowApi.getSession(S.session_id);
      S = r.data || r;
      state.nodeRuns = S.node_runs || [];
      state.nodeId = String(S.current_node_id || '');
    } catch {}
    updateTopbar();
    renderProgressNav();
  } finally {
    setAction(null, false);
    // Restore button state
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = '继续下一步'; }
  }
}

// Show flow completion on current page instead of navigating away
async function showFlowCompleted() {
  const el = document.getElementById('lws-teaching-result');
  if (el) {
    el.innerHTML = `<div class="lws-completed-card">
      <div class="lws-completed-icon">🎉</div>
      <h3>学习流已完成</h3>
      <p>恭喜你完成了本轮学习！</p>
      <div class="lws-completed-actions" style="margin-top:16px;display:flex;gap:12px;">
        <button class="lws-btn lws-btn-primary" id="lws-btn-view-summary">查看学习总结</button>
        <button class="lws-btn lws-btn-outline" id="lws-btn-back-to-flows">返回学习流中心</button>
      </div>
    </div>`;
    document.getElementById('lws-btn-view-summary').onclick = () => {
      navigateTo('#/student/learning/session/' + S.session_id + '/summary');
    };
    document.getElementById('lws-btn-back-to-flows').onclick = () => {
      navigateTo('#/student/learning-flows');
    };
  }
  setFormalPhase(PHASE.COMPLETED, { agentName: '学习流完成' });
  const nextBtn = document.getElementById('lws-btn-next');
  if (nextBtn) { nextBtn.style.display = 'none'; }
  const skipBtn = document.getElementById('lws-btn-skip');
  if (skipBtn) { skipBtn.style.display = 'none'; }
}

async function handleSkip() {
  if (!S || !state.nodeId) return;

  const node = (S.runtime_graph_json?.nodes || []).find(n => n.id === state.nodeId);
  const nodeLabel = node ? (node.title || NODE_LABELS[node.type] || node.type) : '当前节点';

  showModal({
    title: '跳过节点',
    content: `<p>确定要跳过「<strong>${escHtml(nodeLabel)}</strong>」吗？</p><p class="lws-modal-hint">跳过可能影响学习效果。</p>
      <div class="lws-skip-reasons">
        <label class="lws-skip-option"><input type="radio" name="skip-reason" value="already_mastered" checked> 已经掌握</label>
        <label class="lws-skip-option"><input type="radio" name="skip-reason" value="temporarily_not_needed"> 暂时不需要</label>
        <label class="lws-skip-option"><input type="radio" name="skip-reason" value="too_difficult"> 内容过难</label>
        <label class="lws-skip-option"><input type="radio" name="skip-reason" value="content_failed"> 内容生成失败</label>
        <label class="lws-skip-option"><input type="radio" name="skip-reason" value="other"> 其他</label>
      </div>`,
    confirmText: '确认跳过',
    onConfirm: async () => {
      const reasonEl = document.querySelector('input[name="skip-reason"]:checked');
      const reason = reasonEl ? reasonEl.value : '学生主动跳过';
      closeModal();
      const execution = state.execution;
      const skippedNodeId = String(state.nodeId);
      setAction('skip', true);
      abortBoth();

      try {
        const response = await fetch(apiUrl(`/learning-workflows/sessions/${S.session_id}/skip`), {
          ...authFetchOptions('POST', {
            nodeId: skippedNodeId,
            reason,
            expectedNodeExecutionId: execution?.nodeRunId || null,
            operationId: `skip_${S.session_id}_${execution?.nodeRunId || skippedNodeId}`,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.code !== 0) throw new Error(result.message || '跳过节点失败');
        const outcome = result.data || result;
        const snapshot = outcome.session || outcome;
        const skippedNode = (S.runtime_graph_json?.nodes || []).find((item) => String(item.id) === skippedNodeId);
        archiveCurrentWorkspace(skippedNode, '已跳过');

        applySessionSnapshot(snapshot);
        state.nodeId = S.current_node_id;

        // 只清理新节点的工作区，历史节点在上方折叠保留。
        state.guide = { phase: PHASE.IDLE, requestId: '', blocks: [], error: null };
        document.getElementById('lws-guide-blocks').innerHTML = '';
        resetCurrentNodeState();

        updateTopbar();
        renderProgressNav();
        renderKnowledgePointOverview();
        if (S.status === 'COMPLETED' || !S.current_node_id) await showFlowCompleted();
        else await execCurrentNode(S.session_id);
      } catch (e) {
        showToast('跳过失败: ' + escHtml(e.message || ''), 'error');
      } finally {
        setAction(null, false);
      }
    },
  });
}

async function handleRetry() {
  if (!S || !state.nodeId) return;
  setAction('retry', true);

  try {
    abortBoth();
    await fetch(apiUrl(`/learning-workflows/sessions/${S.session_id}/retry`), {
      ...authFetchOptions('POST', { nodeId: state.nodeId }),
    });

    const r = await learningWorkflowApi.getSession(S.session_id);
    S = r.data || r;
    state.nodeRuns = S.node_runs || [];
    state.formalAgent = { phase: PHASE.IDLE, requestId: '', agentName: '', agentType: '', workflowConnected: false, result: null, resultAnswer: null, error: null, startedAt: null, completedAt: null };

    updateTopbar();
    renderProgressNav();
    renderKnowledgePointOverview();
    await execCurrentNode(S.session_id);
  } catch (e) {
    showToast('重试失败: ' + escHtml(e.message || ''), 'error');
  } finally {
    setAction(null, false);
  }
}

async function handleReturn() {
  if (guideActive || formalActive) {
    showModal({
      title: '返回学习流中心',
      content: '<p>当前学习内容仍在生成。返回后会暂停本次学习，并保存当前进度。</p>',
      confirmText: '暂停并返回',
      cancelText: '继续学习',
      onConfirm: async () => {
        closeModal();
        abortBoth();
        try { await learningWorkflowApi.pauseSession(S.session_id); } catch {}
        navigateTo('#/student/learning-flows');
      },
      onCancel: () => closeModal(),
    });
  } else {
    abortBoth();
    navigateTo('#/student/learning-flows');
  }
}

// ========================
// 节点推进
// ========================

async function advanceAndExec(sessionId) {
  const currentNodeIdBefore = state.nodeId;

  try {
    // Step 1: Save current node result (idempotent — backend skips if already saved)
    await saveNodeResult(sessionId, currentNodeIdBefore);

    // Step 2: Always refresh session from server to get latest currentNodeId
    let r;
    try { r = await learningWorkflowApi.getSession(sessionId); } catch {
      r = await learningWorkflowApi.getSession(sessionId);
    }
    S = r.data || r;
    state.sessionPhase = S.status;
    state.nodeRuns = S.node_runs || [];
    const nextNodeId = S.current_node_id;

    console.log('[AdvanceAction] request sessionId=' + sessionId + ' nodeId=' + currentNodeIdBefore);
    console.log('[AdvanceAction] nextNodeId=' + nextNodeId);

    // Step 3: Validate advancement
    if (S.status === 'COMPLETED') {
      await completeAndGo(sessionId);
      return;
    }

    if (!nextNodeId) {
      showToast('学习流已完成', 'success');
      await completeAndGo(sessionId);
      return;
    }

    if (String(nextNodeId) === String(currentNodeIdBefore)) {
      console.error('[AdvanceAction] failed: nextNodeId equals currentNodeId');
      showToast('学习进度未能推进，请稍后重试', 'error');
      return;
    }

    // Step 4: Clean old node state and transition
    state.nodeId = String(nextNodeId);
    resetCurrentNodeState();

    updateTopbar();
    renderProgressNav();
    renderKnowledgePointOverview();

    // Scroll to top
    const mainEl = document.getElementById('lws-main');
    if (mainEl) mainEl.scrollIntoView({ behavior: 'smooth' });

    // Step 5: Execute the new current node
    await execCurrentNode(sessionId);
  } catch (e) {
    console.error('[AdvanceAction] error:', e.message);
    // Refresh state from server on error
    try {
      const r = await learningWorkflowApi.getSession(sessionId);
      S = r.data || r;
      state.nodeRuns = S.node_runs || [];
      state.nodeId = S.current_node_id;
    } catch {}
    updateTopbar();
    renderProgressNav();
    await execCurrentNode(sessionId);
  }
}

async function completeAndGo(sessionId) {
  try { await learningWorkflowApi.completeSession(sessionId); } catch {}
  navigateTo('#/student/learning/session/' + sessionId + '/summary');
}

// ========================
// 暂停页面
// ========================

function showPaused() {
  hideSkeleton();
  hideEl('lws-content-area');
  hideEl('lws-agent-status-bar');
  showEl('lws-paused-state');

  // Don't hide guide panel if guide blocks exist — preserve them for refresh
  const hasGuideBlocks = state && state.guide && state.guide.blocks && state.guide.blocks.length > 0;
  if (!hasGuideBlocks) {
    hideEl('lws-guide-panel');
  }

  const el = document.getElementById('lws-paused-state');
  if (el) {
    const guideStatusText = hasGuideBlocks
      ? '当前进度已保存，继续学习后将从本节点恢复。'
      : '学习已暂停，当前进度已经保存。继续学习后将恢复本节点引导。';
    el.innerHTML = `<div class="lws-paused-card">
      <div class="lws-paused-icon">⏸</div><h3>学习已暂停</h3>
      <p>${guideStatusText}</p>
      <button class="lws-btn lws-btn-primary" data-learning-action="pause">继续学习</button>
    </div>`;
  }

  const pauseBtn = document.getElementById('lws-pause-btn');
  if (pauseBtn) { pauseBtn.textContent = '继续学习'; pauseBtn.className = 'lws-btn lws-btn-primary lws-btn-sm'; }
}

// ========================
// 全局错误
// ========================

function showGlobalError(message, showRetry) {
  hideSkeleton();
  hideEl('lws-content-area');
  hideEl('lws-guide-panel');
  hideEl('lws-progress-nav');
  showEl('lws-error-state');
  const el = document.getElementById('lws-error-state');
  if (el) {
    el.innerHTML = `<div class="lws-error-card">
      <div class="lws-error-icon">!</div><div class="lws-error-info">
      <div class="lws-error-title">会话加载失败</div>
      <div class="lws-error-message">${escHtml(message)}</div></div>
      ${showRetry ? '<button class="lws-btn lws-btn-primary" id="lws-global-retry">重新加载</button>' : ''}
      <button class="lws-btn lws-btn-outline" data-learning-action="return">返回学习流中心</button>
    </div>`;
    document.getElementById('lws-global-retry')?.addEventListener('click', () => initSession(state?.sessionId));
  }
}

// ========================
// Modal 弹窗
// ========================

function showModal({ title, content, confirmText, cancelText, onConfirm, onCancel }) {
  const overlay = document.getElementById('lws-modal-overlay');
  const modal = document.getElementById('lws-modal');
  if (!overlay || !modal) return;

  modal.innerHTML = `<div class="lws-modal-header">
    <h3 class="lws-modal-title">${escHtml(title)}</h3>
  </div>
  <div class="lws-modal-body">${content}</div>
  <div class="lws-modal-footer">
    ${cancelText ? `<button class="lws-btn lws-btn-ghost" id="lws-modal-cancel">${escHtml(cancelText)}</button>` : ''}
    <button class="lws-btn lws-btn-primary" id="lws-modal-confirm">${escHtml(confirmText || '确认')}</button>
  </div>`;

  document.getElementById('lws-modal-confirm').onclick = onConfirm;
  if (cancelText) document.getElementById('lws-modal-cancel').onclick = onCancel || closeModal;

  overlay.style.display = 'flex';
}

function closeModal() {
  const overlay = document.getElementById('lws-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ========================
// 工具函数
// ========================

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function showEl(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hideEl(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function escHtml(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
