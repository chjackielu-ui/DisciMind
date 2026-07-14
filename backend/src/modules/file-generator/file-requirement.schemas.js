const { z } = require('zod');

const requirementFields = {
  artifactType: z.enum(['EXAM_PAPER', 'STUDY_HANDOUT']).optional(),
  courseKey: z.string().trim().max(80).optional(),
  knowledgePointKeys: z.array(z.string().trim().max(80)).max(10).optional(),
  knowledgeBaseRefs: z.array(z.object({ knowledgeBaseId: z.coerce.number().int().positive(), name: z.string().trim().max(200).optional() }).strict()).max(5).optional(),
  title: z.string().trim().max(150).optional(),
  difficulty: z.enum(['BASIC', 'INTERMEDIATE', 'ADVANCED']).optional(),
  questionCount: z.coerce.number().int().min(1).max(50).optional(),
  targetAudience: z.string().trim().max(100).optional(),
  handoutLength: z.enum(['SHORT', 'MEDIUM', 'LONG']).optional(),
  learningObjectives: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  includeExamples: z.boolean().optional(),
  includeExercises: z.boolean().optional(),
  examType: z.enum(['QUIZ', 'MIDTERM', 'FINAL', 'MOCK', 'CUSTOM']).optional(),
  totalScore: z.coerce.number().int().min(1).max(1000).optional(),
  duration: z.coerce.number().int().min(1).max(600).optional(),
  questionTypes: z.array(z.object({
    type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT_ANSWER', 'CALCULATION', 'PROGRAMMING']),
    count: z.coerce.number().int().min(1).max(50),
    score: z.coerce.number().positive().max(200),
  }).strict()).max(10).optional(),
  includeAnswers: z.boolean().optional(),
  includeAnalysis: z.boolean().optional(),
  includeAnswerSheet: z.boolean().optional(),
  outputFormat: z.enum(['DOCX', 'PDF']).optional(),
  outputFormats: z.array(z.enum(['DOCX', 'PDF'])).min(1).max(2).optional(),
  generationStyle: z.string().trim().max(200).optional(),
  specialRequirements: z.string().trim().max(1000).optional(),
};

const requirementPatchSchema = z.object(requirementFields).strict().superRefine((value, ctx) => {
  if (!value.questionTypes?.length) return;
  const types = value.questionTypes.map((item) => item.type);
  if (new Set(types).size !== types.length) {
    ctx.addIssue({ code: 'custom', path: ['questionTypes'], message: '同一种题型只能配置一次' });
  }
  const count = value.questionTypes.reduce((sum, item) => sum + item.count, 0);
  const score = value.questionTypes.reduce((sum, item) => sum + item.count * item.score, 0);
  if (count > 50) ctx.addIssue({ code: 'custom', path: ['questionTypes'], message: '题目总数不能超过 50' });
  if (value.questionCount !== undefined && count !== value.questionCount) ctx.addIssue({ code: 'custom', path: ['questionCount'], message: '题型数量之和必须等于题目总数' });
  if (value.totalScore !== undefined && Math.abs(score - value.totalScore) > 1e-6) ctx.addIssue({ code: 'custom', path: ['totalScore'], message: '各题型分值之和必须等于总分' });
});
const planSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  knowledgeBaseRefs: requirementFields.knowledgeBaseRefs.default([]),
  agentRefs: z.array(z.object({ agentId: z.coerce.number().int().positive(), name: z.string().trim().max(200).optional() }).strict()).max(5).default([]),
}).strict();
const confirmSchema = z.object({ operationId: z.string().trim().min(8).max(64) }).strict();
const prefillSchema = z.object({
  artifactType: z.literal('STUDY_HANDOUT').default('STUDY_HANDOUT'),
  courseId: z.coerce.number().int().positive().optional(),
  knowledgePointId: z.coerce.number().int().positive().optional(),
  learningGoalId: z.coerce.number().int().positive().optional().nullable(),
  learningPlanId: z.coerce.number().int().positive().optional().nullable(),
  workflowTemplateId: z.coerce.number().int().positive().optional().nullable(),
  workflowVersionId: z.coerce.number().int().positive().optional().nullable(),
  learningSessionId: z.coerce.number().int().positive().optional().nullable(),
  knowledgePointIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  planNodeSummary: z.array(z.object({ id: z.string().max(100), type: z.string().max(100), title: z.string().max(200) }).strict()).max(30).optional(),
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
