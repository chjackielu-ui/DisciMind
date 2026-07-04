// 学生端 — 智能练习错题本（重构版）
// 紧凑卡片列表、手风琴展开详情、标签颜色系统

import { getMe } from '../api/auth.js'
import {
  getPracticeWrongQuestions,
  getStudentCourses,
  markPracticeWrongQuestionMastered,
  startSimilarPractice,
  searchVideos,
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
          <button class="complex-btn-secondary btn-video-explain" type="button" data-action="video" data-wrong-id="${item.wrong_question_id}" style="color:#2563eb;border-color:#93c5fd;">▶ 视频讲解</button>
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

    // 视频讲解
    document.querySelectorAll('[data-action="video"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const wrongId = btn.dataset.wrongId
        const item = state.items.find(wq => String(wq.wrong_question_id) === String(wrongId))
        if (item) showVideoModal(item)
      })
    })
  }

  // ========================
  // 视频讲解弹窗（iframe 播放）
  // ========================
  async function showVideoModal(item) {
    // 从错题字段提取关键词
    const keywordParts = [
      item.knowledge_point_name,
      item.course_name,
      item.title || (item.question_content || '').replace(/<[^>]*>/g, '').slice(0, 40),
    ].filter(Boolean).slice(0, 3)
    const searchKeyword = keywordParts.join(' ') || '视频讲解'
    const bilibiliSearchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(searchKeyword)}`

    // 锁定页面滚动
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);'
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:22px;box-shadow:0 24px 64px rgba(0,0,0,0.15);padding:24px;width:92%;max-width:820px;max-height:90vh;display:flex;flex-direction:column;">
        <!-- 弹头 -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-shrink:0;">
          <div>
            <h3 style="font-size:1.1rem;font-weight:700;color:var(--text);margin:0;">▶ 视频讲解</h3>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">关键词：${escapeHtml(searchKeyword)}</div>
          </div>
          <button id="vm-close" style="width:28px;height:28px;border:none;background:rgba(0,0,0,0.05);border-radius:50%;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-muted);">✕</button>
        </div>

        <!-- 主体：左侧列表 + 右侧播放器 -->
        <div style="display:flex;gap:16px;flex:1;min-height:0;overflow:hidden;flex-wrap:wrap;">
          <!-- 左侧视频列表 -->
          <div style="flex:0 0 240px;overflow-y:auto;border:1px solid var(--border);border-radius:14px;padding:8px;background:#fafafa;">
            <div id="video-list" style="display:flex;flex-direction:column;gap:6px;">
              <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">
                <div style="display:inline-block;width:20px;height:20px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:6px;"></div>
                <p>搜索中...</p>
              </div>
            </div>
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
              <a href="${escapeHtml(bilibiliSearchUrl)}" target="_blank" rel="noopener noreferrer" id="bili-search-link" style="display:block;text-align:center;padding:8px;border-radius:10px;font-size:0.82rem;background:#fb7299;color:#fff;text-decoration:none;">去 B 站搜索更多 ›</a>
            </div>
          </div>

          <!-- 右侧播放器 -->
          <div style="flex:1;min-width:280px;display:flex;flex-direction:column;">
            <div id="video-player" style="flex:1;background:#000;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:280px;position:relative;">
              <div style="text-align:center;color:rgba(255,255,255,0.6);font-size:0.9rem;padding:20px;">
                <div style="font-size:2.5rem;margin-bottom:8px;">🎬</div>
                <p>请从左侧选择一个视频</p>
              </div>
            </div>
            <div id="video-title" style="font-size:0.85rem;color:var(--text-muted);margin-top:6px;text-align:center;flex-shrink:0;">&nbsp;</div>
          </div>
        </div>
      </div>
    `

    const container = document.querySelector('.student-dashboard-wrapper') || document.getElementById('app')
    container.appendChild(overlay)

    function closeModal() {
      overlay.remove()
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }

    overlay.querySelector('#vm-close').addEventListener('click', closeModal)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal() })

    // 切换播放
    function playVideo(embedUrl, title) {
      const player = overlay.querySelector('#video-player')
      const titleEl = overlay.querySelector('#video-title')
      if (embedUrl) {
        player.innerHTML = `<iframe src="${escapeHtml(embedUrl)}" style="width:100%;height:100%;border:none;" allowfullscreen allow="autoplay;fullscreen"></iframe>`
        titleEl.textContent = title || '视频讲解'
      } else {
        player.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.6);font-size:0.85rem;padding:20px;">
          <div style="font-size:2rem;margin-bottom:8px;">⚠️</div>
          <p>该视频暂无可用播放地址</p>
        </div>`
        titleEl.textContent = title || ''
      }
    }

    // 调用后端搜索接口（通过 B 站 API 实时检索）
    try {
      const listEl = overlay.querySelector('#video-list')
      const res = await searchVideos({ keyword: searchKeyword, limit: 10 })
      const videos = res.data?.list || []
      const suggestion = res.data?.suggestion || null

      if (videos.length > 0) {
        // 构建列表
        listEl.innerHTML = videos.map((v, idx) => {
          const isBili = (v.source || '').toLowerCase() === 'bilibili'
          const iconHtml = isBili
            ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.77 1.56-3.774C2.564 4.21 3.823 3.69 5.333 3.653h.534l-1.066-1.12a1.2 1.2 0 0 1-.347-.853c0-.338.116-.622.347-.853.23-.231.515-.347.853-.347.339 0 .623.116.854.347L7.947 3.64h8.106l1.44-1.813c.231-.231.515-.347.854-.347.338 0 .622.116.853.347.231.23.347.515.347.853a1.2 1.2 0 0 1-.347.854l-1.387 1.12zM5.333 6.4c-.8 0-1.48.283-2.04.853-.56.57-.84 1.25-.84 2.04v7.68c0 .789.28 1.469.84 2.04.56.57 1.24.853 2.04.853h13.334c.8 0 1.48-.283 2.04-.853.56-.571.84-1.251.84-2.04v-7.68c0-.79-.28-1.47-.84-2.04-.56-.57-1.24-.853-2.04-.853H5.333zm5.334 2.773v3.094h-2.56V9.173h2.56zm5.333 0v3.094h-2.56V9.173h2.56z"/></svg>'
            : '<span style="font-size:0.75rem;">▶</span>'
          const bg = isBili ? '#fb7299' : 'var(--primary)'
          return `<div class="vi-item" data-embed="${escapeHtml(v.embed_url || '')}" data-title="${escapeHtml(v.title)}" data-url="${escapeHtml(v.video_url || '')}" style="cursor:pointer;padding:8px 10px;border-radius:10px;border:1px solid ${idx === 0 ? '#2563eb' : 'var(--border)'};background:${idx === 0 ? '#eff6ff' : '#fff'};transition:all 0.15s;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="flex-shrink:0;width:20px;height:20px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:${bg};color:#fff;">${iconHtml}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:0.82rem;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(v.title)}</div>
                ${v.recommend_reason ? `<div style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">${escapeHtml(v.recommend_reason)}</div>` : ''}
              </div>
            </div>
          </div>`
        }).join('')

        // 绑定列表点击
        const items = listEl.querySelectorAll('.vi-item')
        items.forEach((el, idx) => {
          el.addEventListener('click', () => {
            items.forEach(i => { i.style.borderColor = 'var(--border)'; i.style.background = '#fff' })
            el.style.borderColor = '#2563eb'; el.style.background = '#eff6ff'
            const embed = el.dataset.embed
            const title = el.dataset.title
            playVideo(embed || '', title)
          })
        })

        // 自动播第一个
        if (videos[0]) {
          setTimeout(() => playVideo(videos[0].embed_url || '', videos[0].title || ''), 100)
        }
      } else if (suggestion) {
        listEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.85rem;">
          <div style="font-size:2rem;margin-bottom:6px;">📺</div>
          <p>暂无已收录的视频</p>
          <p style="font-size:0.78rem;margin-top:4px;">${escapeHtml(suggestion.note || '')}</p>
        </div>`
        // 更新B站搜索链接
        const link = overlay.querySelector('#bili-search-link')
        if (link && suggestion.search_url) link.href = suggestion.search_url
      } else {
        listEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:0.85rem;">
          <div style="font-size:2rem;margin-bottom:6px;">📺</div>
          <p>暂无相关视频</p>
        </div>`
      }
    } catch (err) {
      const listEl = overlay.querySelector('#video-list')
      if (listEl) {
        listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.85rem;">
          <p>⚠️ 视频搜索服务异常</p>
          <p style="font-size:0.78rem;margin-top:4px;">可尝试通过下方链接前往 B 站搜索</p>
        </div>`
      }
    }
  }

  await loadItems()
}
