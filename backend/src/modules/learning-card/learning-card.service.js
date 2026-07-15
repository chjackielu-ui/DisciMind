const prisma = require('../../config/prisma');
const practiceService = require('../../services/practice.service');
const aiChatService = require('../../services/ai-chat.service');
const artifactService = require('../ai-assistant/artifact.service');
const daily = require('./daily-learning-card-recommendation.service');
const ai = require('./learning-card-ai.service');
const { learningCardSchema } = require('./learning-card.schemas');
const { hash, safeText, persistenceData, recordToLearningCard } = require('./learning-card.protocol');

function cardError(message, code = 40001, status = 400, publicCode = 'LEARNING_CARD_REQUEST_INVALID') {
  return Object.assign(new Error(message), { code, status, publicCode, expose: true });
}

async function assertStudentCourseAccess(userId, courseId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: Number(userId), course_id: Number(courseId), enrollment_status: 'active' },
    select: { enrollment_id: true },
  });
  if (!enrollment) throw cardError('未加入该课程，无法访问课程学习卡片', 40301, 403, 'LEARNING_CARD_COURSE_FORBIDDEN');
}

async function loadAccessibleCard(user, cardId) {
  const record = await prisma.learningCard.findUnique({
    where: { id: String(cardId) },
    include: { course: true, knowledgePoint: true },
  });
  if (!record || record.status === 'DELETED') throw cardError('学习卡片不存在', 40401, 404, 'LEARNING_CARD_NOT_FOUND');
  const userId = Number(user.user_id);
  if (record.scope === 'STUDENT' && Number(record.ownerUserId) !== userId) {
    throw cardError('无权访问该个性化学习卡片', 40301, 403, 'LEARNING_CARD_FORBIDDEN');
  }
  if (record.scope === 'COURSE' && record.courseId) await assertStudentCourseAccess(userId, record.courseId);
  const state = await prisma.userLearningCardState.findUnique({ where: { userId_cardId: { userId, cardId: record.id } } });
  return { record, state, card: recordToLearningCard(record, state) };
}

async function getCard(user, cardId) {
  return (await loadAccessibleCard(user, cardId)).card;
}

function actionPatch(action) {
  const map = {
    FAVORITE: { isFavorite: true }, UNFAVORITE: { isFavorite: false },
    MASTERED: { isMastered: true }, UNMASTERED: { isMastered: false },
    DEFERRED: { isDeferred: true }, UNDEFERRED: { isDeferred: false },
    IGNORED: { isIgnored: true }, UNIGNORED: { isIgnored: false },
  };
  return map[action] || {};
}

async function recordEvent(tx, userId, cardId, eventType, context) {
  return tx.learningCardEvent.create({ data: { userId, cardId, eventType, context: context || null } });
}

async function performAction(user, cardId, input) {
  const { record, card } = await loadAccessibleCard(user, cardId);
  const userId = Number(user.user_id);
  const patch = actionPatch(input.action);
  const dwell = Math.max(0, Number(input.dwellTimeMs) || 0);
  let state = null;
  let artifact = null;
  await prisma.$transaction(async tx => {
    const update = {
      ...patch,
      ...(input.action === 'VIEW' ? { viewCount: { increment: 1 }, viewedAt: new Date() } : {}),
      ...(dwell ? { totalDwellTimeMs: { increment: dwell } } : {}),
    };
    state = await tx.userLearningCardState.upsert({
      where: { userId_cardId: { userId, cardId: record.id } },
      create: { userId, cardId: record.id, ...patch, viewCount: input.action === 'VIEW' ? 1 : 0, totalDwellTimeMs: dwell, viewedAt: input.action === 'VIEW' ? new Date() : null },
      update,
    });
    await recordEvent(tx, userId, record.id, input.action, input.context);
  });
  if (input.action === 'SAVE_ARTIFACT') {
    const saved = await artifactService.createCards({ user, courseId: card.courseId }, {
      title: card.title, cards: [card], description: '从 LearningCard 1.0 详情保存的学习成果',
      knowledgePointIds: card.knowledgePointId ? [card.knowledgePointId] : [],
      requirements: { source: 'learning-card-platform', schemaVersion: '1.0' },
      metadata: { kind: 'learning_cards', schemaVersion: '1.0', cardIds: [card.id] },
    });
    artifact = artifactService.serialize(saved);
  }
  if (Object.keys(patch).length) await daily.markTodayStale(userId, `CARD_${input.action}`, {
    cardId: record.id,
    knowledgePointId: card.knowledgePointId || undefined,
  }).catch(() => null);
  return { cardId: record.id, state: recordToLearningCard(record, state).state, masteryUnaffected: true, artifact };
}

async function addToPlan(user, cardId) {
  const { card } = await loadAccessibleCard(user, cardId);
  if (!card.courseId) throw cardError('该卡片未关联课程，暂不能加入复习计划', 40901, 409, 'LEARNING_CARD_COURSE_REQUIRED');
  const userId = Number(user.user_id);
  const start = new Date();
  const dayStart = new Date(start); dayStart.setHours(0, 0, 0, 0);
  const title = '智学卡复习计划';
  let plan = await prisma.reviewPlan.findFirst({ where: { student_user_id: userId, course_id: card.courseId, plan_title: title, created_at: { gte: dayStart } }, orderBy: { created_at: 'desc' } });
  if (!plan) plan = await prisma.reviewPlan.create({ data: { student_user_id: userId, course_id: card.courseId, plan_title: title, start_date: start, end_date: new Date(start.getTime() + 14 * 86_400_000) } });
  const marker = `[LearningCard:${card.id}]`;
  let item = await prisma.reviewPlanItem.findFirst({ where: { review_plan_id: plan.review_plan_id, content: { contains: marker } } });
  const created = !item;
  if (!item) item = await prisma.reviewPlanItem.create({ data: { review_plan_id: plan.review_plan_id, day_no: 1, plan_date: start, content: `${marker} ${card.title}\n${card.summary}` } });
  await prisma.learningCardEvent.create({ data: { userId, cardId: card.id, eventType: 'ADD_TO_PLAN', context: { reviewPlanId: plan.review_plan_id, itemId: item.review_plan_item_id } } });
  return { reviewPlanId: plan.review_plan_id, itemId: item.review_plan_item_id, created, actionUrl: '#/student/recommendations' };
}

function wrongQuestionRef(card) {
  const ref = card.sourceRefs.find(item => item.type === 'WRONG_QUESTION' && Number(item.id) > 0);
  return ref ? Number(ref.id) : null;
}

async function startPractice(user, cardId, input = {}) {
  const { card } = await loadAccessibleCard(user, cardId);
  const userId = Number(user.user_id);
  let wrongQuestionId = wrongQuestionRef(card);
  if (!wrongQuestionId && card.knowledgePointId) {
    const wrong = await prisma.wrongQuestion.findFirst({ where: { student_user_id: userId, knowledge_point_id: card.knowledgePointId, status: 'UNRESOLVED' }, orderBy: { updated_at: 'desc' } });
    wrongQuestionId = wrong?.wrong_question_id || null;
  }
  const questionCount = Math.max(1, Math.min(20, Number(input.questionCount) || 3));
  const result = wrongQuestionId
    ? await practiceService.startSimilarPractice(userId, wrongQuestionId, { questionCount })
    : await practiceService.startPractice(userId, { subjectId: card.courseId, questionCount, questionTypes: input.questionTypes || ['single_choice'], difficulty: String(card.difficulty || 'MEDIUM').toLowerCase(), sessionMode: 'practice', answerMode: 'single' });
  const sessionId = result.session?.practice_session_id || result.session?.session_id;
  await prisma.learningCardEvent.create({ data: { userId, cardId: card.id, eventType: 'START_PRACTICE', context: { practiceSessionId: sessionId, questionCount } } });
  return { ...result, actionUrl: sessionId ? `#/student/practice/sessions/${sessionId}` : '#/student/practice' };
}

async function askAi(user, cardId, input = {}) {
  const { card } = await loadAccessibleCard(user, cardId);
  const userId = Number(user.user_id);
  const conversation = await aiChatService.createConversation(userId, { title: `学习卡片：${card.title}`, mode: 'GENERAL' });
  const prompt = safeText(input.question || `请围绕这张学习卡片继续讲解，并先确认我最不理解的地方：${card.title}`, 2000);
  await prisma.aiMessage.create({ data: {
    conversationId: conversation.id, role: 'USER', content: prompt,
    sourcesJson: card.sourceRefs,
    attachments: [{ type: 'LEARNING_CARD', cardId: card.id, title: card.title, summary: card.summary, schemaVersion: '1.0' }],
  } });
  await prisma.learningCardEvent.create({ data: { userId, cardId: card.id, eventType: 'ASK_AI', context: { conversationId: conversation.id } } });
  return { conversationId: conversation.id, actionUrl: `#/student/ai-chat?conversationId=${conversation.id}`, cardContext: { id: card.id, title: card.title } };
}

async function ensureCourseLibrary(courseId) {
  const existing = await prisma.learningCard.count({ where: { courseId: Number(courseId), scope: 'COURSE', status: 'READY' } });
  if (existing >= 3) return;
  const course = await prisma.course.findUnique({ where: { course_id: Number(courseId) } });
  const points = await prisma.knowledgePoint.findMany({ where: { course_id: Number(courseId) }, include: { chapter: true }, orderBy: { sort_order: 'asc' }, take: 18 });
  const templates = ['CONCEPT', 'FORMULA', 'PITFALL', 'EXAMPLE', 'COMPARISON', 'REVIEW'];
  for (const [index, point] of points.entries()) {
    const cardType = /公式|函数|定理|sigmoid/i.test(point.knowledge_point_name) ? 'FORMULA' : templates[index % templates.length];
    const candidate = {
      sourceKind: 'CONCEPT', sourceId: point.knowledge_point_id, cardType, courseId: Number(courseId), courseName: course?.course_name,
      knowledgePointId: point.knowledge_point_id, knowledgePointName: point.knowledge_point_name, chapterName: point.chapter?.chapter_name,
      title: `${point.knowledge_point_name}${({ CONCEPT: '核心概念', FORMULA: '公式', PITFALL: '易错点', EXAMPLE: '例题', COMPARISON: '辨析', REVIEW: '复习' })[cardType]}`,
      summary: safeText(point.description || `回顾 ${point.knowledge_point_name} 的定义、条件和使用方法。`, 1000),
      description: point.description || `${point.knowledge_point_name} 是 ${course?.course_name || '当前课程'} 的知识点。`,
      reason: '来自当前课程知识结构，可作为课前预习与课后复习入口。', difficulty: point.difficulty_level, score: 50,
      sourceRefs: [{ type: 'KNOWLEDGE_POINT', id: point.knowledge_point_id, title: point.knowledge_point_name, excerpt: safeText(point.description, 1000) || null, url: null }],
    };
    const rule = daily.buildRuleCard(candidate, { userId: 0, dateKey: daily.localDateKey(), slot: index });
    const card = learningCardSchema.parse({ ...rule, id: `lc_course_${hash({ courseId, pointId: point.knowledge_point_id, cardType }).slice(0, 24)}`, scope: 'COURSE', recommendationReason: candidate.reason });
    const data = persistenceData(card, { contextVersion: hash({ point: point.updated_at, course: course?.updated_at }), personalizationVersion: 'course-library-v1' });
    const { id, ...update } = data;
    await prisma.learningCard.upsert({ where: { id }, create: data, update });
  }
}

async function getCourseLibrary(user, courseId, query) {
  const userId = Number(user.user_id);
  await assertStudentCourseAccess(userId, courseId);
  await ensureCourseLibrary(courseId);
  const where = {
    courseId: Number(courseId), status: 'READY',
    AND: [
      { OR: [{ scope: 'COURSE' }, { scope: 'GLOBAL' }, { scope: 'STUDENT', ownerUserId: userId }] },
      ...(query.search ? [{ OR: [{ title: { contains: query.search } }, { summary: { contains: query.search } }] }] : []),
    ],
    ...(query.chapterName ? { contentJson: { path: '$.chapterName', equals: query.chapterName } } : {}),
    ...(query.knowledgePointId ? { knowledgePointId: query.knowledgePointId } : {}),
    ...(query.cardType ? { cardType: query.cardType } : {}),
    ...(query.teacherRecommended ? { teacherRecommended: query.teacherRecommended === 'true' } : {}),
  };
  if (query.masteryState !== 'ALL') {
    const stateWhere = query.masteryState === 'FAVORITE' ? { isFavorite: true } : query.masteryState === 'MASTERED' ? { isMastered: true } : { isMastered: false };
    where.userStates = { some: { userId, ...stateWhere } };
  }
  const orderBy = query.sort === 'TITLE' ? { title: 'asc' } : { updatedAt: 'desc' };
  const [total, records] = await Promise.all([
    prisma.learningCard.count({ where }),
    prisma.learningCard.findMany({ where, include: { course: true, userStates: { where: { userId }, take: 1 } }, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  return { list: records.map(record => recordToLearningCard(record, record.userStates[0])), total, page: query.page, pageSize: query.pageSize };
}

async function getWrongQuestionRepairCard(user, wrongQuestionId) {
  const userId = Number(user.user_id);
  const wrong = await prisma.wrongQuestion.findFirst({
    where: { wrong_question_id: Number(wrongQuestionId), student_user_id: userId },
    include: { course: true, chapter: true, knowledge_point: true, question: true },
  });
  if (!wrong) throw cardError('错题不存在或无权访问', 40401, 404, 'WRONG_QUESTION_NOT_FOUND');
  const id = `lc_wrong_${hash({ userId, wrongQuestionId: wrong.wrong_question_id }).slice(0, 24)}`;
  const candidate = {
    sourceKind: 'WRONG', sourceId: wrong.wrong_question_id, cardType: 'WRONG_QUESTION',
    courseId: wrong.course_id || wrong.question?.course_id || null, courseName: wrong.course?.course_name || null,
    knowledgePointId: wrong.knowledge_point_id || wrong.question?.knowledge_point_id || null,
    knowledgePointName: wrong.knowledge_point?.knowledge_point_name || null, chapterName: wrong.chapter?.chapter_name || null,
    title: `${wrong.knowledge_point?.knowledge_point_name || '本题'}错题修复卡`,
    summary: `错误类型：${wrong.wrong_reason || '尚未分类'}。先理解错因，再完成相似练习。`,
    reason: `依据本人错题 ${wrong.wrong_question_id} 的真实记录生成。`, description: wrong.question?.analysis || wrong.knowledge_point?.description || '重新核对题目条件、核心概念和关键步骤。',
    difficulty: wrong.question?.difficulty_level, score: 100,
    metadata: { wrongQuestionId: wrong.wrong_question_id, wrongReason: String(wrong.wrong_reason || '尚未分类'), analysis: wrong.question?.analysis || null },
    sourceRefs: [{ type: 'WRONG_QUESTION', id: wrong.wrong_question_id, title: '本人错题记录', excerpt: safeText(wrong.question?.content, 1000) || null, url: null }],
  };
  const rule = daily.buildRuleCard(candidate, { userId, dateKey: daily.localDateKey(), slot: Number(wrong.wrong_question_id) });
  const card = learningCardSchema.parse({ ...rule, id });
  const data = persistenceData(card, { ownerUserId: userId, contextVersion: hash({ updatedAt: wrong.updated_at, reviewCount: wrong.review_count }), personalizationVersion: hash({ wrongReason: wrong.wrong_reason, status: wrong.review_status }) });
  const { id: cardKey, ...update } = data;
  const record = await prisma.learningCard.upsert({ where: { id: cardKey }, create: data, update, include: { course: true } });
  const state = await prisma.userLearningCardState.findUnique({ where: { userId_cardId: { userId, cardId: cardKey } } });
  return recordToLearningCard(record, state);
}

async function getSceneCards(user, query) {
  const set = await daily.getDailyCards(user);
  return { version: '1.0', scene: query.scene, learningPlanId: query.learningPlanId || null, cards: set.cards.slice(0, 5), status: set.status, generatedAt: set.generatedAt };
}

async function generateCardsArtifact(user, input, options = {}) {
  return ai.generateArtifact(user, input, options);
}

module.exports = {
  cardError, assertStudentCourseAccess, loadAccessibleCard, getCard, performAction,
  addToPlan, startPractice, askAi, ensureCourseLibrary, getCourseLibrary, getWrongQuestionRepairCard,
  getSceneCards, generateCardsArtifact,
};
