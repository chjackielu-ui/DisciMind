// 管理员端首页

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

export async function renderAdminDashboard(app) {
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
    { label: '首页', icon: '🏠' },
    { label: '用户管理', icon: '👥' },
    { label: '课程管理', icon: '📚' },
    { label: '知识库管理', icon: '📖' },
    { label: 'AI模型配置', icon: '🤖' },
    { label: '系统日志', icon: '📋' },
  ]

  const contentHTML = `
    <div class="dashboard-content">
      <!-- 欢迎横幅 -->
      <div class="welcome-banner admin-banner">
        <div class="welcome-text">
          <h2>欢迎你，${displayName}</h2>
          <p>系统运行一切正常，请放心管理！</p>
        </div>
        <div class="welcome-illustration">🛡️</div>
      </div>

      <!-- 数据卡片 -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">120</div>
          <div class="stat-label">用户总数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">100</div>
          <div class="stat-label">学生数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">15</div>
          <div class="stat-label">教师数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">6</div>
          <div class="stat-label">课程数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">80</div>
          <div class="stat-label">知识库文档</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">500</div>
          <div class="stat-label">今日 AI 调用</div>
        </div>
      </div>

      <!-- 系统管理入口 -->
      <div class="card">
        <h3 class="card-title">⚙️ 系统管理入口</h3>
        <div class="admin-links">
          <div class="admin-link-item">
            <span class="admin-link-icon">👥</span>
            <div class="admin-link-info">
              <span class="admin-link-title">用户管理</span>
              <span class="admin-link-desc">管理学生、教师、管理员账号</span>
            </div>
          </div>
          <div class="admin-link-item">
            <span class="admin-link-icon">📚</span>
            <div class="admin-link-info">
              <span class="admin-link-title">课程管理</span>
              <span class="admin-link-desc">创建和维护课程信息</span>
            </div>
          </div>
          <div class="admin-link-item">
            <span class="admin-link-icon">📖</span>
            <div class="admin-link-info">
              <span class="admin-link-title">知识库管理</span>
              <span class="admin-link-desc">管理知识库文档与分类</span>
            </div>
          </div>
          <div class="admin-link-item">
            <span class="admin-link-icon">🤖</span>
            <div class="admin-link-info">
              <span class="admin-link-title">AI模型配置</span>
              <span class="admin-link-desc">配置大模型 API 与参数</span>
            </div>
          </div>
          <div class="admin-link-item">
            <span class="admin-link-icon">📋</span>
            <div class="admin-link-info">
              <span class="admin-link-title">操作日志</span>
              <span class="admin-link-desc">查看系统操作与运行日志</span>
            </div>
          </div>
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
            <span class="info-value">管理员</span>
          </div>
          <div class="info-item">
            <span class="info-label">真实姓名</span>
            <span class="info-value">${user.profile?.real_name || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">邮箱</span>
            <span class="info-value">${user.email || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">手机号</span>
            <span class="info-value">${user.phone || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">用户ID</span>
            <span class="info-value">${user.user_id || '-'}</span>
          </div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '系统管理中心',
    menuItems,
    contentHTML,
    user,
  })
}
