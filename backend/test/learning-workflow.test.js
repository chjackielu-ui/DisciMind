// 学习流系统测试
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

const {
  ALLOWED_NODE_TYPES,
  ALLOWED_CONDITION_TYPES,
  validateGraphJson,
  detectCycle,
  evaluateCondition,
  sanitizeGraphJson,
  sanitizeSettingsJson,
  validateSettingsJson,
  NODE_TO_AGENT,
  getNextNodeIds,
  MAX_NODES,
  MAX_EDGES,
} = require('../src/modules/learning-workflow/workflow-schema');
const {
  toCompletionMode,
  toAdjustmentMode,
  getPracticeConfig,
  currentRunForSession,
} = require('../src/modules/learning-workflow/workflow-runtime.service');
const {
  normalizePracticeConfig,
  shouldCompleteTrainerNode,
} = require('../src/modules/agent/trainer/trainer.service');
const { normalizeWorkflowNodeType } = require('../src/modules/learning-workflow/workflow-node-type');

// Valid test graph
function makeValidGraph() {
  return {
    entryNodeId: 'n1',
    nodes: [
      { id: 'n1', type: 'concept_explanation', title: '概念讲解', config: {}, position: { x: 0, y: 0 } },
      { id: 'n2', type: 'basic_practice', title: '练习', config: {}, position: { x: 0, y: 100 } },
      { id: 'n3', type: 'learning_summary', title: '总结', config: {}, position: { x: 0, y: 200 } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', condition: { type: 'always', params: {} } },
      { id: 'e2', source: 'n2', target: 'n3', condition: { type: 'always', params: {} } },
    ],
  };
}

// -------- DAG Validation --------

describe('workflow-schema DAG validation', () => {

  it('valid graph passes validation', () => {
    const result = validateGraphJson(makeValidGraph());
    assert.strictEqual(result.valid, true, result.errors?.join(', '));
  });

  it('detects cycle in graph', () => {
    const graph = makeValidGraph();
    graph.edges.push({ id: 'e3', source: 'n3', target: 'n1', condition: { type: 'always' } });
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('循环')));
  });

  it('rejects duplicate links between the same nodes', () => {
    const graph = makeValidGraph();
    graph.edges.push({ id: 'e3', source: 'n1', target: 'n2', condition: { type: 'answer_correct', params: {} } });
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('重复连线')));
  });

  it('rejects missing entryNodeId', () => {
    const graph = makeValidGraph();
    graph.entryNodeId = '';
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
  });

  it('rejects empty nodes', () => {
    const result = validateGraphJson({ entryNodeId: 'x', nodes: [], edges: [] });
    assert.strictEqual(result.valid, false);
  });

  it('rejects unknown node type', () => {
    const graph = makeValidGraph();
    graph.nodes.push({ id: 'nx', type: 'evil_code', title: 'bad', config: {}, position: {} });
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('evil_code')));
  });

  it('rejects unknown condition type', () => {
    const graph = makeValidGraph();
    graph.edges[0].condition.type = 'eval_expression';
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
  });

  it('rejects custom expression in condition', () => {
    const graph = makeValidGraph();
    graph.edges[0].condition.expression = '1+1';
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
  });

  it('rejects eval field in condition', () => {
    const graph = makeValidGraph();
    graph.edges[0].condition.eval = 'user.isAdmin';
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
  });

  it('rejects unreachable nodes', () => {
    const graph = makeValidGraph();
    graph.nodes.push({ id: 'n_orphan', type: 'concept_explanation', title: 'orphan', config: {}, position: {} });
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
  });

  it('rejects graph with no end nodes (all nodes have outgoing edges)', () => {
    const graph = {
      entryNodeId: 'n1',
      nodes: [
        { id: 'n1', type: 'concept_explanation', title: 'a', config: {}, position: {} },
        { id: 'n2', type: 'concept_explanation', title: 'b', config: {}, position: {} },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', condition: { type: 'always', params: {} } },
        { id: 'e2', source: 'n2', target: 'n1', condition: { type: 'always', params: {} } },
      ],
    };
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
  });

  it('rejects exceeding max nodes', () => {
    const graph = { entryNodeId: 'n0', nodes: [], edges: [] };
    for (let i = 0; i <= MAX_NODES; i++) {
      graph.nodes.push({ id: `n${i}`, type: 'concept_explanation', title: `n${i}`, config: {}, position: {} });
    }
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
  });

  it('rejects exceeding max edges', () => {
    const graph = { entryNodeId: 'n0', nodes: [{ id: 'n0', type: 'concept_explanation', title: 'a', config: {}, position: {} }], edges: [] };
    for (let i = 0; i <= MAX_EDGES; i++) {
      graph.edges.push({ id: `e${i}`, source: 'n0', target: 'n0', condition: { type: 'always', params: {} } });
    }
    const result = validateGraphJson(graph);
    assert.strictEqual(result.valid, false);
  });

});

// -------- Condition evaluation --------

describe('workflow-schema condition evaluation', () => {

  it('always returns true', () => {
    assert.strictEqual(evaluateCondition({ type: 'always' }, {}), true);
  });

  it('mastery_gte evaluates correctly', () => {
    assert.strictEqual(evaluateCondition({ type: 'mastery_gte', params: { threshold: 80 } }, { mastery: 85 }), true);
    assert.strictEqual(evaluateCondition({ type: 'mastery_gte', params: { threshold: 80 } }, { mastery: 70 }), false);
  });

  it('mastery_lt evaluates correctly', () => {
    assert.strictEqual(evaluateCondition({ type: 'mastery_lt', params: { threshold: 80 } }, { mastery: 70 }), true);
    assert.strictEqual(evaluateCondition({ type: 'mastery_lt', params: { threshold: 80 } }, { mastery: 90 }), false);
  });

  it('answer_correct evaluates correctly', () => {
    assert.strictEqual(evaluateCondition({ type: 'answer_correct' }, { lastAnswerCorrect: true }), true);
    assert.strictEqual(evaluateCondition({ type: 'answer_correct' }, { lastAnswerCorrect: false }), false);
  });

  it('consecutive_wrong_gte evaluates correctly', () => {
    assert.strictEqual(evaluateCondition({ type: 'consecutive_wrong_gte', params: { threshold: 3 } }, { consecutiveWrong: 4 }), true);
    assert.strictEqual(evaluateCondition({ type: 'consecutive_wrong_gte', params: { threshold: 3 } }, { consecutiveWrong: 1 }), false);
  });

  it('accuracy_gte evaluates correctly', () => {
    assert.strictEqual(evaluateCondition({ type: 'accuracy_gte', params: { threshold: 70 } }, { accuracy: 75 }), true);
    assert.strictEqual(evaluateCondition({ type: 'accuracy_gte', params: { threshold: 70 } }, { accuracy: 50 }), false);
  });

});

// -------- Next node selection --------

describe('workflow-schema getNextNodeIds', () => {

  it('returns next node for always edge', () => {
    const graph = makeValidGraph();
    const next = getNextNodeIds(graph, 'n1', {});
    assert.deepStrictEqual(next, ['n2']);
  });

  it('returns conditional edge target when condition matches', () => {
    const graph = makeValidGraph();
    graph.edges = [
      { id: 'e1', source: 'n1', target: 'n2', condition: { type: 'mastery_gte', params: { threshold: 80 } } },
      { id: 'e2', source: 'n1', target: 'n3', condition: { type: 'always', params: {} } },
    ];
    const next = getNextNodeIds(graph, 'n1', { mastery: 90 });
    assert.deepStrictEqual(next, ['n2']);
  });

  it('falls back to always when condition fails', () => {
    const graph = makeValidGraph();
    graph.edges = [
      { id: 'e1', source: 'n1', target: 'n2', condition: { type: 'mastery_gte', params: { threshold: 80 } } },
      { id: 'e2', source: 'n1', target: 'n3', condition: { type: 'always', params: {} } },
    ];
    const next = getNextNodeIds(graph, 'n1', { mastery: 50 });
    assert.deepStrictEqual(next, ['n3']);
  });

  it('returns empty for leaf node', () => {
    const graph = makeValidGraph();
    const next = getNextNodeIds(graph, 'n3', {});
    assert.deepStrictEqual(next, []);
  });

});

// -------- Settings validation --------

describe('workflow-schema settings validation', () => {

  it('valid settings pass', () => {
    assert.strictEqual(validateSettingsJson({ completion_mode: 'flow_complete', target_mastery: 80 }).valid, true);
  });

  it('rejects invalid completion_mode', () => {
    assert.strictEqual(validateSettingsJson({ completion_mode: 'invalid' }).valid, false);
  });

  it('rejects out-of-range target_mastery', () => {
    assert.strictEqual(validateSettingsJson({ target_mastery: 150 }).valid, false);
    assert.strictEqual(validateSettingsJson({ target_mastery: 30 }).valid, false);
  });

});

describe('workflow runtime enum mapping', () => {
  it('maps API settings values to Prisma enum values', () => {
    assert.strictEqual(toCompletionMode('mastery_target'), 'MASTERY_TARGET');
    assert.strictEqual(toAdjustmentMode('ask_before_adjust'), 'ASK_BEFORE_ADJUST');
  });

  it('rejects invalid session enum values', () => {
    assert.throws(() => toCompletionMode('unexpected'), /完成方式/);
    assert.throws(() => toAdjustmentMode('unexpected'), /调整方式/);
  });
});

describe('practice node exit policy', () => {
  it('uses centralized compatible defaults for old workflow nodes', () => {
    const config = getPracticeConfig({});
    assert.deepStrictEqual(config, {
      targetQuestionCount: 5,
      minQuestionCount: 3,
      maxQuestionCount: 8,
      targetMastery: 80,
      consecutiveCorrectToFinish: 3,
      allowSkip: true,
      difficultyMode: 'adaptive',
      exitMode: 'target_or_mastery_or_streak',
    });
  });

  it('clamps invalid counts so maxQuestionCount remains a hard upper bound', () => {
    const config = normalizePracticeConfig({
      targetQuestionCount: 5,
      minQuestionCount: 99,
      maxQuestionCount: 2,
      consecutiveCorrectToFinish: 99,
    });
    assert.strictEqual(config.minQuestionCount, 5);
    assert.strictEqual(config.maxQuestionCount, 5);
    assert.strictEqual(config.consecutiveCorrectToFinish, 5);
  });

  it('completes at the target question count', () => {
    const result = shouldCompleteTrainerNode({
      answeredCount: 5, targetQuestionCount: 5, minQuestionCount: 3, maxQuestionCount: 8,
      consecutiveCorrect: 1, currentMastery: 60, targetMastery: 80, consecutiveCorrectToFinish: 3,
    });
    assert.deepStrictEqual(result, { shouldComplete: true, reason: 'target_questions_reached' });
  });

  it('forces completion at the max count before any further generation', () => {
    const result = shouldCompleteTrainerNode({
      answeredCount: 8, targetQuestionCount: 9, minQuestionCount: 3, maxQuestionCount: 8,
      consecutiveCorrect: 0, currentMastery: 20, targetMastery: 80, consecutiveCorrectToFinish: 3,
    });
    assert.deepStrictEqual(result, { shouldComplete: true, reason: 'max_questions_reached' });
  });

  it('allows early completion after minimum count through mastery or correct streak', () => {
    const mastery = shouldCompleteTrainerNode({
      answeredCount: 3, targetQuestionCount: 5, minQuestionCount: 3, maxQuestionCount: 8,
      consecutiveCorrect: 1, currentMastery: 82, targetMastery: 80, consecutiveCorrectToFinish: 3,
    });
    const streak = shouldCompleteTrainerNode({
      answeredCount: 3, targetQuestionCount: 5, minQuestionCount: 3, maxQuestionCount: 8,
      consecutiveCorrect: 3, currentMastery: 60, targetMastery: 80, consecutiveCorrectToFinish: 3,
    });
    assert.strictEqual(mastery.reason, 'target_mastery_reached');
    assert.strictEqual(streak.reason, 'consecutive_correct_reached');
  });

  it('selects the current node execution by pointer rather than an older run', () => {
    const run = currentRunForSession({
      current_node_id: 'practice',
      current_node_run_id: 22,
      node_runs: [
        { node_run_id: 11, node_id: 'practice', status: 'SKIPPED' },
        { node_run_id: 22, node_id: 'practice', status: 'RUNNING' },
      ],
    });
    assert.strictEqual(run.node_run_id, 22);
  });
});

describe('WorkflowNodeType normalization', () => {
  it('maps basic_practice and its case/style aliases to BASIC_PRACTICE', () => {
    assert.strictEqual(normalizeWorkflowNodeType('basic_practice'), 'BASIC_PRACTICE');
    assert.strictEqual(normalizeWorkflowNodeType('BASIC_PRACTICE'), 'BASIC_PRACTICE');
    assert.strictEqual(normalizeWorkflowNodeType('basic-practice'), 'BASIC_PRACTICE');
    assert.strictEqual(normalizeWorkflowNodeType('basicPractice'), 'BASIC_PRACTICE');
  });

  it('maps documented historical aliases to the actual schema enum', () => {
    assert.strictEqual(normalizeWorkflowNodeType('example_analysis'), 'WORKED_EXAMPLE_ANALYSIS');
    assert.strictEqual(normalizeWorkflowNodeType('error_repair'), 'WRONG_QUESTION_REPAIR');
    assert.strictEqual(normalizeWorkflowNodeType('mastery_assessment'), 'MASTERY_GATE');
  });

  it('rejects unsupported graph types with a safe workflow error', () => {
    assert.throws(
      () => normalizeWorkflowNodeType('timed_assessment', { nodeId: 'node_2', sessionId: 6 }),
      (err) => err.code === 'INVALID_WORKFLOW_NODE_TYPE'
        && err.data.nodeId === 'node_2'
        && err.data.rawNodeType === 'timed_assessment'
        && !String(err.message).includes('prisma.'),
    );
  });
});

// -------- Sanitize --------

describe('workflow-schema sanitization', () => {

  it('sanitizeGraphJson strips extra fields', () => {
    const graph = makeValidGraph();
    graph._evil = 'bad';
    const cleaned = sanitizeGraphJson(graph);
    assert.strictEqual(cleaned._evil, undefined);
  });

  it('sanitizeSettingsJson applies defaults', () => {
    const cleaned = sanitizeSettingsJson({});
    assert.strictEqual(cleaned.completion_mode, 'flow_complete');
    assert.strictEqual(cleaned.target_mastery, 80);
  });

});

// -------- Node-to-Agent mapping --------

describe('NODE_TO_AGENT mapping', () => {

  it('concept_explanation maps to EXPLAINER', () => {
    assert.strictEqual(NODE_TO_AGENT.concept_explanation.agent, 'EXPLAINER');
  });

  it('basic_practice maps to TRAINER', () => {
    assert.strictEqual(NODE_TO_AGENT.basic_practice.agent, 'TRAINER');
  });

  it('learning_summary maps to DIAGNOSTICIAN', () => {
    assert.strictEqual(NODE_TO_AGENT.learning_summary.agent, 'DIAGNOSTICIAN');
  });

  it('mastery_gate has no agent', () => {
    assert.strictEqual(NODE_TO_AGENT.mastery_gate.agent, null);
  });

  it('all allowed node types have mappings', () => {
    for (const type of ALLOWED_NODE_TYPES) {
      assert.ok(NODE_TO_AGENT[type] !== undefined, `Missing mapping for ${type}`);
    }
  });

});

// -------- Cycle detection --------

describe('detectCycle', () => {

  it('returns empty for DAG', () => {
    const result = detectCycle(makeValidGraph());
    assert.deepStrictEqual(result, []);
  });

  it('detects simple cycle', () => {
    const graph = makeValidGraph();
    graph.edges.push({ id: 'e3', source: 'n3', target: 'n1', condition: { type: 'always' } });
    const result = detectCycle(graph);
    assert.ok(result.length > 0, 'Should detect cycle nodes');
  });

  it('detects self-loop', () => {
    const graph = makeValidGraph();
    graph.edges.push({ id: 'e3', source: 'n2', target: 'n2', condition: { type: 'always' } });
    const result = detectCycle(graph);
    assert.ok(result.includes('n2'));
  });

});
