const { z } = require('zod');

const listSchema = z.object({
  status: z.enum(['QUEUED', 'RUNNING', 'WAITING_EXTERNAL', 'SUCCEEDED', 'FAILED', 'CANCELLED']).optional(),
  taskType: z.enum(['KNOWLEDGE_INDEXING', 'FILE_GENERATION', 'DOCUMENT_EXPORT', 'ARTIFACT_CLEANUP', 'LEARNING_FLOW_PRELOAD', 'VOICE_PRELOAD']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  includeDismissed: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});

const dismissTerminalSchema = z.object({
  statuses: z.array(z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED'])).min(1).max(3).optional().default(['SUCCEEDED', 'FAILED', 'CANCELLED']),
}).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '任务查询参数不合法');
  error.code = 40001;
  error.status = 400;
  throw error;
}

module.exports = { listSchema, dismissTerminalSchema, parse };
