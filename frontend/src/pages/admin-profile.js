// 管理员端个人中心页面

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { ADMIN_MENU_ITEMS } from '../utils/admin-menu.js'
import { resetUserPassword } from '../api/admin.js'
import { promptAdmin, notifyAdmin, confirmAdmin } from '../utils/admin-ui.js'
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

  document.getElementById('btn-change-password')?.addEventListener('click', async () => {
    const password = await promptAdmin({ title: '修改管理员密码', label: '新密码', placeholder: '至少 6 位字符', multiline: false })
    if (!password) return
    if (password.length < 6) { notifyAdmin('新密码至少需要 6 位字符', true); return }
    if (!(await confirmAdmin({ title: '确认修改密码', message: '修改后下次登录需使用新密码。', confirmLabel: '修改密码', danger: true }))) return
    try { await resetUserPassword(user.user_id, password); notifyAdmin('密码修改成功') } catch (error) { notifyAdmin(error.message || '密码修改失败', true) }
  })
}
