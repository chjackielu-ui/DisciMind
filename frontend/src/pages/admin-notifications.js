import {
  getAdminNotifications,
  createAdminNotification,
  markNotificationRead,
  markAllNotificationsRead,
} from '../api/admin.js'
import {
  requireAdminUser,
  renderAdminPage,
  notifyAdmin,
  confirmAdmin,
  setBusy,
  escapeHtml,
  getIcon,
} from '../utils/admin-ui.js'
import { formatDate } from '../utils/format.js'

const NOTIFICATION_TYPE_LABELS = {
  task_published: '任务发布',
  task_deadline: '任务提醒',
  task_submitted: '任务提交',
  exam_submitted: '考试提交',
  document_review: '审核通知',
  document_parsed: '文档解析完成',
  knowledge_application: '知识库申请',
  ai_grading_done: 'AI 批改完成',
  file_generated: '文件生成完成',
  ai_task_done: 'AI 任务完成',
  student_risk: '风险预警',
  class_alert: '班级预警',
  frequent_question: '高频问题',
  resource_shared: '教学资源共享',
  system_notice: '系统通知',
}

const CREATE_TYPE_OPTIONS = [
  'system_notice',
  'task_deadline',
  'document_review',
  'resource_shared',
  'student_risk',
  'class_alert',
]

function typeLabel(value) {
  return NOTIFICATION_TYPE_LABELS[String(value || '').toLowerCase()] || '其他通知'
}

function filterPayload(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined))
}

export async function renderAdminNotifications(app) {
  const user = await requireAdminUser()
  if (!user) return

  const state = {
    list: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    loading: true,
    error: null,
  }
  const filters = {
    keyword: '',
    notification_type: '',
    is_read: '',
    receiver: '',
    start_date: '',
    end_date: '',
  }

  renderAdminPage(app, {
    user,
    title: '通知管理',
    contentHTML: '<div id="admin-notifications-root"></div>',
  })

  function rowHTML(notification) {
    const unread = !notification.is_read
    return `<tr class="${unread ? 'is-unread' : ''}">
      <td class="admin-notification-title-cell">
        <strong>${escapeHtml(notification.title || '-')}</strong>
        <p class="admin-notification-summary">${escapeHtml(notification.content || '无补充内容')}</p>
      </td>
      <td><span class="tag tag-student">${escapeHtml(typeLabel(notification.notification_type))}</span></td>
      <td>
        <strong>${escapeHtml(notification.receiver_name || notification.receiver_username || '-')}</strong>
        ${notification.receiver_username && notification.receiver_name !== notification.receiver_username ? `<small>${escapeHtml(notification.receiver_username)}</small>` : ''}
      </td>
      <td>${unread ? '<span class="tag tag-pending">未读</span>' : '<span class="tag tag-active">已读</span>'}</td>
      <td>${notification.created_at ? escapeHtml(formatDate(notification.created_at, 'short')) : '-'}</td>
      <td><div class="action-btns">
        ${unread ? `<button type="button" class="btn-mark-read" data-notification-id="${Number(notification.notification_id)}">标记已读</button>` : '<span class="admin-action-complete">无需操作</span>'}
      </div></td>
    </tr>`
  }

  function filterOptions() {
    return Object.entries(NOTIFICATION_TYPE_LABELS)
      .map(([value, label]) => `<option value="${value}" ${filters.notification_type === value ? 'selected' : ''}>${escapeHtml(label)}</option>`)
      .join('')
  }

  function contentHTML() {
    if (state.loading) {
      return '<div class="loading-state"><div class="loading-spinner"></div><p>正在读取通知记录...</p></div>'
    }
    if (state.error) {
      return `<div class="error-state"><div class="error-icon">${getIcon('alert')}</div><div class="error-message">${escapeHtml(state.error)}</div><button type="button" class="btn-retry" id="admin-notifications-retry">重新加载</button></div>`
    }

    const rows = state.list.length
      ? state.list.map(rowHTML).join('')
      : '<tr><td colspan="6"><div class="empty-state"><p>当前筛选条件下没有通知记录。</p></div></td></tr>'

    return `<div class="dashboard-content admin-list-page">
      <section class="section-header admin-page-heading">
        <div>
          <h2>通知管理</h2>
          <p>查询和发送真实通知记录；筛选、分页和已读状态均直接写入数据库。</p>
        </div>
        <div class="admin-page-actions">
          <button type="button" class="btn-sm btn-secondary" id="admin-mark-all-read">全部标记已读</button>
          <button type="button" class="btn-sm btn-primary" id="admin-create-notification">${getIcon('message')} 发送通知</button>
        </div>
      </section>

      <form class="card search-bar admin-filter-bar" id="admin-notification-filters">
        <label><span>关键词</span><input class="admin-filter-input" name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="标题或内容"></label>
        <label><span>通知类型</span><select class="admin-filter-select" name="notification_type"><option value="">全部类型</option>${filterOptions()}</select></label>
        <label><span>阅读状态</span><select class="admin-filter-select" name="is_read"><option value="">全部状态</option><option value="false" ${filters.is_read === 'false' ? 'selected' : ''}>未读</option><option value="true" ${filters.is_read === 'true' ? 'selected' : ''}>已读</option></select></label>
        <label><span>接收人</span><input class="admin-filter-input" name="receiver" value="${escapeHtml(filters.receiver)}" placeholder="姓名或用户名"></label>
        <label><span>开始时间</span><input class="admin-filter-input" type="date" name="start_date" value="${escapeHtml(filters.start_date)}"></label>
        <label><span>结束时间</span><input class="admin-filter-input" type="date" name="end_date" value="${escapeHtml(filters.end_date)}"></label>
        <div class="admin-filter-actions">
          <button type="submit" class="btn-sm btn-primary">${getIcon('search')} 查询</button>
          <button type="button" class="btn-sm btn-secondary" id="admin-notification-reset">重置</button>
        </div>
      </form>

      <section class="card">
        <div class="admin-list-summary"><span>共 ${state.total.toLocaleString('zh-CN')} 条真实记录</span><button type="button" class="btn-link" id="admin-notification-refresh">${getIcon('refresh')} 刷新</button></div>
        <div class="table-container"><table class="admin-data-table">
          <thead><tr><th>标题与内容</th><th>类型</th><th>接收人</th><th>阅读状态</th><th>发送时间</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="pagination">
          <button type="button" class="btn-sm btn-secondary" data-page="previous" ${state.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="page-info">第 ${state.page} / ${state.totalPages} 页</span>
          <button type="button" class="btn-sm btn-secondary" data-page="next" ${state.page >= state.totalPages ? 'disabled' : ''}>下一页</button>
        </div>
      </section>
    </div>`
  }

  function renderView() {
    const root = document.getElementById('admin-notifications-root')
    if (!root) return
    root.innerHTML = contentHTML()
    if (state.loading || state.error) {
      document.getElementById('admin-notifications-retry')?.addEventListener('click', loadData)
      return
    }

    document.getElementById('admin-notification-filters')?.addEventListener('submit', (event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      Object.keys(filters).forEach((key) => { filters[key] = String(form.get(key) || '').trim() })
      state.page = 1
      loadData()
    })
    document.getElementById('admin-notification-reset')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => { filters[key] = '' })
      state.page = 1
      loadData()
    })
    document.getElementById('admin-notification-refresh')?.addEventListener('click', loadData)
    document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.page === 'previous' && state.page > 1) state.page -= 1
      if (button.dataset.page === 'next' && state.page < state.totalPages) state.page += 1
      loadData()
    }))
    document.querySelectorAll('[data-notification-id]').forEach((button) => button.addEventListener('click', async () => {
      setBusy(button, true)
      try {
        await markNotificationRead(Number(button.dataset.notificationId))
        notifyAdmin('通知已标记为已读')
        await loadData()
      } catch (error) {
        notifyAdmin(error.message || '标记已读失败', true)
        setBusy(button, false)
      }
    }))
    document.getElementById('admin-mark-all-read')?.addEventListener('click', async () => {
      const confirmed = await confirmAdmin({
        title: '全部标记为已读',
        message: '将把当前筛选范围内所有未读通知写入已读状态，是否继续？',
        confirmLabel: '确认标记',
      })
      if (!confirmed) return
      try {
        const result = await markAllNotificationsRead(filterPayload(filters))
        notifyAdmin(`已更新 ${result.data.updated_count} 条通知`)
        await loadData()
      } catch (error) {
        notifyAdmin(error.message || '批量标记失败', true)
      }
    })
    document.getElementById('admin-create-notification')?.addEventListener('click', openCreateDialog)
  }

  async function loadData() {
    state.loading = true
    state.error = null
    renderView()
    try {
      const result = await getAdminNotifications({
        page: state.page,
        page_size: state.pageSize,
        ...filterPayload(filters),
      })
      const data = result.data
      if (!data || !Array.isArray(data.list) || !Number.isFinite(Number(data.total))) {
        throw new Error('通知接口返回结构无效。')
      }
      state.list = data.list
      state.total = Number(data.total)
      state.page = Number(data.page) || state.page
      state.pageSize = Number(data.page_size) || state.pageSize
      state.totalPages = Number(data.total_pages) || Math.max(1, Math.ceil(state.total / state.pageSize))
    } catch (error) {
      state.error = error.message || '通知数据加载失败，请稍后重试。'
    } finally {
      state.loading = false
      renderView()
    }
  }

  function openCreateDialog() {
    document.getElementById('admin-notification-dialog')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'admin-notification-dialog'
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="admin-notification-dialog-title">
      <form id="admin-notification-create-form">
        <div class="section-header">
          <div><h3 id="admin-notification-dialog-title">发送通知</h3><p>保存后会为匹配的活跃用户创建真实通知记录。</p></div>
          <button type="button" class="btn-sm btn-secondary" data-close-notification-dialog>关闭</button>
        </div>
        <div class="form-group"><label for="admin-notification-type">通知类型</label><select id="admin-notification-type" name="notification_type" required>${CREATE_TYPE_OPTIONS.map((value) => `<option value="${value}">${escapeHtml(typeLabel(value))}</option>`).join('')}</select></div>
        <div class="form-group"><label for="admin-notification-target">发送对象</label><select id="admin-notification-target" name="target_role" required><option value="all">全体活跃用户</option><option value="teacher">仅教师</option><option value="student">仅学生</option><option value="admin">仅管理员</option></select></div>
        <div class="form-group"><label for="admin-notification-title">通知标题</label><input id="admin-notification-title" name="title" maxlength="200" required autocomplete="off"></div>
        <div class="form-group"><label for="admin-notification-content">通知内容</label><textarea id="admin-notification-content" name="content" maxlength="20000" rows="5"></textarea></div>
        <div class="modal-actions"><button type="button" class="btn-cancel" data-close-notification-dialog>取消</button><button type="submit" class="btn-confirm">发送通知</button></div>
      </form>
    </div>`
    const modalHost = document.querySelector('.student-dashboard-wrapper.role-admin') || document.body
    modalHost.appendChild(overlay)
    document.body.classList.add('admin-modal-open')

    const close = () => {
      document.removeEventListener('keydown', onKeydown)
      overlay.remove()
      document.body.classList.remove('admin-modal-open')
    }
    const onKeydown = (event) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKeydown)
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close() })
    overlay.querySelectorAll('[data-close-notification-dialog]').forEach((button) => button.addEventListener('click', close))
    overlay.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const button = event.currentTarget.querySelector('[type="submit"]')
      setBusy(button, true, '正在发送')
      try {
        const result = await createAdminNotification({
          notification_type: form.get('notification_type'),
          target_role: form.get('target_role'),
          title: String(form.get('title') || '').trim(),
          content: String(form.get('content') || '').trim() || null,
        })
        close()
        notifyAdmin(`通知发送成功，已创建 ${result.data.count} 条记录`)
        state.page = 1
        await loadData()
      } catch (error) {
        notifyAdmin(error.message || '通知发送失败，请稍后重试。', true)
        setBusy(button, false)
      }
    })
    overlay.querySelector('[name="title"]')?.focus()
  }

  await loadData()
}
