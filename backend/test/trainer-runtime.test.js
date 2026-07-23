const test = require('node:test');
const assert = require('node:assert/strict');
const {
  modelMetadata,
  normalizedAnswer,
  runTrainerWorkflow,
  toLegacyQuestion,
} = require('../src/modules/agent/trainer/trainer-runtime.service');
const learningAgent = require('../src/modules/learning-agent');

test('native trainer question keeps the legacy persistence contract', () => {
  const question = toLegacyQuestion({
    question_id: 'q_1',
    question_type: 'single_choice',
    stem: '2 + 2 = ?',
    options: [
      { key: 'A', content: '3' },
      { key: 'B', content: '4' },
    ],
    correct_answer: 'B',
    analysis: '基础加法。',
    difficulty: 'basic',
  });
  assert.equal(question.question_key, 'q_1');
  assert.equal(question.type, 'single_choice');
  assert.equal(question.standard_answer.correct_option, 'B');
  assert.equal(question.options[1].is_correct, true);
  assert.equal(question.explanation, '基础加法。');
});

test('native trainer questions use one-based stable fallback keys', () => {
  const first = toLegacyQuestion({ question_type: 'true_false', stem: '题目一', correct_answer: '正确' }, 0);
  const second = toLegacyQuestion({ question_key: 'provided_key', question_type: 'true_false', stem: '题目二', correct_answer: '错误' }, 2);
  assert.equal(first.question_key, 'native_1');
  assert.equal(first.question_order, 1);
  assert.equal(second.question_id, 'provided_key');
  assert.equal(second.question_order, 2);
});

test('native trainer adapter normalizes answers and model metadata', () => {
  assert.deepEqual(normalizedAnswer(['B', 'A']), ['B', 'A']);
  assert.equal(normalizedAnswer({ correct_option: 'C' }), 'C');
  assert.deepEqual(modelMetadata({ modelTiming: { totalMs: 120, inputTokens: 10, outputTokens: 4, reasoningTokens: 2 } }), {
    response_time_ms: 120,
    elapsed_time: 0.12,
    total_tokens: 16,
  });
});

test('native trainer workflow preserves the legacy diagnostic envelope', async () => {
  const original = learningAgent.runTrainer;
  learningAgent.runTrainer = async () => ({
    normalizedOutput: {
      mode: 'diagnostic_pre_test',
      questions: [{
        question_id: 'diag_1', question_type: 'single_choice', stem: '题目',
        options: [{ key: 'A', content: '正确' }, { key: 'B', content: '错误' }],
        correct_answer: 'A', analysis: '解析', difficulty: 'basic',
      }],
    },
    validationError: null,
    modelTiming: { totalMs: 50, inputTokens: 8, outputTokens: 4, reasoningTokens: 0 },
  });
  try {
    const result = await runTrainerWorkflow({
      mode: 'diagnostic_pre_test', requestId: 'req-1',
      payload: { requested_question_count: 1, knowledge_point: { name: '测试知识点' }, student_profile: {} },
    });
    assert.equal(result.businessResult.request_id, 'req-1');
    assert.equal(result.businessResult.result.questions[0].standard_answer.correct_option, 'A');
    assert.equal(result.metadata.total_tokens, 12);
  } finally {
    learningAgent.runTrainer = original;
  }
});

test('native trainer adaptive workflow preserves decision and next-question contracts', async () => {
  const original = learningAgent.runTrainer;
  learningAgent.runTrainer = async () => ({
    normalizedOutput: {
      mode: 'adaptive_practice',
      adaptation_strategy: 'reduce_difficulty',
      questions: [{
        question_type: 'single_choice', stem: '自适应题目',
        options: [{ key: 'A', content: '正确' }, { key: 'B', content: '错误' }],
        correct_answer: 'A', adaptive_reason: '上一题回答错误', difficulty: 'basic',
      }],
    },
    validationError: null,
  });
  try {
    const result = await runTrainerWorkflow({
      mode: 'adaptive_training', requestId: 'req-adaptive', payload: {},
    });
    assert.equal(result.businessResult.result.decision.action, 'reduce_difficulty');
    assert.equal(result.businessResult.result.next_question.adaptive_action, 'reduce_difficulty');
    assert.equal(result.businessResult.result.next_question.question_key, 'native_1');
  } finally {
    learningAgent.runTrainer = original;
  }
});
