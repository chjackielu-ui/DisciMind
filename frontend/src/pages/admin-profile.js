// 管理员端个人中心页面

import { changePassword, getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { ADMIN_MENU_ITEMS } from '../utils/admin-menu.js'
import { notifyAdmin, openAdminDrawer } from '../utils/admin-ui.js'
import { escapeHtml } from '../utils/format.js'

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
      <div style="margin-bottom:12px;">
        <a href="#/admin/dashboard" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">返回管理看板</a>
      </div>
      <div class="section-header">
        <h2>个人中心</h2>
      </div>

      <div class="card user-info-card">
        <h3 class="card-title">账户信息</h3>
        <div class="user-info-grid">
          <div class="info-item">
            <span class="info-label">用户 ID</span>
            <span class="info-value">${escapeHtml(user.user_id || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-label">用户名</span>
            <span class="info-value">${escapeHtml(user.username || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-label">角色</span>
            <span class="info-value">管理员</span>
          </div>
          <div class="info-item">
            <span class="info-label">真实姓名</span>
            <span class="info-value">${escapeHtml(user.profile?.real_name || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-label">邮箱</span>
            <span class="info-value">${escapeHtml(user.email || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-label">手机号</span>
            <span class="info-value">${escapeHtml(user.phone || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-label">学院</span>
            <span class="info-value">${escapeHtml(user.profile?.college || '-')}</span>
          </div>
          <div class="info-item">
            <span class="info-label">专业</span>
            <span class="info-value">${escapeHtml(user.profile?.major || '-')}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">安全设置</h3>
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
              <div style="font-size:0.82rem;color:var(--stu-text-muted);">统一管理供应商、模型、Agent 与环境状态</div>
            </div>
            <a class="btn-sm btn-secondary" href="#/admin/ai-config">进入配置中心</a>
          </div>
        </div>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '个人中心',
    menuItems: ADMIN_MENU_ITEMS,
    contentHTML,
    user,
  })

  document.getElementById('btn-change-password')?.addEventListener('click', () => {
    openAdminDrawer({
      title: '修改管理员密码',
      submitLabel: '确认修改',
      content: `<div class="admin-form-grid">
        <div class="admin-field is-wide"><label for="admin-current-password">当前密码</label><input class="admin-input" id="admin-current-password" name="current_password" type="password" autocomplete="current-password" required></div>
        <div class="admin-field"><label for="admin-new-password">新密码</label><input class="admin-input" id="admin-new-password" name="new_password" type="password" autocomplete="new-password" minlength="6" required></div>
        <div class="admin-field"><label for="admin-confirm-password">确认新密码</label><input class="admin-input" id="admin-confirm-password" name="confirm_password" type="password" autocomplete="new-password" minlength="6" required></div>
      </div>`,
      onSubmit: async (formData) => {
        const currentPassword = String(formData.get('current_password') || '')
        const newPassword = String(formData.get('new_password') || '')
        const confirmPassword = String(formData.get('confirm_password') || '')
        if (newPassword.length < 6) throw new Error('新密码至少需要 6 位字符')
        if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致')
        await changePassword({ current_password: currentPassword, new_password: newPassword })
        notifyAdmin('密码修改成功，请重新登录')
        setTimeout(() => {
          clearAuth()
          window.location.hash = '#/login'
        }, 800)
        return true
      },
    })
  })
}
