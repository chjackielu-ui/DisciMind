import {
  addAdminClassStudents,
  createAdminClass,
  deleteAdminClass,
  getAdminClasses,
  getAdminClassStudents,
  getAdminUsers,
  removeAdminClassStudent,
  updateAdminClass,
} from '../api/admin.js'
import { loadAdminAccess, hasAdminPermission } from '../utils/admin-access.js'
import {
  confirmAdmin,
  emptyHTML,
  escapeHtml,
  getIcon,
  notifyAdmin,
  openAdminDrawer,
  renderAdminPage,
  requireAdminUser,
  statusBadge,
} from '../utils/admin-ui.js'

function value(formData, key) {
  const result = String(formData.get(key) || '').trim()
  return result || null
}

function classForm(item = {}) {
  return `
    <div class="admin-form-grid">
      <div class="admin-field is-wide"><label for="class-name">班级名称</label><input class="admin-input" id="class-name" name="class_name" maxlength="100" required value="${escapeHtml(item.class_name || '')}" placeholder="例如：软件工程 2026 级 1 班"></div>
      <div class="admin-field"><label for="class-college">学院</label><input class="admin-input" id="class-college" name="college" maxlength="100" value="${escapeHtml(item.college || '')}"></div>
      <div class="admin-field"><label for="class-major">专业</label><input class="admin-input" id="class-major" name="major" maxlength="100" value="${escapeHtml(item.major || '')}"></div>
      <div class="admin-field"><label for="class-grade">年级</label><input class="admin-input" id="class-grade" name="grade" maxlength="20" value="${escapeHtml(item.grade || '')}" placeholder="例如：2026"></div>
      ${item.admin_class_id ? `<div class="admin-field"><label for="class-status">状态</label><select class="admin-select" id="class-status" name="status"><option value="active" ${item.status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${item.status === 'disabled' ? 'selected' : ''}>停用</option><option value="archived" ${item.status === 'archived' ? 'selected' : ''}>归档</option></select></div>` : ''}
    </div>`
}

export async function renderAdminClasses(app) {
  const user = await requireAdminUser()
  if (!user) return
  let access
  try {
    access = await loadAdminAccess(user.user_id)
  } catch (error) {
    renderAdminPage(app, { user, title: '行政班管理', contentHTML: `<div class="admin-error"><div>${getIcon('alert')}<strong>权限加载失败</strong><p>${escapeHtml(error.message)}</p></div></div>` })
    return
  }

  const canManage = hasAdminPermission(access, 'admin.teaching.manage')
  const state = {
    list: [], total: 0, page: 1, pageSize: 15, totalPages: 1,
    keyword: '', college: '', grade: '', status: '', loading: true, error: '',
  }

  function pagination() {
    if (!state.total) return ''
    return `<div class="admin-pagination"><span>共 ${state.total} 个行政班 · 第 ${state.page}/${state.totalPages} 页</span><div class="admin-pagination-actions"><button class="admin-button is-secondary" id="class-prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><button class="admin-button is-secondary" id="class-next" ${state.page >= state.totalPages ? 'disabled' : ''}>下一页</button></div></div>`
  }

  function tableRows() {
    return state.list.map((item) => `<tr>
      <td><strong>${escapeHtml(item.class_name)}</strong><br><small>${escapeHtml(item.college || '学院未设置')} · ${escapeHtml(item.major || '专业未设置')}</small></td>
      <td>${escapeHtml(item.grade || '-')}</td>
      <td>${escapeHtml(item.advisor_name || '未指定')}</td>
      <td><strong>${Number(item.student_count || 0)}</strong> 名</td>
      <td>${Number(item.teaching_class_count || 0)} 个</td>
      <td>${statusBadge(item.status === 'active' ? '正常' : item.status === 'archived' ? '已归档' : '已停用')}</td>
      <td><div class="admin-inline-actions">
        <button class="admin-button is-secondary" data-members="${item.admin_class_id}">成员</button>
        ${canManage ? `<button class="admin-button is-secondary" data-edit="${item.admin_class_id}">编辑</button><button class="admin-button is-danger" data-delete="${item.admin_class_id}">删除</button>` : ''}
      </div></td>
    </tr>`).join('')
  }

  function render() {
    let body
    if (state.loading) body = '<div class="admin-skeleton" aria-label="正在加载"></div>'
    else if (state.error) body = `<div class="admin-error"><div>${getIcon('alert')}<strong>行政班加载失败</strong><p>${escapeHtml(state.error)}</p><button class="admin-button" id="class-retry">重新加载</button></div></div>`
    else if (!state.list.length) body = emptyHTML('暂无行政班', state.keyword || state.college || state.grade || state.status ? '没有符合当前筛选条件的行政班。' : '创建行政班后，可维护学生归属并关联教学班。')
    else body = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>班级</th><th>年级</th><th>辅导员</th><th>学生</th><th>关联教学班</th><th>状态</th><th>操作</th></tr></thead><tbody>${tableRows()}</tbody></table></div>${pagination()}`

    renderAdminPage(app, {
      user,
      title: '行政班管理',
      contentHTML: `<div class="admin-page">
        <header class="admin-page-header"><div><h2>行政班管理</h2><p>维护学生行政归属、学院专业信息和教学班关联；有成员或教学关联时禁止直接删除。</p></div><div class="admin-header-actions">${canManage ? '<button class="admin-button" id="class-create">新建行政班</button>' : ''}</div></header>
        <section class="admin-card admin-filter-bar">
          <div class="admin-field is-search"><label for="class-keyword">关键词</label><input class="admin-input" id="class-keyword" value="${escapeHtml(state.keyword)}" placeholder="班级、学院或专业"></div>
          <div class="admin-field"><label for="class-college-filter">学院</label><input class="admin-input" id="class-college-filter" value="${escapeHtml(state.college)}"></div>
          <div class="admin-field"><label for="class-grade-filter">年级</label><input class="admin-input" id="class-grade-filter" value="${escapeHtml(state.grade)}"></div>
          <div class="admin-field"><label for="class-status-filter">状态</label><select class="admin-select" id="class-status-filter"><option value="">全部</option><option value="active" ${state.status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${state.status === 'disabled' ? 'selected' : ''}>停用</option><option value="archived" ${state.status === 'archived' ? 'selected' : ''}>归档</option></select></div>
          <button class="admin-button is-secondary" id="class-search">查询</button><button class="admin-button is-ghost" id="class-reset">重置</button>
        </section>
        <section class="admin-card"><div class="admin-card-header"><div><h3>行政班列表</h3><p>数据直接来自行政班与用户档案关系。</p></div><span class="admin-badge is-info">${state.total} 个</span></div>${body}</section>
      </div>`,
    })
    bind()
  }

  async function load() {
    state.loading = true; state.error = ''; render()
    try {
      const result = await getAdminClasses({
        page: state.page, page_size: state.pageSize,
        ...(state.keyword ? { keyword: state.keyword } : {}),
        ...(state.college ? { college: state.college } : {}),
        ...(state.grade ? { grade: state.grade } : {}),
        ...(state.status ? { status: state.status } : {}),
      })
      const data = result.data || {}
      state.list = data.list || []
      state.total = Number(data.total || 0)
      state.totalPages = Number(data.total_pages || Math.max(1, Math.ceil(state.total / state.pageSize)))
    } catch (error) {
      state.list = []; state.total = 0; state.totalPages = 1; state.error = error.message || '请求失败'
    } finally { state.loading = false; render() }
  }

  function openEditor(item = {}) {
    openAdminDrawer({
      title: item.admin_class_id ? '编辑行政班' : '新建行政班',
      content: classForm(item),
      submitLabel: item.admin_class_id ? '保存修改' : '创建班级',
      onSubmit: async (formData) => {
        const payload = {
          class_name: value(formData, 'class_name'), college: value(formData, 'college'),
          major: value(formData, 'major'), grade: value(formData, 'grade'),
        }
        if (item.admin_class_id) {
          payload.status = value(formData, 'status')
          await updateAdminClass(item.admin_class_id, payload)
        } else await createAdminClass(payload)
        notifyAdmin(item.admin_class_id ? '行政班已更新' : '行政班已创建')
        await load()
      },
    })
  }

  async function openMembers(item, candidateKeyword = '') {
    let members = []
    let candidates = []
    try {
      const [memberResult, candidateResult] = await Promise.all([
        getAdminClassStudents(item.admin_class_id, { page: 1, page_size: 100 }),
        getAdminUsers({ role: 'student', status: 'active', page: 1, page_size: 100, ...(candidateKeyword ? { keyword: candidateKeyword } : {}) }),
      ])
      members = memberResult.data?.list || []
      const memberIds = new Set(members.map((entry) => Number(entry.student_user_id)))
      candidates = (candidateResult.data?.list || []).filter((entry) => !memberIds.has(Number(entry.user_id)))
    } catch (error) {
      notifyAdmin(error.message || '成员数据加载失败', true)
      return
    }
    const memberRows = members.length ? members.map((entry) => `<tr><td><strong>${escapeHtml(entry.real_name || entry.username)}</strong><br><small>${escapeHtml(entry.student_no || entry.username)}</small></td><td>${statusBadge(entry.status === 'active' ? '正常' : '已停用')}</td><td>${canManage ? `<button class="admin-button is-danger" type="button" data-remove-member="${entry.student_user_id}">移出</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="3">当前没有学生</td></tr>'
    const candidateRows = candidates.length ? candidates.map((entry) => `<label class="admin-choice"><input type="checkbox" name="student_user_ids" value="${entry.user_id}"><span><strong>${escapeHtml(entry.real_name || entry.username)}</strong><small>${escapeHtml(entry.student_no || entry.username)}${entry.admin_class_name ? ` · 当前：${escapeHtml(entry.admin_class_name)}` : ''}</small></span></label>`).join('') : '<p class="admin-help">没有可加入的正常学生，请调整关键词。</p>'
    const drawer = openAdminDrawer({
      title: `${item.class_name} · 成员`,
      submitLabel: '加入选中学生',
      content: `<section class="admin-card"><div class="admin-card-header"><div><h3>当前成员</h3><p>共 ${members.length} 名；转出不会删除学生账号。</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>学生</th><th>状态</th><th>操作</th></tr></thead><tbody>${memberRows}</tbody></table></div></section>
        ${canManage ? `<section class="admin-card"><div class="admin-card-header"><div><h3>加入学生</h3><p>若学生已有行政班，提交后将完成转班。</p></div></div><div class="admin-inline-actions"><input class="admin-input" id="member-candidate-keyword" value="${escapeHtml(candidateKeyword)}" placeholder="姓名、账号或学号"><button class="admin-button is-secondary" type="button" id="member-candidate-search">查询</button></div><div class="admin-choice-list">${candidateRows}</div></section>` : ''}`,
      onSubmit: async (formData) => {
        if (!canManage) return
        const ids = formData.getAll('student_user_ids').map(Number)
        if (!ids.length) { notifyAdmin('请至少选择一名学生', true); return false }
        await addAdminClassStudents(item.admin_class_id, ids)
        notifyAdmin(`已加入 ${ids.length} 名学生`)
        await load()
      },
    })
    if (!canManage) drawer.root.querySelector('[type="submit"]')?.remove()
    drawer.root.querySelector('#member-candidate-search')?.addEventListener('click', () => {
      const keyword = drawer.root.querySelector('#member-candidate-keyword')?.value.trim() || ''
      drawer.close(); openMembers(item, keyword)
    })
    drawer.root.querySelectorAll('[data-remove-member]').forEach((button) => button.addEventListener('click', async () => {
      const confirmed = await confirmAdmin({ title: '移出行政班', message: '仅清除该学生的行政班归属，不会删除账号。', confirmLabel: '确认移出', danger: true })
      if (!confirmed) return
      try {
        await removeAdminClassStudent(item.admin_class_id, Number(button.dataset.removeMember))
        notifyAdmin('学生已移出行政班'); drawer.close(); await load(); await openMembers(item)
      } catch (error) { notifyAdmin(error.message || '移出失败', true) }
    }))
  }

  function bind() {
    document.getElementById('class-retry')?.addEventListener('click', load)
    document.getElementById('class-create')?.addEventListener('click', () => openEditor())
    document.getElementById('class-search')?.addEventListener('click', () => {
      state.keyword = document.getElementById('class-keyword')?.value.trim() || ''
      state.college = document.getElementById('class-college-filter')?.value.trim() || ''
      state.grade = document.getElementById('class-grade-filter')?.value.trim() || ''
      state.status = document.getElementById('class-status-filter')?.value || ''
      state.page = 1; load()
    })
    document.getElementById('class-keyword')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') document.getElementById('class-search')?.click() })
    document.getElementById('class-reset')?.addEventListener('click', () => { Object.assign(state, { keyword: '', college: '', grade: '', status: '', page: 1 }); load() })
    document.getElementById('class-prev')?.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load() } })
    document.getElementById('class-next')?.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load() } })
    document.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => openEditor(state.list.find((item) => item.admin_class_id === Number(button.dataset.edit)))))
    document.querySelectorAll('[data-members]').forEach((button) => button.addEventListener('click', () => openMembers(state.list.find((item) => item.admin_class_id === Number(button.dataset.members)))))
    document.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
      const item = state.list.find((entry) => entry.admin_class_id === Number(button.dataset.delete))
      const confirmed = await confirmAdmin({ title: '删除行政班', message: `${item.class_name} 仅在没有学生和教学班关联时可删除。`, confirmLabel: '确认删除', danger: true })
      if (!confirmed) return
      try { await deleteAdminClass(item.admin_class_id); notifyAdmin('行政班已删除'); await load() } catch (error) { notifyAdmin(error.message || '删除失败', true) }
    }))
  }

  render()
  await load()
}
