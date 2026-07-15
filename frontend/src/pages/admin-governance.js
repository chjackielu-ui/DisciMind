import { getGovernanceOverview, getGovernanceList, runGovernanceAction } from '../api/admin.js'
import { requireAdminUser, renderAdminPage, notifyAdmin, setBusy, statusBadge, openAdminDrawer, confirmAdmin, parseJsonField, emptyHTML, formatMetric, escapeHtml } from '../utils/admin-ui.js'
import { formatDate } from '../utils/format.js'

const META = {
  'learning-flows': { title: '学习流治理中心', desc: '复用真实模板、版本、会话、节点运行与掌握度数据，检测结构和执行异常。' },
  'knowledge-health': { title: '知识库健康度中心', desc: '从真实知识库、文档、切片与检索记录识别质量问题和知识盲区。', primary: '运行健康扫描', primaryAction: 'scan' },
  'teaching-issues': { title: '教学问题雷达与干预', desc: '从掌握度、作答、错题与学习流数据发现问题，并形成可审计干预闭环。', primary: '检测教学问题', primaryAction: 'detect', secondary: '创建干预' },
  evaluations: { title: '多智能体能力评测', desc: '使用持久化评测集和真实模型运行，对正确性、时延、Token 与风险进行量化。', primary: '创建评测集', primaryAction: 'create' },
  experiments: { title: 'AI 教学沙盒与灰度发布', desc: '对 Agent、模型、提示词与检索配置进行稳定分组、发布、暂停和回滚。', primary: '创建实验', primaryAction: 'create' },
  'digital-twin': { title: '教学数字孪生班级', desc: '基于真实班级学生、掌握度和学习记录生成统计快照；样本不足时停止预测。', primary: '生成班级快照', primaryAction: 'calculate' },
  assets: { title: 'AI 教学资产沉淀中心', desc: '将优质回答、讲解、学习流和教学案例沉淀为可追溯、可审核、可版本化资产。', primary: '沉淀新资产', primaryAction: 'create' },
  'strategy-profiles': { title: '学生学习策略画像', desc: '以多行为信号和时间窗口识别学习方式，保存证据、置信度与历史版本。', primary: '计算学生画像', primaryAction: 'compute' },
  risks: { title: 'AI 安全与异常行为治理', desc: '集中处理幻觉、注入、越权、异常调用、隐私与学术诚信风险。' },
}

const LABELS = {
  total_flows: '学习流总数', today_executions: '今日执行', completion_rate: '完成率', interruption_rate: '中断率', average_mastery_delta: '平均掌握度变化', abnormal_flow_count: '异常流程',
  knowledge_base_count: '知识库', document_count: '文档', chunk_count: '切片', health_score: '健康度', knowledge_coverage: '覆盖率', open_issue_count: '待处理问题', blind_spot_count: '知识盲区',
  high_risk_issue_count: '高风险问题', intervention_count: '干预任务', completed_intervention_count: '已完成干预', affected_count: '影响范围', closure_rate: '闭环率',
  evaluation_set_count: '评测集', run_count: '评测运行', active_run_count: '运行中', average_score: '平均得分', average_latency_ms: '平均时延', result_sample_size: '结果样本',
  experiment_count: '实验总数', active_experiment_count: '运行中实验', assignment_count: '稳定分组', teaching_class_count: '教学班级', snapshot_count: '快照', average_confidence: '平均可信度', average_sample_size: '平均样本',
  asset_count: '资产总数', draft_count: '草稿', published_count: '已发布', pending_review_count: '待审核', usage_count: '使用次数', profile_count: '画像总数', student_count: '覆盖学生',
  open_event_count: '待处理风险', today_event_count: '今日风险', active_rule_count: '启用规则', critical_count: '严重风险',
}

const RECOVERY_LIMITATION = '该扩展模块已与主导航隔离，仅保留现有真实接口的读取与已接入操作。分页、细粒度权限和领域流程尚未完成逐项验收，当前页面不能视为完整治理中心。'

function metricKind(key) { return key.includes('rate') || key.includes('coverage') || key.includes('confidence') ? 'percent' : key.includes('score') || key.includes('delta') ? 'score' : null }

function rowTitle(item) { const identifier = item.id ?? item.template_id; return item.title || item.name || item.profile_type || item.event_key || (identifier == null ? '未命名治理记录' : `记录 ${identifier}`) }
function rowId(item) { return item.id ?? item.template_id }
function rowStatus(item) { return item.status || (typeof item.is_published === 'boolean' ? (item.is_published ? 'published' : 'draft') : 'unknown') }

function rowActions(module, item) {
  const status = rowStatus(item)
  if (module === 'learning-flows') return [{ key: 'validate', label: '结构校验' }]
  if (module === 'knowledge-health' && status === 'open') return [{ key: 'resolve', label: '处置问题' }]
  if (module === 'teaching-issues') return [{ key: 'create-intervention', label: '创建干预' }]
  if (module === 'evaluations') return [
    ...(status === 'draft' && item._count?.cases ? [{ key: 'publish', label: '发布评测集' }] : []),
    ...(item._count?.cases ? [{ key: 'run', label: '运行评测' }] : []),
  ]
  if (module === 'experiments') return [{ key: 'status', label: '发布控制' }]
  if (module === 'digital-twin') return [{ key: 'simulate', label: '干预模拟' }]
  if (module === 'assets') return [{ key: 'status', label: '审核发布' }]
  if (module === 'risks' && !['resolved', 'false_positive'].includes(status)) return [{ key: 'resolve', label: '处理风险', danger: true }]
  if (module === 'knowledge-health' || module === 'risks') return []
  return null
}

function listHTML(module, list) {
  if (!list.length) return emptyHTML('暂无治理记录', '恢复隔离范围内没有可展示的真实记录；页面未使用模拟数据填充。')
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>名称 / 标识</th><th>状态</th><th>范围 / 样本</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${list.map((item) => {
    const actions = rowActions(module, item)
    const identifier = rowId(item)
    const actionHTML = identifier == null
      ? '<span class="admin-limited-state">缺少可验证记录标识，操作已隔离</span>'
      : actions === null
        ? '<span class="admin-limited-state">恢复隔离：尚无已验证的行级操作</span>'
        : actions.length
          ? actions.map((action) => `<button class="admin-button ${action.danger ? 'is-danger' : 'is-secondary'}" data-row-action="${action.key}">${action.label}</button>`).join('')
          : '<span class="admin-help">当前状态无需操作</span>'
    return `<tr${identifier == null ? '' : ` data-id="${escapeHtml(identifier)}"`}><td><strong>${escapeHtml(rowTitle(item))}</strong><br><small>${escapeHtml(item.issue_type || item.asset_type || item.profile_type || item.experiment_key || item.template_key || '')}</small></td><td>${statusBadge(rowStatus(item))}</td><td>${item.sample_size ?? item.affected_count ?? item._count?.sessions ?? item._count?.cases ?? item._count?.assignments ?? '数据不足'}</td><td>${formatDate(item.updated_at || item.created_at || item.detected_at, 'short')}</td><td><div class="admin-inline-actions">${actionHTML}</div></td></tr>`
  }).join('')}</tbody></table></div>`
}

function actionDialog(module, action, id) {
  const forms = {
    validate: '',
    'create-intervention': `<div class="admin-form-grid"><div class="admin-field is-wide"><label>干预标题</label><input class="admin-input" name="title" required></div><div class="admin-field"><label>干预类型</label><select class="admin-select" name="intervention_type"><option value="push_learning_flow">推送学习流</option><option value="targeted_practice">专项练习</option><option value="notify_teacher">通知教师</option><option value="knowledge_supplement">补充知识库</option></select></div><div class="admin-field"><label>教学问题 ID</label><input class="admin-input" name="teaching_issue_id" type="number"></div><div class="admin-field is-wide"><label>干预内容</label><textarea class="admin-textarea" name="content"></textarea></div></div>`,
    create_evaluation: `<div class="admin-form-grid"><div class="admin-field"><label>评测集名称</label><input class="admin-input" name="name" required></div><div class="admin-field"><label>领域</label><input class="admin-input" name="domain"></div><div class="admin-field"><label>发布门槛</label><input class="admin-input" type="number" name="passing_score" min="0" max="100" value="60"></div><div class="admin-field is-wide"><label>说明</label><textarea class="admin-textarea" name="description"></textarea></div><div class="admin-field is-wide"><label>首个评测问题</label><textarea class="admin-textarea" name="case_prompt" required></textarea></div><div class="admin-field is-wide"><label>确定性期望文本</label><input class="admin-input" name="expected_text" required><small>真实模型输出包含此文本时判定通过，不生成随机评分。</small></div></div>`,
    create_experiment: `<div class="admin-form-grid"><div class="admin-field is-wide"><label>实验名称</label><input class="admin-input" name="name" required></div><div class="admin-field"><label>目标类型</label><select class="admin-select" name="target_type"><option value="agent">Agent</option><option value="model">模型</option><option value="workflow">学习流</option></select></div><div class="admin-field"><label>目标 ID</label><input class="admin-input" type="number" name="target_id"></div><div class="admin-field is-wide"><label>成功指标 JSON</label><textarea class="admin-textarea" name="success_metric_json">{"metric":"success_rate"}</textarea></div></div>`,
    calculate: `<div class="admin-form-grid"><div class="admin-field"><label>教学班 ID</label><input class="admin-input" type="number" name="teaching_class_id" required></div><div class="admin-field"><label>课程 ID</label><input class="admin-input" type="number" name="course_id" required></div></div>`,
    create_asset: `<div class="admin-form-grid"><div class="admin-field"><label>资产标题</label><input class="admin-input" name="title" required></div><div class="admin-field"><label>资产类型</label><select class="admin-select" name="asset_type"><option value="quality_answer">优质回答</option><option value="teaching_case">教学案例</option><option value="prompt">提示词</option><option value="learning_flow">学习流资产</option></select></div><div class="admin-field"><label>来源类型</label><input class="admin-input" name="source_type" value="manual"></div><div class="admin-field"><label>来源轨迹 ID</label><input class="admin-input" type="number" name="source_trace_id"></div><div class="admin-field is-wide"><label>内容 JSON</label><textarea class="admin-textarea" name="content_json" required>{"content":""}</textarea></div></div>`,
    compute: `<div class="admin-form-grid"><div class="admin-field"><label>学生用户 ID</label><input class="admin-input" type="number" name="student_user_id" required></div><div class="admin-field"><label>课程 ID（可选）</label><input class="admin-input" type="number" name="course_id"></div></div>`,
    resolve: `<div class="admin-form-grid"><div class="admin-field"><label>处理结果</label><select class="admin-select" name="status"><option value="resolved">已处置</option><option value="confirmed">确认风险</option><option value="false_positive">误报</option></select></div><div class="admin-field is-wide"><label>处理意见</label><textarea class="admin-textarea" name="resolution" required></textarea></div></div>`,
    knowledge_resolve: `<div class="admin-form-grid"><div class="admin-field"><label>处理结果</label><select class="admin-select" name="status"><option value="resolved">已解决</option><option value="ignored">忽略并记录</option></select></div><div class="admin-field is-wide"><label>处理意见</label><textarea class="admin-textarea" name="resolution" required></textarea></div></div>`,
    run: `<div class="admin-form-grid"><div class="admin-field"><label>Agent ID</label><input class="admin-input" type="number" name="agent_config_id" required></div><div class="admin-field"><label>模型 ID（可选）</label><input class="admin-input" type="number" name="model_config_id"></div><div class="admin-field"><label>最大输出 Token</label><input class="admin-input" type="number" name="max_output_tokens" value="800" min="1"></div></div>`,
    experiment_status: `<div class="admin-form-grid"><div class="admin-field"><label>目标状态</label><select class="admin-select" name="status"><option value="published">发布</option><option value="running">开始运行</option><option value="paused">暂停</option><option value="terminated">终止</option><option value="rolled_back">回滚并停用</option></select></div><div class="admin-field is-wide"><label>变更说明</label><textarea class="admin-textarea" name="reason" required></textarea></div></div>`,
    simulate: `<div class="admin-form-grid"><div class="admin-field"><label>干预类型</label><select class="admin-select" name="intervention_type"><option value="targeted_learning_flow">定向学习流</option><option value="targeted_practice">专项练习</option><option value="teacher_support">教师辅导</option></select></div><div class="admin-field is-wide"><label>参数 JSON</label><textarea class="admin-textarea" name="parameters_json">{}</textarea></div></div>`,
    asset_status: `<div class="admin-form-grid"><div class="admin-field"><label>审核动作</label><select class="admin-select" name="action"><option value="submit_review">提交审核</option><option value="approve">审核通过</option><option value="reject">审核拒绝</option><option value="publish">发布</option><option value="offline">下架</option></select></div><div class="admin-field is-wide"><label>审核意见</label><textarea class="admin-textarea" name="reason" required></textarea></div></div>`,
  }
  if (action === 'validate') return runGovernanceAction(module, 'validate', { template_id: Number(id) })
  if (action === 'publish') return runGovernanceAction(module, 'publish', { evaluation_set_id: Number(id) })
  const key = action === 'create' && module === 'evaluations' ? 'create_evaluation' : action === 'create' && module === 'experiments' ? 'create_experiment' : action === 'create' && module === 'assets' ? 'create_asset' : action
  const formKey = action === 'status' && module === 'experiments' ? 'experiment_status' : action === 'status' && module === 'assets' ? 'asset_status' : action === 'resolve' && module === 'knowledge-health' ? 'knowledge_resolve' : key
  const formContent = forms[formKey]
  if (formContent == null) {
    notifyAdmin('该操作尚未完成恢复验收，已保持隔离。', true)
    return null
  }
  openAdminDrawer({ title: META[module].primary || META[module].secondary || '治理操作', content: formContent, onSubmit: async (formData) => {
    const data = Object.fromEntries(formData.entries())
    for (const field of ['teaching_issue_id','passing_score','target_id','teaching_class_id','course_id','source_trace_id','student_user_id','agent_config_id','model_config_id','max_output_tokens']) if (data[field]) data[field] = Number(data[field]); else delete data[field]
    if (module === 'evaluations' && action === 'create') { data.cases = [{ case_key: `case_${Date.now()}`, title: '首个评测案例', input_json: { prompt: data.case_prompt }, expected_json: { expected_text: data.expected_text } }]; delete data.case_prompt; delete data.expected_text }
    if (module === 'experiments' && action === 'create') { data.success_metric_json = parseJsonField(data.success_metric_json, '成功指标'); data.variants = [{ variant_key: 'control', name: '对照组', is_control: true, allocation_bp: 5000, configuration_json: {} }, { variant_key: 'treatment', name: '实验组', allocation_bp: 5000, configuration_json: {} }] }
    if (module === 'assets' && action === 'create') data.content_json = parseJsonField(data.content_json, '资产内容')
    if (action === 'simulate') { data.snapshot_id = Number(id); data.parameters_json = parseJsonField(data.parameters_json, '模拟参数') }
    if (module === 'teaching-issues' && id) data.teaching_issue_id = Number(id)
    if (module === 'knowledge-health' && action === 'resolve') data.issue_id = Number(id)
    if (module === 'risks') data.event_id = Number(id)
    if (module === 'evaluations' && action === 'run') data.evaluation_set_id = Number(id)
    if (module === 'experiments' && action === 'status') data.experiment_id = Number(id)
    if (module === 'assets' && action === 'status') data.asset_id = Number(id)
    const apiAction = module === 'teaching-issues' ? 'create-intervention' : module === 'evaluations' || module === 'experiments' || module === 'assets' ? 'create' : action
    const resolvedAction = ['run','status','simulate','resolve'].includes(action) ? action : apiAction
    const result = await runGovernanceAction(module, resolvedAction, data); notifyAdmin(result.data?.data_status === 'insufficient_data' ? '样本不足，未生成确定性画像' : '操作已真实写入数据库'); await load(module); return true
  } })
}

async function load(module) {
  const root = document.getElementById('admin-governance-root'); if (!root) return
  root.innerHTML = '<div class="admin-skeleton" aria-label="正在加载"></div>'
  try {
    const [overviewResult, listResult] = await Promise.all([getGovernanceOverview(module), getGovernanceList(module, { page: 1, page_size: 20 })])
    const overview = overviewResult?.data
    if (!overview || typeof overview !== 'object' || Array.isArray(overview)) throw new Error('治理概览接口未返回受支持的数据结构')
    if (!listResult?.data || !Array.isArray(listResult.data.list)) throw new Error('治理列表接口尚未返回受支持的数据结构，该模块保持恢复隔离')
    const list = listResult.data.list
    const metrics = Object.entries(overview).filter(([key, value]) => LABELS[key] && (typeof value === 'number' || value == null)).slice(0, 8)
    const metricsHTML = metrics.length
      ? `<div class="admin-metric-grid">${metrics.map(([key, value], index) => `<article class="admin-metric-card" style="--metric-color:${['#7C3AED','#2563EB','#0F9F8F','#D97706'][index % 4]}"><div class="admin-metric-label">${LABELS[key]}</div><div class="admin-metric-value">${formatMetric(value, metricKind(key))}</div><div class="admin-metric-context">${value == null ? '当前真实数据不足' : '来自当前接口响应'}</div></article>`).join('')}</div>`
      : emptyHTML('概览指标暂不可用', '接口没有返回该恢复模块支持的真实指标字段。')
    const totalValue = Number(listResult.data.total)
    const total = Number.isFinite(totalValue) ? totalValue : list.length
    root.innerHTML = `${metricsHTML}<section class="admin-card"><div class="admin-card-header"><div><h3>治理记录</h3><p>恢复视图仅显示前 ${list.length} 条；数据库共 ${total} 条，分页尚未验收。</p></div></div>${listHTML(module, list)}</section>`
    root.querySelectorAll('[data-row-action]').forEach((button) => button.addEventListener('click', async () => { const id = button.closest('tr').dataset.id; if (['resolve','publish'].includes(button.dataset.rowAction) && !(await confirmAdmin({ title: '确认治理操作', message: '该操作会更新真实业务状态并写入操作审计。', confirmLabel: '确认继续', danger: module === 'risks' }))) return; try { const result = actionDialog(module, button.dataset.rowAction, id); if (result instanceof Promise) { setBusy(button, true); await result; notifyAdmin(button.dataset.rowAction === 'validate' ? '结构校验完成' : '状态已更新'); await load(module) } } catch (error) { notifyAdmin(error.message, true); setBusy(button, false) } }))
  } catch (error) {
    root.innerHTML = `<div class="admin-error" role="alert"><div><strong>治理模块保持恢复隔离</strong><p>${escapeHtml(error?.message || '请求失败，请稍后重试。')}</p><button class="admin-button is-secondary" id="retry-governance-load" type="button">重新加载</button></div></div>`
    document.getElementById('retry-governance-load')?.addEventListener('click', () => load(module))
  }
}

export function governanceRenderer(module) {
  return async function render(app) {
    const user = await requireAdminUser(); if (!user) return; const meta = META[module]
    if (!meta) {
      renderAdminPage(app, { user, title: '恢复隔离模块', contentHTML: '<div class="admin-error"><div><strong>不支持的治理模块</strong><p>当前路由没有对应的已验证恢复配置。</p></div></div>' })
      return
    }
    renderAdminPage(app, { user, title: meta.title, contentHTML: `<div class="admin-page"><div class="admin-page-header"><div><h2>${meta.title}</h2><p>${meta.desc}</p></div><div class="admin-header-actions">${meta.primary ? `<button class="admin-button" id="governance-primary">${meta.primary}</button>` : ''}${meta.secondary ? `<button class="admin-button is-secondary" id="governance-secondary">${meta.secondary}</button>` : ''}<button class="admin-button is-secondary" id="governance-refresh">刷新</button></div></div><div class="admin-recovery-isolation" role="status"><strong>恢复隔离 · 有限功能</strong><p>${RECOVERY_LIMITATION}</p></div><div id="admin-governance-root"><div class="admin-skeleton"></div></div></div>` })
    document.getElementById('governance-refresh').addEventListener('click', () => load(module)); document.getElementById('governance-primary')?.addEventListener('click', async (event) => { const action = meta.primaryAction; if (['scan','detect'].includes(action)) { setBusy(event.currentTarget, true); try { const result = await runGovernanceAction(module, action, {}); const count = result?.data?.issues_created ?? result?.data?.documents_scanned ?? result?.data?.groups_scanned; notifyAdmin(count == null ? '扫描请求已完成，接口未返回数量' : `扫描完成：${count}`); await load(module) } catch (error) { notifyAdmin(error.message, true); setBusy(event.currentTarget, false) } } else actionDialog(module, action) }); document.getElementById('governance-secondary')?.addEventListener('click', () => actionDialog(module, 'create-intervention'))
    await load(module)
  }
}

export const renderAdminLearningFlows = governanceRenderer('learning-flows')
export const renderAdminKnowledgeHealth = governanceRenderer('knowledge-health')
export const renderAdminTeachingIssues = governanceRenderer('teaching-issues')
export const renderAdminEvaluations = governanceRenderer('evaluations')
export const renderAdminExperiments = governanceRenderer('experiments')
export const renderAdminDigitalTwin = governanceRenderer('digital-twin')
export const renderAdminAssets = governanceRenderer('assets')
export const renderAdminStrategyProfiles = governanceRenderer('strategy-profiles')
export const renderAdminRisks = governanceRenderer('risks')
