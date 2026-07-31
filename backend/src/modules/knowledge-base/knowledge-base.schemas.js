const { z } = require('zod');

const knowledgeBaseSchema = z.object({
  name: z.string().trim().min(2).max(100).refine((value) => !/[<>]/.test(value), '名称不能包含 HTML'),
  description: z.string().trim().max(1000).default(''),
  category: z.string().trim().max(50).optional(),
  operationId: z.string().trim().min(8).max(64),
});

const retrievalSchema = z.object({ query: z.string().trim().min(1).max(2000) });

const bailianBindingSchema = z.object({
  name: z.string().trim().min(2).max(100).refine((value) => !/[<>]/.test(value), '名称不能包含 HTML'),
  description: z.string().trim().max(1000).default(''),
  knowledgeBaseId: z.string().trim().min(3).max(255),
  remoteDocumentCount: z.number().int().min(0).max(100000).optional(),
  operationId: z.string().trim().min(8).max(64),
});

const bailianDatasetSchema = z.object({
  id: z.string().trim().min(3).max(255),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).default(''),
  documentCount: z.number().int().min(0).max(100000).optional(),
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || '请求参数不合法');
  error.code = 40001;
  error.status = 400;
  throw error;
}

module.exports = { knowledgeBaseSchema, retrievalSchema, bailianBindingSchema, bailianDatasetSchema, parse };
