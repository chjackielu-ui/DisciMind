const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const prisma = require('../src/config/prisma');
const aiConfig = require('../src/services/admin-ai-config.service');
const governance = require('../src/services/admin-governance.service');
const { encryptSecret, decryptSecret, redact } = require('../src/services/admin-secret.service');
const { PERMISSIONS, getUserPermissions } = require('../src/services/admin-permission.service');
const schemas = require('../src/services/admin-ai-config.schemas');
const { createProviderAdapter } = require('../src/modules/ai/provider.adapter');
const providerConfig = require('../src/services/ai-provider-config.service');

const created = { providerId: null, modelId: null, agentId: null, experimentId: null, assetId: null };
let req;

test.before(async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { user_id: true, role: true } });
  assert.ok(admin, 'admin seed user is required');
  req = { user: admin, id: `admin-test-${crypto.randomUUID()}`, ip: '127.0.0.1' };
});

test.after(async () => {
  if (created.assetId) {
    await prisma.aiTeachingAssetReview.deleteMany({ where: { asset_id: created.assetId } });
    await prisma.aiTeachingAssetVersion.deleteMany({ where: { asset_id: created.assetId } });
    await prisma.aiTeachingAsset.deleteMany({ where: { id: created.assetId } });
  }
  if (created.experimentId) {
    await prisma.aiRolloutAssignment.deleteMany({ where: { experiment_id: created.experimentId } });
    await prisma.aiExperimentVariant.deleteMany({ where: { experiment_id: created.experimentId } });
    await prisma.aiExperiment.deleteMany({ where: { id: created.experimentId } });
  }
  if (created.agentId) {
    await prisma.adminAgentVersion.deleteMany({ where: { agent_config_id: created.agentId } });
    await prisma.aiAgentConfig.deleteMany({ where: { agent_config_id: created.agentId } });
  }
  if (created.modelId) await prisma.aiModelConfig.deleteMany({ where: { ai_model_config_id: created.modelId } });
  if (created.providerId) await prisma.aiProvider.deleteMany({ where: { id: created.providerId } });
  await prisma.operationLog.deleteMany({ where: { request_id: req?.id } });
  await prisma.$disconnect();
});

test('AES-GCM secret storage decrypts correctly and redaction removes sensitive fields', () => {
  const encrypted = encryptSecret({ api_key: 'sk-unit-test-123456', app_id: 'app-1' });
  assert.notEqual(encrypted.secret_ciphertext, 'sk-unit-test-123456');
  assert.deepEqual(decryptSecret(encrypted), { api_key: 'sk-unit-test-123456', app_id: 'app-1' });
  const clean = redact({ authorization: 'Bearer secret-token', nested: { apiKey: 'secret', url: 'https://example.test?a=1&token=hidden' } });
  assert.equal(clean.authorization, '[REDACTED]');
  assert.equal(clean.nested.apiKey, '[REDACTED]');
  assert.match(clean.nested.url, /\[REDACTED\]/);
});

test('provider schemas separate secrets and adapters expose the complete unified contract', () => {
  const providerPayload = {
    provider_code: 'contract_test', display_name: '契约测试', provider_type: 'custom',
    base_url: 'https://example.test/v1', auth_type: 'bearer', enabled: true,
    timeout_ms: 5000, max_retries: 0, extra_config_json: { headers: { 'X-Tenant': 'discimind' } },
  };
  assert.equal(schemas.providerInput.safeParse(providerPayload).success, true);
  assert.equal(schemas.providerInput.safeParse({ ...providerPayload, api_key: 'must-not-be-here' }).success, false);
  assert.equal(schemas.providerInput.safeParse({ ...providerPayload, extra_config_json: { headers: { Authorization: 'Bearer plaintext' } } }).success, false);
  assert.equal(schemas.providerSecretInput.safeParse({}).success, false);
  assert.equal(schemas.providerSecretInput.safeParse({ api_key: 'sk-contract' }).success, true);
  assert.equal(schemas.providerSecretClear.safeParse({ confirm: true }).success, true);

  const adapter = createProviderAdapter(providerPayload, { api_key: 'sk-adapter-contract' });
  for (const operation of ['testConnection', 'listModels', 'chat', 'streamChat', 'embed', 'rerank', 'healthCheck', 'normalizeError', 'getCapabilities']) {
    assert.equal(typeof adapter[operation], 'function', `missing adapter operation ${operation}`);
  }
  assert.deepEqual(new Set(adapter.getCapabilities()), new Set(['models', 'chat', 'stream', 'embedding', 'rerank', 'health']));
});

test('legacy environment fallback keeps provider credentials isolated by provider code', () => {
  const originalQwen = process.env.QWEN_API_KEY;
  const originalBailian = process.env.BAILIAN_API_KEY;
  try {
    process.env.QWEN_API_KEY = '';
    process.env.BAILIAN_API_KEY = 'bailian-only-test-value';
    assert.equal(providerConfig.configuredEnvSecret('qwen'), null);
    assert.deepEqual(providerConfig.configuredEnvSecret('bailian'), { api_key: 'bailian-only-test-value' });
  } finally {
    if (originalQwen === undefined) delete process.env.QWEN_API_KEY; else process.env.QWEN_API_KEY = originalQwen;
    if (originalBailian === undefined) delete process.env.BAILIAN_API_KEY; else process.env.BAILIAN_API_KEY = originalBailian;
  }
});

test('explicit super-admin assignment receives the complete permission catalog', async () => {
  const permissions = await getUserPermissions(req.user.user_id, req.user.role);
  assert.deepEqual(new Set(permissions), new Set(PERMISSIONS));
  assert.equal(permissions.includes('admin.ai.secrets.manage'), true);
  assert.equal(permissions.includes('admin.risks.manage'), true);
});

test('provider, model and agent support secure lifecycle, publish and rollback', async () => {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const provider = await aiConfig.createProvider({
    provider_code: `test_${suffix}`, display_name: '自动化测试供应商', provider_type: 'openai_compatible',
    base_url: 'https://example.test/v1', auth_type: 'bearer', enabled: true,
    timeout_ms: 5000, max_retries: 0, extra_config_json: {},
  }, req);
  created.providerId = provider.id;
  assert.equal(provider.secret_configured, false);

  const replaced = await aiConfig.replaceProviderSecret(provider.id, { api_key: 'sk-automation-secret' }, req);
  assert.equal(replaced.secret_configured, true);
  assert.equal(replaced.secret_last_four, 'cret');
  assert.equal(JSON.stringify(replaced).includes('sk-automation-secret'), false);

  const storedBefore = await prisma.aiProvider.findUnique({ where: { id: provider.id } });
  await assert.rejects(aiConfig.updateProvider(provider.id, { api_key: '' }, req), /独立的替换密钥操作/);
  await aiConfig.updateProvider(provider.id, { display_name: '自动化测试供应商（更新）' }, req);
  const storedAfter = await prisma.aiProvider.findUnique({ where: { id: provider.id } });
  assert.equal(storedAfter.secret_ciphertext, storedBefore.secret_ciphertext, 'empty secret input must not overwrite ciphertext');
  assert.equal(JSON.stringify(storedAfter).includes('sk-automation-secret'), false);

  const auditRows = await prisma.operationLog.findMany({ where: { request_id: req.id } });
  assert.equal(JSON.stringify(auditRows).includes('sk-automation-secret'), false);

  const model = await aiConfig.createModel({
    provider_id: provider.id, model_code: `model-${suffix}`, display_name: '自动化测试模型', model_type: 'chat',
    capabilities_json: {}, max_context_length: 8192, max_output_tokens: 1024,
    supports_stream: true, supports_tools: false, supports_vision: false, supports_audio: false, supports_embedding: false, supports_rerank: false,
    input_price: null, output_price: null, currency: 'CNY', enabled: true, is_default: true,
    parameters_json: {}, usage_type: 'QA', temperature: 0.2,
  }, req);
  created.modelId = model.id;
  assert.equal((await aiConfig.getModel(model.id)).created_by, Number(req.user.user_id));
  assert.equal((await aiConfig.setModelEnabled(model.id, false, req)).enabled, false);
  assert.equal((await aiConfig.setModelEnabled(model.id, true, req)).enabled, true);
  await aiConfig.setDefaultModel(model.id, req);

  const agent = await aiConfig.createAgent({
    agent_key: `agent_${suffix}`, agent_type: 'COURSE_QA', agent_name: '自动化测试 Agent',
    description: '验证发布与回滚闭环', runtime_type: 'model_direct', provider_id: provider.id,
    model_config_id: model.id, status: 'draft', enabled: true, timeout_ms: 5000,
    max_retries: 0, max_output_tokens: 512, knowledge_config_json: {}, tool_config_json: {}, runtime_config_json: { temperature: 0.2 },
  }, req);
  created.agentId = agent.id;
  const firstPublish = await aiConfig.publishAgent(agent.id, req);
  assert.equal(firstPublish.status, 'published');
  assert.equal(firstPublish.published_version.version_number, 1);
  const rollback = await aiConfig.rollbackAgent(agent.id, firstPublish.published_version.id, req);
  assert.equal(rollback.published_version.version_number, 2);
  assert.equal(rollback.published_version.rollback_from_id, firstPublish.published_version.id);

  await aiConfig.clearProviderSecret(provider.id, req);
  const cleared = await prisma.aiProvider.findUnique({ where: { id: provider.id } });
  assert.equal(cleared.secret_ciphertext, null);
  assert.equal(cleared.secret_iv, null);
  assert.equal(cleared.secret_auth_tag, null);
});

test('experiment assignments are stable and lifecycle changes are audited', async () => {
  const experiment = await governance.runAction('experiments', 'create', {
    name: '自动化灰度实验', target_type: 'agent', target_id: created.agentId,
    success_metric_json: { metric: 'completion_rate' },
    variants: [
      { variant_key: 'control', name: '对照组', is_control: true, allocation_bp: 5000, configuration_json: {} },
      { variant_key: 'treatment', name: '实验组', is_control: false, allocation_bp: 5000, configuration_json: { temperature: 0.3 } },
    ],
  }, req);
  created.experimentId = experiment.id;
  await governance.runAction('experiments', 'status', { experiment_id: experiment.id, status: 'running', reason: '自动化验证' }, req);
  const first = await governance.runAction('experiments', 'assign', { experiment_id: experiment.id, user_id: req.user.user_id }, req);
  const second = await governance.runAction('experiments', 'assign', { experiment_id: experiment.id, user_id: req.user.user_id }, req);
  assert.equal(first.variant_id, second.variant_id);
  assert.equal(first.assignment_hash, second.assignment_hash);
  const paused = await governance.runAction('experiments', 'status', { experiment_id: experiment.id, status: 'paused', reason: '自动停止' }, req);
  assert.equal(paused.status, 'paused');
});

test('teaching assets have persisted versions and review/publish state', async () => {
  const asset = await governance.runAction('assets', 'create', {
    title: '自动化教学资产', asset_type: 'teaching_case', source_type: 'test',
    content_json: { content: '仅用于验证持久化、审核与发布流程。' },
  }, req);
  created.assetId = asset.id;
  assert.equal(asset.versions.length, 1);
  await governance.runAction('assets', 'status', { asset_id: asset.id, action: 'approve', reason: '自动化审核通过' }, req);
  const published = await governance.runAction('assets', 'status', { asset_id: asset.id, action: 'publish', reason: '自动化发布' }, req);
  assert.equal(published.status, 'published');
  assert.ok(published.published_at);
  assert.equal(await prisma.aiTeachingAssetReview.count({ where: { asset_id: asset.id } }), 2);
});

test('digital twin simulation refuses an insufficient real sample', async () => {
  const snapshot = await prisma.digitalTwinSnapshot.create({ data: {
    teaching_class_id: 999999, course_id: 999999, range_start: new Date(Date.now() - 86400000), range_end: new Date(),
    sample_size: 2, calculation_method: 'test_insufficient_sample', confidence: null,
    mastery_matrix_json: [], data_quality_json: { status: 'insufficient_data' },
  } });
  try {
    await assert.rejects(
      governance.runAction('digital-twin', 'simulate', { snapshot_id: snapshot.id, intervention_type: 'targeted_practice' }, req),
      /样本少于 5/,
    );
  } finally {
    await prisma.digitalTwinSnapshot.delete({ where: { id: snapshot.id } });
  }
});
