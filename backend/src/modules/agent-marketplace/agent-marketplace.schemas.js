const { z } = require('zod');
const { RESPONSE_MODES, CATEGORIES, TAG_GROUPS } = require('./agent-marketplace.constants');

const noMarkup = (value) => !/[<>]/.test(value) && !/(javascript:|data:text\/html|<script)/i.test(value);
const sensitiveTag = (value) => !/(暴力|色情|赌博|毒品|仇恨|诈骗)/i.test(value);

const tagSchema = z.string().trim().min(1).max(20).refine(noMarkup, '标签不能包含 HTML 或脚本').refine(sensitiveTag, '标签包含不允许的内容');
const tagListSchema = z.array(tagSchema).max(5).default([]).transform((items) => [...new Set(items.map((item) => item.trim()))]);

const fileGeneratorConfigSchema = z.object({
  documentType: z.enum(['EXAM_PAPER', 'STUDY_HANDOUT']),
  targetAudience: z.string().trim().min(1).max(100),
  defaultCourse: z.string().trim().max(100).optional().default(''),
  defaultDifficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  answerStyle: z.string().trim().min(1).max(100).default('清晰严谨'),
  knowledgeEnhanced: z.boolean().default(false),
  outputTemplate: z.string().trim().max(3000).optional().default(''),
  maxQuestionCount: z.coerce.number().int().min(1).max(50).default(20),
  fileFormat: z.literal('DOCX').default('DOCX'),
  outputFormats: z.array(z.enum(['DOCX', 'PDF'])).min(1).max(2).default(['DOCX', 'PDF']).transform(items => [...new Set(items)]),
}).strict();

const agentInputSchema = z.object({
  agentType: z.enum(['CHAT', 'FILE_GENERATOR']).default('CHAT'),
  description: z.string().trim().min(10, '请至少用 10 个字描述智能体').max(500),
  name: z.string().trim().max(100).optional().default(''),
  category: z.enum(CATEGORIES).default('综合工具'),
  tags: z.object({
    purpose: tagListSchema,
    style: tagListSchema,
    audience: tagListSchema,
  }).default({ purpose: [], style: [], audience: [] }),
  responseMode: z.enum(RESPONSE_MODES).default('DEFAULT'),
  knowledgeBaseIds: z.array(z.coerce.number().int().positive()).max(3).default([]).transform((items) => [...new Set(items)]),
  memoryEnabledByDefault: z.boolean().default(false),
  systemPrompt: z.string().max(Number(process.env.AGENT_SYSTEM_PROMPT_MAX_CHARS || 3000)).optional(),
  topK: z.coerce.number().int().min(1).max(10).default(5),
  scoreThreshold: z.coerce.number().min(0.1).max(0.95).default(0.55),
  maxOutputTokens: z.coerce.number().int().min(256).max(4000).default(1200),
  operationId: z.string().trim().min(8).max(64),
  changeSummary: z.string().trim().max(500).optional(),
  fileGeneratorConfig: fileGeneratorConfigSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.agentType === 'FILE_GENERATOR' && !value.fileGeneratorConfig) {
    ctx.addIssue({ code: 'custom', path: ['fileGeneratorConfig'], message: '文件生成智能体缺少受控配置' });
  }
  if (value.agentType === 'CHAT' && value.fileGeneratorConfig) {
    ctx.addIssue({ code: 'custom', path: ['fileGeneratorConfig'], message: 'CHAT 智能体不能携带文件生成配置' });
  }
  if (value.responseMode === 'KNOWLEDGE_FIRST' && value.knowledgeBaseIds.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['knowledgeBaseIds'], message: '知识库优先模式请至少绑定一个知识库' });
  }
  for (const [group, items] of Object.entries(value.tags)) {
    const defaults = TAG_GROUPS[group] || [];
    for (const tag of items) {
      if (tag.length > 20 || (!defaults.includes(tag) && !noMarkup(tag))) {
        ctx.addIssue({ code: 'custom', path: ['tags', group], message: '自定义标签不合法' });
      }
    }
  }
});

const ratingSchema = z.object({ rating: z.coerce.number().int().min(1).max(5) });
const reportSchema = z.object({
  reason: z.enum(['内容不准确', '违规内容', '抄袭或侵权', '隐私问题', '恶意提示词', '其他']),
  detail: z.string().trim().max(1000).optional(),
  operationId: z.string().trim().min(8).max(64),
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '请求参数不合法');
  error.code = 40001;
  error.status = 400;
  throw error;
}

module.exports = { agentInputSchema, fileGeneratorConfigSchema, ratingSchema, reportSchema, tagSchema, parse };
