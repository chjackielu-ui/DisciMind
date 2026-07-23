import { getMe } from '../api/auth.js'
import {
  getTeacherQuestions, deleteTeacherQuestion, getTeacherCourses, getKnowledgePoints,
  batchImportQuestions, batchUpdateQuestions, batchDeleteQuestions, exportQuestions, aiGenerateQuestions,
} from '../api/teacher.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { teacherCourseLabel } from '../utils/teacher-course.js'

const TYPES = { single_choice: '单选', multiple_choice: '多选', true_false: '判断', fill_blank: '填空', blank: '填空', short_answer: '简答', programming: '编程' }
const DIFFICULTIES = { basic: '基础', medium: '中等', hard: '困难' }

export async function renderTeacherQuestions(app) {
  let user = getUser()
  const routeQuery = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const initialCourseId = Number(routeQuery.get('course_id')) || null
  try { const result = await getMe(); user = result.data.user; setAuth(getToken(), user) }
  catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }

  const state = { page: 1, pageSize: 20, total: 0, list: [], selected: new Set(), courses: [], knowledgePoints: [], aiPreview: [] }
  const contentHTML = `<div class="teacher-question-page">
    <header class="teacher-page-head compact"><div><span class="teacher-eyebrow">真实题库</span><h2>题库管理</h2><p>筛选、批量维护、JSON 导入导出与 AI 审核入库均复用现有 Question 模型。</p></div><div><button class="teacher-btn" id="qb-import">批量导入</button><button class="teacher-btn" id="qb-ai">AI 生成</button><button class="teacher-btn primary" id="qb-create">新建题目</button></div></header>
    <section class="qb-filter-shell"><div class="qb-filters"><input id="qb-keyword" placeholder="搜索题目内容"><select id="qb-course"><option value="">全部课程</option></select><select id="qb-kp"><option value="">全部知识点</option></select><select id="qb-type"><option value="">全部题型</option>${Object.entries(TYPES).filter(([key]) => key !== 'blank').map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select><button class="teacher-btn" id="qb-advanced-toggle" aria-expanded="false">高级筛选</button><button class="teacher-btn primary" id="qb-search">查询</button><button class="teacher-btn" id="qb-reset">重置</button></div><div class="qb-advanced" id="qb-advanced" hidden><label>难度<select id="qb-difficulty"><option value="">全部难度</option>${Object.entries(DIFFICULTIES).map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>来源<select id="qb-source"><option value="">全部来源</option><option value="manual">教师创建</option><option value="ai">AI 生成</option></select></label><label>状态<select id="qb-status"><option value="">全部状态</option><option value="active">启用</option><option value="pending">待审核</option><option value="disabled">停用</option></select></label><button class="teacher-btn" id="qb-export">导出当前筛选</button></div></section>
    <section class="qb-batch" id="qb-batch" hidden><span>已选择 <b id="qb-selected-count">0</b> 题</span><select id="qb-batch-field"><option value="">选择批量操作</option><option value="difficulty_level">修改难度</option><option value="question_type">修改题型</option><option value="knowledge_point_id">修改知识点</option><option value="status">修改状态/审核</option></select><select id="qb-batch-value"><option value="">请选择值</option></select><button class="teacher-btn" id="qb-batch-apply">应用</button><button class="teacher-btn danger" id="qb-batch-delete">批量删除</button></section>
    <section class="qb-table-card"><div class="qb-table-wrap"><table><thead><tr><th><input id="qb-all" type="checkbox" aria-label="全选当前页"></th><th>题目</th><th>课程/知识点</th><th>题型</th><th>难度</th><th>来源</th><th>使用/正确率</th><th>状态</th><th>操作</th></tr></thead><tbody id="qb-body"><tr><td colspan="9"><div class="teacher-inline-empty">加载中</div></td></tr></tbody></table></div><footer><span id="qb-total">0 道题</span><div><button class="teacher-btn" id="qb-prev">上一页</button><span id="qb-page">1 / 1</span><button class="teacher-btn" id="qb-next">下一页</button></div></footer></section>
    <dialog id="qb-import-dialog" class="teacher-dialog"><form id="qb-import-form"><header><h3>批量导入题目</h3><button type="button" data-close>×</button></header><p class="dialog-note">粘贴 JSON 数组。每项至少包含 course_id、title、question_type、correct_answer；单次最多 500 题。</p><textarea id="qb-import-json" rows="14" spellcheck="false" placeholder='[{"course_id":1,"title":"示例题","question_type":"single_choice","correct_answer":"A"}]'></textarea><footer><button type="button" class="teacher-btn" data-close>取消</button><button class="teacher-btn primary" type="submit">校验并导入</button></footer></form></dialog>
    <dialog id="qb-ai-dialog" class="teacher-dialog qb-ai-dialog"><form id="qb-ai-form"><header><h3>AI 生成题目</h3><button type="button" data-close>×</button></header><div class="teacher-form-grid"><label>课程<select name="course_id" required></select></label><label>数量<input name="count" type="number" min="1" max="30" value="5"></label><label>题型<select name="question_type">${Object.entries(TYPES).filter(([key]) => key !== 'blank').map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>难度<select name="difficulty_level">${Object.entries(DIFFICULTIES).map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select><label class="wide">生成要求<textarea name="prompt" rows="2" placeholder="例如：覆盖决策树剪枝，强调概念辨析"></textarea></label></div><div id="qb-ai-preview" class="qb-ai-preview"><div class="teacher-inline-empty">AI 结果会先在此预览，不会直接写入题库。</div></div><footer><button type="button" class="teacher-btn" id="qb-ai-generate">生成预览</button><button class="teacher-btn primary" type="submit" disabled>审核并入库</button></footer></form></dialog>
  </div>`
  renderDashboardLayout(app, { title: '题库管理', menuItems: TEACHER_MENU_ITEMS, contentHTML, user })

  function filters() { return { page: state.page, page_size: state.pageSize, keyword: document.getElementById('qb-keyword').value.trim(), course_id: document.getElementById('qb-course').value, knowledge_point_id: document.getElementById('qb-kp').value, question_type: document.getElementById('qb-type').value, difficulty_level: document.getElementById('qb-difficulty').value, source: document.getElementById('qb-source').value, status: document.getElementById('qb-status').value } }

  async function loadCourses() {
    const response = await getTeacherCourses({ page_size: 100 }); state.courses = response.data.list || response.data || []
    const html = '<option value="">全部课程</option>' + state.courses.map((item) => `<option value="${item.course_id}">${escapeHtml(teacherCourseLabel(item))}</option>`).join('')
    document.getElementById('qb-course').innerHTML = html
    document.querySelector('#qb-ai-form [name="course_id"]').innerHTML = '<option value="">请选择课程</option>' + state.courses.map((item) => `<option value="${item.course_id}">${escapeHtml(teacherCourseLabel(item))}</option>`).join('')
  }

  async function loadKnowledgePoints(courseId) {
    state.knowledgePoints = []
    if (courseId) { const response = await getKnowledgePoints(Number(courseId)); state.knowledgePoints = response.data.list || response.data || [] }
    document.getElementById('qb-kp').innerHTML = '<option value="">全部知识点</option>' + state.knowledgePoints.map((item) => `<option value="${item.knowledge_point_id}">${escapeHtml(item.knowledge_point_name)}</option>`).join('')
    if (document.getElementById('qb-batch-field').value === 'knowledge_point_id') renderBatchValues()
  }

  function renderRows() {
    const tbody = document.getElementById('qb-body')
    if (!state.list.length) tbody.innerHTML = '<tr><td colspan="9"><div class="teacher-inline-empty">当前筛选下暂无题目</div></td></tr>'
    else tbody.innerHTML = state.list.map((item) => `<tr><td><input type="checkbox" data-select="${item.question_id}" ${state.selected.has(item.question_id) ? 'checked' : ''}></td><td><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.created_by_name || '未知创建人')} · ${new Date(item.created_at).toLocaleDateString()}</small></td><td><span>${escapeHtml(item.course_name || '-')}</span><small>${escapeHtml(item.knowledge_point_name || '未绑定知识点')}</small></td><td>${TYPES[item.question_type] || escapeHtml(item.question_type)}</td><td><span class="qb-difficulty ${item.difficulty_level}">${DIFFICULTIES[item.difficulty_level] || item.difficulty_level}</span></td><td>${item.is_ai_generated ? 'AI' : '教师'}</td><td>${item.usage_count || 0} 次<small>${item.correct_rate == null ? '暂无作答' : `正确率 ${item.correct_rate}%`}</small></td><td><span class="qb-status ${escapeHtml(item.status)}">${item.status === 'active' ? '启用' : item.status === 'pending' ? '待审核' : '停用'}</span></td><td><button class="qb-link" data-edit="${item.question_id}">编辑</button><button class="qb-link danger" data-delete="${item.question_id}">删除</button></td></tr>`).join('')
    tbody.querySelectorAll('[data-select]').forEach((input) => input.addEventListener('change', () => { const id = Number(input.dataset.select); input.checked ? state.selected.add(id) : state.selected.delete(id); updateSelection() }))
    tbody.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => { window.location.hash = `#/teacher/questions/${button.dataset.edit}` })
    tbody.querySelectorAll('[data-delete]').forEach((button) => button.onclick = async () => { if (!confirm('确定删除该题目吗？已有作答记录会保留。')) return; try { await deleteTeacherQuestion(Number(button.dataset.delete)); state.selected.delete(Number(button.dataset.delete)); await loadQuestions() } catch (error) { showToast(error.message, 'error') } })
    const pages = Math.max(1, Math.ceil(state.total / state.pageSize)); document.getElementById('qb-total').textContent = `${state.total} 道题`; document.getElementById('qb-page').textContent = `${state.page} / ${pages}`; document.getElementById('qb-prev').disabled = state.page <= 1; document.getElementById('qb-next').disabled = state.page >= pages
    updateSelection()
  }

  async function loadQuestions() {
    document.getElementById('qb-body').innerHTML = '<tr><td colspan="9"><div class="teacher-inline-empty">正在读取真实题库</div></td></tr>'
    try { const response = await getTeacherQuestions(filters()); state.list = response.data.list || []; state.total = response.data.total || 0; renderRows() }
    catch (error) { document.getElementById('qb-body').innerHTML = `<tr><td colspan="9"><div class="teacher-inline-empty">${escapeHtml(error.message)}</div></td></tr>` }
  }

  function updateSelection() { document.getElementById('qb-selected-count').textContent = String(state.selected.size); document.getElementById('qb-batch').hidden = state.selected.size < 1; const all = document.getElementById('qb-all'); all.checked = !!state.list.length && state.list.every((item) => state.selected.has(item.question_id)); all.indeterminate = state.list.some((item) => state.selected.has(item.question_id)) && !all.checked }
  function renderBatchValues() {
    const field = document.getElementById('qb-batch-field').value; let options = []
    if (field === 'difficulty_level') options = Object.entries(DIFFICULTIES)
    else if (field === 'question_type') options = Object.entries(TYPES).filter(([key]) => key !== 'blank')
    else if (field === 'status') options = [['active','启用/审核通过'],['pending','待审核'],['disabled','停用']]
    else if (field === 'knowledge_point_id') options = state.knowledgePoints.map((item) => [String(item.knowledge_point_id), item.knowledge_point_name])
    document.getElementById('qb-batch-value').innerHTML = '<option value="">请选择值</option>' + options.map(([value,label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')
  }

  async function exportCurrent() {
    const response = await exportQuestions({ ...filters(), page: undefined, page_size: undefined }); const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `DisciMind题库-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url)
  }

  function normalizeAiQuestion(item, courseId) {
    const options = Array.isArray(item.options) ? item.options.map((option, index) => typeof option === 'string' ? { option_key: String.fromCharCode(65 + index), option_content: option } : option) : []
    return { course_id: Number(courseId), title: item.title || item.question || item.content, content: item.content || item.question || item.title, question_type: String(item.question_type || item.type || 'short_answer').toLowerCase(), difficulty_level: String(item.difficulty_level || item.difficulty || 'medium').toLowerCase(), correct_answer: item.correct_answer ?? item.answer, analysis: item.analysis || item.explanation || '', score: Number(item.score || 5), options }
  }

  document.getElementById('qb-course').onchange = async (event) => { await loadKnowledgePoints(event.target.value); state.page = 1; await loadQuestions() }
  document.getElementById('qb-search').onclick = () => { state.page = 1; loadQuestions() }
  document.getElementById('qb-reset').onclick = async () => { document.querySelectorAll('.qb-filter-shell input,.qb-filter-shell select').forEach((item) => { item.value = '' }); await loadKnowledgePoints(''); state.page = 1; loadQuestions() }
  document.getElementById('qb-advanced-toggle').onclick = event => { const panel=document.getElementById('qb-advanced');panel.hidden=!panel.hidden;event.currentTarget.setAttribute('aria-expanded',panel.hidden?'false':'true');event.currentTarget.textContent=panel.hidden?'高级筛选':'收起筛选' }
  document.getElementById('qb-keyword').onkeydown = event => { if(event.key==='Enter'){event.preventDefault();state.page=1;void loadQuestions()} }
  document.getElementById('qb-create').onclick = () => { window.location.hash = initialCourseId ? `#/teacher/questions/create?course_id=${initialCourseId}` : '#/teacher/questions/create' }
  document.getElementById('qb-all').onchange = (event) => { state.list.forEach((item) => event.target.checked ? state.selected.add(item.question_id) : state.selected.delete(item.question_id)); renderRows() }
  document.getElementById('qb-batch-field').onchange = renderBatchValues
  document.getElementById('qb-batch-apply').onclick = async () => { const field = document.getElementById('qb-batch-field').value; const value = document.getElementById('qb-batch-value').value; if (!state.selected.size || !field || !value) return showToast('请选择题目、操作和值', 'warning'); try { await batchUpdateQuestions({ question_ids: [...state.selected], [field]: field === 'knowledge_point_id' ? Number(value) : value }); showToast('批量更新成功', 'success'); await loadQuestions() } catch (error) { showToast(error.message, 'error') } }
  document.getElementById('qb-batch-delete').onclick = async () => { if (!state.selected.size || !confirm(`确定删除所选 ${state.selected.size} 道题吗？`)) return; try { await batchDeleteQuestions({ question_ids: [...state.selected] }); state.selected.clear(); await loadQuestions(); showToast('批量删除成功', 'success') } catch (error) { showToast(error.message, 'error') } }
  document.getElementById('qb-export').onclick = () => exportCurrent().catch((error) => showToast(error.message, 'error'))
  document.getElementById('qb-prev').onclick = () => { if (state.page > 1) { state.page -= 1; loadQuestions() } }
  document.getElementById('qb-next').onclick = () => { if (state.page * state.pageSize < state.total) { state.page += 1; loadQuestions() } }

  const importDialog = document.getElementById('qb-import-dialog'); document.getElementById('qb-import').onclick = () => importDialog.showModal(); importDialog.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => importDialog.close())
  document.getElementById('qb-import-form').onsubmit = async (event) => { event.preventDefault(); try { const questions = JSON.parse(document.getElementById('qb-import-json').value); if (!Array.isArray(questions)) throw new Error('顶层必须是 JSON 数组'); const response = await batchImportQuestions({ questions }); importDialog.close(); showToast(`导入完成：成功 ${response.data.success_count}，失败 ${response.data.failed_count}`, response.data.failed_count ? 'warning' : 'success'); loadQuestions() } catch (error) { showToast(error.message, 'error') } }

  const aiDialog = document.getElementById('qb-ai-dialog'); document.getElementById('qb-ai').onclick = () => aiDialog.showModal(); aiDialog.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => aiDialog.close())
  document.getElementById('qb-ai-generate').onclick = async () => { const data = new FormData(document.getElementById('qb-ai-form')); if (!data.get('course_id')) return showToast('请选择课程', 'warning'); const button = document.getElementById('qb-ai-generate'); button.disabled = true; button.textContent = '生成中'; try { const response = await aiGenerateQuestions({ course_id: Number(data.get('course_id')), count: Number(data.get('count')), question_types: [data.get('question_type')], difficulty_level: data.get('difficulty_level'), prompt: data.get('prompt') }); state.aiPreview = (response.data.questions || []).map((item) => normalizeAiQuestion(item, data.get('course_id'))); document.getElementById('qb-ai-preview').innerHTML = state.aiPreview.length ? state.aiPreview.map((item, index) => `<article><label><input type="checkbox" data-ai-index="${index}" checked><span><b>${escapeHtml(item.title)}</b><small>${TYPES[item.question_type] || item.question_type} · ${DIFFICULTIES[item.difficulty_level] || item.difficulty_level} · 答案 ${escapeHtml(String(item.correct_answer ?? ''))}</small></span></label></article>`).join('') : '<div class="teacher-inline-empty">模型未返回可审核题目</div>'; document.querySelector('#qb-ai-form button[type="submit"]').disabled = !state.aiPreview.length } catch (error) { showToast(error.message, 'error') } finally { button.disabled = false; button.textContent = '生成预览' } }
  document.getElementById('qb-ai-form').onsubmit = async (event) => { event.preventDefault(); const selected = [...document.querySelectorAll('[data-ai-index]:checked')].map((item) => state.aiPreview[Number(item.dataset.aiIndex)]); if (!selected.length) return showToast('请选择审核通过的题目', 'warning'); try { const response = await batchImportQuestions({ questions: selected }); aiDialog.close(); showToast(`已审核入库 ${response.data.success_count} 道题`, 'success'); loadQuestions() } catch (error) { showToast(error.message, 'error') } }

  try {
    await loadCourses()
    if (initialCourseId) {
      document.getElementById('qb-course').value = String(initialCourseId)
      document.querySelector('#qb-ai-form [name="course_id"]').value = String(initialCourseId)
      await loadKnowledgePoints(initialCourseId)
    }
    await loadQuestions()
  } catch (error) { showToast(error.message, 'error') }
}
