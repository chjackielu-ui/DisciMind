import { listTasks, getTask, cancelTask, dismissTerminalTasks } from '../api/tasks.js'
import {
  ACTIVE_TASK_STATUSES, TERMINAL_TASK_STATUSES, createTaskPoller, parseTaskCardState, shouldShowTask,
  snapshotTask, taskStateStorageKey, validResultUrl,
} from './task-center-state.js'

const COLLAPSE_KEY = 'discimind.asyncTaskCenterCollapsed'
const STAGE_LABELS = {
  QUEUED: '等待开始', RUNNING: '处理中', WAITING_EXTERNAL: '等待外部服务',
  UPLOADING: '正在上传', PARSING: '正在解析', INDEXING: '正在建立索引',
  READY: '处理完成', FAILED: '处理失败', CANCELLED: '已取消',
}

let singleton = null

function readCardState(userId) {
  try { return parseTaskCardState(localStorage.getItem(taskStateStorageKey(userId))) } catch { return {} }
}

function writeCardState(userId, state) {
  try { localStorage.setItem(taskStateStorageKey(userId), JSON.stringify(state)) } catch {}
}

function escapeHtml(value) {
  const div = document.createElement('div')
  div.textContent = String(value ?? '')
  return div.innerHTML
}

function actionLabel(task) {
  if (task.requiresUserAction) return '前往处理'
  if (task.taskType === 'DOCUMENT_EXPORT' && task.status === 'FAILED') return '重新导出'
  if (task.taskType === 'DOCUMENT_EXPORT' && task.status === 'SUCCEEDED') return '查看产物'
  if (task.taskType === 'FILE_GENERATION' && task.status === 'SUCCEEDED') return '查看产物'
  if (task.status === 'FAILED' && task.taskType === 'FILE_GENERATION') return '重新处理'
  if (task.taskType === 'LEARNING_FLOW_PRELOAD' && task.status === 'SUCCEEDED') return '前往学习'
  if (task.taskType === 'LEARNING_FLOW_PRELOAD' && task.status === 'FAILED') return '重新准备'
  if (task.taskType === 'VOICE_PRELOAD') return '前往学习'
  if (task.status === 'SUCCEEDED') return '查看结果'
  return '查看详情'
}

function taskDisplayTitle(task) {
  if (task.taskType !== 'DOCUMENT_EXPORT') return task.title
  const material = `${task.title || ''} ${task.stage || ''} ${task.resultUrl || ''}`
  const format = material.includes('PDF') ? 'PDF' : 'DOCX'
  if (task.status === 'SUCCEEDED') return `${format} 已生成`
  if (task.status === 'FAILED') return `${format} 导出失败`
  return `正在导出 ${format}`
}

function taskTypeBadge(taskType) {
  return ({ KNOWLEDGE_INDEXING: '知', FILE_GENERATION: '文', DOCUMENT_EXPORT: '导', LEARNING_FLOW_PRELOAD: '备', VOICE_PRELOAD: '音', ARTIFACT_CLEANUP: '清' })[taskType] || '任'
}

function taskCard(task) {
  const determinate = task.progressMode === 'DETERMINATE' && Number.isFinite(Number(task.progress))
  const progress = determinate ? Math.max(0, Math.min(100, Number(task.progress))) : null
  const stage = STAGE_LABELS[task.stage] || task.stage || STAGE_LABELS[task.status] || task.status
  const resultUrl = validResultUrl(task.resultUrl)
  return `<article class="global-task-card is-${String(task.status).toLowerCase()}" data-task-id="${task.id}">
    <div class="global-task-card-head"><span class="global-task-type">${taskTypeBadge(task.taskType)}</span><div><strong>${escapeHtml(taskDisplayTitle(task))}</strong><p>${escapeHtml(stage)}</p></div><button type="button" data-task-hide title="隐藏任务卡">×</button></div>
    ${determinate ? `<div class="global-task-progress"><i style="width:${progress}%"></i></div><span class="global-task-percent">${progress}%</span>` : `<div class="global-task-stage-only">${task.progressMode === 'INDETERMINATE' ? '处理中…' : escapeHtml(stage)}</div>`}
    ${task.errorMessage ? `<p class="global-task-error">${escapeHtml(task.errorMessage)}</p>` : ''}
    <footer>${resultUrl ? `<button type="button" data-task-open>${actionLabel(task)}</button>` : ''}${task.cancellable && task.status === 'RUNNING' ? '<button type="button" data-task-cancel>取消任务</button>' : ''}</footer>
  </article>`
}

class TaskCenterController {
  constructor(userId, root) {
    this.userId = userId
    this.root = root
    this.tasks = []
    this.collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'
    this.syncExhausted = false
    this.onFocus = () => { if (document.visibilityState === 'visible') void this.poller.syncNow() }
    this.poller = createTaskPoller({
      sync: async () => {
        const result = await listTasks({ pageSize: 50 })
        const items = result.data?.list || []
        return { items, hasActive: items.some(task => ACTIVE_TASK_STATUSES.has(task.status)) }
      },
      onData: result => { this.tasks = result.items; this.syncExhausted = false; this.render() },
      onExhausted: () => { this.syncExhausted = true; this.render() },
    })
    window.addEventListener('focus', this.onFocus)
    document.addEventListener('visibilitychange', this.onFocus)
    void this.poller.start()
  }

  bind(root) { this.root = root; this.render() }

  stop() {
    this.poller.stop()
    window.removeEventListener('focus', this.onFocus)
    document.removeEventListener('visibilitychange', this.onFocus)
  }

  render() {
    if (!this.root?.isConnected) return
    const state = readCardState(this.userId)
    const visible = this.tasks.filter(task => shouldShowTask(task, state[String(task.id)]))
    const activeCount = this.tasks.filter(task => ACTIVE_TASK_STATUSES.has(task.status)).length
    const terminalCount = this.tasks.filter(task => TERMINAL_TASK_STATUSES.has(task.status)).length
    this.root.classList.toggle('is-sync-error', this.syncExhausted)
    this.root.innerHTML = `<button class="global-task-trigger" type="button" aria-label="任务中心" aria-expanded="${!this.collapsed}"><span>任务</span>${activeCount ? `<b>${activeCount}</b>` : this.syncExhausted ? '<b>!</b>' : ''}</button>
      <section class="global-task-panel ${this.collapsed ? 'is-collapsed' : ''}"><header><div><strong>任务中心</strong><span>${activeCount ? `${activeCount} 个任务进行中` : '后台任务'}</span></div><div class="global-task-header-actions">${terminalCount ? '<button type="button" data-task-dismiss-terminal>清除已结束任务</button>' : ''}<button type="button" data-task-collapse>${this.collapsed ? '展开' : '折叠'}</button></div></header>
      ${this.syncExhausted ? '<div class="global-task-sync-error"><p>暂时无法同步任务状态，后台任务可能仍在继续。</p><button type="button" data-task-resync>重新同步</button></div>' : ''}
      <div class="global-task-list">${visible.map(taskCard).join('') || '<p class="global-task-empty">暂无需要关注的任务</p>'}</div></section>`
    this.bindEvents()
  }

  bindEvents() {
    const toggle = () => {
      this.collapsed = !this.collapsed
      localStorage.setItem(COLLAPSE_KEY, this.collapsed ? '1' : '0')
      this.render()
    }
    this.root.querySelector('.global-task-trigger')?.addEventListener('click', toggle)
    this.root.querySelector('[data-task-collapse]')?.addEventListener('click', toggle)
    this.root.querySelector('[data-task-resync]')?.addEventListener('click', () => { void this.poller.syncNow({ manual: true }) })
    this.root.querySelector('[data-task-dismiss-terminal]')?.addEventListener('click', async event => {
      if (!confirm('清除所有已完成、失败和已取消的任务？后台记录不会被删除。')) return
      event.currentTarget.disabled = true
      const terminalIds = this.tasks.filter(task => TERMINAL_TASK_STATUSES.has(task.status)).map(task => String(task.id))
      try {
        await dismissTerminalTasks()
        const next = readCardState(this.userId); terminalIds.forEach(id => { delete next[id] }); writeCardState(this.userId, next)
        this.tasks = this.tasks.filter(task => !TERMINAL_TASK_STATUSES.has(task.status))
        this.render(); await this.poller.syncNow({ manual: true })
      } catch (error) { event.currentTarget.disabled = false; event.currentTarget.title = error.message }
    })
    this.root.querySelectorAll('[data-task-hide]').forEach(button => button.addEventListener('click', () => {
      const id = button.closest('[data-task-id]')?.dataset.taskId
      const task = this.tasks.find(item => String(item.id) === String(id))
      if (!task) return
      const next = readCardState(this.userId)
      next[String(id)] = snapshotTask(task)
      writeCardState(this.userId, next)
      this.render()
    }))
    this.root.querySelectorAll('[data-task-open]').forEach(button => button.addEventListener('click', async () => {
      const id = button.closest('[data-task-id]')?.dataset.taskId
      button.disabled = true
      try {
        const detail = await getTask(id)
        const url = validResultUrl(detail.data?.resultUrl)
        if (!url) throw new Error('任务结果不存在或无权访问')
        window.location.hash = url.slice(1)
      } catch (error) { button.disabled = false; button.title = error.message }
    }))
    this.root.querySelectorAll('[data-task-cancel]').forEach(button => button.addEventListener('click', async () => {
      const id = button.closest('[data-task-id]')?.dataset.taskId
      button.disabled = true
      try { await cancelTask(id); await this.poller.syncNow({ manual: true }) }
      catch (error) { button.disabled = false; button.title = error.message }
    }))
  }
}

export function mountTaskCenter(user) {
  const root = document.getElementById('global-task-center')
  const userId = user?.user_id || user?.id
  if (!root || user?.role !== 'student' || !userId) {
    singleton?.stop()
    singleton = null
    return
  }
  if (singleton && String(singleton.userId) === String(userId)) {
    singleton.bind(root)
    return
  }
  singleton?.stop()
  singleton = new TaskCenterController(userId, root)
}

export { shouldShowTask as shouldShow }
