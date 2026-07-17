import { getMe } from '../api/auth.js'
import {
  createAiChatConversation,
  getAiChatConversations,
  getAiChatStarterQuestions,
  getAiChatMessages,
  streamAiChatMessage,
  createSubjectChatRun,
  getSubjectChatRun,
  getLatestSubjectChatRun,
  streamSubjectChatRun,
  cancelSubjectChatRun,
  retrySubjectChatTask,
  clearAiChatMessages,
  deleteAiChatConversation,
  renameAiChatConversation,
  bulkManageAiChatConversations,
  uploadAiChatAttachment,
  getStudentCourses,
} from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatRelativeTime, truncate } from '../utils/format.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js'
import { showToast } from '../utils/toast.js'
import { disposeAllCharts } from '../utils/echarts.js'
import { listAvailableChatAgents, listCallableAgents, listAccessibleKnowledgeBases, downloadGeneratedArtifactExport } from '../api/marketplace.js'
import { createUnifiedComposer } from '../components/unified-composer.js'
import { streamTasks } from '../api/tasks.js'
import { getAiAssistantCapabilities, getAiConversationPendingAction, actOnAiPendingAction } from '../api/ai-assistant.js'
import { createSearchControls, DEFAULT_SEARCH_OPTIONS } from '../components/ai-assistant/search-controls.js'
import { renderCitedMarkdown, bindCitationClicks } from '../components/ai-assistant/citation-renderer.js'
import { renderSourceCards, focusSource } from '../components/ai-assistant/source-panel.js'
import { createExecutionTrace } from '../components/ai-assistant/execution-trace.js'
import { renderArtifacts, bindArtifactActions } from '../components/ai-assistant/artifact-renderer.js'
import { renderPendingActionCard, bindPendingActionCard } from '../components/ai-assistant/pending-action-card.js'

const MAX_INPUT_LENGTH = 2000
const MAX_IMAGE_COUNT = 4
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const AI_GENERAL_OPEN_FLAG = 'discimind.openGeneralAiChat'
const AI_HISTORY_COLLAPSED_KEY = 'discimind:ai-chat:history-collapsed'
let cachedAiPathLength = null

function formatFileSize(value) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const MODES = [
  { value: 'general', label: '通用学习助手', shortLabel: '通用学习', icon: 'sparkles', desc: '课程概念、复习、代码学习、论文入门' },
  { value: 'subject', label: '学科专属助手', shortLabel: '学科专属', icon: 'book', desc: '围绕指定课程展开答疑' },
  { value: 'agent', label: 'Agent 专属助手', shortLabel: 'Agent 任务', icon: 'workflow', desc: '按任务目标输出结构化结果' },
]

const ICON_PATHS = {
  sparkles: '<path d="m12 3 .9 2.5L15.5 6.5l-2.6 1L12 10l-.9-2.5-2.6-1 2.6-1L12 3Z"/><path d="m6 12 .7 1.8 1.8.7-1.8.7L6 17l-.7-1.8-1.8-.7 1.8-.7L6 12Z"/><path d="M15.5 13.5 17 17l3.5 1.5L17 20l-1.5 3.5L14 20l-3.5-1.5L14 17l1.5-3.5Z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"/>',
  workflow: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h3a3 3 0 0 1 3 3v6M12 18H9a3 3 0 0 1-3-3V9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9A7 7 0 0 1 18 6l2 6M18 15a7 7 0 0 1-11.9 3L4 12"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/>',
  send: '<path d="m4 4 17 8-17 8 3-8-3-8Z"/><path d="M7 12h14"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
}

function iconSvg(name, className = '') {
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`
}

function createAiLoadingIndicator(text, { subtle = false, announce = true } = {}) {
  return `<span class="ai-loading-breadcrumb${subtle ? ' is-subtle' : ''}" role="status" aria-live="${announce ? 'polite' : 'off'}" aria-atomic="true">
    <svg class="ai-path-loader" viewBox="0 0 24 18" aria-hidden="true" fill="none"><path d="M2 12.5C5.2 4.5 8.2 4.5 10.4 10.3c2 5.3 5.2 5 7.1-.2C18.6 7.1 20 6 22 6.2"/></svg>
    <span class="ai-loading-shimmer">${escapeHtml(text || '正在理解问题')}</span>
  </span>`
}

function initializeAiPathLoaders(root = document) {
  const paths = Array.from(root.querySelectorAll?.('.ai-path-loader path') || [])
  if (!paths.length) return
  if (!cachedAiPathLength) cachedAiPathLength = Math.ceil(paths[0].getTotalLength()) || 48
  paths.forEach(path => {
    path.style.setProperty('--ai-path-length', String(cachedAiPathLength))
    path.style.setProperty('--ai-path-length-negative', String(-cachedAiPathLength))
  })
}

const SUBJECTS = [
  { value: 'machine_learning', label: '机器学习' },
  { value: 'operating_system', label: '操作系统' },
  { value: 'web_frontend', label: 'Web 前端' },
  { value: 'probability', label: '概率论' },
  { value: 'database', label: '数据库' },
  { value: 'computer_network', label: '计算机网络' },
  { value: 'software_engineering', label: '软件工程' },
]

const AGENTS = []

const STARTER_FALLBACKS = {
  general: [
    '帮我整理今天的复习提纲',
    '用例子解释这个概念',
    '这类题有哪些易错点？',
    '帮我制定一周学习计划',
  ],
  subjects: {
    machine_learning: [
      '过拟合和欠拟合怎么区分？',
      'PCA 降维步骤是什么？',
      '如何选择模型评估指标？',
      '决策树剪枝有什么作用？',
    ],
    operating_system: [
      '进程和线程有什么区别？',
      '银行家算法怎么判断安全？',
      '页面置换算法怎么区分？',
      '死锁四个条件是什么？',
    ],
    web_frontend: [
      '事件冒泡和捕获怎么区分？',
      'Flex 布局属性怎么记？',
      '为什么 JS 会输出 undefined？',
      '响应式布局断点怎么设？',
    ],
    probability: [
      '贝叶斯公式怎么理解？',
      '常见分布适合哪些场景？',
      '中心极限定理怎么理解？',
      '期望和方差题怎么做？',
    ],
    database: [
      '三大范式分别解决什么？',
      '事务 ACID 怎么理解？',
      '索引为什么能加速查询？',
      '多表连接题怎么分析？',
    ],
    computer_network: [
      'TCP 三次握手做了什么？',
      'HTTP 和 HTTPS 有何区别？',
      '拥塞控制和流控怎么区分？',
      'DNS 查询过程是什么？',
    ],
    software_engineering: [
      '需求分析要产出什么？',
      'UML 用例图怎么画？',
      '黑盒白盒测试怎么区分？',
      '敏捷开发适合什么场景？',
    ],
  },
  agents: {
    knowledge_explain: [
      '请讲清楚这个知识点',
      '这个概念通常怎么考？',
      '总结一下常见易错点',
      '用类比方式解释难点',
    ],
    wrong_question_analysis: [
      '帮我分析这道错题考点',
      '正确解题思路是什么？',
      '我错在了哪一步？',
      '给我一道同类巩固题',
    ],
    study_path_planning: [
      '规划两周入门学习路线',
      '需要哪些前置知识？',
      '每天应该完成什么任务？',
      '如何检查阶段掌握度？',
    ],
    review_plan: [
      '制定一周期末复习计划',
      '哪些内容应优先复习？',
      '错题和知识点如何复盘？',
      '每天如何自测更有效？',
    ],
    coding_learning: [
      '解释这段代码执行过程',
      '这道编程题思路是什么？',
      '代码报错原因有哪些？',
      '如何优化代码复杂度？',
    ],
  },
}

async function getAuthedUser() {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getToken(), user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return null
    }
  }
  return user
}

function modeLabel(mode) {
  return MODES.find(item => item.value === mode)?.label || '通用学习助手'
}

function subjectLabel(subject) {
  return SUBJECTS.find(item => item.value === subject)?.label || '未选择学科'
}

function selectedCourseLabel(state) {
  const course = state.courses.find(item => Number(item.course_id || item.id) === Number(state.courseId))
  return course?.course_name || course?.name || (state.courses.length ? '请选择课程' : '暂无可用课程')
}

function inferSubjectFromCourse(course, fallback = 'machine_learning') {
  if (!course) return fallback
  const code = String(course.course_code || course.code || '').trim().toLowerCase()
  if (SUBJECTS.some(item => item.value === code)) return code
  const name = String(course.course_name || course.name || '').toLowerCase()
  if (/机器学习|machine\s*learning/.test(name)) return 'machine_learning'
  if (/计算机视觉|computer\s*vision/.test(name)) return 'computer_vision'
  if (/自然语言|nlp|natural\s*language/.test(name)) return 'nlp'
  if (/数据科学|data\s*science/.test(name)) return 'data_science'
  return fallback
}

function agentLabel(agentType) {
  return AGENTS.find(item => String(item.value) === String(agentType))?.label || '历史 Agent 对话'
}

function starterContextKey(context) {
  const mode = context?.mode || 'general'
  if (mode === 'subject') return `subject:${context.subject || 'machine_learning'}`
  if (mode === 'agent') return `agent:${context.agentType || context.agent_type || AGENTS[0]?.value || 'unavailable'}`
  return 'general'
}

function fallbackStarterQuestions(context) {
  const mode = context?.mode || 'general'
  if (mode === 'subject') {
    return STARTER_FALLBACKS.subjects[context.subject] || STARTER_FALLBACKS.general
  }
  if (mode === 'agent') {
    return STARTER_FALLBACKS.agents[context.agentType || context.agent_type] || STARTER_FALLBACKS.general
  }
  return STARTER_FALLBACKS.general
}

function normalizeStarterQuestions(questions, context) {
  const merged = [
    ...(Array.isArray(questions) ? questions : []),
    ...fallbackStarterQuestions(context),
  ]
  const seen = new Set()
  return merged
    .map(item => String(item || '').trim())
    .filter(item => item.length >= 4 && item.length <= 80)
    .filter(item => {
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 4)
}

function consumeGeneralAiOpenFlag() {
  try {
    if (sessionStorage.getItem(AI_GENERAL_OPEN_FLAG) !== '1') return false
    sessionStorage.removeItem(AI_GENERAL_OPEN_FLAG)
    return true
  } catch {
    return false
  }
}

function conversationModeLabel(conversation) {
  const mode = conversation?.mode || 'general'
  if (mode === 'subject') return subjectLabel(conversation.subject)
  if (mode === 'agent') return agentLabel(conversation.agent_type || conversation.agentType)
  return modeLabel(mode)
}

function normalizeConversation(conversation) {
  if (!conversation) return null
  return {
    ...conversation,
    id: conversation.id || conversation.conversation_id,
    agent_type: conversation.agent_type || conversation.agentType || '',
  }
}

function renderModePanel(state) {
  const courseOptions = state.courses.map(course => {
    const id = Number(course.course_id || course.id)
    const name = course.course_name || course.name || `课程 ${id}`
    return `<option value="${id}" ${id === Number(state.courseId) ? 'selected' : ''}>${escapeHtml(name)}</option>`
  }).join('')
  return `
    <div class="ai-mode-panel" aria-label="助手与学科设置">
      <div class="ai-mode-cards" role="tablist" aria-label="助手模式">
        ${MODES.map(mode => `
          <button class="ai-mode-card${state.mode === mode.value ? ' active' : ''}" data-mode="${mode.value}" role="tab" aria-selected="${state.mode === mode.value}" aria-label="${escapeHtml(`${mode.label}：${mode.desc}`)}" title="${escapeHtml(mode.desc)}" ${state.generating ? 'disabled' : ''}>
            ${iconSvg(mode.icon)}<span>${escapeHtml(mode.shortLabel)}</span>
          </button>
        `).join('')}
      </div>
      <div class="ai-mode-selectors">
        <label class="${state.mode === 'subject' ? '' : 'is-hidden'}">
          <span class="ai-visually-hidden">课程选择</span>
          <select class="complex-select" id="ai-course-select" ${state.generating || !state.courses.length ? 'disabled' : ''}>
            <option value="">${state.courses.length ? '选择课程' : '暂无可用课程'}</option>${courseOptions}
          </select>
        </label>
        <label class="${state.mode === 'agent' ? '' : 'is-hidden'}">
          <span class="ai-visually-hidden">Agent 选择</span>
          <select class="complex-select" id="ai-agent-select" ${state.generating ? 'disabled' : ''}>
            ${AGENTS.map(item => `<option value="${item.value}" ${state.agentType === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
      </div>
    </div>
  `
}

function filteredConversations(state) {
  const keyword = (state.keyword || '').trim().toLowerCase()
  return state.conversations.filter(raw => {
    const item = normalizeConversation(raw)
    if (keyword && !`${item.title || ''} ${item.last_message?.content_preview || ''}`.toLowerCase().includes(keyword)) return false
    if (state.historyMode && item.mode !== state.historyMode) return false
    if (state.historySubject && item.subject !== state.historySubject) return false
    const dateValue = String(item.updated_at || item.created_at || '').slice(0, 10)
    return !state.historyDate || dateValue === state.historyDate
  })
}

function buildConversationList(state) {
  if (state.loadingConversations) {
    return `<div class="complex-loading ai-compact-state"><div class="complex-spinner"></div><p>正在加载会话...</p></div>`
  }
  if (state.conversationError) {
    return `<div class="complex-error ai-compact-state"><h3>会话加载失败</h3><p>${escapeHtml(state.conversationError)}</p><button class="complex-btn-secondary" id="btn-retry-conversations">重试</button></div>`
  }

  const list = filteredConversations(state)

  if (!list.length) {
    return `<div class="complex-empty ai-compact-state"><h3>暂无会话</h3><p>点击新建对话开始。</p></div>`
  }

  return `<div class="conversation-list ai-conversation-list">
    ${list.map(raw => {
      const conversation = normalizeConversation(raw)
      return `<div class="conversation-item${state.currentId === conversation.id ? ' active' : ''}" data-id="${conversation.id}" tabindex="0" role="button" aria-current="${state.currentId === conversation.id ? 'true' : 'false'}">
        ${state.historyMulti ? `<input type="checkbox" data-ai-history-select="${conversation.id}" ${state.historySelected.has(conversation.id) ? 'checked' : ''} aria-label="选择会话">` : ''}
        <div class="conversation-title-row">
          <b>${escapeHtml(conversation.title || '新对话')}</b>
          ${state.historyMulti ? '' : `<button class="btn-rename-conv" data-rename-id="${conversation.id}" title="重命名会话">重命名</button><button class="btn-delete-conv" data-delete-id="${conversation.id}" title="删除会话" aria-label="删除会话">${iconSvg('trash')}</button>`}
        </div>
        <p class="conversation-preview">${escapeHtml(truncate(conversation.last_message?.content_preview || '还没有消息', 42))}</p>
        <div class="conversation-meta"><span>${escapeHtml(conversationModeLabel(conversation))}</span><time>${formatRelativeTime(conversation.updated_at || conversation.created_at)}</time></div>
      </div>`
    }).join('')}
  </div>`
}

function buildStarterQuestionRow(state) {
  const questions = normalizeStarterQuestions(state.starterQuestions, state)
  return `<div class="starter-question-row${state.loadingStarterQuestions ? ' loading' : ''}" id="starter-question-row">
    ${questions.map(question => `<button class="quick-question" data-question="${escapeHtml(question)}" ${state.generating ? 'disabled' : ''}>${escapeHtml(question)}</button>`).join('')}
  </div>`
}

function buildMessageContexts(message) {
  const knowledge = Array.isArray(message.knowledgeBaseRefs) ? message.knowledgeBaseRefs : []
  const agents = Array.isArray(message.agentRefs) ? message.agentRefs : []
  if (!knowledge.length && !agents.length) return ''
  return `<div class="ai-message-contexts">${knowledge.map(item => `<span>@ ${escapeHtml(item.name || `知识库 ${item.knowledgeBaseId}`)}</span>`).join('')}${agents.map(item => `<span>\\ ${escapeHtml(item.name || `智能体 ${item.agentId}`)}</span>`).join('')}</div>`
}

function numberMessageSources(sources = []) {
  const used = new Set(sources.map(source => Number(source.index ?? source.metadata?.sourceIndex)).filter(Number.isInteger))
  let next = 1
  return sources.map(source => {
    const explicit = Number(source.index ?? source.metadata?.sourceIndex)
    if (Number.isInteger(explicit) && explicit > 0) return { ...source, index: explicit }
    while (used.has(next)) next += 1
    const index = next; used.add(index); next += 1
    return { ...source, index }
  })
}

function buildMessageSources(message) {
  const sources = Array.isArray(message.sources) ? message.sources : []
  if (!sources.length) return ''
  const normalized = numberMessageSources(sources).map(source => ({
    ...source,
    title: source.title || source.documentTitle || source.documentName,
    url: source.url || source.externalUrl,
    siteName: source.siteName || source.knowledgeBaseName || source.metadata?.knowledgeBaseName,
  }))
  return `<details class="ai-message-sources"><summary>查看 ${sources.length} 条真实资料来源</summary><div class="ai-message-source-cards">${renderSourceCards(normalized)}</div></details>`
}

function buildAgentInvocations(message) {
  const invocations = Array.isArray(message.agentInvocations) ? message.agentInvocations : []
  if (!invocations.length) return ''
  const statusLabel = { PENDING: '等待执行', RUNNING: '正在执行', COMPLETED: '已完成', FAILED: '执行失败', CANCELLED: '已取消' }
  return `<div class="ai-agent-invocations">${invocations.map(item => `<article class="status-${String(item.status || '').toLowerCase()}"><header><strong>${escapeHtml(item.agentName || `智能体 ${item.agentId}`)}</strong><span>${escapeHtml(statusLabel[item.status] || item.status || '未知状态')}</span></header>${item.output ? `<div class="message-markdown">${renderMarkdownToHtml(item.output)}</div>` : ''}${item.errorMessage ? `<p class="ai-invocation-error">${escapeHtml(item.errorMessage)}</p>` : ''}${(item.artifacts || []).map(artifact => `<section class="ai-artifact-card"><div><strong>${escapeHtml(artifact.title || artifact.fileName || '生成产物')}</strong><span>${escapeHtml(artifact.fileFormat || artifact.artifactType || '文件')} · ${escapeHtml(artifact.status || '处理中')}${artifact.sizeBytes ? ` · ${formatFileSize(artifact.sizeBytes)}` : ''}</span><small>${artifact.createdAt ? new Date(artifact.createdAt).toLocaleString('zh-CN', { hour12: false }) : ''} · ${escapeHtml(item.agentName || '文件生成智能体')}</small></div><footer>${artifact.previewable ? `<a href="#/student/artifacts/${artifact.id}">预览</a>` : ''}${(artifact.downloads || []).map(file => `<button type="button" data-ai-artifact-download="${escapeHtml(file.format)}" data-artifact-id="${artifact.id}">下载 ${escapeHtml(file.format)}</button>`).join('')}<a href="#/student/agent-tasks">任务详情</a></footer></section>`).join('')}<footer>${item.durationMs ? `耗时 ${(Number(item.durationMs) / 1000).toFixed(1)} 秒` : ''}${item.taskIds?.length ? ' · <a href="#/student/agent-tasks">查看任务</a>' : ''}</footer></article>`).join('')}</div>`
}

function buildMessages(state) {
  if (state.loadingMessages) {
    return `<div class="complex-loading"><div class="complex-spinner"></div><p>正在加载消息...</p></div>`
  }
  if (state.messageError) {
    return `<div class="complex-error"><h3>消息加载失败</h3><p>${escapeHtml(state.messageError)}</p></div>`
  }
  if (!state.currentId && !state.messages.length) {
    return `<div class="complex-empty"><h3>开始新的学习对话</h3><p>选择问答模式后输入问题。</p></div>`
  }
  if (!state.messages.length) {
    return `<div class="complex-empty"><h3>当前会话暂无消息</h3><p>发送第一条学习问题后，会话标题会自动生成。</p></div>`
  }

  return state.messages.map((message, messageIndex) => {
    const role = String(message.role || '').toLowerCase()
    const isUser = role === 'user'
    const isStreaming = Boolean(message.streaming)
    const content = String(message.content || '')
    const attachments = Array.isArray(message.attachments) ? message.attachments : []
    const citedSources = numberMessageSources(message.sources || [])
    return `<div class="message-row ${isUser ? 'user' : 'assistant'}${isStreaming ? ' streaming' : ''}" data-message-id="${escapeHtml(message.id || message.message_id || '')}" data-message-index="${messageIndex}">
      <div class="message-bubble ai-message-bubble">
        ${!isUser ? `<div class="message-meta"><span>千问 3.7 Plus</span>${content && !isStreaming ? `<span class="ai-message-tools"><button type="button" data-copy-message="${escapeHtml(message.id || message.message_id || '')}">复制</button><button type="button" data-speak-message="${escapeHtml(message.id || message.message_id || '')}">朗读</button></span>` : ''}</div>` : ''}
        ${buildMessageContexts(message)}
        ${attachments.length ? `<div class="ai-message-images">${attachments.map(attachment => attachment.mimeType?.startsWith('image/') ? `<button type="button" class="ai-message-image" data-open-image="${escapeHtml(attachment.displayUrl || attachment.dataUrl || attachment.url || '')}" title="查看 ${escapeHtml(attachment.name || '图片')}"><img src="${escapeHtml(attachment.displayUrl || attachment.dataUrl || attachment.url || '')}" alt="${escapeHtml(attachment.name || '对话图片')}"></button>` : `<button type="button" class="ai-message-file" data-open-image="${escapeHtml(attachment.displayUrl || attachment.url || '')}" title="打开附件">文件 · ${escapeHtml(attachment.name || '附件')}</button>`).join('')}</div>` : ''}
        <div class="message-markdown">${content ? (isUser ? renderMarkdownToHtml(content) : renderCitedMarkdown(content, citedSources)) : (isStreaming
          ? (state.mode === 'subject' && state.currentRun
              ? '<p class="thinking-text">回答将随任务进度生成</p>'
              : createAiLoadingIndicator(state.loadingStageText || '正在理解问题'))
          : '<p></p>')}</div>
        ${buildAgentInvocations(message)}
        ${buildMessageSources(message)}
        ${!isUser ? `<div class="student-ai-message-extras"><div data-student-ai-trace="${messageIndex}"></div>${renderArtifacts(message.artifacts || [])}${renderPendingActionCard(message.pendingAction || (messageIndex === state.messages.findLastIndex(item => String(item.role || '').toLowerCase() !== 'user') ? state.pendingAction : null))}</div>` : ''}
      </div>
    </div>`
  }).join('')
}

function readHistoryCollapsed(user) {
  try {
    const key = `${AI_HISTORY_COLLAPSED_KEY}:${user?.user_id || user?.id || 'current'}`
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function loadingTextFromStage(stage, fallback = '正在理解问题') {
  const text = String(stage || '').trim()
  if (!text) return fallback
  if (/画像|学情|薄弱/.test(text)) return '正在分析学生画像'
  if (/知识库|检索|搜索|召回/.test(text)) return '正在检索课程知识库'
  if (/来源|引用|证据/.test(text)) return '正在整理参考来源'
  if (/质量|检查|校验|复核/.test(text)) return '正在检查答案质量'
  if (/结构|组织|提纲/.test(text)) return '正在组织回答结构'
  if (/调用|Agent|模型/.test(text)) return '正在组织回答结构'
  if (/生成|讲解|作答|回答/.test(text)) return '正在生成讲解'
  if (/上下文|课程|学习记录/.test(text)) return '正在读取学习上下文'
  if (/知识点|意图|识别/.test(text)) return '正在识别课程与知识点'
  if (/理解|分析|解析/.test(text)) return '正在理解问题'
  return text.startsWith('正在') ? text : `正在${text}`
}

function loadingTextFromRunEvent(eventName, detail = {}, run = null) {
  const stage = detail.task?.title || detail.task?.description || detail.run?.currentTask || run?.currentTask
  if (stage) return loadingTextFromStage(stage)
  if (eventName === 'tool_started') return '正在检索课程知识库'
  if (eventName === 'source_found') return '正在整理参考来源'
  if (eventName === 'answer_delta') return '正在生成讲解'
  if (eventName === 'task_started' || eventName === 'task_progress') return '正在识别课程与知识点'
  return '正在理解问题'
}

const RUN_STATUS_LABELS = {
  queued: '等待执行', planning: '正在规划', running: '执行中', waiting_tool: '等待工具', waiting_agent: '等待 Agent',
  generating: '生成回答', finalizing: '整理结果', completed: '已完成', failed: '失败', cancelled: '已取消', stalled: '等待超时',
}
const TASK_STATUS_LABELS = {
  pending: '待办', running: '执行中', completed: '完成', failed: '失败', skipped: '已跳过', cancelled: '已取消', retrying: '重试中',
}

const ACTIVE_RUN_STATUSES = new Set(['queued', 'planning', 'running', 'waiting_tool', 'waiting_agent', 'generating', 'finalizing'])
const TERMINAL_RUN_EVENTS = new Set(['run_completed', 'run_failed', 'run_cancelled', 'run_stalled'])

function normalizeRunStatus(status) {
  const value = String(status || 'queued').toLowerCase()
  return ({ pending: 'queued', success: 'completed' })[value] || value
}

function normalizeTaskStatus(status) {
  const value = String(status || 'pending').toLowerCase()
  return value === 'success' ? 'completed' : value
}

function runStatusIcon(status) {
  if (status === 'completed') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'
  if (status === 'failed' || status === 'stalled') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01"/><circle cx="12" cy="12" r="9"/></svg>'
  if (ACTIVE_RUN_STATUSES.has(status) || status === 'running' || status === 'retrying') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v6h-6"/></svg>'
  if (status === 'cancelled' || status === 'skipped') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/><circle cx="12" cy="12" r="9"/></svg>'
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
}

function formatRunDuration(run, serverTimeOffsetMs = 0) {
  if (!run?.startedAt) return '0 秒'
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now() - serverTimeOffsetMs
  const seconds = Math.max(0, Math.floor((end - new Date(run.startedAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function sourceTypeLabel(type) {
  return ({ COURSE_KNOWLEDGE: '课程知识库', STUDENT_PROFILE: '学生画像', WRONG_QUESTION: '历史错题', EXTERNAL_WEB: '外部网页', WEB_SEARCH: '联网网页' })[type] || '学习资料'
}

function buildRunWorkbench(state) {
  const run = state.currentRun
  if (!run) {
    if (state.generating) {
      return `<section class="subject-run-panel" id="subject-run-host" data-run-status="running">
        <div class="subject-run-statusbar">
          <div class="subject-run-status-main">${createAiLoadingIndicator(state.loadingStageText || '正在理解问题')}</div>
          <div class="subject-run-metrics"><span><b>动态规划中</b></span></div>
        </div>
        <div class="subject-run-progress"><i style="width:0%"></i></div>
      </section>`
    }
    return `<section class="subject-run-empty" id="subject-run-host">
      <span class="subject-run-empty-icon">${runStatusIcon('pending')}</span>
      <div><strong>智能任务就绪</strong><p>发送问题后将显示真实执行进度与引用来源。</p></div>
    </section>`
  }
  const tasks = state.runTasks || []
  const visibleTasks = tasks.filter(task => normalizeTaskStatus(task.status) !== 'skipped')
  const skippedTasks = tasks.filter(task => normalizeTaskStatus(task.status) === 'skipped')
  const sources = state.runSources || []
  const validationEvent = [...(state.runEvents || [])].reverse().find(event => event.eventType === 'tool.validation_failed' || event.payload?.protocol?.type === 'tool.validation_failed')
  const validationPayload = validationEvent?.payload?.protocol?.payload || validationEvent?.payload || null
  const validationDetails = validationPayload?.details || null
  const status = normalizeRunStatus(run.status)
  const total = visibleTasks.length || Number(run.totalTaskCount) || tasks.length
  const completed = visibleTasks.filter(task => normalizeTaskStatus(task.status) === 'completed').length
  const progress = skippedTasks.length && total ? Math.round((completed / total) * 100) : Math.max(0, Math.min(100, Number(run.progress) || 0))
  const isActive = ACTIVE_RUN_STATUSES.has(status)
  const stageText = state.loadingStageText || loadingTextFromStage(run.currentTask, status === 'queued' ? '正在理解问题' : '正在执行任务')
  const statusText = status === 'completed'
    ? '已完成全部步骤'
    : status === 'failed'
      ? (run.errorMessage || '任务执行失败')
      : status === 'cancelled'
        ? '任务已取消'
        : status === 'stalled'
          ? (run.errorMessage || '任务等待超时，可重试')
        : stageText
  return `<section class="subject-run-panel" id="subject-run-host" data-run-status="${escapeHtml(status)}">
    <div class="subject-run-statusbar">
      <div class="subject-run-status-main">
        ${isActive
          ? createAiLoadingIndicator(statusText, { subtle: Boolean(state.runAssistantContent), announce: !state.runAssistantContent })
          : `<span class="subject-run-status-icon status-${escapeHtml(status)}">${runStatusIcon(status)}</span><strong>${escapeHtml(statusText)}</strong>`}
      </div>
      <div class="subject-run-metrics">
        <span><b>${completed}/${total}</b></span>
        <span><b>${progress}%</b></span>
        <span>${formatRunDuration(run, state.serverTimeOffsetMs)}</span>
      </div>
    </div>
    <div class="subject-run-progress"><i style="width:${progress}%"></i></div>
    <details class="subject-run-details" ${state.runDetailsOpen || status === 'failed' ? 'open' : ''}>
      <summary><span>执行过程</span><small>${visibleTasks.length} 个实际步骤</small>${iconSvg('chevron', 'subject-run-chevron')}</summary>
      <div class="subject-run-timeline">
        ${visibleTasks.map(task => {
          const taskStatus = normalizeTaskStatus(task.status)
          const started = task.startedAt ? new Date(task.startedAt).getTime() : 0
          const ended = task.completedAt ? new Date(task.completedAt).getTime() : (taskStatus === 'running' || taskStatus === 'retrying' ? Date.now() - state.serverTimeOffsetMs : 0)
          const duration = started && ended ? `${Math.max(0, Math.round((ended - started) / 1000))} 秒` : ''
          return `<article class="subject-run-task task-${escapeHtml(taskStatus)}">
            <span class="subject-run-task-icon">${runStatusIcon(taskStatus)}</span>
            <div class="subject-run-task-body">
              <div class="subject-run-task-head"><strong>${escapeHtml(task.title || '')}</strong><span>${escapeHtml(TASK_STATUS_LABELS[taskStatus] || taskStatus)}${duration ? ` · ${duration}` : ''}</span></div>
              <p>${escapeHtml(task.outputSummary || task.inputSummary || task.description || '')}</p>
              ${(task.errorMessage || task.inputSummary) ? `<details><summary>查看详情</summary><div>${escapeHtml(task.errorMessage || task.inputSummary || '')}</div></details>` : ''}
              ${taskStatus === 'failed' ? `<button type="button" class="subject-run-retry" data-retry-run-task="${escapeHtml(task.taskId)}">重试此运行</button>` : ''}
            </div>
          </article>`
        }).join('')}
      </div>
      ${validationDetails ? `<details class="subject-run-technical"><summary>工具错误技术详情</summary><dl><div><dt>工具</dt><dd>${escapeHtml(validationDetails.toolName || validationPayload?.toolName || '未知')}</dd></div><div><dt>字段</dt><dd>${escapeHtml(validationDetails.argumentPath || '$')}</dd></div><div><dt>期望</dt><dd>${escapeHtml(validationDetails.expectedType || '合法参数')}</dd></div><div><dt>实际</dt><dd>${escapeHtml(`${validationDetails.receivedType || 'unknown'} · ${validationDetails.receivedValueSummary || ''}`)}</dd></div>${validationDetails.requestId ? `<div><dt>requestId</dt><dd>${escapeHtml(validationDetails.requestId)}</dd></div>` : ''}</dl>${validationPayload?.fallback === 'table_and_text' ? '<button type="button" class="subject-run-retry" data-regenerate-chart>重新生成图表</button>' : ''}</details>` : ''}
      ${skippedTasks.length ? `<details class="subject-run-technical"><summary>技术详情：${skippedTasks.length} 个未执行步骤</summary><ul>${skippedTasks.map(task => `<li>${escapeHtml(task.title)}：${escapeHtml(task.errorMessage || '前序步骤未完成')}</li>`).join('')}</ul></details>` : ''}
    </details>
    ${sources.length ? `<details class="subject-run-sources" ${state.runSourcesOpen ? 'open' : ''}>
      <summary class="subject-run-section-title"><strong>参考来源</strong><span>${sources.length} 项</span>${iconSvg('chevron', 'subject-run-chevron')}</summary>
      <div class="subject-run-source-list">
      ${sources.map((source, index) => `<details class="subject-run-source" data-run-source-id="${escapeHtml(source.sourceId || String(index))}" ${state.openRunSourceIds?.has(source.sourceId || String(index)) ? 'open' : ''}>
        <summary><b>[${index + 1}]</b><span>${escapeHtml(source.title || '未命名来源')}</span><small>${escapeHtml(sourceTypeLabel(source.sourceType))}</small></summary>
        <p>${escapeHtml(source.summary || '暂无摘要')}</p>
        ${source.metadata?.knowledgeBaseName ? `<span>知识库：${escapeHtml(source.metadata.knowledgeBaseName)}</span>` : ''}
        ${source.relevanceScore !== null && source.relevanceScore !== undefined ? `<span>相关度：${Math.round(Number(source.relevanceScore) * 100)}%</span>` : ''}
        ${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">打开来源</a>` : ''}
      </details>`).join('')}
      </div>
    </details>` : ''}
  </section>`
}

function buildShell(state) {
  const currentTitle = state.currentConversation?.title || '新对话'
  const currentMode = state.mode === 'subject'
    ? selectedCourseLabel(state)
    : state.mode === 'agent'
      ? agentLabel(state.agentType)
      : modeLabel(state.mode)
  const taskCount = state.runTasks?.length || 0

  return `
    <div class="complex-shell ai-chat-shell">
      <header class="ai-chat-topbar">
        <div class="ai-chat-brand">
          <span class="ai-chat-brand-mark">${iconSvg('sparkles')}</span>
          <div><h1>学科答疑小助手</h1><p>随问随学，循序讲清</p></div>
        </div>
        ${renderModePanel(state)}
        <div class="ai-topbar-meta">
          ${state.mode === 'subject' ? `<span title="当前任务数量">${taskCount} 个任务</span>` : ''}
          <span class="ai-model-name">千问 3.7 Plus</span>
        </div>
      </header>

      <div class="ai-chat-workbench${state.historyCollapsed ? ' history-collapsed' : ''}">
        <aside class="chat-side ai-history-panel">
          <div class="ai-history-head">
            <button class="ai-new-conversation" id="btn-new-conversation" title="新建对话" ${state.generating ? 'disabled' : ''}>${iconSvg('plus')}<span>新建对话</span></button>
            <button class="ai-history-toggle" id="btn-toggle-history" title="${state.historyCollapsed ? '展开历史会话' : '收起历史会话'}" aria-label="${state.historyCollapsed ? '展开历史会话' : '收起历史会话'}" aria-expanded="${!state.historyCollapsed}">${iconSvg('panel')}</button>
          </div>
          <label class="ai-history-search">${iconSvg('search')}<span class="ai-visually-hidden">搜索会话</span><input id="conversation-search" placeholder="搜索会话" value="${escapeHtml(state.keyword || '')}"></label>
          <div class="ai-history-filters"><select id="ai-history-mode" aria-label="按模式筛选"><option value="">全部模式</option><option value="general" ${state.historyMode === 'general' ? 'selected' : ''}>通用助手</option><option value="subject" ${state.historyMode === 'subject' ? 'selected' : ''}>学科助手</option></select><select id="ai-history-subject" aria-label="按学科筛选"><option value="">全部学科</option>${SUBJECTS.map(item => `<option value="${item.value}" ${state.historySubject === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select><input id="ai-history-date" type="date" value="${escapeHtml(state.historyDate || '')}" aria-label="按日期筛选"></div>
          <div id="conversation-list-host">${buildConversationList(state)}</div>
          <div class="ai-history-bulk">${state.historyMulti ? '<button id="btn-ai-history-all">全选结果</button><button id="btn-ai-history-clear">批量清空</button><button id="btn-ai-history-delete">批量删除</button><button id="btn-ai-history-cancel">取消</button>' : '<button id="btn-ai-history-multi">多选管理</button>'}</div>
        </aside>

        <main class="chat-main ai-chat-main">
          <div class="chat-main-head ai-chat-main-head">
            <div class="ai-chat-title-block">
              <h2 class="complex-section-title">${escapeHtml(currentTitle)}</h2>
              <span>${escapeHtml(currentMode)}</span>
              ${state.mode === 'subject' ? '<span class="ai-context-tag">课程知识库</span>' : ''}
            </div>
            <div class="complex-actions ai-chat-actions">
              <button class="ai-toolbar-button" id="btn-regenerate" title="重新生成" ${state.generating || !state.messages.some(m => String(m.role).toLowerCase() === 'user') ? 'disabled' : ''}>${iconSvg('refresh')}<span>重新生成</span></button>
              <button class="ai-toolbar-button" id="btn-rename-current" title="重命名当前会话" ${state.generating || !state.currentId ? 'disabled' : ''}><span>重命名</span></button>
              <button class="ai-toolbar-button ai-toolbar-danger" id="btn-clear-current" title="清空当前对话" ${state.generating || !state.currentId ? 'disabled' : ''}>${iconSvg('trash')}<span>清空</span></button>
            </div>
          </div>

          <div class="chat-messages ai-chat-messages" id="ai-chat-scroll-host">
            ${state.learningContext?.source === 'learning-session' ? `<div class="ai-learning-context-banner"><strong>来自当前学习会话</strong><span>课程、知识点与当前节点会作为受控上下文发送；不会自动重复提问。</span></div>` : ''}
            ${buildRunWorkbench(state)}
            <div class="ai-chat-message-list" id="ai-chat-messages-host">${buildMessages(state)}</div>
          </div>

          <div class="chat-input-area ai-chat-input-area">
            ${buildStarterQuestionRow(state)}
            <div id="subject-unified-composer"></div>
            <p class="ai-input-disclaimer">AI 内容可能存在偏差，请结合课程资料核对。</p>
          </div>
        </main>
      </div>
    </div>`
}

export async function renderStudentAiChat(app) {
  disposeAllCharts()
  const user = await getAuthedUser()
  if (!user) return
  const launchParams = new URLSearchParams(location.hash.split('?')[1] || '')
  const launchConversationId = Number(launchParams.get('conversationId')) || null
  const learningContext = {
    source: launchParams.get('source') || '', sessionId: launchParams.get('sessionId') || '',
    learningPlanId: launchParams.get('learningPlanId') || '', courseId: launchParams.get('courseId') || '',
    knowledgePointId: launchParams.get('knowledgePointId') || '', currentNodeId: launchParams.get('currentNodeId') || '',
  }
  let available = null
  for (let attempt = 0; attempt < 2 && !available; attempt += 1) {
    try { available = await listAvailableChatAgents() } catch { /* transient route/auth refresh; retry once */ }
  }
  if (available) {
    AGENTS.splice(0, AGENTS.length, ...(available.data?.list || []).map(item => ({
      value: String(item.id), label: item.version?.name || `智能体 ${item.id}`, description: item.version?.shortDescription || '',
    })))
  }
  let mentionKnowledgeBases = []
  let callableAgents = []
  let courses = []
  const [knowledgeResult, callableResult, coursesResult, capabilitiesResult] = await Promise.allSettled([listAccessibleKnowledgeBases(), listCallableAgents(), getStudentCourses(), getAiAssistantCapabilities()])
  if (knowledgeResult.status === 'fulfilled') mentionKnowledgeBases = knowledgeResult.value.data?.list || []
  if (callableResult.status === 'fulfilled') callableAgents = callableResult.value.data?.list || []
  if (coursesResult.status === 'fulfilled') courses = coursesResult.value.data?.list || coursesResult.value.data?.courses || []
  const capabilities = capabilitiesResult.status === 'fulfilled' ? capabilitiesResult.value.data : null
  const openGeneralDraftOnLoad = consumeGeneralAiOpenFlag()

  const state = {
    conversations: [],
    messages: [],
    currentId: null,
    currentConversation: null,
    mode: 'general',
    subject: 'machine_learning',
    agentType: AGENTS[0]?.value || '',
    keyword: '',
    historyMode: '',
    historySubject: '',
    historyDate: '',
    historyMulti: false,
    historySelected: new Set(),
    inputDraft: '',
    pendingImages: [],
    knowledgeBaseRefs: [],
    agentRefs: [],
    mentionKnowledgeBases,
    callableAgents,
    listening: false,
    speechRecognition: null,
    starterQuestions: fallbackStarterQuestions({ mode: 'general', subject: 'machine_learning', agentType: AGENTS[0]?.value || '' }),
    starterQuestionKey: 'general',
    loadingStarterQuestions: false,
    loadingConversations: true,
    loadingMessages: false,
    generating: false,
    abortController: null,
    runStreamController: null,
    runTimer: null,
    serverTimeOffsetMs: 0,
    lastRunSequence: 0,
    terminalRunEventSeen: false,
    currentRun: null,
    runTasks: [],
    runEvents: [],
    runSources: [],
    runAssistantLocalId: null,
    runAssistantContent: '',
    runDetailsOpen: false,
    runSourcesOpen: false,
    openRunSourceIds: new Set(),
    loadingStageText: '',
    historyCollapsed: readHistoryCollapsed(user),
    messageAutoFollow: true,
    conversationError: '',
    messageError: '',
    learningContext,
    courses,
    courseId: Number(learningContext.courseId) || null,
    searchOptions: { ...DEFAULT_SEARCH_OPTIONS },
    capabilities,
    pendingAction: null,
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildShell(state), user })
  document.getElementById('student-main')?.classList.add('student-main-ai-chat')
  let starterRequestSeq = 0
  let subjectComposer = null

  function syncModeFromConversation(conversation) {
    if (!conversation) return
    state.mode = conversation.mode || 'general'
    state.subject = conversation.subject || 'machine_learning'
    state.agentType = conversation.agent_type || conversation.agentType || AGENTS[0]?.value || ''
  }

  async function refreshCallableAgents() {
    if (state.mode === 'subject' && !state.courseId) {
      state.callableAgents = []
      subjectComposer?.setSources({ knowledgeBases: state.mentionKnowledgeBases, agents: [] })
      return
    }
    try {
      const course = state.courses.find(item => Number(item.course_id || item.id) === Number(state.courseId))
      const subjectCode = course?.course_code || course?.code || state.subject
      const response = await listCallableAgents({ assistantMode: state.mode, courseId: state.courseId || undefined, subjectCode })
      state.callableAgents = response.data?.list || []
      subjectComposer?.setSources({ knowledgeBases: state.mentionKnowledgeBases, agents: state.callableAgents })
    } catch (error) {
      state.callableAgents = []
      subjectComposer?.setSources({ knowledgeBases: state.mentionKnowledgeBases, agents: [] })
      if (state.mode === 'subject') showToast(error.message || '当前课程没有可调用的学科智能体', 'warning')
    }
  }

  function starterStorageKey(key = starterContextKey(state)) {
    const userKey = user?.user_id || user?.id || 'current'
    return `discimind:ai-chat:starter:${userKey}:${key}`
  }

  function readCachedStarterQuestions(key = starterContextKey(state)) {
    try {
      const raw = localStorage.getItem(starterStorageKey(key))
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed?.questions)) return null
      return parsed.questions
    } catch {
      return null
    }
  }

  function cacheStarterQuestions(key, questions) {
    try {
      localStorage.setItem(starterStorageKey(key), JSON.stringify({
        questions,
        cached_at: new Date().toISOString(),
      }))
    } catch {
      // 缓存失败不影响建议问题展示
    }
  }

  function applyStarterContext() {
    const key = starterContextKey(state)
    if (state.starterQuestionKey === key && state.starterQuestions?.length) return
    state.starterQuestionKey = key
    state.starterQuestions = normalizeStarterQuestions(readCachedStarterQuestions(key), state)
    state.loadingStarterQuestions = false
  }

  const AUTO_FOLLOW_THRESHOLD = 120

  function isNearMessageBottom(host = document.getElementById('ai-chat-scroll-host')) {
    if (!host) return true
    const distanceToBottom = host.scrollHeight - host.scrollTop - host.clientHeight
    return distanceToBottom < AUTO_FOLLOW_THRESHOLD
  }

  function toggleHistoryPanel() {
    state.historyCollapsed = !state.historyCollapsed
    try {
      const key = `${AI_HISTORY_COLLAPSED_KEY}:${user?.user_id || user?.id || 'current'}`
      localStorage.setItem(key, state.historyCollapsed ? '1' : '0')
    } catch {
      // 本地偏好写入失败不影响历史会话功能。
    }
    rerender()
  }

  function bindMessageScrollTracking() {
    const host = document.getElementById('ai-chat-scroll-host')
    if (!host) return
    host.addEventListener('scroll', () => {
      state.messageAutoFollow = isNearMessageBottom(host)
    }, { passive: true })
  }

  function scrollMessages({ force = false } = {}) {
    requestAnimationFrame(() => {
      const host = document.getElementById('ai-chat-scroll-host')
      if (!host) return
      if (force || state.messageAutoFollow || isNearMessageBottom(host)) {
        host.scrollTop = host.scrollHeight
        state.messageAutoFollow = true
      }
    })
  }

  function bindMessageActions(root = document) {
    root.querySelectorAll?.('[data-copy-code]').forEach(button => {
      button.addEventListener('click', async () => {
        const code = decodeURIComponent(button.dataset.copyCode || '')
        try {
          await navigator.clipboard.writeText(code)
          showToast('代码已复制', 'success')
        } catch {
          showToast('复制失败，请手动选择代码', 'error')
        }
      })
    })
    root.querySelectorAll?.('[data-copy-message]').forEach(button => {
      button.addEventListener('click', async () => {
        const message = state.messages.find(item => String(item.id || item.message_id) === button.dataset.copyMessage)
        if (!message) return
        try {
          await navigator.clipboard.writeText(String(message.content || ''))
          showToast('回答已复制', 'success')
        } catch { showToast('复制失败', 'error') }
      })
    })
    root.querySelectorAll?.('[data-speak-message]').forEach(button => {
      button.addEventListener('click', () => {
        const message = state.messages.find(item => String(item.id || item.message_id) === button.dataset.speakMessage)
        if (!message || !('speechSynthesis' in window)) { showToast('当前浏览器不支持朗读', 'warning'); return }
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(String(message.content || '').replace(/[`#*_>\[\]()]/g, ' '))
        utterance.lang = 'zh-CN'
        utterance.rate = 1
        window.speechSynthesis.speak(utterance)
      })
    })
    root.querySelectorAll?.('[data-open-image]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.openImage) window.open(button.dataset.openImage, '_blank', 'noopener,noreferrer')
      })
    })
  }

  async function hydrateMessageAttachments(message) {
    if (!message || !Array.isArray(message.attachments)) return message
    await Promise.all(message.attachments.map(async attachment => {
      if (attachment.displayUrl || attachment.dataUrl || !attachment.url) return
      try {
        const response = await fetch(attachment.url, {
          headers: { Authorization: `Bearer ${getToken()}` },
          credentials: 'include',
        })
        if (response.ok) attachment.displayUrl = URL.createObjectURL(await response.blob())
      } catch {
        // 附件显示失败不影响文本对话。
      }
    }))
    return message
  }

  async function hydrateMessages(messages) {
    await Promise.all((messages || []).map(hydrateMessageAttachments))
    return messages
  }

  function hydrateMessageContent(root = document) {
    bindMessageActions(root)
    bindArtifactActions(root, error => showToast(error.message || '成果下载失败', 'error'))
    bindPendingActionCard(root, { onAction: handlePendingAction, onError: error => showToast(error.message, 'warning') })
    state.messages.forEach((message, index) => {
      const row = root.querySelector?.(`[data-message-index="${index}"]`)
      bindCitationClicks(row, citationIndex => {
        const details = row?.querySelector('.ai-message-sources')
        if (details) details.open = true
        requestAnimationFrame(() => focusSource(row, citationIndex))
      })
      const traceRoot = row?.querySelector(`[data-student-ai-trace="${index}"]`)
      if (traceRoot) {
        const trace = createExecutionTrace(traceRoot)
        ;(message.traceEvents || []).forEach(event => trace.push(event))
      }
    })
    renderMathInMarkdownElements(root)
  }

  function refreshMessages() {
    const host = document.getElementById('ai-chat-messages-host')
    if (!host) return
    const scrollHost = document.getElementById('ai-chat-scroll-host')
    const previousScrollTop = scrollHost?.scrollTop || 0
    const shouldFollow = state.messageAutoFollow || isNearMessageBottom(scrollHost)
    host.innerHTML = buildMessages(state)
    hydrateMessageContent(host)
    initializeAiPathLoaders(host)
    requestAnimationFrame(() => {
      if (!scrollHost) return
      if (shouldFollow) {
        scrollHost.scrollTop = scrollHost.scrollHeight
        state.messageAutoFollow = true
      } else {
        scrollHost.scrollTop = previousScrollTop
      }
    })
    host.querySelectorAll?.('[data-ai-artifact-download]').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true
        try { await downloadGeneratedArtifactExport(button.dataset.artifactId, button.dataset.aiArtifactDownload) }
        catch (error) { showToast(error.message || '文件下载失败', 'error') }
        finally { button.disabled = false }
      })
    })
  }

  function stopRunTimer() {
    if (state.runTimer) window.clearInterval(state.runTimer)
    state.runTimer = null
  }

  function startRunTimer() {
    stopRunTimer()
    if (!ACTIVE_RUN_STATUSES.has(normalizeRunStatus(state.currentRun?.status))) return
    state.runTimer = window.setInterval(() => refreshRunWorkbench(), 1000)
  }

  function resetRunState({ abort = true } = {}) {
    if (abort) state.runStreamController?.abort()
    stopRunTimer()
    state.runStreamController = null
    state.currentRun = null
    state.serverTimeOffsetMs = 0
    state.lastRunSequence = 0
    state.terminalRunEventSeen = false
    state.runTasks = []
    state.runEvents = []
    state.runSources = []
    state.runAssistantLocalId = null
    state.runAssistantContent = ''
    state.runDetailsOpen = false
    state.runSourcesOpen = false
    state.openRunSourceIds.clear()
    state.loadingStageText = ''
  }

  function applyRun(run) {
    if (!run) { resetRunState(); return }
    const changedRun = state.currentRun?.runId && run.runId && state.currentRun.runId !== run.runId
    if (changedRun) {
      state.lastRunSequence = 0
      state.terminalRunEventSeen = false
    }
    state.currentRun = { ...(state.currentRun || {}), ...run, status: normalizeRunStatus(run.status || state.currentRun?.status) }
    if (run.serverNow) state.serverTimeOffsetMs = Date.now() - new Date(run.serverNow).getTime()
    if (Array.isArray(run.tasks)) state.runTasks = run.tasks.map(task => ({ ...task, status: normalizeTaskStatus(task.status) }))
    if (Array.isArray(run.events)) {
      state.runEvents = [...run.events].sort((left, right) => Number(left.sequence) - Number(right.sequence))
      state.lastRunSequence = Math.max(0, ...state.runEvents.map(item => Number(item.sequence) || 0))
      state.terminalRunEventSeen = state.runEvents.some(item => TERMINAL_RUN_EVENTS.has(item.eventType))
    }
    if (Array.isArray(run.sources)) state.runSources = run.sources
    state.runAssistantContent = run.finalAnswer || state.runAssistantContent || ''
    if (ACTIVE_RUN_STATUSES.has(normalizeRunStatus(run.status))) {
      state.loadingStageText = loadingTextFromStage(run.currentTask, state.loadingStageText || '正在理解问题')
    }
  }

  function bindRunEvents() {
    document.querySelectorAll('[data-retry-run-task]').forEach(button => {
      button.addEventListener('click', () => retryRunTask(button.dataset.retryRunTask))
    })
    document.querySelector('[data-regenerate-chart]')?.addEventListener('click', () => sendCurrentMessage({ regenerate: true }))
    const details = document.querySelector('.subject-run-details')
    details?.addEventListener('toggle', () => {
      state.runDetailsOpen = details.open
    })
    const sources = document.querySelector('.subject-run-sources')
    sources?.addEventListener('toggle', () => {
      state.runSourcesOpen = sources.open
    })
    document.querySelectorAll('[data-run-source-id]').forEach(source => {
      source.addEventListener('toggle', () => {
        const sourceId = source.dataset.runSourceId
        if (source.open) state.openRunSourceIds.add(sourceId)
        else state.openRunSourceIds.delete(sourceId)
      })
    })
  }

  function refreshRunWorkbench() {
    const host = document.getElementById('subject-run-host')
    if (!host) return
    const scrollHost = document.getElementById('ai-chat-scroll-host')
    const previousHeight = host.getBoundingClientRect().height
    const previousScrollTop = scrollHost?.scrollTop || 0
    const wrapper = document.createElement('div')
    wrapper.innerHTML = buildRunWorkbench(state)
    const next = wrapper.firstElementChild
    if (next) host.replaceWith(next)
    bindRunEvents()
    initializeAiPathLoaders(next || document)
    if (next && scrollHost) {
      const heightDelta = next.getBoundingClientRect().height - previousHeight
      if (state.messageAutoFollow) scrollMessages()
      else if (previousScrollTop > 0 && heightDelta) scrollHost.scrollTop = Math.max(0, previousScrollTop + heightDelta)
    }
  }

  function ensureRunAssistantMessage() {
    if (state.runAssistantLocalId) {
      const existing = state.messages.find(item => item.id === state.runAssistantLocalId)
      if (existing) return existing
    }
    const message = {
      id: `subject-run-assistant-${state.currentRun?.runId || Date.now()}`,
      role: 'assistant',
      content: state.runAssistantContent || '',
      streaming: true,
      sources: [],
      artifacts: [],
      traceEvents: [],
      confirmationRequired: false,
      created_at: new Date().toISOString(),
    }
    state.runAssistantLocalId = message.id
    state.messages.push(message)
    return message
  }

  function upsertRunTask(task) {
    if (!task?.taskId) return
    const index = state.runTasks.findIndex(item => item.taskId === task.taskId)
    if (index >= 0) state.runTasks[index] = { ...state.runTasks[index], ...task }
    else state.runTasks.push(task)
    state.runTasks.sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex))
  }

  function runEventToTrace(event) {
    if (event?.payload?.protocol?.type) return event.payload.protocol
    const type = ({
      task_started: 'step.started', task_progress: 'step.progress', task_completed: 'step.completed',
      run_status_changed: 'run.phase', run_heartbeat: 'run.heartbeat', agent_heartbeat: 'agent.heartbeat',
      agent_first_delta: 'agent.first_delta', source_found: 'knowledge.hits',
      run_completed: 'run.completed', run_failed: 'run.failed', run_stalled: 'run.stalled', run_cancelled: 'run.cancelled',
    })[event?.eventType]
    if (!type) return null
    return {
      type,
      runId: event.runId,
      sequence: event.sequence,
      timestamp: event.timestamp || event.createdAt,
      payload: { ...(event.payload || {}), title: event.title || event.payload?.task?.title || '' },
    }
  }

  function handleRunEvent(eventName, event) {
    if (!event || event.runId !== state.currentRun?.runId) return
    const sequence = Number(event.sequence) || 0
    if (sequence && sequence <= state.lastRunSequence) return
    if (sequence) state.lastRunSequence = sequence
    state.runEvents.push(event)
    state.runEvents.sort((a, b) => Number(a.sequence) - Number(b.sequence))
    const detail = event.payload || {}
    if (eventName.includes('.') && detail.protocol?.type) {
      const protocol = detail.protocol
      const assistant = ensureRunAssistantMessage()
      assistant.traceEvents = [...(assistant.traceEvents || []), protocol]
      if (eventName === 'knowledge.started') state.loadingStageText = '正在检索已选择的知识库'
      if (eventName === 'knowledge.hits') state.loadingStageText = `知识库已命中 ${Number(protocol.payload?.sourceCount || 0)} 条资料`
      if (eventName === 'knowledge.completed') state.loadingStageText = Number(protocol.payload?.sourceCount || 0) > 0 ? '正在根据知识库资料组织回答' : '所选知识库未命中相关资料'
      if (eventName === 'search.sources') {
        const early = (protocol.payload?.sources || []).map(source => ({
          ...source,
          sourceType: 'WEB_SEARCH',
          metadata: { sourceIndex: source.index, siteName: source.siteName, searchStrategy: source.searchStrategy },
        }))
        assistant.sources = [...early, ...(assistant.sources || []).filter(source => String(source.sourceType).toUpperCase() !== 'WEB_SEARCH')]
      }
      if (eventName === 'artifact.completed' && protocol.payload?.id) {
        assistant.artifacts = [...(assistant.artifacts || []).filter(item => item.id !== protocol.payload.id), protocol.payload]
      }
      if (eventName === 'run.completed') {
        assistant.artifacts = protocol.payload?.artifacts || assistant.artifacts || []
        assistant.confirmationRequired = protocol.payload?.confirmationRequired === true
        if (protocol.payload?.pendingAction) {
          state.pendingAction = protocol.payload.pendingAction
          assistant.pendingAction = protocol.payload.pendingAction
        }
      }
      refreshMessages()
    }
    if (!eventName.includes('.')) {
      const traceEvent = runEventToTrace(event)
      if (traceEvent) {
        const assistant = ensureRunAssistantMessage()
        assistant.traceEvents = [...(assistant.traceEvents || []), traceEvent]
        refreshMessages()
      }
    }
    if (['task_started', 'task_progress', 'tool_started', 'source_found', 'answer_delta'].includes(eventName)) {
      state.loadingStageText = loadingTextFromRunEvent(eventName, detail, state.currentRun)
    }
    if (detail.run) applyRun(detail.run)
    if (detail.task) upsertRunTask(detail.task)
    if (detail.source && !state.runSources.some(item => item.sourceId === detail.source.sourceId)) state.runSources.push(detail.source)
    if (eventName === 'answer_delta' && detail.content) {
      state.runAssistantContent += detail.content
      const assistant = ensureRunAssistantMessage()
      assistant.content = state.runAssistantContent
      assistant.streaming = true
      refreshMessages()
    }
    if (detail.userMessage) {
      const localUser = state.messages.find(item => String(item.id).startsWith('local-user-'))
      if (localUser) replaceLocalMessage(localUser.id, detail.userMessage)
    }
    if (detail.assistantMessage && state.runAssistantLocalId) {
      replaceLocalMessage(state.runAssistantLocalId, detail.assistantMessage)
      state.runAssistantLocalId = null
    }
    if (TERMINAL_RUN_EVENTS.has(eventName) && !state.terminalRunEventSeen) {
      state.terminalRunEventSeen = true
      state.generating = false
      state.loadingStageText = ''
      stopRunTimer()
      const assistant = state.messages.find(item => item.id === state.runAssistantLocalId)
      if (assistant) assistant.streaming = false
    }
    refreshRunWorkbench()
  }

  async function connectRunStream() {
    const runId = state.currentRun?.runId
    if (!runId || !ACTIVE_RUN_STATUSES.has(normalizeRunStatus(state.currentRun.status))) return
    state.runStreamController?.abort()
    state.runStreamController = new AbortController()
    state.generating = true
    ensureRunAssistantMessage()
    startRunTimer()
    let attempts = 0
    try {
      while (attempts < 3 && ACTIVE_RUN_STATUSES.has(normalizeRunStatus(state.currentRun?.status))) {
        const after = state.lastRunSequence
        try {
          await streamSubjectChatRun(runId, {
            after,
            signal: state.runStreamController.signal,
            onEvent: handleRunEvent,
          })
        } catch (error) {
          if (error.name === 'AbortError') throw error
          attempts += 1
          if (attempts >= 3) throw error
        }
        const latest = await getSubjectChatRun(runId)
        applyRun(latest.data)
        if (ACTIVE_RUN_STATUSES.has(normalizeRunStatus(state.currentRun?.status))) {
          attempts += 1
          await new Promise(resolve => window.setTimeout(resolve, Math.min(1500, 400 * attempts)))
        }
      }
      const latest = await getSubjectChatRun(runId)
      applyRun(latest.data)
      const messages = await getAiChatMessages(state.currentId)
      state.messages = await hydrateMessages(messages.data?.messages || state.messages)
      state.currentConversation = normalizeConversation(messages.data?.conversation || state.currentConversation)
    } catch (error) {
      if (error.name !== 'AbortError') {
        try {
          const latest = await getSubjectChatRun(runId)
          applyRun(latest.data)
        } catch {
          // Keep the last valid snapshot; the user can still return through the task center.
        }
        showToast(error.message || '运行事件连接中断，已用最新快照补偿', 'warning')
      }
    } finally {
      if (!ACTIVE_RUN_STATUSES.has(normalizeRunStatus(state.currentRun?.status))) {
        stopRunTimer()
        state.generating = false
      }
      state.runStreamController = null
      rerender()
    }
  }

  async function restoreLatestRun() {
    resetRunState()
    if (!state.currentId) return false
    try {
      const response = await getLatestSubjectChatRun(state.currentId)
      if (!response.data) return false
      applyRun(response.data)
      if (ACTIVE_RUN_STATUSES.has(normalizeRunStatus(state.currentRun.status))) {
        state.generating = true
        startRunTimer()
        state.runAssistantContent = state.currentRun.finalAnswer || state.runEvents
          .filter(event => event.eventType === 'answer_delta')
          .map(event => event.payload?.content || '')
          .join('')
        const assistant = ensureRunAssistantMessage()
        assistant.traceEvents = state.runEvents.map(runEventToTrace).filter(Boolean)
        return true
      }
    } catch (error) {
      console.warn('[student-ai-chat] 恢复运行记录失败:', error.message)
    }
    return false
  }

  async function retryRunTask(taskId) {
    if (!state.currentRun?.runId || state.generating) return
    try {
      const response = await retrySubjectChatTask(state.currentRun.runId, taskId)
      applyRun(response.data)
      state.runAssistantContent = ''
      state.runAssistantLocalId = null
      state.generating = true
      rerender()
      await connectRunStream()
    } catch (error) {
      showToast(error.message || '重试失败', 'error')
    }
  }

  function refreshConversationList() {
    const host = document.getElementById('conversation-list-host')
    if (!host) return
    host.innerHTML = buildConversationList(state)
    bindConversationEvents()
  }

  function bindStarterQuestionEvents() {
    document.querySelectorAll('.quick-question').forEach(button => {
      button.addEventListener('click', () => {
        if (subjectComposer && !state.generating) {
          state.inputDraft = button.dataset.question || ''
          subjectComposer.setValue(state.inputDraft)
          subjectComposer.focus()
          return
        }
      })
    })
  }

  function refreshStarterQuestions() {
    const host = document.getElementById('starter-question-row')
    if (!host) return
    host.outerHTML = buildStarterQuestionRow(state)
    bindStarterQuestionEvents()
  }

  async function loadStarterQuestions({ force = false } = {}) {
    applyStarterContext()
    const requestKey = starterContextKey(state)
    const requestId = ++starterRequestSeq

    const cached = readCachedStarterQuestions(requestKey)
    if (!force && cached?.length) {
      state.starterQuestions = normalizeStarterQuestions(cached, state)
      state.loadingStarterQuestions = false
      refreshStarterQuestions()
      return
    }

    state.loadingStarterQuestions = true
    refreshStarterQuestions()
    try {
      const params = { mode: state.mode }
      if (state.mode === 'subject') params.subject = state.subject
      if (state.mode === 'agent') params.agent_type = state.agentType
      const res = await getAiChatStarterQuestions(params)
      if (requestId !== starterRequestSeq || requestKey !== starterContextKey(state)) return
      const questions = normalizeStarterQuestions(res.data?.questions, state)
      state.starterQuestions = questions
      cacheStarterQuestions(requestKey, questions)
    } catch {
      if (requestId !== starterRequestSeq || requestKey !== starterContextKey(state)) return
      state.starterQuestions = normalizeStarterQuestions([], state)
    } finally {
      if (requestId === starterRequestSeq && requestKey === starterContextKey(state)) {
        state.loadingStarterQuestions = false
        refreshStarterQuestions()
      }
    }
  }

  function autoResizeInput(input) {
    if (!input) return
    input.style.height = 'auto'
    const nextHeight = Math.min(Math.max(input.scrollHeight, 46), 180)
    input.style.height = `${nextHeight}px`
    input.style.overflowY = input.scrollHeight > 180 ? 'auto' : 'hidden'
  }

  function updateInputState(input) {
    state.inputDraft = input?.value || ''
    autoResizeInput(input)
    const sendButton = document.getElementById('btn-send-message')
    const count = document.getElementById('input-count')
    if (sendButton) sendButton.disabled = state.generating || (!state.inputDraft.trim() && !state.pendingImages.length)
    if (count) count.textContent = `${state.inputDraft.length}/${MAX_INPUT_LENGTH}`
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.readAsDataURL(file)
    })
  }

  async function addImageFiles(fileList) {
    const files = Array.from(fileList || []).filter(file => file?.type?.startsWith('image/'))
    if (!files.length) return
    const remaining = MAX_IMAGE_COUNT - state.pendingImages.length
    if (remaining <= 0) { showToast(`单次最多添加 ${MAX_IMAGE_COUNT} 张图片`, 'warning'); return }
    if (files.length > remaining) showToast(`本次仅添加前 ${remaining} 张图片`, 'warning')
    for (const file of files.slice(0, remaining)) {
      if (!SUPPORTED_IMAGE_TYPES.has(file.type)) { showToast(`${file.name} 的格式不支持`, 'warning'); continue }
      if (file.size > MAX_IMAGE_BYTES) { showToast(`${file.name} 超过 5MB`, 'warning'); continue }
      const dataUrl = await fileToDataUrl(file)
      state.pendingImages.push({
        id: globalThis.crypto?.randomUUID?.() || `img_${Date.now()}_${Math.random()}`,
        name: file.name || '粘贴图片', mimeType: file.type, size: file.size, dataUrl,
      })
    }
    rerender()
    document.getElementById('chat-input')?.focus()
  }

  function toggleVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) { showToast('当前浏览器不支持语音输入', 'warning'); return }
    if (state.speechRecognition) { state.speechRecognition.stop(); return }
    const recognition = new Recognition()
    const original = state.inputDraft
    recognition.lang = 'zh-CN'
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0]?.transcript || '').join('')
      const input = document.getElementById('chat-input')
      if (input) { input.value = `${original}${original && transcript ? ' ' : ''}${transcript}`; updateInputState(input) }
    }
    recognition.onerror = event => { if (event.error !== 'aborted') showToast('语音识别未成功，请重试', 'warning') }
    recognition.onend = () => { state.listening = false; state.speechRecognition = null; rerender() }
    state.speechRecognition = recognition
    state.listening = true
    recognition.start()
    rerender()
  }

  function rerender() {
    const main = document.getElementById('student-main')
    if (!main) return
    const previousScrollHost = document.getElementById('ai-chat-scroll-host')
    const previousScrollTop = previousScrollHost?.scrollTop || 0
    const hadScrollHost = Boolean(previousScrollHost)
    const shouldFollow = state.messageAutoFollow || isNearMessageBottom(previousScrollHost)
    applyStarterContext()
    subjectComposer?.destroy()
    subjectComposer = null
    main.innerHTML = buildShell(state)
    bindEvents()
    hydrateMessageContent(main)
    initializeAiPathLoaders(main)
    requestAnimationFrame(() => {
      const nextScrollHost = document.getElementById('ai-chat-scroll-host')
      if (!nextScrollHost) return
      if (!hadScrollHost || shouldFollow) {
        nextScrollHost.scrollTop = nextScrollHost.scrollHeight
        state.messageAutoFollow = true
      } else {
        nextScrollHost.scrollTop = previousScrollTop
      }
    })
  }

  async function loadConversations(selectFirst = true) {
    state.loadingConversations = true
    state.conversationError = ''
    refreshConversationList()
    try {
      const res = await getAiChatConversations({ page_size: 100 })
      state.conversations = (res.data?.list || []).map(normalizeConversation)
      if (!state.currentId && launchConversationId && state.conversations.some(item => Number(item.id) === launchConversationId)) {
        await selectConversation(launchConversationId, false)
      }
      if (selectFirst && !state.currentId && state.conversations.length) {
        await selectConversation(state.conversations[0].id, false)
      }
    } catch (err) {
      state.conversationError = err.message || '会话加载失败'
      showToast(state.conversationError, 'error')
    } finally {
      state.loadingConversations = false
      rerender()
      void loadStarterQuestions()
    }
  }

  async function selectConversation(id, rerenderBefore = true) {
    if (state.generating) return
    state.messageAutoFollow = true
    state.currentId = Number(id)
    state.currentConversation = normalizeConversation(state.conversations.find(item => item.id === state.currentId))
    syncModeFromConversation(state.currentConversation)
    state.loadingMessages = true
    state.messageError = ''
    state.messages = []
    state.pendingAction = null
    if (rerenderBefore) rerender()

    let shouldReconnectRun = false
    try {
      const res = await getAiChatMessages(state.currentId)
      state.currentConversation = normalizeConversation(res.data?.conversation || state.currentConversation)
      syncModeFromConversation(state.currentConversation)
      state.messages = await hydrateMessages(res.data?.messages || [])
      await refreshPendingAction()
      shouldReconnectRun = await restoreLatestRun()
    } catch (err) {
      state.messageError = err.message || '消息加载失败'
      showToast(state.messageError, 'error')
    } finally {
      state.loadingMessages = false
      applyStarterContext()
      state.messageAutoFollow = true
      rerender()
      scrollMessages({ force: true })
      void loadStarterQuestions()
      if (shouldReconnectRun) void connectRunStream()
    }
  }

  async function createConversation(silent = false) {
    try {
      const res = await createAiChatConversation({
        title: '新对话',
        mode: state.mode,
        subject: state.mode === 'subject' ? state.subject : undefined,
        agentType: state.mode === 'agent' ? state.agentType : undefined,
      })
      const conversation = normalizeConversation(res.data)
      state.currentId = conversation.id
      state.currentConversation = conversation
      state.messages = []
      state.conversations = [conversation, ...state.conversations.filter(item => item.id !== conversation.id)]
      if (!silent) showToast('会话已创建', 'success')
      rerender()
      return conversation
    } catch (err) {
      showToast(err.message || '创建会话失败', 'error')
      return null
    }
  }

  async function ensureConversation() {
    if (state.currentId) return state.currentId
    const conversation = await createConversation(true)
    return conversation?.id || null
  }

  function resetForModeChange({ clearInput = false } = {}) {
    resetRunState()
    state.generating = false
    state.currentId = null
    state.currentConversation = null
    state.messages = []
    state.loadingMessages = false
    state.messageError = ''
    state.messageAutoFollow = true
    if (clearInput) {
      state.inputDraft = ''
      state.pendingImages = []
      state.knowledgeBaseRefs = []
      state.agentRefs = []
    }
    applyStarterContext()
    rerender()
    void loadStarterQuestions()
  }

  function startDraftConversation() {
    resetForModeChange({ clearInput: true })
    showToast('已准备新对话，发送后会保存', 'success')
  }

  function openGeneralDraft({ focus = true } = {}) {
    if (state.generating) return
    state.mode = 'general'
    state.subject = 'machine_learning'
    state.agentType = AGENTS[0]?.value || ''
    resetForModeChange({ clearInput: true })
    void refreshCallableAgents()
    if (focus) {
      window.setTimeout(() => subjectComposer?.focus(), 80)
    }
  }

  function changeMode(nextMode) {
    if (state.generating) return
    if (nextMode === 'agent') {
      window.location.hash = '#/student/agents/mine'
      return
    }
    if (state.mode === nextMode) return
    state.mode = nextMode
    if (nextMode === 'subject' && !state.subject) state.subject = 'machine_learning'
    if (nextMode === 'subject' && !state.courseId && state.courses.length) state.courseId = Number(state.courses[0].course_id || state.courses[0].id)
    resetForModeChange()
    void refreshCallableAgents()
  }

  function changeCourse(nextCourseId) {
    if (state.generating) return
    const courseId = Number(nextCourseId) || null
    if (courseId === state.courseId) return
    state.mode = 'subject'
    state.courseId = courseId
    const course = state.courses.find(item => Number(item.course_id || item.id) === Number(courseId))
    state.subject = inferSubjectFromCourse(course, state.subject)
    resetForModeChange()
    void refreshCallableAgents()
  }

  function changeAgent(nextAgent) {
    if (state.generating) return
    const agent = AGENTS.find(item => String(item.value) === String(nextAgent))
    if (!agent) return
    window.location.hash = `#/student/agents/${agent.value}/chat`
  }

  async function loadConversationsAfterSend() {
    try {
      const res = await getAiChatConversations({ page_size: 100 })
      state.conversations = (res.data?.list || []).map(normalizeConversation)
      state.currentConversation = normalizeConversation(state.conversations.find(item => item.id === state.currentId)) || state.currentConversation
    } catch {
      // 会话列表刷新失败不影响当前流式回答展示
    }
    await refreshPendingAction()
  }

  function attachPendingAction(pendingAction) {
    state.pendingAction = pendingAction || null
    for (const message of state.messages) delete message.pendingAction
    const lastAssistant = state.messages.findLast?.(item => String(item.role || '').toLowerCase() !== 'user')
      || [...state.messages].reverse().find(item => String(item.role || '').toLowerCase() !== 'user')
    if (lastAssistant && pendingAction) lastAssistant.pendingAction = pendingAction
  }

  async function refreshPendingAction() {
    if (!state.currentId) { attachPendingAction(null); return null }
    try {
      const response = await getAiConversationPendingAction(state.currentId)
      attachPendingAction(response.data || null)
      return state.pendingAction
    } catch (error) {
      if (![40301, 40401].includes(Number(error.code))) console.warn('[student-ai-chat] pending action refresh failed:', error.message)
      return null
    }
  }

  async function handlePendingAction(pendingActionId, action, patch, control) {
    if (control) control.disabled = true
    try {
      const response = await actOnAiPendingAction(pendingActionId, action, patch)
      const result = response.data || {}
      if (action === 'preview') return result
      attachPendingAction(result.pendingAction || state.pendingAction)
      if (action === 'generate') showToast('文件任务已开始，可在任务与消息中查看实时进度', 'success')
      else if (action === 'modify') showToast('生成需求已更新', 'success')
      else if (action === 'cancel') showToast('本次文件生成已取消', 'success')
      refreshMessages()
      return result
    } catch (error) {
      showToast(error.message || '确认操作失败，请稍后重试', 'error')
      return null
    } finally { if (control) control.disabled = false }
  }

  function replaceLocalMessage(localId, serverMessage) {
    const idx = state.messages.findIndex(item => item.id === localId)
    if (idx >= 0 && serverMessage) {
      state.messages[idx] = serverMessage
    }
  }

  async function sendCurrentMessage({ regenerate = false, confirmed = false, content: confirmedContent = '' } = {}) {
    if (state.generating) return

    const text = String(confirmedContent || state.inputDraft || '').trim()
    const images = regenerate ? [] : [...state.pendingImages]
    const knowledgeBaseRefs = regenerate ? [] : [...state.knowledgeBaseRefs]
    const agentRefs = regenerate ? [] : [...state.agentRefs]
    if (!regenerate && !text && !images.length) {
      showToast('请输入问题或添加图片后再发送', 'warning')
      return
    }
    if (!regenerate && text.length > MAX_INPUT_LENGTH) {
      showToast(`单次输入不能超过 ${MAX_INPUT_LENGTH} 字`, 'warning')
      return
    }
    if (regenerate && !state.messages.some(item => String(item.role).toLowerCase() === 'user')) {
      showToast('当前会话没有可重新生成的问题', 'warning')
      return
    }

    const conversationId = await ensureConversation()
    if (!conversationId) return

    const localUserId = `local-user-${Date.now()}`
    const localAssistantId = `local-assistant-${Date.now()}`
    let streamHadError = false
    let errorMessage = ''
    let rawAssistantContent = ''

    if (regenerate) {
      const lastUserIndex = state.messages.map(item => String(item.role).toLowerCase()).lastIndexOf('user')
      state.messages = lastUserIndex >= 0 ? state.messages.slice(0, lastUserIndex + 1) : state.messages
    } else {
      state.messages.push({
        id: localUserId,
        role: 'user',
        content: text,
        attachments: images.map(image => ({ ...image })),
        knowledgeBaseRefs,
        agentRefs,
        created_at: new Date().toISOString(),
      })
      state.inputDraft = ''
      state.pendingImages = []
      state.knowledgeBaseRefs = []
      state.agentRefs = []
    }

    const assistantMessage = {
      id: localAssistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      sources: [],
      artifacts: [],
      traceEvents: [],
      confirmationRequired: false,
      requestContent: text,
      created_at: new Date().toISOString(),
    }
    resetRunState()
    state.messages.push(assistantMessage)
    state.generating = true
    state.loadingStageText = '正在理解问题'
    state.messageAutoFollow = true
    state.abortController = new AbortController()
    rerender()

    try {
      if (['general', 'subject', 'agent'].includes(state.mode)) {
        const selectedCourse = state.courses.find(item => Number(item.course_id || item.id) === Number(state.courseId))
        const contextPayload = {
          assistantMode: state.mode,
          courseId: state.courseId,
          learningContext: state.learningContext,
          subjectCode: selectedCourse?.course_code || selectedCourse?.code || state.subject,
          searchOptions: { ...state.searchOptions, assignedSiteList: [...(state.searchOptions.assignedSiteList || [])] },
          autoAgent: true,
          confirmed,
        }
        const created = await createSubjectChatRun(conversationId, regenerate ? { regenerate: true, ...contextPayload } : {
          content: text,
          attachments: images.map(item => item.id),
          knowledgeBaseRefs,
          agentRefs,
          ...contextPayload,
        })
        applyRun(created.data)
        state.runAssistantLocalId = localAssistantId
        state.runAssistantContent = ''
        state.currentConversation = normalizeConversation(created.data?.conversation || state.currentConversation)
        if (created.data?.userMessage) {
          await hydrateMessageAttachments(created.data.userMessage)
          replaceLocalMessage(localUserId, created.data.userMessage)
        }
        rerender()
        await connectRunStream()
        if (state.currentRun?.status === 'failed') showToast(state.currentRun.errorMessage || '答疑任务执行失败', 'error')
        else if (state.currentRun?.status === 'cancelled') showToast('已停止生成，已生成内容已保留', 'warning')
        else await loadConversationsAfterSend()
        return
      }
      await streamAiChatMessage(conversationId, regenerate ? { regenerate: true } : {
        content: text,
        images: images.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl })),
        knowledgeBaseRefs,
        agentRefs,
      }, {
        signal: state.abortController.signal,
        onEvent: (eventName, payload) => {
          if (eventName === 'meta') {
            state.loadingStageText = '正在读取学习上下文'
            state.currentConversation = normalizeConversation(payload.conversation || state.currentConversation)
            if (payload.user_message) {
              void hydrateMessageAttachments(payload.user_message).then(() => {
                replaceLocalMessage(localUserId, payload.user_message)
                refreshMessages()
              })
            }
            refreshConversationList()
          }
          if (eventName === 'delta') {
            state.loadingStageText = '正在生成讲解'
            rawAssistantContent += payload.content || ''
            assistantMessage.content = rawAssistantContent
            refreshMessages()
          }
          if (eventName === 'done') {
            state.loadingStageText = ''
            const idx = state.messages.findIndex(item => item.id === localAssistantId)
            if (idx >= 0 && payload.assistant_message) {
              state.messages[idx] = payload.assistant_message
            }
            state.currentConversation = normalizeConversation(payload.conversation || state.currentConversation)
          }
          if (eventName === 'error') {
            streamHadError = true
            errorMessage = payload.message || 'AI 生成失败，请稍后再试'
          }
        },
      })

      if (streamHadError) {
        assistantMessage.content = errorMessage
        rawAssistantContent = errorMessage
        showToast(errorMessage, 'error')
      } else {
        await loadConversationsAfterSend()
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        showToast('已停止生成', 'warning')
      } else {
        state.messages = state.messages.filter(item => item.id !== localAssistantId && item.id !== localUserId)
        if (!regenerate) state.inputDraft = text
        if (!regenerate) state.pendingImages = images
        if (!regenerate) state.knowledgeBaseRefs = knowledgeBaseRefs
        if (!regenerate) state.agentRefs = agentRefs
        showToast(err.message || '消息发送失败，请稍后重试', 'error')
      }
    } finally {
      state.generating = Boolean(state.currentRun && ['pending', 'running'].includes(state.currentRun.status))
      if (!state.generating) state.loadingStageText = ''
      state.abortController = null
      state.messages = state.messages.map(item => item.id === localAssistantId ? { ...item, streaming: false } : item)
      rerender()
    }
  }

  async function stopGeneration() {
    if (!state.generating) return
    if (state.currentRun?.runId && ['pending', 'running'].includes(state.currentRun.status)) {
      try {
        const response = await cancelSubjectChatRun(state.currentRun.runId)
        applyRun(response.data)
        state.runStreamController?.abort()
        state.generating = false
        const assistant = state.messages.find(item => item.id === state.runAssistantLocalId)
        if (assistant) assistant.streaming = false
        rerender()
      } catch (error) {
        showToast(error.message || '停止生成失败', 'error')
      }
      return
    }
    state.abortController?.abort()
  }

  async function clearCurrentConversation() {
    if (!state.currentId || state.generating) return
    if (!window.confirm('确定清空当前对话吗？')) return
    try {
      const res = await clearAiChatMessages(state.currentId)
      state.messages = []
      resetRunState()
      state.currentConversation = normalizeConversation(res.data || state.currentConversation)
      await loadConversationsAfterSend()
      showToast('当前对话已清空', 'success')
      rerender()
    } catch (err) {
      showToast(err.message || '清空失败，请稍后重试', 'error')
    }
  }

  async function deleteConversation(id) {
    if (state.generating) return
    if (!window.confirm('确定删除这个会话吗？删除后不可恢复。')) return
    try {
      await deleteAiChatConversation(id)
      state.conversations = state.conversations.filter(item => item.id !== Number(id))
      if (state.currentId === Number(id)) {
        resetRunState()
        state.currentId = null
        state.currentConversation = null
        state.messages = []
        state.pendingAction = null
      }
      showToast('会话已删除', 'success')
      rerender()
    } catch (err) {
      showToast(err.message || '删除会话失败', 'error')
    }
  }

  function bindConversationEvents() {
    document.querySelectorAll('.conversation-item').forEach(item => {
      item.addEventListener('click', (event) => {
        if (event.target.closest('[data-delete-id],[data-rename-id],[data-ai-history-select]')) return
        if (state.historyMulti) {
          const id = Number(item.dataset.id)
          state.historySelected.has(id) ? state.historySelected.delete(id) : state.historySelected.add(id)
          refreshConversationList()
          return
        }
        selectConversation(item.dataset.id)
      })
      item.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (state.historyMulti) {
          const id = Number(item.dataset.id)
          state.historySelected.has(id) ? state.historySelected.delete(id) : state.historySelected.add(id)
          refreshConversationList()
          return
        }
        selectConversation(item.dataset.id)
      })
    })
    document.querySelectorAll('[data-delete-id]').forEach(button => {
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        deleteConversation(button.dataset.deleteId)
      })
    })
    document.querySelectorAll('[data-rename-id]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation()
      void renameConversation(button.dataset.renameId)
    }))
    document.querySelectorAll('[data-ai-history-select]').forEach(input => input.addEventListener('change', event => {
      event.stopPropagation()
      const id = Number(input.dataset.aiHistorySelect)
      input.checked ? state.historySelected.add(id) : state.historySelected.delete(id)
    }))
  }

  function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', () => changeMode(button.dataset.mode))
    })
    document.getElementById('ai-course-select')?.addEventListener('change', event => changeCourse(event.target.value))
    document.getElementById('ai-agent-select')?.addEventListener('change', event => changeAgent(event.target.value))
    document.getElementById('btn-new-conversation')?.addEventListener('click', startDraftConversation)
    document.getElementById('btn-toggle-history')?.addEventListener('click', toggleHistoryPanel)
    document.getElementById('btn-retry-conversations')?.addEventListener('click', () => loadConversations(false))
    document.getElementById('btn-stop-generation')?.addEventListener('click', stopGeneration)
    document.getElementById('btn-regenerate')?.addEventListener('click', () => sendCurrentMessage({ regenerate: true }))
    document.getElementById('btn-clear-current')?.addEventListener('click', clearCurrentConversation)
    document.getElementById('btn-rename-current')?.addEventListener('click', () => renameConversation(state.currentId))
    document.getElementById('btn-ai-history-multi')?.addEventListener('click', () => { state.historyMulti = true; state.historySelected.clear(); rerender() })
    document.getElementById('btn-ai-history-cancel')?.addEventListener('click', () => { state.historyMulti = false; state.historySelected.clear(); rerender() })
    document.getElementById('btn-ai-history-all')?.addEventListener('click', () => { filteredConversations(state).forEach(item => state.historySelected.add(Number(item.id))); rerender() })
    document.getElementById('btn-ai-history-clear')?.addEventListener('click', () => bulkManageHistory('CLEAR_MESSAGES'))
    document.getElementById('btn-ai-history-delete')?.addEventListener('click', () => bulkManageHistory('DELETE'))

    const search = document.getElementById('conversation-search')
    search?.addEventListener('input', event => {
      state.keyword = event.target.value
      refreshConversationList()
    })
    document.getElementById('ai-history-mode')?.addEventListener('change', event => { state.historyMode = event.target.value; refreshConversationList() })
    document.getElementById('ai-history-subject')?.addEventListener('change', event => { state.historySubject = event.target.value; refreshConversationList() })
    document.getElementById('ai-history-date')?.addEventListener('change', event => { state.historyDate = event.target.value; refreshConversationList() })

    const subjectComposerRoot = document.getElementById('subject-unified-composer')
    if (subjectComposerRoot) {
      subjectComposer = createUnifiedComposer({
        root: subjectComposerRoot,
        initialValue: state.inputDraft,
        knowledgeBases: state.mentionKnowledgeBases,
        agents: state.callableAgents,
        knowledgeBaseRefs: state.knowledgeBaseRefs,
        agentRefs: state.agentRefs,
        attachments: state.pendingImages,
        maxLength: MAX_INPUT_LENGTH,
        placeholder: state.mode === 'subject' ? '输入学科问题；@ 引用知识库，\\ 调用智能体' : '输入学习问题；@ 引用知识库，\\ 调用智能体',
        mountToolbarExtension: host => {
          const controls = createSearchControls(host, {
            value: state.searchOptions,
            capabilities: state.capabilities,
            onChange: value => { state.searchOptions = value },
          })
          controls.setBusy(state.generating)
          return controls
        },
        onDraftChange: payload => {
          state.inputDraft = payload.content
          state.pendingImages = payload.attachments || []
          state.knowledgeBaseRefs = payload.knowledgeBaseRefs
          state.agentRefs = payload.agentRefs
        },
        onContextChange: payload => {
          state.knowledgeBaseRefs = payload.knowledgeBaseRefs
          state.agentRefs = payload.agentRefs
        },
        onSubmit: async payload => {
          state.inputDraft = payload.content
          state.pendingImages = payload.attachments || []
          state.knowledgeBaseRefs = payload.knowledgeBaseRefs
          state.agentRefs = payload.agentRefs
          await sendCurrentMessage()
        },
        onStop: stopGeneration,
        onUpload: async file => {
          const response = await uploadAiChatAttachment(file, state.currentId)
          return response.data || response
        },
        onNotice: message => showToast(message, 'warning'),
      })
      subjectComposer.setBusy(state.generating)
    }

    const input = document.getElementById('chat-input')
    autoResizeInput(input)
    input?.addEventListener('input', () => updateInputState(input))
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        sendCurrentMessage()
      }
    })
    input?.addEventListener('paste', event => {
      const imageFiles = Array.from(event.clipboardData?.items || [])
        .filter(item => item.type?.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean)
      if (imageFiles.length) { event.preventDefault(); void addImageFiles(imageFiles) }
    })
    input?.addEventListener('dragover', event => { event.preventDefault(); input.classList.add('drag-active') })
    input?.addEventListener('dragleave', () => input.classList.remove('drag-active'))
    input?.addEventListener('drop', event => {
      event.preventDefault()
      input.classList.remove('drag-active')
      void addImageFiles(event.dataTransfer?.files)
    })
    document.getElementById('btn-add-image')?.addEventListener('click', () => document.getElementById('ai-image-input')?.click())
    document.getElementById('ai-image-input')?.addEventListener('change', event => { void addImageFiles(event.target.files) })
    document.getElementById('btn-voice-input')?.addEventListener('click', toggleVoiceInput)
    document.querySelectorAll('[data-remove-image]').forEach(button => button.addEventListener('click', () => {
      state.pendingImages = state.pendingImages.filter(image => image.id !== button.dataset.removeImage)
      rerender()
    }))
    document.getElementById('btn-send-message')?.addEventListener('click', () => sendCurrentMessage())

    bindStarterQuestionEvents()

    bindConversationEvents()
    bindRunEvents()
    bindMessageScrollTracking()
  }

  async function renameConversation(id) {
    if (state.generating) return
    const current = normalizeConversation(state.conversations.find(item => Number(item.id) === Number(id)))
    const title = window.prompt('输入新的会话名称', current?.title || '新对话')?.trim()
    if (!title || title === current?.title) return
    try {
      const response = await renameAiChatConversation(id, title)
      const updated = normalizeConversation(response.data)
      state.conversations = state.conversations.map(item => Number(item.id) === Number(id) ? { ...normalizeConversation(item), ...updated } : item)
      if (state.currentId === Number(id)) state.currentConversation = { ...state.currentConversation, ...updated }
      showToast('会话已重命名', 'success')
      rerender()
    } catch (error) { showToast(error.message || '重命名失败', 'error') }
  }

  async function bulkManageHistory(action) {
    const ids = [...state.historySelected]
    if (!ids.length) { showToast('请先选择会话', 'warning'); return }
    const deleting = action === 'DELETE'
    if (!window.confirm(deleting ? '确认删除所选会话吗？关联文件不会被静默删除。' : '确认清空所选会话中的全部消息吗？')) return
    try {
      await bulkManageAiChatConversations({ conversationIds: ids, action })
      if (deleting) state.conversations = state.conversations.filter(item => !state.historySelected.has(Number(item.id)))
      if (state.currentId && state.historySelected.has(state.currentId)) {
        resetRunState(); state.messages = []
        if (deleting) { state.currentId = null; state.currentConversation = null }
      }
      state.historySelected.clear(); state.historyMulti = false
      showToast(deleting ? '所选会话已删除' : '所选会话已清空', 'success')
      if (!deleting) await loadConversations(false)
      else rerender()
    } catch (error) { showToast(error.message || '批量操作失败', 'error') }
  }

  bindEvents()
  initializeAiPathLoaders(document)
  if (window.__discimindOpenGeneralAiChatHandler) {
    window.removeEventListener('discimind:open-general-ai-chat', window.__discimindOpenGeneralAiChatHandler)
  }
  window.__discimindOpenGeneralAiChatHandler = () => openGeneralDraft({ focus: true })
  window.addEventListener('discimind:open-general-ai-chat', window.__discimindOpenGeneralAiChatHandler)
  void loadStarterQuestions()
  await loadConversations(!openGeneralDraftOnLoad)
  const artifactTaskController = new AbortController()
  let artifactTaskSignature = ''
  let refreshingArtifacts = false
  window.addEventListener('hashchange', () => artifactTaskController.abort(), { once: true })
  void streamTasks({
    signal: artifactTaskController.signal,
    onTasks: async payload => {
      const relevantIds = new Set([
        ...state.messages.flatMap(message => (message.agentInvocations || []).flatMap(invocation => invocation.taskIds || [])).map(Number),
        Number(state.pendingAction?.taskId || state.pendingAction?.id),
      ].filter(Number.isInteger))
      if (!relevantIds.size || !state.currentId) return
      const relevant = (payload.list || []).filter(task => relevantIds.has(Number(task.id)))
      const signature = relevant.map(task => `${task.id}:${task.status}:${task.progress}:${task.updatedAt || ''}`).join('|')
      if (!signature || signature === artifactTaskSignature || refreshingArtifacts) return
      artifactTaskSignature = signature
      refreshingArtifacts = true
      try {
        const messages = await getAiChatMessages(state.currentId)
        state.messages = await hydrateMessages(messages.data?.messages || state.messages)
        await refreshPendingAction()
        refreshMessages()
      } finally { refreshingArtifacts = false }
    },
  }).catch(error => { if (error.name !== 'AbortError') console.warn('[ai-chat-artifact-stream]', error.message) })
}
