// 学生端 — 个性化推荐页面 v2
// 新增：排序、搜索、筛选

import { getMe } from '../api/auth.js'
import { getStudentRecommendations } from '../api/student.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, recommendTypeLabel } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { disposeAllCharts, bindResize, renderRingChart, renderBarChart, CHART_COLORS } from '../utils/echarts.js'

function recIcon(name, size = 17) {
  const paths = { star: '<path d="m12 3 2.5 5.2 5.5.8-4 3.9.9 5.5-5-2.7-5 2.7.9-5.5-4-3.9 5.5-.8L12 3Z"/>', bulb: '<path d="M9 18h6m-5 3h4M8.2 15.5A6.5 6.5 0 1 1 16 15.5c-.9.7-1.5 1.7-1.6 2.5H9.6c-.1-.8-.7-1.8-1.4-2.5Z"/>', target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>', note: '<path d="M6 3h9l3 3v15H6V3Z"/><path d="M15 3v4h4M9 12h6m-6 4h6"/>', video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>', route: '<path d="M5 19V5m0 0h6m-6 0 4 4m10 6v4m0 0h-6m6 0-4-4"/><path d="M9 7c5 0 6 3 6 5s-1 5-6 5"/>', calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/>', chart: '<path d="M4 19V5m0 14h16"/><path d="M8 15v-3m4 3V8m4 7v-5"/>', face: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15.5c1 .9 2.2 1.4 3.5 1.4s2.5-.5 3.5-1.4M8.5 9.5h.01m7 0h.01"/>', mail: '<path d="M4 6h16v12H4V6Z"/><path d="m4 7 8 6 8-6"/>', pin: '<path d="M8 4h8l-1 5 3 3v2H6v-2l3-3-1-5Zm4 10v7"/>' };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.pin}</svg>`
}

function sortRecs(items, sortBy) {
  const s = [...items]
  switch (sortBy) {
    case 'priority': return s.sort((a, b) => (a.priority || 99) - (b.priority || 99))
    case 'type': return s.sort((a, b) => (a.recommend_type || '').localeCompare(b.recommend_type || ''))
    case 'recent': return s.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    case 'title': return s.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    default: return s
  }
}

function renderRecCharts(items) {
  bindResize()
  if (!items || items.length === 0) return
  const tc = {}; items.forEach(i => { const t = i.recommend_type || 'other'; tc[t] = (tc[t] || 0) + 1 })
  renderRingChart('chart-rec-type-ring', Object.entries(tc).map(([t, c]) => ({ name: recommendTypeLabel(t), value: c })), '推荐类型占比')
  const pg = { high: 0, medium: 0, low: 0 }
  items.forEach(i => { const p = i.priority || 5; if (p <= 2) pg.high++; else if (p <= 4) pg.medium++; else pg.low++ })
  renderBarChart('chart-rec-priority-bar', ['高(1-2)', '中(3-4)', '低(5+)'], [{ value: pg.high, itemStyle: { color: CHART_COLORS.softRed } }, { value: pg.medium, itemStyle: { color: CHART_COLORS.warm } }, { value: pg.low, itemStyle: { color: CHART_COLORS.light } }], '推荐优先级分布')
}

function buildRecCard(item) {
  const type = item.recommend_type || 'other'
  const clsMap = { knowledge_point: 'rec-card-kp', question: 'rec-card-question', video: 'rec-card-video', learning_path: 'rec-card-default', review_plan: 'rec-card-default' }
  const btnMap = { knowledge_point: ['btn-kp', '去复习'], question: ['btn-question', '去练习'], video: ['btn-video', '看视频'], learning_path: ['btn-default', '查看路线'], review_plan: ['btn-default', '开始复习'] }
  const [btnCls, btnText] = btnMap[type] || ['btn-default', '去学习']
  return `<div class="${clsMap[type] || 'rec-card-default'}" data-rec-type="${type}"><div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;"><div style="flex:1;min-width:0;"><span class="rec-tag ${type}">${recommendTypeLabel(type)}</span><span style="font-size:0.8rem;color:var(--text-hint);margin-left:8px;">优先级 ${item.priority || '-'}</span><div class="rec-card-title">${escapeHtml(item.title)}</div><div class="rec-card-reason">${recIcon('bulb', 15)} ${escapeHtml(item.reason || '系统根据教学大纲与学习情况推荐此内容')}</div></div><button class="btn-rec-action ${btnCls}" data-rec-action="${type}" data-target-id="${item.target_id || ''}" data-target-type="${item.target_type || ''}">${btnText} →</button></div></div>`
}

// ========================
// 主渲染
// ========================

export async function renderStudentRecommendations(app) {
  disposeAllCharts()
  let user = getUser()
  try { const r = await getMe(); user = r.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }

  const menuItems = STUDENT_MENU_ITEMS

  renderDashboardLayout(app, { menuItems, contentHTML: `<div class="rec-hero"><div class="rec-hero-inner"><h2>${recIcon('star', 20)} 个性化推荐</h2><p>系统根据课程教学大纲、学习进度、知识点掌握情况和错题表现，为你生成下一步学习建议。</p></div></div><div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在为你生成智能推荐...</p></div>`, user })

  let items = [], loadError = false
  try { const r = await getStudentRecommendations({ page_size: 50 }); items = r.data?.list || [] } catch (e) { loadError = true }

  let contentHTML
  if (loadError) {
    contentHTML = `<div class="rec-hero"><h2>${recIcon('star', 20)} 个性化推荐</h2></div><div class="error-state"><div class="error-icon">${recIcon('face', 36)}</div><p class="error-message">推荐数据加载失败</p><button class="btn-retry" onclick="window.location.reload()">重新加载</button></div>`
  } else if (items.length === 0) {
    contentHTML = `<div class="rec-hero"><div class="rec-hero-inner"><h2>${recIcon('star', 20)} 个性化推荐</h2><p>系统根据课程教学大纲、学习进度、知识点掌握情况和错题表现，为你生成下一步学习建议。</p></div></div><div class="empty-state"><div class="empty-icon">${recIcon('mail', 40)}</div><div class="empty-title">暂无推荐内容</div><div class="empty-desc">继续学习后，系统将根据你的学习情况自动生成个性化建议。</div></div>`
  } else {
    const tc = {}; items.forEach(i => { const t = i.recommend_type || 'other'; tc[t] = (tc[t] || 0) + 1 })
    const groups = { knowledge_point: [], question: [], video: [], learning_path: [], review_plan: [] }
    items.forEach(i => { const t = i.recommend_type || 'other'; if (groups[t]) groups[t].push(i); else (groups.other = groups.other || []).push(i) })
    const sectionCfg = { knowledge_point: { icon: 'target', title: '知识点推荐', desc: '依据教学大纲中的知识点安排匹配' }, question: { icon: 'note', title: '习题推荐', desc: '针对性练习题，巩固薄弱环节' }, video: { icon: 'video', title: '视频推荐', desc: '通过视频加深理解' }, learning_path: { icon: 'route', title: '学习路线', desc: '依据课程大纲规划的学习路径' }, review_plan: { icon: 'calendar', title: '复习计划', desc: '科学复习计划，高效提升' } }

    const overviewItems = [{ icon: 'list', label: '推荐总数', value: items.length, type: 'all' }, { icon: 'target', label: '知识点', value: tc['knowledge_point'] || 0, type: 'knowledge_point' }, { icon: 'note', label: '习题', value: tc['question'] || 0, type: 'question' }, { icon: 'video', label: '视频', value: tc['video'] || 0, type: 'video' }, { icon: 'route', label: '学习路线', value: tc['learning_path'] || 0, type: 'learning_path' }, { icon: 'calendar', label: '复习计划', value: tc['review_plan'] || 0, type: 'review_plan' }].filter(o => o.type === 'all' || o.value > 0)

    const groupedHTML = Object.entries(groups).filter(([, list]) => list.length > 0).map(([type, list]) => {
      const cfg = sectionCfg[type] || { icon: 'pin', title: type, desc: '' }
      return `<div class="rec-section" data-rec-section="${type}"><div class="rec-section-title"><span class="section-icon">${recIcon(cfg.icon)}</span>${cfg.title}<span class="section-count">${list.length} 项</span></div><p style="font-size:0.85rem;color:var(--text-sub);margin-bottom:16px;">${cfg.desc}</p>${list.map(item => buildRecCard(item)).join('')}</div>`
    }).join('')

    contentHTML = `
      <div class="rec-hero"><div class="rec-hero-inner"><h2>${recIcon('star', 20)} 个性化推荐</h2><p>系统根据课程教学大纲、学习进度、知识点掌握情况和错题表现，为你生成下一步学习建议。</p></div></div>
      <div class="rec-overview-row" id="rec-overview-row" style="margin-top:24px;">${overviewItems.map(o => `<div class="rec-overview-item${o.type === 'all' ? ' active' : ''}" data-rec-filter="${o.type}"><div class="rov-icon">${recIcon(o.icon)}</div><div class="rov-value">${o.value}</div><div class="rov-label">${o.label}</div></div>`).join('')}</div>
      <div class="charts-grid"><div class="chart-card"><div class="chart-header"><span class="chart-title">${recIcon('chart', 16)} 推荐类型占比</span></div><div class="chart-container" id="chart-rec-type-ring"></div></div><div class="chart-card"><div class="chart-header"><span class="chart-title">${recIcon('chart', 16)} 推荐优先级分布</span></div><div class="chart-container" id="chart-rec-priority-bar"></div></div></div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;"><div class="filter-bar" id="rec-filter-bar"><button class="filter-chip active" data-rec-filter="all">全部</button><button class="filter-chip" data-rec-filter="knowledge_point">知识点</button><button class="filter-chip" data-rec-filter="question">习题</button><button class="filter-chip" data-rec-filter="video">视频</button><button class="filter-chip" data-rec-filter="learning_path">学习路线</button><button class="filter-chip" data-rec-filter="review_plan">复习计划</button></div><div class="sort-select-wrap"><label>排序：</label><select class="sort-select" id="rec-sort"><option value="priority">优先级</option><option value="type">类型</option><option value="recent">创建时间</option><option value="title">标题</option></select></div></div>
      <div id="rec-list-container">${groupedHTML}</div>
      <div id="rec-no-results" class="no-filter-results" style="display:none;">没有符合条件的数据<span class="btn-clear-filter" id="rec-clear-filter">清除筛选</span></div>
    `
  }

  app.innerHTML = ''
  renderDashboardLayout(app, { menuItems, contentHTML, user })

  if (!loadError && items.length > 0) {
    setTimeout(() => { renderRecCharts(items); bindRecEvents(items) }, 150)
  }
}

function bindRecEvents(items) {
  let currentFilter = 'all', currentSort = 'priority'

  function applyAll() {
    let filtered = items
    if (currentFilter !== 'all') filtered = filtered.filter(i => i.recommend_type === currentFilter)
    filtered = sortRecs(filtered, currentSort)
    const container = document.getElementById('rec-list-container')
    const noRes = document.getElementById('rec-no-results')
    // 重新分组
    const groups = { knowledge_point: [], question: [], video: [], learning_path: [], review_plan: [] }
    filtered.forEach(i => { const t = i.recommend_type || 'other'; if (groups[t]) groups[t].push(i); else (groups.other = groups.other || []).push(i) })
    const sectionCfg = { knowledge_point: { icon: 'target', title: '知识点推荐', desc: '依据教学大纲匹配' }, question: { icon: 'note', title: '习题推荐', desc: '针对性练习题' }, video: { icon: 'video', title: '视频推荐', desc: '通过视频加深理解' }, learning_path: { icon: 'route', title: '学习路线', desc: '个性化学习路径' }, review_plan: { icon: 'calendar', title: '复习计划', desc: '科学复习计划' } }
    if (container) container.innerHTML = Object.entries(groups).filter(([, l]) => l.length > 0).map(([type, list]) => { const cfg = sectionCfg[type] || { icon: 'pin', title: type, desc: '' }; return `<div class="rec-section" data-rec-section="${type}"><div class="rec-section-title"><span class="section-icon">${recIcon(cfg.icon)}</span>${cfg.title}<span class="section-count">${list.length} 项</span></div><p style="font-size:0.85rem;color:var(--text-sub);margin-bottom:16px;">${cfg.desc}</p>${list.map(item => buildRecCard(item)).join('')}</div>` }).join('')
    if (noRes) noRes.style.display = filtered.length === 0 ? '' : 'none'
    bindRecActionButtons()
  }

  document.querySelectorAll('#rec-filter-bar .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => { document.querySelectorAll('#rec-filter-bar .filter-chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); currentFilter = chip.dataset.recFilter; applyAll() })
  })
  document.querySelectorAll('#rec-overview-row .rec-overview-item').forEach(card => {
    card.addEventListener('click', () => { currentFilter = card.dataset.recFilter; document.querySelectorAll('#rec-filter-bar .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.recFilter === currentFilter)); applyAll() })
  })
  document.getElementById('rec-sort')?.addEventListener('change', (e) => { currentSort = e.target.value; applyAll() })
  document.getElementById('rec-clear-filter')?.addEventListener('click', () => { currentFilter = 'all'; currentSort = 'priority'; document.querySelectorAll('#rec-filter-bar .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.recFilter === 'all')); document.getElementById('rec-sort').value = 'priority'; applyAll() })

  bindRecActionButtons()
}

function bindRecActionButtons() {
  document.querySelectorAll('.btn-rec-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.recAction
      if (action === 'video') { showToast('视频播放功能正在开发中', 'info'); return }
      if (action === 'learning_path') { showToast('学习路线功能正在开发中', 'info'); return }
      if (action === 'review_plan') { showToast('复习计划功能正在开发中', 'info'); return }
      showToast('该功能正在开发中，请通过课程详情查看知识点', 'info')
    })
  })
}
