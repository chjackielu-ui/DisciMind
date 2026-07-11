const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mammoth = require('mammoth');
const prisma = require('../src/config/prisma');
const schemas = require('../src/modules/file-generator/file-content.schemas');
const quality = require('../src/modules/file-generator/file-quality.service');
const generation = require('../src/modules/file-generator/file-generation.service');
const exporter = require('../src/modules/file-generator/document-export.service');
const artifacts = require('../src/modules/file-generator/generated-artifact.service');

const createdAgentIds = [];
const createdArtifactIds = [];
const createdTaskIds = [];
let owner;
let creator;
let fixtureContext;

function question(index = 1) {
  return {
    id: `Q${index}`,
    type: 'SINGLE_CHOICE',
    stem: `逻辑回归题目 ${index}`,
    options: ['选项 A', '选项 B', '选项 C'],
    answer: 'A',
    analysis: `题目 ${index} 的解析`,
    score: 10,
    knowledgePoint: '逻辑回归',
    difficulty: 'BASIC',
  };
}

function examContent(count = 10) {
  const questions = Array.from({ length: count }, (_, index) => ({ ...question(index + 1), score: 100 / count }));
  return {
    title: '逻辑回归基础练习', course: '机器学习', knowledgePoints: ['逻辑回归'], difficulty: 'BASIC', duration: 30, totalScore: 100,
    instructions: ['请独立完成。'], sections: [{ id: 'S1', title: '基础题', questionIds: questions.map((item) => item.id) }], questions,
    answers: questions.map((item) => ({ questionId: item.id, answer: item.answer })), analysis: questions.map((item) => ({ questionId: item.id, analysis: item.analysis })),
    sourceNotice: '本内容由 AI 通用知识生成，请核验。',
  };
}

function handoutContent() {
  return {
    title: '逻辑回归学习讲义', course: '机器学习', knowledgePoints: ['逻辑回归'], learningObjectives: ['理解逻辑回归'], prerequisites: ['线性代数'],
    sections: [{ id: 'S1', title: '核心概念', content: ['逻辑回归用于分类。'] }], examples: [{ title: '二分类', content: '预测正类概率。' }],
    keyPoints: ['Sigmoid 函数'], commonMistakes: ['把概率当作类别'], practice: [{ question: '阈值有什么作用？', answer: '将概率映射为类别。', analysis: '阈值控制决策边界。' }],
    summary: ['逻辑回归是概率分类模型。'], sourceNotice: '参考知识库资料：机器学习 / 讲义.docx。内容由 AI 辅助整理，请核验。',
  };
}

async function createFixture() {
  if (fixtureContext) return fixtureContext;
  owner = await prisma.user.findUnique({ where: { username: 'student_demo' } });
  creator = await prisma.user.findUnique({ where: { username: 'student_b' } });
  const category = await prisma.agentCategory.findFirst();
  const agent = await prisma.userAgent.create({ data: {
    creatorUserId: creator.user_id, agentType: 'FILE_GENERATOR', status: 'PUBLIC', visibility: 'PUBLIC', categoryId: category?.id,
    operationId: `test-stage6-agent:${crypto.randomUUID()}`,
  } });
  createdAgentIds.push(agent.id);
  const version = await prisma.userAgentVersion.create({ data: {
    agentId: agent.id, versionNumber: 1, name: '阶段六文件生成器', shortDescription: 'GeneratedArtifact 专项测试', systemPrompt: '受控教育文件生成',
    welcomeMessage: '请描述文件需求', reviewStatus: 'APPROVED', responseMode: 'DEFAULT',
    fileGeneratorConfigJson: { documentType: 'EXAM_PAPER', fileFormat: 'DOCX', maxQuestionCount: 50 },
  } });
  await prisma.userAgent.update({ where: { id: agent.id }, data: { currentDraftVersionId: version.id, currentPublicVersionId: version.id } });
  const conversation = await prisma.marketplaceAgentConversation.create({ data: {
    userId: owner.user_id, agentId: agent.id, agentVersionId: version.id, operationId: `test-stage6-conversation:${crypto.randomUUID()}`,
  } });
  fixtureContext = { agent, version, conversation };
  return fixtureContext;
}

async function createArtifact({ type = 'EXAM_PAPER', content = examContent(), status = 'CONTENT_READY' } = {}) {
  const { agent, conversation } = await createFixture();
  const record = await prisma.generatedArtifact.create({ data: {
    ownerUserId: owner.user_id, agentId: agent.id, conversationId: conversation.id, operationId: crypto.randomUUID(), artifactType: type,
    title: content.title || '测试文件', requirementsJson: type === 'EXAM_PAPER'
      ? { artifactType: type, title: content.title, courseName: '机器学习', knowledgePointNames: ['逻辑回归'], difficulty: 'BASIC', questionCount: content.questions?.length || 10, includeAnswers: true, includeAnalysis: true, outputFormat: 'DOCX' }
      : { artifactType: type, title: content.title, courseName: '机器学习', knowledgePointNames: ['逻辑回归'], difficulty: 'BASIC', outputFormat: 'DOCX' },
    contentSchemaJson: content, previewHtml: '<article>安全预览</article>', fileFormat: 'DOCX', status,
  } });
  createdArtifactIds.push(record.id);
  return record;
}

test.after(async () => {
  for (const id of createdArtifactIds) {
    const record = await prisma.generatedArtifact.findUnique({ where: { id } }).catch(() => null);
    if (record?.storagePath) await fs.unlink(exporter.resolveStoredPath(record.storagePath)).catch(() => null);
  }
  if (createdTaskIds.length) await prisma.asyncTask.deleteMany({ where: { id: { in: createdTaskIds } } });
  if (createdArtifactIds.length) await prisma.generatedArtifact.deleteMany({ where: { id: { in: createdArtifactIds } } });
  if (createdAgentIds.length) await prisma.userAgent.deleteMany({ where: { id: { in: createdAgentIds } } });
  await prisma.$disconnect();
});

test('EXAM_PAPER and STUDY_HANDOUT schemas accept their complete structures', () => {
  assert.equal(schemas.examPaperSchema.parse(examContent()).questions.length, 10);
  assert.equal(schemas.studyHandoutSchema.parse(handoutContent()).sections.length, 1);
});

test('JSON structure uses exactly one repair and terminates when repaired output is still invalid', async () => {
  let calls = 0;
  const repaired = await generation.callJson('test', schemas.examPaperSchema, async () => {
    calls += 1;
    return { content: calls === 1 ? '{"broken":true}' : JSON.stringify(examContent()) };
  }, 'exam');
  assert.equal(repaired.title, examContent().title);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(() => generation.callJson('test', schemas.examPaperSchema, async () => {
    calls += 1;
    return { content: '{"still":"invalid"}' };
  }, 'exam'), (error) => error.code === 'CONTENT_SCHEMA_REPAIR_FAILED');
  assert.equal(calls, 2);
});

test('50-question exam generation is split into deterministic batches of at most ten', async () => {
  const artifact = { requirementsJson: { title: '五十题试卷', courseName: '机器学习', knowledgePointNames: ['逻辑回归'], difficulty: 'BASIC', questionCount: 50 } };
  let calls = 0;
  const result = await generation.generateExam(artifact, async () => {
    calls += 1;
    return { content: JSON.stringify(Array.from({ length: 10 }, (_, index) => question(((calls - 1) * 10) + index + 1))) };
  }, null);
  assert.equal(calls, 5);
  assert.equal(result.questions.length, 50);
  assert.equal(result.sections.length, 5);
  assert.equal(result.questions[49].id, 'Q50');
  assert.equal(quality.validateQuality('EXAM_PAPER', result, { questionCount: 50 }).ok, true);
});

test('quality checks reject duplicate stems, answer-option mismatch and inconsistent total score', () => {
  const content = examContent(2);
  content.questions[1].stem = content.questions[0].stem;
  content.questions[1].answer = 'Z';
  content.totalScore = 99;
  const result = quality.validateQuality('EXAM_PAPER', content, { questionCount: 2 });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.includes('重复')));
  assert.ok(result.issues.some((item) => item.includes('选项')));
  assert.ok(result.issues.some((item) => item.includes('总分')));
});

test('quality repair applies one minimal patch instead of regenerating the whole document', async () => {
  const content = examContent(2);
  content.questions[1].stem = content.questions[0].stem;
  let calls = 0;
  const repaired = await generation.repairQualityOnce({ artifactType: 'EXAM_PAPER', requirementsJson: { questionCount: 2 } }, content, ['存在重复题目'], async () => {
    calls += 1;
    return { content: JSON.stringify({ questionPatches: [{ id: 'Q2', stem: '逻辑回归题目 2（修复）' }] }) };
  });
  assert.equal(calls, 1);
  assert.equal(repaired.questions[0].stem, content.questions[0].stem);
  assert.notEqual(repaired.questions[1].stem, content.questions[1].stem);
  assert.equal(quality.validateQuality('EXAM_PAPER', repaired, { questionCount: 2 }).ok, true);
});

test('deterministic quality repair fixes duplicate stems and score totals without another model call', () => {
  const content = examContent(3);
  content.questions[1].stem = content.questions[0].stem;
  content.questions.forEach((item) => { item.score = 1 });
  const repaired = generation.repairDeterministicQuality('EXAM_PAPER', content);
  assert.notEqual(repaired.questions[0].stem, repaired.questions[1].stem);
  assert.equal(quality.validateQuality('EXAM_PAPER', repaired, { questionCount: 3 }).ok, true);
});

test('HTML preview escapes model text and strips active or external content', () => {
  const content = handoutContent();
  content.sections[0].content[0] = '<script>alert(1)</script><img src="https://evil.test/a" onerror="alert(2)">';
  const html = generation.renderPreview('STUDY_HANDOUT', content);
  assert.equal(/<script|<img|\sonerror\s*=|javascript:/i.test(html), false);
  assert.match(html, /&lt;script&gt;/);
});

test('DOCX export writes valid OpenXML atomically and serializer never exposes storagePath', async () => {
  const artifact = await createArtifact({ type: 'STUDY_HANDOUT', content: handoutContent() });
  const exported = await exporter.exportArtifact(artifact.id);
  assert.equal(exported.status, 'READY');
  const absolute = exporter.resolveStoredPath(exported.storagePath);
  const stat = await fs.stat(absolute);
  assert.ok(stat.size > 0 && stat.size < exporter.MAX_FILE_BYTES);
  const directory = path.dirname(absolute);
  assert.equal((await fs.readdir(directory)).some((name) => name.endsWith('.tmp')), false);
  const extracted = await mammoth.extractRawText({ path: absolute });
  assert.match(extracted.value, /逻辑回归学习讲义/);
  assert.match(extracted.value, /AI 声明/);
  const serialized = artifacts.serializeArtifact(exported, { detail: true });
  assert.equal('storagePath' in serialized, false);
  assert.equal(JSON.stringify(serialized).includes(absolute), false);
});

test('DOCX validator rejects files larger than the configured limit', async () => {
  const artifact = await createArtifact();
  const target = exporter.safeArtifactPath(artifact.ownerUserId, artifact.id, 'oversize.docx');
  await fs.mkdir(target.directory, { recursive: true });
  const handle = await fs.open(target.absolute, 'w');
  try {
    await handle.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 0, 4, 0);
    await handle.truncate(exporter.MAX_FILE_BYTES + 1);
  } finally {
    await handle.close();
  }
  await assert.rejects(() => exporter.validateDocxFile(target.absolute), (error) => error.code === 'DOCUMENT_TOO_LARGE');
  await fs.unlink(target.absolute);
});

test('export failure preserves structured content and preview, and a retry creates only an export task', async () => {
  const invalid = await createArtifact({ content: { invalid: true } });
  await assert.rejects(() => exporter.exportArtifact(invalid.id));
  const retained = await prisma.generatedArtifact.findUnique({ where: { id: invalid.id } });
  assert.equal(retained.status, 'CONTENT_READY');
  assert.deepEqual(retained.contentSchemaJson, { invalid: true });
  assert.equal(retained.previewHtml, '<article>安全预览</article>');

  const valid = await createArtifact();
  const requested = await artifacts.requestExport({ user_id: owner.user_id, role: 'student' }, valid.id, crypto.randomUUID());
  createdTaskIds.push(requested.task.id);
  assert.equal(requested.task.taskType, 'DOCUMENT_EXPORT');
  assert.equal(await prisma.asyncTask.count({ where: { id: requested.task.id, taskType: 'FILE_GENERATION' } }), 0);
});

test('artifact owner isolation denies another user and the public generator creator', async () => {
  const artifact = await createArtifact();
  const ownerView = await artifacts.getArtifact({ user_id: owner.user_id, role: 'student' }, artifact.id);
  assert.equal(ownerView.id, artifact.id);
  await assert.rejects(() => artifacts.getArtifact({ user_id: creator.user_id, role: 'student' }, artifact.id), /无权访问/);
  await assert.rejects(() => artifacts.getDownload({ user_id: creator.user_id, role: 'student' }, artifact.id), /无权访问/);
});
