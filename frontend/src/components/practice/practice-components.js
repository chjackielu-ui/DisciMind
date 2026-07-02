import { escapeHtml } from '../../utils/format.js'
import {
  questionTypeTagHtml,
  difficultyTagHtml,
  sourceTagHtml,
  statusTagHtml,
  knowledgePointTagHtml,
} from './practice-tags.js'

export {
  questionTypeTagHtml,
  difficultyTagHtml,
  sourceTagHtml,
  statusTagHtml,
  knowledgePointTagHtml,
}

export const PRACTICE_QUESTION_TYPES = [
  { value: 'single_choice', code: 'SINGLE_CHOICE', label: '单选题' },
  { value: 'multiple_choice', code: 'MULTIPLE_CHOICE', label: '多选题' },
  { value: 'true_false', code: 'TRUE_FALSE', label: '判断题' },
  { value: 'fill_blank', code: 'FILL_BLANK', label: '填空题' },
  { value: 'short_answer', code: 'SHORT_ANSWER', label: '简答题' },
]

export const PRACTICE_DIFFICULTIES = [
  { value: 'basic', label: '基础', desc: '适合知识点入门巩固' },
  { value: 'medium', label: '普通', desc: '适合日常训练' },
  { value: 'hard', label: '提高', desc: '适合强化理解' },
  { value: 'comprehensive', label: '综合', desc: '适合阶段复习' },
]

export const PRACTICE_MODES = [
  { value: 'random', label: '随机练习', desc: '从题库中随机抽取符合条件的题目' },
  { value: 'wrong_retry', label: '错题重练', desc: '优先围绕近期错题进行巩固' },
  { value: 'weak_point', label: '薄弱知识点练习', desc: '聚焦掌握度偏低的知识点' },
  { value: 'ai_fill', label: 'AI补题练习', desc: '题量不足时自动补充新题' },
]

// 作答模式
export const ANSWER_MODES = [
  { value: 'single', label: '单题模式', desc: '逐题作答，提交后立即查看解析' },
  { value: 'paper', label: '整卷模式', desc: '自由切换题号，统一提交后查看解析' },
]

// 练习/考试模式
export const PRACTICE_SESSION_MODES = [
  { value: 'practice', label: '练习模式', desc: '适合平时练习，提交后可查看解析和AI提问' },
  { value: 'exam', label: '考试模式', desc: '模拟测试，作答中不显示解析和AI提问' },
]

const TYPE_ALIASES = {
  single_choice: 'single_choice',
  singlechoice: 'single_choice',
  single: 'single_choice',
  multiple_choice: 'multiple_choice',
  multiplechoice: 'multiple_choice',
  multiple: 'multiple_choice',
  true_false: 'true_false',
  truefalse: 'true_false',
  judge: 'true_false',
  blank: 'fill_blank',
  fill_blank: 'fill_blank',
  fillblank: 'fill_blank',
  short_answer: 'short_answer',
  shortanswer: 'short_answer',
}

export function normalizeQuestionType(type) {
  const key = String(type || '').trim().toLowerCase()
  return TYPE_ALIASES[key] || key
}

export function questionTypeCode(type) {
  const normalized = normalizeQuestionType(type)
  return PRACTICE_QUESTION_TYPES.find(item => item.value === normalized)?.code || String(type || '').toUpperCase()
}

export function practiceQuestionTypeLabel(type) {
  const normalized = normalizeQuestionType(type)
  return PRACTICE_QUESTION_TYPES.find(item => item.value === normalized)?.label || type || '未知题型'
}

export function practiceDifficultyLabel(value) {
  const normalized = String(value || '').toLowerCase()
  return PRACTICE_DIFFICULTIES.find(item => item.value === normalized)?.label || value || '未设置'
}

export function practiceDifficultyDesc(value) {
  const normalized = String(value || '').toLowerCase()
  return PRACTICE_DIFFICULTIES.find(item => item.value === normalized)?.desc || ''
}

export function practiceModeLabel(value) {
  const normalized = String(value || '').toLowerCase()
  return PRACTICE_MODES.find(item => item.value === normalized)?.label || value || '智能练习'
}

export function practiceSessionModeLabel(value) {
  const normalized = String(value || '').toLowerCase()
  return PRACTICE_SESSION_MODES.find(item => item.value === normalized)?.label || value || '练习模式'
}

export function answerModeLabel(value) {
  const normalized = String(value || '').toLowerCase()
  return ANSWER_MODES.find(item => item.value === normalized)?.label || value || '单题模式'
}

export function getQuestionKnowledgePoint(question) {
  const kp = question?.knowledge_point || question?.knowledgePoint
  if (kp) return kp
  if (question?.knowledge_point_name || question?.knowledge_point_id) {
    return {
      knowledge_point_id: question.knowledge_point_id,
      knowledge_point_name: question.knowledge_point_name,
    }
  }
  const list = question?.knowledge_points || question?.knowledgePoints || []
  return list[0] || null
}

export function normalizeOptions(question) {
  return (question?.options || []).map((option, index) => ({
    option_id: option.option_id ?? option.id ?? index,
    option_label: option.option_label || option.option_key || option.key || String.fromCharCode(65 + index),
    option_content: option.option_content || option.content || option.text || '',
  }))
}

export function extractAnswerValue(value) {
  if (value == null) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return extractAnswerValue(JSON.parse(trimmed)) } catch { return value }
    }
    return value
  }
  if (Array.isArray(value)) return value.map(item => extractAnswerValue(item)).flat()
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'answer')) return extractAnswerValue(value.answer)
    if (Object.prototype.hasOwnProperty.call(value, 'answers')) return extractAnswerValue(value.answers)
    if (Object.prototype.hasOwnProperty.call(value, 'value')) return extractAnswerValue(value.value)
    if (Object.prototype.hasOwnProperty.call(value, 'correct')) return extractAnswerValue(value.correct)
    return Object.values(value).map(item => extractAnswerValue(item)).flat()
  }
  return String(value)
}

export function answerValues(value) {
  const extracted = extractAnswerValue(value)
  if (Array.isArray(extracted)) return extracted.map(item => String(item)).filter(Boolean)
  if (extracted == null || extracted === '') return []
  if (typeof extracted === 'string' && extracted.includes(',')) {
    return extracted.split(',').map(item => item.trim()).filter(Boolean)
  }
  return [String(extracted)]
}

export function formatPracticeAnswer(value) {
  const values = answerValues(value)
  if (!values.length) return '未作答'
  return values.map(item => {
    const normalized = String(item).toLowerCase()
    if (normalized === 'true') return '正确'
    if (normalized === 'false') return '错误'
    return item
  }).join('、')
}

export function isPracticeAnswered(value) {
  if (Array.isArray(value)) return value.some(item => String(item ?? '').trim() !== '')
  if (value == null) return false
  return String(value).trim() !== ''
}

export function getBlankCount(question) {
  const explicit = Number(question?.blank_count || question?.blankCount)
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, 8)
  const content = String(question?.question_content || question?.content || '')
  const matches = content.match(/_{3,}|\(\s*\)|（\s*）|\[\s*\]/g)
  return Math.max(1, Math.min(matches?.length || 1, 8))
}

export function buildQuestionTypeCheckboxes(selectedTypes = [], maxSelectable = PRACTICE_QUESTION_TYPES.length) {
  const max = Math.max(1, Math.min(PRACTICE_QUESTION_TYPES.length, Number(maxSelectable) || PRACTICE_QUESTION_TYPES.length))
  const selected = new Set(selectedTypes.map(normalizeQuestionType).slice(0, max))
  const limitReached = selected.size >= max
  return PRACTICE_QUESTION_TYPES.map(type => `
    <label class="practice-check-tile${selected.has(type.value) ? ' active' : ''}${!selected.has(type.value) && limitReached ? ' disabled' : ''}">
      <input type="checkbox" name="practice-question-type" value="${type.value}" ${selected.has(type.value) ? 'checked' : ''} ${!selected.has(type.value) && limitReached ? 'disabled' : ''}>
      <span>${type.code}</span>
      <small>${type.label}</small>
    </label>
  `).join('')
}

export function buildDifficultyOptions(selectedDifficulty = 'medium') {
  return PRACTICE_DIFFICULTIES.map(item => `
    <option value="${item.value}" ${item.value === selectedDifficulty ? 'selected' : ''}>${item.label}</option>
  `).join('')
}

export function buildModeCards(selectedMode = 'random') {
  return PRACTICE_MODES.map(item => `
    <button type="button" class="practice-mode-card${item.value === selectedMode ? ' active' : ''}" data-mode="${item.value}">
      <b>${escapeHtml(item.label)}</b>
      <span>${escapeHtml(item.desc)}</span>
    </button>
  `).join('')
}

function isSelectedAnswer(value, optionValue, type) {
  const values = answerValues(value)
  if (normalizeQuestionType(type) === 'multiple_choice') return values.includes(String(optionValue))
  return values[0] === String(optionValue)
}

function optionResultClass(optionLabel, value, correctAnswer, type, submitted) {
  if (!submitted) return isSelectedAnswer(value, optionLabel, type) ? ' selected' : ''
  const selected = isSelectedAnswer(value, optionLabel, type)
  const correct = answerValues(correctAnswer).includes(String(optionLabel))
  if (correct && selected) return ' selected correct-choice'
  if (correct) return ' correct-choice'
  if (selected) return ' selected wrong-choice'
  return ''
}

export function buildAnswerControl(question, value, result = null, submitted = false) {
  const type = normalizeQuestionType(question?.question_type)
  const correctAnswer = result?.correct_answer
  const disabled = submitted ? 'disabled' : ''

  if (type === 'single_choice' || type === 'multiple_choice') {
    const inputType = type === 'multiple_choice' ? 'checkbox' : 'radio'
    const options = normalizeOptions(question)
    return `<div class="choice-list">
      ${options.map((option) => `
        <label class="choice-option${optionResultClass(option.option_label, value, correctAnswer, type, submitted)}${submitted ? ' answer-locked' : ''}" data-choice="${escapeHtml(option.option_label)}">
          <span class="choice-badge">${escapeHtml(option.option_label)}</span>
          <span>${escapeHtml(option.option_content)}</span>
          <input type="${inputType}" name="practice-question-${question.question_id}" value="${escapeHtml(option.option_label)}" ${isSelectedAnswer(value, option.option_label, type) ? 'checked' : ''} ${disabled} hidden>
        </label>
      `).join('')}
    </div>`
  }

  if (type === 'true_false') {
    return `<div class="tf-row">
      ${[
        { value: '正确', badge: 'T' },
        { value: '错误', badge: 'F' },
      ].map(option => `
        <label class="choice-option${optionResultClass(option.value, value, correctAnswer, type, submitted)}${submitted ? ' answer-locked' : ''}" data-choice="${option.value}">
          <span class="choice-badge">${option.badge}</span>
          <span>${option.value}</span>
          <input type="radio" name="practice-question-${question.question_id}" value="${option.value}" ${isSelectedAnswer(value, option.value, type) ? 'checked' : ''} ${disabled} hidden>
        </label>
      `).join('')}
    </div>`
  }

  if (type === 'fill_blank') {
    const count = Math.max(getBlankCount(question), Array.isArray(value) ? value.length : 1)
    const values = Array.isArray(value) ? value : (value ? [value] : [])
    return `<div class="blank-answer-grid">
      ${Array.from({ length: count }).map((_, index) => `
        <label>
          <span>空 ${index + 1}</span>
          <input class="complex-input blank-answer-input" data-blank-index="${index}" value="${escapeHtml(values[index] || '')}" placeholder="请输入答案" ${disabled}>
        </label>
      `).join('')}
    </div>`
  }

  if (type === 'short_answer') {
    const text = Array.isArray(value) ? value.join('\n') : String(value || '')
    return `
      <textarea class="complex-textarea answer-input" rows="8" placeholder="请输入你的作答" ${disabled}>${escapeHtml(text)}</textarea>
      <div class="short-count">${text.length} 字</div>`
  }

  return `<textarea class="complex-textarea answer-input" rows="5" placeholder="请输入答案" ${disabled}>${escapeHtml(Array.isArray(value) ? value.join('；') : value || '')}</textarea>`
}

export function buildQuestionNav(questions, state) {
  const resultsById = state.resultsById || {}
  return questions.map((question, index) => {
    const result = resultsById[question.question_id]
    const answered = isPracticeAnswered(state.answers[question.question_id])
    const statusClass = state.submitted
      ? (result?.is_correct === true ? ' correct' : (result?.is_correct === false ? ' wrong' : ' partial'))
      : ''
    return `<button class="question-number${answered ? ' answered' : ''}${index === state.currentIndex ? ' current' : ''}${statusClass}" data-index="${index}" type="button">${index + 1}</button>`
  }).join('')
}

export function buildAiChatPanel(messages = [], disabled = false) {
  return `
    <div class="practice-ai-panel${disabled ? ' disabled' : ''}">
      <div class="practice-chat-list" id="practice-ai-chat-list">
        ${messages.length ? messages.map(message => `
          <div class="message-row ${message.role === 'user' ? 'user' : 'assistant'}">
            <div class="message-bubble ai-message-bubble">
              <div class="message-meta">${message.role === 'user' ? '我' : 'AI 助手'}</div>
              <div class="message-markdown">${message.html || escapeHtml(message.content || '')}</div>
            </div>
          </div>
        `).join('') : '<div class="practice-chat-empty">提交后可围绕本题继续追问。</div>'}
      </div>
      <div class="practice-ai-input-row">
        <textarea class="complex-textarea" id="practice-ai-input" rows="3" placeholder="输入你的追问" ${disabled ? 'disabled' : ''}></textarea>
        <button class="complex-btn" id="btn-practice-ai-send" type="button" ${disabled ? 'disabled' : ''}>发送</button>
      </div>
    </div>`
}

export function practiceSessionStorageKey(sessionId) {
  return `discimind_practice_session_${sessionId}`
}

export function savePracticeSessionSnapshot(sessionId, payload) {
  if (!sessionId) return
  sessionStorage.setItem(practiceSessionStorageKey(sessionId), JSON.stringify(payload))
}

export function loadPracticeSessionSnapshot(sessionId) {
  if (!sessionId) return null
  try {
    const raw = sessionStorage.getItem(practiceSessionStorageKey(sessionId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// ========================
// 新版构建器：题型胶囊按钮
// ========================
export function buildQuestionTypeCapsules(selectedTypes = [], maxSelectable = PRACTICE_QUESTION_TYPES.length) {
  const max = Math.max(1, Math.min(PRACTICE_QUESTION_TYPES.length, Number(maxSelectable) || PRACTICE_QUESTION_TYPES.length))
  const selected = new Set((selectedTypes || []).map(normalizeQuestionType).slice(0, max))
  const limitReached = selected.size >= max
  return PRACTICE_QUESTION_TYPES.map(type => {
    const active = selected.has(type.value)
    const disabled = !active && limitReached
    return `
    <button type="button" class="type-capsule${active ? ' active' : ''}${disabled ? ' disabled' : ''}"
      data-type="${type.value}"
      ${disabled ? 'disabled' : ''}>
      <span class="type-capsule-icon">${type.code.slice(0, 2)}</span>
      <span>${type.label}</span>
    </button>`
  }).join('')
}

// ========================
// 新版构建器：难度卡片
// ========================
export function buildDifficultyCards(selectedDifficulty = 'medium') {
  return PRACTICE_DIFFICULTIES.map(item => `
    <button type="button" class="diff-card${item.value === selectedDifficulty ? ' active' : ''}" data-difficulty="${item.value}">
      <b>${item.label}</b>
      <small>${item.desc}</small>
    </button>
  `).join('')
}

// ========================
// 新版构建器：题号导航（按题型分组）
// ========================
export function buildQuestionNavGrouped(questions, state) {
  const resultsById = state.resultsById || {}
  // 按题型分组
  const groups = []
  const seen = new Set()
  questions.forEach((question, index) => {
    const type = normalizeQuestionType(question.question_type)
    if (!seen.has(type)) {
      seen.add(type)
      groups.push({ type, label: practiceQuestionTypeLabel(question.question_type), questions: [] })
    }
    const group = groups.find(g => g.type === type)
    group.questions.push({ question, index })
  })

  let html = ''
  groups.forEach(group => {
    html += `<div class="question-nav-group">
      <div class="question-nav-group-title">${questionTypeTagHtml(group.type)}</div>
      <div class="question-nav-group-numbers">`
    group.questions.forEach(({ question, index }) => {
      const result = resultsById[question.question_id]
      const answered = isPracticeAnswered(state.answers[question.question_id])
      let cls = 'question-number'
      // 优先使用个体结果（支持单题模式），其次使用整体提交状态
      if (result) {
        if (result.is_correct === true) cls += ' correct'
        else if (result.is_correct === false) cls += ' wrong'
        else cls += ' partial'
      } else if (state.submitted) {
        cls += ' partial'
      } else if (answered) {
        cls += ' answered'
      }
      if (index === state.currentIndex) cls += ' current'
      html += `<button class="${cls}" data-index="${index}" type="button">${index + 1}</button>`
    })
    html += `</div></div>`
  })
  return html
}

// ========================
// 作答模式选择器
// ========================
export function buildAnswerModeSelector(selectedMode = 'single', disabled = false) {
  return ANSWER_MODES.map(item => `
    <button type="button" class="mode-option${item.value === selectedMode ? ' active' : ''}${disabled && item.value === 'single' ? ' disabled' : ''}"
      data-answer-mode="${item.value}"
      ${disabled && item.value === 'single' ? 'disabled' : ''}>
      <b>${item.label}</b>
      <small>${item.desc}</small>
    </button>
  `).join('')
}

// ========================
// 练习/考试模式选择器
// ========================
export function buildSessionModeSelector(selectedMode = 'practice') {
  return PRACTICE_SESSION_MODES.map(item => `
    <button type="button" class="mode-option${item.value === selectedMode ? ' active' : ''}" data-session-mode="${item.value}">
      <b>${item.label}</b>
      <small>${item.desc}</small>
    </button>
  `).join('')
}

// ========================
// 模式说明文案
// ========================
export function getModeDescription(sessionMode, answerMode) {
  if (sessionMode === 'exam') {
    return '当前为<b>考试模式</b>。作答过程中不会显示 AI 提问和解析入口，提交后才能查看成绩、答案和解析。'
  }
  if (answerMode === 'single') {
    return '当前为<b>逐题练习</b>。每完成一题后，可以立即查看结果、解析，并向 AI 追问本题。'
  }
  return '当前为<b>整卷练习</b>。完成全部题目后统一提交，提交后可以查看解析并使用 AI 提问。'
}

// ========================
// 固定题目数量选项
// ========================
export const QUESTION_COUNT_OPTIONS = [5, 10, 15, 20]

export function buildQuestionCountSelector(currentCount = 10, customCount = '') {
  const count = Number(currentCount)
  let html = '<div class="count-selector-row">'
  QUESTION_COUNT_OPTIONS.forEach(n => {
    html += `<button type="button" class="count-chip${count === n && !customCount ? ' active' : ''}" data-count="${n}">${n} 题</button>`
  })
  html += `<label class="count-custom-label">自定义
    <input class="complex-input count-custom-input" id="practice-count-custom" type="number" min="1" max="50" step="1" value="${escapeHtml(customCount || '')}" placeholder="1-50">
  </label>`
  html += '</div>'
  return html
}
