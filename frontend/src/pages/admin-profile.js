// 管理员端个人中心页面

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

const menuItems = [
  { label: '首页', icon: 'home', hash: '#/admin/dashboard' },
  { label: '用户管理', icon: 'user', hash: '#/admin/users' },
  { label: '课程管理', icon: 'book', hash: '#/admin/courses' },
  { label: '班级管理', icon: 'star', hash: '#/admin/classes' },
  { label: '知识库管理', icon: 'book', hash: '#/admin/knowledge' },
  { label: '操作日志', icon: 'alert', hash: '#/admin/logs' },
  { label: '通知管理', icon: 'message', hash: '#/admin/notifications' },
  { label: 'AI 配置', icon: 'message', hash: '#/admin/ai-config' },
]

export async function renderAdminProfile(app) {
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
      <div class="section-header">
        <h2>👤 个人中心</h2>
      </div>

      <div class="card user-info-card">
        <h3 class="card-title">📋 账户信息</h3>
        <div class="user-info-grid">
          <div class="info-item">
            <span class="info-label">用户 ID</span>
            <span class="info-value">${user.user_id || '-'}</span>
          </div>
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
            <span class="info-label">学院</span>
            <span class="info-value">${user.profile?.college || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">专业</span>
            <span class="info-value">${user.profile?.major || '-'}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">🔒 安全设置</h3>
        <div style="display:flex;flex-direction:column;gap:12px;padding:8px 0;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--stu-border);">
            <div>
              <div style="font-weight:600;color:var(--stu-text);">修改密码</div>
              <div style="font-size:0.82rem;color:var(--stu-text-muted);">定期更换密码可以提高账户安全性</div>
            </div>
            <button class="btn-sm btn-secondary" id="btn-change-password">修改密码</button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;">
            <div>
              <div style="font-weight:600;color:var(--stu-text);">AI 功能配置</div>
              <div style="font-size:0.82rem;color:var(--stu-text-muted);">该功能正在开发中，敬请期待</div>
            </div>
            <button class="btn-sm btn-secondary" style="opacity:0.5;cursor:not-allowed;" disabled>开发中</button>
          </div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '个人中心',
    menuItems,
    contentHTML,
    user,
  })

  document.getElementById('btn-change-password')?.addEventListener('click', () => {
    alert('该功能正在开发中，敬请期待')
  })
}
