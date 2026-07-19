import { getMe } from '../api/auth.js'
import {
  getAllTeachingClasses,
  getTeacherStudents,
  getTeacherTasks,
  getTeacherQuestions,
  getTeachingResources,
} from '../api/teacher.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml } from '../utils/format.js'

const SECTIONS = [
  ['students', '学生管理'],
  ['materials', '课程资料'],
  ['assignments', '作业管理'],
  ['questions', '题库管理'],
  ['resources', '教学资源匹配'],
  ['evaluations', '学生评价'],
]

const TASK_LABELS = {
  homework: '作业',
  exam: '考试',
  quiz: '测验',
  practice: '练习',
  material: '资料',
  announcement: '通知',
}

const RISK_LABELS = { normal: '正常', attention: '需要关注', high: '高风险' }

function currentSection() {
  const value = new URLSearchParams(window.location.hash.split('?')[1] || '').get('section')
  return SECTIONS.some(([key]) => key === value) ? value : 'students'
}

function formatSchedule(value) {
  if (!value) return '上课时间待安排'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => item.label || item.time || '').filter(Boolean).join('、') || '上课时间待安排'
  return value.label || value.time || Object.values(value).filter((item) => typeof item === 'string').join(' · ') || '上课时间待安排'
}

function formatDate(value) {
  if (!value) return '未设置'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未设置' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function score(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

function riskOf(student) {
  return student.evaluation?.risk_level || student.metrics?.risk_level || 'normal'
}

function studentRows(students, evaluationMode = false) {
  if (!students.length) return '<div class="class-workspace-empty"><b>暂无班级学生</b><span>可返回班级管理添加学生。</span></div>'
  return `<div class="class-workspace-table-wrap"><table class="class-workspace-table"><thead><tr>
    <th>学生</th><th>学号</th>${evaluationMode ? '<th>知识掌握</th><th>作业完成</th><th>活跃度</th>' : '<th>专业年级</th><th>学习进度</th>'}<th>综合评价</th><th>风险状态</th><th>操作</th>
  </tr></thead><tbody>${students.map((student) => {
    const name = student.student_name || student.username || '未命名学生'
    const metrics = student.metrics || {}
    const risk = riskOf(student)
    const comprehensive = student.evaluation?.comprehensive_score ?? metrics.comprehensive_score
    return `<tr>
      <td><span class="class-student-name"><i>${escapeHtml(name.slice(0, 1))}</i><b>${escapeHtml(name)}</b></span></td>
      <td>${escapeHtml(student.student_no || '-')}</td>
      ${evaluationMode
        ? `<td>${score(metrics.mastery_score)}%</td><td>${score(metrics.homework_completion_rate)}%</td><td>${score(metrics.activity_score)}%</td>`
        : `<td>${escapeHtml([student.major, student.grade ? `${student.grade}级` : ''].filter(Boolean).join(' · ') || '-')}</td><td><span class="class-progress"><i style="--value:${score(metrics.progress_score ?? metrics.mastery_score)}%"></i></span><em>${score(metrics.progress_score ?? metrics.mastery_score)}%</em></td>`}
      <td><strong>${score(comprehensive)} 分</strong></td>
      <td><span class="class-risk ${risk}">${RISK_LABELS[risk] || '正常'}</span></td>
      <td><button class="class-link" data-student-profile="${student.student_user_id}">${evaluationMode ? '查看评价' : '查看学生'}</button></td>
    </tr>`
  }).join('')}</tbody></table></div>`
}

function materialPanel(resources, classInfo) {
  if (!resources.length) return `<div class="class-workspace-empty"><b>该班级暂无课程资料</b><span>上传后可直接按班级下发并查看阅读回流。</span><button class="teacher-btn primary" data-class-nav="#/teacher/knowledge?course_id=${classInfo.course_id}&teaching_class_id=${classInfo.teaching_class_id}">上传课程资料</button></div>`
  return `<div class="class-resource-list">${resources.map((item) => `<article>
    <span class="class-resource-type">${escapeHtml((item.file_ext || item.resource_kind || 'FILE').slice(0, 5).toUpperCase())}</span>
    <div><b>${escapeHtml(item.title || item.original_filename || '教学资料')}</b><p>${escapeHtml(item.resource_category || item.resource_kind || '课程资料')} · v${item.resource_version || 1}</p></div>
    <dl><div><dt>已读</dt><dd>${item.read_count || 0}/${item.recipient_count || 0}</dd></div><div><dt>下载</dt><dd>${item.download_count || 0}</dd></div></dl>
  </article>`).join('')}</div>`
}

function assignmentPanel(tasks, classInfo) {
  if (!tasks.length) return `<div class="class-workspace-empty"><b>该班级暂无作业任务</b><span>新建任务时课程和教学班会自动带入。</span><button class="teacher-btn primary" data-class-nav="#/teacher/tasks/create?course_id=${classInfo.course_id}&teaching_class_id=${classInfo.teaching_class_id}">发布班级作业</button></div>`
  return `<div class="class-assignment-list">${tasks.map((item) => `<button data-class-nav="#/teacher/tasks/${item.task_id}">
    <span class="class-task-type ${escapeHtml(item.task_type || '')}">${TASK_LABELS[item.task_type] || escapeHtml(item.task_type || '任务')}</span>
    <div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.class_name || classInfo.teaching_class_name)} · 截止 ${formatDate(item.deadline)}</p></div>
    <dl><div><dt>提交</dt><dd>${item.submission_count || 0}/${item.recipient_count || 0}</dd></div><div><dt>状态</dt><dd>${item.status === 'published' ? '已发布' : item.status === 'closed' ? '已截止' : '草稿'}</dd></div></dl>
  </button>`).join('')}</div>`
}

function questionPanel(questions, classInfo) {
  const typeCount = questions.reduce((map, item) => map.set(item.question_type, (map.get(item.question_type) || 0) + 1), new Map())
  if (!questions.length) return `<div class="class-workspace-empty"><b>当前课程题库暂无题目</b><span>题库按课程维护，并可在本班作业中直接组卷。</span><button class="teacher-btn primary" data-class-nav="#/teacher/questions/create?course_id=${classInfo.course_id}">新建题目</button></div>`
  return `<div class="class-question-summary"><section><strong>${questions.length}</strong><span>当前课程题目</span></section>${[...typeCount.entries()].slice(0, 5).map(([type, count]) => `<section><strong>${count}</strong><span>${escapeHtml(type)}</span></section>`).join('')}</div>
    <div class="class-question-list">${questions.slice(0, 8).map((item) => `<button data-class-nav="#/teacher/questions/${item.question_id}"><span>${escapeHtml(item.question_type || '题目')}</span><b>${escapeHtml(item.title || item.content || '未命名题目')}</b><em>${escapeHtml(item.knowledge_point_name || '未绑定知识点')}</em></button>`).join('')}</div>`
}

function resourceMatchPanel(resources, students, questions, classInfo) {
  const riskStudents = students.filter((item) => riskOf(item) !== 'normal')
  const suggestions = [
    { title: '薄弱点修复任务单', detail: `${riskStudents.length} 名学生需要关注，建议匹配分层练习与错因复盘。`, ready: resources.some((item) => /任务单|worksheet/i.test(`${item.resource_category || ''}${item.resource_kind || ''}${item.title || ''}`)) },
    { title: '课堂诊断题组', detail: `课程题库已有 ${questions.length} 道题，可按知识点组成课前诊断。`, ready: questions.length > 0 },
    { title: '课程课件与讲义', detail: `班级当前关联 ${resources.length} 份资料，可在授课前统一下发。`, ready: resources.length > 0 },
  ]
  return `<div class="class-resource-matching"><header><div><b>资源匹配建议</b><p>依据当前班级风险分布、题库和已关联资料生成。</p></div><span>${suggestions.filter((item) => item.ready).length}/${suggestions.length} 项就绪</span></header>
    ${suggestions.map((item) => `<article><i class="${item.ready ? 'ready' : ''}"></i><div><b>${item.title}</b><p>${item.detail}</p></div><span>${item.ready ? '可直接使用' : '建议补充'}</span></article>`).join('')}
    <footer><button class="teacher-btn" data-class-nav="#/teacher/knowledge?course_id=${classInfo.course_id}&teaching_class_id=${classInfo.teaching_class_id}">进入资源中心</button><button class="teacher-btn primary" data-class-nav="#/teacher/preparation?course_id=${classInfo.course_id}&teaching_class_id=${classInfo.teaching_class_id}">进入智慧备课</button></footer>
  </div>`
}

function shell(classInfo) {
  return `<div class="teacher-class-workspace">
    <header class="class-workspace-header">
      <button class="class-back" data-class-nav="#/teacher/system?tab=classes">返回我的班级</button>
      <div><span>${escapeHtml(classInfo.course_name || '未关联课程')}</span><h2>${escapeHtml(classInfo.teaching_class_name)}</h2><p>${escapeHtml([classInfo.semester_name, formatSchedule(classInfo.schedule), classInfo.location].filter(Boolean).join(' · '))}</p></div>
      <button class="teacher-btn primary" data-class-nav="#/teacher/tasks/create?course_id=${classInfo.course_id}&teaching_class_id=${classInfo.teaching_class_id}">发布班级任务</button>
    </header>
    <section class="class-overview-grid">
      <article><span>学生人数</span><b>${classInfo.student_count || 0}<i>人</i></b></article>
      <article><span>近 30 天作业</span><b>${classInfo.recent_assignment_count || 0}<i>项</i></b></article>
      <article><span>平均学习进度</span><b>${score(classInfo.learning_progress)}<i>%</i></b></article>
      <article class="risk"><span>风险学生</span><b>${classInfo.risk_student_count || 0}<i>人</i></b></article>
    </section>
    <nav class="class-workspace-tabs">${SECTIONS.map(([key, label]) => `<button data-class-section="${key}" class="${key === currentSection() ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <section class="class-workspace-panel" id="class-workspace-panel"><div class="class-workspace-empty">正在加载班级数据</div></section>
  </div>`
}

export async function renderTeacherClassWorkspace(app, params) {
  let user = getUser()
  try { const result = await getMe(); user = result.data.user; setAuth(getToken(), user) }
  catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }

  const classId = Number(params?.class_id)
  try {
    const classResponse = await getAllTeachingClasses({ status: 'active' })
    const classes = classResponse.data?.list || []
    const classInfo = classes.find((item) => Number(item.teaching_class_id) === classId)
    if (!classInfo) throw new Error('班级不存在或当前账号无访问权限')

    renderDashboardLayout(app, { title: classInfo.teaching_class_name, menuItems: TEACHER_MENU_ITEMS, contentHTML: shell(classInfo), user })
    const panel = document.getElementById('class-workspace-panel')
    const [studentResponse, taskResponse, questionResponse, resourceResponse] = await Promise.all([
      getTeacherStudents({ class_id: classId, course_id: classInfo.course_id, page_size: 100 }),
      getTeacherTasks({ teaching_class_id: classId, page_size: 100 }),
      getTeacherQuestions({ course_id: classInfo.course_id, page_size: 100 }),
      getTeachingResources({ course_id: classInfo.course_id, teaching_class_id: classId, page_size: 100 }),
    ])
    const data = {
      students: studentResponse.data?.list || [],
      tasks: taskResponse.data?.list || [],
      questions: questionResponse.data?.list || [],
      resources: resourceResponse.data?.list || [],
    }

    function bindPanelNavigation() {
      document.querySelectorAll('[data-class-nav]').forEach((button) => { button.onclick = () => { window.location.hash = button.dataset.classNav } })
      document.querySelectorAll('[data-student-profile]').forEach((button) => { button.onclick = () => { window.location.hash = `#/teacher/students/${button.dataset.studentProfile}?course_id=${classInfo.course_id}&class_id=${classId}` } })
    }

    function renderSection(section) {
      const headers = {
        students: ['学生管理', `${data.students.length} 名学生已加入当前教学班`],
        materials: ['课程资料', `${data.resources.length} 份资料与当前班级直接关联`],
        assignments: ['作业管理', `${data.tasks.length} 项班级任务，继续复用统一发布与批阅流程`],
        questions: ['题库管理', `${data.questions.length} 道课程题目可用于本班组卷`],
        resources: ['教学资源匹配', '把班级学情、题库与现有资源放在同一视图中'],
        evaluations: ['学生评价', '聚焦综合评分、关键维度和风险状态'],
      }
      const [title, description] = headers[section] || headers.students
      let content = studentRows(data.students)
      if (section === 'materials') content = materialPanel(data.resources, classInfo)
      if (section === 'assignments') content = assignmentPanel(data.tasks, classInfo)
      if (section === 'questions') content = questionPanel(data.questions, classInfo)
      if (section === 'resources') content = resourceMatchPanel(data.resources, data.students, data.questions, classInfo)
      if (section === 'evaluations') content = studentRows([...data.students].sort((a, b) => score(a.evaluation?.comprehensive_score) - score(b.evaluation?.comprehensive_score)), true)
      panel.innerHTML = `<header><div><h3>${title}</h3><p>${description}</p></div>${section === 'students' ? '<button class="teacher-btn" data-class-nav="#/teacher/system?tab=classes">维护班级名单</button>' : ''}${section === 'assignments' ? `<button class="teacher-btn primary" data-class-nav="#/teacher/tasks/create?course_id=${classInfo.course_id}&teaching_class_id=${classId}">发布任务</button>` : ''}${section === 'questions' ? `<button class="teacher-btn" data-class-nav="#/teacher/questions?course_id=${classInfo.course_id}">完整题库</button>` : ''}</header>${content}`
      bindPanelNavigation()
    }

    document.querySelectorAll('[data-class-section]').forEach((button) => {
      button.onclick = () => {
        document.querySelectorAll('[data-class-section]').forEach((item) => item.classList.toggle('active', item === button))
        window.history.replaceState(null, '', `#/teacher/classes/${classId}?section=${button.dataset.classSection}`)
        renderSection(button.dataset.classSection)
      }
    })
    bindPanelNavigation()
    renderSection(currentSection())
  } catch (error) {
    renderDashboardLayout(app, {
      title: '班级工作区',
      menuItems: TEACHER_MENU_ITEMS,
      contentHTML: `<div class="teacher-dashboard-error"><b>班级工作区加载失败</b><p>${escapeHtml(error.message || '请稍后重试')}</p><button onclick="window.location.hash='#/teacher/system?tab=classes'">返回班级列表</button></div>`,
      user,
    })
  }
}
