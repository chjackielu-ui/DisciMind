// 管理员端 — 用户管理页面
// 支持搜索、筛选、重置密码、启用/禁用、删除用户

import { getMe } from '../api/auth.js'
import { getAdminUsers, updateAdminUser, updateUserStatus, resetUserPassword, deleteUser } from '../api/admin.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

const ROLE_LABEL = { admin: '管理员', teacher: '教师', student: '学生' }

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

function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${h}:${min}`
  } catch {
    return dateStr
  }
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container')
  if (!container) return
  const toast = document.createElement('div')
  toast.className = `toast-item toast-${type}`
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => {
    if (toast.parentNode) toast.remove()
  }, 3000)
}

export async function renderAdminUsers(app) {
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

  // 查询参数
  let currentPage = 1
  let pageSize = 10
  let totalPages = 1
  let totalCount = 0
  let users = []
  let loading = true
  let error = null

  // 筛选条件
  let searchKeyword = ''
  let filterRole = 'all'
  let filterStatus = 'all'

  // 模态框状态
  let modalTargetUser = null
  let modalType = null // 'reset-password' | 'toggle-status' | 'delete'

  function buildContentHTML() {
    let tableHTML = ''

    if (loading) {
      tableHTML = `
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p>正在加载用户数据...</p>
        </div>
      `
    } else if (error) {
      tableHTML = `
        <div class="empty-state">
          <div class="empty-icon"></div>
          <p>${escapeHtml(error)}</p>
          <button class="btn-sm btn-primary" style="margin-top:12px;" id="btn-retry-load">重新加载</button>
        </div>
      `
    } else if (users.length === 0) {
      tableHTML = `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <p>暂无匹配的用户数据</p>
        </div>
      `
    } else {
      tableHTML = `
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>用户名</th>
                <th>姓名</th>
                <th>学号</th>
                <th>角色</th>
                <th>状态</th>
                <th>邮箱</th>
                <th>手机号</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${users.map(u => buildUserRow(u)).join('')}
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <button id="btn-page-prev" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="page-info">第 ${currentPage} / ${totalPages} 页，共 ${totalCount} 条</span>
          <button id="btn-page-next" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
        </div>
      `
    }

    const contentHTML = `
      <div class="search-bar" id="search-bar">
        <input type="text" id="input-search" placeholder="搜索用户名、姓名、邮箱、手机号..." value="${escapeHtml(searchKeyword)}" />
        <select id="select-role">
          <option value="all" ${filterRole === 'all' ? 'selected' : ''}>全部角色</option>
          <option value="student" ${filterRole === 'student' ? 'selected' : ''}>学生</option>
          <option value="teacher" ${filterRole === 'teacher' ? 'selected' : ''}>教师</option>
          <option value="admin" ${filterRole === 'admin' ? 'selected' : ''}>管理员</option>
        </select>
        <select id="select-status">
          <option value="all" ${filterStatus === 'all' ? 'selected' : ''}>全部状态</option>
          <option value="active" ${filterStatus === 'active' ? 'selected' : ''}>正常</option>
          <option value="disabled" ${filterStatus === 'disabled' ? 'selected' : ''}>已禁用</option>
        </select>
        <button class="btn-sm btn-primary" id="btn-search">搜索</button>
        <button class="btn-sm btn-secondary" id="btn-reset-filter">重置</button>
      </div>

      <!-- Toast 容器 -->
      <div id="toast-container" class="toast-container"></div>

      <!-- 用户表格 -->
      ${tableHTML}

      <!-- 模态框容器 -->
      <div id="modal-container"></div>
    `

    return contentHTML
  }

  function buildUserRow(u) {
    const roleTagClass = `tag tag-${u.role}`
    const roleLabel = ROLE_LABEL[u.role] || u.role

    const statusTagClass = u.status === 'active' ? 'tag tag-active' : 'tag tag-disabled'
    const statusLabel = u.status === 'active' ? '正常' : '已禁用'

    const studentNo = u.profile?.student_no || u.student_no || '-'
    const realName = u.profile?.real_name || u.real_name || '-'

    // 检查当前用户角色，非管理员只能看到有限操作（这里统一管理员视角）
    const isStudent = u.role === 'student'

    let statusActionLabel = u.status === 'active' ? '禁用' : '启用'

    return `
      <tr>
        <td>${escapeHtml(String(u.user_id || u.id || ''))}</td>
        <td>${escapeHtml(u.username || '-')}</td>
        <td>${escapeHtml(realName)}</td>
        <td>${escapeHtml(studentNo)}</td>
        <td><span class="${roleTagClass}">${roleLabel}</span></td>
        <td><span class="${statusTagClass}">${statusLabel}</span></td>
        <td>${escapeHtml(u.email || '-')}</td>
        <td>${escapeHtml(u.phone || '-')}</td>
        <td>${formatDate(u.created_at || u.createdAt || '')}</td>
        <td>
          <div class="action-btns">
            <button class="btn-edit-user" data-user-id="${u.user_id || u.id}" data-username="${escapeHtml(u.username || '')}" data-role="${u.role}" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;cursor:pointer;font-size:0.8rem;">编辑</button>
            <button class="btn-reset-pwd" data-user-id="${u.user_id || u.id}" data-username="${escapeHtml(u.username || '')}">重置密码</button>
            <button class="btn-toggle-status" data-user-id="${u.user_id || u.id}" data-username="${escapeHtml(u.username || '')}" data-status="${u.status || 'active'}">${statusActionLabel}</button>
            ${isStudent ? `<button class="btn-danger btn-delete" data-user-id="${u.user_id || u.id}" data-username="${escapeHtml(u.username || '')}">删除</button>` : ''}
          </div>
        </td>
      </tr>
    `
  }

  function buildResetPasswordModal() {
    if (!modalTargetUser) return ''
    return `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box">
          <h3>重置密码</h3>
          <p style="margin-bottom:16px;color:var(--stu-text-secondary);font-size:0.88rem;">
            正在为用户 <strong>${escapeHtml(modalTargetUser.username)}</strong> 重置密码
          </p>
          <div class="form-group">
            <label>新密码</label>
            <input type="password" id="input-new-password" placeholder="请输入新密码，至少6位" />
          </div>
          <div class="form-group">
            <label>确认密码</label>
            <input type="password" id="input-confirm-password" placeholder="请再次输入新密码" />
          </div>
          <div class="modal-actions">
            <button class="btn-cancel" id="btn-modal-cancel">取消</button>
            <button class="btn-confirm" id="btn-modal-confirm">确认重置</button>
          </div>
        </div>
      </div>
    `
  }

  function buildToggleStatusModal() {
    if (!modalTargetUser) return ''
    const currentStatus = modalTargetUser.status || 'active'
    const targetStatus = currentStatus === 'active' ? 'disabled' : 'active'
    const actionLabel = currentStatus === 'active' ? '禁用' : '启用'
    return `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box">
          <h3>确认${actionLabel}</h3>
          <p style="margin-bottom:16px;color:var(--stu-text-secondary);font-size:0.88rem;">
            确定要${actionLabel}用户 <strong>${escapeHtml(modalTargetUser.username)}</strong> 吗？
          </p>
          <div class="modal-actions">
            <button class="btn-cancel" id="btn-modal-cancel">取消</button>
            <button class="btn-confirm" id="btn-modal-confirm">确认${actionLabel}</button>
          </div>
        </div>
      </div>
    `
  }

  function buildDeleteModal() {
    if (!modalTargetUser) return ''
    return `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box">
          <h3>确认删除</h3>
          <p style="margin-bottom:16px;color:var(--stu-text-secondary);font-size:0.88rem;">
            确定要删除学生用户 <strong>${escapeHtml(modalTargetUser.username)}</strong> 吗？此操作不可撤销。
          </p>
          <div class="modal-actions">
            <button class="btn-cancel" id="btn-modal-cancel">取消</button>
            <button class="btn-confirm" id="btn-modal-confirm" style="background:#DC2626;">确认删除</button>
          </div>
        </div>
      </div>
    `
  }

  function render() {
    const contentHTML = buildContentHTML()
    renderDashboardLayout(app, {
      title: '用户管理',
      menuItems,
      contentHTML,
      user,
    })
    attachEventListeners()
  }

  function attachEventListeners() {
    // 搜索按钮
    document.getElementById('btn-search')?.addEventListener('click', () => {
      searchKeyword = document.getElementById('input-search')?.value || ''
      filterRole = document.getElementById('select-role')?.value || 'all'
      filterStatus = document.getElementById('select-status')?.value || 'all'
      currentPage = 1
      fetchUsers()
    })

    // 回车搜索
    document.getElementById('input-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('btn-search')?.click()
      }
    })

    // 重置筛选
    document.getElementById('btn-reset-filter')?.addEventListener('click', () => {
      const searchInput = document.getElementById('input-search')
      const roleSelect = document.getElementById('select-role')
      const statusSelect = document.getElementById('select-status')
      if (searchInput) searchInput.value = ''
      if (roleSelect) roleSelect.value = 'all'
      if (statusSelect) statusSelect.value = 'all'
      searchKeyword = ''
      filterRole = 'all'
      filterStatus = 'all'
      currentPage = 1
      fetchUsers()
    })

    // 分页
    document.getElementById('btn-page-prev')?.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--
        fetchUsers()
      }
    })

    document.getElementById('btn-page-next')?.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++
        fetchUsers()
      }
    })

    // 重试加载
    document.getElementById('btn-retry-load')?.addEventListener('click', () => {
      fetchUsers()
    })

    // 表格内的操作按钮 — 使用事件委托
    const tableBody = document.querySelector('table tbody')
    if (tableBody) {
      tableBody.addEventListener('click', (e) => {
        const target = e.target.closest('button')
        if (!target) return

        const userId = target.dataset.userId
        const username = target.dataset.username
        const status = target.dataset.status

        if (target.classList.contains('btn-edit-user')) {
          const role = target.dataset.role
          const user = users.find(u => (u.user_id || u.id) === userId)
          modalTargetUser = { user_id: userId, username, role, ...user }
          modalType = 'edit-user'
          showModal()
        } else if (target.classList.contains('btn-reset-pwd')) {
          modalTargetUser = { user_id: userId, username }
          modalType = 'reset-password'
          showModal()
        } else if (target.classList.contains('btn-toggle-status')) {
          modalTargetUser = { user_id: userId, username, status }
          modalType = 'toggle-status'
          showModal()
        } else if (target.classList.contains('btn-delete')) {
          modalTargetUser = { user_id: userId, username }
          modalType = 'delete'
          showModal()
        }
      })
    }
  }

  function showModal() {
    const container = document.getElementById('modal-container')
    if (!container) return

    let html = ''
    if (modalType === 'reset-password') {
      html = buildResetPasswordModal()
    } else if (modalType === 'edit-user') {
      html = buildEditUserModal()
    } else if (modalType === 'toggle-status') {
      html = buildToggleStatusModal()
    } else if (modalType === 'delete') {
      html = buildDeleteModal()
    }

    container.innerHTML = html
    attachModalListeners()
  }

  function hideModal() {
    const container = document.getElementById('modal-container')
    if (container) {
      container.innerHTML = ''
    }
    modalTargetUser = null
    modalType = null
  }

  function attachModalListeners() {
    document.getElementById('btn-modal-cancel')?.addEventListener('click', hideModal)

    // 点击遮罩关闭
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') hideModal()
    })

    document.getElementById('btn-modal-confirm')?.addEventListener('click', async () => {
      if (modalType === 'reset-password') {
        await handleResetPassword()
      } else if (modalType === 'edit-user') {
        await handleEditUser()
      } else if (modalType === 'toggle-status') {
        await handleToggleStatus()
      } else if (modalType === 'delete') {
        await handleDeleteUser()
      }
    })

    // 重置密码模态框支持回车确认
    if (modalType === 'reset-password') {
      const pwdInput = document.getElementById('input-new-password')
      const confirmInput = document.getElementById('input-confirm-password')
      const doConfirm = () => document.getElementById('btn-modal-confirm')?.click()

      pwdInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          confirmInput?.focus()
        }
      })
      confirmInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          doConfirm()
        }
      })
    }
  }

  async function handleResetPassword() {
    const newPwd = document.getElementById('input-new-password')?.value
    const confirmPwd = document.getElementById('input-confirm-password')?.value

    if (!newPwd || newPwd.length < 6) {
      showToast('密码至少需要6位', 'error')
      return
    }
    if (newPwd !== confirmPwd) {
      showToast('两次密码输入不一致', 'error')
      return
    }

    try {
      await resetUserPassword(modalTargetUser.user_id, newPwd)
      showToast(`用户「${modalTargetUser.username}」密码重置成功`)
      hideModal()
    } catch (err) {
      showToast(err.message || '密码重置失败', 'error')
    }
  }

  async function handleToggleStatus() {
    if (!modalTargetUser) return
    const currentStatus = modalTargetUser.status || 'active'
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    const actionLabel = currentStatus === 'active' ? '禁用' : '启用'

    try {
      await updateUserStatus(modalTargetUser.user_id, newStatus)
      showToast(`用户「${modalTargetUser.username}」已${actionLabel}`)
      hideModal()
      fetchUsers()
    } catch (err) {
      showToast(err.message || `${actionLabel}操作失败`, 'error')
    }
  }

  function buildEditUserModal() {
    if (!modalTargetUser) return ''
    const u = modalTargetUser
    const realName = u.profile?.real_name || u.real_name || ''
    const college = u.profile?.college || ''
    const major = u.profile?.major || ''
    const studentNo = u.profile?.student_no || u.student_no || ''
    const email = u.email || ''
    const phone = u.phone || ''
    const roleLabel = u.role === 'teacher' ? '教师' : u.role === 'student' ? '学生' : u.role
    return `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box">
          <h3>编辑用户信息 — ${escapeHtml(u.username)}（${roleLabel}）</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0;">
            <div class="form-group"><label>真实姓名</label><input type="text" id="edit-real-name" value="${escapeHtml(realName)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;"></div>
            <div class="form-group"><label>邮箱</label><input type="email" id="edit-email" value="${escapeHtml(email)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;"></div>
            <div class="form-group"><label>手机号</label><input type="text" id="edit-phone" value="${escapeHtml(phone)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;"></div>
            <div class="form-group"><label>学院</label><input type="text" id="edit-college" value="${escapeHtml(college)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;"></div>
            <div class="form-group"><label>专业</label><input type="text" id="edit-major" value="${escapeHtml(major)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;"></div>
            ${u.role === 'student' ? `<div class="form-group"><label>学号</label><input type="text" id="edit-student-no" value="${escapeHtml(studentNo)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.9rem;"></div>` : ''}
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
            <button class="btn" id="btn-modal-cancel" style="padding:8px 20px;border:1px solid var(--border);border-radius:8px;background:transparent;cursor:pointer;">取消</button>
            <button class="btn btn-primary" id="btn-modal-confirm" style="padding:8px 20px;border:none;border-radius:8px;background:var(--primary);color:#fff;cursor:pointer;">保存</button>
          </div>
        </div>
      </div>
    `
  }

  async function handleEditUser() {
    if (!modalTargetUser) return
    const data = {
      real_name: document.getElementById('edit-real-name')?.value.trim(),
      email: document.getElementById('edit-email')?.value.trim(),
      phone: document.getElementById('edit-phone')?.value.trim(),
      college: document.getElementById('edit-college')?.value.trim(),
      major: document.getElementById('edit-major')?.value.trim(),
    }
    if (modalTargetUser.role === 'student') {
      data.student_no = document.getElementById('edit-student-no')?.value.trim() || null
    }
    if (!data.real_name) { showToast('真实姓名不能为空', 'error'); return }
    try {
      await updateAdminUser(modalTargetUser.user_id, data)
      showToast(`用户「${modalTargetUser.username}」信息已更新`)
      hideModal()
      fetchUsers()
    } catch (err) {
      showToast(err.message || '更新失败', 'error')
    }
  }

  async function handleDeleteUser() {
    if (!modalTargetUser) return

    try {
      await deleteUser(modalTargetUser.user_id)
      showToast(`用户「${modalTargetUser.username}」已删除`)
      hideModal()
      fetchUsers()
    } catch (err) {
      showToast(err.message || '删除失败', 'error')
    }
  }

  async function fetchUsers() {
    loading = true
    error = null
    render()

    try {
      const params = { page: currentPage, page_size: pageSize }
      if (searchKeyword.trim()) {
        params.keyword = searchKeyword.trim()
      }
      if (filterRole !== 'all') {
        params.role = filterRole
      }
      if (filterStatus !== 'all') {
        params.status = filterStatus
      }

      const result = await getAdminUsers(params)
      const data = result.data || {}

      users = data.users || data.list || data.records || []
      totalCount = data.total || data.total_count || data.totalCount || 0
      const computedTotalPages = Math.ceil(totalCount / pageSize)
      totalPages = computedTotalPages > 0 ? computedTotalPages : 1
      loading = false
      render()
    } catch (err) {
      loading = false
      error = err.message || '加载用户数据失败'
      render()
    }
  }

  // 初始化渲染
  render()
  // 开始加载数据
  fetchUsers()
}


