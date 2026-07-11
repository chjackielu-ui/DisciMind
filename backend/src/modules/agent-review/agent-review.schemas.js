const { z } = require('zod');

const operationSchema = z.object({ operationId: z.string().trim().min(8).max(64) });
const rejectSchema = operationSchema.extend({ reason: z.string().trim().min(2).max(1000) });
const resolveReportSchema = operationSchema.extend({ resolution: z.string().trim().min(2).max(1000), offlineAgent: z.boolean().default(false) });
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '请求参数不合法'); error.code = 40001; error.status = 400; throw error;
}
module.exports = { operationSchema, rejectSchema, resolveReportSchema, parse };
