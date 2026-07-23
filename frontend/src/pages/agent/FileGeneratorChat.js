import {
  getFileRequirements, planFileRequirements, patchFileRequirements, confirmFileRequirements, createAgentConversation,
  listAccessibleKnowledgeBases, listAvailableChatAgents,
} from '../../api/marketplace.js'
import { escapeHtml } from '../../utils/format.js'
import { createUnifiedComposer } from '../../components/unified-composer.js'
import { agentIconHTML } from '../../components/agent-icon.js'
import { renderMarketplaceLayout, loadingHTML, operationId, setButtonBusy, notify } from './marketplace-shared.js'

const TYPE_META = {
  STUDY_HANDOUT: {
    eyebrow: 'LEARNING HANDOUT', title: '讲义生成工作台', icon: '✦',
    description: '把课程知识、学习目标和练习设计整理成一份结构化学习讲义。',
    action: '生成学习讲义', deliverable: '学习讲义',
  },
  EXAM_PAPER: {
    eyebrow: 'ASSESSMENT STUDIO', title: '试卷生成工作台', icon: '◈',
    description: '按知识点、难度与题型配比，生成可预览、可导出的结构化试卷。',
    action: '生成考试试卷', deliverable: '考试试卷',
  },
}
const typeLabel = value => TYPE_META[value]?.deliverable || '文件'
const difficultyLabel = value => ({ BASIC: '基础', INTERMEDIATE: '中等', ADVANCED: '进阶' }[value] || '待选择')
const statusLabel = value => ({ COLLECTING: '正在配置', READY: '等待生成', GENERATING: '正在生成', COMPLETED: '已完成' }[value] || '正在配置')
const QUESTION_TYPES = [
  ['SINGLE_CHOICE', '单选题'], ['MULTIPLE_CHOICE', '多选题'], ['TRUE_FALSE', '判断题'], ['FILL_BLANK', '填空题'],
  ['SHORT_ANSWER', '简答题'], ['CALCULATION', '计算题'], ['PROGRAMMING', '编程题'],
]
const DEFAULT_TYPES = [
  { type: 'SINGLE_CHOICE', count: 10, score: 4 },
  { type: 'TRUE_FALSE', count: 5, score: 2 },
  { type: 'SHORT_ANSWER', count: 5, score: 10 },
]

function checked(value) { return value ? 'checked' : '' }

function questionRows(draft) {
  const map = new Map((draft.questionTypes?.length ? draft.questionTypes : DEFAULT_TYPES).map(item => [item.type, item]))
  return QUESTION_TYPES.map(([type, label]) => {
    const item = map.get(type) || { count: 0, score: 0 }
    return `<div class="fg-question-type"><div><strong>${label}</strong><small>${type.replaceAll('_', ' ')}</small></div><label><span>数量</span><input type="number" min="0" max="50" step="1" data-question-count="${type}" value="${item.count || 0}"></label><label><span>每题分值</span><input type="number" min="0" max="200" step="0.5" data-question-score="${type}" value="${item.score || 0}"></label></div>`
  }).join('')
}

function outputFormats(draft) {
  const selected = draft.outputFormats || [draft.outputFormat || 'DOCX']
  return `<div class="fg-format-options"><label class="${selected.includes('DOCX') ? 'is-selected' : ''}"><input type="checkbox" name="fg-format" value="DOCX" ${checked(selected.includes('DOCX'))}><span>DOCX</span><small>可编辑文档</small></label><label class="${selected.includes('PDF') ? 'is-selected' : ''}"><input type="checkbox" name="fg-format" value="PDF" ${checked(selected.includes('PDF'))}><span>PDF</span><small>适合分发打印</small></label><label class="${selected.includes('PPTX') ? 'is-selected' : ''}"><input type="checkbox" name="fg-format" value="PPTX" ${checked(selected.includes('PPTX'))}><span>PPTX</span><small>演示课件</small></label></div>`
}

function knowledgeOptions(points, selectedKeys) {
  if (!points.length) return '<div class="fg-knowledge-empty"><b>先选择课程</b><span>课程确定后，会仅显示与该课程相关的知识点。</span></div>'
  return `<div class="fg-knowledge-grid">${points.map(item => `<label class="fg-knowledge-chip" data-knowledge-name="${escapeHtml(item.knowledgePointName).toLowerCase()}"><input type="checkbox" name="fg-kp" value="${escapeHtml(item.knowledgePointKey)}" ${checked(selectedKeys.includes(item.knowledgePointKey))}><span>${escapeHtml(item.knowledgePointName)}</span></label>`).join('')}</div>`
}

function renderSummary(draft, type) {
  const meta = TYPE_META[type]
  const selectedNames = draft.knowledgePointNames || []
  const detail = type === 'EXAM_PAPER'
    ? `${draft.questionCount || 20} 题 · ${draft.totalScore || 100} 分 · ${draft.duration || 90} 分钟`
    : `${draft.targetAudience || '本科生'} · ${(draft.handoutLength === 'LONG' ? '详细' : draft.handoutLength === 'SHORT' ? '简短' : '标准')}篇幅`
  const questions = (draft.questions || []).slice(0, 3)
  return `<aside class="fg-summary-rail"><section class="fg-summary-card fg-summary-primary"><div class="fg-summary-kicker"><span>${meta.icon}</span><b>本次产物</b></div><h2>${escapeHtml(draft.title || meta.deliverable)}</h2><p>${escapeHtml(draft.courseName || '尚未选择课程')}</p><dl><div><dt>知识点</dt><dd>${selectedNames.length ? `${selectedNames.length} 个已选` : '待选择'}</dd></div><div><dt>难度</dt><dd>${difficultyLabel(draft.difficulty)}</dd></div><div><dt>${type === 'EXAM_PAPER' ? '考试配置' : '内容范围'}</dt><dd>${escapeHtml(detail)}</dd></div></dl><div class="fg-summary-tags">${selectedNames.slice(0, 3).map(name => `<span>${escapeHtml(name)}</span>`).join('')}${selectedNames.length > 3 ? `<span>+${selectedNames.length - 3}</span>` : ''}</div></section><section class="fg-summary-card fg-summary-check"><div><span class="fg-status-dot ${draft.readyForConfirmation ? 'is-ready' : ''}"></span><b>${draft.readyForConfirmation ? '需求已准备完成' : '还差一步即可生成'}</b></div><p>${draft.readyForConfirmation ? '确认后将创建可追踪任务，并在产物中心提供预览和下载。' : '完善课程、知识点及必要参数后，系统会自动完成校验。'}</p>${questions.length ? `<ul>${questions.map(item => `<li>${escapeHtml(item.question)}</li>`).join('')}</ul>` : ''}${draft.readyForConfirmation ? `<button id="fg-confirm" class="fg-primary-action" type="button">${meta.action}<span>→</span></button>` : '<a href="#fg-workspace-form" class="fg-summary-link">继续完善需求 ↓</a>'}</section><a class="fg-task-link" href="#/student/agent-tasks"><span>◌</span><div><b>任务与产物中心</b><small>随时查看生成进度、预览和导出</small></div><i>→</i></a></aside>`
}

function historyHTML(agent, conversations, conversationId) {
  return `<aside class="fg-history"><div class="fg-history-head"><span>工作区</span><button id="new-file-chat" type="button">＋ 新建需求</button></div><div class="fg-history-list">${conversations.map(item => `<a class="${item.id === conversationId ? 'active' : ''}" href="#/student/agents/${agent.id}/chat/${item.id}"><span>${item.id === conversationId ? '◉' : '○'}</span><div><strong>${escapeHtml(item.title || '未命名需求')}</strong><small>${new Date(item.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</small></div></a>`).join('') || '<p>还没有历史需求</p>'}</div><div class="fg-history-note"><b>受控生成</b><span>每次生成都保留任务、版本和导出记录。</span></div></aside>`
}

function selected(value) { return value ? 'selected' : '' }

function scopePanelHTML({ type, fixedType, draft, courses, points, selectedKeys }) {
  const meta = TYPE_META[type]
  const typeControl = fixedType
    ? `<input id="fg-type" type="hidden" value="${type}"><div class="fg-locked-type"><span>产物类型</span><b>${meta.deliverable}</b><small>由当前系统智能体专属生成</small></div>`
    : `<label>产物类型<select id="fg-type" required><option value="STUDY_HANDOUT" ${selected(type === 'STUDY_HANDOUT')}>学习讲义</option><option value="EXAM_PAPER" ${selected(type === 'EXAM_PAPER')}>考试试卷</option></select></label>`
  return `<section class="fg-panel fg-scope-panel" id="fg-workspace-form">
    <div class="fg-section-head"><div><span>01 · 内容范围</span><h2>${type === 'EXAM_PAPER' ? '先定义这份试卷考什么' : '先定义这份讲义要帮助谁学习'}</h2><p>从课程与知识点开始，系统只会使用你有权限访问的内容。</p></div><span class="fg-section-mark">${meta.icon}</span></div>
    <div class="fg-field-grid fg-field-grid-primary">${typeControl}<label>选择课程<select id="fg-course" required><option value="">请选择要覆盖的课程</option>${courses.map(item => `<option value="${item.courseKey}" ${selected(draft.courseKey === item.courseKey)}>${escapeHtml(item.courseName)}</option>`).join('')}</select></label><label>学习难度<select id="fg-difficulty" required><option value="">请选择难度</option>${['BASIC', 'INTERMEDIATE', 'ADVANCED'].map(value => `<option value="${value}" ${selected(draft.difficulty === value)}>${difficultyLabel(value)}</option>`).join('')}</select></label><label class="fg-title-field">产物标题<input id="fg-title" maxlength="150" value="${escapeHtml(draft.title || '')}" placeholder="留空时自动生成规范标题"></label></div>
    <div class="fg-knowledge-picker"><div class="fg-picker-head"><div><b>知识点范围</b><small id="fg-knowledge-count">${selectedKeys.length ? `已选 ${selectedKeys.length} 个知识点` : draft.courseKey ? '请选择本次要覆盖的知识点' : '请先选择课程'}</small></div>${draft.courseKey ? `<div><input id="fg-knowledge-search" type="search" placeholder="搜索知识点"><button id="fg-clear-knowledge" type="button" ${selectedKeys.length ? '' : 'disabled'}>清空选择</button></div>` : ''}</div>${knowledgeOptions(points, selectedKeys)}</div>
  </section>`
}

function examDesignHTML(draft) {
  return `<div class="fg-field-grid fg-field-grid-three"><label>考试场景<select id="fg-exam-type">${[['QUIZ', '随堂测验'], ['MIDTERM', '期中复习'], ['FINAL', '期末复习'], ['MOCK', '模拟考试'], ['CUSTOM', '自定义练习']].map(([value, label]) => `<option value="${value}" ${selected((draft.examType || 'CUSTOM') === value)}>${label}</option>`).join('')}</select></label><label>试卷总分<input id="fg-total-score" type="number" min="1" max="1000" value="${draft.totalScore || 100}"></label><label>考试时长（分钟）<input id="fg-duration" type="number" min="1" max="600" value="${draft.duration || 90}"></label></div><div class="fg-score-strip"><b>题型与配分</b><span id="fg-score-preview"></span></div><div class="fg-question-types">${questionRows(draft)}</div><div class="fg-toggle-row"><label><input id="fg-answers" type="checkbox" ${checked(draft.includeAnswers !== false)}><span>附参考答案</span></label><label><input id="fg-analysis" type="checkbox" ${checked(draft.includeAnalysis !== false)}><span>附逐题解析</span></label><label><input id="fg-answer-sheet" type="checkbox" ${checked(draft.includeAnswerSheet)}><span>生成独立答题卷</span></label></div>`
}

function handoutDesignHTML(draft) {
  return `<div class="fg-field-grid fg-field-grid-two"><label>面向对象<input id="fg-target" maxlength="100" value="${escapeHtml(draft.targetAudience || '本科生')}" placeholder="例如：初学者、期末复习学生"></label><label>内容篇幅<select id="fg-length">${[['SHORT', '简明提纲'], ['MEDIUM', '标准讲义'], ['LONG', '深入讲解']].map(([value, label]) => `<option value="${value}" ${selected((draft.handoutLength || 'MEDIUM') === value)}>${label}</option>`).join('')}</select></label></div><label class="fg-objectives-field"><span>学习目标</span><small>每行一个目标；它们会成为讲义的章节组织依据。</small><textarea id="fg-objectives" maxlength="2000" placeholder="理解核心概念与适用边界&#10;完成一道典型练习并能解释解题思路">${escapeHtml((draft.learningObjectives || []).join('\n'))}</textarea></label><div class="fg-toggle-row"><label><input id="fg-examples" type="checkbox" ${checked(draft.includeExamples !== false)}><span>包含例题</span></label><label><input id="fg-exercises" type="checkbox" ${checked(draft.includeExercises !== false)}><span>包含练习</span></label><label><input id="fg-handout-answers" type="checkbox" ${checked(draft.includeAnswers !== false)}><span>附参考答案</span></label><label><input id="fg-handout-analysis" type="checkbox" ${checked(draft.includeAnalysis !== false)}><span>附答案解析</span></label></div>`
}

function designPanelHTML(type, draft) {
  const isExam = type === 'EXAM_PAPER'
  return `<section class="fg-panel fg-design-panel"><div class="fg-section-head"><div><span>02 · ${isExam ? '试卷设计' : '学习设计'}</span><h2>${isExam ? '组合题型与评分结构' : '决定讲义的学习体验'}</h2><p>${isExam ? '系统会在生成前校验题量、分值和试卷总分。' : '把学习目标转化成可读、可练、可复习的讲义结构。'}</p></div></div>${isExam ? examDesignHTML(draft) : handoutDesignHTML(draft)}</section>`
}

function outputPanelHTML(draft) {
  return `<section class="fg-panel fg-output-panel"><div class="fg-section-head"><div><span>03 · 输出与补充</span><h2>选择交付方式</h2><p>生成任务会保留完整进度，完成后可以预览、下载或再次导出。</p></div></div>${outputFormats(draft)}<div class="fg-field-grid fg-field-grid-two"><label>生成风格<input id="fg-style" maxlength="200" value="${escapeHtml(draft.generationStyle || '')}" placeholder="例如：循序渐进、严谨专业"></label><label>补充要求<textarea id="fg-special" maxlength="1000" placeholder="可补充教学重点、题目要求或排版偏好">${escapeHtml(draft.specialRequirements || '')}</textarea></label></div><div class="fg-form-footer"><span>保存后会进行权限与内容完整性校验</span><button id="fg-save" class="fg-save-button" type="submit">保存并校验 <b>→</b></button></div></section>`
}

function studioHTML({ agent, conversations, conversationId, draft, type, fixedType, courses, points, selectedKeys }) {
  const meta = TYPE_META[type]
  const isExam = type === 'EXAM_PAPER'
  return `<div class="agent-chat-shell file-generator-shell fg-mode-${isExam ? 'exam' : 'handout'}"><header class="fg-workspace-hero"><a href="#/student/agents" class="fg-back-link">← 智能体广场</a><div class="fg-hero-title">${agentIconHTML(agent, { size: 48 })}<div><span>${meta.eyebrow}</span><h1>${meta.title}</h1><p>${meta.description}</p></div></div><div class="fg-hero-meta"><span class="fg-status-pill">${statusLabel(draft.status)}</span><span>可信任务流</span></div></header><div class="fg-stepper"><span class="is-active"><i>1</i>配置范围</span><span class="${draft.courseKey ? 'is-active' : ''}"><i>2</i>选择知识点</span><span class="${draft.readyForConfirmation ? 'is-active' : ''}"><i>3</i>确认并生成</span><p>${isExam ? '配置题型、配分与考试时长' : '配置学习目标、内容深度与练习方式'}</p></div><div class="fg-workspace-layout">${historyHTML(agent, conversations, conversationId)}<main class="file-generator-main"><div class="fg-workbench"><form id="file-requirement-form" class="fg-workspace-form">${scopePanelHTML({ type, fixedType, draft, courses, points, selectedKeys })}${designPanelHTML(type, draft)}${outputPanelHTML(draft)}</form><section class="fg-panel fg-natural-plan"><div class="fg-section-head"><div><span>AI 辅助完善</span><h2>用自然语言补充需求</h2><p>可引用知识库或调用对话智能体，系统会把结果安全地合并进当前需求。</p></div><span class="fg-ai-badge">AI</span></div><div id="fg-composer"></div></section></div>${renderSummary(draft, type)}</main></div></div>`
}

export async function renderFileGeneratorChat(app, { agent, conversationId, conversations }) {
  renderMarketplaceLayout(app, `<div id="file-generator-root">${loadingHTML('正在加载生成工作台...')}</div>`, '#/student/agents')
  const root = document.getElementById('file-generator-root')
  let draft
  let composer
  let knowledgeBases = []
  let callableAgents = []
  const fixedType = agent.version?.fileGeneratorConfig?.documentType

  const render = () => {
    composer?.destroy()
    const type = fixedType || draft.artifactType || 'STUDY_HANDOUT'
    if (fixedType && draft.artifactType !== fixedType) draft = { ...draft, artifactType: fixedType }
    const meta = TYPE_META[type]
    const courses = draft.candidates?.courses || []
    const hasCourse = Boolean(draft.courseKey)
    const points = hasCourse
      ? (draft.candidates?.knowledgePoints || []).filter(item => item.courseKey === draft.courseKey)
      : []
    const selectedKeys = draft.knowledgePointKeys || []

    root.innerHTML = studioHTML({ agent, conversations, conversationId, draft, type, fixedType, courses, points, selectedKeys })
    const selectedKnowledge = () => [...root.querySelectorAll('[name="fg-kp"]:checked')]
    const updateKnowledgeCount = () => {
      const selected = selectedKnowledge().length
      const count = root.querySelector('#fg-knowledge-count')
      if (count) count.textContent = selected ? `已选 ${selected} 个知识点` : '请选择本次要覆盖的知识点'
      const clear = root.querySelector('#fg-clear-knowledge')
      if (clear) clear.disabled = selected === 0
    }
    const scorePreview = () => {
      const rows = QUESTION_TYPES.map(([itemType]) => ({ count: Number(root.querySelector(`[data-question-count="${itemType}"]`)?.value || 0), score: Number(root.querySelector(`[data-question-score="${itemType}"]`)?.value || 0) }))
      const count = rows.reduce((sum, item) => sum + item.count, 0)
      const score = rows.reduce((sum, item) => sum + item.count * item.score, 0)
      const target = Number(root.querySelector('#fg-total-score')?.value || 0)
      const preview = root.querySelector('#fg-score-preview')
      if (preview) { preview.textContent = `${count} 题 · ${score} / ${target} 分${score === target ? ' · 配分正确' : ' · 请调整配分'}`; preview.classList.toggle('is-error', score !== target) }
      return { count, score }
    }
    root.querySelectorAll('[name="fg-kp"]').forEach(input => input.addEventListener('change', updateKnowledgeCount))
    root.querySelector('#fg-knowledge-search')?.addEventListener('input', event => {
      const query = event.target.value.trim().toLowerCase()
      root.querySelectorAll('.fg-knowledge-chip').forEach(item => { item.hidden = Boolean(query) && !item.dataset.knowledgeName.includes(query) })
    })
    root.querySelector('#fg-clear-knowledge')?.addEventListener('click', () => { root.querySelectorAll('[name="fg-kp"]:checked').forEach(item => { item.checked = false }); updateKnowledgeCount() })
    root.querySelectorAll('[data-question-count],[data-question-score],#fg-total-score').forEach(input => input.addEventListener('input', scorePreview))
    scorePreview()
    root.querySelector('#new-file-chat').onclick = async event => { setButtonBusy(event.currentTarget, true); try { const created = await createAgentConversation(agent.id, { title: '新文件需求', operationId: operationId() }); window.location.hash = `#/student/agents/${agent.id}/chat/${created.data.id}` } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) } }
    root.querySelector('#fg-course').onchange = () => {
      const select = root.querySelector('#fg-course')
      const course = courses.find(item => item.courseKey === select.value)
      draft.courseKey = select.value
      draft.courseName = course?.courseName || ''
      draft.knowledgePointKeys = []
      draft.knowledgePointNames = []
      render()
    }
    root.querySelector('#fg-type')?.addEventListener('change', event => { draft.artifactType = event.target.value; render() })
    root.querySelector('#file-requirement-form').onsubmit = async event => {
      event.preventDefault()
      const button = root.querySelector('#fg-save')
      setButtonBusy(button, true, '校验中...')
      try {
        const artifactType = root.querySelector('#fg-type').value
        const outputFormats = [...root.querySelectorAll('[name="fg-format"]:checked')].map(item => item.value)
        if (!outputFormats.length) throw new Error('请至少选择一种输出格式')
        const data = {
          artifactType, courseKey: root.querySelector('#fg-course').value,
          knowledgePointKeys: selectedKnowledge().map(item => item.value), title: root.querySelector('#fg-title').value.trim(),
          difficulty: root.querySelector('#fg-difficulty').value || undefined, outputFormats,
          generationStyle: root.querySelector('#fg-style').value.trim(), specialRequirements: root.querySelector('#fg-special').value.trim(),
        }
        if (artifactType === 'STUDY_HANDOUT') Object.assign(data, {
          targetAudience: root.querySelector('#fg-target').value.trim(), handoutLength: root.querySelector('#fg-length').value,
          learningObjectives: root.querySelector('#fg-objectives').value.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
          includeExamples: root.querySelector('#fg-examples').checked, includeExercises: root.querySelector('#fg-exercises').checked,
          includeAnswers: root.querySelector('#fg-handout-answers').checked, includeAnalysis: root.querySelector('#fg-handout-analysis').checked,
        })
        if (artifactType === 'EXAM_PAPER') {
          const questionTypes = QUESTION_TYPES.map(([itemType]) => ({ type: itemType, count: Number(root.querySelector(`[data-question-count="${itemType}"]`).value), score: Number(root.querySelector(`[data-question-score="${itemType}"]`).value) })).filter(item => item.count > 0)
          if (questionTypes.some(item => item.score <= 0)) throw new Error('启用的题型必须填写大于 0 的单题分值')
          const totals = scorePreview()
          const totalScore = Number(root.querySelector('#fg-total-score').value)
          if (!questionTypes.length) throw new Error('请至少配置一种题型')
          if (Math.abs(totals.score - totalScore) > 1e-6) throw new Error(`各题型总分 ${totals.score} 必须等于试卷总分 ${totalScore}`)
          Object.assign(data, {
            examType: root.querySelector('#fg-exam-type').value, totalScore, duration: Number(root.querySelector('#fg-duration').value),
            questionCount: totals.count, questionTypes, includeAnswers: root.querySelector('#fg-answers').checked,
            includeAnalysis: root.querySelector('#fg-analysis').checked, includeAnswerSheet: root.querySelector('#fg-answer-sheet').checked,
          })
        }
        draft = { ...draft, ...(await patchFileRequirements(conversationId, data)).data }
        notify('需求已保存并完成校验')
        render()
      } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
    }
    composer = createUnifiedComposer({
      root: root.querySelector('#fg-composer'), knowledgeBases, agents: callableAgents, allowImages: false,
      placeholder: '补充需求；@ 引用知识库，\\ 调用对话智能体',
      onNotice: message => notify(message, true),
      onSubmit: async payload => {
        composer.setBusy(true)
        try { draft = { ...draft, ...(await planFileRequirements(conversationId, { message: payload.content, knowledgeBaseRefs: payload.knowledgeBaseRefs, agentRefs: payload.agentRefs })).data }; composer.clear(); render() }
        catch (error) { composer.setBusy(false); notify(error.message, true) }
      },
    })
    root.querySelector('#fg-confirm')?.addEventListener('click', async event => {
      if (!confirm(`确认${meta.action}吗？`)) return
      setButtonBusy(event.currentTarget, true, '正在创建任务...')
      try { const result = await confirmFileRequirements(conversationId, operationId()); notify('生成任务已创建，可在任务中心查看进度'); window.location.hash = `#/student/artifacts/${result.data.artifact.id}` }
      catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) }
    })
  }

  try {
    const [requirements, knowledge, agents] = await Promise.all([getFileRequirements(conversationId), listAccessibleKnowledgeBases(), listAvailableChatAgents()])
    draft = requirements.data
    knowledgeBases = knowledge.data?.list || []
    callableAgents = agents.data?.list || []
    render()
  } catch (error) { root.innerHTML = `<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>` }
}
