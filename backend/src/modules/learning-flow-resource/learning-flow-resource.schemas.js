const { z } = require('zod');

const positiveId = z.coerce.number().int().positive();
const optionalId = positiveId.optional().nullable();
const resourceRole = z.enum([
  'PRE_CLASS_HANDOUT',
  'REFERENCE_MATERIAL',
  'PRACTICE_PAPER',
  'REVIEW_MATERIAL',
]);

const createSchema = z.object({
  courseId: optionalId,
  knowledgePointId: optionalId,
  learningGoalId: optionalId,
  workflowTemplateId: optionalId,
  learningSessionId: optionalId,
  learningPlanId: optionalId,
  resourceRole,
}).strict().superRefine((value, ctx) => {
  if (![value.courseId, value.knowledgePointId, value.learningGoalId, value.workflowTemplateId, value.learningSessionId, value.learningPlanId].some(Boolean)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请至少选择一个有效的学习流关联目标' });
  }
  if (value.knowledgePointId && !value.courseId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '选择知识点时必须同时选择课程' });
  }
});

const listSchema = z.object({
  courseId: optionalId,
  knowledgePointId: optionalId,
  learningGoalId: optionalId,
  workflowTemplateId: optionalId,
  learningSessionId: optionalId,
  learningPlanId: optionalId,
  resourceRole: resourceRole.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw Object.assign(new Error(result.error.issues[0]?.message || '参数不合法'), { code: 40001, status: 400 });
}

module.exports = { createSchema, listSchema, parse, resourceRole };
