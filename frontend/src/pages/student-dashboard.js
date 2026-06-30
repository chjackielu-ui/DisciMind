// 学生端首页 — 从真实接口读取仪表盘数据
// 不再使用静态演示数据

import { getMe } from '../api/auth.js'
import { getStudentDashboard } from '../api/student.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

// HTML 转义工具
function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

// 格式化时长（小时）
function formatHours(h) {
  if (h == null || h === 0) return '0h'
  return h + 'h'
}

// 格式化分数
function formatScore(s) {
  if (s == null || s === '') return '暂未评估'
  return s
}

// 格式化截止时间
function formatDeadline(deadlineStr) {
  if (!deadlineStr) return ''
  const deadline = new Date(deadlineStr)
  const now = new Date()
  if (deadline < now) {
    return '<span class="task-deadline overdue">已截止</span>'
  }
  const dateStr = deadline.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  const timeStr = deadline.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return `<span class="task-deadline">截止: ${dateStr} ${timeStr}</span>`
}

// ========== 各部分构建函数 ==========

function buildStatCard(value, label) {
  return `
    <div class="stat-card">
      <div class="stat-value">${escapeHtml(String(value))}</div>
      <div class="stat-label">${escapeHtml(label)}</div>
    </div>
  `
}

function buildPortraitCard(portrait) {
  const learningScore = portrait?.learning_ability_score
  const researchScore = portrait?.research_ability_score
  const competitionScore = portrait?.competition_ability_score

  return `
    <div class="card">
      <h3 class="card-title">📊 学习画像</h3>
      <div class="profile-list">
        <div class="profile-item">
          <span class="profile-label">学习能力</span>
          <span class="profile-value ${learningScore != null ? 'high' : 'muted'}">${formatScore(learningScore)}</span>
        </div>
        <div class="profile-item">
          <span class="profile-label">科研能力</span>
          <span class="profile-value ${researchScore != null ? 'high' : 'muted'}">${formatScore(researchScore)}</span>
        </div>
        <div class="profile-item">
          <span class="profile-label">竞赛能力</span>
          <span class="profile-value ${competitionScore != null ? 'high' : 'muted'}">${formatScore(competitionScore)}</span>
        </div>
      </div>
    </div>
  `
}

function buildCoursesCard(courses) {
  if (!courses || courses.length === 0) {
    return `
      <div class="card">
        <h3 class="card-title">📚 当前课程</h3>
        <p class="empty-hint">暂无课程</p>
      </div>
    `
  }

  const items = courses
    .map(
      (c) => `
    <div class="course-item">
      <div class="course-name">${escapeHtml(c.course_name)}</div>
      ${c.course_code ? `<div class="course-code">${escapeHtml(c.course_code)}</div>` : ''}
      ${c.description ? `<div class="course-desc">${escapeHtml(c.description)}</div>` : ''}
    </div>`
    )
    .join('')

  return `
    <div class="card">
      <h3 class="card-title">📚 当前课程</h3>
      <div class="course-list">${items}</div>
    </div>
  `
}

function buildWeakKnowledgeCard(points) {
  if (!points || points.length === 0) {
    return `
      <div class="card">
        <h3 class="card-title">⚠️ 薄弱知识点</h3>
        <p class="empty-hint">暂无薄弱知识点</p>
      </div>
    `
  }

  const items = points
    .map(
      (p) => `
    <div class="kp-item">
      <span class="kp-name">${escapeHtml(p.knowledge_point_name || '未知知识点')}</span>
      <span class="kp-score">${p.mastery_score != null ? p.mastery_score + '分' : '-'}</span>
    </div>`
    )
    .join('')

  return `
    <div class="card">
      <h3 class="card-title">⚠️ 薄弱知识点</h3>
      <div class="kp-list">${items}</div>
    </div>
  `
}

function buildRecommendationsCard(recommendations) {
  if (!recommendations || recommendations.length === 0) {
    return `
      <div class="card">
        <h3 class="card-title">⭐ 推荐学习内容</h3>
        <p class="empty-hint">暂无推荐内容</p>
      </div>
    `
  }

  const items = recommendations
    .map(
      (r) => `
    <div class="rec-item">
      <div class="rec-title">${escapeHtml(r.title)}</div>
      ${r.reason ? `<div class="rec-reason">${escapeHtml(r.reason)}</div>` : ''}
    </div>`
    )
    .join('')

  return `
    <div class="card">
      <h3 class="card-title">⭐ 推荐学习内容</h3>
      <div class="rec-list">${items}</div>
    </div>
  `
}

function buildRecentTasksCard(tasks) {
  if (!tasks || tasks.length === 0) {
    return `
      <div class="card">
        <h3 class="card-title">📋 最近学习任务</h3>
        <p class="empty-hint">暂无学习任务</p>
      </div>
    `
  }

  const items = tasks
    .map(
      (t) => `
    <div class="task-item">
      <span class="task-dot ${t.status !== 'published' ? 'pending' : ''}"></span>
      <span>${escapeHtml(t.task_title)}</span>
      ${formatDeadline(t.deadline)}
    </div>`
    )
    .join('')

  return `
    <div class="card">
      <h3 class="card-title">📋 最近学习任务</h3>
      <div class="task-list">${items}</div>
    </div>
  `
}

function buildUserInfoCard(apiUser) {
  return `
    <div class="card user-info-card">
      <h3 class="card-title">📋 账户信息</h3>
      <div class="user-info-grid">
        <div class="info-item">
          <span class="info-label">用户名</span>
          <span class="info-value">${escapeHtml(apiUser.username || '-')}</span>
        </div>
        <div class="info-item">
          <span class="info-label">角色</span>
          <span class="info-value">学生</span>
        </div>
        <div class="info-item">
          <span class="info-label">真实姓名</span>
          <span class="info-value">${escapeHtml(apiUser.real_name || '-')}</span>
        </div>
      </div>
    </div>
  `
}

// ========== 主渲染函数 ==========

export async function renderStudentDashboard(app) {
  // 先从 localStorage 读取用户
  let user = getUser()

  // 尝试从后端获取最新用户信息
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? localStorage.getItem('token') : '', user)
  } catch {
    // 如果获取失败且没有本地用户，跳转登录页
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
    // 否则使用本地缓存的用户信息继续渲染
  }

  const displayName = getUserDisplayName()

  const menuItems = [
    { label: '首页', icon: '🏠' },
    { label: '我的课程', icon: '📚' },
    { label: '学习画像', icon: '📊' },
    { label: '错题本', icon: '📝' },
    { label: 'AI问答', icon: '🤖' },
    { label: '个性化推荐', icon: '⭐' },
  ]

  // 获取仪表盘数据
  let dashboardData = null
  let loadError = false
  try {
    const dashResult = await getStudentDashboard()
    dashboardData = dashResult.data
  } catch (err) {
    console.error('获取学生首页数据失败:', err.message)
    loadError = true
  }

  // 构建内容 HTML
  let contentHTML
  if (loadError || !dashboardData) {
    contentHTML = `
      <div class="dashboard-content">
        <div class="welcome-banner">
          <div class="welcome-text">
            <h2>欢迎你，${escapeHtml(displayName)}</h2>
            <p>数据加载失败，请稍后重试</p>
          </div>
          <div class="welcome-illustration">⚠️</div>
        </div>
        <div class="error-state">
          <div class="error-icon">😞</div>
          <p class="error-message">学生首页数据加载失败，请稍后重试。</p>
          <button class="btn-retry" onclick="window.location.reload()">重新加载</button>
        </div>
      </div>
    `
  } else {
    const { user: apiUser, overview, portrait, courses, weak_knowledge_points, recommendations, recent_tasks } = dashboardData
    const welcomeName = apiUser?.real_name || displayName

    contentHTML = `
      <div class="dashboard-content">
        <!-- 欢迎横幅 -->
        <div class="welcome-banner">
          <div class="welcome-text">
            <h2>欢迎你，${escapeHtml(welcomeName)}</h2>
            <p>祝你学习愉快，今天也要加油哦！</p>
          </div>
          <div class="welcome-illustration">🎓</div>
        </div>

        <!-- 数据概览卡片 -->
        <div class="stats-grid">
          ${buildStatCard(overview.course_count, '课程数量')}
          ${buildStatCard(overview.learning_progress + '%', '学习进度')}
          ${buildStatCard(overview.mastered_knowledge_count, '已掌握知识点')}
          ${buildStatCard(overview.weak_knowledge_count, '薄弱知识点')}
          ${buildStatCard(overview.wrong_question_count, '错题数量')}
          ${buildStatCard(formatHours(overview.weekly_study_hours), '本周学习时长')}
          ${buildStatCard(overview.ai_question_count, 'AI提问次数')}
        </div>

        <!-- 双栏内容区 -->
        <div class="content-columns">
          <div class="column-stack">
            ${buildPortraitCard(portrait)}
            ${buildCoursesCard(courses)}
            ${buildWeakKnowledgeCard(weak_knowledge_points)}
          </div>
          <div class="column-stack">
            ${buildRecommendationsCard(recommendations)}
            ${buildRecentTasksCard(recent_tasks)}
          </div>
        </div>

        <!-- 账户信息卡片 -->
        ${buildUserInfoCard(apiUser || {})}
      </div>
    `
  }

  renderDashboardLayout(app, {
    title: '学生学习中心',
    menuItems,
    contentHTML,
    user,
  })
}
