import * as echarts from 'echarts'
import { getMe } from '../api/auth.js'
import {
  createTeacherAiConversation,
  getTeacherAiContextOptions,
  getTeacherAiConversations,
  getTeacherAiMessages,
  streamTeacherAiMessage,
  retrySaveTeacherAiMessage,
  uploadTeacherAiAttachment,
  clearTeacherAiConversation,
  deleteTeacherAiConversation,
} from '../api/teacher.js'
import { getUser, getToken, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml, formatRelativeTime } from '../utils/format.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js'
import { showToast } from '../utils/toast.js'
import { getIcon } from '../utils/icons.js'
import { getAiAssistantCapabilities, getAiConversationPendingAction, actOnAiPendingAction } from '../api/ai-assistant.js'
import { createSearchControls, DEFAULT_SEARCH_OPTIONS } from '../components/ai-assistant/search-controls.js'
import { renderCitedMarkdown, bindCitationClicks } from '../components/ai-assistant/citation-renderer.js'
import { renderSourceCards, focusSource } from '../components/ai-assistant/source-panel.js'
import { createExecutionTrace } from '../components/ai-assistant/execution-trace.js'
import { renderArtifacts, bindArtifactActions } from '../components/ai-assistant/artifact-renderer.js'
import { renderPendingActionCard, bindPendingActionCard } from '../components/ai-assistant/pending-action-card.js'

const MODES = [
  { value: 'general', label: '通用教学助手', hint: '教学设计、课程资料与日常教学' },
  { value: 'analytics', label: '学情分析助手', hint: '真实班级数据、图表与风险识别' },
  { value: 'preparation', label: '智慧备课助手', hint: '结合学情生成备课建议' },
  { value: 'agent', label: 'Agent 任务', hint: '结构化调用教学 Agent' },
]

const MODE_STARTERS = {
  general: ['设计一节以学生参与为主的课堂', '梳理本周教学重点', '生成课堂提问'],
  analytics: ['分析当前教学班最近 7 天学习情况', '识别需要干预的学生群体', '对比知识点掌握度'],
  preparation: ['根据薄弱知识点生成备课建议', '生成分层练习', '设计课前诊断活动'],
  agent: ['调用题目生成 Agent', '生成课程教学资料', '规划一个多步骤教学任务'],
}

const state = {
  mode: 'general', conversationId: null, conversations: [], messages: [], options: null,
  context: { course_id: '', teaching_class_id: '', range: '7d' }, knowledgeBaseIds: [], agentIds: [], attachments: [],
  generating: false, abortController: null, autoFollow: true, chartInstances: [],
  mention: null, lifecycleController: null, searchOptions: { ...DEFAULT_SEARCH_OPTIONS }, searchControls: null, capabilities: null,
  historyCollapsed: false, historyKeyword: '', contextOpen: false,
  pendingAction: null,
}

function queryConversationId() {
  const query = window.location.hash.split('?')[1] || ''
  const id = Number(new URLSearchParams(query).get('conversationId'))
  return Number.isInteger(id) ? id : null
}

function queryAgentId() {
  const query = window.location.hash.split('?')[1] || ''
  return new URLSearchParams(query).get('agentId') || ''
}

function renderShell() {
  return `<div class="teacher-ai-page${state.historyCollapsed ? ' history-collapsed' : ''}">
    <header class="teacher-ai-topbar">
      <div class="teacher-ai-brand"><span class="teacher-ai-brand-mark">${getIcon('sparkles')}</span><div><h1>教学智能助手</h1><p>依托真实教学情境，辅助分析、备课与课堂设计</p></div></div>
      <nav class="teacher-ai-modes" role="tablist" aria-label="教学助手模式">${MODES.map(item => `<button type="button" role="tab" aria-selected="${item.value === state.mode}" data-ai-mode="${item.value}" class="${item.value === state.mode ? 'active' : ''}" title="${item.hint}"><b>${item.label.replace('助手', '')}</b></button>`).join('')}</nav>
      <div class="teacher-ai-model"><span>教师专属</span><b>千问 3.7 Plus</b></div>
    </header>

    <div class="teacher-ai-layout">
      <aside class="teacher-ai-history" aria-label="历史会话">
        <div class="teacher-ai-history-head">
          <button class="teacher-ai-new" id="teacher-ai-new" type="button"><span class="teacher-ai-new-icon">＋</span><span>新建对话</span></button>
          <button class="teacher-ai-history-toggle" id="teacher-ai-history-toggle" type="button" aria-expanded="${!state.historyCollapsed}" title="${state.historyCollapsed ? '展开历史会话' : '收起历史会话'}">${getIcon('layout')}</button>
        </div>
        <label class="teacher-ai-history-search">${getIcon('search')}<span class="teacher-ai-visually-hidden">搜索会话</span><input id="teacher-ai-history-search" type="search" placeholder="搜索会话" value="${escapeHtml(state.historyKeyword)}"></label>
        <div class="teacher-ai-history-title"><b>最近对话</b><span id="teacher-ai-history-mode-label">${escapeHtml(MODES.find(item => item.value === state.mode)?.label || '')}</span></div>
        <div id="teacher-ai-conversations" class="teacher-ai-conversation-list"><div class="teacher-inline-empty">加载中</div></div>
        <p class="teacher-ai-history-foot">会话仅展示当前教学助手模式</p>
      </aside>

      <main class="teacher-ai-main is-empty" id="teacher-ai-main">
        <header class="teacher-ai-chat-head">
          <div class="teacher-ai-chat-title"><h2 id="teacher-ai-current-title">新对话</h2><div><span id="teacher-ai-current-mode">通用教学助手</span><span id="teacher-ai-context-summary">尚未选择教学上下文</span></div></div>
          <div class="teacher-ai-chat-actions">
            <button type="button" id="teacher-ai-context-toggle" aria-expanded="false">${getIcon('settings')}<span>教学上下文</span><em id="teacher-ai-source-count">0</em></button>
            <button type="button" id="teacher-ai-clear" title="清空当前会话" disabled>${getIcon('close')}<span>清空</span></button>
          </div>
        </header>

        <aside class="teacher-ai-context" id="teacher-ai-context-panel" hidden aria-label="教学上下文设置">
          <div class="teacher-ai-context-head"><div><b>教学上下文</b><span>只使用你有权访问的课程、教学班和资料</span></div><button type="button" id="teacher-ai-context-close" title="关闭教学上下文">${getIcon('close')}</button></div>
          <div class="teacher-context-selects">
            <label>课程<select id="teacher-ai-course"><option value="">请选择课程</option></select></label>
            <label>教学班<select id="teacher-ai-class"><option value="">全部授权教学班</option></select></label>
            <label>时间范围<select id="teacher-ai-range"><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="semester">本学期</option></select></label>
          </div>
          <div class="teacher-context-grid">
            <section class="teacher-context-section"><h3>@ 知识库</h3><div id="teacher-ai-kbs" class="teacher-context-options"><span class="teacher-inline-empty">加载中</span></div></section>
            <section class="teacher-context-section"><h3>\\ Agent</h3><div id="teacher-ai-agents" class="teacher-context-options"></div></section>
          </div>
          <section class="teacher-context-section teacher-context-sources"><h3>回答来源</h3><div id="teacher-ai-sources" class="teacher-ai-source-list"><span class="teacher-inline-empty">回答后显示</span></div></section>
        </aside>

        <div id="teacher-ai-messages" class="teacher-ai-messages"><div class="teacher-ai-welcome"><b>从真实教学情境开始</b><p>例如：分析软件2403班最近 7 天学习情况，并给出下节课教学重点。</p></div></div>
        <div class="teacher-ai-input-area">
          <div class="teacher-ai-starter-row" id="teacher-ai-starter-row"></div>
          <form class="teacher-ai-composer" id="teacher-ai-form">
            <div id="teacher-ai-mention-popover" class="teacher-ai-mention-popover" hidden></div>
            <div id="teacher-ai-selection-chips" class="teacher-ai-selection-chips"></div>
            <div id="teacher-ai-attachments" class="teacher-ai-attachments"></div>
            <textarea id="teacher-ai-input" maxlength="5000" rows="2" placeholder="输入教学问题；可用 @知识库、@课程、@教学班 或 \\Agent 选择器…"></textarea>
            <div id="teacher-ai-search-controls"></div>
            <div class="teacher-ai-composer-actions">
              <div>
                <label class="teacher-tool-button" title="添加文件或图片"><input type="file" id="teacher-ai-file" accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp" multiple hidden>${getIcon('document')}<span>附件</span></label>
                <button type="button" class="teacher-tool-button" id="teacher-ai-voice">${getIcon('microphone')}<span>语音</span></button>
              </div>
              <button class="teacher-btn primary" id="teacher-ai-send" type="submit">发送</button>
            </div>
          </form>
          <p class="teacher-ai-disclaimer">AI 内容可能存在偏差，请结合课程资料与真实教学数据核对。</p>
        </div>
      </main>
    </div>
  </div>`
}

function currentMode() {
  return MODES.find(item => item.value === state.mode) || MODES[0]
}

function currentConversation() {
  return state.conversations.find(item => Number(item.id) === Number(state.conversationId)) || null
}

function contextSummary() {
  const options = state.options || { courses: [], teaching_classes: [] }
  const course = options.courses.find(item => Number(item.course_id) === Number(state.context.course_id))
  const teachingClass = options.teaching_classes.find(item => Number(item.teaching_class_id) === Number(state.context.teaching_class_id))
  const range = { '7d': '近 7 天', '30d': '近 30 天', semester: '本学期' }[state.context.range] || '近 7 天'
  return [course?.course_name, teachingClass?.teaching_class_name || teachingClass?.code, range].filter(Boolean).join(' · ') || '尚未选择教学上下文'
}

function renderWorkbenchHeader() {
  const conversation = currentConversation()
  const mode = currentMode()
  const title = document.getElementById('teacher-ai-current-title')
  const modeLabel = document.getElementById('teacher-ai-current-mode')
  const summary = document.getElementById('teacher-ai-context-summary')
  const historyMode = document.getElementById('teacher-ai-history-mode-label')
  const clearButton = document.getElementById('teacher-ai-clear')
  if (title) title.textContent = conversation?.title || '新对话'
  if (modeLabel) modeLabel.textContent = mode.label
  if (summary) summary.textContent = contextSummary()
  if (historyMode) historyMode.textContent = mode.label
  if (clearButton) clearButton.disabled = !state.conversationId || state.generating
  document.querySelectorAll('[data-ai-mode]').forEach(button => {
    const active = button.dataset.aiMode === state.mode
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', String(active))
  })
  const starters = document.getElementById('teacher-ai-starter-row')
  if (starters) starters.innerHTML = (MODE_STARTERS[state.mode] || MODE_STARTERS.general).map(prompt => `<button type="button" data-composer-starter="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('')
}

function setContextOpen(open) {
  state.contextOpen = Boolean(open)
  const panel = document.getElementById('teacher-ai-context-panel')
  const toggle = document.getElementById('teacher-ai-context-toggle')
  if (panel) panel.hidden = !state.contextOpen
  if (toggle) toggle.setAttribute('aria-expanded', String(state.contextOpen))
  document.querySelector('.teacher-ai-page')?.classList.toggle('context-open', state.contextOpen)
}

function setHistoryCollapsed(collapsed) {
  state.historyCollapsed = Boolean(collapsed)
  const page = document.querySelector('.teacher-ai-page')
  const toggle = document.getElementById('teacher-ai-history-toggle')
  page?.classList.toggle('history-collapsed', state.historyCollapsed)
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!state.historyCollapsed))
    toggle.title = state.historyCollapsed ? '展开历史会话' : '收起历史会话'
  }
}

function disposeCharts() {
  state.chartInstances.forEach(instance => { try { instance.dispose() } catch {} })
  state.chartInstances = []
}

function chartOption(spec) {
  const chartType = ['line', 'bar'].includes(spec.chartType) ? spec.chartType : 'bar'
  const categories = Array.isArray(spec.categories) ? spec.categories : (Array.isArray(spec.xAxis) ? spec.xAxis : [])
  return {
    animationDuration: 450,
    color: ['#b56f24', '#6f8d72', '#c59b52'],
    tooltip: { trigger: 'axis', valueFormatter: value => `${value}${spec.unit || ''}` },
    grid: { top: 28, left: 42, right: 18, bottom: 42, containLabel: true },
    xAxis: { type: 'category', data: categories.slice(0, 60), axisLabel: { color: '#786957', rotate: categories.length > 8 ? 30 : 0 } },
    yAxis: { type: 'value', name: spec.unit || '', splitLine: { lineStyle: { color: '#eee7dc' } } },
    series: (Array.isArray(spec.series) ? spec.series : []).slice(0, 6).map(series => ({ name: String(series.name || ''), type: chartType, smooth: chartType === 'line', data: (series.data || []).slice(0, 60), barMaxWidth: 28, areaStyle: chartType === 'line' ? { opacity: 0.08 } : undefined })),
  }
}

function renderSources(sources = []) {
  const container = document.getElementById('teacher-ai-sources')
  if (!container) return
  container.innerHTML = renderSourceCards(sources, { emptyText: '本回答未使用外部数据' })
  const count = document.getElementById('teacher-ai-source-count')
  if (count) count.textContent = String(sources.filter(item => item.type !== 'chart_spec').length)
}

function renderMessages() {
  disposeCharts()
  const container = document.getElementById('teacher-ai-messages')
  if (!container) return
  document.getElementById('teacher-ai-main')?.classList.toggle('is-empty', !state.messages.length)
  if (!state.messages.length) {
    container.innerHTML = '<div class="teacher-ai-welcome"><b>从真实教学情境开始</b><p>例如：分析软件2403班最近7天学习情况，并给出下节课教学重点。</p><div><button data-starter="分析当前教学班最近7天学习情况">分析当前班级</button><button data-starter="根据薄弱知识点生成课堂问题">生成课堂问题</button><button data-starter="为当前课程生成分层练习建议">生成分层练习</button></div></div>'
  } else {
    container.innerHTML = state.messages.map((message, index) => {
      const charts = (message.sources || []).filter(item => item.type === 'chart_spec').map(item => item.chart)
      return `<article class="teacher-ai-message ${message.role}" data-message-index="${index}">
        <div class="teacher-ai-message-role">${message.role === 'user' ? '教师' : 'AI'}</div>
        <div class="teacher-ai-message-body message-markdown">${message.streaming && !message.content ? '<span class="teacher-ai-thinking">正在读取授权数据并生成回答…</span>' : (message.role === 'assistant' ? renderCitedMarkdown(message.content || '', message.sources || []) : renderMarkdownToHtml(message.content || ''))}</div>
        ${message.persistence?.saved === false ? `<div class="teacher-ai-save-warning"><span>${escapeHtml(message.persistence.message || '回答已生成，但尚未保存。')}</span><button type="button" data-ai-retry-save="${index}">重试保存</button></div>` : ''}
        ${message.role === 'assistant' ? `<div class="teacher-ai-message-extras"><div data-ai-trace="${index}"></div>${renderArtifacts(message.artifacts || [])}${renderPendingActionCard(message.pendingAction || (index === state.messages.findLastIndex(item => item.role === 'assistant') ? state.pendingAction : null))}</div>` : ''}
        ${charts.length ? `<div class="teacher-ai-chart-grid">${charts.map((spec, chartIndex) => `<div class="teacher-ai-chart-card"><b>${escapeHtml(spec.title || '数据图表')}</b><div data-ai-chart="${index}-${chartIndex}"></div></div>`).join('')}</div>` : ''}
      </article>`
    }).join('')
  }
  container.querySelectorAll('[data-starter]').forEach(button => button.addEventListener('click', () => { document.getElementById('teacher-ai-input').value = button.dataset.starter; syncSendButton(); document.getElementById('teacher-ai-input').focus() }))
  container.querySelectorAll('[data-ai-retry-save]').forEach(button => button.addEventListener('click', () => void retryAssistantSave(Number(button.dataset.aiRetrySave))))
  bindPendingActionCard(container, { onAction: handlePendingAction, onError: error => showToast(error.message || '文件任务操作失败', 'error') })
  bindArtifactActions(container, error => showToast(error.message || '成果下载失败', 'error'))
  renderMathInMarkdownElements(container)
  state.messages.forEach((message, index) => {
    bindCitationClicks(container.querySelector(`[data-message-index="${index}"]`), citationIndex => { renderSources(message.sources || []); setContextOpen(true); requestAnimationFrame(() => focusSource(document.getElementById('teacher-ai-sources'), citationIndex)) })
    const traceRoot = container.querySelector(`[data-ai-trace="${index}"]`)
    if (traceRoot) { const trace = createExecutionTrace(traceRoot); (message.traceEvents || []).forEach(event => trace.push(event)) }
    const specs = (message.sources || []).filter(item => item.type === 'chart_spec').map(item => item.chart)
    specs.forEach((spec, chartIndex) => {
      const node = container.querySelector(`[data-ai-chart="${index}-${chartIndex}"]`)
      if (!node) return
      const instance = echarts.init(node); instance.setOption(chartOption(spec)); state.chartInstances.push(instance)
    })
  })
  if (state.autoFollow) container.scrollTop = container.scrollHeight
}

async function retryAssistantSave(index) {
  const message = state.messages[index]
  if (!message || !state.conversationId || message.persistence?.saved !== false) return
  const button = document.querySelector(`[data-ai-retry-save="${index}"]`)
  if (button) { button.disabled = true; button.textContent = '保存中…' }
  try {
    const result = await retrySaveTeacherAiMessage(state.conversationId, {
      content: message.content,
      sources: message.sources || [],
      client_request_id: message.persistence.client_request_id,
    })
    message.id = result.data?.assistant_message?.id || message.id
    message.persistence = { saved: true }
    showToast('回答已保存', 'success')
    renderMessages()
  } catch (error) {
    message.persistence.message = error.message || '保存仍未成功，请稍后重试。'
    showToast(message.persistence.message, 'error')
    if (button) { button.disabled = false; button.textContent = '重试保存' }
  }
}

function renderConversationList() {
  const container = document.getElementById('teacher-ai-conversations')
  if (!container) return
  const keyword = state.historyKeyword.trim().toLowerCase()
  const rows = state.conversations.filter(item => item.mode === state.mode && (!keyword || String(item.title || '').toLowerCase().includes(keyword)))
  container.innerHTML = rows.length ? rows.map(item => {
    const preview = item.last_message?.content_preview || item.last_message_preview || currentMode().hint
    return `<button class="${Number(item.id) === Number(state.conversationId) ? 'active' : ''}" data-conversation-id="${item.id}" aria-current="${Number(item.id) === Number(state.conversationId)}"><b>${escapeHtml(item.title || '教学对话')}</b><p>${escapeHtml(String(preview))}</p><span>${escapeHtml(currentMode().label)}<time>${formatRelativeTime(item.updated_at)}</time></span><i data-delete-conversation="${item.id}" title="删除会话" aria-label="删除会话">×</i></button>`
  }).join('') : `<div class="teacher-inline-empty">${keyword ? '没有匹配的会话' : '该模式暂无对话'}</div>`
  container.querySelectorAll('[data-conversation-id]').forEach(button => button.addEventListener('click', event => {
    if (event.target.closest('[data-delete-conversation]')) return
    void openConversation(Number(button.dataset.conversationId))
  }))
  container.querySelectorAll('[data-delete-conversation]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation(); await deleteTeacherAiConversation(Number(button.dataset.deleteConversation)); if (state.conversationId === Number(button.dataset.deleteConversation)) { state.conversationId = null; state.messages = [] }; await loadConversations(); renderMessages(); renderWorkbenchHeader()
  }))
}

function renderSelectedContext() {
  const container = document.getElementById('teacher-ai-selection-chips')
  if (!container) return
  const options = state.options || { knowledge_bases: [], agents: [] }
  const selectedKnowledge = options.knowledge_bases.filter(item => state.knowledgeBaseIds.includes(Number(item.knowledge_base_id)))
  const selectedAgents = options.agents.filter(item => state.agentIds.includes(String(item.id)))
  container.innerHTML = [
    ...selectedKnowledge.map(item => `<button type="button" data-selected-kb="${item.knowledge_base_id}" title="取消引用">@${escapeHtml(item.name)} ×</button>`),
    ...selectedAgents.map(item => `<button type="button" data-selected-agent="${escapeHtml(String(item.id))}" title="取消调用">\\${escapeHtml(item.name)} ×</button>`),
  ].join('')
  container.querySelectorAll('[data-selected-kb]').forEach(button => button.addEventListener('click', () => {
    state.knowledgeBaseIds = state.knowledgeBaseIds.filter(id => id !== Number(button.dataset.selectedKb)); renderContextOptions()
  }))
  container.querySelectorAll('[data-selected-agent]').forEach(button => button.addEventListener('click', () => {
    state.agentIds = state.agentIds.filter(id => id !== button.dataset.selectedAgent); renderContextOptions()
  }))
}

function currentMention(input) {
  const cursor = input.selectionStart ?? input.value.length
  const before = input.value.slice(0, cursor)
  const matched = before.match(/(^|\s)([@\\])([^\s@\\]*)$/)
  if (!matched) return null
  return { type: matched[2] === '@' ? 'knowledge' : 'agent', query: matched[3].toLowerCase(), start: cursor - matched[3].length - 1, cursor }
}

function closeMention() {
  state.mention = null
  const popover = document.getElementById('teacher-ai-mention-popover')
  if (popover) { popover.hidden = true; popover.innerHTML = '' }
}

function chooseMention(item) {
  const input = document.getElementById('teacher-ai-input')
  const mention = state.mention
  if (!input || !mention) return
  if (mention.type === 'knowledge') {
    const id = Number(item.knowledge_base_id)
    if (!state.knowledgeBaseIds.includes(id)) state.knowledgeBaseIds = [...state.knowledgeBaseIds, id]
  } else {
    const id = String(item.id)
    if (!state.agentIds.includes(id)) state.agentIds = [...state.agentIds, id]
  }
  const label = mention.type === 'knowledge' ? `@${item.name}` : `\\${item.name}`
  input.value = `${input.value.slice(0, mention.start)}${label} ${input.value.slice(mention.cursor)}`
  const cursor = mention.start + label.length + 1
  input.setSelectionRange(cursor, cursor)
  closeMention(); renderContextOptions(); syncSendButton(); input.focus()
}

function updateMention(input) {
  const match = currentMention(input)
  if (!match) return closeMention()
  const options = state.options || { knowledge_bases: [], agents: [] }
  const source = match.type === 'knowledge' ? options.knowledge_bases : options.agents
  const items = source.filter(item => `${item.name || ''} ${item.description || ''}`.toLowerCase().includes(match.query)).slice(0, 8)
  const popover = document.getElementById('teacher-ai-mention-popover')
  if (!popover) return
  state.mention = { ...match, items, index: 0 }
  popover.innerHTML = items.length
    ? `<div class="teacher-ai-mention-head">${match.type === 'knowledge' ? '选择知识库（可多选）' : '选择已注册 Agent（可多选）'}</div>${items.map((item, index) => `<button type="button" class="${index === 0 ? 'active' : ''}" data-mention-index="${index}"><span class="teacher-ai-mention-icon">${getIcon(match.type === 'knowledge' ? 'book' : 'sparkles')}</span><span class="teacher-ai-mention-copy"><b>${match.type === 'knowledge' ? '@' : '\\'}${escapeHtml(item.name)}</b><span>${escapeHtml(item.description || (item.source === 'mine' ? '我的 Agent' : item.source === 'marketplace' ? '市场 Agent' : '系统 Agent'))}</span></span></button>`).join('')}`
    : '<div class="teacher-inline-empty">没有匹配项</div>'
  popover.hidden = false
  popover.querySelectorAll('[data-mention-index]').forEach(button => button.addEventListener('mousedown', event => {
    event.preventDefault(); chooseMention(items[Number(button.dataset.mentionIndex)])
  }))
}

function moveMention(delta) {
  if (!state.mention?.items?.length) return
  state.mention.index = (state.mention.index + delta + state.mention.items.length) % state.mention.items.length
  document.querySelectorAll('[data-mention-index]').forEach((button, index) => button.classList.toggle('active', index === state.mention.index))
}

function uniqueBy(items, keyOf) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = keyOf(item)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeContextOptions(options = {}) {
  return {
    ...options,
    courses: uniqueBy(options.courses, item => `course:${item.course_id}`),
    teaching_classes: uniqueBy(options.teaching_classes, item => `class:${item.teaching_class_id}`),
    knowledge_bases: uniqueBy(options.knowledge_bases, item => `kb:${String(item.name || item.knowledge_base_id || '').trim().toLowerCase()}`),
    agents: uniqueBy(options.agents, item => `agent:${String(item.name || item.id || '').trim().toLowerCase()}`),
  }
}

function renderContextOptions() {
  const options = state.options || { courses: [], teaching_classes: [], knowledge_bases: [], agents: [] }
  const courseSelect = document.getElementById('teacher-ai-course')
  courseSelect.innerHTML = '<option value="">请选择课程</option>' + options.courses.map(item => `<option value="${item.course_id}" ${Number(state.context.course_id) === item.course_id ? 'selected' : ''}>${escapeHtml(item.course_name)}</option>`).join('')
  renderClassOptions()
  document.getElementById('teacher-ai-kbs').innerHTML = options.knowledge_bases.length ? options.knowledge_bases.map(item => `<button class="${state.knowledgeBaseIds.includes(item.knowledge_base_id) ? 'active' : ''}" data-kb-id="${item.knowledge_base_id}">@${escapeHtml(item.name)}</button>`).join('') : '<span class="teacher-inline-empty">暂无可用知识库</span>'
  document.getElementById('teacher-ai-agents').innerHTML = options.agents.map(item => `<button class="${state.agentIds.includes(String(item.id)) ? 'active' : ''}" data-agent-id="${escapeHtml(String(item.id))}">\\${escapeHtml(item.name)}${item.source === 'mine' ? '<small>我的</small>' : item.source === 'marketplace' ? '<small>市场</small>' : ''}</button>`).join('')
  document.querySelectorAll('[data-kb-id]').forEach(button => button.addEventListener('click', () => { const id = Number(button.dataset.kbId); state.knowledgeBaseIds = state.knowledgeBaseIds.includes(id) ? state.knowledgeBaseIds.filter(item => item !== id) : [...state.knowledgeBaseIds, id]; renderContextOptions() }))
  document.querySelectorAll('[data-agent-id]').forEach(button => button.addEventListener('click', () => { const id = button.dataset.agentId; state.agentIds = state.agentIds.includes(id) ? state.agentIds.filter(item => item !== id) : [...state.agentIds, id]; renderContextOptions() }))
  renderSelectedContext()
  renderWorkbenchHeader()
}

function renderClassOptions() {
  const select = document.getElementById('teacher-ai-class')
  const rows = (state.options?.teaching_classes || []).filter(item => !state.context.course_id || item.course_id === Number(state.context.course_id))
  const courseNames = new Map((state.options?.courses || []).map(item => [item.course_id, item.course_name]))
  select.innerHTML = '<option value="">全部授权教学班</option>' + rows.map(item => {
    const label = [courseNames.get(item.course_id), item.teaching_class_name, item.code].filter(Boolean).join(' · ')
    return `<option value="${item.teaching_class_id}" ${Number(state.context.teaching_class_id) === item.teaching_class_id ? 'selected' : ''}>${escapeHtml(label)}</option>`
  }).join('')
}

function renderAttachments() {
  document.getElementById('teacher-ai-attachments').innerHTML = state.attachments.map(item => `<span>${escapeHtml(item.name)}<button type="button" data-remove-file="${item.id}">×</button></span>`).join('')
  document.querySelectorAll('[data-remove-file]').forEach(button => button.addEventListener('click', () => { state.attachments = state.attachments.filter(item => item.id !== button.dataset.removeFile); renderAttachments() }))
  syncSendButton()
}

function syncSendButton() {
  const button = document.getElementById('teacher-ai-send')
  const input = document.getElementById('teacher-ai-input')
  if (!button) return
  button.disabled = !state.generating && !String(input?.value || '').trim() && state.attachments.length === 0
  button.textContent = state.generating ? '停止' : '发送'
  const clearButton = document.getElementById('teacher-ai-clear')
  if (clearButton) clearButton.disabled = !state.conversationId || state.generating
}

async function loadConversations() {
  const result = await getTeacherAiConversations({ page_size: 100 })
  state.conversations = result.data?.list || []
  renderConversationList()
  renderWorkbenchHeader()
}

async function ensureConversation() {
  const current = state.conversations.find(item => item.id === state.conversationId)
  if (current?.mode === state.mode) return state.conversationId
  const result = await createTeacherAiConversation({ mode: state.mode, context: state.context })
  state.conversationId = result.data.id
  state.messages = []
  await loadConversations()
  renderWorkbenchHeader()
  return state.conversationId
}

async function openConversation(id) {
  const result = await getTeacherAiMessages(id)
  state.conversationId = id
  state.messages = result.data?.messages || []
  state.mode = result.data?.conversation?.mode || state.mode
  state.context = { ...state.context, ...(result.data?.conversation?.context || {}) }
  await refreshPendingAction()
  renderConversationList(); renderContextOptions(); renderMessages(); renderWorkbenchHeader()
  const latestAssistant = [...state.messages].reverse().find(message => message.role === 'assistant')
  renderSources(latestAssistant?.sources || [])
}

function attachPendingAction(pendingAction) {
  state.pendingAction = pendingAction || null
  for (const message of state.messages) delete message.pendingAction
  const lastAssistant = [...state.messages].reverse().find(message => message.role === 'assistant')
  if (lastAssistant && pendingAction) lastAssistant.pendingAction = pendingAction
}

async function refreshPendingAction() {
  if (!state.conversationId) { attachPendingAction(null); return null }
  try {
    const response = await getAiConversationPendingAction(state.conversationId)
    attachPendingAction(response.data || null)
    return state.pendingAction
  } catch (error) {
    if (![40301, 40401].includes(Number(error.code))) console.warn('[teacher-ai-chat] pending action refresh failed:', error.message)
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
    if (action === 'generate') showToast('文件任务已开始', 'success')
    else if (action === 'modify') showToast('生成要求已更新', 'success')
    else if (action === 'cancel') showToast('文件任务已取消', 'success')
    else if (action === 'retry') showToast('文件任务已重新进入队列', 'success')
    renderMessages()
    return result
  } catch (error) {
    showToast(error.message || '文件任务操作失败', 'error')
    return null
  } finally { if (control) control.disabled = false }
}

async function sendMessage(options = {}) {
  if (state.generating) { state.abortController?.abort(); return }
  const input = document.getElementById('teacher-ai-input')
  const content = String(options.content ?? input.value).trim()
  if (!content && !state.attachments.length) return
  const id = await ensureConversation()
  const outgoing = [...state.attachments]; state.attachments = []; renderAttachments(); input.value = ''
  const assistant = { role: 'assistant', content: '', sources: [], artifacts: [], traceEvents: [], streaming: true, requestContent: content, confirmationRequired: false }
  state.messages.push({ role: 'user', content: content || outgoing.map(item => item.name).join('、'), attachments: outgoing }, assistant)
  state.generating = true; state.abortController = new AbortController(); syncSendButton(); renderMessages()
  state.searchControls?.setBusy(true)
  try {
    await streamTeacherAiMessage(id, {
      content,
      attachments: outgoing.map(item => item.id),
      context: state.context,
      knowledge_base_refs: state.knowledgeBaseIds,
      agent_refs: state.agentIds,
      search_options: state.searchControls?.getOptions() || state.searchOptions,
      auto_agent: true,
      confirmed: options.confirmed === true,
    }, {
      signal: state.abortController.signal,
      onEvent(event, payload) {
        if (event.includes('.') && payload?.type) {
          assistant.traceEvents.push(payload)
          if (event === 'search.sources') {
            const early = (payload.payload?.sources || []).map(source => ({ ...source, type: 'web', label: source.title }))
            assistant.sources = [...early, ...assistant.sources.filter(source => source.type !== 'web')]
            renderSources(assistant.sources)
          }
          if (event === 'artifact.completed' && payload.payload?.id) assistant.artifacts = [...assistant.artifacts.filter(item => item.id !== payload.payload.id), payload.payload]
          if (event === 'run.completed') {
            assistant.confirmationRequired = payload.payload?.confirmationRequired === true
            if (Array.isArray(payload.payload?.artifacts)) assistant.artifacts = payload.payload.artifacts
            if (payload.payload?.pendingAction) { attachPendingAction(payload.payload.pendingAction); assistant.pendingAction = payload.payload.pendingAction }
          }
        }
        if (event === 'delta') {
          assistant.content += payload.content || ''
          const node = document.querySelector('.teacher-ai-message:last-child .teacher-ai-message-body')
          if (node) {
            node.innerHTML = renderMarkdownToHtml(assistant.content)
            renderMathInMarkdownElements(node)
          }
          if (state.autoFollow) document.getElementById('teacher-ai-messages').scrollTop = document.getElementById('teacher-ai-messages').scrollHeight
        }
        if (event === 'save_error') assistant.persistence = { ...payload, saved: false }
        if (event === 'done') { assistant.content = payload.assistant_message?.content || assistant.content; assistant.sources = payload.assistant_message?.sources || (payload.charts || []).map(chart => ({ type: 'chart_spec', chart })); assistant.artifacts = payload.artifacts || assistant.artifacts; assistant.confirmationRequired = payload.confirmation_required === true; if (payload.pending_action) { attachPendingAction(payload.pending_action); assistant.pendingAction = payload.pending_action }; assistant.traceId = payload.trace_id; assistant.persistence = payload.persistence || assistant.persistence || { saved: true }; state.context = { ...state.context, ...(payload.context || {}) }; renderSources(assistant.sources) }
        if (event === 'error') { assistant.content = assistant.content || payload.message || '生成失败'; assistant.error = payload }
      },
    })
  } catch (error) { assistant.content = error.name === 'AbortError' ? '已停止生成。' : (error.message || 'AI 对话暂时不可用') }
  finally { assistant.streaming = false; state.generating = false; state.abortController = null; state.searchControls?.setBusy(false); await refreshPendingAction(); syncSendButton(); renderMessages(); await loadConversations() }
}

function bindEvents() {
  document.querySelectorAll('[data-ai-mode]').forEach(button => button.addEventListener('click', async () => {
    state.mode = button.dataset.aiMode; state.conversationId = null; state.messages = []; state.pendingAction = null
    renderConversationList(); renderMessages(); renderSources([]); renderWorkbenchHeader()
  }))
  document.getElementById('teacher-ai-new').addEventListener('click', () => { state.conversationId = null; state.messages = []; state.pendingAction = null; renderConversationList(); renderMessages(); renderSources([]); renderWorkbenchHeader(); document.getElementById('teacher-ai-input').focus() })
  document.getElementById('teacher-ai-history-toggle').addEventListener('click', () => setHistoryCollapsed(!state.historyCollapsed))
  document.getElementById('teacher-ai-history-search').addEventListener('input', event => { state.historyKeyword = event.target.value; renderConversationList() })
  document.getElementById('teacher-ai-context-toggle').addEventListener('click', () => setContextOpen(!state.contextOpen))
  document.getElementById('teacher-ai-context-close').addEventListener('click', () => setContextOpen(false))
  document.getElementById('teacher-ai-starter-row').addEventListener('click', event => {
    const button = event.target.closest('[data-composer-starter]')
    if (!button) return
    const input = document.getElementById('teacher-ai-input')
    input.value = button.dataset.composerStarter
    syncSendButton(); input.focus()
  })
  document.getElementById('teacher-ai-clear').addEventListener('click', async () => { if (!state.conversationId) return; await clearTeacherAiConversation(state.conversationId); state.messages = []; renderMessages(); renderSources([]); renderWorkbenchHeader() })
  document.getElementById('teacher-ai-form').addEventListener('submit', event => { event.preventDefault(); void sendMessage() })
  const input = document.getElementById('teacher-ai-input')
  input.addEventListener('input', () => { updateMention(input); syncSendButton() })
  input.addEventListener('click', () => updateMention(input))
  input.addEventListener('keydown', event => {
    if (state.mention && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); moveMention(event.key === 'ArrowDown' ? 1 : -1); return }
    if (state.mention && event.key === 'Escape') { event.preventDefault(); closeMention(); return }
    if (state.mention?.items?.length && event.key === 'Enter') { event.preventDefault(); chooseMention(state.mention.items[state.mention.index]); return }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() }
  })
  document.getElementById('teacher-ai-course').addEventListener('change', event => { state.context.course_id = event.target.value; state.context.teaching_class_id = ''; renderClassOptions(); renderWorkbenchHeader() })
  document.getElementById('teacher-ai-class').addEventListener('change', event => { state.context.teaching_class_id = event.target.value; renderWorkbenchHeader() })
  document.getElementById('teacher-ai-range').addEventListener('change', event => { state.context.range = event.target.value; renderWorkbenchHeader() })
  document.getElementById('teacher-ai-file').addEventListener('change', async event => {
    try { const id = await ensureConversation(); for (const file of [...event.target.files].slice(0, 8 - state.attachments.length)) { const result = await uploadTeacherAiAttachment(file, id); state.attachments.push(result.data) }; renderAttachments() } catch (error) { showToast(error.message || '附件上传失败', 'error') } finally { event.target.value = '' }
  })
  document.getElementById('teacher-ai-voice').addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return showToast('当前浏览器不支持语音输入', 'warning')
    const recognition = new SpeechRecognition(); recognition.lang = 'zh-CN'; recognition.onresult = event => { document.getElementById('teacher-ai-input').value = [...event.results].map(item => item[0].transcript).join(''); syncSendButton() }; recognition.start()
  })
  document.getElementById('teacher-ai-messages').addEventListener('scroll', event => { state.autoFollow = event.target.scrollHeight - event.target.scrollTop - event.target.clientHeight < 90 }, { passive: true })
  window.addEventListener('resize', () => state.chartInstances.forEach(instance => instance.resize()), { passive: true, signal: state.lifecycleController.signal })
}

export async function renderTeacherAiChat(app) {
  state.lifecycleController?.abort()
  state.lifecycleController = new AbortController()
  state.mention = null
  state.conversationId = null
  state.messages = []
  state.pendingAction = null
  state.attachments = []
  state.knowledgeBaseIds = []
  state.agentIds = []
  state.contextOpen = false
  state.historyKeyword = ''
  state.historyCollapsed = window.matchMedia('(max-width: 760px)').matches
  let user = getUser()
  try { const result = await getMe(); user = result.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }
  renderDashboardLayout(app, { title: '教师 AI', menuItems: TEACHER_MENU_ITEMS, contentHTML: renderShell(), user })
  document.getElementById('student-main')?.classList.add('teacher-ai-host')
  state.searchControls = createSearchControls(document.getElementById('teacher-ai-search-controls'), { value: state.searchOptions, capabilities: state.capabilities, onChange: value => { state.searchOptions = value } })
  bindEvents()
  renderWorkbenchHeader()
  syncSendButton()
  try {
    const [options, , capabilityResult] = await Promise.all([getTeacherAiContextOptions(), loadConversations(), getAiAssistantCapabilities().catch(() => null)])
    state.options = normalizeContextOptions(options.data)
    state.capabilities = capabilityResult?.data || null
    state.searchControls?.setCapabilities(state.capabilities)
    const requestedAgent = queryAgentId()
    if (requestedAgent && state.options.agents.some(item => String(item.id) === requestedAgent)) { state.agentIds = [requestedAgent]; setContextOpen(true) }
    renderContextOptions()
    const targetId = queryConversationId(); if (targetId) await openConversation(targetId)
    else requestAnimationFrame(() => document.getElementById('teacher-ai-input')?.focus())
  } catch (error) { showToast(error.message || '教师 AI 初始化失败', 'error') }
}
