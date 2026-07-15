import { learningCardApi } from '../api/learning-cards.js'
import { escapeHtml } from '../utils/format.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js'
import { initChart, disposeChart, defaultTooltip } from '../utils/echarts.js'
import { showToast } from '../utils/toast.js'

export const LEARNING_CARD_TYPE_LABELS = Object.freeze({
  CONCEPT: '核心概念', FORMULA: '公式', PITFALL: '易错点', EXAMPLE: '典型例题', COMPARISON: '概念对比',
  WRONG_QUESTION: '错题修复', TASK: '学习任务', PROGRESS: '学习进步', REVIEW: '复习提醒',
})

const LEGACY_TYPES = { concept: 'CONCEPT', formula: 'FORMULA', comparison: 'COMPARISON', pitfall: 'PITFALL', example: 'EXAMPLE', exam_tip: 'REVIEW', wrong_question_repair: 'WRONG_QUESTION', review: 'REVIEW' }
let activeModal = null

function responseData(response) { return response?.data ?? response }
function typeLabel(type) { return LEARNING_CARD_TYPE_LABELS[type] || type || '学习卡片' }
function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '') }
function state(card) { return card.state || card.userState || {} }
function bool(value) { return Boolean(value) }
function reducedMotion() { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches }
function validUrl(value) { return /^https?:\/\//i.test(String(value || '')) ? String(value) : null }

function repairLatexControlEscapes(value) {
  return String(value ?? '')
    .replace(/\u0008(?=(?:eta|egin|ar))/g, '\\b')
    .replace(/\u000c(?=rac)/g, '\\f')
    .replace(/\n(?=(?:eq|abla|u|ot|eg|ewline))/g, '\\n')
    .replace(/\r(?=(?:ho|ight|angle))/g, '\\r')
    .replace(/\t(?=(?:heta|ext|imes|an|au|anh))/g, '\\t')
}

export function normalizeLearningCard(raw = {}) {
  if (raw.version === '1.0' && /^[A-Z_]+$/.test(String(raw.cardType || ''))) return raw
  const sections = (raw.sections || []).map((section, index) => ({
    id: section.id || `legacy_${index + 1}`,
    type: ({ text: 'MARKDOWN', list: 'MARKDOWN', formula: 'FORMULA', chart: 'CHART', example: 'EXAMPLE' })[section.type] || String(section.type || 'MARKDOWN').toUpperCase(),
    title: section.title || null,
    content: section.type === 'formula' ? null : section.content || null,
    formula: section.type === 'formula' ? section.content : section.formula || null,
    chartSpec: section.chartSpec || raw.chartSpec || null,
    tableSpec: section.tableSpec || null,
  }))
  return {
    version: '1.0', id: raw.id, scope: raw.scope === 'personalized' ? 'STUDENT' : raw.courseId ? 'COURSE' : 'GLOBAL',
    cardType: LEGACY_TYPES[raw.cardType] || 'REVIEW', title: raw.title || '知识卡片', summary: raw.summary || '',
    courseId: raw.courseId || null, courseName: raw.courseName || null, knowledgePointId: raw.knowledgePointId || null,
    knowledgePointName: raw.knowledgePointName || null, chapterName: raw.chapterName || null,
    difficulty: String(raw.difficulty || 'BASIC').toUpperCase(), estimatedReadingSeconds: raw.estimatedReadingSeconds || 45,
    recommendationReason: raw.personalizedReason || raw.recommendationReason || '来自当前课程与知识点。', priorityScore: raw.priorityScore || 0,
    markdownContent: raw.markdownContent || sections.filter(item => item.content).map(item => `## ${item.title || '要点'}\n\n${item.content}`).join('\n\n'),
    sections, sourceRefs: raw.sourceRefs || [], actions: raw.actions || [],
    state: { isFavorite: bool(raw.userState?.favorite), isMastered: bool(raw.userState?.mastered), isDeferred: false, isIgnored: false, viewCount: 0, dwellTimeMs: 0 },
    generator: raw.generator || { model: 'legacy', promptVersion: 'legacy', knowledgeBaseVersion: null, generationMode: 'MIGRATED' },
    createdAt: raw.createdAt || new Date().toISOString(), expiresAt: raw.expiresAt || null,
  }
}

function icon(name) {
  const paths = {
    previous: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', source: '<path d="M4 5h16v14H4zM8 9h8M8 13h6"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>', bookmark: '<path d="M6 4h12v17l-6-4-6 4V4Z"/>',
    practice: '<path d="M7 3h10v4H7V3ZM5 5H4v16h16V5h-1M8 12l2 2 5-5"/>', chat: '<path d="M4 5h16v11H9l-5 4V5Zm4 4h8M8 12h5"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 9a7 7 0 0 1 12-3l2 6M18 15a7 7 0 0 1-12 3l-2-6"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/>', save: '<path d="M5 4h12l2 2v14H5V4Zm3 0v6h8V4"/>',
    export: '<path d="M12 3v12m-4-4 4 4 4-4M5 19h14"/>', eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.eye}</svg>`
}

export function learningCardCoverHtml(input, options = {}) {
  const card = normalizeLearningCard(input)
  const centered = options.centered !== false
  const sourceCount = card.sourceRefs?.length || 0
  const minutes = Math.max(1, Math.ceil(Number(card.estimatedReadingSeconds || 60) / 60))
  return `<article class="lc-cover type-${String(card.cardType).toLowerCase()}${centered ? ' is-center' : ''}" data-learning-card-id="${escapeHtml(card.id)}" tabindex="${centered ? '0' : '-1'}" aria-label="${escapeHtml(typeLabel(card.cardType))}：${escapeHtml(card.title)}">
    <span class="lc-cover-accent"></span><header><span class="lc-type-badge">${escapeHtml(typeLabel(card.cardType))}</span>${card.scope === 'STUDENT' ? '<span class="lc-personalized">为你推荐</span>' : ''}<span class="lc-difficulty">${escapeHtml(card.difficulty)}</span></header>
    <div class="lc-cover-copy"><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.summary)}</p></div>
    <dl><div><dt>课程</dt><dd>${escapeHtml(card.courseName || '通用学习')}</dd></div><div><dt>推荐理由</dt><dd>${escapeHtml(card.recommendationReason || '结合当前学习状态推荐')}</dd></div></dl>
    <footer><span>${icon('clock')}${minutes} 分钟</span><span>${icon('source')}${sourceCount} 个来源</span>${state(card).isMastered ? '<span class="is-mastered">已掌握</span>' : '<span>点击展开</span>'}</footer>
  </article>`
}

function tableHtml(spec) {
  if (!spec?.columns?.length) return ''
  return `<div class="lc-table-wrap"><table><thead><tr>${spec.columns.map(item => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${(spec.rows || []).map(row => `<tr>${row.map(item => `<td>${escapeHtml(item == null ? '—' : item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

function validChartSpec(spec) {
  return spec?.version === '1.0' && ['line', 'bar', 'pie', 'radar', 'scatter'].includes(spec.chart?.type)
    && Array.isArray(spec.chart?.xAxis) && Array.isArray(spec.chart?.series)
    && spec.chart.series.length > 0 && spec.chart.series.every(series => Array.isArray(series.data) && series.data.length === spec.chart.xAxis.length)
}

function chartOption(spec) {
  const chart = spec.chart
  const common = { color: ['#2f6690', '#6b66c9', '#4caf84', '#e8913a', '#e0576e'], tooltip: { ...defaultTooltip(), trigger: chart.type === 'pie' ? 'item' : 'axis' }, animationDuration: reducedMotion() ? 120 : 380 }
  if (chart.type === 'pie') return { ...common, legend: { bottom: 0 }, series: [{ name: chart.series[0].name, type: 'pie', radius: ['38%', '67%'], data: chart.xAxis.map((name, index) => ({ name, value: chart.series[0].data[index] })) }] }
  if (chart.type === 'radar') return { ...common, legend: { bottom: 0 }, radar: { indicator: chart.xAxis.map((name, index) => ({ name, max: Math.max(100, ...chart.series.map(series => Number(series.data[index]) || 0)) })) }, series: [{ type: 'radar', data: chart.series.map(series => ({ name: series.name, value: series.data })) }] }
  if (chart.type === 'scatter') return { ...common, grid: { left: 44, right: 18, top: 26, bottom: 42, containLabel: true }, xAxis: { type: 'category', data: chart.xAxis }, yAxis: { type: 'value', name: chart.unit || '' }, series: chart.series.map(series => ({ name: series.name, type: 'scatter', data: series.data, symbolSize: 9 })) }
  return { ...common, grid: { left: 44, right: 18, top: 26, bottom: 48, containLabel: true }, xAxis: { type: 'category', data: chart.xAxis, boundaryGap: chart.type === 'bar', axisLabel: { rotate: chart.xAxis.length > 8 ? 25 : 0 } }, yAxis: { type: 'value', name: chart.unit || '', splitLine: { lineStyle: { color: 'rgba(47,102,144,.09)' } } }, dataZoom: chart.xAxis.length > 12 ? [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 2 }] : undefined, series: chart.series.map(series => ({ name: series.name, data: series.data, type: chart.type, smooth: chart.type === 'line', symbolSize: 6, areaStyle: chart.type === 'line' ? { opacity: .07 } : undefined, barMaxWidth: 38 })) }
}

function chartSectionHtml(section, cardId, index) {
  const spec = section.chartSpec
  if (!validChartSpec(spec)) return '<div class="lc-content-fallback"><b>图表暂不可用</b><span>ChartSpec 1.0 未通过校验，未填充演示数据。</span></div>'
  const id = `lc-chart-${safeId(cardId)}-${index}`
  return `<div class="lc-chart-view" data-lc-chart="${escapeHtml(encodeURIComponent(JSON.stringify(spec)))}" data-chart-id="${id}"><div id="${id}" class="lc-chart-canvas" role="img" aria-label="${escapeHtml(spec.chart.title)}"></div><div class="lc-chart-tools"><button type="button" data-chart-table>查看数据表</button><button type="button" data-chart-fullscreen>全屏</button><button type="button" data-chart-png>保存 PNG</button></div><div data-chart-table-view hidden>${tableHtml(spec.table)}</div>${spec.insights?.length ? `<ul>${spec.insights.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}<small>来源：${escapeHtml(spec.source?.type || '课程数据')}${spec.source?.range ? ` · ${escapeHtml(spec.source.range)}` : ''}</small></div>`
}

function sectionHtml(section, cardId, index) {
  const title = section.title ? `<h3>${escapeHtml(section.title)}</h3>` : ''
  if (section.type === 'CHART') return `<section class="lc-detail-section is-chart">${title}${chartSectionHtml(section, cardId, index)}</section>`
  if (section.type === 'TABLE') return `<section class="lc-detail-section is-table">${title}${tableHtml(section.tableSpec)}</section>`
  if (section.type === 'FORMULA') return `<section class="lc-detail-section is-formula">${title}<div class="message-markdown">${renderMarkdownToHtml(`$$\n${repairLatexControlEscapes(section.formula || section.content)}\n$$`)}</div></section>`
  return `<section class="lc-detail-section is-${String(section.type || 'MARKDOWN').toLowerCase()}">${title}<div class="message-markdown">${renderMarkdownToHtml(repairLatexControlEscapes(section.content))}</div></section>`
}

function bindCharts(root, cleanup) {
  root.querySelectorAll('[data-lc-chart]').forEach(container => {
    let spec
    try { spec = JSON.parse(decodeURIComponent(container.dataset.lcChart || '')) } catch { spec = null }
    if (!validChartSpec(spec)) return
    const id = container.dataset.chartId
    const instance = initChart(id)
    if (!instance) return
    instance.setOption(chartOption(spec))
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.querySelector('.lc-chart-canvas'))
    cleanup.push(() => { observer.disconnect(); disposeChart(id) })
    container.querySelector('[data-chart-table]')?.addEventListener('click', event => { const table = container.querySelector('[data-chart-table-view]'); table.hidden = !table.hidden; event.currentTarget.textContent = table.hidden ? '查看数据表' : '收起数据表' })
    container.querySelector('[data-chart-fullscreen]')?.addEventListener('click', async () => { try { await container.requestFullscreen?.(); setTimeout(() => instance.resize(), 100) } catch (error) { showToast(error.message || '无法进入全屏', 'error') } })
    container.querySelector('[data-chart-png]')?.addEventListener('click', () => { const link = document.createElement('a'); link.href = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' }); link.download = `${spec.chart.title || '学习图表'}.png`; link.click() })
  })
}

function detailBody(card) {
  const sources = card.sourceRefs || []
  return `<div class="lc-detail-scroll"><header class="lc-detail-head"><div><span class="lc-type-badge">${escapeHtml(typeLabel(card.cardType))}</span>${card.courseName ? `<span>${escapeHtml(card.courseName)}</span>` : ''}${card.chapterName ? `<span>${escapeHtml(card.chapterName)}</span>` : ''}</div><h2 id="lc-dialog-title">${escapeHtml(card.title)}</h2><p>${escapeHtml(card.recommendationReason)}</p></header>
    ${card.markdownContent ? `<section class="lc-detail-markdown"><div class="message-markdown">${renderMarkdownToHtml(repairLatexControlEscapes(card.markdownContent))}</div></section>` : ''}
    <div class="lc-detail-sections">${(card.sections || []).map((section, index) => sectionHtml(section, card.id, index)).join('')}</div>
    <section class="lc-detail-sources"><h3>知识来源</h3>${sources.length ? sources.map(source => { const href = validUrl(source.url); return `<article><div><b>${escapeHtml(source.title)}</b><span>${escapeHtml(source.type)}</span></div>${source.excerpt ? `<p>${escapeHtml(source.excerpt)}</p>` : ''}${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">打开来源</a>` : ''}</article>` }).join('') : '<p>课程知识总结</p>'}</section></div>`
}

function actionButton(command, iconName, label, pressed = null) {
  return `<button type="button" data-lc-action="${command}"${pressed == null ? '' : ` aria-pressed="${pressed}" class="${pressed ? 'is-active' : ''}"`}>${icon(iconName)}<span>${label}</span></button>`
}

export function openLearningCardDetail(input, options = {}) {
  activeModal?.close?.()
  const card = normalizeLearningCard(input)
  const cleanup = []
  const openedAt = performance.now()
  const previousFocus = document.activeElement
  const overlay = document.createElement('div')
  overlay.className = 'lc-modal-layer'
  overlay.innerHTML = `<section class="lc-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="lc-dialog-title"><div class="lc-drawer-handle" aria-hidden="true"></div><button type="button" class="lc-dialog-close" data-lc-close aria-label="关闭学习卡片详情">${icon('close')}</button>${detailBody(card)}<footer class="lc-detail-actions">${actionButton('favorite', 'star', state(card).isFavorite ? '已收藏' : '收藏', state(card).isFavorite)}${actionButton('mastered', 'check', state(card).isMastered ? '已掌握' : '标记掌握', state(card).isMastered)}${actionButton('deferred', 'bookmark', state(card).isDeferred ? '已稍后' : '稍后学习', state(card).isDeferred)}${actionButton('add-plan', 'bookmark', '加入计划')}${actionButton('practice', 'practice', '开始练习')}${actionButton('ask-ai', 'chat', '询问 AI')}${actionButton('save', 'save', '保存成果')}${actionButton('export', 'export', '导出')}</footer></section>`
  document.body.appendChild(overlay)
  document.body.classList.add('lc-modal-open')
  const dialog = overlay.querySelector('.lc-detail-dialog')
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    cleanup.splice(0).forEach(dispose => dispose())
    document.body.classList.remove('lc-modal-open')
    overlay.classList.add('is-closing')
    window.setTimeout(() => overlay.remove(), reducedMotion() ? 100 : 210)
    learningCardApi.action(card.id, { action: 'VIEW', dwellTimeMs: Math.round(performance.now() - openedAt), context: { scene: options.scene || 'DETAIL' } }).catch(() => null)
    previousFocus?.focus?.({ preventScroll: true })
    if (activeModal?.overlay === overlay) activeModal = null
  }
  activeModal = { overlay, close, card }
  overlay.querySelector('[data-lc-close]').addEventListener('click', close)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  const keyHandler = event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const focusable = [...dialog.querySelectorAll('button:not(:disabled),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    if (!focusable.length) return
    const first = focusable[0]; const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  document.addEventListener('keydown', keyHandler); cleanup.push(() => document.removeEventListener('keydown', keyHandler))
  renderMathInMarkdownElements(dialog)
  bindCharts(dialog, cleanup)
  requestAnimationFrame(() => overlay.classList.add('is-open'))
  overlay.querySelector('[data-lc-close]').focus()
  learningCardApi.action(card.id, { action: 'EXPAND', context: { scene: options.scene || 'DETAIL' } }).catch(() => null)

  const run = async (button, fn, success) => {
    if (button.disabled) return
    button.disabled = true
    try { const result = responseData(await fn()); if (success) showToast(success, 'success'); return result }
    catch (error) { showToast(error.message || '操作失败', 'error'); return null }
    finally { if (button.isConnected) { button.disabled = false; button.focus({ preventScroll: true }) } }
  }
  const toggle = async (button, field, onAction, offAction, onLabel, offLabel) => {
    const next = !bool(state(card)[field])
    const result = await run(button, () => learningCardApi.action(card.id, { action: next ? onAction : offAction, context: { scene: options.scene || 'DETAIL' } }))
    if (!result) return
    card.state = { ...state(card), ...result.state }
    button.classList.toggle('is-active', next); button.setAttribute('aria-pressed', String(next)); button.querySelector('span').textContent = next ? onLabel : offLabel
    options.onStateChange?.(card)
  }
  dialog.querySelector('[data-lc-action="favorite"]').onclick = event => toggle(event.currentTarget, 'isFavorite', 'FAVORITE', 'UNFAVORITE', '已收藏', '收藏')
  dialog.querySelector('[data-lc-action="mastered"]').onclick = event => toggle(event.currentTarget, 'isMastered', 'MASTERED', 'UNMASTERED', '已掌握', '标记掌握')
  dialog.querySelector('[data-lc-action="deferred"]').onclick = event => toggle(event.currentTarget, 'isDeferred', 'DEFERRED', 'UNDEFERRED', '已稍后', '稍后学习')
  dialog.querySelector('[data-lc-action="add-plan"]').onclick = event => run(event.currentTarget, () => learningCardApi.addToPlan(card.id), '已加入复习计划')
  dialog.querySelector('[data-lc-action="practice"]').onclick = async event => { const result = await run(event.currentTarget, () => learningCardApi.startPractice(card.id, { questionCount: 3 })); if (result?.actionUrl) { close(); window.location.hash = result.actionUrl } }
  dialog.querySelector('[data-lc-action="ask-ai"]').onclick = async event => { const result = await run(event.currentTarget, () => learningCardApi.askAi(card.id)); if (result?.actionUrl) { close(); window.location.hash = result.actionUrl } }
  dialog.querySelector('[data-lc-action="save"]').onclick = event => run(event.currentTarget, () => learningCardApi.action(card.id, { action: 'SAVE_ARTIFACT' }), '已保存到成果中心')
  dialog.querySelector('[data-lc-action="export"]').onclick = async event => {
    const result = await run(event.currentTarget, () => learningCardApi.action(card.id, { action: 'EXPORT' }))
    if (!result) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${card.title.replace(/[\\/:*?"<>|]/g, '_')}.learning-card.json`; link.click(); URL.revokeObjectURL(url)
  }
  return activeModal
}

function visibleSlots(count, maxVisible) {
  const visible = Math.min(count, maxVisible)
  if (visible <= 1) return [0]
  if (visible === 2) return [-0.55, 0.55]
  if (visible === 3) return [-1, 0, 1]
  if (visible === 4) return [-1.5, -0.5, 0.5, 1.5]
  return [-2, -1, 0, 1, 2]
}

function viewportMode() { return window.innerWidth < 640 ? 'mobile' : window.innerWidth < 1100 ? 'tablet' : 'desktop' }
function maxVisibleForMode(mode) { return mode === 'desktop' ? 5 : 3 }

export function createDailyLearningCardFan(root, options = {}) {
  let cards = (options.cards || []).map(normalizeLearningCard)
  let centerIndex = Math.max(0, Math.min(cards.length - 1, Number(options.centerIndex) || 0))
  let animating = false
  let queuedDirection = 0
  let previousVisibleSet = new Set()
  const impressedCardIds = new Set()
  let pointerStart = null
  let destroyed = false
  let unlockTimer = null

  const circular = index => ((index % cards.length) + cards.length) % cards.length
  function positions() {
    const mode = viewportMode(); const slots = visibleSlots(cards.length, maxVisibleForMode(mode))
    const integerCenter = slots.includes(0)
    return slots.map((slot, order) => {
      let offset
      if (integerCenter) offset = Math.round(slot)
      else offset = order - Math.floor((slots.length - 1) / 2)
      return { slot, index: circular(centerIndex + offset), mode }
    })
  }

  function layout(position) {
    const factor = position.mode === 'desktop' ? 1 : position.mode === 'tablet' ? .74 : .50
    const slot = position.slot
    const x = slot * 176 * factor
    const y = Math.min(46, Math.abs(slot) ** 1.65 * 14 * (position.mode === 'mobile' ? .5 : 1))
    const rotation = position.mode === 'mobile' ? slot * 3 : slot * 7
    const scale = Math.max(.78, 1 - Math.abs(slot) * (position.mode === 'mobile' ? .08 : .09))
    return { x, y, rotation, scale, z: 20 - Math.round(Math.abs(slot) * 4) }
  }

  function render() {
    if (destroyed || !root) return
    if (!cards.length) { root.innerHTML = '<div class="lc-empty"><b>今日智学卡正在准备</b><span>完成一次课程学习后会得到更精准的推荐。</span></div>'; return }
    const visible = positions()
    const nextVisible = new Set(visible.map(item => cards[item.index].id))
    root.innerHTML = `<div class="lc-fan-stage" role="region" aria-roledescription="carousel" aria-label="今日智学卡" tabindex="0"><button type="button" class="lc-fan-arrow is-left" data-fan-move="-1" aria-label="上一张">${icon('previous')}</button><div class="lc-fan-cards">${visible.map(position => {
      const card = cards[position.index]; const style = layout(position); const isCenter = Math.abs(position.slot) < .01 || (!visible.some(item => item.slot === 0) && position.index === centerIndex)
      return `<div class="lc-fan-slot${isCenter ? ' is-center' : ''}" data-fan-index="${position.index}" data-fan-slot="${position.slot}" data-motion="${previousVisibleSet.has(card.id) ? 'move' : 'enter'}" style="--lc-x:${style.x}px;--lc-y:${style.y}px;--lc-r:${style.rotation}deg;--lc-s:${style.scale};--lc-z:${style.z};--lc-hover-x:0px;--lc-hover-y:0px">${learningCardCoverHtml(card, { centered: isCenter })}</div>`
    }).join('')}</div><button type="button" class="lc-fan-arrow is-right" data-fan-move="1" aria-label="下一张">${icon('next')}</button></div><div class="lc-fan-indicators" role="tablist" aria-label="卡片分页">${cards.map((card, index) => `<button type="button" data-fan-dot="${index}" role="tab" aria-label="第 ${index + 1} 张：${escapeHtml(card.title)}" aria-selected="${index === centerIndex}" aria-current="${index === centerIndex ? 'true' : 'false'}"></button>`).join('')}</div>`
    previousVisibleSet = nextVisible
    bind()
    visible.forEach(position => {
      const card = cards[position.index]
      if (impressedCardIds.has(card.id)) return
      impressedCardIds.add(card.id)
      learningCardApi.action(card.id, { action: 'IMPRESSION', context: { scene: 'STUDENT_HOME', slot: position.slot } }).catch(() => impressedCardIds.delete(card.id))
    })
  }

  function finishMove() {
    animating = false
    if (queuedDirection) { const direction = queuedDirection; queuedDirection = 0; move(direction) }
  }
  function move(direction, target = null) {
    if (cards.length < 2) return
    if (animating) { queuedDirection = direction; return }
    animating = true
    centerIndex = target == null ? circular(centerIndex + direction) : circular(target)
    render()
    clearTimeout(unlockTimer); unlockTimer = window.setTimeout(finishMove, reducedMotion() ? 130 : 410)
    options.onChange?.(cards[centerIndex], centerIndex)
  }
  function open(card) { learningCardApi.action(card.id, { action: 'CLICK', context: { scene: 'STUDENT_HOME' } }).catch(() => null); (options.onOpen || openLearningCardDetail)(card, { scene: 'STUDENT_HOME', onStateChange: updated => { cards = cards.map(item => item.id === updated.id ? updated : item); render() } }) }

  function bind() {
    const stage = root.querySelector('.lc-fan-stage')
    root.querySelectorAll('[data-fan-move]').forEach(button => button.addEventListener('click', () => move(Number(button.dataset.fanMove))))
    root.querySelectorAll('[data-fan-dot]').forEach(button => button.addEventListener('click', () => { const target = Number(button.dataset.fanDot); move(target > centerIndex ? 1 : -1, target) }))
    root.querySelectorAll('[data-fan-index]').forEach(slot => {
      const index = Number(slot.dataset.fanIndex); const card = cards[index]
      slot.addEventListener('click', event => {
        if (Math.abs(Number(slot.dataset.fanSlot)) < .01 || index === centerIndex) open(card)
        else move(Number(slot.dataset.fanSlot) > 0 ? 1 : -1, index)
        event.stopPropagation()
      })
      slot.addEventListener('mouseenter', () => {
        if (viewportMode() === 'mobile') return
        slot.classList.add('is-hovered')
        root.querySelectorAll('[data-fan-slot]').forEach(other => { if (other === slot) return; const delta = Number(other.dataset.fanSlot) < Number(slot.dataset.fanSlot) ? -18 : 18; other.style.setProperty('--lc-hover-x', `${delta}px`) })
      })
      slot.addEventListener('mouseleave', () => { slot.classList.remove('is-hovered'); root.querySelectorAll('[data-fan-slot]').forEach(other => other.style.setProperty('--lc-hover-x', '0px')) })
    })
    stage?.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
      else if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open(cards[centerIndex]) }
    })
    stage?.addEventListener('pointerdown', event => { if (event.pointerType === 'mouse') return; pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY }; stage.setPointerCapture?.(event.pointerId) })
    stage?.addEventListener('pointerup', event => { if (!pointerStart || pointerStart.id !== event.pointerId) return; const dx = event.clientX - pointerStart.x; const dy = event.clientY - pointerStart.y; pointerStart = null; if (Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.25) move(dx < 0 ? 1 : -1) })
    stage?.addEventListener('pointercancel', () => { pointerStart = null })
  }

  const resize = () => render()
  window.addEventListener('resize', resize, { passive: true })
  render()
  return {
    render, move,
    setCards(nextCards) { const currentId = cards[centerIndex]?.id; cards = (nextCards || []).map(normalizeLearningCard); const preserved = cards.findIndex(card => card.id === currentId); centerIndex = preserved >= 0 ? preserved : Math.min(centerIndex, Math.max(0, cards.length - 1)); render() },
    getCurrent: () => cards[centerIndex] || null,
    openCurrent: () => cards[centerIndex] && open(cards[centerIndex]),
    destroy() { destroyed = true; clearTimeout(unlockTimer); window.removeEventListener('resize', resize); root.innerHTML = '' },
  }
}

export function renderLearningCardGrid(root, inputCards, options = {}) {
  const cards = (inputCards || []).map(normalizeLearningCard)
  if (!root) return { destroy() {} }
  root.innerHTML = cards.length ? `<div class="lc-grid${options.compact ? ' is-compact' : ''}">${cards.map(card => `<button type="button" class="lc-grid-item" data-grid-card="${escapeHtml(card.id)}">${learningCardCoverHtml(card, { centered: true })}</button>`).join('')}</div>` : '<div class="lc-empty"><b>暂无匹配卡片</b><span>调整筛选或完成更多学习后再来查看。</span></div>'
  root.querySelectorAll('[data-grid-card]').forEach(button => button.addEventListener('click', () => { const card = cards.find(item => item.id === button.dataset.gridCard); if (card) (options.onOpen || openLearningCardDetail)(card, { scene: options.scene || 'CARD_GRID', onStateChange: options.onStateChange }) }))
  return { destroy() { if (root) root.innerHTML = '' } }
}

export function learningCardArtifactHtml(artifact) {
  const cards = (artifact?.content?.cards || artifact?.cards || []).map(normalizeLearningCard)
  if (!cards.length) return ''
  return `<section class="lc-artifact" data-lc-artifact="${escapeHtml(artifact.id)}"><header><div><span>LearningCard 1.0</span><b>${escapeHtml(artifact.title || `已生成 ${cards.length} 张学习卡片`)}</b><small>已生成 ${cards.length} 张，可展开、保存或加入学习计划</small></div><button type="button" data-lc-artifact-expand>展开卡组</button></header><div class="lc-artifact-strip" hidden>${cards.map(card => `<button type="button" data-lc-artifact-card="${escapeHtml(card.id)}"><span>${escapeHtml(typeLabel(card.cardType))}</span><b>${escapeHtml(card.title)}</b><small>${escapeHtml(card.summary)}</small></button>`).join('')}</div><script type="application/json" data-lc-artifact-data>${JSON.stringify(cards).replace(/</g, '\\u003c')}</script></section>`
}

export function bindLearningCardArtifacts(root, onError) {
  root?.querySelectorAll?.('[data-lc-artifact]').forEach(container => {
    let cards = []
    try { cards = JSON.parse(container.querySelector('[data-lc-artifact-data]')?.textContent || '[]').map(normalizeLearningCard) } catch (error) { onError?.(error) }
    const strip = container.querySelector('.lc-artifact-strip')
    container.querySelector('[data-lc-artifact-expand]')?.addEventListener('click', event => { strip.hidden = !strip.hidden; event.currentTarget.textContent = strip.hidden ? '展开卡组' : '收起卡组' })
    container.querySelectorAll('[data-lc-artifact-card]').forEach(button => button.addEventListener('click', () => { const card = cards.find(item => item.id === button.dataset.lcArtifactCard); if (card) openLearningCardDetail(card, { scene: 'AI_CHAT_ARTIFACT' }) }))
  })
}
