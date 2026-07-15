const { z } = require('zod');
const { chartSpecSchema } = require('../ai-assistant/chart-spec');

const CARD_SCOPES = Object.freeze(['GLOBAL', 'COURSE', 'STUDENT']);
const CARD_TYPES = Object.freeze(['CONCEPT', 'FORMULA', 'PITFALL', 'EXAMPLE', 'COMPARISON', 'WRONG_QUESTION', 'TASK', 'PROGRESS', 'REVIEW']);
const DIFFICULTIES = Object.freeze(['BASIC', 'MEDIUM', 'ADVANCED']);
const SECTION_TYPES = Object.freeze(['MARKDOWN', 'FORMULA', 'CHART', 'TABLE', 'EXAMPLE', 'CALLOUT']);
const CARD_EVENT_TYPES = Object.freeze(['IMPRESSION', 'CLICK', 'VIEW', 'EXPAND', 'FAVORITE', 'MASTERED', 'DEFERRED', 'IGNORED', 'ADD_TO_PLAN', 'START_PRACTICE', 'ASK_AI', 'VIEW_SOURCE', 'SAVE_ARTIFACT', 'EXPORT']);

const tableSpecSchema = z.object({
  columns: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  rows: z.array(z.array(z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])).max(20)).max(200),
}).strict().superRefine((value, ctx) => {
  value.rows.forEach((row, index) => {
    if (row.length !== value.columns.length) ctx.addIssue({ code: 'custom', path: ['rows', index], message: '表格行列数量不一致' });
  });
});

const sourceRefSchema = z.object({
  type: z.enum(['COURSE', 'KNOWLEDGE_POINT', 'KNOWLEDGE_BASE', 'DOCUMENT', 'STUDENT_MASTERY', 'WRONG_QUESTION', 'TASK', 'LEARNING_PLAN', 'SYSTEM']),
  id: z.union([z.string().trim().min(1).max(100), z.number().int().positive()]).nullable(),
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().trim().max(1000).nullable().default(null),
  url: z.string().trim().max(1000).nullable().default(null),
}).strict();

const learningCardSectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{2,80}$/i),
  type: z.enum(SECTION_TYPES),
  title: z.string().trim().min(1).max(120).nullable().default(null),
  content: z.string().max(20000).nullable().default(null),
  formula: z.string().max(4000).nullable().default(null),
  chartSpec: chartSpecSchema.nullable().default(null),
  tableSpec: tableSpecSchema.nullable().default(null),
}).strict().superRefine((section, ctx) => {
  if (section.type === 'CHART' && !section.chartSpec) ctx.addIssue({ code: 'custom', path: ['chartSpec'], message: '图表区块缺少 ChartSpec 1.0' });
  if (section.type === 'TABLE' && !section.tableSpec) ctx.addIssue({ code: 'custom', path: ['tableSpec'], message: '表格区块缺少 tableSpec' });
  if (section.type === 'FORMULA' && !(section.formula || section.content)) ctx.addIssue({ code: 'custom', path: ['formula'], message: '公式区块缺少公式内容' });
  if (!['CHART', 'TABLE', 'FORMULA'].includes(section.type) && !section.content) ctx.addIssue({ code: 'custom', path: ['content'], message: '卡片区块缺少内容' });
});

const learningCardActionSchema = z.object({
  type: z.enum(['FAVORITE', 'MASTERED', 'DEFER', 'IGNORE', 'ADD_TO_PLAN', 'START_PRACTICE', 'ASK_AI', 'VIEW_KNOWLEDGE_POINT', 'VIEW_SOURCE', 'SAVE_ARTIFACT', 'EXPORT']),
  label: z.string().trim().min(1).max(40),
  enabled: z.boolean().default(true),
}).strict();

const learningCardStateSchema = z.object({
  isFavorite: z.boolean(),
  isMastered: z.boolean(),
  isDeferred: z.boolean(),
  isIgnored: z.boolean().default(false),
  viewCount: z.number().int().min(0),
  dwellTimeMs: z.number().int().min(0).default(0),
}).strict();

const generatorSchema = z.object({
  model: z.string().trim().min(1).max(100),
  promptVersion: z.string().trim().min(1).max(100),
  knowledgeBaseVersion: z.string().trim().max(128).nullable(),
  generationMode: z.enum(['AI', 'RULE', 'MIGRATED']),
}).strict();

const learningCardSchema = z.object({
  version: z.literal('1.0'),
  id: z.string().regex(/^[a-z0-9_-]{6,80}$/i),
  scope: z.enum(CARD_SCOPES),
  cardType: z.enum(CARD_TYPES),
  title: z.string().trim().min(2).max(200),
  summary: z.string().trim().min(2).max(1000),
  courseId: z.number().int().positive().nullable(),
  courseName: z.string().trim().min(1).max(200).nullable(),
  knowledgePointId: z.number().int().positive().nullable(),
  knowledgePointName: z.string().trim().min(1).max(200).nullable(),
  chapterName: z.string().trim().min(1).max(200).nullable(),
  difficulty: z.enum(DIFFICULTIES),
  estimatedReadingSeconds: z.number().int().min(10).max(900),
  recommendationReason: z.string().trim().min(1).max(1000),
  priorityScore: z.number().finite().min(-1000).max(1000),
  markdownContent: z.string().max(30000),
  sections: z.array(learningCardSectionSchema).min(1).max(12),
  sourceRefs: z.array(sourceRefSchema).min(1).max(12),
  actions: z.array(learningCardActionSchema).max(12),
  state: learningCardStateSchema,
  generator: generatorSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
}).strict().superRefine((card, ctx) => {
  const content = `${card.title}\n${card.summary}\n${card.markdownContent}\n${card.sections.map(item => `${item.content || ''}\n${item.formula || ''}`).join('\n')}`;
  if (/<\s*(?:script|iframe|object|embed)\b/i.test(content)) ctx.addIssue({ code: 'custom', path: ['markdownContent'], message: '卡片内容包含不允许的 HTML 元素' });
  if (card.scope === 'STUDENT' && !card.recommendationReason) ctx.addIssue({ code: 'custom', path: ['recommendationReason'], message: '个性化卡片必须说明推荐原因' });
});

const dailyRefreshSchema = z.object({
  eventType: z.enum(['MANUAL', 'PRACTICE_COMPLETED', 'WRONG_QUESTION_ADDED', 'MASTERY_CHANGED', 'NODE_COMPLETED', 'PLAN_STARTED', 'TEACHER_RESOURCE', 'TEACHER_TASK', 'CARD_FEEDBACK']).default('MANUAL'),
  knowledgePointId: z.coerce.number().int().positive().optional(),
  cardId: z.string().regex(/^[a-z0-9_-]{6,80}$/i).optional(),
}).strict();

const cardActionSchema = z.object({
  action: z.enum(['IMPRESSION', 'CLICK', 'VIEW', 'EXPAND', 'FAVORITE', 'UNFAVORITE', 'MASTERED', 'UNMASTERED', 'DEFERRED', 'UNDEFERRED', 'IGNORED', 'UNIGNORED', 'VIEW_SOURCE', 'SAVE_ARTIFACT', 'EXPORT']),
  dwellTimeMs: z.coerce.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

const courseLibraryQuerySchema = z.object({
  chapterName: z.string().trim().max(200).optional(),
  knowledgePointId: z.coerce.number().int().positive().optional(),
  cardType: z.enum(CARD_TYPES).optional(),
  masteryState: z.enum(['ALL', 'FAVORITE', 'MASTERED', 'UNMASTERED']).default('ALL'),
  teacherRecommended: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['RECENT', 'PRIORITY', 'TITLE']).default('RECENT'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
}).strict();

const sceneQuerySchema = z.object({
  scene: z.enum(['LEARNING_CENTER']).default('LEARNING_CENTER'),
  learningPlanId: z.coerce.number().int().positive().optional(),
}).strict();

const aiGenerateSchema = z.object({
  topic: z.string().trim().min(2).max(500),
  title: z.string().trim().min(2).max(200).optional(),
  courseId: z.coerce.number().int().positive().optional(),
  knowledgePointId: z.coerce.number().int().positive().optional(),
  cardTypes: z.array(z.enum(CARD_TYPES)).min(1).max(8).optional(),
  count: z.coerce.number().int().min(1).max(8).default(5),
  learningGoal: z.string().trim().max(1000).optional(),
  includeChart: z.boolean().default(false),
}).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw Object.assign(new Error(result.error.issues[0]?.message || '学习卡片参数不合法'), { code: 40001, status: 400, details: result.error.issues });
}

module.exports = {
  CARD_SCOPES, CARD_TYPES, DIFFICULTIES, SECTION_TYPES, CARD_EVENT_TYPES,
  tableSpecSchema, sourceRefSchema, learningCardSectionSchema, learningCardActionSchema,
  learningCardStateSchema, generatorSchema, learningCardSchema, dailyRefreshSchema,
  cardActionSchema, courseLibraryQuerySchema, sceneQuerySchema, aiGenerateSchema, parse,
};
