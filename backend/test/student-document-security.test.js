const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');

const app = require('../src/app');
const prisma = require('../src/config/prisma');
const documentService = require('../src/services/student-document.service');
const { signToken } = require('../src/utils/jwt');

let server;
let origin;
let api;
let documentId;
let storedPath;

async function jsonRequest(method, route, token, body) {
  const response = await fetch(`${api}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, data: await response.json().catch(() => ({})) };
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  api = `${origin}/api`;
});

test.after(async () => {
  if (documentId) {
    const record = await prisma.knowledgeDocument.findUnique({ where: { document_id: documentId } }).catch(() => null);
    if (record) {
      await prisma.knowledgeDocument.delete({ where: { document_id: documentId } }).catch(() => null);
      storedPath = storedPath || documentService.resolveDocumentStoragePath(record.file_url);
    }
  }
  if (storedPath) await fs.unlink(storedPath).catch(() => null);
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

test('student document upload, parse and download are owner-scoped and never publicly static', async () => {
  const students = await prisma.user.findMany({ where: { role: 'STUDENT' }, orderBy: { user_id: 'asc' }, take: 2, select: { user_id: true } });
  assert.equal(students.length, 2, '测试库至少需要两个学生账号');
  const ownerToken = signToken({ user_id: students[0].user_id, role: 'student' });
  const otherToken = signToken({ user_id: students[1].user_id, role: 'student' });
  const prefix = `CODEX-HARDENING-${crypto.randomUUID()}`;

  const forged = new FormData();
  forged.append('file', new Blob(['not a pdf'], { type: 'text/plain' }), `${prefix}.pdf`);
  forged.append('title', `${prefix}-forged`);
  const forgedResponse = await fetch(`${api}/student/documents/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: forged,
  });
  assert.equal(forgedResponse.status, 400);

  const form = new FormData();
  form.append('file', new Blob(['DisciMind hardening document\n\nowner scoped content'], { type: 'text/plain' }), `${prefix}.txt`);
  form.append('title', prefix);
  form.append('visibility', 'private');
  const uploadResponse = await fetch(`${api}/student/documents/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: form,
  });
  const upload = await uploadResponse.json();
  assert.equal(uploadResponse.status, 200);
  documentId = upload.data.document_id;

  const record = await prisma.knowledgeDocument.findUnique({ where: { document_id: documentId } });
  assert.match(record.file_url, /^\/uploads\/documents\/doc-/);
  storedPath = documentService.resolveDocumentStoragePath(record.file_url);
  await fs.access(storedPath);

  const publicBypass = await fetch(`${origin}${record.file_url}`);
  assert.equal(publicBypass.status, 404);
  const anonymousDownload = await fetch(`${api}/student/documents/${documentId}/download`);
  assert.equal(anonymousDownload.status, 401);
  const otherDownload = await fetch(`${api}/student/documents/${documentId}/download`, { headers: { Authorization: `Bearer ${otherToken}` } });
  assert.equal(otherDownload.status, 403);

  const parse = await jsonRequest('POST', `/student/documents/${documentId}/parse`, ownerToken);
  assert.equal(parse.response.status, 200);
  assert.ok(['parsed', 'chunked'].includes(parse.data.data.parse_status));
  assert.ok(parse.data.data.chunk_count >= 1);

  const detail = await jsonRequest('GET', `/student/documents/${documentId}`, ownerToken);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.data.download_url, `/api/student/documents/${documentId}/download`);
  assert.equal(Object.hasOwn(detail.data.data, 'file_url'), false);

  const download = await fetch(`${api}/student/documents/${documentId}/download`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') || '', /attachment/i);
  assert.equal(await download.text(), 'DisciMind hardening document\n\nowner scoped content');

  const deleted = await jsonRequest('DELETE', `/student/documents/${documentId}`, ownerToken);
  assert.equal(deleted.response.status, 200);
  assert.equal(await prisma.knowledgeDocument.count({ where: { document_id: documentId } }), 0);
  await assert.rejects(fs.access(storedPath));
  documentId = null;
  storedPath = null;
});
