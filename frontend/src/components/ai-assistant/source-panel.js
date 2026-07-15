import { escapeHtml } from '../../utils/format.js'

function sourceIndex(source) { return Number(source.index ?? source.metadata?.sourceIndex) || null }
function sourceTitle(source) { return source.title || source.label || source.documentTitle || source.sourceType || '未命名来源' }
function sourceSite(source) { return source.siteName || source.site_name || source.metadata?.siteName || '' }

export function renderSourceCards(sources = [], options = {}) {
  const visible = (sources || []).filter(source => source.type !== 'chart_spec')
  if (!visible.length) return `<span class="ai-source-empty">${escapeHtml(options.emptyText || '本回答未使用外部来源')}</span>`
  return visible.map(source => {
    const index = sourceIndex(source); const url = /^https?:\/\//i.test(String(source.url || '')) ? source.url : ''
    const title = sourceTitle(source); const site = sourceSite(source)
    return `<article class="ai-source-card" ${index ? `data-source-index="${index}"` : ''}>
      <div class="ai-source-card-index">${index || (source.type === 'knowledge_base' ? '@' : '•')}</div>
      <div><b>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title)}</b><span>${escapeHtml([site, source.search_strategy || source.metadata?.searchStrategy, source.cited ? '正文已引用' : '来源卡片'].filter(Boolean).join(' · '))}</span></div>
    </article>`
  }).join('')
}

export function focusSource(root, index) {
  const card = root?.querySelector?.(`[data-source-index="${Number(index)}"]`)
  if (!card) return false
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); card.classList.add('is-focused')
  window.setTimeout(() => card.classList.remove('is-focused'), 1600)
  return true
}
