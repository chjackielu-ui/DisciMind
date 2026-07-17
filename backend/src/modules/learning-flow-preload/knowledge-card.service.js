const crypto = require('crypto');
const prisma = require('../../config/prisma');
const asyncTasks = require('../async-task/async-task.service');
const { bailianModelCall } = require('../learning-agent/adapters/bailian-model.adapter');
const artifactService = require('../ai-assistant/artifact.service');
const cache = require('./knowledge-card-cache.service');
const { knowledgeCardSchema, knowledgeCardDeckSchema, cardStatePatchSchema } = require('./knowledge-card.schemas');
const { legacyToLearningCard, persistenceData, recordToLearningCard } = require('../learning-card/learning-card.protocol');

const PROMPT_VERSION = process.env.LEARNING_CARD_PROMPT_VERSION || 'knowledge-card-v1';
const LANGUAGE = 'zh-CN';

function cardError(message, code = 40001, status = 400) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function normalizeNodeType(value) {
  return String(value || 'concept_explanation').trim().toLowerCase().replace(/[\s-]+/g, '_').slice(0, 100);
}

function cardTypesForNode(nodeType, scope) {
  if (scope === 'personalized') {
    if (/(?:adaptive|wrong_question)/u.test(nodeType)) return ['wrong_question_repair', 'pitfall'];
    if (/(?:mastery|summary)/u.test(nodeType)) return ['review', 'exam_tip'];
    return ['pitfall', 'review'];
  }
  if (/(?:basic_practice|adaptive_practice)/u.test(nodeType)) return ['pitfall', 'example', 'exam_tip'];
  if (/(?:mastery_gate|timed)/u.test(nodeType)) return ['review', 'exam_tip', 'formula'];
  if (/learning_summary/u.test(nodeType)) return ['review', 'comparison', 'concept'];
  return ['concept', 'formula', 'comparison'];
}

function shortText(value, max = 300) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function resolveSessionContext(userId, sessionId, requestedNodeId) {
  const session = await prisma.learningSession.findFirst({
    where: { session_id: Number(sessionId), student_user_id: Number(userId) },
    include: { course: true, knowledge_point: true },
  });
  if (!session?.course || !session.knowledge_point) throw cardError('学习会话缺少课程或知识点，无法准备知识卡片', 40901, 409);
  const nodeId = String(requestedNodeId || session.current_node_id || 'current');
  const node = (session.runtime_graph_json?.nodes || []).find(item => String(item.id) === nodeId) || null;
  const nodeType = normalizeNodeType(node?.type || node?.agentType || 'concept_explanation');
  const [mastery, wrongQuestions, knowledgeBases, documents] = await Promise.all([
    prisma.studentMasteryRecord.findUnique({
      where: { student_user_id_course_id_knowledge_point_id: { student_user_id: Number(userId), course_id: session.course_id, knowledge_point_id: session.knowledge_point_id } },
      select: { mastery_score: true, mastery_level: true, updated_at: true },
    }),
    prisma.wrongQuestion.findMany({
      where: { student_user_id: Number(userId), course_id: session.course_id, knowledge_point_id: session.knowledge_point_id, status: 'UNRESOLVED' },
      select: { wrong_reason: true, last_wrong_at: true, updated_at: true }, orderBy: { updated_at: 'desc' }, take: 10,
    }),
    prisma.knowledgeBase.findMany({
      where: { course_id: session.course_id, status: 'active', deleted_at: null },
      select: { knowledge_base_id: true, name: true, updated_at: true }, orderBy: { updated_at: 'desc' }, take: 10,
    }),
    prisma.knowledgeDocument.findMany({
      where: { course_id: session.course_id, review_status: 'APPROVED', deleted_at: null, cleaned_text: { not: null } },
      select: { document_id: true, title: true, cleaned_text: true, resource_version: true, updated_at: true }, orderBy: { updated_at: 'desc' }, take: 3,
    }),
  ]);
  const knowledgeBaseVersion = cache.hash({
    knowledgeBases: knowledgeBases.map(item => [item.knowledge_base_id, item.updated_at]),
    documents: documents.map(item => [item.document_id, item.resource_version, item.updated_at]),
  });
  const personalizationVersion = cache.hash({ mastery, wrongQuestions });
  const baseDimensions = {
    courseId: session.course_id, knowledgePointId: session.knowledge_point_id, nodeType,
    cardType: cardTypesForNode(nodeType, 'universal').join(','), knowledgeBaseVersion,
    promptVersion: PROMPT_VERSION, modelVersion: process.env.BAILIAN_MODEL || 'qwen3.7-plus', language: LANGUAGE,
  };
  const universalDimensions = { ...baseDimensions, personalizationVersion: 'universal-v1' };
  const personalizedDimensions = { ...baseDimensions, cardType: cardTypesForNode(nodeType, 'personalized').join(','), personalizationVersion };
  return {
    userId: Number(userId), sessionId: session.session_id, nodeId, nodeType, course: session.course, knowledgePoint: session.knowledge_point,
    mastery, wrongQuestions, knowledgeBases, documents, knowledgeBaseVersion, personalizationVersion,
    universalDimensions, personalizedDimensions,
    universalKey: cache.hash(universalDimensions),
    personalizedKey: cache.hash({ ...personalizedDimensions, userId: Number(userId) }),
  };
}

function sourceRefs(context, scope) {
  const refs = [{ type: 'KNOWLEDGE_POINT', id: context.knowledgePoint.knowledge_point_id, title: context.knowledgePoint.knowledge_point_name, excerpt: shortText(context.knowledgePoint.description, 300) || null }];
  if (context.documents.length) refs.push(...context.documents.map(item => ({ type: 'KNOWLEDGE_BASE', id: item.document_id, title: item.title, excerpt: shortText(item.cleaned_text, 300) || null })).slice(0, 3));
  else refs.push({ type: 'COURSE', id: context.course.course_id, title: context.course.course_name, excerpt: shortText(context.course.description, 300) || null });
  if (scope === 'personalized' && context.mastery) refs.push({ type: 'STUDENT_MASTERY', id: context.knowledgePoint.knowledge_point_id, title: '本人知识点掌握度', excerpt: `当前记录为 ${Math.round(context.mastery.mastery_score)}%（${context.mastery.mastery_level}）` });
  if (scope === 'personalized' && context.wrongQuestions.length) refs.push({ type: 'WRONG_QUESTION', id: context.knowledgePoint.knowledge_point_id, title: '本人未解决错题', excerpt: `当前知识点有 ${context.wrongQuestions.length} 道未解决错题` });
  return refs.slice(0, 8);
}

function fallbackCard(context, scope, version = 1) {
  const point = context.knowledgePoint;
  const base = shortText(point.description || context.course.description || `${point.knowledge_point_name}是${context.course.course_name}中的当前学习知识点。`, 240);
  const personalized = scope === 'personalized';
  const summary = personalized
    ? (context.mastery ? `当前掌握度记录为 ${Math.round(context.mastery.mastery_score)}%；先核对核心定义，再进入练习。` : context.wrongQuestions.length ? `当前有 ${context.wrongQuestions.length} 道未解决错题；练习前先复习易混概念。` : `当前暂无个性化掌握记录，先用核心概念完成热身。`)
    : base;
  const cardType = personalized ? (context.wrongQuestions.length ? 'wrong_question_repair' : 'review') : 'concept';
  return knowledgeCardSchema.parse({
    id: `kc_${cache.hash({ scope, session: context.sessionId, point: point.knowledge_point_id, node: context.nodeType, version }).slice(0, 20)}`,
    courseId: context.course.course_id, knowledgePointId: point.knowledge_point_id, knowledgePointName: point.knowledge_point_name,
    nodeType: context.nodeType, cardType,
    title: personalized ? `${point.knowledge_point_name}学习提醒` : `${point.knowledge_point_name}核心概念`,
    summary, sections: [{ type: 'text', title: personalized ? '练习前建议' : '先看结论', content: personalized ? summary : base }],
    difficulty: 'basic', estimatedReadingSeconds: 35, sourceRefs: sourceRefs(context, scope), chartSpec: null,
    personalizedReason: personalized ? '依据本人当前掌握记录与未解决错题数量生成；不会直接改变正式掌握度。' : null,
    version, scope,
  });
}

function fallbackDeck(context, scope, cacheKey, status = 'generating', errorCode = null) {
  const dimensions = scope === 'universal' ? context.universalDimensions : context.personalizedDimensions;
  const now = new Date();
  return knowledgeCardDeckSchema.parse({
    schemaVersion: '1.0', cacheKey, status, courseId: context.course.course_id,
    knowledgePointId: context.knowledgePoint.knowledge_point_id, nodeType: context.nodeType, scope, dimensions,
    cards: [fallbackCard(context, scope)], fallback: true, errorCode,
    generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + cache.READY_TTL_MS).toISOString(),
  });
}

function parseModelCards(content) {
  let parsed;
  try { parsed = typeof content === 'string' ? JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) : content; }
  catch { throw cardError('知识卡片模型返回的 JSON 无效', 'KNOWLEDGE_CARD_INVALID_JSON', 502); }
  return Array.isArray(parsed) ? parsed : parsed?.cards;
}

function formulaLooksValid(value) {
  const text = String(value || '');
  return (text.match(/\$/g) || []).length % 2 === 0 && text.length <= 2000;
}

async function generateCards(context, scope, signal) {
  const types = cardTypesForNode(context.nodeType, scope);
  const refs = sourceRefs(context, scope);
  const sourceText = refs.map((ref, index) => `[${index + 1}] ${ref.title}: ${ref.excerpt || '仅使用标题范围'}`).join('\n');
  const count = scope === 'universal' ? 3 : 2;
  const prompt = `为本科生生成 ${count} 张简洁知识卡片。只输出 JSON：{"cards":[...]}。\n课程：${context.course.course_name}\n知识点：${context.knowledgePoint.knowledge_point_name}\n节点：${context.nodeType}\n允许类型：${types.join(',')}\n范围：${scope}\n真实来源：\n${sourceText}\n${scope === 'personalized' ? `本人掌握度：${context.mastery?.mastery_score ?? '暂无'}；未解决错题：${context.wrongQuestions.length}。` : ''}\n每张字段仅含 cardType,title,summary,sections,difficulty,estimatedReadingSeconds,personalizedReason。sections 的 type 只能是 text/formula/list/example；先给结论，单卡单主题，公式使用成对 $，不得编造教材或来源，不得输出学生身份。`;
  const response = await bailianModelCall([
    { role: 'system', content: '你是 DisciMind 知识卡片快速生成器。使用 qwen3.7-plus JSON mode；关闭思考；只依据给定课程、知识点和来源。' },
    { role: 'user', content: prompt },
  ], { jsonMode: true, enableThinking: false, temperature: 0.2, maxTokens: 1300, timeout: 90_000, signal });
  const rawCards = parseModelCards(response.content);
  if (!Array.isArray(rawCards) || rawCards.length < 1) throw cardError('知识卡片模型没有返回卡片', 'KNOWLEDGE_CARD_EMPTY', 502);
  const cards = rawCards.slice(0, count).map((raw, index) => knowledgeCardSchema.parse({
    id: `kc_${cache.hash({ key: scope === 'universal' ? context.universalKey : context.personalizedKey, index, content: raw }).slice(0, 20)}`,
    courseId: context.course.course_id, knowledgePointId: context.knowledgePoint.knowledge_point_id,
    knowledgePointName: context.knowledgePoint.knowledge_point_name, nodeType: context.nodeType,
    cardType: types.includes(raw.cardType) ? raw.cardType : types[index % types.length],
    title: shortText(raw.title, 100), summary: shortText(raw.summary, 300),
    sections: (Array.isArray(raw.sections) ? raw.sections : []).slice(0, 5).map(section => ({
      type: ['text', 'formula', 'list', 'example'].includes(section.type) ? section.type : 'text',
      title: shortText(section.title || '要点', 100), content: shortText(section.content, 2000),
    })),
    difficulty: ['basic', 'medium', 'advanced'].includes(raw.difficulty) ? raw.difficulty : 'medium',
    estimatedReadingSeconds: Math.max(10, Math.min(300, Number(raw.estimatedReadingSeconds) || 45)),
    sourceRefs: refs, chartSpec: null,
    personalizedReason: scope === 'personalized' ? shortText(raw.personalizedReason || '依据本人当前学习记录生成。', 300) : null,
    version: 1, scope,
  }));
  if (cards.some(card => card.sections.some(section => section.type === 'formula' && !formulaLooksValid(section.content)))) throw cardError('知识卡片公式格式校验失败', 'KNOWLEDGE_CARD_FORMULA_INVALID', 502);
  return { cards, usage: response.usage || null };
}

async function enqueueDeck(context, scope, { force = false, reason = 'session_open' } = {}) {
  const cacheKey = scope === 'universal' ? context.universalKey : context.personalizedKey;
  const existing = await cache.readDeck(cacheKey);
  if (!existing) await cache.writeDeck(fallbackDeck(context, scope, cacheKey));
  if (!force && existing?.status === 'ready') return null;
  const operation = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  return asyncTasks.createTask(context.userId, {
    operationId: `knowledge-card-${cacheKey.slice(0, 24)}-${operation}`,
    taskType: 'LEARNING_FLOW_PRELOAD', title: scope === 'universal' ? '准备当前节点知识卡片' : '准备个性化知识卡片',
    description: `${context.knowledgePoint.knowledge_point_name} · ${context.nodeType}`,
    status: 'QUEUED', stage: scope === 'universal' ? '准备核心概念卡片' : '准备个性化复习卡片', progressMode: 'STAGE_ONLY',
    relatedResourceType: 'LEARNING_CARD_CACHE', relatedResourceId: cacheKey,
    resultType: 'LEARNING_CARDS', resultId: context.sessionId,
    resultUrl: `#/student/learning/session/${context.sessionId}`, cancellable: false, maxAttempts: 2,
    dedupeKey: `knowledge-card:${cacheKey}`,
    metadataJson: { kind: 'LEARNING_CARD', cacheKey, scope, priority: scope === 'universal' ? 'P0' : 'P2', reason, sessionId: context.sessionId, nodeId: context.nodeId },
    requestPayloadJson: { sessionId: context.sessionId, nodeId: context.nodeId, scope, cacheKey },
  });
}

async function processCardTask(task, { signal } = {}) {
  const request = task.requestPayloadJson || {};
  const context = await resolveSessionContext(task.userId, request.sessionId, request.nodeId);
  const scope = request.scope === 'personalized' ? 'personalized' : 'universal';
  const expectedKey = scope === 'universal' ? context.universalKey : context.personalizedKey;
  if (request.cacheKey !== expectedKey) throw Object.assign(new Error('知识卡片依赖已变化'), { code: 'KNOWLEDGE_CARD_STALE', permanent: true, userMessage: '学习内容已更新，知识卡片将在下次打开时重新准备。' });
  try {
    const generated = await generateCards(context, scope, signal);
    const now = new Date();
    const deck = await cache.writeDeck({
      schemaVersion: '1.0', cacheKey: expectedKey, status: 'ready', courseId: context.course.course_id,
      knowledgePointId: context.knowledgePoint.knowledge_point_id, nodeType: context.nodeType, scope,
      dimensions: scope === 'universal' ? context.universalDimensions : context.personalizedDimensions,
      cards: generated.cards, fallback: false, errorCode: null,
      generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + cache.READY_TTL_MS).toISOString(),
    });
    await asyncTasks.updateTask(task.id, { status: 'SUCCEEDED', stage: '知识卡片已就绪', requiresUserAction: false, resultType: 'LEARNING_CARDS', resultId: context.sessionId, resultUrl: `#/student/learning/session/${context.sessionId}`, metadataJson: { ...(task.metadataJson || {}), cardCount: deck.cards.length, fallback: false, usage: generated.usage } });
    return deck;
  } catch (error) {
    const fallback = fallbackDeck(context, scope, expectedKey, 'failed', String(error.code || 'KNOWLEDGE_CARD_GENERATION_FAILED').slice(0, 100));
    await cache.writeDeck(fallback);
    error.userMessage = '知识卡片已使用课程内容降级展示，后台生成可以稍后重试。';
    throw error;
  }
}

async function decorateStates(userId, cards) {
  return Promise.all(cards.map(async card => ({ ...card, userState: await cache.readCardState(userId, card.id) || { favorite: false, mastered: false, expanded: false } })));
}

async function unifySessionCards(context, cards, generatedAt) {
  const normalized = [];
  for (const legacy of cards) {
    const sidecar = await cache.readCardState(context.userId, legacy.id);
    const card = legacyToLearningCard(legacy, {
      state: { isFavorite: sidecar?.favorite, isMastered: sidecar?.mastered },
      courseName: context.course.course_name, generatedAt,
      knowledgeBaseVersion: context.knowledgeBaseVersion, promptVersion: PROMPT_VERSION,
    });
    const data = persistenceData(card, {
      ownerUserId: card.scope === 'STUDENT' ? context.userId : null,
      contextVersion: card.scope === 'STUDENT' ? context.personalizationVersion : context.knowledgeBaseVersion,
      personalizationVersion: card.scope === 'STUDENT' ? context.personalizationVersion : 'universal-v1',
    });
    const { id, ...update } = data;
    const record = await prisma.learningCard.upsert({ where: { id }, create: data, update, include: { course: true } });
    const state = await prisma.userLearningCardState.findUnique({ where: { userId_cardId: { userId: context.userId, cardId: id } } });
    normalized.push(recordToLearningCard(record, state));
  }
  return normalized;
}

async function getSessionCards(user, sessionId, options = {}) {
  const context = await resolveSessionContext(user.user_id, sessionId, options.nodeId);
  let universalDeck = await cache.readDeck(context.universalKey);
  let personalizedDeck = await cache.readDeck(context.personalizedKey);
  const universalMissing = !universalDeck; const personalizedMissing = !personalizedDeck;
  if (universalMissing) universalDeck = await cache.writeDeck(fallbackDeck(context, 'universal', context.universalKey));
  if (personalizedMissing) personalizedDeck = await cache.writeDeck(fallbackDeck(context, 'personalized', context.personalizedKey));
  // A previous worker may have stopped after writing the immediate fallback deck.
  // Re-enqueueing a GENERATING deck is safe because AsyncTask dedupes active cache keys,
  // and it prevents a stale "generating" sidecar from blocking recovery forever.
  if (universalMissing || ['generating', 'stale', 'failed'].includes(universalDeck.status)) void enqueueDeck(context, 'universal', { force: !universalMissing, reason: options.reason || 'session_open' }).catch(() => {});
  if (personalizedMissing || ['generating', 'stale', 'failed'].includes(personalizedDeck.status)) void enqueueDeck(context, 'personalized', { force: !personalizedMissing, reason: options.reason || 'session_open' }).catch(() => {});
  const merged = [...universalDeck.cards, ...personalizedDeck.cards].filter((card, index, list) => list.findIndex(item => item.id === card.id || item.title === card.title) === index).slice(0, 5);
  return {
    schemaVersion: '1.0', sessionId: context.sessionId, nodeId: context.nodeId, nodeType: context.nodeType,
    course: { id: context.course.course_id, name: context.course.course_name },
    knowledgePoint: { id: context.knowledgePoint.knowledge_point_id, name: context.knowledgePoint.knowledge_point_name },
    status: universalDeck.status === 'ready' && personalizedDeck.status === 'ready' ? 'ready' : universalDeck.status === 'stale' || personalizedDeck.status === 'stale' ? 'stale' : 'generating',
    cards: await unifySessionCards(context, merged, [universalDeck.generatedAt, personalizedDeck.generatedAt].sort().at(-1)),
    cache: { universal: { key: context.universalKey, status: universalDeck.status }, personalized: { key: context.personalizedKey, status: personalizedDeck.status } },
    immediateFallback: universalDeck.fallback || personalizedDeck.fallback,
  };
}

async function assertCardInSession(user, sessionId, cardId, nodeId) {
  const deck = await getSessionCards(user, sessionId, { nodeId, reason: 'card_action' });
  const card = deck.cards.find(item => item.id === String(cardId));
  if (!card) throw cardError('知识卡片不存在或已过期', 40401, 404);
  return { deck, card };
}

async function updateCardState(user, sessionId, cardId, input = {}) {
  const patch = cardStatePatchSchema.parse(input.state || input);
  const { card } = await assertCardInSession(user, sessionId, cardId, input.nodeId);
  const central = require('../learning-card/learning-card.service');
  let result = { state: card.state };
  if (patch.favorite != null) result = await central.performAction(user, card.id, { action: patch.favorite ? 'FAVORITE' : 'UNFAVORITE' });
  if (patch.mastered != null) result = await central.performAction(user, card.id, { action: patch.mastered ? 'MASTERED' : 'UNMASTERED' });
  if (patch.expanded != null) await central.performAction(user, card.id, { action: 'EXPAND' });
  await cache.writeCardState(user.user_id, card.id, patch);
  return { cardId: card.id, state: result.state, expanded: Boolean(patch.expanded), masteryUnaffected: true };
}

async function saveCardArtifact(user, sessionId, cardId, input = {}) {
  const { deck, card } = await assertCardInSession(user, sessionId, cardId, input.nodeId);
  const record = await artifactService.createCards({ user, courseId: deck.course.id }, {
    title: `${card.knowledgePointName || card.title}知识卡片`, cards: [card],
    description: `学习会话 ${sessionId} 保存的知识卡片`, metadata: { learningSessionId: Number(sessionId), cardId: card.id },
  });
  return artifactService.serialize(record);
}

async function regenerate(user, sessionId, input = {}) {
  const context = await resolveSessionContext(user.user_id, sessionId, input.nodeId);
  await enqueueDeck(context, 'universal', { force: true, reason: 'manual_regenerate' });
  await enqueueDeck(context, 'personalized', { force: true, reason: 'manual_regenerate' });
  return getSessionCards(user, sessionId, { nodeId: context.nodeId, reason: 'manual_regenerate' });
}

function fireAndRecord(input) {
  setImmediate(() => getSessionCards({ user_id: Number(input.userId), role: 'student' }, input.sessionId, { nodeId: input.nodeId, reason: input.reason || 'node_start' }).catch(error => {
    console.warn('[knowledge-card] background prepare failed', { sessionId: Number(input.sessionId), code: error.code || 'KNOWLEDGE_CARD_PREPARE_FAILED' });
  }));
}

module.exports = {
  PROMPT_VERSION, LANGUAGE, normalizeNodeType, cardTypesForNode, resolveSessionContext, sourceRefs,
  fallbackCard, fallbackDeck, generateCards, enqueueDeck, processCardTask, getSessionCards,
  unifySessionCards, updateCardState, saveCardArtifact, regenerate, fireAndRecord,
};
