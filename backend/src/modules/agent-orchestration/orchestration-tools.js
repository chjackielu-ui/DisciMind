const { DynamicStructuredTool } = require('@langchain/core/tools');
const { z } = require('zod');

const TOOL_NAMES = Object.freeze([
  'KnowledgeBaseRetrievalTool',
  'DifyChatflowTool',
  'DifyWorkflowTool',
  'SubjectAgentTool',
  'GeneralAgentTool',
  'FileRequirementExtractionTool',
  'HandoutGenerationTool',
  'ExamGenerationTool',
  'AttachmentTextExtractionTool',
  'ImageUnderstandingTool',
  'ArtifactLookupTool',
  'TaskStatusTool',
  'ResultSynthesisTool',
]);

const inputSchema = z.object({
  userId: z.coerce.number().int().positive(),
  conversationId: z.coerce.number().int().positive(),
  operationId: z.string().min(8).max(160),
  permissionContext: z.record(z.string(), z.unknown()),
  payload: z.record(z.string(), z.unknown()).default({}),
});

function publicError(error, toolName) {
  const wrapped = new Error(`${toolName} 执行失败`);
  wrapped.code = Number(error?.code) || 50001;
  wrapped.status = Number(error?.status) || 500;
  wrapped.cause = error;
  return wrapped;
}

function createOrchestrationTool(toolName, handler) {
  if (!TOOL_NAMES.includes(toolName)) throw new Error(`未知编排工具：${toolName}`);
  if (typeof handler !== 'function') throw new TypeError(`${toolName} 缺少真实执行器`);
  return new DynamicStructuredTool({
    name: toolName.replace(/Tool$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(),
    description: `${toolName}：DisciMind 受权限保护的编排能力。`,
    schema: inputSchema,
    func: async (input) => {
      if (!input.permissionContext?.assistantMode) throw Object.assign(new Error('缺少工具权限上下文'), { code: 40301, status: 403 });
      try {
        const result = await handler({
          userId: input.userId,
          conversationId: input.conversationId,
          operationId: input.operationId,
          permissionContext: input.permissionContext,
          payload: input.payload,
        });
        return JSON.stringify({ ok: true, tool: toolName, result });
      } catch (error) {
        throw publicError(error, toolName);
      }
    },
  });
}

async function invokeStructured(tool, input, options = {}) {
  const retries = Math.min(1, Math.max(0, Number(options.retries ?? 1)));
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await tool.invoke(input);
      const raw = typeof response === 'string' ? response : response?.content;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed?.ok) throw new Error('工具未返回结构化结果');
      return parsed.result;
    } catch (error) {
      lastError = error;
      if (attempt >= retries || error?.cause?.name === 'AbortError' || error?.name === 'AbortError') break;
    }
  }
  throw lastError;
}

module.exports = { TOOL_NAMES, createOrchestrationTool, invokeStructured };
