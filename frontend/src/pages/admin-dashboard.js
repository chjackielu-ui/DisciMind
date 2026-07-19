import { getAdminDashboard, ADMIN_DASHBOARD_CONTRACT_VERSION } from '../api/admin.js'
import { requireAdminUser, renderAdminPage, formatMetric, escapeHtml, getIcon } from '../utils/admin-ui.js'
import { formatDate } from '../utils/format.js'

const STATUS_LABELS = {
  available: '可用',
  operational: '运行正常',
  healthy: '健康',
  success: '正常',
  degraded: '部分受限',
  warning: '需关注',
  unchecked: '未检测',
  pending: '待处理',
  unavailable: '不可用',
  failed: '失败',
  error: '异常',
  unknown: '状态未知',
}

function statusTag(status) {
  const value = String(status || 'unknown').toLowerCase()
  const className = ['available', 'operational', 'healthy', 'success'].includes(value)
    ? 'tag-active'
    : ['unavailable', 'failed', 'error'].includes(value)
      ? 'tag-rejected'
      : 'tag-pending'
  return `<span class="tag ${className}">${escapeHtml(STATUS_LABELS[value] || status || '状态未知')}</span>`
}

function metricCard(label, value, source) {
  return `<article class="stat-card">
    <div class="stat-value">${formatMetric(value)}</div>
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-meta">${escapeHtml(source)}</div>
  </article>`
}

function compactMetric(label, value, hint = '') {
  const normalized = value == null ? '—' : formatMetric(value)
  return `<div class="admin-compact-metric"><span>${escapeHtml(label)}</span><strong data-dashboard-value="${escapeHtml(String(value ?? ''))}">${normalized}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</div>`
}

function metricGroup(title, leadLabel, leadValue, rows, tone) {
  return `<article class="admin-metric-group is-${tone}">
    <header><span>${escapeHtml(title)}</span><strong data-dashboard-value="${escapeHtml(String(leadValue ?? ''))}">${leadValue == null ? '—' : formatMetric(leadValue)}</strong><small>${escapeHtml(leadLabel)}</small></header>
    <div>${rows.map((row) => compactMetric(row.label, row.value, row.hint)).join('')}</div>
  </article>`
}

function renderGroupedMetrics(summary, data) {
  return `<section class="admin-metric-groups" aria-label="管理驾驶舱核心指标">
    ${metricGroup('用户与组织', '用户总数', summary.user_count, [
      { label: '学生', value: summary.student_count },
      { label: '教师', value: summary.teacher_count },
      { label: '管理员', value: summary.admin_count },
    ], 'users')}
    ${metricGroup('教学运行', '课程数', summary.course_count, [
      { label: '行政班', value: summary.admin_class_count },
      { label: '教学班', value: summary.teaching_class_count },
      { label: '活跃班', value: summary.teaching_class_count, hint: '当前状态' },
    ], 'teaching')}
    ${metricGroup('内容与 AI', '知识文档', summary.knowledge_document_count, [
      { label: '今日调用', value: summary.ai_call_count_today },
      { label: '供应商', value: data.system_status?.ai_providers_enabled, hint: '已启用' },
      { label: '可用 Agent', value: data.system_status?.online_agents },
    ], 'ai')}
    ${metricGroup('待办与风险', '待办总量', Number(summary.pending_review_document_count || 0) + Number(summary.pending_agent_review_count || 0) + Number(summary.pending_agent_report_count || 0), [
      { label: '知识审核', value: summary.pending_review_document_count },
      { label: '智能体审核', value: summary.pending_agent_review_count },
      { label: '未读通知', value: summary.unread_notification_count },
    ], 'risk')}
  </section>`
}

function assertDashboardContract(data) {
  if (!data || typeof data !== 'object') throw new Error('驾驶舱接口未返回有效数据。')
  if (!data.summary || typeof data.summary !== 'object') throw new Error('驾驶舱缺少 summary 数据结构。')
  if (!data.system_status || typeof data.system_status !== 'object') throw new Error('驾驶舱缺少 system_status 数据结构。')
  if (!data.service_health || typeof data.service_health !== 'object' || !Array.isArray(data.service_health.services)) {
    throw new Error('驾驶舱缺少 service_health 数据结构。')
  }
  if (!Array.isArray(data.module_errors) || !Array.isArray(data.recent_events)) {
    throw new Error('驾驶舱模块状态结构无效。')
  }
}

function renderServiceHealth(data) {
  const services = data.service_health.services
  if (!services.length) {
    return '<div class="empty-state"><p>暂时没有可展示的服务检测记录。</p></div>'
  }
  return `<div class="admin-links">${services.map((service) => `<article class="admin-link-item">
    <span class="admin-link-icon">${getIcon(service.key === 'database' ? 'document' : service.key === 'api_contract' ? 'alert' : 'settings')}</span>
    <div class="admin-link-info">
      <span class="admin-link-title">${escapeHtml(service.name || service.key || '服务')}</span>
      <span class="admin-link-desc">${escapeHtml(service.message || '暂无补充说明')}</span>
    </div>
    ${statusTag(service.status)}
  </article>`).join('')}</div>`
}

function renderRecentEvents(events) {
  if (!events.length) return '<div class="empty-state"><p>暂无最近管理操作。</p></div>'
  return `<div class="table-container"><table>
    <thead><tr><th>操作</th><th>对象</th><th>状态</th><th>时间</th></tr></thead>
    <tbody>${events.map((event) => `<tr>
      <td>${escapeHtml(event.operation_type || '-')}</td>
      <td>${escapeHtml(event.target_type || 'system')}</td>
      <td>${statusTag(event.action_status)}</td>
      <td>${event.created_at ? escapeHtml(formatDate(event.created_at, 'short')) : '-'}</td>
    </tr>`).join('')}</tbody>
  </table></div>`
}

function renderTrend(data) {
  const rows = Array.isArray(data.trend) ? data.trend : []
  const totalAi = rows.reduce((sum, item) => sum + Number(item.ai_calls || 0), 0)
  const totalLearning = rows.reduce((sum, item) => sum + Number(item.learning_sessions || 0), 0)
  if (!rows.length) return '<div class="empty-state"><p>趋势模块暂不可用，基础统计不受影响。</p></div>'
  if (!totalAi && !totalLearning) {
    return '<div class="empty-state"><p>最近 14 天暂无 AI 调用或学习流样本，暂不绘制趋势。</p></div>'
  }
  const max = Math.max(1, ...rows.flatMap((item) => [Number(item.ai_calls || 0), Number(item.learning_sessions || 0)]))
  return `<div class="admin-trend-summary"><span>AI 调用 <strong>${formatMetric(totalAi)}</strong></span><span>学习流 <strong>${formatMetric(totalLearning)}</strong></span></div>
    <div class="admin-trend-chart" role="img" aria-label="最近 14 天 AI 调用与学习流趋势">
      ${rows.map((item) => {
        const ai = Number(item.ai_calls || 0)
        const learning = Number(item.learning_sessions || 0)
        return `<div class="admin-trend-day" title="${escapeHtml(item.date)}：AI ${ai}，学习流 ${learning}">
          <div class="admin-trend-bars"><i class="is-ai" style="height:${Math.max(ai ? 6 : 0, (ai / max) * 100)}%"></i><i class="is-learning" style="height:${Math.max(learning ? 6 : 0, (learning / max) * 100)}%"></i></div>
          <span>${escapeHtml(String(item.date || '').slice(5))}</span>
        </div>`
      }).join('')}
    </div>
    <div class="admin-trend-legend"><span><i class="is-ai"></i>AI 调用</span><span><i class="is-learning"></i>学习流</span></div>`
}

function distributionBlock(title, rows) {
  const items = Array.isArray(rows) ? rows : []
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0)
  if (!items.length || !total) return `<div class="admin-distribution-block"><h4>${escapeHtml(title)}</h4><p class="admin-data-empty">暂无可统计样本</p></div>`
  const max = Math.max(...items.map((item) => Number(item.value || 0)), 1)
  return `<div class="admin-distribution-block"><h4>${escapeHtml(title)}</h4>${items.map((item) => {
    const value = Number(item.value || 0)
    return `<div class="admin-distribution-row"><span>${escapeHtml(item.label || item.key)}</span><div><i style="width:${(value / max) * 100}%"></i></div><strong>${formatMetric(value)}</strong></div>`
  }).join('')}</div>`
}

function renderDistributions(distributions) {
  const data = distributions || {}
  return `<div class="admin-distribution-grid">
    ${distributionBlock('用户角色', data.users)}
    ${distributionBlock('班级类型', data.classes)}
    ${distributionBlock('知识审核', data.knowledge_reviews)}
  </div>`
}

function renderComposition(distributions) {
  const data = distributions || {}
  return `<div class="admin-composition-stack">${distributionBlock('用户角色构成', data.users)}${distributionBlock('班级构成', data.classes)}</div>`
}

function renderCourseRanking(rows) {
  return distributionBlock('按教学班数量排序', (rows || []).map((item) => ({
    key: item.course_id,
    label: item.course_name,
    value: item.teaching_class_count,
  })))
}

function renderProviderMatrix(data) {
  const providers = data?.service_health?.providers || []
  if (!providers.length) return '<div class="empty-state admin-dashboard-empty"><p>暂无已启用供应商，或供应商状态模块暂不可用。</p></div>'
  return `<div class="admin-provider-matrix">${providers.map((provider) => `<article>
    <span class="admin-health-dot is-${escapeHtml(String(provider.status || 'unknown').toLowerCase())}" aria-hidden="true"></span>
    <div><strong>${escapeHtml(provider.name || '未命名供应商')}</strong><small>${provider.latency_ms == null ? '暂无延迟样本' : `${formatMetric(provider.latency_ms)} ms`}</small></div>
    ${statusTag(provider.status)}
  </article>`).join('')}</div>`
}

function renderAiReliability(data) {
  const rate = data.metrics?.ai_success_rate
  const percentage = rate == null ? null : Math.round(Number(rate) * 1000) / 10
  const failures = data.ai_failure_reasons || []
  return `<div class="admin-reliability-head"><strong>${percentage == null ? '—' : `${percentage}%`}</strong><span>最近样本成功率</span><small>${data.metrics?.sample_status?.ai === 'sufficient' ? '来自真实 AI 调用日志' : '样本不足'}</small></div>
    ${distributionBlock('最近 14 天失败原因', failures)}`
}

function renderFrequentEvents(events) {
  if (!events?.length) return '<div class="empty-state admin-dashboard-empty"><p>最近 14 天暂无可聚合管理事件。</p></div>'
  const max = Math.max(1, ...events.map((item) => Number(item.count || 0)))
  return `<div class="admin-event-frequency">${events.map((event) => `<div><span>${escapeHtml(event.operation_type || 'UNKNOWN')}</span><i><b style="width:${(Number(event.count || 0) / max) * 100}%"></b></i><strong>${formatMetric(event.count)}</strong></div>`).join('')}</div>`
}

function renderTodo(todo) {
  const rows = [
    ['智能体审核', todo?.pending_agent_reviews, '#/admin/agent-reviews'],
    ['知识文档审核', todo?.pending_knowledge_reviews, '#/admin/knowledge'],
    ['智能体举报', todo?.pending_agent_reports, '#/admin/agent-reviews'],
    ['知识治理问题', todo?.pending_knowledge_issues, '#/admin/knowledge'],
    ['AI 风险事件', todo?.pending_risks, '#/admin/risks'],
    ['教学干预', todo?.pending_interventions, '#/admin/teaching-issues'],
  ]
  return `<div class="admin-todo-list">${rows.map(([label, value, href]) => `<a href="${href}"><span>${escapeHtml(label)}</span><strong>${value == null ? '不可用' : formatMetric(value)}</strong>${getIcon('arrow-right')}</a>`).join('')}</div>`
}

function renderReviewFlow(flow) {
  const data = flow || {}
  const groups = [
    { title: '知识文档', href: '#/admin/knowledge', values: data.knowledge_documents || {}, labels: { pending: '待审', approved: '通过', rejected: '驳回' } },
    { title: '智能体版本', href: '#/admin/agent-reviews', values: data.agent_versions || {}, labels: { pending: '待审', approved: '通过', rejected: '驳回' } },
    { title: '智能体举报', href: '#/admin/agent-reviews', values: data.reports || {}, labels: { pending: '待处理', resolved: '已处理' } },
  ]
  const sampleCount = groups.reduce((sum, group) => sum + Object.values(group.values).reduce((inner, value) => inner + Number(value || 0), 0), 0)
  if (!sampleCount) return '<div class="empty-state"><p>当前没有审核流样本。</p></div>'
  return `<div class="admin-review-flow">${groups.map((group) => `<a href="${group.href}" class="admin-review-flow-item">
    <h4>${escapeHtml(group.title)}</h4>
    <div>${Object.entries(group.labels).map(([key, label]) => `<span><b>${formatMetric(group.values[key] || 0)}</b>${label}</span>`).join('')}</div>
  </a>`).join('')}</div>`
}

function renderModuleErrors(errors) {
  if (!errors.length) return ''
  return `<section class="card admin-recovery-warning">
    <h3 class="card-title">部分模块暂不可用</h3>
    <p>基础管理数据仍可使用；以下模块已明确降级，没有用空数组或模拟数据掩盖错误。</p>
    <ul>${errors.map((item) => `<li><strong>${escapeHtml(item.module || 'unknown')}</strong>：${escapeHtml(item.message || '模块加载失败')}</li>`).join('')}</ul>
  </section>`
}

function renderDashboard(data, user) {
  assertDashboardContract(data)
  const summary = data.summary
  const isCurrentContract = data.contract_version === ADMIN_DASHBOARD_CONTRACT_VERSION
  const displayName = user.profile?.real_name || user.username || '管理员'
  return `<div class="dashboard-content">
    <section class="welcome-banner admin-banner">
      <div class="admin-banner-particles" aria-hidden="true">${Array.from({ length: 12 }, (_, index) => `<i style="--particle-index:${index}"></i>`).join('')}</div>
      <div class="welcome-text">
        <h2>欢迎你，${escapeHtml(displayName)}</h2>
        <p>这里展示来自数据库的基础管理指标与可验证的服务状态。</p>
      </div>
      <div class="welcome-illustration" aria-hidden="true">${getIcon('chart')}</div>
    </section>

    <section class="admin-dashboard-toolbar">
      <div>
        <h2>管理驾驶舱</h2>
        <p>接口契约：${escapeHtml(data.contract_version)}${isCurrentContract ? '' : '（兼容模式）'}${data.generated_at ? ` · 更新于 ${escapeHtml(formatDate(data.generated_at, 'short'))}` : ''}</p>
      </div>
      <button type="button" class="btn btn-primary" id="admin-dashboard-refresh">${getIcon('refresh')} 刷新</button>
    </section>

    ${!isCurrentContract ? `<section class="card admin-recovery-warning"><h3 class="card-title">后端服务版本需要同步</h3><p>当前接口不是 ${ADMIN_DASHBOARD_CONTRACT_VERSION}。页面仅展示接口实际返回的基础统计，高级模块标记为不可用；请完成后端重启后再验收。</p></section>` : ''}

    ${renderGroupedMetrics(summary, data)}

    ${renderModuleErrors(data.module_errors)}

    <div class="admin-dashboard-grid">
    <section class="card admin-dashboard-trend-card admin-grid-span-8">
      <div class="section-header"><div><h3 class="card-title">最近 14 天活动趋势</h3><p>真实聚合 AI 调用与学习流执行；无样本时明确显示数据不足。</p></div></div>
      ${renderTrend(data)}
    </section>
    <section class="card admin-grid-span-4">
      <div class="section-header"><h3 class="card-title">用户与班级构成</h3></div>
      ${renderComposition(data.distributions)}
    </section>
    <section class="card admin-grid-span-4">
      <div class="section-header"><h3 class="card-title">课程教学班排行</h3></div>
      ${renderCourseRanking(data.course_class_ranking)}
    </section>
    <section class="card admin-grid-span-4">
      <div class="section-header"><h3 class="card-title">审核流概览</h3></div>
      ${renderReviewFlow(data.review_flow)}
    </section>
    <section class="card admin-grid-span-4">
      <div class="section-header"><h3 class="card-title">AI 供应商健康矩阵</h3></div>
      ${renderProviderMatrix(data)}
    </section>
    <section class="card admin-grid-span-6">
      <div class="section-header"><h3 class="card-title">AI 调用可靠性</h3></div>
      ${renderAiReliability(data)}
    </section>
    <section class="card admin-grid-span-6">
      <div class="section-header"><h3 class="card-title">近期高频管理事件</h3></div>
      ${renderFrequentEvents(data.frequent_admin_events)}
    </section>
    <section class="card admin-grid-span-5">
      <div class="section-header"><h3 class="card-title">待办事项</h3></div>
      ${renderTodo(data.todo)}
    </section>
    <section class="card admin-grid-span-7">
      <div class="section-header"><h3 class="card-title">最近管理操作</h3><a class="btn-link" href="#/admin/logs">查看全部日志</a></div>
      ${renderRecentEvents(data.recent_events)}
    </section>
    <section class="card admin-grid-span-12">
      <div class="section-header">
        <div><h3 class="card-title">系统与服务状态</h3><p>总状态：${statusTag(data.service_health.overall)} · 数据库：${statusTag(data.system_status.database)}</p></div>
      </div>
      ${renderServiceHealth(data)}
    </section>
    </div>
  </div>`
}

function animateDashboardNumbers(root) {
  if (!root || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  root.querySelectorAll('[data-dashboard-value]').forEach((element) => {
    const target = Number(element.dataset.dashboardValue)
    if (!Number.isFinite(target) || target < 0) return
    const started = performance.now()
    const duration = 420
    const frame = (now) => {
      const ratio = Math.min(1, (now - started) / duration)
      element.textContent = formatMetric(Math.round(target * (1 - Math.pow(1 - ratio, 3))))
      if (ratio < 1) window.requestAnimationFrame(frame)
    }
    window.requestAnimationFrame(frame)
  })
}

function dashboardSkeleton() {
  return `<div class="admin-dashboard-skeleton" aria-label="正在读取真实管理数据">
    <div class="is-banner"></div><div class="is-toolbar"></div>
    <div class="is-metrics">${Array.from({ length: 4 }, () => '<i></i>').join('')}</div>
    <div class="is-panels"><i></i><i></i><i></i></div>
  </div>`
}

export async function renderAdminDashboard(app) {
  const user = await requireAdminUser()
  if (!user) return
  renderAdminPage(app, {
    user,
    title: '管理驾驶舱',
    contentHTML: `<div id="admin-dashboard-root">${dashboardSkeleton()}</div>`,
  })

  async function loadDashboard() {
    const target = document.getElementById('admin-dashboard-root')
    if (!target) return
    target.innerHTML = dashboardSkeleton()
    try {
      const result = await getAdminDashboard()
      if (!document.body.contains(target)) return
      target.innerHTML = renderDashboard(result.data, user)
      animateDashboardNumbers(target)
      document.getElementById('admin-dashboard-refresh')?.addEventListener('click', loadDashboard)
    } catch (error) {
      const currentRoot = document.getElementById('admin-dashboard-root')
      if (!currentRoot) return
      currentRoot.innerHTML = `<div class="error-state"><div class="error-icon">${getIcon('alert')}</div><div class="error-message">${escapeHtml(error.message || '驾驶舱数据加载失败，请稍后重试。')}</div><button type="button" class="btn-retry" id="admin-dashboard-retry">重新加载</button></div>`
      document.getElementById('admin-dashboard-retry')?.addEventListener('click', loadDashboard)
    }
  }

  await loadDashboard()
}
