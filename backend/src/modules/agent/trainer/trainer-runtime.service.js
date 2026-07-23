const { createTrainerAgentError } = require('./trainer.errors');

function getLearningAgent() {
  return require('../../learning-agent');
}

function normalizedAnswer(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim());
  if (value == null) return '';
  if (typeof value === 'object') {
    return normalizedAnswer(value.correct_option ?? value.correctOption ?? value.answer ?? value.value);
  }
  return String(value).trim();
}

function toLegacyQuestion(question, index = 1) {
  const questionOrder = Math.max(1, Number(index) || 1);
  const answer = normalizedAnswer(question?.correct_answer ?? question?.correctAnswer ?? question?.answer);
  const correctKeys = new Set((Array.isArray(answer) ? answer : [answer]).map((item) => String(item).trim()));
  const questionKey = question?.question_id || question?.question_key || `native_${questionOrder}`;
  return {
    ...question,
    question_id: questionKey,
    question_key: questionKey,
    question_order: questionOrder,
    type: question?.question_type || question?.type || 'single_choice',
    options: (question?.options || []).map((option) => ({
      ...option,
      key: String(option?.key ?? option?.option_key ?? '').trim(),
      content: String(option?.content ?? option?.option_content ?? option?.text ?? '').trim(),
      is_correct: correctKeys.has(String(option?.key ?? option?.option_key ?? '').trim()),
    })),
    standard_answer: {
      answer,
      correct_option: answer,
    },
    answer,
    explanation: question?.analysis || question?.explanation || '',
  };
}

function modelMetadata(result) {
  const timing = result?.modelTiming || {};
  return {
    response_time_ms: Number(timing.totalMs || 0),
    elapsed_time: Number(timing.totalMs || 0) / 1000,
    total_tokens: Number(timing.inputTokens || 0)
      + Number(timing.outputTokens || 0)
      + Number(timing.reasoningTokens || 0),
  };
}

function requireUsableOutput(result, message) {
  const output = result?.normalizedOutput;
  if (!output || output.is_fallback || result?.validationError) {
    throw createTrainerAgentError(
      'TRAINER_MODEL_FAILED',
      result?.validationError || output?.error || message,
      502,
    );
  }
  return output;
}

function knowledgePointName(payload) {
  return payload?.knowledge_point?.name
    || payload?.knowledge_point?.knowledgePointName
    || payload?.current_question?.knowledge_point
    || '';
}

async function runDiagnostic(params) {
  const { payload = {} } = params;
  const result = await getLearningAgent().runTrainer({
    mode: 'diagnostic_pre_test',
    query: '根据当前课程、知识点和学生掌握情况生成诊断前测。',
    knowledgePointName: knowledgePointName(payload),
    studentContext: {
      masteryScore: payload.student_profile?.mastery_score,
      masteryLevel: payload.student_profile?.mastery_level,
      errorTypes: payload.historical_error_patterns,
    },
    previousPerformance: payload.recent_practice,
    maxQuestions: Number(payload.requested_question_count || 1),
  });
  const output = requireUsableOutput(result, '训练师未返回可用诊断题');
  const questions = (output.questions || []).map((question, index) => toLegacyQuestion(question, index + 1));
  if (!questions.length) {
    throw createTrainerAgentError('TRAINER_NO_QUESTIONS', '训练师未返回可用诊断题', 502);
  }
  return {
    businessResult: {
      success: true,
      mode: params.mode,
      request_id: params.requestId,
      result: { ...output, questions },
    },
    metadata: modelMetadata(result),
  };
}

async function runEvaluation(params) {
  const { payload = {} } = params;
  const question = payload.current_question || payload.question || {};
  const studentAnswer = payload.student_answer?.answer ?? payload.student_answer?.selected_option ?? '';
  const correctAnswer = normalizedAnswer(payload.standard_answer ?? question.standard_answer ?? question.correct_answer);
  const result = await getLearningAgent().evaluateTrainerAnswer({
    question: question.stem || question.content || question.title || '',
    studentAnswer: normalizedAnswer(studentAnswer),
    correctAnswer,
    analysis: question.analysis || question.explanation || '',
  });
  const output = result?.normalizedOutput;
  if (!output || output.evaluation_unavailable || result?.validationError) {
    throw createTrainerAgentError(
      'TRAINER_EVALUATION_FAILED',
      result?.validationError || '训练师深度评价暂不可用',
      502,
    );
  }
  return {
    businessResult: {
      success: true,
      mode: params.mode,
      request_id: params.requestId,
      result: {
        ...output,
        verdict: output.is_correct ? 'correct' : 'incorrect',
      },
    },
    metadata: modelMetadata(result),
  };
}

async function runAdaptive(params) {
  const { payload = {} } = params;
  const result = await getLearningAgent().runTrainer({
    mode: 'adaptive_practice',
    query: '结合上一题表现生成下一道自适应练习题。',
    knowledgePointName: knowledgePointName(payload),
    previousPerformance: {
      currentQuestion: payload.current_question,
      deterministicResult: payload.deterministic_result,
      deepEvaluation: payload.deep_evaluation,
      recentQuestions: payload.recent_questions,
      diagnosticianInstruction: payload.diagnostician_instruction,
    },
    maxQuestions: 1,
  });
  const output = requireUsableOutput(result, '训练师未返回可用自适应题目');
  const question = output.questions?.[0] ? toLegacyQuestion(output.questions[0], 1) : null;
  if (!question) {
    throw createTrainerAgentError('TRAINER_NO_QUESTIONS', '训练师未返回可用自适应题目', 502);
  }
  return {
    businessResult: {
      success: true,
      mode: params.mode,
      request_id: params.requestId,
      result: {
        decision: {
          action: output.adaptation_strategy || 'continue_training',
          reason: question.adaptive_reason || null,
        },
        next_question: {
          ...question,
          adaptive_action: output.adaptation_strategy || 'continue_training',
        },
      },
    },
    metadata: modelMetadata(result),
  };
}

async function runTrainerWorkflow(params) {
  if (params.mode === 'diagnostic_pre_test') return runDiagnostic(params);
  if (params.mode === 'deep_evaluation') return runEvaluation(params);
  if (params.mode === 'adaptive_training') return runAdaptive(params);
  throw createTrainerAgentError('TRAINER_MODE_UNSUPPORTED', `不支持的训练模式: ${params.mode}`, 400);
}

module.exports = {
  normalizedAnswer,
  toLegacyQuestion,
  modelMetadata,
  runTrainerWorkflow,
};
