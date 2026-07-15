const { getBailianConfig, mapBailianError } = require('../../services/bailian-openai.service');
const { buildDashScopeParameters } = require('./search-policy');
const { normalizeSources } = require('./citation-normalizer');
const { aiError } = require('./errors');

function usesMultimodalEndpoint(model) {
  return /^qwen3\.7-plus(?:-|$)/i.test(String(model || '')) || /^qwen3\.5-(?:plus|flash|omni)(?:-|$)/i.test(String(model || ''));
}

function nativeEndpoint(config = getBailianConfig()) {
  const service = usesMultimodalEndpoint(config.model) ? 'multimodal-generation' : 'text-generation';
  const explicit = String(process.env.DASHSCOPE_NATIVE_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) {
    return explicit.endsWith('/generation') ? explicit : `${explicit}/api/v1/services/aigc/${service}/generation`;
  }
  const base = String(config.baseURL || '').replace(/\/$/, '');
  if (/\/compatible-mode\/v1$/i.test(base)) return base.replace(/\/compatible-mode\/v1$/i, `/api/v1/services/aigc/${service}/generation`);
  return `${base}/api/v1/services/aigc/${service}/generation`;
}

function nativeMessages(messages, multimodal) {
  if (!multimodal) return messages;
  return (messages || []).map(message => ({
    role: message.role,
    content: Array.isArray(message.content)
      ? message.content.map(item => item?.text ? { text: String(item.text) } : item?.type === 'text' ? { text: String(item.text || '') } : null).filter(Boolean)
      : [{ text: String(message.content || '') }],
  })).filter(message => message.content.length);
}

function messageText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(item => typeof item === 'string' ? item : item?.text || '').join('');
}

function parseSseBlock(block) {
  const data = String(block || '').split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return null;
  try { return JSON.parse(data); } catch { return null; }
}

async function* readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const parsed = parseSseBlock(block); if (parsed) yield parsed;
      boundary = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  const parsed = parseSseBlock(buffer); if (parsed) yield parsed;
}

function combinedAbortSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(aiError('AI_MODEL_TIMEOUT')), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); signal?.removeEventListener?.('abort', abort); } };
}

class DashScopeSearchClient {
  constructor(options = {}) {
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.config = options.config || getBailianConfig();
    this.endpoint = options.endpoint || nativeEndpoint(this.config);
    this.multimodal = options.multimodal ?? usesMultimodalEndpoint(this.config.model);
    this.timeoutMs = Math.max(10_000, Number(options.timeoutMs || process.env.DASHSCOPE_SEARCH_TIMEOUT_MS || this.config.timeout || process.env.BAILIAN_TIMEOUT_MS || 180_000));
  }

  async *stream({ messages, searchOptions, capabilities, signal, enableThinking = false, maxTokens = 2600 }) {
    const built = buildDashScopeParameters(searchOptions, capabilities);
    if (!built.parameters.enable_search) throw aiError('AI_SEARCH_DISABLED', undefined, 400);
    const abort = combinedAbortSignal(signal, this.timeoutMs);
    let response;
    try {
      response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-DashScope-SSE': 'enable',
        },
        body: JSON.stringify({
          model: this.config.model,
          input: { messages: nativeMessages(messages, this.multimodal) },
          parameters: {
            ...built.parameters,
            enable_thinking: Boolean(enableThinking),
            incremental_output: true,
            result_format: 'message',
            max_tokens: Math.max(128, Math.min(16_384, Number(maxTokens) || 2600)),
          },
        }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        const error = new Error(`DashScope Generation HTTP ${response.status}: ${raw.slice(0, 500)}`);
        error.status = response.status;
        if (/unsupported|invalid.*parameter|parameter.*invalid/i.test(raw)) {
          throw aiError('AI_SEARCH_UNSUPPORTED', '当前模型不支持所选搜索参数。', 400, { status: response.status });
        }
        throw mapBailianError(error, '联网搜索服务暂时不可用，请稍后重试');
      }
      if (!response.body) throw aiError('AI_STREAM_INTERRUPTED', 'DashScope 未返回流式响应。', 502);
      let sourcesSent = false;
      let searchOccurred = false;
      let requestId = null;
      let lastUsage = null;
      for await (const frame of readSse(response.body)) {
        requestId ||= frame.request_id || frame.requestId || null;
        if (frame.code) {
          const rawMessage = String(frame.message || '').slice(0, 500);
          if (/url error|unsupported|invalid.*parameter|parameter.*invalid/i.test(rawMessage)) throw aiError('AI_SEARCH_UNSUPPORTED', '当前模型不支持所选联网接口或搜索参数。', 400, { requestId, upstreamCode: frame.code });
          throw aiError('AI_STREAM_INTERRUPTED', 'DashScope 联网流返回错误。', 502, { requestId, upstreamCode: frame.code });
        }
        const searchInfo = frame.output?.search_info || frame.output?.searchInfo || null;
        const rawSources = searchInfo?.search_results || searchInfo?.searchResults || [];
        const pluginCount = Number(frame.usage?.plugins?.search?.count || frame.usage?.plugins?.search_count || (Array.isArray(frame.usage?.plugins) ? frame.usage.plugins.length : 0));
        if (searchInfo || pluginCount > 0) searchOccurred = true;
        if (!sourcesSent && rawSources.length) {
          sourcesSent = true;
          yield {
            type: 'sources', requestId,
            sources: normalizeSources(rawSources, { sourceType: 'web', searchStrategy: built.effective.strategy, requestId }),
          };
        }
        const message = frame.output?.choices?.[0]?.message || {};
        const reasoning = messageText(message.reasoning_content || message.reasoningContent || '');
        const content = messageText(message.content);
        if (reasoning) yield { type: 'reasoning', content: String(reasoning), requestId };
        if (content) yield { type: 'delta', content: String(content), requestId };
        if (frame.usage && Object.keys(frame.usage).length) {
          lastUsage = frame.usage;
          yield { type: 'usage', usage: frame.usage, requestId };
        }
      }
      if (built.effective.mode === 'force' && !searchOccurred) throw aiError('AI_SEARCH_NOT_TRIGGERED', undefined, 503, { requestId });
      yield { type: 'completed', requestId, searchOccurred, usage: lastUsage, omitted: built.omitted, effective: built.effective };
    } catch (error) {
      if (error?.publicCode) throw error;
      if (abort.signal.aborted && !signal?.aborted) throw aiError('AI_MODEL_TIMEOUT');
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      throw mapBailianError(error, '联网搜索服务暂时不可用，请稍后重试');
    } finally {
      abort.dispose();
    }
  }

  async complete(input) {
    let content = ''; let reasoning = ''; let sources = []; let completed = null;
    for await (const event of this.stream(input)) {
      if (event.type === 'delta') content += event.content;
      if (event.type === 'reasoning') reasoning += event.content;
      if (event.type === 'sources') sources = event.sources;
      if (event.type === 'completed') completed = event;
    }
    return { content, reasoning, sources, ...completed };
  }
}

module.exports = { DashScopeSearchClient, nativeEndpoint, usesMultimodalEndpoint, nativeMessages, messageText, parseSseBlock, readSse };
