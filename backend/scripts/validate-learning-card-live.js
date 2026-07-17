const crypto = require('crypto');
const prisma = require('../src/config/prisma');
const ai = require('../src/modules/learning-card/learning-card-ai.service');
const { learningCardSchema } = require('../src/modules/learning-card/learning-card.schemas');

const runId = `lc_live_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const cardIds = [];
const artifactIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fixture() {
  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', status: 'ACTIVE', student_course_enrollments: { some: { enrollment_status: 'active' } } },
    select: {
      user_id: true,
      student_course_enrollments: { where: { enrollment_status: 'active' }, select: { course_id: true }, take: 10 },
      _count: { select: { mastery_records: true, wrong_questions: true } },
    },
    take: 100,
  });
  const student = students.sort((left, right) => (right._count.mastery_records + right._count.wrong_questions) - (left._count.mastery_records + left._count.wrong_questions))[0];
  if (!student) throw new Error('没有可用于真实卡片验收的在读学生');
  const courseId = student.student_course_enrollments[0]?.course_id;
  const point = await prisma.knowledgePoint.findFirst({ where: { course_id: courseId }, orderBy: { sort_order: 'asc' } });
  if (!point) throw new Error('测试学生的课程没有知识点');
  return { user: { user_id: student.user_id, role: 'student' }, courseId, point };
}

async function cleanup() {
  if (cardIds.length) {
    await prisma.learningCardEvent.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.userLearningCardState.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.dailyLearningCardSetItem.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.learningCard.deleteMany({ where: { id: { in: cardIds } } });
  }
  if (artifactIds.length) {
    await prisma.generatedArtifactExport.deleteMany({ where: { artifactId: { in: artifactIds } } });
    await prisma.generatedArtifact.deleteMany({ where: { id: { in: artifactIds } } });
  }
  await prisma.generatedArtifact.deleteMany({ where: { title: { startsWith: runId } } });
  await prisma.learningCard.deleteMany({ where: { id: { startsWith: runId } } });
}

async function main() {
  assert(ai.MODEL_NAME === 'qwen3.7-plus', `实际模型不是 qwen3.7-plus：${ai.MODEL_NAME}`);
  const { user, courseId, point } = await fixture();
  const cases = [
    { name: '纯文本概念卡', type: 'CONCEPT', topic: `${point.knowledge_point_name}：用简洁段落解释核心概念` },
    { name: 'Markdown 表格卡', type: 'COMPARISON', topic: `${point.knowledge_point_name}：必须用 Markdown 表格比较适用条件、优点与局限` },
    { name: 'LaTeX 公式卡', type: 'FORMULA', topic: 'Sigmoid 函数：必须包含 LaTeX 公式、符号解释和代入示例' },
    { name: 'ECharts 折线图卡', type: 'FORMULA', topic: 'Sigmoid 函数曲线与概率映射', includeChart: true },
    { name: '个性化掌握度卡', type: 'PROGRESS', topic: '本人知识点掌握度雷达图，只能使用当前真实掌握度记录' },
    { name: '任务提醒卡', type: 'TASK', topic: `${point.knowledge_point_name}学习任务提醒与可执行步骤` },
    { name: '错题修复卡', type: 'WRONG_QUESTION', topic: `${point.knowledge_point_name}错题修复：定位错误类型、给出一句话纠错和相似练习策略` },
  ];
  const results = [];
  for (const [index, item] of cases.entries()) {
    const id = `${runId}_${index}`;
    cardIds.push(id);
    const startedAt = Date.now();
    const result = await ai.generateArtifact(user, {
      title: `${runId} ${item.name}`,
      topic: item.topic,
      courseId,
      knowledgePointId: point.knowledge_point_id,
      cardTypes: [item.type],
      count: 1,
      includeChart: Boolean(item.includeChart),
      learningGoal: `真实验收用例：${item.name}`,
    }, { existingIds: [id] });
    artifactIds.push(result.artifact.id);
    const card = learningCardSchema.parse(result.cards[0]);
    assert(card.id === id, `${item.name} 未使用隔离测试 ID`);
    assert(card.cardType === item.type, `${item.name} 类型不正确`);
    assert(card.generator.model === 'qwen3.7-plus', `${item.name} 未记录真实模型`);
    assert(card.sourceRefs.length > 0, `${item.name} 缺少真实来源`);
    if (item.name === 'Markdown 表格卡') assert(/\|[^\n]+\|/.test(card.markdownContent), 'Markdown 表格卡没有表格');
    if (item.name === 'LaTeX 公式卡') assert(card.sections.some(section => section.type === 'FORMULA') || /\\(?:frac|sigma)|\$[^$]+\$/i.test(card.markdownContent), '公式卡没有 LaTeX');
    if (item.name === 'ECharts 折线图卡') assert(card.sections.some(section => section.chartSpec?.chart?.type === 'line'), '折线图卡没有受控 ChartSpec 1.0');
    if (item.name === '个性化掌握度卡') {
      assert(/本人|当前|掌握度/.test(card.recommendationReason), '个性化卡没有个性化推荐原因');
      assert(!card.sections.some(section => section.chartSpec && section.chartSpec.source.type !== 'student_mastery_records'), '个性化图表使用了非本人数据');
    }
    results.push({ name: item.name, type: card.cardType, sections: card.sections.map(section => section.type), sources: card.sourceRefs.length, elapsedMs: Date.now() - startedAt });
    console.log(JSON.stringify({ event: 'case_passed', ...results.at(-1) }));
  }
  console.log(JSON.stringify({ event: 'complete', model: ai.MODEL_NAME, runId, userId: user.user_id, courseId, knowledgePointId: point.knowledge_point_id, results }));
}

main()
  .catch(error => {
    console.error(JSON.stringify({ event: 'failed', runId, message: error.message, code: error.code || null }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(error => {
      console.error(JSON.stringify({ event: 'cleanup_failed', runId, message: error.message }));
      process.exitCode = 1;
    });
    await prisma.$disconnect();
  });
