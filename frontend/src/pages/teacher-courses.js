// 教师端 - 课程列表页（对齐学生端布局结构）

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { getTeacherCourses, createTeacherCourse, updateTeacherCourse, deleteTeacherCourse } from '../api/teacher.js'
import { iconSearch, iconRefresh } from '../utils/icons.js'
import { escapeHtml, formatPercent } from '../utils/format.js'
import { initAllAutoResize } from '../utils/auto-resize.js'
import { disposeAllCharts, bindResize, initChart } from '../utils/echarts.js'
import * as echarts from 'echarts'

function buildOverviewBar(courses) {
  const totalStudents = courses.reduce((s, c) => s + (c.student_count || 0), 0)
  const totalClasses = courses.reduce((s, c) => s + (c.teaching_class_count || 0), 0)
  const activeCount = courses.filter(c => c.status === 'active').length
  const avgProgress = courses.length > 0 ? Math.round(courses.reduce((s, c) => s + (c.learning_progress || 0), 0) / courses.length) : 0
  return `<div class="courses-overview-bar"><div class="courses-overview-item"><div class="overview-icon blue">📚</div><div><div class="overview-value">${courses.length}</div><div class="overview-label">负责课程</div></div></div><div class="courses-overview-item"><div class="overview-icon green">✅</div><div><div class="overview-value">${activeCount}</div><div class="overview-label">进行中</div></div></div><div class="courses-overview-item"><div class="overview-icon purple">👥</div><div><div class="overview-value">${totalStudents}</div><div class="overview-label">总学生数</div></div></div><div class="courses-overview-item"><div class="overview-icon amber">🏫</div><div><div class="overview-value">${totalClasses}</div><div class="overview-label">教学班级</div></div></div><div class="courses-overview-item"><div class="overview-icon blue">📈</div><div><div class="overview-value">${avgProgress}%</div><div class="overview-label">平均进度</div></div></div></div>`
}

function renderCoursesChart(courses) {
  bindResize()
  if (!courses || courses.length === 0) return
  const inst = initChart('chart-courses-progress')
  if (!inst) return
  const chartHeight = courses.length === 1 ? 180 : Math.min(240, 80 + courses.length * 50)
  const dom = document.getElementById('chart-courses-progress')
  if (dom) dom.style.height = chartHeight + 'px'
  inst.setOption({
    tooltip: { backgroundColor: 'rgba(69,26,3,0.94)', borderColor: 'rgba(245,158,11,0.3)', borderWidth: 1, textStyle: { color: '#fff', fontSize: 12 } },
    grid: { left: '3%', right: '4%', top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: courses.map(c => c.course_name), axisLabel: { color: '#57534E', fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: 'rgba(180,83,9,0.08)' } } },
    yAxis: { type: 'value', max: 100, axisLabel: { color: '#A8A29E', fontSize: 11, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(180,83,9,0.05)' } } },
    series: [{
      type: 'bar', barWidth: courses.length === 1 ? 100 : Math.max(32, 60 - courses.length * 3),
      data: courses.map(c => ({ value: c.learning_progress || 0, itemStyle: { borderRadius: [8, 8, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#FBBF24' }, { offset: 1, color: '#D97706' }]) } })),
      label: { show: true, position: 'top', color: '#57534E', fontSize: 12, fontWeight: 'bold', formatter: '{c}%' },
      emphasis: { itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#FDE68A' }, { offset: 1, color: '#F59E0B' }]) } },
    }],
  })
  inst.resize()
}

function buildCourseCard(course) {
  const progress = Math.max(0, Math.min(100, Number(course.learning_progress || 0)))
  return `<article class="course-card-h" data-id="${course.course_id}">
    <div class="course-card-main">
      <h3 class="course-card-name">${escapeHtml(course.course_name || '')}</h3>
      <p class="course-card-desc">${escapeHtml(course.description ? (course.description.substring(0, 80) + (course.description.length > 80 ? '...' : '')) : '暂无课程描述')}</p>
      <div class="course-card-meta-row">
        <span>${escapeHtml(course.course_code || '-')}</span>
        <span>${escapeHtml(course.subject_category || '-')}</span>
        <span>${course.teaching_class_count || 0} 个班级</span>
        <span>${course.student_count || 0} 名学生</span>
      </div>
      <div class="course-card-last"><span style="background:${course.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${course.status === 'active' ? '#065f46' : '#92400e'};padding:2px 10px;border-radius:12px;font-size:0.75rem;">${course.status === 'active' ? '进行中' : '已归档'}</span></div>
    </div>
    <div class="course-card-progress">
      <div class="progress-header-h">
        <span>学习进度</span>
        <b>${formatPercent(progress)}</b>
      </div>
      <div class="progress-bar-h">
        <div class="progress-bar-h-fill" style="width:${progress}%"></div>
      </div>
      <div class="course-card-actions-h">
        <button class="btn-enter-course-h">进入课程 →</button>
        <button class="btn-edit-course-h" type="button" data-id="${course.course_id}">编辑</button>
        <button class="btn-del-course-h" type="button" data-id="${course.course_id}">删除</button>
      </div>
    </div>
    <div class="course-card-cover-panel">
      <div class="cover-bg-pattern"></div>
      <div class="cover-placeholder" aria-hidden="true">${escapeHtml((course.course_name || '课').slice(0, 1))}</div>
    </div>
  </article>`
}

export async function renderTeacherCourses(app) {
  disposeAllCharts()
  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? getToken() : '', user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  // Loading
  renderDashboardLayout(app, {
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML: `<div class="page-header"><h1 class="page-title">课程管理</h1><p class="page-subtitle">管理课程信息、教学班级与章节知识点</p></div><div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在加载课程数据...</p></div>`,
    user,
  })

  let courses = [], loadError = false
  try { const res = await getTeacherCourses({}); courses = res.data.list || [] } catch (e) { loadError = true }

  let contentHTML
  if (loadError) {
    contentHTML = `<div class="page-header"><h1 class="page-title">课程管理</h1></div><div class="error-state"><div class="error-icon">😞</div><p class="error-message">课程数据加载失败</p><button class="btn-retry" onclick="window.location.reload()">重新加载</button></div>`
  } else if (courses.length === 0) {
    contentHTML = `<div class="page-header"><h1 class="page-title">课程管理</h1><p class="page-subtitle">管理课程信息、教学班级与章节知识点</p></div><div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">暂无课程</div><div class="empty-desc">点击下方"新建课程"开始创建您的第一门课程。</div></div><div class="card" style="margin-bottom:20px;padding:14px 20px;"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"><input type="text" id="search-keyword" placeholder="搜索课程名称..." style="flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"><button class="btn btn-primary" id="btn-search" style="padding:6px 14px;font-size:0.85rem;">${iconSearch()} 搜索</button><button class="btn" id="btn-refresh" style="border:1px solid var(--border);padding:6px 10px;font-size:0.85rem;">${iconRefresh()}</button><button class="btn btn-primary" id="btn-create-course" style="margin-left:auto;padding:6px 14px;font-size:0.85rem;">＋ 新建课程</button></div></div>`
  } else {
    contentHTML = `
      <div class="page-header"><div class="page-header-row"><div><h1 class="page-title">课程管理</h1><p class="page-subtitle">管理课程信息、教学班级与章节知识点</p></div><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"><div class="search-box"><span class="search-icon">🔍</span><input type="text" id="search-keyword" placeholder="搜索课程名称或代码..." /></div><button class="btn btn-primary" id="btn-create-course" style="padding:6px 14px;font-size:0.85rem;white-space:nowrap;">＋ 新建课程</button></div></div></div>
      ${buildOverviewBar(courses)}
      <div class="chart-card" style="margin-bottom:24px;"><div class="chart-header"><span class="chart-title">课程学习进度对比</span></div><div class="chart-container" id="chart-courses-progress" style="height:220px;"></div></div>
      <div class="courses-grid" id="courses-grid">${courses.map(c => buildCourseCard(c)).join('')}</div>
      <div id="no-filter-results" class="no-filter-results" style="display:none;">没有符合筛选条件的课程<span class="btn-clear-filter" id="btn-clear-filter">清除筛选</span></div>
    `
  }

  app.innerHTML = ''
  renderDashboardLayout(app, { menuItems: TEACHER_MENU_ITEMS, contentHTML, user })

  if (!loadError && courses.length > 0) {
    setTimeout(() => {
      renderCoursesChart(courses)
      bindTeacherCoursesEvents(courses)
    }, 150)
  } else if (!loadError) {
    bindTeacherCoursesEvents(courses)
  }

  // 注入模态框
  const modalHTML = `
    <div class="modal-overlay" id="course-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 id="modal-title" style="font-size:1.2rem;margin:0;">新建课程</h3>
          <button type="button" id="btn-modal-close" style="border:none;background:none;font-size:24px;color:#999;cursor:pointer;padding:0 4px;line-height:1;">×</button>
        </div>
        <form id="course-form">
          <div class="form-group" style="margin-bottom:14px;">
            <label>课程名称 <span class="required">*</span></label>
            <input type="text" id="form-course-name" required placeholder="例如：机器学习">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>课程编码 <span class="required">*</span></label>
            <input type="text" id="form-course-code" required placeholder="例如：ML001">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>学科分类</label>
            <input type="text" id="form-subject-category" placeholder="计算机大类学科">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>课程描述</label>
            <textarea id="form-description" class="auto-resize-ta" rows="3" placeholder="课程简介..."></textarea>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="btn-modal-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>`
  app.insertAdjacentHTML('beforeend', modalHTML)
  initAllAutoResize()
}

let editingCourseId = null

function bindTeacherCoursesEvents(courses) {
  // 搜索
  const searchInput = document.getElementById('search-keyword')
  let currentKeyword = ''

  function applyFilter() {
    const grid = document.getElementById('courses-grid')
    const noResults = document.getElementById('no-filter-results')
    if (!grid) return
    currentKeyword = (searchInput?.value || '').toLowerCase()
    let filtered = courses
    if (currentKeyword) {
      filtered = courses.filter(c => (c.course_name + ' ' + c.course_code).toLowerCase().includes(currentKeyword))
    }
    grid.innerHTML = filtered.map(c => buildCourseCard(c)).join('')
    if (noResults) noResults.style.display = filtered.length === 0 && courses.length > 0 ? '' : 'none'
    bindCardEvents()
  }

  searchInput?.addEventListener('input', applyFilter)
  document.getElementById('btn-refresh')?.addEventListener('click', applyFilter)

  function bindCardEvents() {
    document.querySelectorAll('.course-card-h').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return
        const id = card.dataset.id; if (id) window.location.hash = `#/teacher/courses/${id}`
      })
    })
    document.querySelectorAll('.btn-enter-course-h').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); const card = btn.closest('.course-card-h'); const id = card?.dataset.id; if (id) window.location.hash = `#/teacher/courses/${id}`
      })
    })
    document.querySelectorAll('.btn-edit-course-h').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = parseInt(btn.dataset.id)
        const course = courses.find(c => c.course_id === id)
        if (course) openModal(course)
      })
    })
    document.querySelectorAll('.btn-del-course-h').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = parseInt(btn.dataset.id)
        if (!confirm('确定删除该课程吗？此操作不可撤销。')) return
        try {
          await deleteTeacherCourse(id)
          window.location.reload()
        } catch (err) { alert(err.message) }
      })
    })
  }

  bindCardEvents()

  // 创建按钮
  document.getElementById('btn-create-course')?.addEventListener('click', () => openModal())

  // 模态框事件
  document.addEventListener('click', (e) => {
    if (e.target.id === 'btn-modal-cancel' || e.target.id === 'btn-modal-close') closeModal()
    if (e.target.classList.contains('modal-overlay')) closeModal()
  })

  document.getElementById('course-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = {
      course_name: document.getElementById('form-course-name').value.trim(),
      course_code: document.getElementById('form-course-code').value.trim(),
      subject_category: document.getElementById('form-subject-category').value.trim() || '计算机大类学科',
      description: document.getElementById('form-description').value.trim(),
    }
    if (!data.course_name || !data.course_code) { alert('课程名称和编码为必填项'); return }
    try {
      if (editingCourseId) {
        await updateTeacherCourse(editingCourseId, data)
      } else {
        await createTeacherCourse(data)
      }
      closeModal()
      window.location.reload()
    } catch (err) { alert(err.message) }
  })
}

function openModal(course = null) {
  const modal = document.getElementById('course-modal')
  if (!modal) return
  editingCourseId = course?.course_id || null
  document.getElementById('modal-title').textContent = course ? '编辑课程' : '新建课程'
  document.getElementById('form-course-name').value = course?.course_name || ''
  document.getElementById('form-course-code').value = course?.course_code || ''
  document.getElementById('form-subject-category').value = course?.subject_category || ''
  document.getElementById('form-description').value = course?.description || ''
  modal.style.display = 'flex'
}

function closeModal() {
  const modal = document.getElementById('course-modal')
  if (modal) modal.style.display = 'none'
  editingCourseId = null
}
