// 学生端首页 — 全课程紧凑总览

import { getMe } from '../api/auth.js'
import { getStudentDashboard, getStudentCourses } from '../api/student.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatPercent, formatDate, recommendTypeLabel, isOverdue } from '../utils/format.js'
import { showToast } from '../utils/toast.js'

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/api\/?$/, '')

function clampPercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function safeNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function getAvatarUrl(user) {
  const url = user?.profile?.avatar_url || user?.avatar_url
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  return `${API_ORIGIN}${url.startsWith('/') ? url : '/' + url}`
}

function getInitial(name) {
  return String(name || '学').trim().slice(0, 1).toUpperCase()
}

function getDisplayName(user, dashboardUser) {
  return user?.profile?.real_name
    || dashboardUser?.real_name
    || getUserDisplayName()
    || user?.username
    || '同学'
}

function getAdminClassName(user) {
  const profile = user?.profile || {}
  return profile.admin_class?.class_name
    || profile.admin_class_name
    || profile.class_name
    || '未绑定行政班'
}

function getStudentNo(user) {
  return user?.profile?.student_no || user?.student_no || '未填写'
}

function buildMetricGrid(overview = {}) {
  const metrics = [
    { label: '课程数量', value: safeNumber(overview.course_count), hint: '已加入课程', tone: 'blue' },
    { label: '学习进度', value: formatPercent(overview.learning_progress), hint: '全课程平均', tone: 'green' },
    { label: '已掌握知识点', value: safeNumber(overview.mastered_knowledge_count), hint: '掌握良好以上', tone: 'green' },
    { label: '薄弱知识点', value: safeNumber(overview.weak_knowledge_count), hint: '建议优先巩固', tone: 'amber' },
    { label: '错题数量', value: safeNumber(overview.wrong_question_count), hint: '未掌握错题', tone: 'red' },
    { label: '本周学习', value: `${safeNumber(overview.weekly_study_hours)}h`, hint: '数据库学习记录', tone: 'blue' },
  ]

  return `
    <div class="home-metric-grid">
      ${metrics.map(item => `
        <article class="home-metric-card ${item.tone}">
          <span>${item.label}</span>
          <b>${escapeHtml(item.value)}</b>
          <em>${escapeHtml(item.hint)}</em>
        </article>
      `).join('')}
    </div>`
}

function buildQuickEntries(courses = []) {
  const hasCourse = courses.length > 0
  return `
    <div class="home-quick-grid">
      <button type="button" class="home-quick-card primary" data-home-nav="start-study">
        <span>立即开始学习</span>
        <b>${hasCourse ? '进入最近课程' : '查看课程'}</b>
      </button>
      <button type="button" class="home-quick-card" data-home-nav="start-practice">
        <span>开始做题</span>
        <b>智能练习</b>
      </button>
      <button type="button" class="home-quick-card" data-home-nav="ai-chat">
        <span>与 AI 对话</span>
        <b>学习助手</b>
      </button>
      <button type="button" class="home-quick-card" data-home-nav="wrong-questions">
        <span>错题巩固</span>
        <b>错题本</b>
      </button>
    </div>`
}

function buildProfileCard(user, displayName, overview = {}) {
  const avatarUrl = getAvatarUrl(user)
  const profile = user?.profile || {}
  const info = [
    { label: '姓名', value: displayName },
    { label: '行政班级', value: getAdminClassName(user) },
    { label: '学号', value: getStudentNo(user) },
    { label: '年级', value: profile.grade || '未填写' },
  ]

  return `
    <aside class="home-student-card">
      <div class="home-student-avatar">
        ${avatarUrl
          ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
          : `<span>${escapeHtml(getInitial(displayName))}</span>`}
      </div>
      <div class="home-student-name">${escapeHtml(displayName)}</div>
      <div class="home-student-role">学生端个人信息</div>
      <div class="home-student-info-list">
        ${info.map(item => `
          <div class="home-student-info-row">
            <span>${escapeHtml(item.label)}</span>
            <b>${escapeHtml(item.value)}</b>
          </div>
        `).join('')}
      </div>
      <div class="home-student-progress">
        <div>
          <span>全课程学习进度</span>
          <b>${formatPercent(overview.learning_progress)}</b>
        </div>
        <div class="home-progress-bar">
          <i style="width:${clampPercent(overview.learning_progress)}%"></i>
        </div>
      </div>
    </aside>`
}

function buildRecommendations(recommendations = []) {
  const list = recommendations.slice(0, 4)
  return `
    <section class="home-panel home-recommend-panel">
      <div class="home-panel-head">
        <div>
          <h3>推荐学习内容</h3>
          <p>来自数据库推荐记录，优先展示最新推荐。</p>
        </div>
        <button type="button" class="home-panel-link" data-home-nav="recommendations">查看更多</button>
      </div>
      ${list.length
        ? `<div class="home-rec-list">
            ${list.map(item => `
              <button type="button" class="home-rec-item" data-home-nav="recommendations">
                <span class="home-rec-tag ${escapeHtml(item.recommend_type || '')}">${escapeHtml(recommendTypeLabel(item.recommend_type))}</span>
                <b>${escapeHtml(item.title || '推荐内容')}</b>
                ${item.reason ? `<em>${escapeHtml(item.reason)}</em>` : ''}
              </button>
            `).join('')}
          </div>`
        : '<div class="home-empty-inline">暂无推荐内容，完成更多学习记录后会自动生成。</div>'}
    </section>`
}

function buildRecentTasks(tasks = []) {
  const list = tasks.slice(0, 5)
  return `
    <section class="home-panel home-task-panel">
      <div class="home-panel-head">
        <div>
          <h3>最近学习任务</h3>
          <p>展示已发布任务，便于快速进入答题。</p>
        </div>
      </div>
      ${list.length
        ? `<div class="home-task-list">
            ${list.map(task => `
              <div class="home-task-item">
                <div>
                  <b>${escapeHtml(task.task_title || '学习任务')}</b>
                  <span class="${isOverdue(task.deadline) ? 'overdue' : ''}">
                    ${task.deadline ? `${isOverdue(task.deadline) ? '已截止' : '截止'} ${formatDate(task.deadline, 'short')}` : '无截止时间'}
                  </span>
                </div>
                <button type="button" data-task-answer="${task.task_id}">开始答题</button>
              </div>
            `).join('')}
          </div>`
        : '<div class="home-empty-inline">暂无最近学习任务。</div>'}
    </section>`
}

function buildCourseProgress(courses = []) {
  return `
    <section class="home-panel home-course-panel">
      <div class="home-panel-head">
        <div>
          <h3>全部课程学习进度</h3>
          <p>首页固定展示全课程视图，不再切换到单门课程首页。</p>
        </div>
        <button type="button" class="home-panel-link" data-home-nav="courses">全部课程</button>
      </div>
      ${courses.length
        ? `<div class="home-course-grid">
            ${courses.map(course => {
              const progress = clampPercent(course.learning_progress ?? course.progress)
              const detail = course.progress_detail || {}
              const completed = detail.completed ?? course.completed_knowledge_count
              const total = detail.total ?? course.knowledge_point_count
              return `
                <button type="button" class="home-course-card" data-course-id="${course.course_id}">
                  <div class="home-course-title-row">
                    <b>${escapeHtml(course.course_name || '未命名课程')}</b>
                    <span>${progress}%</span>
                  </div>
                  <div class="home-progress-bar">
                    <i style="width:${progress}%"></i>
                  </div>
                  <div class="home-course-meta">
                    <span>${escapeHtml(course.course_code || '无课程编码')}</span>
                    <span>${completed != null && total != null ? `${completed}/${total} 知识点` : '知识点统计待更新'}</span>
                  </div>
                  ${course.last_position ? `<em>最近：${escapeHtml(course.last_position)}</em>` : ''}
                </button>`
            }).join('')}
          </div>`
        : '<div class="home-empty-inline">暂无课程，请等待教师加入教学班或课程。</div>'}
    </section>`
}

function buildWeakPoints(weakPoints = []) {
  const list = weakPoints.slice(0, 5)
  return `
    <section class="home-panel home-weak-panel">
      <div class="home-panel-head">
        <div>
          <h3>薄弱知识点</h3>
          <p>基于掌握度记录排序。</p>
        </div>
      </div>
      ${list.length
        ? `<div class="home-weak-list">
            ${list.map(item => `
              <div class="home-weak-item">
                <span>${escapeHtml(item.knowledge_point_name || '未命名知识点')}</span>
                <b>${safeNumber(item.mastery_score)}分</b>
              </div>
            `).join('')}
          </div>`
        : '<div class="home-empty-inline">暂未发现薄弱知识点。</div>'}
    </section>`
}

function buildPortraitSummary(portrait) {
  const scores = [
    { label: '学习能力', value: portrait?.learning_ability_score },
    { label: '科研能力', value: portrait?.research_ability_score },
    { label: '竞赛能力', value: portrait?.competition_ability_score },
  ]
  return `
    <section class="home-panel home-portrait-panel">
      <div class="home-panel-head">
        <div>
          <h3>学习画像摘要</h3>
          <p>跨课程画像均值。</p>
        </div>
        <button type="button" class="home-panel-link" data-home-nav="portrait">查看分析</button>
      </div>
      <div class="home-portrait-score-grid">
        ${scores.map(item => `
          <div>
            <span>${escapeHtml(item.label)}</span>
            <b>${item.value != null ? escapeHtml(item.value) : '待评估'}</b>
          </div>
        `).join('')}
      </div>
    </section>`
}

function buildErrorContent(message) {
  return `
    <div class="dashboard-content student-home-shell">
      <div class="error-state">
        <div class="error-icon">!</div>
        <p class="error-message">${escapeHtml(message || '学生首页数据加载失败')}</p>
        <button class="btn-retry" onclick="window.location.reload()">重新加载</button>
      </div>
    </div>`
}

function buildHomeContent({ user, displayName, dashboardData, courses }) {
  const overview = dashboardData?.overview || {}
  const recommendations = dashboardData?.recommendations || []
  const recentTasks = dashboardData?.recent_tasks || []
  const weakPoints = dashboardData?.weak_knowledge_points || []
  const portrait = dashboardData?.portrait || null

  return `
    <div class="dashboard-content student-home-shell">
      <section class="student-home-top">
        <div class="student-home-primary">
          <div class="student-home-title-row">
            <div>
              <span class="home-eyebrow">学习首页</span>
              <h2>欢迎回来，${escapeHtml(displayName)}</h2>
              <p>这里汇总你的全部课程、进度、推荐内容和待完成任务。</p>
            </div>
            <span class="home-sync-time">同步 ${formatDate(new Date().toISOString(), 'time')}</span>
          </div>
          ${buildMetricGrid(overview)}
          ${buildQuickEntries(courses)}
        </div>
        ${buildProfileCard(user, displayName, overview)}
      </section>

      <section class="home-two-column">
        ${buildRecommendations(recommendations)}
        ${buildRecentTasks(recentTasks)}
      </section>

      ${buildCourseProgress(courses)}

      <section class="home-two-column compact">
        ${buildWeakPoints(weakPoints)}
        ${buildPortraitSummary(portrait)}
      </section>
    </div>`
}

function bindHomeEvents(courses = []) {
  const main = document.getElementById('student-main')
  if (!main) return
  if (main._studentHomeClickHandler) {
    main.removeEventListener('click', main._studentHomeClickHandler)
  }

  const handler = (event) => {
    const nav = event.target.closest('[data-home-nav]')
    const courseCard = event.target.closest('[data-course-id]')
    const taskButton = event.target.closest('[data-task-answer]')

    if (taskButton) {
      const taskId = taskButton.dataset.taskAnswer
      if (taskId) window.location.hash = `#/student/tasks/${taskId}/answer`
      return
    }

    if (courseCard) {
      const courseId = courseCard.dataset.courseId
      if (courseId) window.location.hash = `#/student/courses/${courseId}`
      return
    }

    if (!nav) return
    const target = nav.dataset.homeNav
    if (target === 'start-study') {
      const firstCourse = courses[0]
      if (firstCourse?.course_id) window.location.hash = `#/student/courses/${firstCourse.course_id}`
      else {
        showToast('当前还没有可进入的课程', 'warning')
        window.location.hash = '#/student/courses'
      }
    } else if (target === 'start-practice') {
      window.location.hash = '#/student/practice'
    } else if (target === 'ai-chat') {
      window.location.hash = '#/student/ai-chat'
    } else if (target === 'wrong-questions') {
      window.location.hash = '#/student/wrong-questions'
    } else if (target === 'recommendations') {
      window.location.hash = '#/student/recommendations'
    } else if (target === 'courses') {
      window.location.hash = '#/student/courses'
    } else if (target === 'portrait') {
      window.location.hash = '#/student/portrait'
    }
  }

  main._studentHomeClickHandler = handler
  main.addEventListener('click', handler)
}

export async function renderStudentDashboard(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  const displayName = getDisplayName(user)
  renderDashboardLayout(app, {
    menuItems: STUDENT_MENU_ITEMS,
    contentHTML: `
      <div class="dashboard-content student-home-shell">
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p class="loading-text">正在加载学生首页数据...</p>
        </div>
      </div>`,
    user,
  })

  try {
    const [dashboardResult, coursesResult] = await Promise.all([
      getStudentDashboard(),
      getStudentCourses().catch(() => null),
    ])

    const dashboardData = dashboardResult.data || {}
    const richCourses = coursesResult?.data?.list || dashboardData.courses || []
    const contentHTML = buildHomeContent({
      user,
      displayName: getDisplayName(user, dashboardData.user),
      dashboardData,
      courses: richCourses,
    })

    renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML, user })
    bindHomeEvents(richCourses)
  } catch (err) {
    renderDashboardLayout(app, {
      menuItems: STUDENT_MENU_ITEMS,
      contentHTML: buildErrorContent(err.message),
      user,
    })
  }
}
