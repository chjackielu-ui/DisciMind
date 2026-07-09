// 学生端 — 智能练习中心（重构版）
// 清除班级选择、优化布局、增加模式选择、AI等待弹窗等

import { getMe } from '../api/auth.js'
import {
  abandonPracticeSession,
  getPracticeWrongQuestions,
  getPracticeSessions,
  getStudentCourses,
  getStudentRecommendations,
  startPractice,
} from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import {
  PRACTICE_DIFFICULTIES,
  PRACTICE_QUESTION_TYPES,
  QUESTION_COUNT_OPTIONS,
  ANSWER_MODES,
  PRACTICE_SESSION_MODES,
  answerModeLabel,
  buildQuestionTypeCapsules,
  buildDifficultyCards,
  buildAnswerModeSelector,
  buildSessionModeSelector,
  buildQuestionCountSelector,
  getModeDescription,
  normalizeQuestionType,
  practiceSessionModeLabel,
  removePracticeSessionSnapshot,
  savePracticeSessionSnapshot,
} from '../components/practice/practice-components.js'

// ========================
// 工具函数
// ========================

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

function buildSubjectModels(courses) {
  const map = new Map()
  ;(courses || []).forEach(course => {
    if (!map.has(course.course_id)) {
      map.set(course.course_id, {
        course_id: course.course_id,
        course_name: course.course_name,
        course_code: course.course_code,
        progress: course.progress || 0,
        weak_knowledge_count: course.weak_knowledge_count || 0,
        question_count: course.question_count || 0,
      })
    }
  })
  return [...map.values()]
}

function getSubjectRecommendTag(subject) {
  if (subject.weak_knowledge_count > 0) return 'recommend'
  if ((subject.question_count || 0) >= 20) return 'sufficient'
  return 'ai_fill'
}

function subjectRecommendLabel(type) {
  if (type === 'recommend') return '推荐练习'
  if (type === 'sufficient') return '题库充足'
  return 'AI可补题'
}

function subjectRecommendClass(type) {
  if (type === 'recommend') return 'subject-tag-recommend'
  if (type === 'sufficient') return 'subject-tag-sufficient'
  return 'subject-tag-ai'
}

function getTypeLimit(questionCount) {
  const count = Number(questionCount)
  if (!Number.isFinite(count) || count < 1) return 1
  return Math.min(PRACTICE_QUESTION_TYPES.length, Math.floor(count))
}

function normalizeSelectedTypes(selectedTypes, questionCount) {
  const limit = getTypeLimit(questionCount)
  const selected = (selectedTypes || []).filter(Boolean)
  if (selected.length > 0) return selected.slice(0, limit)
  return PRACTICE_QUESTION_TYPES.slice(0, limit).map(item => item.value)
}

function normalizeSessionStatus(status) {
  return String(status || '').trim().toUpperCase()
}

function isActiveSession(session) {
  return ['CREATED', 'IN_PROGRESS', 'SUBMITTING'].includes(normalizeSessionStatus(session?.status))
}

function canContinueSession(session) {
  return Boolean(session?.can_continue) && isActiveSession(session)
}

function getPrimaryActiveSession(sessions = []) {
  return (sessions || []).find(canContinueSession) || null
}

function formatDateTime(value) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无记录'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSessionStatus(status) {
  const normalized = normalizeSessionStatus(status)
  if (['CREATED', 'IN_PROGRESS', 'SUBMITTING'].includes(normalized)) return '进行中'
  if (normalized === 'SUBMITTED') return '已提交'
  if (normalized === 'ABANDONED') return '已放弃'
  if (normalized === 'EXPIRED') return '已超时'
  return '未知状态'
}

function formatSessionMode(session) {
  const mode = String(session?.mode || '').toUpperCase()
  const sessionMode = mode === 'EXAM' ? 'exam' : 'practice'
  const answerMode = String(session?.answer_mode || '').toUpperCase() === 'PAPER' ? 'paper' : 'single'
  return `${practiceSessionModeLabel(sessionMode)} · ${answerModeLabel(answerMode)}`
}

function sessionProgressText(session) {
  const answered = Number(session?.answered_count || 0)
  const total = Number(session?.question_count || 0)
  return `${answered}/${total} 题`
}

// ========================
// 构建函数
// ========================

function buildLoading() {
  return `
    <div class="complex-shell practice-shell-v2">
      <div class="complex-loading">
        <div class="complex-spinner"></div>
        <p>正在准备练习配置...</p>
      </div>
    </div>`
}

function buildEmpty() {
  return `
    <div class="complex-shell practice-shell-v2">
      <section class="complex-hero practice-hero-v2">
        <div>
          <h1>智能练习中心</h1>
          <p>当前还没有可用于练习的课程。</p>
        </div>
        <div class="complex-actions">
          <button class="complex-btn-secondary" id="btn-go-courses" type="button">查看我的课程</button>
        </div>
      </section>
      <div class="complex-empty">
        <h3>暂无课程</h3>
        <p>请先加入课程或等待教师将你加入教学班。</p>
      </div>
    </div>`
}

// 顶部介绍区
function buildHero(subjectsCount, wrongCount) {
  return `
    <section class="complex-hero practice-hero-v2">
      <div>
        <h1>智能练习中心</h1>
        <p>根据科目、题型、难度和练习模式生成个性化练习任务。</p>
        <div class="exam-meta-row">
          <span>${subjectsCount} 门课程</span>
          <span>${wrongCount ?? 0} 道错题</span>
          <span>自主练习</span>
        </div>
      </div>
    </section>`
}

// 科目选择卡片
function buildSubjectCard(subjects, selectedSubjectId) {
  if (!subjects.length) return ''
  return `
    <section class="practice-card-v2 subject-select-card">
      <div class="practice-card-v2-head">
        <h3 class="complex-section-title">选择练习科目</h3>
        <small>选择一门课程开始针对性练习</small>
      </div>
      <div class="subject-card-grid">
        ${subjects.map(subject => {
          const tag = getSubjectRecommendTag(subject)
          const selected = String(subject.course_id) === String(selectedSubjectId)
          return `
          <button type="button" class="subject-card${selected ? ' active' : ''}" data-subject-id="${subject.course_id}">
            <div class="subject-card-icon">${escapeHtml((subject.course_name || '课')[0])}</div>
            <div class="subject-card-body">
              <b>${escapeHtml(subject.course_name)}</b>
              <small>${escapeHtml(subject.course_code || '')}</small>
              ${subject.question_count ? `<span class="subject-count">题库 ${subject.question_count} 题</span>` : ''}
            </div>
            <span class="subject-recommend-tag ${subjectRecommendClass(tag)}">${subjectRecommendLabel(tag)}</span>
          </button>`
        }).join('')}
      </div>
    </section>`
}

// 练习配置卡片
function getStartHint(state, hasConfig) {
  if (hasConfig || state.starting) return ''
  if (!state.subjectId) return '请先选择练习科目'
  if (!state.questionTypes.length) return '请至少选择一种题型'
  if (!state.difficulty) return '请选择难度'
  if (!state.questionCount || Number(state.questionCount) < 1) return '请设置题目数量'
  return ''
}

function buildConfigCard(state, typeLimit, hasConfig) {
  const sessionMode = state.sessionMode || 'practice'
  const answerMode = state.answerMode || 'single'
  const isExam = sessionMode === 'exam'
  const count = Number(state.questionCount)
  const btnDisabled = !hasConfig || state.starting
  const btnText = state.starting ? '正在准备题目...' : '开始练习'
  const hint = getStartHint(state, hasConfig)

  return `
    <section class="practice-card-v2 config-card ${!state.subjectId ? 'config-disabled' : ''}">
      <div class="practice-card-v2-head config-title-row">
        <div>
          <h3 class="complex-section-title">练习设置</h3>
          <small>配置题型、难度、数量和作答方式</small>
        </div>
        <span class="config-mode-pill">${isExam ? '考试不保存进度' : '自动保存进度'}</span>
      </div>

      <div class="practice-config-split">
        <div class="practice-config-main">
          <!-- 题型选择 -->
          <div class="config-block">
            <div class="config-block-head">
              <span>选择题型</span>
              <small>最多选择 ${typeLimit} 种</small>
            </div>
            <div class="type-capsule-grid" id="practice-type-capsules">
              ${buildQuestionTypeCapsules(state.questionTypes, typeLimit)}
            </div>
          </div>

          <!-- 难度选择 -->
          <div class="config-block">
            <div class="config-block-head">
              <span>选择难度</span>
            </div>
            <div class="diff-card-grid" id="practice-difficulty-cards">
              ${buildDifficultyCards(state.difficulty)}
            </div>
          </div>
        </div>

        <div class="practice-config-side">
          <!-- 题目数量 -->
          <div class="config-block">
            <div class="config-block-head">
              <span>题目数量</span>
              ${count > 20 ? '<small class="hint-warning">题目较多，可能需要 AI 补题</small>' : ''}
            </div>
            <div class="count-selector" id="practice-count-selector">
              ${buildQuestionCountSelector(state.questionCount, state.customCount)}
            </div>
            ${state.countError ? `<p class="config-error">${state.countError}</p>` : ''}
          </div>

          <!-- 作答模式（练习/考试） -->
          <div class="config-block">
            <div class="config-block-head">
              <span>作答模式</span>
            </div>
            <div class="mode-option-grid" id="practice-session-mode">
              ${buildSessionModeSelector(sessionMode)}
            </div>
          </div>

          <!-- 出题方式（单题/整卷） -->
          <div class="config-block" id="answer-mode-block">
            <div class="config-block-head">
              <span>出题方式</span>
              ${isExam ? '<small>考试模式默认整卷提交</small>' : ''}
            </div>
            <div class="mode-option-grid" id="practice-answer-mode">
              ${buildAnswerModeSelector(answerMode, isExam)}
            </div>
          </div>
        </div>
      </div>

      <div class="practice-config-footer">
        <div class="practice-start-summary">
          <b>${isExam ? '考试模式' : '练习模式'}</b>
          <span>${state.questionTypes.length || 0} 种题型 · ${count || 0} 题 · ${isExam ? '提交后查看解析' : '可保存后继续'}</span>
          ${hint ? `<em>${hint}</em>` : ''}
        </div>
        <button class="complex-btn btn-start-practice-v2" id="btn-start-practice" type="button"
          ${btnDisabled ? 'disabled' : ''}>
          ${state.starting ? '<span class="btn-spinner"></span>' : ''}
          ${btnText}
        </button>
      </div>
    </section>`
}

// 模式说明卡片
function buildModeInfoCard(sessionMode, answerMode) {
  const desc = getModeDescription(sessionMode, answerMode)
  const icons = {
    'practice-single': '📝',
    'practice-paper': '📋',
    'exam': '⏱️',
  }
  let key = 'practice-single'
  if (sessionMode === 'exam') key = 'exam'
  else if (answerMode === 'paper') key = 'practice-paper'

  return `
    <section class="practice-card-v2 mode-info-card">
      <div class="mode-info-inner">
        <span class="mode-info-icon">${icons[key]}</span>
        <div>
          <h3 class="complex-section-title" style="margin-bottom:4px;">模式说明</h3>
          <p class="mode-info-desc">${desc}</p>
        </div>
      </div>
    </section>`
}

// 错题本入口卡片
function buildWrongBookCard(wrongStats) {
  const total = wrongStats?.total || 0
  const unresolved = wrongStats?.unresolved || 0
  const mastered = wrongStats?.mastered || 0
  const recent = wrongStats?.recent || 0

  return `
    <section class="practice-card-v2 wrong-book-card">
      <div class="wrong-book-inner">
        <div class="wrong-book-info">
          <h3 class="complex-section-title">我的错题本</h3>
          <div class="wrong-book-stats">
            <div class="wrong-book-stat">
              <b>${total}</b><span>总错题</span>
            </div>
            <div class="wrong-book-stat unresolved">
              <b>${unresolved}</b><span>未掌握</span>
            </div>
            <div class="wrong-book-stat mastered">
              <b>${mastered}</b><span>已掌握</span>
            </div>
            <div class="wrong-book-stat recent">
              <b>${recent}</b><span>最近新增</span>
            </div>
          </div>
        </div>
        <button class="complex-btn-secondary" id="btn-go-wrong-book" type="button">进入错题本</button>
      </div>
    </section>`
}

// 推荐学习入口卡片
function buildRecommendationEntryCard(recommendations) {
  const list = (recommendations || []).slice(0, 3)
  return `
    <section class="practice-card-v2 recommendation-entry-card">
      <div class="practice-card-v2-head">
        <h3 class="complex-section-title">推荐学习内容</h3>
        <button class="complex-btn-secondary" id="btn-go-recommendations" type="button">查看推荐</button>
      </div>
      ${list.length ? `
        <div class="recommend-entry-list">
          ${list.map(item => `
            <button type="button" class="recommend-entry-item" data-go-recommendations>
              <span>${escapeHtml(item.title || '推荐内容')}</span>
              <small>${escapeHtml(item.reason || '根据你的学习数据推荐')}</small>
            </button>
          `).join('')}
        </div>
      ` : '<p class="recommend-entry-empty">暂无推荐内容，完成练习后会持续更新。</p>'}
    </section>`
}

function buildTrainerEntryCard(subjects = [], state = {}) {
  const selected = subjects.find(subject => String(subject.course_id) === String(state.subjectId)) || subjects[0] || null
  const hash = selected
    ? `#/student/trainer?courseId=${encodeURIComponent(selected.course_id)}`
    : '#/student/trainer'
  return `
    <section class="practice-card-v2">
      <div class="practice-card-v2-head">
        <div>
          <h3 class="complex-section-title">AI 训练师</h3>
          <small>基于知识点生成诊断题、深度批改和下一题策略</small>
        </div>
      </div>
      <button class="complex-btn" id="btn-open-trainer" type="button" data-hash="${hash}" style="width:100%;">立即使用</button>
    </section>`
}

function buildResumeCard(activeSession) {
  if (!activeSession) {
    return `
      <section class="practice-card-v2 practice-resume-card empty">
        <div>
          <span class="practice-card-eyebrow">继续练习</span>
          <h3 class="complex-section-title">暂无未完成练习</h3>
          <p>练习模式会自动保存进度，离开后可以从这里继续作答。</p>
        </div>
      </section>`
  }

  return `
    <section class="practice-card-v2 practice-resume-card active">
      <div class="resume-main">
        <span class="practice-card-eyebrow">继续上次练习</span>
        <h3 class="complex-section-title">${escapeHtml(activeSession.course_name || '自主练习')}</h3>
        <p>${escapeHtml(formatSessionMode(activeSession))} · 已作答 ${sessionProgressText(activeSession)} · ${formatDateTime(activeSession.last_active_at)}</p>
      </div>
      <div class="resume-actions">
        <button class="complex-btn" type="button" data-continue-session="${activeSession.practice_session_id}">继续作答</button>
        <button class="complex-btn-secondary danger" type="button" data-abandon-session="${activeSession.practice_session_id}">放弃本次</button>
      </div>
    </section>`
}

function buildPracticeHistoryCard(sessions = []) {
  const list = (sessions || []).slice(0, 6)
  return `
    <section class="practice-card-v2 practice-history-card">
      <div class="practice-card-v2-head">
        <div>
          <h3 class="complex-section-title">练习历史</h3>
          <small>查看每一轮练习、错题数量和未完成状态</small>
        </div>
      </div>
      ${list.length ? `
        <div class="practice-history-list">
          ${list.map(session => {
            const status = normalizeSessionStatus(session.status)
            const active = isActiveSession(session)
            const submitted = status === 'SUBMITTED'
            const abandoned = status === 'ABANDONED'
            const wrongCount = Number(session.wrong_count || 0)
            return `
              <article class="practice-history-item ${active ? 'active' : submitted ? 'submitted' : abandoned ? 'abandoned' : ''}">
                <div class="history-item-main">
                  <div class="history-title-row">
                    <b>${escapeHtml(session.course_name || '自主练习')}</b>
                    <span>${formatSessionStatus(session.status)}</span>
                  </div>
                  <p>${escapeHtml(formatSessionMode(session))}</p>
                  <div class="history-meta-row">
                    <em>${sessionProgressText(session)}</em>
                    <em>错题 ${wrongCount} 道</em>
                    <em>${formatDateTime(session.submitted_at || session.last_active_at || session.started_at)}</em>
                  </div>
                </div>
                <div class="history-actions">
                  ${canContinueSession(session) ? `<button type="button" class="complex-btn-secondary" data-continue-session="${session.practice_session_id}">继续</button>` : ''}
                  ${active && !canContinueSession(session) ? `<button type="button" class="complex-btn-secondary danger" data-abandon-session="${session.practice_session_id}">放弃</button>` : ''}
                  ${submitted ? `<button type="button" class="complex-btn-secondary" data-view-session="${session.practice_session_id}">回看</button>` : ''}
                </div>
              </article>`
          }).join('')}
        </div>
      ` : '<p class="practice-history-empty">完成一次练习后，这里会显示历史记录和错题统计。</p>'}
    </section>`
}

function buildPracticeInsightCard(sessions = []) {
  const submitted = (sessions || []).filter(item => normalizeSessionStatus(item.status) === 'SUBMITTED')
  const active = (sessions || []).filter(canContinueSession)
  const wrongTotal = submitted.reduce((sum, item) => sum + Number(item.wrong_count || 0), 0)
  return `
    <section class="practice-card-v2 practice-insight-card">
      <div class="insight-stat">
        <b>${active.length}</b>
        <span>可继续</span>
      </div>
      <div class="insight-stat">
        <b>${submitted.length}</b>
        <span>已完成</span>
      </div>
      <div class="insight-stat warning">
        <b>${wrongTotal}</b>
        <span>历史错题</span>
      </div>
    </section>`
}

// 底部开始练习操作区
function buildStartBar(state, hasConfig) {
  const btnDisabled = !hasConfig || state.starting
  const btnText = state.starting ? '正在准备题目...' : '开始练习'
  let hint = ''
  if (!hasConfig && !state.starting) {
    if (!state.subjectId) hint = '请先选择练习科目'
    else if (!state.questionTypes.length) hint = '请至少选择一种题型'
    else if (!state.difficulty) hint = '请选择难度'
    else if (!state.questionCount || Number(state.questionCount) < 1) hint = '请设置题目数量'
  }

  return `
    <section class="practice-start-bar">
      ${hint ? `<p class="start-hint">${hint}</p>` : ''}
      <button class="complex-btn btn-start-practice-v2" id="btn-start-practice" type="button"
        ${btnDisabled ? 'disabled' : ''}>
        ${state.starting ? '<span class="btn-spinner"></span>' : ''}
        ${btnText}
      </button>
    </section>`
}

// AI生成等待弹窗（全屏毛玻璃遮罩）
function buildAiGeneratingModal() {
  return `
    <div class="ai-generating-overlay" id="ai-generating-overlay">
      <div class="ai-generating-modal">
        <div class="ai-generating-icon">
          <div class="ai-generating-spinner"></div>
        </div>
        <h3>AI 正在生成练习题</h3>
        <p>系统正在根据你选择的科目、题型和难度补充练习题，题目准备完成后将自动进入练习。</p>
        <div class="ai-generating-steps" id="ai-generating-steps">
          <div class="ai-step active">正在分析练习配置...</div>
          <div class="ai-step">正在匹配本地题库...</div>
          <div class="ai-step">正在调用 AI 生成补充题目...</div>
          <div class="ai-step">正在校验题目格式...</div>
          <div class="ai-step">正在整理答题页面...</div>
        </div>
        <div class="ai-generating-notice">
          <p>⏳ 请稍等，题目生成过程中不要重复点击或关闭页面。</p>
        </div>
        <button class="complex-btn-ghost" id="btn-cancel-generating" type="button">取消生成</button>
      </div>
    </div>`
}

// 页面整体结构
function buildPage(data, state) {
  const { subjects, wrongStats, recommendations, sessions } = data
  if (!subjects.length) return buildEmpty()

  const sessionMode = state.sessionMode || 'practice'
  const answerMode = state.answerMode || 'single'
  const typeLimit = getTypeLimit(state.questionCount)
  const hasConfig = state.subjectId && state.questionTypes.length > 0
    && state.difficulty && Number(state.questionCount) >= 1
  const activeSession = getPrimaryActiveSession(sessions)

  return `
    <div class="complex-shell practice-shell-v2">
      ${buildHero(subjects.length, wrongStats?.total)}
      <div class="practice-v2-grid">
        ${buildSubjectCard(subjects, state.subjectId)}
        <div class="practice-main-grid">
          <div class="practice-center-workbench">
            ${buildResumeCard(activeSession)}
            ${buildConfigCard(state, typeLimit, hasConfig)}
            ${buildModeInfoCard(sessionMode, answerMode)}
          </div>
          <aside class="practice-side-rail">
            ${buildTrainerEntryCard(subjects, state)}
            ${buildPracticeInsightCard(sessions)}
            ${buildPracticeHistoryCard(sessions)}
            ${buildWrongBookCard(wrongStats)}
            ${buildRecommendationEntryCard(recommendations)}
          </aside>
        </div>
      </div>
    </div>`
}

// ========================
// 数据加载
// ========================

async function loadWrongStats() {
  try {
    const [allResult, unresolvedResult] = await Promise.all([
      getPracticeWrongQuestions({ page_size: 1 }).catch(() => ({ data: { total: 0 } })),
      getPracticeWrongQuestions({ page_size: 1, status: 'unresolved' }).catch(() => ({ data: { total: 0 } })),
    ])
    const total = allResult.data?.total || 0
    const unresolved = unresolvedResult.data?.total || 0
    // 从列表中推算 mastered 和 recent
    let mastered = 0
    let recent = 0
    try {
      const listResult = await getPracticeWrongQuestions({ page_size: 100 })
      const list = listResult.data?.list || []
      mastered = list.filter(item => String(item.status || '').toLowerCase() === 'mastered').length
      const now = Date.now()
      const sevenDays = 7 * 24 * 60 * 60 * 1000
      recent = list.filter(item => {
        const t = item.created_at ? new Date(item.created_at).getTime() : 0
        return now - t < sevenDays
      }).length
    } catch { /* use fallback */ }
    return { total, unresolved, mastered, recent }
  } catch {
    return { total: 0, unresolved: 0, mastered: 0, recent: 0 }
  }
}

// ========================
// 主渲染函数
// ========================

export async function renderStudentPracticeCenter(app) {
  const user = await getAuthedUser()
  if (!user) return

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildLoading(), user })

  // 并行加载数据
  let courses = []
  let wrongStats = { total: 0, unresolved: 0, mastered: 0, recent: 0 }
  let recommendations = []
  let sessions = []
  try {
    const [courseResult, ws, recResult, sessionResult] = await Promise.all([
      getStudentCourses(),
      loadWrongStats(),
      getStudentRecommendations({ page_size: 4 }).catch(() => ({ data: { list: [] } })),
      getPracticeSessions({ page_size: 8 }).catch(() => ({ data: { list: [] } })),
    ])
    courses = courseResult.data?.list || []
    wrongStats = ws
    recommendations = recResult.data?.list || []
    sessions = sessionResult.data?.list || []
  } catch (err) {
    renderDashboardLayout(app, {
      menuItems: STUDENT_MENU_ITEMS,
      contentHTML: `
        <div class="complex-shell practice-shell-v2">
          <div class="complex-error">
            <h3>练习中心加载失败</h3>
            <p>${escapeHtml(err.message || '请稍后重试。')}</p>
            <button class="complex-btn" id="btn-retry-practice">重新加载</button>
          </div>
        </div>`,
      user,
    })
    document.getElementById('btn-retry-practice')?.addEventListener('click', () => renderStudentPracticeCenter(app))
    return
  }

  const subjects = buildSubjectModels(courses)
  const firstSubject = subjects[0] || null
  const state = {
    subjectId: firstSubject?.course_id || '',
    questionTypes: ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer'],
    difficulty: 'medium',
    questionCount: 10,
    customCount: '',
    sessionMode: 'practice',
    answerMode: 'single',
    starting: false,
    countError: '',
    generatingTimer: null,
    generatingAbort: null,
  }
  state.questionTypes = normalizeSelectedTypes(state.questionTypes, state.questionCount)
  const data = { subjects, wrongStats, recommendations, sessions }

  function syncQuestionTypes() {
    state.questionTypes = normalizeSelectedTypes(state.questionTypes, state.questionCount)
  }

  function getEffectiveQuestionCount() {
    if (state.customCount) {
      const n = Number(state.customCount)
      if (Number.isFinite(n) && n >= 1 && n <= 50) return n
    }
    return Number(state.questionCount)
  }

  function validateCount() {
    const n = getEffectiveQuestionCount()
    if (!Number.isFinite(n) || n < 1) {
      state.countError = '题目数量需在 1 到 50 之间'
      return false
    }
    if (n > 50) {
      state.countError = '题目数量不能超过 50'
      return false
    }
    state.countError = ''
    return true
  }

  function hasConfig() {
    return state.subjectId && state.questionTypes.length > 0
      && state.difficulty && validateCount()
  }

  async function refreshSessions() {
    try {
      const result = await getPracticeSessions({ page_size: 8 })
      data.sessions = result.data?.list || []
    } catch {
      data.sessions = data.sessions || []
    }
  }

  function rerender() {
    syncQuestionTypes()
    const main = document.getElementById('student-main')
    if (!main) return
    main.innerHTML = buildPage(data, state)
    bindEvents()
  }

  async function abandonSession(sessionId) {
    if (!sessionId) return
    const ok = window.confirm('确定放弃本次作答吗？放弃后不会继续保存进度，也不会生成成绩。')
    if (!ok) return
    try {
      await abandonPracticeSession(sessionId)
      removePracticeSessionSnapshot(sessionId)
      await refreshSessions()
      showToast('已放弃本次作答', 'success')
      rerender()
    } catch (err) {
      showToast(err.message || '放弃练习失败，请稍后重试', 'error')
    }
  }

  // ========================
  // AI 补题等待逻辑
  // ========================
  function showGeneratingModal() {
    // 在 body 上添加弹窗
    const existing = document.getElementById('ai-generating-overlay')
    if (existing) existing.remove()

    const modalHtml = buildAiGeneratingModal()
    const container = document.createElement('div')
    container.innerHTML = modalHtml
    document.body.appendChild(container.firstElementChild)

    // 轮换文案
    const steps = document.querySelectorAll('#ai-generating-steps .ai-step')
    let stepIndex = 0
    const stepTimer = setInterval(() => {
      if (stepIndex < steps.length) {
        steps[stepIndex]?.classList.remove('active')
        steps[stepIndex]?.classList.add('done')
      }
      stepIndex++
      if (stepIndex < steps.length) {
        steps[stepIndex]?.classList.add('active')
      }
      if (stepIndex >= steps.length) {
        clearInterval(stepTimer)
      }
    }, 8000)

    document.getElementById('btn-cancel-generating')?.addEventListener('click', () => {
      clearInterval(stepTimer)
      hideGeneratingModal()
      if (state.generatingAbort) {
        state.generatingAbort.abort()
        state.generatingAbort = null
      }
      state.starting = false
      rerender()
      showToast('已取消练习生成', 'warning')
    })

    return () => {
      clearInterval(stepTimer)
      hideGeneratingModal()
    }
  }

  function hideGeneratingModal() {
    const overlay = document.getElementById('ai-generating-overlay')
    if (overlay) overlay.remove()
    if (state.generatingTimer) {
      clearTimeout(state.generatingTimer)
      state.generatingTimer = null
    }
  }

  // ========================
  // 开始练习
  // ========================
  async function startNow() {
    if (state.starting) return
    if (!hasConfig()) {
      if (!state.subjectId) showToast('请先选择练习科目', 'warning')
      else if (!state.questionTypes.length) showToast('请至少选择一种题型', 'warning')
      else if (!state.difficulty) showToast('请选择难度', 'warning')
      else showToast('请正确设置题目数量', 'warning')
      return
    }
    syncQuestionTypes()

    const activeSession = getPrimaryActiveSession(data.sessions)
    if (activeSession) {
      const ok = window.confirm('当前还有一轮未完成练习。已保存的进度会保留在“继续练习”中，仍要开始新的练习吗？')
      if (!ok) return
    }

    const questionCount = getEffectiveQuestionCount()
    const sessionMode = state.sessionMode || 'practice'
    const answerMode = sessionMode === 'exam' ? 'paper' : (state.answerMode || 'single')

    state.starting = true
    rerender()

    // AI 补题等待弹窗 — 始终显示，因为后端可能在题库不足时需要 AI 生成题目
    const abortController = new AbortController()
    state.generatingAbort = abortController
    const hideModal = showGeneratingModal()

    // 超时控制：60 秒
    const TIMEOUT_MS = 60000
    let timedOut = false
    state.generatingTimer = setTimeout(() => {
      timedOut = true
      if (state.generatingAbort) {
        state.generatingAbort.abort()
        state.generatingAbort = null
      }
    }, TIMEOUT_MS)

    try {
      const result = await startPractice({
        subjectId: Number(state.subjectId),
        questionTypes: state.questionTypes,
        difficulty: state.difficulty,
        questionCount,
        practiceMode: sessionMode === 'exam' ? 'EXAM' : 'PRACTICE',
        answerMode: answerMode === 'single' ? 'SINGLE' : 'PAPER',
        signal: abortController.signal,
      })

      // 如果已经超时，忽略迟到响应
      if (timedOut) {
        return
      }

      // 清理等待状态
      hideModal()
      clearTimeout(state.generatingTimer)
      state.generatingTimer = null
      state.starting = false
      state.generatingAbort = null

      const startData = result.data || {}
      const sessionId = startData.session?.practice_session_id
      const questions = startData.questions || []

      if (!sessionId) throw new Error('练习会话创建失败')
      if (!questions.length) {
        showToast('题目准备失败，请调整配置后重试', 'error')
        rerender()
        return
      }

      // 构建快照
      const subject = subjects.find(s => String(s.course_id) === String(state.subjectId)) || {
        course_id: state.subjectId,
        course_name: '自主练习',
      }
      const serverSession = startData.session || {}
      const snapshot = {
        session: startData.session,
        questions,
        generated_count: startData.generated_count || 0,
        warning: startData.warning || null,
        subject,
        config: {
          subjectId: Number(state.subjectId),
          questionTypes: [...state.questionTypes],
          difficulty: state.difficulty,
          questionCount,
          sessionMode: String(serverSession.mode || '').toUpperCase() === 'EXAM' ? 'exam' : sessionMode,
          answerMode: String(serverSession.answer_mode || '').toUpperCase() === 'PAPER' ? 'paper' : answerMode,
        },
        answers: {},
        currentIndex: 0,
        submitted: false,
        result: null,
        aiChats: {},
        startedAtMs: Date.parse(serverSession.started_at || '') || Date.now(),
        practice_session_id: sessionId,
      }
      if (snapshot.config.sessionMode === 'exam') {
        removePracticeSessionSnapshot(sessionId)
      } else {
        savePracticeSessionSnapshot(sessionId, snapshot)
      }
      if (startData.warning) showToast(startData.warning, 'warning')
      else showToast('练习已生成', 'success')
      window.location.hash = `#/student/practice/sessions/${sessionId}`
    } catch (err) {
      // 清理等待状态
      hideModal()
      clearTimeout(state.generatingTimer)
      state.generatingTimer = null
      state.starting = false
      state.generatingAbort = null

      if (timedOut || err.name === 'AbortError') {
        showToast('AI 生成练习题超时，请稍后重试。你可以减少题目数量或减少题型范围后再次尝试。', 'error')
      } else if (err.message && err.message.includes('题目准备失败')) {
        showToast('当前没有可用题目，请调整题型、难度或稍后重试。', 'error')
      } else {
        showToast(err.message || '题目生成失败，请稍后重试。', 'error')
      }
      rerender()
    }
  }

  // ========================
  // 事件绑定
  // ========================
  function bindEvents() {
    document.getElementById('btn-go-courses')?.addEventListener('click', () => { window.location.hash = '#/student/courses' })
    document.getElementById('btn-go-wrong-book')?.addEventListener('click', () => { window.location.hash = '#/student/wrong-questions' })
    document.getElementById('btn-go-recommendations')?.addEventListener('click', () => { window.location.hash = '#/student/recommendations' })
    document.getElementById('btn-open-trainer')?.addEventListener('click', (event) => {
      window.location.hash = event.currentTarget.dataset.hash || '#/student/trainer'
    })
    document.querySelectorAll('[data-go-recommendations]').forEach(btn => {
      btn.addEventListener('click', () => { window.location.hash = '#/student/recommendations' })
    })
    document.querySelectorAll('[data-continue-session]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sessionId = btn.dataset.continueSession
        if (sessionId) window.location.hash = `#/student/practice/sessions/${sessionId}`
      })
    })
    document.querySelectorAll('[data-view-session]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sessionId = btn.dataset.viewSession
        if (sessionId) window.location.hash = `#/student/practice/sessions/${sessionId}`
      })
    })
    document.querySelectorAll('[data-abandon-session]').forEach(btn => {
      btn.addEventListener('click', () => abandonSession(Number(btn.dataset.abandonSession)))
    })
    document.getElementById('btn-start-practice')?.addEventListener('click', startNow)

    // 科目卡片选择
    document.querySelectorAll('.subject-card').forEach(btn => {
      btn.addEventListener('click', () => {
        state.subjectId = btn.dataset.subjectId
        rerender()
      })
    })

    // 题型胶囊选择
    document.querySelectorAll('.type-capsule').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return
        const typeValue = btn.dataset.type
        const idx = state.questionTypes.indexOf(typeValue)
        if (idx >= 0) {
          state.questionTypes.splice(idx, 1)
        } else {
          const limit = getTypeLimit(state.questionCount)
          if (state.questionTypes.length >= limit) {
            showToast(`当前题目数量最多选择 ${limit} 种题型`, 'warning')
            return
          }
          state.questionTypes.push(typeValue)
        }
        syncQuestionTypes()
        rerender()
      })
    })

    // 难度卡片选择
    document.querySelectorAll('.diff-card').forEach(btn => {
      btn.addEventListener('click', () => {
        state.difficulty = btn.dataset.difficulty
        rerender()
      })
    })

    // 题目数量选择
    document.querySelectorAll('.count-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.questionCount = Number(btn.dataset.count)
        state.customCount = ''
        state.countError = ''
        syncQuestionTypes()
        rerender()
      })
    })
    const customInput = document.getElementById('practice-count-custom')
    if (customInput) {
      customInput.addEventListener('input', () => {
        state.customCount = customInput.value
        const n = Number(customInput.value)
        if (customInput.value && (!Number.isFinite(n) || n < 1 || n > 50)) {
          state.countError = '题目数量需在 1 到 50 之间'
        } else {
          state.countError = ''
        }
        rerender()
      })
    }

    // 练习/考试模式选择
    document.querySelectorAll('#practice-session-mode .mode-option').forEach(btn => {
      btn.addEventListener('click', () => {
        state.sessionMode = btn.dataset.sessionMode
        if (state.sessionMode === 'exam') {
          state.answerMode = 'paper'
        }
        rerender()
      })
    })

    // 单题/整卷模式选择
    document.querySelectorAll('#practice-answer-mode .mode-option').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return
        state.answerMode = btn.dataset.answerMode
        rerender()
      })
    })
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildPage(data, state), user })
  bindEvents()
}
