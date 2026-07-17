const { z } = require('zod');
const { GOAL_TYPES, TARGET_DEPTHS } = require('../constants/learning-goal.constants');

const clarificationOptionSchema = z.object({
  title: z.string().min(1).max(80),
  goalText: z.string().min(2).max(300),
}).strict();

const resolverOutputSchema = z.object({
  goalType: z.enum(GOAL_TYPES),
  normalizedTitle: z.string().min(1).max(255),
  selectedPrimaryCandidateKey: z.string().regex(/^candidate_\d+$/).nullable().optional(),
  relatedCandidateKeys: z.array(z.string().regex(/^candidate_\d+$/)).max(5).default([]),
  focusQuestion: z.string().max(500).nullable().optional(),
  clarificationQuestion: z.string().max(300).nullable().optional(),
  clarificationOptions: z.array(clarificationOptionSchema).max(5).default([]),
  targetDepth: z.enum(TARGET_DEPTHS).default('basic'),
  reasonSummary: z.string().max(300).default(''),
}).strict();

module.exports = { resolverOutputSchema, clarificationOptionSchema };
