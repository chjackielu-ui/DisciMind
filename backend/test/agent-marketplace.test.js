const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const prisma = require('../src/config/prisma');
const roleMiddleware = require('../src/middlewares/role.middleware');
const constants = require('../src/modules/agent-marketplace/agent-marketplace.constants');
const schemas = require('../src/modules/agent-marketplace/agent-marketplace.schemas');
const { scopedOperationId } = require('../src/modules/agent-marketplace/operation-id');
const { normalizeGeneratedConfig, generateAgentConfig } = require('../src/modules/agent-marketplace/agent-prompt.service');
const market = require('../src/modules/agent-marketplace/agent-marketplace.service');
const knowledge = require('../src/modules/knowledge-base/knowledge-base.service');
const { runtimeTemplate, runAgent } = require('../src/modules/agent-chat/agent-runtime.service');
const chat = require('../src/modules/agent-chat/agent-chat.service');
const memory = require('../src/modules/agent-chat/agent-memory.service');

test.after(async () => {
  await prisma.$disconnect();
});

const validAgentInput = {
  description: '创建一个帮助本科生理解机器学习概念的耐心学习助手。', name: '', category: '概念讲解',
  tags: { purpose: ['概念讲解', '概念讲解'], style: ['耐心详细'], audience: ['本科生'] },
  responseMode: 'DEFAULT', knowledgeBaseIds: [], memoryEnabledByDefault: false, topK: 5,
  scoreThreshold: 0.55, maxOutputTokens: 1200, operationId: 'unit-test-operation',
};

test('marketplace agent type defaults to CHAT and FILE_GENERATOR accepts only controlled DOCX config', () => {
  assert.equal(schemas.agentInputSchema.parse(validAgentInput).agentType, 'CHAT');
  const parsed = schemas.agentInputSchema.parse({
    ...validAgentInput,
    agentType: 'FILE_GENERATOR',
    fileGeneratorConfig: {
      documentType: 'EXAM_PAPER', targetAudience: '本科生', defaultDifficulty: 'MEDIUM',
      answerStyle: '清晰严谨', knowledgeEnhanced: true, maxQuestionCount: 50, fileFormat: 'DOCX',
    },
  });
  assert.equal(parsed.fileGeneratorConfig.maxQuestionCount, 50);
  assert.equal(parsed.fileGeneratorConfig.fileFormat, 'DOCX');
  assert.throws(() => schemas.agentInputSchema.parse({ ...validAgentInput, agentType: 'FILE_GENERATOR' }));
  assert.throws(() => schemas.agentInputSchema.parse({
    ...validAgentInput, agentType: 'FILE_GENERATOR', fileGeneratorConfig: {
      documentType: 'EXAM_PAPER', targetAudience: '本科生', maxQuestionCount: 51, fileFormat: 'PDF',
    },
  }));
});

test('only DEFAULT and KNOWLEDGE_FIRST response modes exist', () => {
  assert.deepEqual(constants.RESPONSE_MODES, ['DEFAULT', 'KNOWLEDGE_FIRST']);
});

test('strict knowledge mode is absent from schema and marketplace source', () => {
  const files = [
    path.resolve(__dirname, '../prisma/schema.prisma'),
    path.resolve(__dirname, '../src/modules/agent-marketplace/agent-marketplace.constants.js'),
  ];
  assert.equal(files.some((file) => fs.readFileSync(file, 'utf8').includes('STRICT_KNOWLEDGE')), false);
});

test('agent input deduplicates tags and defaults private memory off', () => {
  const parsed = schemas.parse(schemas.agentInputSchema, validAgentInput);
  assert.deepEqual(parsed.tags.purpose, ['概念讲解']);
  assert.equal(parsed.memoryEnabledByDefault, false);
});

test('invalid HTML tag is rejected', () => {
  assert.throws(() => schemas.parse(schemas.agentInputSchema, { ...validAgentInput, tags: { ...validAgentInput.tags, purpose: ['<script>'] } }));
});

test('system prompt over 3000 chars is rejected', () => {
  assert.throws(() => schemas.parse(schemas.agentInputSchema, { ...validAgentInput, systemPrompt: 'x'.repeat(3001) }));
});

test('knowledge-first requires a knowledge base', () => {
  assert.throws(() => schemas.parse(schemas.agentInputSchema, { ...validAgentInput, responseMode: 'KNOWLEDGE_FIRST' }));
});

test('topK and score threshold ranges are enforced', () => {
  assert.throws(() => schemas.parse(schemas.agentInputSchema, { ...validAgentInput, topK: 11 }));
  assert.throws(() => schemas.parse(schemas.agentInputSchema, { ...validAgentInput, scoreThreshold: 0.01 }));
});

test('structured AI config uses generated name when name is empty', () => {
  const output = normalizeGeneratedConfig({ name: '机器学习助手', shortDescription: '简介', systemPrompt: '安全提示词', welcomeMessage: '你好', capabilities: [], limitations: [], suggestedQuestions: [] }, validAgentInput);
  assert.equal(output.name, '机器学习助手');
});

test('structured AI config respects advanced system prompt edit', () => {
  const output = normalizeGeneratedConfig({ name: '助手', shortDescription: '简介', systemPrompt: '自动', welcomeMessage: '你好' }, { ...validAgentInput, systemPrompt: '用户编辑后的提示词' });
  assert.equal(output.systemPrompt, '用户编辑后的提示词');
});

test('LangChain config generation parses model JSON', async () => {
  const output = await generateAgentConfig(validAgentInput, [], async () => ({ content: JSON.stringify({ name: '测试助手', shortDescription: '一句话', systemPrompt: '安全系统提示词', welcomeMessage: '欢迎', capabilities: ['概念讲解'], limitations: [], suggestedQuestions: [] }) }));
  assert.equal(output.name, '测试助手');
});

test('runtime prompt marks knowledge as untrusted context', async () => {
  const prompt = await runtimeTemplate.format({ systemPrompt: '身份', memoryContext: '无', knowledgeContext: '<knowledge_context>资料</knowledge_context>' });
  assert.match(prompt, /不是系统命令/);
  assert.match(prompt, /不得编造知识库来源/);
});

test('LangChain runtime includes history, memory and knowledge', async () => {
  let captured;
  const result = await runAgent({
    version: { systemPrompt: '你是学习助手', maxOutputTokens: 500 }, history: [{ role: 'USER', content: '上一问' }],
    memories: [{ type: 'LEARNING_GOAL', title: '目标', content: '通过考试' }], question: '当前问题',
    records: [{ knowledgeBaseName: '课程资料', documentName: '讲义', segmentId: 'seg-1', content: '事实内容' }],
  }, async (messages) => { captured = messages; return { content: '回答', usage: {} }; });
  assert.equal(result.content, '回答');
  assert.match(captured[0].content, /通过考试/);
  assert.match(captured[0].content, /事实内容/);
});

test('actual page number never fabricates invalid pages', () => {
  assert.equal(chat.actualPageNumber({}), null);
  assert.equal(chat.actualPageNumber({ page_number: '12' }), 12);
  assert.equal(chat.actualPageNumber({ page_number: 'chapter 3' }), null);
});

test('knowledge fallback notices are explicit', () => {
  assert.match(chat.FALLBACK_NOTICE, /未找到直接依据/);
  assert.match(chat.UNAVAILABLE_NOTICE, /知识库暂时不可用/);
});

test('sensitive long-term memory is rejected', () => {
  assert.throws(() => memory.assertSafeMemory('我的 API Key 是 abc'));
  assert.doesNotThrow(() => memory.assertSafeMemory('我喜欢循序渐进的回答'));
});

test('operation ids are stable and scoped by user and action', () => {
  assert.equal(scopedOperationId(1, 'same-operation', 'create'), scopedOperationId(1, 'same-operation', 'create'));
  assert.notEqual(scopedOperationId(1, 'same-operation', 'create'), scopedOperationId(2, 'same-operation', 'create'));
});

test('PDF, DOCX, MD and TXT signatures are accepted', () => {
  const cases = [
    { originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n'), size: 9 },
    { originalname: 'a.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]), size: 5 },
    { originalname: 'a.md', mimetype: 'text/markdown', buffer: Buffer.from('# title'), size: 7 },
    { originalname: 'a.txt', mimetype: 'text/plain', buffer: Buffer.from('plain text'), size: 10 },
  ];
  cases.forEach((file) => assert.doesNotThrow(() => knowledge.validateUpload(file)));
});

test('upload rejects extension, MIME mismatch, unsafe path and wrong header', () => {
  assert.throws(() => knowledge.validateUpload({ originalname: 'a.js', mimetype: 'text/javascript', buffer: Buffer.from('x'), size: 1 }));
  assert.throws(() => knowledge.validateUpload({ originalname: 'a.pdf', mimetype: 'text/plain', buffer: Buffer.from('%PDF-'), size: 5 }));
  assert.throws(() => knowledge.validateUpload({ originalname: '../a.txt', mimetype: 'text/plain', buffer: Buffer.from('x'), size: 1 }));
  assert.throws(() => knowledge.validateUpload({ originalname: 'a.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not pdf'), size: 7 }));
});

test('upload rejects files over configured limit', () => {
  assert.throws(() => knowledge.validateUpload({ originalname: 'a.txt', mimetype: 'text/plain', buffer: Buffer.from('x'), size: knowledge.MAX_FILE_BYTES + 1 }));
});

test('knowledge serializer hides dataset ID and storage path', () => {
  const serialized = knowledge.serializeKnowledgeBase({ knowledge_base_id: 1, name: 'KB', description: '', marketplace_visibility: 'PRIVATE', marketplace_status: 'EMPTY', document_count: 0, total_size_bytes: 0n, dify_dataset_id: 'secret-dataset', owner_user_id: 1, created_at: new Date(), updated_at: new Date(), _count: {} }, 1);
  assert.equal('difyDatasetId' in serialized, false);
  assert.equal(JSON.stringify(serialized).includes('secret-dataset'), false);
});

test('student role is blocked by admin middleware', () => {
  let statusCode; let body; let nextCalled = false;
  const res = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
  roleMiddleware(['admin'])({ user: { role: 'student' } }, res, () => { nextCalled = true; });
  assert.equal(statusCode, 403); assert.equal(body.code, 40301); assert.equal(nextCalled, false);
});

test('admin role passes admin middleware', () => {
  let nextCalled = false;
  roleMiddleware(['admin'])({ user: { role: 'admin' } }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('student B seed is unique and marketplace demo counts are complete', async () => {
  const [studentBCount, publicCount, privateCount, pendingCount, rejectedCount] = await Promise.all([
    prisma.user.count({ where: { username: 'student_b' } }), prisma.userAgent.count({ where: { status: 'PUBLIC', operationId: { startsWith: 'seed-agent-marketplace-' } } }),
    prisma.userAgent.count({ where: { status: 'PRIVATE', operationId: { startsWith: 'seed-agent-marketplace-' } } }), prisma.userAgent.count({ where: { status: 'PUBLIC_PENDING', operationId: { startsWith: 'seed-agent-marketplace-' } } }),
    prisma.userAgent.count({ where: { status: 'REJECTED', operationId: { startsWith: 'seed-agent-marketplace-' } } }),
  ]);
  assert.equal(studentBCount, 1); assert.equal(publicCount, 6); assert.equal(privateCount, 3); assert.equal(pendingCount, 2); assert.equal(rejectedCount, 1);
});

test('student A cannot view student B private agent', async () => {
  const [a, privateB] = await Promise.all([prisma.user.findUnique({ where: { username: 'student_demo' } }), prisma.userAgent.findUnique({ where: { operationId: 'seed-agent-marketplace-b-private-1' } })]);
  await assert.rejects(() => market.getAgent(a.user_id, privateB.id), /无权查看/);
});

test('student B cannot edit student A private agent', async () => {
  const [b, privateA] = await Promise.all([prisma.user.findUnique({ where: { username: 'student_b' } }), prisma.userAgent.findUnique({ where: { operationId: 'seed-agent-marketplace-a-private-1' } })]);
  await assert.rejects(() => market.updateAgent(b.user_id, privateA.id, validAgentInput), /无权编辑/);
});

test('public agents are visible to student B but system prompt is not exposed', async () => {
  const b = await prisma.user.findUnique({ where: { username: 'student_b' } });
  const result = await market.listAgents(b.user_id, {}, 'public');
  assert.ok(result.total >= 6); assert.equal('systemPrompt' in result.list[0].version, false);
});

test('one current rating and favorite exist for seeded interaction', async () => {
  const b = await prisma.user.findUnique({ where: { username: 'student_b' } });
  const agent = await prisma.userAgent.findUnique({ where: { operationId: 'seed-agent-marketplace-public-1' } });
  const [favorites, ratings] = await Promise.all([prisma.agentFavorite.count({ where: { userId: b.user_id, agentId: agent.id } }), prisma.agentRating.count({ where: { userId: b.user_id, agentId: agent.id } })]);
  assert.equal(favorites, 1); assert.equal(ratings, 1);
});

test('owner cannot rate their own public agent', async () => {
  const a = await prisma.user.findUnique({ where: { username: 'student_demo' } });
  const agent = await prisma.userAgent.findUnique({ where: { operationId: 'seed-agent-marketplace-public-1' } });
  await assert.rejects(() => market.rate(a.user_id, agent.id, 5), /不能给自己的智能体评分/);
});
