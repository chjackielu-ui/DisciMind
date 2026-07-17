const test = require('node:test');
const assert = require('node:assert/strict');

const { knowledgeCardDeckSchema } = require('../src/modules/learning-flow-preload/knowledge-card.schemas');
const { cardTypesForNode, fallbackDeck } = require('../src/modules/learning-flow-preload/knowledge-card.service');
const cache = require('../src/modules/learning-flow-preload/knowledge-card-cache.service');

function context() {
  const base = {
    userId: 7, sessionId: 50, nodeType: 'adaptive_practice',
    course: { course_id: 1, course_name: '机器学习', description: '机器学习课程' },
    knowledgePoint: { knowledge_point_id: 4, knowledge_point_name: '逻辑回归', description: '用于二分类的线性模型。' },
    mastery: { mastery_score: 58, mastery_level: 'WEAK' }, wrongQuestions: [{ wrong_reason: 'CONCEPT_MISUNDERSTANDING' }], documents: [],
  };
  base.universalDimensions = { courseId: 1, knowledgePointId: 4, nodeType: base.nodeType, cardType: 'concept,formula,comparison', knowledgeBaseVersion: 'kb-v1', promptVersion: 'card-v1', modelVersion: 'qwen3.7-plus', language: 'zh-CN', personalizationVersion: 'universal-v1' };
  base.personalizedDimensions = { ...base.universalDimensions, cardType: 'wrong_question_repair,pitfall', personalizationVersion: 'student-v1' };
  return base;
}

test('node-to-card routing keeps Trainer wait cards focused', () => {
  assert.deepEqual(cardTypesForNode('concept_explanation', 'universal'), ['concept', 'formula', 'comparison']);
  assert.deepEqual(cardTypesForNode('adaptive_practice', 'personalized'), ['wrong_question_repair', 'pitfall']);
  assert.deepEqual(cardTypesForNode('mastery_gate', 'universal'), ['review', 'exam_tip', 'formula']);
});

test('fallback deck is strict, source-backed, immediate, and does not change mastery', () => {
  const ctx = context();
  const key = cache.hash(ctx.universalDimensions);
  const deck = fallbackDeck(ctx, 'universal', key);
  assert.equal(deck.status, 'generating');
  assert.equal(deck.fallback, true);
  assert.equal(deck.cards.length, 1);
  assert.equal(deck.cards[0].knowledgePointName, '逻辑回归');
  assert.ok(deck.cards[0].sourceRefs.length >= 1);
  assert.equal(deck.cards[0].chartSpec, null);
});

test('knowledge-card schema rejects duplicate titles and scope mismatches', () => {
  const ctx = context();
  const key = cache.hash(ctx.universalDimensions);
  const deck = fallbackDeck(ctx, 'universal', key);
  assert.throws(() => knowledgeCardDeckSchema.parse({ ...deck, cards: [deck.cards[0], { ...deck.cards[0], id: `${deck.cards[0].id}_2` }] }), /标题重复/);
  assert.throws(() => knowledgeCardDeckSchema.parse({ ...deck, cards: [{ ...deck.cards[0], scope: 'personalized' }] }), /范围/);
});
