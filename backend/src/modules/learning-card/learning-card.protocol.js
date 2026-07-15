const crypto = require('crypto');
const { learningCardSchema } = require('./learning-card.schemas');

const LEGACY_TYPES = Object.freeze({
  concept: 'CONCEPT', formula: 'FORMULA', comparison: 'COMPARISON', pitfall: 'PITFALL',
  example: 'EXAMPLE', exam_tip: 'REVIEW', wrong_question_repair: 'WRONG_QUESTION', review: 'REVIEW',
});

const LEGACY_SECTIONS = Object.freeze({
  text: 'MARKDOWN', list: 'MARKDOWN', formula: 'FORMULA', chart: 'CHART', example: 'EXAMPLE',
});

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function learningCardCacheKey(card, extra = {}) {
  return hash({
    namespace: 'learning-card-v1',
    userId: extra.ownerUserId || (card.scope === 'STUDENT' ? 'STUDENT' : 'GLOBAL'),
    courseId: card.courseId || null,
    knowledgePointId: card.knowledgePointId || null,
    cardType: card.cardType,
    contextVersion: extra.contextVersion || null,
    knowledgeBaseVersion: extra.knowledgeBaseVersion ?? card.generator?.knowledgeBaseVersion ?? null,
    promptVersion: extra.promptVersion ?? card.generator?.promptVersion ?? null,
    modelVersion: extra.modelVersion ?? card.generator?.model ?? null,
    recommendationDate: extra.recommendationDate || null,
    personalizationVersion: extra.personalizationVersion || null,
  });
}

function safeText(value, max = 1000) {
  const text = String(value ?? '').replace(/<\s*\/?\s*(?:script|iframe|object|embed)[^>]*>/gi, '').trim();
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function emptyState() {
  return { isFavorite: false, isMastered: false, isDeferred: false, isIgnored: false, viewCount: 0, dwellTimeMs: 0 };
}

function stateFromRecord(state) {
  return {
    isFavorite: Boolean(state?.isFavorite ?? state?.favorite),
    isMastered: Boolean(state?.isMastered ?? state?.mastered),
    isDeferred: Boolean(state?.isDeferred ?? state?.deferred),
    isIgnored: Boolean(state?.isIgnored ?? state?.ignored),
    viewCount: Math.max(0, Number(state?.viewCount) || 0),
    dwellTimeMs: Math.max(0, Number(state?.totalDwellTimeMs ?? state?.dwellTimeMs) || 0),
  };
}

function defaultActions(card = {}) {
  const actions = [
    ['FAVORITE', '收藏'], ['MASTERED', '标记已掌握'], ['DEFER', '稍后学习'], ['IGNORE', '不感兴趣'],
    ['ADD_TO_PLAN', '加入学习计划'], ['START_PRACTICE', '开始相关练习'], ['ASK_AI', '询问 AI'],
    ['SAVE_ARTIFACT', '保存成果'], ['EXPORT', '导出'],
  ];
  if (card.knowledgePointId) actions.push(['VIEW_KNOWLEDGE_POINT', '查看知识点']);
  if (card.sourceRefs?.length) actions.push(['VIEW_SOURCE', '查看来源']);
  return actions.map(([type, label]) => ({ type, label, enabled: true }));
}

function normalizeSource(source, index = 0) {
  const type = String(source?.type || 'SYSTEM').toUpperCase();
  const supported = new Set(['COURSE', 'KNOWLEDGE_POINT', 'KNOWLEDGE_BASE', 'DOCUMENT', 'STUDENT_MASTERY', 'WRONG_QUESTION', 'TASK', 'LEARNING_PLAN', 'SYSTEM']);
  return {
    type: supported.has(type) ? type : 'SYSTEM',
    id: source?.id == null ? null : typeof source.id === 'number' ? source.id : safeText(source.id, 100),
    title: safeText(source?.title || `课程知识总结 ${index + 1}`, 200) || '课程知识总结',
    excerpt: safeText(source?.excerpt, 1000) || null,
    url: safeText(source?.url, 1000) || null,
  };
}

function legacyToLearningCard(legacy, context = {}) {
  if (legacy?.version === '1.0' && /^[A-Z_]+$/.test(String(legacy.cardType || ''))) {
    return learningCardSchema.parse({ ...legacy, state: stateFromRecord(context.state || legacy.state) });
  }
  const createdAt = context.generatedAt || legacy?.createdAt || new Date().toISOString();
  const sections = (Array.isArray(legacy?.sections) ? legacy.sections : []).map((section, index) => {
    const type = LEGACY_SECTIONS[String(section?.type || '').toLowerCase()] || 'MARKDOWN';
    const content = safeText(section?.content, 20000) || null;
    return {
      id: `section_${index + 1}`,
      type,
      title: safeText(section?.title, 120) || null,
      content: type === 'FORMULA' ? null : content,
      formula: type === 'FORMULA' ? content : null,
      chartSpec: type === 'CHART' && section?.chartSpec ? section.chartSpec : null,
      tableSpec: null,
    };
  });
  if (!sections.length) sections.push({ id: 'section_1', type: 'MARKDOWN', title: '核心内容', content: safeText(legacy?.summary || '课程知识总结', 20000), formula: null, chartSpec: null, tableSpec: null });
  const sources = (Array.isArray(legacy?.sourceRefs) ? legacy.sourceRefs : []).map(normalizeSource);
  if (!sources.length) sources.push(normalizeSource({ type: legacy?.knowledgePointId ? 'KNOWLEDGE_POINT' : 'COURSE', id: legacy?.knowledgePointId || legacy?.courseId || null, title: legacy?.knowledgePointName || context.courseName || '课程知识总结' }));
  const card = {
    version: '1.0',
    id: safeText(legacy?.id || `lc_${hash(legacy).slice(0, 24)}`, 80),
    scope: String(legacy?.scope).toLowerCase() === 'personalized' ? 'STUDENT' : legacy?.courseId ? 'COURSE' : 'GLOBAL',
    cardType: LEGACY_TYPES[String(legacy?.cardType || '').toLowerCase()] || 'REVIEW',
    title: safeText(legacy?.title || '知识卡片', 200),
    summary: safeText(legacy?.summary || '课程知识总结', 1000),
    courseId: Number(legacy?.courseId) || null,
    courseName: safeText(context.courseName || legacy?.courseName, 200) || null,
    knowledgePointId: Number(legacy?.knowledgePointId) || null,
    knowledgePointName: safeText(legacy?.knowledgePointName, 200) || null,
    chapterName: safeText(legacy?.chapterName, 200) || null,
    difficulty: String(legacy?.difficulty || 'basic').toUpperCase(),
    estimatedReadingSeconds: Math.max(10, Math.min(900, Number(legacy?.estimatedReadingSeconds) || 45)),
    recommendationReason: safeText(legacy?.personalizedReason || legacy?.recommendationReason || (String(legacy?.scope).toLowerCase() === 'personalized' ? '依据本人当前学习记录生成。' : '来自当前课程与知识点。'), 1000),
    priorityScore: Number(legacy?.priorityScore) || 0,
    markdownContent: safeText(legacy?.markdownContent || sections.filter(item => item.content).map(item => `## ${item.title || '要点'}\n\n${item.content}`).join('\n\n'), 30000),
    sections,
    sourceRefs: sources,
    actions: [],
    state: stateFromRecord(context.state || legacy?.userState || legacy?.state),
    generator: {
      model: safeText(context.model || legacy?.generator?.model || 'legacy-knowledge-card', 100),
      promptVersion: safeText(context.promptVersion || legacy?.generator?.promptVersion || 'legacy-card-v1', 100),
      knowledgeBaseVersion: safeText(context.knowledgeBaseVersion || legacy?.generator?.knowledgeBaseVersion, 128) || null,
      generationMode: 'MIGRATED',
    },
    createdAt,
    expiresAt: context.expiresAt || legacy?.expiresAt || null,
  };
  if (!['BASIC', 'MEDIUM', 'ADVANCED'].includes(card.difficulty)) card.difficulty = 'MEDIUM';
  card.actions = defaultActions(card);
  return learningCardSchema.parse(card);
}

function recordToLearningCard(record, state = null) {
  const content = record?.contentJson || {};
  const parsed = legacyToLearningCard(content, {
    state,
    courseName: record?.course?.course_name,
    generatedAt: record?.createdAt?.toISOString?.() || record?.createdAt,
    expiresAt: record?.expiresAt?.toISOString?.() || record?.expiresAt || null,
  });
  return learningCardSchema.parse({
    ...parsed,
    id: record?.id || parsed.id,
    scope: record?.scope || parsed.scope,
    cardType: record?.cardType || parsed.cardType,
    title: record?.title || parsed.title,
    summary: record?.summary || parsed.summary,
    courseId: record?.courseId ?? parsed.courseId,
    knowledgePointId: record?.knowledgePointId ?? parsed.knowledgePointId,
    state: stateFromRecord(state),
  });
}

function persistenceData(card, extra = {}) {
  const validated = learningCardSchema.parse(card);
  return {
    id: validated.id,
    ownerUserId: validated.scope === 'STUDENT' ? Number(extra.ownerUserId) || null : null,
    scope: validated.scope,
    cardType: validated.cardType,
    courseId: validated.courseId,
    knowledgePointId: validated.knowledgePointId,
    title: validated.title,
    summary: validated.summary,
    contentJson: validated,
    sourceRefsJson: validated.sourceRefs,
    generatorJson: validated.generator,
    cacheKey: extra.cacheKey || learningCardCacheKey(validated, extra),
    status: extra.status || 'READY',
    version: validated.version,
    teacherRecommended: Boolean(extra.teacherRecommended),
    expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : null,
  };
}

module.exports = {
  LEGACY_TYPES, LEGACY_SECTIONS, hash, learningCardCacheKey, safeText, emptyState, stateFromRecord,
  defaultActions, normalizeSource, legacyToLearningCard, recordToLearningCard, persistenceData,
};
