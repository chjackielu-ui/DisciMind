const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const exporter = require('../src/modules/file-generator/document-export.service');

let server;
let base;
let agentId;
let artifactId;
const taskIds = [];

async function request(method, route, token, body, json = true) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, data: json ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}

async function login(account) {
  const result = await request('POST', '/auth/login', null, { account, password: '123456' });
  assert.equal(result.response.status, 200);
  return { token: result.data.data.accessToken, user: result.data.data.user };
}

function content() {
  return {
    title: 'HTTP 逻辑回归讲义', course: '机器学习', knowledgePoints: ['逻辑回归'], learningObjectives: ['理解逻辑回归'], prerequisites: ['线性代数'],
    sections: [{ id: 'S1', title: '核心概念', content: ['逻辑回归用于二分类。'] }], examples: [{ title: '示例', content: '预测样本为正类的概率。' }],
    keyPoints: ['Sigmoid'], commonMistakes: ['混淆概率和类别'], practice: [{ question: '阈值是什么？', answer: '分类边界。', analysis: '用于把概率转为类别。' }],
    summary: ['逻辑回归是分类模型。'], sourceNotice: '本内容由 AI 通用知识生成，请核验。',
  };
}

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  if (taskIds.length) await prisma.asyncTask.deleteMany({ where: { id: { in: taskIds } } });
  if (artifactId) {
    const artifact = await prisma.generatedArtifact.findUnique({ where: { id: artifactId } }).catch(() => null);
    if (artifact?.storagePath) await fs.unlink(exporter.resolveStoredPath(artifact.storagePath)).catch(() => null);
    const exports = await prisma.generatedArtifactExport.findMany({ where: { artifactId }, select: { storagePath: true } });
    for (const item of exports) if (item.storagePath) await fs.unlink(exporter.resolveStoredPath(item.storagePath)).catch(() => null);
    await prisma.generatedArtifactExport.deleteMany({ where: { artifactId } });
    await prisma.generatedArtifact.deleteMany({ where: { id: artifactId } });
  }
  if (agentId) await prisma.userAgent.deleteMany({ where: { id: agentId } });
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

test('artifact HTTP list/detail/download/export enforce ownership without exposing paths', async () => {
  const [owner, other] = await Promise.all([login('student_demo'), login('student_b')]);
  const category = await prisma.agentCategory.findFirst();
  const agent = await prisma.userAgent.create({ data: {
    creatorUserId: other.user.user_id, agentType: 'FILE_GENERATOR', status: 'PUBLIC', visibility: 'PUBLIC', categoryId: category?.id,
    operationId: `http-stage6-agent:${crypto.randomUUID()}`,
  } });
  agentId = agent.id;
  const version = await prisma.userAgentVersion.create({ data: {
    agentId, versionNumber: 1, name: 'HTTP 阶段六生成器', shortDescription: 'HTTP Artifact 验收', systemPrompt: '受控生成', welcomeMessage: '描述需求',
    reviewStatus: 'APPROVED', responseMode: 'DEFAULT', fileGeneratorConfigJson: { documentType: 'STUDY_HANDOUT', fileFormat: 'DOCX' },
  } });
  await prisma.userAgent.update({ where: { id: agentId }, data: { currentDraftVersionId: version.id, currentPublicVersionId: version.id } });
  const conversation = await prisma.marketplaceAgentConversation.create({ data: {
    userId: owner.user.user_id, agentId, agentVersionId: version.id, operationId: `http-stage6-conversation:${crypto.randomUUID()}`,
  } });
  const artifact = await prisma.generatedArtifact.create({ data: {
    ownerUserId: owner.user.user_id, agentId, conversationId: conversation.id, operationId: crypto.randomUUID(), artifactType: 'STUDY_HANDOUT', title: content().title,
    requirementsJson: { artifactType: 'STUDY_HANDOUT', title: content().title, courseName: '机器学习', knowledgePointNames: ['逻辑回归'], outputFormat: 'DOCX' },
    contentSchemaJson: content(), previewHtml: '<article>安全预览</article>', status: 'CONTENT_READY', fileFormat: 'DOCX',
  } });
  artifactId = artifact.id;
  await exporter.exportArtifact(artifact.id);

  const list = await request('GET', '/generated-artifacts?pageSize=100', owner.token);
  assert.equal(list.response.status, 200);
  assert.ok(list.data.data.list.some((item) => item.id === artifact.id));
  assert.equal(JSON.stringify(list.data).includes('storagePath'), false);

  const detail = await request('GET', `/generated-artifacts/${artifact.id}`, owner.token);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.data.id, artifact.id);
  assert.match(detail.data.data.previewHtml, /安全预览/);
  assert.equal(JSON.stringify(detail.data).includes('storagePath'), false);

  const deniedDetail = await request('GET', `/generated-artifacts/${artifact.id}`, other.token);
  assert.equal(deniedDetail.response.status, 403);
  const deniedDownload = await request('GET', `/generated-artifacts/${artifact.id}/download`, other.token);
  assert.equal(deniedDownload.response.status, 403);

  const download = await request('GET', `/generated-artifacts/${artifact.id}/download`, owner.token, null, false);
  assert.equal(download.response.status, 200);
  assert.match(download.response.headers.get('content-type'), /wordprocessingml/);
  assert.match(download.response.headers.get('content-disposition'), /filename\*=UTF-8/);
  assert.deepEqual([...download.data.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const accessed = await prisma.generatedArtifact.findUnique({ where: { id: artifact.id } });
  assert.ok(accessed.lastAccessedAt);

  const operationId = crypto.randomUUID();
  const first = await request('POST', `/generated-artifacts/${artifact.id}/export`, owner.token, { operationId });
  const second = await request('POST', `/generated-artifacts/${artifact.id}/export`, owner.token, { operationId });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.data.task.taskType, 'DOCUMENT_EXPORT');
  assert.equal(first.data.data.task.id, second.data.data.task.id);
  taskIds.push(first.data.data.task.id);
});
