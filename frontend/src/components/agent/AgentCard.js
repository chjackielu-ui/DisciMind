import { escapeHtml } from '../../utils/format.js'
import AgentTag from './AgentTag.js'
import AgentTypeBadge from './AgentTypeBadge.js'

export default function AgentCard(agent = {}, options = {}) {
  const id = Number(agent.id ?? agent.agent_id ?? agent.agentId)
  const safeId = Number.isInteger(id) && id > 0 ? id : ''
  const name = String(agent.name || agent.agent_name || '未命名智能体').trim().slice(0, 100)
  const description = String(agent.description || '暂无简介').trim().slice(0, 500)
  const tags = (Array.isArray(agent.tags) ? agent.tags : []).slice(0, 6).map(tag => AgentTag(tag)).join('')
  const actionLabel = String(options.actionLabel || '使用智能体').slice(0, 30)
  return `<article class="agent-card" data-agent-id="${safeId}">
    <header class="agent-card__header"><h3>${escapeHtml(name)}</h3>${AgentTypeBadge(agent.runtime_type || agent.agent_type || agent.type)}</header>
    <p class="agent-card__description">${escapeHtml(description)}</p>
    ${tags ? `<div class="agent-card__tags">${tags}</div>` : ''}
    <button class="agent-card__action" type="button" data-agent-action="open" ${safeId ? '' : 'disabled'}>${escapeHtml(actionLabel)}</button>
  </article>`
}
