const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const { listSkills } = require('../src/modules/ai-assistant/skill-registry');
const { buildRegistry, standardizeKnowledgeSources } = require('../src/modules/ai-assistant/tool-handlers.service');
const { ToolRegistry } = require('../src/modules/ai-assistant/tool-registry');
const { FunctionCallExecutor, preflightTool } = require('../src/modules/ai-assistant/function-call-executor');
const { normalizeCitations } = require('../src/modules/ai-assistant/citation-normalizer');

test('every Skill exposes the complete capability and parameter contract', () => {
  const skills = listSkills('student');
  assert.ok(skills.length >= 8);
  for (const skill of skills) {
    for (const field of ['id', 'description', 'intents', 'requiredInputs', 'optionalInputs', 'tools', 'agents', 'workflow', 'outputTypes', 'allowedRoles']) assert.ok(Object.hasOwn(skill, field), `${skill.id}.${field}`);
  }
});

test('priority Tool contracts align Registry parameters with handler schemas', () => {
  const registry = buildRegistry();
  const tools = registry.describe({ user: { role: 'student' } });
  for (const name of ['create_chart_artifact', 'create_docx_artifact', 'create_xlsx_artifact', 'get_student_learning_records', 'get_student_score_trend', 'get_student_mastery', 'get_student_wrong_questions', 'execute_agent', 'knowledge_retrieve']) {
    const tool = tools.find(item => item.name === name);
    assert.ok(tool, name);
    assert.equal(tool.parameters.type, 'object', name);
    assert.equal(tool.parameters.additionalProperties, false, name);
    assert.ok(Array.isArray(tool.requiredInputs), name);
    assert.ok(Array.isArray(tool.optionalInputs), name);
    assert.ok(Array.isArray(tool.outputTypes), name);
  }
  const chart = tools.find(item => item.name === 'create_chart_artifact');
  assert.deepEqual(chart.parameters.required, ['spec']);
  assert.deepEqual(chart.parameters.properties.spec.required, ['version', 'chart', 'table', 'insights', 'source']);
});

test('preflight rejects invalid arguments with field-level safe details before handler execution', async () => {
  let handlerCalls = 0;
  const registry = new ToolRegistry().register({
    name: 'strict_value', roles: ['student'], inputSchema: z.object({ count: z.number().int().min(1) }).strict(),
    parameters: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false },
    handler: async input => { handlerCalls += 1; return input; },
  });
  const call = { id: 'bad', function: { name: 'strict_value', arguments: '{"count":"one"}' } };
  await assert.rejects(() => preflightTool(registry, call, { user: { role: 'student' }, requestId: 'req-contract' }), error => {
    assert.equal(error.publicCode, 'AI_TOOL_VALIDATION_FAILED');
    assert.equal(error.details.toolName, 'strict_value');
    assert.equal(error.details.argumentPath, 'count');
    assert.equal(error.details.receivedType, 'string');
    assert.equal(error.details.requestId, 'req-contract');
    return true;
  });
  assert.equal(handlerCalls, 0);
});

test('Function Calling emits validation_failed and never emits started before a rejected preflight', async () => {
  const registry = new ToolRegistry().register({
    name: 'strict_value', roles: ['student'], inputSchema: z.object({ count: z.number().int() }).strict(),
    parameters: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false },
    handler: async input => input,
  });
  let round = 0;
  const clientFactory = () => ({ model: 'test', client: { chat: { completions: { create: async () => {
    round += 1;
    if (round === 1) return { choices: [{ message: { content: '', tool_calls: [{ id: 'bad', type: 'function', function: { name: 'strict_value', arguments: '{"count":"one"}' } }] } }] };
    return { choices: [{ message: { content: '已安全降级' } }] };
  } } } } });
  const events = [];
  const result = await new FunctionCallExecutor(registry, { clientFactory }).run({ context: { user: { role: 'student' }, requestId: 'req-preflight' }, messages: [{ role: 'user', content: 'test' }], onEvent: (type, payload) => events.push({ type, payload }) });
  assert.equal(result.content, '已安全降级');
  assert.deepEqual(events.map(item => item.type), ['tool.validation_failed']);
});

test('internal knowledge-base records survive source normalization without a public URL', () => {
  const records = standardizeKnowledgeSources([{
    knowledgeBaseId: 9, knowledgeBaseName: '机器学习知识库', documentId: 12,
    documentName: '机器学习教材.pdf', segmentId: 'seg-1', content: '逻辑回归使用 sigmoid 建模类别概率。', score: 0.91,
  }]);
  const result = normalizeCitations('参考资料 [1]', records);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].sourceType, 'knowledge_base');
  assert.equal(result.sources[0].knowledgeBaseId, 9);
  assert.equal(result.sources[0].url, null);
  assert.deepEqual(result.citations, [1]);
});
