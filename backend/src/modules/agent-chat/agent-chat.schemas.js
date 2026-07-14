const { z } = require('zod');

const knowledgeBaseRefSchema = z.object({
  knowledgeBaseId: z.coerce.number().int().positive(),
  name: z.string().trim().max(100).optional(),
}).strict();
const agentRefSchema = z.object({
  agentId: z.coerce.number().int().positive(),
  name: z.string().trim().max(100).optional(),
}).strict();
const structuredRefs = {
  knowledgeBaseRefs: z.array(knowledgeBaseRefSchema).max(5).default([]),
  agentRefs: z.array(agentRefSchema).max(5).default([]),
};
const imageSchema = z.object({
  name: z.string().trim().min(1).max(180),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  dataUrl: z.string().max(7 * 1024 * 1024),
}).strict();

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).default('新对话'),
  memoryEnabled: z.boolean().optional(),
  operationId: z.string().trim().min(8).max(64),
});
const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  memoryEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, '没有可更新的内容');
const messageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  operationId: z.string().trim().min(8).max(64),
  images: z.array(imageSchema).max(4).default([]),
  ...structuredRefs,
});
const generationSchema = z.object({
  content: z.string().trim().min(1).max(4000).optional(),
  regenerate: z.boolean().default(false),
  operationId: z.string().trim().min(8).max(64),
  images: z.array(imageSchema).max(4).default([]),
  ...structuredRefs,
}).refine(value => value.regenerate || Boolean(value.content) || value.images.length > 0, '消息内容不能为空');
const memorySchema = z.object({
  type: z.enum(['LEARNING_GOAL', 'STYLE_PREFERENCE', 'COURSE_BACKGROUND', 'PROJECT_BACKGROUND', 'PROGRESS', 'USER_REQUEST']),
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(1000),
  sourceMessageId: z.coerce.number().int().positive().optional(),
  enabled: z.boolean().default(true),
});
const memoryUpdateSchema = memorySchema.partial().refine(value => Object.keys(value).length > 0, '没有可更新的内容');
const memoryCandidateDecisionSchema = z.object({ action: z.enum(['SAVE', 'DISCARD']) }).strict();
const bulkConversationSchema = z.object({
  conversationIds: z.array(z.coerce.number().int().positive()).min(1).max(100).transform(items => [...new Set(items)]),
  action: z.enum(['DELETE', 'CLEAR_MESSAGES']),
  deleteArtifacts: z.boolean().default(false),
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '请求参数不合法');
  error.code = 40001;
  error.status = 400;
  throw error;
}
module.exports = {
  createConversationSchema, updateConversationSchema, messageSchema, generationSchema,
  memorySchema, memoryUpdateSchema, memoryCandidateDecisionSchema, bulkConversationSchema, knowledgeBaseRefSchema, agentRefSchema, parse,
};
