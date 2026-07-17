const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { signToken } = require('../src/utils/jwt');

let server;
let base;
let superAdmin;
let superToken;
let readOnlyAdmin;
let assignmentlessAdmin;

async function request(method, route, token, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, json: await response.json() };
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;

  const login = await request('POST', '/auth/login', null, { account: 'admin_demo', password: '123456' });
  assert.equal(login.response.status, 200);
  superAdmin = login.json.data.user;
  superToken = login.json.data.accessToken || login.json.data.token;

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const passwordHash = await bcrypt.hash(`rbac-${suffix}`, 8);
  [readOnlyAdmin, assignmentlessAdmin] = await Promise.all([
    prisma.user.create({ data: { username: `rbac_read_${suffix}`, password_hash: passwordHash, role: 'ADMIN', status: 'ACTIVE' } }),
    prisma.user.create({ data: { username: `rbac_none_${suffix}`, password_hash: passwordHash, role: 'ADMIN', status: 'ACTIVE' } }),
  ]);
  const readOnlyRole = await prisma.adminRole.findUniqueOrThrow({ where: { role_code: 'read_only_auditor' } });
  await prisma.adminUserRole.create({ data: { user_id: readOnlyAdmin.user_id, role_id: readOnlyRole.id, granted_by: superAdmin.user_id } });
});

test.after(async () => {
  const ids = [readOnlyAdmin?.user_id, assignmentlessAdmin?.user_id].filter(Boolean);
  if (ids.length) {
    await prisma.operationLog.deleteMany({
      where: { operation_type: 'REPLACE_ADMIN_USER_ROLES', target_id: { in: ids } },
    });
    await prisma.adminUserRole.deleteMany({ where: { user_id: { in: ids } } });
    await prisma.user.deleteMany({ where: { user_id: { in: ids } } });
  }
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

test('super administrator has an explicit complete RBAC assignment', async () => {
  const access = await request('GET', '/admin/rbac/me', superToken);
  assert.equal(access.response.status, 200);
  assert.deepEqual(access.json.data.role_codes, ['super_admin']);
  assert.equal(access.json.data.permissions.length, 31);
  assert.ok(access.json.data.permissions.includes('admin.system.manage'));

  const dashboard = await request('GET', '/admin/dashboard', superToken);
  assert.equal(dashboard.response.status, 200);
});

test('read-only administrator can read but cannot call protected writes', async () => {
  const token = signToken({ user_id: readOnlyAdmin.user_id, role: 'admin' });
  const access = await request('GET', '/admin/rbac/me', token);
  assert.equal(access.response.status, 200);
  assert.deepEqual(access.json.data.role_codes, ['read_only_auditor']);
  assert.ok(access.json.data.permissions.includes('admin.dashboard.view'));
  assert.equal(access.json.data.permissions.includes('admin.system.manage'), false);

  const dashboard = await request('GET', '/admin/dashboard', token);
  assert.equal(dashboard.response.status, 200);
  const adminClasses = await request('GET', '/admin/admin-classes?page=1&page_size=5', token);
  assert.equal(adminClasses.response.status, 200);
  const teachingClasses = await request('GET', '/admin/teaching-classes?page=1&page_size=5', token);
  assert.equal(teachingClasses.response.status, 200);
  const denied = await request('POST', '/admin/notifications', token, {});
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.code, 40301);
  const deniedClassWrite = await request('POST', '/admin/admin-classes', token, { class_name: '不得创建' });
  assert.equal(deniedClassWrite.response.status, 403);
  assert.equal(deniedClassWrite.json.code, 40301);
});

test('AI provider secrets and model mutations are independently permission-protected', async () => {
  const readOnlyToken = signToken({ user_id: readOnlyAdmin.user_id, role: 'admin' });
  const providers = await request('GET', '/admin/ai/providers', readOnlyToken);
  assert.equal(providers.response.status, 200);
  assert.equal(Array.isArray(providers.json.data), true);
  assert.equal(JSON.stringify(providers.json.data).includes('secret_ciphertext'), false);

  for (const [route, body] of [
    ['/admin/ai/providers/999999/replace-secret', { api_key: 'must-not-be-accepted' }],
    ['/admin/ai/providers/999999/clear-secret', { confirm: true }],
    ['/admin/ai/models/999999/disable', {}],
  ]) {
    const denied = await request('POST', route, readOnlyToken, body);
    assert.equal(denied.response.status, 403);
    assert.equal(denied.json.code, 40301);
    assert.equal(JSON.stringify(denied.json).includes('must-not-be-accepted'), false);
  }

  const unconfirmed = await request('POST', '/admin/ai/providers/999999/clear-secret', superToken, {});
  assert.equal(unconfirmed.response.status, 400);
  const confirmed = await request('POST', '/admin/ai/providers/999999/clear-secret', superToken, { confirm: true });
  assert.equal(confirmed.response.status, 404);
  const missingModel = await request('GET', '/admin/ai/models/999999', superToken);
  assert.equal(missingModel.response.status, 404);
});

test('assignmentless administrator gets no implicit permissions', async () => {
  const token = signToken({ user_id: assignmentlessAdmin.user_id, role: 'admin' });
  const access = await request('GET', '/admin/rbac/me', token);
  assert.equal(access.response.status, 200);
  assert.deepEqual(access.json.data, { role_codes: [], permissions: [] });

  const denied = await request('GET', '/admin/dashboard', token);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.code, 40301);
});

test('database role overrides a forged legacy role in JWT claims', async () => {
  const student = await prisma.user.findFirstOrThrow({ where: { role: 'STUDENT', status: 'ACTIVE' } });
  const forged = signToken({ user_id: student.user_id, role: 'admin' });
  const denied = await request('GET', '/admin/dashboard', forged);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.code, 40301);
});

test('role replacement is permission-protected, persisted and audited', async () => {
  const readOnlyToken = signToken({ user_id: readOnlyAdmin.user_id, role: 'admin' });
  const denied = await request('PUT', `/admin/rbac/users/${readOnlyAdmin.user_id}/roles`, readOnlyToken, {
    role_codes: ['teaching_admin'], expires_at: null,
  });
  assert.equal(denied.response.status, 403);

  const changed = await request('PUT', `/admin/rbac/users/${readOnlyAdmin.user_id}/roles`, superToken, {
    role_codes: ['teaching_admin'], expires_at: null,
  });
  assert.equal(changed.response.status, 200);
  assert.deepEqual(changed.json.data.role_codes, ['teaching_admin']);
  assert.equal(await prisma.operationLog.count({
    where: { operation_type: 'REPLACE_ADMIN_USER_ROLES', target_id: readOnlyAdmin.user_id },
  }), 1);

  const restored = await request('PUT', `/admin/rbac/users/${readOnlyAdmin.user_id}/roles`, superToken, {
    role_codes: ['read_only_auditor'], expires_at: null,
  });
  assert.equal(restored.response.status, 200);
});

test('administrator cannot remove system-management permission from the current session', async () => {
  const denied = await request('PUT', `/admin/rbac/users/${superAdmin.user_id}/roles`, superToken, {
    role_codes: ['read_only_auditor'], expires_at: null,
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.code, 40301);
  const assignment = await prisma.adminUserRole.findFirst({
    where: { user_id: superAdmin.user_id, role: { role_code: 'super_admin' } },
  });
  assert.ok(assignment);
});
