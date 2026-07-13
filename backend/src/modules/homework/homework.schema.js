// 作业模块 Zod 校验 Schema
// 复用 file-content.schemas 内的 questionSchema

const { z } = require('zod');

// 作业发布入参
const createHomeworkSchema = z.object({
  course_id: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  question_json: z.array(z.object({
    id: z.string(),
    type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT_ANSWER']),
    stem: z.string().min(1),
    options: z.array(z.string()).optional(),
    answer: z.union([z.string(), z.array(z.string())]),
    analysis: z.string().optional(),
    score: z.number().nonnegative().optional(),
    knowledgePoint: z.string().optional(),
  })).min(1),
  total_score: z.number().positive().optional(),
  deadline: z.string().datetime().optional(),
}).strict();

const updateHomeworkSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  question_json: z.array(z.object({
    id: z.string(),
    type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT_ANSWER']),
    stem: z.string().min(1),
    options: z.array(z.string()).optional(),
    answer: z.union([z.string(), z.array(z.string())]),
    analysis: z.string().optional(),
    score: z.number().nonnegative().optional(),
    knowledgePoint: z.string().optional(),
  })).optional(),
  deadline: z.string().datetime().optional(),
}).strict();

// 批量导入试题入参
const importQuestionSchema = z.object({
  questions: z.array(z.object({
    type: z.enum(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'FILL_BLANK', 'SHORT_ANSWER']),
    stem: z.string().min(1),
    options: z.array(z.string()).optional(),
    answer: z.union([z.string(), z.array(z.string())]),
    analysis: z.string().optional(),
    score: z.number().nonnegative().optional(),
  })).min(1).max(200),
}).strict();

// 手动批改入参
const manualMarkSchema = z.object({
  score: z.number().min(0),
  comment: z.string().max(2000).optional(),
  wrong_keywords: z.array(z.string()).optional(),
}).strict();

// 分页查询参数
const listQuerySchema = z.object({
  course_id: z.string().optional(),
  status: z.string().optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

const submissionQuerySchema = z.object({
  mark_status: z.string().optional(),
  submit_status: z.string().optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

module.exports = {
  createHomeworkSchema,
  updateHomeworkSchema,
  importQuestionSchema,
  manualMarkSchema,
  listQuerySchema,
  submissionQuerySchema,
};
