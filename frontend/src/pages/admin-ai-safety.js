import { getAiSafetyOverview, syncAiSafetyStandards, setAiSafetyRuleEnabled } from '../api/admin.js'
import { requireAdminUser, renderAdminPage, notifyAdmin, setBusy, confirmAdmin, escapeHtml, getIcon } from '../utils/admin-ui.js'
import { loadAdminAccess, hasAdminPermission } from '../utils/admin-access.js'
import { formatDate } from '../utils/format.js'

const state = { user: null, access: null, data: null }

const POSTURE = {
  low: { label: '低风险', note: '当前没有未处置风险事件', className: 'is-low' },
  medium: { label: '中风险', note: '存在待核查风险事件', className: 'is-medium' },
  high: { label: '高风险', note: '存在高风险事件，需要优先处置', className: 'is-high' },
  critical: { label: '严重风险', note: '存在严重事件，应立即限制相关能力', className: 'is-critical' },
}

const DOMAIN_LABELS = {
  governance: '治理责任', privacy: '隐私数据', content: '内容安全', security: '系统安全',
  reliability: '可靠性', fairness: '公平性', transparency: '透明度', education: '教育场景', operations: '事件响应',
}

function metricCard(label, value, note, tone = '') {
  return `<article class="ai-safety-metric ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`
}

function controlsHTML(controls, canManage) {
  return controls.map((control) => {
    const ready = control.configured && control.status === 'published'
    const stateLabel = !control.configured ? '未同步' : control.enabled ? '已启用' : '已停用'
    return `<article class="ai-safety-control ${control.enabled ? 'is-enabled' : ''}">
      <header><div><span class="ai-safety-domain">${escapeHtml(DOMAIN_LABELS[control.domain] || control.domain)}</span><span class="ai-safety-function">${escapeHtml(control.nist_function)}</span></div><span class="ai-safety-control-state ${ready && control.enabled ? 'is-ready' : ''}">${escapeHtml(stateLabel)}</span></header>
      <h3>${escapeHtml(control.name)}</h3><p>${escapeHtml(control.description)}</p>
      <ul>${control.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <footer><div>${control.regulatory_basis.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>${canManage && control.rule_id ? `<button class="admin-button is-secondary" type="button" data-toggle-rule="${control.rule_id}" data-enabled="${control.enabled}">${control.enabled ? '停用规则' : '启用规则'}</button>` : ''}</footer>
    </article>`
  }).join('')
}

function eventsHTML(events) {
  if (!events.length) return '<div class="ai-safety-empty">当前风险事件表中没有记录；规则基线仅用于治理台账，需由具体检测链产生风险事件。</div>'
  return `<div class="admin-table-wrap"><table class="admin-table ai-safety-events"><thead><tr><th>风险事件</th><th>类型</th><th>严重度</th><th>状态</th><th>证据</th><th>检测时间</th></tr></thead><tbody>${events.map((event) => `<tr><td><strong>${escapeHtml(event.title || event.event_key)}</strong><br><small>${escapeHtml(event.rule?.name || event.event_key)}</small></td><td>${escapeHtml(DOMAIN_LABELS[event.risk_type] || event.risk_type)}</td><td><span class="ai-safety-severity is-${escapeHtml(event.severity)}">${escapeHtml(event.severity)}</span></td><td>${escapeHtml(event.status)}</td><td>${Number(event._count?.evidence || 0)} 条</td><td>${formatDate(event.detected_at, 'short')}</td></tr>`).join('')}</tbody></table></div>`
}

function renderData() {
  const root = document.getElementById('admin-ai-safety-root')
  if (!root || !state.data) return
  const data = state.data
  const canManage = hasAdminPermission(state.access, 'admin.risks.manage')
  const posture = POSTURE[data.risk_posture] || POSTURE.medium
  const configurationRate = Number(data.control_configuration_rate || 0)
  const percentage = `${Math.round(configurationRate * 100)}%`
  root.innerHTML = `
    <section class="ai-safety-posture ${posture.className}">
      <div class="ai-safety-posture-icon">${getIcon('alert')}</div><div><span>当前安全态势</span><h3>${posture.label}</h3><p>${posture.note}。治理基线版本 ${escapeHtml(data.framework_version)}。</p></div>
      <div class="ai-safety-score" style="--score:${Math.round(configurationRate * 100)}"><strong>${percentage}</strong><span>控制配置率</span></div>
    </section>
    <div class="ai-safety-metrics">
      ${metricCard('标准控制项', data.standard_control_count, '覆盖治理、数据、内容与运营')}
      ${metricCard('已配置并启用', data.active_control_count, `${data.standard_control_count - data.active_control_count} 项待配置`, data.active_control_count === data.standard_control_count ? 'is-good' : 'is-warning')}
      ${metricCard('待处置风险', data.open_event_count, `今日新增 ${data.today_event_count} 项`, data.open_event_count ? 'is-warning' : 'is-good')}
      ${metricCard('严重 / 高风险', `${data.critical_event_count} / ${data.high_event_count}`, '优先执行限制、调查与复盘', data.critical_event_count ? 'is-danger' : '')}
    </div>
    <section class="admin-card ai-safety-standards">
      <div class="admin-card-header"><div><span class="ai-safety-eyebrow">STANDARDIZED CONTROLS</span><h3>标准化安全规范</h3><p>这是治理台账与控制基线；同步后写入真实风险规则表，状态与管理员操作均可审计。配置率不等同于合规认证或自动防护率。</p></div>${canManage ? `<button class="admin-button" id="sync-ai-safety">${data.active_control_count ? '重新同步规范' : '同步并启用规范'}</button>` : ''}</div>
      <div class="ai-safety-control-grid">${controlsHTML(data.controls, canManage)}</div>
    </section>
    <section class="admin-card ai-safety-evidence">
      <div class="admin-card-header"><div><span class="ai-safety-eyebrow">EVIDENCE & RESPONSE</span><h3>风险证据与处置</h3><p>最近风险事件来自真实证据链，不使用模拟记录。</p></div><div class="admin-inline-actions"><a class="admin-button is-secondary" href="#/admin/traces">查看证据链</a><a class="admin-button is-secondary" href="#/admin/risks">进入风险处置</a></div></div>
      ${eventsHTML(data.recent_events || [])}
    </section>`
  bindActions()
}

function bindActions() {
  document.getElementById('sync-ai-safety')?.addEventListener('click', async (event) => {
    const confirmed = await confirmAdmin({ title: '同步标准安全规范', message: '将创建或升级 9 项标准风险规则，并写入管理员操作审计。', confirmLabel: '确认同步' })
    if (!confirmed) return
    const button = event.currentTarget; setBusy(button, true, '同步中')
    try { const result = await syncAiSafetyStandards(); notifyAdmin(`已同步 ${result.data.synced_count} 项安全规范`); await load() }
    catch (error) { notifyAdmin(error.message || '规范同步失败', true); setBusy(button, false) }
  })
  document.querySelectorAll('[data-toggle-rule]').forEach((button) => button.addEventListener('click', async () => {
    const enabled = button.dataset.enabled !== 'true'
    const confirmed = await confirmAdmin({ title: enabled ? '启用安全规则' : '停用安全规则', message: enabled ? '启用后该控制项计入控制配置率。' : '停用会降低控制配置率，并保留完整审计记录。', confirmLabel: enabled ? '确认启用' : '确认停用', danger: !enabled })
    if (!confirmed) return
    setBusy(button, true)
    try { await setAiSafetyRuleEnabled(Number(button.dataset.toggleRule), enabled); notifyAdmin(enabled ? '安全规则已启用' : '安全规则已停用'); await load() }
    catch (error) { notifyAdmin(error.message || '规则更新失败', true); setBusy(button, false) }
  }))
}

async function load() {
  const root = document.getElementById('admin-ai-safety-root')
  if (root) root.innerHTML = '<div class="admin-skeleton" aria-label="正在加载 AI 安全治理数据"></div>'
  try { const result = await getAiSafetyOverview(); state.data = result.data; renderData() }
  catch (error) { if (root) root.innerHTML = `<div class="admin-error" role="alert"><div><strong>AI 安全治理数据加载失败</strong><p>${escapeHtml(error.message || '请稍后重试')}</p><button class="admin-button is-secondary" id="retry-ai-safety">重新加载</button></div></div>`; document.getElementById('retry-ai-safety')?.addEventListener('click', load) }
}

export async function renderAdminAiSafety(app) {
  const user = await requireAdminUser(); if (!user) return
  state.user = user
  try { state.access = await loadAdminAccess(user.user_id) } catch (error) { notifyAdmin(error.message, true); return }
  renderAdminPage(app, { user, title: 'AI 安全治理', contentHTML: `<div class="admin-page ai-safety-page">
    <div class="admin-page-header ai-safety-header"><div><span class="ai-safety-eyebrow">AI SAFETY GOVERNANCE</span><h2>AI 安全治理</h2><p>以风险为核心，把治理责任、评测、监测、处置和持续改进形成可审计闭环。</p></div><button class="admin-button is-secondary" id="refresh-ai-safety">刷新</button></div>
    <div class="ai-safety-frameworks" aria-label="规范依据">
      <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noreferrer"><strong>NIST AI RMF</strong><span>GOVERN · MAP · MEASURE · MANAGE</span></a>
      <a href="https://www.iso.org/standard/42001" target="_blank" rel="noreferrer"><strong>ISO/IEC 42001</strong><span>AI 管理体系与 PDCA</span></a>
      <a href="https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm" target="_blank" rel="noreferrer"><strong>中国监管要求</strong><span>生成式 AI 服务管理暂行办法</span></a>
      <a href="https://std.samr.gov.cn/gb/search/gbDetailedCNF?id=33D40F1160BF5D92E06397BE0A0A5B93" target="_blank" rel="noreferrer"><strong>GB/T 45654-2025</strong><span>生成式 AI 服务安全基本要求</span></a>
    </div><div id="admin-ai-safety-root"><div class="admin-skeleton"></div></div></div>` })
  document.getElementById('refresh-ai-safety')?.addEventListener('click', load)
  await load()
}
