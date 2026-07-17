import {
  getWorkCenterSummary,
  getWorkCenterMessages,
  getWorkCenterMessage,
  readWorkCenterMessage,
  readAllWorkCenterMessages,
} from '../api/work-center.js'
import { escapeHtml, formatDate } from '../utils/format.js'
import { getIcon } from '../utils/icons.js'

const EDGE_MARGIN = 18
const DRAG_THRESHOLD = 7
const CLOSED_INTERVAL = 30_000
const OPEN_INTERVAL = 15_000
const MESSAGE_TYPES = {
  all: { label: '全部', value: '' },
  resource: { label: '课程文件', value: 'resource_shared' },
  task: { label: '任务', value: 'task_published' },
  system: { label: '系统', value: 'system_notice' },
}

let activeController = null

function positionKey(user) {
  return `discimind.workCenterPosition.${user.user_id}.${String(user.role).toLowerCase()}`
}

function collapsedKey(user) {
  return `discimind.workCenterCollapsed.${user.user_id}.${String(user.role).toLowerCase()}`
}

function readPosition(user) {
  try {
    const value = JSON.parse(localStorage.getItem(positionKey(user)) || 'null')
    return Number.isFinite(value?.y) ? { y: value.y } : null
  } catch { return null }
}

function savePosition(user, value) {
  try { localStorage.setItem(positionKey(user), JSON.stringify({ edge: 'right', y: Math.round(value.y) })) } catch {}
}

function readCollapsed(user) {
  try { return localStorage.getItem(collapsedKey(user)) === '1' } catch { return false }
}

function saveCollapsed(user, value) {
  try { localStorage.setItem(collapsedKey(user), value ? '1' : '0') } catch {}
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function statusLabel(value) {
  const labels = {
    queued: '等待中', planning: '规划中', running: '执行中', waiting_external: '等待外部服务', waiting_tool: '等待工具', waiting_agent: '等待 Agent',
    generating: '生成中', finalizing: '整理中', succeeded: '已完成', completed: '已完成', failed: '失败', stalled: '等待超时', cancelled: '已取消',
  }
  return labels[String(value || '').toLowerCase()] || value || '待处理'
}

function timeLabel(value) {
  try { return formatDate(value, 'short') } catch { return '' }
}

function typeLabel(value) {
  const map = {
    resource_shared: '课程文件', task_published: '任务发布', task_deadline: '任务提醒', system_notice: '系统消息',
    document_review: '文档审核', file_generated: '文件生成', ai_task_done: 'AI 任务', student_risk: '学情风险',
    learning_card_daily: '学习卡片',
  }
  return map[String(value || '').toLowerCase()] || '消息'
}

function taskRows(tasks) {
  if (!tasks?.length) return '<div class="unified-center-empty">当前没有待办任务</div>'
  return tasks.map((task) => `<button type="button" class="unified-feed-row is-task" data-task-url="${escapeHtml(task.action_url || '')}" data-task-id="${task.id}" data-task-category="${escapeHtml(task.task_category || 'background_task')}">
    <span class="unified-feed-icon">${getIcon(task.task_category === 'file_generation' ? 'document' : task.task_category === 'ai_agent' ? 'sparkles' : 'workflow')}</span>
    <span class="unified-feed-copy"><strong>${escapeHtml(task.title || '后台任务')}</strong><small>${escapeHtml(task.summary || task.stage || '')}</small><em>${escapeHtml(statusLabel(task.status))}${task.progress == null ? '' : ` · ${Math.round(task.progress)}%`}</em></span>
    <span class="unified-feed-arrow">${getIcon('arrow-right')}</span>
  </button>`).join('')
}

function messageRows(messages) {
  if (!messages?.length) return '<div class="unified-center-empty">当前筛选下没有消息</div>'
  return messages.map((message) => `<button type="button" class="unified-feed-row is-message${message.unread ? ' is-unread' : ''}" data-message-id="${message.id}">
    <span class="unified-feed-icon">${getIcon(message.source_type === 'resource_distribution' || message.source_type === 'course_file' ? 'document' : 'message')}</span>
    <span class="unified-feed-copy"><strong>${escapeHtml(message.title || '消息')}</strong><small>${escapeHtml(message.summary || '')}</small><em>${escapeHtml(typeLabel(message.notification_type))} · ${escapeHtml(timeLabel(message.created_at))}</em></span>
    ${message.unread ? '<i class="unified-unread-dot" aria-label="未读"></i>' : ''}
  </button>`).join('')
}

export function renderUnifiedTaskMessageCenter(user) {
  const role = escapeHtml(String(user?.role || '').toLowerCase())
  return `<div class="unified-work-center role-${role}" id="unified-work-center">
    <div class="unified-center-rail">
      <button type="button" class="unified-center-trigger" id="unified-center-trigger" aria-label="打开任务与消息中心" aria-controls="unified-center-panel" aria-expanded="false">
        <span class="unified-trigger-icon">${getIcon('message')}</span>
        <span class="unified-trigger-copy"><strong>任务与消息</strong><small id="unified-trigger-status">正在同步</small></span>
        <span class="unified-trigger-counts" aria-label="待办与最近提醒计数"><i id="unified-task-count" title="待办任务">0</i><i id="unified-message-count" title="最近提醒">0</i></span>
      </button>
      <button type="button" class="unified-center-dock-toggle" id="unified-center-dock-toggle" aria-label="向右收纳任务与消息中心" aria-expanded="true">${getIcon('arrow-right')}</button>
    </div>
    <section class="unified-center-panel" id="unified-center-panel" aria-label="任务与消息中心" hidden>
      <header><div><strong>任务与消息中心</strong><small id="unified-refreshed-at">正在读取真实数据</small></div><span class="unified-panel-actions"><button type="button" id="unified-center-refresh" aria-label="刷新">${getIcon('refresh')}</button><button type="button" id="unified-center-close" aria-label="关闭任务与消息中心">${getIcon('close')}</button></span></header>
      <div class="unified-center-tabs" role="tablist">
        <button type="button" class="is-active" data-center-tab="tasks" role="tab" aria-selected="true">待办任务 <span id="unified-tab-task-count">0</span></button>
        <button type="button" data-center-tab="messages" role="tab" aria-selected="false">最近消息 <span id="unified-tab-message-count">0</span></button>
      </div>
      <div class="unified-center-view" id="unified-task-view">
        <div class="unified-task-filters" id="unified-task-filters" aria-label="任务分类">
          <button type="button" class="is-active" data-task-filter="all">全部</button><button type="button" data-task-filter="ai_agent">AI 任务</button><button type="button" data-task-filter="learning_flow">学习流</button><button type="button" data-task-filter="file_generation">文件生成</button><button type="button" data-task-filter="background_task">后台任务</button>
        </div>
        <div id="unified-task-list" class="unified-feed-list"><div class="unified-center-loading">正在同步任务</div></div><footer><button type="button" id="unified-view-task-center">进入任务中心 ${getIcon('arrow-right')}</button></footer>
      </div>
      <div class="unified-center-view" id="unified-message-view" hidden>
        <div class="unified-message-tools" id="unified-message-tools" hidden>
          <button type="button" data-unread-filter="false" class="is-active">全部</button><button type="button" data-unread-filter="true">仅未读</button>
          <span class="unified-type-filters">${Object.entries(MESSAGE_TYPES).map(([key, item]) => `<button type="button" data-type-filter="${key}" class="${key === 'all' ? 'is-active' : ''}">${item.label}</button>`).join('')}</span>
        </div>
        <div id="unified-message-list" class="unified-feed-list"><div class="unified-center-loading">正在同步消息</div></div>
        <footer><button type="button" id="unified-read-all">全部已读</button><button type="button" id="unified-view-all-messages">查看全部消息</button><button type="button" id="unified-load-more" hidden>继续加载</button></footer>
      </div>
      <div class="unified-center-error" id="unified-center-error" hidden></div>
    </section>
    <div class="unified-message-modal" id="unified-message-modal" hidden>
      <div role="dialog" aria-modal="true" aria-labelledby="unified-message-title">
        <header><span>${getIcon('message')}</span><div><strong id="unified-message-title">消息详情</strong><small id="unified-message-meta"></small></div><button type="button" id="unified-message-close" aria-label="关闭">${getIcon('close')}</button></header>
        <div class="unified-message-body" id="unified-message-body"></div>
        <footer><button type="button" id="unified-message-dismiss">关闭</button><button type="button" class="is-primary" id="unified-message-action" hidden>打开关联内容</button></footer>
      </div>
    </div>
  </div>`
}

export function unmountUnifiedTaskMessageCenter() {
  activeController?.destroy()
  activeController = null
  document.getElementById('unified-work-center')?.remove()
}

export function mountUnifiedTaskMessageCenter(user) {
  activeController?.destroy()
  activeController = null
  const root = document.getElementById('unified-work-center')
  if (!root || !['student', 'teacher', 'admin'].includes(String(user?.role).toLowerCase())) return

  const trigger = root.querySelector('#unified-center-trigger')
  const dockToggle = root.querySelector('#unified-center-dock-toggle')
  const panel = root.querySelector('#unified-center-panel')
  const taskView = root.querySelector('#unified-task-view')
  const messageView = root.querySelector('#unified-message-view')
  const taskList = root.querySelector('#unified-task-list')
  const messageList = root.querySelector('#unified-message-list')
  const messageTools = root.querySelector('#unified-message-tools')
  const loadMore = root.querySelector('#unified-load-more')
  const errorBox = root.querySelector('#unified-center-error')
  const modal = root.querySelector('#unified-message-modal')
  let summary = { pending_task_count: 0, unread_message_count: 0, tasks: [], messages: [] }
  let open = false
  let collapsed = false
  let tab = 'tasks'
  let taskFilter = 'all'
  let expandedMessages = false
  let messagePage = 1
  let hasMore = false
  let unreadOnly = false
  let typeFilter = 'all'
  let messageItems = []
  let pollTimer = null
  let pulseTimer = null
  let destroyed = false
  let drag = null
  let dragFrame = null
  let dragNextY = null
  let suppressClick = false

  function positionPanel() {
    if (!open || panel.hidden) return
    const triggerRect = trigger.getBoundingClientRect()
    const panelHeight = panel.offsetHeight || Math.min(window.innerHeight * 0.7, 520)
    root.classList.toggle('panel-above', triggerRect.bottom + 9 + panelHeight > window.innerHeight - EDGE_MARGIN)
  }

  function setError(message = '') {
    errorBox.hidden = !message
    errorBox.textContent = message
  }

  function applyPosition(position) {
    const railHeight = root.querySelector('.unified-center-rail')?.offsetHeight || 52
    const y = clamp(position?.y ?? 88, EDGE_MARGIN, window.innerHeight - railHeight - EDGE_MARGIN)
    root.style.left = 'auto'
    root.style.top = `${y}px`
    root.style.right = '0px'
    positionPanel()
    return { y }
  }

  function updateCounts(previousUnread = summary.unread_message_count) {
    root.querySelector('#unified-task-count').textContent = summary.pending_task_count || 0
    root.querySelector('#unified-message-count').textContent = summary.unread_message_count || 0
    root.querySelector('#unified-tab-task-count').textContent = summary.pending_task_count || 0
    root.querySelector('#unified-tab-message-count').textContent = summary.unread_message_count || 0
    const recentTitle = summary.messages?.[0]?.title ? ` · 最近：${summary.messages[0].title}` : ''
    root.querySelector('#unified-trigger-status').textContent = `${summary.running_task_count || 0} 进行中 · ${summary.pending_task_count || 0} 待办 · ${summary.unread_message_count || 0} 未读${recentTitle}`
    if (summary.unread_message_count > previousUnread) {
      trigger.classList.add('has-new')
      clearTimeout(pulseTimer)
      pulseTimer = window.setTimeout(() => trigger.classList.remove('has-new'), 1400)
    }
  }

  function renderSummary() {
    const visibleTasks = taskFilter === 'all' ? summary.tasks : (summary.tasks || []).filter((task) => task.task_category === taskFilter)
    taskList.innerHTML = taskRows(visibleTasks)
    if (!expandedMessages) messageList.innerHTML = messageRows(summary.messages)
    root.querySelector('#unified-refreshed-at').textContent = `更新于 ${timeLabel(summary.refreshed_at || new Date())}`
    updateCounts()
  }

  async function refreshSummary({ silent = false } = {}) {
    if (destroyed || document.hidden) return
    const previousUnread = summary.unread_message_count || 0
    if (!silent) trigger.classList.add('is-refreshing')
    try {
      const result = await getWorkCenterSummary()
      if (destroyed) return
      summary = result.data || summary
      renderSummary()
      updateCounts(previousUnread)
      setError()
      if (expandedMessages) await loadMessages({ reset: true })
    } catch (error) {
      if (!silent) setError(error.message || '任务与消息同步失败')
    } finally {
      trigger.classList.remove('is-refreshing')
    }
  }

  function schedulePoll() {
    clearInterval(pollTimer)
    if (document.hidden || destroyed) return
    pollTimer = window.setInterval(() => refreshSummary({ silent: true }), open ? OPEN_INTERVAL : CLOSED_INTERVAL)
  }

  function switchTab(next) {
    tab = next
    taskView.hidden = tab !== 'tasks'
    messageView.hidden = tab !== 'messages'
    root.querySelectorAll('[data-center-tab]').forEach((button) => {
      const active = button.dataset.centerTab === tab
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
    })
  }

  function setOpen(next) {
    open = Boolean(next)
    panel.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
    root.classList.toggle('is-open', open)
    if (open) {
      requestAnimationFrame(positionPanel)
      refreshSummary({ silent: true })
    } else {
      root.classList.remove('panel-above')
    }
    schedulePoll()
  }

  function setCollapsed(next, { persist = true } = {}) {
    collapsed = Boolean(next)
    if (collapsed) setOpen(false)
    root.classList.toggle('is-collapsed', collapsed)
    trigger.setAttribute('aria-label', collapsed ? '展开任务与消息中心' : '打开任务与消息中心')
    dockToggle.setAttribute('aria-expanded', String(!collapsed))
    if (persist) saveCollapsed(user, collapsed)
    applyPosition({ y: root.getBoundingClientRect().top })
  }

  function queueDragPosition(y) {
    dragNextY = y
    if (dragFrame != null) return
    dragFrame = window.requestAnimationFrame(() => {
      dragFrame = null
      const nextY = dragNextY
      dragNextY = null
      if (Number.isFinite(nextY)) applyPosition({ y: nextY })
    })
  }

  async function loadMessages({ reset = false } = {}) {
    if (reset) { messagePage = 1; messageItems = [] }
    messageList.innerHTML = reset ? '<div class="unified-center-loading">正在读取消息</div>' : messageList.innerHTML
    try {
      const selectedType = MESSAGE_TYPES[typeFilter]?.value || ''
      const result = await getWorkCenterMessages({ page: messagePage, page_size: 12, is_read: unreadOnly ? false : '', notification_type: selectedType })
      const data = result.data || {}
      messageItems = reset ? (data.list || []) : [...messageItems, ...(data.list || [])]
      hasMore = Boolean(data.has_more)
      messageList.innerHTML = messageRows(messageItems)
      loadMore.hidden = !hasMore
      setError()
    } catch (error) { setError(error.message || '消息列表读取失败') }
  }

  async function openMessage(id) {
    try {
      const result = await getWorkCenterMessage(id)
      const message = result.data
      root.querySelector('#unified-message-title').textContent = message.title || '消息详情'
      root.querySelector('#unified-message-meta').textContent = `${typeLabel(message.notification_type)} · ${timeLabel(message.created_at)}${message.sender_name ? ` · ${message.sender_name}` : ''}`
      const related = message.related
      root.querySelector('#unified-message-body').innerHTML = `<p>${escapeHtml(message.content || message.summary || '暂无详细内容')}</p>${related ? `<dl><div><dt>课程</dt><dd>${escapeHtml(related.course?.course_name || '-')}</dd></div><div><dt>教学班</dt><dd>${escapeHtml(related.teaching_class?.teaching_class_name || '-')}</dd></div><div><dt>文件</dt><dd>${escapeHtml(related.file?.original_filename || related.file?.title || '-')}</dd></div></dl>` : ''}`
      const action = root.querySelector('#unified-message-action')
      action.hidden = !message.action_url
      action.dataset.url = message.action_url || ''
      if (message.unread) {
        await readWorkCenterMessage(id)
        summary.unread_message_count = Math.max(0, (summary.unread_message_count || 0) - 1)
        summary.messages = summary.messages.map((item) => item.id === Number(id) ? { ...item, unread: false, status: 'read' } : item)
        messageItems = messageItems.map((item) => item.id === Number(id) ? { ...item, unread: false, status: 'read' } : item)
        updateCounts()
        if (expandedMessages) messageList.innerHTML = messageRows(messageItems)
      }
      modal.hidden = false
      root.querySelector('#unified-message-close').focus()
    } catch (error) { setError(error.message || '消息详情读取失败') }
  }

  function closeModal() { modal.hidden = true; trigger.focus({ preventScroll: true }) }

  trigger.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return
    if (open) setOpen(false)
    const rect = root.getBoundingClientRect()
    drag = { pointerId: event.pointerId, startY: event.clientY, y: rect.top, moved: false }
    trigger.setPointerCapture?.(event.pointerId)
  })
  trigger.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.abs(dy) < DRAG_THRESHOLD) return
    drag.moved = true
    suppressClick = true
    root.classList.add('is-dragging')
    queueDragPosition(drag.y + dy)
    event.preventDefault()
  })
  trigger.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return
    if (dragFrame != null) window.cancelAnimationFrame(dragFrame)
    dragFrame = null
    if (Number.isFinite(dragNextY)) applyPosition({ y: dragNextY })
    dragNextY = null
    if (drag.moved) {
      savePosition(user, applyPosition({ y: root.getBoundingClientRect().top }))
    }
    root.classList.remove('is-dragging')
    drag = null
    window.setTimeout(() => { suppressClick = false }, 0)
  })
  trigger.addEventListener('pointercancel', () => {
    if (dragFrame != null) window.cancelAnimationFrame(dragFrame)
    dragFrame = null
    dragNextY = null
    drag = null
    suppressClick = false
    root.classList.remove('is-dragging')
  })
  trigger.addEventListener('click', () => {
    if (suppressClick) return
    if (collapsed) setCollapsed(false)
    else setOpen(!open)
  })
  dockToggle.addEventListener('click', () => { setCollapsed(true); trigger.focus({ preventScroll: true }) })
  root.querySelectorAll('[data-center-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.centerTab)))
  root.querySelector('#unified-center-refresh').addEventListener('click', () => refreshSummary())
  root.querySelector('#unified-center-close').addEventListener('click', () => { setOpen(false); trigger.focus({ preventScroll: true }) })
  root.querySelector('#unified-task-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-task-filter]')
    if (!button) return
    taskFilter = button.dataset.taskFilter
    root.querySelectorAll('[data-task-filter]').forEach((item) => item.classList.toggle('is-active', item === button))
    renderSummary()
  })
  root.querySelector('#unified-view-task-center').addEventListener('click', () => {
    const role = String(user.role).toLowerCase()
    window.location.hash = role === 'student' ? '#/student/agent-tasks' : role === 'teacher' ? '#/teacher/artifacts' : '#/admin/logs'
  })
  root.querySelector('#unified-view-all-messages').addEventListener('click', async () => {
    expandedMessages = true
    messageTools.hidden = false
    root.querySelector('#unified-view-all-messages').hidden = true
    await loadMessages({ reset: true })
  })
  root.querySelector('#unified-read-all').addEventListener('click', async () => {
    try { await readAllWorkCenterMessages(); summary.unread_message_count = 0; updateCounts(); await refreshSummary({ silent: true }) } catch (error) { setError(error.message) }
  })
  loadMore.addEventListener('click', async () => { if (hasMore) { messagePage += 1; await loadMessages() } })
  messageList.addEventListener('click', (event) => { const row = event.target.closest('[data-message-id]'); if (row) openMessage(row.dataset.messageId) })
  taskList.addEventListener('click', (event) => { const row = event.target.closest('[data-task-url]'); if (row?.dataset.taskUrl) window.location.hash = row.dataset.taskUrl })
  messageTools.addEventListener('click', async (event) => {
    const unread = event.target.closest('[data-unread-filter]')
    const type = event.target.closest('[data-type-filter]')
    if (unread) {
      unreadOnly = unread.dataset.unreadFilter === 'true'
      messageTools.querySelectorAll('[data-unread-filter]').forEach((button) => button.classList.toggle('is-active', button === unread))
    }
    if (type) {
      typeFilter = type.dataset.typeFilter
      messageTools.querySelectorAll('[data-type-filter]').forEach((button) => button.classList.toggle('is-active', button === type))
    }
    if (unread || type) await loadMessages({ reset: true })
  })
  root.querySelector('#unified-message-close').addEventListener('click', closeModal)
  root.querySelector('#unified-message-dismiss').addEventListener('click', closeModal)
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal() })
  root.querySelector('#unified-message-action').addEventListener('click', (event) => { if (event.currentTarget.dataset.url) window.location.hash = event.currentTarget.dataset.url; closeModal() })
  const visibilityHandler = () => { if (document.hidden) clearInterval(pollTimer); else { refreshSummary({ silent: true }); schedulePoll() } }
  const outsideHandler = (event) => {
    if (open && !root.contains(event.target)) setOpen(false)
  }
  const keyHandler = (event) => {
    if (event.key !== 'Escape') return
    if (!modal.hidden) closeModal()
    else if (open) { setOpen(false); trigger.focus({ preventScroll: true }) }
  }
  const resizeHandler = () => {
    savePosition(user, applyPosition({ y: root.getBoundingClientRect().top }))
    positionPanel()
  }
  document.addEventListener('visibilitychange', visibilityHandler)
  document.addEventListener('pointerdown', outsideHandler)
  document.addEventListener('keydown', keyHandler)
  window.addEventListener('resize', resizeHandler, { passive: true })

  activeController = {
    destroy() {
      destroyed = true
      clearInterval(pollTimer)
      clearTimeout(pulseTimer)
      if (dragFrame != null) window.cancelAnimationFrame(dragFrame)
      document.removeEventListener('visibilitychange', visibilityHandler)
      document.removeEventListener('pointerdown', outsideHandler)
      document.removeEventListener('keydown', keyHandler)
      window.removeEventListener('resize', resizeHandler)
    },
  }
  applyPosition(readPosition(user))
  setCollapsed(readCollapsed(user), { persist: false })
  switchTab('tasks')
  refreshSummary()
  schedulePoll()
}
