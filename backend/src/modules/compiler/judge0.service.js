const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const TERMINAL_STATUS_IDS = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
const MAX_RESULT_CHARS = 65_536;
const SUPPORTED_LANGUAGES = new Set(['c', 'python']);

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function getJudge0Config(env = process.env) {
  const baseURL = String(env.JUDGE0_BASE_URL || 'http://127.0.0.1:2358').replace(/\/$/, '');
  const parsedURL = new URL(baseURL);
  if (parsedURL.protocol !== 'http:' || parsedURL.username || parsedURL.password || !LOOPBACK_HOSTS.has(parsedURL.hostname)) {
    const error = new Error('JUDGE0_BASE_URL 必须是无凭据的本机 HTTP 回环地址');
    error.code = 50001;
    throw error;
  }
  return {
    baseURL,
    languageId: Math.floor(clampNumber(env.JUDGE0_C_LANGUAGE_ID, 1, 500, 50)),
    languageIds: {
      c: Math.floor(clampNumber(env.JUDGE0_C_LANGUAGE_ID, 1, 500, 50)),
      python: Math.floor(clampNumber(env.JUDGE0_PYTHON_LANGUAGE_ID, 1, 500, 71)),
    },
    cpuTimeLimit: clampNumber(env.JUDGE0_CPU_TIME_LIMIT_SECONDS, 1, 3, 2),
    wallTimeLimit: clampNumber(env.JUDGE0_WALL_TIME_LIMIT_SECONDS, 2, 6, 4),
    memoryLimitKb: Math.floor(clampNumber(env.JUDGE0_MEMORY_LIMIT_KB, 32_768, 131_072, 131_072)),
    requestTimeoutMs: Math.floor(clampNumber(env.JUDGE0_REQUEST_TIMEOUT_MS, 3_000, 20_000, 12_000)),
    pollIntervalMs: Math.floor(clampNumber(env.JUDGE0_POLL_INTERVAL_MS, 100, 1_000, 300)),
  };
}

function encode(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function decode(value) {
  if (!value) return '';
  try {
    return Buffer.from(String(value), 'base64').toString('utf8').slice(0, MAX_RESULT_CHARS);
  } catch {
    return String(value).slice(0, MAX_RESULT_CHARS);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, options, timeoutMs, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 版本不支持 fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error(`Judge0 请求失败（HTTP ${response.status}）`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Judge0 请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function classify(raw, language = 'c') {
  const statusId = Number(raw?.status?.id || 13);
  const stdout = decode(raw?.stdout);
  const compileMessage = decode(raw?.compile_output);
  const stderr = decode(raw?.stderr);
  const message = decode(raw?.message);
  let status = 'RUNTIME_ERROR';
  let statusCode = 3;
  if ([3, 4].includes(statusId)) {
    status = statusId === 4 ? 'WRONG_ANSWER' : 'SUCCESS';
    statusCode = 1;
  } else if (statusId === 5) {
    status = 'TIME_LIMIT_EXCEEDED';
    statusCode = 2;
  } else if (statusId === 6) {
    status = 'COMPILE_ERROR';
    statusCode = 0;
  } else if (statusId === 13) {
    status = 'SYSTEM_ERROR';
  }
  // Judge0 runs Python directly, so syntax errors arrive as runtime stderr.
  // Surface those as compile errors in the teaching UI.
  if (language === 'python' && status === 'RUNTIME_ERROR' && /(?:SyntaxError|IndentationError|TabError)/.test(stderr)) {
    status = 'COMPILE_ERROR';
    statusCode = 0;
  }
  return {
    status,
    statusCode,
    stdout,
    compileMessage,
    stderr,
    message,
    timeMs: raw?.time == null ? null : Math.round(Number(raw.time) * 1000),
    memoryKb: raw?.memory == null ? null : Number(raw.memory),
    judgeStatus: {
      id: statusId,
      description: String(raw?.status?.description || status),
    },
  };
}

async function pollSubmission(token, config, fetchImpl) {
  const deadline = Date.now() + config.requestTimeoutMs;
  const fields = 'stdout,stderr,compile_output,message,status,time,memory';
  while (Date.now() < deadline) {
    const result = await fetchJson(
      `${config.baseURL}/submissions/${encodeURIComponent(token)}?base64_encoded=true&fields=${fields}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      Math.max(1_000, deadline - Date.now()),
      fetchImpl,
    );
    if (TERMINAL_STATUS_IDS.has(Number(result?.status?.id))) return result;
    await delay(config.pollIntervalMs);
  }
  throw new Error('Judge0 执行结果等待超时');
}

async function executeCode({ language = 'c', sourceCode, stdin = '' }, options = {}) {
  const config = options.config || getJudge0Config(options.env);
  if (!SUPPORTED_LANGUAGES.has(language)) throw new Error('暂不支持该编程语言');
  const body = {
    language_id: config.languageIds[language],
    source_code: encode(sourceCode),
    stdin: encode(stdin),
    cpu_time_limit: config.cpuTimeLimit,
    wall_time_limit: config.wallTimeLimit,
    memory_limit: config.memoryLimitKb,
    max_file_size: 1_024,
    max_processes_and_or_threads: 30,
    // Judge0 1.13.1 cgroup mode expects cgroup v1. Docker Desktop and Ubuntu 22.04
    // commonly use cgroup v2, so use isolate's per-process limits instead.
    enable_per_process_and_thread_time_limit: true,
    enable_per_process_and_thread_memory_limit: true,
    enable_network: false,
  };
  const submitted = await fetchJson(
    `${config.baseURL}/submissions?base64_encoded=true&wait=true`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    config.requestTimeoutMs,
    options.fetch,
  );
  const raw = TERMINAL_STATUS_IDS.has(Number(submitted?.status?.id))
    ? submitted
    : await pollSubmission(submitted?.token, config, options.fetch);
  return classify(raw, language);
}

async function executeC({ sourceCode, stdin = '' }, options = {}) {
  return executeCode({ language: 'c', sourceCode, stdin }, options);
}

module.exports = { executeC, executeCode, classify, getJudge0Config, LOOPBACK_HOSTS, SUPPORTED_LANGUAGES };
