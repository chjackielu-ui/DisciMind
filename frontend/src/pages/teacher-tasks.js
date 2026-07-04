// 教师端 - 任务列表页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { getTeacherTasks, getTeacherCourses, deleteTeacherTask } from '../api/teacher.js'
import { iconSearch, iconRefresh } from '../utils/icons.js'

export async function renderTeacherTasks(app) {
  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? localStorage.getItem('token') : '', user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  const displayName = getUserDisplayName()

  const menuItems = [
    { label: '首页', icon: 'home', hash: '#/teacher/dashboard' },
    { label: '我的课程', icon: 'book', hash: '#/teacher/courses' },
    { label: '学生管理', icon: 'user', hash: '#/teacher/students' },
    { label: '作业测试', icon: 'alert', hash: '#/teacher/tasks' },
    { label: '题库管理', icon: 'star', hash: '#/teacher/questions' },
    { label: '知识库', icon: 'book', hash: '#/teacher/knowledge' },
    { label: '学情分析', icon: 'star', hash: '#/teacher/analytics' },
    { label: '个人中心', icon: 'user', hash: '#/teacher/profile' },
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <div class="page-header">
        <h2 class="page-title">📋 作业测试</h2>
        <p class="page-subtitle">管理发布给学生的作业、测验、学习任务与复习计划</p>
      </div>

      <div class="card" style="margin-bottom: 20px;">
        <div class="filter-bar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
          <input type="text" id="search-keyword" placeholder="搜索任务标题..." style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          <select id="filter-course" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;min-width:120px;">
            <option value="">全部课程</option>
          </select>
          <select id="filter-type" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
            <option value="">全部类型</option>
            <option value="homework">作业</option>
            <option value="quiz">测验</option>
            <option value="study_task">学习任务</option>
            <option value="review_plan">复习计划</option>
          </select>
          <select id="filter-status" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;">
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="closed">已截止</option>
          </select>
          <button class="btn btn-primary" id="btn-search">${iconSearch()} 搜索</button>
          <button class="btn" id="btn-refresh" style="border:1px solid var(--border);">${iconRefresh()}</button>
          <button class="btn btn-primary" id="btn-create-task" style="margin-left:auto;">＋ 新建任务</button>
        </div>
      </div>

      <div id="task-list-container">
        <div class="empty-hint">正在加载任务数据...</div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '作业测试',
    menuItems,
    contentHTML,
    user,
  })

  // ---- 数据 ----
  let currentTasks = []
  let courses = []

  // 加载课程列表用于下拉筛选
  async function loadCourseOptions() {
    try {
      const res = await getTeacherCourses()
      courses = res.data.list || []
      const sel = document.getElementById('filter-course')
      if (sel) {
        sel.innerHTML =
          '<option value="">全部课程</option>' +
          courses.map((c) => `<option value="${c.course_id}">${c.course_name}</option>`).join('')
      }
    } catch {
      // 静默失败，课程筛选仅作辅助
    }
  }

  async function loadTasks() {
    const container = document.getElementById('task-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'

    const keyword = document.getElementById('search-keyword')?.value || ''
    const courseId = document.getElementById('filter-course')?.value || ''
    const taskType = document.getElementById('filter-type')?.value || ''
    const status = document.getElementById('filter-status')?.value || ''

    const params = {}
    if (keyword) params.keyword = keyword
    if (courseId) params.course_id = parseInt(courseId, 10)
    if (taskType) params.task_type = taskType
    if (status) params.status = status

    try {
      const res = await getTeacherTasks(params)
      currentTasks = res.data.list || []
      renderTasks(currentTasks)
    } catch (err) {
      container.innerHTML =
        '<div class="error-state"><div class="error-icon">⚠️</div><div class="error-message">' +
        err.message +
        '</div><button class="btn-retry" onclick="location.reload()">重试</button></div>'
    }
  }

  function getTaskTypeLabel(type) {
    const map = {
      homework: '📝 作业',
      quiz: '📄 测验',
      study_task: '📖 学习任务',
      review_plan: '🔄 复习计划',
    }
    return map[type] || type || '-'
  }

  function getStatusBadge(status) {
    const map = {
      draft: { color: '#6b7280', bg: '#f3f4f6', label: '草稿' },
      published: { color: '#065f46', bg: '#d1fae5', label: '已发布' },
      closed: { color: '#92400e', bg: '#fef3c7', label: '已截止' },
    }
    const s = map[status] || { color: '#6b7280', bg: '#f3f4f6', label: status || '-' }
    return (
      '<span style="background:' +
      s.bg +
      ';color:' +
      s.color +
      ';padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:500;">' +
      s.label +
      '</span>'
    )
  }

  function formatDate(iso) {
    if (!iso) return '-'
    const d = new Date(iso)
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0') +
      ' ' +
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0')
    )
  }

  function renderTasks(tasks) {
    const container = document.getElementById('task-list-container')
    if (!container) return

    if (!tasks || tasks.length === 0) {
      container.innerHTML =
        '<div class="empty-hint" style="padding:60px 0;">暂无任务，点击上方"新建任务"开始创建</div>'
      return
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px;">
        ${tasks
          .map(
            (t) => `
          <div class="card task-card" data-id="${t.task_id}" style="cursor:pointer;padding:20px;transition:all 0.25s ease;border-left:4px solid var(--stu-primary);display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
              <h3 style="font-size:1.05rem;font-weight:600;color:var(--stu-dark);margin:0;flex:1;">${t.title}</h3>
              ${getStatusBadge(t.status)}
            </div>
            <div style="display:flex;gap:8px;margin-bottom:10px;">
              <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:8px;font-size:0.75rem;">${getTaskTypeLabel(t.task_type)}</span>
            </div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:10px;flex:1;">
              <div>📚 ${t.course_name || '-'}</div>
              <div>👥 ${t.class_name || '-'}</div>
              ${t.deadline ? '<div>⏰ 截止：' + formatDate(t.deadline) + '</div>' : ''}
              ${
                t.description
                  ? '<div style="margin-top:4px;color:var(--text-muted);font-size:0.8rem;">' +
                    t.description.substring(0, 80) +
                    (t.description.length > 80 ? '...' : '') +
                    '</div>'
                  : ''
              }
            </div>
            <div style="display:flex;gap:16px;font-size:0.8rem;color:var(--text-muted);padding-top:10px;border-top:1px solid var(--border);">
              <span>📝 ${t.question_count || 0} 题</span>
              <span>📊 ${t.submission_count || 0} 人已提交</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button class="btn-delete-task" data-id="${t.task_id}" style="flex:1;padding:6px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.85rem;">删除</button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `

    // 点击卡片进入详情
    container.querySelectorAll('.task-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return
        const id = el.dataset.id
        window.location.hash = '#/teacher/tasks/' + id
      })
    })

    // 删除
    container.querySelectorAll('.btn-delete-task').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = parseInt(btn.dataset.id, 10)
        if (!confirm('确定删除该任务吗？此操作不可撤销。')) return
        try {
          await deleteTeacherTask(id)
          loadTasks()
        } catch (err) {
          alert(err.message)
        }
      })
    })
  }

  // ---- 事件绑定 ----
  document.getElementById('btn-create-task')?.addEventListener('click', () => {
    window.location.hash = '#/teacher/tasks/create'
  })

  document.getElementById('btn-search')?.addEventListener('click', () => loadTasks())

  document.getElementById('btn-refresh')?.addEventListener('click', () => loadTasks())

  document.getElementById('search-keyword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadTasks()
  })

  // 下拉筛选变更时自动重新加载
  document.getElementById('filter-course')?.addEventListener('change', () => loadTasks())
  document.getElementById('filter-type')?.addEventListener('change', () => loadTasks())
  document.getElementById('filter-status')?.addEventListener('change', () => loadTasks())

  // ---- 初始化 ----
  loadCourseOptions()
  loadTasks()
}
