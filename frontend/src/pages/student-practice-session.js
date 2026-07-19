// 学生端 — 智能练习答题页面（V4 专注答题 + 流式AI + 单题顺序模式）
// 三标签右侧面板：题目信息 | 题目解析 | AI提问
// 流式 AI 返回：复用 SSE 模式，逐段追加
// 单题模式：maxUnlockedIndex 控制顺序作答
// 计时器：提交后停止

import { getMe } from '../api/auth.js'
import {
  abandonPracticeSession,
  getPracticeSessionDetail,
  savePracticeItemAnswer,
  submitPracticeItem,
  submitPracticeSession,
  streamPracticeQuestionAi,
  generatePracticeAnalysis,
} from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml } from '../utils/format.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js'
import { showToast } from '../utils/toast.js'
import { closeExamLeaveModal, showExamLeaveModal } from '../components/common/exam-leave-modal.js'
import {
  buildAnswerControl,
  buildQuestionNavGrouped,
  formatPracticeAnswer,
  getBlankCount,
  getQuestionKnowledgePoint,
  isPracticeAnswered,
  loadPracticeSessionSnapshot,
  removePracticeSessionSnapshot,
  normalizeQuestionType,
  savePracticeSessionSnapshot,
} from '../components/practice/practice-components.js'
import {
  questionTypeTagHtml,
  difficultyTagHtml,
  statusTagHtml,
} from '../components/practice/practice-tags.js'

let practiceElapsedTimer = null
let focusModeCleanup = null

// ========================
// 工具函数
// ========================

function getSessionId(params) {
  if (params?.practice_session_id) return Number(params.practice_session_id)
  const match = window.location.hash.slice(1).match(/^\/student\/practice\/sessions\/(\d+)$/)
  return match ? Number(match[1]) : null
}

async function getAuthedUser() {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return null }
  }
  return user
}

function formatElapsed(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = String(Math.floor(total / 3600)).padStart(2, '0')
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function getStartedAtMs(snapshot) {
  const fromSnapshot = Number(snapshot?.startedAtMs)
  if (Number.isFinite(fromSnapshot) && fromSnapshot > 0) return fromSnapshot
  const fromSession = Date.parse(snapshot?.session?.started_at || '')
  if (Number.isFinite(fromSession)) return fromSession
  return Date.now()
}

function normalizeQuestions(questions) {
  return (questions || []).map((q, i) => ({ ...q, question_order: q.question_order || i + 1 }))
    .sort((a, b) => (a.question_order || 0) - (b.question_order || 0))
}

function initAnswers(questions, savedAnswers = {}) {
  const answers = { ...savedAnswers }
  questions.forEach(q => {
    if (Object.prototype.hasOwnProperty.call(answers, q.question_id)) return
    const t = normalizeQuestionType(q.question_type)
    if (t === 'multiple_choice') answers[q.question_id] = []
    else if (t === 'fill_blank') answers[q.question_id] = Array.from({ length: getBlankCount(q) }, () => '')
    else answers[q.question_id] = ''
  })
  return answers
}

function buildResultsById(result) {
  const map = {}
  ;(result?.results || []).forEach(r => { map[r.question_id] = r })
  return map
}

function answeredCount(questions, answers) {
  return questions.filter(q => isPracticeAnswered(answers[q.question_id])).length
}

function buildAnswerPayload(questions, answers) {
  return questions.map(q => ({ questionId: q.question_id, answer: answers[q.question_id] }))
}

// ========================
// 模式判断
// ========================

function getSessionMode(snapshot) { return snapshot?.config?.sessionMode || 'practice' }
function getAnswerMode(snapshot) { return snapshot?.config?.answerMode || 'single' }
function isExamMode(snapshot) { return getSessionMode(snapshot) === 'exam' }
function isSingleMode(snapshot) { return getAnswerMode(snapshot) === 'single' && !isExamMode(snapshot) }
function shouldPersistProgress(snapshot) { return !isExamMode(snapshot) }

function inferConfigFromSession(session = {}, fallback = {}) {
  const mode = String(session.mode || '').toUpperCase()
  const answerMode = String(session.answer_mode || '').toUpperCase()
  const sessionMode = mode === 'EXAM' ? 'exam' : 'practice'
  const resolvedAnswerMode = sessionMode === 'exam'
    ? 'paper'
    : (mode === 'PAPER_PRACTICE' || answerMode === 'PAPER' ? 'paper' : 'single')
  return {
    ...(fallback || {}),
    sessionMode,
    answerMode: resolvedAnswerMode,
  }
}

function buildSnapshotFromRemote(detail, local = {}) {
  const session = detail?.session || {}
  const questions = normalizeQuestions(detail?.questions || [])
  const answers = { ...(detail?.answers || {}) }
  questions.forEach((q) => {
    if (q.draft_answer != null) answers[q.question_id] = q.draft_answer
  })
  const results = [
    ...(detail?.results || []),
    ...questions.map(q => q.result).filter(Boolean),
  ]
  const itemStatuses = {}
  questions.forEach(q => { itemStatuses[q.question_id] = q.item_status || 'UNANSWERED' })
  results.forEach(r => { itemStatuses[r.question_id] = r.item_status || 'GRADED' })

  return {
    ...local,
    session,
    questions,
    answers: { ...(local.answers || {}), ...answers },
    currentIndex: Number(session.current_item_index ?? local.currentIndex ?? 0),
    submitted: Boolean(detail?.submitted || String(session.status || '').toUpperCase() === 'SUBMITTED' || local.submitted),
    result: results.length ? { ...(local.result || {}), results, session } : (local.result || null),
    itemStatuses: { ...(local.itemStatuses || {}), ...itemStatuses },
    subject: detail?.subject || local.subject || null,
    config: inferConfigFromSession(session, local.config),
    startedAtMs: Date.parse(session.started_at || '') || local.startedAtMs || Date.now(),
    finalDurationSeconds: session.duration_seconds ?? local.finalDurationSeconds ?? null,
    practice_session_id: session.practice_session_id || local.practice_session_id,
  }
}

// ========================
// 权限控制
// ========================

function isSessionSubmitted(state) { return Boolean(state.submitted) }
function isCurrentQuestionSubmitted(state, snapshot) {
  if (isSessionSubmitted(state)) return true
  if (isSingleMode(snapshot)) {
    const cur = state.questions[state.currentIndex]
    return cur && !!state.resultsById[cur.question_id]
  }
  return false
}
function canViewAnalysis(state, snapshot) {
  if (isExamMode(snapshot) && !isSessionSubmitted(state)) return false
  const cur = state.questions[state.currentIndex]
  return isCurrentQuestionSubmitted(state, snapshot) || Boolean(cur && state.resultsById[cur.question_id])
}
function canAskAi(state, snapshot) {
  if (isExamMode(snapshot) && !isSessionSubmitted(state)) return false
  const cur = state.questions[state.currentIndex]
  return isCurrentQuestionSubmitted(state, snapshot) || Boolean(cur && state.resultsById[cur.question_id])
}
function isExamActive(state, snapshot) { return isExamMode(snapshot) && !isSessionSubmitted(state) }
function isPracticeLocked(state, snapshot) { return isExamMode(snapshot) && !isSessionSubmitted(state) }

// ========================
// 单题模式 — 顺序控制
// ========================

function canJumpToQuestion(index, state, snapshot) {
  if (!isSingleMode(snapshot)) return true
  return index <= (state.maxUnlockedIndex ?? 0)
}

function isQuestionLocked(index, state, snapshot) {
  if (!isSingleMode(snapshot)) return false
  return index > (state.maxUnlockedIndex ?? 0)
}

// ========================
// 构建函数
// ========================

function buildLoading() {
  return `<div class="complex-shell practice-shell-v4"><div class="complex-loading"><div class="complex-spinner"></div><p>正在打开练习...</p></div></div>`
}

function buildMissing() {
  return `<div class="complex-shell practice-shell-v4"><div class="complex-error"><h3>练习会话不存在</h3><p>请从智能练习中心重新开始一次练习。</p><button class="complex-btn" id="btn-back-practice">返回练习中心</button></div></div>`
}

// 顶部信息栏（精简）
function buildTopbar(snapshot, state) {
  const answered = answeredCount(state.questions, state.answers)
  const total = state.questions.length
  const subject = snapshot.subject?.course_name || '智能练习'
  const exam = isExamMode(snapshot)
  const single = isSingleMode(snapshot)
  const sessionLabel = exam ? '考试模式' : '练习模式'
  const answerLabel = single ? '单题模式' : '整卷模式'

  let elapsed
  if (state.submitted && state.finalDurationSeconds != null) elapsed = state.finalDurationSeconds
  else if (state.submitted) elapsed = Math.round((Date.now() - state.startedAtMs) / 1000)
  else elapsed = Math.round((Date.now() - state.startedAtMs) / 1000)

  return `<section class="exam-topbar practice-topbar-v4 ${exam ? 'exam-topbar-mode' : ''}">
    <div class="topbar-left">
      <h1 class="exam-title">${escapeHtml(subject)}</h1>
      <div class="topbar-mode-badges">
        <span class="mode-badge ${exam ? 'exam' : 'practice'}">${sessionLabel}</span>
        <span class="mode-badge ${single ? 'single' : 'paper'}">${answerLabel}</span>
        ${state.submitted ? '<span class="mode-badge submitted">已提交</span>' : '<span class="mode-badge answering">作答中</span>'}
        ${single && !state.submitted ? `<span class="mode-badge single">第${(state.maxUnlockedIndex || 0) + 1}/${total}题</span>` : ''}
      </div>
      <div class="exam-meta-row">
        <span>进度 ${answered}/${total}</span>
        <span>用时 <b id="practice-elapsed">${formatElapsed(elapsed)}</b></span>
        ${!state.submitted ? `<span>${exam ? '进度不保存' : `保存 ${escapeHtml(state.saveStatus || '已同步')}`}</span>` : ''}
        ${snapshot.generated_count ? `<span>AI补题 ${snapshot.generated_count}</span>` : ''}
      </div>
    </div>
    <div class="topbar-right">
      ${!state.submitted ? '<button class="complex-btn-secondary" id="btn-back-practice-top" type="button">离开本次</button>' : ''}
      ${state.submitted ? '<button class="complex-btn-secondary" id="btn-back-practice-top" type="button">← 返回练习中心</button>' : ''}
      ${state.submitted ? '<button class="complex-btn-secondary" id="btn-go-wrong-book" type="button">错题本</button>' : ''}
    </div>
  </section>`
}

function buildSummary(snapshot, state) {
  if (!state.submitted) return ''
  const s = state.result?.summary || {}
  const sess = state.result?.session || {}
  const total = s.question_count || state.questions.length
  const correct = s.correct_count || 0
  const wrong = s.wrong_count || Math.max(0, total - correct)
  const acc = total ? Math.round((correct / total) * 100) : 0
  return `<section class="practice-result-strip">
    <div><span>得分</span><b>${sess.score ?? '--'} / ${sess.total_score ?? '--'}</b></div>
    <div><span>正确率</span><b>${acc}%</b></div>
    <div><span>答对</span><b class="ok">${correct}</b></div>
    <div><span>答错</span><b class="bad">${wrong}</b></div>
    <div><span>错题本新增</span><b>${(s.wrong_question_created_count || 0) + (s.wrong_question_updated_count || 0)}</b></div>
  </section>`
}

function buildSingleResultBadge(result) {
  if (!result) return ''
  if (result.is_correct === true) return '<span class="status-pill correct">✓ 答对</span>'
  if (result.is_correct === false) return '<span class="status-pill wrong">✗ 答错</span>'
  return '<span class="status-pill warning">待确认</span>'
}

// 题目卡片（中间主区域）
function buildQuestionCard(question, index, state, snapshot) {
  const result = state.resultsById[question.question_id]
  const kp = getQuestionKnowledgePoint(question)
  const content = question.question_content || question.content || question.title || ''
  const value = state.answers[question.question_id]
  const score = result ? `${result.score ?? 0} / ${result.max_score ?? result.total_score ?? question.score ?? 0}` : `${question.score || 0} 分`
  const single = isSingleMode(snapshot)
  const singleSubmitted = single && !!result
  const itemSubmitted = !!result && !isExamMode(snapshot)

  return `<section class="question-card practice-question-card-v4${result ? (result.is_correct === true ? ' practice-question-correct' : (result.is_correct === false ? ' practice-question-wrong' : '')) : ''}" data-question-id="${question.question_id}">
    <div class="question-head">
      <div>
        <h2>第 ${index + 1} 题</h2>
        <div class="practice-question-tags">
          ${questionTypeTagHtml(normalizeQuestionType(question.question_type))}
          ${difficultyTagHtml(question.difficulty_level)}
          <span class="complex-tag">${score}</span>
          ${kp?.knowledge_point_name ? `<span class="complex-tag">${escapeHtml(kp.knowledge_point_name)}</span>` : ''}
        </div>
      </div>
      <div class="practice-result-head">${buildSingleResultBadge(result)}</div>
    </div>
    <div class="question-content">${escapeHtml(content)}</div>
    <div class="answer-area">${buildAnswerControl(question, value, result, state.submitted || singleSubmitted || itemSubmitted)}</div>
    ${(state.submitted || singleSubmitted || itemSubmitted) ? `
    <div class="answer-compare-grid practice-answer-compare">
      <div class="answer-box student-answer"><span>我的答案</span><b>${escapeHtml(formatPracticeAnswer(result?.student_answer ?? value))}</b></div>
      <div class="answer-box correct-answer"><span>正确答案</span><b>${escapeHtml(formatPracticeAnswer(result?.correct_answer))}</b></div>
    </div>` : ''}
  </section>`
}

// ========================
// 右侧三标签面板
// ========================

function buildTabButtons(state, snapshot) {
  const examActive = isExamActive(state, snapshot)
  const tabs = [{ id: 'info', label: '题目信息', icon: '📋' }]
  if (!examActive || state.submitted) {
    tabs.push({ id: 'analysis', label: '题目解析', icon: '📖' })
    tabs.push({ id: 'ai', label: 'AI提问', icon: '💬' })
  }
  const active = state.activeTab || 'info'
  return `<div class="side-tabs-bar">${tabs.map(t => `
    <button class="side-tab-btn${active === t.id ? ' active' : ''}" data-tab="${t.id}" type="button">
      <span class="side-tab-icon">${t.icon}</span><span class="side-tab-label">${t.label}</span>
    </button>`).join('')}</div>`
}

function buildInfoTab(question, state, snapshot) {
  const result = state.resultsById[question.question_id]
  const itemStatus = state.itemStatuses?.[question.question_id] || question.item_status || 'UNANSWERED'
  const kp = getQuestionKnowledgePoint(question)
  const single = isSingleMode(snapshot)
  const submitted = state.submitted || (single && !!result)
  let statusText = '未提交', statusClass = ''
  if (submitted && result) {
    if (result.is_correct === true) { statusText = '✓ 答对'; statusClass = 'correct' }
    else if (result.is_correct === false) { statusText = '✗ 答错'; statusClass = 'wrong' }
    else { statusText = '已提交'; statusClass = 'partial' }
  } else if (result) {
    statusText = result.is_correct === true ? '✓ 答对' : (result.is_correct === false ? '✗ 答错' : '已提交')
    statusClass = result.is_correct === true ? 'correct' : (result.is_correct === false ? 'wrong' : 'partial')
  } else if (itemStatus === 'CONFIRMED') {
    statusText = isExamMode(snapshot) ? '已确认' : '已提交'
    statusClass = 'partial'
  } else if (itemStatus === 'SAVED') {
    statusText = '已保存'
    statusClass = 'partial'
  }
  const answered = isPracticeAnswered(state.answers[question.question_id])
  return `<div class="side-tab-content" id="tab-content-info">
    <h4 class="side-tab-title">题目信息</h4>
    <div class="info-grid">
      <div class="info-row"><span class="info-label">知识点</span><span class="info-value">${escapeHtml(kp?.knowledge_point_name || '暂未标注')}</span></div>
      <div class="info-row"><span class="info-label">难度</span><span class="info-value">${difficultyTagHtml(question.difficulty_level)}</span></div>
      <div class="info-row"><span class="info-label">题型</span><span class="info-value">${questionTypeTagHtml(normalizeQuestionType(question.question_type))}</span></div>
      <div class="info-row"><span class="info-label">状态</span><span class="info-value status-text ${statusClass}">${statusText}</span></div>
      <div class="info-row"><span class="info-label">作答</span><span class="info-value">${answered ? '已作答' : '未作答'}</span></div>
      ${result?.is_correct === false ? `<div class="info-row"><span class="info-label">错题</span><span class="info-value">${statusTagHtml('wrong')}</span></div>` : ''}
      ${isSingleMode(snapshot) && !state.submitted ? `<div class="info-row"><span class="info-label">解锁进度</span><span class="info-value">${(state.maxUnlockedIndex || 0) + 1} / ${state.questions.length}</span></div>` : ''}
    </div>
  </div>`
}

function buildAnalysisTab(question, state, snapshot) {
  const result = state.resultsById[question.question_id]
  const canView = canViewAnalysis(state, snapshot)
  const qid = question.question_id
  const aiAnalysis = state.aiAnalyses?.[qid]
  const aiAnalysisLoading = state.aiAnalysisLoading?.[qid]

  if (!canView) {
    const exam = isExamMode(snapshot)
    const single = isSingleMode(snapshot)
    let msg = '提交整卷后可查看解析。'
    if (exam) msg = '考试提交后可查看解析。'
    else if (single) msg = '提交本题后可查看解析。'
    return `<div class="side-tab-content" id="tab-content-analysis"><h4 class="side-tab-title">题目解析</h4><div class="tab-lock-state"><span class="lock-icon">🔒</span><p>${msg}</p></div></div>`
  }

  const officialAnalysis = result?.answer_analysis || result?.feedback || ''
  const correctAnswer = formatPracticeAnswer(result?.correct_answer)
  const myAnswer = formatPracticeAnswer(result?.student_answer ?? state.answers[question.question_id])

  return `<div class="side-tab-content" id="tab-content-analysis">
    <h4 class="side-tab-title">题目解析</h4>
    <div class="analysis-section">
      <div class="analysis-block correct-block"><b>正确答案</b><p>${escapeHtml(correctAnswer)}</p></div>
      <div class="analysis-block my-block"><b>我的答案</b><p>${escapeHtml(myAnswer)}</p></div>
      ${officialAnalysis ? `<div class="analysis-block official-block"><b>官方解析</b><div class="analysis-text">${escapeHtml(officialAnalysis)}</div></div>` : `<div class="analysis-block official-block"><b>官方解析</b><p class="analysis-empty">暂无官方解析</p></div>`}
    </div>
    ${!aiAnalysis && !aiAnalysisLoading ? `<div class="ai-gen-analysis-area"><p class="ai-gen-hint">可使用 AI 生成补充解析</p><button class="complex-btn-secondary ai-gen-btn" id="btn-gen-analysis" type="button">✨ AI生成解析</button></div>` : ''}
    ${aiAnalysisLoading ? `<div class="ai-gen-analysis-area"><div class="ai-gen-loading"><div class="complex-spinner"></div><span>AI 正在生成解析...</span></div></div>` : ''}
    ${aiAnalysis ? `<div class="analysis-block ai-block"><b>🤖 AI 补充解析</b><div class="analysis-text message-markdown" id="ai-analysis-content">${renderMarkdownToHtml(aiAnalysis)}</div></div>` : ''}
  </div>`
}

function buildAiChatTab(question, state, snapshot) {
  const canUse = canAskAi(state, snapshot)
  const qid = question.question_id
  const messages = state.aiChats?.[qid] || []
  const exam = isExamMode(snapshot)
  const single = isSingleMode(snapshot)

  if (!canUse) {
    let msg = '提交整卷后可向 AI 追问。'
    if (exam) msg = '考试提交后可向 AI 追问。'
    else if (single) msg = '提交本题后可向 AI 追问。'
    return `<div class="side-tab-content" id="tab-content-ai"><h4 class="side-tab-title">AI提问</h4><div class="tab-lock-state"><span class="lock-icon">🔒</span><p>${msg}</p></div></div>`
  }

  return `<div class="side-tab-content side-tab-chat" id="tab-content-ai">
    <h4 class="side-tab-title">AI提问</h4>
    <div class="side-chat-messages" id="practice-ai-chat-list">
      ${messages.length ? messages.map(m => `
        <div class="side-chat-msg ${m.role === 'user' ? 'user' : 'assistant'}">
          <div class="side-chat-bubble">
            <div class="side-chat-meta">${m.role === 'user' ? '我' : 'AI 助手'}</div>
            <div class="message-markdown">${m.html || escapeHtml(m.content || '')}</div>
          </div>
        </div>`).join('') : '<div class="practice-chat-empty">提交后可围绕本题追问 AI。</div>'}
      ${state.aiSending ? '<div class="side-chat-msg assistant" id="streaming-bubble"><div class="side-chat-bubble"><div class="side-chat-meta">AI 助手</div><div class="message-markdown" id="streaming-content">正在思考...</div></div></div>' : ''}
    </div>
    <div class="side-chat-input-row">
      <textarea class="complex-textarea" id="practice-ai-input" rows="2" placeholder="输入追问内容..." ${state.aiSending ? 'disabled' : ''}></textarea>
      <button class="complex-btn" id="btn-practice-ai-send" type="button" ${state.aiSending ? 'disabled' : ''}>${state.aiSending ? '...' : '发送'}</button>
    </div>
  </div>`
}

function buildSidePanel(question, state, snapshot) {
  const activeTab = state.activeTab || 'info'
  let contentHTML = ''
  if (activeTab === 'info') contentHTML = buildInfoTab(question, state, snapshot)
  else if (activeTab === 'analysis') contentHTML = buildAnalysisTab(question, state, snapshot)
  else if (activeTab === 'ai') contentHTML = buildAiChatTab(question, state, snapshot)

  return `<aside class="answer-progress-panel practice-side-panel-v4">
    ${buildTabButtons(state, snapshot)}
    <div class="side-panel-body" id="side-panel-body">${contentHTML}</div>
  </aside>`
}

// 左侧题号导航
function buildNavPanel(questions, state, snapshot) {
  return `<aside class="question-nav-panel practice-nav-panel-v4">
    <h4 class="nav-panel-title">题号</h4>
    <div class="question-nav-grouped" id="practice-question-nav">
      ${buildQuestionNavGroupedLockable(questions, state, snapshot)}
    </div>
  </aside>`
}

// 带锁定状态的题号导航
function buildQuestionNavGroupedLockable(questions, state, snapshot) {
  const resultsById = state.resultsById || {}
  const groups = []
  const seen = new Set()
  questions.forEach((q, index) => {
    const type = normalizeQuestionType(q.question_type)
    if (!seen.has(type)) {
      seen.add(type)
      // We need the label helper from practice-components
      groups.push({ type, questions: [] })
    }
    groups.find(g => g.type === type).questions.push({ question: q, index })
  })

  let html = ''
  groups.forEach(group => {
    html += `<div class="question-nav-group"><div class="question-nav-group-title">${questionTypeTagHtml(group.type)}</div><div class="question-nav-group-numbers">`
    group.questions.forEach(({ question, index }) => {
      const result = resultsById[question.question_id]
      const answered = isPracticeAnswered(state.answers[question.question_id])
      const itemStatus = state.itemStatuses?.[question.question_id]
      const locked = isQuestionLocked(index, state, snapshot)
      let cls = 'question-number'
      if (locked) {
        cls += ' locked'
      } else if (result) {
        if (result.is_correct === true) cls += ' correct'
        else if (result.is_correct === false) cls += ' wrong'
        else cls += ' partial'
      } else if (state.submitted) {
        cls += ' partial'
      } else if (itemStatus === 'CONFIRMED') {
        cls += ' partial'
      } else if (itemStatus === 'SAVED') {
        cls += ' answered'
      } else if (answered) {
        cls += ' answered'
      }
      if (index === state.currentIndex) cls += ' current'
      html += `<button class="${cls}" data-index="${index}" type="button"${locked ? ' title="单题模式需按顺序作答，请先完成当前题"' : ''}>${index + 1}</button>`
    })
    html += `</div></div>`
  })
  return html
}

// 底部操作栏
function buildBottomBar(snapshot, state) {
  const questions = state.questions
  const single = isSingleMode(snapshot)
  const exam = isExamMode(snapshot)
  const currentQuestion = questions[state.currentIndex]
  const currentResult = state.resultsById[currentQuestion?.question_id]
  const currentStatus = state.itemStatuses?.[currentQuestion?.question_id]
  const isLast = state.currentIndex >= questions.length - 1
  const allSubmitted = single && questions.every(q => !!state.resultsById[q.question_id])

  if (single) {
    const canGoNext = !!currentResult && !isLast
    const canGoPrev = state.currentIndex > 0
    return `<div class="exam-bottom-bar practice-bottom-bar-v4">
      <div class="complex-actions">
        <button class="complex-btn-ghost" id="btn-prev-practice-question" type="button" ${!canGoPrev ? 'disabled' : ''}>上一题</button>
        <button class="complex-btn-ghost" id="btn-next-practice-question" type="button" ${!canGoNext ? 'disabled' : ''}>${canGoNext ? '下一题' : (allSubmitted && isLast ? '✓ 已完成' : '下一题')}</button>
      </div>
      <div class="complex-actions">
        ${allSubmitted || state.submitted ? '<button class="complex-btn-secondary" id="btn-back-practice-bottom" type="button">返回练习中心</button>' : ''}
        <button class="complex-btn" id="btn-submit-single" type="button" ${currentResult || state.submitting ? 'disabled' : ''}>
          ${currentResult ? '已提交' : (state.submitting ? '提交中...' : '提交本题')}
        </button>
      </div>
    </div>`
  }

  return `<div class="exam-bottom-bar practice-bottom-bar-v4">
    <div class="complex-actions">
      <button class="complex-btn-ghost" id="btn-prev-practice-question" type="button" ${state.currentIndex === 0 ? 'disabled' : ''}>上一题</button>
      <button class="complex-btn-ghost" id="btn-next-practice-question" type="button" ${isLast ? 'disabled' : ''}>下一题</button>
      ${exam ? '' : `<button class="complex-btn-secondary" id="btn-submit-current" type="button" ${state.submitted || state.itemSubmitting || currentResult ? 'disabled' : ''}>
        ${state.itemSubmitting ? '处理中...' : (exam ? (currentStatus === 'CONFIRMED' ? '重新确认本题' : '确认本题') : (currentResult ? '已提交本题' : '提交本题'))}
      </button>`}
    </div>
    <div class="complex-actions">
      ${state.submitted ? '<button class="complex-btn-secondary" id="btn-back-practice-bottom" type="button">返回练习中心</button>' : '<button class="complex-btn-secondary" id="btn-back-practice-bottom" type="button">离开本次</button>'}
      <button class="complex-btn" id="btn-submit-practice" type="button" ${state.submitted || state.submitting ? 'disabled' : ''}>
        ${state.submitting ? '提交中...' : (state.submitted ? '已提交' : '提交整卷')}
      </button>
    </div>
  </div>`
}

function buildPage(snapshot, state) {
  const questions = state.questions
  if (!questions.length) {
    return `<div class="complex-shell practice-shell-v4"><button class="complex-btn-ghost" id="btn-back-practice" type="button" style="margin-bottom:16px;">← 返回练习中心</button><div class="complex-empty"><h3>当前练习暂无题目</h3><p>请调整题型、难度或题目数量后重新开始。</p></div></div>`
  }
  const current = questions[state.currentIndex] || questions[0]
  const focusClass = isPracticeLocked(state, snapshot) ? ' practice-focus-mode' : ''
  return `<div class="complex-shell practice-shell-v4${focusClass}">
    ${buildTopbar(snapshot, state)}
    ${buildSummary(snapshot, state)}
    <div class="exam-layout practice-exam-layout-v4">
      ${buildNavPanel(questions, state, snapshot)}
      <main id="practice-question-host">${buildQuestionCard(current, state.currentIndex, state, snapshot)}</main>
      ${buildSidePanel(current, state, snapshot)}
    </div>
    ${buildBottomBar(snapshot, state)}
  </div>`
}

// ========================
// 计时器
// ========================

function stopTimer() {
  if (practiceElapsedTimer) { clearInterval(practiceElapsedTimer); practiceElapsedTimer = null }
}

function startElapsedTimer(state) {
  stopTimer()
  if (state.submitted) {
    const el = document.getElementById('practice-elapsed')
    if (el && state.finalDurationSeconds != null) el.textContent = formatElapsed(state.finalDurationSeconds)
    return
  }
  practiceElapsedTimer = setInterval(() => {
    if (!/^#\/student\/practice\/sessions\/\d+$/.test(window.location.hash)) { stopTimer(); return }
    const el = document.getElementById('practice-elapsed')
    if (!el) { stopTimer(); return }
    if (state.submitted) { stopTimer(); if (state.finalDurationSeconds != null) el.textContent = formatElapsed(state.finalDurationSeconds); return }
    el.textContent = formatElapsed((Date.now() - state.startedAtMs) / 1000)
  }, 1000)
}

// ========================
// 专注模式
// ========================

function enableFocusMode(state, snapshot, sessionId, onLeaveAttempt) {
  if (focusModeCleanup) focusModeCleanup()
  const wrapper = document.querySelector('.student-dashboard-wrapper')
  const locked = isPracticeLocked(state, snapshot)
  if (locked && wrapper) wrapper.classList.add('practice-focus-active')
  if (locked) {
    document.querySelectorAll('.sidebar-menu-item').forEach(item => {
      const hash = item.dataset.hash || ''
      if (hash !== `#/student/practice/sessions/${sessionId}`) {
        item.classList.add('practice-locked')
        item.setAttribute('title', '完成并提交本次练习后可访问')
      }
    })
  }

  function beforeUnloadHandler(e) {
    if (!state.submitted) {
      e.preventDefault()
      e.returnValue = isExamMode(snapshot) ? '考试模式不会保存进度，确认离开吗？' : '当前练习尚未提交，确认离开吗？'
      return e.returnValue
    }
  }
  window.addEventListener('beforeunload', beforeUnloadHandler)

  // 侧边栏点击拦截
  function sidebarClickHandler(e) {
    const item = e.target.closest('.sidebar-menu-item')
    if (!item) return
    const hash = item.dataset.hash || ''
    if (hash === `#/student/practice/sessions/${sessionId}`) return
    if (state.submitted) return
    e.preventDefault(); e.stopImmediatePropagation()
    onLeaveAttempt?.(hash || '#/student/practice')
  }
  const sidebarMenu = document.getElementById('sidebar-menu-wrap')
  sidebarMenu?.addEventListener('click', sidebarClickHandler, true)

  // 顶部返回按钮拦截
  function backButtonHandler(e) {
    const btn = e.target.closest('.btn-back, [id^="btn-back-practice"]')
    if (!btn || state.submitted) return
    e.preventDefault(); e.stopPropagation()
    onLeaveAttempt?.('#/student/practice')
  }
  document.addEventListener('click', backButtonHandler, true)

  focusModeCleanup = () => {
    window.removeEventListener('beforeunload', beforeUnloadHandler)
    sidebarMenu?.removeEventListener('click', sidebarClickHandler, true)
    document.removeEventListener('click', backButtonHandler, true)
    if (wrapper) wrapper.classList.remove('practice-focus-active')
    document.querySelectorAll('.sidebar-menu-item.practice-locked').forEach(i => { i.classList.remove('practice-locked'); i.removeAttribute('title') })
    focusModeCleanup = null
  }
}

function disableFocusMode() {
  if (focusModeCleanup) { focusModeCleanup(); focusModeCleanup = null }
  const w = document.querySelector('.student-dashboard-wrapper')
  if (w) w.classList.remove('practice-focus-active')
}

// ========================
// 主渲染函数
// ========================

export async function renderStudentPracticeSession(app, params = {}) {
  stopTimer(); disableFocusMode()
  const sessionId = getSessionId(params)
  if (!sessionId) { window.location.hash = '#/student/practice'; return }

  const user = await getAuthedUser()
  if (!user) return

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildLoading(), user })

  const localSnapshot = loadPracticeSessionSnapshot(sessionId) || {}
  let snapshot = localSnapshot
  try {
    const remote = await getPracticeSessionDetail(sessionId)
    const remoteData = remote.data || {}
    const remoteConfig = inferConfigFromSession(remoteData.session || {}, {})
    snapshot = buildSnapshotFromRemote(remoteData, remoteConfig.sessionMode === 'exam' ? {} : localSnapshot)
    if (shouldPersistProgress(snapshot)) savePracticeSessionSnapshot(sessionId, snapshot)
    else removePracticeSessionSnapshot(sessionId)
  } catch (err) {
    if (localSnapshot?.config?.sessionMode === 'exam') {
      removePracticeSessionSnapshot(sessionId)
      renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildMissing(), user })
      document.getElementById('btn-back-practice')?.addEventListener('click', () => { window.location.hash = '#/student/practice' })
      showToast('考试模式不使用本地缓存，请重新进入或开始新的考试。', 'warning')
      return
    }
    if (!localSnapshot.questions?.length) {
      renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildMissing(), user })
      document.getElementById('btn-back-practice')?.addEventListener('click', () => { window.location.hash = '#/student/practice' })
      showToast(err.message || '答题会话恢复失败', 'error')
      return
    }
    showToast('暂时无法从服务器恢复会话，已使用本地缓存。', 'warning')
  }

  const state = {
    questions: normalizeQuestions(snapshot.questions || []),
    answers: initAnswers(normalizeQuestions(snapshot.questions || []), snapshot.answers || {}),
    currentIndex: Number(snapshot.currentIndex || 0),
    submitted: Boolean(snapshot.submitted),
    result: snapshot.result || null,
    resultsById: buildResultsById(snapshot.result),
    aiChats: snapshot.aiChats || {},
    aiAnalyses: snapshot.aiAnalyses || {},
    aiAnalysisLoading: snapshot.aiAnalysisLoading || {},
    submitting: false,
    itemSubmitting: false,
    saving: false,
    saveStatus: snapshot.saveStatus || '已同步',
    itemStatuses: snapshot.itemStatuses || {},
    aiSending: false,
    startedAtMs: getStartedAtMs(snapshot),
    activeTab: snapshot.activeTab || 'info',
    finalDurationSeconds: snapshot.finalDurationSeconds != null ? snapshot.finalDurationSeconds
      : (snapshot.result?.session?.duration_seconds != null ? snapshot.result.session.duration_seconds : null),
    // 单题模式顺序控制
    maxUnlockedIndex: snapshot.maxUnlockedIndex != null ? snapshot.maxUnlockedIndex : 0,
  }

  function persist() {
    if (!shouldPersistProgress(snapshot)) {
      removePracticeSessionSnapshot(sessionId)
      return
    }
    savePracticeSessionSnapshot(sessionId, {
      ...snapshot, questions: state.questions, answers: state.answers,
      currentIndex: state.currentIndex, submitted: state.submitted, result: state.result,
      itemStatuses: state.itemStatuses, saveStatus: state.saveStatus,
      aiChats: state.aiChats, aiAnalyses: state.aiAnalyses, aiAnalysisLoading: state.aiAnalysisLoading,
      startedAtMs: state.startedAtMs, activeTab: state.activeTab, finalDurationSeconds: state.finalDurationSeconds,
      maxUnlockedIndex: state.maxUnlockedIndex,
    })
  }

  function setPracticeAiContext() {
    if (typeof window === 'undefined') return
    const current = state.questions[state.currentIndex] || null
    const result = current ? state.resultsById[current.question_id] : null
    const kp = current ? getQuestionKnowledgePoint(current) : null
    if (current && canViewAnalysis(state, snapshot)) {
      window.__discimindStudentPageContext = {
        type: 'practiceQuestionDetail',
        page: 'student-practice-session',
        sessionId,
        subject: snapshot.subject || null,
        question: current,
        result,
        knowledgePoint: kp || null,
        studentAnswer: state.answers[current.question_id],
      }
      return
    }
    window.__discimindStudentPageContext = {
      type: 'practiceSession',
      page: 'student-practice-session',
      sessionId,
      subject: snapshot.subject || null,
      submitted: state.submitted,
      currentIndex: state.currentIndex,
      questionCount: state.questions.length,
    }
  }

  function rerender() {
    const main = document.getElementById('student-main')
    if (!main) return
    setPracticeAiContext()
    main.innerHTML = buildPage(snapshot, state)
    bindEvents()
    renderMathInMarkdownElements(main)
    scrollChatToBottom()
    startElapsedTimer(state)
    if (!state.submitted) enableFocusMode(state, snapshot, sessionId, requestLeave)
    else disableFocusMode()
  }

  function scrollChatToBottom() {
    const chat = document.getElementById('practice-ai-chat-list')
    if (chat) chat.scrollTop = chat.scrollHeight
  }

  let saveTimer = null

  async function saveQuestionAnswer(question, { silent = true } = {}) {
    if (!question || state.submitted) return true
    if (isExamMode(snapshot)) {
      state.saveStatus = '考试模式不保存'
      return true
    }
    const result = state.resultsById[question.question_id]
    const exam = isExamMode(snapshot)
    if (result && !exam) return true
    state.saving = true
    state.saveStatus = '保存中'
    persist()
    try {
      const response = await savePracticeItemAnswer(sessionId, question.question_id, {
        answer: state.answers[question.question_id],
        clientUpdatedAt: new Date().toISOString(),
      })
      const data = response.data || {}
      state.itemStatuses[question.question_id] = data.item_status || data.itemStatus || state.itemStatuses[question.question_id] || 'SAVED'
      state.saveStatus = '已保存'
      state.saving = false
      persist()
      return true
    } catch (err) {
      state.saveStatus = '保存失败'
      state.saving = false
      persist()
      if (!silent) showToast(err.message || '答案保存失败，请稍后重试', 'error')
      return false
    }
  }

  function scheduleSaveCurrentQuestion() {
    if (isExamMode(snapshot)) {
      state.saveStatus = '考试模式不保存'
      return
    }
    if (saveTimer) clearTimeout(saveTimer)
    const question = state.questions[state.currentIndex]
    state.saveStatus = '有未保存修改'
    persist()
    saveTimer = setTimeout(() => {
      saveQuestionAnswer(question, { silent: true })
      saveTimer = null
    }, 800)
  }

  async function flushCurrentAnswer() {
    if (isExamMode(snapshot)) return true
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    return saveQuestionAnswer(state.questions[state.currentIndex], { silent: false })
  }

  // ========================
  // 提交逻辑
  // ========================

  async function submitSingleQuestion() {
    if (state.itemSubmitting) return
    const current = state.questions[state.currentIndex]
    if (!current) return
    if (!isPracticeAnswered(state.answers[current.question_id])) { showToast('请先完成本题作答', 'warning'); return }

    state.itemSubmitting = true; rerender()
    try {
      const saved = await flushCurrentAnswer()
      if (!saved) throw new Error('当前答案保存失败，请稍后重试')
      const result = await submitPracticeItem(sessionId, current.question_id, { answer: state.answers[current.question_id] })
      const data = result.data || {}
      if (data.results) data.results.forEach(item => { state.resultsById[item.question_id] = item })
      if (!state.result) state.result = { results: [], summary: {}, session: {} }
      if (data.results) state.result.results = [...(state.result.results || []).filter(r => r.question_id !== current.question_id), ...data.results]
      if (data.summary) state.result.summary = data.summary
      if (data.session) { state.result.session = data.session; if (data.session.duration_seconds != null) state.finalDurationSeconds = data.session.duration_seconds }
      state.itemStatuses[current.question_id] = data.item_status || data.itemStatus || 'GRADED'
      state.itemSubmitting = false;
      // 单题模式：解锁下一题
      if (isSingleMode(snapshot) && state.currentIndex >= (state.maxUnlockedIndex || 0)) {
        state.maxUnlockedIndex = Math.min(state.currentIndex + 1, state.questions.length - 1)
      }
      // 检查是否所有题都已提交
      const allDone = state.questions.every(q => !!state.resultsById[q.question_id])
      if (allDone && isSingleMode(snapshot)) {
        state.submitted = true
        if (!state.finalDurationSeconds) state.finalDurationSeconds = Math.round((Date.now() - state.startedAtMs) / 1000)
        stopTimer()
      }
      persist()
      showToast(data.results?.[0]?.is_correct ? '回答正确！' : '回答错误，查看解析学习吧', data.results?.[0]?.is_correct ? 'success' : 'warning')
      rerender()
    } catch (err) { state.itemSubmitting = false; showToast(err.message || '提交失败，请稍后重试', 'error'); rerender() }
  }

  async function submitCurrentQuestion() {
    if (isSingleMode(snapshot)) return submitSingleQuestion()
    if (state.itemSubmitting || state.submitted) return
    const current = state.questions[state.currentIndex]
    if (!current) return
    if (!isPracticeAnswered(state.answers[current.question_id])) { showToast('请先完成本题作答', 'warning'); return }

    state.itemSubmitting = true; rerender()
    try {
      const saved = await flushCurrentAnswer()
      if (!saved) throw new Error('当前答案保存失败，请稍后重试')
      const result = await submitPracticeItem(sessionId, current.question_id, { answer: state.answers[current.question_id] })
      const data = result.data || {}
      state.itemStatuses[current.question_id] = data.item_status || data.itemStatus || (isExamMode(snapshot) ? 'CONFIRMED' : 'GRADED')
      if (data.results) {
        data.results.forEach(item => { state.resultsById[item.question_id] = item })
        if (!state.result) state.result = { results: [], summary: {}, session: {} }
        state.result.results = [...(state.result.results || []).filter(r => r.question_id !== current.question_id), ...data.results]
      }
      state.itemSubmitting = false
      persist()
      showToast(isExamMode(snapshot) ? '本题已确认' : '本题已提交并判题', 'success')
      rerender()
    } catch (err) { state.itemSubmitting = false; showToast(err.message || '提交失败，请稍后重试', 'error'); rerender() }
  }

  async function submitPaper(options = {}) {
    const { confirmBeforeSubmit = true } = options
    if (state.submitting || state.submitted) return
    const unanswered = state.questions.filter(q => !isPracticeAnswered(state.answers[q.question_id])).length
    const confirmed = state.questions.filter(q => state.itemStatuses[q.question_id] === 'CONFIRMED').length
    const graded = state.questions.filter(q => state.resultsById[q.question_id]).length
    const message = [
      `总题数：${state.questions.length}`,
      `已作答：${state.questions.length - unanswered}`,
      `未作答：${unanswered}`,
      isExamMode(snapshot) ? `已确认：${confirmed}` : `已单题提交：${graded}`,
      isExamMode(snapshot) ? '提交后不可撤销。' : '提交后将生成整卷结果。',
    ].join('\n')
    if (confirmBeforeSubmit && !window.confirm(message)) return false
    state.submitting = true; rerender()
    try {
      const saved = await flushCurrentAnswer()
      if (!saved) throw new Error('当前答案保存失败，请稍后重试')
      const result = await submitPracticeSession(sessionId, {
        answers: buildAnswerPayload(state.questions, state.answers),
        submitRequestId: `submit-${sessionId}-${Date.now()}`,
      })
      state.result = result.data || {}; state.resultsById = buildResultsById(state.result)
      state.submitted = true; state.submitting = false
      state.finalDurationSeconds = state.result?.session?.duration_seconds != null ? state.result.session.duration_seconds : Math.round((Date.now() - state.startedAtMs) / 1000)
      stopTimer(); persist()
      showToast('提交成功，已生成练习结果', 'success')
      rerender()
      return true
    } catch (err) { state.submitting = false; showToast(err.message || '提交失败，请稍后重试', 'error'); rerender(); return false }
  }

  async function abandonCurrentSession() {
    try {
      await abandonPracticeSession(sessionId)
      removePracticeSessionSnapshot(sessionId)
      state.submitted = true
      stopTimer()
      disableFocusMode()
      showToast(isExamMode(snapshot) ? '已放弃本次考试' : '已放弃本次练习', 'success')
      return true
    } catch (err) {
      showToast(err.message || '放弃失败，请稍后重试', 'error')
      return false
    }
  }

  function requestLeave(targetHash = '#/student/practice') {
    if (state.submitted) {
      window.location.hash = targetHash
      return
    }

    if (document.querySelector('.exam-leave-overlay')) return

    showExamLeaveModal({
      mode: isExamMode(snapshot) ? 'exam' : 'practice',
      title: snapshot?.subject?.course_name || '智能练习',
      answeredCount: answeredCount(state.questions, state.answers),
      totalCount: state.questions.length,
      hasUnsavedChanges: state.saveStatus === '有未保存修改',
      onContinue: () => {
        if (window.location.hash !== `#/student/practice/sessions/${sessionId}`) {
          window.location.hash = `#/student/practice/sessions/${sessionId}`
        }
      },
      onSubmitAndLeave: async () => {
        const ok = await submitPaper({ confirmBeforeSubmit: false })
        if (!ok) throw new Error('提交失败，请稍后重试')
        disableFocusMode()
        window.location.hash = targetHash
      },
      onSaveAndLeave: isExamMode(snapshot) ? null : async () => {
        const ok = await flushCurrentAnswer()
        if (!ok) throw new Error('保存失败，请稍后重试')
        disableFocusMode()
        window.location.hash = targetHash
      },
      onAbandon: async () => {
        const ok = await abandonCurrentSession()
        if (ok) window.location.hash = targetHash
      },
    })
  }

  // ========================
  // AI 流式追问
  // ========================

  let aiStreamAbortController = null

  async function sendAiQuestion() {
    const current = state.questions[state.currentIndex]
    if (!current || state.aiSending) return
    if (!canAskAi(state, snapshot)) { showToast(isSingleMode(snapshot) ? '请先提交本题' : '请先提交整卷', 'warning'); return }

    const input = document.getElementById('practice-ai-input')
    const message = (input?.value || '').trim()
    if (!message) { showToast('请输入追问内容', 'warning'); return }

    const qid = current.question_id
    if (!state.aiChats[qid]) state.aiChats[qid] = []
    state.aiChats[qid].push({ role: 'user', content: message, html: escapeHtml(message), created_at: new Date().toISOString() })

    // 添加一个临时的 AI 回答占位
    const tempId = 'streaming_' + Date.now()
    state.aiChats[qid].push({ role: 'assistant', content: '', html: '', created_at: new Date().toISOString(), _streaming: true, _tempId: tempId })
    state.aiSending = true
    if (input) input.value = ''
    persist(); rerender()
    scrollChatToBottom()

    aiStreamAbortController = new AbortController()
    let streamContent = ''

    try {
      await streamPracticeQuestionAi(qid, { sessionId, question: message }, {
        signal: aiStreamAbortController.signal,
        onDelta: (payload) => {
          streamContent += payload.content || ''
          // 更新最后一个 assistant 消息
          const msgs = state.aiChats[qid]
          const last = msgs[msgs.length - 1]
          if (last && last._streaming) {
            last.content = streamContent
            last.html = renderMarkdownToHtml(streamContent)
            // 增量更新 DOM
            const streamingEl = document.getElementById('streaming-content')
            if (streamingEl) streamingEl.innerHTML = renderMarkdownToHtml(streamContent)
            scrollChatToBottom()
          }
          persist()
        },
        onDone: () => {
          const msgs = state.aiChats[qid]
          const last = msgs[msgs.length - 1]
          if (last && last._streaming) {
            delete last._streaming; delete last._tempId
            if (!last.content) last.content = 'AI 暂未返回内容。'
            last.html = renderMarkdownToHtml(last.content)
          }
          state.aiSending = false; aiStreamAbortController = null
          persist(); rerender()
        },
        onError: (payload) => {
          const msgs = state.aiChats[qid]
          const last = msgs[msgs.length - 1]
          if (last && last._streaming) {
            last.content = payload.message || 'AI 回答失败，请稍后重试'
            last.html = escapeHtml(last.content)
            delete last._streaming; delete last._tempId
          }
          state.aiSending = false; aiStreamAbortController = null
          showToast(payload.message || 'AI 回答失败，请稍后重试', 'error')
          persist(); rerender()
        },
      })
    } catch (err) {
      if (err.name === 'AbortError') { /* user cancelled */ }
      else {
        const msgs = state.aiChats[qid]
        const last = msgs[msgs.length - 1]
        if (last && last._streaming) {
          last.content = err.message || 'AI 回答失败，请稍后重试'
          last.html = escapeHtml(last.content)
          delete last._streaming; delete last._tempId
        }
        showToast(err.message || 'AI 回答失败，请稍后重试', 'error')
      }
      state.aiSending = false; aiStreamAbortController = null
      persist(); rerender()
    }
  }

  // AI 生成解析
  async function generateAnalysis() {
    const current = state.questions[state.currentIndex]
    if (!current) return
    if (!canViewAnalysis(state, snapshot)) { showToast(isSingleMode(snapshot) ? '请先提交本题' : '请先提交整卷', 'warning'); return }
    const qid = current.question_id
    if (!state.aiAnalyses) state.aiAnalyses = {}
    if (!state.aiAnalysisLoading) state.aiAnalysisLoading = {}
    state.aiAnalysisLoading[qid] = true; persist(); rerender()
    try {
      const result = await generatePracticeAnalysis(qid, { sessionId })
      state.aiAnalyses[qid] = result.data?.analysis || 'AI 暂未返回解析。'
      showToast('AI 解析已生成', 'success')
    } catch (err) { showToast(err.message || 'AI 生成解析失败，请稍后重试', 'error') }
    finally { state.aiAnalysisLoading[qid] = false; persist(); rerender() }
  }

  // ========================
  // 事件绑定
  // ========================

  function bindEvents() {
    function goBack() {
      if (!state.submitted) { requestLeave('#/student/practice'); return }
      window.location.hash = '#/student/practice'
    }
    document.getElementById('btn-back-practice')?.addEventListener('click', goBack)
    document.getElementById('btn-back-practice-top')?.addEventListener('click', goBack)
    document.getElementById('btn-back-practice-bottom')?.addEventListener('click', goBack)

    document.getElementById('btn-go-wrong-book')?.addEventListener('click', () => {
      if (isPracticeLocked(state, snapshot)) { showToast('完成并提交本次练习后可查看错题本。', 'warning'); return }
      if (!state.submitted) { requestLeave('#/student/wrong-questions'); return }
      window.location.hash = '#/student/wrong-questions'
    })

    document.getElementById('btn-submit-practice')?.addEventListener('click', submitPaper)
    document.getElementById('btn-submit-single')?.addEventListener('click', submitSingleQuestion)
    document.getElementById('btn-submit-current')?.addEventListener('click', submitCurrentQuestion)

    // Tab 切换
    document.querySelectorAll('.side-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab
        if (!tabId) return
        state.activeTab = tabId; persist(); rerender()
      })
    })

    document.getElementById('btn-gen-analysis')?.addEventListener('click', generateAnalysis)

    // 题号导航点击
    document.querySelectorAll('.question-number').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.index || 0)
        if (isNaN(idx)) return
        // 单题模式锁定检查
        if (isSingleMode(snapshot) && idx > (state.maxUnlockedIndex || 0)) {
          showToast('单题模式需要按顺序作答，请先完成当前题。', 'warning')
          return
        }
        flushCurrentAnswer().then(() => {
          state.currentIndex = idx; persist(); rerender()
        })
      })
    })

    // 上一题/下一题
    document.getElementById('btn-prev-practice-question')?.addEventListener('click', () => {
      if (state.currentIndex <= 0) return
      flushCurrentAnswer().then(() => {
        state.currentIndex -= 1; persist(); rerender()
      })
    })
    document.getElementById('btn-next-practice-question')?.addEventListener('click', () => {
      if (isSingleMode(snapshot)) {
        const current = state.questions[state.currentIndex]
        if (!current || !state.resultsById[current.question_id]) {
          showToast('请先提交当前题再进入下一题。', 'warning')
          return
        }
        if (state.currentIndex >= state.questions.length - 1) return
      } else {
        if (state.currentIndex >= state.questions.length - 1) return
      }
      flushCurrentAnswer().then(() => {
        state.currentIndex += 1; persist(); rerender()
      })
    })

    // 选择题/判断题
    document.querySelectorAll('.choice-option input').forEach(input => {
      input.addEventListener('change', () => {
        if (state.submitted) return
        const single = isSingleMode(snapshot)
        if (single && state.resultsById[state.questions[state.currentIndex]?.question_id]) return
        const question = state.questions[state.currentIndex]
        const type = normalizeQuestionType(question.question_type)
        if (type === 'multiple_choice') {
          state.answers[question.question_id] = [...document.querySelectorAll(`input[name="practice-question-${question.question_id}"]:checked`)].map(i => i.value)
        } else { state.answers[question.question_id] = input.value }
        scheduleSaveCurrentQuestion(); rerender()
      })
    })

    // 简答题
    document.querySelector('.answer-input')?.addEventListener('input', e => {
      if (state.submitted) return
      const single = isSingleMode(snapshot)
      if (single && state.resultsById[state.questions[state.currentIndex]?.question_id]) return
      state.answers[state.questions[state.currentIndex].question_id] = e.target.value
      const c = document.querySelector('.short-count')
      if (c) c.textContent = `${e.target.value.length} 字`
      scheduleSaveCurrentQuestion()
    })

    // 填空题
    document.querySelectorAll('.blank-answer-input').forEach(input => {
      input.addEventListener('input', () => {
        if (state.submitted) return
        const single = isSingleMode(snapshot)
        if (single && state.resultsById[state.questions[state.currentIndex]?.question_id]) return
        const values = [...document.querySelectorAll('.blank-answer-input')]
          .sort((a, b) => Number(a.dataset.blankIndex) - Number(b.dataset.blankIndex))
          .map(i => i.value)
        state.answers[state.questions[state.currentIndex].question_id] = values
        scheduleSaveCurrentQuestion()
      })
    })

    // AI 发送
    document.getElementById('btn-practice-ai-send')?.addEventListener('click', sendAiQuestion)
    document.getElementById('practice-ai-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendAiQuestion()
    })
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildPage(snapshot, state), user })
  bindEvents()
  renderMathInMarkdownElements(document.getElementById('student-main'))
  startElapsedTimer(state)
  if (!state.submitted) enableFocusMode(state, snapshot, sessionId, requestLeave)

  return () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    aiStreamAbortController?.abort()
    aiStreamAbortController = null
    stopTimer()
    disableFocusMode()
    closeExamLeaveModal()
    if (window.__discimindStudentPageContext?.sessionId === sessionId) {
      delete window.__discimindStudentPageContext
    }
  }
}
