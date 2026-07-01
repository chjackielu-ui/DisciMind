// 学生端 — 错题本页面 v2
// 新增：排序、搜索、筛选、toast 提示

import { getMe } from '../api/auth.js'
import { getStudentWrongQuestions, updateWrongQuestionStatus } from '../api/student.js'
import { getUser, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml, formatDate, formatRelativeTime, wrongStatusLabel } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { disposeAllCharts, bindResize, renderRingChart, renderHorizontalBarChart, CHART_COLORS } from '../utils/echarts.js'

function sortWQs(items, sortBy) {
  const s = [...items]
  switch (sortBy) {
    case 'recent': return s.sort((a, b) => new Date(b.last_wrong_at || 0) - new Date(a.last_wrong_at || 0))
    case 'count': return s.sort((a, b) => (b.wrong_count || 0) - (a.wrong_count || 0))
    case 'type': return s.sort((a, b) => (a.question_type || '').localeCompare(b.question_type || ''))
    case 'kp': return s.sort((a, b) => (a.knowledge_point_name || '').localeCompare(b.knowledge_point_name || ''))
    case 'status': return s.sort((a, b) => (a.status || '').localeCompare(b.status || ''))
    default: return s
  }
}

function renderWrongCharts(items) {
  bindResize()
  if (!items || items.length === 0) return
  const sc = { unresolved: 0, mastered: 0, removed: 0 }
  items.forEach(w => { const s = w.status || 'unresolved'; if (sc[s] !== undefined) sc[s]++ })
  renderRingChart('chart-wrong-status-ring', [{ name: '未掌握', value: sc.unresolved, itemStyle: { color: CHART_COLORS.softRed } }, { name: '已掌握', value: sc.mastered, itemStyle: { color: CHART_COLORS.softGreen } }, { name: '已移除', value: sc.removed, itemStyle: { color: '#829AB1' } }].filter(d => d.value > 0), '错题状态占比')
  const kpMap = {}; items.forEach(w => { const n = w.knowledge_point_name || '未知'; kpMap[n] = (kpMap[n] || 0) + 1 })
  const ke = Object.entries(kpMap).sort((a, b) => b[1] - a[1])
  if (ke.length > 0) renderHorizontalBarChart('chart-wrong-kp-bar', ke.map(e => e[0]), ke.map(e => e[1]), '错题知识点分布')
}

function buildWQCard(wq) {
  const status = wq.status || 'unresolved'
  return `<div class="wrong-question-card" data-wq-id="${wq.wrong_question_id}" data-status="${status}" data-type="${wq.question_type || ''}" data-kp="${escapeHtml(wq.knowledge_point_name || '')}"><div class="wq-header"><div class="wq-status-bar ${status}"></div><span class="wq-meta-tag type-tag">${escapeHtml(wq.question_type || '未知')}</span><span class="wq-meta-tag course-tag">${escapeHtml(wq.course_name || '')}</span><span class="wq-meta-tag kp-tag">${escapeHtml(wq.knowledge_point_name || '')}</span><span class="wq-meta-tag status-tag ${status}">${wrongStatusLabel(status)}</span><span style="margin-left:auto;font-size:0.78rem;color:var(--text-hint);">${formatRelativeTime(wq.last_wrong_at)}</span></div><div class="wq-body"><div class="wq-content">${escapeHtml(wq.question_content || '暂无题目内容')}</div><div class="wq-meta"><span style="font-size:0.8rem;color:var(--text-hint);">错误次数: ${wq.wrong_count || 1}</span><span style="font-size:0.8rem;color:var(--text-hint);">最近错误: ${formatDate(wq.last_wrong_at, 'date')}</span></div><div class="wq-actions">${status === 'unresolved' ? `<button class="btn-wq-action mastered-btn" data-action="mastered" data-wq-id="${wq.wrong_question_id}">✅ 标记已掌握</button><button class="btn-wq-action remove-btn" data-action="removed" data-wq-id="${wq.wrong_question_id}">🗑️ 移出错题本</button>` : ''}${status === 'mastered' ? `<button class="btn-wq-action" data-action="unresolved" data-wq-id="${wq.wrong_question_id}">🔄 恢复未掌握</button><button class="btn-wq-action remove-btn" data-action="removed" data-wq-id="${wq.wrong_question_id}">🗑️ 移出错题本</button>` : ''}${status === 'removed' ? `<button class="btn-wq-action" data-action="unresolved" data-wq-id="${wq.wrong_question_id}">🔄 恢复未掌握</button>` : ''}</div></div></div>`
}

// ========================
// 主渲染
// ========================

export async function renderStudentWrongQuestions(app) {
  disposeAllCharts()
  let user = getUser()
  try { const r = await getMe(); user = r.data.user; setAuth(localStorage.getItem('token') || '', user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }

  const menuItems = STUDENT_MENU_ITEMS

  renderDashboardLayout(app, { menuItems, contentHTML: `<div class="page-header"><h1 class="page-title">我的错题本</h1><p class="page-subtitle">系统根据你的答题情况自动沉淀错题，帮助你定位薄弱知识点。</p></div><div class="loading-state"><div class="loading-spinner"></div><p class="loading-text">正在加载错题数据...</p></div>`, user })

  let wqs = [], loadError = false
  try { const r = await getStudentWrongQuestions({ page_size: 50 }); wqs = r.data?.list || [] } catch (e) { loadError = true }

  let contentHTML
  if (loadError) {
    contentHTML = `<div class="page-header"><h1 class="page-title">我的错题本</h1></div><div class="error-state"><div class="error-icon">😞</div><p class="error-message">错题数据加载失败</p><button class="btn-retry" onclick="window.location.reload()">重新加载</button></div>`
  } else if (wqs.length === 0) {
    contentHTML = `<div class="page-header"><h1 class="page-title">我的错题本</h1><p class="page-subtitle">系统根据你的答题情况自动沉淀错题，帮助你定位薄弱知识点。</p></div><div class="empty-state"><div class="empty-icon">🎉</div><div class="empty-title">暂无错题</div><div class="empty-desc">太棒了！你目前没有错题记录。继续加油！</div></div>`
  } else {
    const unresolved = wqs.filter(w => w.status === 'unresolved').length
    const mastered = wqs.filter(w => w.status === 'mastered').length
    const kpSet = new Set(wqs.map(w => w.knowledge_point_id).filter(Boolean))
    contentHTML = `
      <div class="page-header"><div class="page-header-row"><div><h1 class="page-title">我的错题本</h1><p class="page-subtitle">系统根据你的答题情况自动沉淀错题，帮助你定位薄弱知识点。</p></div><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"><div class="search-box"><span class="search-icon">🔍</span><input type="text" id="wq-search" placeholder="搜索题目..." /></div><div class="sort-select-wrap"><label>排序：</label><select class="sort-select" id="wq-sort"><option value="recent">最近错误</option><option value="count">错误次数</option><option value="type">题型</option><option value="kp">知识点</option><option value="status">状态</option></select></div></div></div></div>
      <div class="filter-bar" id="wq-filter-bar"><button class="filter-chip active" data-filter="all">全部</button><button class="filter-chip" data-filter="unresolved">未掌握</button><button class="filter-chip" data-filter="mastered">已掌握</button><button class="filter-chip" data-filter="removed">已移除</button></div>
      <div class="wrong-stats-row"><div class="wrong-stat-card"><div class="ws-value">${wqs.length}</div><div class="ws-label">错题总数</div></div><div class="wrong-stat-card unresolved"><div class="ws-value">${unresolved}</div><div class="ws-label">未掌握</div></div><div class="wrong-stat-card mastered"><div class="ws-value">${mastered}</div><div class="ws-label">已掌握</div></div><div class="wrong-stat-card"><div class="ws-value">${kpSet.size}</div><div class="ws-label">涉及知识点</div></div></div>
      <div class="charts-grid"><div class="chart-card"><div class="chart-header"><span class="chart-title">📊 错题状态占比</span></div><div class="chart-container" id="chart-wrong-status-ring"></div></div><div class="chart-card" style="grid-column:1/-1;"><div class="chart-header"><span class="chart-title">📈 错题知识点分布</span></div><div class="chart-container-lg" id="chart-wrong-kp-bar"></div></div></div>
      <div id="wq-list-container">${wqs.map(w => buildWQCard(w)).join('')}</div>
      <div id="wq-no-results" class="no-filter-results" style="display:none;">没有符合条件的数据<span class="btn-clear-filter" id="wq-clear-filter">清除筛选</span></div>
    `
  }

  app.innerHTML = ''
  renderDashboardLayout(app, { menuItems, contentHTML, user })

  if (!loadError && wqs.length > 0) {
    setTimeout(() => { renderWrongCharts(wqs); bindWQEvents(wqs) }, 150)
  }
}

function bindWQEvents(wqs) {
  let currentFilter = 'all', currentSort = 'recent'

  function applyAll() {
    let filtered = wqs
    if (currentFilter !== 'all') filtered = filtered.filter(w => w.status === currentFilter)
    const kw = (document.getElementById('wq-search')?.value || '').toLowerCase()
    if (kw) filtered = filtered.filter(w => (w.question_content || '').toLowerCase().includes(kw))
    filtered = sortWQs(filtered, currentSort)
    const container = document.getElementById('wq-list-container')
    const noRes = document.getElementById('wq-no-results')
    if (container) container.innerHTML = filtered.map(w => buildWQCard(w)).join('')
    if (noRes) noRes.style.display = filtered.length === 0 ? '' : 'none'
    bindActionButtons()
  }

  document.querySelectorAll('#wq-filter-bar .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => { document.querySelectorAll('#wq-filter-bar .filter-chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); currentFilter = chip.dataset.filter; applyAll() })
  })
  document.getElementById('wq-search')?.addEventListener('input', applyAll)
  document.getElementById('wq-sort')?.addEventListener('change', (e) => { currentSort = e.target.value; applyAll() })
  document.getElementById('wq-clear-filter')?.addEventListener('click', () => {
    document.getElementById('wq-search').value = ''; currentFilter = 'all'; currentSort = 'recent'
    document.querySelectorAll('#wq-filter-bar .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'))
    document.getElementById('wq-sort').value = 'recent'; applyAll()
  })

  bindActionButtons()
}

function bindActionButtons() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const wqId = parseInt(btn.dataset.wqId, 10)
      const action = btn.dataset.action
      if (!wqId) return
      const msgMap = { mastered: '确定标记为"已掌握"吗？', unresolved: '确定恢复为"未掌握"吗？', removed: '确定移出错题本吗？' }
      if (!confirm(msgMap[action] || '确定吗？')) return
      btn.disabled = true; btn.textContent = '处理中...'
      try {
        await updateWrongQuestionStatus(wqId, action)
        showToast('错题状态已更新', 'success')
        setTimeout(() => window.location.reload(), 500)
      } catch (err) {
        showToast('操作失败: ' + err.message, 'error')
        btn.disabled = false
      }
    })
  })
}
