const OpenAI = require('openai');

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen3.7-plus';
const MISSING_API_KEY_MESSAGE = '百炼 API Key 未配置，请在后端环境中设置 BAILIAN_API_KEY。';

let cachedClient = null;
let cachedKey = '';

function getBailianConfig() {
  const apiKey = String(process.env.BAILIAN_API_KEY || '').trim();
  if (!apiKey || apiKey.startsWith('请')) {
    throw Object.assign(new Error(MISSING_API_KEY_MESSAGE), { code: 50002 });
  }
  return {
    apiKey,
    baseURL: String(process.env.BAILIAN_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: String(process.env.BAILIAN_MODEL || DEFAULT_MODEL),
    timeout: Math.max(10_000, Number(process.env.BAILIAN_TIMEOUT_MS || 180_000)),
    maxRetries: Math.max(0, Math.min(3, Number(process.env.BAILIAN_MAX_RETRIES || 1))),
  };
}

function getBailianClient() {
  const config = getBailianConfig();
  const key = `${config.baseURL}|${config.apiKey.slice(-8)}|${config.timeout}|${config.maxRetries}`;
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
    });
    cachedKey = key;
  }
  return { client: cachedClient, model: config.model, config };
}

function buildChatCompletionParams({ messages, stream = false, temperature = 0.5, maxTokens, jsonMode = false } = {}) {
  const params = {
    model: getBailianConfig().model,
    messages,
    stream,
    temperature,
    // qwen3.7-plus 默认可能开启思考。学习对话重视首字速度，显式关闭。
    enable_thinking: false,
  };
  if (Number.isFinite(Number(maxTokens))) params.max_tokens = Number(maxTokens);
  if (jsonMode) params.response_format = { type: 'json_object' };
  return params;
}

function mapBailianError(error, fallbackMessage = 'AI 服务调用失败，请稍后再试') {
  const status = Number(error?.status || error?.response?.status || 0);
  if (status === 401 || status === 403) {
    return Object.assign(new Error('百炼服务认证失败，请检查 BAILIAN_API_KEY'), { code: 50002 });
  }
  if (status === 429) {
    return Object.assign(new Error('AI 请求较多，请稍后重试'), { code: 50002 });
  }
  if (error?.name === 'AbortError') return error;
  return Object.assign(new Error(fallbackMessage), { code: 50002 });
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  MISSING_API_KEY_MESSAGE,
  getBailianConfig,
  getBailianClient,
  buildChatCompletionParams,
  mapBailianError,
};
