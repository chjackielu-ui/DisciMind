const { z } = require('zod');

const providerTypes = ['bailian', 'qwen', 'deepseek', 'spark', 'openai_compatible', 'dify', 'custom'];
const runtimeTypes = ['langgraph', 'self', 'dify_workflow', 'dify_chatflow', 'model_direct'];
const agentTypes = ['COURSE_QA', 'LEARNING_ANALYSIS', 'PERSONALIZED_RECOMMENDATION', 'QUESTION_GENERATION', 'DOCUMENT_SUMMARY', 'TRAINER', 'EXPLAINER', 'DIAGNOSTICIAN'];
const usageTypes = ['QA', 'SUMMARY', 'QUESTION_GENERATION', 'GRADING', 'RECOMMENDATION', 'EMBEDDING', 'SAFETY'];

const optionalUrl = z.union([z.literal(''), z.string().url().refine((value) => /^https?:\/\//i.test(value), '仅支持 HTTP/HTTPS')]).optional();
function containsSensitiveKey(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => /authorization|api[_-]?key|api[_-]?secret|token|secret|password|cookie/i.test(key) || containsSensitiveKey(item));
}

const jsonObject = z.record(z.string(), z.unknown()).optional().nullable();
const safeConfigObject = jsonObject.superRefine((value, ctx) => {
  if (containsSensitiveKey(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '扩展配置不得包含密钥、Token 或 Authorization，请使用独立密钥操作' });
});

const providerInput = z.object({
  provider_code: z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/),
  display_name: z.string().trim().min(1).max(160),
  provider_type: z.enum(providerTypes),
  base_url: optionalUrl,
  auth_type: z.enum(['bearer', 'api_key_header', 'none']).default('bearer'),
  enabled: z.boolean().default(true),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).default(10000),
  max_retries: z.coerce.number().int().min(0).max(5).default(1),
  extra_config_json: safeConfigObject,
}).strict();

const providerUpdate = providerInput.partial().omit({ provider_code: true }).strict();

const providerSecretInput = z.object({
  api_key: z.string().trim().min(1).max(10000).optional(),
  api_secret: z.string().trim().min(1).max(10000).optional(),
  app_id: z.string().trim().min(1).max(500).optional(),
  workspace_id: z.string().trim().min(1).max(500).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, '至少填写一个密钥字段');

const providerSecretClear = z.object({ confirm: z.literal(true) }).strict();

const modelInput = z.object({
  provider_id: z.coerce.number().int().positive(),
  model_code: z.string().trim().min(1).max(120),
  display_name: z.string().trim().min(1).max(160),
  model_type: z.enum(['chat', 'reasoning', 'embedding', 'rerank', 'vision', 'speech', 'image', 'workflow']).default('chat'),
  capabilities_json: jsonObject,
  max_context_length: z.coerce.number().int().positive().max(10000000).optional().nullable(),
  max_output_tokens: z.coerce.number().int().positive().max(1000000).optional().nullable(),
  supports_stream: z.boolean().default(false), supports_tools: z.boolean().default(false),
  supports_vision: z.boolean().default(false), supports_audio: z.boolean().default(false),
  supports_embedding: z.boolean().default(false), supports_rerank: z.boolean().default(false),
  input_price: z.coerce.number().min(0).optional().nullable(), output_price: z.coerce.number().min(0).optional().nullable(),
  currency: z.string().trim().min(3).max(12).default('CNY'), enabled: z.boolean().default(true),
  is_default: z.boolean().default(false), parameters_json: jsonObject,
  usage_type: z.enum(usageTypes).default('QA'), temperature: z.coerce.number().min(0).max(2).optional().nullable(),
}).strict();

const agentInput = z.object({
  agent_key: z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/),
  agent_type: z.enum(agentTypes), agent_name: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional().nullable(), runtime_type: z.enum(runtimeTypes),
  provider_id: z.coerce.number().int().positive().optional().nullable(),
  model_config_id: z.coerce.number().int().positive().optional().nullable(),
  base_url_override: optionalUrl,
  dify_app_id: z.string().max(255).optional().nullable(), dify_workflow_id: z.string().max(255).optional().nullable(),
  timeout_ms: z.coerce.number().int().min(1000).max(600000).default(120000),
  max_retries: z.coerce.number().int().min(0).max(5).default(1),
  max_output_tokens: z.coerce.number().int().positive().max(1000000).optional().nullable(),
  knowledge_config_json: jsonObject, tool_config_json: jsonObject, runtime_config_json: jsonObject,
  enabled: z.boolean().default(true), status: z.enum(['draft', 'published', 'disabled', 'archived']).default('draft'),
}).strict();

module.exports = {
  providerInput, providerUpdate, providerSecretInput, providerSecretClear,
  modelInput, modelUpdate: modelInput.partial().strict(),
  agentInput, agentUpdate: agentInput.partial().omit({ agent_key: true }).strict(),
};
