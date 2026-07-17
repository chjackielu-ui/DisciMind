const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  EXECUTION_STATUS,
  mapGraphExecution,
  sanitizePracticeData,
  buildInteraction,
  contentFromState,
  buildNodeDescriptor,
  allowedActions,
} = require('../src/modules/learning-workflow/execution-protocol');
const { normalizeStoredAgentOutput } = require('../src/modules/learning-workflow/agent-result-parser');
const {
  getAgentForNode,
  getDefaultStrategy,
  requiresStudentInteraction,
  agentOutputRequiresInteraction,
} = require('../src/modules/learning-agent/graph/node-dispatcher');
const { createBailianModel } = require('../src/modules/learning-agent/adapters/bailian-model.adapter');

test('learning-agent public entrypoint loads all production modules without a model call', () => {
  const entry = require('../src/modules/learning-agent');
  assert.deepEqual(entry.assertLearningAgentModules(), [
    'runExplainer', 'runTrainer', 'evaluateTrainerAnswer',
    'runDiagnostician', 'invokeGraph', 'resumeGraph',
  ]);
});

test('LangGraph 1.4 interrupt maps to WAITING_INPUT', () => {
  const result = { __interrupt__: [{ id: 'i1', value: { type: 'wait_student', nodeId: 'n2' } }] };
  const execution = mapGraphExecution({ status: 'waiting_student' }, result, { next: ['waitForStudent'], tasks: [] });
  assert.equal(execution.status, EXECUTION_STATUS.WAITING_INPUT);
  assert.equal(execution.requiresStudentInput, true);
  assert.equal(execution.nodeCompleted, false);
});

test('nodeCompleted false is not classified as FAILED', () => {
  const execution = mapGraphExecution({ status: 'running' }, null, { next: ['callAgent'], tasks: [] });
  assert.equal(execution.nodeCompleted, false);
  assert.notEqual(execution.status, EXECUTION_STATUS.FAILED);
});

test('wait_continue maps to a completed node that can advance once', () => {
  const snapshot = { next: ['waitForContinue'], tasks: [{ interrupts: [{ value: { type: 'wait_continue', nodeId: 'n1' } }] }] };
  const execution = mapGraphExecution({ status: 'completed_node' }, null, snapshot);
  assert.equal(execution.status, EXECUTION_STATUS.COMPLETED);
  assert.equal(execution.canContinue, true);
  assert.deepEqual(allowedActions(execution), ['continue', 'skip']);
});

test('Socratic WAITING_INPUT exposes one text-and-image answer composer', () => {
  const execution = {
    status: EXECUTION_STATUS.WAITING_INPUT,
    interrupt: { questionId: 'intro_1', nodeRunId: 53 },
  };
  const interaction = buildInteraction(
    { id: 'n1', type: 'socratic_questioning' },
    { starting_question: '为什么残差平方和越小越好？' },
    execution,
    execution.interrupt,
  );
  assert.equal(interaction.type, 'free_text');
  assert.equal(interaction.allowText, true);
  assert.equal(interaction.allowImages, true);
  assert.equal(interaction.maxImages, 3);
  assert.equal(interaction.submitLabel, '提交回答');
});

test('WAITING_INPUT recovers its composer from persisted Agent output after restart', () => {
  const execution = {
    status: EXECUTION_STATUS.WAITING_INPUT,
    interrupt: { nodeRunId: 53 },
  };
  const content = contentFromState(
    { id: 'n1', type: 'socratic_questioning' },
    null,
    {
      agent_type: 'EXPLAINER',
      output_summary_json: {
        protocolVersion: '1.0',
        agentType: 'explainer',
        contentType: 'explanation',
        data: { starting_question: '请说说你的理解。', guidance_hints: ['先观察变量关系'] },
      },
    },
    execution,
  );
  assert.equal(content.interaction.type, 'free_text');
  assert.equal(content.interaction.nodeRunId, 53);
});

test('practice interaction uses options belonging to the interrupted question', () => {
  const output = {
    questions: [
      { question_id: 'q1', question_type: 'single_choice', options: [{ key: 'A', content: '第一题' }] },
      { question_id: 'q2', question_type: 'single_choice', options: [{ key: 'B', content: '第二题' }] },
    ],
  };
  const execution = { status: EXECUTION_STATUS.WAITING_INPUT };
  const interaction = buildInteraction(
    { type: 'basic_practice' }, output, execution, { questionId: 'q2', nodeRunId: 9 },
  );
  assert.deepEqual(interaction.options, [{ key: 'B', content: '第二题' }]);
});

test('plain concept explanation does not deadlock waiting for nonexistent input', () => {
  const output = { title: '线性回归', sections: [{ heading: '定义', content: '用直线描述变量关系。' }] };
  assert.equal(requiresStudentInteraction('concept_explanation'), false);
  assert.equal(agentOutputRequiresInteraction('concept_explanation', output), false);
});

test('a DAG leaf ends the flow instead of falling back to array order', () => {
  const { resolveNextNodeIds } = require('../src/modules/learning-agent/graph/learning-flow.graph').__test;
  const graph = {
    nodes: [{ id: 'recap' }, { id: 'summary' }],
    edges: [{ id: 'e1', source: 'recap', target: 'summary', condition: { type: 'always', params: {} } }],
  };
  assert.deepEqual(resolveNextNodeIds(graph, 'summary', graph.nodes, 1, {}), []);
  assert.deepEqual(resolveNextNodeIds(graph, 'recap', graph.nodes, 0, {}), ['summary']);
});

test('edge-less legacy workflows still advance sequentially', () => {
  const { resolveNextNodeIds } = require('../src/modules/learning-agent/graph/learning-flow.graph').__test;
  const nodes = [{ id: 'n1' }, { id: 'n2' }];
  assert.deepEqual(resolveNextNodeIds({ nodes, edges: [] }, 'n1', nodes, 0, {}), ['n2']);
});

test('Bailian structured calls disable thinking and use JSON mode without max_tokens', () => {
  const model = createBailianModel({ apiKey: 'unit-test-key', jsonMode: true });
  assert.equal(model.modelKwargs.enable_thinking, false);
  assert.deepEqual(model.modelKwargs.response_format, { type: 'json_object' });
  assert.equal(model.maxTokens, undefined);
});

test('structured Trainer output remains an object', () => {
  const value = { mode: 'basic_practice', questions: [{ question_id: 'q1', stem: '题目' }] };
  assert.strictEqual(normalizeStoredAgentOutput(value), value);
  assert.equal(typeof normalizeStoredAgentOutput(value), 'object');
});

test('historic JSON, markdown fence and branch_result wrappers parse once', () => {
  const historic = { branch_result: '```json\n{"mode":"basic_practice","questions":[]}\n```' };
  assert.deepEqual(normalizeStoredAgentOutput(historic), { mode: 'basic_practice', questions: [] });
});

test('practice response hides answer and analysis until submission', () => {
  const source = {
    mode: 'basic_practice',
    questions: [{ question_id: 'q1', question_type: 'single_choice', stem: '1+1', options: [{ key: 'A', content: '2' }], correct_answer: 'A', analysis: '解析' }],
  };
  const before = sanitizePracticeData(source, []);
  assert.equal(before.questions[0].correct_answer, undefined);
  assert.equal(before.questions[0].analysis, undefined);
  assert.equal(before.questions[0].evaluation, undefined);
  const after = sanitizePracticeData(source, [{ questionId: 'q1', studentAnswer: 'A', correctAnswer: 'A', isCorrect: true, analysis: '解析' }]);
  assert.equal(after.questions[0].evaluation.correctAnswer, 'A');
});

test('node index exposes consistent zero-based and display indexes', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(buildNodeDescriptor({ id: 'b', type: 'basic_practice', title: '练习' }, nodes, null, { status: 'WAITING_INPUT' }), {
    id: 'b', index: 1, displayIndex: 2, total: 3,
    type: 'basic_practice', title: '练习', status: 'WAITING_INPUT',
  });
});

test('exam sprint diagnosis and summary route to dedicated modes', () => {
  assert.equal(getAgentForNode('wrong_question_repair'), 'diagnostician');
  assert.equal(getDefaultStrategy('wrong_question_repair'), 'wrong_question_diagnosis');
  assert.equal(getAgentForNode('learning_summary'), 'diagnostician');
  assert.equal(getDefaultStrategy('learning_summary'), 'learning_summary');
});

test('production learning page has no generic raw JSON timeline renderer', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/student-learning-session.js'), 'utf8');
  assert.doesNotMatch(source, /timeline-card-body[^\n]*JSON\.stringify\(data\)/);
  assert.match(source, /content\.contentType === 'practice'/);
  assert.match(source, /execution\?\.status === 'WAITING_INPUT'/);
});

test('internal module paths are never returned as user-facing errors', () => {
  const graph = require('../src/modules/learning-agent/graph/learning-flow.graph');
  const safe = graph.__test.safeError(new Error("Cannot find module 'E:\\\\DisciMind\\\\secret.js'"));
  assert.equal(safe.message, '学习内容暂时生成失败，请重新尝试或跳过当前节点。');
  assert.doesNotMatch(safe.message, /DisciMind|Require stack|MODULE_NOT_FOUND/);
});
