const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/config/prisma');
const workflow = require('../src/modules/dify/trainer-workflow.service');
const { TrainerWorkflowError } = require('../src/modules/dify/trainer.errors');
const {
  sanitizePublicQuestion,
  stringifyHasPublicLeak,
} = require('../src/modules/agent/trainer/trainer.sanitizer');
const trainerService = require('../src/modules/agent/trainer/trainer.service');

const originalRunTrainerWorkflow = workflow.runTrainerWorkflow;
const originalBuildDifyUser = workflow.buildDifyUser;

function sampleQuestion(key = 'q1', correct = 'B') {
  return {
    question_key: key,
    type: 'single_choice',
    stem: `关于 ${key} 的判断，哪一项正确？`,
    options: [
      { key: 'A', content: '混淆概念的选项', is_correct: correct === 'A' },
      { key: 'B', content: '符合定义的选项', is_correct: correct === 'B' },
      { key: 'C', content: '无关干扰项', is_correct: correct === 'C' },
    ],
    standard_answer: { correct_option: correct, answer_content: 'secret' },
    explanation: '这里是提交后才允许展示的解析。',
    distractor_analysis: { A: '混淆原因' },
    target_pitfall: { id: `pitfall_${key}`, name: '概念混淆', description: '可能泄露答案的描述' },
    difficulty: 'medium',
    estimated_time_seconds: 40,
    reasoning_content: 'hidden reasoning',
    usage: { total_tokens: 100 },
  };
}

function createMockWorkflow(overrides = {}) {
  const calls = [];
  workflow.buildDifyUser = () => 'discimind-test-user';
  workflow.runTrainerWorkflow = async (input) => {
    calls.push(input);
    if (overrides[input.mode]) return overrides[input.mode](input, calls);

    if (input.mode === 'diagnostic_pre_test') {
      return {
        businessResult: {
          success: true,
          request_id: input.requestId,
          mode: input.mode,
          result: {
            question_count: 1,
            questions: [sampleQuestion('diag_q1', 'B')],
          },
        },
        metadata: { workflow_run_id: `wf_${input.mode}`, response_time_ms: 12, total_tokens: 120 },
      };
    }
    if (input.mode === 'deep_evaluation') {
      return {
        businessResult: {
          success: true,
          request_id: input.requestId,
          mode: input.mode,
          result: {
            verdict: input.payload?.deterministic_result?.is_correct ? 'correct' : 'incorrect',
            error_type: input.payload?.deterministic_result?.is_correct ? null : 'concept_confusion',
            error_analysis: { root_cause: '概念边界不清' },
            remediation: { next_step: '回看定义并做一道变式题' },
          },
        },
        metadata: { workflow_run_id: `wf_${input.mode}`, response_time_ms: 15, total_tokens: 160 },
      };
    }
    if (input.mode === 'adaptive_training') {
      return {
        businessResult: {
          success: true,
          request_id: input.requestId,
          mode: input.mode,
          result: {
            decision: { action: 'remediate', reason: '针对薄弱点补题' },
            next_question: sampleQuestion('adaptive_q2', 'A'),
          },
        },
        metadata: { workflow_run_id: `wf_${input.mode}`, response_time_ms: 18, total_tokens: 180 },
      };
    }
    throw new Error(`unexpected mode ${input.mode}`);
  };
  return calls;
}

function restoreWorkflow() {
  workflow.runTrainerWorkflow = originalRunTrainerWorkflow;
  workflow.buildDifyUser = originalBuildDifyUser;
}

async function getFixture(t) {
  const student = await prisma.user.findUnique({ where: { username: 'student_demo' } });
  if (!student) return t.skip('缺少 student_demo 种子用户');
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: student.user_id },
    orderBy: { enrollment_id: 'asc' },
  });
  if (!enrollment) return t.skip('缺少学生选课种子数据');
  const knowledgePoint = await prisma.knowledgePoint.findFirst({
    where: { course_id: enrollment.course_id },
    orderBy: { knowledge_point_id: 'asc' },
  });
  if (!knowledgePoint) return t.skip('缺少知识点种子数据');

  return {
    userId: student.user_id,
    courseId: enrollment.course_id,
    knowledgePointId: knowledgePoint.knowledge_point_id,
  };
}

async function snapshotMastery(userId, courseId, knowledgePointId) {
  const [mastery, portrait] = await Promise.all([
    prisma.studentMasteryRecord.findUnique({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: userId,
          course_id: courseId,
          knowledge_point_id: knowledgePointId,
        },
      },
    }),
    prisma.studentPortrait.findUnique({
      where: {
        student_user_id_course_id: {
          student_user_id: userId,
          course_id: courseId,
        },
      },
    }),
  ]);
  return { mastery, portrait };
}

async function restoreMastery(userId, courseId, knowledgePointId, snapshot) {
  if (snapshot.mastery) {
    await prisma.studentMasteryRecord.update({
      where: { mastery_record_id: snapshot.mastery.mastery_record_id },
      data: {
        mastery_score: snapshot.mastery.mastery_score,
        mastery_level: snapshot.mastery.mastery_level,
        question_score: snapshot.mastery.question_score,
        system_score: snapshot.mastery.system_score,
      },
    }).catch(() => {});
  } else {
    await prisma.studentMasteryRecord.deleteMany({
      where: { student_user_id: userId, course_id: courseId, knowledge_point_id: knowledgePointId },
    });
  }

  if (snapshot.portrait) {
    await prisma.studentPortrait.update({
      where: { portrait_id: snapshot.portrait.portrait_id },
      data: {
        mastery_score: snapshot.portrait.mastery_score,
        learning_total_score: snapshot.portrait.learning_total_score,
      },
    }).catch(() => {});
  }
}

async function cleanupSession(sessionId) {
  if (!sessionId) return;
  const trainerQuestions = await prisma.trainerSessionQuestion.findMany({
    where: { practice_session_id: sessionId },
    select: { question_id: true },
  }).catch(() => []);
  const questionIds = trainerQuestions.map((item) => item.question_id).filter(Boolean);

  await prisma.trainerAnswerDetail.deleteMany({
    where: { answer_record: { practice_session_id: sessionId } },
  }).catch(() => {});
  await prisma.answerRecord.deleteMany({ where: { practice_session_id: sessionId } }).catch(() => {});
  await prisma.agentRunRecord.deleteMany({ where: { practice_session_id: sessionId } }).catch(() => {});
  await prisma.practiceSession.delete({ where: { practice_session_id: sessionId } }).catch(() => {});
  if (questionIds.length > 0) {
    await prisma.question.deleteMany({ where: { question_id: { in: questionIds } } }).catch(() => {});
  }
}

test.after(async () => {
  restoreWorkflow();
  await prisma.$disconnect();
});

test('sanitizePublicQuestion removes all answer-bearing fields', () => {
  const publicQuestion = sanitizePublicQuestion(sampleQuestion('safe_q1'), 1);
  assert.equal(stringifyHasPublicLeak(publicQuestion), false);
  const serialized = JSON.stringify(publicQuestion);
  assert.equal(serialized.includes('is_correct'), false);
  assert.equal(serialized.includes('standard_answer'), false);
  assert.equal(serialized.includes('correct_option'), false);
  assert.equal(serialized.includes('answer_content'), false);
  assert.equal(serialized.includes('distractor_analysis'), false);
  assert.equal(serialized.includes('explanation'), false);
});

test('context loads real course, mastery, profile, recent practice and active session shape', async (t) => {
  const fixture = await getFixture(t);
  if (!fixture) return;

  const context = await trainerService.getTrainerContext(fixture.userId, fixture);
  assert.equal(context.course.courseId, fixture.courseId);
  assert.equal(context.knowledgePoint.knowledgePointId, fixture.knowledgePointId);
  assert.equal(typeof context.studentPortrait.profileDataSufficient, 'boolean');
  assert.ok(Object.prototype.hasOwnProperty.call(context.mastery, 'masteryScore'));
  assert.ok(Object.prototype.hasOwnProperty.call(context, 'activeSession'));
});

test('create session persists PracticeSession as master and rejects active duplicates', async (t) => {
  const fixture = await getFixture(t);
  if (!fixture) return;
  const calls = createMockWorkflow();
  let sessionId;

  try {
    const created = await trainerService.createTrainerSession(fixture.userId, {
      ...fixture,
      questionCount: 1,
      locale: 'zh-CN',
      requestId: `test_diag_${Date.now()}`,
    });
    sessionId = created.session.sessionId;

    const dbSession = await prisma.practiceSession.findUnique({
      where: { practice_session_id: sessionId },
      include: { trainer_detail: true, trainer_questions: true, agent_run_records: true },
    });
    assert.equal(dbSession.source_type, 'AI_TRAINER');
    assert.equal(dbSession.mode, 'AI_TRAINER');
    assert.equal(dbSession.knowledge_point_id, fixture.knowledgePointId);
    assert.equal(dbSession.trainer_detail.question_count, 1);
    assert.equal(dbSession.trainer_questions.length, 1);
    assert.equal(calls.filter((call) => call.mode === 'diagnostic_pre_test').length, 1);
    assert.equal(JSON.stringify(created.currentQuestion).includes('correct_option'), false);

    await assert.rejects(
      () => trainerService.createTrainerSession(fixture.userId, {
        ...fixture,
        questionCount: 1,
        locale: 'zh-CN',
        requestId: `test_dup_${Date.now()}`,
      }),
      (err) => err.code === 'EXISTING_ACTIVE_SESSION',
    );
  } finally {
    await cleanupSession(sessionId);
    restoreWorkflow();
  }
});

test('submit answer writes answer detail, wrong question, mastery update, adaptive next question and is idempotent', async (t) => {
  const fixture = await getFixture(t);
  if (!fixture) return;
  const snapshot = await snapshotMastery(fixture.userId, fixture.courseId, fixture.knowledgePointId);
  const calls = createMockWorkflow();
  let sessionId;

  try {
    const created = await trainerService.createTrainerSession(fixture.userId, {
      ...fixture,
      questionCount: 1,
      locale: 'zh-CN',
      requestId: `test_answer_diag_${Date.now()}`,
    });
    sessionId = created.session.sessionId;

    const submitted = await trainerService.submitTrainerAnswer(fixture.userId, sessionId, {
      questionKey: created.currentQuestion.questionKey,
      selectedOption: 'A',
      timeSpentSeconds: 12,
      confidenceLevel: 'high',
      locale: 'zh-CN',
      requestId: `test_answer_${Date.now()}`,
    });

    assert.equal(submitted.answerResult.isCorrect, false);
    assert.equal(submitted.answerResult.correctOption, 'B');
    assert.equal(submitted.evaluation.error_type, 'concept_confusion');
    assert.equal(submitted.adaptiveDecision.action, 'remediate');
    assert.ok(submitted.nextQuestion);

    const answerCount = await prisma.answerRecord.count({ where: { practice_session_id: sessionId } });
    const detailCount = await prisma.trainerAnswerDetail.count({
      where: { answer_record: { practice_session_id: sessionId } },
    });
    const wrongCount = await prisma.wrongQuestion.count({
      where: {
        student_user_id: fixture.userId,
        question: { practice_session_links: { some: { practice_session_id: sessionId } } },
      },
    });
    assert.equal(answerCount, 1);
    assert.equal(detailCount, 1);
    assert.equal(wrongCount, 1);
    assert.equal(calls.filter((call) => call.mode === 'deep_evaluation').length, 1);
    assert.equal(calls.filter((call) => call.mode === 'adaptive_training').length, 1);

    const duplicated = await trainerService.submitTrainerAnswer(fixture.userId, sessionId, {
      questionKey: created.currentQuestion.questionKey,
      selectedOption: 'A',
      timeSpentSeconds: 12,
      confidenceLevel: 'high',
      locale: 'zh-CN',
      requestId: `test_answer_dup_${Date.now()}`,
    });
    assert.equal(duplicated.duplicated, true);
    assert.equal(await prisma.answerRecord.count({ where: { practice_session_id: sessionId } }), 1);
    assert.equal(calls.filter((call) => call.mode === 'deep_evaluation').length, 1);
  } finally {
    await cleanupSession(sessionId);
    await restoreMastery(fixture.userId, fixture.courseId, fixture.knowledgePointId, snapshot);
    restoreWorkflow();
  }
});

test('complete, report and events use real persisted timeline', async (t) => {
  const fixture = await getFixture(t);
  if (!fixture) return;
  const snapshot = await snapshotMastery(fixture.userId, fixture.courseId, fixture.knowledgePointId);
  createMockWorkflow();
  let sessionId;

  try {
    const created = await trainerService.createTrainerSession(fixture.userId, {
      ...fixture,
      questionCount: 1,
      locale: 'zh-CN',
      requestId: `test_complete_diag_${Date.now()}`,
    });
    sessionId = created.session.sessionId;
    await trainerService.submitTrainerAnswer(fixture.userId, sessionId, {
      questionKey: created.currentQuestion.questionKey,
      selectedOption: 'B',
      timeSpentSeconds: 8,
      confidenceLevel: 'medium',
      locale: 'zh-CN',
      requestId: `test_complete_answer_${Date.now()}`,
    });

    const completed = await trainerService.completeTrainerSession(fixture.userId, sessionId);
    assert.equal(completed.session.status, 'SUBMITTED');
    assert.equal(completed.report.title, '训练师训练总结');

    const report = await trainerService.getTrainerReport(fixture.userId, sessionId);
    const events = await trainerService.getTrainerEvents(fixture.userId, sessionId);
    assert.equal(report.sessionSummary.completedCount, 1);
    assert.ok(events.some((event) => event.type === 'session_created'));
    assert.ok(events.some((event) => event.type === 'deep_evaluation_completed'));
    assert.ok(events.some((event) => event.type === 'session_completed'));
  } finally {
    await cleanupSession(sessionId);
    await restoreMastery(fixture.userId, fixture.courseId, fixture.knowledgePointId, snapshot);
    restoreWorkflow();
  }
});

test('abandon marks trainer PracticeSession without deleting records', async (t) => {
  const fixture = await getFixture(t);
  if (!fixture) return;
  createMockWorkflow();
  let sessionId;

  try {
    const created = await trainerService.createTrainerSession(fixture.userId, {
      ...fixture,
      questionCount: 1,
      locale: 'zh-CN',
      requestId: `test_abandon_diag_${Date.now()}`,
    });
    sessionId = created.session.sessionId;
    const abandoned = await trainerService.abandonTrainerSession(fixture.userId, sessionId);
    assert.equal(abandoned.abandoned, true);
    assert.equal(abandoned.session.status, 'ABANDONED');
    assert.equal(await prisma.practiceSession.count({ where: { practice_session_id: sessionId } }), 1);
  } finally {
    await cleanupSession(sessionId);
    restoreWorkflow();
  }
});

test('diagnostic workflow failure updates session and run record as FAILED', async (t) => {
  const fixture = await getFixture(t);
  if (!fixture) return;
  const requestId = `test_fail_diag_${Date.now()}`;
  createMockWorkflow({
    diagnostic_pre_test: () => {
      throw new TrainerWorkflowError('TRAINER_TIMEOUT', 'Dify 训练师请求超时', 504);
    },
  });

  let sessionId;
  try {
    await assert.rejects(
      () => trainerService.createTrainerSession(fixture.userId, {
        ...fixture,
        questionCount: 1,
        locale: 'zh-CN',
        requestId,
      }),
      (err) => err.code === 'TRAINER_TIMEOUT',
    );
    const run = await prisma.agentRunRecord.findFirst({
      where: { request_id: requestId, agent_type: 'TRAINER', mode: 'diagnostic_pre_test' },
      orderBy: { created_at: 'desc' },
    });
    assert.equal(run.status, 'FAILED');
    sessionId = run.practice_session_id;
    const session = await prisma.practiceSession.findUnique({ where: { practice_session_id: sessionId } });
    assert.equal(session.status, 'FAILED');
  } finally {
    await cleanupSession(sessionId);
    restoreWorkflow();
  }
});
