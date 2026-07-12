/**
 * Bailian (百炼) 大模型适配器
 *
 * 基于 LangChain ChatOpenAI 封装阿里云百炼平台 OpenAI 兼容接口。
 * 支持纯文本和图文多模态（image+text）调用。
 *
 * 环境变量:
 *   BAILIAN_API_KEY   - 百炼 API Key（必需）
 *   BAILIAN_BASE_URL  - 百炼兼容端点（默认 https://dashscope.aliyuncs.com/compatible-mode/v1）
 *   BAILIAN_MODEL     - 模型名称（默认 qwen3.7-plus）
 */

const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage, AIMessage } = require('@langchain/core/messages');

// ---------------------------------------------------------------------------
// 统一错误
// ---------------------------------------------------------------------------

class AppError extends Error {
  constructor(code, message, status = 500, cause = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      cause: this.cause ? this.cause.message : null,
    };
  }
}

function createAppError(code, message, status = 500, cause = null) {
  return new AppError(code, message, status, cause);
}

// ---------------------------------------------------------------------------
// 模型默认参数（集中管理）
// ---------------------------------------------------------------------------

const MODEL_DEFAULTS = Object.freeze({
  temperature: 0.3,
  maxTokens: 2048,
  topP: 0.9,
  timeout: Number(process.env.BAILIAN_TIMEOUT_MS || process.env.AGENT_REQUEST_TIMEOUT_MS || 180_000),
  maxRetries: Number(process.env.BAILIAN_MAX_RETRIES || 1),
  enableThinking: String(process.env.BAILIAN_ENABLE_THINKING || 'false').toLowerCase() === 'true',
});

// ---------------------------------------------------------------------------
// 日志脱敏工具
// ---------------------------------------------------------------------------

/**
 * 对要写入日志的对象做脱敏处理，移除:
 *  - API Key
 *  - base64 图片数据（image_url.url 中含 data: 前缀的）
 *  - 学生隐私字段（userId / studentId / realName / phone / email）
 */
const PRIVACY_FIELDS = new Set([
  'apiKey',
  'api_key',
  'userId',
  'studentId',
  'student_id',
  'realName',
  'real_name',
  'phone',
  'email',
  'password',
  'token',
]);

function sanitizeForLog(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') {
    // 如果是字符串且像 base64 图片，截短
    if (typeof obj === 'string' && obj.startsWith('data:image')) {
      return obj.slice(0, 64) + '...[base64 truncated]';
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(sanitizeForLog);

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (PRIVACY_FIELDS.has(key) || PRIVACY_FIELDS.has(lower)) {
      cleaned[key] = '[REDACTED]';
    } else if (
      typeof value === 'string' &&
      value.startsWith('data:image')
    ) {
      cleaned[key] = value.slice(0, 64) + '...[base64 truncated]';
    } else {
      cleaned[key] = sanitizeForLog(value);
    }
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// 校验消息列表格式
// ---------------------------------------------------------------------------

/**
 * 校验消息数组中每个 image_url 的 url 是否为合法 base64 data URL。
 * 仅做快速格式检查，不解析完整 base64。
 */
function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    throw createAppError('BAILIAN_INVALID_MESSAGES', 'messages 必须为数组', 400);
  }
  if (messages.length === 0) {
    throw createAppError('BAILIAN_INVALID_MESSAGES', 'messages 不能为空', 400);
  }
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      throw createAppError(
        'BAILIAN_INVALID_MESSAGE_FORMAT',
        `messages[${i}] 不是合法的消息对象`,
        400,
      );
    }
    if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
      throw createAppError(
        'BAILIAN_INVALID_ROLE',
        `messages[${i}].role 必须为 user/assistant/system，收到: ${msg.role}`,
        400,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 工厂: 创建 ChatOpenAI 实例
// ---------------------------------------------------------------------------

/**
 * 创建百炼 ChatOpenAI 实例。
 *
 * @param {Object} [options]
 * @param {string}  [options.apiKey]      - 覆盖 BAILIAN_API_KEY
 * @param {string}  [options.baseURL]     - 覆盖 BAILIAN_BASE_URL
 * @param {string}  [options.model]       - 覆盖 BAILIAN_MODEL
 * @param {number}  [options.temperature] - 默认 MODEL_DEFAULTS.temperature
 * @param {number}  [options.maxTokens]   - 默认 MODEL_DEFAULTS.maxTokens
 * @param {number}  [options.topP]        - 默认 MODEL_DEFAULTS.topP
 * @param {number}  [options.timeout]     - 默认 MODEL_DEFAULTS.timeout (ms)
 * @param {number}  [options.maxRetries]  - 默认 MODEL_DEFAULTS.maxRetries
 * @returns {ChatOpenAI}
 */
function createBailianModel(options = {}) {
  const baseURL =
    options.baseURL ||
    process.env.BAILIAN_BASE_URL ||
    'https://dashscope.aliyuncs.com/compatible-mode/v1';

  const model =
    options.model || process.env.BAILIAN_MODEL || 'qwen3.7-plus';

  const apiKey =
    options.apiKey || process.env.BAILIAN_API_KEY || '';

  if (!apiKey) {
    throw createAppError(
      'BAILIAN_NO_API_KEY',
      '未配置 BAILIAN_API_KEY 环境变量',
      500,
    );
  }

  const jsonMode = options.jsonMode === true;
  const enableThinking = options.enableThinking ?? MODEL_DEFAULTS.enableThinking;
  const modelKwargs = {
    ...(options.modelKwargs || {}),
    enable_thinking: enableThinking,
  };
  if (jsonMode) modelKwargs.response_format = { type: 'json_object' };

  return new ChatOpenAI(
    {
      model,
      apiKey,
      configuration: { baseURL },
      temperature: options.temperature ?? MODEL_DEFAULTS.temperature,
      // 百炼 JSON Mode 不应设置 max_tokens，否则可能截断 JSON。
      maxTokens: jsonMode ? undefined : (options.maxTokens ?? MODEL_DEFAULTS.maxTokens),
      topP: options.topP ?? MODEL_DEFAULTS.topP,
      timeout: options.timeout ?? MODEL_DEFAULTS.timeout,
      maxRetries: options.maxRetries ?? MODEL_DEFAULTS.maxRetries,
      modelKwargs,
    },
    { baseURL },
  );
}

// ---------------------------------------------------------------------------
// 默认单例
// ---------------------------------------------------------------------------

const _modelCache = new Map();

/**
 * 返回全局默认百炼模型实例（惰性单例）。
 * @returns {ChatOpenAI}
 */
function getDefaultBailianModel(options = {}) {
  const key = JSON.stringify({
    jsonMode: options.jsonMode === true,
    enableThinking: options.enableThinking ?? MODEL_DEFAULTS.enableThinking,
    maxTokens: options.maxTokens ?? null,
    temperature: options.temperature ?? MODEL_DEFAULTS.temperature,
    timeout: options.timeout ?? MODEL_DEFAULTS.timeout,
  });
  if (!_modelCache.has(key)) _modelCache.set(key, createBailianModel(options));
  return _modelCache.get(key);
}

// ---------------------------------------------------------------------------
// 核心调用: bailianModelCall
// ---------------------------------------------------------------------------

/**
 * 调用百炼大模型。
 *
 * 纯文本消息示例:
 *   [{ role: "user", content: "你好" }]
 *
 * 多模态消息示例:
 *   [{
 *     role: "user",
 *     content: [
 *       { type: "text", text: "这张图片里有什么？" },
 *       { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }
 *     ]
 *   }]
 *
 * @param {Array}   messages        - 消息列表，格式同 OpenAI chat completion
 * @param {Object}  [options]
 * @param {AbortSignal} [options.signal]  - 取消信号
 * @param {number}  [options.timeout]     - 本次调用超时 (ms)，会合并到实例配置
 * @returns {Promise<{content: string, usage: Object}>}
 */
async function bailianModelCall(messages, options = {}) {
  // Optional learning-preload cache. Any lookup/validation error is a soft miss.
  try {
    const cached = await require('../../learning-flow-preload/learning-flow-preload-model.adapter').cachedModelResponse(messages, options);
    if (cached) return cached;
  } catch {
    // Preserve the original model path exactly when preload is absent or unavailable.
  }
  const {
    signal,
    timeout,
    jsonMode = false,
    enableThinking = MODEL_DEFAULTS.enableThinking,
    maxTokens,
    temperature,
  } = options;

  try {
    // 1. 校验
    validateMessages(messages);

    // 2. 使用按调用能力缓存的模型实例。结构化 Agent 默认关闭思考并启用 JSON Mode。
    const model = getDefaultBailianModel({
      timeout,
      jsonMode,
      enableThinking,
      maxTokens,
      temperature,
    });

    const langchainMessages = messages.map((message) => {
      if (message.role === 'system') return new SystemMessage({ content: message.content });
      if (message.role === 'assistant') return new AIMessage({ content: message.content });
      return new HumanMessage({ content: message.content });
    });

    // 3. 构造调用参数
    const invokeOptions = {};
    if (signal) {
      invokeOptions.signal = signal;
    }

    // 4. 调用
    const startTime = process.hrtime.bigint();
    const wallStart = Date.now();
    const response = await model.invoke(langchainMessages, invokeOptions);
    const wallElapsed = Date.now() - wallStart;
    const preciseMs = Math.round(Number(process.hrtime.bigint() - startTime) / 1e6 * 100) / 100;

    // 5. 提取 usage（ChatOpenAI 的 invoke 返回 AIMessage，usage 在 additional_kwargs 或 response_metadata 中）
    const usage = {
      prompt_tokens:
        response.usage_metadata?.input_tokens ??
        response.additional_kwargs?.usage?.prompt_tokens ??
        0,
      completion_tokens:
        response.usage_metadata?.output_tokens ??
        response.additional_kwargs?.usage?.completion_tokens ??
        0,
      total_tokens:
        response.usage_metadata?.total_tokens ??
        response.additional_kwargs?.usage?.total_tokens ??
        0,
      reasoning_tokens:
        response.usage_metadata?.output_token_details?.reasoning ??
        response.usage_metadata?.output_token_details?.reasoning_tokens ??
        response.additional_kwargs?.usage?.completion_tokens_details?.reasoning_tokens ??
        0,
    };

    const content =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // 6. 成功日志（脱敏）
    console.log(JSON.stringify({
      event: 'bailian_model_call',
      model: process.env.BAILIAN_MODEL || 'qwen3.7-plus',
      elapsedMs: wallElapsed,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      reasoningTokens: usage.reasoning_tokens,
      totalTokens: usage.total_tokens,
      thinkingEnabled: enableThinking,
      jsonMode,
    }));

    return {
      content,
      usage,
      timing: { totalMs: preciseMs, firstTokenMs: 0, wallMs: wallElapsed },
    };
  } catch (error) {
    // 不打印 API Key、base64 或学生隐私数据
    const safeContext = {
      messageCount: messages.length,
      hasSignal: !!signal,
      hasTimeout: timeout !== undefined,
    };
    console.error(
      `[BailianModel] call failed: ${error.message}`,
      sanitizeForLog(safeContext),
    );

    // 已经是 AppError 则直接抛出
    if (error instanceof AppError) throw error;

    // AbortError（客户端取消）
    if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
      throw createAppError('BAILIAN_REQUEST_ABORTED', '请求已被取消', 499, error);
    }

    // 超时
    if (
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET' ||
      (error.message && error.message.includes('timeout'))
    ) {
      throw createAppError('BAILIAN_TIMEOUT', '请求超时', 504, error);
    }

    // HTTP 状态码错误（LangChain 通常包装在 error.status 中）
    const status = error.status || 500;
    if (status === 401 || status === 403) {
      throw createAppError(
        'BAILIAN_AUTH_ERROR',
        '百炼 API 认证失败，请检查 BAILIAN_API_KEY',
        status,
        error,
      );
    }
    if (status === 429) {
      throw createAppError(
        'BAILIAN_RATE_LIMIT',
        '百炼 API 请求频率过高，请稍后重试',
        429,
        error,
      );
    }
    if (status >= 400 && status < 500) {
      throw createAppError(
        'BAILIAN_CLIENT_ERROR',
        `百炼 API 请求错误: ${error.message}`,
        status,
        error,
      );
    }
    if (status >= 500) {
      throw createAppError(
        'BAILIAN_SERVER_ERROR',
        `百炼 API 服务端错误: ${error.message}`,
        status,
        error,
      );
    }

    // 网络/未知错误
    throw createAppError(
      'BAILIAN_UNKNOWN_ERROR',
      `百炼调用异常: ${error.message}`,
      500,
      error,
    );
  }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

module.exports = {
  createBailianModel,
  getDefaultBailianModel,
  bailianModelCall,
  sanitizeForLog,
  AppError,
  createAppError,
  MODEL_DEFAULTS,
};
