// 学生端 — 错题学习工作区（升级版）
// 三栏布局：左侧分类导航 + 中间错题工作区 + 右侧练习篮
// 支持多层级分类、多条件筛选、错误原因/学习状态管理、标签、错题系列
// 四种练习模式：原题顺序/打乱重做、AI变式/相似题

import { getMe } from '../api/auth.js'
import {
  getPracticeWrongQuestions,
  getStudentCourses,
  markPracticeWrongQuestionMastered,
  startSimilarPractice,
  searchVideos,
  getWrongQuestionOverview,
  getWrongQuestionTaxonomy,
  queryWrongQuestions,
  updateWrongQuestion,
  getWrongQuestionTags,
  createWrongQuestionTag,
  deleteWrongQuestionTag,
  addTagToWrongQuestion,
  removeTagFromWrongQuestion,
  getWrongQuestionCollections,
  createWrongQuestionCollection,
  deleteWrongQuestionCollection,
  createAiGenerationJob,
  getAiGenerationJob,
  cancelAiGenerationJob,
  startWrongQuestionPractice,
} from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, formatRelativeTime } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import {
  PRACTICE_DIFFICULTIES,
  PRACTICE_QUESTION_TYPES,
  formatPracticeAnswer,
  normalizeQuestionType,
} from '../components/practice/practice-components.js'
import {
  questionTypeTagHtml,
  difficultyTagHtml,
  statusTagHtml,
  knowledgePointTagHtml,
} from '../components/practice/practice-tags.js'
import { savePracticeSessionSnapshot } from '../components/practice/practice-components.js'
import { learningCardApi } from '../api/learning-cards.js'
import { renderLearningCardGrid } from '../components/learning-card-platform.js'

// ========================
// 常量
// ========================

const WRONG_REASONS = {
  CONCEPT_MISUNDERSTANDING: '概念理解错误',
  MEMORY_WEAK: '知识点记忆不牢',
  FORMULA_ERROR: '公式使用错误',
  CALCULATION_ERROR: '计算错误',
  QUESTION_READING_ERROR: '审题错误',
  METHOD_SELECTION_ERROR: '方法选择错误',
  CARELESS: '粗心失误',
  TIME_INSUFFICIENT: '时间不足',
  UNKNOWN: '完全不会',
  OTHER: '其他',
}

const REVIEW_STATUSES = {
  PENDING_REVIEW: '待复习',
  REINFORCING: '正在巩固',
  WRONG_AGAIN: '再次出错',
  MASTERED: '已掌握',
  IGNORED: '暂时忽略',
}

const PRACTICE_MODES = {
  ORIGINAL_ORDER: { label: '原题顺序重做', icon: '顺序', desc: '按原题顺序重新作答' },
  ORIGINAL_SHUFFLE: { label: '原题打乱重做', icon: '打乱', desc: '题目和选项随机打乱' },
  AI_VARIANT: { label: 'AI 变式重做', icon: '变式', desc: 'AI 生成变式题，知识点一致' },
  AI_SIMILAR: { label: 'AI 相似题', icon: '相似', desc: 'AI 生成全新同类题目' },
}

const DIFFICULTY_MODES = {
  EASIER: '更简单',
  SAME: '同难度',
  HARDER: '更困难',
  MIXED: '混合难度',
}

const SORT_OPTIONS = [
  { value: 'recent', label: '最近出错' },
  { value: 'last_reviewed', label: '最近复习' },
  { value: 'difficulty', label: '难度' },
]

// ========================
// 工具函数
// ========================

function getHashSearchParams() {
  const raw = window.location.hash.slice(1)
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : ''
  return new URLSearchParams(query)
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

function normalizeWrongQuestionItem(item) {
  const q = item.question || {}
  return {
    wrong_question_id: item.wrong_question_id,
    question_id: item.question_id || q.question_id,
    source_type: item.source_type,
    status: String(item.status || 'unresolved').toLowerCase(),
    wrong_reason: String(item.wrong_reason || '').toLowerCase(),
    wrong_reason_source: String(item.wrong_reason_source || 'user').toLowerCase(),
    review_status: String(item.review_status || 'pending_review').toLowerCase(),
    review_count: item.review_count || 0,
    consecutive_correct_count: item.consecutive_correct_count || 0,
    last_reviewed_at: item.last_reviewed_at,
    last_wrong_at: item.last_wrong_at,
    mastered_at: item.mastered_at,
    ignored_at: item.ignored_at,
    course_id: item.course_id,
    course_name: item.course_name,
    chapter_id: item.chapter_id,
    chapter_name: item.chapter_name,
    knowledge_point_id: item.knowledge_point_id,
    knowledge_point_name: item.knowledge_point_name,
    question_type: normalizeQuestionType(q.question_type || 'single_choice'),
    difficulty_level: String(q.difficulty_level || 'medium').toLowerCase(),
    question_content: q.question_content || q.title || '',
    title: q.title || '',
    options: q.options || [],
    correct_answer: q.correct_answer,
    answer_analysis: q.answer_analysis || '',
    wrong_count: item.wrong_count || 1,
    last_wrong_answer: item.last_wrong_answer || '',
    created_at: item.created_at,
    updated_at: item.updated_at || item.last_wrong_at,
    tags: item.tags || [],
  }
}

// ========================
// 主渲染函数
// ========================

export async function renderStudentWrongQuestions(app) {
  const user = await getAuthedUser()
  if (!user) return

  renderDashboardLayout(app, {
    menuItems: STUDENT_MENU_ITEMS,
    contentHTML: buildLoading(),
    user,
  })

  // 状态
  const state = {
    // 筛选
    courseId: getHashSearchParams().get('courseId') || getHashSearchParams().get('subjectId') || '',
    chapterId: '',
    knowledgePointId: '',
    wrongReason: '',
    reviewStatus: '',
    questionType: '',
    difficulty: '',
    tags: '',
    collectionId: '',
    search: '',
    sort: 'recent',
    page: 1,
    pageSize: 20,
    // 视图
    viewMode: 'card', // card | compact | byChapter | byKnowledgePoint
    // 数据
    overview: null,
    taxonomy: [],
    items: [],
    total: 0,
    allTags: [],
    collections: [],
    loading: false,
    // 练习篮
    basket: new Set(),
    practiceMode: 'ORIGINAL_ORDER',
    difficultyMode: 'SAME',
    similarCount: 1,
    // UI 状态
    leftOpen: true,
    rightOpen: true,
    expandedCards: new Set(),
    repairCards: new Map(), repairLoading: new Set(),
    // AI 生成
    aiJob: null,
    aiJobPolling: null,
    // 请求防重锁
    isGenerating: false,
    isCreatingPractice: false,
  }

  function setAiContext() {
    if (typeof window === 'undefined') return
    window.__discimindStudentPageContext = {
      type: 'wrongQuestionBook',
      page: 'student-wrong-questions',
      courseId: state.courseId || null,
      filters: {
        wrongReason: state.wrongReason,
        reviewStatus: state.reviewStatus,
        questionType: state.questionType,
        difficulty: state.difficulty,
        search: state.search,
      },
      wrongQuestionCount: state.total,
    }
  }

  // ========================
  // 数据加载
  // ========================

  async function loadOverview() {
    try {
      const params = {}
      if (state.courseId) params.courseId = state.courseId
      const result = await getWrongQuestionOverview(params)
      state.overview = result.data || {}
    } catch (err) {
      state.overview = null
    }
  }

  async function loadTaxonomy() {
    try {
      const params = {}
      if (state.courseId) params.courseId = state.courseId
      const result = await getWrongQuestionTaxonomy(params)
      state.taxonomy = result.data || []
    } catch (err) {
      state.taxonomy = []
    }
  }

  async function loadTags() {
    try {
      const result = await getWrongQuestionTags()
      state.allTags = result.data || []
    } catch {
      state.allTags = []
    }
  }

  async function loadCollections() {
    try {
      const result = await getWrongQuestionCollections()
      state.collections = result.data || []
    } catch {
      state.collections = []
    }
  }

  async function loadItems() {
    state.loading = true
    rerender()
    try {
      const params = {
        page: state.page,
        page_size: state.pageSize,
        sort: state.sort,
      }
      if (state.courseId) params.courseId = state.courseId
      if (state.chapterId) params.chapterId = state.chapterId
      if (state.knowledgePointId) params.knowledgePointId = state.knowledgePointId
      if (state.wrongReason) params.wrongReason = state.wrongReason
      if (state.reviewStatus) params.reviewStatus = state.reviewStatus
      if (state.questionType) params.questionType = state.questionType
      if (state.difficulty) params.difficulty = state.difficulty
      if (state.tags) params.tags = state.tags
      if (state.collectionId) params.collectionId = state.collectionId
      if (state.search) params.search = state.search

      const result = await queryWrongQuestions(params)
      state.items = (result.data?.list || []).map(normalizeWrongQuestionItem)
      state.total = result.data?.total || 0
      state.loading = false
      rerender()
    } catch (err) {
      state.loading = false
      // 回退到旧接口
      try {
        const oldParams = { page_size: 200 }
        if (state.courseId) oldParams.subjectId = state.courseId
        const result = await getPracticeWrongQuestions(oldParams)
        state.items = (result.data?.list || []).map(normalizeWrongQuestionItem)
        state.total = state.items.length
      } catch {
        state.items = []
        state.total = 0
      }
      rerender(err.message || '加载失败')
    }
  }

  async function loadAll() {
    state.loading = true
    rerender()
    await Promise.all([loadOverview(), loadTaxonomy(), loadTags(), loadCollections()])
    await loadItems()
  }

  function rerender(errorMessage = '') {
    const main = document.getElementById('student-main')
    if (!main) return
    setAiContext()
    main.innerHTML = buildPage(state, errorMessage)
    bindEvents()
    void mountRepairCards()
  }

  async function mountRepairCards() {
    const roots = [...document.querySelectorAll('[data-wq-repair-card]')]
    for (const root of roots) {
      const id = String(root.dataset.wqRepairCard)
      if (state.repairCards.has(id)) { renderLearningCardGrid(root, [state.repairCards.get(id)], { compact: true, scene: 'WRONG_QUESTION_DETAIL' }); continue }
      if (state.repairLoading.has(id)) continue
      state.repairLoading.add(id)
      try {
        const card = (await learningCardApi.repairCard(id)).data
        state.repairCards.set(id, card)
        if (document.body.contains(root)) renderLearningCardGrid(root, [card], { compact: true, scene: 'WRONG_QUESTION_DETAIL' })
      } catch (error) {
        if (document.body.contains(root)) root.innerHTML = `<div class="lc-empty"><b>错题修复卡暂不可用</b><span>${escapeHtml(error.message || '原题练习仍可继续。')}</span></div>`
      } finally { state.repairLoading.delete(id) }
    }
  }

  // ========================
  // 页面构建
  // ========================

  function buildPage(s, errorMessage) {
    const basketArr = [...s.basket]
      .map(id => s.items.find(item => String(item.wrong_question_id) === String(id)))
      .filter(Boolean)

    return `
    <div class="wq-workspace ${s.leftOpen ? 'left-open' : ''} ${s.rightOpen ? 'right-open' : ''}">
      ${buildLeftSidebar(s)}
      ${buildCenterWorkspace(s, errorMessage)}
      ${buildRightBasket(s, basketArr)}
      ${buildTagModal(s)}
      ${buildCollectionModal(s)}
      ${buildAiProgressModal(s)}
      ${s.viewMode !== 'card' ? '' : buildExpandedModals(s)}
    </div>`
  }

  // ========================
  // 左侧分类导航
  // ========================

  function buildLeftSidebar(s) {
    const filterChips = []
    if (s.courseId) {
      const course = s.taxonomy.find(c => String(c.course_id) === String(s.courseId))
      filterChips.push({ label: course?.course_name || '课程', key: 'courseId' })
    }
    if (s.wrongReason) filterChips.push({ label: WRONG_REASONS[s.wrongReason.toUpperCase()] || s.wrongReason, key: 'wrongReason' })
    if (s.reviewStatus) filterChips.push({ label: REVIEW_STATUSES[s.reviewStatus.toUpperCase()] || s.reviewStatus, key: 'reviewStatus' })
    if (s.questionType) filterChips.push({ label: PRACTICE_QUESTION_TYPES.find(t => t.value === s.questionType)?.label || s.questionType, key: 'questionType' })
    if (s.difficulty) filterChips.push({ label: PRACTICE_DIFFICULTIES.find(d => d.value === s.difficulty)?.label || s.difficulty, key: 'difficulty' })

    return `
    <aside class="wq-sidebar wq-sidebar-left">
      <div class="wq-sidebar-header">
        <h3>分类导航</h3>
        <button class="wq-sidebar-toggle" id="btn-toggle-left" title="收起">◀</button>
      </div>
      <div class="wq-sidebar-scroll">
        ${filterChips.length > 0 ? `
        <div class="wq-filter-chips">
          ${filterChips.map(c => `<span class="wq-chip" data-clear="${c.key}">${escapeHtml(c.label)} ✕</span>`).join('')}
          <button class="wq-chip-clear" id="btn-clear-filters">清空筛选</button>
        </div>` : ''}

        <div class="wq-nav-section">
          <div class="wq-nav-title" data-action="expand-section" data-section="courses">
            <span>课程分类</span>
            <span class="wq-nav-arrow">▼</span>
          </div>
          <div class="wq-nav-body" id="section-courses">
            <div class="wq-nav-item ${!s.courseId ? 'active' : ''}" data-nav="course" data-id="">全部课程 (${s.overview?.total || 0})</div>
            ${s.taxonomy.map(c => `
              <div class="wq-nav-item ${String(s.courseId) === String(c.course_id) ? 'active' : ''}" data-nav="course" data-id="${c.course_id}">
                ${escapeHtml(c.course_name)} <span class="wq-nav-count">${c.wrong_count}</span>
              </div>
              ${String(s.courseId) === String(c.course_id) ? c.chapters.map(ch => `
                <div class="wq-nav-item wq-nav-sub ${String(s.chapterId) === String(ch.chapter_id) ? 'active' : ''}" data-nav="chapter" data-id="${ch.chapter_id}">
                  ${escapeHtml(ch.chapter_name)} <span class="wq-nav-count">${ch.wrong_count}</span>
                </div>
                ${String(s.chapterId) === String(ch.chapter_id) ? ch.knowledge_points.map(kp => `
                  <div class="wq-nav-item wq-nav-sub2 ${String(s.knowledgePointId) === String(kp.knowledge_point_id) ? 'active' : ''}" data-nav="kp" data-id="${kp.knowledge_point_id}">
                    ${escapeHtml(kp.knowledge_point_name)} <span class="wq-nav-count">${kp.wrong_count}</span>
                  </div>
                `).join('') : ''}
              `).join('') : ''}
            `).join('')}
          </div>
        </div>

        <div class="wq-nav-section">
          <div class="wq-nav-title" data-action="expand-section" data-section="reasons">
            <span>错误原因</span>
            <span class="wq-nav-arrow">▼</span>
          </div>
          <div class="wq-nav-body" id="section-reasons">
            <div class="wq-nav-item ${!s.wrongReason ? 'active' : ''}" data-nav="wrongReason" data-id="">全部</div>
            ${Object.entries(WRONG_REASONS).map(([key, label]) => `
              <div class="wq-nav-item ${s.wrongReason === key.toLowerCase() ? 'active' : ''}" data-nav="wrongReason" data-id="${key.toLowerCase()}">${label}</div>
            `).join('')}
          </div>
        </div>

        <div class="wq-nav-section">
          <div class="wq-nav-title" data-action="expand-section" data-section="statuses">
            <span>学习状态</span>
            <span class="wq-nav-arrow">▼</span>
          </div>
          <div class="wq-nav-body" id="section-statuses">
            <div class="wq-nav-item ${!s.reviewStatus ? 'active' : ''}" data-nav="reviewStatus" data-id="">全部</div>
            ${Object.entries(REVIEW_STATUSES).map(([key, label]) => `
              <div class="wq-nav-item ${s.reviewStatus === key.toLowerCase() ? 'active' : ''}" data-nav="reviewStatus" data-id="${key.toLowerCase()}">${label}</div>
            `).join('')}
          </div>
        </div>

        <div class="wq-nav-section">
          <div class="wq-nav-title" data-action="expand-section" data-section="types">
            <span>题型</span>
            <span class="wq-nav-arrow">▼</span>
          </div>
          <div class="wq-nav-body" id="section-types">
            <div class="wq-nav-item ${!s.questionType ? 'active' : ''}" data-nav="questionType" data-id="">全部</div>
            ${PRACTICE_QUESTION_TYPES.map(t => `
              <div class="wq-nav-item ${s.questionType === t.value ? 'active' : ''}" data-nav="questionType" data-id="${t.value}">${t.label}</div>
            `).join('')}
          </div>
        </div>

        <div class="wq-nav-section">
          <div class="wq-nav-title" data-action="expand-section" data-section="difficulties">
            <span>难度</span>
            <span class="wq-nav-arrow">▼</span>
          </div>
          <div class="wq-nav-body" id="section-difficulties">
            <div class="wq-nav-item ${!s.difficulty ? 'active' : ''}" data-nav="difficulty" data-id="">全部</div>
            ${PRACTICE_DIFFICULTIES.map(d => `
              <div class="wq-nav-item ${s.difficulty === d.value ? 'active' : ''}" data-nav="difficulty" data-id="${d.value}">${d.label}</div>
            `).join('')}
          </div>
        </div>

        ${s.allTags.length > 0 ? `
        <div class="wq-nav-section">
          <div class="wq-nav-title" data-action="expand-section" data-section="tags">
            <span>标签</span>
            <span class="wq-nav-arrow">▼</span>
          </div>
          <div class="wq-nav-body" id="section-tags">
            ${s.allTags.map(t => `
              <div class="wq-nav-item ${s.tags === String(t.tag_id) ? 'active' : ''}" data-nav="tags" data-id="${t.tag_id}">
                <span class="wq-tag-dot" style="background:${t.color || '#6366f1'}"></span>${escapeHtml(t.name)}
                <span class="wq-nav-count">${t.wrong_question_count || 0}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        ${s.collections.length > 0 ? `
        <div class="wq-nav-section">
          <div class="wq-nav-title" data-action="expand-section" data-section="collections">
            <span>错题系列</span>
            <span class="wq-nav-arrow">▼</span>
          </div>
          <div class="wq-nav-body" id="section-collections">
            ${s.collections.map(c => `
              <div class="wq-nav-item ${String(s.collectionId) === String(c.collection_id) ? 'active' : ''}" data-nav="collectionId" data-id="${c.collection_id}">
                ${escapeHtml(c.name)} <span class="wq-nav-count">${c.wrong_question_count || 0}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
      </div>
    </aside>`
  }

  // ========================
  // 中间工作区
  // ========================

  function buildCenterWorkspace(s, errorMessage) {
    const basketSize = s.basket.size
    return `
    <main class="wq-main">
      ${buildTopStats(s)}
      ${buildToolbar(s, basketSize)}
      ${s.loading ? buildLoading() : ''}
      ${errorMessage ? `<div class="complex-error"><p>${escapeHtml(errorMessage)}</p><button class="complex-btn" id="btn-retry">重试</button></div>` : ''}
      ${!s.loading && !errorMessage && s.items.length === 0 ? buildEmpty() : ''}
      ${!s.loading && !errorMessage && s.items.length > 0 ? buildItemList(s) : ''}
      ${!s.loading && s.total > s.pageSize ? buildPagination(s) : ''}
    </main>`
  }

  function buildTopStats(s) {
    const ov = s.overview || {}
    return `
    <section class="wq-stats-bar">
      <div class="wq-stat-item">
        <b>${ov.total || s.total}</b><span>错题总数</span>
      </div>
      <div class="wq-stat-item warn">
        <b>${ov.pending_review ?? '-'}</b><span>待复习</span>
      </div>
      <div class="wq-stat-item danger">
        <b>${ov.wrong_again ?? '-'}</b><span>再次出错</span>
      </div>
      <div class="wq-stat-item info">
        <b>${ov.reinforcing ?? '-'}</b><span>正在巩固</span>
      </div>
      <div class="wq-stat-item success">
        <b>${ov.mastered ?? '-'}</b><span>已掌握</span>
      </div>
      <div class="wq-stat-item">
        <b>${ov.weekly_new ?? '-'}</b><span>本周新增</span>
      </div>
      <div class="wq-stat-item">
        <b>${ov.weekly_completed ?? '-'}</b><span>本周完成</span>
      </div>
    </section>`
  }

  function buildToolbar(s, basketSize) {
    return `
    <section class="wq-toolbar">
      <div class="wq-toolbar-left">
        <button class="wq-btn-icon" id="btn-toggle-left-m" title="分类导航">☰</button>
        <input class="wq-search-input" id="wq-search" type="text" placeholder="搜索题目内容..." value="${escapeHtml(s.search)}">
        <select class="wq-select-sm" id="wq-sort">
          ${SORT_OPTIONS.map(o => `<option value="${o.value}" ${s.sort === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <div class="wq-view-toggle">
          <button class="wq-btn-icon-sm ${s.viewMode === 'card' ? 'active' : ''}" data-view="card" title="卡片视图">▦</button>
          <button class="wq-btn-icon-sm ${s.viewMode === 'compact' ? 'active' : ''}" data-view="compact" title="紧凑列表">☰</button>
          <button class="wq-btn-icon-sm ${s.viewMode === 'byChapter' ? 'active' : ''}" data-view="byChapter" title="按章节分组">章</button>
          <button class="wq-btn-icon-sm ${s.viewMode === 'byKnowledgePoint' ? 'active' : ''}" data-view="byKnowledgePoint" title="按知识点分组">点</button>
        </div>
      </div>
      <div class="wq-toolbar-right">
        <span class="wq-result-info">共 ${s.total} 道错题</span>
        ${basketSize > 0 ? `<button class="wq-btn-accent" id="btn-toggle-right-m">练习篮 (${basketSize})</button>` : ''}
        <button class="wq-btn-icon" id="btn-toggle-right" title="练习篮">篮</button>
      </div>
    </section>`
  }

  function buildItemList(s) {
    if (s.viewMode === 'byChapter') return buildGroupedList(s, 'chapter_name', '章节')
    if (s.viewMode === 'byKnowledgePoint') return buildGroupedList(s, 'knowledge_point_name', '知识点')
    if (s.viewMode === 'compact') return buildCompactList(s)
    return buildCardList(s)
  }

  function buildCardList(s) {
    return `
    <section class="wq-card-list">
      ${s.items.map(item => buildWrongQuestionCard(s, item)).join('')}
    </section>`
  }

  function buildCompactList(s) {
    return `
    <section class="wq-compact-table">
      <div class="wq-table-header">
        <span class="wq-th wq-th-check"><input type="checkbox" id="cb-select-all-page" title="全选当前页"></span>
        <span class="wq-th wq-th-type">题型</span>
        <span class="wq-th wq-th-content">题目内容</span>
        <span class="wq-th wq-th-kp">知识点</span>
        <span class="wq-th wq-th-reason">错误原因</span>
        <span class="wq-th wq-th-status">状态</span>
        <span class="wq-th wq-th-actions">操作</span>
      </div>
      ${s.items.map(item => buildCompactRow(s, item)).join('')}
    </section>`
  }

  function buildCompactRow(s, item) {
    const inBasket = s.basket.has(String(item.wrong_question_id))
    const summary = (item.question_content || item.title || '').slice(0, 60)
    const reasonLabel = WRONG_REASONS[String(item.wrong_reason).toUpperCase()] || '未标注'
    const statusLabel = REVIEW_STATUSES[String(item.review_status).toUpperCase()] || '待复习'
    return `
    <div class="wq-table-row ${inBasket ? 'in-basket' : ''}" data-wq-id="${item.wrong_question_id}">
      <span class="wq-td wq-td-check">
        <input type="checkbox" class="cb-basket-item" data-wq-id="${item.wrong_question_id}" ${inBasket ? 'checked' : ''}>
      </span>
      <span class="wq-td wq-td-type">${questionTypeTagHtml(item.question_type)}</span>
      <span class="wq-td wq-td-content">
        <a class="wq-expand-link" data-action="expand" data-wq-id="${item.wrong_question_id}">${escapeHtml(summary)}${(item.question_content || '').length > 60 ? '...' : ''}</a>
      </span>
      <span class="wq-td wq-td-kp">${escapeHtml(item.knowledge_point_name || '-')}</span>
      <span class="wq-td wq-td-reason">${reasonLabel}</span>
      <span class="wq-td wq-td-status">${statusLabel}</span>
      <span class="wq-td wq-td-actions">
        <button class="wq-btn-mini" data-action="basket" data-wq-id="${item.wrong_question_id}">${inBasket ? '移除' : '入选'}</button>
      </span>
    </div>`
  }

  function buildGroupedList(s, groupField, groupLabel) {
    const groups = {}
    s.items.forEach(item => {
      const key = item[groupField] || '未分类'
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    })

    return `
    <section class="wq-grouped-list">
      ${Object.entries(groups).map(([key, items]) => `
        <div class="wq-group">
          <div class="wq-group-header">
            <span class="wq-group-title">${escapeHtml(key)}</span>
            <span class="wq-group-count">${items.length} 题</span>
          </div>
          ${items.map(item => buildWrongQuestionCard(s, item)).join('')}
        </div>
      `).join('')}
    </section>`
  }

  function buildWrongQuestionCard(s, item) {
    const mastered = item.review_status === 'mastered'
    const wrongAgain = item.review_status === 'wrong_again'
    const inBasket = s.basket.has(String(item.wrong_question_id))
    const expanded = s.expandedCards.has(String(item.wrong_question_id))
    const summary = (item.question_content || item.title || '暂无题目内容').slice(0, 100)
    const reasonLabel = WRONG_REASONS[String(item.wrong_reason).toUpperCase()] || ''
    const statusLabel = REVIEW_STATUSES[String(item.review_status).toUpperCase()] || ''

    return `
    <article class="wq-card ${mastered ? 'mastered' : ''} ${wrongAgain ? 'wrong-again' : ''} ${inBasket ? 'in-basket' : ''}"
      data-wq-id="${item.wrong_question_id}">
      <div class="wq-card-head" data-action="expand" data-wq-id="${item.wrong_question_id}">
        <div class="wq-card-check">
          <input type="checkbox" class="cb-basket-item" data-wq-id="${item.wrong_question_id}" ${inBasket ? 'checked' : ''} title="加入练习篮">
        </div>
        <div class="wq-card-tags">
          ${questionTypeTagHtml(item.question_type)}
          ${difficultyTagHtml(item.difficulty_level)}
          ${item.course_name ? `<span class="qtag subject-tag">${escapeHtml(item.course_name)}</span>` : ''}
          ${item.knowledge_point_name ? knowledgePointTagHtml(item.knowledge_point_name) : ''}
          ${item.tags && item.tags.length > 0 ? item.tags.map(t => `<span class="qtag" style="background:${t.color || '#6366f1'}20;color:${t.color || '#6366f1'};border:1px solid ${t.color || '#6366f1'}40">${escapeHtml(t.name)}</span>`).join('') : ''}
        </div>
        <p class="wq-card-summary">${escapeHtml(summary)}${(item.question_content || '').length > 100 ? '...' : ''}</p>
        <div class="wq-card-meta">
          ${reasonLabel ? `<span class="wq-reason-badge" title="错误原因">${reasonLabel}</span>` : ''}
          <span class="wq-status-badge ${item.review_status}">${statusLabel || '待复习'}</span>
          ${item.review_count > 0 ? `<span class="wq-meta-text">重做${item.review_count}次</span>` : ''}
          ${item.consecutive_correct_count > 0 ? `<span class="wq-meta-text success">连续对${item.consecutive_correct_count}次</span>` : ''}
          <span class="wq-meta-text">${formatRelativeTime(item.updated_at)}</span>
        </div>
        <span class="wq-card-expand-icon">${expanded ? '▲' : '▼'}</span>
      </div>

      ${expanded ? `
      <div class="wq-card-detail">
        <div class="wq-detail-grid">
          <div class="wq-detail-block">
            <b>题目内容</b>
            <p>${escapeHtml(item.question_content || item.title || '暂无')}</p>
          </div>
          ${item.options && item.options.length > 0 ? `
          <div class="wq-detail-block">
            <b>选项</b>
            <div class="wq-option-list">
              ${item.options.map(o => `
                <div class="wq-option-item">
                  <b>${escapeHtml(o.option_label || o.option_key || '')}</b>
                  <span>${escapeHtml(o.option_content || '')}</span>
                </div>
              `).join('')}
            </div>
          </div>` : ''}
          <div class="wq-detail-block">
            <b>正确答案</b>
            <p class="wq-answer-correct">${escapeHtml(formatPracticeAnswer(item.correct_answer))}</p>
          </div>
          ${item.answer_analysis ? `
          <div class="wq-detail-block">
            <b>解析</b>
            <p>${escapeHtml(item.answer_analysis)}</p>
          </div>` : ''}
        </div>

        <section class="lc-wq-repair"><div class="lc-section-head"><div><h2>错题修复卡</h2><p>基于本题真实错因、知识点与解析生成</p></div></div><div data-wq-repair-card="${item.wrong_question_id}"><div class="lc-empty"><b>正在准备修复卡</b><span>原题和相似练习不受影响。</span></div></div></section>

        <div class="wq-detail-actions-row">
          <div class="wq-detail-actions-left">
            <label class="wq-action-label">
              错误原因
              <select class="wq-select-xs" data-action="set-reason" data-wq-id="${item.wrong_question_id}">
                <option value="">未设置</option>
                ${Object.entries(WRONG_REASONS).map(([k, v]) => `<option value="${k.toLowerCase()}" ${item.wrong_reason === k.toLowerCase() ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </label>
            <label class="wq-action-label">
              学习状态
              <select class="wq-select-xs" data-action="set-status" data-wq-id="${item.wrong_question_id}">
                ${Object.entries(REVIEW_STATUSES).map(([k, v]) => `<option value="${k.toLowerCase()}" ${item.review_status === k.toLowerCase() ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </label>
            <button class="wq-btn-mini" data-action="add-tag" data-wq-id="${item.wrong_question_id}">+标签</button>
          </div>
          <div class="wq-detail-actions-right">
            <button class="wq-btn-sm" data-action="redo-original" data-wq-id="${item.wrong_question_id}">重做原题</button>
            <button type="button" class="wq-btn-sm primary" data-action="ai-variant" data-wq-id="${item.wrong_question_id}">AI变式</button>
            <div class="wq-similar-group">
              <span class="wq-similar-label">再做</span>
              <input class="wq-similar-count" id="similar-count-${item.wrong_question_id}" type="number" min="1" max="20" value="1" style="width:42px">
              <span class="wq-similar-label">题</span>
              <button type="button" class="wq-btn-sm accent" data-action="ai-similar" data-wq-id="${item.wrong_question_id}">相似题</button>
            </div>
          </div>
        </div>
      </div>` : ''}
    </article>`
  }

  function buildLoading() {
    return `<div class="complex-loading"><div class="complex-spinner"></div><p>正在加载...</p></div>`
  }

  function buildEmpty() {
    return `
    <div class="complex-empty">
      <h3>没有符合条件的错题</h3>
      <p>调整筛选条件或前往智能练习中心开始练习。</p>
      <button class="complex-btn" id="btn-go-practice">前往练习中心</button>
    </div>`
  }

  function buildPagination(s) {
    const totalPages = Math.ceil(s.total / s.pageSize)
    if (totalPages <= 1) return ''
    const pages = []
    for (let i = 1; i <= Math.min(totalPages, 7); i++) pages.push(i)

    return `
    <div class="wq-pagination">
      <button class="wq-btn-mini" data-page="${s.page - 1}" ${s.page <= 1 ? 'disabled' : ''}>上一页</button>
      ${pages.map(p => `<button class="wq-btn-mini ${p === s.page ? 'active' : ''}" data-page="${p}">${p}</button>`).join('')}
      ${totalPages > 7 ? `<span>...${totalPages}</span>` : ''}
      <button class="wq-btn-mini" data-page="${s.page + 1}" ${s.page >= totalPages ? 'disabled' : ''}>下一页</button>
      <span class="wq-page-info">${s.page}/${totalPages} 页</span>
    </div>`
  }

  // ========================
  // 右侧练习篮
  // ========================

  function buildRightBasket(s, basketItems) {
    const chapterIds = new Set(basketItems.map(item => item.chapter_id).filter(Boolean))
    const kpIds = new Set(basketItems.map(item => item.knowledge_point_id).filter(Boolean))

    return `
    <aside class="wq-sidebar wq-sidebar-right">
      <div class="wq-sidebar-header">
        <h3>练习篮</h3>
        <button class="wq-sidebar-toggle" id="btn-toggle-right" title="收起">▶</button>
      </div>
      <div class="wq-sidebar-scroll">
        <div class="wq-basket-stats">
          <div class="wq-basket-stat"><b>${basketItems.length}</b><span>已选题数</span></div>
          <div class="wq-basket-stat"><b>${chapterIds.size}</b><span>涉及章节</span></div>
          <div class="wq-basket-stat"><b>${kpIds.size}</b><span>涉及知识点</span></div>
        </div>

        <div class="wq-basket-mode">
          <b>练习模式</b>
          ${Object.entries(PRACTICE_MODES).map(([key, mode]) => `
            <label class="wq-radio-item ${s.practiceMode === key ? 'checked' : ''}">
              <input type="radio" name="practiceMode" value="${key}" ${s.practiceMode === key ? 'checked' : ''}>
              <span>${mode.icon} ${mode.label}</span>
              <small>${mode.desc}</small>
            </label>
          `).join('')}
        </div>

        ${s.practiceMode === 'AI_VARIANT' ? `
        <div class="wq-basket-mode">
          <b>难度设置</b>
          ${Object.entries(DIFFICULTY_MODES).map(([key, label]) => `
            <label class="wq-radio-item ${s.difficultyMode === key ? 'checked' : ''}">
              <input type="radio" name="difficultyMode" value="${key}" ${s.difficultyMode === key ? 'checked' : ''}>
              <span>${label}</span>
            </label>
          `).join('')}
        </div>` : ''}

        ${basketItems.length > 0 ? `
        <div class="wq-basket-list">
          <b>已选题目 (${basketItems.length})</b>
          ${basketItems.slice(0, 10).map(item => `
            <div class="wq-basket-item">
              <span class="wq-basket-item-text">${escapeHtml((item.question_content || item.title || '').slice(0, 40))}</span>
              <button class="wq-btn-mini-remove" data-action="remove-basket" data-wq-id="${item.wrong_question_id}">✕</button>
            </div>
          `).join('')}
          ${basketItems.length > 10 ? `<p class="wq-meta-text">...还有 ${basketItems.length - 10} 道</p>` : ''}
        </div>` : `<p class="wq-empty-hint">点击错题旁的复选框或"入选"按钮添加题目</p>`}

        <div class="wq-basket-actions">
          ${basketItems.length > 0 ? `
            <button class="wq-btn-sm" id="btn-save-collection">保存为系列</button>
            <button class="wq-btn-sm" id="btn-clear-basket">清空</button>
          ` : ''}
          <button type="button" class="wq-btn-primary wq-btn-block" id="btn-start-practice" ${basketItems.length === 0 ? 'disabled' : ''}>
            ${basketItems.length > 0 ? `开始练习 (${basketItems.length}题)` : '请先选择题目'}
          </button>
        </div>
      </div>
    </aside>`
  }

  // ========================
  // 弹窗
  // ========================

  function buildTagModal(s) {
    return `
    <div class="wq-modal" id="modal-tag" style="display:none">
      <div class="wq-modal-overlay" data-action="close-modal" data-modal="modal-tag"></div>
      <div class="wq-modal-content">
        <div class="wq-modal-header">
          <h3>管理标签</h3>
          <button class="wq-modal-close" data-action="close-modal" data-modal="modal-tag">✕</button>
        </div>
        <div class="wq-modal-body">
          <div class="wq-tag-create-row">
            <input class="complex-input" id="input-new-tag-name" placeholder="新标签名称" maxlength="50">
            <input class="complex-input" id="input-new-tag-color" placeholder="颜色 (#6366f1)" value="#6366f1" maxlength="20" style="width:120px">
            <button class="complex-btn" id="btn-create-tag">创建</button>
          </div>
          <div class="wq-tag-list" id="modal-tag-list">
            ${s.allTags.map(t => `
              <div class="wq-tag-item">
                <span class="wq-tag-dot" style="background:${t.color || '#6366f1'}"></span>
                <span>${escapeHtml(t.name)}</span>
                <span class="wq-meta-text">${t.wrong_question_count || 0} 题</span>
                <button class="wq-btn-mini-remove" data-action="delete-tag" data-tag-id="${t.tag_id}">删除</button>
              </div>
            `).join('')}
            ${s.allTags.length === 0 ? '<p class="wq-empty-hint">还没有标签，创建一个吧</p>' : ''}
          </div>
        </div>
      </div>
    </div>`
  }

  function buildCollectionModal(s) {
    return `
    <div class="wq-modal" id="modal-collection" style="display:none">
      <div class="wq-modal-overlay" data-action="close-modal" data-modal="modal-collection"></div>
      <div class="wq-modal-content">
        <div class="wq-modal-header">
          <h3>保存为错题系列</h3>
          <button class="wq-modal-close" data-action="close-modal" data-modal="modal-collection">✕</button>
        </div>
        <div class="wq-modal-body">
          <label>系列名称 <input class="complex-input" id="input-collection-name" placeholder="例如：第三章重点错题" maxlength="100"></label>
          <label>描述 <input class="complex-input" id="input-collection-desc" placeholder="可选描述" maxlength="1000"></label>
          <button class="complex-btn" id="btn-save-collection-confirm">保存 (${s.basket.size} 题)</button>
        </div>
      </div>
    </div>`
  }

  function buildAiProgressModal(s) {
    if (!s.aiJob) return ''
    const job = s.aiJob
    return `
    <div class="wq-modal" id="modal-ai-progress" style="display:flex">
      <div class="wq-modal-overlay"></div>
      <div class="wq-modal-content">
        <div class="wq-modal-header">
          <h3>AI 题目生成中...</h3>
          ${job.status === 'CANCELLED' || job.status === 'COMPLETED' || job.status === 'PARTIAL_SUCCESS' || job.status === 'FAILED' ? `<button class="wq-modal-close" id="btn-close-ai-modal">✕</button>` : ''}
        </div>
        <div class="wq-modal-body">
          <div class="wq-progress-bar">
            <div class="wq-progress-fill" style="width:${job.progress || 0}%"></div>
          </div>
          <div class="wq-progress-info">
            <p>状态: ${job.status}</p>
            <p>批次: ${job.current_batch || 0} / ${job.total_batches || 0}</p>
            <p>成功: ${job.success_count || 0} | 失败: ${job.fail_count || 0}</p>
            <p>目标: ${job.target_count || 0} 题</p>
          </div>
          ${job.status === 'GENERATING' || job.status === 'PENDING' ? `
            <button class="wq-btn-sm" id="btn-cancel-ai-job">取消生成</button>
          ` : ''}
          ${job.status === 'PARTIAL_SUCCESS' ? `
            <button class="wq-btn-sm primary" id="btn-use-ai-results">使用成功题目 (${job.success_count} 题)</button>
            <button class="wq-btn-sm" id="btn-retry-ai-job">重试失败部分</button>
          ` : ''}
          ${job.status === 'COMPLETED' ? `
            <button class="wq-btn-sm primary" id="btn-use-ai-results">使用全部题目 (${job.success_count} 题)</button>
          ` : ''}
          ${job.status === 'FAILED' ? `
            <p class="wq-error-text">${escapeHtml(job.error_message || '生成失败，请重试')}</p>
            <button class="wq-btn-sm" id="btn-retry-ai-job">重试</button>
          ` : ''}
        </div>
      </div>
    </div>`
  }

  function buildExpandedModals(s) {
    return '' // 展开细节直接在卡片内
  }

  // ========================
  // 事件绑定
  // ========================

  function bindEvents() {
    // 侧边栏切换
    document.getElementById('btn-toggle-left')?.addEventListener('click', () => {
      state.leftOpen = !state.leftOpen
      rerender()
    })
    document.getElementById('btn-toggle-right')?.addEventListener('click', () => {
      state.rightOpen = !state.rightOpen
      rerender()
    })
    // 移动端按钮
    document.getElementById('btn-toggle-left-m')?.addEventListener('click', () => {
      state.leftOpen = !state.leftOpen
      rerender()
    })
    document.getElementById('btn-toggle-right-m')?.addEventListener('click', () => {
      state.rightOpen = !state.rightOpen
      rerender()
    })

    // 导航点击
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', () => {
        const nav = el.dataset.nav
        const id = el.dataset.id
        if (nav === 'course') { state.courseId = id; state.chapterId = ''; state.knowledgePointId = '' }
        else if (nav === 'chapter') { state.chapterId = id; state.knowledgePointId = '' }
        else if (nav === 'kp') state.knowledgePointId = id
        else if (nav === 'wrongReason') state.wrongReason = id
        else if (nav === 'reviewStatus') state.reviewStatus = id
        else if (nav === 'questionType') state.questionType = id
        else if (nav === 'difficulty') state.difficulty = id
        else if (nav === 'tags') state.tags = id
        else if (nav === 'collectionId') state.collectionId = id
        state.page = 1
        loadAll()
      })
    })

    // 展开/折叠分区
    document.querySelectorAll('[data-action="expand-section"]').forEach(el => {
      el.addEventListener('click', () => {
        const sectionId = 'section-' + el.dataset.section
        const body = document.getElementById(sectionId)
        const arrow = el.querySelector('.wq-nav-arrow')
        if (body) {
          const hidden = body.style.display === 'none'
          body.style.display = hidden ? 'block' : 'none'
          if (arrow) arrow.textContent = hidden ? '▼' : '▶'
        }
      })
    })

    // 筛选 chips 清除
    document.querySelectorAll('[data-clear]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.clear
        if (key === 'courseId') { state.courseId = ''; state.chapterId = ''; state.knowledgePointId = '' }
        else if (key === 'wrongReason') state.wrongReason = ''
        else if (key === 'reviewStatus') state.reviewStatus = ''
        else if (key === 'questionType') state.questionType = ''
        else if (key === 'difficulty') state.difficulty = ''
        state.page = 1
        loadAll()
      })
    })
    document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
      state.courseId = ''; state.chapterId = ''; state.knowledgePointId = ''
      state.wrongReason = ''; state.reviewStatus = ''; state.questionType = ''
      state.difficulty = ''; state.tags = ''; state.collectionId = ''; state.search = ''
      state.page = 1
      loadAll()
    })

    // 搜索
    const searchInput = document.getElementById('wq-search')
    let searchTimer
    searchInput?.addEventListener('input', e => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => {
        state.search = e.target.value
        state.page = 1
        loadItems()
      }, 400)
    })

    // 排序
    document.getElementById('wq-sort')?.addEventListener('change', e => {
      state.sort = e.target.value
      state.page = 1
      loadItems()
    })

    // 视图切换
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', () => {
        state.viewMode = el.dataset.view
        rerender()
      })
    })

    // 全选当前页
    document.getElementById('cb-select-all-page')?.addEventListener('change', e => {
      const checked = e.target.checked
      document.querySelectorAll('.cb-basket-item').forEach(cb => {
        cb.checked = checked
        const wqId = cb.dataset.wqId
        if (checked) state.basket.add(wqId)
        else state.basket.delete(wqId)
      })
      rerender()
    })

    // 练习篮复选框
    document.querySelectorAll('.cb-basket-item').forEach(cb => {
      cb.addEventListener('change', e => {
        e.stopPropagation()
        const wqId = cb.dataset.wqId
        if (cb.checked) state.basket.add(wqId)
        else state.basket.delete(wqId)
        rerender()
      })
    })

    // 展开卡片
    document.querySelectorAll('[data-action="expand"]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        const wqId = el.dataset.wqId
        if (state.expandedCards.has(wqId)) state.expandedCards.delete(wqId)
        else state.expandedCards.add(wqId)
        rerender()
      })
    })

    // 练习篮入选/移除按钮
    document.querySelectorAll('[data-action="basket"]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        const wqId = el.dataset.wqId
        if (state.basket.has(wqId)) state.basket.delete(wqId)
        else state.basket.add(wqId)
        rerender()
      })
    })

    // 移除练习篮中的题目
    document.querySelectorAll('[data-action="remove-basket"]').forEach(el => {
      el.addEventListener('click', () => {
        state.basket.delete(el.dataset.wqId)
        rerender()
      })
    })

    // 错误原因选择
    document.querySelectorAll('[data-action="set-reason"]').forEach(el => {
      el.addEventListener('change', async e => {
        e.stopPropagation()
        const wqId = parseInt(el.dataset.wqId)
        const reason = e.target.value || null
        try {
          await updateWrongQuestion(wqId, { wrongReason: reason, wrongReasonSource: 'USER' })
          showToast('错误原因已更新', 'success')
          const item = state.items.find(i => String(i.wrong_question_id) === String(wqId))
          if (item) item.wrong_reason = reason
          rerender()
        } catch (err) {
          showToast(err.message || '更新失败', 'error')
        }
      })
    })

    // 学习状态选择
    document.querySelectorAll('[data-action="set-status"]').forEach(el => {
      el.addEventListener('change', async e => {
        e.stopPropagation()
        const wqId = parseInt(el.dataset.wqId)
        const status = e.target.value
        try {
          await updateWrongQuestion(wqId, { reviewStatus: status })
          showToast('学习状态已更新', 'success')
          const item = state.items.find(i => String(i.wrong_question_id) === String(wqId))
          if (item) item.review_status = status
          rerender()
        } catch (err) {
          showToast(err.message || '更新失败', 'error')
        }
      })
    })

    // 添加标签按钮
    document.querySelectorAll('[data-action="add-tag"]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        const modal = document.getElementById('modal-tag')
        if (modal) modal.style.display = 'flex'
        modal._wqId = el.dataset.wqId
      })
    })

    // 重做原题
    document.querySelectorAll('[data-action="redo-original"]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        state.basket.add(el.dataset.wqId)
        state.practiceMode = 'ORIGINAL_ORDER'
        startPractice()
      })
    })

    // AI 变式
    document.querySelectorAll('[data-action="ai-variant"]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        if (state.isGenerating) return
        state.basket.add(el.dataset.wqId)
        state.practiceMode = 'AI_VARIANT'
        startAiGeneration()
      })
    })

    // AI 相似题
    document.querySelectorAll('[data-action="ai-similar"]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation()
        if (state.isGenerating) return
        const wqId = el.dataset.wqId
        const countInput = document.getElementById('similar-count-' + wqId)
        const count = Math.max(1, Math.min(20, parseInt(countInput?.value) || 1))
        startSimilarPracticeDirect(wqId, count)
      })
    })

    // 练习模式切换
    document.querySelectorAll('input[name="practiceMode"]').forEach(el => {
      el.addEventListener('change', e => {
        state.practiceMode = e.target.value
        rerender()
      })
    })

    // 难度模式切换
    document.querySelectorAll('input[name="difficultyMode"]').forEach(el => {
      el.addEventListener('change', e => {
        state.difficultyMode = e.target.value
      })
    })

    // 开始练习
    document.getElementById('btn-start-practice')?.addEventListener('click', () => {
      if (state.isGenerating || state.isCreatingPractice) return
      if (state.basket.size === 0) return
      if (state.practiceMode === 'AI_VARIANT' || state.practiceMode === 'AI_SIMILAR') {
        startAiGeneration()
      } else {
        startPractice()
      }
    })

    // 清空练习篮
    document.getElementById('btn-clear-basket')?.addEventListener('click', () => {
      state.basket.clear()
      rerender()
    })

    // 保存系列
    document.getElementById('btn-save-collection')?.addEventListener('click', () => {
      document.getElementById('modal-collection').style.display = 'flex'
    })

    // 弹窗关闭
    document.querySelectorAll('[data-action="close-modal"]').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById(el.dataset.modal).style.display = 'none'
      })
    })

    // 创建标签
    document.getElementById('btn-create-tag')?.addEventListener('click', async () => {
      const name = document.getElementById('input-new-tag-name').value.trim()
      const color = document.getElementById('input-new-tag-color').value.trim()
      if (!name) { showToast('请输入标签名称', 'warning'); return }
      try {
        await createWrongQuestionTag({ name, color: color || '#6366f1' })
        showToast('标签创建成功', 'success')
        await loadTags()
        document.getElementById('input-new-tag-name').value = ''
      } catch (err) {
        showToast(err.message || '创建失败', 'error')
      }
    })

    // 删除标签
    document.querySelectorAll('[data-action="delete-tag"]').forEach(el => {
      el.addEventListener('click', async () => {
        const tagId = parseInt(el.dataset.tagId)
        try {
          await deleteWrongQuestionTag(tagId)
          showToast('标签已删除', 'success')
          await loadTags()
        } catch (err) {
          showToast(err.message || '删除失败', 'error')
        }
      })
    })

    // 保存系列确认
    document.getElementById('btn-save-collection-confirm')?.addEventListener('click', async () => {
      const name = document.getElementById('input-collection-name').value.trim()
      if (!name) { showToast('请输入系列名称', 'warning'); return }
      const description = document.getElementById('input-collection-desc').value.trim()
      try {
        await createWrongQuestionCollection({
          name,
          description,
          wrongQuestionIds: [...state.basket].map(Number),
        })
        showToast('错题系列已保存', 'success')
        document.getElementById('modal-collection').style.display = 'none'
        await loadCollections()
      } catch (err) {
        showToast(err.message || '保存失败', 'error')
      }
    })

    // 其他按钮
    document.getElementById('btn-retry')?.addEventListener('click', loadItems)
    document.getElementById('btn-go-practice')?.addEventListener('click', () => {
      window.location.hash = '#/student/practice'
    })

    // AI 进度弹窗操作
    document.getElementById('btn-cancel-ai-job')?.addEventListener('click', cancelAiJob)
    document.getElementById('btn-retry-ai-job')?.addEventListener('click', retryAiJob)
    document.getElementById('btn-use-ai-results')?.addEventListener('click', useAiResults)
    document.getElementById('btn-close-ai-modal')?.addEventListener('click', () => {
      stopAiPolling()
      state.aiJob = null
      rerender()
    })

    // 分页
    document.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', () => {
        if (el.disabled) return
        state.page = parseInt(el.dataset.page)
        loadItems()
      })
    })
  }

  // ========================
  // 练习发起
  // ========================

  async function startPractice() {
    if (state.isCreatingPractice || state.isGenerating) return
    const wqIds = [...state.basket].map(Number)
    if (wqIds.length === 0) { showToast('请先选择题目', 'warning'); return }

    state.isCreatingPractice = true
    const btnStart = document.getElementById('btn-start-practice')
    if (btnStart) { btnStart.disabled = true; btnStart.textContent = '正在创建练习...' }

    try {
      const result = await startWrongQuestionPractice({
        wrongQuestionIds: wqIds,
        practiceMode: state.practiceMode,
        answerMode: 'SINGLE',
      })
      const startData = result.data || {}
      const sessionId = startData.session?.practice_session_id
      if (!sessionId) throw new Error('练习会话创建失败')

      const firstItem = state.items.find(i => String(i.wrong_question_id) === String(wqIds[0]))
      savePracticeSessionSnapshot(sessionId, {
        session: startData.session,
        questions: startData.questions || [],
        subject: firstItem
          ? { course_id: firstItem.course_id, course_name: firstItem.course_name, classes: [] }
          : {},
        config: {
          subjectId: firstItem?.course_id,
          questionTypes: [...new Set(wqIds.map(id => state.items.find(i => String(i.wrong_question_id) === String(id))?.question_type).filter(Boolean))],
          difficulty: 'medium',
          questionCount: wqIds.length,
          sessionMode: 'practice',
          answerMode: 'single',
          sourceType: 'WRONG_QUESTION_PRACTICE',
          practiceMode: state.practiceMode,
        },
        answers: {},
        currentIndex: 0,
        submitted: false,
        result: null,
        aiChats: {},
        startedAtMs: Date.now(),
        practice_session_id: sessionId,
      })
      showToast('错题练习已创建', 'success')
      window.location.hash = `#/student/practice/sessions/${sessionId}`
    } catch (err) {
      console.error('[错题练习] 请求失败', { message: err.message, code: err.code, wqCount: wqIds.length })
      showToast(err.message || '创建练习失败', 'error')
      if (btnStart) { btnStart.disabled = false; btnStart.textContent = `开始练习 (${wqIds.length}题)` }
    } finally {
      state.isCreatingPractice = false
    }
  }

  async function startSimilarPracticeDirect(wqId, count) {
    if (state.isGenerating) return
    const item = state.items.find(i => String(i.wrong_question_id) === String(wqId))
    if (!item || !item.course_id) { showToast('缺少课程信息', 'warning'); return }

    const btn = document.querySelector(`[data-action="ai-similar"][data-wq-id="${wqId}"]`)
    if (btn) { btn.disabled = true; btn.textContent = '生成中...' }
    state.isGenerating = true

    try {
      const result = await startSimilarPractice(wqId, { questionCount: count })
      const startData = result.data || {}
      const sessionId = startData.session?.practice_session_id
      if (!sessionId) throw new Error('练习会话创建失败')

      savePracticeSessionSnapshot(sessionId, {
        session: startData.session,
        questions: startData.questions || [],
        generated_count: startData.generated_count || 0,
        warning: startData.warning || null,
        subject: { course_id: item.course_id, course_name: item.course_name, classes: [] },
        config: {
          subjectId: item.course_id,
          questionTypes: [item.question_type],
          difficulty: item.difficulty_level || 'medium',
          questionCount: count,
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
      showToast(`已生成 ${count} 道相似题`, 'success')
      window.location.hash = `#/student/practice/sessions/${sessionId}`
    } catch (err) {
      console.error('[相似题] 请求失败', {
        message: err.message,
        code: err.code,
        wqId,
        count,
      })
      showToast(err.message || '生成失败', 'error')
      if (btn) { btn.disabled = false; btn.textContent = '相似题' }
    } finally {
      state.isGenerating = false
    }
  }

  async function startAiGeneration() {
    if (state.isGenerating) return
    const wqIds = [...state.basket].map(Number)
    if (wqIds.length === 0) { showToast('请先选择题目', 'warning'); return }

    const items = wqIds.map(id => state.items.find(i => String(i.wrong_question_id) === String(id))).filter(Boolean)
    if (items.length === 0) { showToast('错题数据异常', 'error'); return }

    state.isGenerating = true
    const btnStart = document.getElementById('btn-start-practice')
    if (btnStart) { btnStart.disabled = true; btnStart.textContent = '正在创建AI任务...' }

    try {
      const result = await createAiGenerationJob({
        mode: state.practiceMode === 'AI_VARIANT' ? 'VARIANT' : 'SIMILAR',
        sourceQuestions: items.map(item => ({
          wrong_question_id: item.wrong_question_id,
          question_id: item.question_id,
          question_type: item.question_type,
          content: item.question_content,
          options: item.options,
          correct_answer: item.correct_answer,
          knowledge_point_name: item.knowledge_point_name,
          difficulty_level: item.difficulty_level,
        })),
        count: state.practiceMode === 'AI_SIMILAR' ? items.length * state.similarCount : items.length,
        difficulty: state.difficultyMode,
      })

      state.aiJob = result.data || {}
      rerender()
      startAiPolling(state.aiJob.job_id)
    } catch (err) {
      console.error('[AI出题] 请求失败', {
        message: err.message,
        code: err.code,
        mode: state.practiceMode === 'AI_VARIANT' ? 'VARIANT' : 'SIMILAR',
        sourceCount: items.length,
      })
      showToast(err.message || 'AI 生成任务创建失败', 'error')
      if (btnStart) { btnStart.disabled = false; btnStart.textContent = `开始练习 (${wqIds.length}题)` }
    } finally {
      state.isGenerating = false
    }
  }

  function startAiPolling(jobId) {
    stopAiPolling()
    state.aiJobPolling = setInterval(async () => {
      try {
        const result = await getAiGenerationJob(jobId)
        state.aiJob = result.data || {}
        rerender()

        const status = state.aiJob.status
        if (['COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
          stopAiPolling()
        }
      } catch (err) {
        console.error('AI job polling error:', err)
      }
    }, 1500)
  }

  function stopAiPolling() {
    if (state.aiJobPolling) {
      clearInterval(state.aiJobPolling)
      state.aiJobPolling = null
    }
  }

  async function cancelAiJob() {
    if (!state.aiJob?.job_id) return
    try {
      await cancelAiGenerationJob(state.aiJob.job_id)
      stopAiPolling()
      state.aiJob = null
      rerender()
      showToast('AI 生成已取消', 'info')
    } catch (err) {
      showToast(err.message || '取消失败', 'error')
    }
  }

  async function retryAiJob() {
    if (!state.aiJob?.job_id) return
    try {
      await import('../api/student.js').then(m => m.retryAiGenerationJob(state.aiJob.job_id))
      startAiPolling(state.aiJob.job_id)
      showToast('重试已启动', 'info')
    } catch (err) {
      showToast(err.message || '重试失败', 'error')
    }
  }

  function useAiResults() {
    stopAiPolling()
    state.aiJob = null
    rerender()
    showToast('AI 题目已保存，请从练习篮发起练习', 'info')
  }

  // ========================
  // 启动
  // ========================

  await loadAll()
}
