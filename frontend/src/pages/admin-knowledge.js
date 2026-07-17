// 管理员端知识库管理页面

import { getMe } from '../api/auth.js'
import { getAdminKnowledgeDocuments, reviewKnowledgeDocument } from '../api/admin.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { ADMIN_MENU_ITEMS } from '../utils/admin-menu.js'
import { notifyAdmin, confirmAdmin, promptAdmin } from '../utils/admin-ui.js'
import { escapeHtml } from '../utils/format.js'
import { loadAdminAccess, hasAdminPermission } from '../utils/admin-access.js'

export async function renderAdminKnowledge(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  const displayName = getUserDisplayName()
  let access
  try { access = await loadAdminAccess(user.user_id) } catch (error) {
    renderDashboardLayout(app, { menuItems: ADMIN_MENU_ITEMS, user, contentHTML: `<div class="error-state"><div class="error-message">${escapeHtml(error.message)}</div></div>` })
    return
  }
  const canManage = hasAdminPermission(access, 'admin.knowledge.manage')
  let state = { list: [], total: 0, page: 1, pageSize: 10, loading: true, error: null }
  let filters = { keyword: '', scope_type: '', review_status: '', parse_status: '' }

  async function loadData() {
    state.loading = true; state.error = null
    renderView()
    try {
      const params = { page: state.page, page_size: state.pageSize, ...filters }
      Object.keys(params).forEach((k) => { if (!params[k]) delete params[k] })
      const result = await getAdminKnowledgeDocuments(params)
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
      return `<div class="error-state"><div class="error-icon"></div><div class="error-message">${escapeHtml(state.error)}</div><button class="btn-retry" id="admin-knowledge-retry">重试</button></div>`
    }

    const totalPages = Math.ceil(state.total / state.pageSize) || 1

    function scopeLabel(s) {
      const m = { platform: '平台', course: '课程', class: '班级', personal: '个人' }
      return m[s] || s
    }
    function parseLabel(s) {
      const m = { uploaded: '已上传', parsing: '解析中', parsed: '已解析', chunking: '切片中', chunked: '已切片', embedding: '向量化中', embedded: '已向量化', failed: '失败' }
      return m[s] || s
    }
    function reviewTag(s) {
      if (s === 'approved') return '<span class="tag tag-approved">已通过</span>'
      if (s === 'rejected') return '<span class="tag tag-rejected">已拒绝</span>'
      return '<span class="tag tag-pending">待审核</span>'
    }

    let rows = ''
    if (state.list.length === 0) {
      rows = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--stu-text-muted);">暂无知识库文档</td></tr>`
    } else {
      for (const doc of state.list) {
        const canReview = canManage && doc.review_status === 'pending'
        rows += `<tr>
          <td>${escapeHtml(doc.document_id)}</td>
          <td><strong>${escapeHtml(doc.title)}</strong></td>
          <td>${escapeHtml(doc.owner_name || '-')}</td>
          <td><span class="tag tag-student">${escapeHtml(scopeLabel(doc.scope_type))}</span></td>
          <td><span class="tag tag-pending">${escapeHtml(parseLabel(doc.parse_status))}</span></td>
          <td>${reviewTag(doc.review_status)}</td>
          <td>${escapeHtml(doc.file_ext || '-')} / ${doc.file_size_bytes ? `${escapeHtml((doc.file_size_bytes / 1024).toFixed(0))}KB` : '-'}</td>
          <td>
            <div class="action-btns">
              ${canReview ? `<button class="btn-review" data-id="${doc.document_id}" data-action="approve">通过</button><button class="btn-review" data-id="${doc.document_id}" data-action="reject">拒绝</button>` : `<span style="color:var(--stu-text-muted);font-size:0.82rem;">${doc.review_status === 'pending' ? '仅可查看' : '已审核'}</span>`}
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
      <div class="section-header">
        <div><h2>知识文档</h2><p>查看真实文档、解析状态和审核状态，并执行有审计记录的内容审核。</p></div>
      </div>

      <div class="search-bar">
        <input type="text" aria-label="搜索文档" placeholder="搜索文档标题或文件名..." value="${escapeHtml(filters.keyword)}" id="search-input" />
        <select id="filter-scope" aria-label="知识范围">
          <option value="">全部范围</option>
          <option value="platform" ${filters.scope_type === 'platform' ? 'selected' : ''}>平台</option>
          <option value="course" ${filters.scope_type === 'course' ? 'selected' : ''}>课程</option>
          <option value="class" ${filters.scope_type === 'class' ? 'selected' : ''}>班级</option>
          <option value="personal" ${filters.scope_type === 'personal' ? 'selected' : ''}>个人</option>
        </select>
        <select id="filter-review" aria-label="审核状态">
          <option value="">全部审核状态</option>
          <option value="pending" ${filters.review_status === 'pending' ? 'selected' : ''}>待审核</option>
          <option value="approved" ${filters.review_status === 'approved' ? 'selected' : ''}>已通过</option>
          <option value="rejected" ${filters.review_status === 'rejected' ? 'selected' : ''}>已拒绝</option>
        </select>
        <select id="filter-parse" aria-label="解析状态">
          <option value="">全部解析状态</option>
          <option value="uploaded" ${filters.parse_status === 'uploaded' ? 'selected' : ''}>已上传</option>
          <option value="parsing" ${filters.parse_status === 'parsing' ? 'selected' : ''}>解析中</option>
          <option value="parsed" ${filters.parse_status === 'parsed' ? 'selected' : ''}>已解析</option>
          <option value="embedded" ${filters.parse_status === 'embedded' ? 'selected' : ''}>已向量化</option>
          <option value="failed" ${filters.parse_status === 'failed' ? 'selected' : ''}>失败</option>
        </select>
        <button class="btn-sm btn-primary" id="btn-search">搜索</button>
      </div>

      <div class="card">
        <div class="table-container">
          <table>
            <thead><tr>
              <th>ID</th><th>文档标题</th><th>上传者</th><th>范围</th><th>解析状态</th><th>审核状态</th><th>文件信息</th><th>操作</th>
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
    renderDashboardLayout(app, { menuItems: ADMIN_MENU_ITEMS, contentHTML, user })

    document.getElementById('admin-knowledge-retry')?.addEventListener('click', loadData)

    document.getElementById('btn-search')?.addEventListener('click', () => {
      filters.keyword = document.getElementById('search-input')?.value || ''
      filters.scope_type = document.getElementById('filter-scope')?.value || ''
      filters.review_status = document.getElementById('filter-review')?.value || ''
      filters.parse_status = document.getElementById('filter-parse')?.value || ''
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

    document.querySelectorAll('.btn-review').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const docId = parseInt(btn.dataset.id, 10)
        const action = btn.dataset.action
        const status = action === 'approve' ? 'approved' : 'rejected'
        let comment = '管理员审核通过'
        if (action === 'reject') {
          comment = await promptAdmin({ title: '驳回知识文档', label: '驳回原因', placeholder: '请输入可审计的驳回原因' })
          if (!comment) return notifyAdmin('驳回必须填写原因', true)
        } else if (!(await confirmAdmin({ title: '审核知识文档', message: '确定通过该文档的审核吗？', confirmLabel: '通过' }))) return
        try {
          await reviewKnowledgeDocument(docId, status, comment)
          notifyAdmin('审核完成')
          loadData()
        } catch (err) {
          notifyAdmin('审核失败: ' + err.message, true)
        }
      })
    })
  }

  await loadData()
}
