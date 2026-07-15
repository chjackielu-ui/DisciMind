const { getBailianClient } = require('../../services/bailian-openai.service');
const traceRepository = require('./trace-repository.service');
const { aiError } = require('./errors');

function parseArguments(value, toolName = 'unknown', context = {}) {
  try { return JSON.parse(String(value || '{}')); }
  catch {
    throw aiError('AI_TOOL_VALIDATION_FAILED', '模型返回的工具参数不是合法 JSON。', 400, {
      toolName, argumentPath: '$', expectedType: 'JSON object', receivedType: 'invalid_json',
      receivedValueSummary: String(value || '').slice(0, 120), recoverable: true, requestId: context.requestId || null,
    });
  }
}

function withTimeout(promise, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(aiError('AI_TOOL_TIMEOUT')), timeoutMs);
    timer.unref?.();
    const abort = () => reject(signal?.reason || Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => { clearTimeout(timer); signal?.removeEventListener?.('abort', abort); });
  });
}

async function auditValidationFailure(context, toolName, rawInput, error) {
  if (!context.traceId) return;
  await traceRepository.addToolCall(context.traceId, context.stepId, {
    tool_name: toolName || 'unknown', input: rawInput, output: null, status: 'validation_failed',
    latency_ms: 0, retry_count: 0, permission_decision: 'preflight_rejected',
    error_message: `${error.publicCode || 'AI_TOOL_VALIDATION_FAILED'}: ${error.message}`,
  }).catch(() => null);
}

async function preflightTool(registry, call, context = {}) {
  const toolName = String(call.function?.name || 'unknown');
  let rawInput = call.function?.arguments;
  try {
    rawInput = parseArguments(rawInput, toolName, context);
    return { ...registry.preflight(toolName, rawInput, context), rawInput };
  } catch (error) {
    if (error.details && !error.details.requestId) error.details.requestId = context.requestId || null;
    if (error.details && !error.details.toolName) error.details.toolName = toolName;
    await auditValidationFailure(context, toolName, rawInput, error);
    throw error;
  }
}

async function executeTool(registry, call, context, options = {}) {
  const preflight = options.preflight || await preflightTool(registry, call, context);
  const { tool, permission } = preflight;
  const parsedData = preflight.input;
  const signature = `${tool.name}:${JSON.stringify(parsedData)}`;
  if (options.seen?.has(signature)) throw aiError('AI_WORKFLOW_LOOP', '检测到重复工具调用，已停止循环。', 409);
  options.seen?.add(signature);
  const started = Date.now(); let retryCount = 0; let result; let lastError;
  const attempts = tool.idempotent ? tool.maxRetries + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      result = await withTimeout(tool.handler(parsedData, context), tool.timeoutMs, context.signal);
      if (tool.outputSchema) {
        const output = tool.outputSchema.safeParse(result);
        if (!output.success) throw aiError('AI_TOOL_VALIDATION_FAILED', `工具“${tool.name}”输出未通过契约校验。`, 500, {
          toolName: tool.name, argumentPath: '$output', expectedType: 'declared output schema',
          receivedType: typeof result, receivedValueSummary: result && typeof result === 'object' ? `object(keys=${Object.keys(result).slice(0, 12).join(',')})` : String(result).slice(0, 120),
          recoverable: false, requestId: context.requestId || null,
        });
      }
      lastError = null; break;
    } catch (error) {
      lastError = error; retryCount = attempt;
      if (attempt + 1 >= attempts || error?.status === 403 || error?.code === 40301 || error?.name === 'AbortError') break;
    }
  }
  const audit = {
    tool_name: tool.name, input: parsedData, output: lastError ? null : result,
    status: lastError ? 'failed' : 'success', latency_ms: Date.now() - started,
    retry_count: retryCount, permission_decision: permission.decision,
    error_message: lastError?.message,
  };
  if (context.traceId) await traceRepository.addToolCall(context.traceId, context.stepId, audit).catch(() => null);
  if (lastError) throw lastError;
  return { tool, result, audit, preflight: { repaired: preflight.repaired, repairs: preflight.repairs } };
}

class FunctionCallExecutor {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.maxRounds = Math.max(1, Math.min(8, Number(options.maxRounds || process.env.AI_TOOL_MAX_ROUNDS || 4)));
    this.maxCalls = Math.max(1, Math.min(20, Number(options.maxCalls || process.env.AI_TOOL_MAX_CALLS || 8)));
    this.clientFactory = options.clientFactory || getBailianClient;
  }

  async run(input = {}) {
    const { client, model } = this.clientFactory();
    const messages = [...(input.messages || [])];
    const context = input.context || {};
    const tools = this.registry.toOpenAiTools(context);
    const seen = new Set(); const calls = []; let repairAttempts = 0;
    for (let round = 0; round < this.maxRounds; round += 1) {
      const completion = await client.chat.completions.create({
        model, messages, tools, tool_choice: 'auto', temperature: 0.25,
        enable_thinking: false, max_tokens: Number(input.maxTokens || 2200),
      }, { signal: context.signal });
      const message = completion.choices?.[0]?.message || {};
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      messages.push({ role: 'assistant', content: message.content || '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      if (!toolCalls.length) return { content: String(message.content || ''), messages, calls, usage: completion.usage || null };
      if (calls.length + toolCalls.length > this.maxCalls) throw aiError('AI_WORKFLOW_LOOP');
      let requestedRepair = false;
      for (const call of toolCalls) {
        let preflight;
        try {
          preflight = await preflightTool(this.registry, call, context);
        } catch (error) {
          input.onEvent?.('tool.validation_failed', { toolCallId: call.id, toolName: call.function?.name, code: error.publicCode || 'AI_TOOL_VALIDATION_FAILED', message: error.message, details: error.details || null });
          if (error.publicCode === 'AI_TOOL_VALIDATION_FAILED' && error.details?.recoverable && repairAttempts < 1) {
            repairAttempts += 1;
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: { code: error.publicCode, message: error.message, details: error.details }, instruction: '请只修复参数结构，不要重新查询已获得的数据，并重新调用同一工具一次。' }) });
            requestedRepair = true;
            break;
          }
          throw error;
        }
        input.onEvent?.('tool.started', { toolCallId: call.id, toolName: preflight.tool.name, preflight: { repaired: preflight.repaired, repairs: preflight.repairs } });
        const executed = await executeTool(this.registry, call, context, { seen, preflight });
        calls.push({ id: call.id, name: executed.tool.name, result: executed.result, audit: executed.audit });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(executed.result ?? null) });
        input.onEvent?.('tool.completed', { toolCallId: call.id, toolName: executed.tool.name, result: executed.result });
      }
      if (requestedRepair) continue;
    }
    throw aiError('AI_WORKFLOW_LOOP');
  }
}

module.exports = { FunctionCallExecutor, parseArguments, withTimeout, auditValidationFailure, preflightTool, executeTool };
