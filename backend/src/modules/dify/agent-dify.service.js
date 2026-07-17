const axios = require('axios');
const { loadEnv } = require('../../config/env');
const { createAgentError } = require('../agent/common/agent.errors');

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_RETRIES = 1;
const RETRY_DELAY_MS = 250;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'ERR_NETWORK',
]);

const AGENT_CONFIGS = {
  explainer: {
    label: '讲解者',
    prefix: 'DIFY_EXPLAINER',
    userPrefix: 'discimind-explainer',
  },
  diagnostician: {
    label: '诊断师',
    prefix: 'DIFY_DIAGNOSTICIAN',
    userPrefix: 'discimind-diagnostician',
  },
};

function parseBooleanEnv(name, fallback = true) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAgentDescriptor(agent) {
  const descriptor = AGENT_CONFIGS[agent];
  if (!descriptor) {
    throw createAgentError('AGENT_CONFIG_ERROR', `未知 Dify Agent: ${agent}`, 500);
  }
  return descriptor;
}

function getDifyAgentConfig(agent, options = {}) {
  loadEnv();
  const descriptor = getAgentDescriptor(agent);
  const prefix = descriptor.prefix;
  const enabled = parseBooleanEnv(`${prefix}_ENABLED`, true);
  if (!enabled && !options.allowDisabled) {
    throw createAgentError(`${prefix}_DISABLED`, `${descriptor.label} Agent 未启用`, 503);
  }

  const baseURL = String(process.env[`${prefix}_BASE_URL`] || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env[`${prefix}_API_KEY`] || '').trim();
  if (!baseURL) {
    throw createAgentError(`${prefix}_CONFIG_ERROR`, `Dify ${descriptor.label} Base URL 未配置`, 503);
  }
  if (!apiKey) {
    throw createAgentError(`${prefix}_CONFIG_ERROR`, `Dify ${descriptor.label} API Key 未配置`, 503);
  }

  return {
    agent,
    label: descriptor.label,
    prefix,
    enabled,
    baseURL,
    apiKey,
    timeoutMs: parsePositiveInt(process.env[`${prefix}_TIMEOUT_MS`], DEFAULT_TIMEOUT_MS),
    maxRetries: parsePositiveInt(process.env[`${prefix}_MAX_RETRIES`], DEFAULT_MAX_RETRIES),
    userPrefix: String(process.env[`${prefix}_USER_PREFIX`] || descriptor.userPrefix).trim() || descriptor.userPrefix,
    debug: parseBooleanEnv(`${prefix}_DEBUG`, false),
  };
}

function hasUsableConfig(agent) {
  try {
    getDifyAgentConfig(agent);
    return true;
  } catch {
    return false;
  }
}

function buildDifyUser(agent, userId) {
  const config = getDifyAgentConfig(agent);
  if (userId == null || String(userId).trim() === '') {
    throw createAgentError(`${config.prefix}_AUTH_CONTEXT_ERROR`, '无法获取当前用户 ID', 401);
  }
  return `${config.userPrefix}-${String(userId).trim()}`;
}

function createDifyClient(config) {
  return axios.create({
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
}

function stripMarkdownJsonFence(value) {
  const raw = String(value || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return raw;
}

function parseMaybeJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  const raw = stripMarkdownJsonFence(value);
  const candidates = [raw];
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function safeStringify(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 600);
  try {
    return JSON.stringify(value, (key, val) => {
      const lowerKey = String(key || '').toLowerCase();
      if (lowerKey.includes('authorization') || lowerKey.includes('api_key') || lowerKey.includes('token')) {
        return '[redacted]';
      }
      return val;
    }).slice(0, 600);
  } catch {
    return String(value).slice(0, 600);
  }
}

function sanitizeDifyPayload(value) {
  // Strip Prisma internals and circular references by round-tripping through JSON.
  // Dify Python runtime can hit recursion limits on deeply-linked Prisma objects.
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function metadataElapsedMs(metadata) {
  if (metadata?.response_time_ms != null) return Math.round(Number(metadata.response_time_ms));
  if (metadata?.elapsed_time != null) return Math.round(Number(metadata.elapsed_time) * 1000);
  return null;
}

function normalizeDiagnosticianResponse(response, context) {
  const envelope = response?.data;
  const data = envelope?.data;
  const prefix = context.prefix;

  if (!envelope || typeof envelope !== 'object' || !data || typeof data !== 'object') {
    throw createAgentError(`${prefix}_INVALID_RESPONSE`, 'Dify 诊断师返回结构异常', 502);
  }

  if ((data.status && data.status !== 'succeeded') || data.error) {
    throw createAgentError(`${prefix}_WORKFLOW_FAILED`, 'Dify 诊断师 Workflow 执行失败', 502, {
      request_id: context.requestId,
      task_id: envelope.task_id || null,
      workflow_run_id: envelope.workflow_run_id || data.workflow_run_id || data.id || null,
      upstream_status: data.status || null,
      upstream_error: safeStringify(data.error),
    });
  }

  // Check for the branch_result output variable (intended name).
  // Also accept "output" and "text" as fallbacks for Dify workflows where the
  // end node was published with a different output variable name.
  let rawBranchResult = data.outputs?.branch_result;
  if (rawBranchResult == null) {
    rawBranchResult = data.outputs?.output;
  }
  if (rawBranchResult == null) {
    rawBranchResult = data.outputs?.text;
  }
  if (rawBranchResult == null && data.outputs && typeof data.outputs === 'object') {
    // Last resort: grab the first string value from outputs
    const firstValue = Object.values(data.outputs).find((v) => typeof v === 'string');
    rawBranchResult = firstValue || null;
  }

  const branchResult = parseMaybeJsonObject(rawBranchResult);
  if (!branchResult) {
    throw createAgentError(`${prefix}_INVALID_RESPONSE`, 'Dify 诊断师返回缺少 outputs.branch_result', 502);
  }

  if (branchResult.success !== true) {
    throw createAgentError(`${prefix}_BUSINESS_FAILED`, 'Dify 诊断师业务校验未通过', 422, branchResult);
  }

  return {
    branchResult,
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

function mapAxiosError(agent, err) {
  const descriptor = getAgentDescriptor(agent);
  const prefix = descriptor.prefix;
  const status = err?.response?.status;

  if (status === 401) {
    return createAgentError('DIFY_AUTH_FAILED', `Dify ${descriptor.label} 上游鉴权失败 (HTTP 401)`, 502, {
      source: 'dify',
      stage: 'dify_authentication',
      upstream_status: status,
    });
  }
  if (status === 403) {
    return createAgentError('DIFY_AUTH_FAILED', `Dify ${descriptor.label} 上游权限不足 (HTTP 403)`, 502, {
      source: 'dify',
      stage: 'dify_authentication',
      upstream_status: status,
    });
  }
  if (status === 404) {
    return createAgentError('DIFY_ENDPOINT_NOT_FOUND', `Dify ${descriptor.label} API 端点不存在 (HTTP 404)`, 502, {
      source: 'dify',
      stage: 'dify_request',
      upstream_status: status,
    });
  }
  if (status === 400 || status === 422) {
    return createAgentError('DIFY_INPUT_VALIDATION_FAILED', `Dify ${descriptor.label} 请求参数校验失败 (HTTP ${status})`, 502, {
      source: 'dify',
      stage: 'dify_validation',
      upstream_status: status,
    });
  }
  if (isTimeoutError(err)) {
    return createAgentError('DIFY_TIMEOUT', `Dify ${descriptor.label} 请求超时`, 504, {
      source: 'network',
      stage: 'dify_response',
      retryable: true,
    });
  }
  if (!err?.response) {
    return createAgentError('DIFY_UNREACHABLE', `Dify ${descriptor.label} 服务无法连接`, 502, {
      source: 'network',
      stage: 'dify_connection',
      upstream_code: err?.code || null,
      retryable: true,
    });
  }
  if (status >= 500 || status === 429) {
    return createAgentError('DIFY_UNREACHABLE', `Dify ${descriptor.label} 上游服务暂不可用`, 502, {
      source: 'dify',
      stage: 'dify_request',
      upstream_status: status,
      retryable: true,
    });
  }
  return createAgentError(`${prefix}_REQUEST_REJECTED`, `Dify ${descriptor.label} 上游拒绝请求`, 502, {
    source: 'dify',
    stage: 'dify_request',
    upstream_status: status || null,
  });
}

async function runDiagnosticianWorkflow(input, options = {}) {
  const config = getDifyAgentConfig('diagnostician');
  const client = options.client || createDifyClient(config);
  const startedAt = Date.now();
  const requestBody = {
    inputs: {
      mode: input.mode,
      request_id: input.requestId,
      payload: sanitizeDifyPayload(input.payload),
      locale: input.locale || 'zh-CN',
      debug: Boolean(input.debug),
    },
    response_mode: 'blocking',
    user: input.difyUser,
  };

  let attempt = 0;
  while (attempt <= config.maxRetries) {
    try {
      const response = await client.post('/workflows/run', requestBody);
      return normalizeDiagnosticianResponse(response, {
        prefix: config.prefix,
        requestId: input.requestId,
        attempts: attempt + 1,
        startedAt,
      });
    } catch (err) {
      if (err.name === 'AgentIntegrationError') throw err;
      if (attempt < config.maxRetries && isRetryableError(err)) {
        attempt += 1;
        await sleep(Math.min(4000, RETRY_DELAY_MS * (2 ** (attempt - 1))) + Math.floor(Math.random() * 200));
        continue;
      }
      throw mapAxiosError('diagnostician', err);
    }
  }

  throw createAgentError(`${config.prefix}_UPSTREAM_UNAVAILABLE`, 'Dify 诊断师服务无法连接', 502);
}

async function openExplainerChatStream(input, options = {}) {
  const config = getDifyAgentConfig('explainer');
  const client = options.client || createDifyClient(config);
  const requestBody = {
    inputs: input.inputs,
    query: input.query,
    response_mode: 'streaming',
    conversation_id: input.conversationId || undefined,
    user: input.difyUser,
  };

  const reqId = input.inputs?.request_id || 'unknown';
  console.log(`[Explainer][${reqId}] dify_request_started method=POST path=/chat-messages baseURL=${config.baseURL}`);

  try {
    const response = await client.post('/chat-messages', requestBody, {
      responseType: 'stream',
      signal: input.signal,
      timeout: config.timeoutMs,
    });
    console.log(`[Explainer][${reqId}] dify_http_connected status=${response.status}`);
    return response;
  } catch (err) {
    console.log(`[Explainer][${reqId}] dify_request_failed stage=dify_request status=${err.response?.status || 'N/A'} error=${err.code || err.message}`);
    throw mapAxiosError('explainer', err);
  }
}

module.exports = {
  buildDifyUser,
  getDifyAgentConfig,
  hasUsableConfig,
  metadataElapsedMs,
  openExplainerChatStream,
  parseMaybeJsonObject,
  runDiagnosticianWorkflow,
  safeStringify,
  sanitizeDifyPayload,
};
