import { escapeHtml } from '../../utils/format.js'

export default function AgentTag(label, options = {}) {
  const text = String(label || '').trim()
  if (!text) return ''
  const tone = ['neutral', 'primary', 'success', 'warning'].includes(options.tone) ? options.tone : 'neutral'
  return `<span class="agent-tag agent-tag--${tone}">${escapeHtml(text.slice(0, 40))}</span>`
}
