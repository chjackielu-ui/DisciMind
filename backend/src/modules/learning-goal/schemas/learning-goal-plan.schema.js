const { z } = require('zod');
const { TARGET_DEPTHS, WORKFLOW_TEMPLATE_KEYS } = require('../constants/learning-goal.constants');

const subGoalSchema = z.object({
  id: z.string().regex(/^sg_\d+$/),
  title: z.string().min(2).max(160),
  type: z.enum(['concept', 'practice', 'diagnostic', 'review']),
  knowledgePointId: z.number().int().positive().nullable(),
}).strict();

const prerequisiteSchema = z.object({
  title: z.string().min(1).max(160),
  required: z.boolean(),
  knowledgePointId: z.number().int().positive().nullable(),
}).strict();

const planSchema = z.object({
  subGoals: z.array(subGoalSchema).min(2).max(6),
  prerequisites: z.array(prerequisiteSchema).max(6),
  targetDepth: z.enum(TARGET_DEPTHS),
  targetMastery: z.number().int().min(60).max(95),
  estimatedMinutes: z.number().int().min(10).max(120),
  recommendedTemplateKey: z.enum(WORKFLOW_TEMPLATE_KEYS),
  recommendedNodeIntents: z.array(z.object({ intent: z.string().max(80), subGoalId: z.string().regex(/^sg_\d+$/).optional() }).strict()).max(8),
}).strict();

module.exports = { subGoalSchema, prerequisiteSchema, planSchema };
