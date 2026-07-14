const { z } = require('zod');

const creationMode = z.enum(['goal_based', 'ai_generated', 'custom']);
const planStatus = z.enum(['draft', 'ready', 'running', 'paused', 'completed', 'failed', 'archived']);

const createSchema = z.object({
  courseId: z.coerce.number().int().positive(),
  knowledgePointId: z.coerce.number().int().positive(),
  knowledgePointIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  learningGoalId: z.coerce.number().int().positive().optional().nullable(),
  goalText: z.string().trim().min(2).max(500).optional(),
  workflowTemplateId: z.coerce.number().int().positive().optional().nullable(),
  workflowVersionId: z.coerce.number().int().positive().optional().nullable(),
  creationMode,
  status: z.enum(['draft', 'ready']).default('ready'),
  targetMastery: z.coerce.number().int().min(1).max(100).optional().nullable(),
  completionMode: z.enum(['MASTERY_TARGET', 'WORKFLOW_COMPLETE', 'FLOW_COMPLETE', 'mastery_target', 'flow_complete']).optional(),
  estimatedMinutes: z.coerce.number().int().min(1).max(240).optional().nullable(),
}).strict().superRefine((value, context) => {
  if (value.creationMode === 'goal_based' && !value.learningGoalId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['learningGoalId'], message: '按学习目标生成时必须选择学习目标' });
  }
  if (!value.learningGoalId && !value.goalText) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['goalText'], message: '请填写学习目标' });
  }
});

const listSchema = z.object({
  status: planStatus.optional(),
  creationMode: creationMode.optional(),
  courseId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const transitionSchema = z.object({ status: planStatus }).strict();
const operationSchema = z.object({ operationId: z.string().trim().min(8).max(128).optional() }).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw Object.assign(new Error(result.error.issues[0]?.message || '学习计划参数不合法'), { code: 40001, status: 400 });
}

module.exports = { createSchema, listSchema, transitionSchema, operationSchema, parse };
