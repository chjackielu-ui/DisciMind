import {
  listAgents, listMyAgents, listFavoriteAgents, getAgent, createAgentConversation,
  favoriteAgent, unfavoriteAgent, copyAgent, applyAgentPublic, deleteAgent, rateAgent, reportAgent, getHotAgentRankings,
} from '../../api/marketplace.js'
import { escapeHtml } from '../../utils/format.js'
import { renderMarketplaceLayout, loadingHTML, errorHTML, statusLabel, operationId, setButtonBusy, notify } from './marketplace-shared.js'

function avatar(agent) {
  const name = agent.version?.name || 'AI'
  return `<div class="agent-card-avatar">${escapeHtml(name.slice(0, 1))}</div>`
}

function agentCard(agent, mode) {
  const v = agent.version || {}
  const tags = [...(v.tags?.purpose || []), ...(v.tags?.style || [])].slice(0, 3)
  const own = mode === 'mine'
  return `<article class="agent-market-card" data-agent-id="${agent.id}">
    <div class="agent-card-head">${avatar(agent)}<div><h3>${escapeHtml(v.name || '未命名智能体')}</h3><p>${escapeHtml(agent.creator?.name || '未知创建者')} · ${escapeHtml(agent.category || '综合工具')}</p></div>
      <button class="agent-favorite-btn${agent.isFavorite ? ' active' : ''}" type="button" data-action="favorite" aria-label="收藏">${agent.isFavorite ? '★' : '☆'}</button>
    </div>
    <p class="agent-card-description">${escapeHtml(v.shortDescription || '')}</p>
    <div class="agent-card-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}${v.responseMode === 'KNOWLEDGE_FIRST' ? '<span>知识库增强</span>' : ''}</div>
    <div class="agent-card-stats"><span>使用 ${agent.usageCount || 0}</span><span>评分 ${Number(agent.ratingAverage || 0).toFixed(1)} (${agent.ratingCount || 0})</span>${own ? `<span class="agent-status status-${String(agent.status).toLowerCase()}">${statusLabel(agent.status)}</span>` : ''}</div>
    <div class="agent-card-actions">
      <button class="complex-btn" type="button" data-action="use">立即使用</button>
      ${own ? '<button class="complex-btn-secondary" type="button" data-action="edit">编辑</button>' : ''}
      <details class="agent-more"><summary>更多</summary><div>
        <button type="button" data-action="detail">查看详情</button>
        ${own ? `<button type="button" data-action="apply" ${['PUBLIC_PENDING', 'PUBLIC'].includes(agent.status) || v.reviewStatus === 'PENDING' ? 'disabled' : ''}>申请公开</button><button type="button" data-action="delete">删除</button>` : '<button type="button" data-action="copy">复制智能体</button><button type="button" data-action="report">举报</button>'}
      </div></details>
    </div>
  </article>`
}

async function startConversation(agentId, button) {
  setButtonBusy(button, true, '正在进入...')
  try {
    const result = await createAgentConversation(agentId, { title: '新对话', operationId: operationId() })
    window.location.hash = `#/student/agents/${agentId}/chat/${result.data.id}`
  } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
}

function bindCards(root, agents, mode, reload) {
  root.querySelectorAll('.agent-market-card').forEach(card => {
    const id = Number(card.dataset.agentId)
    const agent = agents.find(item => item.id === id)
    card.addEventListener('click', async event => {
      const button = event.target.closest('[data-action]')
      if (!button) return
      const action = button.dataset.action
      try {
        if (action === 'use') return startConversation(id, button)
        if (action === 'detail') window.location.hash = `#/student/agents/${id}/detail`
        if (action === 'edit') window.location.hash = `#/student/agents/${id}/edit`
        if (action === 'favorite') { setButtonBusy(button, true); await (agent.isFavorite ? unfavoriteAgent(id) : favoriteAgent(id)); notify(agent.isFavorite ? '已取消收藏' : '已收藏'); await reload() }
        if (action === 'copy') { if (!confirm('复制后会创建一个仅自己可见的副本，继续吗？')) return; setButtonBusy(button, true); const result = await copyAgent(id, operationId()); notify(result.data.copyNotice || '复制成功'); window.location.hash = `#/student/agents/${result.data.id}/edit` }
        if (action === 'apply') { if (!confirm('提交后将由管理员审核，确认申请公开吗？')) return; setButtonBusy(button, true); await applyAgentPublic(id, operationId()); notify('已提交审核'); await reload() }
        if (action === 'delete') { if (!confirm('确认删除这个智能体吗？')) return; await deleteAgent(id); notify('已删除'); await reload() }
        if (action === 'report') { const detail = prompt('请简要说明举报问题（可取消）'); if (detail === null) return; await reportAgent(id, '其他', detail, operationId()); notify('举报已提交') }
      } catch (error) { notify(error.message, true); setButtonBusy(button, false) }
    })
  })
}

async function renderList(app, mode) {
  const active = mode === 'mine' ? '#/student/agents/mine' : mode === 'favorites' ? '#/student/agents/favorites' : '#/student/agents'
  renderMarketplaceLayout(app, `<section class="agent-market-hero"><div><h1>${mode === 'public' ? '发现更多好用的学习伙伴' : mode === 'mine' ? '我的智能体' : '我的收藏'}</h1><p>${mode === 'public' ? '直接使用公开智能体，或复制一份打造自己的版本。' : '管理你的学习助手、审核状态和使用入口。'}</p></div>${mode === 'public' ? '<a class="complex-btn" href="#/student/agents/create">创建智能体</a>' : ''}</section><div id="agent-list-root">${loadingHTML()}</div>`, active)
  const root = document.getElementById('agent-list-root')
  let search = ''
  const load = async () => {
    root.innerHTML = loadingHTML()
    try {
      const params = mode === 'public' ? { search } : {}
      const [result, rankingResult] = await Promise.all([
        mode === 'mine' ? listMyAgents(params) : mode === 'favorites' ? listFavoriteAgents(params) : listAgents(params),
        mode === 'public' ? getHotAgentRankings(10).catch(() => ({ data: { list: [] } })) : Promise.resolve({ data: { list: [] } }),
      ])
      const agents = result.data.list || []
      const rankings = rankingResult.data?.list || []
      const cards = agents.length ? `<div class="agent-card-grid">${agents.map(item => agentCard(item, mode)).join('')}</div>` : '<div class="agent-market-empty"><p>这里还没有智能体。</p></div>'
      const filters = '<aside class="agent-market-filters"><h3>筛选智能体</h3><label>关键词<input id="agent-search" placeholder="名称、简介或能力"></label><button id="agent-search-btn" class="agent-search-btn" type="button">应用筛选</button><button id="agent-filter-reset" class="complex-btn-ghost" type="button">重置</button></aside>'
      const ranking = `<aside class="agent-hot-ranking"><h3>本周热门</h3><ol>${rankings.map((item, index) => `<li class="${index > 2 ? 'ranking-extra' : ''}"><a href="#/student/agents/${item.agentId}/detail"><b>${item.rank}</b><span><strong>${escapeHtml(item.name)}</strong><small>${item.successfulAnswers7d} 次成功回答 · ${item.score} 分</small></span></a></li>`).join('')}</ol>${rankings.length > 3 ? '<button id="ranking-toggle" class="complex-btn-ghost" type="button">展开前十</button>' : ''}</aside>`
      root.innerHTML = mode === 'public' ? `<div class="agent-market-workbench">${filters}<section class="agent-market-results">${cards}</section>${ranking}</div>` : cards
      const searchInput = document.getElementById('agent-search')
      if (searchInput) searchInput.value = search
      document.getElementById('agent-search-btn')?.addEventListener('click', () => { search = searchInput.value.trim(); load() })
      document.getElementById('agent-filter-reset')?.addEventListener('click', () => { search = ''; load() })
      document.getElementById('ranking-toggle')?.addEventListener('click', event => { root.querySelector('.agent-hot-ranking').classList.toggle('is-expanded'); event.currentTarget.textContent = event.currentTarget.textContent.includes('展开') ? '收起' : '展开前十' })
      bindCards(root, agents, mode, load)
    } catch (error) { root.innerHTML = errorHTML(error.message); root.querySelector('[data-retry]')?.addEventListener('click', load) }
  }
  await load()
}

export const renderAgentMarket = app => renderList(app, 'public')
export const renderMyAgents = app => renderList(app, 'mine')
export const renderFavoriteAgents = app => renderList(app, 'favorites')

export async function renderAgentDetail(app, params) {
  renderMarketplaceLayout(app, `<div id="agent-detail-root">${loadingHTML()}</div>`)
  const root = document.getElementById('agent-detail-root')
  try {
    const result = await getAgent(params.id)
    const agent = result.data; const v = agent.version || {}
    root.innerHTML = `<section class="agent-detail-hero">${avatar(agent)}<div><span class="agent-status status-${String(agent.status).toLowerCase()}">${statusLabel(agent.status)}</span><h1>${escapeHtml(v.name || '未命名智能体')}</h1><p>${escapeHtml(v.shortDescription || '')}</p><div class="agent-card-tags">${Object.values(v.tags || {}).flat().map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div></section>
      <div class="agent-detail-grid">
        <section class="complex-card">
          <h3>智能体信息</h3>
          <dl class="agent-detail-meta"><div><dt>身份</dt><dd>${escapeHtml(agent.creator?.name || agent.creator?.username || '未知创建者')}</dd></div><div><dt>类型</dt><dd>${escapeHtml(agent.agentType || 'CHAT')}</dd></div><div><dt>分类</dt><dd>${escapeHtml(agent.category || '综合工具')}</dd></div><div><dt>版本</dt><dd>v${escapeHtml(String(v.versionNumber || 1))} · ${escapeHtml(v.reviewStatus || 'DRAFT')}</dd></div><div><dt>回答模式</dt><dd>${escapeHtml(v.responseMode || 'DEFAULT')}</dd></div><div><dt>知识库</dt><dd>${(v.knowledgeBases || []).length ? (v.knowledgeBases || []).map(item => escapeHtml(item.name)).join('、') : '未启用'}</dd></div><div><dt>使用统计</dt><dd>${agent.usageCount || 0} 次 · ${Number(agent.ratingAverage || 0).toFixed(1)} 分</dd></div><div><dt>更新时间</dt><dd>${escapeHtml(new Date(agent.updatedAt).toLocaleString())}</dd></div></dl>
          <h3>这个智能体能做什么</h3>
          <ul>${(v.capabilities || []).length ? v.capabilities.map(item => `<li>${escapeHtml(item)}</li>`).join('') : '<li>学习问答与内容梳理</li>'}</ul>
          <h3>使用边界</h3>
          <ul>${(v.limitations || []).length ? v.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join('') : '<li>暂无特别限制说明</li>'}</ul>
          <h3>推荐问题</h3><ul>${(v.suggestedQuestions || []).length ? v.suggestedQuestions.map(item => `<li>${escapeHtml(item)}</li>`).join('') : '<li>暂无推荐问题</li>'}</ul>
        </section>
        <section class="complex-card agent-detail-action-card">
          <h3>开始使用</h3>
          ${v.welcomeMessage ? `<p>${escapeHtml(v.welcomeMessage)}</p>` : ''}
          <button id="detail-use" class="complex-btn">立即使用</button>
          ${!agent.isOwner ? `
            <button id="detail-copy" class="complex-btn-secondary">复制到我的智能体</button>
            <div class="agent-rating-row"><span>评分：</span>${[1,2,3,4,5].map(n => `<button data-rating="${n}" type="button" aria-label="评分${n}星">${n}★</button>`).join('')}</div>
            <button id="detail-report" class="complex-btn-ghost">举报</button>
          ` : `
            <button id="detail-edit" class="complex-btn-secondary">编辑智能体</button>
          `}
        </section>
      </div>`
    document.getElementById('detail-use').addEventListener('click', event => startConversation(agent.id, event.currentTarget))
    document.getElementById('detail-edit')?.addEventListener('click', () => { window.location.hash = `#/student/agents/${agent.id}/edit` })
    document.getElementById('detail-copy')?.addEventListener('click', async event => { setButtonBusy(event.currentTarget, true); try { const copied = await copyAgent(agent.id, operationId()); window.location.hash = `#/student/agents/${copied.data.id}/edit` } catch (error) { notify(error.message, true); setButtonBusy(event.currentTarget, false) } })
    root.querySelectorAll('[data-rating]').forEach(button => button.addEventListener('click', async () => { try { await rateAgent(agent.id, Number(button.dataset.rating)); notify('评分已保存') } catch (error) { notify(error.message, true) } }))
    document.getElementById('detail-report')?.addEventListener('click', async () => { const detail = prompt('请说明举报问题'); if (detail === null) return; try { await reportAgent(agent.id, '其他', detail, operationId()); notify('举报已提交') } catch (error) { notify(error.message, true) } })
  } catch (error) { root.innerHTML = errorHTML(error.message) }
}

export default renderAgentMarket
