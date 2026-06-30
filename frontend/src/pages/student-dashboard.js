// 学生端首页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

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

  const contentHTML = `
    <div class="dashboard-content">
      <!-- 欢迎横幅 -->
      <div class="welcome-banner">
        <div class="welcome-text">
          <h2>欢迎你，${displayName}</h2>
          <p>祝你学习愉快，今天也要加油哦！</p>
        </div>
        <div class="welcome-illustration">🎓</div>
      </div>

      <!-- 数据卡片 -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">68%</div>
          <div class="stat-label">学习进度</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">12</div>
          <div class="stat-label">已掌握知识点</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">5</div>
          <div class="stat-label">未掌握知识点</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">18</div>
          <div class="stat-label">错题数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">6.5h</div>
          <div class="stat-label">本周学习时长</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">15</div>
          <div class="stat-label">AI提问次数</div>
        </div>
      </div>

      <!-- 下方两栏 -->
      <div class="content-columns">
        <!-- 学习画像 -->
        <div class="card">
          <h3 class="card-title">📊 学习画像</h3>
          <div class="profile-list">
            <div class="profile-item">
              <span class="profile-label">学习能力</span>
              <span class="profile-value high">65.5</span>
            </div>
            <div class="profile-item">
              <span class="profile-label">科研能力</span>
              <span class="profile-value muted">暂未评估</span>
            </div>
            <div class="profile-item">
              <span class="profile-label">竞赛能力</span>
              <span class="profile-value muted">暂未评估</span>
            </div>
          </div>
        </div>

        <!-- 推荐学习任务 -->
        <div class="card">
          <h3 class="card-title">📋 推荐学习任务</h3>
          <ul class="task-list">
            <li class="task-item">
              <span class="task-dot"></span>
              <span>复习 PCA 主成分分析</span>
            </li>
            <li class="task-item">
              <span class="task-dot"></span>
              <span>完成 PCA 进阶练习</span>
            </li>
            <li class="task-item">
              <span class="task-dot"></span>
              <span>观看推荐视频讲解</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- 用户信息卡片 -->
      <div class="card user-info-card">
        <h3 class="card-title">📋 账户信息</h3>
        <div class="user-info-grid">
          <div class="info-item">
            <span class="info-label">用户名</span>
            <span class="info-value">${user.username || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">角色</span>
            <span class="info-value">学生</span>
          </div>
          <div class="info-item">
            <span class="info-label">真实姓名</span>
            <span class="info-value">${user.profile?.real_name || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">学院</span>
            <span class="info-value">${user.profile?.college || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">专业</span>
            <span class="info-value">${user.profile?.major || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">年级</span>
            <span class="info-value">${user.profile?.grade || '-'}</span>
          </div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '学生学习中心',
    menuItems,
    contentHTML,
    user,
  })
}
