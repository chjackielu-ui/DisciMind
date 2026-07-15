import {
  listAgents, listMyAgents, listFavoriteAgents, getAgent, createAgentConversation,
  favoriteAgent, unfavoriteAgent, copyAgent, applyAgentPublic, deleteAgent, rateAgent, reportAgent, getHotAgentRankings,
} from '../../api/marketplace.js'
import { escapeHtml } from '../../utils/format.js'
import { renderMarketplaceLayout, loadingHTML, errorHTML, statusLabel, operationId, setButtonBusy, notify } from './marketplace-shared.js'
import { openAgentCardMenu } from './agent-card-menu.js'
import { agentIconHTML } from '../../components/agent-icon.js'

const CAPABILITIES = ['知识库问答','学科答疑','概念讲解','题目解析','试卷生成','学习讲义生成','DOCX 导出','PDF 导出','学习规划','科研辅助','编程学习','写作表达','自定义标签']
const CATEGORIES = ['课程学习','学科答疑','概念讲解','题目解析','考试复习','学习规划','科研辅助','论文阅读','写作表达','编程学习','职业与生涯规划','校园服务','综合工具','其他']

function avatar(agent) {
  return agentIconHTML(agent, { size: 44, className: 'agent-card-avatar' })
}

function agentCard(agent, mode) {
  const v = agent.version || {}
  const tagEntries = [
    ...(v.capabilities || []).map(value => ({ value, kind: 'capability' })),
    ...(v.tags?.purpose || []).map(value => ({ value, kind: 'purpose' })),
    ...(v.tags?.style || []).map(value => ({ value, kind: 'style' })),
  ].filter((entry, index, entries) => entries.findIndex(item => item.value === entry.value) === index)
  const tags = tagEntries.slice(0, 4)
  const own = mode === 'mine' || Boolean(agent.isOwner)
  const isFileGenerator = agent.agentType === 'FILE_GENERATOR'
  const knowledgeEnabled = (v.knowledgeBases || []).length > 0 || v.responseMode === 'KNOWLEDGE_FIRST'
  return `<article class="agent-market-card" data-agent-id="${agent.id}">
    <div class="agent-card-head">${avatar(agent)}<div><h3>${escapeHtml(v.name || '未命名智能体')}</h3><p>${escapeHtml(agent.creator?.name || '未知创建者')} · ${escapeHtml(agent.category || '综合工具')}</p><div class="agent-card-identity">${agent.isSystem ? '<span>系统内置</span>' : ''}<span>${isFileGenerator ? '文件生成' : '对话助手'}</span></div></div>
      <button class="agent-more-trigger" type="button" data-action="more" aria-label="更多操作" aria-haspopup="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button>
    </div>
    <p class="agent-card-description">${escapeHtml(v.shortDescription || '')}</p>
    <div class="agent-card-tags">${tags.map(tag => `<span class="is-${tag.kind}">${escapeHtml(tag.value)}</span>`).join('')}${tagEntries.length > tags.length ? `<span class="is-more">+${tagEntries.length - tags.length}</span>` : ''}</div>
    <div class="agent-card-capability-state"><span class="is-context">${knowledgeEnabled ? '知识库增强' : '通用模型'}</span>${isFileGenerator ? '<span class="is-format">DOCX</span><span class="is-format">PDF</span>' : '<span class="is-dialogue">连续对话</span>'}</div>
    <div class="agent-card-stats"><span>使用 ${agent.usageCount || 0}</span><span>评分 ${Number(agent.ratingAverage || 0).toFixed(1)} (${agent.ratingCount || 0})</span><span>${agent.updatedAt ? new Date(agent.updatedAt).toLocaleDateString('zh-CN') : '最近更新'}</span>${own ? `<span class="agent-status status-${String(agent.status).toLowerCase()}">${statusLabel(agent.status)}</span>` : ''}</div>
    <div class="agent-card-actions">
      <button class="complex-btn" type="button" data-action="use">${isFileGenerator ? '生成文件' : '立即对话'}</button>
      <button class="complex-btn-secondary" type="button" data-action="detail">详情</button>
       ${own ? '<button class="complex-btn-secondary" type="button" data-action="edit">编辑</button>' : `<button class="agent-favorite-btn${agent.isFavorite ? ' active' : ''}" type="button" data-action="favorite" aria-label="收藏"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/></svg>${agent.isFavorite ? '已收藏' : '收藏'}</button>`}
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
    const own = mode === 'mine' || Boolean(agent?.isOwner)
    card.addEventListener('click', async event => {
      const button = event.target.closest('[data-action]')
      if (!button) return
      const action = button.dataset.action
      try {
        if (action === 'more') {
          const items = [{ action: 'detail', label: '查看详情' }, ...(own ? [{ action: 'apply', label: '申请公开', disabled: ['PUBLIC_PENDING','PUBLIC'].includes(agent.status) || agent.version?.reviewStatus === 'PENDING' }, { action: 'delete', label: '删除' }] : [{ action: 'copy', label: '复制智能体' }, { action: 'report', label: '举报' }])]
          return openAgentCardMenu(button, items, menuAction => button.closest('.agent-market-card').dispatchEvent(new CustomEvent('agent-menu-action', { bubbles: true, detail: { action: menuAction } })))
        }
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
    card.addEventListener('agent-menu-action', event => { const proxy = document.createElement('button'); proxy.dataset.action = event.detail.action; card.appendChild(proxy); proxy.click(); proxy.remove() })
  })
}

async function renderList(app, mode) {
  const active = mode === 'mine' ? '#/student/agents/mine' : mode === 'favorites' ? '#/student/agents/favorites' : '#/student/agents'
  renderMarketplaceLayout(app, `<section class="agent-market-hero"><div><span class="agent-market-eyebrow">AI STUDY PARTNERS</span><h1>${mode === 'public' ? '发现更多好用的学习伙伴' : mode === 'mine' ? '我的智能体' : '我的收藏'}</h1><p>${mode === 'public' ? '直接使用公开智能体，或复制一份打造自己的版本。' : '管理你的学习助手、审核状态和使用入口。'}</p></div>${mode === 'public' ? '<a class="complex-btn" href="#/student/agents/create">创建智能体</a>' : ''}</section><div id="agent-list-root">${loadingHTML()}</div>`, active)
  const root = document.getElementById('agent-list-root')
  const url = new URLSearchParams((location.hash.split('?')[1] || ''))
  let state = Object.fromEntries(url.entries()); let draft = { ...state }
  const persist = () => { const q = new URLSearchParams(); Object.entries(state).forEach(([k,v]) => v && q.set(k,v)); history.replaceState(null,'',`${active}${q.toString()?`?${q}`:''}`) }
  const load = async () => {
    root.innerHTML = loadingHTML()
    try {
      const params = mode === 'public' ? { ...state, pageSize: 60 } : { ...state, pageSize: 60 }
      const [result, rankingResult] = await Promise.all([
        mode === 'mine' ? listMyAgents(params) : mode === 'favorites' ? listFavoriteAgents(params) : listAgents(params),
        mode === 'public' ? getHotAgentRankings(10).catch(() => ({ data: { list: [] } })) : Promise.resolve({ data: { list: [] } }),
      ])
      const agents = result.data.list || []
      const rankings = rankingResult.data?.list || []
      const cards = agents.length ? `<div class="agent-card-grid">${agents.map(item => agentCard(item, mode)).join('')}</div>` : '<div class="agent-market-empty"><p>这里还没有智能体。</p></div>'
      const chipEntries = Object.entries(state).filter(([key,value]) => value && key !== 'q' && key !== 'source')
      const filters = `<section class="agent-market-toolbar"><form id="agent-search-form"><input id="agent-search" value="${escapeHtml(state.q||'')}" placeholder="搜索名称、简介、创建者、标签、能力或推荐问题"><button class="agent-search-clear" id="agent-search-clear" type="button" ${state.q ? '' : 'hidden'}>清空</button><button class="agent-search-btn" type="submit">搜索</button><button class="complex-btn-secondary" id="agent-filter-open" type="button">筛选${chipEntries.length ? ` (${chipEntries.length})` : ''}</button></form><div class="agent-filter-summary"><span>找到 <b>${result.data.total || 0}</b> 个智能体</span>${state.agentType==='FILE_GENERATOR'?'<em>文件生成智能体</em>':''}<div>${chipEntries.map(([k,v])=>`<button data-remove-filter="${k}">${escapeHtml(v)}</button>`).join('')}</div>${chipEntries.length?'<button id="agent-clear-filters" type="button">清除筛选</button>':''}<label class="agent-inline-sort">排序<select id="agent-sort-inline"><option value="recommended">综合推荐</option><option value="hot">热度</option><option value="latest">最新</option><option value="usage">使用次数</option><option value="rating">评分</option></select></label></div></section>`
      const ranking = `<aside class="agent-hot-ranking"><h3>本周热门</h3><ol>${rankings.map((item, index) => `<li class="${index > 2 ? 'ranking-extra' : ''}"><a href="#/student/agents/${item.agentId}/detail"><b>${item.rank}</b><span><strong>${escapeHtml(item.name)}</strong><small>${item.successfulAnswers7d} 次成功回答 · ${item.score} 分</small></span></a></li>`).join('')}</ol>${rankings.length > 3 ? '<button id="ranking-toggle" class="complex-btn-ghost" type="button">展开前十</button>' : ''}</aside>`
      root.innerHTML = mode === 'public' ? `${filters}<div class="agent-market-workbench"><section class="agent-market-results">${cards}</section>${ranking}</div>` : cards
      const searchInput = document.getElementById('agent-search')
      document.getElementById('agent-search-form')?.addEventListener('submit', event => { event.preventDefault(); state.q=searchInput.value.trim(); persist(); load() })
      document.getElementById('agent-search-clear')?.addEventListener('click', () => { state.q = ''; persist(); load() })
      document.getElementById('agent-filter-open')?.addEventListener('click', () => openFilters())
      const inlineSort = document.getElementById('agent-sort-inline'); if (inlineSort) { inlineSort.value = state.sort || 'recommended'; inlineSort.onchange = () => { state.sort = inlineSort.value; persist(); load() } }
      root.querySelectorAll('[data-remove-filter]').forEach(btn=>btn.onclick=()=>{delete state[btn.dataset.removeFilter];persist();load()})
      document.getElementById('agent-clear-filters')?.addEventListener('click',()=>{const q=state.q;state=q?{q}:{};draft={...state};persist();load()})
      document.getElementById('ranking-toggle')?.addEventListener('click', event => { root.querySelector('.agent-hot-ranking').classList.toggle('is-expanded'); event.currentTarget.textContent = event.currentTarget.textContent.includes('展开') ? '收起' : '展开前十' })
      bindCards(root, agents, mode, load)
    } catch (error) { root.innerHTML = errorHTML(error.message); root.querySelector('[data-retry]')?.addEventListener('click', load) }
  }
  function openFilters(){ draft={...state}; const overlay=document.createElement('div');overlay.className='agent-filter-overlay';overlay.innerHTML=`<section class="agent-filter-drawer"><header><h2>筛选智能体</h2><button data-filter-close>×</button></header><div class="agent-filter-fields"><label>智能体类型<select data-filter="agentType"><option value="">全部</option><option>CHAT</option><option>FILE_GENERATOR</option></select></label><label>分类<select data-filter="category"><option value="">全部分类</option>${CATEGORIES.map(x=>`<option>${x}</option>`).join('')}</select></label><fieldset><legend>能力标签</legend>${CAPABILITIES.map(x=>`<label><input type="checkbox" data-capability="${x}">${x}</label>`).join('')}</fieldset><label>回答模式<select data-filter="answerMode"><option value="">全部</option><option value="DEFAULT">默认模式</option><option value="KNOWLEDGE_FIRST">知识库优先</option></select></label><label>知识库<select data-filter="knowledgeEnabled"><option value="">全部</option><option value="true">使用知识库</option><option value="false">不使用知识库</option></select></label><label>来源<select data-filter="source"><option value="">平台公开</option><option value="mine">我的智能体</option><option value="favorites">我的收藏</option><option value="system">系统内置</option></select></label><label>最低评分<select data-filter="rating"><option value="">不限</option><option value="4">4 分以上</option><option value="4.5">4.5 分以上</option></select></label><label>排序<select data-filter="sort"><option value="recommended">综合推荐</option><option value="hot">热度</option><option value="latest">最新</option><option value="usage">使用次数</option><option value="rating">评分</option></select></label></div><footer><button data-filter-reset>重置</button><button class="complex-btn" data-filter-apply>应用筛选</button></footer></section>`;document.body.appendChild(overlay); const close=()=>overlay.remove();overlay.onclick=e=>{if(e.target===overlay)close()};overlay.querySelector('[data-filter-close]').onclick=close;overlay.querySelectorAll('[data-filter]').forEach(el=>el.value=draft[el.dataset.filter]||'');const selected=new Set(String(draft.capabilities||'').split(',').filter(Boolean));overlay.querySelectorAll('[data-capability]').forEach(el=>el.checked=selected.has(el.dataset.capability));overlay.querySelector('[data-filter-reset]').onclick=()=>{draft={q:state.q||''};close();state={...draft};persist();load()};overlay.querySelector('[data-filter-apply]').onclick=()=>{overlay.querySelectorAll('[data-filter]').forEach(el=>{if(el.value)draft[el.dataset.filter]=el.value;else delete draft[el.dataset.filter]});draft.capabilities=[...overlay.querySelectorAll('[data-capability]:checked')].map(x=>x.dataset.capability).join(',');if(!draft.capabilities)delete draft.capabilities;state={...draft};persist();close();load()}}
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
            <div class="agent-rating-row"><span>评分：</span>${[1,2,3,4,5].map(n => `<button data-rating="${n}" type="button" aria-label="评分 ${n} 分">${n} 分</button>`).join('')}</div>
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
