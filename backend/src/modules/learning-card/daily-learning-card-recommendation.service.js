const prisma = require('../../config/prisma');
const asyncTasks = require('../async-task/async-task.service');
const { chartSpecSchema } = require('../ai-assistant/chart-spec');
const { learningCardSchema } = require('./learning-card.schemas');
const { hash, safeText, emptyState, defaultActions, persistenceData, recordToLearningCard } = require('./learning-card.protocol');
const platformCache = require('./learning-card-cache.service');

const DEFAULT_WEIGHTS = Object.freeze({
  weaknessScore: 0.28,
  forgettingRisk: 0.18,
  recentErrorScore: 0.20,
  taskUrgency: 0.14,
  planRelevance: 0.12,
  teacherPriority: 0.08,
});

const SLOT_KINDS = Object.freeze(['WEAKNESS', 'WRONG', 'CONCEPT', 'TASK', 'PROGRESS']);
const activeRefreshes = new Map();

function recommendationWeights() {
  let configured = {};
  try { configured = JSON.parse(process.env.LEARNING_CARD_RECOMMENDATION_WEIGHTS || '{}'); } catch { configured = {}; }
  const merged = Object.fromEntries(Object.entries(DEFAULT_WEIGHTS).map(([key, fallback]) => {
    const value = Number(configured[key]);
    return [key, Number.isFinite(value) && value >= 0 ? value : fallback];
  }));
  const total = Object.values(merged).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, value / total]));
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function scoreCandidate(candidate, weights = recommendationWeights()) {
  const positive = Object.entries(weights).reduce((sum, [key, weight]) => sum + clamp(candidate[key]) * weight, 0);
  return Math.round((positive - clamp(candidate.repetitionPenalty, 0, 80) - clamp(candidate.masteredPenalty, 0, 80) - clamp(candidate.ignoredPenalty, 0, 100)) * 100) / 100;
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.LEARNING_CARD_TIME_ZONE || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function dateOnly(dateKey) { return new Date(`${dateKey}T00:00:00.000Z`); }
function daysSince(value) { return value ? Math.max(0, (Date.now() - new Date(value).getTime()) / 86_400_000) : 30; }

function candidateKey(candidate) {
  return `${candidate.sourceKind}:${candidate.courseId || 0}:${candidate.knowledgePointId || 0}:${candidate.cardType}:${candidate.sourceId || 0}`;
}

function selectDiverseCards(input, limit = 5, { rotation = 0 } = {}) {
  const ranked = input.map(candidate => ({ ...candidate, score: scoreCandidate(candidate) }))
    .filter(candidate => Number(candidate.ignoredPenalty || 0) < 100)
    .sort((left, right) => right.score - left.score || candidateKey(left).localeCompare(candidateKey(right)));
  const selected = [];
  const selectedKeys = new Set();
  const typeCounts = new Map();
  const canUse = (candidate) => {
    if (selectedKeys.has(candidateKey(candidate))) return false;
    if ((typeCounts.get(candidate.cardType) || 0) >= 2) return false;
    const previous = selected.at(-1);
    return !(candidate.knowledgePointId && previous?.knowledgePointId === candidate.knowledgePointId);
  };
  for (const sourceKind of SLOT_KINDS) {
    const bucket = ranked.filter(candidate => candidate.sourceKind === sourceKind);
    const offset = bucket.length ? Math.abs(Number.isFinite(rotation) ? Math.trunc(rotation) : 0) % bucket.length : 0;
    const rotated = bucket.length ? [...bucket.slice(offset), ...bucket.slice(0, offset)] : [];
    const candidate = rotated.find(canUse) || null;
    if (candidate && canUse(candidate)) {
      selected.push(candidate); selectedKeys.add(candidateKey(candidate)); typeCounts.set(candidate.cardType, (typeCounts.get(candidate.cardType) || 0) + 1);
    }
  }
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (!canUse(candidate)) continue;
    selected.push(candidate); selectedKeys.add(candidateKey(candidate)); typeCounts.set(candidate.cardType, (typeCounts.get(candidate.cardType) || 0) + 1);
  }
  if (selected.length < limit) {
    for (const candidate of ranked) {
      if (selected.length >= limit) break;
      if (selectedKeys.has(candidateKey(candidate)) || (typeCounts.get(candidate.cardType) || 0) >= 2) continue;
      selected.push(candidate); selectedKeys.add(candidateKey(candidate)); typeCounts.set(candidate.cardType, (typeCounts.get(candidate.cardType) || 0) + 1);
    }
  }
  return selected.slice(0, limit);
}

function difficulty(value) {
  const normalized = String(value || 'BASIC').toUpperCase();
  return ['BASIC', 'MEDIUM', 'ADVANCED'].includes(normalized) ? normalized : 'MEDIUM';
}

function baseSource(candidate) {
  if (candidate.sourceKind === 'ONBOARDING') return { type: 'SYSTEM', id: null, title: 'DisciMind 学习引导', excerpt: safeText(candidate.description, 1000) || null, url: null };
  if (candidate.knowledgePointId) return { type: 'KNOWLEDGE_POINT', id: candidate.knowledgePointId, title: candidate.knowledgePointName || '课程知识点', excerpt: safeText(candidate.description, 1000) || null, url: null };
  return { type: 'COURSE', id: candidate.courseId || null, title: candidate.courseName || '课程知识总结', excerpt: safeText(candidate.description, 1000) || null, url: null };
}

function progressChart(candidate) {
  const points = (candidate.metadata?.masteries || []).filter(item => item.name && Number.isFinite(Number(item.score))).slice(0, 6);
  if (points.length < 3) return null;
  const xAxis = points.map(item => item.name);
  const values = points.map(item => Math.round(clamp(item.score) * 100) / 100);
  return chartSpecSchema.parse({
    version: '1.0',
    chart: { type: 'radar', title: '近期知识点掌握度', subtitle: '使用当前登录学生的真实掌握度记录', xAxis, series: [{ name: '掌握度', data: values }], unit: '%' },
    table: { columns: ['知识点', '掌握度'], rows: xAxis.map((name, index) => [name, values[index]]) },
    insights: candidate.metadata?.progressInsight ? [candidate.metadata.progressInsight] : [],
    source: { type: 'student_mastery_records', range: '当前记录' },
  });
}

function buildRuleCard(candidate, { userId, dateKey, slot = 0 } = {}) {
  const title = safeText(candidate.title || candidate.knowledgePointName || '今日学习卡片', 200);
  const summary = safeText(candidate.summary || candidate.reason || '根据当前学习记录生成。', 1000);
  const sections = [];
  if (candidate.cardType === 'WRONG_QUESTION') {
    sections.push(
      { id: 'error', type: 'CALLOUT', title: '错误类型', content: safeText(candidate.metadata?.wrongReason || '尚未分类', 20000), formula: null, chartSpec: null, tableSpec: null },
      { id: 'repair', type: 'MARKDOWN', title: '一句话纠错', content: safeText(candidate.metadata?.analysis || candidate.description || '重新核对题目条件、核心定义与关键步骤后再作答。', 20000), formula: null, chartSpec: null, tableSpec: null },
      { id: 'practice', type: 'CALLOUT', title: '推荐练习', content: '先重做原题，再完成一道同知识点相似题。', formula: null, chartSpec: null, tableSpec: null },
    );
  } else if (candidate.cardType === 'TASK') {
    sections.push({ id: 'task', type: 'MARKDOWN', title: '当前任务', content: `**${title}**\n\n${summary}${candidate.metadata?.deadline ? `\n\n截止时间：${new Date(candidate.metadata.deadline).toLocaleString('zh-CN')}` : ''}`, formula: null, chartSpec: null, tableSpec: null });
  } else if (candidate.cardType === 'PROGRESS') {
    sections.push({ id: 'progress', type: 'MARKDOWN', title: '学习进步', content: summary, formula: null, chartSpec: null, tableSpec: null });
    const chartSpec = progressChart(candidate);
    if (chartSpec) sections.push({ id: 'progress_chart', type: 'CHART', title: '掌握度雷达图', content: null, formula: null, chartSpec, tableSpec: null });
  } else {
    sections.push({ id: 'concept', type: 'MARKDOWN', title: candidate.sourceKind === 'WEAKNESS' ? '本次复习重点' : '核心内容', content: safeText(candidate.description || summary, 20000), formula: null, chartSpec: null, tableSpec: null });
    if (candidate.sourceKind === 'WEAKNESS') sections.push({ id: 'next', type: 'CALLOUT', title: '建议行动', content: '先复述定义，再完成一组针对性练习；遇到不确定步骤可直接询问 AI。', formula: null, chartSpec: null, tableSpec: null });
  }
  const sourceRefs = [baseSource(candidate), ...(candidate.sourceRefs || [])]
    .filter((source, index, list) => list.findIndex(item => `${item.type}:${item.id}` === `${source.type}:${source.id}`) === index)
    .slice(0, 12);
  const expiresAt = new Date(dateOnly(dateKey).getTime() + 2 * 86_400_000).toISOString();
  const card = {
    version: '1.0', id: `lc_${hash({ userId, dateKey, slot, key: candidateKey(candidate) }).slice(0, 24)}`,
    scope: 'STUDENT', cardType: candidate.cardType, title, summary,
    courseId: candidate.courseId || null, courseName: safeText(candidate.courseName, 200) || null,
    knowledgePointId: candidate.knowledgePointId || null, knowledgePointName: safeText(candidate.knowledgePointName, 200) || null,
    chapterName: safeText(candidate.chapterName, 200) || null, difficulty: difficulty(candidate.difficulty),
    estimatedReadingSeconds: Math.max(20, Math.min(300, Number(candidate.estimatedReadingSeconds) || 60)),
    recommendationReason: safeText(candidate.reason || '根据近期学习记录推荐。', 1000), priorityScore: candidate.score,
    markdownContent: sections.filter(section => section.content).map(section => `## ${section.title || '要点'}\n\n${section.content}`).join('\n\n'),
    sections, sourceRefs, actions: [], state: emptyState(),
    generator: { model: 'rule-engine', promptVersion: 'daily-learning-card-rule-v1', knowledgeBaseVersion: candidate.knowledgeBaseVersion || null, generationMode: 'RULE' },
    createdAt: new Date().toISOString(), expiresAt,
  };
  card.actions = defaultActions(card);
  return learningCardSchema.parse(card);
}

function feedbackPenalty(snapshot, candidate) {
  const key = `${candidate.courseId || 0}:${candidate.knowledgePointId || 0}:${candidate.cardType}`;
  const feedback = snapshot.feedback.get(key) || {};
  return {
    repetitionPenalty: Math.min(36, Number(feedback.impressions || 0) * 6),
    masteredPenalty: feedback.mastered ? 55 : 0,
    ignoredPenalty: feedback.ignored ? 100 : 0,
    favoriteBoost: feedback.favorite && !feedback.mastered ? 10 : 0,
  };
}

function candidateWithPenalty(snapshot, candidate) {
  const penalty = feedbackPenalty(snapshot, candidate);
  return { ...candidate, ...penalty, planRelevance: clamp((candidate.planRelevance || 0) + penalty.favoriteBoost) };
}

function buildCandidates(snapshot) {
  const candidates = [];
  const errorByPoint = new Map();
  snapshot.wrongQuestions.forEach(item => {
    const key = item.knowledge_point_id || item.question?.knowledge_point_id || 0;
    const bucket = errorByPoint.get(key) || [];
    bucket.push(item); errorByPoint.set(key, bucket);
  });
  snapshot.masteries.slice().sort((a, b) => a.mastery_score - b.mastery_score).slice(0, 8).forEach((item, index) => {
    const errors = errorByPoint.get(item.knowledge_point_id) || [];
    candidates.push(candidateWithPenalty(snapshot, {
      sourceKind: 'WEAKNESS', sourceId: item.mastery_record_id, cardType: errors.length ? 'PITFALL' : 'REVIEW',
      courseId: item.course_id, courseName: item.course?.course_name, knowledgePointId: item.knowledge_point_id,
      knowledgePointName: item.knowledge_point?.knowledge_point_name, chapterName: item.knowledge_point?.chapter?.chapter_name,
      description: item.knowledge_point?.description || `${item.knowledge_point?.knowledge_point_name || '当前知识点'}需要优先复习。`,
      title: `${item.knowledge_point?.knowledge_point_name || '薄弱知识点'}重点复习`,
      summary: `当前掌握度 ${Math.round(item.mastery_score)}%，建议先复习再练习。`,
      reason: `该知识点当前掌握度为 ${Math.round(item.mastery_score)}%，在近期知识点中优先级较高。`,
      difficulty: item.knowledge_point?.difficulty_level, weaknessScore: 100 - item.mastery_score,
      forgettingRisk: clamp(daysSince(item.updated_at) / 30 * 100), recentErrorScore: clamp(errors.length * 24),
      taskUrgency: 0, planRelevance: snapshot.plan?.knowledgePointId === item.knowledge_point_id ? 100 : 35,
      teacherPriority: 0, rankHint: index,
    }));
  });
  [...errorByPoint.values()].sort((a, b) => b.length - a.length).slice(0, 6).forEach(items => {
    const item = items[0]; const point = item.knowledge_point || item.question?.knowledge_point;
    candidates.push(candidateWithPenalty(snapshot, {
      sourceKind: 'WRONG', sourceId: item.wrong_question_id, cardType: 'WRONG_QUESTION', courseId: item.course_id || item.question?.course_id,
      courseName: item.course?.course_name || item.question?.course?.course_name, knowledgePointId: item.knowledge_point_id || item.question?.knowledge_point_id,
      knowledgePointName: point?.knowledge_point_name, chapterName: item.chapter?.chapter_name,
      description: item.question?.analysis || point?.description || '根据最近错题的真实错因生成修复建议。',
      title: `${point?.knowledge_point_name || '最近错题'}修复卡`, summary: `该知识点有 ${items.length} 道未解决错题，先定位错因再做相似题。`,
      reason: `与你最近的 ${items.length} 道未解决错题有关。`, difficulty: item.question?.difficulty_level,
      weaknessScore: 80, forgettingRisk: clamp(daysSince(item.last_wrong_at) / 14 * 70), recentErrorScore: clamp(55 + items.length * 12), taskUrgency: 0,
      planRelevance: snapshot.plan?.knowledgePointId === (item.knowledge_point_id || item.question?.knowledge_point_id) ? 100 : 55, teacherPriority: 0,
      metadata: { wrongQuestionId: item.wrong_question_id, wrongReason: item.wrong_reason || '尚未分类', analysis: item.question?.analysis || null },
      sourceRefs: [{ type: 'WRONG_QUESTION', id: item.wrong_question_id, title: '本人最近错题', excerpt: safeText(item.question?.content, 1000) || null, url: null }],
    }));
  });
  const conceptPoints = snapshot.knowledgePoints.filter(point => !snapshot.masteries.some(item => item.knowledge_point_id === point.knowledge_point_id)).slice(0, 8);
  [...snapshot.masteries.map(item => item.knowledge_point).filter(Boolean), ...conceptPoints].slice(0, 10).forEach((point, index) => {
    candidates.push(candidateWithPenalty(snapshot, {
      sourceKind: 'CONCEPT', sourceId: point.knowledge_point_id, cardType: /sigmoid|公式|函数/i.test(point.knowledge_point_name) ? 'FORMULA' : 'CONCEPT',
      courseId: point.course_id, courseName: point.course?.course_name || snapshot.courseMap.get(point.course_id), knowledgePointId: point.knowledge_point_id,
      knowledgePointName: point.knowledge_point_name, chapterName: point.chapter?.chapter_name, description: point.description || `${point.knowledge_point_name}是当前课程的核心知识点。`,
      title: `${point.knowledge_point_name}核心概念`, summary: safeText(point.description || `用一分钟回顾 ${point.knowledge_point_name} 的定义和适用场景。`, 1000),
      reason: index === 0 ? '与当前薄弱点或学习计划相关，适合今天快速复习。' : '来自已加入课程的核心知识点。', difficulty: point.difficulty_level,
      weaknessScore: 45, forgettingRisk: 45, recentErrorScore: errorByPoint.has(point.knowledge_point_id) ? 60 : 0,
      taskUrgency: 0, planRelevance: snapshot.plan?.knowledgePointId === point.knowledge_point_id ? 100 : 45, teacherPriority: 0,
    }));
  });
  snapshot.tasks.slice(0, 8).forEach(item => {
    const task = item.task; const deadlineMs = task?.deadline ? new Date(task.deadline).getTime() - Date.now() : null;
    const urgency = deadlineMs == null ? 35 : deadlineMs <= 0 ? 100 : clamp(100 - deadlineMs / (7 * 86_400_000) * 80);
    candidates.push(candidateWithPenalty(snapshot, {
      sourceKind: 'TASK', sourceId: task.task_id, cardType: 'TASK', courseId: task.course_id, courseName: task.course?.course_name,
      knowledgePointId: task.knowledge_point_links?.[0]?.knowledge_point_id || null,
      knowledgePointName: task.knowledge_point_links?.[0]?.knowledge_point?.knowledge_point_name || null,
      title: task.title, summary: task.description || '按时完成教师发布的学习任务。', reason: deadlineMs != null && deadlineMs <= 3 * 86_400_000 ? '该学习任务即将截止。' : '来自当前课程的待完成任务。',
      difficulty: 'MEDIUM', weaknessScore: 0, forgettingRisk: 0, recentErrorScore: 0, taskUrgency: urgency, planRelevance: 60, teacherPriority: 90,
      metadata: { deadline: task.deadline }, sourceRefs: [{ type: 'TASK', id: task.task_id, title: task.title, excerpt: safeText(task.description, 1000) || null, url: null }],
    }));
  });
  const masteryValues = snapshot.masteries.map(item => Number(item.mastery_score)).filter(Number.isFinite);
  const average = masteryValues.length ? masteryValues.reduce((sum, value) => sum + value, 0) / masteryValues.length : 0;
  const weeklyMinutes = Math.round(snapshot.studyRecords.filter(item => new Date(item.created_at) >= new Date(Date.now() - 7 * 86_400_000)).reduce((sum, item) => sum + (Number(item.duration_seconds) || 0), 0) / 60);
  const progressCourse = snapshot.enrollments[0]?.course;
  candidates.push(candidateWithPenalty(snapshot, {
    sourceKind: 'PROGRESS', sourceId: localDateKey(), cardType: 'PROGRESS', courseId: progressCourse?.course_id || null, courseName: progressCourse?.course_name || null,
    knowledgePointId: null, knowledgePointName: null, title: weeklyMinutes ? `本周已学习 ${weeklyMinutes} 分钟` : '建立今天的学习节奏',
    summary: masteryValues.length ? `当前记录的知识点平均掌握度为 ${Math.round(average)}%，继续巩固薄弱项。` : '完成一次练习后，这里会展示真实学习进步。',
    reason: '依据最近 7 天学习时长和当前掌握度记录生成。', difficulty: 'BASIC', weaknessScore: 20, forgettingRisk: 0, recentErrorScore: 0, taskUrgency: 0, planRelevance: 45, teacherPriority: 0,
    metadata: { masteries: snapshot.masteries.slice(0, 6).map(item => ({ name: item.knowledge_point?.knowledge_point_name, score: item.mastery_score })), progressInsight: `本周学习 ${weeklyMinutes} 分钟，平均掌握度 ${Math.round(average)}%。` },
    sourceRefs: [{ type: 'STUDENT_MASTERY', id: null, title: '本人掌握度与学习记录', excerpt: `最近 7 天学习 ${weeklyMinutes} 分钟`, url: null }],
  }));
  if (!snapshot.masteries.length && !snapshot.wrongQuestions.length && !snapshot.studyRecords.length && !snapshot.tasks.length) {
    const course = snapshot.enrollments[0]?.course || null;
    const point = snapshot.knowledgePoints[0] || null;
    const common = {
      sourceId: course?.course_id || 'new-user', courseId: course?.course_id || null, courseName: course?.course_name || null,
      knowledgePointId: point?.knowledge_point_id || null, knowledgePointName: point?.knowledge_point_name || null,
      difficulty: 'BASIC', weaknessScore: 35, forgettingRisk: 0, recentErrorScore: 0, taskUrgency: 0,
      planRelevance: 45, teacherPriority: 0, repetitionPenalty: 0, masteredPenalty: 0, ignoredPenalty: 0,
    };
    const cold = [
      ['WEAKNESS', 'REVIEW', '先建立今天的学习目标', '用一句话写下今天要理解的概念与完成标准。', '新用户冷启动：先建立清晰、可完成的学习目标。'],
      ['WRONG', 'PITFALL', '第一次练习前的易错提醒', '先读清条件、写出依据，再计算或选择答案，能显著减少非知识性失误。', '尚无错题记录，先学习通用纠错方法。'],
      ['CONCEPT', 'CONCEPT', point ? `${point.knowledge_point_name}入门卡` : '从核心概念开始', point?.description || '先理解定义、适用条件和一个具体例子，再进入练习。', course ? `来自已加入课程“${course.course_name}”的首个知识点。` : '尚未加入课程，先了解平台学习方法。'],
      ['TASK', 'TASK', '完成首次学习计划', '选择一门课程和一个知识点，创建首个可执行学习计划。', '当前没有待完成任务，建议先创建学习计划。'],
      ['PROGRESS', 'PROGRESS', '完成一次练习，开启成长记录', '完成学习后会在这里展示真实时长、正确率和掌握度变化。', '尚无学习记录，不使用演示数据或虚构趋势。'],
    ];
    for (const [sourceKind, cardType, title, summary, reason] of cold) {
      if (candidates.some(item => item.sourceKind === sourceKind)) continue;
      candidates.push({ ...common, sourceKind, sourceId: `${common.sourceId}:${sourceKind}`, cardType, title, summary, description: summary, reason,
        sourceRefs: [{ type: 'SYSTEM', id: null, title: course?.course_name || 'DisciMind 学习引导', excerpt: summary, url: null }] });
    }
  }
  return candidates;
}

async function collectSnapshot(userId) {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since7 = new Date(Date.now() - 7 * 86_400_000);
  const [enrollments, masteries, wrongQuestions, studyRecords, plans, tasks, states, events] = await Promise.all([
    prisma.studentCourseEnrollment.findMany({ where: { student_user_id: userId, enrollment_status: 'active' }, include: { course: true }, orderBy: { joined_at: 'desc' }, take: 30 }),
    prisma.studentMasteryRecord.findMany({ where: { student_user_id: userId }, include: { course: true, knowledge_point: { include: { course: true, chapter: true } } }, orderBy: { mastery_score: 'asc' }, take: 100 }),
    prisma.wrongQuestion.findMany({ where: { student_user_id: userId, status: 'UNRESOLVED' }, include: { course: true, chapter: true, knowledge_point: true, question: { include: { course: true, knowledge_point: true } } }, orderBy: { last_wrong_at: 'desc' }, take: 100 }),
    prisma.studyRecord.findMany({ where: { student_user_id: userId, created_at: { gte: since30 } }, orderBy: { created_at: 'desc' }, take: 300 }),
    prisma.studentLearningPlan.findMany({ where: { studentUserId: userId }, include: { course: true, knowledgePoint: true }, orderBy: { updatedAt: 'desc' }, take: 5 }),
    prisma.learningTaskRecipient.findMany({ where: { student_user_id: userId }, include: { task: { include: { course: true, knowledge_point_links: { include: { knowledge_point: true } }, submissions: { where: { student_user_id: userId }, select: { submission_status: true } } } } }, orderBy: { updated_at: 'desc' }, take: 50 }),
    prisma.userLearningCardState.findMany({ where: { userId }, include: { card: { select: { courseId: true, knowledgePointId: true, cardType: true } } }, take: 500 }),
    prisma.learningCardEvent.findMany({ where: { userId, eventType: 'IMPRESSION', createdAt: { gte: since7 } }, include: { card: { select: { courseId: true, knowledgePointId: true, cardType: true } } }, take: 500 }),
  ]);
  const courseIds = enrollments.map(item => item.course_id);
  const knowledgePoints = courseIds.length ? await prisma.knowledgePoint.findMany({ where: { course_id: { in: courseIds } }, include: { course: true, chapter: true }, orderBy: [{ course_id: 'asc' }, { sort_order: 'asc' }], take: 160 }) : [];
  const feedback = new Map();
  states.forEach(item => {
    const key = `${item.card.courseId || 0}:${item.card.knowledgePointId || 0}:${item.card.cardType}`;
    feedback.set(key, { ...(feedback.get(key) || {}), favorite: item.isFavorite, mastered: item.isMastered, ignored: item.isIgnored });
  });
  events.forEach(item => {
    const key = `${item.card.courseId || 0}:${item.card.knowledgePointId || 0}:${item.card.cardType}`;
    const value = feedback.get(key) || {}; value.impressions = (value.impressions || 0) + 1; feedback.set(key, value);
  });
  const activePlan = plans.find(item => ['READY', 'RUNNING', 'PAUSED', 'DRAFT'].includes(String(item.status))) || plans[0] || null;
  return {
    userId, enrollments, masteries, wrongQuestions, studyRecords, tasks: tasks.filter(item => !item.task.submissions?.length),
    plan: activePlan ? { id: activePlan.id, courseId: activePlan.courseId, knowledgePointId: activePlan.knowledgePointId, status: activePlan.status } : null,
    knowledgePoints, feedback, courseMap: new Map(enrollments.map(item => [item.course_id, item.course.course_name])),
  };
}

function snapshotVersion(snapshot) {
  return hash({
    enrollments: snapshot.enrollments.map(item => [item.enrollment_id, item.course_id]),
    masteries: snapshot.masteries.map(item => [item.mastery_record_id, item.mastery_score, item.updated_at]),
    wrong: snapshot.wrongQuestions.map(item => [item.wrong_question_id, item.status, item.review_count, item.updated_at]),
    study: snapshot.studyRecords.slice(0, 80).map(item => [item.study_record_id, item.duration_seconds, item.progress_percent, item.created_at]),
    tasks: snapshot.tasks.map(item => [item.recipient_id, item.task_id, item.updated_at]), plan: snapshot.plan,
  });
}

async function enqueueDailyGeneration(userId, setId, version, generationToken, options = {}) {
  const token = String(generationToken || version);
  const cycle = token.slice(0, 32);
  const targetCardIds = Array.isArray(options.targetCardIds) ? options.targetCardIds.map(String).slice(0, 5) : [];
  return asyncTasks.createTask(userId, {
    operationId: `daily-learning-cards-${setId}-${cycle}`,
    taskType: 'LEARNING_FLOW_PRELOAD', title: '更新今日学习卡片', description: '使用课程知识和最小必要学习画像增强今日卡片',
    status: 'QUEUED', stage: '等待生成个性化卡片', progressMode: 'STAGE_ONLY', relatedResourceType: 'DAILY_LEARNING_CARD_SET', relatedResourceId: setId,
    resultType: 'LEARNING_CARDS', resultId: setId, resultUrl: '#/student/dashboard?focus=learning-cards', cancellable: false,
    dedupeKey: `daily-learning-cards:${setId}:${cycle}`, maxAttempts: 2, userVisible: false,
    metadataJson: { kind: 'DAILY_LEARNING_CARD', setId, dataSnapshotVersion: version, generationToken: token, targetCardIds },
    requestPayloadJson: { setId, dataSnapshotVersion: version, generationToken: token, targetCardIds },
  });
}

async function serializeSet(record, userId) {
  const items = [...(record.items || [])].sort((a, b) => a.slot - b.slot);
  const states = items.length ? await prisma.userLearningCardState.findMany({ where: { userId, cardId: { in: items.map(item => item.cardId) } } }) : [];
  const stateMap = new Map(states.map(item => [item.cardId, item]));
  const cards = items.map(item => ({ ...recordToLearningCard(item.card, stateMap.get(item.cardId)), priorityScore: item.score, recommendationReason: item.reason || item.card.contentJson?.recommendationReason || '根据近期学习记录推荐。' }));
  return {
    version: record.version, date: localDateKey(record.recommendationDate), userId: record.userId,
    cards, generatedAt: record.generatedAt.toISOString(), refreshedAt: record.refreshedAt.toISOString(),
    reasonSummary: record.reasonSummary || '根据近期学习记录，为你整理今日最值得关注的内容',
    dataSnapshotVersion: record.dataSnapshotVersion, status: record.generationStatus,
  };
}

async function cacheSerializedSet(value) {
  await platformCache.writeDaily(value).catch(() => null);
  return value;
}

async function loadSet(userId, date) {
  return prisma.dailyLearningCardSet.findUnique({
    where: { userId_recommendationDate: { userId, recommendationDate: date } },
    include: { items: { include: { card: { include: { course: true } } }, orderBy: { slot: 'asc' } } },
  });
}

const EVENT_SOURCE_KINDS = Object.freeze({
  PRACTICE_COMPLETED: ['WEAKNESS', 'WRONG'],
  WRONG_QUESTION_ADDED: ['WRONG'],
  MASTERY_CHANGED: ['WEAKNESS', 'PROGRESS'],
  NODE_COMPLETED: ['WEAKNESS', 'CONCEPT', 'PROGRESS'],
  PLAN_STARTED: ['TASK', 'CONCEPT'],
  TEACHER_RESOURCE: ['CONCEPT'],
  TEACHER_TASK: ['TASK'],
  CARD_FEEDBACK: [],
});

function existingItemKey(item) {
  const context = item.contextJson || {};
  return candidateKey({
    sourceKind: item.sourceKind,
    courseId: context.courseId || item.card?.courseId,
    knowledgePointId: context.knowledgePointId || item.card?.knowledgePointId,
    cardType: item.card?.cardType,
    sourceId: context.sourceId,
  });
}

function affectedSlot(existing, input = {}) {
  if (!existing?.items?.length) return null;
  if (input.cardId) {
    const exact = existing.items.find(item => item.cardId === input.cardId);
    if (exact) return exact;
  }
  if (input.knowledgePointId) {
    const exact = existing.items.find(item => Number(item.card?.knowledgePointId || item.contextJson?.knowledgePointId) === Number(input.knowledgePointId));
    if (exact) return exact;
  }
  const sourceKinds = EVENT_SOURCE_KINDS[input.eventType] || [];
  return existing.items.find(item => sourceKinds.includes(item.sourceKind)) || existing.items[0];
}

function chooseAffectedReplacement(candidates, existing, target, input = {}) {
  if (!target) return null;
  const otherItems = existing.items.filter(item => item.id !== target.id);
  const usedKeys = new Set(otherItems.map(existingItemKey));
  const typeCounts = otherItems.reduce((counts, item) => counts.set(item.card.cardType, (counts.get(item.card.cardType) || 0) + 1), new Map());
  const ordered = candidates.map(candidate => ({ ...candidate, score: scoreCandidate(candidate) }))
    .filter(candidate => Number(candidate.ignoredPenalty || 0) < 100)
    .sort((left, right) => {
      const leftPoint = input.knowledgePointId && Number(left.knowledgePointId) === Number(input.knowledgePointId) ? 1 : 0;
      const rightPoint = input.knowledgePointId && Number(right.knowledgePointId) === Number(input.knowledgePointId) ? 1 : 0;
      const leftKind = left.sourceKind === target.sourceKind ? 1 : 0;
      const rightKind = right.sourceKind === target.sourceKind ? 1 : 0;
      return rightPoint - leftPoint || rightKind - leftKind || right.score - left.score || candidateKey(left).localeCompare(candidateKey(right));
    });
  const previous = existing.items.find(item => item.slot === target.slot - 1);
  const next = existing.items.find(item => item.slot === target.slot + 1);
  return ordered.find(candidate => {
    if (usedKeys.has(candidateKey(candidate))) return false;
    if ((typeCounts.get(candidate.cardType) || 0) >= 2) return false;
    if (candidate.knowledgePointId && [previous, next].some(item => Number(item?.card?.knowledgePointId) === Number(candidate.knowledgePointId))) return false;
    return true;
  }) || null;
}

async function persistRuleSet(userId, dateKey, snapshot, selected, existing = null) {
  const version = snapshotVersion(snapshot);
  const cards = selected.map((candidate, slot) => buildRuleCard(candidate, { userId, dateKey, slot }));
  const refreshedAt = new Date();
  const generationToken = hash({ version, cards: cards.map(card => card.id), refreshedAt: refreshedAt.toISOString() });
  await prisma.$transaction(async tx => {
    for (const card of cards) {
      const data = persistenceData(card, {
        ownerUserId: userId, status: 'READY', recommendationDate: dateKey,
        contextVersion: version, personalizationVersion: version,
      });
      await tx.learningCard.upsert({ where: { id: card.id }, create: data, update: { ...data, id: undefined } });
    }
    if (existing) await tx.dailyLearningCardSetItem.deleteMany({ where: { setId: existing.id } });
    const setData = {
      reasonSummary: '根据近期学习记录，为你整理今日最值得关注的内容', dataSnapshotVersion: version,
      generationStatus: 'GENERATING', refreshedAt, generatedAt: existing?.generatedAt || refreshedAt,
      items: { create: cards.map((card, slot) => ({ cardId: card.id, slot, score: selected[slot].score, reason: selected[slot].reason, sourceKind: selected[slot].sourceKind, contextJson: { ...selected[slot].metadata, generationToken, courseId: selected[slot].courseId || null, knowledgePointId: selected[slot].knowledgePointId || null, sourceId: selected[slot].sourceId || null } })) },
    };
    if (existing) await tx.dailyLearningCardSet.update({ where: { id: existing.id }, data: setData });
    else await tx.dailyLearningCardSet.create({ data: { userId, recommendationDate: dateOnly(dateKey), version: '1.0', ...setData } });
  });
  const record = await loadSet(userId, dateOnly(dateKey));
  await enqueueDailyGeneration(userId, record.id, version, generationToken).catch(() => null);
  return cacheSerializedSet(await serializeSet(record, userId));
}

async function persistAffectedSlot(userId, dateKey, snapshot, existing, target, candidate) {
  const version = snapshotVersion(snapshot);
  const card = buildRuleCard(candidate, { userId, dateKey, slot: target.slot });
  const refreshedAt = new Date();
  const generationToken = hash({ version, targetCardId: card.id, slot: target.slot, refreshedAt: refreshedAt.toISOString() });
  await prisma.$transaction(async tx => {
    const data = persistenceData(card, {
      ownerUserId: userId, status: 'READY', recommendationDate: dateKey,
      contextVersion: version, personalizationVersion: version,
    });
    await tx.learningCard.upsert({ where: { id: card.id }, create: data, update: { ...data, id: undefined } });
    for (const item of existing.items) {
      await tx.dailyLearningCardSetItem.update({
        where: { id: item.id },
        data: item.id === target.id ? {
          cardId: card.id, score: candidate.score, reason: candidate.reason, sourceKind: candidate.sourceKind,
          contextJson: { ...(candidate.metadata || {}), generationToken, courseId: candidate.courseId || null, knowledgePointId: candidate.knowledgePointId || null, sourceId: candidate.sourceId || null },
        } : { contextJson: { ...(item.contextJson || {}), generationToken } },
      });
    }
    await tx.dailyLearningCardSet.update({ where: { id: existing.id }, data: {
      reasonSummary: '学习状态已更新，仅刷新了受影响的卡片槽位。', dataSnapshotVersion: version,
      generationStatus: 'GENERATING', refreshedAt,
    } });
  });
  const record = await loadSet(userId, dateOnly(dateKey));
  await enqueueDailyGeneration(userId, record.id, version, generationToken, { targetCardIds: [card.id] }).catch(() => null);
  return cacheSerializedSet(await serializeSet(record, userId));
}

async function refreshAffectedDailyCards(user, input = {}) {
  const userId = Number(user.user_id);
  const dateKey = localDateKey();
  const existing = await loadSet(userId, dateOnly(dateKey));
  if (!existing?.items?.length) return rebuildDailyCards(user, { force: true });
  const snapshot = await collectSnapshot(userId);
  const target = affectedSlot(existing, input);
  const candidate = chooseAffectedReplacement(buildCandidates(snapshot), existing, target, input);
  if (!target || !candidate) return rebuildDailyCards(user, { force: true });
  return persistAffectedSlot(userId, dateKey, snapshot, existing, target, candidate);
}

async function rebuildDailyCards(user, options = {}) {
  const userId = Number(user.user_id);
  const dateKey = localDateKey();
  const date = dateOnly(dateKey);
  const existing = await loadSet(userId, date);
  const snapshot = await collectSnapshot(userId);
  const version = snapshotVersion(snapshot);
  if (existing && existing.dataSnapshotVersion === version && !options.force && existing.generationStatus !== 'STALE') {
    return cacheSerializedSet(await serializeSet(existing, userId));
  }
  const candidates = buildCandidates(snapshot);
  const rotation = options.force ? Number.parseInt(hash(`${Date.now()}:${userId}`).slice(0, 4), 16) : 0;
  const selected = selectDiverseCards(candidates, 5, { rotation });
  if (!selected.length) throw Object.assign(new Error('当前没有可生成学习卡片的课程或任务，请先加入课程。'), { code: 40401, status: 404 });
  return persistRuleSet(userId, dateKey, snapshot, selected, existing);
}

function scheduleRefresh(user, options = {}) {
  const userId = Number(user.user_id);
  const key = `${userId}:${localDateKey()}`;
  if (activeRefreshes.has(key)) return activeRefreshes.get(key);
  const pending = options.eventType && options.eventType !== 'MANUAL'
    ? refreshAffectedDailyCards(user, options)
    : rebuildDailyCards(user, { ...options, force: true });
  const guarded = pending
    .catch(error => { console.warn('[learning-card] stale-while-revalidate failed', { userId, code: error.code || 'DAILY_CARD_REFRESH_FAILED' }); })
    .finally(() => activeRefreshes.delete(key));
  activeRefreshes.set(key, guarded);
  return guarded;
}

async function getDailyCards(user, options = {}) {
  const userId = Number(user.user_id);
  const dateKey = localDateKey();
  if (!options.force) {
    const cached = await platformCache.readDaily(userId, dateKey);
    if (cached) {
      if (cached.status === 'STALE' || cached.status === 'FAILED') setImmediate(() => scheduleRefresh(user, cached.pendingRefresh || { eventType: options.eventType }));
      return cached;
    }
  }
  return rebuildDailyCards(user, options);
}

async function refreshDailyCards(user, input = {}) {
  if (input.eventType && input.eventType !== 'MANUAL') return refreshAffectedDailyCards(user, input);
  return getDailyCards(user, { force: true, ...input });
}

async function markTodayStale(userId, reason = 'LEARNING_EVENT', context = {}) {
  const dateKey = localDateKey();
  const date = dateOnly(dateKey);
  const normalized = String(reason).startsWith('CARD_') ? 'CARD_FEEDBACK' : String(reason);
  const pendingRefresh = { eventType: EVENT_SOURCE_KINDS[normalized] ? normalized : 'MASTERY_CHANGED', ...context };
  await prisma.dailyLearningCardSet.updateMany({ where: { userId: Number(userId), recommendationDate: date }, data: { generationStatus: 'STALE', reasonSummary: `学习状态已更新（${reason}），相关卡片将在下次读取时刷新。`, refreshedAt: new Date() } });
  await platformCache.markDailyStale(Number(userId), dateKey, `学习状态已更新（${reason}），相关卡片正在后台刷新。`, pendingRefresh).catch(() => null);
}

module.exports = {
  DEFAULT_WEIGHTS, SLOT_KINDS, recommendationWeights, clamp, scoreCandidate, localDateKey,
  selectDiverseCards, buildRuleCard, buildCandidates, collectSnapshot, snapshotVersion,
  serializeSet, rebuildDailyCards, getDailyCards, refreshDailyCards, refreshAffectedDailyCards,
  affectedSlot, chooseAffectedReplacement, markTodayStale, enqueueDailyGeneration,
};
