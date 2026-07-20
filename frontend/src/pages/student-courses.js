// 学生端 — 我的课程页面 v2
// 新增：排序、搜索、筛选

import { getMe } from '../api/auth.js'
import { getStudentCourses, setStudentCoursePin, activateStudentCourse } from '../api/student.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatPercent, formatDate } from '../utils/format.js'
import { disposeAllCharts, bindResize, initChart } from '../utils/echarts.js'
import * as echarts from 'echarts'
import { getCourseCoverUrl } from '../utils/course-cover.js'

function icon(name, size = 20) {
  const paths = {
    books: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5Zm16 0A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z"/><path d="M11 5H7m6 0h4"/>',
    trend: '<path d="M4 18V6m0 12h16"/><path d="m7 14 4-4 3 2 5-6"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    alert: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 4h.01"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    pin: '<path d="M8 4h8l-1 5 3 3v2H6v-2l3-3-1-5Zm4 10v7"/>',
    face: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15.5c1 .9 2.2 1.4 3.5 1.4s2.5-.5 3.5-1.4M8.5 9.5h.01m7 0h.01"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.books}</svg>`
}

// ========================
// 排序
// ========================

function sortCourses(courses, sortBy) {
  const sorted = [...courses]
  const sampleRank = (course) => course.is_sample_course ? Number(course.display_order || 0) : 1000
  const withSamplePriority = (compare) => sorted.sort((a, b) => {
    if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1
    const priority = sampleRank(a) - sampleRank(b)
    return priority || compare(a, b)
  })
  switch (sortBy) {
    case 'progress-desc': return withSamplePriority((a, b) => (b.progress || 0) - (a.progress || 0))
    case 'progress-asc': return withSamplePriority((a, b) => (a.progress || 0) - (b.progress || 0))
    case 'name': return withSamplePriority((a, b) => (a.course_name || '').localeCompare(b.course_name || ''))
    case 'weak-desc': return withSamplePriority((a, b) => (b.weak_knowledge_count || 0) - (a.weak_knowledge_count || 0))
    case 'mastered-desc': return withSamplePriority((a, b) => (b.mastered_knowledge_count || 0) - (a.mastered_knowledge_count || 0))
    default: return withSamplePriority((a, b) => a.course_id - b.course_id)
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
  const chartHeight = courses.length === 1 ? 180 : Math.min(240, 80 + courses.length * 50)
  document.getElementById('chart-courses-progress').style.height = chartHeight + 'px'
  inst.setOption({
    tooltip: { backgroundColor: 'rgba(22,66,91,0.94)', borderColor: 'rgba(129,195,215,0.3)', borderWidth: 1, textStyle: { color: '#fff', fontSize: 12 } },
    grid: { left: '3%', right: '4%', top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: courses.map(c => c.course_name), axisLabel: { color: '#5A6B80', fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: 'rgba(22,66,91,0.08)' } } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#8899AE', fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(22,66,91,0.05)' } } },
    series: [{
      type: 'bar', barWidth: courses.length === 1 ? 100 : Math.max(32, 60 - courses.length * 3),
      data: courses.map(c => ({ value: c.progress || 0, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#81C3D7' }, { offset: 1, color: '#2F6690' }]) } })),
      label: { show: true, position: 'top', color: '#5A6B80', fontSize: 12, fontWeight: 'bold', formatter: '{c}%' },
      emphasis: { itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#A8D8EA' }, { offset: 1, color: '#3A7CA5' }]) } },
    }],
  })
  inst.resize()
}

// ========================
// HTML
// ========================

function buildOverviewBar(courses) {
  const totalKp = courses.reduce((s, c) => s + (c.knowledge_point_count || 0), 0)
  const totalWeak = courses.reduce((s, c) => s + (c.weak_knowledge_count || 0), 0)
  const totalVideos = courses.reduce((s, c) => s + (c.video_count || 0), 0)
  const avgProgress = courses.length > 0 ? Math.round(courses.reduce((s, c) => s + (c.progress || 0), 0) / courses.length) : 0
  return `<div class="courses-overview-bar"><div class="courses-overview-item"><div class="overview-icon blue">${icon('books')}</div><div><div class="overview-value">${courses.length}</div><div class="overview-label">已加入课程</div></div></div><div class="courses-overview-item"><div class="overview-icon green">${icon('trend')}</div><div><div class="overview-value">${avgProgress}%</div><div class="overview-label">平均学习进度</div></div></div><div class="courses-overview-item"><div class="overview-icon purple">${icon('target')}</div><div><div class="overview-value">${totalKp}</div><div class="overview-label">总知识点数</div></div></div><div class="courses-overview-item"><div class="overview-icon amber">${icon('video')}</div><div><div class="overview-value">${totalVideos}</div><div class="overview-label">课程视频</div></div></div><div class="courses-overview-item"><div class="overview-icon amber">${icon('alert')}</div><div><div class="overview-value">${totalWeak}</div><div class="overview-label">薄弱知识点</div></div></div></div>`
}

function buildCourseCard(course) {
  const mastered = course.mastered_knowledge_count || 0
  const weak = course.weak_knowledge_count || 0
  const total = course.knowledge_point_count || 0
  const general = Math.max(0, total - mastered - weak)
  const teachers = (course.teacher_list || []).map(t => t.real_name).join('、')
  const progress = Math.max(0, Math.min(100, Number(course.progress || 0)))
  const lastText = course.last_position
    ? `${escapeHtml(course.last_position)}${course.last_study_at ? ' · ' + formatDate(course.last_study_at, 'short') : ''}`
    : '尚未开始'

  const coverUrl = getCourseCoverUrl(course)
  const fallbackCover = '/pics/books/book_covers/default.svg'

  // 右侧封面区域
  const coverPanelHTML = `
    <div class="course-card-cover-panel">
      <div class="cover-bg-pattern"></div>
      ${coverUrl
        ? `<img src="${escapeHtml(coverUrl)}" alt="《${escapeHtml(course.course_name)}》课程封面" loading="lazy" onerror="this.onerror=null;this.src='${escapeHtml(fallbackCover)}';" />`
        : `<div class="cover-placeholder" aria-hidden="true">${escapeHtml((course.course_name || '课').slice(0, 1))}</div>`}
    </div>`

  // 课程代码、教师、视频、习题
  const code = course.course_code ? `<span>${escapeHtml(course.course_code)}</span>` : ''
  const teacherSpan = teachers ? `<span>${escapeHtml(teachers)}</span>` : ''
  const stats = [
    course.question_count ? `${course.question_count} 习题` : '',
    course.video_count ? `${course.video_count} 视频` : '',
  ].filter(Boolean).join(' · ')

  return `<article class="course-card-h" data-course-id="${course.course_id}">
    <div class="course-card-main">
      <div class="course-card-title-row"><h3 class="course-card-name">${escapeHtml(course.course_name)}</h3><button class="btn-course-pin-h ${course.is_pinned ? 'is-pinned' : ''}" type="button" aria-pressed="${Boolean(course.is_pinned)}" title="${course.is_pinned ? '取消置顶课程' : '置顶课程'}">${icon('pin', 17)}<span>${course.is_pinned ? '已置顶' : '置顶'}</span></button></div>
      <p class="course-card-desc">${escapeHtml(course.description || '暂无课程描述')}</p>
      <div class="course-card-meta-row">
        ${code}${code && teacherSpan ? ' · ' : ''}${teacherSpan}${(code || teacherSpan) && stats ? ' · ' : ''}${stats}
      </div>
      <div class="course-card-last">${lastText}</div>
    </div>
    <div class="course-card-progress">
      <div class="progress-header-h">
        <span>学习进度</span>
        <b>${formatPercent(progress)}</b>
      </div>
      <div class="progress-bar-h">
        <div class="progress-bar-h-fill" style="width:${progress}%"></div>
      </div>
      <div class="kp-inline-stats">
        <span class="kp-stat">${total} 总</span>
        <span class="kp-stat mastered">${mastered} 已掌握</span>
        <span class="kp-stat general">${general} 一般</span>
        <span class="kp-stat weak">${weak} 薄弱</span>
      </div>
      <div class="course-card-actions-h">
        <button class="btn-enter-course-h" data-course-start="${progress <= 0}">${progress > 0 ? '继续学习' : '开始学习'} →</button>
        <button class="btn-course-knowledge-graph-h" type="button">知识图谱</button>
        <button class="btn-course-wrong-book-h" type="button">错题本</button>
      </div>
    </div>
    ${coverPanelHTML}
  </article>`
}

// ========================
// 主渲染
// ========================

export async function renderStudentCourses(app) {
  disposeAllCharts()
  let user = getUser()
  try { const r = await getMe(); user = r.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }

  const menuItems = STUDENT_MENU_ITEMS

  // Loading
  renderDashboardLayout(app, { menuItems, contentHTML: `<div class="page-header"><h1 class="page-title">我的课程</h1><p class="page-subtitle">查看当前已加入课程、学习进度与知识点掌握状态</p></div><div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在加载课程数据...</p></div>`, user })

  let courses = [], loadError = false
  try { const r = await getStudentCourses(); courses = r.data?.list || [] } catch (e) { loadError = true }

  let contentHTML
  if (loadError) {
    contentHTML = `<div class="page-header"><h1 class="page-title">我的课程</h1></div><div class="error-state"><div class="error-icon">${icon('face', 38)}</div><p class="error-message">课程数据加载失败</p><button class="btn-retry" onclick="window.location.reload()">重新加载</button></div>`
  } else if (courses.length === 0) {
    contentHTML = `<div class="page-header"><h1 class="page-title">我的课程</h1><p class="page-subtitle">查看当前已加入课程、学习进度与知识点掌握状态</p></div><div class="empty-state"><div class="empty-icon">${icon('books', 42)}</div><div class="empty-title">暂无课程</div><div class="empty-desc">你尚未加入任何课程，请等待教师将你加入教学班。</div></div>`
  } else {
    const defaultSort = 'progress-desc'
    contentHTML = `
      <div class="page-header"><div class="page-header-row"><div><h1 class="page-title">我的课程</h1><p class="page-subtitle">查看当前已加入课程、学习进度与知识点掌握状态</p></div><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"><div class="search-box"><span class="search-icon">${icon('search', 17)}</span><input type="text" id="course-search" placeholder="搜索课程名称或代码..." /></div><div class="sort-select-wrap"><label>排序：</label><select class="sort-select" id="course-sort"><option value="progress-desc">学习进度↓</option><option value="progress-asc">学习进度↑</option><option value="name">课程名称</option><option value="weak-desc">薄弱知识点↓</option><option value="mastered-desc">已掌握知识点↓</option></select></div></div></div></div>
      ${buildOverviewBar(courses)}
      <div class="chart-card" style="margin-bottom:24px;"><div class="chart-header"><span class="chart-title">课程学习进度对比</span></div><div class="chart-container" id="chart-courses-progress" style="height:220px;"></div></div>
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
    document.querySelectorAll('.course-card-h').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return
        const cid = card.dataset.courseId; if (cid) window.location.hash = `#/student/courses/${cid}`
      })
    })
    document.querySelectorAll('.btn-enter-course-h').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); const card = btn.closest('.course-card-h'); const cid = card?.dataset.courseId
        if (!cid) return
        if (btn.dataset.courseStart !== 'true') { window.location.hash = `#/student/courses/${cid}`; return }
        btn.disabled = true; const original = btn.textContent; btn.textContent = '正在分发摸底测试…'
        try {
          const result = await activateStudentCourse(cid)
          const taskId = result.data?.diagnostic_task_id
          if (taskId) window.location.hash = `#/student/tasks/${taskId}/answer`
          else window.location.hash = `#/student/courses/${cid}`
        } catch (error) { btn.disabled = false; btn.textContent = original; window.alert(error.message || '摸底测试分发失败，请稍后重试') }
      })
    })
    document.querySelectorAll('.btn-course-pin-h').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); const card = btn.closest('.course-card-h'); const cid = card?.dataset.courseId; if (!cid) return
        const course = courses.find(item => Number(item.course_id) === Number(cid)); if (!course) return
        btn.disabled = true
        try { await setStudentCoursePin(cid, !course.is_pinned); course.is_pinned = !course.is_pinned; applyFilters() }
        catch (error) { btn.disabled = false; window.alert(error.message || '课程置顶状态更新失败') }
      })
    })
    document.querySelectorAll('.btn-course-wrong-book-h').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const card = btn.closest('.course-card-h')
        const cid = card?.dataset.courseId
        if (cid) window.location.hash = `#/student/wrong-questions?subjectId=${encodeURIComponent(cid)}`
      })
    })
    document.querySelectorAll('.btn-course-knowledge-graph-h').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const card = btn.closest('.course-card-h')
        const cid = card?.dataset.courseId
        if (cid) window.location.hash = `#/student/courses/${cid}?section=knowledge-graph`
      })
    })
  }
}
