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
  outputFormat: z.literal('DOCX').optional(),
  generationStyle: z.string().trim().max(200).optional(),
  specialRequirements: z.string().trim().max(1000).optional(),
};

const requirementPatchSchema = z.object(requirementFields).strict();
const planSchema = z.object({ message: z.string().trim().min(1).max(2000) }).strict();
const confirmSchema = z.object({ operationId: z.string().trim().min(8).max(64) }).strict();

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '文件需求参数不合法');
  error.code = 40001; error.status = 400; throw error;
}

module.exports = { requirementFields, requirementPatchSchema, planSchema, confirmSchema, parse };
