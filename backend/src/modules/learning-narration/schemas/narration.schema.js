const { z } = require('zod');

const CreateNarrationJobSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
  nodeRunId: z.coerce.number().int().positive(),
  contentBlockId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),
  purpose: z.enum(['node_content', 'feedback', 'history_replay']).default('node_content'),
}).strict();

module.exports = { CreateNarrationJobSchema };
