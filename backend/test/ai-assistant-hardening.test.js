const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const {
  decideSearch, parseSearchOptions, cropSearchOptions, buildDashScopeParameters,
} = require('../src/modules/ai-assistant/search-policy');
const { normalizeCitations, normalizeSources } = require('../src/modules/ai-assistant/citation-normalizer');
const { StreamEventFactory } = require('../src/modules/ai-assistant/stream-event.service');
const { DashScopeSearchClient } = require('../src/modules/ai-assistant/dashscope-search.client');
const { ToolRegistry } = require('../src/modules/ai-assistant/tool-registry');
const { FunctionCallExecutor, executeTool } = require('../src/modules/ai-assistant/function-call-executor');
const { createPlan } = require('../src/modules/ai-assistant/workflow-planner');
const {
  resolveAgentExecutionMode,
  buildAgentSteps,
  serialAgentQuery,
  contextQueryForPlan,
  fileCapabilityResponse,
  normalizeKnowledgeBaseIds,
  normalizePrefetchedKnowledgeSources,
  mergeRetrievalSources,
} = require('../src/modules/ai-assistant/assistant-orchestrator.service');
const { retrievalKnowledgeBases } = require('../src/modules/agent-chat/agent-context.service');
const { staticCapabilities } = require('../src/modules/ai-assistant/capability.service');
const { createXlsx } = require('../src/modules/ai-assistant/simple-xlsx');
const agentRuntime = require('../src/modules/agent-chat/agent-runtime.service');
const { classifyLearningIntent, detectFileIntent, INTENTS } = require('../src/modules/ai-assistant/intent-router.service');
const { chartSpecSchema, buildChartSpec } = require('../src/modules/ai-assistant/chart-spec');
const { buildRegistry } = require('../src/modules/ai-assistant/tool-handlers.service');
const { capabilityMetadata } = require('../src/modules/ai-assistant/agent-registry.service');
const { effectiveFileRequest, artifactPreviewUrl } = require('../src/modules/ai-assistant/pending-action.service');

test('search policy distinguishes OFF, AUTO realtime, and FORCE', () => {
  assert.equal(decideSearch('解释闭包', { mode: 'off' }).enabled, false);
  assert.equal(decideSearch('今天北京天气如何', { mode: 'auto' }).enabled, true);
  assert.equal(decideSearch('解释闭包', { mode: 'auto' }).enabled, false);
  assert.deepEqual(decideSearch('解释闭包', { mode: 'force' }), { enabled: true, forced: true, realtime: false, reason: 'forced' });
});

test('explicit knowledge bases are a forced allow-list with stable source merging', () => {
  assert.deepEqual(normalizeKnowledgeBaseIds([11, { knowledgeBaseId: 11 }, { knowledge_base_id: 12 }, 0, 'bad']), [11, 12]);
  const explicit = [{ knowledge_base_id: 11 }];
  const bound = [{ knowledge_base_id: 7 }];
  assert.deepEqual(retrievalKnowledgeBases(explicit, bound), explicit);
  const prefetched = normalizePrefetchedKnowledgeSources([{ title: '手册', snippet: '学分模块', knowledgeBaseId: 11 }]);
  const merged = mergeRetrievalSources(prefetched, [
    { title: '手册', snippet: '学分模块', knowledgeBaseId: 11 },
    { title: '手册', snippet: '毕业条件', knowledgeBaseId: 11, segmentId: 'seg-2' },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(item => item.index), [1, 2]);
});

test('unsupported qwen3.7 advanced search options are cropped, never sent blindly', () => {
  const capabilities = staticCapabilities('qwen3.7-plus');
  const built = buildDashScopeParameters({
    mode: 'force', strategy: 'agent', freshness: 7, assignedSiteList: ['example.com'],
    promptIntervene: '仅搜索权威来源', enableTextImageMixed: true,
  }, capabilities);
  assert.equal(built.effective.strategy, 'turbo');
  assert.equal(built.effective.freshness, null);
  assert.deepEqual(built.effective.assignedSiteList, []);
  assert.equal(built.parameters.search_options.forced_search, true);
  assert.equal('freshness' in built.parameters.search_options, false);
  assert.equal('enable_text_image_mixed' in built.parameters, false);
  assert.ok(built.omitted.length >= 5);
});

test('site list validation accepts domains and rejects non-http schemes', () => {
  assert.deepEqual(parseSearchOptions({ assignedSiteList: ['https://www.example.com/path'] }).assignedSiteList, ['example.com']);
  assert.throws(() => parseSearchOptions({ assignedSiteList: ['javascript:alert(1)'] }), /来源站点/);
});

test('citation normalizer preserves code, math, and markdown links', () => {
  const answer = '结论 [1]\n\n`code[1]`\n\n$y=[1]$\n\n[链接[1]](https://example.com)\n\n缺失 [9]';
  const result = normalizeCitations(answer, [{ index: 1, title: '来源', url: 'https://example.com/a' }]);
  assert.match(result.text, /结论 \[ref_1\]/);
  assert.match(result.text, /`code\[1\]`/);
  assert.match(result.text, /\$y=\[1\]\$/);
  assert.match(result.text, /\[链接\[1\]\]\(https:\/\/example.com\)/);
  assert.deepEqual(result.citations, [1]);
  assert.deepEqual(result.missing, [9]);
});

test('source normalization drops unsafe URLs and deduplicates indices', () => {
  const sources = normalizeSources([
    { index: 1, title: 'A', url: 'https://a.example/x' },
    { index: 1, title: 'B', url: 'https://b.example/x' },
    { index: 3, title: 'bad', url: 'javascript:alert(1)' },
  ]);
  assert.deepEqual(sources.map(item => item.index), [1, 2]);
  assert.equal(sources.length, 2);
});

test('versioned stream events are monotonic', () => {
  const factory = new StreamEventFactory('run-1', { clock: () => new Date('2026-07-15T00:00:00.000Z') });
  const first = factory.create('run.started'); const second = factory.create('answer.delta', { content: 'a' });
  assert.equal(first.version, '1.0'); assert.equal(first.sequence, 1); assert.equal(second.sequence, 2);
  assert.throws(() => factory.create('unknown.event'), /未知 AI 流事件/);
});

test('DashScope native stream emits sources before answer and verifies search execution', async () => {
  const frames = [
    { request_id: 'req-1', output: { search_info: { search_results: [{ index: 1, title: '实时来源', url: 'https://example.com/news' }] }, choices: [{ message: { content: '' } }] } },
    { request_id: 'req-1', output: { choices: [{ message: { content: '实时答案 [ref_1]' } }] }, usage: { plugins: { search: { count: 1 } } } },
  ];
  const body = frames.map(frame => `data:${JSON.stringify(frame)}\n\n`).join('');
  const client = new DashScopeSearchClient({
    config: { apiKey: 'test-key', baseURL: 'https://example.com/compatible-mode/v1', model: 'qwen3.7-plus' },
    fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  });
  const events = [];
  for await (const event of client.stream({ messages: [{ role: 'user', content: '今天新闻' }], searchOptions: { mode: 'force' }, capabilities: staticCapabilities('qwen3.7-plus') })) events.push(event);
  assert.equal(events[0].type, 'sources');
  assert.equal(events.find(item => item.type === 'delta').content, '实时答案 [ref_1]');
  assert.equal(events.at(-1).searchOccurred, true);
});

test('forced search fails when upstream silently skips search', async () => {
  const frame = { request_id: 'req-2', output: { choices: [{ message: { content: '未搜索' } }] }, usage: {} };
  const client = new DashScopeSearchClient({
    config: { apiKey: 'test-key', baseURL: 'https://example.com/compatible-mode/v1', model: 'qwen3.7-plus' },
    fetchImpl: async () => new Response(`data:${JSON.stringify(frame)}\n\n`, { status: 200 }),
  });
  await assert.rejects(async () => {
    for await (const event of client.stream({ messages: [{ role: 'user', content: '新闻' }], searchOptions: { mode: 'force' }, capabilities: staticCapabilities('qwen3.7-plus') })) void event;
  }, error => error.publicCode === 'AI_SEARCH_NOT_TRIGGERED');
});

test('tool registry enforces role, validation, timeout metadata, and duplicate-loop guard', async () => {
  const registry = new ToolRegistry().register({
    name: 'read_teacher_data', description: 'read', roles: ['teacher'], inputSchema: z.object({ id: z.number().int() }),
    parameters: { type: 'object', properties: { id: { type: 'integer' } } }, handler: async input => ({ id: input.id }),
  });
  const call = { id: 'c1', function: { name: 'read_teacher_data', arguments: '{"id":1}' } };
  await assert.rejects(() => executeTool(registry, call, { user: { role: 'student' } }), error => error.status === 403);
  const seen = new Set();
  const first = await executeTool(registry, call, { user: { role: 'teacher' } }, { seen });
  assert.deepEqual(first.result, { id: 1 });
  await assert.rejects(() => executeTool(registry, call, { user: { role: 'teacher' } }, { seen }), error => error.publicCode === 'AI_WORKFLOW_LOOP');

  const writeRegistry = new ToolRegistry().register({
    name: 'write_artifact', description: 'write', roles: ['student'], requiresConfirmation: true,
    inputSchema: z.object({ title: z.string() }), parameters: { type: 'object', properties: { title: { type: 'string' } } },
    handler: async input => ({ title: input.title }),
  });
  const writeCall = { id: 'w1', function: { name: 'write_artifact', arguments: '{"title":"safe"}' } };
  await assert.rejects(() => executeTool(writeRegistry, writeCall, { user: { role: 'student' } }), error => error.status === 409 && error.details?.requiresConfirmation === true);
  const confirmed = await executeTool(writeRegistry, writeCall, { user: { role: 'student' }, confirmed: true });
  assert.deepEqual(confirmed.result, { title: 'safe' });
});

test('Function Calling supports multiple calls then final answer', async () => {
  const registry = new ToolRegistry().register({
    name: 'echo_value', description: 'echo', roles: ['student'], inputSchema: z.object({ value: z.string() }),
    parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] }, handler: async input => ({ echoed: input.value }),
  });
  let round = 0;
  const clientFactory = () => ({ model: 'qwen3.7-plus', client: { chat: { completions: { create: async () => {
    round += 1;
    if (round === 1) return { choices: [{ message: { content: '', tool_calls: [
      { id: 'a', type: 'function', function: { name: 'echo_value', arguments: '{"value":"one"}' } },
      { id: 'b', type: 'function', function: { name: 'echo_value', arguments: '{"value":"two"}' } },
    ] } }] };
    return { choices: [{ message: { content: '完成' } }], usage: { total_tokens: 12 } };
  } } } } });
  const result = await new FunctionCallExecutor(registry, { clientFactory }).run({ messages: [{ role: 'user', content: 'echo' }], context: { user: { role: 'student' } } });
  assert.equal(result.content, '完成'); assert.equal(result.calls.length, 2); assert.equal(result.usage.total_tokens, 12);
});

test('workflow planner prioritizes realtime research and high-risk artifact confirmation skill', () => {
  const plan = createPlan({ query: '请搜索今天最新政策并生成 Excel 表格', role: 'teacher', searchOptions: { mode: 'auto' } });
  assert.equal(plan.intent.search.enabled, true);
  assert.ok(plan.skills.some(skill => skill.id === 'spreadsheet_generation'));
  assert.equal(plan.steps[0].type, 'search');
});

test('multi-agent planning persists serial dependencies and independent parallel branches', () => {
  const selected = [
    { agent: { id: 11 }, version: { name: 'Agent A' } },
    { agent: { id: 22 }, version: { name: 'Agent B' } },
  ];
  assert.equal(resolveAgentExecutionMode({}, '请并行分析两个独立方向'), 'parallel');
  assert.equal(resolveAgentExecutionMode({ agentExecutionMode: 'serial' }, '请并行分析'), 'serial');
  const serial = buildAgentSteps(selected, 'serial');
  const parallel = buildAgentSteps(selected, 'parallel');
  assert.deepEqual(serial[0].dependsOn, []); assert.deepEqual(serial[1].dependsOn, [serial[0].id]);
  assert.ok(serial[1].inputFromPrevious); assert.deepEqual(parallel.flatMap(step => step.dependsOn), []);
  const chained = serialAgentQuery('原始任务', [{ agentName: 'Agent A', content: '真实上游输出' }]);
  assert.match(chained, /真实上游输出/); assert.match(chained, /原始任务/);
});

test('historical Dify runtime labels execute through the local LangChain model', async () => {
  const originalFetch = global.fetch;
  const controller = new AbortController();
  let captured;
  try {
    global.fetch = async () => { throw new Error('historical provider must not call Dify'); };
    const result = await agentRuntime.runAgent({
      version: { runtimeProvider: 'DIFY_CHATFLOW', runtimeConfigJson: {}, systemPrompt: '你是学习助手', maxOutputTokens: 500 },
      userId: 3, conversation: { difyConversationId: null }, history: [], memories: [],
      question: '解释逻辑回归', records: [], images: [], signal: controller.signal,
    }, async (messages, options) => {
      captured = { messages, options };
      return { content: 'LangChain success', usage: {} };
    });
    assert.equal(result.content, 'LangChain success');
    assert.equal(captured.options.signal, controller.signal);
    assert.match(captured.messages.at(-1).content, /逻辑回归/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('minimal XLSX generator produces a valid OOXML ZIP package', () => {
  const buffer = createXlsx([['姓名', '分数'], ['张三', 95]], '成绩');
  assert.deepEqual([...buffer.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(buffer.includes(Buffer.from('[Content_Types].xml')));
  assert.ok(buffer.includes(Buffer.from('xl/worksheets/sheet1.xml')));
  assert.ok(buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) > 0);
});

test('owner-bound learning intents use authenticated tools and never route to file generation', () => {
  const wrong = classifyLearningIntent('查看我最近的错题，不要问学号', 'student');
  assert.equal(wrong.kind, INTENTS.WRONG);
  assert.deepEqual(wrong.tools, ['get_student_wrong_questions']);
  const score = createPlan({ query: '分析我最近一个月成绩变化', role: 'student', searchOptions: { mode: 'auto' } });
  assert.equal(score.intent.kind, INTENTS.SCORE);
  assert.equal(score.intent.search.enabled, false);
  assert.ok(score.steps.some(step => step.tool === 'get_student_score_trend'));
  assert.equal(score.steps.some(step => step.type === 'model'), false);
});

test('file intent distinguishes downloadable output from chat-only preview', () => {
  assert.equal(detectFileIntent('帮我生成一份机器学习期末试卷').matched, true);
  assert.equal(detectFileIntent('只在对话中展示试卷，不要生成文件').matched, false);
  const plan = createPlan({ query: '生成一份 PDF 试卷', role: 'student', searchOptions: { mode: 'off' } });
  assert.equal(plan.intent.kind, INTENTS.FILE);
  assert.ok(plan.steps.some(step => step.type === 'confirmation'));
});

test('file capability questions never create tasks or reuse historical requirements', () => {
  for (const query of ['你可以生成文件吗', '你能生成 PDF 吗', '支持生成哪些文件格式', '请问你可以生成文件吗']) {
    const detected = detectFileIntent(query);
    assert.equal(detected.matched, false, query);
    assert.equal(detected.capabilityQuestion, true, query);
    const plan = createPlan({ query, role: 'teacher', searchOptions: { mode: 'auto' } });
    assert.equal(plan.intent.kind, INTENTS.FILE_CAPABILITY, query);
    assert.equal(plan.intent.executionMode, 'DIRECT_RESPONSE', query);
    assert.equal(plan.steps.some(step => step.type === 'confirmation' || step.type === 'tool'), false, query);
    assert.equal(contextQueryForPlan(query, [{ role: 'user', content: '请生成一份历史试卷' }], plan), query);
  }
  assert.equal(detectFileIntent('你能不能帮我生成一份逻辑回归讲义').matched, true);
  assert.equal(detectFileIntent('请生成 PDF').matched, true);
  assert.match(fileCapabilityResponse('teacher'), /不会创建生成任务/);
  assert.match(fileCapabilityResponse('teacher'), /不会沿用或输出历史对话/);
});

test('pending artifact links stay in the current role portal', () => {
  assert.equal(artifactPreviewUrl('teacher', 696), '#/teacher/artifacts/696');
  assert.equal(artifactPreviewUrl('admin', 696), '#/teacher/artifacts/696');
  assert.equal(artifactPreviewUrl('student', 696), '#/student/artifacts/696');
});

test('async task result links accept the role-aware artifact route', () => {
  const tasks = require('../src/modules/async-task/async-task.service');
  assert.equal(tasks.sanitizeResultUrl('#/artifacts/696?format=DOCX'), '#/artifacts/696?format=DOCX');
  assert.equal(tasks.sanitizeResultUrl('#/teacher/artifacts/696'), '#/teacher/artifacts/696');
});

test('multi-turn file request keeps the original requirement when the user supplies a missing course', () => {
  const original = '帮我生成一份机器学习逻辑回归教学讲义，输出 PDF。文件备注：验收标记';
  const followup = '课程选择：机器学习。请继续按上一条要求生成 PDF 文件。';
  const merged = effectiveFileRequest(followup, [
    { role: 'user', content: original },
    { role: 'assistant', content: '请选择要生成文件的课程。' },
    { role: 'user', content: followup },
  ]);
  assert.match(merged, /逻辑回归教学讲义/);
  assert.match(merged, /验收标记/);
  assert.match(merged, /课程选择：机器学习/);
  const contextQuery = contextQueryForPlan(followup, [
    { role: 'user', content: original },
    { role: 'assistant', content: '请选择要生成文件的课程。' },
    { role: 'user', content: followup },
  ], { intent: { kind: INTENTS.FILE } });
  assert.match(contextQuery, /逻辑回归/);
});

test('student registry exposes all eight owner-bound tools without student identity parameters', () => {
  const tools = buildRegistry().describe({ user: { role: 'student' } });
  const expected = [
    'get_current_student_context', 'get_student_wrong_questions', 'get_student_learning_records',
    'get_student_score_trend', 'get_student_mastery', 'get_student_recent_sessions',
    'get_student_learning_time', 'get_student_task_completion',
  ];
  expected.forEach(name => {
    const tool = tools.find(item => item.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.equal(Object.hasOwn(tool.parameters?.properties || {}, 'studentUserId'), false);
  });
  assert.equal(tools.some(item => item.name === 'student_learning_profile'), false);
});

test('ChartSpec 1.0 enforces chart/source/table contracts and aligned series', () => {
  const spec = buildChartSpec('get_student_score_trend', {
    no_data: false,
    range: { label: '最近 30 天', start: '2026-06-15T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z' },
    metricDefinition: '得分率定义', source: { label: '真实成绩记录' },
    points: [{ label: '07/01', title: '练习', scoreRate: 72, sourceType: '练习' }],
  });
  assert.equal(spec.version, '1.0');
  assert.equal(spec.chart.unit, '%');
  assert.throws(() => chartSpecSchema.parse({ ...spec, chart: { ...spec.chart, series: [{ name: '错误', data: [] }] } }), /横轴|xAxis|数量/);
});

test('Agent metadata separates content agents from artifact generators', () => {
  const content = capabilityMetadata({ agentType: 'CHAT' }, { capabilitiesJson: ['题目生成'], runtimeProvider: 'MODEL' });
  const file = capabilityMetadata({ agentType: 'FILE_GENERATOR' }, { capabilitiesJson: ['试卷生成'], fileGeneratorConfigJson: { documentType: 'EXAM_PAPER' } });
  assert.equal(content.canGenerateArtifact, false);
  assert.ok(content.preferredIntents.includes('chat_question_generation'));
  assert.ok(Array.isArray(content.forbiddenIntents));
  assert.equal(file.canGenerateArtifact, true);
  assert.deepEqual(file.supportedArtifactTypes, ['EXAM_PAPER']);
});
