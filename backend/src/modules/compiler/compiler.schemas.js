const { z } = require('zod');

const sourceCode = z.string().min(1, '请输入源代码').max(100_000, '源码不能超过 100000 个字符');
const language = z.enum(['c', 'python']).optional().default('c');
const topicId = z.coerce.number().int().positive().nullable().optional();

const runSchema = z.object({
  sourceCode,
  stdin: z.string().max(32_768, '标准输入不能超过 32768 个字符').optional().default(''),
  topicId,
  language,
}).strict();

const judgeSchema = z.object({
  sourceCode,
  topicId: z.coerce.number().int().positive(),
  language,
}).strict();

const historySchema = z.object({
  topicId,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '请求参数不合法');
  error.code = 40001;
  error.status = 400;
  error.expose = true;
  throw error;
}

module.exports = { runSchema, judgeSchema, historySchema, parse };
