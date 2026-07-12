export const ACTIVE_TASK_STATUSES = new Set(['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'])
export const TERMINAL_TASK_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])

const RESULT_URL_PATTERNS = [
  /^#\/student\/agents(?:\/knowledge|\/\d+(?:\/.*)?)?$/,
  /^#\/student\/generated-artifacts(?:\/\d+)?(?:\?.*)?$/,
  /^#\/student\/artifacts(?:\/\d+)?(?:\?.*)?$/,
  /^#\/student\/learning-flows(?:\?.*)?$/,
  /^#\/student\/learning\/session\/\d+$/,
]

export function validResultUrl(value) {
  const url = String(value || '').trim()
  return RESULT_URL_PATTERNS.some(pattern => pattern.test(url)) ? url : ''
}

export function taskStateStorageKey(userId) {
  return `discimind.asyncTaskCardState.v2.${String(userId || 'anonymous')}`
}

export function parseTaskCardState(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value && typeof value === 'object' && value.dismissedAt))
  } catch {
    return {}
  }
}

export function snapshotTask(task, now = new Date()) {
  return {
    taskId: task.id,
    lastSeenProgress: task.progressMode === 'DETERMINATE' && Number.isFinite(Number(task.progress)) ? Number(task.progress) : null,
    lastSeenStatus: task.status || null,
    lastSeenResultUrl: validResultUrl(task.resultUrl) || null,
    lastSeenNeedsAction: Boolean(task.requiresUserAction),
    dismissedAt: now.toISOString(),
  }
}

export function shouldShowTask(task, snapshot) {
  if (!snapshot?.dismissedAt) return true
  const currentProgress = task.progressMode === 'DETERMINATE' ? Number(task.progress) : null
  const seenProgress = Number(snapshot.lastSeenProgress)
  if (Number.isFinite(currentProgress) && currentProgress >= 90 && (!Number.isFinite(seenProgress) || seenProgress < 90)) return true
  if (TERMINAL_TASK_STATUSES.has(task.status) && task.status !== snapshot.lastSeenStatus) return true
  if (Boolean(task.requiresUserAction) && !Boolean(snapshot.lastSeenNeedsAction)) return true
  const currentUrl = validResultUrl(task.resultUrl)
  const seenUrl = validResultUrl(snapshot.lastSeenResultUrl)
  if (currentUrl && currentUrl !== seenUrl) return true
  return false
}

export function createTaskPoller({
  sync,
  onData = () => {},
  onExhausted = () => {},
  schedule = (fn, delay) => setTimeout(fn, delay),
  cancelSchedule = timer => clearTimeout(timer),
  activeDelay = 3000,
  retryDelays = [1000, 2000, 4000],
} = {}) {
  let timer = null
  let running = false
  let stopped = false
  let retryIndex = 0

  const cancelTimer = () => {
    if (timer != null) cancelSchedule(timer)
    timer = null
  }
  const plan = delay => {
    cancelTimer()
    if (!stopped) timer = schedule(() => { timer = null; void run() }, delay)
  }
  const run = async ({ manual = false } = {}) => {
    if (stopped || running) return
    if (manual) { retryIndex = 0; cancelTimer() }
    running = true
    try {
      const result = await sync()
      retryIndex = 0
      onData(result)
      if (result?.hasActive) plan(activeDelay)
      else cancelTimer()
    } catch (error) {
      if (retryIndex < retryDelays.length) plan(retryDelays[retryIndex++])
      else { cancelTimer(); onExhausted(error) }
    } finally {
      running = false
    }
  }
  return {
    start: () => { stopped = false; return run() },
    syncNow: options => run(options),
    stop: () => { stopped = true; cancelTimer() },
    hasTimer: () => timer != null,
    isRunning: () => running,
  }
}
