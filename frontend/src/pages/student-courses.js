// 学生端 — 我的课程页面 v2
// 新增：排序、搜索、筛选

import { getMe } from '../api/auth.js'
import { getStudentCourses } from '../api/student.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatPercent } from '../utils/format.js'
import { disposeAllCharts, bindResize, initChart } from '../utils/echarts.js'
import * as echarts from 'echarts'

// ========================
// 排序
// ========================

function sortCourses(courses, sortBy) {
  const sorted = [...courses]
  switch (sortBy) {
    case 'progress-desc': return sorted.sort((a, b) => (b.progress || 0) - (a.progress || 0))
    case 'progress-asc': return sorted.sort((a, b) => (a.progress || 0) - (b.progress || 0))
    case 'name': return sorted.sort((a, b) => (a.course_name || '').localeCompare(b.course_name || ''))
    case 'weak-desc': return sorted.sort((a, b) => (b.weak_knowledge_count || 0) - (a.weak_knowledge_count || 0))
    case 'mastered-desc': return sorted.sort((a, b) => (b.mastered_knowledge_count || 0) - (a.mastered_knowledge_count || 0))
    default: return sorted
  }
}

// ========================
// 图表
// ========================

function renderCoursesChart(courses) {
  bindResize()
  if (!courses || courses.length === 0) return
  const inst = initChart('chart-courses-progress')
  if (!inst) return
  inst.setOption({
    tooltip: { backgroundColor: 'rgba(22,66,91,0.94)', borderColor: 'rgba(129,195,215,0.3)', borderWidth: 1, textStyle: { color: '#fff', fontSize: 13 } },
    grid: { left: '3%', right: '4%', top: 10, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: courses.map(c => c.course_name), axisLabel: { color: '#627D98', fontSize: 12 }, axisTick: { show: false }, axisLine: { lineStyle: { color: 'rgba(22,66,91,0.1)' } } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#627D98', formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(22,66,91,0.06)' } } },
    series: [{
      type: 'bar', barWidth: courses.length === 1 ? 80 : 48,
      data: courses.map(c => ({ value: c.progress || 0, itemStyle: { borderRadius: [10, 10, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#81C3D7' }, { offset: 1, color: '#2F6690' }]) } })),
      label: { show: true, position: 'top', color: '#627D98', fontSize: 13, fontWeight: 'bold', formatter: '{c}%' },
    }],
  })
}

// ========================
// HTML
// ========================

function buildOverviewBar(courses) {
  const totalKp = courses.reduce((s, c) => s + (c.knowledge_point_count || 0), 0)
  const totalWeak = courses.reduce((s, c) => s + (c.weak_knowledge_count || 0), 0)
  const avgProgress = courses.length > 0 ? Math.round(courses.reduce((s, c) => s + (c.progress || 0), 0) / courses.length) : 0
  return `<div class="courses-overview-bar"><div class="courses-overview-item"><div class="overview-icon blue">📚</div><div><div class="overview-value">${courses.length}</div><div class="overview-label">已加入课程</div></div></div><div class="courses-overview-item"><div class="overview-icon green">📈</div><div><div class="overview-value">${avgProgress}%</div><div class="overview-label">平均学习进度</div></div></div><div class="courses-overview-item"><div class="overview-icon purple">🎯</div><div><div class="overview-value">${totalKp}</div><div class="overview-label">总知识点数</div></div></div><div class="courses-overview-item"><div class="overview-icon amber">⚠️</div><div><div class="overview-value">${totalWeak}</div><div class="overview-label">薄弱知识点</div></div></div></div>`
}

function buildCourseCard(course) {
  const mastered = course.mastered_knowledge_count || 0
  const weak = course.weak_knowledge_count || 0
  const total = course.knowledge_point_count || 0
  const general = Math.max(0, total - mastered - weak)
  const teachers = (course.teacher_list || []).map(t => t.real_name).join('、')
  return `<div class="course-card" data-course-id="${course.course_id}"><div class="card-top-bar"></div><div class="card-body"><div class="card-title-row"><div class="card-course-name">${escapeHtml(course.course_name)}</div><div class="card-course-code">${escapeHtml(course.course_code)}</div></div><div class="card-desc">${escapeHtml(course.description || '暂无课程描述')}</div><div class="card-meta"><span class="meta-item">🏫 ${escapeHtml(course.teaching_class_name || '-')}</span>${teachers ? `<span class="meta-item">👨‍🏫 ${escapeHtml(teachers)}</span>` : ''}</div><div class="course-progress-bar-wrap"><div class="progress-header"><span class="progress-label">学习进度</span><span class="progress-value">${formatPercent(course.progress)}</span></div><div class="course-progress-bar"><div class="progress-fill" style="width:${course.progress || 0}%"></div></div></div><div class="kp-stats-row"><div class="kp-stat-item"><div class="kp-stat-value">${total}</div><div class="kp-stat-label">总知识点</div></div><div class="kp-stat-item"><div class="kp-stat-value" style="color:#4CAF84;">${mastered}</div><div class="kp-stat-label">已掌握</div></div><div class="kp-stat-item"><div class="kp-stat-value" style="color:#F0B85E;">${general}</div><div class="kp-stat-label">一般</div></div><div class="kp-stat-item"><div class="kp-stat-value" style="color:#E0576E;">${weak}</div><div class="kp-stat-label">薄弱</div></div></div><button class="btn-enter-course">进入课程 →</button></div></div>`
}

// ========================
// 主渲染
// ========================

export async function renderStudentCourses(app) {
  disposeAllCharts()
  let user = getUser()
  try { const r = await getMe(); user = r.data.user; setAuth(localStorage.getItem('token') || '', user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }

  const menuItems = STUDENT_MENU_ITEMS

  // Loading
  renderDashboardLayout(app, { menuItems, contentHTML: `<div class="page-header"><h1 class="page-title">我的课程</h1><p class="page-subtitle">查看当前已加入课程、学习进度与知识点掌握状态</p></div><div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在加载课程数据...</p></div>`, user })

  let courses = [], loadError = false
  try { const r = await getStudentCourses(); courses = r.data?.list || [] } catch (e) { loadError = true }

  let contentHTML
  if (loadError) {
    contentHTML = `<div class="page-header"><h1 class="page-title">我的课程</h1></div><div class="error-state"><div class="error-icon">😞</div><p class="error-message">课程数据加载失败</p><button class="btn-retry" onclick="window.location.reload()">重新加载</button></div>`
  } else if (courses.length === 0) {
    contentHTML = `<div class="page-header"><h1 class="page-title">我的课程</h1><p class="page-subtitle">查看当前已加入课程、学习进度与知识点掌握状态</p></div><div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">暂无课程</div><div class="empty-desc">你尚未加入任何课程，请等待教师将你加入教学班。</div></div>`
  } else {
    const defaultSort = 'progress-desc'
    contentHTML = `
      <div class="page-header"><div class="page-header-row"><div><h1 class="page-title">我的课程</h1><p class="page-subtitle">查看当前已加入课程、学习进度与知识点掌握状态</p></div><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"><div class="search-box"><span class="search-icon">🔍</span><input type="text" id="course-search" placeholder="搜索课程名称或代码..." /></div><div class="sort-select-wrap"><label>排序：</label><select class="sort-select" id="course-sort"><option value="progress-desc">学习进度↓</option><option value="progress-asc">学习进度↑</option><option value="name">课程名称</option><option value="weak-desc">薄弱知识点↓</option><option value="mastered-desc">已掌握知识点↓</option></select></div></div></div></div>
      ${buildOverviewBar(courses)}
      <div class="chart-card" style="margin-bottom:28px;"><div class="chart-header"><span class="chart-title">📊 课程学习进度对比</span></div><div class="chart-container" id="chart-courses-progress" style="height:${courses.length === 1 ? '200px' : '300px'};"></div></div>
      <div class="courses-grid" id="courses-grid">${sortCourses(courses, defaultSort).map(c => buildCourseCard(c)).join('')}</div>
      <div id="no-filter-results" class="no-filter-results" style="display:none;">没有符合筛选条件的课程<span class="btn-clear-filter" id="btn-clear-filter">清除筛选</span></div>
    `
  }

  app.innerHTML = ''
  renderDashboardLayout(app, { menuItems, contentHTML, user })

  if (!loadError && courses.length > 0) {
    setTimeout(() => {
      renderCoursesChart(courses)
      bindEvents(courses)
    }, 150)
  }
}

function bindEvents(courses) {
  let currentSort = 'progress-desc'
  const grid = document.getElementById('courses-grid')
  const noResults = document.getElementById('no-filter-results')

  function applyFilters() {
    const keyword = (document.getElementById('course-search')?.value || '').toLowerCase()
    let filtered = courses.filter(c => {
      const text = (c.course_name + ' ' + c.course_code).toLowerCase()
      return !keyword || text.includes(keyword)
    })
    filtered = sortCourses(filtered, currentSort)
    if (grid) grid.innerHTML = filtered.map(c => buildCourseCard(c)).join('')
    if (noResults) noResults.style.display = filtered.length === 0 && courses.length > 0 ? '' : 'none'
    bindCardClicks()
  }

  document.getElementById('course-search')?.addEventListener('input', applyFilters)
  document.getElementById('course-sort')?.addEventListener('change', (e) => { currentSort = e.target.value; applyFilters() })
  document.getElementById('btn-clear-filter')?.addEventListener('click', () => {
    const input = document.getElementById('course-search'); if (input) { input.value = ''; applyFilters() }
  })
  bindCardClicks()

  function bindCardClicks() {
    document.querySelectorAll('.course-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return
        const cid = card.dataset.courseId; if (cid) window.location.hash = `#/student/courses/${cid}`
      })
    })
    document.querySelectorAll('.btn-enter-course').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); const card = btn.closest('.course-card'); const cid = card?.dataset.courseId; if (cid) window.location.hash = `#/student/courses/${cid}`
      })
    })
  }
}
