const { z } = require('zod');

const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['DRAFT', 'GENERATING', 'CONTENT_READY', 'EXPORTING', 'READY', 'FAILED', 'EXPIRED', 'DELETING', 'DELETED']).optional(),
  artifactType: z.enum(['EXAM_PAPER', 'STUDY_HANDOUT']).optional(),
  artifactRole: z.enum(['PRIMARY', 'STUDENT_PAPER', 'ANSWER_KEY', 'ANSWER_SHEET']).optional(),
  q: z.string().trim().max(100).optional(),
  agentId: z.coerce.number().int().positive().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
}).strict();

const exportSchema = z.object({ operationId: z.string().trim().min(8).max(128), formats: z.array(z.enum(['DOCX','PDF'])).min(1).max(2).default(['DOCX']) }).strict();
const bulkDeleteSchema = z.object({ artifactIds: z.array(z.coerce.number().int().positive()).min(1).max(100).transform(items => [...new Set(items)]) }).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw Object.assign(new Error(result.error.issues[0]?.message || '参数不合法'), { code: 40001, status: 400 });
}

module.exports = { listSchema, exportSchema, bulkDeleteSchema, parse };
