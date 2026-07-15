const { z } = require('zod');

const sourceRefSchema = z.object({
  type: z.enum(['COURSE', 'KNOWLEDGE_POINT', 'KNOWLEDGE_BASE', 'STUDENT_MASTERY', 'WRONG_QUESTION']),
  id: z.union([z.string().max(100), z.number().int().positive()]).nullable(),
  title: z.string().min(1).max(200),
  excerpt: z.string().max(500).nullable().default(null),
}).strict();

const sectionSchema = z.object({
  type: z.enum(['text', 'formula', 'list', 'example', 'chart']),
  title: z.string().min(1).max(100), content: z.string().min(1).max(2000),
}).strict();

const knowledgeCardSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{8,80}$/i),
  courseId: z.number().int().positive(), knowledgePointId: z.number().int().positive(),
  knowledgePointName: z.string().min(1).max(100), nodeType: z.string().min(1).max(100),
  cardType: z.enum(['concept', 'formula', 'comparison', 'pitfall', 'example', 'exam_tip', 'wrong_question_repair', 'review']),
  title: z.string().min(2).max(100), summary: z.string().min(2).max(300),
  sections: z.array(sectionSchema).min(1).max(5),
  difficulty: z.enum(['basic', 'medium', 'advanced']),
  estimatedReadingSeconds: z.number().int().min(10).max(300),
  sourceRefs: z.array(sourceRefSchema).min(1).max(8),
  chartSpec: z.null().default(null), personalizedReason: z.string().max(300).nullable().default(null),
  version: z.number().int().positive(), scope: z.enum(['universal', 'personalized']),
}).strict();

const knowledgeCardDeckSchema = z.object({
  schemaVersion: z.literal('1.0'), cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['ready', 'generating', 'stale', 'failed']),
  courseId: z.number().int().positive(), knowledgePointId: z.number().int().positive(),
  nodeType: z.string().min(1).max(100), scope: z.enum(['universal', 'personalized']),
  dimensions: z.object({
    courseId: z.number().int().positive(), knowledgePointId: z.number().int().positive(), nodeType: z.string().min(1).max(100),
    cardType: z.string().min(1).max(100), knowledgeBaseVersion: z.string().min(1).max(128),
    promptVersion: z.string().min(1).max(64), modelVersion: z.string().min(1).max(100),
    language: z.string().min(2).max(20), personalizationVersion: z.string().min(1).max(128),
  }).strict(),
  cards: z.array(knowledgeCardSchema).min(1).max(5),
  fallback: z.boolean(), errorCode: z.string().max(100).nullable(),
  generatedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict().superRefine((deck, ctx) => {
  const titles = deck.cards.map(card => card.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) ctx.addIssue({ code: 'custom', path: ['cards'], message: '知识卡片标题重复' });
  for (const [index, card] of deck.cards.entries()) {
    if (card.courseId !== deck.courseId || card.knowledgePointId !== deck.knowledgePointId || card.nodeType !== deck.nodeType || card.scope !== deck.scope) {
      ctx.addIssue({ code: 'custom', path: ['cards', index], message: '卡片范围与卡组不一致' });
    }
  }
});

const cardStatePatchSchema = z.object({
  favorite: z.boolean().optional(), mastered: z.boolean().optional(), expanded: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0, '至少更新一种卡片状态');

module.exports = { sourceRefSchema, sectionSchema, knowledgeCardSchema, knowledgeCardDeckSchema, cardStatePatchSchema };
