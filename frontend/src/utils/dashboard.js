// Dashboard 共享布局 — 悬浮式左侧导航栏 + 主内容区
// v2: 统一 SVG 图标、优化对齐、菜单 hash 导航

import { getUserDisplayName, logoutSession } from './auth.js'
import { getIcon, iconMessage, iconPin, iconPinFilled, iconLogout } from './icons.js'
import { createAiChatConversation, streamAiChatMessage } from '../api/student.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from './markdown.js'

const ROLE_LABEL = { admin: '管理员', teacher: '教师', student: '学生' }
const API_ORIGIN = 'http://localhost:3000'
const STUDENT_SIDEBAR_FIRST_VISIT_KEY = 'discimind.studentSidebarFirstVisitSeen'
const AI_FLOAT_STATE_KEY = 'discimind.studentAiFloatState'
const AI_FLOAT_EDGE_MARGIN = 18
const AI_FLOAT_MAX_INPUT = 2000

let sidebarExpanded = true
let sidebarPinned = false
let isHoveringSidebar = false
let collapseTimer = null
let autoCollapseTimer = null

export function renderDashboardLayout(app, config) {
  const { menuItems, contentHTML, user } = config
  const displayName = getUserDisplayName()
  const roleLabel = ROLE_LABEL[user.role] || user.role
  const avatarUrl = getAvatarUrl(user)

  sidebarExpanded = shouldExpandSidebarInitially(user)
  sidebarPinned = false
  isHoveringSidebar = false
  if (collapseTimer) clearTimeout(collapseTimer)
  if (autoCollapseTimer) clearTimeout(autoCollapseTimer)
  setBasicStudentPageContext()

  // 构建菜单 HTML（使用 SVG 图标）
  const currentHash = window.location.hash.slice(1) || ''
  const menuHTML = menuItems.map((item) => {
    const iconSVG = getIcon(item.icon)
    const itemId = getMenuItemId(item)
    // 精确匹配：优先使用 item.matchHash 函数，否则精确比较 hash
    let isActive = false
    if (typeof item.matchHash === 'function') {
      isActive = item.matchHash(currentHash)
    } else if (item.hash) {
      const itemPath = item.hash.startsWith('#') ? item.hash.slice(1) : item.hash
      isActive = currentHash === itemPath
    }
    return `
      <button type="button" class="sidebar-menu-item${isActive ? ' active' : ''}" data-menu-id="${escapeHtml(itemId)}" data-hash="${escapeHtml(item.hash || '')}" aria-current="${isActive ? 'page' : 'false'}" title="${escapeHtml(item.label)}">
        <span class="sidebar-menu-icon">${iconSVG}</span>
        <span class="sidebar-menu-text">${escapeHtml(item.label)}</span>
        <span class="menu-tooltip">${escapeHtml(item.label)}</span>
      </button>`
  }).join('')

  const roleClass = user?.role === 'teacher' ? ' role-teacher' : user?.role === 'admin' ? ' role-admin' : ''

  app.innerHTML = `
    <div class="student-dashboard-wrapper${roleClass}">
      <nav class="student-sidebar ${sidebarExpanded ? 'expanded' : 'collapsed'}" id="student-sidebar" style="--sidebar-menu-count:${Math.max(1, menuItems.length)}">
        <div class="sidebar-brand">
          <div class="sidebar-brand-mark">
            <img src="/logo.png" alt="DisciMind" />
          </div>
          <div class="sidebar-brand-text">
            <span class="sidebar-brand-cn">学研智擎</span>
            <span class="sidebar-brand-en">DisciMind</span>
          </div>
        </div>

        <div class="sidebar-menu-wrap" id="sidebar-menu-wrap">${menuHTML}</div>

        <div class="sidebar-footer">
          <button class="sidebar-pin-btn" id="sidebar-pin-btn" title="固定展开">
            <span class="pin-icon-svg">${iconPin()}</span>
            <span class="pin-text">固定展开</span>
          </button>
          <div class="sidebar-user-info" id="sidebar-user-info" title="个人主页">
            <div class="sidebar-user-avatar">
              ${avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}" />`
                : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>`}
            </div>
            <div class="sidebar-user-detail">
              <span class="sidebar-user-name">${escapeHtml(displayName)}</span>
              <span class="sidebar-user-role">${roleLabel}</span>
            </div>
          </div>
          <button class="sidebar-logout-btn" id="btn-logout" title="退出登录">
            <span class="logout-icon-svg">${iconLogout()}</span>
            <span class="logout-text">退出登录</span>
          </button>
        </div>
      </nav>

      <main class="student-main" id="student-main">${contentHTML}</main>
      ${renderStudentAiFloat(user)}
    </div>
  `

  // 侧边栏交互
  const sidebar = document.getElementById('student-sidebar')
  const pinBtn = document.getElementById('sidebar-pin-btn')

  function expandSidebar() {
    if (!sidebar) return
    sidebar.classList.remove('collapsed'); sidebar.classList.add('expanded')
    sidebarExpanded = true
    updateWrapperState()
  }
  function collapseSidebar() {
    if (!sidebar) return
    if (sidebarPinned || isHoveringSidebar) return
    sidebar.classList.remove('expanded'); sidebar.classList.add('collapsed')
    sidebarExpanded = false
    updateWrapperState()
  }

  // 同步 wrapper 状态类，供侧栏状态样式使用；主内容区保持固定折叠栏留白。
  function updateWrapperState() {
    const wrapper = document.querySelector('.student-dashboard-wrapper')
    if (!wrapper) return
    if (sidebarExpanded || sidebarPinned) {
      wrapper.classList.add('sidebar-expanded')
      wrapper.classList.remove('sidebar-collapsed')
    } else {
      wrapper.classList.add('sidebar-collapsed')
      wrapper.classList.remove('sidebar-expanded')
    }
  }
  // 初始设置
  updateWrapperState()

  if (sidebar) {
    sidebar.addEventListener('mouseenter', () => { isHoveringSidebar = true; if (collapseTimer) clearTimeout(collapseTimer); expandSidebar() })
    sidebar.addEventListener('mouseleave', () => { isHoveringSidebar = false; collapseTimer = setTimeout(collapseSidebar, 600) })
  }

  if (pinBtn) {
    pinBtn.addEventListener('click', () => {
      sidebarPinned = !sidebarPinned
      if (sidebarPinned) { pinBtn.classList.add('pinned'); pinBtn.querySelector('.pin-icon-svg').innerHTML = iconPinFilled(); expandSidebar() }
      else { pinBtn.classList.remove('pinned'); pinBtn.querySelector('.pin-icon-svg').innerHTML = iconPin(); if (!isHoveringSidebar) { clearTimeout(collapseTimer); collapseTimer = setTimeout(collapseSidebar, 400) } }
      updateWrapperState()
    })
  }

  let scrollTicking = false
  window.addEventListener('scroll', () => {
    if (!scrollTicking) { window.requestAnimationFrame(() => { if (!isHoveringSidebar && !sidebarPinned && sidebarExpanded) collapseSidebar(); scrollTicking = false }); scrollTicking = true }
  }, { passive: true })

  window.addEventListener('resize', () => { if (window.innerWidth <= 768 && sidebarExpanded && !sidebarPinned && !isHoveringSidebar) collapseSidebar() }, { passive: true })

  autoCollapseTimer = setTimeout(() => { if (!isHoveringSidebar && !sidebarPinned && sidebarExpanded) collapseSidebar() }, 2500)

  // 退出
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    resetStudentSidebarFirstVisit()
    await logoutSession()
    window.location.hash = '#/login'
  })

  // 用户信息入口
  document.getElementById('sidebar-user-info')?.addEventListener('click', () => {
    if (user.role === 'student') window.location.hash = '#/student/profile'
  })

  // 菜单点击
  document.querySelectorAll('.sidebar-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-menu-item').forEach(i => i.classList.remove('active'))
      item.classList.add('active')
      const hash = item.dataset.hash
      if (hash) window.location.hash = hash
    })
  })

  initStudentAiFloat(user)
}

function getMenuItemId(item) {
  if (item?.id) return item.id
  const source = item?.hash || item?.label || 'menu-item'
  return String(source).replace(/^#/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'menu-item'
}

function shouldExpandSidebarInitially(user) {
  if (user?.role !== 'student') return true
  try {
    if (window.sessionStorage.getItem(STUDENT_SIDEBAR_FIRST_VISIT_KEY) === '1') return false
    const currentHash = window.location.hash.slice(1) || ''
    const isStudentLanding = currentHash === '/student/dashboard' || currentHash === '/student'
    window.sessionStorage.setItem(STUDENT_SIDEBAR_FIRST_VISIT_KEY, '1')
    return isStudentLanding
  } catch {
    return true
  }
}

function resetStudentSidebarFirstVisit() {
  try {
    window.sessionStorage.removeItem(STUDENT_SIDEBAR_FIRST_VISIT_KEY)
  } catch {}
}

function setBasicStudentPageContext() {
  if (typeof window === 'undefined') return
  const hash = window.location.hash.slice(1) || ''
  window.__discimindStudentPageContext = {
    type: 'page',
    page: hash,
  }
}

function getStudentPageContext() {
  return (typeof window !== 'undefined' && window.__discimindStudentPageContext) || {
    type: 'page',
    page: window.location.hash.slice(1) || '',
  }
}

function compactText(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function compactKpList(list = [], limit = 8) {
  return (Array.isArray(list) ? list : []).slice(0, limit).map((kp, index) => {
    const score = kp.mastery_score ?? kp.masteryScore ?? 0
    const chapter = kp.chapter_name || kp.chapterName || ''
    return `${index + 1}. ${kp.knowledge_point_name || kp.knowledgePointName || '知识点'}${chapter ? `（${chapter}）` : ''}：${score}分`
  }).join('\n') || '暂无'
}

function courseContextText(context = {}) {
  const course = context.course || {}
  if (!course.course_id && !course.course_name) return ''
  const selection = context.currentKnowledgePoint?.knowledge_point_name
    ? `\n当前选中知识点：${context.currentKnowledgePoint.knowledge_point_name}（${context.currentKnowledgePoint.mastery_score ?? 0}分，${context.currentKnowledgePoint.mastery_level || context.currentKnowledgePoint.status || 'unknown'}）`
    : ''
  return `当前课程：${course.course_name || '未知课程'}${course.course_code ? `（${course.course_code}）` : ''}
学习进度：${course.learning_progress ?? 0}%
知识点总数：${context.masterySummary?.total ?? course.knowledge_point_count ?? 0}
薄弱知识点：
${compactKpList(context.weakKnowledgePoints)}
已掌握知识点：
${compactKpList(context.masteredKnowledgePoints)}
学习中知识点：
${compactKpList(context.learningKnowledgePoints, 6)}
未学习知识点：
${compactKpList(context.unstartedKnowledgePoints, 6)}${selection}`
}

function normalizeQuestionFromContext(context = {}) {
  const wrong = context.wrongQuestion || null
  const question = context.question || null
  if (wrong) return {
    source: 'wrongQuestion',
    courseName: wrong.course_name || context.course?.course_name || '',
    knowledgePointName: wrong.knowledge_point_name || '',
    questionType: wrong.question_type || '',
    difficulty: wrong.difficulty_level || '',
    content: wrong.question_content || wrong.title || '',
    options: wrong.options || [],
    studentAnswer: wrong.last_wrong_answer || wrong.student_answer || '',
    correctAnswer: wrong.correct_answer || '',
    analysis: wrong.answer_analysis || '',
  }
  if (question) return {
    source: 'practiceQuestion',
    courseName: context.subject?.course_name || context.course?.course_name || '',
    knowledgePointName: context.knowledgePoint?.knowledge_point_name || context.knowledgePointName || '',
    questionType: question.question_type || '',
    difficulty: question.difficulty_level || '',
    content: question.question_content || question.content || question.title || '',
    options: question.options || [],
    studentAnswer: context.result?.student_answer ?? context.studentAnswer ?? '',
    correctAnswer: context.result?.correct_answer ?? question.correct_answer ?? '',
    analysis: context.result?.answer_analysis || context.result?.feedback || question.answer_analysis || '',
  }
  return null
}

function questionContextText(question) {
  if (!question) return ''
  const options = Array.isArray(question.options) && question.options.length
    ? question.options.map((option) => {
        const label = option.option_label || option.option_key || option.label || ''
        const content = option.option_content || option.content || ''
        return `${label}. ${compactText(content, 80)}`
      }).join('\n')
    : '无'
  return `课程：${question.courseName || '未知课程'}
知识点：${question.knowledgePointName || '未标注'}
题型：${question.questionType || '未知'}；难度：${question.difficulty || '未知'}
题干：${compactText(question.content, 420)}
选项：
${options}
学生答案：${compactText(question.studentAnswer, 220) || '未记录'}
正确答案：${compactText(question.correctAnswer, 220) || '未记录'}
已有解析：${compactText(question.analysis, 360) || '暂无'}`
}

function buildMiniSkillPayload(skill) {
  const context = getStudentPageContext()
  const courseText = courseContextText(context)
  const question = normalizeQuestionFromContext(context)
  const questionText = questionContextText(question)

  if (skill === 'review_focus') {
    if (!courseText) {
      return {
        displayText: '复习重点',
        content: '我想整理复习重点，但当前不在某一门课程的具体学习页面。请先说明需要我提供课程名称、课程页面或薄弱知识点数据，然后给出一个通用的课程复习重点整理模板。请用 Markdown 输出，必要时支持 LaTeX 公式。',
      }
    }
    return {
      displayText: '复习重点',
      content: `请基于以下课程学习数据，为我整理本课程的复习重点。需要优先关注薄弱知识点，同时说明已掌握知识点如何低成本保持。请用 Markdown 分层输出，必要时可使用 LaTeX 公式。

${courseText}`,
    }
  }

  if (skill === 'wrong_question') {
    if (!questionText) {
      return {
        displayText: '错题分析',
        action: { type: 'goWrongBook', label: '前往错题本', courseId: context.course?.course_id || context.subjectId || null },
        content: '我想做错题分析，但当前不处于某一道题的详情界面。请告诉我需要进入具体错题或提供题干、我的答案、正确答案与解析；最后请询问我是否需要前往错题本选择一道题。请用 Markdown 输出。',
      }
    }
    return {
      displayText: '错题分析',
      content: `请对下面这道题做错题分析。请指出考点、正确思路、我可能错在哪里、同类题解法和下一步巩固建议。请用 Markdown 输出，涉及公式时使用 LaTeX。

${questionText}`,
    }
  }

  if (skill === 'study_plan') {
    const contextBlock = [courseText, questionText ? `当前题目上下文：\n${questionText}` : ''].filter(Boolean).join('\n\n')
    return {
      displayText: '学习计划',
      content: `请为我制定一个可执行的学习计划。若有课程、知识点或题目上下文，请结合这些数据安排优先级；如果上下文不足，请先说明还需要哪些信息，再给出通用计划。请用 Markdown 输出，任务要能直接执行。

${contextBlock || '当前没有具体课程或题目上下文。'}`,
    }
  }

  return { displayText: '', content: '' }
}

function miniActionTarget(action = {}) {
  if (action.type !== 'goWrongBook') return '#/student/wrong-questions'
  return action.courseId
    ? `#/student/wrong-questions?subjectId=${encodeURIComponent(action.courseId)}`
    : '#/student/wrong-questions'
}

function renderStudentAiFloat(user) {
  if (user?.role !== 'student') return ''
  return `
    <div class="ai-float-widget" id="student-ai-float" aria-label="AI 对话悬浮入口">
      <button class="ai-float-hide" id="student-ai-float-hide" type="button" title="贴边隐藏" aria-label="贴边隐藏 AI 助手">‹</button>
      <button class="ai-float-main" id="student-ai-float-open" type="button" title="打开 AI 学习助手" aria-label="打开 AI 学习助手" aria-expanded="false">
        <span class="ai-float-orb">${iconMessage()}</span>
      </button>
      <span class="ai-float-grip" title="拖动 AI 助手" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
      <button class="ai-float-dock" id="student-ai-float-dock" type="button" title="打开 AI 学习助手" aria-label="打开 AI 学习助手">${iconMessage()}</button>
      <section class="ai-mini-panel" id="student-ai-mini-panel" aria-label="AI 对话窗" hidden>
        <div class="ai-mini-head">
          <div>
            <b>AI 学习助手</b>
            <span>当前页面内快速问答</span>
          </div>
          <button class="ai-mini-close" id="student-ai-mini-close" type="button" aria-label="收起 AI 对话窗">×</button>
        </div>
        <div class="ai-mini-messages" id="student-ai-mini-messages">
          <div class="ai-mini-empty">可以直接问课程概念、错题思路或复习计划。</div>
        </div>
        <div class="ai-mini-suggestions">
          <button type="button" data-ai-mini-skill="review_focus">复习重点</button>
          <button type="button" data-ai-mini-skill="wrong_question">错题分析</button>
          <button type="button" data-ai-mini-skill="study_plan">学习计划</button>
        </div>
        <form class="ai-mini-form" id="student-ai-mini-form">
          <textarea id="student-ai-mini-input" maxlength="${AI_FLOAT_MAX_INPUT}" rows="2" placeholder="输入学习问题，Enter 发送"></textarea>
          <button id="student-ai-mini-send" type="submit" disabled>发送</button>
        </form>
      </section>
    </div>`
}

function initStudentAiFloat(user) {
  if (user?.role !== 'student') return
  const widget = document.getElementById('student-ai-float')
  const openButton = document.getElementById('student-ai-float-open')
  const hideButton = document.getElementById('student-ai-float-hide')
  const dockButton = document.getElementById('student-ai-float-dock')
  const panel = document.getElementById('student-ai-mini-panel')
  const closeButton = document.getElementById('student-ai-mini-close')
  const messagesEl = document.getElementById('student-ai-mini-messages')
  const form = document.getElementById('student-ai-mini-form')
  const input = document.getElementById('student-ai-mini-input')
  const sendButton = document.getElementById('student-ai-mini-send')
  if (!widget || !openButton || !hideButton || !dockButton || !panel || !messagesEl || !form || !input || !sendButton) return

  let state = readAiFloatState()
  let dragState = null
  let wasDragging = false
  const miniState = {
    conversationId: null,
    messages: [],
    generating: false,
    abortController: null,
  }

  function clampY(y) {
    const rect = widget.getBoundingClientRect()
    const topLimit = window.innerWidth <= 768 ? 14 : 20
    const bottomReserve = window.innerWidth <= 768 ? 104 : 24
    const maxY = Math.max(topLimit, window.innerHeight - rect.height - bottomReserve)
    return Math.min(Math.max(Number(y) || defaultAiFloatY(widget), topLimit), maxY)
  }

  function applyState(nextState = state) {
    state = {
      side: 'right',
      y: clampY(nextState?.y),
      hidden: Boolean(nextState?.hidden),
    }
    widget.dataset.side = 'right'
    widget.classList.toggle('is-docked', state.hidden)
    if (state.hidden) setPanelOpen(false)
    widget.style.top = `${state.y}px`
    widget.style.bottom = 'auto'
    widget.style.right = 'auto'
    const width = widget.offsetWidth || 186
    widget.style.left = `${Math.max(AI_FLOAT_EDGE_MARGIN, window.innerWidth - width - AI_FLOAT_EDGE_MARGIN)}px`
    hideButton.textContent = '‹'
    hideButton.setAttribute('aria-label', '向右贴边隐藏 AI 助手')
    updateMiniPanelPlacement()
  }

  function saveState() {
    try {
      localStorage.setItem(AI_FLOAT_STATE_KEY, JSON.stringify(state))
    } catch {}
  }

  function setPanelOpen(open) {
    const nextOpen = Boolean(open)
    if (nextOpen && state.hidden) {
      state.hidden = false
      widget.classList.remove('is-docked')
      saveState()
    }
    widget.classList.toggle('is-panel-open', nextOpen)
    panel.hidden = !nextOpen
    openButton.setAttribute('aria-expanded', nextOpen ? 'true' : 'false')
    if (nextOpen) {
      requestAnimationFrame(() => {
        updateMiniPanelPlacement()
        input.focus()
      })
    }
  }

  function updateMiniPanelPlacement() {
    if (!panel || panel.hidden) return
    const rect = widget.getBoundingClientRect()
    const panelHeight = panel.offsetHeight || 460
    widget.classList.toggle('panel-below', rect.top - panelHeight - 12 < 12)
  }

  function bindMiniMessageActions() {
    messagesEl.querySelectorAll('[data-ai-mini-action="goWrongBook"]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.target || '#/student/wrong-questions'
        window.location.hash = target
      })
    })
    messagesEl.querySelectorAll('[data-copy-code]').forEach((button) => {
      button.addEventListener('click', async () => {
        const code = decodeURIComponent(button.dataset.copyCode || '')
        try { await navigator.clipboard.writeText(code) } catch {}
      })
    })
  }

  function hydrateMiniMessages() {
    bindMiniMessageActions()
    renderMathInMarkdownElements(messagesEl)
  }

  function shouldShowMiniAction(message) {
    if (!message?.action || message.streaming) return false
    if (message.action.type !== 'goWrongBook') return true
    return /错题本|具体错题|选择.*题|题目详情|进入.*错题/i.test(message.content || '')
  }

  function renderMiniMessages() {
    if (!miniState.messages.length) {
      messagesEl.innerHTML = '<div class="ai-mini-empty">可以直接问课程概念、错题思路或复习计划。</div>'
      return
    }
    messagesEl.innerHTML = miniState.messages.map((message) => {
      const role = message.role === 'user' ? 'user' : 'assistant'
      const content = message.content
        ? renderMarkdownToHtml(message.content)
        : (message.streaming ? '<span class="ai-mini-thinking">正在思考中...</span>' : '')
      const actionHtml = shouldShowMiniAction(message)
        ? `<div class="ai-mini-actions"><button type="button" data-ai-mini-action="${escapeHtml(message.action.type)}" data-target="${escapeHtml(miniActionTarget(message.action))}">${escapeHtml(message.action.label || '前往')}</button></div>`
        : ''
      return `<div class="ai-mini-message ${role}${message.streaming ? ' streaming' : ''}">
        <div class="message-markdown">${content}</div>
        ${actionHtml}
      </div>`
    }).join('')
    hydrateMiniMessages()
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function updateInputState() {
    sendButton.disabled = miniState.generating || !input.value.trim()
    input.style.height = 'auto'
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 42), 112)}px`
  }

  async function ensureMiniConversation() {
    if (miniState.conversationId) return miniState.conversationId
    const result = await createAiChatConversation({
      title: '悬浮对话',
      mode: 'general',
    })
    const conversation = result.data || {}
    const id = conversation.id || conversation.conversation_id
    if (!id) throw new Error('AI 会话创建失败')
    miniState.conversationId = id
    return id
  }

  async function sendMiniMessage(rawText, options = {}) {
    let text = String(rawText || '').trim()
    if (text.length > AI_FLOAT_MAX_INPUT) text = text.slice(0, AI_FLOAT_MAX_INPUT)
    if (!text || miniState.generating) return

    input.value = ''
    updateInputState()
    setPanelOpen(true)

    const assistantMessage = { role: 'assistant', content: '', streaming: true, action: options.action || null }
    miniState.messages.push({ role: 'user', content: options.displayText || text }, assistantMessage)
    miniState.generating = true
    miniState.abortController = new AbortController()
    renderMiniMessages()
    updateInputState()

    let streamHadError = false
    try {
      const conversationId = await ensureMiniConversation()
      await streamAiChatMessage(conversationId, { content: text }, {
        signal: miniState.abortController.signal,
        onEvent: (eventName, payload) => {
          if (eventName === 'delta') {
            assistantMessage.content += payload.content || ''
            renderMiniMessages()
          }
          if (eventName === 'done' && payload.assistant_message?.content) {
            assistantMessage.content = payload.assistant_message.content
          }
          if (eventName === 'error') {
            streamHadError = true
            assistantMessage.content = payload.message || 'AI 生成失败，请稍后再试'
          }
        },
      })
      if (streamHadError) renderMiniMessages()
    } catch (err) {
      if (err.name === 'AbortError') {
        assistantMessage.content = '已停止生成。'
      } else {
        assistantMessage.content = err.message || 'AI 对话暂时不可用，请稍后重试'
      }
    } finally {
      assistantMessage.streaming = false
      miniState.generating = false
      miniState.abortController = null
      renderMiniMessages()
      updateInputState()
    }
  }

  function snapToRight(y) {
    applyState({ side: 'right', y, hidden: false })
    saveState()
  }

  applyState(state)

  openButton.addEventListener('click', (event) => {
    if (wasDragging) {
      event.preventDefault()
      wasDragging = false
      return
    }
    setPanelOpen(panel.hidden)
  })

  dockButton.addEventListener('click', () => {
    applyState({ ...state, hidden: false })
    saveState()
    setPanelOpen(true)
  })

  hideButton.addEventListener('click', (event) => {
    event.stopPropagation()
    applyState({ ...state, hidden: true })
    saveState()
  })

  closeButton?.addEventListener('click', () => setPanelOpen(false))
  input.addEventListener('input', updateInputState)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMiniMessage(input.value)
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    sendMiniMessage(input.value)
  })
  widget.querySelectorAll('[data-ai-mini-skill]').forEach((button) => {
    button.addEventListener('click', () => {
      const payload = buildMiniSkillPayload(button.dataset.aiMiniSkill)
      sendMiniMessage(payload.content, payload)
    })
  })

  widget.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || state.hidden) return
    if (!event.target.closest('.ai-float-grip')) return
    if (event.target.closest('.ai-float-hide') || event.target.closest('.ai-mini-panel')) return
    const rect = widget.getBoundingClientRect()
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    wasDragging = false
    widget.classList.add('is-dragging')
    widget.setPointerCapture?.(event.pointerId)
  })

  widget.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return
    const dx = Math.abs(event.clientX - dragState.startX)
    const dy = Math.abs(event.clientY - dragState.startY)
    if (dx + dy > 5) wasDragging = true
    const rect = widget.getBoundingClientRect()
    const nextTop = clampY(event.clientY - dragState.offsetY)
    widget.style.left = `${Math.max(AI_FLOAT_EDGE_MARGIN, window.innerWidth - rect.width - AI_FLOAT_EDGE_MARGIN)}px`
    widget.style.top = `${nextTop}px`
    widget.dataset.side = 'right'
    updateMiniPanelPlacement()
  })

  function endDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return
    const rect = widget.getBoundingClientRect()
    widget.classList.remove('is-dragging')
    widget.releasePointerCapture?.(event.pointerId)
    dragState = null
    snapToRight(rect.top)
    window.setTimeout(() => { wasDragging = false }, 120)
  }

  widget.addEventListener('pointerup', endDrag)
  widget.addEventListener('pointercancel', endDrag)
  window.addEventListener('resize', () => {
    if (!document.body.contains(widget)) return
    applyState(state)
  }, { passive: true })
  renderMiniMessages()
  updateInputState()
}

function readAiFloatState() {
  try {
    const raw = localStorage.getItem(AI_FLOAT_STATE_KEY)
    if (!raw) return defaultAiFloatState()
    const parsed = JSON.parse(raw)
    return {
      side: 'right',
      y: Number(parsed?.y) || defaultAiFloatState().y,
      hidden: Boolean(parsed?.hidden),
    }
  } catch {
    return defaultAiFloatState()
  }
}

function defaultAiFloatState() {
  return { side: 'right', y: defaultAiFloatY(), hidden: false }
}

function defaultAiFloatY(widget) {
  const approxHeight = widget?.offsetHeight || 76
  const bottomReserve = window.innerWidth <= 768 ? 112 : 28
  return Math.max(90, window.innerHeight - approxHeight - bottomReserve)
}

function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

function getAvatarUrl(user) {
  const url = user?.profile?.avatar_url || user?.avatar_url
  if (!url) return ''
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url
  return `${API_ORIGIN}${url.startsWith('/') ? url : '/' + url}`
}
