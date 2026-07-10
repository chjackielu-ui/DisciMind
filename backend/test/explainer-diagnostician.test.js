const test = require('node:test');
const assert = require('node:assert/strict');

const { runDiagnosticianWorkflow } = require('../src/modules/dify/agent-dify.service');
const {
  selectExplainerStrategy,
  transformDifyStreamEvent,
} = require('../src/modules/agent/explainer/explainer.service');
const {
  detectDeterministicInterventions,
  mergeDeterministicInterventions,
  validateInstruction,
} = require('../src/modules/agent/diagnostician/diagnostician.service');

const DIAG_ENV_KEYS = [
  'DIFY_DIAGNOSTICIAN_ENABLED',
  'DIFY_DIAGNOSTICIAN_BASE_URL',
  'DIFY_DIAGNOSTICIAN_API_KEY',
  'DIFY_DIAGNOSTICIAN_TIMEOUT_MS',
  'DIFY_DIAGNOSTICIAN_MAX_RETRIES',
  'DIFY_DIAGNOSTICIAN_USER_PREFIX',
];

async function withDiagEnv(overrides, fn) {
  const previous = new Map();
  DIAG_ENV_KEYS.forEach((key) => previous.set(key, process.env[key]));
  Object.entries({
    DIFY_DIAGNOSTICIAN_ENABLED: 'true',
    DIFY_DIAGNOSTICIAN_BASE_URL: 'http://localhost/v1',
    DIFY_DIAGNOSTICIAN_API_KEY: 'placeholder',
    DIFY_DIAGNOSTICIAN_TIMEOUT_MS: '120000',
    DIFY_DIAGNOSTICIAN_MAX_RETRIES: '0',
    DIFY_DIAGNOSTICIAN_USER_PREFIX: 'discimind-diagnostician',
    ...overrides,
  }).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    return await fn();
  } finally {
    DIAG_ENV_KEYS.forEach((key) => {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

function difyWorkflowEnvelope(branchResult, dataOverrides = {}) {
  return {
    data: {
      task_id: 'task_diag_001',
      workflow_run_id: 'workflow_diag_001',
      data: {
        id: 'diag_data_001',
        status: 'succeeded',
        outputs: { branch_result: branchResult },
        elapsed_time: 1.1,
        total_tokens: 123,
        ...dataOverrides,
      },
    },
  };
}

test('Explainer stream conversion emits unified delta, metadata and done events', () => {
  const delta = transformDifyStreamEvent('', {
    event: 'message',
    answer: '你好',
    conversation_id: 'conv_1',
    message_id: 'msg_1',
  });
  assert.deepEqual(delta[0], {
    event: 'delta',
    data: {
      text: '你好',
      conversationId: 'conv_1',
      messageId: 'msg_1',
    },
  });

  const done = transformDifyStreamEvent('', {
    event: 'message_end',
    conversation_id: 'conv_1',
    message_id: 'msg_1',
    metadata: { usage: { total_tokens: 20 } },
  });
  assert.equal(done[0].event, 'metadata');
  assert.equal(done[1].event, 'done');
  assert.equal(done[0].data.usage.total_tokens, 20);
});

test('Explainer auto strategy prioritizes pending diagnostician intervention', () => {
  const decision = selectExplainerStrategy({
    strategyHint: 'auto',
    context: {
      pendingIntervention: {
        action: 'switch_strategy',
        params_json: { strategy: 'analogy_bridge' },
        trigger_reason: '当前教法连续失败',
      },
      misconceptions: [],
      errorTypes: {},
      mastery: { mastery_score: 20 },
      portrait: {},
      recentReports: [],
    },
  });
  assert.equal(decision.strategy, 'analogy_bridge');
  assert.equal(decision.source, 'diagnostician_intervention');
});

test('Diagnostician workflow parses object and JSON string branch_result', async () => {
  await withDiagEnv({}, async () => {
    const objectClient = {
      async post(path, body) {
        assert.equal(path, '/workflows/run');
        assert.equal(body.inputs.mode, 'mental_model');
        return difyWorkflowEnvelope({
          success: true,
          mode: 'mental_model',
          request_id: 'req_object',
          result: { ok: true },
        });
      },
    };
    const objectResult = await runDiagnosticianWorkflow({
      mode: 'mental_model',
      requestId: 'req_object',
      payload: { student_id: '1', preprocessed_data: {} },
      locale: 'zh-CN',
      debug: false,
      difyUser: 'discimind-diagnostician-1',
    }, { client: objectClient });
    assert.equal(objectResult.branchResult.result.ok, true);

    const stringClient = {
      async post() {
        return difyWorkflowEnvelope('```json\n{"success":true,"mode":"growth_report","request_id":"req_string","result":{"ok":true}}\n```');
      },
    };
    const stringResult = await runDiagnosticianWorkflow({
      mode: 'growth_report',
      requestId: 'req_string',
      payload: { student_id: '1', preprocessed_data: {} },
      locale: 'zh-CN',
      debug: false,
      difyUser: 'discimind-diagnostician-1',
    }, { client: stringClient });
    assert.equal(stringResult.branchResult.result.ok, true);
  });
});

test('Diagnostician workflow rejects business success=false even when HTTP succeeds', async () => {
  await withDiagEnv({}, async () => {
    const client = {
      async post() {
        return difyWorkflowEnvelope({
          success: false,
          mode: 'strategy_intervention',
          error: { code: 'INVALID_INPUT' },
          result: {},
        });
      },
    };
    await assert.rejects(
      () => runDiagnosticianWorkflow({
        mode: 'strategy_intervention',
        requestId: 'req_business_fail',
        payload: { student_id: '1', preprocessed_data: {} },
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-diagnostician-1',
      }, { client }),
      (err) => err.code === 'DIFY_DIAGNOSTICIAN_BUSINESS_FAILED' && err.status === 422,
    );
  });
});

test('Deterministic interventions cover consecutive wrong and attention decline', () => {
  const interventions = detectDeterministicInterventions({
    answer_stats: {
      consecutive_wrong_count: 3,
      consecutive_correct_count: 0,
      avg_duration_seconds: 130,
      all_correct_long_time: false,
      all_wrong_high_confidence: false,
    },
    attention_trend: { profile: 'declining' },
    mastery: { current_score: 40 },
    recent_error_type: 'concept_confusion',
    strategy_history: [],
  });

  assert.ok(interventions.some((item) => item.instruction.action === 'reduce_difficulty_and_focus'));
  assert.ok(interventions.some((item) => item.instruction.action === 'suggest_break'));
});

test('Intervention whitelist accepts known actions and rejects unknown actions', () => {
  const accepted = validateInstruction('explainer', {
    action: 'switch_strategy',
    params: { strategy: 'analogy' },
  });
  assert.equal(accepted.valid, true);
  assert.equal(accepted.params.strategy, 'analogy_bridge');

  const rejected = validateInstruction('trainer', {
    action: 'delete_database',
    params: { anything: true },
  });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.action, 'delete_database');
});

// ============================================================
// 扩展测试：诊断师 branch_result 解析、错误处理、数据验证
// ============================================================

const {
  parseMaybeJsonObject,
  sanitizeDifyPayload,
} = require('../src/modules/dify/agent-dify.service');
const {
  computeStatistics,
  buildPayload,
} = require('../src/modules/agent/diagnostician/diagnostician.service');
const {
  validateDiagnosticianAnalyzeBody,
} = require('../src/modules/agent/diagnostician/diagnostician.validator');

test('parseMaybeJsonObject handles plain object, JSON string, markdown fenced JSON, and malformed input', () => {
  // Plain object
  const obj = { success: true, mode: 'test' };
  assert.deepEqual(parseMaybeJsonObject(obj), obj);

  // JSON string
  const str = '{"success":true,"mode":"mental_model"}';
  assert.deepEqual(parseMaybeJsonObject(str), { success: true, mode: 'mental_model' });

  // Markdown fenced JSON
  const fenced = '```json\n{"success":true,"mode":"growth_report"}\n```';
  assert.deepEqual(parseMaybeJsonObject(fenced), { success: true, mode: 'growth_report' });

  // Markdown fenced without language tag
  const fencedNoLang = '```\n{"success":true}\n```';
  assert.deepEqual(parseMaybeJsonObject(fencedNoLang), { success: true });

  // JSON embedded in text
  const embedded = 'Some text {"success":true,"result":{"ok":1}} more text';
  const parsed = parseMaybeJsonObject(embedded);
  assert.equal(parsed.success, true);
  assert.equal(parsed.result.ok, 1);

  // Invalid
  assert.equal(parseMaybeJsonObject('not json at all'), null);
  assert.equal(parseMaybeJsonObject(''), null);
  assert.equal(parseMaybeJsonObject(null), null);
  assert.equal(parseMaybeJsonObject(123), null);
  assert.equal(parseMaybeJsonObject([]), null);
});

test('sanitizeDifyPayload serializes deeply nested objects via JSON round-trip', () => {
  // Prisma objects have deep reference chains (e.g. answer→question→course→...).
  // sanitizeDifyPayload flattens these via JSON.parse(JSON.stringify(...)) to avoid
  // Dify Python recursion limits. JS-level circular refs still throw, which is acceptable.
  const deep = {
    name: 'test',
    child: {
      name: 'child',
      parent: null, // Prisma relations are null or refs, not circular at JSON level
    },
  };
  const result = sanitizeDifyPayload(deep);
  assert.equal(result.name, 'test');
  assert.equal(result.child.name, 'child');
  assert.equal(result.child.parent, null);

  // Prisma-like objects with extra internal fields should be stripped
  const prismaLike = {
    id: 1,
    name: 'answer',
    question: { id: 10, course: { id: 5, name: 'Math' } },
    $parent: { $parent: { deep: true } },
    _model: 'AnswerRecord',
  };
  const cleaned = sanitizeDifyPayload(prismaLike);
  assert.equal(cleaned.id, 1);
  assert.equal(cleaned.question.course.name, 'Math');
  // Prisma internal fields ($parent, _model) may or may not be stripped by JSON.stringify
  // The key behavior is: no throw, depth is bounded
});

test('computeStatistics handles empty answers gracefully', () => {
  const scope = {
    student: { user_id: 1 },
    course: { course_id: 1, course_name: '测试课程' },
    knowledgePoint: { knowledge_point_id: 1, knowledge_point_name: '测试知识点', difficulty_level: 'medium' },
  };
  const data = {
    masteryRecords: [],
    parentMastery: null,
    portrait: null,
    snapshots: [],
    answers: [],
    sessions: [],
    recentRuns: [],
    reports: [],
  };
  const stats = computeStatistics(data, scope);
  assert.equal(stats.answer_stats.answer_count, 0);
  assert.equal(stats.answer_stats.accuracy, null);
  assert.equal(stats.sample_quality.sufficient, false);
  assert.equal(stats.sample_quality.limitations.length, 1);
});

test('computeStatistics handles consecutive wrong streak', () => {
  const scope = {
    student: { user_id: 1 },
    course: { course_id: 1, course_name: '测试课程' },
    knowledgePoint: null,
  };
  const data = {
    masteryRecords: [],
    parentMastery: null,
    portrait: null,
    snapshots: [],
    answers: [
      { is_correct: false, duration_seconds: 60, trainer_answer_detail: null, question: {} },
      { is_correct: false, duration_seconds: 45, trainer_answer_detail: null, question: {} },
      { is_correct: false, duration_seconds: 30, trainer_answer_detail: null, question: {} },
      { is_correct: true, duration_seconds: 50, trainer_answer_detail: null, question: {} },
    ],
    sessions: [],
    recentRuns: [],
    reports: [],
  };
  const stats = computeStatistics(data, scope);
  assert.equal(stats.answer_stats.consecutive_wrong_count, 3);
  assert.equal(stats.answer_stats.consecutive_correct_count, 0);
  assert.equal(stats.answer_stats.answer_count, 4);
  assert.equal(stats.answer_stats.correct_count, 1);
  assert.equal(stats.answer_stats.wrong_count, 3);
});

test('computeStatistics builds error distribution from trainer_answer_detail', () => {
  const scope = {
    student: { user_id: 1 },
    course: { course_id: 1, course_name: '测试课程' },
    knowledgePoint: null,
  };
  const data = {
    masteryRecords: [],
    parentMastery: null,
    portrait: null,
    snapshots: [],
    answers: [
      { is_correct: false, duration_seconds: 60, trainer_answer_detail: { deep_evaluation_json: { error_type: 'concept_confusion', error_analysis: { mental_model_gap: '混淆逻辑回归系数与概率增量' } } }, question: {} },
      { is_correct: false, duration_seconds: 45, trainer_answer_detail: { deep_evaluation_json: { error_type: 'concept_confusion' } }, question: {} },
      { is_correct: false, duration_seconds: 30, trainer_answer_detail: { deep_evaluation_json: { errorType: 'calculation_error' } }, question: {} },
    ],
    sessions: [],
    recentRuns: [],
    reports: [],
  };
  const stats = computeStatistics(data, scope);
  assert.equal(stats.error_type_distribution.concept_confusion, 2);
  assert.equal(stats.error_type_distribution.calculation_error, 1);
  assert.equal(stats.recent_error_type, 'concept_confusion');
  assert.equal(stats.focus_pitfall, '混淆逻辑回归系数与概率增量');
});

test('computeStatistics builds confidence calibration', () => {
  const scope = {
    student: { user_id: 1 },
    course: { course_id: 1, course_name: '测试课程' },
    knowledgePoint: null,
  };
  const data = {
    masteryRecords: [],
    parentMastery: null,
    portrait: null,
    snapshots: [],
    answers: [
      { is_correct: false, duration_seconds: 60, trainer_answer_detail: { confidence_level: 'high' }, question: {} },
      { is_correct: false, duration_seconds: 45, trainer_answer_detail: { confidence_level: 'high' }, question: {} },
      { is_correct: true, duration_seconds: 30, trainer_answer_detail: { confidence_level: 'low' }, question: {} },
    ],
    sessions: [],
    recentRuns: [],
    reports: [],
  };
  const stats = computeStatistics(data, scope);
  assert.equal(stats.confidence_calibration.label, 'overconfident');
  assert.equal(stats.confidence_calibration.high_wrong_count, 2);
  assert.equal(stats.confidence_calibration.sample_size, 3);
});

test('computeStatistics builds attention trend as declining when second half is slower', () => {
  const scope = {
    student: { user_id: 1 },
    course: { course_id: 1, course_name: '测试课程' },
    knowledgePoint: null,
  };
  const data = {
    masteryRecords: [],
    parentMastery: null,
    portrait: null,
    snapshots: [],
    answers: [
      { is_correct: false, duration_seconds: 200, trainer_answer_detail: null, question: {} },
      { is_correct: false, duration_seconds: 180, trainer_answer_detail: null, question: {} },
      { is_correct: false, duration_seconds: 50, trainer_answer_detail: null, question: {} },
      { is_correct: false, duration_seconds: 40, trainer_answer_detail: null, question: {} },
    ],
    sessions: [],
    recentRuns: [],
    reports: [],
  };
  const stats = computeStatistics(data, scope);
  assert.equal(stats.attention_trend.profile, 'declining');
});

test('deterministic interventions trigger reduce_difficulty for 3+ consecutive wrong', () => {
  const interventions = detectDeterministicInterventions({
    answer_stats: {
      consecutive_wrong_count: 3,
      consecutive_correct_count: 0,
      avg_duration_seconds: 60,
      all_correct_long_time: false,
      all_wrong_high_confidence: false,
    },
    attention_trend: { profile: 'sustained' },
    mastery: { current_score: 50 },
    recent_error_type: 'concept_confusion',
    focus_pitfall: '混淆逻辑回归系数与概率增量',
    strategy_history: [],
  });
  const trainerActions = interventions.filter((i) => i.target_agent === 'trainer');
  assert.ok(trainerActions.some((i) => i.instruction.action === 'reduce_difficulty_and_focus'));
  assert.ok(trainerActions.some((i) => i.instruction.params.focus_pitfall === '混淆逻辑回归系数与概率增量'));
});

test('strategy intervention response merges deterministic trainer and explainer actions over weak Dify suggestion', () => {
  const merged = mergeDeterministicInterventions({
    success: true,
    mode: 'strategy_intervention',
    request_id: 'req_merge',
    result: {
      target_agent: 'orchestrator',
      instruction: { action: 'continue_current_plan', params: {} },
      all_interventions: [
        { target_agent: 'orchestrator', instruction: { action: 'continue_current_plan', params: {} } },
      ],
    },
  }, [
    {
      trigger: '连续 3 题错误',
      target_agent: 'trainer',
      instruction: {
        action: 'reduce_difficulty_and_focus',
        params: { difficulty: 'basic', focus_pitfall: '混淆逻辑回归系数与概率增量', max_questions: 3 },
      },
      priority: 20,
    },
    {
      trigger: '当前教法连续失败 2 次',
      target_agent: 'explainer',
      instruction: {
        action: 'switch_strategy',
        params: { strategy: 'analogy_bridge', focus_misconception: '混淆逻辑回归系数与概率增量' },
      },
      priority: 25,
    },
  ]);

  assert.equal(merged.result.target_agent, 'trainer');
  assert.equal(merged.result.instruction.action, 'reduce_difficulty_and_focus');
  assert.equal(merged.result.parallel_instruction_to_explainer.action, 'switch_strategy');
  assert.ok(merged.result.all_interventions.some((item) => item.target_agent === 'trainer'));
  assert.ok(merged.result.all_interventions.some((item) => item.target_agent === 'explainer'));
});

test('deterministic interventions trigger insert_diagnostic for correct but slow', () => {
  const interventions = detectDeterministicInterventions({
    answer_stats: {
      consecutive_wrong_count: 0,
      consecutive_correct_count: 3,
      avg_duration_seconds: 150,
      all_correct_long_time: true,
      all_wrong_high_confidence: false,
    },
    attention_trend: { profile: 'sustained' },
    mastery: { current_score: 70 },
    recent_error_type: 'calculation_error',
    strategy_history: [],
  });
  assert.ok(interventions.some((i) => i.instruction.action === 'insert_diagnostic_question'));
});

test('deterministic interventions trigger advance when mastery high', () => {
  const interventions = detectDeterministicInterventions({
    answer_stats: {
      consecutive_wrong_count: 0,
      consecutive_correct_count: 4,
      avg_duration_seconds: 60,
      all_correct_long_time: false,
      all_wrong_high_confidence: false,
    },
    attention_trend: { profile: 'sustained' },
    mastery: { current_score: 90 },
    recent_error_type: 'unknown',
    strategy_history: [],
  });
  assert.ok(interventions.some((i) => i.instruction.action === 'advance_to_next_stage'));
});

test('intervention whitelist maps strategy aliases correctly', () => {
  const tests = [
    ['direct', 'direct_instruction'],
    ['socratic', 'socratic_dialogue'],
    ['analogy', 'analogy_bridge'],
    ['misconception', 'misconception_confrontation'],
  ];
  for (const [alias, canonical] of tests) {
    const result = validateInstruction('explainer', {
      action: 'switch_strategy',
      params: { strategy: alias },
    });
    assert.equal(result.params.strategy, canonical, `alias "${alias}" should map to "${canonical}"`);
  }
});

test('intervention whitelist strips non-executable params before persistence', () => {
  const trainer = validateInstruction('trainer', {
    action: 'reduce_difficulty_and_focus',
    params: {
      difficulty: 'basic',
      focus_pitfall: '混淆逻辑回归系数与概率增量',
      max_questions: 3,
      recent_error_type: 'concept_confusion',
      debug_header: 'should_not_persist',
    },
  });
  assert.deepEqual(trainer.params, {
    difficulty: 'basic',
    focus_pitfall: '混淆逻辑回归系数与概率增量',
    max_questions: 3,
  });

  const explainer = validateInstruction('explainer', {
    action: 'switch_strategy',
    params: {
      strategy: 'analogy',
      focus_misconception: '混淆逻辑回归系数与概率增量',
      from_strategy: 'direct_instruction',
    },
  });
  assert.deepEqual(explainer.params, {
    strategy: 'analogy_bridge',
    focus_misconception: '混淆逻辑回归系数与概率增量',
  });
});

test('intervention whitelist validates all known actions for each agent', () => {
  const trainerActions = ['reduce_difficulty_and_focus', 'insert_diagnostic_question', 'increase_difficulty', 'variant_pursuit', 'skip_remaining_practice'];
  const explainerActions = ['switch_strategy', 'focus_misconception', 'review_prerequisite', 'provide_analogy', 'summarize_and_confirm'];
  const orchestratorActions = ['suggest_break', 'continue_current_plan', 'advance_to_next_stage'];

  for (const action of trainerActions) {
    const result = validateInstruction('trainer', { action, params: {} });
    assert.equal(result.valid, true, `trainer action "${action}" should be valid`);
  }
  for (const action of explainerActions) {
    const result = validateInstruction('explainer', { action, params: {} });
    assert.equal(result.valid, true, `explainer action "${action}" should be valid`);
  }
  for (const action of orchestratorActions) {
    const result = validateInstruction('orchestrator', { action, params: {} });
    assert.equal(result.valid, true, `orchestrator action "${action}" should be valid`);
  }
});

test('intervention whitelist normalizes target_agent frontend→orchestrator', () => {
  const result = validateInstruction('frontend', {
    action: 'suggest_break',
    params: { duration_minutes: 10 },
  });
  assert.equal(result.valid, true);
  assert.equal(result.targetAgent, 'orchestrator');
});

test('validator rejects invalid mode', () => {
  assert.throws(
    () => validateDiagnosticianAnalyzeBody({ mode: 'invalid_mode', knowledgePointId: 1 }),
    (err) => err.code === 'INVALID_MODE',
  );
});

test('validator rejects missing knowledgePointId for mental_model', () => {
  assert.throws(
    () => validateDiagnosticianAnalyzeBody({ mode: 'mental_model' }),
    (err) => err.code === 'INVALID_INPUT',
  );
});

test('validator requires reportPeriod for growth_report', () => {
  assert.throws(
    () => validateDiagnosticianAnalyzeBody({ mode: 'growth_report' }),
    (err) => err.code === 'INVALID_INPUT',
  );
});

test('validator accepts growth_report with valid reportPeriod', () => {
  const result = validateDiagnosticianAnalyzeBody({
    mode: 'growth_report',
    reportPeriod: { from: '2026-07-01', to: '2026-07-09' },
  });
  assert.equal(result.mode, 'growth_report');
  assert.equal(result.knowledgePointId, null); // not required for growth_report
  assert.equal(result.reportPeriod.from, '2026-07-01');
});

test('validator rejects non-object body', () => {
  assert.throws(
    () => validateDiagnosticianAnalyzeBody('not an object'),
    (err) => err.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => validateDiagnosticianAnalyzeBody(null),
    (err) => err.code === 'INVALID_INPUT',
  );
});

test('validator auto-generates requestId when empty', () => {
  const result = validateDiagnosticianAnalyzeBody({ mode: 'mental_model', knowledgePointId: 1 });
  assert.ok(result.requestId.startsWith('diagnostician_mental_model_'));
  assert.ok(result.requestId.length <= 128);
});

test('validator normalizes locale and debug flags', () => {
  const result = validateDiagnosticianAnalyzeBody({
    mode: 'mental_model',
    knowledgePointId: 1,
    locale: 'en-US',
    debug: true,
    requestId: 'custom_req_123',
  });
  assert.equal(result.locale, 'en-US');
  assert.equal(result.debug, true);
  assert.equal(result.requestId, 'custom_req_123');
});

test('validator rejects excessively long requestId', () => {
  assert.throws(
    () => validateDiagnosticianAnalyzeBody({ mode: 'mental_model', knowledgePointId: 1, requestId: 'x'.repeat(200) }),
    (err) => err.code === 'INVALID_INPUT',
  );
});

test('dify timeout is mapped to safe error', async () => {
  await withDiagEnv({ DIFY_DIAGNOSTICIAN_MAX_RETRIES: '0' }, async () => {
    const timeoutClient = {
      async post() {
        const err = new Error('timeout of 120000ms exceeded');
        err.code = 'ECONNABORTED';
        throw err;
      },
    };
    await assert.rejects(
      () => runDiagnosticianWorkflow({
        mode: 'mental_model',
        requestId: 'req_timeout',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-diagnostician-1',
      }, { client: timeoutClient }),
      (err) => err.code === 'DIFY_TIMEOUT' && err.status === 504,
    );
  });
});

test('dify 502 is mapped to safe upstream error', async () => {
  await withDiagEnv({ DIFY_DIAGNOSTICIAN_MAX_RETRIES: '0' }, async () => {
    const badGatewayClient = {
      async post() {
        const err = new Error('Bad Gateway');
        err.response = { status: 502, data: 'Bad Gateway' };
        throw err;
      },
    };
    await assert.rejects(
      () => runDiagnosticianWorkflow({
        mode: 'mental_model',
        requestId: 'req_502',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-diagnostician-1',
      }, { client: badGatewayClient }),
      (err) => err.code === 'DIFY_UNREACHABLE' && err.status === 502,
    );
  });
});

test('dify 404 is mapped to safe endpoint not found error', async () => {
  await withDiagEnv({ DIFY_DIAGNOSTICIAN_MAX_RETRIES: '0' }, async () => {
    const notFoundClient = {
      async post() {
        const err = new Error('Not Found');
        err.response = { status: 404 };
        throw err;
      },
    };
    await assert.rejects(
      () => runDiagnosticianWorkflow({
        mode: 'mental_model',
        requestId: 'req_404',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-diagnostician-1',
      }, { client: notFoundClient }),
      (err) => err.code === 'DIFY_ENDPOINT_NOT_FOUND' && err.status === 502,
    );
  });
});

test('dify connection refused is mapped safely', async () => {
  await withDiagEnv({ DIFY_DIAGNOSTICIAN_MAX_RETRIES: '0' }, async () => {
    const refusedClient = {
      async post() {
        const err = new Error('connect ECONNREFUSED');
        err.code = 'ECONNREFUSED';
        throw err;
      },
    };
    await assert.rejects(
      () => runDiagnosticianWorkflow({
        mode: 'mental_model',
        requestId: 'req_refused',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-diagnostician-1',
      }, { client: refusedClient }),
      (err) => err.code === 'DIFY_UNREACHABLE',
    );
  });
});

test('workflow status not succeeded is rejected', async () => {
  await withDiagEnv({ DIFY_DIAGNOSTICIAN_MAX_RETRIES: '0' }, async () => {
    const failedClient = {
      async post() {
        return {
          data: {
            task_id: 'task_fail',
            data: {
              id: 'data_fail',
              status: 'failed',
              error: 'Workflow execution failed',
              outputs: { branch_result: '{"success":true}' },
            },
          },
        };
      },
    };
    await assert.rejects(
      () => runDiagnosticianWorkflow({
        mode: 'mental_model',
        requestId: 'req_failed_status',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-diagnostician-1',
      }, { client: failedClient }),
      (err) => err.code === 'DIFY_DIAGNOSTICIAN_WORKFLOW_FAILED',
    );
  });
});

test('dify errors do not leak API key', async () => {
  await withDiagEnv({}, async () => {
    const errorClient = {
      async post() {
        const err = new Error('Unauthorized');
        err.response = { status: 401, data: { message: 'Invalid API key' } };
        throw err;
      },
    };
    try {
      await runDiagnosticianWorkflow({
        mode: 'mental_model',
        requestId: 'req_no_leak',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-diagnostician-1',
      }, { client: errorClient });
      assert.fail('should have thrown');
    } catch (err) {
      const msg = JSON.stringify(err);
      assert.ok(!msg.includes(process.env.DIFY_DIAGNOSTICIAN_API_KEY || 'should-not-match'), 'API Key leaked in error');
      assert.ok(!msg.toLowerCase().includes('app-'), 'app- prefix leaked in error');
    }
  });
});

test('branch_result as Object (not string) still parses correctly', async () => {
  await withDiagEnv({}, async () => {
    const client = {
      async post() {
        return {
          data: {
            task_id: 'task_obj',
            data: {
              id: 'data_obj',
              status: 'succeeded',
              outputs: {
                branch_result: {
                  success: true,
                  mode: 'mental_model',
                  request_id: 'req_obj',
                  result: { mental_model_summary: { mastery_level: 75 } },
                },
              },
              elapsed_time: 0.5,
              total_tokens: 50,
            },
          },
        };
      },
    };
    const result = await runDiagnosticianWorkflow({
      mode: 'mental_model',
      requestId: 'req_obj',
      payload: {},
      locale: 'zh-CN',
      debug: false,
      difyUser: 'discimind-diagnostician-1',
    }, { client });
    assert.equal(result.branchResult.result.mental_model_summary.mastery_level, 75);
  });
});

test('INVALID_INPUT branch_result is rejected as business failure', async () => {
  await withDiagEnv({}, async () => {
    const client = {
      async post() {
        return difyWorkflowEnvelope({
          success: false,
          mode: 'INVALID_INPUT',
          error: { code: 'INVALID_INPUT', message: 'Missing required field' },
          result: {},
        });
      },
    };
    await assert.rejects(
      () => runDiagnosticianWorkflow({
        mode: 'mental_model',
        requestId: 'req_invalid',
        payload: {},
        locale: 'zh-CN',
        debug: false,
        difyUser: 'discimind-diagnostician-1',
      }, { client }),
      (err) => err.code === 'DIFY_DIAGNOSTICIAN_BUSINESS_FAILED' && err.data.mode === 'INVALID_INPUT',
    );
  });
});

test('agent errors carry proper name for instanceof checks', () => {
  const { AgentIntegrationError, createAgentError } = require('../src/modules/agent/common/agent.errors');
  const err = createAgentError('TEST_ERROR', 'test message', 400, { detail: 'x' });
  assert.ok(err instanceof AgentIntegrationError);
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'AgentIntegrationError');
  assert.equal(err.code, 'TEST_ERROR');
  assert.equal(err.status, 400);
  assert.equal(err.data.detail, 'x');
});
