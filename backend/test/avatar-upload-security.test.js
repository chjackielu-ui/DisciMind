const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { signToken } = require('../src/utils/jwt');

const avatarDir = path.resolve(__dirname, '../../storage/uploads/avatars');
const documentDir = path.resolve(__dirname, '../../storage/uploads/documents');
let server;
let api;

async function avatarFiles() {
  return new Set(await fs.readdir(avatarDir).catch(() => []));
}

async function documentFiles() {
  return new Set(await fs.readdir(documentDir).catch(() => []));
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

test('API responses expose baseline browser security headers and no framework banner', async () => {
  const response = await fetch(`${api}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('avatar upload rejects extension spoofing and forged image content without leaving files', async (t) => {
  const user = await prisma.user.findFirst({ where: { role: 'STUDENT' }, select: { user_id: true, role: true } });
  if (!user) return t.skip('测试库没有学生账号');
  const token = signToken({ user_id: user.user_id, role: 'student' });
  const before = await avatarFiles();

  const mismatched = new FormData();
  mismatched.append('avatar', new Blob(['not an image'], { type: 'image/png' }), 'avatar.txt');
  const mismatchResponse = await fetch(`${api}/auth/me/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: mismatched,
  });
  assert.equal(mismatchResponse.status, 400);

  const forged = new FormData();
  forged.append('avatar', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'avatar.png');
  const forgedResponse = await fetch(`${api}/auth/me/avatar`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: forged,
  });
  assert.equal(forgedResponse.status, 400);
  assert.match((await forgedResponse.json()).message, /文件内容与声明的图片类型不一致/);

  assert.deepEqual(await avatarFiles(), before);
});

test('teacher document upload rejects MIME and signature spoofing without leaving files', async (t) => {
  const user = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { user_id: true } });
  if (!user) return t.skip('测试库没有管理员账号');
  const token = signToken({ user_id: user.user_id, role: 'admin' });
  const before = await documentFiles();

  const mismatched = new FormData();
  mismatched.append('file', new Blob(['%PDF-forged'], { type: 'text/plain' }), 'lesson.pdf');
  const mismatchResponse = await fetch(`${api}/teacher/knowledge-documents/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: mismatched,
  });
  assert.equal(mismatchResponse.status, 400);

  const forged = new FormData();
  forged.append('file', new Blob(['not a real pdf'], { type: 'application/pdf' }), 'lesson.pdf');
  const forgedResponse = await fetch(`${api}/teacher/knowledge-documents/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: forged,
  });
  assert.equal(forgedResponse.status, 400);
  assert.match((await forgedResponse.json()).message, /文件内容与扩展名不一致/);
  assert.deepEqual(await documentFiles(), before);
});
