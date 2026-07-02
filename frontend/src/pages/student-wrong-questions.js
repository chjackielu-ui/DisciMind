// 学生端 — 智能练习错题本（重构版）
// 紧凑卡片列表、手风琴展开详情、标签颜色系统

import { getMe } from '../api/auth.js'
import {
  getPracticeWrongQuestions,
  getStudentCourses,
  markPracticeWrongQuestionMastered,
  startSimilarPractice,
} from '../api/student.js'
import { getUser, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, formatRelativeTime } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import {
  PRACTICE_DIFFICULTIES,
  PRACTICE_QUESTION_TYPES,
  formatPracticeAnswer,
  normalizeQuestionType,
  practiceDifficultyLabel,
  practiceQuestionTypeLabel,
  savePracticeSessionSnapshot,
} from '../components/practice/practice-components.js'
import {
  questionTypeTagHtml,
  difficultyTagHtml,
  statusTagHtml,
  knowledgePointTagHtml,
} from '../components/practice/practice-tags.js'

// ========================
// 工具函数
// ========================

async function getAuthedUser() {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(localStorage.getItem('token') || '', user)
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
        classes: [],
      })
    }
    const subject = map.get(course.course_id)
    if (course.teaching_class_id && !subject.classes.some(item => item.class_id === course.teaching_class_id)) {
      subject.classes.push({
        class_id: course.teaching_class_id,
        class_name: course.teaching_class_name || '默认班级',
      })
    }
  })
  return [...map.values()]
}

function normalizeWrongQuestion(item) {
  const question = item.question || {}
  return {
    wrong_question_id: item.wrong_question_id,
    question_id: item.question_id || question.question_id,
    source_type: item.source_type,
    status: String(item.status || 'unresolved').toLowerCase(),
    course_id: item.course_id,
    course_name: item.course_name,
    knowledge_point_id: item.knowledge_point_id,
    knowledge_point_name: item.knowledge_point_name,
    question_type: normalizeQuestionType(question.question_type || item.question_type),
    difficulty_level: String(question.difficulty_level || item.difficulty_level || 'medium').toLowerCase(),
    question_content: question.question_content || item.question_content || question.title || '',
    title: question.title || '',
    options: question.options || [],
    correct_answer: question.correct_answer,
    answer_analysis: question.answer_analysis || question.analysis || '',
    wrong_count: item.wrong_count || 1,
    last_wrong_answer: item.last_wrong_answer || item.student_answer || '',
    created_at: item.created_at,
    updated_at: item.updated_at || item.last_wrong_at,
    mastered_at: item.mastered_at,
  }
}

// ========================
// 构建函数
// ========================

function buildLoading() {
  return `
    <div class="complex-shell practice-shell-v2">
      <div class="complex-loading">
        <div class="complex-spinner"></div>
        <p>正在加载错题本...</p>
      </div>
    </div>`
}

// 统计卡片
function buildStats(items) {
  const unresolved = items.filter(item => item.status === 'unresolved').length
  const mastered = items.filter(item => item.status === 'mastered').length
  const now = Date.now()
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  const recent = items.filter(item => {
    const t = item.created_at ? new Date(item.created_at).getTime() : 0
    return now - t < sevenDays
  }).length

  return `
    <section class="wrong-stats-v2">
      <div class="wrong-stat-card">
        <b>${items.length}</b>
        <span>总错题数</span>
      </div>
      <div class="wrong-stat-card unresolved">
        <b>${unresolved}</b>
        <span>未掌握</span>
      </div>
      <div class="wrong-stat-card mastered">
        <b>${mastered}</b>
        <span>已掌握</span>
      </div>
      <div class="wrong-stat-card recent">
        <b>${recent}</b>
        <span>最近新增</span>
      </div>
    </section>`
}

// 筛选区
function buildFilterPanel(subjects, state) {
  return `
    <section class="complex-card wrong-filter-v2">
      <div class="filter-row">
        <label>
          <span>科目</span>
          <select class="complex-select" id="wrong-subject-filter">
            <option value="all" ${state.subjectId === 'all' ? 'selected' : ''}>全部科目</option>
            ${subjects.map(subject => `<option value="${subject.course_id}" ${String(state.subjectId) === String(subject.course_id) ? 'selected' : ''}>${escapeHtml(subject.course_name)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>题型</span>
          <select class="complex-select" id="wrong-type-filter">
            <option value="all" ${state.questionType === 'all' ? 'selected' : ''}>全部题型</option>
            ${PRACTICE_QUESTION_TYPES.map(type => `<option value="${type.value}" ${state.questionType === type.value ? 'selected' : ''}>${type.label}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>难度</span>
          <select class="complex-select" id="wrong-difficulty-filter">
            <option value="all" ${state.difficulty === 'all' ? 'selected' : ''}>全部难度</option>
            ${PRACTICE_DIFFICULTIES.map(d => `<option value="${d.value}" ${state.difficulty === d.value ? 'selected' : ''}>${d.label}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>掌握状态</span>
          <select class="complex-select" id="wrong-status-filter">
            <option value="all" ${state.status === 'all' ? 'selected' : ''}>全部</option>
            <option value="unresolved" ${state.status === 'unresolved' ? 'selected' : ''}>未掌握</option>
            <option value="mastered" ${state.status === 'mastered' ? 'selected' : ''}>已掌握</option>
          </select>
        </label>
        <label>
          <span>关键词</span>
          <input class="complex-input" id="wrong-search-input" type="text" placeholder="搜索题目内容..." value="${escapeHtml(state.search || '')}">
        </label>
      </div>
      <div class="filter-actions">
        <button class="complex-btn-secondary" id="btn-reset-wrong-filter" type="button">重置筛选</button>
      </div>
    </section>`
}

// 紧凑错题卡片
function buildCompactWrongCard(item, expanded) {
  const mastered = item.status === 'mastered'
  const summary = (item.question_content || item.title || '暂无题目内容').slice(0, 120)

  return `
    <article class="wrong-compact-card ${mastered ? 'mastered' : 'unresolved'} ${expanded ? 'expanded' : ''}"
      data-wrong-id="${item.wrong_question_id}" data-question-id="${item.question_id}">
      <!-- 折叠头部 -->
      <div class="wrong-compact-head" data-action="toggle">
        <div class="wrong-compact-main">
          <div class="wrong-compact-tags">
            ${questionTypeTagHtml(item.question_type)}
            ${difficultyTagHtml(item.difficulty_level)}
            ${item.course_name ? `<span class="qtag subject-tag">${escapeHtml(item.course_name)}</span>` : ''}
            ${item.knowledge_point_name ? knowledgePointTagHtml(item.knowledge_point_name) : ''}
          </div>
          <p class="wrong-compact-summary">${escapeHtml(summary)}${(item.question_content || '').length > 120 ? '...' : ''}</p>
          <div class="wrong-compact-meta">
            ${statusTagHtml(item.status)}
            ${item.wrong_count > 1 ? `<span class="wrong-count-badge">错 ${item.wrong_count} 次</span>` : ''}
            <span class="wrong-time">${formatRelativeTime(item.updated_at)}</span>
          </div>
        </div>
        <span class="wrong-expand-icon">${expanded ? '▲' : '▼'}</span>
      </div>

      <!-- 展开详情 -->
      <div class="wrong-compact-detail" style="${expanded ? '' : 'display:none'}">
        <div class="wrong-detail-content">
          <div class="wrong-detail-block">
            <b>题目内容</b>
            <p>${escapeHtml(item.question_content || item.title || '暂无题目内容')}</p>
          </div>

          ${item.options?.length ? `
          <div class="wrong-detail-block">
            <b>选项</b>
            <div class="wrong-option-list-compact">
              ${item.options.map(option => `
                <div class="wrong-option-item">
                  <b>${escapeHtml(option.option_label || option.option_key || '')}</b>
                  <span>${escapeHtml(option.option_content || option.content || '')}</span>
                </div>
              `).join('')}
            </div>
          </div>` : ''}

          <div class="wrong-detail-compare">
            <div class="wrong-detail-col">
              <b>我的最近答案</b>
              <p class="wrong-answer-student">${escapeHtml(formatPracticeAnswer(item.last_wrong_answer) || '未记录')}</p>
            </div>
            <div class="wrong-detail-col">
              <b>正确答案</b>
              <p class="wrong-answer-correct">${escapeHtml(formatPracticeAnswer(item.correct_answer))}</p>
            </div>
          </div>

          ${item.answer_analysis ? `
          <div class="wrong-detail-block">
            <b>官方解析</b>
            <p>${escapeHtml(item.answer_analysis)}</p>
          </div>` : ''}
        </div>

        <div class="wrong-compact-actions">
          <button class="complex-btn-secondary btn-practice-similar" type="button" data-action="similar" data-wrong-id="${item.wrong_question_id}">再练一道类似题</button>
          ${mastered ? '' : `<button class="complex-btn btn-mark-mastered" type="button" data-action="master" data-wrong-id="${item.wrong_question_id}">标记已掌握</button>`}
        </div>
      </div>
    </article>`
}

// 页面整体
function buildPage(subjects, items, state, loading = false, errorMessage = '') {
  // 前端筛选
  let filtered = [...items]
  if (state.questionType !== 'all') {
    filtered = filtered.filter(item => item.question_type === state.questionType)
  }
  if (state.difficulty !== 'all') {
    filtered = filtered.filter(item => item.difficulty_level === state.difficulty)
  }
  if (state.search) {
    const kw = state.search.toLowerCase()
    filtered = filtered.filter(item =>
      (item.question_content || '').toLowerCase().includes(kw) ||
      (item.title || '').toLowerCase().includes(kw) ||
      (item.knowledge_point_name || '').toLowerCase().includes(kw)
    )
  }

  return `
    <div class="complex-shell practice-shell-v2">
      <section class="complex-hero practice-hero-v2">
        <div>
          <h1>我的错题本</h1>
          <p>按科目、题型、难度和掌握状态筛选错题，可标记已掌握或继续练习类似题。</p>
          <div class="exam-meta-row">
            <span>智能练习</span>
            <span>${filtered.length} 道</span>
            <span>${state.status === 'all' ? '全部状态' : (state.status === 'unresolved' ? '未掌握' : '已掌握')}</span>
          </div>
        </div>
        <div class="complex-actions">
          <button class="complex-btn-secondary" id="btn-go-practice" type="button">智能练习中心</button>
        </div>
      </section>

      ${buildStats(filtered)}
      ${buildFilterPanel(subjects, state)}

      ${loading ? '<div class="complex-loading"><div class="complex-spinner"></div><p>正在刷新错题...</p></div>' : ''}
      ${errorMessage ? `<div class="complex-error"><h3>错题加载失败</h3><p>${escapeHtml(errorMessage)}</p><button class="complex-btn" id="btn-retry-wrong" type="button">重新加载</button></div>` : ''}
      ${!loading && !errorMessage && filtered.length === 0 ? `
        <div class="complex-empty">
          <h3>没有符合条件的错题</h3>
          <p>可以调整筛选条件，或前往智能练习中心开始新的练习。</p>
        </div>
      ` : ''}
      ${!loading && !errorMessage && filtered.length > 0 ? `
        <section class="wrong-compact-list">
          ${filtered.map(item => buildCompactWrongCard(item, false)).join('')}
        </section>
      ` : ''}
    </div>`
}

// ========================
// 主渲染函数
// ========================

export async function renderStudentWrongQuestions(app) {
  const user = await getAuthedUser()
  if (!user) return

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildLoading(), user })

  let subjects = []
  try {
    const courseResult = await getStudentCourses()
    subjects = buildSubjectModels(courseResult.data?.list || [])
  } catch {
    subjects = []
  }

  const state = {
    subjectId: 'all',
    questionType: 'all',
    difficulty: 'all',
    status: 'all',
    search: '',
    loading: false,
    items: [],
    expandedIds: new Set(),
  }

  async function loadItems() {
    state.loading = true
    rerender()
    try {
      const params = { page_size: 200 }
      if (state.subjectId !== 'all') params.subjectId = state.subjectId
      if (state.status !== 'all') params.status = state.status
      const result = await getPracticeWrongQuestions(params)
      state.items = (result.data?.list || []).map(normalizeWrongQuestion)
      state.loading = false
      rerender()
    } catch (err) {
      state.loading = false
      rerender(err.message || '请稍后重试。')
    }
  }

  function rerender(errorMessage = '') {
    const main = document.getElementById('student-main')
    if (!main) return
    main.innerHTML = buildPage(subjects, state.items, state, state.loading, errorMessage)
    bindEvents()
  }

  async function markMastered(wrongId) {
    const btn = document.querySelector(`[data-action="master"][data-wrong-id="${wrongId}"]`)
    if (btn) {
      btn.disabled = true
      btn.textContent = '处理中...'
    }
    try {
      await markPracticeWrongQuestionMastered(wrongId)
      showToast('已标记为掌握', 'success')
      await loadItems()
    } catch (err) {
      showToast(err.message || '标记失败，请稍后重试', 'error')
      if (btn) {
        btn.disabled = false
        btn.textContent = '标记已掌握'
      }
    }
  }

  async function practiceSimilar(wrongId) {
    const item = state.items.find(wq => String(wq.wrong_question_id) === String(wrongId))
    if (!item?.course_id) {
      showToast('缺少课程信息，无法生成类似题', 'warning')
      return
    }
    const subject = subjects.find(s => String(s.course_id) === String(item.course_id)) || {
      course_id: item.course_id,
      course_name: item.course_name,
      classes: [],
    }
    const classInfo = subject.classes?.[0] || null
    const btn = document.querySelector(`[data-action="similar"][data-wrong-id="${wrongId}"]`)
    if (btn) {
      btn.disabled = true
      btn.textContent = '生成中...'
    }
    try {
      const result = await startSimilarPractice(wrongId, {
        classId: classInfo?.class_id || undefined,
        questionCount: 1,
      })
      const startData = result.data || {}
      const sessionId = startData.session?.practice_session_id
      if (!sessionId) throw new Error('练习会话创建失败')
      savePracticeSessionSnapshot(sessionId, {
        session: startData.session,
        questions: startData.questions || [],
        generated_count: startData.generated_count || 0,
        warning: startData.warning || null,
        subject,
        config: {
          subjectId: item.course_id,
          questionTypes: [item.question_type],
          difficulty: item.difficulty_level || 'medium',
          questionCount: 1,
          sessionMode: 'practice',
          answerMode: 'single',
        },
        answers: {},
        currentIndex: 0,
        submitted: false,
        result: null,
        aiChats: {},
        startedAtMs: Date.now(),
        practice_session_id: sessionId,
      })
      showToast('类似题已生成', 'success')
      window.location.hash = `#/student/practice/sessions/${sessionId}`
    } catch (err) {
      showToast(err.message || '类似题生成失败', 'error')
      if (btn) {
        btn.disabled = false
        btn.textContent = '再练一道类似题'
      }
    }
  }

  function bindEvents() {
    document.getElementById('btn-go-practice')?.addEventListener('click', () => { window.location.hash = '#/student/practice' })
    document.getElementById('btn-retry-wrong')?.addEventListener('click', loadItems)
    document.getElementById('btn-reset-wrong-filter')?.addEventListener('click', () => {
      state.subjectId = 'all'
      state.questionType = 'all'
      state.difficulty = 'all'
      state.status = 'all'
      state.search = ''
      loadItems()
    })

    // 筛选器
    document.getElementById('wrong-subject-filter')?.addEventListener('change', event => {
      state.subjectId = event.target.value
      loadItems()
    })
    document.getElementById('wrong-status-filter')?.addEventListener('change', event => {
      state.status = event.target.value
      loadItems()
    })
    document.getElementById('wrong-type-filter')?.addEventListener('change', event => {
      state.questionType = event.target.value
      rerender()
    })
    document.getElementById('wrong-difficulty-filter')?.addEventListener('change', event => {
      state.difficulty = event.target.value
      rerender()
    })
    document.getElementById('wrong-search-input')?.addEventListener('input', event => {
      state.search = event.target.value
      rerender()
    })

    // 展开/折叠
    document.querySelectorAll('[data-action="toggle"]').forEach(head => {
      head.addEventListener('click', () => {
        const card = head.closest('.wrong-compact-card')
        const detail = card?.querySelector('.wrong-compact-detail')
        const icon = card?.querySelector('.wrong-expand-icon')
        if (detail && icon) {
          const isHidden = detail.style.display === 'none'
          detail.style.display = isHidden ? 'block' : 'none'
          icon.textContent = isHidden ? '▲' : '▼'
          card.classList.toggle('expanded', isHidden)
        }
      })
    })

    // 标记掌握 / 练习类似题
    document.querySelectorAll('[data-action="master"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        markMastered(btn.dataset.wrongId)
      })
    })
    document.querySelectorAll('[data-action="similar"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        practiceSimilar(btn.dataset.wrongId)
      })
    })
  }

  await loadItems()
}
