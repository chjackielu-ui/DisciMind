import { get, post, BASE_URL } from './request.js'
import { getToken } from '../utils/auth.js'

export const listTasks = (params = {}) => get('/tasks', { params })
export const listActiveTasks = () => get('/tasks/active')
export const getTask = id => get(`/tasks/${id}`)
export const cancelTask = (id) => post(`/tasks/${id}/cancel`, {})
export const retryTask = (id) => post(`/tasks/${id}/retry`, {})
export const dismissTaskRecord = (id) => post(`/tasks/${id}/dismiss`, {})
export const dismissTerminalTasks = (statuses) => post('/tasks/dismiss-terminal', statuses?.length ? { statuses } : {})
export const bulkCancelTasks = ids => post('/tasks/bulk/cancel', { ids })
export const bulkDismissTasks = ids => post('/tasks/bulk/dismiss', { ids })
export const bulkDeleteTasks = ids => post('/tasks/bulk/delete', { ids })

export async function streamTasks({ signal, onTasks, onError } = {}) {
  const response = await fetch(`${BASE_URL}/tasks/stream`, {
    signal,
    headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
    credentials: 'include',
  })
  if (!response.ok) throw new Error(`任务流连接失败 (${response.status})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue }
      if (!line.startsWith('data:')) continue
      const payload = JSON.parse(line.slice(5).trim())
      if (eventName === 'tasks') onTasks?.(payload)
      if (eventName === 'error') onError?.(payload)
      eventName = ''
    }
  }
}
