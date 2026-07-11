const { z } = require('zod');
const { TARGET_DEPTHS, getLearningGoalConfig } = require('../constants/learning-goal.constants');

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PROMPT_INJECTION = /(?:ignore|忽略|无视|覆盖).{0,16}(?:system|系统|previous|之前|以上).{0,16}(?:prompt|提示|指令)|(?:system\s*prompt|开发者消息|developer\s*message)|(?:输出|返回).{0,12}(?:sql|数据库\s*id|dataset\s*id)/i;

function cleanGoalText(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function validateGoalText(value) {
  const config = getLearningGoalConfig();
  const cleaned = cleanGoalText(value);
  if (!cleaned) return { valid: false, code: 'EMPTY_GOAL', message: '请输入学习目标' };
  if (cleaned.length > config.maxInputChars) return { valid: false, code: 'GOAL_TOO_LONG', message: `学习目标不能超过 ${config.maxInputChars} 个字符` };
  if (CONTROL_CHARS.test(cleaned)) return { valid: false, code: 'INVALID_GOAL_TEXT', message: '学习目标包含不支持的控制字符' };
  if (PROMPT_INJECTION.test(cleaned)) return { valid: false, code: 'UNSAFE_GOAL_TEXT', message: '学习目标包含不允许的系统指令或数据访问要求' };
  return { valid: true, value: cleaned };
}

const preferencesSchema = z.object({
  targetDepth: z.enum(TARGET_DEPTHS).optional(),
  targetMastery: z.coerce.number().int().min(60).max(95).optional(),
  availableMinutes: z.coerce.number().int().min(10).max(120).optional(),
  explanationWeight: z.coerce.number().min(0).max(1).optional(),
  practiceWeight: z.coerce.number().min(0).max(1).optional(),
}).strict().optional().default({});

const resolveInputSchema = z.object({
  courseId: z.coerce.number().int().positive(),
  goalText: z.string(),
  operationId: z.string().trim().min(8).max(128).optional(),
  preferences: preferencesSchema,
}).strict().superRefine((value, ctx) => {
  const validation = validateGoalText(value.goalText);
  if (!validation.valid) ctx.addIssue({ code: 'custom', path: ['goalText'], message: validation.message, params: { businessCode: validation.code } });
});

const patchInputSchema = z.object({
  normalizedTitle: z.string().trim().min(2).max(255).optional(),
  focusQuestion: z.string().trim().max(500).nullable().optional(),
  targetDepth: z.enum(TARGET_DEPTHS).optional(),
  targetMastery: z.coerce.number().int().min(60).max(95).optional(),
  estimatedMinutes: z.coerce.number().int().min(10).max(120).optional(),
  clarificationGoalText: z.string().optional(),
}).strict();

module.exports = { resolveInputSchema, patchInputSchema, preferencesSchema, cleanGoalText, validateGoalText };
