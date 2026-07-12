const { z } = require('zod');

const requirementFields = {
  artifactType: z.enum(['EXAM_PAPER', 'STUDY_HANDOUT']).optional(),
  courseKey: z.string().trim().max(80).optional(),
  knowledgePointKeys: z.array(z.string().trim().max(80)).max(10).optional(),
  title: z.string().trim().max(150).optional(),
  difficulty: z.enum(['BASIC', 'INTERMEDIATE', 'ADVANCED']).optional(),
  questionCount: z.coerce.number().int().min(1).max(50).optional(),
  includeAnswers: z.boolean().optional(),
  includeAnalysis: z.boolean().optional(),
  outputFormat: z.enum(['DOCX', 'PDF']).optional(),
  outputFormats: z.array(z.enum(['DOCX', 'PDF'])).min(1).max(2).optional(),
  generationStyle: z.string().trim().max(200).optional(),
  specialRequirements: z.string().trim().max(1000).optional(),
};

const requirementPatchSchema = z.object(requirementFields).strict();
const planSchema = z.object({ message: z.string().trim().min(1).max(2000) }).strict();
const confirmSchema = z.object({ operationId: z.string().trim().min(8).max(64) }).strict();
const prefillSchema = z.object({
  artifactType: z.literal('STUDY_HANDOUT').default('STUDY_HANDOUT'),
  courseId: z.coerce.number().int().positive().optional(),
  knowledgePointId: z.coerce.number().int().positive().optional(),
  learningGoalId: z.coerce.number().int().positive().optional().nullable(),
  workflowTemplateId: z.coerce.number().int().positive().optional().nullable(),
  learningSessionId: z.coerce.number().int().positive().optional().nullable(),
  targetMastery: z.coerce.number().int().min(1).max(100).optional().nullable(),
  learningPreference: z.object({}).passthrough().optional(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  resourceRole: z.literal('PRE_CLASS_HANDOUT').default('PRE_CLASS_HANDOUT'),
}).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '文件需求参数不合法');
  error.code = 40001; error.status = 400; throw error;
}

module.exports = { requirementFields, requirementPatchSchema, planSchema, confirmSchema, prefillSchema, parse };
