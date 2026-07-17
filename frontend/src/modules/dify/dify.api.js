import { BASE_URL, get, post } from '../../api/request.js'
import { getToken } from '../../utils/auth.js'

export const difyApi = {
  health: () => get('/dify/health'),
  chat: (payload) => post('/dify/chat', { ...payload, response_mode: 'blocking' }),
  workflow: (inputs) => post('/dify/workflow', { inputs }),
  async streamChat(payload, { signal, onEvent } = {}) {
    const response = await fetch(`${BASE_URL}/dify/chat`, {
      method: 'POST', credentials: 'include', signal,
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: JSON.stringify({ ...payload, response_mode: 'streaming' }),
    })
    if (!response.ok || !response.body) throw new Error(`Dify 流式请求失败（HTTP ${response.status}）`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() || ''
        for (const frame of frames) {
          const event = frame.match(/^event:\s*(.+)$/m)?.[1] || 'message'
          const raw = frame.match(/^data:\s*(.+)$/m)?.[1]
          if (!raw) continue
          const data = JSON.parse(raw)
          onEvent?.({ event, data })
          if (event === 'error') throw new Error(data.message || 'Dify 流式调用失败')
        }
      }
    } finally { reader.releaseLock() }
  },
}

export default difyApi
