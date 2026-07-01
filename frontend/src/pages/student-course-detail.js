// 学生端 — 课程详情页面 v2
// 新增：知识点排序、搜索、筛选

import { getMe } from '../api/auth.js'
import { getStudentCourseDetail, getStudentCourseChapters, getStudentCourseKnowledgePoints } from '../api/student.js'
import { getUser, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, masteryLabel, difficultyLabel } from '../utils/format.js'
import { disposeAllCharts, bindResize, initChart, renderRingChart, renderHorizontalBarChart, CHART_COLORS } from '../utils/echarts.js'
import * as echarts from 'echarts'

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
  inst.setOption({ series: [{ type: 'pie', radius: ['70%', '88%'], center: ['50%', '50%'], silent: true, label: { show: true, position: 'center', fontSize: 22, fontWeight: 'bold', color: '#fff', formatter: `${course.learning_progress || 0}%` }, data: [{ value: course.learning_progress || 0, itemStyle: { color: 'rgba(255,255,255,0.9)', borderRadius: 6 } }, { value: Math.max(0, 100 - (course.learning_progress || 0)), itemStyle: { color: 'rgba(255,255,255,0.15)' } }] }] })
}

function buildKpCard(kp) {
  return `<div class="kp-list-card" data-kp-id="${kp.knowledge_point_id}" data-mastery="${kp.mastery_level || 'unknown'}" data-name="${escapeHtml(kp.knowledge_point_name)}"><div style="flex:1;min-width:0;"><div style="font-weight:600;color:var(--text-main);margin-bottom:4px;">${escapeHtml(kp.knowledge_point_name)}</div><div style="font-size:0.8rem;color:var(--text-sub);">${escapeHtml(kp.chapter_name || '')} · ${difficultyLabel(kp.difficulty_level)} · ${escapeHtml(kp.knowledge_point_code)}</div></div><div style="text-align:center;flex-shrink:0;"><div style="font-size:1.3rem;font-weight:700;color:var(--stu-primary);">${kp.mastery_score || 0}</div><span class="kp-pill mastery-${kp.mastery_level || 'unknown'}" style="font-size:0.72rem;">${masteryLabel(kp.mastery_level)}</span></div><div style="font-size:0.75rem;color:var(--text-hint);flex-shrink:0;">${kp.last_study_at ? formatDate(kp.last_study_at, 'date') : '未学习'}</div></div>`
}

// ========================
// 主渲染
// ========================

export async function renderStudentCourseDetail(app) {
  disposeAllCharts()
  const courseId = getCourseIdFromHash()
  if (!courseId) { window.location.hash = '#/student/courses'; return }

  let user = getUser()
  try { const r = await getMe(); user = r.data.user; setAuth(localStorage.getItem('token') || '', user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }

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

    contentHTML = `
      <div style="margin-bottom:20px;"><button class="btn-back" onclick="window.location.hash='#/student/courses'">← 返回我的课程</button></div>
      <div class="course-hero-card"><div class="hero-inner"><div class="hero-info"><div class="hero-course-name">${escapeHtml(course.course_name)}</div><div class="hero-course-code">${escapeHtml(course.course_code)} · ${escapeHtml(course.subject_category || '')}</div><div class="hero-desc">${escapeHtml(course.description || '')}</div><div class="hero-meta-tags"><span class="hero-tag">🏫 ${escapeHtml(className)}</span>${teachers ? `<span class="hero-tag">👨‍🏫 ${escapeHtml(teachers)}</span>` : ''}<span class="hero-tag">📖 ${course.chapter_count || 0} 个章节</span><span class="hero-tag">🎯 ${course.knowledge_point_count || 0} 个知识点</span></div></div><div class="hero-chart-area" id="chart-hero-progress"></div></div></div>
      <div class="course-metrics-row"><div class="course-metric-card"><div class="metric-value">${course.chapter_count || 0}</div><div class="metric-label">章节数</div></div><div class="course-metric-card"><div class="metric-value">${course.knowledge_point_count || 0}</div><div class="metric-label">知识点数</div></div><div class="course-metric-card"><div class="metric-value" style="color:#4CAF84;">${mastered}</div><div class="metric-label">已掌握</div></div><div class="course-metric-card"><div class="metric-value" style="color:#E0576E;">${weak}</div><div class="metric-label">薄弱</div></div><div class="course-metric-card"><div class="metric-value">${(course.recent_tasks || []).length}</div><div class="metric-label">最近任务</div></div></div>
      <div class="charts-grid"><div class="chart-card"><div class="chart-header"><span class="chart-title">🎯 掌握等级分布</span></div><div class="chart-container" id="chart-detail-mastery-ring"></div></div><div class="chart-card" style="grid-column:1/-1;"><div class="chart-header"><span class="chart-title">📊 知识点掌握度详情</span></div><div class="chart-container-lg" id="chart-detail-kp-bar"></div></div></div>
      <div class="card" style="margin-bottom:24px;"><h3 class="card-title">🗺️ 章节学习地图</h3><div class="chapter-timeline">${chapters.map((ch, idx) => { const chKps = kps.filter(k => k.chapter_id === ch.chapter_id); return `<div class="chapter-node"><div class="chapter-dot">${idx + 1}</div><div class="chapter-content"><div class="chapter-name">${escapeHtml(ch.chapter_name)}</div><div class="chapter-desc">${escapeHtml(ch.description || '')} · ${ch.knowledge_point_count || 0} 个知识点</div><div class="kp-pills">${chKps.map(k => `<span class="kp-pill mastery-${k.mastery_level || 'unknown'}" title="${masteryLabel(k.mastery_level)} · ${k.mastery_score || 0}分">${escapeHtml(k.knowledge_point_name)}</span>`).join('')}${chKps.length === 0 ? '<span class="kp-pill mastery-unknown">暂无知识点</span>' : ''}</div></div></div>` }).join('')}</div></div>
      <div class="card"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;"><h3 class="card-title" style="margin-bottom:0;">📋 知识点列表</h3><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><input class="search-box" type="text" id="kp-search" placeholder="🔍 搜索知识点..." style="width:200px;padding:7px 14px;font-size:0.85rem;" /><div class="sort-select-wrap"><label>排序：</label><select class="sort-select" id="kp-sort"><option value="default">课程顺序</option><option value="score-asc">掌握分数↑</option><option value="score-desc">掌握分数↓</option><option value="name">知识点名称</option><option value="difficulty">难度</option><option value="recent">最近学习</option></select></div></div></div><div class="filter-bar" id="kp-filter-bar"><button class="filter-chip active" data-filter="all">全部</button><button class="filter-chip" data-filter="excellent">优秀</button><button class="filter-chip" data-filter="good">良好</button><button class="filter-chip" data-filter="general">一般</button><button class="filter-chip" data-filter="weak">薄弱</button></div><div id="kp-list-container" style="display:flex;flex-direction:column;gap:12px;">${kps.map(k => buildKpCard(k)).join('')}</div><div id="kp-no-results" class="no-filter-results" style="display:none;">没有符合条件的数据<span class="btn-clear-filter" id="kp-clear-filter">清除筛选</span></div></div>
    `
  }

  app.innerHTML = ''
  renderDashboardLayout(app, { menuItems, contentHTML, user })

  if (!loadError && course) {
    setTimeout(() => { renderHeroProgress(course); renderDetailCharts(kps); bindDetailEvents(kps) }, 150)
  }
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
