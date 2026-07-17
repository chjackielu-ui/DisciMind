// 管理员端 — 用户管理页面（完整功能版 V2）
// 按需求文档 FR-USER-001：分角色 Tab 管理 + 精确搜索 + 账号生命周期管理
// 布局对齐学生端页面结构

import { getMe } from '../api/auth.js'
import {
  getAdminUsers,
  createAdminUser,
  updateAdminUser,
  updateUserStatus,
  resetUserPassword,
  deleteUser,
  getAdminClasses,
  getAdminRbacOverview,
} from '../api/admin.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { escapeHtml, formatDate } from '../utils/format.js'
import { ADMIN_MENU_ITEMS } from '../utils/admin-menu.js'
import { getIcon } from '../utils/icons.js'
import { loadAdminAccess } from '../utils/admin-access.js'

const ROLE_LABEL = { admin: '管理员', teacher: '教师', student: '学生' }
const ROLE_ORDER = ['student', 'teacher', 'admin']

function showToast(message, type = 'success') {
  const container = document.getElementById('admin-toast-container')
  if (!container) return
  const toast = document.createElement('div')
  toast.className = `toast-item toast-${type}`
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => { if (toast.parentNode) toast.remove() }, 3000)
}

// ========================
// 统计概览条
// ========================
function buildOverviewBar(stats = {}) {
  return `<div class="courses-overview-bar">
    <div class="courses-overview-item"><div class="overview-icon blue">${getIcon('user')}</div><div><div class="overview-value">${stats.total || 0}</div><div class="overview-label">用户总数</div></div></div>
    <div class="courses-overview-item"><div class="overview-icon green">${getIcon('book')}</div><div><div class="overview-value">${stats.student_count || 0}</div><div class="overview-label">学生</div></div></div>
    <div class="courses-overview-item"><div class="overview-icon amber">${getIcon('edit')}</div><div><div class="overview-value">${stats.teacher_count || 0}</div><div class="overview-label">教师</div></div></div>
    <div class="courses-overview-item"><div class="overview-icon purple">${getIcon('settings')}</div><div><div class="overview-value">${stats.admin_count || 0}</div><div class="overview-label">管理员</div></div></div>
    <div class="courses-overview-item"><div class="overview-icon red">${getIcon('alert')}</div><div><div class="overview-value">${stats.disabled_count || 0}</div><div class="overview-label">已禁用</div></div></div>
  </div>`
}

// ========================
// 精确搜索栏（按角色切换字段）
// ========================
function buildSearchBar(activeTab, filters = {}, canManageUsers = false, canManageAdmins = false) {
  const keywordPlaceholder = activeTab === 'student' ? '搜索姓名、学号...'
    : activeTab === 'teacher' ? '搜索姓名、工号...'
    : activeTab === 'admin' ? '搜索姓名...'
    : '搜索用户名、姓名、邮箱、手机号...'

  let preciseFieldsHTML = ''
  if (activeTab === 'student') {
    preciseFieldsHTML = `
      <input type="text" id="filter-real-name" placeholder="姓名" value="${escapeHtml(filters.real_name || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
      <input type="text" id="filter-student-no" placeholder="学号" value="${escapeHtml(filters.student_no || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
      <input type="text" id="filter-college" placeholder="学院" value="${escapeHtml(filters.college || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
      <input type="text" id="filter-major" placeholder="专业" value="${escapeHtml(filters.major || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
      <input type="text" id="filter-grade" placeholder="年级" value="${escapeHtml(filters.grade || '')}" style="width:70px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
      <input type="text" id="filter-class-name" placeholder="班级" value="${escapeHtml(filters.class_name || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
    `
  } else if (activeTab === 'teacher') {
    preciseFieldsHTML = `
      <input type="text" id="filter-real-name" placeholder="姓名" value="${escapeHtml(filters.real_name || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
      <input type="text" id="filter-teacher-no" placeholder="工号" value="${escapeHtml(filters.teacher_no || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
      <input type="text" id="filter-college" placeholder="学院" value="${escapeHtml(filters.college || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
    `
  } else if (activeTab === 'admin') {
    preciseFieldsHTML = `
      <input type="text" id="filter-real-name" placeholder="姓名" value="${escapeHtml(filters.real_name || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />
    `
  }

  return `<div class="card" style="margin-bottom:20px;padding:14px 20px;">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <div class="search-box" style="flex:1;min-width:180px;">
        <span class="search-icon">${getIcon('search')}</span>
        <input type="text" id="input-keyword" placeholder="${keywordPlaceholder}" value="${escapeHtml(filters.keyword || '')}" />
      </div>
      ${preciseFieldsHTML}
      <select id="select-status" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;min-width:90px;">
        <option value="all" ${filters.status === 'all' || !filters.status ? 'selected' : ''}>全部状态</option>
        <option value="active" ${filters.status === 'active' ? 'selected' : ''}>正常</option>
        <option value="disabled" ${filters.status === 'disabled' ? 'selected' : ''}>已禁用</option>
      </select>
      <button class="btn btn-primary" id="btn-search" style="padding:8px 16px;font-size:0.85rem;white-space:nowrap;">${getIcon('search')} 搜索</button>
      <button class="btn" id="btn-reset" style="border:1px solid var(--border);padding:8px 12px;font-size:0.85rem;white-space:nowrap;">重置</button>
      ${canManageUsers && (activeTab !== 'admin' || canManageAdmins) ? `<button class="btn btn-primary" id="btn-create-user" style="margin-left:auto;padding:8px 16px;font-size:0.85rem;white-space:nowrap;">${getIcon('user')} 新建${ROLE_LABEL[activeTab] || '用户'}</button>` : ''}
    </div>
  </div>`
}

// ========================
// 用户表格
// ========================
function buildUserRow(u, activeTab, { canManageUsers = false, canManageAdmins = false, currentUserId = null } = {}) {
  const roleClass = `tag tag-${u.role}`
  const roleLabel = ROLE_LABEL[u.role] || u.role
  const statusClass = u.status === 'active' ? 'tag tag-active' : 'tag tag-disabled'
  const statusLabel = u.status === 'active' ? '正常' : '已禁用'
  const realName = u.real_name || '-'
  const studentNo = u.student_no || '-'
  const teacherNo = u.teacher_no || '-'
  const college = u.college || '-'
  const gender = u.gender === 'male' ? '男' : u.gender === 'female' ? '女' : '-'

  let extraCols = ''
  if (activeTab === 'student' || activeTab === 'all') {
    extraCols = `<td>${escapeHtml(studentNo)}</td><td>${escapeHtml(college)}</td><td>${escapeHtml(u.major || '-')}</td><td>${escapeHtml(u.grade || '-')}</td><td>${escapeHtml(u.admin_class_name || '-')}</td>`
  } else if (activeTab === 'teacher') {
    extraCols = `<td>${escapeHtml(teacherNo)}</td><td>${escapeHtml(college)}</td><td>${escapeHtml(gender)}</td>`
  } else if (activeTab === 'admin') {
    extraCols = `<td>${escapeHtml(gender)}</td>`
  }

  const statusActionLabel = u.status === 'active' ? '禁用' : '启用'
  const canManageRow = canManageUsers && (u.role !== 'admin' || canManageAdmins)
  const isCurrentAdmin = u.role === 'admin' && Number(u.user_id) === Number(currentUserId)
  const actions = canManageRow ? `<div class="action-btns">
    <button class="btn-edit-user" data-user-id="${u.user_id}" data-username="${escapeHtml(u.username)}" data-role="${u.role}">编辑</button>
    <button class="btn-reset-pwd" data-user-id="${u.user_id}" data-username="${escapeHtml(u.username)}">重置密码</button>
    ${isCurrentAdmin ? '' : `<button class="btn-toggle-status" data-user-id="${u.user_id}" data-username="${escapeHtml(u.username)}" data-status="${u.status || 'active'}">${statusActionLabel}</button><button class="btn-delete" data-user-id="${u.user_id}" data-username="${escapeHtml(u.username)}" data-role="${u.role}">移除</button>`}
    ${u.role === 'admin' && canManageAdmins ? '<a class="btn-edit-user" href="#/admin/permissions">角色权限</a>' : ''}
  </div>` : '<span class="tag tag-disabled">只读</span>'

  return `<tr>
    <td>${escapeHtml(String(u.user_id || ''))}</td>
    <td>${escapeHtml(u.username || '-')}</td>
    <td>${escapeHtml(realName)}</td>
    <td><span class="${roleClass}">${roleLabel}</span></td>
    ${extraCols}
    <td>${escapeHtml(u.email || '-')}</td>
    <td><span class="${statusClass}">${statusLabel}</span></td>
    <td>${formatDate(u.created_at)}</td>
    <td>${actions}</td>
  </tr>`
}

function buildTableHead(activeTab) {
  let extraHead = ''
  if (activeTab === 'student' || activeTab === 'all') {
    extraHead = '<th>学号</th><th>学院</th><th>专业</th><th>年级</th><th>班级</th>'
  } else if (activeTab === 'teacher') {
    extraHead = '<th>工号</th><th>学院</th><th>性别</th>'
  } else if (activeTab === 'admin') {
    extraHead = '<th>性别</th>'
  }
  return `<tr>
    <th>ID</th><th>用户名</th><th>姓名</th><th>角色</th>
    ${extraHead}
    <th>邮箱</th><th>状态</th><th>创建时间</th><th style="min-width:260px;">操作</th>
  </tr>`
}

// ========================
// 模态框
// ========================
function buildCreateEditModal(targetUser, activeTab, {
  canManageAdmins = false,
  adminClasses = [],
  adminRoles = [],
} = {}) {
  const isEdit = !!targetUser
  const title = isEdit ? `编辑用户 — ${escapeHtml(targetUser.username)}` : '新建用户'
  const u = targetUser || {}
  const role = u.role || (activeTab !== 'all' ? activeTab : 'student')
  const roleOptions = [
    '<option value="student">学生</option>',
    '<option value="teacher">教师</option>',
    canManageAdmins ? '<option value="admin">管理员</option>' : '',
  ].filter(Boolean).join('').replace(`value="${role}"`, `value="${role}" selected`)
  const classOptions = adminClasses.map((item) => `<option value="${item.admin_class_id}" ${Number(u.admin_class_id) === Number(item.admin_class_id) ? 'selected' : ''}>${escapeHtml(item.class_name)}${item.grade ? ` · ${escapeHtml(item.grade)}` : ''}</option>`).join('')
  const assignedRoles = (u.admin_roles || []).map((item) => item.role_code)
  const roleAssignmentHTML = isEdit
    ? `<div class="admin-inline-warning"><div><strong>管理员角色由权限中心维护</strong><p>${assignedRoles.length ? assignedRoles.map(escapeHtml).join('、') : '当前未分配有效角色'}。保存资料后可前往“角色与权限”调整。</p></div></div>`
    : `<div class="admin-rbac-option-list">${adminRoles.map((item) => `<label><input type="checkbox" name="admin_role_codes" value="${escapeHtml(item.role_code)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || item.role_code)}</small></span></label>`).join('')}</div>${adminRoles.length ? '' : '<div class="admin-inline-warning"><div><strong>角色目录不可用</strong><p>无法创建未分配角色的管理员，请刷新后重试。</p></div></div>'}`

  return `<div class="modal-overlay" id="modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center;">
    <div style="background:#fff;border-radius:16px;padding:28px;width:580px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="font-size:1.2rem;margin:0;">${title}</h3>
        <button type="button" id="btn-modal-close" aria-label="关闭用户表单" style="border:none;background:none;color:#999;cursor:pointer;padding:4px;line-height:1;">${getIcon('close')}</button>
      </div>
      <form id="user-form">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
          <div class="form-group">
            <label>用户名 ${!isEdit ? '<span class="required">*</span>' : ''}</label>
            <input type="text" id="form-username" required ${isEdit ? 'readonly style="background:#f5f5f5;"' : ''} value="${escapeHtml(u.username || '')}" placeholder="登录用户名" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          </div>
          <div class="form-group">
            <label>角色${!isEdit ? ' <span class="required">*</span>' : ''}</label>
            <select id="form-role" ${isEdit ? 'disabled' : ''} style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:${isEdit ? '#f5f5f5' : '#fff'};box-sizing:border-box;">
              ${roleOptions}
            </select>
          </div>
          ${!isEdit ? `
          <div class="form-group" style="grid-column:1/-1;">
            <label>密码 <span class="required">*</span></label>
            <input type="password" id="form-password" required placeholder="至少6位" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          </div>` : ''}
          <div class="form-group">
            <label>真实姓名 <span class="required">*</span></label>
            <input type="text" id="form-real-name" required value="${escapeHtml(u.real_name || '')}" placeholder="真实姓名" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          </div>
          <div class="form-group">
            <label>邮箱</label>
            <input type="email" id="form-email" value="${escapeHtml(u.email || '')}" placeholder="email@example.com" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          </div>
          <div class="form-group">
            <label>手机号</label>
            <input type="text" id="form-phone" value="${escapeHtml(u.phone || '')}" placeholder="手机号" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          </div>
          <div class="form-group">
            <label>学院</label>
            <input type="text" id="form-college" value="${escapeHtml(u.college || '')}" placeholder="学院" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />
          </div>
          <div class="form-group">
            <label>性别</label>
            <select id="form-gender" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box;">
              <option value="" ${!u.gender ? 'selected' : ''}>未设置</option>
              <option value="male" ${u.gender === 'male' ? 'selected' : ''}>男</option>
              <option value="female" ${u.gender === 'female' ? 'selected' : ''}>女</option>
            </select>
          </div>
          <div class="form-role-fields" data-role-section="student" style="display:${role === 'student' ? 'contents' : 'none'};">
            <div class="form-group"><label>学号</label><input type="text" id="form-student-no" value="${escapeHtml(u.student_no || '')}" placeholder="学号" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
            <div class="form-group"><label>专业</label><input type="text" id="form-major" value="${escapeHtml(u.major || '')}" placeholder="专业" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
            <div class="form-group"><label>年级</label><input type="text" id="form-grade" value="${escapeHtml(u.grade || '')}" placeholder="年级" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
            <div class="form-group"><label>行政班级</label><select id="form-admin-class" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box;"><option value="">暂不分班</option>${classOptions}</select></div>
          </div>
          <div class="form-role-fields" data-role-section="teacher" style="display:${role === 'teacher' ? 'contents' : 'none'};">
            <div class="form-group"><label>工号</label><input type="text" id="form-teacher-no" value="${escapeHtml(u.teacher_no || '')}" placeholder="工号" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
          </div>
          <div class="form-role-fields" data-role-section="admin" style="display:${role === 'admin' ? 'block' : 'none'};grid-column:1/-1;">
            <div class="form-group"><label>管理员角色 ${isEdit ? '' : '<span class="required">*</span>'}</label>${roleAssignmentHTML}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;padding-top:16px;border-top:1px solid var(--border);">
          <button type="button" class="btn" id="btn-modal-cancel" style="border:1px solid var(--border);padding:8px 20px;border-radius:8px;background:transparent;cursor:pointer;">取消</button>
          <button type="submit" class="btn btn-primary" style="padding:8px 24px;border:none;border-radius:8px;cursor:pointer;">保存</button>
        </div>
      </form>
    </div>
  </div>`
}

function buildResetPwdModal(targetUser) {
  return `<div class="modal-overlay" id="modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center;">
    <div style="background:#fff;border-radius:16px;padding:28px;width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <h3 style="margin-bottom:16px;">重置密码</h3>
      <p style="margin-bottom:16px;color:var(--text-secondary);font-size:0.9rem;">为用户 <strong>${escapeHtml(targetUser.username)}</strong> 重置密码</p>
      <div class="form-group" style="margin-bottom:14px;"><label>新密码</label><input type="password" id="input-new-pwd" placeholder="至少6位" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
      <div class="form-group" style="margin-bottom:14px;"><label>确认密码</label><input type="password" id="input-confirm-pwd" placeholder="再次输入" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
        <button class="btn" id="btn-modal-cancel" style="border:1px solid var(--border);padding:8px 20px;border-radius:8px;background:transparent;cursor:pointer;">取消</button>
        <button class="btn btn-primary" id="btn-modal-confirm" style="padding:8px 20px;border:none;border-radius:8px;cursor:pointer;">确认重置</button>
      </div>
    </div>
  </div>`
}

function buildConfirmModal(targetUser, type) {
  const labels = { 'toggle-status': targetUser.status === 'active' ? '禁用' : '启用', 'delete': '移除' }
  const actionLabel = labels[type] || type
  const isDanger = type === 'delete'
  return `<div class="modal-overlay" id="modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;display:flex;align-items:center;justify-content:center;">
    <div style="background:#fff;border-radius:16px;padding:28px;width:400px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);text-align:center;">
      <h3 style="margin-bottom:12px;">确认${actionLabel}</h3>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:20px;">确定要${actionLabel}用户 <strong>${escapeHtml(targetUser.username)}</strong> 吗？${type === 'delete' ? '账号将被软删除并立即撤销登录会话，历史数据和审计记录会保留。' : ''}</p>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button class="btn" id="btn-modal-cancel" style="border:1px solid var(--border);padding:8px 24px;border-radius:8px;background:transparent;cursor:pointer;">取消</button>
        <button class="btn" id="btn-modal-confirm" style="padding:8px 24px;border:none;border-radius:8px;background:${isDanger ? '#DC2626' : 'var(--primary)'};color:#fff;cursor:pointer;">确认${actionLabel}</button>
      </div>
    </div>
  </div>`
}

// ========================
// 主渲染函数
// ========================
export async function renderAdminUsers(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }
  let access
  try {
    access = await loadAdminAccess(user.user_id)
  } catch (error) {
    renderDashboardLayout(app, {
      menuItems: ADMIN_MENU_ITEMS,
      contentHTML: '<div class="error-state"><div class="error-icon">' + getIcon('alert') + '</div><p class="error-message">' + escapeHtml(error.message || '管理员权限加载失败') + '</p></div>',
      user,
    })
    return
  }
  const canManageUsers = access.permissions.includes('admin.users.manage')
  const canManageAdmins = canManageUsers && access.permissions.includes('admin.system.manage')

  // ---- 状态 ----
  let currentPage = 1
  let pageSize = 15
  let totalPages = 1
  let totalCount = 0
  let users = []
  let loading = true
  let loadError = null
  const requestedRole = new URLSearchParams(String(window.location.hash).split('?')[1] || '').get('role')
  let activeTab = ROLE_ORDER.includes(requestedRole) ? requestedRole : 'student'
  let stats = {}
  let adminClasses = []
  let adminRoles = []
  const setupWarnings = []

  // 筛选条件
  let filters = { keyword: '', status: 'all' }

  // 模态框
  let modalType = null
  let modalTargetUser = null

  // ---- Loading ----
  renderDashboardLayout(app, {
    menuItems: ADMIN_MENU_ITEMS,
    contentHTML: `<div class="page-header"><h1 class="page-title">${ROLE_LABEL[activeTab]}管理</h1><p class="page-subtitle">正在加载真实账号、资料与关联关系</p></div><div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在加载用户数据...</p></div>`,
    user,
  })

  // ---- 加载数据 ----
  const optionTasks = [
    getAdminClasses({ page: 1, page_size: 100 }),
    canManageAdmins ? getAdminRbacOverview() : Promise.resolve(null),
  ]
  const [classOptionsResult, roleOptionsResult] = await Promise.allSettled(optionTasks)
  if (classOptionsResult.status === 'fulfilled') {
    adminClasses = classOptionsResult.value?.data?.list || []
  } else {
    setupWarnings.push('行政班级选项加载失败，学生资料仍可编辑，但暂不能调整归班。')
  }
  if (canManageAdmins) {
    if (roleOptionsResult.status === 'fulfilled') {
      adminRoles = (roleOptionsResult.value?.data?.roles || []).filter((role) => role.enabled)
    } else {
      setupWarnings.push('管理员角色目录加载失败，暂不能创建管理员。')
    }
  }
  await fetchUsers()

  function buildContentHTML() {
    const pageTitle = `${ROLE_LABEL[activeTab] || '用户'}管理`
    let tableHTML = ''
    if (loading) {
      tableHTML = `<div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在加载用户数据...</p></div>`
    } else if (loadError) {
      tableHTML = `<div class="error-state"><div class="error-icon">${getIcon('alert')}</div><p class="error-message">${escapeHtml(loadError)}</p><button class="btn-retry" id="btn-retry-load">重新加载</button></div>`
    } else if (users.length === 0) {
      tableHTML = `<div class="empty-state"><div class="empty-icon">${getIcon('user')}</div><div class="empty-title">暂无匹配的用户</div><div class="empty-desc">尝试调整筛选条件或点击"新建用户"添加账号。</div></div>`
    } else {
      tableHTML = `
        <div class="table-container admin-users-table-container">
          <table class="admin-users-table">
            <thead><tr style="background:#f8f9fa;border-bottom:2px solid var(--border);">${buildTableHead(activeTab)}</tr></thead>
            <tbody>${users.map(u => buildUserRow(u, activeTab, { canManageUsers, canManageAdmins, currentUserId: user.user_id })).join('')}</tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-top:20px;padding:16px 0;">
          <button class="btn" id="btn-page-prev" style="border:1px solid var(--border);padding:6px 16px;" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>
          <span style="font-size:0.9rem;color:var(--text-secondary);">第 ${currentPage} / ${totalPages} 页，共 ${totalCount} 条</span>
          <button class="btn" id="btn-page-next" style="border:1px solid var(--border);padding:6px 16px;" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
        </div>
      `
    }

    return `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <h1 class="page-title">${pageTitle}</h1>
            <p class="page-subtitle">查看和维护${ROLE_LABEL[activeTab] || '用户'}账号、资料、状态与关联关系</p>
          </div>
        </div>
      </div>
      ${buildOverviewBar(stats)}
      ${!canManageUsers ? '<div class=\'admin-inline-warning\'><div><strong>当前为只读用户视图</strong><p>需要 admin.users.manage 才能创建、编辑、重置密码、启停或移除账号。</p></div></div>' : ''}
      ${setupWarnings.map((warning) => `<div class=\'admin-inline-warning\'><div><strong>部分功能暂不可用</strong><p>${escapeHtml(warning)}</p></div></div>`).join('')}
      ${buildSearchBar(activeTab, filters, canManageUsers, canManageAdmins)}
      <div id="admin-toast-container" class="toast-container"></div>
      <div class="card" style="overflow:hidden;padding:0;">${tableHTML}</div>
      <div id="modal-container"></div>
    `
  }

  function render() {
    const contentHTML = buildContentHTML()
    app.innerHTML = ''
    renderDashboardLayout(app, { menuItems: ADMIN_MENU_ITEMS, contentHTML, user })
    attachEvents()
  }

  function attachEvents() {
    // 搜索
    document.getElementById('btn-search')?.addEventListener('click', () => {
      collectFilters()
      currentPage = 1
      fetchUsers()
    })
    document.getElementById('input-keyword')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { collectFilters(); currentPage = 1; fetchUsers() }
    })

    // 精确搜索字段回车触发
    ;['filter-real-name', 'filter-student-no', 'filter-teacher-no', 'filter-college', 'filter-major', 'filter-grade', 'filter-class-name'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { collectFilters(); currentPage = 1; fetchUsers() }
      })
    })

    // 重置
    document.getElementById('btn-reset')?.addEventListener('click', () => {
      filters = { keyword: '', status: 'all' }
      currentPage = 1
      fetchUsers()
    })

    // 分页
    document.getElementById('btn-page-prev')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; fetchUsers() } })
    document.getElementById('btn-page-next')?.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; fetchUsers() } })

    // 重试
    document.getElementById('btn-retry-load')?.addEventListener('click', () => fetchUsers())

    // 创建用户
    document.getElementById('btn-create-user')?.addEventListener('click', () => {
      modalType = 'create-edit'
      modalTargetUser = null
      showModal()
    })

    // 表格操作（事件委托）
    const table = document.querySelector('table tbody')
    if (table) {
      table.addEventListener('click', (e) => {
        const btn = e.target.closest('button')
        if (!btn) return
        const userId = parseInt(btn.dataset.userId)
        const username = btn.dataset.username

        if (btn.classList.contains('btn-edit-user')) {
          const u = users.find(x => (x.user_id) === userId)
          modalType = 'create-edit'
          modalTargetUser = u || { user_id: userId, username, role: btn.dataset.role }
          showModal()
        } else if (btn.classList.contains('btn-reset-pwd')) {
          modalType = 'reset-pwd'
          modalTargetUser = { user_id: userId, username }
          showModal()
        } else if (btn.classList.contains('btn-toggle-status')) {
          modalType = 'toggle-status'
          modalTargetUser = { user_id: userId, username, status: btn.dataset.status }
          showModal()
        } else if (btn.classList.contains('btn-delete')) {
          modalType = 'delete'
          modalTargetUser = { user_id: userId, username }
          showModal()
        }
      })
    }
  }

  function collectFilters() {
    filters = {
      keyword: document.getElementById('input-keyword')?.value.trim() || '',
      status: document.getElementById('select-status')?.value || 'all',
    }
    // 精确字段
    ;['real_name', 'student_no', 'teacher_no', 'college', 'major', 'grade', 'class_name'].forEach(field => {
      const el = document.getElementById(`filter-${field.replace(/_/g, '-')}`)
      if (el?.value.trim()) filters[field] = el.value.trim()
    })
  }

  async function fetchUsers() {
    loading = true
    loadError = null
    render()

    try {
      const params = { page: currentPage, page_size: pageSize }
      if (filters.keyword) params.keyword = filters.keyword
      if (activeTab !== 'all') params.role = activeTab
      if (filters.status !== 'all') params.status = filters.status
      // 精确字段
      ;['real_name', 'student_no', 'teacher_no', 'college', 'major', 'grade', 'class_name'].forEach(field => {
        if (filters[field]) params[field] = filters[field]
      })

      const res = await getAdminUsers(params)
      const data = res.data || {}
      users = data.list || []
      totalCount = data.total || 0
      totalPages = Math.ceil(totalCount / pageSize) || 1

      // 统计信息
      const apiStats = data.stats || data
      stats = {
        total: Number(apiStats.total) || 0,
        student_count: Number(apiStats.student_count) || 0,
        teacher_count: Number(apiStats.teacher_count) || 0,
        admin_count: Number(apiStats.admin_count) || 0,
        disabled_count: Number(apiStats.disabled_count) || 0,
      }
      loading = false
      render()
    } catch (err) {
      loading = false
      loadError = err.message || '加载用户数据失败'
      render()
    }
  }

  // ---- 模态框 ----
  function showModal() {
    const container = document.getElementById('modal-container')
    if (!container) return
    let html = ''
    if (modalType === 'create-edit') html = buildCreateEditModal(modalTargetUser, activeTab, { canManageAdmins, adminClasses, adminRoles })
    else if (modalType === 'reset-pwd') html = buildResetPwdModal(modalTargetUser)
    else if (modalType === 'toggle-status') html = buildConfirmModal(modalTargetUser, 'toggle-status')
    else if (modalType === 'delete') html = buildConfirmModal(modalTargetUser, 'delete')
    container.innerHTML = html
    bindModalEvents()
  }

  function hideModal() {
    const container = document.getElementById('modal-container')
    if (container) container.innerHTML = ''
    modalType = null
    modalTargetUser = null
  }

  function bindModalEvents() {
    document.getElementById('btn-modal-cancel')?.addEventListener('click', hideModal)
    document.getElementById('btn-modal-close')?.addEventListener('click', hideModal)
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') hideModal()
    })
    document.getElementById('form-role')?.addEventListener('change', (event) => {
      document.querySelectorAll('[data-role-section]').forEach((section) => {
        const visible = section.dataset.roleSection === event.target.value
        section.style.display = visible
          ? (section.dataset.roleSection === 'admin' ? 'block' : 'contents')
          : 'none'
      })
    })

    // 创建/编辑表单提交
    document.getElementById('user-form')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      await handleCreateEdit()
    })

    // 重置密码确认
    document.getElementById('btn-modal-confirm')?.addEventListener('click', async () => {
      if (modalType === 'reset-pwd') await handleResetPwd()
      else if (modalType === 'toggle-status') await handleToggleStatus()
      else if (modalType === 'delete') await handleDelete()
    })

    // 密码框回车
    document.getElementById('input-confirm-pwd')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-modal-confirm')?.click()
    })
  }

  async function handleCreateEdit() {
    const isEdit = !!modalTargetUser
    const role = isEdit ? modalTargetUser.role : document.getElementById('form-role')?.value || activeTab

    const data = {
      username: document.getElementById('form-username')?.value.trim(),
      role: role,
      real_name: document.getElementById('form-real-name')?.value.trim(),
      email: document.getElementById('form-email')?.value.trim() || undefined,
      phone: document.getElementById('form-phone')?.value.trim() || undefined,
      gender: document.getElementById('form-gender')?.value || undefined,
      college: document.getElementById('form-college')?.value.trim() || undefined,
    }

    if (!isEdit) {
      data.password = document.getElementById('form-password')?.value.trim()
      if (!data.password || data.password.length < 6) { showToast('密码至少需要6位', 'error'); return }
    }
    if (!data.real_name) { showToast('真实姓名不能为空', 'error'); return }

    if (role === 'student') {
      data.student_no = document.getElementById('form-student-no')?.value.trim() || undefined
      data.college = document.getElementById('form-college')?.value.trim() || undefined
      data.major = document.getElementById('form-major')?.value.trim() || undefined
      data.grade = document.getElementById('form-grade')?.value.trim() || undefined
      data.admin_class_id = Number(document.getElementById('form-admin-class')?.value) || null
    } else if (role === 'teacher') {
      data.teacher_no = document.getElementById('form-teacher-no')?.value.trim() || undefined
    } else if (role === 'admin' && !isEdit) {
      data.role_codes = [...document.querySelectorAll('input[name="admin_role_codes"]:checked')].map((input) => input.value)
      if (!data.role_codes.length) { showToast('请至少分配一个管理员角色', 'error'); return }
    }

    try {
      if (isEdit) {
        await updateAdminUser(modalTargetUser.user_id, data)
        showToast('用户信息已更新')
      } else {
        await createAdminUser(data)
        showToast(role === 'admin' ? '管理员已创建并完成角色落库' : '用户创建成功')
      }
      hideModal()
      fetchUsers()
    } catch (err) { showToast(err.message || '操作失败', 'error') }
  }

  async function handleResetPwd() {
    const pwd = document.getElementById('input-new-pwd')?.value
    const confirm = document.getElementById('input-confirm-pwd')?.value
    if (!pwd || pwd.length < 6) { showToast('密码至少需要6位', 'error'); return }
    if (pwd !== confirm) { showToast('两次密码不一致', 'error'); return }
    try {
      await resetUserPassword(modalTargetUser.user_id, pwd)
      showToast('密码已重置')
      hideModal()
    } catch (err) { showToast(err.message || '操作失败', 'error') }
  }

  async function handleToggleStatus() {
    const currentStatus = modalTargetUser.status || 'active'
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    try {
      await updateUserStatus(modalTargetUser.user_id, newStatus)
      showToast(`用户已${newStatus === 'active' ? '启用' : '禁用'}`)
      hideModal()
      fetchUsers()
    } catch (err) { showToast(err.message || '操作失败', 'error') }
  }

  async function handleDelete() {
    try {
      await deleteUser(modalTargetUser.user_id)
      showToast('账号已软删除并撤销登录会话')
      hideModal()
      fetchUsers()
    } catch (err) { showToast(err.message || '删除失败', 'error') }
  }
}
