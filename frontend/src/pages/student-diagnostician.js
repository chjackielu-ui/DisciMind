// 学生端 — 诊断师分析页面
// 提供心智模型、策略干预、成长报告三种诊断分析

import { getMe } from '../api/auth.js'
import { getMentalModel, getStrategyIntervention, getGrowthReport, DIAGNOSTICIAN_MODES } from '../api/diagnostician.js'
import { getUser } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'

const MENU_ITEMS = STUDENT_MENU_ITEMS
const KP_ID_DEFAULT = 1

let currentMode = DIAGNOSTICIAN_MODES.MENTAL_MODEL
let currentResult = null
let loading = false

function getModeLabel(mode) {
  const map = {
    [DIAGNOSTICIAN_MODES.MENTAL_MODEL]: '心智模型分析',
    [DIAGNOSTICIAN_MODES.STRATEGY_INTERVENTION]: '策略干预建议',
    [DIAGNOSTICIAN_MODES.GROWTH_REPORT]: '成长报告',
  }
  return map[mode] || mode
}

function getModeDesc(mode) {
  const map = {
    [DIAGNOSTICIAN_MODES.MENTAL_MODEL]: '基于学习数据构建学生当前知识点的认知模型，识别掌握程度和潜在误解。',
    [DIAGNOSTICIAN_MODES.STRATEGY_INTERVENTION]: '检测学习异常模式，生成面向训练师和讲解者的精准干预指令。',
    [DIAGNOSTICIAN_MODES.GROWTH_REPORT]: '汇总一段时间内的学习变化趋势，评估策略有效性和能力迁移迹象。',
  }
  return map[mode] || ''
}

async function runAnalysis(mode, extra = {}) {
  if (loading) return
  loading = true
  currentMode = mode
  renderContent()

  try {
    let response
    if (mode === DIAGNOSTICIAN_MODES.MENTAL_MODEL) {
      response = await getMentalModel(KP_ID_DEFAULT, extra.sessionId)
    } else if (mode === DIAGNOSTICIAN_MODES.STRATEGY_INTERVENTION) {
      response = await getStrategyIntervention(KP_ID_DEFAULT, extra.sessionId)
    } else {
      response = await getGrowthReport({
        knowledgePointId: KP_ID_DEFAULT,
        reportPeriod: extra.reportPeriod || { from: '2026-07-01', to: '2026-07-09' },
      })
    }
    currentResult = response.data
    showToast('分析完成', 'success')
  } catch (err) {
    currentResult = { _error: err.message || '分析请求失败' }
    showToast(err.message || '分析失败', 'error')
  } finally {
    loading = false
    renderContent()
  }
}

function renderMentalModelResult(result) {
  const m = result.mental_model_summary || {}
  if (!m || Object.keys(m).length === 0) return '<p class="diag-empty">暂无心智模型数据</p>'

  const level = m.mastery_level || 0
  const levelLabel = level >= 85 ? '优秀' : level >= 70 ? '良好' : level >= 50 ? '一般' : level > 0 ? '薄弱' : '未评估'
  const levelColor = level >= 85 ? '#22c55e' : level >= 70 ? '#3b82f6' : level >= 50 ? '#f59e0b' : '#ef4444'

  const items = [
    { label: '掌握程度', value: `${level}/100` },
    { label: '掌握等级', value: levelLabel },
    { label: '信心水平', value: m.confidence_level || '—' },
    { label: '认知速度', value: m.cognitive_speed || '—' },
    { label: '注意力特征', value: m.attention_profile || '—' },
    { label: '信心校准', value: m.confidence_calibration || '—' },
    { label: '类比响应度', value: m.analogy_responsiveness != null ? `${Math.round(m.analogy_responsiveness * 100)}%` : '—' },
    { label: '认知负荷', value: m.cognitive_load_estimate || '—' },
  ]

  const strategies = Array.isArray(m.recommended_strategies) ? m.recommended_strategies : []
  const misconceptions = Array.isArray(m.detected_misconceptions) ? m.detected_misconceptions : []

  return `
    <div class="diag-mastery-bar">
      <div class="diag-mastery-fill" style="width:${level}%;background:${levelColor}"></div>
      <span>${level}/100 · ${levelLabel}</span>
    </div>
    <div class="diag-grid">
      ${items.map(i => `<div class="diag-item"><span class="diag-item-label">${escapeHtml(i.label)}</span><span class="diag-item-value">${escapeHtml(String(i.value))}</span></div>`).join('')}
    </div>
    ${misconceptions.length > 0 ? `
      <div class="diag-section">
        <h4>检测到的误解模式</h4>
        <ul class="diag-list">${misconceptions.map(mc => `<li>${escapeHtml(typeof mc === 'string' ? mc : mc.description || mc.name || JSON.stringify(mc))}</li>`).join('')}</ul>
      </div>
    ` : ''}
    ${strategies.length > 0 ? `
      <div class="diag-section">
        <h4>推荐教学策略</h4>
        <ul class="diag-list">${strategies.map(s => `<li><strong>${escapeHtml(s.agent || '')}</strong> — ${escapeHtml(s.strategy || '')}：${escapeHtml(s.reason || '')}</li>`).join('')}</ul>
      </div>
    ` : ''}
  `
}

function renderInterventionResult(result) {
  const interventions = result.all_interventions || []
  if (interventions.length === 0 && !result.target_agent) return '<p class="diag-empty">暂无干预建议</p>'

  const main = result.instruction
  const parallel = result.parallel_instruction_to_explainer

  return `
    ${main ? `
      <div class="diag-section">
        <h4>主要干预 (→ ${escapeHtml(result.target_agent || 'orchestrator')})</h4>
        <div class="diag-intervention-card">
          <span class="diag-action">${escapeHtml(main.action || '—')}</span>
          <pre class="diag-params">${escapeHtml(JSON.stringify(main.params || {}, null, 2))}</pre>
        </div>
      </div>
    ` : ''}
    ${parallel ? `
      <div class="diag-section">
        <h4>并行指令 (→ explainer)</h4>
        <div class="diag-intervention-card">
          <span class="diag-action">${escapeHtml(parallel.action || '—')}</span>
          <pre class="diag-params">${escapeHtml(JSON.stringify(parallel.params || {}, null, 2))}</pre>
        </div>
      </div>
    ` : ''}
    ${interventions.length > 0 ? `
      <div class="diag-section">
        <h4>全部干预建议 (${interventions.length} 条)</h4>
        ${interventions.map((int, i) => `
          <div class="diag-intervention-card">
            <span class="diag-action">#${i + 1} → ${escapeHtml(int.target_agent || '?')}：${escapeHtml(int.instruction?.action || int.action || '—')}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `
}

function renderGrowthReportResult(result) {
  const growth = Array.isArray(result.knowledge_growth) ? result.knowledge_growth : []
  const strategies = Array.isArray(result.effective_strategies) ? result.effective_strategies : []
  const nextActions = Array.isArray(result.next_actions) ? result.next_actions : []
  const dq = result.data_quality || {}

  return `
    ${result.narrative_summary ? `
      <div class="diag-section">
        <h4>成长概览</h4>
        <p class="diag-narrative">${escapeHtml(String(result.narrative_summary).slice(0, 1000))}</p>
      </div>
    ` : ''}
    ${growth.length > 0 ? `
      <div class="diag-section">
        <h4>知识成长轨迹 (${growth.length} 条)</h4>
        ${growth.map(g => `<div class="diag-growth-item">
          <span>知识点 ${escapeHtml(String(g.knowledge_point_id || g.kp || '—'))}</span>
          <span class="diag-delta">${g.delta != null ? (g.delta >= 0 ? '+' : '') + g.delta : '—'}</span>
        </div>`).join('')}
      </div>
    ` : ''}
    ${Object.keys(result.error_evolution || {}).length > 0 ? `
      <div class="diag-section">
        <h4>错误演化</h4>
        <pre class="diag-pre">${escapeHtml(JSON.stringify(result.error_evolution, null, 2))}</pre>
      </div>
    ` : ''}
    ${strategies.length > 0 ? `
      <div class="diag-section">
        <h4>有效策略 (${strategies.length} 条)</h4>
        <ul class="diag-list">${strategies.map(s => {
          const effect = s.effect_score != null ? ` (效果分: ${s.effect_score})` : ''
          return `<li><strong>${escapeHtml(s.agent || s.strategy || '—')}</strong>${effect}</li>`
        }).join('')}</ul>
      </div>
    ` : ''}
    ${nextActions.length > 0 ? `
      <div class="diag-section">
        <h4>建议下一步</h4>
        <ul class="diag-list">${nextActions.map(a => `<li>${escapeHtml(typeof a === 'string' ? a : a.action || a.suggestion || JSON.stringify(a))}</li>`).join('')}</ul>
      </div>
    ` : ''}
    ${Object.keys(dq).length > 0 ? `
      <div class="diag-section diag-meta">
        <span>数据质量：样本量 ${dq.sample_size ?? dq.answer_count ?? dq.sampleCount ?? '—'}</span>
        ${dq.limitations?.length ? `<span> · 限制：${escapeHtml(dq.limitations.join(', '))}</span>` : ''}
        ${dq.sufficient === false ? '<span> · 数据不足，结论仅供参考</span>' : ''}
      </div>
    ` : ''}
  `
}

function renderResult() {
  if (loading) {
    return `<div class="diag-loading">⏳ 正在调用诊断师分析，请稍候...</div>`
  }

  if (!currentResult) {
    return `<p class="diag-empty">选择上方分析模式，点击"开始分析"获取诊断师报告。</p>`
  }

  if (currentResult._error) {
    return `<div class="diag-error">
      <p>❌ ${escapeHtml(currentResult._error)}</p>
      <button class="diag-retry-btn" onclick="window._diagRetry()">重试</button>
    </div>`
  }

  const result = currentResult.result || {}
  const mode = currentResult.mode

  let body = ''
  if (mode === DIAGNOSTICIAN_MODES.MENTAL_MODEL) {
    body = renderMentalModelResult(result)
  } else if (mode === DIAGNOSTICIAN_MODES.STRATEGY_INTERVENTION) {
    body = renderInterventionResult(result)
  } else if (mode === DIAGNOSTICIAN_MODES.GROWTH_REPORT) {
    body = renderGrowthReportResult(result)
  } else {
    body = `<pre class="diag-pre">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`
  }

  const requestId = currentResult.requestId || '—'
  const interventions = Array.isArray(currentResult.interventions) ? currentResult.interventions.length : 0

  return `
    <div class="diag-result-header">
      <span class="diag-mode-badge">${getModeLabel(mode)}</span>
      <span class="diag-meta">请求 ID：${escapeHtml(requestId)} | 干预数：${interventions}</span>
    </div>
    ${body}
  `
}

function renderContent() {
  const app = document.getElementById('app')
  if (!app) return

  const user = getUser()

  const contentHTML = `
    <div class="diag-page-shell">
      <div class="diag-hero">
        <div>
          <span class="diag-eyebrow">AI Diagnostician</span>
          <h2>诊断师分析</h2>
          <p>${escapeHtml(getModeDesc(currentMode))}</p>
        </div>
      </div>

      <div class="diag-mode-tabs">
        ${[DIAGNOSTICIAN_MODES.MENTAL_MODEL, DIAGNOSTICIAN_MODES.STRATEGY_INTERVENTION, DIAGNOSTICIAN_MODES.GROWTH_REPORT].map(m => `
          <button class="diag-mode-tab ${m === currentMode ? 'active' : ''}" onclick="window._diagSwitchMode('${m}')">
            ${getModeLabel(m)}
          </button>
        `).join('')}
      </div>

      <div class="diag-actions">
        <button class="diag-run-btn" onclick="window._diagRun()" ${loading ? 'disabled' : ''}>
          ${loading ? '分析中...' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg> 开始分析'}
        </button>
      </div>

      <div class="diag-result-card">
        ${renderResult()}
      </div>
    </div>
  `

  renderDashboardLayout(app, { menuItems: MENU_ITEMS, contentHTML, user })
}

// 全局函数供 onclick 使用
window._diagSwitchMode = function (mode) {
  currentMode = mode
  currentResult = null
  renderContent()
}

window._diagRun = function () {
  runAnalysis(currentMode)
}

window._diagRetry = function () {
  runAnalysis(currentMode)
}

export async function renderStudentDiagnostician() {
  try {
    await getMe()
  } catch {
    // 未登录由仪表盘布局处理
  }
  renderContent()
}

export const render = renderStudentDiagnostician
