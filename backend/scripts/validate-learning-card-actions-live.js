const prisma = require('../src/config/prisma');
const daily = require('../src/modules/learning-card/daily-learning-card-recommendation.service');
const service = require('../src/modules/learning-card/learning-card.service');
const { learningCardSchema } = require('../src/modules/learning-card/learning-card.schemas');
const { persistenceData } = require('../src/modules/learning-card/learning-card.protocol');

const runId = `lc_action_live_${Date.now()}`;
const created = { cardId: runId, artifactId: null, conversationId: null, practiceSessionId: null, reviewPlanId: null, reviewItemId: null, reviewPlanWasNew: false };

function assert(condition, message) { if (!condition) throw new Error(message); }

async function fixture() {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { enrollment_status: 'active', student: { role: 'STUDENT', status: 'ACTIVE' } },
    include: { course: true }, orderBy: { student_user_id: 'asc' },
  });
  if (!enrollment) throw new Error('没有可用于动作回路验收的在读学生');
  return { user: { user_id: enrollment.student_user_id, role: 'student' }, course: enrollment.course };
}

async function cleanup() {
  if (created.artifactId) {
    await prisma.generatedArtifactExport.deleteMany({ where: { artifactId: created.artifactId } });
    await prisma.generatedArtifact.deleteMany({ where: { id: created.artifactId } });
  }
  if (created.conversationId) {
    await prisma.aiMessage.deleteMany({ where: { conversationId: created.conversationId } });
    await prisma.aiConversation.deleteMany({ where: { id: created.conversationId } });
  }
  if (created.practiceSessionId) await prisma.practiceSession.deleteMany({ where: { practice_session_id: created.practiceSessionId } });
  if (created.reviewItemId) await prisma.reviewPlanItem.deleteMany({ where: { review_plan_item_id: created.reviewItemId } });
  if (created.reviewPlanWasNew && created.reviewPlanId) await prisma.reviewPlan.deleteMany({ where: { review_plan_id: created.reviewPlanId, items: { none: {} } } });
  await prisma.learningCardEvent.deleteMany({ where: { cardId: created.cardId } });
  await prisma.userLearningCardState.deleteMany({ where: { cardId: created.cardId } });
  await prisma.dailyLearningCardSetItem.deleteMany({ where: { cardId: created.cardId } });
  await prisma.learningCard.deleteMany({ where: { id: created.cardId } });
}

async function main() {
  const { user, course } = await fixture();
  const dateKey = daily.localDateKey();
  const candidate = {
    sourceKind: 'TASK', sourceId: runId, cardType: 'TASK', courseId: course.course_id, courseName: course.course_name,
    knowledgePointId: null, knowledgePointName: null, title: 'LearningCard 动作回路验收',
    summary: '验证收藏以外的学习计划、练习、AI 上下文和成果保存链路。',
    description: '本卡仅用于自动验收，并在 finally 中精确清理。', reason: '本地真实动作回路验收。',
    difficulty: 'BASIC', score: 50, sourceRefs: [{ type: 'COURSE', id: course.course_id, title: course.course_name, excerpt: course.description || null, url: null }],
  };
  const card = learningCardSchema.parse({ ...daily.buildRuleCard(candidate, { userId: user.user_id, dateKey, slot: 0 }), id: runId });
  await prisma.learningCard.create({ data: persistenceData(card, { ownerUserId: user.user_id, contextVersion: runId, personalizationVersion: runId }) });

  const detail = await service.getCard(user, card.id);
  assert(detail.version === '1.0' && detail.id === card.id, '详情协议回路失败');

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const existingPlan = await prisma.reviewPlan.findFirst({ where: { student_user_id: user.user_id, course_id: course.course_id, plan_title: '智学卡复习计划', created_at: { gte: dayStart } } });
  const plan = await service.addToPlan(user, card.id);
  created.reviewPlanId = plan.reviewPlanId; created.reviewItemId = plan.itemId; created.reviewPlanWasNew = !existingPlan;
  assert(plan.created === true && plan.actionUrl === '#/student/recommendations', '加入学习计划回路失败');
  const duplicatePlan = await service.addToPlan(user, card.id);
  assert(duplicatePlan.created === false && duplicatePlan.itemId === plan.itemId, '加入计划幂等性失败');

  const practice = await service.startPractice(user, card.id, { questionCount: 1 });
  created.practiceSessionId = practice.session?.practice_session_id || practice.session?.session_id || null;
  assert(created.practiceSessionId && practice.actionUrl.includes(String(created.practiceSessionId)), '开始练习回路失败');

  const ai = await service.askAi(user, card.id, { question: '请用一个问题检查我是否理解这张卡。' });
  created.conversationId = ai.conversationId;
  const aiMessage = await prisma.aiMessage.findFirst({ where: { conversationId: ai.conversationId, role: 'USER' } });
  assert(ai.actionUrl.includes(String(ai.conversationId)) && aiMessage?.attachments?.[0]?.cardId === card.id, '携卡询问 AI 回路失败');

  const saved = await service.performAction(user, card.id, { action: 'SAVE_ARTIFACT', context: { scene: 'LIVE_VALIDATION' } });
  created.artifactId = saved.artifact?.id || null;
  assert(created.artifactId && saved.artifact.artifactType === 'KNOWLEDGE_CARDS', '保存成果回路失败');

  console.log(JSON.stringify({ event: 'complete', runId, userId: user.user_id, courseId: course.course_id, checks: { detail: true, addToPlan: true, addToPlanIdempotent: true, startPractice: true, askAiWithCardContext: true, saveArtifact: true } }));
}

main()
  .catch(error => { console.error(JSON.stringify({ event: 'failed', runId, code: error.code || null, message: error.message })); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch(error => { console.error(JSON.stringify({ event: 'cleanup_failed', runId, message: error.message })); process.exitCode = 1; }); await prisma.$disconnect(); });
