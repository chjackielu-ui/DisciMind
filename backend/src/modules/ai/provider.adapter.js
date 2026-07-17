const axios = require('axios');
const { safeError } = require('../../services/admin-secret.service');

const SUPPORTED_PROVIDER_TYPES = Object.freeze([
  'bailian', 'qwen', 'deepseek', 'spark', 'dify', 'openai_compatible', 'custom',
]);
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH',
  'ENOTFOUND', 'EPIPE', 'ERR_NETWORK', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT',
]);
const circuitStates = new Map();

function cleanBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) throw Object.assign(new Error('供应商 Base URL 必须使用 HTTP 或 HTTPS'), { code: 40001, expose: true });
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
  if (!token) throw Object.assign(new Error('供应商密钥未配置'), { code: 40001, expose: true });
  if (provider.auth_type === 'api_key_header') headers['X-API-Key'] = token;
  else headers.Authorization = `Bearer ${token}`;
  return headers;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function providerPath(value, fallback = null) {
  const text = String(value || fallback || '').trim();
  if (!text) return null;
  if (!/^\/[a-z0-9/_-]+$/i.test(text) || text.includes('..') || text.startsWith('//')) {
    throw Object.assign(new Error('供应商接口路径配置不合法'), { code: 40001, expose: true });
  }
  return text;
}

function stripMarkdownJsonFence(value) {
  return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseStructuredJson(value) {
  if (value && typeof value === 'object') return value;
  const raw = stripMarkdownJsonFence(value);
  const candidates = [raw];
  const objectStart = raw.indexOf('{');
  const objectEnd = raw.lastIndexOf('}');
  const arrayStart = raw.indexOf('[');
  const arrayEnd = raw.lastIndexOf(']');
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(raw.slice(objectStart, objectEnd + 1));
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(raw.slice(arrayStart, arrayEnd + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try the next safe candidate */ }
  }
  throw Object.assign(new Error('模型返回的结构化结果不是有效 JSON'), { code: 50201, publicCode: 'AI_INVALID_JSON', retryable: false, expose: true });
}

function upstreamCode(error) {
  return error?.response?.data?.code
    || error?.response?.data?.error?.code
    || error?.response?.data?.error_code
    || error?.code
    || null;
}

function isRetryableError(error) {
  if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') return false;
  const status = Number(error?.response?.status || 0);
  if (RETRYABLE_HTTP_STATUSES.has(status)) return true;
  const code = String(upstreamCode(error) || '').toUpperCase();
  if (RETRYABLE_NETWORK_CODES.has(code)) return true;
  const message = String(error?.message || '').toLowerCase();
  return /throttling\.ratequota|rate.?quota|ssl.*eof|socket hang up|connection reset|temporary failure|network error/.test(`${code} ${message}`.toLowerCase());
}

function normalizeProviderError(error, providerCode = null) {
  if (error?.publicCode?.startsWith('AI_')) return error;
  const status = Number(error?.response?.status || 0);
  const code = String(upstreamCode(error) || '').toUpperCase();
  const aborted = error?.name === 'AbortError' || error?.code === 'ERR_CANCELED';
  const timeout = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || /timeout/i.test(String(error?.message || ''));
  let publicCode = 'AI_UPSTREAM_UNAVAILABLE';
  let message = 'AI 服务暂时不可用，请稍后重试';
  let httpStatus = 502;
  let retryable = isRetryableError(error);
  if (aborted) { publicCode = 'AI_REQUEST_CANCELLED'; message = 'AI 请求已取消'; httpStatus = 499; retryable = false; }
  else if (timeout || status === 408) { publicCode = 'AI_TIMEOUT'; message = 'AI 请求超时，请重试'; httpStatus = 504; retryable = true; }
  else if (status === 401 || status === 403) { publicCode = 'AI_AUTH_FAILED'; message = 'AI 供应商鉴权失败，请联系管理员检查配置'; retryable = false; }
  else if (status === 404) { publicCode = 'AI_ENDPOINT_NOT_FOUND'; message = 'AI 模型或接口不存在，请联系管理员检查配置'; retryable = false; }
  else if (status === 429 || code.includes('THROTTLING') || code.includes('RATEQUOTA')) { publicCode = 'AI_RATE_LIMITED'; message = 'AI 服务请求过于频繁，请稍后重试'; httpStatus = 429; retryable = true; }
  else if (status >= 500) { publicCode = 'AI_UPSTREAM_UNAVAILABLE'; httpStatus = 502; retryable = true; }
  const normalized = Object.assign(new Error(message), {
    code: httpStatus === 429 ? 42901 : 50201,
    status: httpStatus,
    publicCode,
    retryable,
    expose: true,
    details: { provider: providerCode, upstreamStatus: status || null, upstreamCode: code || null },
  });
  return normalized;
}

function createLimiter(maxConcurrent, maxQueue) {
  let active = 0;
  const queue = [];
  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) { active += 1; next(release); }
  };
  return function acquire() {
    if (active < maxConcurrent) { active += 1; return Promise.resolve(release); }
    if (queue.length >= maxQueue) return Promise.reject(Object.assign(new Error('AI 并发队列已满，请稍后重试'), { code: 42901, status: 429, publicCode: 'AI_CONCURRENCY_LIMITED', retryable: true, expose: true }));
    return new Promise((resolve) => queue.push(resolve));
  };
}

function createProviderAdapter(provider, secret = {}, runtime = {}) {
  const type = String(provider.provider_type || 'openai_compatible').toLowerCase();
  if (!SUPPORTED_PROVIDER_TYPES.includes(type)) throw Object.assign(new Error('不支持的 AI 供应商类型'), { code: 40001, expose: true });
  const baseUrl = cleanBaseUrl(provider.base_url);
  const providerCode = String(provider.provider_code || type);
  const timeout = boundedInteger(provider.timeout_ms || process.env.AI_PROVIDER_TIMEOUT_MS, 30000, 1000, 120000);
  const totalTimeout = boundedInteger(provider.extra_config_json?.total_timeout_ms || process.env.AI_PROVIDER_TOTAL_TIMEOUT_MS, Math.min(240000, timeout * 3), timeout, 300000);
  const retries = boundedInteger(provider.max_retries, 2, 0, 4);
  const headers = authHeaders(provider, secret);
  const sleep = runtime.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = runtime.random || Math.random;
  const http = runtime.http || axios;
  const acquire = createLimiter(
    boundedInteger(provider.extra_config_json?.max_concurrency || process.env.AI_PROVIDER_MAX_CONCURRENCY, 8, 1, 64),
    boundedInteger(provider.extra_config_json?.max_queue || process.env.AI_PROVIDER_MAX_QUEUE, 64, 0, 1000),
  );
  const circuitKey = `${providerCode}:${baseUrl}`;
  const failureThreshold = boundedInteger(provider.extra_config_json?.circuit_failure_threshold, 5, 2, 20);
  const circuitCooldownMs = boundedInteger(provider.extra_config_json?.circuit_cooldown_ms, 30000, 1000, 300000);

  function circuit() {
    const state = circuitStates.get(circuitKey) || { failures: 0, openUntil: 0 };
    if (state.openUntil && state.openUntil <= Date.now()) { state.failures = 0; state.openUntil = 0; }
    circuitStates.set(circuitKey, state);
    return state;
  }

  async function request(config) {
    const state = circuit();
    if (state.openUntil > Date.now()) throw Object.assign(new Error('AI 供应商暂时熔断，请稍后重试'), { code: 50201, status: 503, publicCode: 'AI_CIRCUIT_OPEN', retryable: true, expose: true });
    const release = await acquire();
    const startedAt = Date.now();
    let lastError;
    try {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const remaining = totalTimeout - (Date.now() - startedAt);
        if (remaining <= 0) throw normalizeProviderError(Object.assign(new Error('total timeout'), { code: 'ETIMEDOUT' }), providerCode);
        try {
          const response = await http({
            timeout: Math.min(timeout, remaining), headers, maxRedirects: 0,
            maxBodyLength: 20 * 1024 * 1024, maxContentLength: 20 * 1024 * 1024,
            validateStatus: (status) => status >= 200 && status < 300,
            ...config,
          });
          state.failures = 0;
          return response;
        } catch (error) {
          lastError = error;
          if (attempt >= retries || !isRetryableError(error)) break;
          const retryAfter = Number(error?.response?.headers?.['retry-after']);
          const exponential = Math.min(4000, 250 * (2 ** attempt));
          const delay = Number.isFinite(retryAfter) && retryAfter >= 0
            ? Math.min(10000, retryAfter * 1000)
            : exponential + Math.floor(random() * 200);
          await sleep(Math.min(delay, Math.max(0, remaining - 1)));
        }
      }
      state.failures += 1;
      if (state.failures >= failureThreshold) state.openUntil = Date.now() + circuitCooldownMs;
      throw normalizeProviderError(lastError, providerCode);
    } finally {
      release();
    }
  }

  function openAiChatPayload({ model, messages, maxTokens = 2048, temperature = 0.7, stream = false, responseFormat }) {
    return { model, messages, max_tokens: maxTokens, temperature, stream, ...(responseFormat ? { response_format: responseFormat } : {}) };
  }

  function difyChatPayload({ messages, stream = false, inputs = {}, user, conversationId, files = [] }) {
    const lastUserMessage = [...(messages || [])].reverse().find((item) => item?.role === 'user');
    return {
      inputs: inputs && typeof inputs === 'object' && !Array.isArray(inputs) ? inputs : {},
      query: String(lastUserMessage?.content || ''),
      response_mode: stream ? 'streaming' : 'blocking',
      user: String(user || provider.extra_config_json?.user || 'discimind-user').slice(0, 255),
      ...(conversationId ? { conversation_id: String(conversationId) } : {}),
      ...(Array.isArray(files) && files.length ? { files } : {}),
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
      method: 'POST', signal: options.signal,
      url: `${baseUrl}${dify ? '/chat-messages' : '/chat/completions'}`,
      data: dify ? difyChatPayload(options) : openAiChatPayload(options),
    });
    const content = String((dify ? response.data?.answer : response.data?.choices?.[0]?.message?.content) || '').trim();
    if (!content) throw Object.assign(new Error('AI 服务返回了空内容'), { code: 50201, status: 502, publicCode: 'AI_EMPTY_RESPONSE', retryable: true, expose: true });
    return {
      ok: true, latency_ms: Date.now() - started, content: content.slice(0, 2_000_000),
      conversation_id: dify ? response.data?.conversation_id || null : null,
      usage: response.data?.usage || response.data?.metadata?.usage || null,
    };
  }

  function parseStreamLine(line, dify) {
    const raw = line.replace(/^data:\s*/, '').trim();
    if (!raw || raw.startsWith(':')) return null;
    if (raw === '[DONE]') return { done: true };
    let event;
    try { event = JSON.parse(raw); } catch { return null; }
    if (dify && ['error', 'workflow_failed'].includes(event.event)) {
      throw Object.assign(new Error(String(event.message || 'Dify 流式调用失败')), { code: 50201, status: 502, publicCode: 'DIFY_STREAM_ERROR', retryable: false, expose: true });
    }
    const content = dify ? (event.answer || '') : (event.choices?.[0]?.delta?.content || '');
    return { content: String(content || ''), event: event.event || null, done: dify ? ['message_end', 'workflow_finished'].includes(event.event) : false, raw: event };
  }

  async function* streamChat(options) {
    const dify = type === 'dify';
    const response = await request({
      method: 'POST', responseType: 'stream', signal: options.signal,
      url: `${baseUrl}${dify ? '/chat-messages' : '/chat/completions'}`,
      data: dify ? difyChatPayload({ ...options, stream: true }) : openAiChatPayload({ ...options, stream: true }),
    });
    let buffer = '';
    let received = false;
    let ended = false;
    const consume = function* (lines) {
      for (const line of lines) {
        const parsed = parseStreamLine(line, dify);
        if (!parsed) continue;
        if (parsed.content) { received = true; yield { content: parsed.content, event: parsed.event, raw: parsed.raw }; }
        if (parsed.done) ended = true;
      }
    };
    try {
      for await (const chunk of response.data) {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        yield* consume(lines);
      }
      if (buffer.trim()) yield* consume([buffer]);
    } catch (error) {
      throw normalizeProviderError(error, providerCode);
    }
    if (!received) throw Object.assign(new Error('AI 流式服务未返回有效内容'), { code: 50201, status: 502, publicCode: 'AI_EMPTY_STREAM', retryable: !ended, expose: true });
  }

  async function embed({ model, input, signal }) {
    if (type === 'dify') throw Object.assign(new Error('Dify 供应商不提供统一 Embedding 接口'), { code: 40001, expose: true });
    const expected = Array.isArray(input) ? input.length : 1;
    if (!expected) throw Object.assign(new Error('Embedding 输入不能为空'), { code: 40001, expose: true });
    const started = Date.now();
    const response = await request({ method: 'POST', signal, url: `${baseUrl}/embeddings`, data: { model, input } });
    const rows = response.data?.data;
    if (!Array.isArray(rows) || rows.length !== expected || rows.some((item) => !Array.isArray(item?.embedding) || !item.embedding.length || item.embedding.some((value) => !Number.isFinite(Number(value))))) {
      throw Object.assign(new Error('Embedding 返回缺失或批次不完整'), { code: 50201, status: 502, publicCode: 'AI_INVALID_EMBEDDING', retryable: true, expose: true });
    }
    return { ok: true, latency_ms: Date.now() - started, embeddings: rows.map((item) => item.embedding.map(Number)), usage: response.data?.usage || null };
  }

  async function rerank({ model, query, documents, topN, signal }) {
    if (type === 'dify') throw Object.assign(new Error('Dify 供应商不提供统一 Rerank 接口'), { code: 40001, expose: true });
    const started = Date.now();
    const response = await request({ method: 'POST', signal, url: `${baseUrl}/rerank`, data: { model, query, documents, ...(topN ? { top_n: topN } : {}) } });
    const results = Array.isArray(response.data?.results) ? response.data.results : (Array.isArray(response.data?.data) ? response.data.data : []);
    if (!results.length) throw Object.assign(new Error('Rerank 服务未返回有效结果'), { code: 50201, status: 502, publicCode: 'AI_EMPTY_RERANK', retryable: true, expose: true });
    return { ok: true, latency_ms: Date.now() - started, results, usage: response.data?.usage || null };
  }

  async function generateImage({ model, prompt, negativePrompt, n = 1, size = '1024x1024', responseFormat = 'url', signal }) {
    if (type === 'dify') throw Object.assign(new Error('Dify 供应商不提供统一图片生成接口'), { code: 40001, expose: true });
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) throw Object.assign(new Error('图片生成提示词不能为空'), { code: 40001, expose: true });
    const count = boundedInteger(n, 1, 1, 4);
    if (!/^\d{2,5}x\d{2,5}$/i.test(String(size))) throw Object.assign(new Error('图片尺寸格式不合法'), { code: 40001, expose: true });
    if (!['url', 'b64_json'].includes(responseFormat)) throw Object.assign(new Error('图片返回格式不合法'), { code: 40001, expose: true });
    const started = Date.now();
    const response = await request({
      method: 'POST', signal,
      url: `${baseUrl}${providerPath(provider.extra_config_json?.image_path, '/images/generations')}`,
      data: {
        model, prompt: cleanPrompt.slice(0, 10000), n: count, size: String(size), response_format: responseFormat,
        ...(negativePrompt ? { negative_prompt: String(negativePrompt).slice(0, 5000) } : {}),
      },
    });
    const rows = response.data?.data || response.data?.images || response.data?.output?.results;
    const images = (Array.isArray(rows) ? rows : []).map((item) => ({
      url: /^https?:\/\//i.test(String(item?.url || '')) ? String(item.url).slice(0, 4000) : null,
      b64_json: typeof item?.b64_json === 'string' && item.b64_json.length <= 20 * 1024 * 1024 ? item.b64_json : null,
      revised_prompt: item?.revised_prompt ? String(item.revised_prompt).slice(0, 10000) : null,
    })).filter((item) => item.url || item.b64_json);
    if (!images.length) throw Object.assign(new Error('图片生成服务未返回有效图片'), { code: 50201, status: 502, publicCode: 'AI_EMPTY_IMAGE', retryable: true, expose: true });
    return { ok: true, latency_ms: Date.now() - started, images };
  }

  async function generateVideo({ model, prompt, imageUrl, durationSeconds = 5, aspectRatio = '16:9', signal }) {
    const endpoint = providerPath(provider.extra_config_json?.video_path);
    if (!endpoint) throw Object.assign(new Error('当前供应商未配置视频生成接口'), { code: 40001, publicCode: 'AI_VIDEO_NOT_CONFIGURED', expose: true });
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) throw Object.assign(new Error('视频生成提示词不能为空'), { code: 40001, expose: true });
    if (imageUrl && !/^https?:\/\//i.test(String(imageUrl))) throw Object.assign(new Error('视频参考图地址不合法'), { code: 40001, expose: true });
    const started = Date.now();
    const response = await request({
      method: 'POST', signal, url: `${baseUrl}${endpoint}`,
      data: {
        model, prompt: cleanPrompt.slice(0, 10000),
        duration: boundedInteger(durationSeconds, 5, 1, 60),
        aspect_ratio: ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(aspectRatio) ? aspectRatio : '16:9',
        ...(imageUrl ? { image_url: String(imageUrl).slice(0, 4000) } : {}),
      },
    });
    const data = response.data?.data || response.data?.output || response.data;
    const taskId = data?.task_id || data?.id || response.data?.request_id;
    const url = /^https?:\/\//i.test(String(data?.url || data?.video_url || '')) ? String(data.url || data.video_url).slice(0, 4000) : null;
    if (!taskId && !url) throw Object.assign(new Error('视频生成服务未返回任务或视频'), { code: 50201, status: 502, publicCode: 'AI_EMPTY_VIDEO_TASK', retryable: true, expose: true });
    return { ok: true, latency_ms: Date.now() - started, task_id: taskId ? String(taskId).slice(0, 500) : null, status: String(data?.status || (url ? 'succeeded' : 'submitted')).slice(0, 60), url };
  }

  async function workflow({ inputs = {}, user = 'discimind-user', signal }) {
    if (type !== 'dify') throw Object.assign(new Error('仅 Dify 供应商支持 Workflow'), { code: 40001, expose: true });
    const started = Date.now();
    const response = await request({ method: 'POST', signal, url: `${baseUrl}/workflows/run`, data: { inputs, response_mode: 'blocking', user: String(user).slice(0, 255) } });
    const data = response.data?.data;
    if (!data || data.status !== 'succeeded' || !data.outputs || typeof data.outputs !== 'object' || !Object.keys(data.outputs).length) {
      throw Object.assign(new Error(data?.error || 'Dify Workflow 未返回有效输出'), { code: 50201, status: 502, publicCode: data?.status === 'failed' ? 'DIFY_WORKFLOW_FAILED' : 'DIFY_EMPTY_OUTPUT', retryable: false, expose: true });
    }
    return { ok: true, latency_ms: Date.now() - started, outputs: data.outputs, workflow_run_id: response.data?.workflow_run_id || data.id || null, usage: data.total_tokens == null ? null : { total_tokens: data.total_tokens } };
  }

  function getCapabilities() {
    if (type === 'dify') return ['chat', 'stream', 'workflow', 'chatflow', 'health'];
    return ['models', 'chat', 'stream', 'embedding', 'rerank', 'image', ...(provider.extra_config_json?.video_path ? ['video'] : []), 'health'];
  }

  return {
    testConnection, listModels, chat, streamChat, embed, rerank, generateImage, generateVideo, workflow,
    healthCheck: testConnection,
    normalizeError: (error) => normalizeProviderError(error, providerCode),
    getCapabilities,
  };
}

module.exports = {
  createProviderAdapter, cleanBaseUrl, authHeaders, SUPPORTED_PROVIDER_TYPES,
  RETRYABLE_HTTP_STATUSES, RETRYABLE_NETWORK_CODES, isRetryableError,
  normalizeProviderError, parseStructuredJson, stripMarkdownJsonFence, providerPath,
};
