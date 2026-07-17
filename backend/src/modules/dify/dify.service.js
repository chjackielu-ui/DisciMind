const { loadEnv } = require('../../config/env');
const { createProviderAdapter } = require('../ai/provider.adapter');

const MAX_QUERY_LENGTH = 50000;

function getConfig(options = {}) {
  loadEnv();
  const baseUrl = String(options.baseUrl || process.env.DIFY_API_BASE_URL || '').trim();
  const apiKey = String(options.apiKey || process.env.DIFY_API_KEY || '').trim();
  if (!baseUrl || !apiKey) throw Object.assign(new Error('Dify 通用应用尚未完成配置'), { code: 50301, status: 503, publicCode: 'DIFY_NOT_CONFIGURED', retryable: false, expose: true });
  return {
    baseUrl,
    apiKey,
    timeoutMs: Number(options.timeoutMs || process.env.DIFY_TIMEOUT_MS || 120000),
    maxRetries: Number(options.maxRetries ?? process.env.DIFY_MAX_RETRIES ?? 2),
  };
}

function createClient(options = {}) {
  const config = getConfig(options);
  return createProviderAdapter({
    provider_code: 'dify_default', provider_type: 'dify', base_url: config.baseUrl,
    auth_type: 'bearer', timeout_ms: config.timeoutMs, max_retries: config.maxRetries,
    extra_config_json: { max_concurrency: Number(process.env.DIFY_MAX_CONCURRENCY || 8) },
  }, { api_key: config.apiKey }, options.runtime);
}

function normalizeQuery(value) {
  const query = String(value || '').trim();
  if (!query) throw Object.assign(new Error('Dify 对话内容不能为空'), { code: 40001, expose: true });
  if (query.length > MAX_QUERY_LENGTH) throw Object.assign(new Error(`Dify 对话内容不能超过 ${MAX_QUERY_LENGTH} 字`), { code: 40001, expose: true });
  return query;
}

function userKey(user) {
  const id = Number(user?.user_id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('无法获取当前用户身份'), { code: 40101, status: 401, expose: true });
  return `discimind-${String(user.role || 'user').toLowerCase()}-${id}`;
}

function chatOptions(user, body = {}, signal) {
  return {
    messages: [{ role: 'user', content: normalizeQuery(body.query || body.message) }],
    inputs: body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs) ? body.inputs : {},
    conversationId: body.conversation_id || null,
    files: Array.isArray(body.files) ? body.files.slice(0, 10) : [],
    user: userKey(user),
    signal,
  };
}

async function chat(user, body, options = {}) {
  return (options.client || createClient(options)).chat(chatOptions(user, body, options.signal));
}

async function* streamChat(user, body, options = {}) {
  yield* (options.client || createClient(options)).streamChat(chatOptions(user, body, options.signal));
}

async function workflow(user, body = {}, options = {}) {
  if (!body.inputs || typeof body.inputs !== 'object' || Array.isArray(body.inputs)) throw Object.assign(new Error('Workflow inputs 必须是对象'), { code: 40001, expose: true });
  return (options.client || createClient(options)).workflow({ inputs: body.inputs, user: userKey(user), signal: options.signal });
}

async function health(options = {}) {
  const configured = Boolean(String(process.env.DIFY_API_BASE_URL || '').trim() && String(process.env.DIFY_API_KEY || '').trim());
  if (!configured) return { configured: false, healthy: false, reason: 'not_configured' };
  try {
    const result = await (options.client || createClient(options)).healthCheck();
    return { configured: true, healthy: true, latency_ms: result.latency_ms };
  } catch (error) {
    return { configured: true, healthy: false, reason: error.publicCode || 'DIFY_UNAVAILABLE', retryable: Boolean(error.retryable) };
  }
}

module.exports = { getConfig, createClient, normalizeQuery, userKey, chat, streamChat, workflow, health };
