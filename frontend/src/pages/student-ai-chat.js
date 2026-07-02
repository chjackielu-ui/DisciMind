import { getMe } from '../api/auth.js'
import {
  createAiChatConversation,
  getAiChatConversations,
  getAiChatStarterQuestions,
  getAiChatMessages,
  streamAiChatMessage,
  clearAiChatMessages,
  deleteAiChatConversation,
} from '../api/student.js'
import { getUser, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatRelativeTime, truncate } from '../utils/format.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js'
import { showToast } from '../utils/toast.js'
import { disposeAllCharts } from '../utils/echarts.js'

const MAX_INPUT_LENGTH = 2000

const MODES = [
  { value: 'general', label: '通用学习助手', desc: '课程概念、复习、代码学习、论文入门' },
  { value: 'subject', label: '学科专属助手', desc: '围绕指定课程展开答疑' },
  { value: 'agent', label: 'Agent 专属助手', desc: '按任务目标输出结构化结果' },
]

const SUBJECTS = [
  { value: 'machine_learning', label: '机器学习' },
  { value: 'operating_system', label: '操作系统' },
  { value: 'web_frontend', label: 'Web 前端' },
  { value: 'probability', label: '概率论' },
  { value: 'database', label: '数据库' },
  { value: 'computer_network', label: '计算机网络' },
  { value: 'software_engineering', label: '软件工程' },
]

const AGENTS = [
  { value: 'knowledge_explain', label: '知识点讲解 Agent' },
  { value: 'wrong_question_analysis', label: '错题解析 Agent' },
  { value: 'study_path_planning', label: '学习路径规划 Agent' },
  { value: 'review_plan', label: '复习计划 Agent' },
  { value: 'coding_learning', label: '编程学习 Agent' },
]

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

function modeLabel(mode) {
  return MODES.find(item => item.value === mode)?.label || '通用学习助手'
}

function subjectLabel(subject) {
  return SUBJECTS.find(item => item.value === subject)?.label || '未选择学科'
}

function agentLabel(agentType) {
  return AGENTS.find(item => item.value === agentType)?.label || '未选择 Agent'
}

function starterContextKey(context) {
  const mode = context?.mode || 'general'
  if (mode === 'subject') return `subject:${context.subject || 'machine_learning'}`
  if (mode === 'agent') return `agent:${context.agentType || context.agent_type || 'knowledge_explain'}`
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
  return `
    <section class="ai-mode-panel">
      <div class="ai-mode-cards" role="list">
        ${MODES.map(mode => `
          <button class="ai-mode-card${state.mode === mode.value ? ' active' : ''}" data-mode="${mode.value}" ${state.generating ? 'disabled' : ''}>
            <span>${escapeHtml(mode.label)}</span>
            <small>${escapeHtml(mode.desc)}</small>
          </button>
        `).join('')}
      </div>
      <div class="ai-mode-selectors">
        <label class="${state.mode === 'subject' ? '' : 'is-hidden'}">
          <span>学科选择</span>
          <select class="complex-select" id="ai-subject-select" ${state.generating ? 'disabled' : ''}>
            ${SUBJECTS.map(item => `<option value="${item.value}" ${state.subject === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
        <label class="${state.mode === 'agent' ? '' : 'is-hidden'}">
          <span>Agent 选择</span>
          <select class="complex-select" id="ai-agent-select" ${state.generating ? 'disabled' : ''}>
            ${AGENTS.map(item => `<option value="${item.value}" ${state.agentType === item.value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
      </div>
    </section>
  `
}

function buildConversationList(state) {
  if (state.loadingConversations) {
    return `<div class="complex-loading ai-compact-state"><div class="complex-spinner"></div><p>正在加载会话...</p></div>`
  }
  if (state.conversationError) {
    return `<div class="complex-error ai-compact-state"><h3>会话加载失败</h3><p>${escapeHtml(state.conversationError)}</p><button class="complex-btn-secondary" id="btn-retry-conversations">重试</button></div>`
  }

  const keyword = (state.keyword || '').trim().toLowerCase()
  const list = keyword
    ? state.conversations.filter(item => `${item.title || ''} ${item.last_message?.content_preview || ''}`.toLowerCase().includes(keyword))
    : state.conversations

  if (!list.length) {
    return `<div class="complex-empty ai-compact-state"><h3>暂无会话</h3><p>点击新建对话开始。</p></div>`
  }

  return `<div class="conversation-list ai-conversation-list">
    ${list.map(raw => {
      const conversation = normalizeConversation(raw)
      return `<div class="conversation-item${state.currentId === conversation.id ? ' active' : ''}" data-id="${conversation.id}">
        <div class="conversation-title-row">
          <b>${escapeHtml(conversation.title || '新对话')}</b>
          <button class="btn-delete-conv" data-delete-id="${conversation.id}" title="删除会话">×</button>
        </div>
        <p>${escapeHtml(conversationModeLabel(conversation))}</p>
        <p>${escapeHtml(truncate(conversation.last_message?.content_preview || '还没有消息', 42))}</p>
        <p>${formatRelativeTime(conversation.updated_at || conversation.created_at)}</p>
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

  return state.messages.map(message => {
    const role = String(message.role || '').toLowerCase()
    const isUser = role === 'user'
    const isStreaming = Boolean(message.streaming)
    const content = String(message.content || '')
    return `<div class="message-row ${isUser ? 'user' : 'assistant'}${isStreaming ? ' streaming' : ''}" data-message-id="${escapeHtml(message.id || message.message_id || '')}">
      <div class="message-bubble ai-message-bubble">
        ${!isUser ? '<div class="message-meta">学科答疑小助手</div>' : ''}
        <div class="message-markdown">${content ? renderMarkdownToHtml(content) : (isStreaming ? '<p class="thinking-text">正在思考中...</p>' : '<p></p>')}</div>
      </div>
    </div>`
  }).join('')
}

function buildShell(state) {
  const currentTitle = state.currentConversation?.title || '新对话'
  const currentMode = state.mode === 'subject'
    ? subjectLabel(state.subject)
    : state.mode === 'agent'
      ? agentLabel(state.agentType)
      : modeLabel(state.mode)

  return `
    <div class="complex-shell ai-chat-shell">
      <section class="complex-hero ai-chat-hero">
        <div>
          <h1>学科答疑小助手</h1>
          <p>基于学习场景的多模式 AI 答疑 Agent，支持学科问答、错题解析与学习路径建议。</p>
        </div>
        <div class="ai-hero-meta">
          <span>${escapeHtml(currentMode)}</span>
          <span>DeepSeek 流式答疑</span>
        </div>
      </section>

      ${renderModePanel(state)}

      <div class="ai-chat-workbench">
        <aside class="chat-side ai-history-panel">
          <button class="complex-btn" id="btn-new-conversation" style="width:100%;" ${state.generating ? 'disabled' : ''}>新建对话</button>
          <input class="complex-input" id="conversation-search" placeholder="搜索会话" style="margin-top:10px;" value="${escapeHtml(state.keyword || '')}">
          <div id="conversation-list-host">${buildConversationList(state)}</div>
        </aside>

        <main class="chat-main ai-chat-main">
          <div class="chat-main-head ai-chat-main-head">
            <div class="ai-chat-title-block">
              <h2 class="complex-section-title">${escapeHtml(currentTitle)}</h2>
              <span class="status-pill success">${escapeHtml(currentMode)}</span>
            </div>
            <div class="complex-actions ai-chat-actions">
              <button class="complex-btn-ghost" id="btn-regenerate" ${state.generating || !state.messages.some(m => String(m.role).toLowerCase() === 'user') ? 'disabled' : ''}>重新生成</button>
              <button class="complex-btn-ghost" id="btn-clear-current" ${state.generating || !state.currentId ? 'disabled' : ''}>清空当前对话</button>
              <button class="complex-btn-danger" id="btn-stop-generation" ${state.generating ? '' : 'disabled'}>停止生成</button>
            </div>
          </div>

          <div class="chat-messages ai-chat-messages" id="ai-chat-messages-host">${buildMessages(state)}</div>

          <div class="chat-input-area ai-chat-input-area">
            ${buildStarterQuestionRow(state)}
            <div class="chat-input-row ai-chat-input-row">
              <textarea class="complex-textarea" id="chat-input" maxlength="${MAX_INPUT_LENGTH}" placeholder="输入学习相关问题，Enter 发送，Shift + Enter 换行" ${state.generating ? 'disabled' : ''}>${escapeHtml(state.inputDraft || '')}</textarea>
              <button class="complex-btn" id="btn-send-message" ${state.generating || !String(state.inputDraft || '').trim() ? 'disabled' : ''}>${state.generating ? '生成中' : '发送'}</button>
            </div>
            <div class="ai-input-foot">
              <span id="input-count">${String(state.inputDraft || '').length}/${MAX_INPUT_LENGTH}</span>
              <span>AI 生成内容仅供学习参考，请结合课程资料核对。</span>
            </div>
          </div>
        </main>
      </div>
    </div>`
}

export async function renderStudentAiChat(app) {
  disposeAllCharts()
  const user = await getAuthedUser()
  if (!user) return

  const state = {
    conversations: [],
    messages: [],
    currentId: null,
    currentConversation: null,
    mode: 'general',
    subject: 'machine_learning',
    agentType: 'knowledge_explain',
    keyword: '',
    inputDraft: '',
    starterQuestions: fallbackStarterQuestions({ mode: 'general', subject: 'machine_learning', agentType: 'knowledge_explain' }),
    starterQuestionKey: 'general',
    loadingStarterQuestions: false,
    loadingConversations: true,
    loadingMessages: false,
    generating: false,
    abortController: null,
    conversationError: '',
    messageError: '',
  }

  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, contentHTML: buildShell(state), user })
  let starterRequestSeq = 0

  function syncModeFromConversation(conversation) {
    if (!conversation) return
    state.mode = conversation.mode || 'general'
    state.subject = conversation.subject || 'machine_learning'
    state.agentType = conversation.agent_type || conversation.agentType || 'knowledge_explain'
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

  function scrollMessages() {
    requestAnimationFrame(() => {
      const host = document.getElementById('ai-chat-messages-host')
      if (host) host.scrollTop = host.scrollHeight
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
  }

  function hydrateMessageContent(root = document) {
    bindMessageActions(root)
    renderMathInMarkdownElements(root)
  }

  function refreshMessages() {
    const host = document.getElementById('ai-chat-messages-host')
    if (!host) return
    host.innerHTML = buildMessages(state)
    hydrateMessageContent(host)
    scrollMessages()
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
        const inputEl = document.getElementById('chat-input')
        if (!inputEl || state.generating) return
        inputEl.value = button.dataset.question || ''
        updateInputState(inputEl)
        inputEl.focus()
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
    if (sendButton) sendButton.disabled = state.generating || !state.inputDraft.trim()
    if (count) count.textContent = `${state.inputDraft.length}/${MAX_INPUT_LENGTH}`
  }

  function rerender() {
    const main = document.getElementById('student-main')
    if (!main) return
    applyStarterContext()
    main.innerHTML = buildShell(state)
    bindEvents()
    hydrateMessageContent(main)
    scrollMessages()
  }

  async function loadConversations(selectFirst = true) {
    state.loadingConversations = true
    state.conversationError = ''
    refreshConversationList()
    try {
      const res = await getAiChatConversations({ page_size: 50 })
      state.conversations = (res.data?.list || []).map(normalizeConversation)
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
    state.currentId = Number(id)
    state.currentConversation = normalizeConversation(state.conversations.find(item => item.id === state.currentId))
    syncModeFromConversation(state.currentConversation)
    state.loadingMessages = true
    state.messageError = ''
    state.messages = []
    if (rerenderBefore) rerender()

    try {
      const res = await getAiChatMessages(state.currentId)
      state.currentConversation = normalizeConversation(res.data?.conversation || state.currentConversation)
      syncModeFromConversation(state.currentConversation)
      state.messages = res.data?.messages || []
    } catch (err) {
      state.messageError = err.message || '消息加载失败'
      showToast(state.messageError, 'error')
    } finally {
      state.loadingMessages = false
      applyStarterContext()
      rerender()
      void loadStarterQuestions()
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
    state.currentId = null
    state.currentConversation = null
    state.messages = []
    state.loadingMessages = false
    state.messageError = ''
    if (clearInput) state.inputDraft = ''
    applyStarterContext()
    rerender()
    void loadStarterQuestions()
  }

  function startDraftConversation() {
    resetForModeChange({ clearInput: true })
    showToast('已准备新对话，发送后会保存', 'success')
  }

  function changeMode(nextMode) {
    if (state.generating || state.mode === nextMode) return
    state.mode = nextMode
    if (nextMode === 'subject' && !state.subject) state.subject = 'machine_learning'
    if (nextMode === 'agent' && !state.agentType) state.agentType = 'knowledge_explain'
    resetForModeChange()
  }

  function changeSubject(nextSubject) {
    if (state.generating || state.subject === nextSubject) return
    state.mode = 'subject'
    state.subject = nextSubject
    resetForModeChange()
  }

  function changeAgent(nextAgent) {
    if (state.generating || state.agentType === nextAgent) return
    state.mode = 'agent'
    state.agentType = nextAgent
    resetForModeChange()
  }

  async function loadConversationsAfterSend() {
    try {
      const res = await getAiChatConversations({ page_size: 50 })
      state.conversations = (res.data?.list || []).map(normalizeConversation)
      state.currentConversation = normalizeConversation(state.conversations.find(item => item.id === state.currentId)) || state.currentConversation
    } catch {
      // 会话列表刷新失败不影响当前流式回答展示
    }
  }

  function replaceLocalMessage(localId, serverMessage) {
    const idx = state.messages.findIndex(item => item.id === localId)
    if (idx >= 0 && serverMessage) {
      state.messages[idx] = serverMessage
    }
  }

  async function sendCurrentMessage({ regenerate = false } = {}) {
    if (state.generating) return

    const text = String(state.inputDraft || '').trim()
    if (!regenerate && !text) {
      showToast('请输入问题后再发送', 'warning')
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
        created_at: new Date().toISOString(),
      })
      state.inputDraft = ''
    }

    const assistantMessage = {
      id: localAssistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      created_at: new Date().toISOString(),
    }
    state.messages.push(assistantMessage)
    state.generating = true
    state.abortController = new AbortController()
    rerender()

    try {
      await streamAiChatMessage(conversationId, regenerate ? { regenerate: true } : { content: text }, {
        signal: state.abortController.signal,
        onEvent: (eventName, payload) => {
          if (eventName === 'meta') {
            state.currentConversation = normalizeConversation(payload.conversation || state.currentConversation)
            if (payload.user_message) replaceLocalMessage(localUserId, payload.user_message)
            refreshConversationList()
          }
          if (eventName === 'delta') {
            rawAssistantContent += payload.content || ''
            assistantMessage.content = rawAssistantContent
            refreshMessages()
          }
          if (eventName === 'done') {
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
        showToast(err.message || '消息发送失败，请稍后重试', 'error')
      }
    } finally {
      state.generating = false
      state.abortController = null
      state.messages = state.messages.map(item => item.id === localAssistantId ? { ...item, streaming: false } : item)
      rerender()
    }
  }

  function stopGeneration() {
    if (!state.generating || !state.abortController) return
    state.abortController.abort()
  }

  async function clearCurrentConversation() {
    if (!state.currentId || state.generating) return
    if (!window.confirm('确定清空当前对话吗？')) return
    try {
      const res = await clearAiChatMessages(state.currentId)
      state.messages = []
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
        state.currentId = null
        state.currentConversation = null
        state.messages = []
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
        if (event.target.closest('[data-delete-id]')) return
        selectConversation(item.dataset.id)
      })
    })
    document.querySelectorAll('[data-delete-id]').forEach(button => {
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        deleteConversation(button.dataset.deleteId)
      })
    })
  }

  function bindEvents() {
    document.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', () => changeMode(button.dataset.mode))
    })
    document.getElementById('ai-subject-select')?.addEventListener('change', event => changeSubject(event.target.value))
    document.getElementById('ai-agent-select')?.addEventListener('change', event => changeAgent(event.target.value))
    document.getElementById('btn-new-conversation')?.addEventListener('click', startDraftConversation)
    document.getElementById('btn-retry-conversations')?.addEventListener('click', () => loadConversations(false))
    document.getElementById('btn-stop-generation')?.addEventListener('click', stopGeneration)
    document.getElementById('btn-regenerate')?.addEventListener('click', () => sendCurrentMessage({ regenerate: true }))
    document.getElementById('btn-clear-current')?.addEventListener('click', clearCurrentConversation)

    const search = document.getElementById('conversation-search')
    search?.addEventListener('input', event => {
      state.keyword = event.target.value
      refreshConversationList()
    })

    const input = document.getElementById('chat-input')
    autoResizeInput(input)
    input?.addEventListener('input', () => updateInputState(input))
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        sendCurrentMessage()
      }
    })
    document.getElementById('btn-send-message')?.addEventListener('click', () => sendCurrentMessage())

    bindStarterQuestionEvents()

    bindConversationEvents()
  }

  bindEvents()
  void loadStarterQuestions()
  await loadConversations(true)
}
