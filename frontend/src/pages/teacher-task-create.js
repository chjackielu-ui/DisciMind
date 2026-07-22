import { getMe } from '../api/auth.js'
import {
  getTeacherCourses, getTeachingClasses, getTeacherQuestions, getTeachingResources,
  createTeacherTask, getTeacherTask, updateTeacherTask, previewTaskComposition,
} from '../api/teacher.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { teacherCourseLabel } from '../utils/teacher-course.js'

const STEPS = ['课程与班级', '任务信息', '题目来源', '作答规则', '附件与发布', '预览', '发布确认']
const TYPE_LABELS = { homework: '作业', exam: '考试', practice: '练习', quiz: '测验', material: '学习资料', announcement: '教学通知' }
const QUESTION_TYPES = [
  ['single_choice', '单选'], ['multiple_choice', '多选'], ['true_false', '判断'],
  ['fill_blank', '填空'], ['short_answer', '简答'], ['programming', '编程'],
]

function dateInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export async function renderTeacherTaskCreate(app, params) {
  let user = getUser()
  const taskId = Number(params?.task_id) || null
  const routeQuery = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const initialCourseId = Number(routeQuery.get('course_id')) || null
  const initialClassId = Number(routeQuery.get('teaching_class_id')) || null
  const initialType = routeQuery.get('type')
  try {
    const result = await getMe(); user = result.data.user; setAuth(getToken(), user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  const state = { step: 0, courses: [], classes: [], questions: [], selected: new Map(), selectedAttachmentIds: new Set(), resources: [], task: null, composition: null }
  const contentHTML = `<div class="teacher-publisher-page">
    <header class="teacher-page-head compact"><div><span class="teacher-eyebrow">统一 TeachingTask 发布器</span><h2>${taskId ? '编辑教学任务' : '发布教学任务'}</h2><p>作业、考试、练习、资料与通知共用同一发布、学生接收和消息链路。</p></div><button class="teacher-btn" id="publisher-back">返回任务列表</button></header>
    <nav class="publisher-steps" id="publisher-steps">${STEPS.map((label, index) => `<button data-step="${index}" class="${index === 0 ? 'active' : ''}"><i>${index + 1}</i><span>${label}</span></button>`).join('')}</nav>
    <form id="publisher-form" class="publisher-shell">
      <main class="publisher-main">
        <section class="publisher-panel" data-panel="0">
          <header><h3>选择教学空间</h3><p>只显示当前教师负责或被授权的课程与教学班。</p></header>
          <div class="teacher-form-grid"><label>课程<select name="course_id" id="pub-course" required><option value="">请选择课程</option></select></label><label>教学班<select name="teaching_class_id" id="pub-class" required><option value="">请先选择课程</option></select></label><label>任务类型<select name="task_type" id="pub-type">${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>题目来源<select name="source_mode" id="pub-source"><option value="question_bank">题库</option><option value="ai_generated">已审核 AI 题目</option><option value="mixed">题库 + AI 混合</option><option value="manual">手动选择</option></select></label></div>
          <div class="publisher-context-note" id="pub-class-note">选择教学班后，将在发布时为班内学生创建任务关系和通知。</div>
        </section>
        <section class="publisher-panel" data-panel="1" hidden>
          <header><h3>任务信息</h3><p>时间均按浏览器当前时区填写，服务端保存为标准时间。</p></header>
          <div class="teacher-form-grid"><label class="wide">标题<input name="title" required maxlength="240" placeholder="例如：第三章分类算法巩固作业"></label><label class="wide">说明<textarea name="description" rows="3" placeholder="学习目标、提交要求和补充说明"></textarea></label><label>开始时间<input name="start_time" type="datetime-local"></label><label>截止时间<input name="deadline" type="datetime-local"></label><label>时长（分钟）<input name="duration_minutes" type="number" min="1" max="1440"></label><label>允许次数<input name="allowed_attempts" type="number" min="1" max="100" value="1"></label><label>总分<input name="total_score" type="number" min="0" step="0.5" value="100"></label><label>及格分<input name="pass_score" type="number" min="0" step="0.5" value="60"></label><label class="wide">考试/任务说明<textarea name="instructions" rows="2"></textarea></label><label class="wide">考场/作答规则<textarea name="rules" rows="2"></textarea></label></div>
        </section>
        <section class="publisher-panel" data-panel="2" hidden>
          <header><h3>配置题目来源</h3><p>混合模式按比例从真实题库选择；AI 题目进入题库审核后才参与发布。</p></header>
          <div class="publisher-composition"><div>${QUESTION_TYPES.map(([value, label]) => `<label>${label}<input type="number" min="0" max="100" value="${['single_choice', 'multiple_choice'].includes(value) ? 5 : 0}" data-type-count="${value}"></label>`).join('')}</div><label>AI 占比 <input id="pub-ai-ratio" type="range" min="0" max="100" value="40"><span id="pub-ai-ratio-label">40%</span></label><button type="button" class="teacher-btn primary" id="pub-compose">生成组卷预览</button><button type="button" class="teacher-btn" id="pub-load-questions">加载题库手选</button></div>
          <div class="publisher-question-picker" id="pub-question-picker"><div class="teacher-inline-empty">可按组卷规则自动选择，也可加载题库手动增减。</div></div>
          <div class="publisher-validation" id="pub-validation"></div>
        </section>
        <section class="publisher-panel" data-panel="3" hidden>
          <header><h3>作答与反馈规则</h3><p>考试附加规则仅在任务类型为考试时生效。</p></header>
          <div class="publisher-rule-grid">
            ${[['allow_late_submit','允许逾期提交'],['allow_pause','允许暂停'],['save_draft','允许保存草稿'],['randomize_questions','随机题序'],['randomize_options','随机选项'],['auto_grade','客观题自动批阅'],['ai_grade_subjective','AI 辅助主观题批阅'],['full_screen_mode','全屏模式'],['prevent_screen_switch','防切屏提示'],['separate_answer_sheet','独立答题卷'],['auto_submit','到时自动交卷']].map(([name,label]) => `<label><input type="checkbox" name="${name}" ${['save_draft','auto_grade','auto_submit'].includes(name) ? 'checked' : ''}> ${label}</label>`).join('')}
          </div>
          <div class="teacher-form-grid"><label>成绩显示<select name="show_score_policy"><option value="after_submit">提交后</option><option value="after_deadline">截止后</option><option value="manual">教师发布</option><option value="never">不显示</option></select></label><label>答案显示<select name="show_answer_policy"><option value="after_deadline">截止后</option><option value="after_submit">提交后</option><option value="manual">教师发布</option><option value="never">不显示</option></select></label><label>解析显示<select name="show_analysis_policy"><option value="after_deadline">截止后</option><option value="after_submit">提交后</option><option value="manual">教师发布</option><option value="never">不显示</option></select></label><label>成绩发布时间<input name="score_release_at" type="datetime-local"></label><label>解析发布时间<input name="analysis_release_at" type="datetime-local"></label></div>
        </section>
        <section class="publisher-panel" data-panel="4" hidden>
          <header><h3>附件与发布范围</h3><p>这里只列出当前教师有权使用的教学资源。</p></header>
          <div id="pub-resource-list" class="publisher-resource-list"><div class="teacher-inline-empty">正在读取教学资源</div></div>
        </section>
        <section class="publisher-panel" data-panel="5" hidden><header><h3>发布预览</h3><p>确认班级、时间、题目总分、反馈策略和附件。</p></header><div id="pub-preview" class="publisher-preview"></div></section>
        <section class="publisher-panel" data-panel="6" hidden><header><h3>发布确认</h3><p>发布会立即写入学生任务关系并创建通知；保存草稿不会通知学生。</p></header><div class="publisher-confirm"><label><input type="radio" name="final_status" value="draft" checked> 保存草稿，可稍后继续编辑</label><label><input type="radio" name="final_status" value="published"> 立即发布并通知教学班学生</label><label class="confirm-check"><input id="pub-confirm-check" type="checkbox"> 我已核对截止时间、题目总分和发布范围</label><button type="button" class="teacher-btn primary" id="pub-submit">${taskId ? '保存任务' : '创建任务'}</button></div></section>
      </main>
      <aside class="publisher-summary"><h3>任务摘要</h3><dl id="pub-summary"><div><dt>课程</dt><dd>未选择</dd></div><div><dt>教学班</dt><dd>未选择</dd></div><div><dt>类型</dt><dd>作业</dd></div><div><dt>题目</dt><dd>0 道</dd></div><div><dt>题目总分</dt><dd>0</dd></div></dl><div class="publisher-summary-tip">所有数据来自当前账号权限范围，发布时服务端会再次校验。</div></aside>
      <footer class="publisher-footer"><button type="button" class="teacher-btn" id="pub-prev" disabled>上一步</button><span id="pub-step-label">1 / 7</span><button type="button" class="teacher-btn primary" id="pub-next">下一步</button></footer>
    </form>
  </div>`

  renderDashboardLayout(app, { title: taskId ? '编辑任务' : '发布任务', menuItems: TEACHER_MENU_ITEMS, contentHTML, user })
  const form = document.getElementById('publisher-form')
  const value = (name) => form.elements[name]?.value || ''
  const checked = (name) => !!form.elements[name]?.checked

  function renderStep() {
    document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = Number(panel.dataset.panel) !== state.step })
    document.querySelectorAll('#publisher-steps button').forEach((button) => button.classList.toggle('active', Number(button.dataset.step) === state.step))
    document.getElementById('pub-prev').disabled = state.step === 0
    document.getElementById('pub-next').hidden = state.step === STEPS.length - 1
    document.getElementById('pub-step-label').textContent = `${state.step + 1} / ${STEPS.length}`
    if (state.step === 5) renderPreview()
    updateSummary()
  }

  function updateSummary() {
    const selectedCourse = state.courses.find((item) => String(item.course_id) === value('course_id'))
    const selectedClass = state.classes.find((item) => String(item.teaching_class_id) === value('teaching_class_id'))
    const score = [...state.selected.values()].reduce((sum, item) => sum + Number(item.task_score ?? item.score ?? 0), 0)
    document.getElementById('pub-summary').innerHTML = `<div><dt>课程</dt><dd>${escapeHtml(selectedCourse?.course_name || '未选择')}</dd></div><div><dt>教学班</dt><dd>${escapeHtml(selectedClass?.teaching_class_name || selectedClass?.name || '未选择')}</dd></div><div><dt>类型</dt><dd>${TYPE_LABELS[value('task_type')] || '-'}</dd></div><div><dt>题目</dt><dd>${state.selected.size} 道</dd></div><div><dt>题目总分</dt><dd>${score}</dd></div>`
  }

  async function loadCourses() {
    const response = await getTeacherCourses({ page_size: 100 })
    state.courses = response.data.list || response.data || []
    document.getElementById('pub-course').innerHTML = '<option value="">请选择课程</option>' + state.courses.map((item) => `<option value="${item.course_id}">${escapeHtml(teacherCourseLabel(item))}</option>`).join('')
  }

  async function loadClasses(courseId, selectedId = '') {
    state.classes = []
    const select = document.getElementById('pub-class')
    if (!courseId) { select.innerHTML = '<option value="">请先选择课程</option>'; return }
    const response = await getTeachingClasses(Number(courseId), { status: 'active', page_size: 100 })
    state.classes = response.data.list || response.data || []
    select.innerHTML = '<option value="">请选择教学班</option>' + state.classes.map((item) => `<option value="${item.teaching_class_id}">${escapeHtml(item.teaching_class_name || item.name)}${item.code ? `（${escapeHtml(item.code)}）` : ''}</option>`).join('')
    if (selectedId) select.value = String(selectedId)
  }

  async function loadResources() {
    try {
      const response = await getTeachingResources({ course_id: value('course_id'), page_size: 100 })
      state.resources = response.data.list || response.data || []
      const list = document.getElementById('pub-resource-list')
      list.innerHTML = state.resources.length ? state.resources.map((item) => `<label><input type="checkbox" name="attachment_ids" value="${item.document_id}" ${state.selectedAttachmentIds.has(Number(item.document_id)) ? 'checked' : ''}><span><b>${escapeHtml(item.resource_title || item.file_name || item.title)}</b><small>${escapeHtml(item.mime_type || item.resource_type || '教学资源')}</small></span></label>`).join('') : '<div class="teacher-inline-empty">当前课程暂无可用教学资源</div>'
      list.querySelectorAll('[name="attachment_ids"]').forEach((input) => input.addEventListener('change', () => {
        const documentId = Number(input.value)
        if (input.checked) state.selectedAttachmentIds.add(documentId)
        else state.selectedAttachmentIds.delete(documentId)
        updateSummary()
      }))
    } catch (error) { document.getElementById('pub-resource-list').innerHTML = `<div class="teacher-inline-empty">${escapeHtml(error.message)}</div>` }
  }

  function renderQuestionPicker() {
    const rows = state.questions.length ? state.questions : [...state.selected.values()]
    document.getElementById('pub-question-picker').innerHTML = rows.length ? `<div class="publisher-question-tools"><label><input id="pub-select-all" type="checkbox"> 全选当前结果</label><span>${rows.length} 道候选，已选择 ${state.selected.size} 道</span></div>${rows.map((item) => `<label class="publisher-question-row"><input type="checkbox" data-question-id="${item.question_id}" ${state.selected.has(item.question_id) ? 'checked' : ''}><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.question_type || '')} · ${escapeHtml(item.difficulty_level || '')}${item.knowledge_point_name ? ` · ${escapeHtml(item.knowledge_point_name)}` : ''}</small></span><input data-question-score="${item.question_id}" type="number" min="0" step="0.5" value="${Number(state.selected.get(item.question_id)?.task_score ?? item.score ?? 0)}" aria-label="题目分值"></label>`).join('')}` : '<div class="teacher-inline-empty">未找到符合条件的题目</div>'
    document.querySelectorAll('[data-question-id]').forEach((box) => box.addEventListener('change', () => {
      const item = rows.find((row) => row.question_id === Number(box.dataset.questionId))
      if (box.checked) state.selected.set(item.question_id, { ...item, task_score: Number(document.querySelector(`[data-question-score="${item.question_id}"]`)?.value || item.score || 0) })
      else state.selected.delete(item.question_id)
      updateSummary()
    }))
    document.querySelectorAll('[data-question-score]').forEach((input) => input.addEventListener('change', () => {
      const item = state.selected.get(Number(input.dataset.questionScore)); if (item) { item.task_score = Number(input.value || 0); updateSummary() }
    }))
    document.getElementById('pub-select-all')?.addEventListener('change', (event) => {
      rows.forEach((item) => event.target.checked ? state.selected.set(item.question_id, { ...item, task_score: Number(item.score || 0) }) : state.selected.delete(item.question_id)); renderQuestionPicker(); updateSummary()
    })
  }

  async function compose() {
    if (!value('course_id') || !value('teaching_class_id')) throw new Error('请先选择课程和教学班')
    const typeCounts = Object.fromEntries([...document.querySelectorAll('[data-type-count]')].map((input) => [input.dataset.typeCount, Number(input.value || 0)]))
    const response = await previewTaskComposition({ course_id: Number(value('course_id')), teaching_class_id: Number(value('teaching_class_id')), source_mode: value('source_mode'), type_counts: typeCounts, ai_ratio: Number(document.getElementById('pub-ai-ratio').value) / 100, question_ids: [...state.selected.keys()], total_score: Number(value('total_score') || 0) })
    state.composition = response.data; state.questions = response.data.questions || []; state.selected = new Map(state.questions.map((item) => [item.question_id, { ...item, task_score: Number(item.score || 0) }]))
    const validation = response.data.validation || {}
    document.getElementById('pub-validation').innerHTML = `<span class="${validation.count_valid ? 'ok' : 'warn'}">数量 ${validation.selected_count ?? 0}/${validation.requested_count ?? 0}</span><span class="${validation.score_valid ? 'ok' : 'warn'}">题目总分 ${validation.total_score ?? 0}/${validation.requested_total_score ?? '-'}</span><span>知识点覆盖 ${(response.data.knowledge_point_coverage || []).length}</span>`
    renderQuestionPicker(); updateSummary()
  }

  async function loadQuestionBank() {
    if (!value('course_id')) throw new Error('请先选择课程')
    const response = await getTeacherQuestions({ course_id: value('course_id'), page_size: 100 })
    state.questions = response.data.list || []; renderQuestionPicker()
  }

  function payload(status) {
    const questionIds = [...state.selected.keys()]
    return {
      course_id: Number(value('course_id')), teaching_class_id: Number(value('teaching_class_id')), task_type: value('task_type'),
      title: value('title').trim(), description: value('description').trim() || null, start_time: value('start_time') || null, deadline: value('deadline') || null,
      duration_minutes: value('duration_minutes') ? Number(value('duration_minutes')) : null, allowed_attempts: Number(value('allowed_attempts') || 1),
      total_score: value('total_score') ? Number(value('total_score')) : null, pass_score: value('pass_score') ? Number(value('pass_score')) : null,
      instructions: value('instructions').trim() || null, rules: value('rules').trim() || null, status, source_mode: value('source_mode'), question_ids: questionIds,
      question_scores: Object.fromEntries(questionIds.map((id) => [id, Number(state.selected.get(id)?.task_score ?? state.selected.get(id)?.score ?? 0)])),
      attachment_ids: [...state.selectedAttachmentIds],
      allow_late_submit: checked('allow_late_submit'), allow_pause: checked('allow_pause'), save_draft: checked('save_draft'), randomize_questions: checked('randomize_questions'), randomize_options: checked('randomize_options'), auto_grade: checked('auto_grade'), ai_grade_subjective: checked('ai_grade_subjective'), full_screen_mode: checked('full_screen_mode'),
      show_score_policy: value('show_score_policy'), show_answer_policy: value('show_answer_policy'), show_analysis_policy: value('show_analysis_policy'), score_release_at: value('score_release_at') || null, analysis_release_at: value('analysis_release_at') || null,
      configuration: { source_mode: value('source_mode'), ai_ratio: Number(document.getElementById('pub-ai-ratio').value) / 100, prevent_screen_switch: checked('prevent_screen_switch'), separate_answer_sheet: checked('separate_answer_sheet'), auto_submit: checked('auto_submit'), composition_validation: state.composition?.validation || null },
    }
  }

  function validateCurrent() {
    if (state.step === 0 && (!value('course_id') || !value('teaching_class_id'))) return '请选择课程和教学班'
    if (state.step === 1 && !value('title').trim()) return '请填写任务标题'
    if (state.step === 1 && value('start_time') && value('deadline') && new Date(value('start_time')) >= new Date(value('deadline'))) return '截止时间必须晚于开始时间'
    if (state.step === 2 && ['homework','exam','practice','quiz'].includes(value('task_type')) && !state.selected.size) return '请至少选择一道题目'
    return ''
  }

  function renderPreview() {
    const data = payload('draft'); const course = state.courses.find((item) => item.course_id === data.course_id); const cls = state.classes.find((item) => item.teaching_class_id === data.teaching_class_id)
    document.getElementById('pub-preview').innerHTML = `<h3>${escapeHtml(data.title || '未填写标题')}</h3><dl><div><dt>发布范围</dt><dd>${escapeHtml(course?.course_name || '-')} / ${escapeHtml(cls?.teaching_class_name || cls?.name || '-')}</dd></div><div><dt>任务类型</dt><dd>${TYPE_LABELS[data.task_type]}</dd></div><div><dt>时间</dt><dd>${data.start_time || '立即'} 至 ${data.deadline || '未设置'}</dd></div><div><dt>题目</dt><dd>${data.question_ids.length} 道，${[...state.selected.values()].reduce((s, q) => s + Number(q.task_score ?? q.score ?? 0), 0)} 分</dd></div><div><dt>尝试</dt><dd>${data.allowed_attempts} 次，${data.allow_late_submit ? '允许' : '不允许'}逾期</dd></div><div><dt>附件</dt><dd>${data.attachment_ids.length} 个教学资源</dd></div></dl>${data.description ? `<p>${escapeHtml(data.description)}</p>` : ''}`
  }

  async function loadExisting() {
    if (!taskId) {
      if (initialCourseId) {
        document.getElementById('pub-course').value = String(initialCourseId)
        await loadClasses(initialCourseId, initialClassId)
      }
      if (initialType && TYPE_LABELS[initialType]) form.elements.task_type.value = initialType
      updateSummary()
      return
    }
    const response = await getTeacherTask(taskId); state.task = response.data
    const task = state.task
    state.selectedAttachmentIds = new Set((task.attachments || []).map((item) => Number(item.document_id)))
    document.getElementById('pub-course').value = String(task.course_id); await loadClasses(task.course_id, task.teaching_class_id); await loadResources()
    const assign = { task_type: task.task_type, source_mode: task.source_mode, title: task.title, description: task.description, start_time: dateInput(task.start_time), deadline: dateInput(task.deadline), duration_minutes: task.duration_minutes, allowed_attempts: task.allowed_attempts, total_score: task.total_score, pass_score: task.pass_score, instructions: task.instructions, rules: task.rules, show_score_policy: task.show_score_policy, show_answer_policy: task.show_answer_policy, show_analysis_policy: task.show_analysis_policy, score_release_at: dateInput(task.score_release_at), analysis_release_at: dateInput(task.analysis_release_at) }
    Object.entries(assign).forEach(([name, val]) => { if (form.elements[name] && val != null) form.elements[name].value = val })
    ;['allow_late_submit','allow_pause','save_draft','randomize_questions','randomize_options','auto_grade','ai_grade_subjective','full_screen_mode'].forEach((name) => { if (form.elements[name] && task[name] != null) form.elements[name].checked = !!task[name] })
    const configuration = task.configuration && typeof task.configuration === 'object' ? task.configuration : {}
    ;['prevent_screen_switch','separate_answer_sheet','auto_submit'].forEach((name) => { if (form.elements[name] && configuration[name] != null) form.elements[name].checked = !!configuration[name] })
    if (Number.isFinite(Number(configuration.ai_ratio))) {
      const ratio = Math.max(0, Math.min(100, Math.round(Number(configuration.ai_ratio) * 100)))
      document.getElementById('pub-ai-ratio').value = String(ratio)
      document.getElementById('pub-ai-ratio-label').textContent = `${ratio}%`
    }
    if (configuration.composition_validation) state.composition = { validation: configuration.composition_validation }
    const finalStatus = form.querySelector(`[name="final_status"][value="${task.status === 'published' ? 'published' : 'draft'}"]`)
    if (finalStatus) finalStatus.checked = true
    if (task.status !== 'draft') ['pub-course', 'pub-class', 'pub-type'].forEach((id) => { document.getElementById(id).disabled = true })
    state.selected = new Map((task.questions || []).map((item) => [item.question_id, { ...item, task_score: item.task_score ?? item.score }]))
    renderQuestionPicker(); updateSummary()
  }

  document.getElementById('publisher-back').onclick = () => { window.location.hash = '#/teacher/tasks' }
  document.querySelectorAll('#publisher-steps button').forEach((button) => button.addEventListener('click', () => { const error = validateCurrent(); if (Number(button.dataset.step) > state.step && error) return showToast(error, 'warning'); state.step = Number(button.dataset.step); renderStep() }))
  document.getElementById('pub-prev').onclick = () => { state.step = Math.max(0, state.step - 1); renderStep() }
  document.getElementById('pub-next').onclick = async () => { const error = validateCurrent(); if (error) return showToast(error, 'warning'); if (state.step === 3) await loadResources(); state.step = Math.min(6, state.step + 1); renderStep() }
  document.getElementById('pub-course').addEventListener('change', async (event) => { state.selected.clear(); state.selectedAttachmentIds.clear(); await loadClasses(event.target.value); await loadResources(); updateSummary() })
  form.addEventListener('change', updateSummary)
  document.getElementById('pub-ai-ratio').addEventListener('input', (event) => { document.getElementById('pub-ai-ratio-label').textContent = `${event.target.value}%` })
  document.getElementById('pub-compose').onclick = () => compose().catch((error) => showToast(error.message, 'error'))
  document.getElementById('pub-load-questions').onclick = () => loadQuestionBank().catch((error) => showToast(error.message, 'error'))
  document.getElementById('pub-submit').onclick = async () => {
    if (!document.getElementById('pub-confirm-check').checked) return showToast('请先确认已核对发布信息', 'warning')
    const status = state.task?.status === 'closed' ? 'closed' : form.elements.final_status.value; const data = payload(status)
    if (status === 'published') { const score = [...state.selected.values()].reduce((s, q) => s + Number(q.task_score ?? q.score ?? 0), 0); if (data.question_ids.length && data.total_score != null && Math.abs(score - data.total_score) > .001) return showToast(`题目总分 ${score} 与任务总分 ${data.total_score} 不一致`, 'error') }
    const button = document.getElementById('pub-submit'); button.disabled = true; button.textContent = '正在写入'
    try { const response = taskId ? await updateTeacherTask(taskId, data) : await createTeacherTask(data); showToast(taskId ? '任务已更新' : status === 'published' ? `发布成功，已通知 ${response.data?.notification_count ?? response.data?.recipient_count ?? 0} 名学生` : '草稿已保存', 'success'); window.location.hash = '#/teacher/tasks' }
    catch (error) { showToast(error.message, 'error'); button.disabled = false; button.textContent = taskId ? '保存任务' : '创建任务' }
  }

  try { await loadCourses(); await loadExisting(); if (!taskId) await loadResources() } catch (error) { showToast(error.message, 'error') }
  renderStep()
}
