import { getMe } from '../api/auth.js'
import { getStudentTasks, getStudentCourses } from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'

let pollTimer = null

const TYPE_LABELS = { homework: '作业', exam: '考试', practice: '练习', quiz: '测验', material: '资料', announcement: '通知' }

function dateTime(value) {
  if (!value) return '无截止时间'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

function shell() {
  return `<div class="student-teaching-tasks">
    <header><div><span>教学任务</span><h2>我的作业与考试</h2><p>教师发布的作业、考试、练习、资料和通知统一到达这里。</p></div><button id="student-task-refresh">刷新</button></header>
    <section class="student-task-filters">
      <label>课程<select id="student-task-course"><option value="">全部课程</option></select></label>
      <label>类型<select id="student-task-type"><option value="">全部类型</option><option value="homework">作业</option><option value="exam">考试</option><option value="practice">练习</option><option value="material">资料</option><option value="announcement">通知</option></select></label>
      <label>任务状态<select id="student-task-status"><option value="">已发布与已截止</option><option value="published">进行中</option><option value="closed">已截止</option></select></label>
      <label>完成状态<select id="student-task-submission"><option value="">全部</option><option value="pending">待完成</option><option value="completed">已提交</option></select></label>
      <button id="student-task-query">查询</button>
    </section>
    <section class="student-task-summary" id="student-task-summary"></section>
    <main id="student-task-list"><div class="student-task-empty">正在加载教学任务…</div></main>
  </div>`
}

function renderList(rows) {
  const submissionFilter = document.getElementById('student-task-submission').value
  const filtered = rows.filter(item => submissionFilter === 'completed' ? !!item.submission_status : submissionFilter === 'pending' ? !item.submission_status : true)
  const completed = rows.filter(item => item.submission_status).length
  document.getElementById('student-task-summary').innerHTML = `<article><b>${rows.length}</b><span>当前任务</span></article><article><b>${rows.filter(item => item.task_type === 'homework').length}</b><span>作业</span></article><article><b>${rows.filter(item => item.task_type === 'exam').length}</b><span>考试</span></article><article><b>${completed}</b><span>已提交</span></article>`
  const container = document.getElementById('student-task-list')
  container.innerHTML = filtered.length ? filtered.map(item => {
    const overdue = item.deadline && new Date(item.deadline) < new Date()
    const completedTask = !!item.submission_status
    const status = completedTask ? '已提交' : overdue || item.status === 'closed' ? '已截止' : '待完成'
    return `<article class="student-teaching-task-card" data-status="${completedTask ? 'completed' : overdue ? 'overdue' : 'pending'}">
      <div class="student-task-card-head"><span>${escapeHtml(TYPE_LABELS[item.task_type] || item.task_type)}</span><em>${status}</em></div>
      <h3>${escapeHtml(item.task_title)}</h3><p>${escapeHtml(item.course_name || '未关联课程')}</p>
      <dl><div><dt>截止</dt><dd>${dateTime(item.deadline)}</dd></div><div><dt>题目</dt><dd>${item.question_count || 0} 道</dd></div><div><dt>总分</dt><dd>${item.configured_total_score ?? '-'} 分</dd></div><div><dt>成绩</dt><dd>${item.score ?? '-'}</dd></div></dl>
      <button data-answer-task="${item.task_id}">${completedTask ? '查看结果' : overdue ? '查看任务' : '开始作答'}</button>
    </article>`
  }).join('') : '<div class="student-task-empty">当前筛选范围没有教学任务。</div>'
  container.querySelectorAll('[data-answer-task]').forEach(button => button.addEventListener('click', () => { window.location.hash = `#/student/tasks/${button.dataset.answerTask}/answer` }))
}

async function loadTasks() {
  const params = { page_size: 100 }
  const course = document.getElementById('student-task-course').value
  const type = document.getElementById('student-task-type').value
  const status = document.getElementById('student-task-status').value
  if (course) params.course_id = Number(course)
  if (type) params.task_type = type
  if (status) params.status = status
  const result = await getStudentTasks(params)
  renderList(result.data?.list || [])
}

export async function renderStudentTeachingTasks(app) {
  if (pollTimer) clearInterval(pollTimer)
  let user = getUser()
  try { const result = await getMe(); user = result.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: shell(), user })
  try {
    const courses = await getStudentCourses({ page_size: 100 })
    document.getElementById('student-task-course').innerHTML = '<option value="">全部课程</option>' + (courses.data?.list || []).map(item => `<option value="${item.course_id}">${escapeHtml(item.course_name)}</option>`).join('')
    await loadTasks()
  } catch (error) { showToast(error.message || '教学任务加载失败', 'error') }
  document.getElementById('student-task-query').addEventListener('click', () => void loadTasks())
  document.getElementById('student-task-refresh').addEventListener('click', () => void loadTasks())
  document.getElementById('student-task-submission').addEventListener('change', () => void loadTasks())
  const refreshOnVisible = () => { if (!document.hidden && window.location.hash.startsWith('#/student/teaching-tasks')) void loadTasks() }
  document.addEventListener('visibilitychange', refreshOnVisible, { once: true })
  pollTimer = setInterval(() => {
    if (!window.location.hash.startsWith('#/student/teaching-tasks')) { clearInterval(pollTimer); pollTimer = null; return }
    if (!document.hidden) void loadTasks()
  }, 20000)
}
