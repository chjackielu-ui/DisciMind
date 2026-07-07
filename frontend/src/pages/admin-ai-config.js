// 管理员端 AI 配置页面（占位）
// AI 相关功能暂不实现，仅展示"开发中"提示

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

const menuItems = [
  { label: '首页', icon: 'home', hash: '#/admin/dashboard' },
  { label: '用户管理', icon: 'user', hash: '#/admin/users' },
  { label: '教学管理', icon: 'book', hash: '#/admin/courses', prefixMatch: '/admin/courses', children: [
      { label: '课程管理', hash: '#/admin/courses' },
      { label: '班级管理', hash: '#/admin/classes' },
    ]},
  { label: '系统管理', icon: 'settings', hash: '#/admin/knowledge', prefixMatch: '/admin/knowledge', children: [
      { label: '知识库管理', hash: '#/admin/knowledge' },
      { label: '操作日志', hash: '#/admin/logs' },
      { label: '通知管理', hash: '#/admin/notifications' },
      { label: 'AI 配置', hash: '#/admin/ai-config' },
      { label: '个人信息', hash: '#/admin/profile' },
    ]},
]

export async function renderAdminAiConfig(app) {
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

  const displayName = getUserDisplayName()

  const contentHTML = `
    <div class="dashboard-content">
      <div style="margin-bottom:12px;">
        <a href="#/admin/knowledge" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回系统管理</a>
      </div>
      <!-- 欢迎横幅 -->
      <div class="welcome-banner admin-banner">
        <div class="welcome-text">
          <h2>AI 模型配置</h2>
          <p>${displayName}，管理 AI 模型与 API 配置</p>
        </div>
        <div class="welcome-illustration"></div>
      </div>

      <!-- 开发中提示 -->
      <div class="card" style="text-align:center;padding:60px 24px;">
        <div style="font-size:4rem;margin-bottom:20px;"></div>
        <h3 style="color:var(--stu-dark);font-size:1.3rem;margin-bottom:12px;">该功能正在开发中，敬请期待</h3>
        <p style="color:var(--stu-text-muted);font-size:0.92rem;max-width:400px;margin:0 auto;line-height:1.8;">
          管理员端 AI 模型配置功能包含：<br />
          · AI 模型供应商管理（DeepSeek、讯飞星火、通义千问）<br />
          · Dify 智能体配置<br />
          · API Key 管理与加密存储<br />
          · 调用频率与配额控制<br />
          · AI 调用日志查看<br /><br />
          这些功能将在后续版本中逐步实现。
        </p>
      </div>

      <!-- 功能入口占位 -->
      <div class="card">
        <h3 class="card-title">规划中的功能模块</h3>
        <div class="admin-links">
          <div class="admin-link-item" style="opacity:0.6;cursor:default;">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">AI 模型供应商</span>
              <span class="admin-link-desc">配置与管理 AI 模型（开发中）</span>
            </div>
          </div>
          <div class="admin-link-item" style="opacity:0.6;cursor:default;">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">Dify 智能体配置</span>
              <span class="admin-link-desc">连接与管理 Dify 工作流（开发中）</span>
            </div>
          </div>
          <div class="admin-link-item" style="opacity:0.6;cursor:default;">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">AI 调用统计</span>
              <span class="admin-link-desc">查看 AI 服务调用情况（开发中）</span>
            </div>
          </div>
          <div class="admin-link-item" style="opacity:0.6;cursor:default;">
            <span class="admin-link-icon"></span>
            <div class="admin-link-info">
              <span class="admin-link-title">API 密钥管理</span>
              <span class="admin-link-desc">安全管理第三方 API 密钥（开发中）</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 账户信息 -->
      <div class="card user-info-card">
        <h3 class="card-title">账户信息</h3>
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
    title: 'AI 模型配置',
    menuItems,
    contentHTML,
    user,
  })
}


