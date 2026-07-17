import {
  addTeachingClassStudents,
  createTeachingClass,
  deleteTeachingClass,
  getAdminClasses,
  getAdminCourses,
  getAdminUsers,
  getTeachingClassPage,
  getTeachingClassStudents,
  removeTeachingClassStudent,
  updateTeachingClass,
} from '../api/admin.js'
import { loadAdminAccess, hasAdminPermission } from '../utils/admin-access.js'
import {
  confirmAdmin, emptyHTML, escapeHtml, getIcon, notifyAdmin, openAdminDrawer,
  renderAdminPage, requireAdminUser, statusBadge,
} from '../utils/admin-ui.js'

const pick = (formData, key) => String(formData.get(key) || '').trim() || null

export async function renderAdminTeachingClasses(app) {
  const user = await requireAdminUser()
  if (!user) return
  let access
  try { access = await loadAdminAccess(user.user_id) } catch (error) {
    renderAdminPage(app, { user, title: '教学班管理', contentHTML: `<div class="admin-error"><div>${getIcon('alert')}<strong>权限加载失败</strong><p>${escapeHtml(error.message)}</p></div></div>` })
    return
  }
  const canManage = hasAdminPermission(access, 'admin.teaching.manage')
  const state = { list: [], total: 0, page: 1, pageSize: 15, totalPages: 1, keyword: '', status: '', courseId: '', loading: true, error: '', courses: [], adminClasses: [], teachers: [] }

  function courseOptions(selected = '') { return `<option value="">全部课程</option>${state.courses.map((item) => `<option value="${item.course_id}" ${Number(selected) === item.course_id ? 'selected' : ''}>${escapeHtml(item.course_name)} (${escapeHtml(item.course_code)})</option>`).join('')}` }
  function teacherOptions(selected = '') { return `<option value="">未指定</option>${state.teachers.map((item) => `<option value="${item.user_id}" ${Number(selected) === item.user_id ? 'selected' : ''}>${escapeHtml(item.real_name || item.username)} (${escapeHtml(item.teacher_no || item.username)})</option>`).join('')}` }
  function adminClassChoices(selected = []) {
    const set = new Set(selected.map((entry) => Number(entry.admin_class_id || entry)))
    return state.adminClasses.length ? state.adminClasses.map((item) => `<label class="admin-choice"><input type="checkbox" name="admin_class_ids" value="${item.admin_class_id}" ${set.has(item.admin_class_id) ? 'checked' : ''}><span><strong>${escapeHtml(item.class_name)}</strong><small>${escapeHtml(item.grade || '年级未设置')} · ${item.student_count || 0} 名学生</small></span></label>`).join('') : '<p class="admin-help">暂无正常行政班，可稍后关联。</p>'
  }

  function render() {
    const rows = state.list.map((item) => `<tr><td><strong>${escapeHtml(item.teaching_class_name)}</strong><br><small><code>${escapeHtml(item.code || '未设置编码')}</code></small></td><td>${escapeHtml(item.course_name || '-')}<br><small>${escapeHtml(item.course_code || '')}</small></td><td>${escapeHtml(item.semester || '-')}<br><small>${escapeHtml(item.location || '地点未设置')}</small></td><td>${escapeHtml(item.teacher_name || '未指定')}</td><td><strong>${item.student_count || 0}</strong>${item.capacity ? ` / ${item.capacity}` : ''}</td><td>${(item.admin_classes || []).map((entry) => escapeHtml(entry.class_name)).join('、') || '-'}</td><td>${statusBadge(item.status === 'active' ? '正常' : item.status === 'archived' ? '已归档' : '已停用')}</td><td><div class="admin-inline-actions"><button class="admin-button is-secondary" data-teaching-members="${item.teaching_class_id}">成员</button>${canManage ? `<button class="admin-button is-secondary" data-teaching-edit="${item.teaching_class_id}">编辑</button><button class="admin-button is-danger" data-teaching-delete="${item.teaching_class_id}">${item.status === 'archived' ? '已归档' : '归档/删除'}</button>` : ''}</div></td></tr>`).join('')
    let body
    if (state.loading) body = '<div class="admin-skeleton" aria-label="正在加载"></div>'
    else if (state.error) body = `<div class="admin-error"><div>${getIcon('alert')}<strong>教学班加载失败</strong><p>${escapeHtml(state.error)}</p><button class="admin-button" id="teaching-retry">重新加载</button></div></div>`
    else if (!state.list.length) body = emptyHTML('暂无教学班', state.keyword || state.status || state.courseId ? '没有符合当前筛选条件的教学班。' : '教学班承载课程学生、教师和行政班关联。')
    else body = `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>教学班</th><th>课程</th><th>学期 / 地点</th><th>主讲教师</th><th>学生 / 容量</th><th>行政班</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div><div class="admin-pagination"><span>共 ${state.total} 个教学班 · 第 ${state.page}/${state.totalPages} 页</span><div class="admin-pagination-actions"><button class="admin-button is-secondary" id="teaching-prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><button class="admin-button is-secondary" id="teaching-next" ${state.page >= state.totalPages ? 'disabled' : ''}>下一页</button></div></div>`
    renderAdminPage(app, { user, title: '教学班管理', contentHTML: `<div class="admin-page"><header class="admin-page-header"><div><h2>教学班管理</h2><p>按课程维护授课班、主讲教师、学生名单和行政班关联；已有业务记录时删除将安全归档。</p></div><div class="admin-header-actions">${canManage ? '<button class="admin-button" id="teaching-create">新建教学班</button>' : ''}</div></header><section class="admin-card admin-filter-bar"><div class="admin-field is-search"><label for="teaching-keyword">关键词</label><input class="admin-input" id="teaching-keyword" value="${escapeHtml(state.keyword)}" placeholder="教学班、编码、课程或学期"></div><div class="admin-field"><label for="teaching-course-filter">课程</label><select class="admin-select" id="teaching-course-filter">${courseOptions(state.courseId)}</select></div><div class="admin-field"><label for="teaching-status-filter">状态</label><select class="admin-select" id="teaching-status-filter"><option value="">全部</option><option value="active" ${state.status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${state.status === 'disabled' ? 'selected' : ''}>停用</option><option value="archived" ${state.status === 'archived' ? 'selected' : ''}>归档</option></select></div><button class="admin-button is-secondary" id="teaching-search">查询</button><button class="admin-button is-ghost" id="teaching-reset">重置</button></section><section class="admin-card"><div class="admin-card-header"><div><h3>教学班列表</h3><p>学生人数仅统计当前有效选课。</p></div><span class="admin-badge is-info">${state.total} 个</span></div>${body}</section></div>` })
    bind()
  }

  async function loadAuxiliary() {
    const [courseResult, classResult, teacherResult] = await Promise.all([
      getAdminCourses({ page: 1, page_size: 100, status: 'active' }),
      getAdminClasses({ page: 1, page_size: 100, status: 'active' }),
      getAdminUsers({ page: 1, page_size: 100, role: 'teacher', status: 'active' }),
    ])
    state.courses = courseResult.data?.list || courseResult.data?.courses || []
    state.adminClasses = classResult.data?.list || []
    state.teachers = teacherResult.data?.list || []
  }

  async function load() {
    state.loading = true; state.error = ''; render()
    try {
      const result = await getTeachingClassPage({ page: state.page, page_size: state.pageSize, ...(state.keyword ? { keyword: state.keyword } : {}), ...(state.status ? { status: state.status } : {}), ...(state.courseId ? { course_id: state.courseId } : {}) })
      const data = result.data || {}; state.list = data.list || []; state.total = Number(data.total || 0); state.totalPages = Number(data.total_pages || Math.max(1, Math.ceil(state.total / state.pageSize)))
    } catch (error) { state.list = []; state.total = 0; state.totalPages = 1; state.error = error.message || '请求失败' }
    finally { state.loading = false; render() }
  }

  function openEditor(item = {}) {
    const selectedCourse = item.course_id || state.courses[0]?.course_id || ''
    const statusField = item.teaching_class_id
      ? `<div class="admin-field"><label for="teaching-status">状态</label><select class="admin-select" id="teaching-status" name="status"><option value="active" ${item.status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${item.status === 'disabled' ? 'selected' : ''}>停用</option><option value="archived" ${item.status === 'archived' ? 'selected' : ''}>归档</option></select></div>`
      : ''
    const content = `<div class="admin-form-grid">
      <div class="admin-field is-wide"><label for="teaching-course">课程</label><select class="admin-select" id="teaching-course" name="course_id" required ${item.teaching_class_id ? 'disabled' : ''}>${courseOptions(selectedCourse).replace('<option value="">全部课程</option>', '<option value="">请选择课程</option>')}</select></div>
      <div class="admin-field"><label for="teaching-name">教学班名称</label><input class="admin-input" id="teaching-name" name="teaching_class_name" maxlength="100" required value="${escapeHtml(item.teaching_class_name || '')}"></div>
      <div class="admin-field"><label for="teaching-code">教学班编码</label><input class="admin-input" id="teaching-code" name="code" maxlength="80" value="${escapeHtml(item.code || '')}"></div>
      <div class="admin-field"><label for="teaching-semester">学期</label><input class="admin-input" id="teaching-semester" name="semester" maxlength="50" value="${escapeHtml(item.semester || '')}" placeholder="2026-2027-1"></div>
      <div class="admin-field"><label for="teaching-location">地点</label><input class="admin-input" id="teaching-location" name="location" maxlength="200" value="${escapeHtml(item.location || '')}"></div>
      <div class="admin-field"><label for="teaching-capacity">容量</label><input class="admin-input" id="teaching-capacity" type="number" min="1" name="capacity" value="${escapeHtml(item.capacity || '')}"></div>
      <div class="admin-field"><label for="teaching-teacher">主讲教师</label><select class="admin-select" id="teaching-teacher" name="teacher_user_id">${teacherOptions(item.teacher_user_id)}</select></div>
      ${statusField}
      <div class="admin-field is-wide"><span class="admin-field-label">关联行政班</span><div class="admin-choice-list">${adminClassChoices(item.admin_classes || [])}</div></div>
      <div class="admin-field is-wide"><label for="teaching-description">说明</label><textarea class="admin-textarea" id="teaching-description" name="description" maxlength="5000">${escapeHtml(item.description || '')}</textarea></div>
    </div>`
    openAdminDrawer({ title: item.teaching_class_id ? '编辑教学班' : '新建教学班', submitLabel: item.teaching_class_id ? '保存修改' : '创建教学班', content, onSubmit: async (formData) => {
      const payload = { teaching_class_name: pick(formData, 'teaching_class_name'), code: pick(formData, 'code'), semester: pick(formData, 'semester'), location: pick(formData, 'location'), capacity: pick(formData, 'capacity'), teacher_user_id: pick(formData, 'teacher_user_id'), description: pick(formData, 'description'), admin_class_ids: formData.getAll('admin_class_ids').map(Number) }
      if (item.teaching_class_id) { payload.status = pick(formData, 'status'); await updateTeachingClass(item.teaching_class_id, payload) } else await createTeachingClass(Number(pick(formData, 'course_id')), payload)
      notifyAdmin(item.teaching_class_id ? '教学班已更新' : '教学班已创建'); await load()
    } })
  }

  async function openMembers(item, candidateKeyword = '') {
    let members = []; let candidates = []
    try {
      const [memberResult, candidateResult] = await Promise.all([getTeachingClassStudents(item.teaching_class_id, { page: 1, page_size: 100 }), getAdminUsers({ role: 'student', status: 'active', page: 1, page_size: 100, ...(candidateKeyword ? { keyword: candidateKeyword } : {}) })])
      members = memberResult.data?.list || []; const ids = new Set(members.map((entry) => Number(entry.student_user_id))); candidates = (candidateResult.data?.list || []).filter((entry) => !ids.has(Number(entry.user_id)))
    } catch (error) { notifyAdmin(error.message || '成员数据加载失败', true); return }
    const memberRows = members.length ? members.map((entry) => `<tr><td><strong>${escapeHtml(entry.real_name || entry.username)}</strong><br><small>${escapeHtml(entry.student_no || entry.username)}</small></td><td>${escapeHtml(new Date(entry.joined_at).toLocaleDateString('zh-CN'))}</td><td>${canManage ? `<button class="admin-button is-danger" type="button" data-drop-student="${entry.student_user_id}">退班</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="3">当前没有学生</td></tr>'
    const candidatesHtml = candidates.length ? candidates.map((entry) => `<label class="admin-choice"><input type="checkbox" name="student_user_ids" value="${entry.user_id}"><span><strong>${escapeHtml(entry.real_name || entry.username)}</strong><small>${escapeHtml(entry.student_no || entry.username)}${entry.admin_class_name ? ` · ${escapeHtml(entry.admin_class_name)}` : ''}</small></span></label>`).join('') : '<p class="admin-help">没有可加入的正常学生。</p>'
    const drawer = openAdminDrawer({ title: `${item.teaching_class_name} · 学生名单`, submitLabel: '加入选中学生', content: `<section class="admin-card"><div class="admin-card-header"><div><h3>当前学生</h3><p>${members.length}${item.capacity ? ` / ${item.capacity}` : ''} 名</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>学生</th><th>加入日期</th><th>操作</th></tr></thead><tbody>${memberRows}</tbody></table></div></section>${canManage ? `<section class="admin-card"><div class="admin-card-header"><div><h3>加入学生</h3><p>同一课程已有选课时，将转入当前教学班。</p></div></div><div class="admin-inline-actions"><input class="admin-input" id="teaching-candidate-keyword" value="${escapeHtml(candidateKeyword)}" placeholder="姓名、账号或学号"><button class="admin-button is-secondary" type="button" id="teaching-candidate-search">查询</button></div><div class="admin-choice-list">${candidatesHtml}</div></section>` : ''}`, onSubmit: async (formData) => { if (!canManage) return; const ids = formData.getAll('student_user_ids').map(Number); if (!ids.length) { notifyAdmin('请至少选择一名学生', true); return false } await addTeachingClassStudents(item.teaching_class_id, ids); notifyAdmin(`已加入 ${ids.length} 名学生`); await load() } })
    if (!canManage) drawer.root.querySelector('[type="submit"]')?.remove()
    drawer.root.querySelector('#teaching-candidate-search')?.addEventListener('click', () => { const keyword = drawer.root.querySelector('#teaching-candidate-keyword')?.value.trim() || ''; drawer.close(); openMembers(item, keyword) })
    drawer.root.querySelectorAll('[data-drop-student]').forEach((button) => button.addEventListener('click', async () => { const confirmed = await confirmAdmin({ title: '学生退班', message: '将保留选课历史，并把当前选课标记为已退班。', confirmLabel: '确认退班', danger: true }); if (!confirmed) return; try { await removeTeachingClassStudent(item.teaching_class_id, Number(button.dataset.dropStudent)); notifyAdmin('学生已退出教学班'); drawer.close(); await load(); await openMembers(item) } catch (error) { notifyAdmin(error.message || '退班失败', true) } }))
  }

  function bind() {
    document.getElementById('teaching-retry')?.addEventListener('click', load)
    document.getElementById('teaching-create')?.addEventListener('click', () => openEditor())
    document.getElementById('teaching-search')?.addEventListener('click', () => { state.keyword = document.getElementById('teaching-keyword')?.value.trim() || ''; state.courseId = document.getElementById('teaching-course-filter')?.value || ''; state.status = document.getElementById('teaching-status-filter')?.value || ''; state.page = 1; load() })
    document.getElementById('teaching-keyword')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') document.getElementById('teaching-search')?.click() })
    document.getElementById('teaching-reset')?.addEventListener('click', () => { Object.assign(state, { keyword: '', courseId: '', status: '', page: 1 }); load() })
    document.getElementById('teaching-prev')?.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load() } }); document.getElementById('teaching-next')?.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load() } })
    document.querySelectorAll('[data-teaching-edit]').forEach((button) => button.addEventListener('click', () => openEditor(state.list.find((item) => item.teaching_class_id === Number(button.dataset.teachingEdit)))))
    document.querySelectorAll('[data-teaching-members]').forEach((button) => button.addEventListener('click', () => openMembers(state.list.find((item) => item.teaching_class_id === Number(button.dataset.teachingMembers)))))
    document.querySelectorAll('[data-teaching-delete]').forEach((button) => button.addEventListener('click', async () => { const item = state.list.find((entry) => entry.teaching_class_id === Number(button.dataset.teachingDelete)); if (item.status === 'archived') return; const confirmed = await confirmAdmin({ title: '归档或删除教学班', message: '没有业务记录时将删除；存在选课、知识库或任务记录时将安全归档。', confirmLabel: '继续', danger: true }); if (!confirmed) return; try { const result = await deleteTeachingClass(item.teaching_class_id); notifyAdmin(result.data?.deletion_mode === 'soft' ? '教学班已归档' : '教学班已删除'); await load() } catch (error) { notifyAdmin(error.message || '操作失败', true) } }))
  }

  render()
  try { await loadAuxiliary() } catch (error) { notifyAdmin(`部分选项加载失败：${error.message}`, true) }
  await load()
}
