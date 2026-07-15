import { learningWorkflowApi } from '../api/learning-workflows.js'
import { escapeHtml } from '../utils/format.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js'
import { normalizeLearningCard, openLearningCardDetail, LEARNING_CARD_TYPE_LABELS } from './learning-card-platform.js'

const TYPE_LABELS = {
  concept: '核心概念', formula: '公式', comparison: '对比', pitfall: '易错点', example: '例题',
  exam_tip: '考试提示', wrong_question_repair: '错题修复', review: '复习提醒',
}

const CARD_ICONS = {
  previous: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/>',
  favorite: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  save: '<path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4m-8 16v-6h8v6"/>',
  mastered: '<path d="m5 12 4 4L19 6"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 9a7 7 0 0 1 12-3l2 6M18 15a7 7 0 0 1-12 3l-2-6"/>',
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${CARD_ICONS[name]}</svg>`
}

function renderSection(section) {
  if (section.type === 'list' || section.type === 'LIST') {
    const items = String(section.content).split(/\n|；/).map(item => item.replace(/^[-*\d.、\s]+/, '').trim()).filter(Boolean)
    return `<section><h5>${escapeHtml(section.title)}</h5><ul>${items.map(item => `<li>${renderMarkdownToHtml(item)}</li>`).join('')}</ul></section>`
  }
  if (section.type === 'FORMULA') return `<section class="type-formula"><h5>${escapeHtml(section.title || '关键公式')}</h5><div class="message-markdown">${renderMarkdownToHtml(`$$\n${section.formula || section.content || ''}\n$$`)}</div></section>`
  if (section.type === 'CHART') return `<section class="type-chart"><h5>${escapeHtml(section.title || '图表')}</h5><p>图表将在统一详情中按需加载。</p></section>`
  return `<section class="type-${escapeHtml(String(section.type).toLowerCase())}"><h5>${escapeHtml(section.title || '要点')}</h5><div class="message-markdown">${renderMarkdownToHtml(section.content || '')}</div></section>`
}

export function createLearningCardDeck(root, options = {}) {
  let deck = null
  let index = 0
  let requestVersion = 0
  let pollTimer = null
  let pollCount = 0
  let busy = false

  function stopPolling() { if (pollTimer) window.clearTimeout(pollTimer); pollTimer = null }

  function activeCard() { return deck?.cards?.[Math.min(index, Math.max(0, deck.cards.length - 1))] || null }

  function render() {
    if (!root) return
    const card = activeCard()
    if (!deck || !card) {
      root.innerHTML = `<section class="lws-card-deck is-loading" aria-live="polite"><header><div><span>学习卡片</span><strong>正在读取当前知识点</strong></div><i></i></header><div class="lws-card-skeleton"><b></b><span></span><span></span></div></section>`
      root.hidden = false
      return
    }
    const cardState = card.state || card.userState || {}
    const expanded = Boolean(cardState.expanded)
    const generating = deck.status !== 'ready'
    root.hidden = false
    root.innerHTML = `<section class="lws-card-deck${generating ? ' is-generating' : ''}" tabindex="0" aria-label="${escapeHtml(deck.knowledgePoint?.name || '知识')}卡片组">
      <header><div><span>学习卡片 · ${escapeHtml(deck.knowledgePoint?.name || '')}</span><strong>${generating ? '练习正在准备，你可以先查看这些知识卡片。' : '卡片已就绪，可边看边等待练习。'}</strong></div><div class="lws-card-progress"><b>${index + 1}</b><span>/ ${deck.cards.length}</span></div></header>
      <div class="lws-card-stage">
        <article class="lws-learning-card scope-${escapeHtml(card.scope)}${expanded ? ' is-expanded' : ''}">
          <div class="lws-card-meta"><span>${escapeHtml(LEARNING_CARD_TYPE_LABELS[card.cardType] || TYPE_LABELS[card.cardType] || card.cardType)}</span><span>${escapeHtml(card.difficulty)}</span><span>约 ${Math.max(1, Math.ceil(Number(card.estimatedReadingSeconds || 30) / 60))} 分钟</span>${card.scope === 'STUDENT' || card.scope === 'personalized' ? '<span>个性化</span>' : ''}</div>
          <h4>${escapeHtml(card.title)}</h4><p class="lws-card-summary">${escapeHtml(card.summary)}</p>
          <div class="lws-card-sections" ${expanded ? '' : 'hidden'}>${(card.sections || []).map(renderSection).join('')}${card.recommendationReason ? `<aside>${escapeHtml(card.recommendationReason)}</aside>` : ''}</div>
          <details class="lws-card-sources"><summary>查看来源（${card.sourceRefs?.length || 0}）</summary>${(card.sourceRefs || []).map(source => `<div><b>${escapeHtml(source.title)}</b>${source.excerpt ? `<p>${escapeHtml(source.excerpt)}</p>` : ''}<small>${escapeHtml(source.type)}</small></div>`).join('')}</details>
          <footer>
            <button type="button" data-card-command="previous" aria-label="上一张" title="上一张" ${index === 0 ? 'disabled' : ''}>${icon('previous')}<span>上一张</span></button>
            <button type="button" data-card-command="next" aria-label="下一张" title="下一张" ${index >= deck.cards.length - 1 ? 'disabled' : ''}>${icon('next')}<span>下一张</span></button>
            <button type="button" data-card-command="expand" aria-expanded="${expanded}">${icon('expand')}<span>${expanded ? '收起' : '展开'}</span></button>
            <button type="button" data-card-command="detail">${icon('expand')}<span>查看详情</span></button>
            <button type="button" data-card-command="favorite" class="${cardState.isFavorite || cardState.favorite ? 'active' : ''}" aria-pressed="${Boolean(cardState.isFavorite || cardState.favorite)}">${icon('favorite')}<span>${cardState.isFavorite || cardState.favorite ? '已收藏' : '收藏'}</span></button>
            <button type="button" data-card-command="save">${icon('save')}<span>保存</span></button>
            <button type="button" data-card-command="mastered" class="${cardState.isMastered || cardState.mastered ? 'active' : ''}" aria-pressed="${Boolean(cardState.isMastered || cardState.mastered)}">${icon('mastered')}<span>${cardState.isMastered || cardState.mastered ? '已标记掌握' : '标记掌握'}</span></button>
          </footer>
        </article>
      </div>
      ${generating ? `<button type="button" class="lws-card-refresh" data-card-command="refresh" ${busy ? 'disabled' : ''}>${icon('refresh')}<span>${busy ? '刷新中' : '刷新卡片'}</span></button>` : ''}
    </section>`
    bind()
    renderMathInMarkdownElements(root)
  }

  async function updateState(patch) {
    const card = activeCard(); if (!card || busy) return
    busy = true
    card.state = { ...(card.state || {}), ...(patch.favorite == null ? {} : { isFavorite: patch.favorite }), ...(patch.mastered == null ? {} : { isMastered: patch.mastered }), ...(patch.expanded == null ? {} : { expanded: patch.expanded }) }; render()
    try { await learningWorkflowApi.updateSessionCardState(deck.sessionId, card.id, patch, deck.nodeId) }
    catch (error) { options.onNotice?.(error.message || '卡片状态保存失败', 'error') }
    finally { busy = false; render() }
  }

  function bind() {
    const shell = root.querySelector('.lws-card-deck')
    shell?.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); index -= 1; render() }
      if (event.key === 'ArrowRight' && index < deck.cards.length - 1) { event.preventDefault(); index += 1; render() }
    })
    root.querySelector('[data-card-command="previous"]')?.addEventListener('click', () => { index -= 1; render() })
    root.querySelector('[data-card-command="next"]')?.addEventListener('click', () => { index += 1; render() })
    root.querySelector('[data-card-command="expand"]')?.addEventListener('click', () => updateState({ expanded: !activeCard().state?.expanded }))
    root.querySelector('[data-card-command="detail"]')?.addEventListener('click', () => openLearningCardDetail(activeCard(), { scene: 'LEARNING_FLOW_WAIT' }))
    root.querySelector('[data-card-command="favorite"]')?.addEventListener('click', () => updateState({ favorite: !(activeCard().state?.isFavorite || activeCard().state?.favorite) }))
    root.querySelector('[data-card-command="mastered"]')?.addEventListener('click', () => updateState({ mastered: !(activeCard().state?.isMastered || activeCard().state?.mastered) }))
    root.querySelector('[data-card-command="save"]')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true
      try { await learningWorkflowApi.saveSessionCard(deck.sessionId, activeCard().id, deck.nodeId); options.onNotice?.('知识卡片已保存到成果中心', 'success') }
      catch (error) { options.onNotice?.(error.message || '知识卡片保存失败', 'error') }
      finally { event.currentTarget.disabled = false }
    })
    root.querySelector('[data-card-command="refresh"]')?.addEventListener('click', () => load(deck.sessionId, deck.nodeId, { force: true }))
  }

  function schedulePoll(sessionId, nodeId, version) {
    stopPolling()
    if (deck?.status === 'ready' || pollCount >= 12 || version !== requestVersion) return
    pollTimer = window.setTimeout(() => { pollCount += 1; void load(sessionId, nodeId, { silent: true, preservePoll: true }) }, 2500)
  }

  async function load(sessionId, nodeId, settings = {}) {
    const version = settings.preservePoll ? requestVersion : ++requestVersion
    if (!settings.preservePoll) { pollCount = 0; stopPolling() }
    busy = true
    if (!settings.silent && !deck) render()
    try {
      const response = settings.force
        ? await learningWorkflowApi.regenerateSessionCards(sessionId, nodeId)
        : await learningWorkflowApi.getSessionCards(sessionId, nodeId)
      if (version !== requestVersion) return
      const next = response.data || response
      next.cards = (next.cards || []).map(normalizeLearningCard)
      const previousId = activeCard()?.id
      deck = next
      const previousIndex = deck.cards?.findIndex(card => card.id === previousId) ?? -1
      index = previousIndex >= 0 ? previousIndex : Math.min(index, Math.max(0, (deck.cards?.length || 1) - 1))
      render(); schedulePoll(sessionId, nodeId, version)
    } catch (error) {
      if (version === requestVersion) {
        options.onNotice?.(error.message || '知识卡片加载失败，练习仍可继续', 'warning')
        if (!deck) root.hidden = true
      }
    } finally { busy = false; if (version === requestVersion && deck) render() }
  }

  return { load, render, getDeck: () => deck, destroy: () => { requestVersion += 1; stopPolling(); if (root) root.innerHTML = '' } }
}
