const { z } = require('zod');
const { aiError } = require('./errors');

const RISK_LEVELS = new Set(['low', 'medium', 'high']);

function receivedType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isNaN(value)) return 'nan';
  return typeof value;
}

function receivedAt(value, path = []) {
  let current = value;
  for (const part of path) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function valueSummary(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (typeof value === 'object') return `object(keys=${Object.keys(value).slice(0, 12).join(',')})`;
  return String(value).slice(0, 120);
}

function validationDetails(toolName, issue, raw, context = {}, extra = {}) {
  const path = Array.isArray(issue?.path) ? issue.path : [];
  const value = receivedAt(raw, path);
  return {
    toolName: String(toolName || 'unknown'),
    argumentPath: path.length ? path.map(part => typeof part === 'number' ? `[${part}]` : String(part)).join('.').replace(/\.\[/g, '[') : '$',
    expectedType: String(issue?.expected || issue?.code || extra.expectedType || 'valid input'),
    receivedType: extra.receivedType || receivedType(value),
    receivedValueSummary: extra.receivedValueSummary || valueSummary(value),
    recoverable: extra.recoverable !== false,
    requestId: context.requestId || null,
    issue: String(issue?.message || extra.message || '参数未通过校验').slice(0, 300),
    ...extra,
  };
}

class ToolRegistry {
  constructor() { this.tools = new Map(); }

  register(definition) {
    const name = String(definition?.name || '').trim();
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) throw new Error(`无效工具名称：${name}`);
    if (this.tools.has(name)) throw new Error(`工具已注册：${name}`);
    if (!(definition.inputSchema instanceof z.ZodType)) throw new Error(`工具 ${name} 缺少 Zod 输入 Schema`);
    if (typeof definition.handler !== 'function') throw new Error(`工具 ${name} 缺少 handler`);
    const roles = new Set((definition.roles || ['student', 'teacher', 'admin']).map(item => String(item).toLowerCase()));
    const riskLevel = RISK_LEVELS.has(definition.riskLevel) ? definition.riskLevel : 'low';
    const record = Object.freeze({
      ...definition, name, roles, riskLevel,
      description: String(definition.description || name).slice(0, 400),
      timeoutMs: Math.max(1000, Math.min(180000, Number(definition.timeoutMs) || 30000)),
      maxRetries: Math.max(0, Math.min(2, Number(definition.maxRetries) || 0)),
      idempotent: definition.idempotent !== false,
      requiresConfirmation: definition.requiresConfirmation === true,
      requiredInputs: Object.freeze([...(definition.requiredInputs || [])]),
      optionalInputs: Object.freeze([...(definition.optionalInputs || [])]),
      outputTypes: Object.freeze([...(definition.outputTypes || ['json'])]),
    });
    this.tools.set(name, record);
    return this;
  }

  get(name) {
    const tool = this.tools.get(String(name));
    if (!tool) throw aiError('AI_TOOL_VALIDATION_FAILED', `未注册工具：${String(name).slice(0, 64)}`, 400, validationDetails(name, null, {}, {}, { expectedType: 'registered tool', receivedType: 'unknown_tool', receivedValueSummary: String(name).slice(0, 64), recoverable: true }));
    return tool;
  }

  assertAllowed(tool, context = {}) {
    const role = String(context.user?.role || context.role || '').toLowerCase();
    if (!tool.roles.has(role)) throw aiError('AI_AGENT_FORBIDDEN', `当前身份无权调用工具“${tool.name}”。`, 403, { toolName: tool.name, argumentPath: '$', expectedType: `role:${[...tool.roles].join('|')}`, receivedType: `role:${role || 'unknown'}`, receivedValueSummary: role || 'missing', recoverable: false, requestId: context.requestId || null });
    if (tool.requiresConfirmation && context.confirmed !== true) {
      throw aiError('AI_TOOL_VALIDATION_FAILED', `工具“${tool.name}”需要用户确认后才能执行。`, 409, { toolName: tool.name, argumentPath: '$.confirmed', expectedType: 'true', receivedType: receivedType(context.confirmed), receivedValueSummary: valueSummary(context.confirmed), recoverable: true, requestId: context.requestId || null, requiresConfirmation: true });
    }
    return { role, decision: tool.requiresConfirmation ? 'confirmed' : 'allowed' };
  }

  preflight(name, rawInput, context = {}) {
    const tool = this.get(name);
    const permission = this.assertAllowed(tool, context);
    let normalized = { value: rawInput, repaired: false, repairs: [] };
    try {
      if (typeof tool.normalizeInput === 'function') normalized = tool.normalizeInput(rawInput, context) || normalized;
    } catch (error) {
      const issue = error?.issues?.[0] || { path: [], code: 'normalization_failed', message: error?.message || '参数规范化失败' };
      throw aiError('AI_TOOL_VALIDATION_FAILED', `工具“${tool.name}”参数错误：${issue.message}`, 400, validationDetails(tool.name, issue, rawInput, context, { recoverable: true, normalizationAttempted: true }));
    }
    const parsed = tool.inputSchema.safeParse(normalized.value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0] || { path: [], code: 'invalid_input', message: '参数错误' };
      throw aiError('AI_TOOL_VALIDATION_FAILED', `工具“${tool.name}”参数错误：${issue.message}`, 400, validationDetails(tool.name, issue, normalized.value, context, { recoverable: true, normalizationAttempted: typeof tool.normalizeInput === 'function', repairs: normalized.repairs || [] }));
    }
    if (tool.name === 'create_chart_artifact') {
      const spec = parsed.data?.spec;
      const realEmpty = spec?.chart?.xAxis?.length === 0 && /^get_student_/.test(String(spec?.source?.type || ''));
      if (spec?.chart?.xAxis?.length === 0 && !realEmpty) {
        const issue = { path: ['spec', 'chart', 'xAxis'], code: 'too_small', expected: 'non-empty array', message: '图表没有可验证的数据点' };
        throw aiError('AI_TOOL_VALIDATION_FAILED', `工具“${tool.name}”参数错误：${issue.message}`, 400, validationDetails(tool.name, issue, parsed.data, context, { recoverable: false, normalizationAttempted: true, repairs: normalized.repairs || [] }));
      }
    }
    return { tool, permission, input: parsed.data, repaired: Boolean(normalized.repaired), repairs: normalized.repairs || [] };
  }

  list(context = {}) {
    const role = String(context.user?.role || context.role || '').toLowerCase();
    return [...this.tools.values()].filter(tool => tool.roles.has(role));
  }

  toOpenAiTools(context = {}) {
    return this.list(context).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || { type: 'object', properties: {}, additionalProperties: false },
      },
    }));
  }

  describe(context = {}) {
    return this.list(context).map(tool => ({
      name: tool.name, description: tool.description, roles: [...tool.roles], riskLevel: tool.riskLevel,
      timeoutMs: tool.timeoutMs, maxRetries: tool.maxRetries, idempotent: tool.idempotent,
      requiresConfirmation: tool.requiresConfirmation, requiredInputs: tool.requiredInputs,
      optionalInputs: tool.optionalInputs, outputTypes: tool.outputTypes,
      parameters: tool.parameters || {},
    }));
  }
}

module.exports = { ToolRegistry, receivedType, receivedAt, valueSummary, validationDetails };
