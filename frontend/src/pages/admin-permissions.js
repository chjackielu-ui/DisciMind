import {
  getAdminRbacOverview,
  updateAdminUserRoles,
  updateAdminRolePermissions,
} from '../api/admin.js'
import { getUser } from '../utils/auth.js'
import { loadAdminAccess, invalidateAdminAccess } from '../utils/admin-access.js'
import {
  requireAdminUser,
  renderAdminPage,
  notifyAdmin,
  openAdminDrawer,
  emptyHTML,
  escapeHtml,
  statusBadge,
} from '../utils/admin-ui.js'

const MODULE_LABEL = {
  dashboard: '驾驶舱', users: '用户', teaching: '教学', 'ai.providers': 'AI 供应商',
  'ai.secrets': 'AI 密钥', 'ai.models': 'AI 模型', agents: 'Agent', traces: '证据链',
  workflows: '学习流', knowledge: '知识', interventions: '干预', evaluations: '评测',
  experiments: '实验', assets: '教学资产', risks: '风险', audit: '审计', system: '系统',
}

function roleBadges(roles) {
  if (!roles?.length) return '<span class="admin-badge is-danger">未分配</span>'
  return roles.map((role) => `<span class="admin-badge is-info">${escapeHtml(role.name)}</span>`).join(' ')
}

function overviewHTML(data, canManage) {
  const roles = data.roles || []
  const permissions = data.permissions || []
  const admins = data.admins || []
  const uncovered = admins.filter((admin) => !admin.roles?.length).length
  return `
    <div class="admin-page-header">
      <div><h2>角色与权限</h2><p>管理员必须通过显式角色获得权限；菜单、前端路由与后端接口使用同一权限目录。</p></div>
      <button class="admin-button is-secondary" id="rbac-refresh" type="button">刷新</button>
    </div>
    <div class="admin-rbac-summary">
      <article><span>内置角色</span><strong>${roles.filter((role) => role.built_in).length}</strong></article>
      <article><span>权限项</span><strong>${permissions.length}</strong></article>
      <article><span>管理员</span><strong>${admins.length}</strong></article>
      <article class="${uncovered ? 'is-warning' : ''}"><span>未显式授权</span><strong>${uncovered}</strong></article>
    </div>
    ${!canManage ? '<div class="admin-inline-warning"><div><strong>当前为只读权限视图</strong><p>需要 admin.system.manage 才能更改管理员角色或角色权限。</p></div></div>' : ''}
    <section class="admin-card">
      <div class="admin-card-header"><div><h3>管理员角色分配</h3><p>禁用账号和过期角色不会产生有效权限。</p></div></div>
      ${admins.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>管理员</th><th>账号状态</th><th>显式角色</th><th>有效期</th>${canManage ? '<th>操作</th>' : ''}</tr></thead><tbody>
        ${admins.map((admin) => `<tr><td><strong>${escapeHtml(admin.real_name)}</strong><small>${escapeHtml(admin.username)} · ID ${admin.user_id}</small></td><td>${statusBadge(admin.status)}</td><td><div class="admin-rbac-badges">${roleBadges(admin.roles)}</div></td><td>${escapeHtml(admin.roles?.find((role) => role.expires_at)?.expires_at || '长期有效')}</td>${canManage ? `<td><button class="admin-button is-secondary" type="button" data-edit-admin="${admin.user_id}">分配角色</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>` : emptyHTML('暂无管理员', '当前数据库中没有管理员账号。')}
    </section>
    <section class="admin-card">
      <div class="admin-card-header"><div><h3>内置角色权限矩阵</h3><p>敏感权限会单独标记；超级管理员始终保留完整权限。</p></div></div>
      ${roles.length ? `<div class="admin-rbac-role-grid">${roles.map((role) => `<article class="admin-rbac-role-card"><header><div><h3>${escapeHtml(role.name)}</h3><code>${escapeHtml(role.role_code)}</code></div>${statusBadge(role.enabled ? 'enabled' : 'disabled')}</header><p>${escapeHtml(role.description || '暂无说明')}</p><dl><div><dt>权限</dt><dd>${role.permission_keys.length}</dd></div><div><dt>已分配管理员</dt><dd>${role.assigned_user_count}</dd></div></dl>${canManage ? `<button class="admin-button is-secondary" type="button" data-edit-role="${escapeHtml(role.role_code)}">配置权限</button>` : ''}</article>`).join('')}</div>` : emptyHTML('暂无角色', 'RBAC 角色目录尚未初始化。')}
    </section>`
}

function assignmentDrawer(admin, roles) {
  const selected = new Set((admin.roles || []).map((role) => role.role_code))
  const expiration = admin.roles?.find((role) => role.expires_at)?.expires_at
  const localExpiration = expiration ? new Date(expiration).toISOString().slice(0, 16) : ''
  return `<div class="admin-rbac-option-list">${roles.map((role) => `<label><input type="checkbox" name="role_codes" value="${escapeHtml(role.role_code)}" ${selected.has(role.role_code) ? 'checked' : ''}><span><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || role.role_code)}</small></span></label>`).join('')}</div><div class="admin-field"><label>统一有效期（可选）</label><input class="admin-input" type="datetime-local" name="expires_at" value="${escapeHtml(localExpiration)}"><small class="admin-help">留空表示长期有效。所有本次分配的角色采用同一有效期。</small></div>`
}

function permissionDrawer(role, permissions) {
  const selected = new Set(role.permission_keys || [])
  const groups = permissions.reduce((map, permission) => {
    if (!map.has(permission.module)) map.set(permission.module, [])
    map.get(permission.module).push(permission)
    return map
  }, new Map())
  return `<div class="admin-rbac-permission-groups">${[...groups.entries()].map(([module, items]) => `<fieldset><legend>${escapeHtml(MODULE_LABEL[module] || module)}</legend>${items.map((permission) => `<label><input type="checkbox" name="permission_keys" value="${escapeHtml(permission.permission_key)}" ${selected.has(permission.permission_key) ? 'checked' : ''} ${role.role_code === 'super_admin' ? 'disabled' : ''}><span><strong>${escapeHtml(permission.name)}</strong><code>${escapeHtml(permission.permission_key)}</code></span>${permission.sensitive ? '<em>敏感</em>' : ''}</label>`).join('')}</fieldset>`).join('')}</div>${role.role_code === 'super_admin' ? '<div class="admin-inline-warning"><div><strong>超级管理员保护</strong><p>该角色必须永久保留完整权限，不能取消选中。</p></div></div>' : ''}`
}

export async function renderAdminPermissions(app) {
  const user = await requireAdminUser()
  if (!user) return
  let data = null
  let access = await loadAdminAccess(user.user_id)

  renderAdminPage(app, {
    user,
    title: '角色与权限',
    contentHTML: '<div class="admin-page" id="admin-rbac-root"><div class="admin-skeleton"></div></div>',
  })
  const root = document.getElementById('admin-rbac-root')
  if (!root) return

  const canManage = () => access.permissions.includes('admin.system.manage')

  const bind = () => {
    root.querySelector('#rbac-refresh')?.addEventListener('click', load)
    root.querySelectorAll('[data-edit-admin]').forEach((button) => button.addEventListener('click', () => {
      const admin = data.admins.find((item) => item.user_id === Number(button.dataset.editAdmin))
      if (!admin) return
      openAdminDrawer({
        title: `分配角色 · ${admin.real_name}`,
        content: assignmentDrawer(admin, data.roles.filter((role) => role.enabled)),
        onSubmit: async (formData) => {
          const roleCodes = formData.getAll('role_codes').map(String)
          const expiresValue = String(formData.get('expires_at') || '').trim()
          await updateAdminUserRoles(admin.user_id, {
            role_codes: roleCodes,
            expires_at: expiresValue ? new Date(expiresValue).toISOString() : null,
          })
          invalidateAdminAccess()
          access = await loadAdminAccess(getUser()?.user_id, { force: true })
          notifyAdmin('管理员角色已更新并写入审计日志')
          await load()
          return true
        },
      })
    }))
    root.querySelectorAll('[data-edit-role]').forEach((button) => button.addEventListener('click', () => {
      const role = data.roles.find((item) => item.role_code === button.dataset.editRole)
      if (!role) return
      openAdminDrawer({
        title: `配置权限 · ${role.name}`,
        content: permissionDrawer(role, data.permissions),
        onSubmit: async (formData) => {
          const permissionKeys = role.role_code === 'super_admin'
            ? [...role.permission_keys]
            : formData.getAll('permission_keys').map(String)
          await updateAdminRolePermissions(role.role_code, { permission_keys: permissionKeys })
          invalidateAdminAccess()
          access = await loadAdminAccess(getUser()?.user_id, { force: true })
          notifyAdmin('角色权限已更新并写入审计日志')
          await load()
          return true
        },
      })
    }))
  }

  async function load() {
    root.innerHTML = '<div class="admin-skeleton"></div>'
    try {
      const result = await getAdminRbacOverview()
      data = result.data || { roles: [], permissions: [], admins: [] }
      root.innerHTML = overviewHTML(data, canManage())
      bind()
    } catch (error) {
      root.innerHTML = `<div class="admin-error"><div><strong>角色权限加载失败</strong><p>${escapeHtml(error.message)}</p><button class="admin-button is-secondary" id="rbac-retry" type="button">重试</button></div></div>`
      root.querySelector('#rbac-retry')?.addEventListener('click', load)
    }
  }

  await load()
}
