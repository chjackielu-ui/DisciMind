const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createProviderAdapter,
  isRetryableError,
  normalizeProviderError,
  parseStructuredJson,
} = require('../src/modules/ai/provider.adapter');
const dify = require('../src/modules/dify/dify.service');

function provider(overrides = {}) {
  return {
    provider_code: `gateway_test_${Math.random()}`,
    provider_type: 'openai_compatible',
    base_url: 'https://provider.example/v1',
    auth_type: 'bearer',
    timeout_ms: 1000,
    max_retries: 2,
    extra_config_json: { circuit_failure_threshold: 10 },
    ...overrides,
  };
}

test('AI gateway retries 429 with bounded jitter and returns non-empty chat content', async () => {
  let attempts = 0;
  const delays = [];
  const adapter = createProviderAdapter(provider(), { api_key: 'test-key' }, {
    random: () => 0.5,
    sleep: async (ms) => delays.push(ms),
    http: async () => {
      attempts += 1;
      if (attempts < 3) throw { response: { status: 429, headers: {}, data: { code: 'Throttling.RateQuota' } } };
      return { status: 200, data: { choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 2 } } };
    },
  });
  const result = await adapter.chat({ model: 'test', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(result.content, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [350, 600]);
});

test('AI gateway does not retry authentication failures and exposes a safe normalized error', async () => {
  let attempts = 0;
  const adapter = createProviderAdapter(provider(), { api_key: 'test-key' }, {
    sleep: async () => assert.fail('401 must not be retried'),
    http: async () => { attempts += 1; throw { response: { status: 401, data: { message: 'secret upstream detail' } } }; },
  });
  await assert.rejects(() => adapter.chat({ model: 'test', messages: [{ role: 'user', content: 'hello' }] }), (error) => {
    assert.equal(error.publicCode, 'AI_AUTH_FAILED');
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /secret upstream detail/);
    return true;
  });
  assert.equal(attempts, 1);
});

test('AI gateway rejects empty chat, incomplete embeddings and malformed structured JSON', async () => {
  const empty = createProviderAdapter(provider({ max_retries: 0 }), { api_key: 'test-key' }, { http: async () => ({ status: 200, data: { choices: [] } }) });
  await assert.rejects(() => empty.chat({ model: 'test', messages: [] }), (error) => error.publicCode === 'AI_EMPTY_RESPONSE');

  const missingEmbedding = createProviderAdapter(provider({ max_retries: 0 }), { api_key: 'test-key' }, { http: async () => ({ status: 200, data: { data: [{ embedding: [0.1, 0.2] }] } }) });
  await assert.rejects(() => missingEmbedding.embed({ model: 'embed', input: ['a', 'b'] }), (error) => error.publicCode === 'AI_INVALID_EMBEDDING');
  assert.deepEqual(parseStructuredJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => parseStructuredJson('not-json'), (error) => error.publicCode === 'AI_INVALID_JSON');
});

test('AI gateway classifies temporary network and Bailian quota failures as retryable', () => {
  assert.equal(isRetryableError({ code: 'ECONNRESET' }), true);
  assert.equal(isRetryableError({ message: 'SSL EOF occurred in violation of protocol' }), true);
  assert.equal(isRetryableError({ response: { status: 400, data: { code: 'Throttling.RateQuota' } } }), true);
  assert.equal(normalizeProviderError({ response: { status: 429, data: {} } }, 'qwen').publicCode, 'AI_RATE_LIMITED');
});

test('retired Dify service cannot create clients or issue outbound calls', async () => {
  assert.throws(() => dify.createClient(), (error) => error.status === 410 && error.publicCode === 'DIFY_RETIRED');
  assert.throws(() => dify.chat(), (error) => error.status === 410 && error.publicCode === 'DIFY_RETIRED');
  assert.deepEqual(await dify.health(), {
    configured: false,
    healthy: false,
    retired: true,
    migratedTo: 'LANGCHAIN_LANGGRAPH',
  });
});
