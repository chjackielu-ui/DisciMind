// 管理员端操作日志页面

import { getMe } from '../api/auth.js'
import { getOperationLogs } from '../api/admin.js'
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

export async function renderAdminLogs(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  let state = { list: [], total: 0, page: 1, pageSize: 15, loading: true, error: null }
  let filters = { operation_type: '', start_date: '', end_date: '' }

  async function loadData() {
    state.loading = true; state.error = null
    renderView()
    try {
      const params = { page: state.page, page_size: state.pageSize, ...filters }
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k] })
      const result = await getOperationLogs(params)
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
      return `<div class="error-state"><div class="error-icon">⚠️</div><div class="error-message">${state.error}</div><button class="btn-retry" onclick="location.reload()">重试</button></div>`
    }

    const totalPages = Math.ceil(state.total / state.pageSize) || 1

    const typeLabels = {
      task_create: '创建任务', task_submit: '提交任务', task_grade: '批改任务',
      user_create: '创建用户', user_update: '更新用户', user_status: '修改状态',
      course_create: '创建课程', course_update: '更新课程',
      document_upload: '上传文档', document_review: '审核文档',
      knowledge_create: '创建知识点', question_create: '创建题目',
      login: '登录', register: '注册', other: '其他',
    }

    let rows = ''
    if (state.list.length === 0) {
      rows = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--stu-text-muted);">暂无操作日志</td></tr>`
    } else {
      for (const log of state.list) {
        const typeLabel = typeLabels[log.operation_type] || log.operation_type
        const time = log.created_at ? new Date(log.created_at).toLocaleString('zh-CN') : '-'
        rows += `<tr>
          <td>${log.operation_log_id}</td>
          <td>${log.real_name || log.username || '-'}</td>
          <td><span class="tag ${log.role === 'admin' ? 'tag-admin' : log.role === 'teacher' ? 'tag-teacher' : 'tag-student'}">${log.role || '-'}</span></td>
          <td>${typeLabel}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${log.operation_desc || ''}">${log.operation_desc || '-'}</td>
          <td>${time}</td>
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
      <div class="section-header">
        <h2>📋 操作日志</h2>
      </div>

      <div class="search-bar">
        <input type="text" placeholder="搜索操作描述..." value="${filters.operation_type}" id="search-input" />
        <input type="date" id="filter-start" value="${filters.start_date}" title="开始日期" />
        <input type="date" id="filter-end" value="${filters.end_date}" title="结束日期" />
        <button class="btn-sm btn-primary" id="btn-search">搜索</button>
        <button class="btn-sm btn-secondary" id="btn-reset">重置</button>
      </div>

      <div class="card">
        <div class="table-container">
          <table>
            <thead><tr>
              <th>ID</th><th>操作人</th><th>角色</th><th>操作类型</th><th>操作描述</th><th>时间</th>
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
    renderDashboardLayout(app, { title: '操作日志', menuItems, contentHTML, user })

    document.getElementById('btn-search')?.addEventListener('click', () => {
      filters.operation_type = document.getElementById('search-input')?.value || ''
      filters.start_date = document.getElementById('filter-start')?.value || ''
      filters.end_date = document.getElementById('filter-end')?.value || ''
      state.page = 1
      loadData()
    })

    document.getElementById('btn-reset')?.addEventListener('click', () => {
      filters = { operation_type: '', start_date: '', end_date: '' }
      state.page = 1
      loadData()
    })

    document.querySelectorAll('[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.page
        if (action === 'prev' && state.page > 1) { state.page--; loadData() }
        if (action === 'next') { const tp = Math.ceil(state.total / state.pageSize); if (state.page < tp) { state.page++; loadData() } }
      })
    })
  }

  await loadData()
}
