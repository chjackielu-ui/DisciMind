const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const packages = require('../src/services/student-learning-package.service');

const context = {
  userId: 3,
  user: { user_id: 3, role: 'student' },
  courseId: 1,
  courseName: '机器学习',
  knowledgePointId: 11,
  knowledgePointName: '线性回归',
  knowledgePointDescription: '线性回归使用线性函数拟合连续目标值。',
  chapterName: '监督学习',
  masteryScore: 48,
};

test('resource package always exposes the five required resources in a stable order', () => {
  assert.deepEqual(packages.RESOURCE_ORDER, ['handout', 'ppt', 'cards', 'exam', 'video']);
  const resources = packages.initialResources();
  assert.deepEqual(Object.keys(resources), packages.RESOURCE_ORDER);
  assert.ok(Object.values(resources).every((item) => item.status === 'pending'));
});

test('single-knowledge-point document requirements stay internally consistent', () => {
  const handout = packages.buildDocumentRequirements('STUDY_HANDOUT', context);
  assert.deepEqual(handout.knowledgePointIds, [context.knowledgePointId]);
  assert.deepEqual(handout.knowledgePointNames, [context.knowledgePointName]);
  assert.equal(handout.difficulty, 'BASIC');
  assert.deepEqual(handout.outputFormats, ['DOCX']);

  const exam = packages.buildDocumentRequirements('EXAM_PAPER', context);
  assert.equal(exam.questionTypes.reduce((sum, item) => sum + item.count, 0), exam.questionCount);
  assert.equal(exam.questionTypes.reduce((sum, item) => sum + item.count * item.score, 0), exam.totalScore);
  assert.equal(exam.includeAnswers, false);
});

test('knowledge card fallback remains schema-valid and personalized', () => {
  const cards = packages.fallbackCards(context);
  assert.equal(cards.length, 5);
  assert.equal(new Set(cards.map((card) => card.cardType)).size, 5);
  assert.ok(cards.every((card) => card.scope === 'STUDENT'));
  assert.ok(cards.every((card) => card.courseId === context.courseId && card.knowledgePointId === context.knowledgePointId));
  assert.ok(cards.every((card) => card.generator.generationMode === 'RULE'));
});

test('document fallbacks remain schema-valid and keep the single-course scope', () => {
  const handoutRequirements = packages.buildDocumentRequirements('STUDY_HANDOUT', context);
  const handout = packages.fallbackHandoutContent(context, handoutRequirements);
  assert.deepEqual(handout.knowledgePoints, [context.knowledgePointName]);
  assert.match(handout.sourceNotice, /系统课程与知识点数据/);
  assert.ok(handout.sections.length >= 3);

  const examRequirements = packages.buildDocumentRequirements('EXAM_PAPER', context);
  const exam = packages.fallbackExamContent(context, examRequirements);
  assert.deepEqual(exam.knowledgePoints, [context.knowledgePointName]);
  assert.equal(exam.questions.length, 8);
  assert.equal(exam.questions.reduce((sum, item) => sum + item.score, 0), 100);
  assert.match(exam.sourceNotice, /系统课程与知识点数据/);
});

test('document fallback is limited to upstream model failures', () => {
  assert.equal(packages.isDocumentModelUnavailable({ code: 'CONTENT_MODEL_CALL_FAILED' }), true);
  assert.equal(packages.isDocumentModelUnavailable({ code: 'CONTENT_SCHEMA_REPAIR_FAILED' }), true);
  assert.equal(packages.isDocumentModelUnavailable({ code: 'DOCUMENT_INVALID' }), false);
});

test('resource package routes, worker dispatch and frontend API are connected', async () => {
  const [routes, worker, api, service] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../src/routes/student-video.routes.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../src/modules/async-task/async-task.worker.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../frontend/src/api/student.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../src/services/student-learning-package.service.js'), 'utf8'),
  ]);
  assert.match(routes, /knowledge-points\/:knowledge_point_id\/resource-packages/);
  assert.match(routes, /resource-packages\/:task_id/);
  assert.match(routes, /resource-packages\/:task_id\/retry/);
  assert.match(worker, /KNOWLEDGE_RESOURCE_PACKAGE/);
  assert.match(api, /createStudentKnowledgeResourcePackage/);
  assert.match(api, /getStudentKnowledgeResourcePackage/);
  assert.match(api, /retryStudentKnowledgeResourcePackage/);
  assert.match(service, /packageCreationLocks/);
  assert.match(service, /RESOURCE_PACKAGE_ACTIVE_LIMIT_PER_USER/);
});

test('resource package keeps browser-rendered video state resumable and downloadable', async () => {
  const [service, panel] = await Promise.all([
    fs.readFile(path.resolve(__dirname, '../src/services/student-learning-package.service.js'), 'utf8'),
    fs.readFile(path.resolve(__dirname, '../../frontend/src/components/video/LearningMediaPanel.jsx'), 'utf8'),
  ]);
  assert.match(service, /const videoDownloadUrl = videoTask\.resultUrl \|\| resources\.video\.downloadUrl/);
  assert.match(service, /downloadUrl:\s*\/\^\\\/api\\\/\//);
  assert.match(service, /status:\s*\{\s*in:\s*\['WAITING_EXTERNAL',\s*'RUNNING',\s*'SUCCEEDED'\]/);
  assert.match(panel, /videoTask:\s*resumableVideoTask\(value\.videoTask\)/);
});
