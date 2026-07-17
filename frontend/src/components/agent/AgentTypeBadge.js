import { escapeHtml } from '../../utils/format.js'

const LABELS = Object.freeze({
  dify: 'Dify', self: '自研', langgraph: 'LangGraph', model_direct: '模型直连',
  course_qa: '课程问答', trainer: '训练师', explainer: '讲解师', diagnostician: '诊断师',
})

export default function AgentTypeBadge(type) {
  const key = String(type || 'self').trim().toLowerCase()
  const cssKey = /^[a-z0-9_-]+$/.test(key) ? key : 'self'
  return `<span class="agent-type-badge agent-type-badge--${cssKey}">${escapeHtml(LABELS[key] || type || '自研')}</span>`
}
