import { escapeHtml } from '../../utils/format.js'

export default function AiMessageItem(message = {}) {
  const role = message.role === 'user' ? 'user' : 'assistant'
  const content = String(message.content || '').trim()
  const status = ['pending', 'streaming', 'done', 'failed'].includes(message.status) ? message.status : 'done'
  const label = role === 'user' ? '我' : 'DisciMind AI'
  const time = message.createdAt ? new Date(message.createdAt) : null
  const timeText = time && !Number.isNaN(time.getTime()) ? time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
  return `<article class="ai-message ai-message--${role}" data-message-status="${status}">
    <div class="ai-message__meta"><strong>${label}</strong>${timeText ? `<time>${escapeHtml(timeText)}</time>` : ''}</div>
    <div class="ai-message__content">${escapeHtml(content || (status === 'pending' ? '正在思考…' : '暂无内容')).replace(/\n/g, '<br>')}</div>
  </article>`
}
