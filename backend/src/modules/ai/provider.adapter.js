const axios = require('axios');
const { safeError } = require('../../services/admin-secret.service');

const SUPPORTED_PROVIDER_TYPES = Object.freeze([
  'bailian', 'qwen', 'deepseek', 'spark', 'dify', 'openai_compatible', 'custom',
]);

function cleanBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) throw Object.assign(new Error('供应商 Base URL 必须使用 HTTP 或 HTTPS'), { code: 40001 });
  return text;
}

function safeCustomHeaders(provider) {
  const source = provider.extra_config_json?.headers;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => !/authorization|api[_-]?key|api[_-]?secret|token|secret|password|cookie/i.test(key) && typeof value === 'string')
    .map(([key, value]) => [key, value.slice(0, 2000)]));
}

function authHeaders(provider, secret = {}) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...safeCustomHeaders(provider) };
  if (provider.auth_type === 'none') return headers;
  const token = secret.api_key || secret.token;
  if (!token) throw Object.assign(new Error('供应商密钥未配置'), { code: 40001 });
  if (provider.auth_type === 'api_key_header') headers['X-API-Key'] = token;
  else headers.Authorization = `Bearer ${token}`;
  return headers;
}

function createProviderAdapter(provider, secret = {}) {
  const type = String(provider.provider_type || 'openai_compatible').toLowerCase();
  if (!SUPPORTED_PROVIDER_TYPES.includes(type)) throw Object.assign(new Error('不支持的 AI 供应商类型'), { code: 40001 });
  const baseUrl = cleanBaseUrl(provider.base_url);
  const timeout = Math.min(120000, Math.max(1000, Number(provider.timeout_ms) || Number(process.env.AI_PROVIDER_HEALTHCHECK_TIMEOUT_MS) || 10000));
  const retries = Math.min(5, Math.max(0, Number(provider.max_retries) || 0));
  const headers = authHeaders(provider, secret);

  async function request(config) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await axios({
          timeout, headers, maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 300,
          ...config,
        });
      } catch (error) {
        lastError = error;
        if (attempt < retries && (!error.response || error.response.status >= 500)) continue;
        break;
      }
    }
    const safe = safeError(lastError);
    throw Object.assign(new Error(safe.message), { code: 50201, provider_status: safe.status, provider_code: safe.code });
  }

  function openAiChatPayload({ model, messages, maxTokens = 64, temperature = 0.2, stream = false }) {
    return { model, messages, max_tokens: maxTokens, temperature, stream };
  }

  function difyChatPayload({ messages, stream = false }) {
    const lastUserMessage = [...(messages || [])].reverse().find((item) => item?.role === 'user');
    return {
      inputs: provider.extra_config_json?.inputs || {},
      query: String(lastUserMessage?.content || ''),
      response_mode: stream ? 'streaming' : 'blocking',
      user: String(provider.extra_config_json?.user || 'discimind-admin').slice(0, 255),
    };
  }

  async function testConnection() {
    const started = Date.now();
    const path = type === 'dify' ? '/parameters' : '/models';
    const response = await request({ method: 'GET', url: `${baseUrl}${path}` });
    return { ok: true, latency_ms: Date.now() - started, status: response.status };
  }

  async function listModels() {
    if (type === 'dify') return [];
    const response = await request({ method: 'GET', url: `${baseUrl}/models` });
    return Array.isArray(response.data?.data)
      ? response.data.data.map((item) => ({ id: String(item.id || ''), owned_by: item.owned_by || null })).filter((item) => item.id)
      : [];
  }

  async function chat(options) {
    const started = Date.now();
    const dify = type === 'dify';
    const response = await request({
      method: 'POST',
      url: `${baseUrl}${dify ? '/chat-messages' : '/chat/completions'}`,
      data: dify ? difyChatPayload(options) : openAiChatPayload(options),
    });
    return {
      ok: true,
      latency_ms: Date.now() - started,
      content: String((dify ? response.data?.answer : response.data?.choices?.[0]?.message?.content) || '').slice(0, 2_000_000),
      usage: response.data?.usage || response.data?.metadata?.usage || null,
    };
  }

  async function* streamChat(options) {
    const dify = type === 'dify';
    const response = await request({
      method: 'POST', responseType: 'stream',
      url: `${baseUrl}${dify ? '/chat-messages' : '/chat/completions'}`,
      data: dify ? difyChatPayload({ ...options, stream: true }) : openAiChatPayload({ ...options, stream: true }),
    });
    let buffer = '';
    for await (const chunk of response.data) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const raw = line.replace(/^data:\s*/, '').trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const event = JSON.parse(raw);
          const content = dify ? (event.answer || '') : (event.choices?.[0]?.delta?.content || '');
          if (content) yield { content: String(content), event: event.event || null };
        } catch { /* Ignore provider keep-alive frames. */ }
      }
    }
  }

  async function embed({ model, input }) {
    if (type === 'dify') throw Object.assign(new Error('Dify 供应商不提供统一 Embedding 接口'), { code: 40001 });
    const started = Date.now();
    const response = await request({ method: 'POST', url: `${baseUrl}/embeddings`, data: { model, input } });
    return {
      ok: true, latency_ms: Date.now() - started,
      embeddings: Array.isArray(response.data?.data) ? response.data.data.map((item) => item.embedding).filter(Array.isArray) : [],
      usage: response.data?.usage || null,
    };
  }

  async function rerank({ model, query, documents, topN }) {
    if (type === 'dify') throw Object.assign(new Error('Dify 供应商不提供统一 Rerank 接口'), { code: 40001 });
    const started = Date.now();
    const response = await request({
      method: 'POST', url: `${baseUrl}/rerank`,
      data: { model, query, documents, ...(topN ? { top_n: topN } : {}) },
    });
    return {
      ok: true, latency_ms: Date.now() - started,
      results: Array.isArray(response.data?.results) ? response.data.results : (Array.isArray(response.data?.data) ? response.data.data : []),
      usage: response.data?.usage || null,
    };
  }

  function getCapabilities() {
    if (type === 'dify') return ['chat', 'stream', 'workflow', 'chatflow', 'health'];
    return ['models', 'chat', 'stream', 'embedding', 'rerank', 'health'];
  }

  return {
    testConnection,
    listModels,
    chat,
    streamChat,
    embed,
    rerank,
    healthCheck: testConnection,
    normalizeError: safeError,
    getCapabilities,
  };
}

module.exports = { createProviderAdapter, cleanBaseUrl, authHeaders, SUPPORTED_PROVIDER_TYPES };
