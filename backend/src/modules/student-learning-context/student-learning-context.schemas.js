const { z } = require('zod');

const updateSchema = z.object({
  courseId: z.coerce.number().int().positive(),
  knowledgePointId: z.coerce.number().int().positive(),
  learningGoalId: z.coerce.number().int().positive(),
  workflowTemplateId: z.coerce.number().int().positive(),
  targetMastery: z.coerce.number().int().min(1).max(100).optional().nullable(),
  completionMode: z.enum(['MASTERY_TARGET', 'WORKFLOW_COMPLETE', 'TIME_BOXED']).default('MASTERY_TARGET'),
  learningPreference: z.object({
    explanationStyle: z.enum(['CONCISE', 'DETAILED', 'SOCRATIC']).default('DETAILED'),
    practiceIntensity: z.enum(['LIGHT', 'STANDARD', 'INTENSIVE']).default('STANDARD'),
    includeExamples: z.boolean().default(true),
  }).passthrough().default({}),
  voiceConfig: z.object({ enabled: z.boolean().default(false), voice: z.string().trim().max(80).optional(), speechRate: z.coerce.number().min(0.5).max(2).optional() }).passthrough().default({}),
}).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw Object.assign(new Error(result.error.issues[0]?.message || '参数不合法'), { code: 40001, status: 400 });
}

module.exports = { updateSchema, parse };
