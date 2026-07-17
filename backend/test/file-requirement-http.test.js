const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const requirements = require('../src/modules/file-generator/file-requirement.service');

let server; let base; let agentId; let conversationId; let artifactId; let taskId;
async function request(method, route, token, body) {
  const response = await fetch(`${base}${route}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { response, json: await response.json() };
}
async function login(account) { const result = await request('POST', '/auth/login', null, { account, password: '123456' }); return { token: result.json.data.accessToken, user: result.json.data.user }; }

test.before(async () => { server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(async () => {
  if (artifactId) await prisma.generatedArtifact.deleteMany({ where: { id: artifactId } });
  if (taskId) await prisma.asyncTask.deleteMany({ where: { id: taskId } });
  if (agentId) await prisma.userAgent.deleteMany({ where: { id: agentId } });
  await new Promise(resolve => server.close(resolve)); await prisma.$disconnect();
});

test('file requirement HTTP endpoints isolate draft and confirm idempotently', async () => {
  const [owner, other] = await Promise.all([login('student_demo'), login('student_b')]);
  const category = await prisma.agentCategory.findFirst();
  const agent = await prisma.userAgent.create({ data: { creatorUserId: other.user.user_id, agentType: 'FILE_GENERATOR', status: 'PUBLIC', visibility: 'PUBLIC', categoryId: category.id, operationId: `http-file:${crypto.randomUUID()}` } }); agentId = agent.id;
  const version = await prisma.userAgentVersion.create({ data: { agentId, versionNumber: 1, name: 'HTTP 文件生成器', shortDescription: 'HTTP 文件需求专项验收生成器', systemPrompt: '受控生成', welcomeMessage: '描述需求', reviewStatus: 'APPROVED', fileGeneratorConfigJson: { documentType: 'EXAM_PAPER', fileFormat: 'DOCX' } } });
  await prisma.userAgent.update({ where: { id: agentId }, data: { currentPublicVersionId: version.id, currentDraftVersionId: version.id } });
  const conversation = await prisma.marketplaceAgentConversation.create({ data: { userId: owner.user.user_id, agentId, agentVersionId: version.id, operationId: `http-file-conv:${crypto.randomUUID()}` } }); conversationId = conversation.id;
  const candidates = await requirements.accessibleCandidates(owner.user.user_id); const course = candidates.publicCourses[0]; const point = candidates.publicKnowledgePoints.find(item => item.courseKey === course.courseKey);
  const patch = await request('PATCH', `/agent-conversations/${conversationId}/file-requirements`, owner.token, { artifactType: 'EXAM_PAPER', courseKey: course.courseKey, knowledgePointKeys: [point.knowledgePointKey], title: 'HTTP 试卷', difficulty: 'BASIC', questionCount: 10, includeAnswers: true, includeAnalysis: true, outputFormat: 'DOCX' });
  assert.equal(patch.response.status, 200); assert.equal(patch.json.data.readyForConfirmation, true); assert.equal('courseId' in patch.json.data, false);
  const denied = await request('GET', `/agent-conversations/${conversationId}/file-requirements`, other.token); assert.equal(denied.response.status, 403);
  const previous = process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER; process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER = '100';
  const operationId = crypto.randomUUID(); const first = await request('POST', `/agent-conversations/${conversationId}/file-confirm`, owner.token, { operationId }); const second = await request('POST', `/agent-conversations/${conversationId}/file-confirm`, owner.token, { operationId });
  if (previous === undefined) delete process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER; else process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER = previous;
  assert.equal(first.response.status, 200); assert.equal(second.response.status, 200); assert.equal(first.json.data.artifact.id, second.json.data.artifact.id); assert.equal(first.json.data.task.id, second.json.data.task.id);
  artifactId = first.json.data.artifact.id; taskId = first.json.data.task.id;
});
