const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { configureHttpServer } = require('../src/config/http-server');

test('HTTP server defaults support slow uploads without timing out SSE sockets', () => {
  const server = http.createServer();
  const configured = configureHttpServer(server, {});

  assert.deepEqual(configured, {
    requestTimeoutMs: 1_860_000,
    headersTimeoutMs: 66_000,
    keepAliveTimeoutMs: 65_000,
    socketTimeoutMs: 0,
  });
  assert.equal(server.requestTimeout, 1_860_000);
  assert.equal(server.headersTimeout, 66_000);
  assert.equal(server.keepAliveTimeout, 65_000);
  assert.equal(server.timeout, 0);
});

test('HTTP server accepts valid overrides and rejects unsafe timeout ordering', () => {
  const server = http.createServer();
  const configured = configureHttpServer(server, {
    HTTP_REQUEST_TIMEOUT_MS: '900000',
    HTTP_HEADERS_TIMEOUT_MS: '71000',
    HTTP_KEEP_ALIVE_TIMEOUT_MS: '70000',
  });

  assert.equal(configured.requestTimeoutMs, 900_000);
  assert.throws(
    () => configureHttpServer(http.createServer(), {
      HTTP_REQUEST_TIMEOUT_MS: '60000',
      HTTP_HEADERS_TIMEOUT_MS: '66000',
      HTTP_KEEP_ALIVE_TIMEOUT_MS: '65000',
    }),
    /HTTP_HEADERS_TIMEOUT_MS 不能大于 HTTP_REQUEST_TIMEOUT_MS/,
  );
  assert.throws(
    () => configureHttpServer(http.createServer(), {
      HTTP_HEADERS_TIMEOUT_MS: '65000',
      HTTP_KEEP_ALIVE_TIMEOUT_MS: '65000',
    }),
    /HTTP_HEADERS_TIMEOUT_MS 必须大于 HTTP_KEEP_ALIVE_TIMEOUT_MS/,
  );
});
