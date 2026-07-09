const axios = require('axios');
const { loadEnv } = require('../../config/env');
const { TrainerWorkflowError, createTrainerError } = require('./trainer.errors');
const { isPlainObject } = require('./trainer.validator');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_USER_PREFIX = 'discimind-user';
const RETRY_DELAY_MS = 500;
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getTrainerConfig() {
  loadEnv();

  const baseURL = String(process.env.DIFY_TRAINER_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.DIFY_TRAINER_API_KEY || '').trim();

  if (!baseURL) {
    throw createTrainerError('TRAINER_CONFIG_ERROR', 'Dify 训练师 Base URL 未配置', 500);
  }
  if (!apiKey) {
    throw createTrainerError('TRAINER_CONFIG_ERROR', 'Dify 训练师 API Key 未配置', 500);
  }

  return {
    baseURL,
    apiKey,
    timeoutMs: parsePositiveInt(process.env.DIFY_TRAINER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: parsePositiveInt(process.env.DIFY_TRAINER_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    userPrefix: String(process.env.DIFY_TRAINER_USER_PREFIX || DEFAULT_USER_PREFIX).trim() || DEFAULT_USER_PREFIX,
  };
}

function buildDifyUser(userId) {
  loadEnv();

  const prefix = String(process.env.DIFY_TRAINER_USER_PREFIX || DEFAULT_USER_PREFIX).trim() || DEFAULT_USER_PREFIX;
  if (userId == null || String(userId).trim() === '') {
    throw createTrainerError('TRAINER_AUTH_CONTEXT_ERROR', '无法获取当前用户 ID', 401);
  }
  return `${prefix}-${String(userId).trim()}`;
}

function createTrainerClient(config) {
  return axios.create({
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeStringify(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 500);

  try {
    return JSON.stringify(value, (key, val) => {
      const lowerKey = String(key || '').toLowerCase();
      if (lowerKey.includes('authorization') || lowerKey.includes('api_key') || lowerKey.includes('token')) {
        return '[redacted]';
      }
      return val;
    }).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function getOutputResult(outputs) {
  if (!isPlainObject(outputs)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(outputs, 'result')) return undefined;
  return outputs.result;
}

function toWorkflowFailureData(envelope, data, requestId) {
  return {
    request_id: requestId,
    task_id: envelope?.task_id || null,
    workflow_run_id: envelope?.workflow_run_id || data?.workflow_run_id || data?.id || null,
    upstream_status: data?.status || null,
    upstream_error: safeStringify(data?.error),
  };
}

function normalizeDifyResponse(response, context) {
  const envelope = response?.data;
  const data = envelope?.data;

  if (!isPlainObject(envelope) || !isPlainObject(data)) {
    throw createTrainerError('TRAINER_INVALID_RESPONSE', 'Dify 训练师返回结构异常', 502);
  }

  if ((data.status && data.status !== 'succeeded') || data.error) {
    throw createTrainerError(
      'TRAINER_WORKFLOW_FAILED',
      'Dify 训练师 Workflow 执行失败',
      502,
      toWorkflowFailureData(envelope, data, context.requestId),
    );
  }

  const rawResult = getOutputResult(data.outputs);
  if (rawResult === undefined || rawResult === null) {
    throw createTrainerError('TRAINER_INVALID_RESPONSE', 'Dify 训练师返回缺少 outputs.result', 502);
  }

  const businessResult = parseMaybeJson(rawResult);
  if (!isPlainObject(businessResult)) {
    throw createTrainerError('TRAINER_INVALID_RESPONSE', 'Dify 训练师业务结果不是 JSON 对象', 502);
  }

  if (businessResult.success === false) {
    throw createTrainerError(
      'TRAINER_WORKFLOW_BUSINESS_FAILED',
      'Dify 训练师业务校验未通过',
      422,
      businessResult,
    );
  }

  if (businessResult.success !== true) {
    throw createTrainerError('TRAINER_INVALID_RESPONSE', 'Dify 训练师业务结果缺少 success=true', 502);
  }

  return {
    businessResult,
    metadata: {
      task_id: envelope.task_id || null,
      workflow_run_id: envelope.workflow_run_id || data.workflow_run_id || data.id || null,
      status: data.status || null,
      elapsed_time: data.elapsed_time ?? null,
      total_tokens: data.total_tokens ?? null,
      attempts: context.attempts,
      response_time_ms: Date.now() - context.startedAt,
    },
  };
}

function isTimeoutError(err) {
  return err?.code === 'ECONNABORTED'
    || err?.code === 'ETIMEDOUT'
    || /timeout/i.test(String(err?.message || ''));
}

function isRetryableError(err) {
  const status = err?.response?.status;
  if (status && RETRYABLE_HTTP_STATUSES.has(status)) return true;
  return RETRYABLE_NETWORK_CODES.has(err?.code);
}

function mapAxiosError(err) {
  const status = err?.response?.status;

  if (status === 401 || status === 403) {
    return createTrainerError('TRAINER_UPSTREAM_AUTH_FAILED', 'Dify 训练师上游认证失败', 502, {
      upstream_status: status,
    });
  }

  if (isTimeoutError(err)) {
    return createTrainerError('TRAINER_TIMEOUT', 'Dify 训练师请求超时', 504);
  }

  if (!err?.response) {
    return createTrainerError('TRAINER_UPSTREAM_UNAVAILABLE', 'Dify 训练师服务无法连接', 502, {
      upstream_code: err?.code || null,
    });
  }

  if (status >= 500) {
    return createTrainerError('TRAINER_UPSTREAM_UNAVAILABLE', 'Dify 训练师上游服务暂不可用', 502, {
      upstream_status: status,
    });
  }

  return createTrainerError('TRAINER_WORKFLOW_FAILED', 'Dify 训练师上游拒绝请求', 502, {
    upstream_status: status || null,
  });
}

async function postWorkflowWithRetry(client, requestBody, config, context) {
  let attempt = 0;

  while (attempt <= config.maxRetries) {
    try {
      const response = await client.post('/workflows/run', requestBody);
      return normalizeDifyResponse(response, {
        ...context,
        attempts: attempt + 1,
      });
    } catch (err) {
      if (err instanceof TrainerWorkflowError) throw err;

      if (attempt < config.maxRetries && isRetryableError(err)) {
        attempt += 1;
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      throw mapAxiosError(err);
    }
  }

  throw createTrainerError('TRAINER_UPSTREAM_UNAVAILABLE', 'Dify 训练师服务无法连接', 502);
}

async function runTrainerWorkflow(input, options = {}) {
  const config = getTrainerConfig();
  const client = options.client || createTrainerClient(config);
  const startedAt = Date.now();

  const requestBody = {
    inputs: {
      mode: input.mode,
      request_id: input.requestId,
      payload: input.payload,
      locale: input.locale,
      debug: input.debug,
    },
    response_mode: 'blocking',
    user: input.difyUser,
  };

  return postWorkflowWithRetry(client, requestBody, config, {
    requestId: input.requestId,
    mode: input.mode,
    startedAt,
  });
}

module.exports = {
  buildDifyUser,
  getTrainerConfig,
  parseMaybeJson,
  runTrainerWorkflow,
};
