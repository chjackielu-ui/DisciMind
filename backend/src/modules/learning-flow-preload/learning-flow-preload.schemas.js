const { z } = require('zod');

const createSchema = z.object({
  learningPlanId: z.coerce.number().int().positive().optional(),
  workflowTemplateId: z.coerce.number().int().positive().optional(),
  learningGoalId: z.coerce.number().int().positive().optional(),
  learningSessionId: z.coerce.number().int().positive().optional().nullable(),
  operationId: z.string().trim().min(8).max(128).optional(),
}).strict();

const listSchema = z.object({
  learningPlanId: z.coerce.number().int().positive().optional(),
  workflowTemplateId: z.coerce.number().int().positive().optional(),
  learningGoalId: z.coerce.number().int().positive().optional(),
  status: z.enum(['NOT_STARTED', 'QUEUED', 'PRELOADING', 'PARTIAL', 'READY', 'FAILED', 'EXPIRED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const cardQuerySchema = z.object({
  nodeId: z.string().trim().min(1).max(100).optional(),
}).strict();

const cardStateSchema = z.object({
  nodeId: z.string().trim().min(1).max(100).optional(),
  state: z.object({ favorite: z.boolean().optional(), mastered: z.boolean().optional(), expanded: z.boolean().optional() }).strict(),
}).strict();

const regenerateCardsSchema = z.object({ nodeId: z.string().trim().min(1).max(100).optional() }).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw Object.assign(new Error(result.error.issues[0]?.message || '参数不合法'), { code: 40001, status: 400 });
}

module.exports = { createSchema, listSchema, cardQuerySchema, cardStateSchema, regenerateCardsSchema, parse };
