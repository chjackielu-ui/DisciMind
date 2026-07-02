import { getMe } from '../api/auth.js'
import { getStudentSubmission, getQuestionAnalysis } from '../api/student.js'
import { getUser, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, formatDuration, formatAnswerContent, questionTypeLabel, taskTypeLabel, submissionStatusLabel, gradingStatusLabel } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { disposeAllCharts, bindResize, renderRingChart, renderBarChart, CHART_COLORS } from '../utils/echarts.js'

function getSubmissionId(params) {
  if (params?.submission_id) return Number(params.submission_id)
  const m = window.location.hash.slice(1).match(/^\/student\/submissions\/(\d+)\/result$/)
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
  return `<div class="complex-shell"><div class="complex-loading"><div class="complex-spinner"></div><p>正在加载提交结果...</p></div></div>`
}

function buildError(message) {
  return `
    <div class="complex-shell">
      <div class="complex-error">
        <h3>提交结果加载失败</h3>
        <p>${escapeHtml(message || 'submission 不存在或暂无权限访问。')}</p>
        <button class="complex-btn" id="btn-retry-result">重新加载</button>
      </div>
    </div>`
}

function getScoreLevel(score, total) {
  if (score == null || !total) return { label: '待批改', cls: 'warning' }
  const rate = (Number(score) / Number(total)) * 100
  if (rate >= 90) return { label: '优秀', cls: 'success' }
  if (rate >= 75) return { label: '良好', cls: 'success' }
  if (rate >= 60) return { label: '及格', cls: 'warning' }
  return { label: '需要加强', cls: 'danger' }
}

function buildSummary(answers) {
  const total = answers.length
  const correct = answers.filter(a => a.is_correct === true).length
  const wrong = answers.filter(a => a.is_correct === false).length
  const autoGraded = answers.filter(a => String(a.grading_status || '').toLowerCase() === 'auto_graded').length
  const aiGraded = answers.filter(a => a.ai_grading || String(a.grading_status || '').toLowerCase() === 'ai_graded').length
  const newWrong = answers.filter(a => a.wrong_question_status).length
  return { total, correct, wrong, autoGraded, aiGraded, newWrong }
}

function aggregateByType(answers) {
  const map = new Map()
  answers.forEach(a => {
    const key = String(a.question_type || 'unknown').toLowerCase()
    if (!map.has(key)) map.set(key, { type: key, score: 0, total: 0 })
    const item = map.get(key)
    item.score += Number(a.score || 0)
    item.total += Number(a.total_score || 0)
  })
  return [...map.values()]
}

function resultPill(answer) {
  if (answer.score == null) return `<span class="status-pill warning">待批改</span>`
  if (answer.is_correct === true) return `<span class="status-pill correct">正确</span>`
  const score = Number(answer.score || 0)
  const total = Number(answer.total_score || 0)
  if (score > 0 && score < total) return `<span class="status-pill partial">部分得分</span>`
  return `<span class="status-pill wrong">错误</span>`
}

function buildAdvice(answers) {
  const low = answers.filter(a => Number(a.score || 0) < Number(a.total_score || 0))
  if (!low.length) return '本次测验整体表现良好，可以继续保持当前节奏，并尝试挑战更高难度的综合题。'
  const kpNames = [...new Set(low.map(a => a.knowledge_point?.knowledge_point_name).filter(Boolean))]
  if (kpNames.length) return `本次测验中 ${kpNames.slice(0, 3).join('、')} 相关题目得分偏低，建议优先复习对应知识点，并结合错题本完成巩固练习。`
  const typeNames = [...new Set(low.map(a => questionTypeLabel(a.question_type)))]
  return `本次测验中 ${typeNames.slice(0, 3).join('、')} 仍有提升空间，建议回看相关课程资料并完成推荐学习。`
}

function buildAnswerCard(answer, index) {
  const content = answer.question_content || answer.question_title || ''
  const analysis = answer.answer_analysis || answer.feedback || answer.ai_grading?.comment || ''
  return `
    <article class="result-question-card" data-question-id="${answer.question_id}">
      <div class="result-question-head">
        <div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span class="complex-tag">第 ${index + 1} 题</span>
            <span class="complex-tag">${questionTypeLabel(answer.question_type)}</span>
            ${answer.knowledge_point?.knowledge_point_name ? `<span class="complex-tag">${escapeHtml(answer.knowledge_point.knowledge_point_name)}</span>` : ''}
          </div>
          <div style="color:var(--text-main);line-height:1.65;">${escapeHtml(content)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          ${resultPill(answer)}
          <div style="margin-top:8px;color:var(--complex-deep);font-weight:800;">${answer.score == null ? '待批改' : `${answer.score} / ${answer.total_score || 0}`}</div>
        </div>
      </div>
      <div class="answer-compare-grid">
        <div class="answer-box"><span>学生答案</span>${escapeHtml(formatAnswerContent(answer.student_answer))}</div>
        <div class="answer-box"><span>标准答案</span>${escapeHtml(formatAnswerContent(answer.correct_answer))}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <span class="status-pill ${answer.wrong_question_status ? 'warning' : 'success'}">${answer.wrong_question_status ? '已进入错题本' : '未进入错题本'}</span>
        <span class="status-pill">${gradingStatusLabel(answer.grading_status)}</span>
        <button class="complex-btn-ghost btn-toggle-analysis" type="button">查看解析</button>
      </div>
      <div class="analysis-body">${analysis ? escapeHtml(analysis) : '暂无解析，后续将由 AI 或教师补充。'}</div>
    </article>`
}

function buildPage(data) {
  const submission = data.submission || {}
  const task = data.task || {}
  const answers = data.answers || []
  if (!answers.length) {
    return `
      <div class="complex-shell">
        <button class="btn-back" id="btn-back-course">← 返回我的课程</button>
        <div class="complex-empty">
          <h3>暂无可展示的批改结果</h3>
          <p>提交记录已找到，但还没有答案明细。</p>
        </div>
      </div>`
  }

  const summary = buildSummary(answers)
  const level = getScoreLevel(submission.score, submission.total_score)
  const accuracy = summary.total ? Math.round((summary.correct / summary.total) * 100) : 0
  return `
    <div class="complex-shell">
      <section class="report-hero">
        <div>
          <button class="complex-btn-secondary" id="btn-back-course" style="margin-bottom:12px;">返回我的课程</button>
          <h1>${escapeHtml(task.task_title || '提交结果')}</h1>
          <p>${escapeHtml(task.course_name || '')} · ${taskTypeLabel(task.task_type)} · 提交时间 ${formatDate(submission.submitted_at)}</p>
          <div class="exam-meta-row">
            <span>正确率 ${accuracy}%</span>
            <span>批改状态：${gradingStatusLabel(submission.grading_status)}</span>
            <span>提交状态：${submissionStatusLabel(submission.status)}</span>
            <span>用时：${formatDuration(submission.duration_seconds)}</span>
            ${submission.is_late ? '<span>迟交</span>' : ''}
            <span>${level.label}</span>
          </div>
        </div>
        <div class="report-score-box">
          <b>${submission.score == null ? '--' : submission.score}</b>
          <span>/ ${submission.total_score || 0} 分</span>
        </div>
      </section>

      <section class="complex-metric-grid">
        <div class="complex-metric"><b>${summary.total}</b><span>总题数</span></div>
        <div class="complex-metric"><b>${summary.correct}</b><span>正确题数</span></div>
        <div class="complex-metric"><b>${summary.wrong}</b><span>错误题数</span></div>
        <div class="complex-metric"><b>${summary.autoGraded}</b><span>自动批改</span></div>
        <div class="complex-metric"><b>${summary.aiGraded}</b><span>AI 批改</span></div>
        <div class="complex-metric"><b>${summary.newWrong}</b><span>新增错题</span></div>
      </section>

      <section class="report-charts">
        <div class="complex-card"><h3 class="complex-section-title">得分构成</h3><div class="chart-container-sm" id="result-score-ring"></div></div>
        <div class="complex-card"><h3 class="complex-section-title">题型得分</h3><div class="chart-container-sm" id="result-type-bar"></div></div>
      </section>

      <section class="complex-card">
        <h3 class="complex-section-title">学习建议</h3>
        <p style="margin:0;color:var(--text-sub);line-height:1.75;">${escapeHtml(buildAdvice(answers))}</p>
        <div class="complex-actions" style="margin-top:14px;">
          <button class="complex-btn-secondary" id="btn-go-wrong">查看错题本</button>
          <button class="complex-btn-secondary" id="btn-go-courses">返回我的课程</button>
          <button class="complex-btn" id="btn-go-recommend">再看推荐学习</button>
        </div>
      </section>

      <section>
        <h3 class="complex-section-title">每题结果</h3>
        <div class="result-question-list">${answers.map((a, i) => buildAnswerCard(a, i)).join('')}</div>
      </section>
    </div>`
}

function renderCharts(data) {
  bindResize()
  const submission = data.submission || {}
  const answers = data.answers || []
  const score = Number(submission.score || 0)
  const total = Number(submission.total_score || 0)
  renderRingChart('result-score-ring', [
    { name: '得分', value: score, itemStyle: { color: CHART_COLORS.primary } },
    { name: '失分', value: Math.max(0, total - score), itemStyle: { color: CHART_COLORS.softYellow } },
  ], '')
  const grouped = aggregateByType(answers)
  renderBarChart('result-type-bar', grouped.map(g => questionTypeLabel(g.type)), [
    { name: '得分', data: grouped.map(g => g.score), itemStyle: { color: CHART_COLORS.primary, borderRadius: [8, 8, 0, 0] } },
    { name: '满分', data: grouped.map(g => g.total), itemStyle: { color: CHART_COLORS.light, borderRadius: [8, 8, 0, 0] } },
  ], '')
}

function bindEvents(app, params, submissionId, data) {
  document.getElementById('btn-back-course')?.addEventListener('click', () => { window.location.hash = '#/student/courses' })
  document.getElementById('btn-go-courses')?.addEventListener('click', () => { window.location.hash = '#/student/courses' })
  document.getElementById('btn-go-wrong')?.addEventListener('click', () => { window.location.hash = '#/student/wrong-questions' })
  document.getElementById('btn-go-recommend')?.addEventListener('click', () => { window.location.hash = '#/student/recommendations' })
  document.querySelectorAll('.btn-toggle-analysis').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.result-question-card')
      const body = card?.querySelector('.analysis-body')
      if (!card || !body) return
      body.classList.toggle('open')
      btn.textContent = body.classList.contains('open') ? '收起解析' : '查看解析'
      if (body.dataset.loaded === '1' || body.textContent.trim() !== '暂无解析，后续将由 AI 或教师补充。') return
      try {
        const res = await getQuestionAnalysis(card.dataset.questionId, submissionId)
        const analysis = res.data?.question?.answer_analysis || res.data?.student_answer?.feedback || res.data?.student_answer?.ai_grading?.comment
        if (analysis) body.textContent = analysis
        body.dataset.loaded = '1'
      } catch (err) {
        showToast(err.message || '解析加载失败', 'warning')
      }
    })
  })
}

export async function renderStudentSubmissionResult(app, params = {}) {
  disposeAllCharts()
  const submissionId = getSubmissionId(params)
  if (!submissionId) {
    window.location.hash = '#/student/courses'
    return
  }

  const user = await getAuthedUser()
  if (!user) return
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildLoading(), user })

  let data
  try {
    const res = await getStudentSubmission(submissionId)
    data = res.data || {}
  } catch (err) {
    renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildError(err.message), user })
    document.getElementById('btn-retry-result')?.addEventListener('click', () => renderStudentSubmissionResult(app, params))
    showToast(err.code === 40301 ? '无权限查看该提交结果' : '提交结果加载失败', 'error')
    return
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildPage(data), user })
  bindEvents(app, params, submissionId, data)
  requestAnimationFrame(() => renderCharts(data))
}
