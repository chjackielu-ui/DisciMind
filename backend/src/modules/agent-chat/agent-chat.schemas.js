const { z } = require('zod');

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
});
const generationSchema = z.object({
  content: z.string().trim().min(1).max(4000).optional(),
  regenerate: z.boolean().default(false),
  operationId: z.string().trim().min(8).max(64),
}).refine(value => value.regenerate || Boolean(value.content), '消息内容不能为空');
const memorySchema = z.object({
  type: z.enum(['LEARNING_GOAL', 'STYLE_PREFERENCE', 'COURSE_BACKGROUND', 'PROJECT_BACKGROUND', 'PROGRESS', 'USER_REQUEST']),
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(1000),
  sourceMessageId: z.coerce.number().int().positive().optional(),
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '请求参数不合法');
  error.code = 40001;
  error.status = 400;
  throw error;
}
module.exports = { createConversationSchema, updateConversationSchema, messageSchema, generationSchema, memorySchema, parse };
