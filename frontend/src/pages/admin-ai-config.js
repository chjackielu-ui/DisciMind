import {
  getAiProviders, createAiProvider, updateAiProvider, testAiProvider, setAiProviderEnabled, replaceAiProviderSecret, clearAiProviderSecret,
  getAiModels, createAiModel, updateAiModel, testAiModel, setAiModelEnabled, setDefaultAiModel,
  getAdminAgents, getAdminAgent, createAdminAgent, updateAdminAgent, testAdminAgent, publishAdminAgent, rollbackAdminAgent,
  getAdminEnvironmentStatus,
} from '../api/admin.js'
import { requireAdminUser, renderAdminPage, notifyAdmin, setBusy, statusBadge, openAdminDrawer, confirmAdmin, parseJsonField, emptyHTML, escapeHtml, getIcon } from '../utils/admin-ui.js'
import { formatDate } from '../utils/format.js'
import { loadAdminAccess, hasAdminPermission } from '../utils/admin-access.js'

const state = { providers: [], models: [], agents: [], environment: null, access: null, tab: 'providers', modelProviderId: null, warnings: [] }
const providerTypeLabel = { bailian: '阿里云百炼', qwen: '通义千问', deepseek: 'DeepSeek', spark: '讯飞星火', openai_compatible: 'OpenAI 兼容', dify: 'Dify', custom: '自定义' }
const sourceLabel = { database: '数据库', environment: '环境变量', mixed: '数据库 + 环境回退', default: '系统安全默认' }
const can = (permission) => hasAdminPermission(state.access, permission)
const compactDate = (value) => value ? formatDate(value).replace(/^\d{4}-/, '') : '尚未检测'

function providerMark(type) {
  const paths = type === 'dify' ? '<path d="M7 5h10l4 7-4 7H7l-4-7 4-7Z"/><path d="m9 9 6 6m0-6-6 6"/>' : type === 'spark' ? '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>' : '<circle cx="12" cy="12" r="9"/><path d="M7 13c3-7 7-7 10 0M8 16h8"/>'
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${paths}</svg>`
}

function providerCards() {
  if (!state.providers.length) return emptyHTML('暂无供应商', '新增供应商后可配置真实模型与 Agent。')
  return `<div class="admin-provider-grid">${state.providers.map((item) => `<article class="admin-provider-card" data-provider-id="${item.id}">
    <header><span class="admin-provider-mark">${providerMark(item.provider_type)}</span><div><h3>${escapeHtml(item.display_name)}</h3><p>${escapeHtml(providerTypeLabel[item.provider_type] || item.provider_type)}</p></div>${statusBadge(item.enabled ? item.connection_status : 'disabled')}</header>
    <dl><div><dt>配置来源</dt><dd>${escapeHtml(sourceLabel[item.source_type] || item.source_type)}</dd></div><div><dt>模型数量</dt><dd>${item.model_count}</dd></div><div><dt>密钥状态</dt><dd>${item.secret_configured ? `已配置${item.secret_last_four ? ` · ****${escapeHtml(item.secret_last_four)}` : ''}` : '未配置'}</dd></div><div><dt>平均延迟</dt><dd>${item.average_latency_ms == null ? '数据不足' : `${item.average_latency_ms} ms`}</dd></div><div><dt>最近检测</dt><dd title="${escapeHtml(item.last_checked_at ? formatDate(item.last_checked_at) : '尚未检测')}">${escapeHtml(compactDate(item.last_checked_at))}</dd></div><div><dt>启用状态</dt><dd>${item.enabled ? '已启用' : '已停用'}</dd></div></dl>
    <p class="admin-provider-url">${escapeHtml(item.base_url || '未设置 Base URL')}</p>
    <footer>${can('admin.ai.providers.manage') ? `<button class="admin-button is-secondary" data-action="edit-provider">编辑配置</button><button class="admin-button is-secondary" data-action="test-provider" ${item.enabled ? '' : 'disabled'}>测试连接</button><button class="admin-button is-ghost" data-action="toggle-provider">${item.enabled ? '停用' : '启用'}</button>` : ''}${can('admin.ai.models.view') ? '<button class="admin-button is-secondary" data-action="view-models">查看模型</button>' : ''}${can('admin.ai.secrets.manage') ? `<button class="admin-button is-secondary" data-action="replace-provider-secret">替换密钥</button>${item.secret_configured ? '<button class="admin-button is-danger" data-action="clear-provider">清除密钥</button>' : ''}` : ''}${can('admin.traces.view') ? '<button class="admin-button is-ghost" data-action="provider-logs">调用记录</button>' : ''}</footer>
  </article>`).join('')}</div>`
}

function modelTable() {
  if (!state.models.length) return emptyHTML('暂无模型', '选择供应商并新增真实模型配置。')
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>模型</th><th>供应商</th><th>类型</th><th>能力</th><th>上下文</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.models.map((model) => {
    const provider = state.providers.find((item) => item.id === model.provider_id)
    const caps = ['stream', 'tools', 'vision', 'audio', 'embedding', 'rerank'].filter((key) => model[`supports_${key}`]).join(' · ') || '基础对话'
    return `<tr data-model-id="${model.id}"><td><strong>${escapeHtml(model.display_name)}</strong><br><small>${escapeHtml(model.model_code)}</small></td><td>${escapeHtml(provider?.display_name || model.provider)}</td><td>${escapeHtml(model.model_type)}</td><td>${escapeHtml(caps)}</td><td>${model.context_window?.toLocaleString?.() || '数据不足'}</td><td>${statusBadge(model.enabled ? (model.is_default ? 'default' : 'enabled') : 'disabled')}</td><td><div class="admin-inline-actions">${can('admin.ai.models.manage') ? `<button class="admin-button is-secondary" data-action="edit-model">编辑</button><button class="admin-button is-secondary" data-action="test-model" ${model.enabled ? '' : 'disabled'}>测试</button><button class="admin-button is-ghost" data-action="toggle-model">${model.enabled ? '停用' : '启用'}</button><button class="admin-button is-ghost" data-action="default-model" ${model.is_default || !model.enabled ? 'disabled' : ''}>设为默认</button>` : '<span class="admin-help">只读</span>'}</div></td></tr>`
  }).join('')}</tbody></table></div>`
}

function agentTable() {
  if (!state.agents.length) return emptyHTML('暂无 Agent 配置', '新增 Agent 并绑定真实供应商和模型。')
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Agent</th><th>运行模式</th><th>供应商 / 模型</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.agents.map((agent) => {
    const provider = state.providers.find((item) => item.id === agent.provider_id); const model = state.models.find((item) => item.id === agent.model_id)
    return `<tr data-agent-id="${agent.id}"><td><strong>${escapeHtml(agent.name)}</strong><br><small>${escapeHtml(agent.agent_key || agent.agent_type)}</small></td><td>${escapeHtml(agent.runtime_type)}</td><td>${escapeHtml(provider?.display_name || '未绑定')}<br><small>${escapeHtml(model?.display_name || '未绑定模型')}</small></td><td>v${agent.version || 1}</td><td>${statusBadge(agent.enabled ? agent.status : 'disabled')}</td><td><div class="admin-inline-actions">${can('admin.agents.manage') ? '<button class="admin-button is-secondary" data-action="edit-agent">编辑</button><button class="admin-button is-secondary" data-action="test-agent">测试</button>' : ''}${can('admin.agents.publish') ? '<button class="admin-button" data-action="publish-agent">发布</button><button class="admin-button is-danger" data-action="rollback-agent">回滚</button>' : ''}${!can('admin.agents.manage') && !can('admin.agents.publish') ? '<span class="admin-help">只读</span>' : ''}</div></td></tr>`
  }).join('')}</tbody></table></div>`
}

function environmentPanel() {
  if (!state.environment) return '<div class="admin-skeleton"></div>'
  const entries = Object.entries(state.environment).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && 'configured' in value)
  const providers = Object.entries(state.environment.providers || {}).filter(([, value]) => value && typeof value === 'object').map(([key, value]) => [providerTypeLabel[key] || key, value])
  return `<div class="admin-grid-3">${[...entries, ...providers].map(([name, value]) => `<article class="admin-card admin-environment-item"><div>${getIcon(value.available === false ? 'alert' : 'settings')}</div><h3>${escapeHtml(name.replaceAll('_', ' '))}</h3><p>${value.configured ? '已配置' : '未配置'}${'available' in value ? ` · ${value.available ? '可用' : '不可用'}` : ''}</p>${statusBadge(value.available === false ? 'unavailable' : value.configured ? 'available' : 'unchecked')}</article>`).join('')}</div><p class="admin-help">检测时间：${formatDate(state.environment.checked_at)}。页面仅展示状态，不返回任何真实路径、地址或密钥值。</p>`
}

function renderFrame(sectionHTML) {
  const root = document.getElementById('admin-ai-root'); if (!root) return
  const heading = state.tab === 'agents' ? '智能体运营与版本' : state.tab === 'environment' ? '密钥与环境' : state.tab === 'models' ? '模型管理' : '供应商配置'
  root.innerHTML = `<div class="admin-page-header"><div><h2>${heading}</h2><p>数据库启用配置优先于环境变量与安全默认值；密钥仅在后端使用 AES-256-GCM 保存，前端永不回显。</p></div><div class="admin-header-actions">${state.tab === 'providers' && can('admin.ai.providers.manage') ? '<button class="admin-button" id="add-provider">新增供应商</button>' : ''}${state.tab === 'models' && can('admin.ai.models.manage') ? '<button class="admin-button" id="add-model">新增模型</button>' : ''}${state.tab === 'agents' && can('admin.agents.manage') ? '<button class="admin-button" id="add-agent">新增 Agent</button>' : ''}<button class="admin-button is-secondary" id="reload-ai">刷新</button></div></div>
    ${state.tab === 'models' && state.modelProviderId ? `<div class="admin-load-warning" role="status"><strong>已按供应商筛选模型</strong><button class="admin-button is-ghost" type="button" id="clear-model-provider">清除筛选</button></div>` : ''}
    ${state.warnings.length ? `<div class="admin-load-warning" role="status"><strong>部分关联数据未加载</strong><ul>${state.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>` : ''}
    <section>${sectionHTML}</section>`
  bindContent()
}

function renderContent() {
  renderFrame(state.tab === 'providers' ? providerCards() : state.tab === 'models' ? modelTable() : state.tab === 'agents' ? agentTable() : environmentPanel())
}

function arrayData(result, label) {
  if (!Array.isArray(result?.data)) throw new Error(`${label}接口未返回受支持的数据结构`)
  return result.data
}

function warningFrom(label, reason) {
  return `${label}：${reason?.message || '请求失败'}`
}

function renderLoadError(error) {
  renderFrame(`<div class="admin-error" role="alert"><div><strong>当前配置页加载失败</strong><p>${escapeHtml(error?.message || '请求失败，请稍后重试。')}</p><button class="admin-button is-secondary" id="retry-ai-load" type="button">重新加载</button></div></div>`)
  document.getElementById('retry-ai-load')?.addEventListener('click', () => loadData())
}

async function loadData() {
  const root = document.getElementById('admin-ai-root'); if (!root) return
  root.innerHTML = '<div class="admin-skeleton" aria-label="正在加载"></div>'
  state.warnings = []
  try {
    if (state.tab === 'providers') {
      state.providers = arrayData(await getAiProviders(), '供应商')
    } else if (state.tab === 'models') {
      const [modelsResult, providersResult] = await Promise.allSettled([getAiModels(state.modelProviderId ? { provider_id: state.modelProviderId } : undefined), getAiProviders()])
      if (modelsResult.status === 'rejected') throw modelsResult.reason
      state.models = arrayData(modelsResult.value, '模型')
      if (providersResult.status === 'fulfilled') {
        try { state.providers = arrayData(providersResult.value, '供应商') } catch (error) { state.providers = []; state.warnings.push(warningFrom('供应商名称', error)) }
      } else {
        state.providers = []
        state.warnings.push(warningFrom('供应商名称', providersResult.reason))
      }
    } else if (state.tab === 'agents') {
      const [agentsResult, providersResult, modelsResult] = await Promise.allSettled([getAdminAgents(), getAiProviders(), getAiModels()])
      if (agentsResult.status === 'rejected') throw agentsResult.reason
      state.agents = arrayData(agentsResult.value, 'Agent')
      if (providersResult.status === 'fulfilled') {
        try { state.providers = arrayData(providersResult.value, '供应商') } catch (error) { state.providers = []; state.warnings.push(warningFrom('供应商绑定', error)) }
      } else {
        state.providers = []
        state.warnings.push(warningFrom('供应商绑定', providersResult.reason))
      }
      if (modelsResult.status === 'fulfilled') {
        try { state.models = arrayData(modelsResult.value, '模型') } catch (error) { state.models = []; state.warnings.push(warningFrom('模型绑定', error)) }
      } else {
        state.models = []
        state.warnings.push(warningFrom('模型绑定', modelsResult.reason))
      }
    } else {
      state.environment = null
      const result = await getAdminEnvironmentStatus()
      if (!result?.data || typeof result.data !== 'object') throw new Error('环境状态接口未返回受支持的数据结构')
      state.environment = result.data
    }
    renderContent()
    return true
  } catch (error) {
    renderLoadError(error)
    return false
  }
}

function providerForm(item = {}) {
  const config = item.extra_config_json || {}
  return `<div class="admin-form-grid"><div class="admin-field"><label>供应商类型 <span class="required">*</span></label><select class="admin-select" name="provider_type" required>${Object.entries(providerTypeLabel).map(([value, label]) => `<option value="${value}" ${item.provider_type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="admin-field"><label>显示名称 <span class="required">*</span></label><input class="admin-input" name="display_name" value="${escapeHtml(item.display_name || '')}" required maxlength="160"></div>${item.id ? '' : '<div class="admin-field"><label>配置代码 <span class="required">*</span></label><input class="admin-input" name="provider_code" required pattern="[a-z0-9][a-z0-9_-]*" placeholder="custom_provider"></div>'}<div class="admin-field is-wide"><label>Base URL <span class="required">*</span></label><input class="admin-input" name="base_url" type="url" value="${escapeHtml(item.base_url || '')}" required placeholder="https://api.example.com/v1"></div><div class="admin-field"><label>认证方式</label><select class="admin-select" name="auth_type"><option value="bearer">Bearer Token</option><option value="api_key_header" ${item.auth_type === 'api_key_header' ? 'selected' : ''}>X-API-Key</option><option value="none" ${item.auth_type === 'none' ? 'selected' : ''}>无认证</option></select></div><div class="admin-field"><label>超时（毫秒）</label><input class="admin-input" name="timeout_ms" type="number" min="1000" max="120000" value="${item.timeout_ms || 10000}"></div><div class="admin-field"><label>重试次数</label><input class="admin-input" name="max_retries" type="number" min="0" max="5" value="${item.max_retries ?? 1}"></div><div class="admin-field is-wide"><label>自定义请求头 JSON</label><textarea class="admin-textarea" name="headers_json">${escapeHtml(JSON.stringify(config.headers || {}, null, 2))}</textarea><small class="admin-help">禁止在此填写 Authorization、API Key、Token 或 Secret。</small></div><div class="admin-field is-wide"><label>自定义参数 JSON</label><textarea class="admin-textarea" name="parameters_json">${escapeHtml(JSON.stringify(config.parameters || {}, null, 2))}</textarea></div><div class="admin-field is-wide"><label><input type="checkbox" name="enabled" ${item.enabled !== false ? 'checked' : ''}> 立即启用</label></div></div>`
}

function openProvider(item) {
  openAdminDrawer({ title: item ? '编辑供应商' : '新增供应商', content: providerForm(item), onSubmit: async (data) => {
    const payload = Object.fromEntries(data.entries()); payload.enabled = data.has('enabled'); payload.timeout_ms = Number(payload.timeout_ms); payload.max_retries = Number(payload.max_retries); payload.extra_config_json = { headers: parseJsonField(payload.headers_json, '自定义请求头'), parameters: parseJsonField(payload.parameters_json, '自定义参数') }; delete payload.headers_json; delete payload.parameters_json
    await (item ? updateAiProvider(item.id, payload) : createAiProvider(payload)); notifyAdmin(item ? '供应商已更新' : '供应商已创建；如需认证，请使用“替换密钥”独立配置'); await loadData(); return true
  } })
}

function providerSecretForm(item) {
  const type = item.provider_type
  const showApiSecret = ['spark', 'custom'].includes(type)
  const showAppId = ['spark', 'dify', 'custom'].includes(type)
  const showWorkspace = ['bailian', 'qwen', 'openai_compatible', 'custom'].includes(type)
  return `<p class="admin-help">当前为 ${escapeHtml(item.display_name)} 替换密钥。所有输入默认空白，提交后仅显示配置状态和最后四位。</p><div class="admin-form-grid"><div class="admin-field is-wide"><label>API Key / Token</label><input class="admin-input" name="api_key" type="password" autocomplete="new-password" maxlength="10000" placeholder="输入新的密钥"></div>${showApiSecret ? '<div class="admin-field"><label>API Secret</label><input class="admin-input" name="api_secret" type="password" autocomplete="new-password" maxlength="10000"></div>' : ''}${showAppId ? '<div class="admin-field"><label>App ID</label><input class="admin-input" name="app_id" type="password" autocomplete="new-password" maxlength="500"></div>' : ''}${showWorkspace ? '<div class="admin-field"><label>Workspace ID</label><input class="admin-input" name="workspace_id" type="password" autocomplete="new-password" maxlength="500"></div>' : ''}</div>`
}

function openProviderSecret(item) {
  openAdminDrawer({ title: '替换供应商密钥', submitLabel: '确认替换', content: providerSecretForm(item), onSubmit: async (data) => {
    const payload = Object.fromEntries([...data.entries()].filter(([, value]) => String(value).trim()).map(([key, value]) => [key, String(value).trim()]))
    if (!Object.keys(payload).length) throw new Error('至少填写一个密钥字段；空值不会覆盖现有密钥')
    await replaceAiProviderSecret(item.id, payload); notifyAdmin('供应商密钥已安全替换'); await loadData(); return true
  } })
}

function modelForm(item = {}) {
  return `<div class="admin-form-grid"><div class="admin-field"><label>供应商 <span class="required">*</span></label><select class="admin-select" name="provider_id" required>${state.providers.map((p) => `<option value="${p.id}" ${item.provider_id === p.id ? 'selected' : ''}>${escapeHtml(p.display_name)}</option>`).join('')}</select></div><div class="admin-field"><label>模型代码 <span class="required">*</span></label><input class="admin-input" name="model_code" value="${escapeHtml(item.model_code || '')}" required></div><div class="admin-field"><label>显示名称 <span class="required">*</span></label><input class="admin-input" name="display_name" value="${escapeHtml(item.display_name || '')}" required></div><div class="admin-field"><label>模型类型</label><select class="admin-select" name="model_type">${['chat','reasoning','embedding','rerank','vision','speech','image','workflow'].map((v) => `<option ${item.model_type === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="admin-field"><label>上下文窗口</label><input class="admin-input" name="max_context_length" type="number" min="1" value="${item.context_window || ''}"></div><div class="admin-field"><label>最大输出 Token</label><input class="admin-input" name="max_output_tokens" type="number" min="1" value="${item.max_output_tokens || ''}"></div><div class="admin-field is-wide"><label>能力</label><div class="admin-inline-actions">${['stream','tools','vision','audio','embedding','rerank'].map((key) => `<label><input type="checkbox" name="supports_${key}" ${item[`supports_${key}`] ? 'checked' : ''}> ${key}</label>`).join('')}</div></div><div class="admin-field is-wide"><label>参数 JSON</label><textarea class="admin-textarea" name="parameters_json">${escapeHtml(JSON.stringify(item.parameters_json || {}, null, 2))}</textarea></div><div class="admin-field"><label><input type="checkbox" name="enabled" ${item.enabled !== false ? 'checked' : ''}> 启用</label></div><div class="admin-field"><label><input type="checkbox" name="is_default" ${item.is_default ? 'checked' : ''}> 默认模型</label></div></div>`
}

function openModel(item) {
  openAdminDrawer({ title: item ? '编辑模型' : '新增模型', content: modelForm(item), onSubmit: async (data) => {
    const payload = Object.fromEntries(data.entries()); payload.provider_id = Number(payload.provider_id); payload.parameters_json = parseJsonField(payload.parameters_json, '模型参数'); ['max_context_length','max_output_tokens'].forEach((key) => payload[key] = payload[key] ? Number(payload[key]) : null); ['enabled','is_default','supports_stream','supports_tools','supports_vision','supports_audio','supports_embedding','supports_rerank'].forEach((key) => payload[key] = data.has(key)); payload.capabilities_json = {}; payload.currency = 'CNY'; payload.usage_type = 'QA'
    await (item ? updateAiModel(item.id, payload) : createAiModel(payload)); notifyAdmin(item ? '模型已更新' : '模型已创建'); await loadData(); return true
  } })
}

function agentForm(item = {}) {
  return `<div class="admin-form-grid">${item.id ? '' : '<div class="admin-field"><label>Agent Key <span class="required">*</span></label><input class="admin-input" name="agent_key" pattern="[a-z0-9][a-z0-9_-]*" required></div>'}<div class="admin-field"><label>名称 <span class="required">*</span></label><input class="admin-input" name="agent_name" value="${escapeHtml(item.name || '')}" required></div><div class="admin-field"><label>Agent 类型</label><select class="admin-select" name="agent_type">${['COURSE_QA','LEARNING_ANALYSIS','PERSONALIZED_RECOMMENDATION','QUESTION_GENERATION','DOCUMENT_SUMMARY','TRAINER','EXPLAINER','DIAGNOSTICIAN'].map((v) => `<option ${String(item.agent_type || '').toUpperCase() === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="admin-field"><label>运行模式</label><select class="admin-select" name="runtime_type">${['langgraph','self','dify_workflow','dify_chatflow','model_direct'].map((v) => `<option ${item.runtime_type === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="admin-field"><label>供应商</label><select class="admin-select" name="provider_id"><option value="">未绑定</option>${state.providers.map((p) => `<option value="${p.id}" ${item.provider_id === p.id ? 'selected' : ''}>${escapeHtml(p.display_name)}</option>`).join('')}</select></div><div class="admin-field"><label>模型</label><select class="admin-select" name="model_config_id"><option value="">未绑定</option>${state.models.map((m) => `<option value="${m.id}" ${item.model_id === m.id ? 'selected' : ''}>${escapeHtml(m.display_name)}</option>`).join('')}</select></div><div class="admin-field"><label>超时（毫秒）</label><input class="admin-input" name="timeout_ms" type="number" min="1000" value="${item.timeout_ms || 120000}"></div><div class="admin-field"><label>最大输出 Token</label><input class="admin-input" name="max_output_tokens" type="number" min="1" value="${item.max_output_tokens || 2048}"></div><div class="admin-field is-wide"><label>知识库绑定 JSON</label><textarea class="admin-textarea" name="knowledge_config_json">${escapeHtml(JSON.stringify(item.knowledge_config_json || {}, null, 2))}</textarea></div><div class="admin-field is-wide"><label>工具绑定 JSON</label><textarea class="admin-textarea" name="tool_config_json">${escapeHtml(JSON.stringify(item.tool_config_json || {}, null, 2))}</textarea></div><div class="admin-field is-wide"><label>运行参数 JSON</label><textarea class="admin-textarea" name="runtime_config_json">${escapeHtml(JSON.stringify(item.runtime_config_json || {}, null, 2))}</textarea></div><div class="admin-field"><label><input type="checkbox" name="enabled" ${item.enabled !== false ? 'checked' : ''}> 启用</label></div></div>`
}

function openAgent(item) {
  openAdminDrawer({ title: item ? '编辑 Agent' : '新增 Agent', content: agentForm(item), onSubmit: async (data) => {
    const payload = Object.fromEntries(data.entries()); payload.provider_id = payload.provider_id ? Number(payload.provider_id) : null; payload.model_config_id = payload.model_config_id ? Number(payload.model_config_id) : null; payload.timeout_ms = Number(payload.timeout_ms); payload.max_output_tokens = Number(payload.max_output_tokens); payload.max_retries = item?.max_retries ?? 1; payload.enabled = data.has('enabled'); payload.status = item?.status || 'draft'; ['knowledge_config_json','tool_config_json','runtime_config_json'].forEach((key) => payload[key] = parseJsonField(payload[key], key));
    await (item ? updateAdminAgent(item.id, payload) : createAdminAgent(payload)); notifyAdmin(item ? 'Agent 已更新' : 'Agent 已创建'); await loadData(); return true
  } })
}

async function openRollback(agent) {
  const detail = (await getAdminAgent(agent.id)).data
  if (!detail.versions?.length) throw new Error('当前 Agent 尚无可回滚的发布版本')
  openAdminDrawer({ title: '回滚 Agent 版本', submitLabel: '确认回滚', content: `<div class="admin-field"><label>目标版本记录</label><select class="admin-select" name="version_id" required>${detail.versions.map((version) => `<option value="${version.id}">v${version.version_number} · ${escapeHtml(version.status)} · ${formatDate(version.published_at || version.created_at)}</option>`).join('')}</select><small class="admin-help">系统不会覆盖历史版本，而会基于所选快照创建新的发布版本。</small></div>`, onSubmit: async (data) => { const confirmed = await confirmAdmin({ title: '确认回滚 Agent', message: '回滚会创建新的发布快照并记录完整操作审计。', confirmLabel: '确认回滚', danger: true }); if (!confirmed) return false; await rollbackAdminAgent(agent.id, Number(data.get('version_id'))); notifyAdmin('Agent 已回滚为新版本'); await loadData(); return true } })
}

function bindContent() {
  document.getElementById('reload-ai')?.addEventListener('click', () => loadData()); document.getElementById('add-provider')?.addEventListener('click', () => openProvider()); document.getElementById('add-model')?.addEventListener('click', () => openModel()); document.getElementById('add-agent')?.addEventListener('click', () => openAgent())
  document.getElementById('clear-model-provider')?.addEventListener('click', () => { window.location.hash = '#/admin/ai-config?tab=models' })
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const providerId = Number(button.closest('[data-provider-id]')?.dataset.providerId); const modelId = Number(button.closest('[data-model-id]')?.dataset.modelId); const agentId = Number(button.closest('[data-agent-id]')?.dataset.agentId); const action = button.dataset.action
    const provider = state.providers.find((item) => item.id === providerId); const model = state.models.find((item) => item.id === modelId); const agent = state.agents.find((item) => item.id === agentId)
    if (action === 'edit-provider') return openProvider(provider); if (action === 'replace-provider-secret') return openProviderSecret(provider); if (action === 'edit-model') return openModel(model); if (action === 'edit-agent') return openAgent(agent)
    if (action === 'view-models') { window.location.hash = `#/admin/ai-config?tab=models&provider_id=${providerId}`; return }
    if (action === 'provider-logs') { window.location.hash = '#/admin/traces'; return }
    if (action === 'clear-provider' && !(await confirmAdmin({ title: '清除供应商密钥', message: '数据库密钥将被永久清除；环境变量回退仍可能生效。', confirmLabel: '确认清除', danger: true }))) return
    if (action === 'publish-agent' && !(await confirmAdmin({ title: '发布 Agent 版本', message: '将创建不可变配置快照并切换为已发布状态。', confirmLabel: '确认发布' }))) return
    if (action === 'rollback-agent') {
      try { await openRollback(agent) } catch (error) { notifyAdmin(error.message, true) } return
    }
    setBusy(button, true)
    try {
      if (action === 'test-provider') await testAiProvider(providerId)
      if (action === 'toggle-provider') await setAiProviderEnabled(providerId, !provider.enabled)
      if (action === 'clear-provider') await clearAiProviderSecret(providerId)
      if (action === 'test-model') await testAiModel(modelId)
      if (action === 'toggle-model') await setAiModelEnabled(modelId, !model.enabled)
      if (action === 'default-model') await setDefaultAiModel(modelId)
      if (action === 'test-agent') await testAdminAgent(agentId)
      if (action === 'publish-agent') await publishAdminAgent(agentId)
      notifyAdmin('操作成功'); await loadData()
    } catch (error) { notifyAdmin(error.message, true); setBusy(button, false) }
  }))
}

export async function renderAdminAiConfig(app) {
  const user = await requireAdminUser(); if (!user) return
  state.access = await loadAdminAccess(user.user_id)
  const hash = window.location.hash
  const params = new URLSearchParams(String(hash).split('?')[1] || '')
  const requestedTab = params.get('tab')
  state.tab = hash.includes('/admin/agents') ? 'agents' : hash.includes('/admin/environment') ? 'environment' : ['providers', 'models'].includes(requestedTab) ? requestedTab : 'providers'
  state.modelProviderId = state.tab === 'models' && Number(params.get('provider_id')) > 0 ? Number(params.get('provider_id')) : null
  if (state.tab === 'providers' && !can('admin.ai.providers.view')) state.tab = can('admin.ai.models.view') ? 'models' : can('admin.agents.view') ? 'agents' : 'environment'
  if (state.tab === 'models' && !can('admin.ai.models.view')) state.tab = can('admin.ai.providers.view') ? 'providers' : 'environment'
  renderAdminPage(app, { user, title: state.tab === 'agents' ? '智能体运营' : state.tab === 'environment' ? '密钥与环境' : state.tab === 'models' ? '模型管理' : '供应商配置', contentHTML: '<div class="admin-page" id="admin-ai-root"><div class="admin-skeleton"></div></div>' })
  await loadData()
}
