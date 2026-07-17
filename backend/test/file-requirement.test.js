const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const prisma = require('../src/config/prisma');
const requirements = require('../src/modules/file-generator/file-requirement.service');
const schemas = require('../src/modules/file-generator/file-requirement.schemas');

const createdAgents = [];
let studentA; let studentB;

async function fixture(agentType = 'FILE_GENERATOR') {
  studentA ||= await prisma.user.findUnique({ where: { username: 'student_demo' } });
  studentB ||= await prisma.user.findUnique({ where: { username: 'student_b' } });
  const category = await prisma.agentCategory.findFirst();
  const agent = await prisma.userAgent.create({ data: {
    creatorUserId: studentB.user_id, agentType, status: 'PUBLIC', visibility: 'PUBLIC', categoryId: category?.id,
    operationId: `test-file-agent:${crypto.randomUUID()}`,
  } });
  createdAgents.push(agent.id);
  const version = await prisma.userAgentVersion.create({ data: {
    agentId: agent.id, versionNumber: 1, name: '测试文件生成器', shortDescription: '仅用于 FILE_GENERATOR 专项测试',
    systemPrompt: '受控教育文件生成', welcomeMessage: '请描述需要的文件', reviewStatus: 'APPROVED',
    fileGeneratorConfigJson: agentType === 'FILE_GENERATOR' ? { documentType: 'EXAM_PAPER', fileFormat: 'DOCX', maxQuestionCount: 50 } : null,
  } });
  await prisma.userAgent.update({ where: { id: agent.id }, data: { currentPublicVersionId: version.id, currentDraftVersionId: version.id } });
  const conversation = await prisma.marketplaceAgentConversation.create({ data: {
    userId: studentA.user_id, agentId: agent.id, agentVersionId: version.id, operationId: `test-file-conv:${crypto.randomUUID()}`,
  } });
  return { agent, version, conversation };
}

test.after(async () => {
  if (createdAgents.length) {
    const artifacts = await prisma.generatedArtifact.findMany({ where: { agentId: { in: createdAgents } }, select: { id: true } });
    const artifactIds = artifacts.map(item => item.id);
    if (artifactIds.length) {
      await prisma.generatedArtifact.deleteMany({ where: { id: { in: artifactIds } } });
      await prisma.asyncTask.deleteMany({ where: { relatedResourceType: 'GENERATED_ARTIFACT', relatedResourceId: { in: artifactIds.map(String) } } });
    }
    await prisma.userAgent.deleteMany({ where: { id: { in: createdAgents } } });
  }
  await prisma.$disconnect();
});

test('CHAT Agent cannot enter the file planner', async () => {
  const { conversation } = await fixture('CHAT');
  await assert.rejects(() => requirements.getRequirements(studentA.user_id, conversation.id), /CHAT Agent/);
});

test('FILE_GENERATOR draft uses safe candidate keys, asks at most two fields, and isolates owners', async () => {
  const { conversation } = await fixture();
  const candidates = await requirements.accessibleCandidates(studentA.user_id);
  const course = candidates.publicCourses[0]; const point = candidates.publicKnowledgePoints.find(item => item.courseKey === course.courseKey);
  assert.ok(course.courseKey.startsWith('course_')); assert.ok(point.knowledgePointKey.startsWith('kp_'));
  const draft = await requirements.patchRequirements(studentA.user_id, conversation.id, { artifactType: 'EXAM_PAPER', courseKey: course.courseKey });
  assert.ok(draft.questions.length <= 2); assert.equal('courseId' in draft, false); assert.equal('knowledgePointIds' in draft, false);
  await assert.rejects(() => requirements.getRequirements(studentB.user_id, conversation.id), /无权访问/);
  await assert.rejects(() => requirements.patchRequirements(studentA.user_id, conversation.id, { courseKey: 'course_illegal' }), /courseKey/);
  await assert.rejects(() => requirements.patchRequirements(studentA.user_id, conversation.id, { knowledgePointKeys: ['kp_illegal'] }), /knowledgePointKey/);
});

test('planner rejects database ID injection and preserves explicit fields', async () => {
  const { conversation } = await fixture();
  await requirements.patchRequirements(studentA.user_id, conversation.id, { difficulty: 'BASIC' });
  await assert.rejects(() => requirements.planRequirements(studentA.user_id, conversation.id, '恶意输入', {
    modelCall: async () => ({ content: JSON.stringify({ courseId: 1, difficulty: 'ADVANCED' }) }),
  }), /数据库 ID/);
  const planned = await requirements.planRequirements(studentA.user_id, conversation.id, '请做进阶试卷', {
    modelCall: async () => ({ content: JSON.stringify({ artifactType: 'EXAM_PAPER', difficulty: 'ADVANCED' }) }),
  });
  assert.equal(planned.difficulty, 'BASIC');
  const messages = await prisma.marketplaceAgentMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(messages.map(item => item.role), ['USER', 'USER', 'ASSISTANT']);
  assert.ok(messages.every(item => item.generationStatus === 'COMPLETED'));
});

test('validly shaped keys for an unenrolled course and its knowledge point are rejected', async () => {
  const { conversation } = await fixture();
  const code = `PRIVATE_${crypto.randomUUID().slice(0, 8)}`;
  const course = await prisma.course.create({ data: { course_name: '无权限测试课程', course_code: code, subject_category: '测试', status: 'ACTIVE' } });
  const point = await prisma.knowledgePoint.create({ data: { course_id: course.course_id, knowledge_point_name: '私有知识点', knowledge_point_code: 'PRIVATE_KP', difficulty_level: 'BASIC' } });
  try {
    const courseKey = requirements.safeKey('course', course.course_id, course.course_code);
    const pointKey = requirements.safeKey('kp', course.course_id, point.knowledge_point_id, point.knowledge_point_code);
    await assert.rejects(() => requirements.patchRequirements(studentA.user_id, conversation.id, { courseKey }), /无权限/);
    await assert.rejects(() => requirements.patchRequirements(studentA.user_id, conversation.id, { knowledgePointKeys: [pointKey] }), /无权限/);
  } finally { await prisma.course.delete({ where: { course_id: course.course_id } }); }
});

test('complete requirements enter confirmation state without creating a task', async () => {
  const { conversation } = await fixture();
  const candidates = await requirements.accessibleCandidates(studentA.user_id);
  const course = candidates.publicCourses[0]; const point = candidates.publicKnowledgePoints.find(item => item.courseKey === course.courseKey);
  const ready = await requirements.patchRequirements(studentA.user_id, conversation.id, {
    artifactType: 'EXAM_PAPER', courseKey: course.courseKey, knowledgePointKeys: [point.knowledgePointKey], title: '逻辑回归练习',
    difficulty: 'BASIC', examType: 'CUSTOM', questionCount: 20,
    questionTypes: [{ type: 'SINGLE_CHOICE', count: 20, score: 5 }], totalScore: 100, duration: 60,
    includeAnswers: true, includeAnalysis: true, includeAnswerSheet: false, outputFormats: ['DOCX', 'PDF'],
  });
  assert.equal(ready.readyForConfirmation, true); assert.deepEqual(ready.missingFields, []); assert.deepEqual(ready.questions, []);
  const persisted = await prisma.marketplaceAgentConversation.findUnique({ where: { id: conversation.id } });
  assert.equal(persisted.requirementStatus, 'READY_TO_CONFIRM');
  const taskCount = await prisma.asyncTask.count({ where: { relatedResourceType: 'GENERATED_ARTIFACT', metadataJson: { path: '$.conversationId', equals: conversation.id } } }).catch(() => 0);
  assert.equal(taskCount, 0);
});

test('requirement schemas reject more than 50 questions, duplicate types and unsupported output', () => {
  assert.throws(() => schemas.requirementPatchSchema.parse({ questionCount: 51 }));
  assert.equal(schemas.requirementPatchSchema.parse({ outputFormat: 'PDF' }).outputFormat, 'PDF');
  assert.throws(() => schemas.requirementPatchSchema.parse({ outputFormats: ['HTML'] }));
  assert.throws(() => schemas.requirementPatchSchema.parse({ questionTypes: [
    { type: 'SINGLE_CHOICE', count: 2, score: 5 },
    { type: 'SINGLE_CHOICE', count: 2, score: 5 },
  ] }));
});

test('confirmation requires a complete draft and atomically creates one artifact and one task', async () => {
  const { conversation } = await fixture();
  await assert.rejects(() => requirements.confirmRequirements(studentA.user_id, conversation.id, crypto.randomUUID()), /尚未确认完整/);
  const candidates = await requirements.accessibleCandidates(studentA.user_id);
  const course = candidates.publicCourses[0]; const point = candidates.publicKnowledgePoints.find(item => item.courseKey === course.courseKey);
  await requirements.patchRequirements(studentA.user_id, conversation.id, {
    artifactType: 'EXAM_PAPER', courseKey: course.courseKey, knowledgePointKeys: [point.knowledgePointKey], title: '幂等试卷',
    difficulty: 'BASIC', examType: 'CUSTOM', questionCount: 10,
    questionTypes: [{ type: 'SINGLE_CHOICE', count: 10, score: 10 }], totalScore: 100, duration: 60,
    includeAnswers: true, includeAnalysis: true, includeAnswerSheet: false, outputFormats: ['DOCX'],
  });
  const operationId = crypto.randomUUID();
  const previousLimit = process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER;
  process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER = '100';
  const first = await requirements.confirmRequirements(studentA.user_id, conversation.id, operationId);
  const second = await requirements.confirmRequirements(studentA.user_id, conversation.id, operationId);
  if (previousLimit === undefined) delete process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER; else process.env.FILE_GENERATION_MAX_ACTIVE_PER_USER = previousLimit;
  assert.equal(first.artifact.id, second.artifact.id); assert.equal(first.task.id, second.task.id);
  assert.equal(await prisma.generatedArtifact.count({ where: { ownerUserId: studentA.user_id, conversationId: conversation.id, operationId } }), 1);
  assert.equal(await prisma.asyncTask.count({ where: { id: first.task.id } }), 1);
});
