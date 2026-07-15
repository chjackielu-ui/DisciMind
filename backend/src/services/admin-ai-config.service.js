const crypto = require('crypto');
const prisma = require('../config/prisma');
const { loadEnv } = require('../config/env');
const { encryptSecret, redact, safeError } = require('./admin-secret.service');
const { recordAdminOperation } = require('./admin-audit.service');
const { createProviderAdapter } = require('../modules/ai/provider.adapter');
const providerConfig = require('./ai-provider-config.service');

loadEnv();

async function ensureEnvironmentProviders() {
  if (!providerConfig.environmentFallbackEnabled()) return;
  for (const definition of providerConfig.ENV_PROVIDERS) {
    const existing = await prisma.aiProvider.findUnique({ where: { provider_code: definition.provider_code } });
    if (!existing) {
      await prisma.aiProvider.create({ data: {
        provider_code: definition.provider_code,
        display_name: definition.display_name,
        provider_type: definition.provider_type,
        base_url: providerConfig.environmentBaseUrl(definition.provider_code), auth_type: 'bearer', enabled: true,
        source_type: 'environment', timeout_ms: Number(process.env.AI_PROVIDER_HEALTHCHECK_TIMEOUT_MS) || 10000,
      } });
    }
  }
}

function providerPublic(provider, aggregate = {}) {
  const metadata = providerConfig.secretMetadata(provider);
  return {
    id: provider.id, provider_code: provider.provider_code, display_name: provider.display_name,
    provider_type: provider.provider_type, base_url: provider.base_url, auth_type: provider.auth_type,
    enabled: provider.enabled, connection_status: provider.connection_status,
    last_checked_at: provider.last_checked_at, last_latency_ms: provider.last_latency_ms,
    timeout_ms: provider.timeout_ms, max_retries: provider.max_retries,
    extra_config_json: redact(provider.extra_config_json || {}), source_type: metadata.source === 'default' ? provider.source_type : metadata.source,
    secret_configured: metadata.configured, secret_source: metadata.source,
    secret_last_four: metadata.last_four, secret_updated_at: metadata.updated_at,
    model_count: aggregate.model_count || 0,
    average_latency_ms: aggregate.average_latency_ms ?? provider.last_latency_ms ?? null,
    created_at: provider.created_at, updated_at: provider.updated_at,
  };
}

async function resolveProviderSecret(provider) {
  return providerConfig.resolveProviderSecret(provider);
}

async function listProviders() {
  if (providerConfig.databaseConfigEnabled()) await ensureEnvironmentProviders();
  const providers = await prisma.aiProvider.findMany({ orderBy: [{ enabled: 'desc' }, { display_name: 'asc' }] });
  const modelCounts = await prisma.aiModelConfig.groupBy({ by: ['provider_id'], _count: { ai_model_config_id: true }, where: { provider_id: { not: null } } });
  const countMap = new Map(modelCounts.map((item) => [item.provider_id, item._count.ai_model_config_id]));
  return providers.map((provider) => providerPublic(provider, { model_count: countMap.get(provider.id) || 0 }));
}

async function getProvider(id) {
  const provider = await prisma.aiProvider.findUnique({ where: { id: Number(id) } });
  if (!provider) throw Object.assign(new Error('AI 供应商不存在'), { code: 40401 });
  const modelCount = await prisma.aiModelConfig.count({ where: { provider_id: provider.id } });
  return providerPublic(provider, { model_count: modelCount });
}

function assertNoSecretFields(input) {
  const forbidden = ['api_key', 'api_secret', 'app_id', 'workspace_id'].filter((key) => Object.prototype.hasOwnProperty.call(input || {}, key));
  if (forbidden.length) throw Object.assign(new Error('密钥必须通过独立的替换密钥操作提交'), { code: 40001 });
}

async function createProvider(input, req) {
  assertNoSecretFields(input);
  const data = {
    provider_code: input.provider_code, display_name: input.display_name, provider_type: input.provider_type,
    base_url: input.base_url || null, auth_type: input.auth_type, enabled: input.enabled,
    timeout_ms: input.timeout_ms, max_retries: input.max_retries,
    extra_config_json: input.extra_config_json || {}, source_type: providerConfig.envDefinition(input.provider_code) ? 'environment' : 'database',
    created_by: Number(req.user.user_id), updated_by: Number(req.user.user_id),
  };
  const created = await prisma.aiProvider.create({ data });
  await recordAdminOperation({ req, operationType: 'CREATE_AI_PROVIDER', targetType: 'ai_provider', targetId: created.id, after: providerPublic(created) });
  return providerPublic(created);
}

async function updateProvider(id, input, req) {
  assertNoSecretFields(input);
  const current = await prisma.aiProvider.findUnique({ where: { id: Number(id) } });
  if (!current) throw Object.assign(new Error('AI 供应商不存在'), { code: 40401 });
  const allowed = ['display_name', 'provider_type', 'base_url', 'auth_type', 'enabled', 'timeout_ms', 'max_retries', 'extra_config_json'];
  const data = { updated_by: Number(req.user.user_id) };
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(input, key)) data[key] = input[key] === '' ? null : input[key];
  const updated = await prisma.aiProvider.update({ where: { id: current.id }, data });
  providerConfig.invalidateProviderConfig(current.id);
  await recordAdminOperation({ req, operationType: 'UPDATE_AI_PROVIDER', targetType: 'ai_provider', targetId: current.id, before: providerPublic(current), after: providerPublic(updated) });
  return providerPublic(updated);
}

async function replaceProviderSecret(id, secret, req) {
  const current = await prisma.aiProvider.findUnique({ where: { id: Number(id) } });
  if (!current) throw Object.assign(new Error('AI 供应商不存在'), { code: 40401 });
  const normalized = Object.fromEntries(Object.entries(secret).map(([key, value]) => [key, String(value).trim()]));
  const updated = await prisma.aiProvider.update({ where: { id: current.id }, data: {
    ...encryptSecret(normalized),
    source_type: providerConfig.configuredEnvSecret(current.provider_code) ? 'mixed' : 'database',
    updated_by: Number(req.user.user_id),
  } });
  providerConfig.invalidateProviderConfig(current.id);
  await recordAdminOperation({
    req, operationType: 'REPLACE_AI_PROVIDER_SECRET', targetType: 'ai_provider', targetId: current.id,
    before: { secret_configured: Boolean(current.secret_ciphertext), source: current.source_type },
    after: { secret_configured: true, source: updated.source_type, secret_last_four: updated.secret_last_four },
  });
  return providerPublic(updated);
}

async function setProviderEnabled(id, enabled, req) {
  const current = await prisma.aiProvider.findUnique({ where: { id: Number(id) } });
  if (!current) throw Object.assign(new Error('AI 供应商不存在'), { code: 40401 });
  const updated = await prisma.aiProvider.update({ where: { id: current.id }, data: { enabled, updated_by: Number(req.user.user_id) } });
  providerConfig.invalidateProviderConfig(current.id);
  await recordAdminOperation({ req, operationType: enabled ? 'ENABLE_AI_PROVIDER' : 'DISABLE_AI_PROVIDER', targetType: 'ai_provider', targetId: current.id, before: { enabled: current.enabled }, after: { enabled } });
  return providerPublic(updated);
}

async function clearProviderSecret(id, req) {
  const current = await prisma.aiProvider.findUnique({ where: { id: Number(id) } });
  if (!current) throw Object.assign(new Error('AI 供应商不存在'), { code: 40401 });
  const updated = await prisma.aiProvider.update({ where: { id: current.id }, data: {
    secret_ciphertext: null, secret_iv: null, secret_auth_tag: null, secret_last_four: null,
    secret_updated_at: new Date(), source_type: providerConfig.configuredEnvSecret(current.provider_code) ? 'environment' : 'database',
    updated_by: Number(req.user.user_id),
  } });
  providerConfig.invalidateProviderConfig(current.id);
  await recordAdminOperation({ req, operationType: 'CLEAR_AI_PROVIDER_SECRET', targetType: 'ai_provider', targetId: current.id, before: { secret_configured: Boolean(current.secret_ciphertext) }, after: { secret_configured: false } });
  return providerPublic(updated);
}

async function testProvider(id, req) {
  const provider = await prisma.aiProvider.findUnique({ where: { id: Number(id) } });
  if (!provider) throw Object.assign(new Error('AI 供应商不存在'), { code: 40401 });
  if (!provider.enabled) throw Object.assign(new Error('请先启用供应商再执行连接测试'), { code: 40001 });
  try {
    const runtime = await providerConfig.resolveProviderRuntime(provider);
    const result = await createProviderAdapter(runtime.provider, runtime.secret || {}).testConnection();
    await prisma.aiProvider.update({ where: { id: provider.id }, data: { connection_status: 'available', last_checked_at: new Date(), last_latency_ms: result.latency_ms } });
    await recordAdminOperation({ req, operationType: 'TEST_AI_PROVIDER', targetType: 'ai_provider', targetId: provider.id, after: { status: 'available', latency_ms: result.latency_ms } });
    return result;
  } catch (error) {
    const normalized = safeError(error);
    await prisma.aiProvider.update({ where: { id: provider.id }, data: { connection_status: 'unavailable', last_checked_at: new Date(), last_latency_ms: null } });
    await recordAdminOperation({ req, operationType: 'TEST_AI_PROVIDER', targetType: 'ai_provider', targetId: provider.id, success: false, failureReason: normalized.message });
    throw Object.assign(new Error(normalized.message), { code: error.code || 50201 });
  }
}

function modelPublic(model) {
  return {
    id: model.ai_model_config_id, provider_id: model.provider_id, provider: model.provider,
    model_code: model.model_code || model.model_name, model_name: model.model_name,
    display_name: model.display_name || model.model_name, model_type: model.model_type,
    capabilities_json: model.capabilities_json || {}, context_window: model.max_context_length,
    max_output_tokens: model.max_output_tokens, supports_stream: model.supports_stream,
    supports_tools: model.supports_tools, supports_vision: model.supports_vision,
    supports_audio: model.supports_audio, supports_embedding: model.supports_embedding,
    supports_rerank: model.supports_rerank,
    input_price: model.input_price == null ? null : Number(model.input_price),
    output_price: model.output_price == null ? null : Number(model.output_price),
    currency: model.currency, enabled: model.enabled, is_default: model.is_default,
    parameters_json: model.parameters_json || {}, usage_type: String(model.usage_type).toLowerCase(),
    created_by: model.created_by, updated_by: model.updated_by,
    created_at: model.created_at, updated_at: model.updated_at,
  };
}

async function listModels(query = {}) {
  const where = {};
  if (query.provider_id) where.provider_id = Number(query.provider_id);
  if (query.enabled !== undefined) where.enabled = String(query.enabled) === 'true';
  const models = await prisma.aiModelConfig.findMany({ where, orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }] });
  return models.map(modelPublic);
}

async function getModel(id) {
  const model = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: Number(id) } });
  if (!model) throw Object.assign(new Error('AI 模型不存在'), { code: 40401 });
  return modelPublic(model);
}

async function createModel(input, req) {
  const provider = await prisma.aiProvider.findUnique({ where: { id: input.provider_id } });
  if (!provider) throw Object.assign(new Error('AI 供应商不存在'), { code: 40401 });
  const created = await prisma.$transaction(async (tx) => {
    if (input.is_default) await tx.aiModelConfig.updateMany({ where: { provider_id: provider.id }, data: { is_default: false } });
    return tx.aiModelConfig.create({ data: {
      provider_id: provider.id, provider: provider.provider_code, model_name: input.model_code,
      model_code: input.model_code, display_name: input.display_name, model_type: input.model_type,
      capabilities_json: input.capabilities_json || {}, max_context_length: input.max_context_length,
      max_output_tokens: input.max_output_tokens, supports_stream: input.supports_stream,
      supports_tools: input.supports_tools, supports_vision: input.supports_vision,
      supports_audio: input.supports_audio, supports_embedding: input.supports_embedding,
      supports_rerank: input.supports_rerank,
      input_price: input.input_price, output_price: input.output_price, currency: input.currency,
      enabled: input.enabled, is_default: input.is_default, parameters_json: input.parameters_json || {},
      usage_type: input.usage_type, temperature: input.temperature,
      created_by: Number(req.user.user_id), updated_by: Number(req.user.user_id),
    } });
  });
  await recordAdminOperation({ req, operationType: 'CREATE_AI_MODEL', targetType: 'ai_model', targetId: created.ai_model_config_id, after: modelPublic(created) });
  return modelPublic(created);
}

async function updateModel(id, input, req) {
  const current = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: Number(id) } });
  if (!current) throw Object.assign(new Error('AI 模型不存在'), { code: 40401 });
  const data = { ...input, updated_by: Number(req.user.user_id) };
  if (input.model_code) data.model_name = input.model_code;
  if (input.provider_id) {
    const provider = await prisma.aiProvider.findUnique({ where: { id: input.provider_id } });
    if (!provider) throw Object.assign(new Error('AI 供应商不存在'), { code: 40401 });
    data.provider = provider.provider_code;
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (input.is_default) await tx.aiModelConfig.updateMany({ where: { provider_id: input.provider_id || current.provider_id, ai_model_config_id: { not: current.ai_model_config_id } }, data: { is_default: false } });
    return tx.aiModelConfig.update({ where: { ai_model_config_id: current.ai_model_config_id }, data });
  });
  await recordAdminOperation({ req, operationType: 'UPDATE_AI_MODEL', targetType: 'ai_model', targetId: current.ai_model_config_id, before: modelPublic(current), after: modelPublic(updated) });
  return modelPublic(updated);
}

async function setDefaultModel(id, req) {
  return updateModel(id, { is_default: true }, req);
}

async function setModelEnabled(id, enabled, req) {
  const current = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: Number(id) } });
  if (!current) throw Object.assign(new Error('AI 模型不存在'), { code: 40401 });
  const updated = await prisma.aiModelConfig.update({
    where: { ai_model_config_id: current.ai_model_config_id },
    data: { enabled, is_default: enabled ? current.is_default : false, updated_by: Number(req.user.user_id) },
  });
  await recordAdminOperation({
    req, operationType: enabled ? 'ENABLE_AI_MODEL' : 'DISABLE_AI_MODEL', targetType: 'ai_model', targetId: current.ai_model_config_id,
    before: { enabled: current.enabled, is_default: current.is_default }, after: { enabled: updated.enabled, is_default: updated.is_default },
  });
  return modelPublic(updated);
}

async function testModel(id, req) {
  const model = await prisma.aiModelConfig.findUnique({ where: { ai_model_config_id: Number(id) }, include: { provider_config: true } });
  if (!model?.provider_config) throw Object.assign(new Error('模型或供应商不存在'), { code: 40401 });
  if (!model.enabled || !model.provider_config.enabled) throw Object.assign(new Error('请先启用模型及其供应商再执行测试'), { code: 40001 });
  const runtime = await providerConfig.resolveProviderRuntime(model.provider_config);
  const adapter = createProviderAdapter(runtime.provider, runtime.secret || {});
  const modelCode = model.model_code || model.model_name;
  let result;
  if (model.model_type === 'embedding') result = await adapter.embed({ model: modelCode, input: ['连接测试'] });
  else if (model.model_type === 'rerank') result = await adapter.rerank({ model: modelCode, query: '连接测试', documents: ['连接测试'] });
  else if (model.model_type === 'workflow') result = await adapter.healthCheck();
  else if (['chat', 'reasoning', 'vision'].includes(model.model_type)) result = await adapter.chat({
    model: modelCode, messages: [{ role: 'user', content: '请仅回复“连接正常”。' }], maxTokens: 32,
  });
  else throw Object.assign(new Error(`当前适配器尚不支持 ${model.model_type} 模型测试`), { code: 40001 });
  await recordAdminOperation({ req, operationType: 'TEST_AI_MODEL', targetType: 'ai_model', targetId: model.ai_model_config_id, after: { ok: true, latency_ms: result.latency_ms } });
  return result;
}

function agentPublic(agent) {
  return {
    id: agent.agent_config_id, agent_key: agent.agent_key, agent_type: String(agent.agent_type).toLowerCase(),
    name: agent.agent_name, description: agent.description, runtime_type: agent.runtime_type,
    provider_id: agent.provider_id, model_id: agent.model_config_id, base_url_override: agent.base_url_override,
    workflow_id: agent.dify_workflow_id, app_id: agent.dify_app_id,
    enabled: agent.enabled, status: agent.status, version: agent.version,
    timeout_ms: agent.timeout_ms, max_retries: agent.max_retries, max_output_tokens: agent.max_output_tokens,
    knowledge_config_json: agent.knowledge_config_json || {}, tool_config_json: agent.tool_config_json || {},
    runtime_config_json: agent.runtime_config_json || {}, published_at: agent.published_at,
    created_at: agent.created_at, updated_at: agent.updated_at,
  };
}

async function listAgents() {
  const agents = await prisma.aiAgentConfig.findMany({ orderBy: [{ enabled: 'desc' }, { updated_at: 'desc' }] });
  return agents.map(agentPublic);
}

async function getAgent(id) {
  const agent = await prisma.aiAgentConfig.findUnique({ where: { agent_config_id: Number(id) }, include: { versions: { orderBy: { version_number: 'desc' }, take: 20 } } });
  if (!agent) throw Object.assign(new Error('Agent 不存在'), { code: 40401 });
  return { ...agentPublic(agent), versions: agent.versions };
}

function agentData(input, userId) {
  const data = { ...input, updated_by: Number(userId) };
  if (data.agent_type) data.agent_type = String(data.agent_type).toUpperCase();
  if (Object.prototype.hasOwnProperty.call(data, 'model_config_id')) data.model_config_id = data.model_config_id || null;
  if (Object.prototype.hasOwnProperty.call(data, 'provider_id')) data.provider_id = data.provider_id || null;
  return data;
}

async function createAgent(input, req) {
  const data = agentData(input, req.user.user_id);
  data.created_by = Number(req.user.user_id);
  const created = await prisma.aiAgentConfig.create({ data });
  await recordAdminOperation({ req, operationType: 'CREATE_ADMIN_AGENT', targetType: 'ai_agent', targetId: created.agent_config_id, after: agentPublic(created) });
  return agentPublic(created);
}

async function updateAgent(id, input, req) {
  const current = await prisma.aiAgentConfig.findUnique({ where: { agent_config_id: Number(id) } });
  if (!current) throw Object.assign(new Error('Agent 不存在'), { code: 40401 });
  const updated = await prisma.aiAgentConfig.update({ where: { agent_config_id: current.agent_config_id }, data: agentData(input, req.user.user_id) });
  await recordAdminOperation({ req, operationType: 'UPDATE_ADMIN_AGENT', targetType: 'ai_agent', targetId: current.agent_config_id, before: agentPublic(current), after: agentPublic(updated) });
  return agentPublic(updated);
}

async function testAgent(id, req) {
  const agent = await prisma.aiAgentConfig.findUnique({ where: { agent_config_id: Number(id) }, include: { model_config: { include: { provider_config: true } } } });
  if (!agent?.model_config?.provider_config) throw Object.assign(new Error('Agent 尚未绑定可测试的供应商和模型'), { code: 40001 });
  const runtime = await providerConfig.resolveProviderRuntime(agent.model_config.provider_config);
  const result = await createProviderAdapter(runtime.provider, runtime.secret || {}).chat({ model: agent.model_config.model_code || agent.model_config.model_name, messages: [{ role: 'user', content: '执行健康检查，仅回复“Agent 正常”。' }], maxTokens: Math.min(agent.max_output_tokens || 32, 64) });
  await recordAdminOperation({ req, operationType: 'TEST_ADMIN_AGENT', targetType: 'ai_agent', targetId: agent.agent_config_id, after: { ok: true, latency_ms: result.latency_ms } });
  return result;
}

async function publishAgent(id, req) {
  const current = await prisma.aiAgentConfig.findUnique({ where: { agent_config_id: Number(id) } });
  if (!current) throw Object.assign(new Error('Agent 不存在'), { code: 40401 });
  if (!current.provider_id || !current.model_config_id) throw Object.assign(new Error('发布前必须绑定供应商和模型'), { code: 40001 });
  const result = await prisma.$transaction(async (tx) => {
    const latest = await tx.adminAgentVersion.findFirst({ where: { agent_config_id: current.agent_config_id }, orderBy: { version_number: 'desc' } });
    const nextVersion = (latest?.version_number || 0) + 1;
    const version = await tx.adminAgentVersion.create({ data: {
      agent_config_id: current.agent_config_id, version_number: nextVersion, status: 'published',
      model_config_id: current.model_config_id, prompt_version_id: current.prompt_version_id,
      knowledge_snapshot: current.knowledge_config_json || {}, tool_snapshot: current.tool_config_json || {},
      parameter_snapshot: current.runtime_config_json || {}, created_by: Number(req.user.user_id),
      published_by: Number(req.user.user_id), published_at: new Date(),
    } });
    const agent = await tx.aiAgentConfig.update({ where: { agent_config_id: current.agent_config_id }, data: { status: 'published', version: nextVersion, published_at: new Date(), updated_by: Number(req.user.user_id) } });
    return { agent, version };
  });
  await recordAdminOperation({ req, operationType: 'PUBLISH_ADMIN_AGENT', targetType: 'ai_agent', targetId: current.agent_config_id, before: { status: current.status, version: current.version }, after: { status: 'published', version: result.version.version_number } });
  return { ...agentPublic(result.agent), published_version: result.version };
}

async function rollbackAgent(id, versionId, req) {
  const current = await prisma.aiAgentConfig.findUnique({ where: { agent_config_id: Number(id) } });
  const source = await prisma.adminAgentVersion.findFirst({ where: { id: Number(versionId), agent_config_id: Number(id) } });
  if (!current || !source) throw Object.assign(new Error('Agent 或回滚版本不存在'), { code: 40401 });
  const result = await prisma.$transaction(async (tx) => {
    const latest = await tx.adminAgentVersion.findFirst({ where: { agent_config_id: current.agent_config_id }, orderBy: { version_number: 'desc' } });
    const nextVersion = (latest?.version_number || 0) + 1;
    const agent = await tx.aiAgentConfig.update({ where: { agent_config_id: current.agent_config_id }, data: {
      model_config_id: source.model_config_id, prompt_version_id: source.prompt_version_id,
      knowledge_config_json: source.knowledge_snapshot, tool_config_json: source.tool_snapshot,
      runtime_config_json: source.parameter_snapshot, version: nextVersion, status: 'published',
      published_at: new Date(), updated_by: Number(req.user.user_id),
    } });
    const version = await tx.adminAgentVersion.create({ data: {
      agent_config_id: current.agent_config_id, version_number: nextVersion, status: 'published',
      model_config_id: source.model_config_id, prompt_version_id: source.prompt_version_id,
      knowledge_snapshot: source.knowledge_snapshot, tool_snapshot: source.tool_snapshot,
      parameter_snapshot: source.parameter_snapshot, rollback_from_id: source.id,
      created_by: Number(req.user.user_id), published_by: Number(req.user.user_id), published_at: new Date(),
    } });
    return { agent, version };
  });
  await recordAdminOperation({ req, operationType: 'ROLLBACK_ADMIN_AGENT', targetType: 'ai_agent', targetId: current.agent_config_id, before: { version: current.version }, after: { version: result.version.version_number, rollback_from: source.id } });
  return { ...agentPublic(result.agent), published_version: result.version };
}

function stableAssignment(experimentKey, salt, userId, variants) {
  const hash = crypto.createHash('sha256').update(`${experimentKey}:${salt}:${userId}`).digest('hex');
  const bucket = parseInt(hash.slice(0, 8), 16) % 10000;
  let cursor = 0;
  for (const variant of variants.filter((item) => item.enabled)) {
    cursor += variant.allocation_bp;
    if (bucket < cursor) return { variant, hash };
  }
  return { variant: variants.find((item) => item.is_control) || variants[0] || null, hash };
}

module.exports = {
  listProviders, getProvider, createProvider, updateProvider, replaceProviderSecret, setProviderEnabled, clearProviderSecret, testProvider,
  listModels, getModel, createModel, updateModel, setDefaultModel, setModelEnabled, testModel,
  listAgents, getAgent, createAgent, updateAgent, testAgent, publishAgent, rollbackAgent,
  resolveProviderSecret, stableAssignment, ensureEnvironmentProviders, providerPublic, modelPublic, agentPublic,
};
