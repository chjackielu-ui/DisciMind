const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'discimind-learning-card-'));
process.env.LEARNING_CARD_PLATFORM_CACHE_DIR = cacheRoot;

const { learningCardSchema } = require('../src/modules/learning-card/learning-card.schemas');
const { legacyToLearningCard, learningCardCacheKey } = require('../src/modules/learning-card/learning-card.protocol');
const {
  scoreCandidate,
  selectDiverseCards,
  buildCandidates,
  buildRuleCard,
  affectedSlot,
  chooseAffectedReplacement,
} = require('../src/modules/learning-card/daily-learning-card-recommendation.service');
const platformCache = require('../src/modules/learning-card/learning-card-cache.service');
const { isRecoverableAiEnhancementError, repairLatexControlEscapes } = require('../src/modules/learning-card/learning-card-ai.service');

function candidate(overrides = {}) {
  return {
    sourceKind: 'CONCEPT', sourceId: overrides.sourceId || Math.random().toString(16).slice(2), cardType: 'CONCEPT',
    courseId: 1, courseName: '机器学习', knowledgePointId: 1, knowledgePointName: '逻辑回归',
    title: '逻辑回归核心概念', summary: '理解二分类概率模型。', description: '逻辑回归使用 Sigmoid 输出概率。',
    reason: '与你当前的学习计划相关。', difficulty: 'MEDIUM', weaknessScore: 50, forgettingRisk: 30,
    recentErrorScore: 20, taskUrgency: 10, planRelevance: 60, teacherPriority: 0,
    repetitionPenalty: 0, masteredPenalty: 0, ignoredPenalty: 0, score: 50,
    ...overrides,
  };
}

function snapshot() {
  return {
    enrollments: [], masteries: [], wrongQuestions: [], studyRecords: [], tasks: [], plan: null,
    knowledgePoints: [], feedback: new Map(), courseMap: new Map(),
  };
}

test.after(async () => {
  platformCache.clearMemory();
  await fsp.rm(cacheRoot, { recursive: true, force: true });
});

test('LearningCard 1.0 migrates legacy cards and rejects active HTML content', () => {
  const migrated = legacyToLearningCard({
    id: 'legacy_card_1001', scope: 'personalized', cardType: 'formula', title: 'Sigmoid 公式',
    summary: '二分类概率映射', courseId: 1, knowledgePointId: 2,
    markdownContent: '公式为 $p=1/(1+e^{-z})$', sourceRefs: [{ type: 'SYSTEM', id: null, title: '旧版卡片' }],
  });
  assert.equal(migrated.version, '1.0');
  assert.equal(migrated.scope, 'STUDENT');
  assert.equal(migrated.cardType, 'FORMULA');
  assert.equal(learningCardSchema.parse(migrated).id, 'legacy_card_1001');

  assert.throws(() => learningCardSchema.parse({
    ...migrated,
    markdownContent: '<script>alert(1)</script>',
  }), /不允许的 HTML/);
});

test('ChartSpec 1.0 is strict and card sections reject malformed charts', () => {
  const card = buildRuleCard(candidate({ sourceId: 'chart-source' }), { userId: 7, dateKey: '2026-07-16', slot: 0 });
  const badChart = {
    version: '1.0',
    chart: { type: 'line', title: '趋势', subtitle: null, xAxis: ['一', '二'], series: [{ name: '掌握度', data: [60] }], unit: '%' },
    table: { columns: ['名称', '值'], rows: [['一', 60]] }, insights: [], source: { type: 'test', range: null },
  };
  assert.throws(() => learningCardSchema.parse({
    ...card,
    sections: [...card.sections, { id: 'bad_chart', type: 'CHART', title: '趋势', content: null, formula: null, chartSpec: badChart, tableSpec: null }],
  }), /series 数据长度/);
});

test('recommendation score applies positive weights and repetition/mastery/ignore penalties', () => {
  const base = candidate({ weaknessScore: 90, recentErrorScore: 80 });
  const positive = scoreCandidate(base);
  assert.ok(positive > scoreCandidate({ ...base, weaknessScore: 0, recentErrorScore: 0 }));
  assert.ok(scoreCandidate({ ...base, repetitionPenalty: 30 }) < positive);
  assert.ok(scoreCandidate({ ...base, masteredPenalty: 55 }) < positive);
  assert.ok(scoreCandidate({ ...base, ignoredPenalty: 100 }) < 0);
});

test('daily selector keeps five slots diverse, limits duplicate types, and avoids adjacent knowledge points', () => {
  const sources = ['WEAKNESS', 'WRONG', 'CONCEPT', 'TASK', 'PROGRESS', 'CONCEPT', 'TASK'];
  const types = ['REVIEW', 'WRONG_QUESTION', 'CONCEPT', 'TASK', 'PROGRESS', 'CONCEPT', 'TASK'];
  const cards = sources.map((sourceKind, index) => candidate({
    sourceKind, sourceId: `source-${index}`, cardType: types[index], knowledgePointId: index === 1 ? 2 : index + 1,
    weaknessScore: 100 - index, recentErrorScore: 80 - index,
  }));
  const selected = selectDiverseCards(cards, 5);
  assert.equal(selected.length, 5);
  const counts = selected.reduce((map, item) => map.set(item.cardType, (map.get(item.cardType) || 0) + 1), new Map());
  assert.ok([...counts.values()].every(value => value <= 2));
  assert.ok(selected.every((item, index) => index === 0 || item.knowledgePointId !== selected[index - 1].knowledgePointId));
  const rotated = selectDiverseCards(cards, 5, { rotation: 3 });
  assert.deepEqual(new Set(rotated.map(item => item.sourceKind)), new Set(['WEAKNESS', 'WRONG', 'CONCEPT', 'TASK', 'PROGRESS']));
});

test('cold start produces a complete truthful five-card set without demo trend data', () => {
  const candidates = buildCandidates(snapshot());
  const selected = selectDiverseCards(candidates, 5);
  assert.equal(selected.length, 5);
  assert.deepEqual(new Set(selected.map(item => item.sourceKind)), new Set(['WEAKNESS', 'WRONG', 'CONCEPT', 'TASK', 'PROGRESS']));
  assert.match(selected.find(item => item.sourceKind === 'PROGRESS').summary, /完成一次练习/);
});

test('learning events replace only the affected slot while preserving diversity constraints', () => {
  const items = ['WEAKNESS', 'WRONG', 'CONCEPT', 'TASK', 'PROGRESS'].map((sourceKind, slot) => ({
    id: slot + 1, slot, sourceKind, cardId: `existing_${slot}`,
    contextJson: { sourceId: `old-${slot}`, courseId: 1, knowledgePointId: slot + 1 },
    card: { cardType: ['REVIEW', 'WRONG_QUESTION', 'CONCEPT', 'TASK', 'PROGRESS'][slot], courseId: 1, knowledgePointId: slot + 1 },
  }));
  const existing = { items };
  const target = affectedSlot(existing, { eventType: 'MASTERY_CHANGED', knowledgePointId: 1 });
  assert.equal(target.slot, 0);
  const replacement = chooseAffectedReplacement([
    candidate({ sourceKind: 'WEAKNESS', sourceId: 'new-weakness', cardType: 'PITFALL', knowledgePointId: 1, weaknessScore: 99 }),
    candidate({ sourceKind: 'CONCEPT', sourceId: 'duplicate-neighbor', cardType: 'CONCEPT', knowledgePointId: 2, weaknessScore: 100 }),
  ], existing, target, { eventType: 'MASTERY_CHANGED', knowledgePointId: 1 });
  assert.equal(replacement.sourceId, 'new-weakness');
  assert.deepEqual(existing.items.filter(item => item.id !== target.id).map(item => item.cardId), ['existing_1', 'existing_2', 'existing_3', 'existing_4']);
});

test('cache key contains user/context/model/prompt/knowledge-base/personalization dimensions', () => {
  const card = buildRuleCard(candidate({ sourceId: 'cache-source' }), { userId: 12, dateKey: '2026-07-16', slot: 0 });
  const common = { ownerUserId: 12, contextVersion: 'ctx-1', modelVersion: 'qwen3.7-plus', promptVersion: 'p1', knowledgeBaseVersion: 'kb1', personalizationVersion: 'student-v1' };
  const first = learningCardCacheKey(card, common);
  assert.notEqual(first, learningCardCacheKey(card, { ...common, ownerUserId: 13 }));
  assert.notEqual(first, learningCardCacheKey(card, { ...common, contextVersion: 'ctx-2' }));
  assert.notEqual(first, learningCardCacheKey(card, { ...common, modelVersion: 'qwen3.7-plus-2026' }));
  assert.notEqual(first, learningCardCacheKey(card, { ...common, promptVersion: 'p2' }));
  assert.notEqual(first, learningCardCacheKey(card, { ...common, knowledgeBaseVersion: 'kb2' }));
  assert.notEqual(first, learningCardCacheKey(card, { ...common, personalizationVersion: 'student-v2' }));
});

test('two-level daily cache writes atomically, validates protocol, and supports stale-while-revalidate state', async () => {
  const card = buildRuleCard(candidate({ sourceId: 'cached-source' }), { userId: 19, dateKey: '2026-07-16', slot: 0 });
  const payload = {
    version: '1.0', userId: 19, date: '2026-07-16', cards: [card], status: 'READY',
    generatedAt: new Date().toISOString(), refreshedAt: new Date().toISOString(), reasonSummary: '测试', dataSnapshotVersion: 'v1',
  };
  await platformCache.writeDaily(payload);
  platformCache.clearMemory();
  assert.equal((await platformCache.readDaily(19, '2026-07-16')).cards[0].id, card.id);
  assert.equal((await platformCache.markDailyStale(19, '2026-07-16', '学习状态变化')).status, 'STALE');
  assert.equal((await platformCache.readDaily(19, '2026-07-16')).reasonSummary, '学习状态变化');
  assert.equal(fs.readdirSync(cacheRoot).filter(name => name.endsWith('.tmp')).length, 0);
});

test('daily AI enhancement degrades only model/output failures and never hides database failures', () => {
  assert.equal(isRecoverableAiEnhancementError(Object.assign(new Error('bad json'), { code: 'LEARNING_CARD_AI_INVALID_OUTPUT' })), true);
  assert.equal(isRecoverableAiEnhancementError(Object.assign(new Error('timeout'), { code: 'BAILIAN_TIMEOUT' })), true);
  assert.equal(isRecoverableAiEnhancementError(Object.assign(new Error('database failed'), { code: 'P2002', name: 'PrismaClientKnownRequestError' })), false);
});

test('Qwen JSON control escapes are repaired back into safe LaTeX commands', () => {
  assert.equal(repairLatexControlEscapes(`无标签 $${'\n'}eq$ 无法直接比较准确率`), '无标签 $\\neq$ 无法直接比较准确率');
  assert.equal(repairLatexControlEscapes(`$${'\t'}heta$ 与 $${'\u000c'}rac{a}{b}$`), '$\\theta$ 与 $\\frac{a}{b}$');
});

test('route, worker and frontend interaction contracts are wired end to end', () => {
  const routeSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/learning-card/learning-card.routes.js'), 'utf8');
  const appSource = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
  const workerSource = fs.readFileSync(path.resolve(__dirname, '../src/modules/async-task/async-task.worker.js'), 'utf8');
  const uiSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/learning-card-platform.js'), 'utf8');
  [
    '/student/learning-cards/daily', '/courses/:courseId/learning-cards',
    '/wrong-questions/:id/repair-card', '/ai/cards/generate',
  ].forEach(fragment => assert.match(routeSource, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  assert.match(appSource, /app\.use\('\/api', learningCardRoutes\)/);
  assert.match(workerSource, /DAILY_LEARNING_CARD/);
  assert.match(workerSource, /processDailyCardTask/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/modules/learning-card/daily-learning-card-recommendation.service.js'), 'utf8'), /generationToken/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/modules/learning-card/daily-learning-card-recommendation.service.js'), 'utf8'), /persistAffectedSlot/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/modules/learning-card/learning-card-ai.service.js'), 'utf8'), /requestedTargetIds/);
  assert.match(uiSource, /ResizeObserver/);
  assert.match(uiSource, /prefers-reduced-motion/);
  assert.match(uiSource, /pointerdown/);
  assert.match(uiSource, /keydown/);
  assert.match(uiSource, /dispose\(/);
});
