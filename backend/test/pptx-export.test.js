const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const prisma = require('../src/config/prisma');
const artifactExport = require('../src/modules/file-generator/artifact-export.service');
const generatedArtifacts = require('../src/modules/file-generator/generated-artifact.service');
const { resolveStoredPath } = require('../src/modules/file-generator/document-export.service');
const pptx = require('../src/modules/file-generator/pptx-export.service');

const examContent = {
  title: '数据结构测试卷', course: '数据结构', knowledgePoints: ['线性表'], difficulty: 'BASIC', duration: 60, totalScore: 10,
  instructions: ['独立完成'], sections: [{ id: 'section-1', title: '选择题', questionIds: ['Q1'] }],
  questions: [{ id: 'Q1', type: 'SINGLE_CHOICE', stem: '顺序表的特点是什么？', options: ['随机访问', '链式存储'], answer: 'A', analysis: '顺序表支持随机访问。', score: 10, knowledgePoint: '线性表', difficulty: 'BASIC' }],
  answers: [{ questionId: 'Q1', answer: 'A' }], analysis: [{ questionId: 'Q1', analysis: '顺序表支持随机访问。' }],
};

test('PPTX slide planning preserves exam artifact roles', () => {
  const studentSlides = pptx.buildSlides({ artifactType: 'EXAM_PAPER', artifactRole: 'STUDENT_PAPER', title: examContent.title, requirementsJson: { includeAnswers: true, includeAnalysis: true }, contentSchemaJson: examContent });
  assert.equal(studentSlides.some(item => item.title.includes('参考答案')), false);
  const answerSlides = pptx.buildSlides({ artifactType: 'EXAM_PAPER', artifactRole: 'ANSWER_KEY', title: `${examContent.title} - 参考答案与解析`, requirementsJson: { includeAnswers: true, includeAnalysis: true }, contentSchemaJson: examContent });
  assert.equal(answerSlides.some(item => item.title.includes('参考答案与解析')), true);
});

test('PPTX export writes a ready OpenXML artifact', async () => {
  const owner = await prisma.user.findUnique({ where: { username: 'student_demo' } });
  assert.ok(owner);
  const content = {
    title: 'PPTX 导出测试讲义', course: '数据结构', knowledgePoints: ['线性表'],
    learningObjectives: ['理解线性表的基本特征'], prerequisites: ['数组基础'],
    sections: [{ id: 'section-1', title: '线性表概念', content: ['线性表是具有相同数据类型元素的有限序列。'] }],
    examples: [], keyPoints: ['元素之间存在一对一关系'], commonMistakes: ['混淆逻辑结构与存储结构'], practice: [],
    principles: ['线性表支持顺序存储和链式存储。'], references: ['课程教材'], summary: ['掌握线性表定义与基本操作。'],
  };
  const artifact = await prisma.generatedArtifact.create({ data: {
    ownerUserId: owner.user_id, operationId: crypto.randomUUID(), artifactType: 'STUDY_HANDOUT', title: content.title,
    description: 'PPTX 导出专项测试', requirementsJson: { artifactType: 'STUDY_HANDOUT', outputFormats: ['PPTX'], includeAnswers: false, includeAnalysis: false },
    contentSchemaJson: content, previewHtml: '<article><h1>PPTX 导出测试讲义</h1></article>', fileFormat: 'PPTX', status: 'CONTENT_READY',
  } });
  let storedPath;
  try {
    const exported = await artifactExport.exportFormat(artifact.id, 'PPTX');
    assert.equal(exported.status, 'READY');
    assert.equal(exported.mimeType, pptx.PPTX_MIME);
    storedPath = exported.storagePath;
    const validated = await pptx.validatePptx(resolveStoredPath(storedPath));
    assert.ok(validated.stat.size > 1024);
    const directDownload = await generatedArtifacts.getExportDownload({ user_id: owner.user_id, role: 'student' }, artifact.id, 'PPTX');
    const primaryDownload = await generatedArtifacts.getDownload({ user_id: owner.user_id, role: 'student' }, artifact.id);
    assert.equal(directDownload.mimeType, pptx.PPTX_MIME);
    assert.equal(directDownload.extension, 'pptx');
    assert.equal(primaryDownload.absolutePath, directDownload.absolutePath);
    assert.equal(primaryDownload.fileName.endsWith('.pptx'), true);
  } finally {
    if (storedPath) await fs.unlink(resolveStoredPath(storedPath)).catch(() => null);
    await prisma.generatedArtifactExport.deleteMany({ where: { artifactId: artifact.id } });
    await prisma.generatedArtifact.delete({ where: { id: artifact.id } });
    await prisma.$disconnect();
  }
});
