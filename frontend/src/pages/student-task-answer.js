import { getMe } from '../api/auth.js'
import { startStudentTask, saveStudentAnswers, submitStudentTask } from '../api/student.js'
import { getUser, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, taskTypeLabel, submissionStatusLabel, questionTypeLabel, parseAnswerContent, answerToPayload, isAnsweredValue } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { disposeAllCharts, bindResize, renderRingChart, CHART_COLORS } from '../utils/echarts.js'

let autosaveTimer = null

function getTaskId(params) {
  if (params?.task_id) return Number(params.task_id)
  const m = window.location.hash.slice(1).match(/^\/student\/tasks\/(\d+)\/answer$/)
  return m ? Number(m[1]) : null
}

async function getAuthedUser() {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(localStorage.getItem('token') || '', user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return null
    }
  }
  return user
}

function buildLoading() {
  return `<div class="complex-shell"><div class="complex-loading"><div class="complex-spinner"></div><p>题目加载中...</p></div></div>`
}

function buildError(message) {
  return `
    <div class="complex-shell">
      <div class="complex-error">
        <h3>答题任务加载失败，请稍后重试。</h3>
        <p>${escapeHtml(message || '请检查任务状态或稍后重试。')}</p>
        <button class="complex-btn" id="btn-retry-task">重新加载</button>
      </div>
    </div>`
}

function normalizeQuestions(questions) {
  return (questions || []).slice().sort((a, b) => (a.question_order || 0) - (b.question_order || 0))
}

function initAnswers(questions) {
  const answers = {}
  questions.forEach(q => {
    const parsed = parseAnswerContent(q.draft_answer)
    const type = String(q.question_type || '').toLowerCase()
    if (type === 'multiple_choice') {
      answers[q.question_id] = Array.isArray(parsed) ? parsed.map(String) : (parsed ? [String(parsed)] : [])
    } else {
      answers[q.question_id] = Array.isArray(parsed) ? parsed[0] || '' : (parsed || '')
    }
  })
  return answers
}

function getAnsweredCount(questions, answers) {
  return questions.filter(q => isAnsweredValue(answers[q.question_id])).length
}

function buildPayload(questions, answers) {
  return questions.map(q => ({
    question_id: q.question_id,
    answer_content: answerToPayload(answers[q.question_id]),
  }))
}

function isSelected(value, optionValue, type) {
  if (type === 'multiple_choice') return Array.isArray(value) && value.map(String).includes(String(optionValue))
  return String(value || '') === String(optionValue)
}

function buildQuestionHTML(q, idx, value, marked) {
  const type = String(q.question_type || '').toLowerCase()
  const options = q.options || []
  const content = q.question_content || q.content || q.title || ''
  const title = q.title && q.title !== content ? `<div class="complex-section-title">${escapeHtml(q.title)}</div>` : ''

  let answerHTML = ''
  if (type === 'single_choice' || type === 'multiple_choice') {
    answerHTML = `<div class="choice-list">
      ${options.map((opt, optIdx) => {
        const label = opt.option_label || opt.option_key || String.fromCharCode(65 + optIdx)
        const optValue = label
        return `<label class="choice-option${isSelected(value, optValue, type) ? ' selected' : ''}" data-choice="${escapeHtml(optValue)}">
          <span class="choice-badge">${escapeHtml(label)}</span>
          <span>${escapeHtml(opt.option_content || opt.content || '')}</span>
          <input type="${type === 'multiple_choice' ? 'checkbox' : 'radio'}" name="question-${q.question_id}" value="${escapeHtml(optValue)}" ${isSelected(value, optValue, type) ? 'checked' : ''} hidden>
        </label>`
      }).join('')}
    </div>`
  } else if (type === 'true_false') {
    answerHTML = `<div class="tf-row">
      ${['正确', '错误'].map(v => `<label class="choice-option${isSelected(value, v, type) ? ' selected' : ''}" data-choice="${v}">
        <span class="choice-badge">${v === '正确' ? 'T' : 'F'}</span><span>${v}</span>
        <input type="radio" name="question-${q.question_id}" value="${v}" ${isSelected(value, v, type) ? 'checked' : ''} hidden>
      </label>`).join('')}
    </div>`
  } else if (type === 'blank') {
    answerHTML = `<textarea class="complex-textarea answer-input" rows="4" placeholder="请输入填空答案，多个空可用分号分隔">${escapeHtml(value || '')}</textarea>`
  } else if (type === 'short_answer') {
    const text = String(value || '')
    answerHTML = `<textarea class="complex-textarea answer-input" rows="8" placeholder="请输入你的作答思路和关键步骤">${escapeHtml(text)}</textarea><div class="short-count">${text.length} 字</div>`
  } else if (type === 'programming') {
    answerHTML = `<div class="complex-empty" style="min-height:180px;"><h3>编程题功能预留</h3><p>本题型后续将接入代码编辑与运行环境。本轮不会影响其他题目作答。</p></div>`
  } else {
    answerHTML = `<textarea class="complex-textarea answer-input" rows="6" placeholder="请输入答案">${escapeHtml(value || '')}</textarea>`
  }

  return `
    <section class="question-card" data-question-id="${q.question_id}">
      <div class="question-head">
        <div>
          <h2>第 ${idx + 1} 题</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <span class="complex-tag">${questionTypeLabel(type)}</span>
            <span class="complex-tag">${q.score || 0} 分</span>
            ${(q.knowledge_points || []).map(k => `<span class="complex-tag">${escapeHtml(k.knowledge_point_name)}</span>`).join('')}
          </div>
        </div>
        <button class="complex-btn-ghost" id="btn-mark-question" type="button">${marked ? '取消标记' : '标记本题'}</button>
      </div>
      ${title}
      <div class="question-content">${escapeHtml(content)}</div>
      ${answerHTML}
    </section>`
}

function buildPage(data, state) {
  const { task, submission, questions } = data
  const answered = getAnsweredCount(questions, state.answers)
  const total = questions.length
  const current = questions[state.currentIndex]
  if (!total) {
    return `
      <div class="complex-shell">
        <button class="btn-back" id="btn-back-courses">← 返回我的课程</button>
        <div class="complex-empty">
          <h3>当前任务暂无题目，请联系教师或稍后重试。</h3>
          <p>任务已存在，但还没有可作答的题目。</p>
        </div>
      </div>`
  }

  return `
    <div class="complex-shell exam-shell">
      <div class="exam-topbar">
        <div>
          <button class="complex-btn-secondary" id="btn-back-courses" style="margin-bottom:10px;">返回</button>
          <h1 class="exam-title">${escapeHtml(task?.task_title || '在线答题')}</h1>
          <p class="exam-subtitle">请按题目要求作答，切换题目不会丢失当前答案。</p>
          <div class="exam-meta-row">
            <span>${taskTypeLabel(task?.task_type)}</span>
            <span>截止：${formatDate(task?.deadline)}</span>
            <span>状态：${submissionStatusLabel(submission?.status)}</span>
            <span>${total} 题</span>
            <span>总分 ${submission?.total_score || questions.reduce((s, q) => s + (q.score || 0), 0)} 分</span>
            <span>已答 ${answered}/${total}</span>
            <span id="save-status">保存状态：${escapeHtml(state.saveStatus || '未保存')}</span>
          </div>
        </div>
        <div class="complex-actions">
          <button class="complex-btn-secondary" id="btn-save-draft">保存草稿</button>
          <button class="complex-btn" id="btn-submit-task">提交答案</button>
        </div>
      </div>

      <div class="exam-layout">
        <aside class="question-nav-panel">
          <h3 class="complex-section-title">题目导航</h3>
          <div class="question-number-grid">
            ${questions.map((q, i) => `<button class="question-number${isAnsweredValue(state.answers[q.question_id]) ? ' answered' : ''}${i === state.currentIndex ? ' current' : ''}${state.marked.has(q.question_id) ? ' marked' : ''}" data-index="${i}">${i + 1}</button>`).join('')}
          </div>
        </aside>

        <main id="question-host">
          ${buildQuestionHTML(current, state.currentIndex, state.answers[current.question_id], state.marked.has(current.question_id))}
        </main>

        <aside class="answer-progress-panel">
          <h3 class="complex-section-title">答题进度</h3>
          <div class="progress-kpis">
            <div><b>${answered}</b><span>已答题</span></div>
            <div><b>${Math.max(0, total - answered)}</b><span>未答题</span></div>
            <div><b>${current?.score || 0}</b><span>当前分值</span></div>
            <div><b>${Math.max(8, total * 3)}</b><span>预计分钟</span></div>
          </div>
          <div class="progress-chart-mini" id="exam-progress-chart"></div>
          <div class="complex-card" style="box-shadow:none;padding:12px;margin-top:12px;background:rgba(47,102,144,0.05);">
            <b style="color:var(--complex-deep);font-size:0.86rem;">答题说明</b>
            <p style="margin:6px 0 0;color:var(--text-sub);font-size:0.78rem;line-height:1.6;">系统每 60 秒自动保存一次草稿。提交后将进入自动批改流程。</p>
          </div>
        </aside>
      </div>

      <div class="exam-bottom-bar">
        <div class="complex-actions">
          <button class="complex-btn-ghost" id="btn-prev-question" ${state.currentIndex === 0 ? 'disabled' : ''}>上一题</button>
          <button class="complex-btn-ghost" id="btn-next-question" ${state.currentIndex >= total - 1 ? 'disabled' : ''}>下一题</button>
        </div>
        <div class="complex-actions">
          <button class="complex-btn-secondary" id="btn-save-draft-bottom">保存草稿</button>
          <button class="complex-btn" id="btn-submit-task-bottom">提交答案</button>
        </div>
      </div>
    </div>`
}

function renderProgressChart(questions, answers) {
  bindResize()
  const answered = getAnsweredCount(questions, answers)
  const unanswered = Math.max(0, questions.length - answered)
  renderRingChart('exam-progress-chart', [
    { name: '已答', value: answered, itemStyle: { color: CHART_COLORS.primary } },
    { name: '未答', value: unanswered, itemStyle: { color: '#D9DCD6' } },
  ], '')
}

export async function renderStudentTaskAnswer(app, params = {}) {
  disposeAllCharts()
  if (autosaveTimer) clearInterval(autosaveTimer)

  const taskId = getTaskId(params)
  if (!taskId) {
    window.location.hash = '#/student/courses'
    return
  }

  const user = await getAuthedUser()
  if (!user) return

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildLoading(), user })

  let data
  try {
    const result = await startStudentTask(taskId, { mode: 'normal' })
    data = result.data || {}
  } catch (err) {
    renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildError(err.message), user })
    document.getElementById('btn-retry-task')?.addEventListener('click', () => renderStudentTaskAnswer(app, params))
    showToast(err.code === 40301 ? '无权限访问该任务' : '答题任务加载失败，请重试', 'error')
    return
  }

  const submission = data.submission || {}
  const status = String(submission.status || '').toLowerCase()
  if (status && status !== 'in_progress') {
    showToast(data.message || '该任务已提交，正在进入结果页', 'info')
    window.location.hash = `#/student/submissions/${submission.submission_id}/result`
    return
  }

  const questions = normalizeQuestions(data.questions || [])
  const state = {
    currentIndex: 0,
    answers: initAnswers(questions),
    marked: new Set(),
    saveStatus: '未保存',
    saving: false,
    submitting: false,
  }
  data.questions = questions

  async function saveDraft(silent = false) {
    if (!submission.submission_id || state.saving) return
    state.saving = true
    updateButtons(true)
    try {
      await saveStudentAnswers(submission.submission_id, { answers: buildPayload(questions, state.answers) })
      state.saveStatus = `已保存 ${formatDate(new Date().toISOString(), 'time')}`
      document.getElementById('save-status').textContent = `保存状态：${state.saveStatus}`
      if (!silent) showToast('答案草稿已保存', 'success')
    } catch (err) {
      if (!silent) showToast(err.message || '保存失败，请稍后重试', 'error')
    } finally {
      state.saving = false
      updateButtons(false)
    }
  }

  async function submitNow() {
    if (state.submitting) return
    const ok = window.confirm('你确定要提交吗？提交后将进入自动批改流程。')
    if (!ok) return
    state.submitting = true
    updateButtons(true, true)
    try {
      const result = await submitStudentTask(taskId, {
        submission_id: submission.submission_id,
        answers: buildPayload(questions, state.answers),
      })
      const subId = result.data?.submission?.submission_id || submission.submission_id
      showToast('提交成功，正在进入结果页', 'success')
      window.location.hash = `#/student/submissions/${subId}/result`
    } catch (err) {
      if (/已提交|重复提交/.test(err.message || '')) {
        showToast('该任务已提交，正在进入结果页', 'info')
        window.location.hash = `#/student/submissions/${submission.submission_id}/result`
        return
      }
      showToast(err.message || '提交失败，请稍后重试', 'error')
      state.submitting = false
      updateButtons(false, false)
    }
  }

  function updateButtons(disabled, submitting = false) {
    ;['btn-save-draft', 'btn-save-draft-bottom'].forEach(id => {
      const btn = document.getElementById(id)
      if (btn) {
        btn.disabled = disabled
        btn.textContent = disabled && !submitting ? '保存中...' : '保存草稿'
      }
    })
    ;['btn-submit-task', 'btn-submit-task-bottom'].forEach(id => {
      const btn = document.getElementById(id)
      if (btn) {
        btn.disabled = disabled
        btn.textContent = submitting ? '提交中...' : '提交答案'
      }
    })
  }

  function rerender() {
    const main = document.getElementById('student-main')
    if (!main) return
    main.innerHTML = buildPage(data, state)
    bindEvents()
    requestAnimationFrame(() => renderProgressChart(questions, state.answers))
  }

  function bindEvents() {
    document.getElementById('btn-back-courses')?.addEventListener('click', () => { window.location.hash = '#/student/courses' })
    document.getElementById('btn-save-draft')?.addEventListener('click', () => saveDraft(false))
    document.getElementById('btn-save-draft-bottom')?.addEventListener('click', () => saveDraft(false))
    document.getElementById('btn-submit-task')?.addEventListener('click', submitNow)
    document.getElementById('btn-submit-task-bottom')?.addEventListener('click', submitNow)
    document.getElementById('btn-prev-question')?.addEventListener('click', () => { if (state.currentIndex > 0) { state.currentIndex--; rerender() } })
    document.getElementById('btn-next-question')?.addEventListener('click', () => { if (state.currentIndex < questions.length - 1) { state.currentIndex++; rerender() } })
    document.getElementById('btn-mark-question')?.addEventListener('click', () => {
      const qid = questions[state.currentIndex]?.question_id
      if (!qid) return
      if (state.marked.has(qid)) state.marked.delete(qid)
      else state.marked.add(qid)
      rerender()
    })
    document.querySelectorAll('.question-number').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentIndex = Number(btn.dataset.index || 0)
        rerender()
      })
    })
    document.querySelectorAll('.choice-option input').forEach(input => {
      input.addEventListener('change', () => {
        const q = questions[state.currentIndex]
        const type = String(q.question_type || '').toLowerCase()
        if (type === 'multiple_choice') {
          const selected = [...document.querySelectorAll(`input[name="question-${q.question_id}"]:checked`)].map(i => i.value)
          state.answers[q.question_id] = selected
        } else {
          state.answers[q.question_id] = input.value
        }
        state.saveStatus = '有未保存修改'
        rerender()
      })
    })
    document.querySelector('.answer-input')?.addEventListener('input', (e) => {
      const q = questions[state.currentIndex]
      state.answers[q.question_id] = e.target.value
      state.saveStatus = '有未保存修改'
      const count = document.querySelector('.short-count')
      if (count) count.textContent = `${e.target.value.length} 字`
      document.getElementById('save-status').textContent = `保存状态：${state.saveStatus}`
      renderProgressChart(questions, state.answers)
    })
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildPage(data, state), user })
  bindEvents()
  requestAnimationFrame(() => renderProgressChart(questions, state.answers))
  autosaveTimer = setInterval(() => saveDraft(true), 60000)
}
