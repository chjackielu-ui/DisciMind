import { getMe } from '../api/auth.js'
import { getStudentCourses, getStudentCourseKnowledgePoints } from '../api/student.js'
import {
  abandonTrainerSession,
  completeTrainerSession,
  createTrainerSession,
  getTrainerContext,
  getTrainerReport,
  getTrainerSession,
  submitTrainerAnswer,
} from '../api/trainer.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'

function parseHashQuery() {
  const raw = window.location.hash.split('?')[1] || ''
  return Object.fromEntries(new URLSearchParams(raw).entries())
}

async function getAuthedUser() {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return null
    }
  }
  return user
}

function loadingHTML(text = '正在打开训练师...') {
  return `<div class="complex-shell trainer-shell"><div class="complex-loading"><div class="complex-spinner"></div><p>${escapeHtml(text)}</p></div></div>`
}

function trainerStyles() {
  return `
  <style>
    .trainer-shell { display:flex; flex-direction:column; gap:18px; }
    .trainer-topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    .trainer-title h1 { margin:0; font-size:1.45rem; color:var(--text-main); }
    .trainer-title p { margin:5px 0 0; color:var(--text-sub); font-size:0.9rem; }
    .trainer-progress-pill { padding:8px 12px; border-radius:8px; background:rgba(76,175,132,0.1); color:#2f7a5b; font-weight:700; font-size:0.85rem; }
    .trainer-grid { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(280px,0.8fr); gap:18px; align-items:start; }
    .trainer-panel { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:18px; }
    .trainer-panel h3 { margin:0 0 12px; color:var(--text-main); }
    .trainer-meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .trainer-meta span { padding:6px 9px; border-radius:8px; background:var(--bg-subtle); color:var(--text-sub); font-size:0.8rem; }
    .trainer-select-row { display:grid; grid-template-columns:1fr 1fr auto; gap:10px; align-items:end; }
    .trainer-select-row label { display:flex; flex-direction:column; gap:6px; color:var(--text-sub); font-size:0.85rem; }
    .trainer-select-row select { min-width:0; padding:9px 10px; border:1px solid var(--border); border-radius:8px; background:#fff; }
    .trainer-question-stem { font-size:1.05rem; line-height:1.7; color:var(--text-main); margin-bottom:14px; }
    .trainer-option-list { display:flex; flex-direction:column; gap:10px; }
    .trainer-option { width:100%; text-align:left; display:flex; gap:10px; align-items:flex-start; padding:13px 14px; border:1px solid var(--border); border-radius:8px; background:#fff; cursor:pointer; color:var(--text-main); }
    .trainer-option.active { border-color:var(--stu-primary); box-shadow:0 0 0 3px rgba(76,175,132,0.12); }
    .trainer-option-key { width:24px; height:24px; border-radius:50%; background:var(--bg-subtle); display:inline-flex; align-items:center; justify-content:center; font-weight:700; flex:0 0 auto; }
    .trainer-answer-bar { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-top:18px; flex-wrap:wrap; }
    .trainer-confidence { display:flex; align-items:center; gap:8px; color:var(--text-sub); font-size:0.85rem; }
    .trainer-confidence select { padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:#fff; }
    .trainer-feedback { display:grid; gap:12px; }
    .trainer-feedback-card { padding:14px; border-radius:8px; border:1px solid var(--border); background:var(--bg-subtle); }
    .trainer-feedback-card.correct { border-color:rgba(76,175,132,0.35); background:rgba(76,175,132,0.08); }
    .trainer-feedback-card.wrong { border-color:rgba(224,87,110,0.35); background:rgba(224,87,110,0.08); }
    .trainer-status-list { display:flex; flex-direction:column; gap:9px; }
    .trainer-status-item { display:flex; justify-content:space-between; gap:10px; padding:10px 0; border-bottom:1px solid var(--border); font-size:0.86rem; }
    .trainer-status-item:last-child { border-bottom:0; }
    .trainer-events { display:flex; flex-direction:column; gap:10px; max-height:360px; overflow:auto; }
    .trainer-event { border-left:3px solid var(--stu-primary); padding-left:10px; }
    .trainer-event b { display:block; color:var(--text-main); font-size:0.86rem; }
    .trainer-event span { color:var(--text-sub); font-size:0.78rem; }
    .trainer-summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:16px; }
    .trainer-summary-item { padding:12px; border-radius:8px; background:var(--bg-subtle); }
    .trainer-summary-item b { display:block; color:var(--text-main); font-size:1.25rem; }
    .trainer-summary-item span { color:var(--text-sub); font-size:0.78rem; }
    @media (max-width: 900px) {
      .trainer-grid, .trainer-select-row, .trainer-summary-grid { grid-template-columns:1fr; }
      .trainer-answer-bar { align-items:stretch; }
      .trainer-answer-bar .complex-btn, .trainer-answer-bar .complex-btn-secondary { width:100%; }
    }
  </style>`
}

function stateLabel(phase) {
  const labels = {
    setup: '准备训练',
    generating: '正在生成诊断题',
    pretestReady: '诊断题已就绪',
    answering: '正在作答',
    evaluating: '正在深度批改',
    feedback: '查看反馈',
    adaptive: '制定下一题策略',
    summary: '训练总结',
    error: '出现错误',
  }
  return labels[phase] || '训练师'
}

function buildTopbar(state) {
  const ctx = state.context || {}
  const session = state.session?.session || state.session
  const progress = state.session?.progress || {}
  const courseName = ctx.course?.courseName || state.session?.course?.courseName || '选择课程'
  const kpName = ctx.knowledgePoint?.knowledgePointName || state.session?.knowledgePoint?.knowledgePointName || '选择知识点'
  return `
    <div class="trainer-topbar">
      <button class="complex-btn-ghost" id="btn-trainer-back" type="button">返回</button>
      <div class="trainer-title">
        <h1>AI 训练师</h1>
        <p>${escapeHtml(courseName)} · ${escapeHtml(kpName)} · ${escapeHtml(stateLabel(state.phase))}</p>
      </div>
      <span class="trainer-progress-pill">${progress.completedCount || 0}/${progress.totalCount || session?.questionCount || 0}</span>
    </div>`
}

function buildSetupPanel(state) {
  const context = state.context
  const active = context?.activeSession
  return `
    <section class="trainer-panel">
      <h3>训练设置</h3>
      <div class="trainer-select-row">
        <label>课程
          <select id="trainer-course-select">
            <option value="">请选择课程</option>
            ${state.courses.map(course => `<option value="${course.course_id}" ${String(course.course_id) === String(state.courseId) ? 'selected' : ''}>${escapeHtml(course.course_name)}</option>`).join('')}
          </select>
        </label>
        <label>知识点
          <select id="trainer-kp-select" ${state.loadingKps || !state.courseId ? 'disabled' : ''}>
            <option value="">请选择知识点</option>
            ${state.knowledgePoints.map(kp => `<option value="${kp.knowledge_point_id}" ${String(kp.knowledge_point_id) === String(state.knowledgePointId) ? 'selected' : ''}>${escapeHtml(kp.knowledge_point_name)}</option>`).join('')}
          </select>
        </label>
        <button class="complex-btn" id="btn-start-trainer" type="button" ${state.generating || !state.courseId || !state.knowledgePointId ? 'disabled' : ''}>
          ${state.generating ? '正在启动...' : '训练师诊断'}
        </button>
      </div>
      ${context ? `
        <div class="trainer-meta">
          <span>掌握度：${context.mastery?.masteryScore ?? '暂无'}</span>
          <span>画像：${context.studentPortrait?.profileDataSufficient ? '已有数据' : '数据不足'}</span>
          <span>近期正确率：${context.recentPractice?.accuracy ?? '暂无'}${context.recentPractice?.accuracy == null ? '' : '%'}</span>
        </div>
      ` : ''}
      ${active ? `
        <div class="trainer-feedback-card" style="margin-top:14px;">
          <b>已有进行中的训练师会话</b>
          <p style="margin:8px 0 12px;color:var(--text-sub);">可以继续当前训练，或先放弃后重新开始。</p>
          <button class="complex-btn-secondary" id="btn-continue-active-trainer" type="button" data-session-id="${active.sessionId}">继续训练</button>
          <button class="complex-btn-ghost" id="btn-abandon-active-trainer" type="button" data-session-id="${active.sessionId}">放弃当前会话</button>
        </div>
      ` : ''}
    </section>`
}

function buildQuestionPanel(state) {
  const q = state.currentQuestion
  if (!q) {
    return `
      <section class="trainer-panel">
        <h3>当前暂无题目</h3>
        <p style="color:var(--text-sub);">可以完成本次训练并查看总结。</p>
        <button class="complex-btn" id="btn-complete-trainer-empty" type="button">完成训练</button>
      </section>`
  }
  return `
    <section class="trainer-panel">
      <h3>诊断题 ${q.questionOrder || ''}</h3>
      <div class="trainer-question-stem">${escapeHtml(q.stem || '')}</div>
      <div class="trainer-option-list">
        ${(q.options || []).map(option => `
          <button class="trainer-option ${state.selectedOption === option.key ? 'active' : ''}" type="button" data-option="${escapeHtml(option.key)}">
            <span class="trainer-option-key">${escapeHtml(option.key)}</span>
            <span>${escapeHtml(option.content)}</span>
          </button>`).join('')}
      </div>
      <div class="trainer-answer-bar">
        <label class="trainer-confidence">信心
          <select id="trainer-confidence">
            <option value="high" ${state.confidenceLevel === 'high' ? 'selected' : ''}>高</option>
            <option value="medium" ${state.confidenceLevel === 'medium' ? 'selected' : ''}>中</option>
            <option value="low" ${state.confidenceLevel === 'low' ? 'selected' : ''}>低</option>
          </select>
        </label>
        <button class="complex-btn" id="btn-submit-trainer-answer" type="button" ${state.evaluating || !state.selectedOption ? 'disabled' : ''}>
          ${state.evaluating ? '正在深度批改...' : '提交答案'}
        </button>
      </div>
    </section>`
}

function buildFeedbackPanel(state) {
  const feedback = state.feedback || {}
  const result = feedback.answerResult || {}
  return `
    <section class="trainer-panel">
      <h3>本题反馈</h3>
      <div class="trainer-feedback">
        <div class="trainer-feedback-card ${result.isCorrect ? 'correct' : 'wrong'}">
          <b>${result.isCorrect ? '回答正确' : '回答错误'}</b>
          <p>你的答案：${escapeHtml(result.selectedOption || '-')}；正确答案：${escapeHtml(result.correctOption || '-')}</p>
          ${result.explanation ? `<p>${escapeHtml(result.explanation)}</p>` : ''}
        </div>
        ${feedback.evaluation ? `
          <div class="trainer-feedback-card">
            <b>错误类型与补救建议</b>
            <p>${escapeHtml(feedback.evaluation.error_type || feedback.evaluation.verdict || '已完成深度批改')}</p>
            <p>${escapeHtml(feedback.evaluation.error_analysis?.root_cause || feedback.evaluation.remediation?.next_step || feedback.evaluation.message || '')}</p>
          </div>
        ` : ''}
        ${feedback.adaptiveDecision ? `
          <div class="trainer-feedback-card">
            <b>当前策略</b>
            <p>${escapeHtml(feedback.adaptiveDecision.reason || feedback.adaptiveDecision.message || feedback.adaptiveDecision.action || '继续完成下一题')}</p>
          </div>
        ` : ''}
      </div>
      <div class="trainer-answer-bar">
        ${feedback.nextQuestion ? '<button class="complex-btn" id="btn-trainer-next" type="button">进入下一题</button>' : '<button class="complex-btn" id="btn-complete-trainer" type="button">完成训练</button>'}
        <button class="complex-btn-ghost" id="btn-refresh-trainer" type="button">刷新状态</button>
      </div>
    </section>`
}

function buildSummaryPanel(state) {
  const report = state.report || {}
  const summary = report.sessionSummary || {}
  return `
    <section class="trainer-panel">
      <h3>训练师训练总结</h3>
      <div class="trainer-summary-grid">
        <div class="trainer-summary-item"><b>${summary.completedCount || 0}</b><span>完成题数</span></div>
        <div class="trainer-summary-item"><b>${summary.correctCount || 0}</b><span>正确题数</span></div>
        <div class="trainer-summary-item"><b>${summary.accuracy || 0}%</b><span>正确率</span></div>
        <div class="trainer-summary-item"><b>${summary.totalTimeSeconds || 0}s</b><span>用时</span></div>
      </div>
      <div class="trainer-feedback-card">
        <b>掌握度变化</b>
        <p>${report.masteryChange?.masteryBefore ?? '暂无'} → ${report.masteryChange?.masteryAfter ?? '暂无'}</p>
      </div>
      <div class="trainer-answer-bar">
        <button class="complex-btn-secondary" id="btn-trainer-history" type="button">返回练习中心</button>
        <button class="complex-btn-ghost" id="btn-trainer-report-refresh" type="button">刷新报告</button>
      </div>
    </section>`
}

function buildStatusPanel(state) {
  const progress = state.session?.progress || {}
  return `
    <aside class="trainer-panel">
      <h3>训练师状态</h3>
      <div class="trainer-status-list">
        <div class="trainer-status-item"><span>状态</span><b>${escapeHtml(stateLabel(state.phase))}</b></div>
        <div class="trainer-status-item"><span>进度</span><b>${progress.percent || 0}%</b></div>
        <div class="trainer-status-item"><span>正确率</span><b>${progress.accuracy || 0}%</b></div>
      </div>
      <h3 style="margin-top:18px;">真实执行时间线</h3>
      <div class="trainer-events">
        ${(state.events || []).length ? state.events.map(event => `
          <div class="trainer-event">
            <b>${escapeHtml(event.title || event.type)}</b>
            <span>${escapeHtml(event.at || '')}</span>
          </div>`).join('') : '<p style="color:var(--text-sub);font-size:0.86rem;">启动训练后会显示真实事件。</p>'}
      </div>
    </aside>`
}

function buildMain(state) {
  let left
  if (state.phase === 'summary') left = buildSummaryPanel(state)
  else if (state.phase === 'feedback') left = buildFeedbackPanel(state)
  else if (state.phase === 'answering' || state.phase === 'evaluating' || state.phase === 'pretestReady') left = buildQuestionPanel(state)
  else left = buildSetupPanel(state)

  return `
    ${trainerStyles()}
    <div class="complex-shell trainer-shell">
      ${buildTopbar(state)}
      <div class="trainer-grid">
        ${left}
        ${buildStatusPanel(state)}
      </div>
    </div>`
}

export async function renderStudentTrainerSession(app, params = {}) {
  const user = await getAuthedUser()
  if (!user) return

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: loadingHTML(), user })

  const query = parseHashQuery()
  const state = {
    phase: 'setup',
    user,
    courseId: query.courseId || query.course_id || '',
    knowledgePointId: query.knowledgePointId || query.knowledge_point_id || '',
    sessionId: params.session_id || params.sessionId || query.sessionId || query.session_id || '',
    courses: [],
    knowledgePoints: [],
    context: null,
    session: null,
    currentQuestion: null,
    selectedOption: '',
    confidenceLevel: 'medium',
    feedback: null,
    report: null,
    events: [],
    generating: false,
    evaluating: false,
    loadingKps: false,
  }

  function rerender() {
    renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildMain(state), user })
    bindEvents()
  }

  async function loadCourses() {
    const result = await getStudentCourses()
    state.courses = result.data?.list || []
    if (!state.courseId && state.courses[0]) state.courseId = state.courses[0].course_id
  }

  async function loadKnowledgePoints() {
    if (!state.courseId) return
    state.loadingKps = true
    rerender()
    try {
      const result = await getStudentCourseKnowledgePoints(state.courseId)
      state.knowledgePoints = result.data?.list || []
      if (!state.knowledgePointId && state.knowledgePoints[0]) state.knowledgePointId = state.knowledgePoints[0].knowledge_point_id
    } finally {
      state.loadingKps = false
    }
  }

  async function loadContext() {
    if (!state.courseId || !state.knowledgePointId) return
    const result = await getTrainerContext({
      courseId: state.courseId,
      knowledgePointId: state.knowledgePointId,
    })
    state.context = result.data
  }

  async function loadSession(sessionId = state.sessionId) {
    if (!sessionId) return
    const result = await getTrainerSession(sessionId)
    state.sessionId = sessionId
    state.session = result.data
    state.currentQuestion = result.data.currentQuestion
    state.feedback = result.data.latestFeedback
    state.events = result.data.events || []
    state.phase = result.data.session?.status === 'SUBMITTED'
      ? 'summary'
      : (state.currentQuestion ? 'answering' : 'feedback')
    if (state.phase === 'summary') {
      const report = await getTrainerReport(sessionId)
      state.report = report.data
    }
  }

  async function startTrainer() {
    if (state.generating) return
    if (!state.courseId || !state.knowledgePointId) {
      showToast('请先选择课程和知识点', 'warning')
      return
    }
    if (state.context?.activeSession?.sessionId) {
      window.location.hash = `#/student/trainer/sessions/${state.context.activeSession.sessionId}`
      return
    }
    state.generating = true
    state.phase = 'generating'
    rerender()
    try {
      const result = await createTrainerSession({
        courseId: Number(state.courseId),
        knowledgePointId: Number(state.knowledgePointId),
        questionCount: 3,
        locale: 'zh-CN',
      })
      const sessionId = result.data?.session?.sessionId
      if (!sessionId) throw new Error('训练师会话创建失败')
      window.location.hash = `#/student/trainer/sessions/${sessionId}`
    } catch (err) {
      state.phase = 'setup'
      showToast(err.message || '训练师启动失败', 'error')
    } finally {
      state.generating = false
      rerender()
    }
  }

  async function submitAnswer() {
    if (!state.currentQuestion || !state.selectedOption || state.evaluating) return
    state.evaluating = true
    state.phase = 'evaluating'
    rerender()
    try {
      const result = await submitTrainerAnswer(state.sessionId, {
        questionKey: state.currentQuestion.questionKey,
        selectedOption: state.selectedOption,
        confidenceLevel: state.confidenceLevel,
        timeSpentSeconds: 0,
        locale: 'zh-CN',
      })
      state.feedback = result.data
      state.events = result.data.agentEvents || state.events
      state.phase = 'feedback'
      showToast(result.data.answerResult?.isCorrect ? '回答正确' : '已生成反馈', result.data.answerResult?.isCorrect ? 'success' : 'warning')
      await loadSession(state.sessionId)
      state.phase = 'feedback'
      state.feedback = result.data
    } catch (err) {
      state.phase = 'answering'
      showToast(err.message || '提交失败，请稍后重试', 'error')
    } finally {
      state.evaluating = false
      rerender()
    }
  }

  async function complete() {
    if (!state.sessionId) return
    try {
      const result = await completeTrainerSession(state.sessionId)
      state.report = result.data.report
      state.phase = 'summary'
      await loadSession(state.sessionId)
      state.phase = 'summary'
      showToast('训练已完成', 'success')
      rerender()
    } catch (err) {
      showToast(err.message || '完成训练失败', 'error')
    }
  }

  async function abandon(sessionId = state.sessionId) {
    if (!sessionId) return
    if (!window.confirm('确定放弃当前训练师会话吗？已提交的答案会保留。')) return
    try {
      await abandonTrainerSession(sessionId)
      showToast('已放弃当前训练', 'success')
      window.location.hash = '#/student/practice'
    } catch (err) {
      showToast(err.message || '放弃失败', 'error')
    }
  }

  function bindEvents() {
    document.getElementById('btn-trainer-back')?.addEventListener('click', () => { window.location.hash = '#/student/practice' })
    document.getElementById('trainer-course-select')?.addEventListener('change', async (event) => {
      state.courseId = event.target.value
      state.knowledgePointId = ''
      state.context = null
      await loadKnowledgePoints()
      await loadContext().catch(() => {})
      rerender()
    })
    document.getElementById('trainer-kp-select')?.addEventListener('change', async (event) => {
      state.knowledgePointId = event.target.value
      state.context = null
      await loadContext().catch(err => showToast(err.message || '上下文加载失败', 'error'))
      rerender()
    })
    document.getElementById('btn-start-trainer')?.addEventListener('click', startTrainer)
    document.getElementById('btn-continue-active-trainer')?.addEventListener('click', (event) => {
      window.location.hash = `#/student/trainer/sessions/${event.currentTarget.dataset.sessionId}`
    })
    document.getElementById('btn-abandon-active-trainer')?.addEventListener('click', (event) => abandon(event.currentTarget.dataset.sessionId))
    document.querySelectorAll('.trainer-option').forEach(button => {
      button.addEventListener('click', () => {
        if (state.evaluating) return
        state.selectedOption = button.dataset.option
        rerender()
      })
    })
    document.getElementById('trainer-confidence')?.addEventListener('change', event => { state.confidenceLevel = event.target.value })
    document.getElementById('btn-submit-trainer-answer')?.addEventListener('click', submitAnswer)
    document.getElementById('btn-trainer-next')?.addEventListener('click', () => {
      state.currentQuestion = state.feedback?.nextQuestion
      state.feedback = null
      state.selectedOption = ''
      state.phase = 'answering'
      rerender()
    })
    document.getElementById('btn-complete-trainer')?.addEventListener('click', complete)
    document.getElementById('btn-complete-trainer-empty')?.addEventListener('click', complete)
    document.getElementById('btn-refresh-trainer')?.addEventListener('click', () => loadSession().then(rerender))
    document.getElementById('btn-trainer-report-refresh')?.addEventListener('click', () => loadSession().then(rerender))
    document.getElementById('btn-trainer-history')?.addEventListener('click', () => { window.location.hash = '#/student/practice' })
  }

  try {
    await loadCourses()
    if (state.courseId) await loadKnowledgePoints()
    if (state.sessionId) await loadSession(state.sessionId)
    else if (state.courseId && state.knowledgePointId) await loadContext()
    rerender()
  } catch (err) {
    renderDashboardLayout(app, {
      menuItems: STUDENT_MENU_ITEMS,
      contentHTML: `<div class="complex-shell trainer-shell"><div class="complex-error"><h3>训练师加载失败</h3><p>${escapeHtml(err.message || '请稍后重试')}</p><button class="complex-btn" id="btn-trainer-retry">重新加载</button></div></div>`,
      user,
    })
    document.getElementById('btn-trainer-retry')?.addEventListener('click', () => renderStudentTrainerSession(app, params))
  }
}
