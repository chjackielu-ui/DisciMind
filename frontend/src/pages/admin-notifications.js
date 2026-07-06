// 管理员端通知管理页面

import { getMe } from '../api/auth.js'
import { getAdminNotifications, createAdminNotification, markNotificationRead, markAllNotificationsRead } from '../api/admin.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'

const menuItems = [
  { label: '首页', icon: 'home', hash: '#/admin/dashboard' },
  { label: '用户管理', icon: 'user', hash: '#/admin/users' },
  { label: '教学管理', icon: 'book', hash: '#/admin/courses' },
  { label: '系统管理', icon: 'settings', hash: '#/admin/knowledge' },
]

const notificationTypeLabels = {
  task_published: '任务发布',
  task_deadline: '任务截止',
  document_review: '文档审核',
  document_parsed: '文档解析',
  ai_grading_done: 'AI批改完成',
  system_notice: '系统通知',
}

export async function renderAdminNotifications(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  let state = { list: [], total: 0, page: 1, pageSize: 10, loading: true, error: null }
  let filters = { notification_type: '', is_read: '' }

  async function loadData() {
    state.loading = true; state.error = null
    renderView()
    try {
      const params = { page: state.page, page_size: state.pageSize, ...filters }
      Object.keys(params).forEach((k) => { if (params[k] === '' || params[k] === undefined) delete params[k] })
      const result = await getAdminNotifications(params)
      state.list = result.data.list || []
      state.total = result.data.total || 0
    } catch (err) {
      state.error = err.message
      state.list = []
    } finally {
      state.loading = false
      renderView()
    }
  }

  function getContentHTML() {
    if (state.loading) {
      return `<div class="loading-state"><div class="loading-spinner"></div><p>加载中...</p></div>`
    }
    if (state.error) {
      return `<div class="error-state"><div class="error-icon"></div><div class="error-message">${state.error}</div><button class="btn-retry" onclick="location.reload()">重试</button></div>`
    }

    const totalPages = Math.ceil(state.total / state.pageSize) || 1

    let rows = ''
    if (state.list.length === 0) {
      rows = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--stu-text-muted);">暂无通知</td></tr>`
    } else {
      for (const n of state.list) {
        const typeLabel = notificationTypeLabels[n.notification_type] || n.notification_type
        const time = n.created_at ? new Date(n.created_at).toLocaleString('zh-CN') : '-'
        rows += `<tr style="${!n.is_read ? 'font-weight:600;' : ''}">
          <td>${n.notification_id}</td>
          <td>
            <div>${n.title}</div>
            <div style="font-size:0.78rem;color:var(--stu-text-muted);margin-top:4px;">${n.content || ''}</div>
          </td>
          <td><span class="tag tag-student">${typeLabel}</span></td>
          <td>${n.receiver_name || '-'}</td>
          <td>
            <div class="action-btns">
              ${!n.is_read ? `<button class="btn-mark-read" data-id="${n.notification_id}">标记已读</button>` : '<span style="color:var(--stu-text-muted);font-size:0.82rem;">已读</span>'}
            </div>
          </td>
        </tr>`
      }
    }

    let pagination = ''
    if (state.total > state.pageSize) {
      pagination = `<div class="pagination">
        <button ${state.page <= 1 ? 'disabled' : ''} data-page="prev">上一页</button>
        <span class="page-info">第 ${state.page} / ${totalPages} 页，共 ${state.total} 条</span>
        <button ${state.page >= totalPages ? 'disabled' : ''} data-page="next">下一页</button>
      </div>`
    }

    return `
      <div style="margin-bottom:12px;">
        <a href="#/admin/knowledge" style="font-size:0.85rem;color:var(--primary);text-decoration:none;">← 返回系统管理</a>
      </div>
      <div class="section-header">
        <h2>通知管理</h2>
        <div style="display:flex;gap:8px;">
          <button class="btn-sm btn-secondary" id="btn-create-notification">+ 发送通知</button>
          <button class="btn-sm btn-secondary" id="btn-mark-all-read">全部标记已读</button>
        </div>
      </div>

      <div class="search-bar">
        <select id="filter-type">
          <option value="">全部类型</option>
          <option value="system_notice" ${filters.notification_type === 'system_notice' ? 'selected' : ''}>系统通知</option>
          <option value="task_published" ${filters.notification_type === 'task_published' ? 'selected' : ''}>任务发布</option>
          <option value="document_review" ${filters.notification_type === 'document_review' ? 'selected' : ''}>文档审核</option>
        </select>
        <select id="filter-read">
          <option value="">全部状态</option>
          <option value="false" ${filters.is_read === 'false' ? 'selected' : ''}>未读</option>
          <option value="true" ${filters.is_read === 'true' ? 'selected' : ''}>已读</option>
        </select>
        <button class="btn-sm btn-primary" id="btn-search">搜索</button>
      </div>

      <div class="card">
        <div class="table-container">
          <table>
            <thead><tr>
              <th>ID</th><th>通知内容</th><th>类型</th><th>接收人</th><th>操作</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${pagination}
      </div>
    `
  }

  function renderView() {
    const contentHTML = getContentHTML()
    renderDashboardLayout(app, { title: '通知管理', menuItems, contentHTML, user })

    // 搜索
    document.getElementById('btn-search')?.addEventListener('click', () => {
      filters.notification_type = document.getElementById('filter-type')?.value || ''
      filters.is_read = document.getElementById('filter-read')?.value || ''
      state.page = 1
      loadData()
    })

    // 分页
    document.querySelectorAll('[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.page
        if (action === 'prev' && state.page > 1) { state.page--; loadData() }
        if (action === 'next') { const tp = Math.ceil(state.total / state.pageSize); if (state.page < tp) { state.page++; loadData() } }
      })
    })

    // 标记已读
    document.querySelectorAll('.btn-mark-read').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const nid = parseInt(btn.dataset.id, 10)
        try {
          await markNotificationRead(nid)
          loadData()
        } catch (err) { alert('操作失败: ' + err.message) }
      })
    })

    // 全部标记已读
    document.getElementById('btn-mark-all-read')?.addEventListener('click', async () => {
      if (!confirm('确定将所有通知标记为已读？')) return
      try {
        await markAllNotificationsRead(user.user_id)
        loadData()
      } catch (err) { alert('操作失败: ' + err.message) }
    })

    // 创建通知
    document.getElementById('btn-create-notification')?.addEventListener('click', () => showCreateModal())
  }

  function showCreateModal() {
    // 锁定底层滚动
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px);'
    overlay.innerHTML = `
      <div class="modal-box" style="background:#fff;border-radius:var(--stu-radius,22px);box-shadow:0 24px 64px rgba(91,33,182,0.15);padding:28px;width:90%;max-width:540px;max-height:85vh;overflow-y:auto;border:1px solid var(--stu-border,rgba(124,58,237,0.12));">
        <h3 style="font-size:1.1rem;margin-bottom:18px;color:var(--stu-dark,#5B21B6);">📨 发送通知</h3>
        <div class="form-group" style="margin-bottom:14px;">
          <label style="display:block;font-size:0.85rem;color:var(--stu-text-secondary);margin-bottom:4px;font-weight:500;">通知类型 *</label>
          <select id="create-type" style="width:100%;padding:9px 12px;border:1px solid var(--stu-border,rgba(124,58,237,0.12));border-radius:8px;font-size:0.9rem;font-family:var(--font);color:var(--stu-text);outline:none;">
            <option value="system_notice">系统通知</option>
            <option value="task_published">任务发布</option>
            <option value="document_review">文档审核</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <label style="display:block;font-size:0.85rem;color:var(--stu-text-secondary);margin-bottom:4px;font-weight:500;">发送对象 *</label>
          <select id="create-target" style="width:100%;padding:9px 12px;border:1px solid var(--stu-border,rgba(124,58,237,0.12));border-radius:8px;font-size:0.9rem;font-family:var(--font);color:var(--stu-text);outline:none;">
            <option value="all">全体用户</option>
            <option value="teacher">仅教师</option>
            <option value="student">仅学生</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <label style="display:block;font-size:0.85rem;color:var(--stu-text-secondary);margin-bottom:4px;font-weight:500;">通知标题 *</label>
          <input type="text" id="create-title" placeholder="请输入通知标题" required style="width:100%;padding:9px 12px;border:1px solid var(--stu-border,rgba(124,58,237,0.12));border-radius:8px;font-size:0.9rem;font-family:var(--font);color:var(--stu-text);outline:none;" />
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <label style="display:block;font-size:0.85rem;color:var(--stu-text-secondary);margin-bottom:4px;font-weight:500;">通知内容</label>
          <textarea id="create-content" placeholder="请输入通知内容" style="width:100%;padding:9px 12px;border:1px solid var(--stu-border,rgba(124,58,237,0.12));border-radius:8px;font-size:0.9rem;font-family:var(--font);color:var(--stu-text);outline:none;min-height:80px;resize:vertical;"></textarea>
        </div>
        <div class="modal-actions" style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
          <button class="btn-cancel" id="modal-cancel" style="padding:8px 22px;border-radius:10px;font-size:0.88rem;font-family:var(--font);cursor:pointer;background:transparent;border:1px solid var(--stu-border,rgba(124,58,237,0.12));color:var(--stu-text-secondary);transition:all 0.2s;">取消</button>
          <button class="btn-confirm" id="modal-confirm" style="padding:8px 22px;border-radius:10px;font-size:0.88rem;font-family:var(--font);cursor:pointer;background:var(--stu-primary,#7C3AED);color:#fff;border:none;transition:all 0.2s;">发送</button>
        </div>
      </div>
    `

    // 插入到 student-dashboard-wrapper 内，确保 CSS 作用域匹配
    const container = app.querySelector('.student-dashboard-wrapper') || app
    container.appendChild(overlay)

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal()
    })

    // 取消按钮
    overlay.querySelector('#modal-cancel').addEventListener('click', closeModal)

    // 发送
    overlay.querySelector('#modal-confirm').addEventListener('click', async () => {
      const title = overlay.querySelector('#create-title').value.trim()
      if (!title) { alert('请输入通知标题'); return }
      try {
        await createAdminNotification({
          target_role: overlay.querySelector('#create-target').value,
          notification_type: overlay.querySelector('#create-type').value,
          title,
          content: overlay.querySelector('#create-content').value.trim() || null,
        })
        closeModal()
        alert('通知发送成功')
        loadData()
      } catch (err) { alert('发送失败: ' + err.message) }
    })

    function closeModal() {
      overlay.remove()
      // 恢复滚动
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }

  await loadData()
}
