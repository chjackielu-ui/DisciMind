import { listTasks } from '../api/tasks.js'
import { ACTIVE_TASK_STATUSES, createTaskPoller } from './task-center-state.js'

const AUTO_COLLAPSE_MS = 2500
const INTRO_STORAGE_PREFIX = 'discimind:task-island:intro:'
let singleton = null

function consumeLoginIntro(userId) {
  const key = `${INTRO_STORAGE_PREFIX}${userId}`
  try {
    if (sessionStorage.getItem(key) === 'shown') return false
    sessionStorage.setItem(key, 'shown')
  } catch {}
  return true
}

function escapeHtml(value) {
  const div = document.createElement('div')
  div.textContent = String(value ?? '')
  return div.innerHTML
}

function stageText(task) {
  return task?.stage || ({ QUEUED: '等待开始', RUNNING: '处理中', WAITING_EXTERNAL: '等待外部服务', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消' })[task?.status] || '后台任务'
}

class TaskIslandController {
  constructor(userId, root) {
    this.userId = userId
    this.root = root
    this.tasks = []
    this.expanded = consumeLoginIntro(userId)
    this.signature = ''
    this.syncExhausted = false
    this.collapseTimer = 0
    this.onFocus = () => { if (document.visibilityState === 'visible') void this.poller.syncNow() }
    this.onOutsidePointer = event => { if (!this.root?.contains(event.target)) this.collapseNow() }
    this.poller = createTaskPoller({
      sync: async () => {
        const response = await listTasks({ pageSize: 50 })
        const items = response.data?.list || []
        return { items, hasActive: items.some(task => ACTIVE_TASK_STATUSES.has(task.status)) }
      },
      onData: result => this.accept(result.items),
      onExhausted: () => { this.syncExhausted = true; this.render() },
    })
    window.addEventListener('focus', this.onFocus)
    document.addEventListener('visibilitychange', this.onFocus)
    document.addEventListener('pointerdown', this.onOutsidePointer, true)
    void this.poller.start()
  }

  accept(items) {
    const signature = items.map(task => `${task.id}:${task.status}:${task.progress}:${task.stage}`).join('|')
    this.tasks = items
    this.syncExhausted = false
    this.signature = signature
    this.render()
    if (this.expanded) this.scheduleCollapse()
  }

  onTaskCenterPage() { return window.location.hash.includes('/student/agent-tasks') }
  bind(root) { this.root = root; this.render(); if (this.onTaskCenterPage()) this.collapseNow(); else if (this.expanded) this.scheduleCollapse() }
  collapseNow() {
    this.expanded = false
    clearTimeout(this.collapseTimer)
    this.root?.classList.remove('is-expanded')
  }
  stop() {
    this.poller.stop()
    clearTimeout(this.collapseTimer)
    window.removeEventListener('focus', this.onFocus)
    document.removeEventListener('visibilitychange', this.onFocus)
    document.removeEventListener('pointerdown', this.onOutsidePointer, true)
  }
  expand() {
    this.expanded = true
    clearTimeout(this.collapseTimer)
    this.root?.classList.add('is-expanded')
    this.collapseTimer = window.setTimeout(() => {
      if (this.root?.matches(':hover') || this.root?.contains(document.activeElement)) return this.scheduleCollapse()
      this.collapseNow()
    }, AUTO_COLLAPSE_MS)
  }
  scheduleCollapse() {
    clearTimeout(this.collapseTimer)
    this.collapseTimer = window.setTimeout(() => {
      if (this.root?.matches(':hover') || this.root?.contains(document.activeElement)) return this.scheduleCollapse()
      this.collapseNow()
    }, AUTO_COLLAPSE_MS)
  }
  render() {
    if (!this.root?.isConnected) return
    const active = this.tasks.filter(task => ACTIVE_TASK_STATUSES.has(task.status))
    const recent = active[0] || this.tasks[0] || null
    const count = Math.min(99, this.tasks.length)
    const progress = recent?.progressMode === 'DETERMINATE' && Number.isFinite(Number(recent.progress)) ? Math.max(0, Math.min(100, Number(recent.progress))) : null
    this.root.className = `global-task-center${this.expanded ? ' is-expanded' : ''}${this.syncExhausted ? ' is-sync-error' : ''}`
    this.root.innerHTML = `<button class="global-task-island" type="button" aria-label="进入任务中心" title="进入任务中心">
      <span class="global-task-island-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg></span>
      <b class="global-task-island-count">${this.syncExhausted ? '!' : count}</b>
      <span class="global-task-island-copy"><strong>${escapeHtml(recent?.title || '任务中心')}</strong><small>${escapeHtml(this.syncExhausted ? '状态同步失败，点击查看' : recent ? stageText(recent) : '暂无后台任务')}</small>${progress == null ? '' : `<i><em style="width:${progress}%"></em></i>`}</span>
      <span class="global-task-island-active">${active.length ? `${active.length} 进行中` : '查看全部'}</span>
    </button>`
    const button = this.root.querySelector('.global-task-island')
    button?.addEventListener('click', () => { window.location.hash = '#/student/agent-tasks' })
    button?.addEventListener('pointerenter', () => this.expand())
    button?.addEventListener('pointerleave', () => this.scheduleCollapse())
    button?.addEventListener('focus', () => this.expand())
    button?.addEventListener('blur', () => this.scheduleCollapse())
  }
}

export function mountTaskCenter(user) {
  const root = document.getElementById('global-task-center')
  const userId = user?.user_id || user?.id
  if (!root || user?.role !== 'student' || !userId) {
    singleton?.stop(); singleton = null; return
  }
  if (singleton && String(singleton.userId) === String(userId)) { singleton.bind(root); return }
  singleton?.stop()
  singleton = new TaskIslandController(userId, root)
}
