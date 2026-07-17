// 学习驾驶舱 v4 — DisciMind 学生端
// 架构：百炼引导老师 + 教学 Agent 并行执行
// 核心改进：JSON 解析渲染、统一状态管理、事件委托、语句块引导

import { learningWorkflowApi, streamLearningSessionAssistant } from '../api/learning-workflows.js';
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
import { LearningNarrationClient } from '../services/learning-narration.js';
import { collectNarrationSegments } from '../services/learning-speech-segments.js';
import { LearningPdfViewer } from '../services/learning-pdf-viewer.js';
import { studentLearningPlanApi } from '../api/student-learning-plans.js';
import { createLearningCardDeck } from '../components/learning-card-deck.js';

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
let completionChat = { messages: [], sending: false, abortController: null };
let narrationClient = null;
let narrationState = 'idle';
let lastNarrationKey = '';
let narrationSnapshot = { state: 'idle', hasSession: false, currentIndex: -1, total: 0, progress: 0 };
let narrationObserver = null;
let narrationOriginalVisible = true;
let narrationMiniMinimized = false;
let progressNavState = null;
let lastProgressNodeId = null;
let pdfViewer = null;
let pdfSources = [];
let pdfOpenDocuments = [];
let activePdfDocumentId = '';
let pdfDocumentSerial = 0;
let pdfSwitchVersion = 0;
let pdfSwitchPromise = Promise.resolve();
let pdfControlsCleanup = null;
let pdfSourcesLoaded = false;
let learningCardDeck = null;

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
  if (state?.execution?.nodeId && String(state.execution.nodeId) !== String(node.id)) {
    narrationClient?.stop({ cancel: true }).catch(() => {});
    lastNarrationKey = '';
  }
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
  const page = document.getElementById('lws-page');
  if (page) {
    const planId = S.learning_plan?.id || S.learningPlanId || '';
    Object.assign(page.dataset, {
      learningSessionId: String(S.session_id || state.sessionId || ''),
      learningPlanId: String(planId),
      courseId: String(S.course_id || S.course?.course_id || ''),
      knowledgePointId: String(S.knowledge_point_id || S.knowledge_point?.knowledge_point_id || ''),
      currentNodeId: String(S.current_node_id || ''),
    });
    window.dispatchEvent(new Event('discimind:learning-context'));
  }
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

  if (info.executionStatus === 'WAITING_INPUT') {
    if (!fa.completedAtMs) fa.completedAtMs = Date.now();
    clearFormalAgentTimer();
    if (fa.startedAtMs) fa.elapsedMs = fa.completedAtMs - fa.startedAtMs;
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
  completionChat.abortController?.abort();
  completionChat = { messages: [], sending: false, abortController: null };
  narrationClient?.destroy().catch(() => {});
  narrationClient = new LearningNarrationClient();
  narrationState = 'idle';
  narrationSnapshot = { state: 'idle', hasSession: false, currentIndex: -1, total: 0, progress: 0 };
  narrationOriginalVisible = true;
  narrationMiniMinimized = false;
  lastProgressNodeId = null;
  pdfViewer?.destroy().catch(() => {});
  pdfViewer = null;
  pdfSources = [];
  pdfOpenDocuments = [];
  activePdfDocumentId = '';
  pdfDocumentSerial = 0;
  pdfSwitchVersion = 0;
  pdfSwitchPromise = Promise.resolve();
  pdfSourcesLoaded = false;
  pdfControlsCleanup?.();
  pdfControlsCleanup = null;
  lastNarrationKey = '';
  learningCardDeck?.destroy();
  learningCardDeck = null;

  const html = buildPageShell();
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: html, user });
  learningCardDeck = createLearningCardDeck(document.getElementById('lws-learning-card-deck'), {
    onNotice: (message, type = 'warning') => showToast(message, type),
  });
  document.querySelector('.student-dashboard-wrapper')?.classList.add('learning-session-layout');
  const resetInitialScroll = () => window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  resetInitialScroll();
  requestAnimationFrame(resetInitialScroll);
  setTimeout(resetInitialScroll, 0);

  setTimeout(() => bindEvents(), 50);
  setTimeout(() => initializeNarration(), 60);
  initSession(sessionId);
}

function buildPageShell() {
  return `<div class="lws-page" id="lws-page">
    <div class="lws-progress-trigger" id="lws-progress-trigger" aria-hidden="true"></div>
    <div class="lws-study-layout" id="lws-study-layout"><section class="lws-study-column">
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
          <button class="lws-btn lws-btn-outline lws-btn-sm" data-learning-action="immersive-toggle" id="lws-immersive-toggle" aria-pressed="false">沉浸学习</button>
          <button class="lws-btn lws-btn-outline lws-btn-sm" data-learning-action="pdf-toggle" id="lws-pdf-toggle">参考资料</button>
          <button class="lws-progress-pin" data-learning-action="progress-pin" id="lws-progress-pin" type="button" aria-label="锁定进度导航">锁定</button>
          <button class="lws-progress-collapse" data-learning-action="progress-toggle" id="lws-progress-toggle" type="button" aria-label="收起进度导航">收起</button>
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
        <div class="lws-narration" id="lws-narration">
          <div class="lws-narration-copy"><span id="lws-narration-title">语音伴学</span><span id="lws-narration-subtitle">未开启语音伴学</span><small id="lws-narration-position">第 0 / 0 段</small><div class="lws-narration-progress"><i id="lws-narration-progress"></i></div></div>
          <div class="lws-narration-controls">
            <button type="button" data-learning-action="narration-toggle" id="lws-narration-toggle">开启语音伴学</button>
            <button type="button" data-learning-action="narration-play-pause" data-narration-play-pause disabled>播放</button>
            <button type="button" data-learning-action="narration-stop" disabled>停止</button>
            <button type="button" data-learning-action="narration-replay" disabled>重播</button>
            <button type="button" data-learning-action="narration-previous" disabled>上一段</button>
            <button type="button" data-learning-action="narration-next" disabled>下一段</button>
            <select id="lws-narration-rate" data-narration-rate aria-label="语音倍速"><option value="0.75">0.75×</option><option value="1" selected>1.0×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2.0×</option></select>
            <label><input type="checkbox" id="lws-narration-subtitles" checked> 字幕</label>
          </div>
        </div>
      </div>
      <div class="lws-agent-status-bar" id="lws-agent-status-bar" style="display:none"></div>
      <div id="lws-learning-card-deck" hidden></div>
       <div class="lws-content-area" id="lws-content-area" style="display:none">
         <div class="lws-node-history" id="lws-node-history"></div>
         <div class="lws-multimodal-container" id="lws-multimodal-container" style="display:none"></div>
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
    </div></section>
    <button type="button" class="lws-pdf-backdrop" id="lws-pdf-backdrop" data-learning-action="pdf-close" aria-label="关闭 PDF 阅读器" hidden></button>
    <aside class="lws-pdf-panel" id="lws-pdf-panel" aria-hidden="true" aria-label="PDF 连续阅读器" hidden>
      <div class="lws-pdf-resizer" id="lws-pdf-resizer" aria-label="拖动调整阅读器宽度"></div>
      <header class="lws-pdf-header">
        <div class="lws-pdf-title"><b>参考资料</b><span id="lws-pdf-file-name">请选择 PDF</span></div>
        <select id="lws-pdf-source" aria-label="添加 PDF 来源"><option value="">添加计划产物或知识库 PDF</option></select>
        <label class="lws-pdf-local-picker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4m0 0L8 8m4-4 4 4M5 15v4h14v-4"/></svg><span>添加 PDF</span><input id="lws-pdf-local" type="file" accept="application/pdf,.pdf" multiple hidden></label>
        <button type="button" class="lws-pdf-icon-btn" data-learning-action="pdf-close" aria-label="关闭阅读器" title="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </header>
      <div class="lws-pdf-tabs" id="lws-pdf-tabs" role="tablist" aria-label="已打开的 PDF" hidden></div>
      <div class="lws-pdf-local-note" id="lws-pdf-local-note" hidden>仅在当前浏览器会话预览，不会上传到知识库。</div>
      <div class="lws-pdf-toolbar">
        <button type="button" class="lws-pdf-icon-btn" data-learning-action="pdf-prev" aria-label="上一页" title="上一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></button>
        <label class="lws-pdf-page-field"><input id="lws-pdf-page-input" type="number" min="1" value="1" inputmode="numeric" aria-label="跳转页码"><span id="lws-pdf-page-count">/ 0</span></label>
        <button type="button" class="lws-pdf-icon-btn" data-learning-action="pdf-next" aria-label="下一页" title="下一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></button>
        <i class="lws-pdf-tool-separator"></i>
        <button type="button" class="lws-pdf-icon-btn" data-learning-action="pdf-zoom-out" aria-label="缩小" title="缩小"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M8 11h6m3 6 4 4"/></svg></button>
        <span class="lws-pdf-zoom-value" id="lws-pdf-zoom-value">100%</span>
        <button type="button" class="lws-pdf-icon-btn" data-learning-action="pdf-zoom-in" aria-label="放大" title="放大"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M8 11h6m-3-3v6m6 3 4 4"/></svg></button>
        <button type="button" class="lws-pdf-fit-btn" data-learning-action="pdf-fit" title="根据阅读区宽度缩放"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 12h8"/></svg><span>适合宽度</span></button>
        <span class="lws-pdf-continuous" title="页面按顺序连续排列">连续</span>
      </div>
      <div class="lws-pdf-drop-overlay" id="lws-pdf-drop-overlay" hidden>松开即可添加 PDF，可一次拖入多个文件</div><div class="lws-pdf-viewport" data-pdf-viewport tabindex="0"><div class="lws-pdf-empty" id="lws-pdf-status">请选择上方资料，或将 PDF 拖到这里</div><div class="lws-pdf-pages" data-pdf-pages></div></div><output class="lws-pdf-zoom-hint" data-pdf-zoom-hint aria-live="polite"></output>
      <footer class="lws-pdf-footer"><button type="button" data-learning-action="pdf-download"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>下载</button><button type="button" data-learning-action="pdf-open-window"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 4h6v6m0-6-9 9M19 13v6H5V5h6"/></svg>新窗口打开</button></footer>
    </aside></div>
    <aside class="lws-narration-mini" id="lws-narration-mini" hidden aria-label="悬浮语音播放器">
      <div class="lws-narration-mini-copy"><b id="lws-narration-mini-title">当前讲解</b><span id="lws-narration-mini-position">第 0 / 0 段</span><div class="lws-narration-progress"><i id="lws-narration-mini-progress"></i></div></div>
      <div class="lws-narration-mini-controls">
        <button type="button" data-learning-action="narration-previous" aria-label="上一段">上一段</button>
        <button type="button" data-learning-action="narration-play-pause" data-narration-play-pause aria-label="播放或暂停">播放</button>
        <button type="button" data-learning-action="narration-next" aria-label="下一段">下一段</button>
        <button type="button" data-learning-action="narration-stop">停止</button>
        <select data-narration-rate aria-label="语音倍速"><option value="0.75">0.75×</option><option value="1" selected>1.0×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2.0×</option></select>
        <button type="button" data-learning-action="narration-return">返回原位置</button>
        <button type="button" data-learning-action="narration-mini-toggle" aria-label="最小化">—</button>
      </div>
    </aside>
    <div class="lws-modal-overlay" id="lws-modal-overlay" style="display:none">
      <div class="lws-modal" id="lws-modal"></div>
    </div>
  </div>`;
}

function syncImmersiveButton() {
  const root = document.getElementById('lws-page');
  const button = document.getElementById('lws-immersive-toggle');
  const active = Boolean(root?.classList.contains('is-immersive'));
  if (!button) return;
  button.textContent = active ? '退出全屏' : '沉浸学习';
  button.setAttribute('aria-pressed', String(active));
}

async function toggleImmersiveStudy() {
  const root = document.getElementById('lws-page');
  if (!root) return;
  const entering = !root.classList.contains('is-immersive');
  root.classList.toggle('is-immersive', entering);
  document.body.classList.toggle('lws-immersive-mode', entering);
  syncImmersiveButton();
  try {
    if (entering && !document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen();
    else if (!entering && document.fullscreenElement === root && document.exitFullscreen) await document.exitFullscreen();
  } catch {
    if (entering) showToast('浏览器未允许全屏，已保留沉浸布局', 'warning');
  }
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
    if (state && state.action.submitting && !['return', 'immersive-toggle', 'pdf-toggle', 'pdf-close'].includes(action)) {
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
      case 'immersive-toggle': await toggleImmersiveStudy(); break;
      case 'narration-toggle': await toggleNarration(); break;
      case 'narration-play-pause': await toggleNarrationPlayback(); break;
      case 'narration-stop': await stopNarration(); break;
      case 'narration-replay': await narrationClient?.replay(); break;
      case 'narration-previous': await narrationClient?.playRelativeSegment(-1); break;
      case 'narration-next': await narrationClient?.playRelativeSegment(1); break;
      case 'narration-history': await startNarrationForRun(Number(actionEl.dataset.nodeRunId), 'history_replay', true); break;
      case 'narration-return': scrollToNarration(); break;
      case 'narration-mini-toggle': narrationMiniMinimized = !narrationMiniMinimized; updateNarrationMini(); break;
      case 'progress-toggle': setProgressCollapsed(!progressNavState?.collapsed, { lock: true }); break;
      case 'progress-pin': toggleProgressLock(); break;
      case 'progress-node': locateProgressNode(actionEl.dataset.nodeId); break;
      case 'current-content': document.getElementById('lws-teaching-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'pdf-toggle': await togglePdfPanel(); break;
      case 'pdf-close': await closePdfPanel(); break;
      case 'pdf-prev': await pdfViewer?.goTo(pdfViewer.pageNumber - 1); break;
      case 'pdf-next': await pdfViewer?.goTo(pdfViewer.pageNumber + 1); break;
      case 'pdf-zoom-out': await pdfViewer?.zoomBy(-0.1); break;
      case 'pdf-zoom-in': await pdfViewer?.zoomBy(0.1); break;
      case 'pdf-fit': await pdfViewer?.fit(); break;
      case 'pdf-download': pdfViewer?.download(); break;
      case 'pdf-open-window': pdfViewer?.openWindow(); break;
    }
  };

  root.addEventListener('click', handler);

  const rates = [...root.querySelectorAll('[data-narration-rate]')];
  const onRate = (event) => {
    const value = Number(event.currentTarget.value);
    rates.forEach((select) => { select.value = String(value); });
    narrationClient?.setPlaybackRate(value);
  };
  rates.forEach((rate) => rate.addEventListener('change', onRate));
  const subtitles = document.getElementById('lws-narration-subtitles');
  const onSubtitles = () => narrationClient?.setSubtitles(subtitles.checked);
  subtitles?.addEventListener('change', onSubtitles);
  pdfControlsCleanup = initPdfControls(root);

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
  const fullscreenHandler = () => {
    if (document.fullscreenElement === root) {
      root.classList.add('is-immersive');
      document.body.classList.add('lws-immersive-mode');
    } else if (root.classList.contains('is-immersive')) {
      root.classList.remove('is-immersive');
      document.body.classList.remove('lws-immersive-mode');
    }
    syncImmersiveButton();
  };
  document.addEventListener('fullscreenchange', fullscreenHandler);

  sessionEventCleanup = () => {
    root.removeEventListener('click', handler);
    delete root.dataset.learningEventsBound;
    if (modalOverlay) {
      modalOverlay.removeEventListener('click', modalClickHandler);
    }
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    document.removeEventListener('fullscreenchange', fullscreenHandler);
    rates.forEach((rate) => rate.removeEventListener('change', onRate));
    subtitles?.removeEventListener('change', onSubtitles);
    pdfControlsCleanup?.();
    pdfControlsCleanup = null;
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
  completionChat.abortController?.abort();
  completionChat.abortController = null;
  completionChat.sending = false;
  narrationClient?.destroy().catch(() => {});
  narrationClient = null;
  pdfViewer?.destroy().catch(() => {});
  pdfViewer = null;
  learningCardDeck?.destroy();
  learningCardDeck = null;

  // Clear all timers
  clearFormalAgentTimer();
  clearGuideTimer();

  // Clear sticky observer
  if (stickyObserver) { stickyObserver.disconnect(); stickyObserver = null; }
  if (narrationObserver) { narrationObserver.disconnect(); narrationObserver = null; }
  cleanupProgressNavigation();
  const sentinel = document.getElementById('lws-sticky-sentinel');
  if (sentinel) sentinel.remove();
  const root = document.getElementById('lws-page');
  root?.classList.remove('is-immersive');
  document.body.classList.remove('lws-immersive-mode');
  if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => {});
}

// ========================
// 实时语音导学（完全旁路，不参与学习节点状态）
// ========================

const NARRATION_STATUS = {
  idle: '语音伴学待开启', preparing: '正在准备讲解', playing: '正在播放', paused: '已暂停',
  stopped: '已停止', completed: '语音已完成', error: '语音暂时不可用',
};

async function initializeNarration() {
  if (!narrationClient) return;
  const client = narrationClient;
  client.addEventListener('settings', ({ detail }) => {
    if (client !== narrationClient) return;
    const toggle = document.getElementById('lws-narration-toggle');
    const subtitles = document.getElementById('lws-narration-subtitles');
    if (subtitles) subtitles.checked = client.subtitlesEnabled;
    document.querySelectorAll('[data-narration-rate]').forEach((select) => { select.value = String(client.playbackRate); });
    if (!detail.enabled) {
      if (toggle) { toggle.disabled = true; toggle.textContent = '当前浏览器不支持语音'; }
      setNarrationUi('error', '当前浏览器和实时语音服务均不可用');
    } else if (client.enabledByUser && toggle) {
      toggle.textContent = '关闭自动伴学';
      setNarrationUi('idle', detail.remoteEnabled ? '实时语音已就绪，点击播放开始' : '浏览器语音已就绪，点击播放开始');
    } else {
      setNarrationUi('idle', detail.remoteEnabled ? '可使用实时语音讲解' : '可使用浏览器语音讲解');
    }
  });
  client.addEventListener('state', ({ detail }) => { if (client === narrationClient) setNarrationUi(detail.state, detail.message, detail); });
  client.addEventListener('segment', ({ detail }) => {
    if (client !== narrationClient) return;
    const title = document.getElementById('lws-narration-title');
    const subtitle = document.getElementById('lws-narration-subtitle');
    if (title) title.textContent = `正在讲解：${detail.title || currentNodeTitle()}`;
    if (subtitle) { subtitle.textContent = detail.subtitle || ''; subtitle.hidden = !client.subtitlesEnabled; }
    highlightNarrationSegment(detail.anchorId);
    narrationSnapshot = { ...narrationSnapshot, ...detail };
    updateNarrationMini();
  });
  client.addEventListener('subtitles', ({ detail }) => {
    const subtitle = document.getElementById('lws-narration-subtitle');
    if (subtitle) subtitle.hidden = !detail.enabled;
  });
  client.addEventListener('error', ({ detail }) => setNarrationUi('error', detail.message));
  try { await client.loadSettings(); initNarrationObserver(); } catch { setNarrationUi('error', '语音暂时不可用，文字内容不受影响。'); }
}

function currentNodeTitle() {
  const node = (S?.runtime_graph_json?.nodes || []).find((item) => String(item.id) === String(state?.nodeId));
  return node?.title || NODE_LABELS[node?.type] || '当前学习内容';
}

function setNarrationUi(nextState, message, snapshot = {}) {
  narrationState = nextState;
  narrationSnapshot = { ...narrationSnapshot, ...snapshot, state: nextState, hasSession: narrationClient?.hasSession || false, currentIndex: narrationClient?.currentIndex ?? -1, total: narrationClient?.totalSegments || 0, progress: narrationClient?.progress || 0 };
  const subtitle = document.getElementById('lws-narration-subtitle');
  if (subtitle && !message && nextState !== 'playing') subtitle.textContent = NARRATION_STATUS[nextState] || '语音伴学';
  if (subtitle && message) subtitle.textContent = message;
  document.querySelectorAll('[data-narration-play-pause]').forEach((playPause) => {
    playPause.disabled = nextState === 'error' && !narrationClient?.enabledByUser;
    playPause.textContent = nextState === 'paused' ? '继续' : ['playing', 'preparing'].includes(nextState) ? '暂停' : '播放';
  });
  document.querySelectorAll('[data-learning-action="narration-stop"], [data-learning-action="narration-replay"], [data-learning-action="narration-previous"], [data-learning-action="narration-next"]').forEach((button) => {
    button.disabled = !narrationClient?.hasSession;
  });
  const current = Math.max(0, (narrationClient?.currentIndex ?? -1) + 1);
  const total = narrationClient?.totalSegments || 0;
  setText('lws-narration-position', `第 ${current} / ${total} 段`);
  const progress = narrationClient?.progress || 0;
  const bar = document.getElementById('lws-narration-progress');
  if (bar) bar.style.width = `${progress}%`;
  updateNarrationMini();
}

async function toggleNarration() {
  if (!narrationClient?.settings?.enabled) return;
  const toggle = document.getElementById('lws-narration-toggle');
  try {
    if (!narrationClient.enabledByUser) {
      await narrationClient.enable();
      if (toggle) toggle.textContent = '关闭自动伴学';
      await maybeStartNarration(null, 'node_content', true);
    } else {
      narrationClient.disable();
      lastNarrationKey = '';
      if (toggle) toggle.textContent = '开启语音伴学';
    }
  } catch (error) { setNarrationUi('error', error.message); }
}

async function toggleNarrationPlayback() {
  if (!narrationClient) return;
  if (!narrationClient.hasSession && narrationClient.enabledByUser) return maybeStartNarration(null, 'node_content', true);
  if (narrationState === 'paused') await narrationClient.resume();
  else if (['playing', 'preparing'].includes(narrationState)) await narrationClient.pause();
  else if (narrationState === 'completed') await narrationClient.replay();
  else if (narrationState === 'stopped') await narrationClient.replay();
  else await maybeStartNarration(null, 'node_content', true);
}

async function stopNarration() { lastNarrationKey = ''; await narrationClient?.stop({ cancel: true }); }

async function startNarrationForRun(nodeRunId, purpose = 'node_content', force = false) {
  if (!narrationClient?.enabledByUser || !nodeRunId) return;
  const nodeRun = (S?.node_runs || []).find((run) => Number(run.node_run_id) === Number(nodeRunId));
  if (!nodeRun) return;
  const key = `${nodeRunId}:${purpose}`;
  if (!force && lastNarrationKey === key) return;
  lastNarrationKey = key;
  try {
    await narrationClient.start({
      sessionId: Number(S.session_id), nodeRunId: Number(nodeRunId),
      contentBlockId: `node_${nodeRunId}_main`, purpose,
      fallbackSegments: collectCurrentNarrationSegments(),
    });
  } catch (error) { setNarrationUi('error', error.message || '语音暂时不可用，文字内容不受影响。'); }
}

async function maybeStartNarration(node, purpose = 'node_content', force = false) {
  if (!narrationClient?.enabledByUser) return;
  const nodeRunId = state?.execution?.nodeRunId || S?.currentNodeRun?.node_run_id
    || (S?.node_runs || []).find((run) => String(run.node_id) === String(node?.id || state?.nodeId))?.node_run_id;
  return startNarrationForRun(Number(nodeRunId), purpose, force);
}

function collectCurrentNarrationSegments() {
  return collectNarrationSegments([
    document.getElementById('lws-guide-blocks'),
    document.getElementById('lws-teaching-result'),
    document.getElementById('lws-kp-overview'),
  ]);
}

function highlightNarrationSegment(anchorId) {
  document.querySelectorAll('.is-narrating').forEach((element) => element.classList.remove('is-narrating'));
  if (!anchorId) return;
  const element = document.querySelector(`[data-narration-anchor="${CSS.escape(String(anchorId))}"]`);
  element?.classList.add('is-narrating');
}

function initNarrationObserver() {
  narrationObserver?.disconnect();
  const original = document.getElementById('lws-narration');
  if (!original) return;
  narrationObserver = new IntersectionObserver(([entry]) => {
    narrationOriginalVisible = entry.isIntersecting;
    if (entry.isIntersecting) narrationMiniMinimized = false;
    updateNarrationMini();
  }, { threshold: [0.05, 0.5] });
  narrationObserver.observe(original);
}

function updateNarrationMini() {
  const mini = document.getElementById('lws-narration-mini');
  if (!mini) return;
  const show = Boolean(narrationClient?.hasSession && narrationState !== 'idle' && !narrationOriginalVisible);
  mini.hidden = !show;
  mini.classList.toggle('is-minimized', narrationMiniMinimized);
  setText('lws-narration-mini-title', narrationClient?.currentSegment?.title || currentNodeTitle());
  const current = Math.max(0, (narrationClient?.currentIndex ?? -1) + 1);
  const total = narrationClient?.totalSegments || 0;
  setText('lws-narration-mini-position', `第 ${current} / ${total} 段 · ${narrationClient?.playbackRate || 1}×`);
  const bar = document.getElementById('lws-narration-mini-progress');
  if (bar) bar.style.width = `${narrationClient?.progress || 0}%`;
}

function scrollToNarration() {
  narrationMiniMinimized = false;
  document.getElementById('lws-narration')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ========================
// 右侧 PDF 对照阅读（PDF.js + 受保护文件 Blob）
// ========================

const PDF_PANEL_STATE_KEY = 'discimind:learning-pdf-panel';

function readPdfPanelState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PDF_PANEL_STATE_KEY) || '{}');
    return { width: Math.max(360, Math.min(520, Number(parsed.width) || 430)), sourceId: String(parsed.sourceId || '') };
  } catch { return { width: 430, sourceId: '' }; }
}

function savePdfPanelState(patch = {}) {
  const current = readPdfPanelState();
  try { localStorage.setItem(PDF_PANEL_STATE_KEY, JSON.stringify({ ...current, ...patch })); } catch {}
}

function currentPdfDocument() {
  return pdfOpenDocuments.find(item => item.id === activePdfDocumentId) || null;
}

function renderPdfTabs() {
  const tabs = document.getElementById('lws-pdf-tabs');
  if (!tabs) return;
  tabs.hidden = pdfOpenDocuments.length === 0;
  tabs.innerHTML = pdfOpenDocuments.map(item => `<span class="lws-pdf-tab${item.id === activePdfDocumentId ? ' is-active' : ''}" role="presentation">
    <button type="button" role="tab" aria-selected="${item.id === activePdfDocumentId}" data-pdf-document="${escAttr(item.id)}" title="${escAttr(item.name)}">${escHtml(item.name)}</button>
    <button type="button" class="lws-pdf-tab-close" data-pdf-document-close="${escAttr(item.id)}" aria-label="关闭 ${escAttr(item.name)}" title="关闭此 PDF">×</button>
  </span>`).join('');
}

function captureActivePdfView() {
  const item = currentPdfDocument();
  if (!item || !pdfViewer?.document) return;
  item.view = pdfViewer.snapshotView();
  if (pdfViewer.blob && !item.source.file) item.source = { ...item.source, file: pdfViewer.blob };
}

function pdfDocumentId(source) {
  if (source.type !== 'local' && source.id) return `server:${source.id}`;
  pdfDocumentSerial += 1;
  return `local:${Date.now()}:${pdfDocumentSerial}`;
}

async function switchPdfDocument(documentId, { force = false } = {}) {
  const next = pdfOpenDocuments.find(item => item.id === documentId);
  if (!next || !pdfViewer) return;
  if (!force && activePdfDocumentId === documentId && pdfViewer.document) return;
  captureActivePdfView();
  activePdfDocumentId = documentId;
  renderPdfTabs();
  const version = ++pdfSwitchVersion;
  pdfSwitchPromise = pdfSwitchPromise.catch(() => {}).then(async () => {
    if (version !== pdfSwitchVersion || activePdfDocumentId !== documentId) return;
    try {
      const savedView = { ...next.view };
      await pdfViewer.load(next.source);
      if (version !== pdfSwitchVersion || activePdfDocumentId !== documentId) return;
      if (pdfViewer.blob && !next.source.file) next.source = { ...next.source, file: pdfViewer.blob };
      await pdfViewer.restoreView(savedView);
      const select = document.getElementById('lws-pdf-source');
      if (select) select.value = '';
      savePdfPanelState({ sourceId: next.source.type === 'local' ? '' : String(next.source.id || '') });
      renderPdfTabs();
    } catch (error) {
      if (version === pdfSwitchVersion) showToast(error.message || 'PDF 加载失败', 'error');
    }
  });
  return pdfSwitchPromise;
}

async function addPdfDocument(source, { activate = true } = {}) {
  const id = pdfDocumentId(source);
  const existing = pdfOpenDocuments.find(item => item.id === id);
  if (existing) return activate ? switchPdfDocument(existing.id) : existing;
  const item = { id, name: source.name || '参考资料.pdf', source: { ...source }, view: {} };
  pdfOpenDocuments.push(item);
  renderPdfTabs();
  if (activate) await switchPdfDocument(item.id);
  return item;
}

async function addLocalPdfFiles(files) {
  const incoming = [...(files || [])];
  const accepted = incoming.filter(file => file instanceof Blob && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')));
  if (!accepted.length) {
    if (incoming.length) showToast('请拖入有效的 PDF 文件', 'error');
    return;
  }
  let last = null;
  for (const file of accepted) last = await addPdfDocument({ type: 'local', name: file.name, file }, { activate: false });
  if (last) await switchPdfDocument(last.id);
  if (accepted.length > 1) showToast(`已添加 ${accepted.length} 个 PDF，可通过标签切换`, 'success');
}

async function removePdfDocument(documentId) {
  const index = pdfOpenDocuments.findIndex(item => item.id === documentId);
  if (index < 0) return;
  const wasActive = activePdfDocumentId === documentId;
  if (wasActive) captureActivePdfView();
  pdfOpenDocuments.splice(index, 1);
  if (!wasActive) { renderPdfTabs(); return; }
  pdfSwitchVersion += 1;
  const replacement = pdfOpenDocuments[Math.min(index, pdfOpenDocuments.length - 1)] || null;
  activePdfDocumentId = '';
  if (!replacement) {
    await pdfViewer?.destroy();
    updatePdfUi({ loaded: false, fileName: '' });
    renderPdfTabs();
    return;
  }
  await switchPdfDocument(replacement.id, { force: true });
}

function updatePdfUi(viewState = {}) {
  const status = document.getElementById('lws-pdf-status');
  const hasDocument = Boolean(viewState.loaded || pdfViewer?.document);
  if (status) {
    status.hidden = hasDocument && !viewState.loading && !viewState.error;
    status.textContent = viewState.error || (viewState.loading ? '正在解析 PDF…' : '请选择上方资料，或将 PDF 拖到这里');
    status.classList.toggle('is-error', Boolean(viewState.error));
  }
  setText('lws-pdf-file-name', viewState.fileName || pdfViewer?.fileName || '请选择 PDF');
  const currentPage = viewState.pageNumber || pdfViewer?.pageNumber || 1;
  const pageCount = viewState.pageCount || pdfViewer?.pageCount || 0;
  const pageInput = document.getElementById('lws-pdf-page-input');
  if (pageInput && document.activeElement !== pageInput) pageInput.value = String(currentPage);
  if (pageInput) pageInput.max = String(Math.max(1, pageCount));
  setText('lws-pdf-page-count', `/ ${pageCount}`);
  setText('lws-pdf-zoom-value', `${Math.round((viewState.scale || pdfViewer?.scale || 1) * 100)}%`);
  document.querySelector('[data-learning-action="pdf-fit"]')?.classList.toggle('is-active', Boolean(viewState.fitWidth ?? pdfViewer?.fitWidth));
  document.getElementById('lws-pdf-local-note')?.toggleAttribute('hidden', (viewState.sourceType || pdfViewer?.sourceType) !== 'local');
  const active = currentPdfDocument();
  if (active && !viewState.loading && !viewState.error && hasDocument) {
    active.view = { ...active.view, pageNumber: currentPage, scale: viewState.scale || pdfViewer?.scale || 1, fitWidth: viewState.fitWidth ?? pdfViewer?.fitWidth };
  }
  renderPdfTabs();
  document.querySelectorAll('[data-learning-action^="pdf-"]').forEach((button) => {
    const action = button.dataset.learningAction;
    if (['pdf-toggle', 'pdf-close'].includes(action)) return;
    if (action === 'pdf-prev') button.disabled = !hasDocument || (pdfViewer?.pageNumber || 1) <= 1;
    else if (action === 'pdf-next') button.disabled = !hasDocument || (pdfViewer?.pageNumber || 0) >= (pdfViewer?.pageCount || 0);
    else button.disabled = !hasDocument;
  });
}

function initPdfControls(root) {
  const panel = document.getElementById('lws-pdf-panel');
  const select = document.getElementById('lws-pdf-source');
  const localInput = document.getElementById('lws-pdf-local');
  const tabs = document.getElementById('lws-pdf-tabs');
  const dropOverlay = document.getElementById('lws-pdf-drop-overlay');
  const pageInput = document.getElementById('lws-pdf-page-input');
  const resizer = document.getElementById('lws-pdf-resizer');
  if (!panel || !select || !localInput || !tabs || !resizer) return () => {};
  pdfViewer = new LearningPdfViewer(panel, { onStateChange: updatePdfUi });
  const saved = readPdfPanelState();
  root.style.setProperty('--lws-pdf-width', `${saved.width}px`);
  let resizeFrame = 0;
  let drag = null;
  const onSource = async () => {
    const source = pdfSources.find((item) => item.id === select.value);
    if (!source) return;
    select.value = '';
    await addPdfDocument(source);
  };
  const onLocal = async () => {
    const files = localInput.files;
    if (!files?.length) return;
    await addLocalPdfFiles(files);
    localInput.value = '';
  };
  const onTabsClick = (event) => {
    const close = event.target.closest('[data-pdf-document-close]');
    if (close) { event.stopPropagation(); void removePdfDocument(close.dataset.pdfDocumentClose); return; }
    const tab = event.target.closest('[data-pdf-document]');
    if (tab) void switchPdfDocument(tab.dataset.pdfDocument);
  };
  const hasDraggedFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
  const showDropTarget = (visible) => {
    panel.classList.toggle('is-drag-over', visible);
    dropOverlay?.toggleAttribute('hidden', !visible);
  };
  const onDragOver = (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    showDropTarget(true);
  };
  const onDragLeave = (event) => {
    if (event.relatedTarget && panel.contains(event.relatedTarget)) return;
    showDropTarget(false);
  };
  const onDrop = (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    showDropTarget(false);
    void addLocalPdfFiles(event.dataTransfer?.files || []);
  };
  const onPageJump = async () => {
    if (!pdfViewer?.document) return;
    await pdfViewer.goTo(Number(pageInput?.value));
  };
  const onPageKeydown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); onPageJump(); }
  };
  const onPointerDown = (event) => {
    if (event.button !== 0 || window.innerWidth < 1180) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: panel.getBoundingClientRect().width };
    resizer.setPointerCapture?.(event.pointerId);
    panel.classList.add('is-resizing');
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = Math.max(360, Math.min(520, drag.startWidth + drag.startX - event.clientX));
    root.style.setProperty('--lws-pdf-width', `${width}px`);
    savePdfPanelState({ width: Math.round(width) });
  };
  const onPointerEnd = async (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    panel.classList.remove('is-resizing');
    resizer.releasePointerCapture?.(event.pointerId);
    if (pdfViewer?.document && pdfViewer.fitWidth) await pdfViewer.fit();
  };
  const onWindowResize = () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (pdfViewer?.document && pdfViewer.fitWidth) pdfViewer.fit().catch(() => {});
    });
  };
  select.addEventListener('change', onSource);
  localInput.addEventListener('change', onLocal);
  tabs.addEventListener('click', onTabsClick);
  panel.addEventListener('dragenter', onDragOver);
  panel.addEventListener('dragover', onDragOver);
  panel.addEventListener('dragleave', onDragLeave);
  panel.addEventListener('drop', onDrop);
  pageInput?.addEventListener('change', onPageJump);
  pageInput?.addEventListener('keydown', onPageKeydown);
  resizer.addEventListener('pointerdown', onPointerDown);
  resizer.addEventListener('pointermove', onPointerMove);
  resizer.addEventListener('pointerup', onPointerEnd);
  resizer.addEventListener('pointercancel', onPointerEnd);
  window.addEventListener('resize', onWindowResize, { passive: true });
  updatePdfUi();
  return () => {
    select.removeEventListener('change', onSource);
    localInput.removeEventListener('change', onLocal);
    tabs.removeEventListener('click', onTabsClick);
    panel.removeEventListener('dragenter', onDragOver);
    panel.removeEventListener('dragover', onDragOver);
    panel.removeEventListener('dragleave', onDragLeave);
    panel.removeEventListener('drop', onDrop);
    pageInput?.removeEventListener('change', onPageJump);
    pageInput?.removeEventListener('keydown', onPageKeydown);
    resizer.removeEventListener('pointerdown', onPointerDown);
    resizer.removeEventListener('pointermove', onPointerMove);
    resizer.removeEventListener('pointerup', onPointerEnd);
    resizer.removeEventListener('pointercancel', onPointerEnd);
    window.removeEventListener('resize', onWindowResize);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
  };
}

async function loadPdfSources() {
  if (pdfSourcesLoaded || !S) return;
  const select = document.getElementById('lws-pdf-source');
  if (!select) return;
  select.disabled = true;
  select.innerHTML = '<option value="">正在读取有权限的 PDF…</option>';
  const sources = [];
  const planId = S.learning_plan?.id || S.learningPlanId;
  try {
    if (!planId) throw new Error('学习会话未关联学习计划');
    const result = await studentLearningPlanApi.referenceMaterials(planId);
    const payload = result.data || result;
    (payload.list || []).filter(item => item.previewable && item.mimeType === 'application/pdf').forEach((item) => sources.push({
      id: item.id,
      type: item.group === 'knowledge' ? 'knowledge' : 'plan',
      name: item.fileName || item.title,
      label: `${item.group === 'pre_class' ? '课前资料' : item.group === 'knowledge' ? `知识库 · ${item.knowledgeBaseName || ''}` : '学习计划产物'} · ${item.fileName || item.title}`,
      url: item.previewUrl,
    }));
  } catch (error) { console.warn('[LearningPdf] reference materials unavailable', error.message); }
  pdfSources = sources;
  pdfSourcesLoaded = true;
  select.disabled = false;
  select.innerHTML = `<option value="">${sources.length ? '选择计划产物或知识库 PDF' : '暂无服务端 PDF，可选择本地文件'}</option>${sources.map((source) => `<option value="${escAttr(source.id)}">${escHtml(source.label)}</option>`).join('')}`;
  const savedId = readPdfPanelState().sourceId;
  if (savedId && sources.some((item) => item.id === savedId)) select.value = savedId;
}

async function togglePdfPanel() {
  const panel = document.getElementById('lws-pdf-panel');
  const page = document.getElementById('lws-page');
  const backdrop = document.getElementById('lws-pdf-backdrop');
  if (!panel || !page) return;
  if (!panel.hidden) return closePdfPanel();
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  backdrop?.removeAttribute('hidden');
  page.classList.add('is-pdf-open');
  window.dispatchEvent(new Event('discimind:float-layout'));
  document.getElementById('lws-pdf-toggle')?.setAttribute('aria-expanded', 'true');
  await loadPdfSources();
  const select = document.getElementById('lws-pdf-source');
  if (activePdfDocumentId && !pdfViewer?.document) await switchPdfDocument(activePdfDocumentId, { force: true });
  else if (select?.value && !pdfViewer?.document) select.dispatchEvent(new Event('change'));
  requestAnimationFrame(() => { syncProgressOffset(); pdfViewer?.fit().catch(() => {}); });
}

async function closePdfPanel() {
  const panel = document.getElementById('lws-pdf-panel');
  const page = document.getElementById('lws-page');
  if (!panel || !page) return;
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  document.getElementById('lws-pdf-backdrop')?.setAttribute('hidden', '');
  page.classList.remove('is-pdf-open');
  window.dispatchEvent(new Event('discimind:float-layout'));
  document.getElementById('lws-pdf-toggle')?.setAttribute('aria-expanded', 'false');
  document.getElementById('lws-pdf-local').value = '';
  captureActivePdfView();
  await pdfViewer?.destroy();
  updatePdfUi({ loaded: false, fileName: '' });
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
  narrationClient?.stop({ cancel: true }).catch(() => {});
  lastNarrationKey = '';
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
    interaction: null,
  };
  currentRequestId = null;

  clearFormalAgentTimer();

  const teachingEl = document.getElementById('lws-teaching-result');
  if (teachingEl) teachingEl.innerHTML = '';

  // Remove input composer
  removeComposerInputComposer();

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
  const run = (S?.node_runs || []).find((item) => String(item.node_id) === nodeId);
  details.innerHTML = `<summary>${escHtml(node?.title || NODE_LABELS[node?.type] || '已完成节点')} · ${escHtml(label)}</summary>${run?.node_run_id ? `<button type="button" class="lws-history-narrate" data-learning-action="narration-history" data-node-run-id="${Number(run.node_run_id)}">朗读本段</button>` : ''}`;
  const content = document.createElement('div');
  content.className = 'lws-history-content';
  content.innerHTML = source.innerHTML;
  // History is a visual snapshot, never an interactive workspace. Keeping
  // copied ids makes later global lookups target the folded historical node.
  content.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  details.appendChild(content);
  history.appendChild(details);
}

function restorePersistedHistory() {
  const history = document.getElementById('lws-node-history');
  if (!history) return;
  const graphNodes = S.runtime_graph_json?.nodes || [];
  if (S?.agentMode === 'langgraph') {
    for (const run of S.node_runs || []) {
      if (!['COMPLETED', 'SKIPPED'].includes(run.status) || !run.content) continue;
      if (String(run.node_id) === String(S.current_node_id)) continue;
      const node = graphNodes.find((candidate) => String(candidate.id) === String(run.node_id));
      const details = document.createElement('details');
      details.className = 'lws-history-card';
      details.dataset.historyNode = String(run.node_id);
      details.innerHTML = `<summary>${escHtml(node?.title || NODE_LABELS[node?.type] || '学习节点')} · ${run.status === 'SKIPPED' ? '已跳过' : '已完成'}</summary><button type="button" class="lws-history-narrate" data-learning-action="narration-history" data-node-run-id="${Number(run.node_run_id)}">朗读本段</button><div class="lws-history-content">${buildUnifiedHistoryHtml(run.content)}</div>`;
      history.appendChild(details);
    }
    return;
  }
  if (!Array.isArray(S?.completedTrainerHistory)) return;
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

function buildUnifiedHistoryHtml(content) {
  const data = content?.data || {};
  if (content?.contentType === 'practice') {
    const questions = data.questions || [];
    return (data.answers || []).map((answer, index) => {
      const question = questions.find((item) => String(item.questionId || item.id) === String(answer.questionId));
      return `<article class="lws-timeline-card"><div class="lws-timeline-card-header"><span class="lws-timeline-badge question">第 ${index + 1} 题</span><span class="lws-timeline-badge ${answer.isCorrect ? 'correct' : 'incorrect'}">${answer.isCorrect ? '正确' : '错误'}</span></div><div class="lws-timeline-card-body"><div class="lws-question-stem">${escHtml(question?.stem || answer.questionStem || '')}</div><p>你的答案：${escHtml(Array.isArray(answer.studentAnswer) ? answer.studentAnswer.join(', ') : answer.studentAnswer || '')}</p><p>正确答案：${escHtml(Array.isArray(answer.correctAnswer) ? answer.correctAnswer.join(', ') : answer.correctAnswer || '')}</p>${answer.analysis || answer.feedback ? `<p class="lws-eval-analysis">${escHtml(answer.analysis || answer.feedback)}</p>` : ''}</div></article>`;
    }).join('') || '<p>该练习尚无已提交题目。</p>';
  }
  const parts = [];
  for (const section of data.sections || []) parts.push({ title: section.heading || section.title || '讲解', text: section.content || section.text || '' });
  const scalarFields = [
    ['核心概念', data.concept], ['讲解', data.content], ['小结', data.summary],
    ['诊断结论', data.diagnosis_conclusion || data.overall_assessment], ['误区说明', data.misconception],
    ['错误原因', data.root_cause || data.root_cause_analysis], ['本轮完成情况', data.completion_summary],
    ['错题情况', data.wrong_answer_summary],
  ];
  for (const [title, text] of scalarFields) if (text) parts.push({ title, text });
  for (const [title, list] of [
    ['已掌握内容', data.mastered_content], ['薄弱内容', data.weak_content],
    ['修复建议', data.repair_suggestions], ['后续建议', data.next_steps],
  ]) if (Array.isArray(list) && list.length) parts.push({ title, text: list.map((item) => `• ${item}`).join('\n') });
  return parts.map((part) => `<section class="lws-section-card"><div class="lws-section-header"><span class="lws-section-title">${escHtml(part.title)}</span></div><div class="lws-section-body">${escHtml(part.text)}</div></section>`).join('')
    || '<p>该条历史内容格式较旧，暂时无法展示。</p>';
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
    void learningCardDeck?.load(sessionId, state.nodeId);

    updateTopbar();
    hideSkeleton();
    renderProgressNav();
    renderKnowledgePointOverview();
    restorePersistedHistory();

    // 恢复已有的 guide 内容
    restoreGuideFromNodeRun();

    if (S.status === 'PAUSED') { showPaused(); return; }
    if (S.status === 'COMPLETED') {
      await loadKnowledgePointData();
      await showFlowCompleted();
      return;
    }
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
let progressRevealTimer = null;

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

function initProgressNavigation() {
  cleanupProgressNavigation();
  const compactDefault = window.innerHeight < 700;
  progressNavState = {
    mode: compactDefault ? 'collapsed' : 'expanded',
    collapsed: compactDefault,
    locked: null,
    lastScrollTop: Math.max(0, window.scrollY || document.documentElement.scrollTop || 0),
    downDistance: 0,
    upDistance: 0,
    hover: false,
    transitioning: false,
    transitionTarget: null,
    transitionTimer: null,
    holdExpandedUntil: 0,
    raf: 0,
  };
  const shell = document.getElementById('lws-sticky-shell');
  const nav = document.getElementById('lws-progress-nav');
  const onScroll = () => {
    if (!progressNavState || progressNavState.raf) return;
    progressNavState.raf = requestAnimationFrame(() => {
      if (!progressNavState) return;
      progressNavState.raf = 0;
      const nextTop = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
      const delta = nextTop - progressNavState.lastScrollTop;
      progressNavState.lastScrollTop = nextTop;
      if (Math.abs(delta) < 2 || progressNavState.locked || progressNavState.transitioning) return;
      if (nextTop < 64) {
        progressNavState.downDistance = 0;
        progressNavState.upDistance = 0;
        setProgressCollapsed(false, { reason: 'near-top' });
        return;
      }
      if (delta > 0) {
        progressNavState.upDistance = 0;
        progressNavState.downDistance += delta;
        if (!progressNavState.hover
          && performance.now() >= progressNavState.holdExpandedUntil
          && nextTop > 120
          && progressNavState.downDistance >= 48) {
          progressNavState.downDistance = 0;
          setProgressCollapsed(true, { reason: 'scroll-down' });
        }
      } else {
        progressNavState.downDistance = 0;
        progressNavState.upDistance += Math.abs(delta);
        if (progressNavState.upDistance >= 24) {
          progressNavState.upDistance = 0;
          setProgressCollapsed(false, { reason: 'scroll-up' });
        }
      }
    });
  };
  const trigger = document.getElementById('lws-progress-trigger');
  const onTrigger = () => {
    if (!progressNavState || progressNavState.locked) return;
    progressNavState.hover = true;
    progressNavState.downDistance = 0;
    progressNavState.holdExpandedUntil = Math.max(progressNavState.holdExpandedUntil, performance.now() + 600);
    setProgressCollapsed(false, { reason: 'top-hot-zone', minimumHold: 600 });
  };
  const onTriggerLeave = () => {
    if (!progressNavState) return;
    progressNavState.hover = false;
    progressNavState.downDistance = 0;
    progressNavState.lastScrollTop = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
  };
  const onResize = () => {
    syncProgressOffset();
  };
  const onTransitionEnd = (event) => {
    if (event.target === nav && ['max-height', 'opacity', 'padding-top', 'padding-bottom'].includes(event.propertyName)) finishProgressTransition();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  trigger?.addEventListener('pointerenter', onTrigger);
  trigger?.addEventListener('pointerleave', onTriggerLeave);
  nav?.addEventListener('transitionend', onTransitionEnd);
  progressNavState.cleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    trigger?.removeEventListener('pointerenter', onTrigger);
    trigger?.removeEventListener('pointerleave', onTriggerLeave);
    nav?.removeEventListener('transitionend', onTransitionEnd);
  };
  shell?.setAttribute('data-progress-state', progressNavState.mode);
  setProgressCollapsed(compactDefault, { immediate: true });
  syncProgressOffset();
}

function cleanupProgressNavigation() {
  if (progressRevealTimer) { clearTimeout(progressRevealTimer); progressRevealTimer = null; }
  if (progressNavState?.raf) cancelAnimationFrame(progressNavState.raf);
  if (progressNavState?.transitionTimer) clearTimeout(progressNavState.transitionTimer);
  progressNavState?.cleanup?.();
  progressNavState = null;
}

function setProgressCollapsed(collapsed, options = {}) {
  if (!progressNavState) return;
  const target = Boolean(collapsed);
  if (progressNavState.locked && !options.lock && !options.ignoreLock) return;
  if (options.lock) progressNavState.locked = target ? 'collapsed' : 'expanded';
  if (!target && options.minimumHold) {
    progressNavState.holdExpandedUntil = Math.max(progressNavState.holdExpandedUntil, performance.now() + options.minimumHold);
  }
  const shell = document.getElementById('lws-sticky-shell');
  if (!shell) return;
  if (progressNavState.collapsed === target && !progressNavState.transitioning) {
    shell.classList.toggle('is-progress-collapsed', target);
    shell.classList.toggle('is-progress-locked', Boolean(progressNavState.locked));
    progressNavState.mode = progressNavState.locked ? `locked-${target ? 'collapsed' : 'expanded'}` : (target ? 'collapsed' : 'expanded');
    shell.dataset.progressState = progressNavState.mode;
    shell.classList.toggle('is-progress-locked', Boolean(progressNavState.locked));
    updateProgressControls();
    return;
  }
  progressNavState.collapsed = target;
  progressNavState.downDistance = 0;
  progressNavState.upDistance = 0;
  shell.classList.toggle('is-progress-collapsed', target);
  shell.classList.toggle('is-progress-locked', Boolean(progressNavState.locked));
  if (options.immediate) {
    progressNavState.transitioning = false;
    progressNavState.transitionTarget = null;
    progressNavState.mode = progressNavState.locked ? `locked-${target ? 'collapsed' : 'expanded'}` : (target ? 'collapsed' : 'expanded');
    shell.dataset.progressState = progressNavState.mode;
  } else {
    progressNavState.transitioning = true;
    progressNavState.transitionTarget = target;
    progressNavState.mode = 'transitioning';
    shell.dataset.progressState = 'transitioning';
    shell.classList.add('is-progress-transitioning');
    if (progressNavState.transitionTimer) clearTimeout(progressNavState.transitionTimer);
    progressNavState.transitionTimer = setTimeout(finishProgressTransition, 260);
  }
  updateProgressControls();
  requestAnimationFrame(syncProgressOffset);
}

function finishProgressTransition() {
  if (!progressNavState?.transitioning) return;
  if (progressNavState.transitionTimer) clearTimeout(progressNavState.transitionTimer);
  progressNavState.transitionTimer = null;
  progressNavState.transitioning = false;
  progressNavState.transitionTarget = null;
  progressNavState.mode = progressNavState.locked
    ? `locked-${progressNavState.collapsed ? 'collapsed' : 'expanded'}`
    : (progressNavState.collapsed ? 'collapsed' : 'expanded');
  const shell = document.getElementById('lws-sticky-shell');
  shell?.classList.remove('is-progress-transitioning');
  if (shell) shell.dataset.progressState = progressNavState.mode;
  progressNavState.lastScrollTop = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
  requestAnimationFrame(syncProgressOffset);
}

function updateProgressControls() {
  if (!progressNavState) return;
  const toggle = document.getElementById('lws-progress-toggle');
  if (toggle) {
    toggle.textContent = progressNavState.collapsed ? '展开' : '收起';
    toggle.setAttribute('aria-label', progressNavState.collapsed ? '展开进度导航' : '收起进度导航');
  }
  const pin = document.getElementById('lws-progress-pin');
  if (pin) {
    pin.textContent = progressNavState.locked ? '已锁定' : '锁定';
    pin.setAttribute('aria-pressed', progressNavState.locked ? 'true' : 'false');
  }
}

function toggleProgressLock() {
  if (!progressNavState) return;
  progressNavState.locked = progressNavState.locked ? null : (progressNavState.collapsed ? 'collapsed' : 'expanded');
  setProgressCollapsed(progressNavState.collapsed, { ignoreLock: true, immediate: true });
}

function brieflyRevealProgress() {
  if (!progressNavState || progressNavState.locked === 'collapsed') return;
  setProgressCollapsed(false, { reason: 'node-change', minimumHold: 1200 });
  if (progressRevealTimer) clearTimeout(progressRevealTimer);
  progressRevealTimer = setTimeout(() => { progressRevealTimer = null; }, 1200);
}

function syncProgressOffset() {
  const shell = document.getElementById('lws-sticky-shell');
  if (!shell) return;
  document.documentElement.style.setProperty('--lws-progress-offset', `${Math.ceil(shell.getBoundingClientRect().height + 14)}px`);
}

function locateProgressNode(nodeId) {
  if (!nodeId || !S) return;
  const graphNodes = S.runtime_graph_json?.nodes || [];
  const node = graphNodes.find((item) => String(item.id) === String(nodeId));
  if (!node) return;
  if (String(node.id) === String(S.current_node_id)) {
    const target = document.getElementById('lws-guide-panel')?.offsetParent
      ? document.getElementById('lws-guide-panel')
      : document.getElementById('lws-content-area');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const run = (S.node_runs || []).find((item) => String(item.node_id) === String(node.id));
  if (['COMPLETED', 'SKIPPED'].includes(run?.status)) {
    const history = document.querySelector(`[data-history-node="${CSS.escape(String(node.id))}"]`);
    if (history) {
      history.open = true;
      history.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else showToast('该节点已完成，但暂无可展示的历史内容', 'info');
    return;
  }
  showToast('该节点尚未解锁，请按当前学习流程继续', 'warning');
}

function updateTopbar() {
  if (!S) return;
  setText('lws-flow-title', S.workflow_template?.title || '学习会话');
  setText('lws-course-name', S.course?.course_name || '—');
  setText('lws-kp-name', S.knowledge_point?.knowledge_point_name || '—');
  const graph = S.runtime_graph_json || {};
  const total = (graph.nodes || []).length;
  const displayIndex = S.progress?.displayIndex
    || (S.status === 'COMPLETED' ? total : Math.min(total, (S.completedNodeCount || 0) + 1));
  setText('lws-node-progress', `节点 ${displayIndex}/${total}`);
}

function hideSkeleton() {
  hideEl('lws-skeleton');
  showEl('lws-progress-nav');
  showEl('lws-bottom-bar');
  showEl('lws-kp-overview');
  initStickyObserver();
  initProgressNavigation();
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

  const completedCount = nodeRuns.filter((run) => ['COMPLETED', 'SKIPPED'].includes(run.status)).length;
  const currentIndex = Math.max(0, nodes.findIndex((node) => String(node.id) === String(S.current_node_id)));
  const percent = S.status === 'COMPLETED' ? 100 : nodes.length ? Math.min(99, Math.round((completedCount / nodes.length) * 100)) : 0;
  const remaining = Math.max(0, nodes.length - completedCount - (S.status === 'COMPLETED' ? 0 : 1));
  const current = nodes[currentIndex];
  const nodeChanged = lastProgressNodeId != null && String(lastProgressNodeId) !== String(S.current_node_id);
  lastProgressNodeId = S.current_node_id;
  el.innerHTML = `<div class="lws-progress-summary"><div><b>${escHtml(S.workflow_template?.title || '学习流')}</b><span>当前：${escHtml(current?.title || NODE_LABELS[current?.type] || '已完成')}</span></div><div class="lws-progress-summary-value"><strong>${percent}%</strong><small>剩余 ${remaining} 个节点</small></div></div>
    <button type="button" class="lws-progress-compact" data-learning-action="progress-toggle"><span>${escHtml(current?.title || NODE_LABELS[current?.type] || '学习已完成')}</span><b>${Math.min(nodes.length, currentIndex + 1)} / ${nodes.length}</b><i><em style="width:${percent}%"></em></i></button>
    <div class="lws-progress-track">${nodes.map((node, i) => {
    let cls = 'lws-progress-node';
    if (String(node.id) === String(S.current_node_id)) cls += ' current';
    else if (completedIds.has(node.id) || completedIds.has(String(node.id))) {
      const skipped = nodeRuns.find(r => String(r.node_id) === String(node.id) && r.status === 'SKIPPED');
      cls += skipped ? ' skipped' : ' completed';
    } else if (failedIds.has(node.id) || failedIds.has(String(node.id))) cls += ' failed';
    else cls += ' waiting';

    const info = getNodeType(node.type);
    return `<button type="button" class="${cls}" data-learning-action="progress-node" data-node-id="${escAttr(String(node.id))}" title="${escAttr(node.title || NODE_LABELS[node.type] || node.type)}">
      <span class="lws-progress-dot">${i + 1}</span>
      <span class="lws-progress-label">${escHtml(node.title || NODE_LABELS[node.type] || node.type)}</span>
      <span class="lws-progress-agent">${escHtml(info?.agent || '')}</span>
    </button>`;
  }).join('')}</div>`;
  if (nodeChanged) brieflyRevealProgress();
  requestAnimationFrame(syncProgressOffset);
}

function renderKnowledgePointOverview() {
  const el = document.getElementById('lws-kp-overview');
  if (!el || !S) return;
  showEl('lws-kp-overview');
  const mastery = S.mastery_current != null ? Math.round(S.mastery_current) : null;
  const graph = S.runtime_graph_json || {};
  const node = (graph.nodes || []).find(n => n.id === S.current_node_id);
  const nodeLabel = node ? (node.title || NODE_LABELS[node.type] || node.type) : '—';
  const info = node ? getNodeType(node.type) : null;
  const sessionStatus = ({ RUNNING: '学习进行中', PAUSED: '已暂停', COMPLETED: '已完成', FAILED: '需要重试' })[S.status] || '准备中';
  el.innerHTML = `<div class="lws-kp-card">
    <div class="lws-kp-current"><span class="lws-kp-tag">当前节点</span><h3>${escHtml(nodeLabel)}</h3><span class="lws-kp-task-type">${escHtml(info?.label || '学习节点')}</span></div>
    <div class="lws-kp-status"><span>${escHtml(sessionStatus)}</span>${mastery != null ? `<span>掌握度 <b>${mastery}%</b></span>` : '<span>掌握度待评估</span>'}</div>
    <p class="lws-kp-task-goal">${escHtml(node?.description || `完成 ${nodeLabel}`)}</p>
    <button type="button" class="lws-kp-primary" data-learning-action="current-content">进入当前内容</button>
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
    [PHASE.PREPARING]: '正在读取学习节点',
    [PHASE.REQUESTING]: '正在匹配课程资料',
    [PHASE.HTTP_CONNECTED]: '已找到相关资料',
    [PHASE.STREAMING]: fa.executionStatus === 'WAITING_INPUT' ? '等待学生作答' : '正在生成教学内容',
    [PHASE.COMPLETED]: '内容生成完成',
    [PHASE.FAILED]: 'Agent 执行失败',
  };

  // Additional stage messages based on elapsed time
  let stageNote = '';
  if (fa.phase !== PHASE.IDLE && fa.phase !== PHASE.COMPLETED && fa.phase !== PHASE.FAILED && fa.startedAtMs) {
    const elapsed = fa.elapsedMs || (Date.now() - fa.startedAtMs);
    if (elapsed > 30000) stageNote = '模型正在进行较复杂的分析，请稍候';
    else if (elapsed > 10000) stageNote = '正在生成内容';
    else if (elapsed > 3000) stageNote = '正在校验内容格式';
  }

  const phaseLabel = phaseLabels[fa.phase] || fa.phase;
  let elapsedHtml = '';

  // Use state machine: if timer is active, elapsedMs is updated by interval
  if (fa.executionStatus === 'WAITING_INPUT') {
    elapsedHtml = `<span class="lws-agent-elapsed">生成耗时 ${(fa.elapsedMs / 1000).toFixed(1)} 秒</span>`;
  } else if (fa.phase === PHASE.COMPLETED && fa.completedAtMs && fa.startedAtMs) {
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
    ${stageNote ? `<span class="lws-agent-stage-note">${escHtml(stageNote)}</span>` : ''}
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

  // Next button — hidden when input composer is active; submit is in-composer
  if (nextBtn) {
    nextBtn.disabled = submitting;
    if (fa.phase === PHASE.FAILED) {
      nextBtn.disabled = true;
      nextBtn.textContent = '请先处理错误';
    } else if (isInputComposerVisible()) {
      nextBtn.disabled = true;
      nextBtn.textContent = '请先提交答案';
    } else if (fa.executionStatus === 'WAITING_INPUT') {
      nextBtn.disabled = true;
      nextBtn.textContent = '请先提交答案';
    } else if (fa.phase === PHASE.COMPLETED) {
      nextBtn.disabled = submitting;
      nextBtn.textContent = S?.progress?.displayIndex === S?.progress?.total ? '完成学习' : '继续下一步';
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
  void learningCardDeck?.load(sessionId, state.nodeId);
  const execution = beginExecution(node);

  // Check if already completed (has output content we can restore)
  const existingRun = (S.node_runs || []).find(
    r => String(r.node_id) === String(node.id) && r.status === 'COMPLETED'
  );

  // If completed with valid output, just restore display
  if (existingRun && S.agentMode !== 'langgraph') {
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

  // LangGraph only exposes attachments together with the active answer composer.
  // Remove the old standalone uploader and any composer left by the prior node.
  removeComposerInputComposer();
  const legacyMultimodal = document.getElementById('lws-multimodal-container');
  if (legacyMultimodal) {
    legacyMultimodal.innerHTML = '';
    legacyMultimodal.style.display = 'none';
  }

  // Reset draft state for new node
  resetCurrentDraft();

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

  // Parallel: Bailian Guide + Formal Agent
  const guidePromise = startGuideAgent(node, 'enter', null, execution);
  const formalPromise = startFormalAgent(node, sessionId, execution);

  await Promise.allSettled([guidePromise, formalPromise]);

  // Refresh session data after both complete
  try {
    if (!isExecutionCurrent(execution)) return;
    const r = await learningWorkflowApi.getSession(sessionId);
    applySessionSnapshot(r);
    // Re-render from the canonical session snapshot. This closes the small
    // response/guide race where the execute response can finish while the
    // refreshed checkpoint content is still being folded into the page.
    if (S.currentContent?.data && String(S.current_node_id) === String(node.id)) {
      renderUnifiedAgentContent(S.currentContent, node, S.execution || {});
      state.formalAgent.result = S.currentContent.data;
    }
  } catch {}
  updateTopbar();
  renderProgressNav();
}

// ========================
// 百炼学习引导 (多阶段)
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
    // A navigation can win the race before the previous request observes abort.
    // The backend's stale-execution response is an expected cancellation, not an error.
    if (e.name === 'AbortError' || e.code === 'STALE_NODE_EXECUTION' || !isExecutionCurrent(execution)) return;
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

  if (S?.agentMode === 'langgraph') {
    return runLangGraphNode(node, sessionId, execution, controller);
  }

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

async function runLangGraphNode(node, sessionId, execution, controller) {
  const el = document.getElementById('lws-teaching-result');
  if (el) el.innerHTML = `<div class="lws-stream-loading"><p>正在生成 ${escHtml(node.title || NODE_LABELS[node.type] || '学习内容')}…</p></div>`;
  try {
    formalActive = true;
    setFormalPhase(PHASE.REQUESTING, {
      agentName: getNodeType(node.type)?.agent || 'Agent',
      requestId: currentRequestId,
      executionStatus: 'GENERATING',
    });
    const response = await fetch(apiUrl(`/learning-workflows/sessions/${sessionId}/execute-current`), {
      ...authFetchOptions('POST', {
        executionId: S.activeExecution?.executionId || null,
        expectedNodeExecutionId: execution?.nodeRunId || null,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(payload.message || '学习内容生成失败'), {
        code: payload.code, httpStatus: response.status,
      });
    }
    if (!isExecutionCurrent(execution)) return;
    const data = payload.data || payload;
    if (data.session) applySessionSnapshot(data.session);
    if (data.nodeRunId) state.execution.nodeRunId = data.nodeRunId;
    state.execution.executionId = data.execution?.executionId || null;

    if (data.execution?.status === 'FAILED' || data.success === false) {
      throw Object.assign(new Error(data.error?.message || '学习内容暂时生成失败，请重新尝试或跳过当前节点。'), {
        code: data.error?.code || 'AGENT_EXECUTION_FAILED', httpStatus: 200,
      });
    }
    if (!data.content?.data) {
      throw Object.assign(new Error('学习内容格式暂时无法识别，请重新尝试。'), { code: 'AGENT_CONTENT_EMPTY' });
    }

    renderUnifiedAgentContent(data.content, node, data.execution || {});
    state.formalAgent.result = data.content.data;
    state.formalAgent.serverAdvanced = false;
    const waitingInput = data.execution?.status === 'WAITING_INPUT';
    const interaction = data.content?.interaction || null;
    if (interaction) state.formalAgent.interaction = interaction;

    const runMeta = data.session?.currentNodeRun?.output_summary_json || {};
    const generatedAt = runMeta.generatedAt || data.session?.currentNodeRun?.started_at;
    const completedAtMs = generatedAt ? new Date(generatedAt).getTime() : Date.now();
    const generationElapsedMs = Number(runMeta.generationElapsedMs);
    const startedAtMs = Number.isFinite(generationElapsedMs)
      ? completedAtMs - Math.max(0, generationElapsedMs)
      : completedAtMs;
    setFormalPhase(waitingInput ? PHASE.STREAMING : PHASE.COMPLETED, {
      agentName: agentDisplayName(data.content.agentType),
      executionStatus: data.execution?.status,
      startedAtMs,
      completedAtMs,
      workflowConnected: true,
      error: null,
      interaction,
    });
    updateTopbar();
    renderProgressNav();
    renderKnowledgePointOverview();
  } catch (error) {
    if (error.name === 'AbortError' || !isExecutionCurrent(execution)) return;
    handleFormalAgentError({
      ...error,
      message: '学习内容暂时生成失败，请重新尝试或跳过当前节点。',
      retryable: true,
    }, node, sessionId);
  } finally {
    if (formalAbortCtrl === controller) formalAbortCtrl = null;
    if (isExecutionCurrent(execution)) formalActive = false;
  }
}

function agentDisplayName(agentType) {
  const names = { explainer: 'Explainer', trainer: 'Trainer', diagnostician: 'Diagnostician' };
  return names[String(agentType || '').toLowerCase()] || '教学 Agent';
}

function renderUnifiedAgentContent(content, node, execution) {
  if (content.contentType === 'practice') {
    renderGraphPractice(content.data, node, execution);
  } else if (content.contentType === 'diagnosis') {
    renderDiagnosticContent(content.data, node);
  } else if (content.contentType === 'summary') {
    renderSummaryContent(content.data, node);
  } else {
    renderExplainerContent(content.data, node);
  }
  const latestAnswer = content?.data?.answerHistory?.at?.(-1);
  if (latestAnswer) renderSubmittedEvaluation(latestAnswer);
  syncLearningInputComposer(content, execution);
  queueMicrotask(() => maybeStartNarration(node).catch(() => {}));
}

function syncLearningInputComposer(content, execution) {
  const interaction = content?.interaction;
  if (execution?.status === 'WAITING_INPUT' && interaction && interaction.type !== 'none') {
    renderLearningInputComposer(interaction);
  } else {
    removeComposerInputComposer();
  }
}

function renderInfoCards(title, cards, sources = []) {
  const el = document.getElementById('lws-teaching-result');
  if (!el) return;
  const hasContent = (value) => Array.isArray(value)
    ? value.some((item) => String(typeof item === 'string' ? item : item?.content || item?.explanation || item?.mapping || '').trim())
    : String(value ?? '').trim().length > 0;
  const body = cards.filter((card) => hasContent(card?.content)).map((card) => {
    const content = Array.isArray(card.content)
      ? card.content.map((item) => `- ${typeof item === 'string' ? item : item?.content || item?.explanation || item?.mapping || ''}`).join('\n')
      : String(card.content);
    return `<section class="lws-section-card"><div class="lws-section-header"><span class="lws-section-title">${escHtml(card.title || '学习内容')}</span></div><div class="lws-section-body message-markdown">${renderMarkdownToHtml(content)}</div></section>`;
  }).join('');
  const sourceHtml = sources.length ? `<details class="lws-sources-details"><summary class="lws-sources-summary">📚 知识库来源 (${sources.length})</summary><div class="lws-sources-list">${sources.map((source) => `<div class="lws-source-item"><span class="lws-source-name">${escHtml(source.document_name || source.documentName || source.name || '课程资料')}</span></div>`).join('')}</div></details>` : '';
  el.innerHTML = `<div class="lws-teaching-header"><h3>${escHtml(title || '学习内容')}</h3></div><div class="lws-sections-container">${body || '<p class="lws-fallback-text">该条内容格式较旧，暂时无法展示。</p>'}</div>${sourceHtml}`;
  setTimeout(() => renderMathInMarkdownElements?.(el), 50);
}

function renderExplainerContent(data, node) {
  const cards = [];
  if (Array.isArray(data.sections)) {
    for (const section of data.sections) {
      const keyPoints = Array.isArray(section.key_points) && section.key_points.length
        ? `\n\n${section.key_points.map((point) => `- ${point}`).join('\n')}` : '';
      cards.push({ title: section.heading || section.title || '核心概念', content: `${section.content || section.text || ''}${keyPoints}` });
    }
  }
  if (data.concept) cards.push({ title: '核心概念', content: data.concept });
  for (const analogy of data.analogies || []) cards.push({ title: `类比：${analogy.domain || ''}`, content: `${analogy.mapping || ''}${analogy.limitation ? `\n\n类比边界：${analogy.limitation}` : ''}` });
  if (data.bridge_back) cards.push({ title: '回到原概念', content: data.bridge_back });
  if (data.problem_statement) cards.push({ title: '例题', content: data.problem_statement });
  for (const step of data.solution_steps || []) cards.push({ title: `步骤 ${step.step_number || ''}`, content: `${step.description || ''}${step.rationale ? `\n\n理由：${step.rationale}` : ''}` });
  if (data.final_answer) cards.push({ title: '结论', content: data.final_answer });
  if (data.key_insights) cards.push({ title: '关键洞察', content: data.key_insights });
  if (data.common_mistakes) cards.push({ title: '易错点', content: data.common_mistakes });
  if (data.starting_question) cards.push({ title: '引导问题', content: data.starting_question });
  if (data.guidance_hints) cards.push({ title: '思考提示', content: data.guidance_hints });
  if (data.identified_misconception) cards.push({ title: '识别到的误区', content: data.identified_misconception });
  if (data.why_it_is_wrong) cards.push({ title: '为什么不正确', content: data.why_it_is_wrong });
  if (data.correct_understanding) cards.push({ title: '正确理解', content: data.correct_understanding });
  if (data.key_concepts) cards.push({ title: '核心概念', content: data.key_concepts.map((item) => `${item.name}：${item.explanation}`) });
  if (data.summary) cards.push({ title: '小结', content: data.summary });
  if (data.content) cards.push({ title: '讲解', content: data.content });
  renderInfoCards(data.title || data.topic || node.title, cards, data.knowledge_sources || []);
}

function renderDiagnosticContent(data, node) {
  if (data.mode === 'diagnostic_decision') {
    const mastery = Number(data.mastery_estimate);
    const target = Number(data.target_mastery);
    const answered = Number(data.answered_count || 0);
    const accuracy = data.accuracy == null ? '暂无可计分题目' : `${Number(data.accuracy)}%`;
    renderInfoCards(node.title || '掌握度判断', [
      { title: data.passed ? '已达到目标' : '建议继续巩固', content: data.overall_assessment },
      { title: '掌握度进度', content: Number.isFinite(mastery) && Number.isFinite(target) ? `当前 ${mastery}% · 目标 ${target}% · ${data.passed ? '已达标' : `还差 ${Math.max(0, target - mastery)} 个百分点`}` : '' },
      { title: '本轮表现', content: answered ? `已计分 ${answered} 题，答对 ${Number(data.correct_count || 0)} 题，答错 ${Number(data.wrong_count || 0)} 题，正确率 ${accuracy}` : accuracy },
      { title: '下一步', content: data.recommended_next_step || data.decisions?.map((item) => item.reason) || [] },
    ], data.knowledge_sources || []);
    return;
  }
  const cards = [
    { title: '诊断结论', content: data.diagnosis_conclusion || data.overall_assessment || data.overall_pattern || data.conservative_recommendation },
    { title: '错误类型', content: data.error_types || (data.primary_error_type ? [data.primary_error_type] : []) },
    { title: '误区说明', content: data.misconception || (data.identified_misconceptions || []).map((item) => item.description) },
    { title: '合理部分', content: data.reasonable_parts || [] },
    { title: '错误原因', content: data.root_cause || data.root_cause_analysis || data.evidence },
    { title: '修复建议', content: data.repair_suggestions || (data.suggested_remediation ? [data.suggested_remediation] : []) },
    { title: '推荐下一步', content: data.recommended_next_step || data.recommended_action },
    { title: '是否需要补救讲解', content: data.needs_remedial_explanation == null ? '' : (data.needs_remedial_explanation ? '需要' : '暂不需要') },
  ];
  renderInfoCards(node.title || '学习诊断', cards, data.knowledge_sources || []);
}

function renderSubmittedEvaluation(evaluation) {
  if (!evaluation) return;
  const el = document.getElementById('lws-teaching-result');
  if (!el || el.querySelector('.lws-answer-evaluation')) return;
  const score = evaluation.score == null ? Number.NaN : Number(evaluation.score);
  const level = Number.isFinite(score) && score >= 80 ? 'strong' : Number.isFinite(score) && score >= 60 ? 'developing' : 'review';
  const title = level === 'strong' ? '理解得很到位' : level === 'developing' ? '思路基本正确' : '还可以再完善一步';
  const feedback = evaluation.feedback || evaluation.analysis || '回答已记录。';
  const suggestion = evaluation.remediationHint || evaluation.errorAnalysis || '';
  el.insertAdjacentHTML('beforeend', `<section class="lws-answer-evaluation ${level}">
    <div class="lws-answer-evaluation-icon">${level === 'strong' ? '✓' : '✦'}</div>
    <div><div class="lws-answer-evaluation-head"><b>学习引导老师评价</b>${Number.isFinite(score) ? `<span>${score} 分</span>` : ''}</div>
      <h4>${escHtml(title)}</h4><p>${escHtml(feedback)}</p>${suggestion ? `<p class="lws-answer-evaluation-tip">建议：${escHtml(suggestion)}</p>` : ''}</div>
  </section>`);
}

function renderSummaryContent(data, node) {
  renderInfoCards(node.title || '学习总结', [
    { title: '本轮完成情况', content: data.completion_summary || data.overall_assessment },
    { title: '已掌握内容', content: data.mastered_content || [] },
    { title: '薄弱内容', content: data.weak_content || [] },
    { title: '错题情况', content: data.wrong_answer_summary },
    { title: '掌握度变化', content: data.mastery_change ? `${data.mastery_change.before ?? '—'} → ${data.mastery_change.after ?? '—'}` : '' },
    { title: '后续建议', content: data.next_steps || [] },
  ], data.knowledge_sources || []);
}

function toTimelineQuestion(question, index = 0) {
  return {
    id: question.id || question.questionId,
    questionKey: question.questionId || question.id,
    type: question.questionType || question.type || 'short_answer',
    stem: question.stem || '',
    options: (question.options || []).map((option) => ({ key: option.key, text: option.content || option.text })),
    difficulty: question.difficulty || 'medium',
    knowledgePoint: question.knowledgePoint || '',
    sequence: index + 1,
    hints: question.hints || [],
  };
}

function renderGraphPractice(data, node, execution) {
  const el = document.getElementById('lws-teaching-result');
  if (!el) return;
  el.innerHTML = '';
  ensureTimelineContainer(el);
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const answers = Array.isArray(data.answers) ? data.answers : [];
  trainerState = {
    ...trainerState,
    session: { sessionId: `langgraph_${S.session_id}_${state.execution?.nodeRunId || ''}` },
    currentNode: node,
    currentQuestion: null,
    answeredQuestions: answers,
    submitting: false,
    loadingNext: false,
    nodeRunId: state.execution?.nodeRunId,
    practiceConfig: {
      targetQuestionCount: questions.length,
      minQuestionCount: questions.length,
      maxQuestionCount: questions.length,
      targetMastery: S.target_mastery,
    },
    progress: {
      completedCount: answers.length,
      correctCount: answers.filter((answer) => answer.isCorrect).length,
      totalCount: questions.length,
    },
    currentMastery: S.mastery_current,
    hintLevel: 0,
  };
  renderTrainerProgress();
  for (const answer of answers) {
    const index = questions.findIndex((question) => String(question.questionId || question.id) === String(answer.questionId));
    const question = toTimelineQuestion(index >= 0 ? questions[index] : { id: answer.questionId, stem: answer.questionStem }, Math.max(0, index));
    appendToTimeline('question_card', { question });
    appendToTimeline('student_answer', { answer: Array.isArray(answer.studentAnswer) ? answer.studentAnswer.join(', ') : answer.studentAnswer, submittedAt: answer.submittedAt });
    appendToTimeline('evaluation', { isCorrect: answer.isCorrect, correctAnswer: Array.isArray(answer.correctAnswer) ? answer.correctAnswer.join(', ') : answer.correctAnswer, analysis: answer.analysis || answer.feedback, errorType: answer.errorType });
  }
  if (execution.status === 'WAITING_INPUT' && data.currentQuestion) {
    const currentIndex = Number(data.currentQuestionIndex || answers.length || 0);
    appendGraphPracticeQuestion(toTimelineQuestion(data.currentQuestion, currentIndex), node);
  } else if (execution.status === 'COMPLETED') {
    appendToTimeline('info', { text: '本节点练习已完成，可继续进入下一节点。' });
  }
}

function appendGraphPracticeQuestion(question, node) {
  trainerState.currentQuestion = question;
  trainerState.currentNode = node;
  appendToTimeline('question_card', { question });
  triggerGuideForPhase('before_question', {
    question: {
      sequence: question.sequence,
      type: question.type,
      stem: question.stem,
      options: question.options,
      difficulty: question.difficulty,
    },
    progress: trainerState.progress || {},
  });
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
          model: import.meta.env.VITE_BAILIAN_MODEL || 'qwen3.7-plus',
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

// ========================
// 统一回答组件 — 状态管理
// ========================

let currentDraft = {
  text: '',
  selectedOptions: [],
  uploadedFiles: [],
  nodeRunId: null,
  questionId: null,
};

function revokePreviewFiles(files = []) {
  files.forEach((file) => { if (String(file?.previewUrl || '').startsWith('blob:')) URL.revokeObjectURL(file.previewUrl); });
}

function resetCurrentDraft() {
  revokePreviewFiles(currentDraft.uploadedFiles);
  currentDraft = {
    text: '',
    selectedOptions: [],
    uploadedFiles: [],
    nodeRunId: state?.execution?.nodeRunId || null,
    questionId: null,
  };
}

function isInputComposerVisible() {
  if (!state) return false;
  const exec = S?.execution || state.execution || {};
  if (exec.status !== 'WAITING_INPUT') return false;

  // Check if interaction data exists
  const interaction = S?.currentContent?.interaction
    || state.formalAgent?.interaction
    || exec.interrupt;
  if (!interaction) return false;

  const itype = interaction.type || interaction.interactionType;
  return itype && itype !== 'none';
}

function getCurrentInteraction() {
  return S?.currentContent?.interaction
    || state.formalAgent?.interaction
    || S?.execution?.interrupt
    || null;
}

// ========================
// 统一回答组件 — 渲染
// ========================

function renderLearningInputComposer(interaction, afterElId = 'lws-teaching-result') {
  if (!interaction) return;
  const itype = interaction.type || interaction.interactionType || 'free_text';

  // Find or create the composer container
  let composer = document.getElementById('lws-input-composer');
  if (!composer) {
    composer = document.createElement('div');
    composer.id = 'lws-input-composer';
    composer.className = 'lws-input-composer';
    const afterEl = document.getElementById(afterElId);
    if (afterEl) {
      afterEl.insertAdjacentElement('afterend', composer);
    } else {
      const contentArea = document.getElementById('lws-content-area');
      if (contentArea) contentArea.appendChild(composer);
    }
  }

  const isChoice = ['single_choice', 'multiple_choice', 'true_false'].includes(itype);
  const isFreeText = ['free_text', 'short_answer', 'fill_blank'].includes(itype);
  const placeholder = interaction.placeholder || '请输入你的回答……';
  const submitLabel = interaction.submitLabel || '提交回答';
  const options = interaction.options || [];
  const maxImages = interaction.maxImages || 3;

  // Sync draft
  if (interaction.nodeRunId && currentDraft.nodeRunId !== interaction.nodeRunId) {
    resetCurrentDraft();
    currentDraft.nodeRunId = interaction.nodeRunId;
  }
  if (interaction.questionId) currentDraft.questionId = interaction.questionId;

  const html = buildComposerHtml(itype, isChoice, isFreeText, placeholder, submitLabel, options, maxImages);
  composer.innerHTML = html;

  // Bind events
  setTimeout(() => mountLearningInputComposer(interaction), 30);

  // Scroll composer into view
  setTimeout(() => composer.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
}

function buildComposerHtml(itype, isChoice, isFreeText, placeholder, submitLabel, options, maxImages) {
  let inputHtml = '';

  if (isChoice && options.length) {
    const inputType = itype === 'multiple_choice' ? 'checkbox' : 'radio';
    const name = `lws-composer-choice-${Date.now()}`;
    inputHtml = `<div class="lws-composer-options">${options.map((option) => `
      <label class="lws-composer-option">
        <input type="${inputType}" name="${escAttr(name)}" value="${escAttr(option.key)}">
        <span class="lws-composer-option-key">${escHtml(option.key)}</span>
        <span class="lws-composer-option-content">${escHtml(option.content)}</span>
      </label>`).join('')}</div>`;
    // For free_text after choices
    if (itype === 'single_choice' || itype === 'true_false') {
      inputHtml += `<textarea class="lws-composer-textarea" id="lws-composer-text" rows="2" placeholder="补充说明（可选）..." style="margin-top:8px;"></textarea>`;
    }
  } else if (isFreeText) {
    const rows = itype === 'free_text' ? 4 : 2;
    inputHtml = `<textarea class="lws-composer-textarea" id="lws-composer-text" rows="${rows}" placeholder="${escAttr(placeholder)}">${escHtml(currentDraft.text || '')}</textarea>`;
  }

  const uploadedCount = currentDraft.uploadedFiles.length;
  const previewsHtml = currentDraft.uploadedFiles.map((f, i) => `
    <div class="lws-composer-file-preview">
      <img src="${escAttr(f.previewUrl || f.fileUrl)}" alt="${escAttr(f.fileName || '')}" class="lws-composer-thumb">
      <button class="lws-composer-file-remove" data-file-index="${i}" title="删除">&times;</button>
    </div>`).join('');

  const canSubmit = isChoice
    ? currentDraft.selectedOptions.length > 0
    : Boolean(currentDraft.text?.trim() || currentDraft.uploadedFiles.length);

  return `
    <div class="lws-composer-body">
      ${inputHtml}
      <div class="lws-composer-footer">
        <div class="lws-composer-attachments">
          <label class="lws-composer-attach-btn" id="lws-composer-attach-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            <span>添加图片</span>
            <input type="file" id="lws-composer-file-input" accept="image/jpeg,image/png,image/gif,image/webp,image/bmp" multiple hidden>
          </label>
          <span class="lws-composer-file-count">${uploadedCount}/${maxImages} 张</span>
          <div class="lws-composer-file-previews" id="lws-composer-file-previews">${previewsHtml}</div>
        </div>
        <button class="lws-btn lws-btn-primary lws-composer-submit" id="lws-composer-submit" ${canSubmit ? '' : 'disabled'}>${escHtml(submitLabel)}</button>
      </div>
    </div>
    <div class="lws-composer-status" id="lws-composer-status" style="display:none"></div>`;
}

function mountLearningInputComposer(interaction) {
  const composer = document.getElementById('lws-input-composer');
  if (!composer) return;

  // File input
  const fileInput = document.getElementById('lws-composer-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => handleComposerFileSelect(e.target.files));
  }

  // Drag-and-drop on composer
  composer.addEventListener('dragover', (e) => { e.preventDefault(); composer.classList.add('lws-composer-dragover'); });
  composer.addEventListener('dragleave', () => { composer.classList.remove('lws-composer-dragover'); });
  composer.addEventListener('drop', (e) => {
    e.preventDefault();
    composer.classList.remove('lws-composer-dragover');
    handleComposerFileSelect(e.dataTransfer.files);
  });

  // Remove file buttons
  composer.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.lws-composer-file-remove');
    if (delBtn) {
      const idx = parseInt(delBtn.dataset.fileIndex, 10);
      removeComposerFile(idx);
    }
  });

  // Submit button
  const submitBtn = document.getElementById('lws-composer-submit');
  if (submitBtn) {
    submitBtn.onclick = () => submitLearningInput(interaction);
  }

  // Textarea change — enable submit
  const textarea = document.getElementById('lws-composer-text');
  if (textarea) {
    textarea.addEventListener('input', () => {
      currentDraft.text = textarea.value.trim();
      if (submitBtn) {
        submitBtn.disabled = !currentDraft.text && !currentDraft.uploadedFiles.length;
      }
    });
  }

  // Choice input change — enable submit
  const choiceInputs = composer.querySelectorAll('input[type="radio"], input[type="checkbox"]');
  for (const input of choiceInputs) {
    input.addEventListener('change', () => {
      const checked = [...composer.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')];
      currentDraft.selectedOptions = checked.map((item) => item.value);
      if (submitBtn) submitBtn.disabled = false;
    });
  }
}

function removeComposerInputComposer() {
  const composer = document.getElementById('lws-input-composer');
  if (composer) composer.remove();
  resetCurrentDraft();
}

async function handleComposerFileSelect(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!files.length) { showToast('请选择图片文件', 'warning'); return; }

  const remaining = 3 - currentDraft.uploadedFiles.length;
  if (files.length > remaining) {
    showToast(`最多上传 3 张图片（还可添加 ${remaining} 张）`, 'warning');
    files.splice(remaining);
  }

  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));

  try {
    const statusEl = document.getElementById('lws-composer-status');
    if (statusEl) { statusEl.style.display = ''; statusEl.textContent = '上传中…'; }
    const result = await learningWorkflowApi.uploadSessionFiles(state.sessionId, formData);
    if (result.code === 200 && result.data?.files) {
      currentDraft.uploadedFiles.push(...result.data.files);
      if (statusEl) { statusEl.textContent = `已上传 ${currentDraft.uploadedFiles.length} 张`; }
      // Refresh previews
      const previewsEl = document.getElementById('lws-composer-file-previews');
      const countEl = document.querySelector('.lws-composer-file-count');
      if (previewsEl) {
        previewsEl.innerHTML = currentDraft.uploadedFiles.map((f, i) => `
          <div class="lws-composer-file-preview">
            <img src="${escAttr(f.previewUrl || f.fileUrl)}" alt="${escAttr(f.fileName || '')}" class="lws-composer-thumb">
            <button class="lws-composer-file-remove" data-file-index="${i}" title="删除">&times;</button>
          </div>`).join('');
      }
      if (countEl) countEl.textContent = `${currentDraft.uploadedFiles.length}/3 张`;

      // 自由回答允许图片作为回答内容；选择题仍必须先选择选项。
      const submitBtn = document.getElementById('lws-composer-submit');
      const choiceInput = document.querySelector('#lws-input-composer input[type="radio"], #lws-input-composer input[type="checkbox"]');
      if (submitBtn && !choiceInput) submitBtn.disabled = false;
    } else {
      if (statusEl) { statusEl.textContent = '上传失败'; }
      showToast(result.message || '上传失败', 'error');
    }
  } catch (err) {
    const statusEl = document.getElementById('lws-composer-status');
    if (statusEl) { statusEl.style.display = ''; statusEl.textContent = '上传失败'; }
    showToast('上传失败: ' + (err.message || ''), 'error');
  }
}

function removeComposerFile(index) {
  if (index >= 0 && index < currentDraft.uploadedFiles.length) {
    revokePreviewFiles([currentDraft.uploadedFiles[index]]);
    currentDraft.uploadedFiles.splice(index, 1);
    const previewsEl = document.getElementById('lws-composer-file-previews');
    const countEl = document.querySelector('.lws-composer-file-count');
    if (previewsEl) {
      previewsEl.innerHTML = currentDraft.uploadedFiles.map((f, i) => `
        <div class="lws-composer-file-preview">
          <img src="${escAttr(f.previewUrl || f.fileUrl)}" alt="${escAttr(f.fileName || '')}" class="lws-composer-thumb">
          <button class="lws-composer-file-remove" data-file-index="${i}" title="删除">&times;</button>
        </div>`).join('');
    }
    if (countEl) countEl.textContent = `${currentDraft.uploadedFiles.length}/3 张`;
    // 没有文字、图片或已选选项时禁用提交。
    const submitBtn = document.getElementById('lws-composer-submit');
    const hasChoice = currentDraft.selectedOptions.length > 0;
    if (submitBtn && !currentDraft.text && !currentDraft.uploadedFiles.length && !hasChoice) {
      submitBtn.disabled = true;
    }
  }
}

async function submitLearningInput(interaction) {
  if (!S || !state) return;
  if (state.action.submitting) return;

  const itype = interaction.type || interaction.interactionType || 'free_text';

  // Collect answer
  let answer = '';
  let selectedOptions = [];
  if (['single_choice', 'multiple_choice', 'true_false'].includes(itype)) {
    const composer = document.getElementById('lws-input-composer');
    if (composer) {
      const checked = [...composer.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked')];
      selectedOptions = checked.map((item) => item.value);
      answer = selectedOptions.join(', ');
    }
    // Also check supplement textarea
    const suppText = document.getElementById('lws-composer-text');
    if (suppText?.value?.trim()) {
      currentDraft.text = suppText.value.trim();
    }
    if (!selectedOptions.length) {
      showToast('请先选择一个答案', 'warning');
      return;
    }
  } else {
    const textarea = document.getElementById('lws-composer-text');
    if (textarea) currentDraft.text = textarea.value.trim();
    answer = currentDraft.text;
  }

  if (!answer && !currentDraft.uploadedFiles.length) {
    showToast('请输入你的回答或上传图片', 'warning');
    return;
  }

  await narrationClient?.stop({ cancel: true });
  setAction('submit-answer', true);
  const submitBtn = document.getElementById('lws-composer-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中…'; }
  const statusEl = document.getElementById('lws-composer-status');
  if (statusEl) { statusEl.style.display = ''; statusEl.textContent = '正在提交…'; }

  try {
    const operationId = `answer_${S.session_id}_${interaction.nodeRunId || state.execution?.nodeRunId}_${Date.now()}`;
    const resp = await learningWorkflowApi.submitAnswer(state.sessionId, {
      questionKey: interaction.questionId || 'free_response',
      operationId,
      expectedNodeExecutionId: state.execution?.nodeRunId || interaction.nodeRunId,
      studentInput: {
        text: currentDraft.text || answer,
        answer,
        selectedOptions,
        fileRefs: currentDraft.uploadedFiles.map(({ previewUrl, ...file }) => file),
        questionId: interaction.questionId,
      },
      answer: selectedOptions.length === 1 ? selectedOptions[0] : answer,
      selectedOption: selectedOptions.length === 1 ? selectedOptions[0] : undefined,
      timeSpentSeconds: Math.round((Date.now() - (state.formalAgent?.startedAtMs || Date.now())) / 1000),
      requestId: `lw_a_${state.sessionId}_${interaction.questionId || 'fr'}_${Date.now()}`,
    });

    const data = resp.data || resp;
    if (!isExecutionCurrent(state.execution)) return;

    if (S.agentMode === 'langgraph') {
      if (data.session) applySessionSnapshot(data.session);
      const currentNode = (S.runtime_graph_json?.nodes || []).find(
        (item) => String(item.id) === String(state.nodeId),
      );
      if (data.content?.data && currentNode) {
        // Rebuild the active workspace from the canonical response. This keeps
        // text, choices, images, answer history and the next question in one UI.
        renderUnifiedAgentContent(data.content, currentNode, data.execution || {});
      } else {
        removeComposerInputComposer();
      }

      if (data.execution?.status === 'WAITING_INPUT') {
        setFormalPhase(PHASE.STREAMING, {
          agentName: agentDisplayName(data.content?.agentType),
          executionStatus: 'WAITING_INPUT',
          workflowConnected: true,
          interaction: data.content?.interaction || null,
        });
      } else {
        setFormalPhase(PHASE.COMPLETED, {
          agentName: agentDisplayName(data.content?.agentType),
          executionStatus: 'COMPLETED',
          completedAtMs: Date.now(),
        });
        state.formalAgent.result = data.content?.data || buildTrainerResultPayload(
          (S.runtime_graph_json?.nodes || []).find(n => String(n.id) === String(state.nodeId)));
      }
      updateTopbar();
      renderProgressNav();
      await maybeStartNarration(currentNode, 'feedback', true);
    }
  } catch (e) {
    if (!isExecutionCurrent(state.execution)) return;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '重新提交'; }
    if (statusEl) { statusEl.style.display = 'none'; }
    showToast('提交失败: ' + (e.message || ''), 'error');
  } finally {
    setAction(null, false);
  }
}

async function runTrainerNode(node, sessionId, execution, controller) {
  const el = document.getElementById('lws-teaching-result');
  if (el) el.innerHTML = '';

  // Card preparation is independent from the long-running Trainer workflow.
  // It renders an immediate cache/fallback deck and keeps refreshing in parallel.
  void learningCardDeck?.load(sessionId, String(node.id));

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
  const isMultipleChoice = question.type === 'multiple_choice';

  const answerCard = document.createElement('div');
  answerCard.className = 'lws-timeline-card lws-timeline-answer';
  answerCard.id = 'lws-answer-' + qId;
  answerCard.innerHTML = `<div class="lws-timeline-card-body">
    ${isChoice ? `<div class="lws-question-options">${opts.map(o => `<label class="lws-option-label"><input type="${isMultipleChoice ? 'checkbox' : 'radio'}" name="lws-ans-${qId}" value="${escAttr(o.key || '')}"><span class="lws-option-key">${escHtml(o.key || '')}</span><span>${escHtml(o.text || o.content || '')}</span></label>`).join('')}</div>`
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
  const selected = [...document.querySelectorAll(`input[name="lws-ans-${qId}"]:checked`)];
  if (selected.length) answer = question.type === 'multiple_choice' ? selected.map((item) => item.value) : selected[0].value;
  else {
    const textarea = document.getElementById('lws-trainer-answer-' + qId);
    if (textarea) answer = textarea.value.trim();
  }
  if (!answer || (Array.isArray(answer) && !answer.length)) { showToast('请选择或输入你的答案', 'warning'); return; }

  // Lock submission
  trainerState.submitting = true;
  await narrationClient?.stop({ cancel: true });
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

    if (S.agentMode === 'langgraph') {
      applyLangGraphSubmitResult(data, { qId, answer, question, trainerSession, sessionId, node, execution });
      return;
    }

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

function applyLangGraphSubmitResult(data, context) {
  const { qId, answer, trainerSession, sessionId, node, execution } = context;
  if (data.execution?.status === 'FAILED' || data.success === false) {
    throw Object.assign(new Error(data.error?.message || '答案提交失败'), { code: data.error?.code });
  }
  appendToTimeline('student_answer', {
    id: qId,
    answer: Array.isArray(answer) ? answer.join(', ') : answer,
    submittedAt: new Date().toISOString(),
  });
  if (data.evaluation) {
    appendToTimeline('evaluation', {
      id: qId,
      isCorrect: data.evaluation.isCorrect,
      correctAnswer: Array.isArray(data.evaluation.correctAnswer) ? data.evaluation.correctAnswer.join(', ') : data.evaluation.correctAnswer,
      studentAnswer: answer,
      analysis: data.evaluation.analysis || data.evaluation.feedback || data.evaluation.errorAnalysis || '',
      errorType: data.evaluation.errorType || null,
    });
  }
  document.getElementById('lws-answer-' + qId)?.remove();
  if (data.session) applySessionSnapshot(data.session);
  trainerState.answeredQuestions = data.content?.data?.answers || trainerState.answeredQuestions;
  trainerState.progress = {
    completedCount: trainerState.answeredQuestions.length,
    correctCount: trainerState.answeredQuestions.filter((item) => item.isCorrect).length,
    totalCount: data.content?.data?.questions?.length || trainerState.progress?.totalCount || 0,
  };
  renderTrainerProgress();

  if (data.execution?.status === 'WAITING_INPUT' && data.content?.data?.currentQuestion) {
    const next = toTimelineQuestion(data.content.data.currentQuestion, data.content.data.currentQuestionIndex || trainerState.answeredQuestions.length);
    trainerState.currentQuestion = next;
    setFormalPhase(PHASE.STREAMING, { agentName: 'Trainer', executionStatus: 'WAITING_INPUT', workflowConnected: true });
    setTimeout(() => {
      if (isExecutionCurrent(execution)) appendTrainerQuestionToTimeline(next, trainerSession, sessionId, node);
    }, 250);
    return;
  }

  state.formalAgent.result = data.content?.data || buildTrainerResultPayload(node);
  state.formalAgent.serverAdvanced = false;
  setFormalPhase(PHASE.COMPLETED, { agentName: 'Trainer', executionStatus: 'COMPLETED', completedAtMs: Date.now() });
  appendToTimeline('info', { text: '本节点练习已完成，可继续进入下一节点。' });
  updateTopbar();
  renderProgressNav();
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
  // Old in-memory history cards may still contain this id from a node that was
  // archived before the current render. Demote those copies first.
  document.querySelectorAll('#lws-timeline').forEach((element) => {
    if (!parentEl.contains(element)) element.removeAttribute('id');
  });
  let timeline = parentEl.querySelector('#lws-timeline');
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
        ${data.correctAnswer !== undefined && data.correctAnswer !== null && data.correctAnswer !== '' ? `<div class="lws-eval-row"><span class="lws-eval-label">正确答案:</span> <b>${escHtml(data.correctAnswer)}</b></div>` : ''}
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
      card.innerHTML = '<div class="lws-timeline-card-body">该条历史内容格式较旧，暂时无法展示。</div>';
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
    if (S.agentMode === 'langgraph') {
      const response = await fetch(apiUrl(`/learning-workflows/sessions/${S.session_id}/complete-node`), {
        ...authFetchOptions('POST', {
          nodeId: previousNodeId,
          expectedNodeExecutionId: state.execution?.nodeRunId || S.currentNodeRun?.node_run_id || null,
          clientActionId,
          operationId: clientActionId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || '进入下一节点失败');
      const outcome = payload.data || payload;
      if (outcome.execution?.status === 'FAILED') throw new Error(outcome.error?.message || '进入下一节点失败');
      archiveCurrentWorkspace(previousNode, '已完成');
      abortBoth();
      if (outcome.session) applySessionSnapshot(outcome.session);
      if (S.status === 'COMPLETED' || outcome.execution?.flowCompleted || !S.current_node_id) {
        await showFlowCompleted();
        return;
      }
      state.nodeId = String(S.current_node_id);
      state.guide = { phase: PHASE.IDLE, requestId: '', blocks: [], error: null };
      const guideEl = document.getElementById('lws-guide-blocks');
      if (guideEl) guideEl.innerHTML = '';
      resetCurrentNodeState();
      updateTopbar();
      renderProgressNav();
      renderKnowledgePointOverview();
      await execCurrentNode(S.session_id);
      return;
    }

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
    updateActionButtons();
  }
}

// Show flow completion on current page instead of navigating away
async function showFlowCompleted() {
  showEl('lws-content-area');
  showEl('lws-guide-panel');
  const guideBlocks = document.getElementById('lws-guide-blocks');
  if (guideBlocks && !guideBlocks.querySelector('[data-completion-guide]')) {
    guideBlocks.insertAdjacentHTML('beforeend', '<div class="lws-guide-bubble" data-completion-guide>本轮学习已经完成。还有什么需要问的吗？我会结合刚才的学习节点、你的作答评价和掌握度继续陪你深入讨论。</div>');
  }
  setGuidePhase(PHASE.COMPLETED);
  const el = document.getElementById('lws-teaching-result');
  if (el) {
    el.innerHTML = `<div class="lws-completed-card">
      <div class="lws-completed-hero"><div class="lws-completed-icon">🎉</div><div><h3>学习流已完成</h3>
      <p>总结已保存。你可以继续追问，AI 会带着本轮学习上下文回答。</p></div></div>
      <div class="lws-completion-chat">
        <div class="lws-completion-chat-head"><b>继续和学习引导老师聊聊</b><span>真实流式回答 · 已关联本轮学习记录</span></div>
        <div class="lws-completion-messages" id="lws-completion-messages"></div>
        <div class="lws-completion-suggestions">
          <button type="button" data-completion-question="请根据我刚才的作答，指出最需要继续巩固的一个概念。">我最薄弱的地方</button>
          <button type="button" data-completion-question="请把本轮最关键的概念用一个新例子再讲一遍。">换个例子讲解</button>
          <button type="button" data-completion-question="请根据本轮学习结果给我一道针对性的思考题，不要立即给答案。">再出一道思考题</button>
        </div>
        <form class="lws-completion-form" id="lws-completion-form"><textarea id="lws-completion-input" rows="2" maxlength="800" placeholder="继续追问本轮内容，Enter 发送，Shift+Enter 换行"></textarea><button class="lws-btn lws-btn-primary" type="submit">发送</button></form>
      </div>
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
    bindCompletionChat();
  }
  setFormalPhase(PHASE.COMPLETED, { agentName: '学习流完成' });
  const nextBtn = document.getElementById('lws-btn-next');
  if (nextBtn) { nextBtn.style.display = 'none'; }
  const skipBtn = document.getElementById('lws-btn-skip');
  if (skipBtn) { skipBtn.style.display = 'none'; }
}

function renderCompletionMessages() {
  const host = document.getElementById('lws-completion-messages');
  if (!host) return;
  if (!completionChat.messages.length) {
    host.innerHTML = '<div class="lws-completion-empty">你可以从上面的快捷问题开始，或直接输入自己的问题。</div>';
    return;
  }
  host.innerHTML = completionChat.messages.map((message) => `<div class="lws-completion-message ${message.role}"><div class="message-markdown">${message.content ? renderMarkdownToHtml(message.content) : '<span class="lws-chat-thinking">正在组织回答…</span>'}</div></div>`).join('');
  renderMathInMarkdownElements(host);
  host.scrollTop = host.scrollHeight;
}

function bindCompletionChat() {
  if (!completionChat.messages.length) completionChat = { messages: [], sending: false, abortController: null };
  renderCompletionMessages();
  const form = document.getElementById('lws-completion-form');
  const input = document.getElementById('lws-completion-input');
  form?.addEventListener('submit', (event) => { event.preventDefault(); sendCompletionQuestion(input?.value); });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendCompletionQuestion(input.value); }
  });
  document.querySelectorAll('[data-completion-question]').forEach((button) => {
    button.addEventListener('click', () => sendCompletionQuestion(button.dataset.completionQuestion));
  });
}

async function sendCompletionQuestion(rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message || completionChat.sending || !S) return;
  const input = document.getElementById('lws-completion-input');
  if (input) input.value = '';
  const history = completionChat.messages.filter((item) => item.content).slice(-6).map(({ role, content }) => ({ role, content }));
  const assistant = { role: 'assistant', content: '' };
  completionChat.messages.push({ role: 'user', content: message }, assistant);
  completionChat.sending = true;
  completionChat.abortController = new AbortController();
  renderCompletionMessages();
  const submit = document.querySelector('#lws-completion-form button');
  if (submit) { submit.disabled = true; submit.textContent = '回答中…'; }
  try {
    await streamLearningSessionAssistant(S.session_id, { message, history }, {
      onEvent: (eventName, data) => {
        if (eventName === 'delta') { assistant.content += data.text || ''; renderCompletionMessages(); }
        if (eventName === 'error') throw new Error(data.message || 'AI 对话失败');
      },
    }, completionChat.abortController.signal);
    if (!assistant.content) assistant.content = '暂时没有生成有效回答，请重新提问。';
  } catch (error) {
    assistant.content = error.name === 'AbortError' ? '本次回答已停止。' : (error.message || 'AI 对话暂时不可用。');
  } finally {
    completionChat.sending = false;
    completionChat.abortController = null;
    if (submit) { submit.disabled = false; submit.textContent = '发送'; }
    renderCompletionMessages();
  }
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
    const failedNodeId = String(state.nodeId);
    abortBoth();
    const response = await fetch(apiUrl(`/learning-workflows/sessions/${S.session_id}/retry`), {
      ...authFetchOptions('POST', {
        nodeId: failedNodeId,
        operationId: `retry_${S.session_id}_${failedNodeId}_${Date.now()}`,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || '重试失败');
    const outcome = payload.data || payload;
    if (outcome.session) applySessionSnapshot(outcome.session);
    else {
      const r = await learningWorkflowApi.getSession(S.session_id);
      applySessionSnapshot(r);
    }
    state.nodeRuns = S.node_runs || [];
    state.nodeId = String(S.current_node_id || failedNodeId);
    state.formalAgent = { phase: PHASE.IDLE, requestId: '', agentName: '', agentType: '', workflowConnected: false, result: null, resultAnswer: null, error: null, startedAtMs: null, completedAtMs: null, elapsedMs: 0, timerId: null };

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
// 多模态文件上传
// ========================

let uploadedFiles = [];

function resetUploadedFiles() {
  revokePreviewFiles(uploadedFiles);
  uploadedFiles = [];
}

function initMultimodalUpload() {
  const area = document.getElementById('lws-multimodal-area');
  if (!area) return;

  // 文件选择按钮
  const fileInput = area.querySelector('#lws-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => handleFileSelect(e.target.files));
  }

  // 拖拽上传
  const dropZone = area.querySelector('.lws-drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('lws-dragover'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('lws-dragover'); });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('lws-dragover');
      handleFileSelect(e.dataTransfer.files);
    });
  }

  // 删除按钮委托
  area.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.lws-file-remove');
    if (delBtn) {
      const idx = parseInt(delBtn.dataset.fileIndex, 10);
      removeFile(idx);
    }
  });

  renderFilePreviews();
}

async function handleFileSelect(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (files.length === 0) {
    showToast('请选择图片文件 (JPEG, PNG, GIF, WebP, BMP)', 'warning');
    return;
  }

  const remaining = 3 - uploadedFiles.length;
  if (files.length > remaining) {
    showToast(`最多上传 3 张图片（当前已有 ${uploadedFiles.length} 张，还可添加 ${remaining} 张）`, 'warning');
    files.splice(remaining);
  }

  // 上传文件
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));

  try {
    showToast('正在上传图片...', 'info');
    const result = await learningWorkflowApi.uploadSessionFiles(state.sessionId, formData);
    if (result.code === 200 && result.data?.files) {
      uploadedFiles.push(...result.data.files);
      renderFilePreviews();
      showToast(`已上传 ${result.data.files.length} 张图片`, 'success');
    } else {
      showToast(result.message || '上传失败', 'error');
    }
  } catch (err) {
    showToast('上传失败: ' + (err.message || '网络错误'), 'error');
  }
}

function removeFile(index) {
  if (index >= 0 && index < uploadedFiles.length) {
    revokePreviewFiles([uploadedFiles[index]]);
    uploadedFiles.splice(index, 1);
    renderFilePreviews();
  }
}

function renderFilePreviews() {
  const container = document.getElementById('lws-file-previews');
  if (!container) return;

  if (uploadedFiles.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = uploadedFiles
    .map(
      (f, i) => `
      <div class="lws-file-preview-item">
        <img src="${escAttr(f.previewUrl || f.fileUrl)}" alt="${escAttr(f.fileName)}" class="lws-file-thumb">
        <span class="lws-file-name">${escHtml(f.fileName)}</span>
        <button class="lws-file-remove" data-file-index="${i}" title="删除">&times;</button>
      </div>`,
    )
    .join('');
}

function renderMultimodalUpload() {
  const remaining = 3 - uploadedFiles.length;
  return `
    <div class="lws-multimodal-area" id="lws-multimodal-area">
      <div class="lws-multimodal-header">
        <span class="lws-multimodal-title">📷 图片输入（可选，最多 3 张）</span>
        ${remaining > 0
          ? `<label class="lws-file-select-btn">选择图片<input type="file" id="lws-file-input" accept="image/jpeg,image/png,image/gif,image/webp,image/bmp" multiple hidden></label>`
          : '<span class="lws-file-limit-text">已达上限</span>'}
      </div>
      ${remaining > 0
        ? `<div class="lws-drop-zone">
            <span>拖拽图片到此处，或点击"选择图片"</span>
            <span class="lws-drop-hint">支持 JPEG、PNG、GIF、WebP、BMP，单张不超过 10MB</span>
          </div>`
        : ''}
      <div class="lws-file-previews" id="lws-file-previews"></div>
    </div>`;
}

// ========================
// 工具函数
// ========================

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function showEl(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hideEl(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function escHtml(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
