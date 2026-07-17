import {
  getFileRequirements, planFileRequirements, patchFileRequirements, confirmFileRequirements, createAgentConversation,
  listAccessibleKnowledgeBases, listAvailableChatAgents,
} from '../../api/marketplace.js'
import { escapeHtml } from '../../utils/format.js'
import { createUnifiedComposer } from '../../components/unified-composer.js'
import { agentIconHTML } from '../../components/agent-icon.js'
import { renderMarketplaceLayout, loadingHTML, operationId, setButtonBusy, notify } from './marketplace-shared.js'

const typeLabel = value => value === 'STUDY_HANDOUT' ? '学习讲义' : '考试试卷'
const difficultyLabel = value => ({ BASIC: '基础', INTERMEDIATE: '中等', ADVANCED: '进阶' }[value] || '未选择')
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
    return `<div class="fg-question-type"><span>${label}</span><label>数量<input type="number" min="0" max="50" step="1" data-question-count="${type}" value="${item.count || 0}"></label><label>每题分值<input type="number" min="0" max="200" step="0.5" data-question-score="${type}" value="${item.score || 0}"></label></div>`
  }).join('')
}

function requirementSummary(draft) {
  if (!draft.readyForConfirmation) return ''
  return `<section class="complex-card fg-confirm-card"><h2>确认生成</h2><p>确认后会创建数据库任务，并在任务中心持续显示真实进度。</p><dl class="agent-detail-meta"><div><dt>文件类型</dt><dd>${typeLabel(draft.artifactType)}</dd></div><div><dt>课程</dt><dd>${escapeHtml(draft.courseName || '')}</dd></div><div><dt>知识点</dt><dd>${escapeHtml((draft.knowledgePointNames || []).join('、'))}</dd></div><div><dt>难度</dt><dd>${difficultyLabel(draft.difficulty)}</dd></div>${draft.artifactType === 'EXAM_PAPER' ? `<div><dt>题目与总分</dt><dd>${draft.questionCount || 0} 题 · ${draft.totalScore || 0} 分</dd></div><div><dt>考试时长</dt><dd>${draft.duration || 0} 分钟</dd></div>` : `<div><dt>对象与长度</dt><dd>${escapeHtml(draft.targetAudience || '')} · ${escapeHtml(draft.handoutLength || '')}</dd></div>`}<div><dt>输出格式</dt><dd>${escapeHtml((draft.outputFormats || ['DOCX']).join('、'))}</dd></div></dl><div class="fg-confirm-actions"><button id="fg-confirm" class="complex-btn" type="button">确认生成</button><a href="#/student/agent-tasks">查看任务中心</a></div></section>`
}

export async function renderFileGeneratorChat(app, { agent, conversationId, conversations }) {
  renderMarketplaceLayout(app, `<div id="file-generator-root">${loadingHTML('正在读取文件需求...')}</div>`, '#/student/agents/mine')
  const root = document.getElementById('file-generator-root')
  let draft
  let composer
  let knowledgeBases = []
  let callableAgents = []

  const render = () => {
    composer?.destroy()
    const courses = draft.candidates?.courses || []
    const points = (draft.candidates?.knowledgePoints || []).filter(item => !draft.courseKey || item.courseKey === draft.courseKey)
    const isExam = draft.artifactType === 'EXAM_PAPER'
    const isHandout = draft.artifactType === 'STUDY_HANDOUT'
    root.innerHTML = `<div class="agent-chat-shell file-generator-shell"><header class="agent-chat-topbar"><a href="#/student/agents/mine">返回我的智能体</a>${agentIconHTML(agent, { size: 44 })}<div class="agent-chat-title"><h1>${escapeHtml(agent.version?.name || '文件生成器')}</h1><p>需求确认、内容生成、文件导出和下载均使用持久化任务。</p></div><span class="agent-runtime-badge">${escapeHtml(draft.status || 'COLLECTING')}</span></header>
      <div class="agent-chat-layout file-generator-layout"><aside class="agent-chat-history"><button id="new-file-chat" class="complex-btn">新建需求</button>${conversations.map(item => `<a class="${item.id === conversationId ? 'active' : ''}" href="#/student/agents/${agent.id}/chat/${item.id}">${escapeHtml(item.title)}</a>`).join('')}</aside>
      <main class="agent-chat-main file-generator-main"><form id="file-requirement-form" class="agent-create-form"><section class="complex-card"><h2>基础要求</h2><div class="agent-advanced-grid">
        <label>文件类型<select id="fg-type" required><option value="">请选择</option><option value="EXAM_PAPER" ${isExam ? 'selected' : ''}>考试试卷</option><option value="STUDY_HANDOUT" ${isHandout ? 'selected' : ''}>学习讲义</option></select></label>
        <label>课程<select id="fg-course" required><option value="">请选择</option>${courses.map(item => `<option value="${item.courseKey}" ${draft.courseKey === item.courseKey ? 'selected' : ''}>${escapeHtml(item.courseName)}</option>`).join('')}</select></label>
        <label>难度<select id="fg-difficulty" required><option value="">请选择</option>${['BASIC','INTERMEDIATE','ADVANCED'].map(value => `<option value="${value}" ${draft.difficulty === value ? 'selected' : ''}>${difficultyLabel(value)}</option>`).join('')}</select></label>
        <label>标题<input id="fg-title" maxlength="150" value="${escapeHtml(draft.title || '')}" placeholder="留空时按课程与类型生成"></label></div>
        <fieldset><legend>知识点</legend><div class="fg-knowledge-options">${points.map(item => `<label><input type="checkbox" name="fg-kp" value="${item.knowledgePointKey}" ${(draft.knowledgePointKeys || []).includes(item.knowledgePointKey) ? 'checked' : ''}> ${escapeHtml(item.knowledgePointName)}</label>`).join('') || '<p>请选择课程后再选择知识点。</p>'}</div></fieldset>
      </section>
      <section class="complex-card ${isHandout ? '' : 'is-hidden'}" id="fg-handout-options"><h2>讲义参数</h2><div class="agent-advanced-grid"><label>面向对象<input id="fg-target" maxlength="100" value="${escapeHtml(draft.targetAudience || '本科生')}"></label><label>讲义长度<select id="fg-length">${[['SHORT','简短'],['MEDIUM','标准'],['LONG','详细']].map(([value,label]) => `<option value="${value}" ${(draft.handoutLength || 'MEDIUM') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><label>学习目标（每行一项）<textarea id="fg-objectives" maxlength="2000">${escapeHtml((draft.learningObjectives || []).join('\n'))}</textarea></label><div class="fg-check-grid"><label><input id="fg-examples" type="checkbox" ${checked(draft.includeExamples !== false)}> 包含例题</label><label><input id="fg-exercises" type="checkbox" ${checked(draft.includeExercises !== false)}> 包含练习</label><label><input id="fg-handout-answers" type="checkbox" ${checked(draft.includeAnswers !== false)}> 包含答案</label><label><input id="fg-handout-analysis" type="checkbox" ${checked(draft.includeAnalysis !== false)}> 包含解析</label></div></section>
      <section class="complex-card ${isExam ? '' : 'is-hidden'}" id="fg-exam-options"><h2>试卷参数</h2><div class="agent-advanced-grid"><label>考试类型<select id="fg-exam-type">${[['QUIZ','随堂测验'],['MIDTERM','期中考试'],['FINAL','期末考试'],['MOCK','模拟考试'],['CUSTOM','自定义']].map(([value,label]) => `<option value="${value}" ${(draft.examType || 'CUSTOM') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>总分<input id="fg-total-score" type="number" min="1" max="1000" value="${draft.totalScore || 100}"></label><label>考试时长（分钟）<input id="fg-duration" type="number" min="1" max="600" value="${draft.duration || 90}"></label></div><div class="fg-question-types"><header><strong>题型、数量与单题分值</strong><span id="fg-score-preview"></span></header>${questionRows(draft)}</div><div class="fg-check-grid"><label><input id="fg-answers" type="checkbox" ${checked(draft.includeAnswers !== false)}> 生成参考答案</label><label><input id="fg-analysis" type="checkbox" ${checked(draft.includeAnalysis !== false)}> 生成解析</label><label><input id="fg-answer-sheet" type="checkbox" ${checked(draft.includeAnswerSheet)}> 生成独立答题卷</label></div></section>
      <section class="complex-card"><h2>输出与补充</h2><fieldset><legend>输出格式</legend><label><input type="checkbox" name="fg-format" value="DOCX" ${(draft.outputFormats || [draft.outputFormat || 'DOCX']).includes('DOCX') ? 'checked' : ''}> DOCX</label><label><input type="checkbox" name="fg-format" value="PDF" ${(draft.outputFormats || []).includes('PDF') ? 'checked' : ''}> PDF</label></fieldset><label>生成风格<input id="fg-style" maxlength="200" value="${escapeHtml(draft.generationStyle || '')}" placeholder="例如：严谨、循序渐进"></label><label>补充要求<textarea id="fg-special" maxlength="1000">${escapeHtml(draft.specialRequirements || '')}</textarea></label><button id="fg-save" class="complex-btn-secondary" type="submit">保存并校验需求</button></section></form>
      <section class="complex-card fg-natural-plan"><h2>用自然语言补充</h2><p>可使用 @ 引用有权访问的知识库，使用 \ 按顺序调用对话智能体辅助完善需求。</p><div id="fg-composer"></div>${(draft.questions || []).length ? `<div class="fg-missing"><strong>还需要确认</strong>${draft.questions.map(item => `<p>${escapeHtml(item.question)}</p>`).join('')}</div>` : ''}</section>
      ${requirementSummary(draft)}</main></div></div>`

    const scorePreview = () => {
      const rows = QUESTION_TYPES.map(([type]) => ({ count: Number(root.querySelector(`[data-question-count="${type}"]`)?.value || 0), score: Number(root.querySelector(`[data-question-score="${type}"]`)?.value || 0) }))
      const count = rows.reduce((sum, item) => sum + item.count, 0)
      const score = rows.reduce((sum, item) => sum + item.count * item.score, 0)
      const target = Number(root.querySelector('#fg-total-score')?.value || 0)
      const preview = root.querySelector('#fg-score-preview')
      if (preview) { preview.textContent = `${count} 题 · ${score} 分${score === target ? '' : `（应为 ${target} 分）`}`; preview.classList.toggle('is-error', score !== target) }
      return { count, score }
    }
    root.querySelectorAll('[data-question-count],[data-question-score],#fg-total-score').forEach(input => input.addEventListener('input', scorePreview))
    scorePreview()
    root.querySelector('#new-file-chat').onclick = async event => { setButtonBusy(event.currentTarget, true); try { const created = await createAgentConversation(agent.id, { title: '新文件需求', operationId: operationId() }); window.location.hash = `#/student/agents/${agent.id}/chat/${created.data.id}` } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) } }
    root.querySelector('#fg-course').onchange = () => { draft.courseKey = root.querySelector('#fg-course').value; draft.knowledgePointKeys = []; render() }
    root.querySelector('#fg-type').onchange = () => { draft.artifactType = root.querySelector('#fg-type').value; render() }
    root.querySelector('#file-requirement-form').onsubmit = async event => {
      event.preventDefault(); const button = root.querySelector('#fg-save'); setButtonBusy(button, true, '校验中...')
      try {
        const artifactType = root.querySelector('#fg-type').value
        const outputFormats = [...root.querySelectorAll('[name="fg-format"]:checked')].map(item => item.value)
        if (!outputFormats.length) throw new Error('请至少选择一种输出格式')
        const data = { artifactType, courseKey: root.querySelector('#fg-course').value, knowledgePointKeys: [...root.querySelectorAll('[name="fg-kp"]:checked')].map(item => item.value), title: root.querySelector('#fg-title').value.trim(), difficulty: root.querySelector('#fg-difficulty').value || undefined, outputFormats, generationStyle: root.querySelector('#fg-style').value.trim(), specialRequirements: root.querySelector('#fg-special').value.trim() }
        if (artifactType === 'STUDY_HANDOUT') Object.assign(data, { targetAudience: root.querySelector('#fg-target').value.trim(), handoutLength: root.querySelector('#fg-length').value, learningObjectives: root.querySelector('#fg-objectives').value.split(/\r?\n/).map(item => item.trim()).filter(Boolean), includeExamples: root.querySelector('#fg-examples').checked, includeExercises: root.querySelector('#fg-exercises').checked, includeAnswers: root.querySelector('#fg-handout-answers').checked, includeAnalysis: root.querySelector('#fg-handout-analysis').checked })
        if (artifactType === 'EXAM_PAPER') {
          const questionTypes = QUESTION_TYPES.map(([type]) => ({ type, count: Number(root.querySelector(`[data-question-count="${type}"]`).value), score: Number(root.querySelector(`[data-question-score="${type}"]`).value) })).filter(item => item.count > 0)
          if (questionTypes.some(item => item.score <= 0)) throw new Error('启用的题型必须填写大于 0 的单题分值')
          const totals = scorePreview(); const totalScore = Number(root.querySelector('#fg-total-score').value)
          if (!questionTypes.length) throw new Error('请至少配置一种题型')
          if (Math.abs(totals.score - totalScore) > 1e-6) throw new Error(`各题型总分 ${totals.score} 必须等于试卷总分 ${totalScore}`)
          Object.assign(data, { examType: root.querySelector('#fg-exam-type').value, totalScore, duration: Number(root.querySelector('#fg-duration').value), questionCount: totals.count, questionTypes, includeAnswers: root.querySelector('#fg-answers').checked, includeAnalysis: root.querySelector('#fg-analysis').checked, includeAnswerSheet: root.querySelector('#fg-answer-sheet').checked })
        }
        draft = { ...draft, ...(await patchFileRequirements(conversationId, data)).data }; notify('需求已保存并通过权限校验'); render()
      } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
    }
    composer = createUnifiedComposer({
      root: root.querySelector('#fg-composer'), knowledgeBases, agents: callableAgents, allowImages: false,
      placeholder: '补充生成要求；@ 引用知识库，\\ 调用对话智能体',
      onNotice: message => notify(message, true),
      onSubmit: async payload => {
        composer.setBusy(true)
        try { draft = { ...draft, ...(await planFileRequirements(conversationId, { message: payload.content, knowledgeBaseRefs: payload.knowledgeBaseRefs, agentRefs: payload.agentRefs })).data }; composer.clear(); render() }
        catch (error) { composer.setBusy(false); notify(error.message, true) }
      },
    })
    root.querySelector('#fg-confirm')?.addEventListener('click', async event => { if (!confirm('确认按当前摘要创建真实生成任务吗？')) return; setButtonBusy(event.currentTarget, true, '创建任务...'); try { const result = await confirmFileRequirements(conversationId, operationId()); notify('任务已创建，可在任务中心查看实时进度'); window.location.hash = `#/student/artifacts/${result.data.artifact.id}` } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) } })
  }

  try {
    const [requirements, knowledge, agents] = await Promise.all([getFileRequirements(conversationId), listAccessibleKnowledgeBases(), listAvailableChatAgents()])
    draft = requirements.data; knowledgeBases = knowledge.data?.list || []; callableAgents = agents.data?.list || []; render()
  } catch (error) { root.innerHTML = `<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>` }
}
