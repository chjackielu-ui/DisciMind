const DEFAULT_HTTP_TIMEOUTS = Object.freeze({
  requestTimeoutMs: 31 * 60 * 1000,
  headersTimeoutMs: 66 * 1000,
  keepAliveTimeoutMs: 65 * 1000,
});

function readTimeout(env, name, fallback, minimum, maximum) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${minimum}-${maximum} 之间的整数毫秒值`);
  }
  return value;
}

function configureHttpServer(server, env = process.env) {
  const requestTimeoutMs = readTimeout(
    env,
    'HTTP_REQUEST_TIMEOUT_MS',
    DEFAULT_HTTP_TIMEOUTS.requestTimeoutMs,
    60_000,
    60 * 60 * 1000,
  );
  const headersTimeoutMs = readTimeout(
    env,
    'HTTP_HEADERS_TIMEOUT_MS',
    DEFAULT_HTTP_TIMEOUTS.headersTimeoutMs,
    5_000,
    120_000,
  );
  const keepAliveTimeoutMs = readTimeout(
    env,
    'HTTP_KEEP_ALIVE_TIMEOUT_MS',
    DEFAULT_HTTP_TIMEOUTS.keepAliveTimeoutMs,
    1_000,
    120_000,
  );

  if (headersTimeoutMs > requestTimeoutMs) {
    throw new Error('HTTP_HEADERS_TIMEOUT_MS 不能大于 HTTP_REQUEST_TIMEOUT_MS');
  }
  if (headersTimeoutMs <= keepAliveTimeoutMs) {
    throw new Error('HTTP_HEADERS_TIMEOUT_MS 必须大于 HTTP_KEEP_ALIVE_TIMEOUT_MS');
  }

  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  server.keepAliveTimeout = keepAliveTimeoutMs;

  // SSE and upgraded WebSocket connections have their own heartbeat/lifecycle.
  // A socket inactivity timeout here would terminate otherwise healthy streams.
  server.setTimeout(0);

  return { requestTimeoutMs, headersTimeoutMs, keepAliveTimeoutMs, socketTimeoutMs: 0 };
}

module.exports = { DEFAULT_HTTP_TIMEOUTS, configureHttpServer, readTimeout };
