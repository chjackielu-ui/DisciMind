import { getAdminTraces, getAdminTrace, markAdminTraceRisk } from '../api/admin.js'
import { requireAdminUser, renderAdminPage, notifyAdmin, statusBadge, openAdminDrawer, emptyHTML, escapeHtml } from '../utils/admin-ui.js'
import { formatDate } from '../utils/format.js'

const state = { page: 1, pageSize: 20, filters: {}, total: 0, list: [] }

function tableHTML() {
  if (!state.list.length) return emptyHTML('暂无 AI 请求轨迹', '真实 AI 调用发生后，证据链会在此显示。')
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>请求 ID</th><th>用户</th><th>场景</th><th>状态</th><th>知识引用</th><th>Token</th><th>耗时</th><th>时间</th><th>操作</th></tr></thead><tbody>${state.list.map((item) => `<tr data-trace-id="${item.id}"><td><code>${escapeHtml(String(item.request_id || item.trace_id || item.id || '').slice(0, 12))}...</code></td><td>${escapeHtml(item.user_name || '系统')}</td><td>${escapeHtml(item.scene || item.entry_point || '未标注')}</td><td>${statusBadge(item.risk_flag ? 'risk' : item.status)}</td><td>${item.retrieval_hit ? '已命中' : '未命中'}</td><td>${item.total_tokens ?? '数据不足'}</td><td>${item.latency_ms == null ? '数据不足' : `${item.latency_ms} ms`}</td><td>${formatDate(item.created_at, 'short')}</td><td><div class="admin-inline-actions"><button class="admin-button is-secondary" data-trace-view>查看证据链</button><button class="admin-button is-danger" data-trace-risk ${item.risk_flag ? 'disabled title="该请求已标记为风险"' : ''}>${item.risk_flag ? '已标记风险' : '标记风险'}</button></div></td></tr>`).join('')}</tbody></table></div><div class="admin-pagination"><span>共 ${state.total} 条，第 ${state.page} 页</span><div class="admin-pagination-actions"><button class="admin-button is-secondary" id="trace-prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><button class="admin-button is-secondary" id="trace-next" ${state.page * state.pageSize >= state.total ? 'disabled' : ''}>下一页</button></div></div>`
}

async function showTrace(id) {
  const result = await getAdminTrace(id); const trace = result.data
  if (!trace || typeof trace !== 'object') throw new Error('证据链接口未返回受支持的数据结构')
  const steps = Array.isArray(trace.steps) ? trace.steps.filter((step) => step && typeof step === 'object') : []
  const retrievals = Array.isArray(trace.retrievals) ? trace.retrievals.filter((item) => item && typeof item === 'object') : []
  const nodes = [
    { type: 'input', title: '请求输入', status: 'success', detail: trace.input_summary },
    ...steps.map((step) => ({ type: step.step_type, title: step.title, status: step.status, detail: step.output_summary || step.input_summary, latency: step.latency_ms })),
    { type: 'output', title: '结果输出', status: trace.status, detail: trace.output_summary },
  ]
  const requestLabel = String(trace.request_id || trace.trace_id || id || '').slice(0, 12)
  openAdminDrawer({ title: `证据链 · ${requestLabel}`, submitLabel: '关闭', content: `<div class="admin-trace-summary"><div><span>Trace ID</span><code>${escapeHtml(trace.trace_id || trace.request_id || id)}</code></div><div><span>状态</span>${statusBadge(trace.status)}</div><div><span>Token</span><strong>${trace.total_tokens ?? '数据不足'}</strong></div><div><span>总耗时</span><strong>${trace.latency_ms == null ? '数据不足' : `${trace.latency_ms} ms`}</strong></div></div><div class="admin-timeline">${nodes.map((node, index) => `<article class="admin-timeline-node"><span class="admin-timeline-index">${index + 1}</span><div><header><h4>${escapeHtml(node.title)}</h4>${statusBadge(node.status)}</header>${node.latency != null ? `<small>${node.latency} ms</small>` : ''}<pre>${escapeHtml(typeof node.detail === 'string' ? node.detail : JSON.stringify(node.detail || {}, null, 2))}</pre></div></article>`).join('')}</div>${retrievals.length ? `<div class="admin-card"><div class="admin-card-header"><h3>知识检索与引用</h3></div>${retrievals.map((item) => `<p><strong>${escapeHtml(item.document_title || '未命名文档')}</strong> · 页码 ${item.page_number ?? '未知'} · 检索分数 ${item.retrieval_score ?? '数据不足'}</p>`).join('')}</div>` : ''}`, onSubmit: async () => true })
}

function riskDialog(id) {
  openAdminDrawer({ title: '标记 AI 风险事件', submitLabel: '创建风险事件', content: `<div class="admin-form-grid"><div class="admin-field"><label>风险类型</label><select class="admin-select" name="risk_type"><option value="hallucination">AI 幻觉风险</option><option value="prompt_injection">提示词注入</option><option value="sensitive_content">敏感内容</option><option value="academic_integrity">学术诚信风险</option><option value="manual_review">人工复核</option></select></div><div class="admin-field"><label>等级</label><select class="admin-select" name="severity"><option value="medium">中</option><option value="high">高</option><option value="critical">严重</option><option value="low">低</option></select></div><div class="admin-field is-wide"><label>标题</label><input class="admin-input" name="title" value="管理员标记的 AI 请求风险" required></div><div class="admin-field is-wide"><label>说明</label><textarea class="admin-textarea" name="description"></textarea></div></div>`, onSubmit: async (data) => { await markAdminTraceRisk(id, Object.fromEntries(data.entries())); notifyAdmin('已创建风险事件并关联证据链'); await load(); return true } })
}

function bind() {
  document.querySelectorAll('[data-trace-view]').forEach((button) => button.addEventListener('click', () => showTrace(button.closest('tr').dataset.traceId).catch((error) => notifyAdmin(error.message, true))))
  document.querySelectorAll('[data-trace-risk]').forEach((button) => button.addEventListener('click', () => riskDialog(button.closest('tr').dataset.traceId)))
  document.getElementById('trace-prev')?.addEventListener('click', () => { state.page -= 1; load() }); document.getElementById('trace-next')?.addEventListener('click', () => { state.page += 1; load() })
}

async function load() {
  const root = document.getElementById('admin-trace-table'); if (!root) return
  root.innerHTML = '<div class="admin-skeleton" aria-label="正在加载"></div>'
  try {
    const result = await getAdminTraces({ ...state.filters, page: state.page, page_size: state.pageSize })
    const data = result?.data
    if (!data || !Array.isArray(data.list)) throw new Error('轨迹列表接口未返回受支持的数据结构')
    state.list = data.list
    state.total = Number(data.total) || 0
    state.page = Number(data.page) || state.page
    state.pageSize = Number(data.pageSize || data.page_size) || state.pageSize
    root.innerHTML = tableHTML(); bind()
  } catch (error) {
    root.innerHTML = `<div class="admin-error" role="alert"><div><strong>轨迹列表加载失败</strong><p>${escapeHtml(error?.message || '请求失败，请稍后重试。')}</p><button class="admin-button is-secondary" id="retry-trace-load" type="button">重新加载</button></div></div>`
    document.getElementById('retry-trace-load')?.addEventListener('click', load)
  }
}

export async function renderAdminTraces(app) {
  const user = await requireAdminUser(); if (!user) return
  renderAdminPage(app, { user, title: 'AI 教学决策证据链', contentHTML: `<div class="admin-page"><div class="admin-page-header"><div><h2>AI 请求轨迹</h2><p>展示可解释的执行步骤、检索引用、工具调用与结果状态，不记录或暴露模型隐藏思维过程。</p></div><button class="admin-button is-secondary" id="trace-refresh">刷新</button></div><div class="admin-filter-bar"><div class="admin-field is-search"><label>请求 ID</label><input class="admin-input" id="trace-request-id" placeholder="request_id / trace_id"></div><div class="admin-field"><label>状态</label><select class="admin-select" id="trace-status"><option value="">全部</option><option value="success">成功</option><option value="failed">失败</option><option value="running">运行中</option></select></div><div class="admin-field"><label>风险</label><select class="admin-select" id="trace-risk"><option value="">全部</option><option value="true">仅风险</option></select></div><button class="admin-button" id="trace-search">筛选</button></div><div class="admin-card" id="admin-trace-table"><div class="admin-skeleton"></div></div></div>` })
  document.getElementById('trace-refresh').addEventListener('click', load); document.getElementById('trace-search').addEventListener('click', () => { state.page = 1; state.filters = { request_id: document.getElementById('trace-request-id').value.trim(), status: document.getElementById('trace-status').value, risk: document.getElementById('trace-risk').value }; load() })
  await load()
}
