const { z } = require('zod');
const prisma = require('../../config/prisma');
const { bailianModelCall } = require('../learning-agent/adapters/bailian-model.adapter');
const artifactService = require('../ai-assistant/artifact.service');
const asyncTasks = require('../async-task/async-task.service');
const { chartSpecSchema } = require('../ai-assistant/chart-spec');
const { CARD_TYPES, learningCardSchema } = require('./learning-card.schemas');
const { hash, safeText, emptyState, defaultActions, normalizeSource, persistenceData } = require('./learning-card.protocol');
const platformCache = require('./learning-card-cache.service');

const PROMPT_VERSION = process.env.LEARNING_CARD_AI_PROMPT_VERSION || 'learning-card-platform-v1';
const MODEL_NAME = process.env.BAILIAN_MODEL || process.env.QWEN_MODEL || 'qwen3.7-plus';

const rawSectionSchema = z.object({
  type: z.enum(['MARKDOWN', 'FORMULA', 'CHART', 'TABLE', 'EXAMPLE', 'CALLOUT']),
  title: z.string().max(120).nullable().optional(),
  content: z.string().max(20000).nullable().optional(),
  formula: z.string().max(4000).nullable().optional(),
  chartSpec: z.unknown().nullable().optional(),
  tableSpec: z.unknown().nullable().optional(),
}).strict();

const rawCardSchema = z.object({
  cardType: z.enum(CARD_TYPES), title: z.string().min(2).max(200), summary: z.string().min(2).max(1000),
  difficulty: z.enum(['BASIC', 'MEDIUM', 'ADVANCED']), estimatedReadingSeconds: z.number().int().min(10).max(900),
  markdownContent: z.string().max(30000), sections: z.array(rawSectionSchema).min(1).max(12),
}).strict();

function modelError(message, code = 'LEARNING_CARD_AI_INVALID_OUTPUT', status = 502) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function parseJson(content) {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) : content;
    return Array.isArray(parsed) ? parsed : parsed?.cards;
  } catch { throw modelError('Qwen 返回的学习卡片 JSON 无效'); }
}

function repairLatexControlEscapes(value) {
  return String(value ?? '')
    .replace(/\u0008(?=(?:eta|egin|ar))/g, '\\b')
    .replace(/\u000c(?=rac)/g, '\\f')
    .replace(/\n(?=(?:eq|abla|u|ot|eg|ewline))/g, '\\n')
    .replace(/\r(?=(?:ho|ight|angle))/g, '\\r')
    .replace(/\t(?=(?:heta|ext|imes|an|au|anh))/g, '\\t');
}

function sigmoidChartSpec() {
  const xAxis = []; const values = [];
  for (let x = -6; x <= 6; x += 1) { xAxis.push(String(x)); values.push(Math.round((1 / (1 + Math.exp(-x))) * 10000) / 10000); }
  return chartSpecSchema.parse({
    version: '1.0',
    chart: { type: 'line', title: 'Sigmoid 函数曲线', subtitle: '由 σ(z)=1/(1+e^{-z}) 在 [-6, 6] 上确定性采样', xAxis, series: [{ name: 'σ(z)', data: values }], unit: null },
    table: { columns: ['z', 'σ(z)'], rows: xAxis.map((value, index) => [value, values[index]]) },
    insights: ['z=0 时函数值为 0.5；曲线单调递增并渐近于 0 和 1。'],
    source: { type: 'formula_sampling', range: 'z ∈ [-6, 6], step=1' },
  });
}

function masteryRadar(masteries) {
  const rows = (masteries || []).filter(item => item.knowledge_point?.knowledge_point_name && Number.isFinite(Number(item.mastery_score))).slice(0, 6);
  if (rows.length < 3) return null;
  const xAxis = rows.map(item => item.knowledge_point.knowledge_point_name);
  const values = rows.map(item => Math.round(Number(item.mastery_score) * 100) / 100);
  return chartSpecSchema.parse({
    version: '1.0',
    chart: { type: 'radar', title: '本人知识点掌握度雷达图', subtitle: '来自当前登录学生的 StudentMasteryRecord', xAxis, series: [{ name: '掌握度', data: values }], unit: '%' },
    table: { columns: ['知识点', '掌握度'], rows: xAxis.map((name, index) => [name, values[index]]) },
    insights: [], source: { type: 'student_mastery_records', range: '当前记录' },
  });
}

async function assertCourseAccess(user, courseId) {
  if (!courseId) return null;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin') return prisma.course.findUnique({ where: { course_id: Number(courseId) } });
  if (role === 'teacher') {
    const relation = await prisma.courseTeacherRelation.findFirst({ where: { course_id: Number(courseId), teacher_user_id: Number(user.user_id) }, include: { course: true } });
    if (!relation) throw Object.assign(new Error('无权为该课程生成学习卡片'), { code: 40301, status: 403 });
    return relation.course;
  }
  const enrollment = await prisma.studentCourseEnrollment.findFirst({ where: { student_user_id: Number(user.user_id), course_id: Number(courseId), enrollment_status: 'active' }, include: { course: true } });
  if (!enrollment) throw Object.assign(new Error('未加入该课程，无法生成学习卡片'), { code: 40301, status: 403 });
  return enrollment.course;
}

async function resolveGenerationContext(user, input) {
  const userId = Number(user.user_id);
  let knowledgePoint = input.knowledgePointId ? await prisma.knowledgePoint.findUnique({ where: { knowledge_point_id: Number(input.knowledgePointId) }, include: { course: true, chapter: true } }) : null;
  let courseId = Number(input.courseId || knowledgePoint?.course_id) || null;
  let course = await assertCourseAccess(user, courseId);
  if (!knowledgePoint && String(user.role).toLowerCase() === 'student') {
    const enrollments = await prisma.studentCourseEnrollment.findMany({ where: { student_user_id: userId, enrollment_status: 'active' }, select: { course_id: true }, take: 30 });
    const courseIds = enrollments.map(item => item.course_id);
    if (courseIds.length) {
      const topic = safeText(input.topic, 80);
      knowledgePoint = await prisma.knowledgePoint.findFirst({ where: { course_id: { in: courseIds }, OR: [{ knowledge_point_name: { contains: topic } }, { description: { contains: topic } }] }, include: { course: true, chapter: true } });
      if (!knowledgePoint && input.courseId) knowledgePoint = await prisma.knowledgePoint.findFirst({ where: { course_id: Number(input.courseId) }, include: { course: true, chapter: true }, orderBy: { sort_order: 'asc' } });
    }
  }
  if (knowledgePoint && courseId && knowledgePoint.course_id !== courseId) throw Object.assign(new Error('知识点不属于指定课程'), { code: 40001, status: 400 });
  courseId ||= knowledgePoint?.course_id || null;
  course ||= knowledgePoint?.course || await assertCourseAccess(user, courseId);
  const [documents, knowledgeBases, mastery, wrongQuestions, masteries] = await Promise.all([
    courseId ? prisma.knowledgeDocument.findMany({ where: { course_id: courseId, review_status: 'APPROVED', deleted_at: null, cleaned_text: { not: null } }, select: { document_id: true, title: true, cleaned_text: true, resource_version: true, updated_at: true }, orderBy: { updated_at: 'desc' }, take: 4 }) : [],
    courseId ? prisma.knowledgeBase.findMany({ where: { course_id: courseId, status: 'active', deleted_at: null }, select: { knowledge_base_id: true, name: true, updated_at: true }, take: 10 }) : [],
    knowledgePoint && String(user.role).toLowerCase() === 'student' ? prisma.studentMasteryRecord.findUnique({ where: { student_user_id_course_id_knowledge_point_id: { student_user_id: userId, course_id: knowledgePoint.course_id, knowledge_point_id: knowledgePoint.knowledge_point_id } } }) : null,
    String(user.role).toLowerCase() === 'student' ? prisma.wrongQuestion.findMany({ where: { student_user_id: userId, status: 'UNRESOLVED', ...(courseId ? { course_id: courseId } : {}), ...(knowledgePoint ? { knowledge_point_id: knowledgePoint.knowledge_point_id } : {}) }, include: { question: true }, orderBy: { updated_at: 'desc' }, take: 8 }) : [],
    String(user.role).toLowerCase() === 'student' ? prisma.studentMasteryRecord.findMany({ where: { student_user_id: userId, ...(courseId ? { course_id: courseId } : {}) }, include: { knowledge_point: true }, orderBy: { mastery_score: 'asc' }, take: 8 }) : [],
  ]);
  const knowledgeBaseVersion = hash({ documents: documents.map(item => [item.document_id, item.resource_version, item.updated_at]), knowledgeBases: knowledgeBases.map(item => [item.knowledge_base_id, item.updated_at]) });
  const sources = [];
  if (knowledgePoint) sources.push({ type: 'KNOWLEDGE_POINT', id: knowledgePoint.knowledge_point_id, title: knowledgePoint.knowledge_point_name, excerpt: safeText(knowledgePoint.description, 1000) || null, url: null });
  documents.forEach(item => sources.push({ type: 'DOCUMENT', id: item.document_id, title: item.title, excerpt: safeText(item.cleaned_text, 1000) || null, url: null }));
  if (!sources.length && course) sources.push({ type: 'COURSE', id: course.course_id, title: course.course_name, excerpt: safeText(course.description, 1000) || null, url: null });
  if (!sources.length) sources.push({ type: 'SYSTEM', id: null, title: '课程知识总结', excerpt: `主题：${safeText(input.topic, 500)}`, url: null });
  return { user, userId, courseId, course, knowledgePoint, documents, knowledgeBases, mastery, wrongQuestions, masteries, knowledgeBaseVersion, sources: sources.slice(0, 12) };
}

function outputSchemaPrompt() {
  return `{"cards":[{"cardType":"CONCEPT|FORMULA|PITFALL|EXAMPLE|COMPARISON|WRONG_QUESTION|TASK|PROGRESS|REVIEW","title":"string","summary":"string","difficulty":"BASIC|MEDIUM|ADVANCED","estimatedReadingSeconds":60,"markdownContent":"Markdown string","sections":[{"type":"MARKDOWN|FORMULA|EXAMPLE|CALLOUT","title":"string|null","content":"string|null","formula":"LaTeX string|null","chartSpec":null,"tableSpec":null}]}]}`;
}

async function requestBatch(context, input, batchTypes, count, signal) {
  const sourceText = context.sources.map((source, index) => `[${index + 1}] ${source.title}: ${source.excerpt || '仅使用标题范围'}`).join('\n');
  const prompt = `生成 ${count} 张 DisciMind LearningCard 1.0 学习卡片。只输出 JSON，不输出解释。\n主题：${input.topic}\n课程：${context.course?.course_name || '未指定'}\n知识点：${context.knowledgePoint?.knowledge_point_name || '按主题识别'}\n允许卡片类型：${batchTypes.join(',')}\n学习目标：${input.learningGoal || '帮助本科生理解、复习并进入练习'}\n学生薄弱点摘要：${context.mastery ? `当前掌握度 ${Math.round(context.mastery.mastery_score)}%` : '未提供，不得编造'}\n最近错误摘要：${context.wrongQuestions.length ? context.wrongQuestions.map(item => item.wrong_reason || item.question?.analysis || '未分类').join('；').slice(0, 800) : '暂无，不得编造'}\n课程难度：${context.knowledgePoint?.difficulty_level || 'MEDIUM'}\n真实来源：\n${sourceText}\n输出 Schema：${outputSchemaPrompt()}\n要求：Markdown 可包含安全表格；LaTeX 不带可执行代码；一次只生成 1 到 3 张；单卡单主题；不得伪造学生成绩、掌握度、教材或来源；图表字段保持 null，受控 ChartSpec 由服务端补充；必须基于给定来源。`;
  const response = await bailianModelCall([
    { role: 'system', content: '你是 DisciMind 个性化学习卡片生成器。使用 qwen3.7-plus 结构化 JSON 输出，关闭思考，只依据给定来源。' },
    { role: 'user', content: prompt },
  ], { jsonMode: true, enableThinking: false, temperature: 0.2, maxTokens: Math.min(2400, 900 + count * 500), timeout: 120_000, signal });
  const raw = parseJson(response.content);
  if (!Array.isArray(raw) || !raw.length) throw modelError('Qwen 没有返回学习卡片');
  return { cards: raw.slice(0, count).map(item => rawCardSchema.parse(item)), usage: response.usage || null };
}

function normalizeSection(section, index) {
  const type = section.type;
  let chartSpec = null;
  if (type === 'CHART' && section.chartSpec) chartSpec = chartSpecSchema.parse(section.chartSpec);
  const tableSpec = type === 'TABLE' && section.tableSpec ? section.tableSpec : null;
  const formula = type === 'FORMULA' ? safeText(repairLatexControlEscapes(section.formula || section.content), 4000) || null : null;
  return {
    id: `section_${index + 1}`, type,
    title: safeText(section.title, 120) || null,
    content: ['FORMULA', 'CHART', 'TABLE'].includes(type) ? (type === 'FORMULA' ? null : safeText(repairLatexControlEscapes(section.content), 20000) || null) : safeText(repairLatexControlEscapes(section.content), 20000) || null,
    formula, chartSpec, tableSpec,
  };
}

async function generateLearningCards(user, input, options = {}) {
  const context = options.context || await resolveGenerationContext(user, input);
  const requestedTypes = (input.cardTypes?.length ? input.cardTypes : ['CONCEPT', 'FORMULA', 'COMPARISON', 'PITFALL', 'EXAMPLE']).slice(0, input.count);
  const rawCards = []; const usage = [];
  for (let offset = 0; offset < input.count; offset += 3) {
    const count = Math.min(3, input.count - offset);
    const batchTypes = Array.from({ length: count }, (_, index) => requestedTypes[(offset + index) % requestedTypes.length]);
    const batch = await requestBatch(context, input, batchTypes, count, options.signal);
    rawCards.push(...batch.cards); if (batch.usage) usage.push(batch.usage);
  }
  const now = new Date().toISOString();
  const sources = context.sources.map(normalizeSource);
  const cards = rawCards.slice(0, input.count).map((raw, index) => {
    const cardType = requestedTypes[index % requestedTypes.length] || raw.cardType;
    const sections = raw.sections.map(normalizeSection);
    if ((input.includeChart || /sigmoid|S\s*形曲线/i.test(input.topic)) && cardType === 'FORMULA' && !sections.some(section => section.type === 'CHART')) {
      sections.push({ id: `section_${sections.length + 1}`, type: 'CHART', title: 'Sigmoid 函数曲线', content: null, formula: null, chartSpec: sigmoidChartSpec(), tableSpec: null });
    }
    if ((/掌握度.*雷达|雷达图/i.test(input.topic) || cardType === 'PROGRESS') && !sections.some(section => section.type === 'CHART')) {
      const chart = masteryRadar(context.masteries); if (chart) sections.push({ id: `section_${sections.length + 1}`, type: 'CHART', title: '本人掌握度雷达图', content: null, formula: null, chartSpec: chart, tableSpec: null });
    }
    const id = options.existingIds?.[index] || `lc_${hash({ userId: context.userId, topic: input.topic, index, raw, at: now }).slice(0, 24)}`;
    const card = {
      version: '1.0', id, scope: 'STUDENT', cardType,
      title: safeText(raw.title, 200), summary: safeText(raw.summary, 1000), courseId: context.courseId,
      courseName: safeText(context.course?.course_name, 200) || null, knowledgePointId: context.knowledgePoint?.knowledge_point_id || input.knowledgePointId || null,
      knowledgePointName: safeText(context.knowledgePoint?.knowledge_point_name, 200) || null, chapterName: safeText(context.knowledgePoint?.chapter?.chapter_name, 200) || null,
      difficulty: raw.difficulty, estimatedReadingSeconds: raw.estimatedReadingSeconds,
      recommendationReason: context.mastery ? `结合本人当前 ${Math.round(context.mastery.mastery_score)}% 掌握度和近期学习记录生成。` : '依据当前课程、知识点和已授权来源生成。',
      priorityScore: Number(options.priorityScore || 0), markdownContent: safeText(repairLatexControlEscapes(raw.markdownContent), 30000), sections,
      sourceRefs: sources, actions: [], state: emptyState(),
      generator: { model: MODEL_NAME, promptVersion: PROMPT_VERSION, knowledgeBaseVersion: context.knowledgeBaseVersion, generationMode: 'AI' },
      createdAt: now, expiresAt: options.expiresAt || null,
    };
    card.actions = defaultActions(card);
    return learningCardSchema.parse(card);
  });
  if (new Set(cards.map(card => card.title.trim().toLowerCase())).size !== cards.length) throw modelError('Qwen 生成了重复标题');
  return { cards, usage, context };
}

async function persistCards(user, generated, extra = {}) {
  for (const card of generated.cards) {
    const data = persistenceData(card, {
      ownerUserId: user.user_id, cacheKey: extra.cacheKey, status: 'READY',
      contextVersion: extra.contextVersion || generated.context?.knowledgeBaseVersion,
      personalizationVersion: extra.personalizationVersion || hash({ mastery: generated.context?.mastery, wrongQuestions: generated.context?.wrongQuestions?.map(item => item.wrong_question_id) }),
      recommendationDate: extra.recommendationDate || null,
    });
    const { id, ...update } = data;
    await prisma.learningCard.upsert({ where: { id }, create: data, update });
  }
  return generated.cards;
}

async function generateArtifact(user, input, options = {}) {
  const generated = await generateLearningCards(user, input, options);
  await persistCards(user, generated);
  const record = await artifactService.createCards({ user, courseId: generated.context.courseId }, {
    title: input.title || `已生成 ${generated.cards.length} 张${safeText(input.topic, 80)}学习卡片`,
    cards: generated.cards, description: `LearningCard 1.0 · ${generated.cards.length} 张`,
    knowledgePointIds: generated.context.knowledgePoint ? [generated.context.knowledgePoint.knowledge_point_id] : [],
    requirements: { source: 'learning-card-platform', schemaVersion: '1.0', promptVersion: PROMPT_VERSION },
    metadata: { kind: 'learning_cards', schemaVersion: '1.0', cardIds: generated.cards.map(card => card.id) },
  });
  return { artifact: artifactService.serialize(record), cards: generated.cards, model: MODEL_NAME, promptVersion: PROMPT_VERSION, usage: generated.usage };
}

function isRecoverableAiEnhancementError(error) {
  const code = String(error?.code || '');
  return error?.name === 'ZodError'
    || code.startsWith('BAILIAN_')
    || code.startsWith('LEARNING_CARD_AI_')
    || ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT'].includes(code);
}

async function processDailyCardTask(task, { signal } = {}) {
  const setId = Number(task.requestPayloadJson?.setId || task.metadataJson?.setId);
  const set = await prisma.dailyLearningCardSet.findFirst({ where: { id: setId, userId: task.userId }, include: { user: true, items: { include: { card: true }, orderBy: { slot: 'asc' } } } });
  if (!set) throw Object.assign(new Error('每日学习卡片集合不存在'), { code: 'DAILY_CARD_SET_NOT_FOUND', permanent: true });
  if (set.dataSnapshotVersion !== task.requestPayloadJson?.dataSnapshotVersion) throw Object.assign(new Error('每日学习数据快照已变化'), { code: 'DAILY_CARD_SET_STALE', permanent: true, userMessage: '学习状态已更新，卡片将在下次进入首页时刷新。' });
  const requestedGenerationToken = String(task.requestPayloadJson?.generationToken || task.metadataJson?.generationToken || '');
  const currentGenerationToken = String(set.items[0]?.contextJson?.generationToken || '');
  if (requestedGenerationToken && requestedGenerationToken !== currentGenerationToken) throw Object.assign(new Error('每日学习卡片生成轮次已更新'), { code: 'DAILY_CARD_SET_STALE', permanent: true, userMessage: '已开始生成更新的一组学习卡片。' });
  const user = { user_id: task.userId, role: 'student' };
  let aiCount = 0; let aiFailureCount = 0;
  try {
    const requestedTargetIds = new Set((task.requestPayloadJson?.targetCardIds || task.metadataJson?.targetCardIds || []).map(String));
    const eligible = set.items.filter(item => !['TASK', 'PROGRESS'].includes(item.card.cardType));
    const targets = (requestedTargetIds.size ? eligible.filter(item => requestedTargetIds.has(item.cardId)) : eligible).slice(0, 3);
    for (const item of targets) {
      const current = item.card.contentJson;
      try {
        const generated = await generateLearningCards(user, {
          topic: current.knowledgePointName || current.title, title: current.title, courseId: current.courseId || undefined,
          knowledgePointId: current.knowledgePointId || undefined, cardTypes: [current.cardType], count: 1,
          learningGoal: current.recommendationReason, includeChart: current.cardType === 'FORMULA',
        }, { signal, existingIds: [current.id], priorityScore: item.score, expiresAt: current.expiresAt });
        await persistCards(user, generated, { cacheKey: item.card.cacheKey }); aiCount += 1;
      } catch (error) {
        if (!isRecoverableAiEnhancementError(error)) throw error;
        aiFailureCount += 1;
        console.warn('[learning-card] AI enhancement kept rule fallback', { setId: set.id, cardId: current.id, code: error.code || error.name });
      }
    }
    await prisma.dailyLearningCardSet.update({ where: { id: set.id }, data: { generationStatus: 'READY', refreshedAt: new Date() } });
    const daily = require('./daily-learning-card-recommendation.service');
    const readySet = await prisma.dailyLearningCardSet.findUnique({ where: { id: set.id }, include: { items: { include: { card: { include: { course: true } } }, orderBy: { slot: 'asc' } } } });
    if (readySet) await platformCache.writeDaily(await daily.serializeSet(readySet, task.userId)).catch(() => null);
    const wrongCount = set.items.filter(item => item.sourceKind === 'WRONG').length;
    const idempotencyKey = `daily-learning-cards:${task.userId}:${set.recommendationDate.toISOString().slice(0, 10)}`;
    await prisma.notification.upsert({
      where: { idempotency_key: idempotencyKey },
      create: { receiver_user_id: task.userId, notification_type: 'SYSTEM_NOTICE', title: '今日学习卡片已更新', content: `今日学习卡片已更新，共 ${set.items.length} 张，其中 ${wrongCount} 张与你最近的错题有关。`, target_type: 'learning_card_daily', target_id: set.id, business_type: 'LEARNING_CARD_DAILY', business_id: set.id, idempotency_key: idempotencyKey },
      update: { content: `今日学习卡片已更新，共 ${set.items.length} 张，其中 ${wrongCount} 张与你最近的错题有关。`, is_read: false, read_at: null, deleted_at: null },
    });
    await asyncTasks.updateTask(task.id, {
      status: 'SUCCEEDED', stage: '今日学习卡片已更新', completedAt: new Date(),
      errorCode: null, errorMessage: null,
      metadataJson: { ...(task.metadataJson || {}), cardCount: set.items.length, aiCardCount: aiCount, aiFallbackCount: aiFailureCount },
    });
    return { setId: set.id, cardCount: set.items.length, aiCardCount: aiCount, aiFallbackCount: aiFailureCount };
  } catch (error) {
    await prisma.dailyLearningCardSet.update({ where: { id: set.id }, data: { generationStatus: 'FAILED', refreshedAt: new Date() } }).catch(() => null);
    const dateKey = set.recommendationDate.toISOString().slice(0, 10);
    const cached = await platformCache.readDaily(task.userId, dateKey).catch(() => null);
    if (cached) await platformCache.writeDaily({ ...cached, status: 'FAILED', refreshedAt: new Date().toISOString() }).catch(() => null);
    error.userMessage = 'AI 卡片增强暂时不可用，已继续使用真实课程数据生成的规则卡片。';
    throw error;
  }
}

module.exports = {
  PROMPT_VERSION, MODEL_NAME, rawCardSchema, parseJson, repairLatexControlEscapes, sigmoidChartSpec, masteryRadar,
  resolveGenerationContext, generateLearningCards, persistCards, generateArtifact,
  isRecoverableAiEnhancementError, processDailyCardTask,
};
