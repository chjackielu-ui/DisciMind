const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectExplainerStrategy,
  transformDifyStreamEvent,
} = require('../src/modules/agent/explainer/explainer.service');
const {
  computeStatistics,
  detectDeterministicInterventions,
  mergeDeterministicInterventions,
  validateInstruction,
} = require('../src/modules/agent/diagnostician/diagnostician.service');
const { validateDiagnosticianAnalyzeBody } = require('../src/modules/agent/diagnostician/diagnostician.validator');

function diagnosticData(answers = []) {
  return {
    masteryRecords: [], parentMastery: null, portrait: null, snapshots: [], answers,
    sessions: [], recentRuns: [], reports: [],
  };
}

function scope(knowledgePoint = null) {
  return {
    student: { user_id: 1 },
    course: { course_id: 1, course_name: '测试课程' },
    knowledgePoint,
  };
}

test('Explainer stream conversion keeps the existing SSE response contract', () => {
  const delta = transformDifyStreamEvent('', {
    event: 'message', answer: '你好', conversation_id: 'conv_1', message_id: 'msg_1',
  });
  assert.deepEqual(delta[0], {
    event: 'delta',
    data: { text: '你好', conversationId: 'conv_1', messageId: 'msg_1' },
  });
  const done = transformDifyStreamEvent('', {
    event: 'message_end', conversation_id: 'conv_1', message_id: 'msg_1', metadata: { usage: { total_tokens: 20 } },
  });
  assert.equal(done[0].event, 'metadata');
  assert.equal(done[1].event, 'done');
  assert.equal(done[0].data.usage.total_tokens, 20);
});

test('Explainer strategy prioritizes a pending diagnostician intervention', () => {
  const decision = selectExplainerStrategy({
    strategyHint: 'auto',
    context: {
      pendingIntervention: {
        action: 'switch_strategy', params_json: { strategy: 'analogy_bridge' }, trigger_reason: '当前教法连续失败',
      },
      misconceptions: [], errorTypes: {}, mastery: { mastery_score: 20 }, portrait: {}, recentReports: [],
    },
  });
  assert.equal(decision.strategy, 'analogy_bridge');
  assert.equal(decision.source, 'diagnostician_intervention');
});

test('local diagnostician statistics handle empty answers and wrong streaks', () => {
  const empty = computeStatistics(diagnosticData(), scope({ knowledge_point_id: 1, knowledge_point_name: '知识点' }));
  assert.equal(empty.answer_stats.answer_count, 0);
  assert.equal(empty.answer_stats.accuracy, null);
  assert.equal(empty.sample_quality.sufficient, false);

  const stats = computeStatistics(diagnosticData([
    { is_correct: false, duration_seconds: 60, trainer_answer_detail: null, question: {} },
    { is_correct: false, duration_seconds: 45, trainer_answer_detail: null, question: {} },
    { is_correct: false, duration_seconds: 30, trainer_answer_detail: null, question: {} },
    { is_correct: true, duration_seconds: 50, trainer_answer_detail: null, question: {} },
  ]), scope());
  assert.equal(stats.answer_stats.consecutive_wrong_count, 3);
  assert.equal(stats.answer_stats.correct_count, 1);
  assert.equal(stats.answer_stats.wrong_count, 3);
});

test('local diagnostician builds error distribution and confidence calibration', () => {
  const stats = computeStatistics(diagnosticData([
    { is_correct: false, duration_seconds: 60, trainer_answer_detail: { confidence_level: 'high', deep_evaluation_json: { error_type: 'concept_confusion' } }, question: {} },
    { is_correct: false, duration_seconds: 45, trainer_answer_detail: { confidence_level: 'high', deep_evaluation_json: { error_type: 'concept_confusion' } }, question: {} },
    { is_correct: true, duration_seconds: 30, trainer_answer_detail: { confidence_level: 'low', deep_evaluation_json: { errorType: 'calculation_error' } }, question: {} },
  ]), scope());
  assert.equal(stats.error_type_distribution.concept_confusion, 2);
  assert.equal(stats.confidence_calibration.label, 'overconfident');
  assert.equal(stats.confidence_calibration.high_wrong_count, 2);
});

test('deterministic interventions cover repeated errors and attention decline', () => {
  const interventions = detectDeterministicInterventions({
    answer_stats: {
      consecutive_wrong_count: 3, consecutive_correct_count: 0, avg_duration_seconds: 130,
      all_correct_long_time: false, all_wrong_high_confidence: false,
    },
    attention_trend: { profile: 'declining' },
    mastery: { current_score: 40 },
    recent_error_type: 'concept_confusion',
    strategy_history: [],
  });
  assert.ok(interventions.some((item) => item.instruction.action === 'reduce_difficulty_and_focus'));
  assert.ok(interventions.some((item) => item.instruction.action === 'suggest_break'));
});

test('deterministic interventions override weaker model suggestions', () => {
  const merged = mergeDeterministicInterventions({
    success: true,
    mode: 'strategy_intervention',
    request_id: 'req_merge',
    result: {
      target_agent: 'orchestrator',
      instruction: { action: 'continue_current_plan', params: {} },
      all_interventions: [],
    },
  }, [{
    trigger: '连续 3 题错误', target_agent: 'trainer', priority: 20,
    instruction: { action: 'reduce_difficulty_and_focus', params: { difficulty: 'basic', max_questions: 3 } },
  }]);
  assert.equal(merged.result.target_agent, 'trainer');
  assert.equal(merged.result.instruction.action, 'reduce_difficulty_and_focus');
});

test('intervention whitelist accepts known actions and strips unknown params', () => {
  const accepted = validateInstruction('explainer', {
    action: 'switch_strategy', params: { strategy: 'analogy', debug_header: 'remove' },
  });
  assert.equal(accepted.valid, true);
  assert.deepEqual(accepted.params, { strategy: 'analogy_bridge' });

  const rejected = validateInstruction('trainer', { action: 'delete_database', params: { anything: true } });
  assert.equal(rejected.valid, false);
});

test('diagnostician validator keeps the existing request contract', () => {
  assert.throws(
    () => validateDiagnosticianAnalyzeBody({ mode: 'invalid_mode', knowledgePointId: 1 }),
    (error) => error.code === 'INVALID_MODE',
  );
  assert.throws(
    () => validateDiagnosticianAnalyzeBody({ mode: 'mental_model' }),
    (error) => error.code === 'INVALID_INPUT',
  );
  const result = validateDiagnosticianAnalyzeBody({
    mode: 'growth_report', reportPeriod: { from: '2026-07-01', to: '2026-07-09' },
  });
  assert.equal(result.mode, 'growth_report');
  assert.equal(result.knowledgePointId, null);
});

test('agent errors retain safe typed metadata', () => {
  const { AgentIntegrationError, createAgentError } = require('../src/modules/agent/common/agent.errors');
  const error = createAgentError('TEST_ERROR', 'test message', 400, { detail: 'x' });
  assert.ok(error instanceof AgentIntegrationError);
  assert.equal(error.code, 'TEST_ERROR');
  assert.equal(error.status, 400);
  assert.equal(error.data.detail, 'x');
});
