// 学生端 — 课程详情页面 v2
// 新增：知识点排序、搜索、筛选

import { getMe } from '../api/auth.js'
import { getStudentCourseDetail, getStudentCourseChapters, getStudentCourseKnowledgePoints } from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, masteryLabel, difficultyLabel } from '../utils/format.js'
import { disposeAllCharts, bindResize, initChart, renderRingChart, renderHorizontalBarChart, CHART_COLORS } from '../utils/echarts.js'
import * as echarts from 'echarts'
import { buildMindData, createMindMap, getKnowledgeStatus } from '../components/kgraph/KgMindMap.js'
import { buildVideoPanelHTML, loadKpVideosToPanel } from '../components/kgraph/KgVideoPanel.js'

function getCourseIdFromHash() {
  const m = window.location.hash.slice(1).match(/^\/student\/courses\/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function sortKPs(kps, sortBy) {
  const s = [...kps]
  switch (sortBy) {
    case 'score-asc': return s.sort((a, b) => (a.mastery_score || 0) - (b.mastery_score || 0))
    case 'score-desc': return s.sort((a, b) => (b.mastery_score || 0) - (a.mastery_score || 0))
    case 'name': return s.sort((a, b) => (a.knowledge_point_name || '').localeCompare(b.knowledge_point_name || ''))
    case 'difficulty': return s.sort((a, b) => (a.difficulty_level || '').localeCompare(b.difficulty_level || ''))
    case 'recent': return s.sort((a, b) => new Date(b.last_study_at || 0) - new Date(a.last_study_at || 0))
    default: return s.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }
}

function renderDetailCharts(kps) {
  bindResize()
  if (!kps || kps.length === 0) return
  const lc = { excellent: 0, good: 0, general: 0, weak: 0 }
  kps.forEach(k => { const l = k.mastery_level || 'weak'; if (lc[l] !== undefined) lc[l]++ })
  const rd = [{ name: '优秀', value: lc.excellent, itemStyle: { color: '#4CAF84' } }, { name: '良好', value: lc.good, itemStyle: { color: CHART_COLORS.primary } }, { name: '一般', value: lc.general, itemStyle: { color: CHART_COLORS.warm } }, { name: '薄弱', value: lc.weak, itemStyle: { color: CHART_COLORS.softRed } }].filter(d => d.value > 0)
  if (rd.length === 0) rd.push({ name: '暂无数据', value: 1, itemStyle: { color: '#E2E8F0' } })
  renderRingChart('chart-detail-mastery-ring', rd, '掌握等级分布')
  const sorted = [...kps].sort((a, b) => (a.mastery_score || 0) - (b.mastery_score || 0))
  renderHorizontalBarChart('chart-detail-kp-bar', sorted.map(k => k.knowledge_point_name), sorted.map(k => k.mastery_score || 0), '知识点掌握度详情')
}

function renderHeroProgress(course) {
  const dom = document.getElementById('chart-hero-progress')
  if (!dom) return
  const inst = echarts.init(dom)
  const progress = Math.max(0, Math.min(100, Number(course.learning_progress || 0)))
  inst.setOption({ series: [{ type: 'pie', radius: ['70%', '88%'], center: ['50%', '50%'], silent: true, label: { show: true, position: 'center', fontSize: 22, fontWeight: 'bold', color: '#fff', formatter: `${progress}%` }, data: [{ value: progress, itemStyle: { color: 'rgba(255,255,255,0.9)', borderRadius: 6 } }, { value: Math.max(0, 100 - progress), itemStyle: { color: 'rgba(255,255,255,0.15)' } }] }] })
}

function buildKpCard(kp) {
  return `<div class="kp-list-card" data-kp-id="${kp.knowledge_point_id}" data-mastery="${kp.mastery_level || 'unknown'}" data-name="${escapeHtml(kp.knowledge_point_name)}"><div style="flex:1;min-width:0;"><div style="font-weight:600;color:var(--text-main);margin-bottom:4px;">${escapeHtml(kp.knowledge_point_name)}</div><div style="font-size:0.8rem;color:var(--text-sub);">${escapeHtml(kp.chapter_name || '')} · ${difficultyLabel(kp.difficulty_level)} · ${escapeHtml(kp.knowledge_point_code)}</div></div><div style="text-align:center;flex-shrink:0;"><div style="font-size:1.3rem;font-weight:700;color:var(--stu-primary);">${kp.mastery_score || 0}</div><span class="kp-pill mastery-${kp.mastery_level || 'unknown'}" style="font-size:0.72rem;">${masteryLabel(kp.mastery_level)}</span></div><div style="font-size:0.75rem;color:var(--text-hint);flex-shrink:0;">${kp.last_study_at ? formatDate(kp.last_study_at, 'date') : '未学习'}</div></div>`
}

const KG_STATUS_LABELS = {
  mastered: '已掌握',
  learning: '学习中',
  unstarted: '未学习',
  weak: '薄弱',
}

function sortByCourseOrder(list) {
  return [...(list || [])].sort((a, b) => {
    const orderA = Number(a?.sort_order ?? a?.chapter_order ?? 0)
    const orderB = Number(b?.sort_order ?? b?.chapter_order ?? 0)
    if (orderA !== orderB) return orderA - orderB
    return Number(a?.chapter_id ?? a?.knowledge_point_id ?? 0) - Number(b?.chapter_id ?? b?.knowledge_point_id ?? 0)
  })
}

function buildChaptersWithKps(chapters, kps) {
  const chapterMap = new Map()
  const sortedChapters = sortByCourseOrder(chapters)

  sortedChapters.forEach((ch) => {
    chapterMap.set(String(ch.chapter_id), { ...ch, kps: [], _seenKps: new Set() })
  })

  sortByCourseOrder(kps).forEach((kp) => {
    const chapterKey = kp.chapter_id == null ? 'uncategorized' : String(kp.chapter_id)
    if (!chapterMap.has(chapterKey)) {
      chapterMap.set(chapterKey, {
        chapter_id: kp.chapter_id || 'uncategorized',
        chapter_name: kp.chapter_name || '未归属章节',
        sort_order: 9999,
        knowledge_point_count: 0,
        kps: [],
        _seenKps: new Set(),
      })
    }
    const chapter = chapterMap.get(chapterKey)
    const kpKey = String(kp.knowledge_point_id)
    if (!chapter._seenKps.has(kpKey)) {
      chapter.kps.push(kp)
      chapter._seenKps.add(kpKey)
    }
  })

  return [...chapterMap.values()].map((chapter) => {
    const { _seenKps, ...rest } = chapter
    return { ...rest, kps: sortByCourseOrder(rest.kps) }
  })
}

function buildVideoContextHTML(course) {
  return `
    <div class="course-video-context-kicker">当前学习对象</div>
    <div class="course-video-context-title" title="${escapeHtml(course.course_name)}">${escapeHtml(course.course_name)}</div>
    <div class="course-video-context-meta"><span>课程整体</span><span>${Math.max(0, Math.min(100, Number(course.learning_progress || 0)))}%</span></div>`
}

function buildKgControls() {
  return [
    ['zoom-in', '+', '放大'],
    ['zoom-out', '-', '缩小'],
    ['fit', '适', '适应画布'],
    ['root', '根', '返回课程根节点'],
    ['expand', '展', '全部展开'],
    ['collapse', '收', '全部收起'],
  ].map(([action, label, title]) => `<button type="button" class="kg-control-btn" data-kg-action="${action}" title="${title}" aria-label="${title}">${label}</button>`).join('')
}

function buildStatusLegend() {
  return `
    <span><i class="legend-dot status-mastered"></i>已掌握</span>
    <span><i class="legend-dot status-learning"></i>学习中</span>
    <span><i class="legend-dot status-unstarted"></i>未学习</span>
    <span><i class="legend-dot status-weak"></i>薄弱</span>`
}

function buildQuickKpButtons(kps) {
  return sortByCourseOrder(kps).map((kp) => {
    const status = getKnowledgeStatus(kp)
    return `<button type="button" class="kg-quick-kp" data-kp-id="${kp.knowledge_point_id}" data-status="${status}" title="${escapeHtml(kp.chapter_name || '')} · ${escapeHtml(kp.knowledge_point_name)}">${escapeHtml(kp.knowledge_point_name)}</button>`
  }).join('')
}

function getKpStatusLabel(kp) {
  return KG_STATUS_LABELS[getKnowledgeStatus(kp)] || masteryLabel(kp?.mastery_level)
}

function setSearchButtonLoading(button, loading) {
  if (!button) return
  button.disabled = loading
  button.textContent = loading ? '搜索中' : '搜索'
}

function buildSelectionContext(course, kps, selection = {}) {
  const kpId = selection.kpId || selection.knowledgePointId
  const kp = kpId ? kps.find((item) => String(item.knowledge_point_id) === String(kpId)) : null
  return {
    courseName: course.course_name,
    chapterName: selection.chapterName || kp?.chapter_name || '',
    knowledgePointName: selection.knowledgePointName || kp?.knowledge_point_name || '',
    statusLabel: kp ? getKpStatusLabel(kp) : (selection.type === 'chapter' ? '章节' : '课程整体'),
  }
}

function toAiKpSummary(kp) {
  return {
    knowledge_point_id: kp.knowledge_point_id,
    knowledge_point_name: kp.knowledge_point_name,
    chapter_name: kp.chapter_name || '',
    mastery_level: kp.mastery_level || 'unknown',
    mastery_score: kp.mastery_score ?? 0,
    status: getKnowledgeStatus(kp),
  }
}

function setCourseAiContext(course, kps, selection = {}) {
  if (typeof window === 'undefined') return
  const weakKnowledgePoints = kps
    .filter(kp => getKnowledgeStatus(kp) === 'weak' || String(kp.mastery_level || '').toLowerCase() === 'weak')
    .sort((a, b) => (a.mastery_score || 0) - (b.mastery_score || 0))
    .map(toAiKpSummary)
  const masteredKnowledgePoints = kps
    .filter(kp => getKnowledgeStatus(kp) === 'mastered')
    .sort((a, b) => (b.mastery_score || 0) - (a.mastery_score || 0))
    .map(toAiKpSummary)
  const learningKnowledgePoints = kps
    .filter(kp => getKnowledgeStatus(kp) === 'learning')
    .map(toAiKpSummary)
  const unstartedKnowledgePoints = kps
    .filter(kp => getKnowledgeStatus(kp) === 'unstarted')
    .map(toAiKpSummary)
  const currentKpId = selection.kpId || selection.knowledgePointId
  const currentKnowledgePoint = currentKpId
    ? kps.find(kp => String(kp.knowledge_point_id) === String(currentKpId))
    : null

  window.__discimindStudentPageContext = {
    type: 'courseDetail',
    page: 'student-course-detail',
    course: {
      course_id: course.course_id,
      course_name: course.course_name,
      course_code: course.course_code,
      learning_progress: course.learning_progress || 0,
      chapter_count: course.chapter_count || 0,
      knowledge_point_count: course.knowledge_point_count || kps.length,
    },
    selection: {
      type: selection.type || 'course',
      chapter_id: selection.chapterId || null,
      chapter_name: selection.chapterName || '',
      knowledge_point_id: currentKpId || null,
      knowledge_point_name: selection.knowledgePointName || currentKnowledgePoint?.knowledge_point_name || '',
    },
    currentKnowledgePoint: currentKnowledgePoint ? toAiKpSummary(currentKnowledgePoint) : null,
    weakKnowledgePoints,
    masteredKnowledgePoints,
    learningKnowledgePoints,
    unstartedKnowledgePoints,
    masterySummary: {
      total: kps.length,
      weak: weakKnowledgePoints.length,
      mastered: masteredKnowledgePoints.length,
      learning: learningKnowledgePoints.length,
      unstarted: unstartedKnowledgePoints.length,
    },
  }
}

function buildKnowledgeGraphSection(course, chapters, kps) {
  if ((!chapters || chapters.length === 0) && (!kps || kps.length === 0)) {
    return `
      <section class="course-kg-section" id="course-kg-section">
        <div class="course-kg-header">
          <div><h3>知识图谱与视频讲解</h3><p>当前课程暂无章节与知识点数据</p></div>
        </div>
        <div class="empty-state"><div class="empty-title">该课程暂未配置知识图谱</div><div class="empty-desc">教师录入章节和知识点后，这里会展示课程学习树。</div></div>
      </section>`
  }

  const quickKpButtons = buildQuickKpButtons(kps)

  return `
    <section class="course-kg-section" id="course-kg-section">
      <div class="course-kg-header">
        <div>
          <h3>知识图谱与视频讲解</h3>
          <p>${escapeHtml(course.course_name)} · ${chapters.length} 个章节 · ${kps.length} 个知识点</p>
        </div>
        <div class="course-kg-legend">
          ${buildStatusLegend()}
        </div>
      </div>
      <div class="course-kg-layout">
        <div class="course-kg-map-wrap">
          <div class="course-kg-map-head">
            <div class="kg-quick-strip" aria-label="快速定位知识点">
              ${quickKpButtons || '<span class="kg-quick-empty">暂无知识点</span>'}
            </div>
            <div class="course-kg-controls" aria-label="图谱工具栏">${buildKgControls()}</div>
          </div>
          <div id="course-kg-mind-container" class="course-kg-mind"></div>
          <div id="course-kg-error" class="course-kg-error" style="display:none;"></div>
        </div>
        <div class="course-kg-video-wrap">
          <div id="course-video-context" class="course-video-context">${buildVideoContextHTML(course)}</div>
          <div class="course-video-search">
            <input id="course-video-keyword" type="text" value="${escapeHtml(course.course_name)}" placeholder="搜索课程、章节或知识点视频" />
            <button id="btn-course-video-search" type="button">搜索</button>
          </div>
          <div class="course-video-keyword" id="course-video-keyword-hint">自动关键词：${escapeHtml(course.course_name)}</div>
          ${buildVideoPanelHTML()}
        </div>
      </div>
    </section>`
}

function initCourseKnowledgeGraph(course, chapters, kps) {
  const section = document.getElementById('course-kg-section')
  if (!section || ((!chapters || chapters.length === 0) && (!kps || kps.length === 0))) return

  const mindContainer = document.getElementById('course-kg-mind-container')
  const errorBox = document.getElementById('course-kg-error')
  const keywordInput = document.getElementById('course-video-keyword')
  const keywordHint = document.getElementById('course-video-keyword-hint')
  const searchButton = document.getElementById('btn-course-video-search')
  const videoCache = {}
  let currentSelection = {
    type: 'course',
    courseId: course.course_id,
    courseName: course.course_name,
    keyword: course.course_name,
  }
  let mindController = null
  let videoRequestSeq = 0
  setCourseAiContext(course, kps, currentSelection)

  function setKeyword(keyword) {
    const value = String(keyword || '').replace(/\s+/g, ' ').trim() || course.course_name
    if (keywordInput) keywordInput.value = value
    if (keywordHint) keywordHint.textContent = `自动关键词：${value}`
    return value
  }

  async function searchByKeyword(keyword, selection = currentSelection) {
    const requestId = ++videoRequestSeq
    const value = setKeyword(keyword)
    if (!value) return
    const nodeKey = selection.kpId || selection.knowledgePointId || selection.chapterId || selection.courseId || 'course'
    const cacheKey = `${course.course_id}:${selection.type || 'manual'}:${nodeKey}:${value}`
    setSearchButtonLoading(searchButton, true)
    await loadKpVideosToPanel(cacheKey, value, section, videoCache, {
      courseId: course.course_id,
      knowledgePointId: selection.kpId || selection.knowledgePointId || null,
      context: buildSelectionContext(course, kps, selection),
      limit: 10,
      isCurrent: () => requestId === videoRequestSeq,
    })
    if (requestId === videoRequestSeq) setSearchButtonLoading(searchButton, false)
  }

  function setActiveQuickKp(kpId) {
    section.querySelectorAll('.kg-quick-kp').forEach((btn) => {
      btn.classList.toggle('active', String(btn.dataset.kpId) === String(kpId))
    })
  }

  function handleSelection(selection) {
    currentSelection = {
      ...selection,
      courseId: course.course_id,
      courseName: course.course_name,
    }
    if (selection.type === 'knowledgePoint') {
      setActiveQuickKp(selection.kpId || selection.knowledgePointId)
    } else {
      setActiveQuickKp(null)
    }
    setCourseAiContext(course, kps, currentSelection)
    searchByKeyword(selection.shortKeyword || selection.keyword || course.course_name, currentSelection)
  }

  try {
    const chaptersWithKps = buildChaptersWithKps(chapters, kps)
    const mindData = buildMindData(course, chaptersWithKps)
    if (window.__discimindKgCleanup) window.__discimindKgCleanup()
    mindController = createMindMap(mindContainer, mindData, kps, handleSelection)
    const resizeHandler = () => mindController?.fit()
    window.addEventListener('resize', resizeHandler)
    window.__discimindKgCleanup = () => {
      window.removeEventListener('resize', resizeHandler)
      mindController?.dispose?.()
    }
  } catch (err) {
    if (mindContainer) mindContainer.style.display = 'none'
    if (errorBox) {
      errorBox.style.display = ''
      errorBox.innerHTML = `<b>知识图谱加载失败</b><span>${escapeHtml(err.message || String(err))}</span><button type="button" onclick="window.location.reload()">重新加载</button>`
    }
  }

  searchButton?.addEventListener('click', () => {
    searchByKeyword(keywordInput?.value || course.course_name, { ...currentSelection, type: currentSelection.type || 'manual' })
  })
  keywordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchByKeyword(keywordInput.value, { ...currentSelection, type: currentSelection.type || 'manual' })
  })
  section.querySelectorAll('.kg-quick-kp').forEach(btn => {
    btn.addEventListener('click', () => {
      mindController?.selectKnowledgePoint(btn.dataset.kpId)
    })
  })
  section.querySelectorAll('[data-kg-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.kgAction
      if (action === 'zoom-in') mindController?.zoomIn()
      if (action === 'zoom-out') mindController?.zoomOut()
      if (action === 'fit') mindController?.fit()
      if (action === 'root') mindController?.centerRoot()
      if (action === 'expand') mindController?.expandAll()
      if (action === 'collapse') mindController?.collapseAll()
    })
  })

  setTimeout(() => {
    mindController?.selectRoot?.()
  }, 120)
}

// ========================
// 主渲染
// ========================

export async function renderStudentCourseDetail(app) {
  disposeAllCharts()
  const courseId = getCourseIdFromHash()
  if (!courseId) { window.location.hash = '#/student/courses'; return }

  let user = getUser()
  try { const r = await getMe(); user = r.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }

  const menuItems = STUDENT_MENU_ITEMS

  // Loading
  renderDashboardLayout(app, { menuItems, contentHTML: `<div style="margin-bottom:20px;"><button class="btn-back" onclick="window.location.hash='#/student/courses'">← 返回我的课程</button></div><div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在加载课程详情...</p></div>`, user })

  let course = null, chapters = [], kps = [], loadError = false
  try {
    const [cr, chr, kr] = await Promise.all([getStudentCourseDetail(courseId), getStudentCourseChapters(courseId), getStudentCourseKnowledgePoints(courseId)])
    course = cr.data; chapters = chr.data?.list || []; kps = kr.data?.list || []
  } catch (e) { loadError = true }

  let contentHTML
  if (loadError || !course) {
    contentHTML = `<div style="margin-bottom:20px;"><button class="btn-back" onclick="window.location.hash='#/student/courses'">← 返回我的课程</button></div><div class="error-state"><div class="error-icon">😞</div><p class="error-message">课程详情加载失败</p><button class="btn-retry" onclick="window.location.reload()">重新加载</button></div>`
  } else {
    const teachers = (course.teacher_list || []).map(t => t.real_name).join('、')
    const className = course.teaching_class?.teaching_class_name || '-'
    const mastered = kps.filter(k => k.mastery_level === 'good' || k.mastery_level === 'excellent').length
    const weak = kps.filter(k => k.mastery_level === 'weak').length

    const progress = Math.max(0, Math.min(100, Number(course.learning_progress || 0)))
    const lastPositionText = course.last_position
      ? `${escapeHtml(course.last_position)}${course.last_study_at ? ' · ' + formatDate(course.last_study_at, 'short') : ''}`
      : '尚未开始'

    contentHTML = `
      <div style="margin-bottom:20px;"><button class="btn-back" onclick="window.location.hash='#/student/courses'">← 返回我的课程</button></div>
      <div class="course-hero-card"><div class="hero-inner"><div class="hero-info"><div class="hero-course-name">${escapeHtml(course.course_name)}</div><div class="hero-course-code">${escapeHtml(course.course_code)} · ${escapeHtml(course.subject_category || '')}</div><div class="hero-desc">${escapeHtml(course.description || '')}</div><div class="hero-meta-tags"><span class="hero-tag">🏫 ${escapeHtml(className)}</span>${teachers ? `<span class="hero-tag">👨‍🏫 ${escapeHtml(teachers)}</span>` : ''}<span class="hero-tag">📖 ${course.chapter_count || 0} 个章节</span><span class="hero-tag">🎯 ${course.knowledge_point_count || 0} 个知识点</span><span class="hero-tag">📍 ${lastPositionText}</span></div></div><div class="hero-chart-area" id="chart-hero-progress"></div></div></div>
      <div class="course-metrics-row"><div class="course-metric-card"><div class="metric-value">${progress}%</div><div class="metric-label">学习进度</div></div><div class="course-metric-card"><div class="metric-value">${course.chapter_count || 0}</div><div class="metric-label">章节数</div></div><div class="course-metric-card"><div class="metric-value">${course.knowledge_point_count || 0}</div><div class="metric-label">知识点数</div></div><div class="course-metric-card"><div class="metric-value" style="color:#4CAF84;">${mastered}</div><div class="metric-label">已掌握</div></div><div class="course-metric-card"><div class="metric-value" style="color:#E0576E;">${weak}</div><div class="metric-label">薄弱</div></div><div class="course-metric-card"><div class="metric-value">${course.video_count || 0}</div><div class="metric-label">课程视频</div></div><div class="course-metric-card"><div class="metric-value">${course.question_count || 0}</div><div class="metric-label">习题数</div></div></div>
      <div class="course-action-strip">
        <button class="course-action-btn primary" id="btn-course-wrong-book" type="button">本课程错题本</button>
        <button class="course-action-btn" id="btn-course-practice" type="button">进入智能练习</button>
      </div>
      ${buildKnowledgeGraphSection(course, chapters, kps)}
      <div class="charts-grid"><div class="chart-card"><div class="chart-header"><span class="chart-title">🎯 掌握等级分布</span></div><div class="chart-container" id="chart-detail-mastery-ring"></div></div><div class="chart-card" style="grid-column:1/-1;"><div class="chart-header"><span class="chart-title">📊 知识点掌握度详情</span></div><div class="chart-container-lg" id="chart-detail-kp-bar"></div></div></div>
      <div class="card" style="margin-bottom:24px;"><h3 class="card-title">🗺️ 章节学习地图</h3><div class="chapter-timeline">${chapters.map((ch, idx) => { const chKps = kps.filter(k => k.chapter_id === ch.chapter_id); return `<div class="chapter-node"><div class="chapter-dot">${idx + 1}</div><div class="chapter-content"><div class="chapter-name">${escapeHtml(ch.chapter_name)}</div><div class="chapter-desc">${escapeHtml(ch.description || '')} · ${ch.knowledge_point_count || 0} 个知识点</div><div class="kp-pills">${chKps.map(k => `<span class="kp-pill mastery-${k.mastery_level || 'unknown'}" title="${masteryLabel(k.mastery_level)} · ${k.mastery_score || 0}分">${escapeHtml(k.knowledge_point_name)}</span>`).join('')}${chKps.length === 0 ? '<span class="kp-pill mastery-unknown">暂无知识点</span>' : ''}</div></div></div>` }).join('')}</div></div>
      <div class="card"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;"><h3 class="card-title" style="margin-bottom:0;">📋 知识点列表</h3><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><input class="search-box" type="text" id="kp-search" placeholder="🔍 搜索知识点..." style="width:200px;padding:7px 14px;font-size:0.85rem;" /><div class="sort-select-wrap"><label>排序：</label><select class="sort-select" id="kp-sort"><option value="default">课程顺序</option><option value="score-asc">掌握分数↑</option><option value="score-desc">掌握分数↓</option><option value="name">知识点名称</option><option value="difficulty">难度</option><option value="recent">最近学习</option></select></div></div></div><div class="filter-bar" id="kp-filter-bar"><button class="filter-chip active" data-filter="all">全部</button><button class="filter-chip" data-filter="excellent">优秀</button><button class="filter-chip" data-filter="good">良好</button><button class="filter-chip" data-filter="general">一般</button><button class="filter-chip" data-filter="weak">薄弱</button></div><div id="kp-list-container" style="display:flex;flex-direction:column;gap:12px;">${kps.map(k => buildKpCard(k)).join('')}</div><div id="kp-no-results" class="no-filter-results" style="display:none;">没有符合条件的数据<span class="btn-clear-filter" id="kp-clear-filter">清除筛选</span></div></div>
    `
  }

  app.innerHTML = ''
  renderDashboardLayout(app, { menuItems, contentHTML, user })

  if (!loadError && course) {
    setTimeout(() => { renderHeroProgress(course); bindCourseActionEvents(course); initCourseKnowledgeGraph(course, chapters, kps); renderDetailCharts(kps); bindDetailEvents(kps) }, 150)
  }
}

function bindCourseActionEvents(course) {
  document.getElementById('btn-course-wrong-book')?.addEventListener('click', () => {
    window.location.hash = `#/student/wrong-questions?subjectId=${encodeURIComponent(course.course_id)}`
  })
  document.getElementById('btn-course-practice')?.addEventListener('click', () => {
    window.location.hash = '#/student/practice'
  })
}

function bindDetailEvents(kps) {
  let currentFilter = 'all', currentSort = 'default'

  function applyAll() {
    let filtered = kps
    if (currentFilter !== 'all') filtered = filtered.filter(k => k.mastery_level === currentFilter)
    const kw = (document.getElementById('kp-search')?.value || '').toLowerCase()
    if (kw) filtered = filtered.filter(k => k.knowledge_point_name.toLowerCase().includes(kw))
    filtered = sortKPs(filtered, currentSort)
    const container = document.getElementById('kp-list-container')
    const noResults = document.getElementById('kp-no-results')
    if (container) container.innerHTML = filtered.map(k => buildKpCard(k)).join('')
    if (noResults) noResults.style.display = filtered.length === 0 ? '' : 'none'
  }

  document.querySelectorAll('#kp-filter-bar .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => { document.querySelectorAll('#kp-filter-bar .filter-chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); currentFilter = chip.dataset.filter; applyAll() })
  })
  document.getElementById('kp-search')?.addEventListener('input', applyAll)
  document.getElementById('kp-sort')?.addEventListener('change', (e) => { currentSort = e.target.value; applyAll() })
  document.getElementById('kp-clear-filter')?.addEventListener('click', () => {
    document.getElementById('kp-search').value = ''; currentFilter = 'all'; currentSort = 'default'
    document.querySelectorAll('#kp-filter-bar .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'))
    document.getElementById('kp-sort').value = 'default'; applyAll()
  })
}
