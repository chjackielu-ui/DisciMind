const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const app = require('../src/app');
const prisma = require('../src/config/prisma');

let server;
let base;
let createdSessionId;

async function request(route, { body, cookie } = {}) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  return { response, json: await response.json() };
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});

test.after(async () => {
  if (createdSessionId) {
    await prisma.authSession.deleteMany({ where: { session_id: createdSessionId } });
    await prisma.refreshToken.deleteMany({ where: { session_id: createdSessionId } });
  }
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

test('public registration cannot create an administrator', async () => {
  const username = `blocked_admin_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const result = await request('/register', { body: { username, password: 'safe-test-password', role: 'admin' } });
  assert.equal(result.response.status, 403);
  assert.equal(result.json.code, 40301);
  assert.equal(await prisma.user.count({ where: { username } }), 0);
});

test('legacy session refresh requires the HttpOnly refresh cookie', async () => {
  const login = await request('/login', { body: { account: 'student_demo', password: '123456' } });
  assert.equal(login.response.status, 200);
  createdSessionId = login.json.data.sessionId;
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const denied = await request('/session/refresh', { body: { sessionId: createdSessionId } });
  assert.equal(denied.response.status, 401);
  assert.equal(denied.json.code, 40101);

  const refreshed = await request('/session/refresh', { cookie, body: { sessionId: createdSessionId } });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.json.data.sessionId, createdSessionId);
  assert.ok(refreshed.json.data.accessToken);
});

test('login endpoint rejects a burst after its configured limit', async () => {
  let last;
  for (let index = 0; index < 21; index += 1) {
    last = await request('/login', { body: { account: `missing_${index}`, password: 'wrong-password' } });
  }
  assert.equal(last.response.status, 429);
  assert.equal(last.json.code, 42901);
  assert.ok(Number(last.response.headers.get('retry-after')) > 0);
});
