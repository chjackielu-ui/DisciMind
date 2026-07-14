const { z } = require('zod');

const questionSchema = z.object({
  id: z.string().trim().min(1).max(40), type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT_ANSWER', 'CALCULATION', 'PROGRAMMING']),
  stem: z.string().trim().min(1).max(3000), options: z.array(z.string().trim().min(1).max(1000)).max(10).default([]),
  answer: z.union([z.string(), z.array(z.string())]), analysis: z.string().trim().min(1).max(5000), score: z.number().nonnegative().max(1000),
  knowledgePoint: z.string().trim().min(1).max(100), difficulty: z.enum(['BASIC', 'INTERMEDIATE', 'ADVANCED']),
}).strict();

const examPaperSchema = z.object({
  title: z.string().trim().min(1).max(200), course: z.string().trim().min(1).max(100), knowledgePoints: z.array(z.string().trim().min(1)).min(1).max(20),
  difficulty: z.enum(['BASIC', 'INTERMEDIATE', 'ADVANCED']), duration: z.number().int().positive().max(600), totalScore: z.number().positive().max(1000),
  instructions: z.array(z.string().trim().min(1)).min(1).max(20), sections: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), questionIds: z.array(z.string()).min(1) })).min(1),
  questions: z.array(questionSchema).min(1).max(50), answers: z.array(z.object({ questionId: z.string().min(1), answer: z.union([z.string(), z.array(z.string())]) })).min(1),
  analysis: z.array(z.object({ questionId: z.string().min(1), analysis: z.string().min(1) })).min(1), sourceNotice: z.string().max(1000).optional(),
}).strict();

const handoutSectionSchema = z.object({ id: z.string().min(1), title: z.string().min(1), content: z.array(z.string().trim().min(1)).min(1) }).strict();
const studyHandoutSchema = z.object({
  title: z.string().trim().min(1).max(200), course: z.string().trim().min(1).max(100), knowledgePoints: z.array(z.string().trim().min(1)).min(1).max(20),
  learningObjectives: z.array(z.string().trim().min(1)).min(1), prerequisites: z.array(z.string().trim().min(1)).min(1), sections: z.array(handoutSectionSchema).min(1),
  examples: z.array(z.object({ title: z.string().min(1), content: z.string().min(1) })).default([]), keyPoints: z.array(z.string().min(1)).min(1),
  commonMistakes: z.array(z.string().min(1)).min(1), practice: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1), analysis: z.string().min(1) })).default([]),
  principles: z.array(z.string().min(1)).min(1), references: z.array(z.string().min(1)).min(1),
  summary: z.array(z.string().min(1)).min(1), sourceNotice: z.string().max(1000).optional(),
}).strict();

function schemaFor(type) { return type === 'EXAM_PAPER' ? examPaperSchema : studyHandoutSchema; }
function stripFence(value) { return String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''); }
async function parseWithSingleRepair(type, raw, repair) {
  const schema = schemaFor(type); let value;
  try { value = typeof raw === 'string' ? JSON.parse(stripFence(raw)) : raw; } catch (error) { value = null; }
  let parsed = schema.safeParse(value); if (parsed.success) return { data: parsed.data, repaired: false };
  if (!repair) throw Object.assign(new Error('生成内容不符合结构要求'), { code: 'CONTENT_SCHEMA_INVALID', issues: parsed.error?.issues || [] });
  const repairedRaw = await repair({ value, issues: parsed.error?.issues || [] });
  try { value = typeof repairedRaw === 'string' ? JSON.parse(stripFence(repairedRaw)) : repairedRaw; } catch { value = null; }
  parsed = schema.safeParse(value); if (parsed.success) return { data: parsed.data, repaired: true };
  throw Object.assign(new Error('内容自动修复后仍不符合结构要求'), { code: 'CONTENT_SCHEMA_REPAIR_FAILED', issues: parsed.error?.issues || [] });
}

module.exports = { questionSchema, examPaperSchema, handoutSectionSchema, studyHandoutSchema, schemaFor, parseWithSingleRepair };
