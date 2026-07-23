const crypto = require('crypto');

const prisma = require('../../../config/prisma');
const masteryService = require('../../../services/mastery.service');
const wrongQuestionService = require('../../../services/wrong-question.service');
const trainerRuntimeService = require('./trainer-runtime.service');
const diagnosticianService = require('../diagnostician/diagnostician.service');
const {
  applyClaimedIntervention,
  claimPendingIntervention,
  failClaimedIntervention,
} = require('../common/intervention.service');
const { createTrainerAgentError } = require('./trainer.errors');
const {
  pickQuestionKey,
  sanitizePublicQuestion,
  stripUnsafeInternalMeta,
} = require('./trainer.sanitizer');
const {
  answerRecordDto,
  chapterDto,
  courseDto,
  knowledgePointDto,
  progressDto,
  sessionDto,
  toIso,
} = require('./trainer.dto');

const SOURCE_TYPE = 'AI_TRAINER';
const PRACTICE_MODE = 'AI_TRAINER';
const ACTIVE_STATUSES = ['CREATED', 'IN_PROGRESS', 'SUBMITTING', 'created', 'in_progress', 'submitting'];
const FINAL_STATUSES = ['SUBMITTED', 'ABANDONED', 'EXPIRED', 'submitted', 'abandoned', 'expired', 'graded'];
const QUESTION_SCORE = 10;
const TRAINER_NODE_DEFAULTS = Object.freeze({
  targetQuestionCount: 5,
  minQuestionCount: 3,
  maxQuestionCount: 8,
  targetMastery: 80,
  consecutiveCorrectToFinish: 3,
  allowSkip: true,
  difficultyMode: 'adaptive',
  exitMode: 'target_or_mastery_or_streak',
});

const QUESTION_TYPE_TO_PRISMA = {
  single_choice: 'SINGLE_CHOICE',
  multiple_choice: 'MULTIPLE_CHOICE',
  fill_blank: 'FILL_BLANK',
  blank: 'BLANK',
  true_false: 'TRUE_FALSE',
  short_answer: 'SHORT_ANSWER',
  programming: 'PROGRAMMING',
};

const DIFFICULTY_TO_PRISMA = {
  basic: 'BASIC',
  easy: 'BASIC',
  medium: 'MEDIUM',
  normal: 'MEDIUM',
  hard: 'HARD',
  difficult: 'HARD',
};

function lower(value) {
  return value == null ? null : String(value).toLowerCase();
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizePracticeConfig(config = {}, fallbackTarget = TRAINER_NODE_DEFAULTS.targetQuestionCount) {
  const targetQuestionCount = boundedInt(
    config.targetQuestionCount ?? config.questionCount,
    fallbackTarget,
    1,
    20,
  );
  const minQuestionCount = boundedInt(
    config.minQuestionCount,
    Math.min(TRAINER_NODE_DEFAULTS.minQuestionCount, targetQuestionCount),
    1,
    targetQuestionCount,
  );
  const maxQuestionCount = boundedInt(
    config.maxQuestionCount,
    Math.max(TRAINER_NODE_DEFAULTS.maxQuestionCount, targetQuestionCount),
    targetQuestionCount,
    20,
  );
  return {
    targetQuestionCount,
    minQuestionCount,
    maxQuestionCount,
    targetMastery: boundedInt(config.targetMastery, TRAINER_NODE_DEFAULTS.targetMastery, 0, 100),
    consecutiveCorrectToFinish: boundedInt(
      config.consecutiveCorrectToFinish,
      TRAINER_NODE_DEFAULTS.consecutiveCorrectToFinish,
      1,
      maxQuestionCount,
    ),
    allowSkip: config.allowSkip !== false,
    difficultyMode: String(config.difficultyMode || TRAINER_NODE_DEFAULTS.difficultyMode),
    exitMode: String(config.exitMode || TRAINER_NODE_DEFAULTS.exitMode),
  };
}

function workflowBinding(params = {}) {
  if (!params.learningSessionId || !params.nodeExecutionId) return null;
  return {
    learningSessionId: Number(params.learningSessionId),
    nodeExecutionId: Number(params.nodeExecutionId),
    executionVersion: Number(params.executionVersion || 1),
  };
}

function getWorkflowBinding(session) {
  return session?.navigation_config?.learningWorkflow || null;
}

function isCancelledError(err) {
  return ['TRAINER_RUN_CANCELLED', 'STALE_NODE_EXECUTION', 'SESSION_CLOSED'].includes(err?.code);
}

async function assertWorkflowExecutionActive(sessionId, binding) {
  if (!binding) return true;
  const [practiceSession, nodeRun, learningSession] = await Promise.all([
    prisma.practiceSession.findUnique({
      where: { practice_session_id: Number(sessionId) },
      select: { status: true },
    }),
    prisma.learningSessionNodeRun.findUnique({
      where: { node_run_id: Number(binding.nodeExecutionId) },
      select: { status: true, trainer_session_id: true, execution_version: true, session_id: true },
    }),
    prisma.learningSession.findUnique({
      where: { session_id: Number(binding.learningSessionId) },
      select: { current_node_run_id: true, status: true },
    }),
  ]);
  const active = practiceSession && ACTIVE_STATUSES.includes(practiceSession.status)
    && nodeRun?.status === 'RUNNING'
    && Number(nodeRun.trainer_session_id) === Number(sessionId)
    && Number(nodeRun.execution_version || 1) === Number(binding.executionVersion || 1)
    && Number(nodeRun.session_id) === Number(binding.learningSessionId)
    && Number(learningSession?.current_node_run_id) === Number(binding.nodeExecutionId)
    && learningSession?.status === 'RUNNING';
  if (!active) {
    throw createTrainerAgentError('TRAINER_RUN_CANCELLED', '当前训练请求已取消或已过期', 409);
  }
  return true;
}

function isFinalStatus(status) {
  return FINAL_STATUSES.includes(status) || FINAL_STATUSES.includes(lower(status));
}

function normalizeQuestionType(value) {
  const key = lower(value || 'single_choice');
  return QUESTION_TYPE_TO_PRISMA[key] || 'SINGLE_CHOICE';
}

function normalizeDifficulty(value) {
  const key = lower(value || 'medium');
  return DIFFICULTY_TO_PRISMA[key] || 'MEDIUM';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function safeJson(value, fallback = null) {
  if (value === undefined) return fallback;
  return value;
}

function truncate(value, length) {
  const text = String(value || '').trim();
  return text.length > length ? text.slice(0, length) : text;
}

function summarizeObject(value) {
  if (!value || typeof value !== 'object') return value ?? null;
  return stripUnsafeInternalMeta(value);
}

function getBusinessResultPayload(businessResult) {
  return businessResult?.result || businessResult?.data || {};
}

function extractDiagnosticQuestions(businessResult) {
  const result = getBusinessResultPayload(businessResult);
  const candidates = [
    result.questions,
    result.diagnostic_questions,
    result.pretest_questions,
    result.pre_test?.questions,
    result.diagnostic_pre_test?.questions,
  ];
  return candidates.find(Array.isArray) || [];
}

function extractAdaptiveDecision(businessResult) {
  const result = getBusinessResultPayload(businessResult);
  return result.decision || result.adaptive_decision || result.strategy || null;
}

function extractAdaptiveNextQuestion(businessResult) {
  const result = getBusinessResultPayload(businessResult);
  return result.next_question || result.nextQuestion || result.question || null;
}

function extractEvaluationResult(businessResult) {
  return getBusinessResultPayload(businessResult);
}

function getCorrectOption(fullQuestion) {
  const standard = fullQuestion?.standard_answer || fullQuestion?.standardAnswer || fullQuestion?.answer || null;
  if (typeof standard === 'string') return standard.trim();
  if (standard && typeof standard === 'object') {
    const candidate = standard.correct_option ?? standard.correctOption ?? standard.answer ?? standard.value;
    if (Array.isArray(candidate)) return candidate.map((item) => String(item).trim()).join(',');
    if (candidate != null) return String(candidate).trim();
  }

  const correctOption = (fullQuestion?.options || []).find((option) => option?.is_correct === true);
  return correctOption ? String(correctOption.key ?? correctOption.option_key ?? '').trim() : '';
}

function buildQuestionCorrectAnswer(fullQuestion) {
  const correctOption = getCorrectOption(fullQuestion);
  return {
    answer: correctOption,
    correct_option: correctOption,
  };
}

function normalizeFullQuestion(input, fallbackOrder = 1) {
  if (!input || typeof input !== 'object') {
    throw createTrainerAgentError('TRAINER_INVALID_QUESTION', '训练师返回题目结构异常', 502);
  }

  const questionKey = pickQuestionKey(input, fallbackOrder);
  const stem = String(input.stem ?? input.content ?? input.title ?? '').trim();
  const type = String(input.type ?? input.question_type ?? 'single_choice').trim();
  const options = Array.isArray(input.options) ? input.options : [];

  if (!questionKey || !stem) {
    throw createTrainerAgentError('TRAINER_INVALID_QUESTION', '训练师返回题目缺少 questionKey 或 stem', 502);
  }

  const normalizedOptions = options.map((option, index) => ({
    key: String(option?.key ?? option?.option_key ?? String.fromCharCode(65 + index)).trim(),
    content: String(option?.content ?? option?.option_content ?? option?.text ?? '').trim(),
    is_correct: option?.is_correct === true || option?.isCorrect === true,
  })).filter((option) => option.key && option.content);

  if (type.includes('choice') && normalizedOptions.length < 2) {
    throw createTrainerAgentError('TRAINER_INVALID_QUESTION', '选择题至少需要两个选项', 502);
  }

  const merged = stripUnsafeInternalMeta({
    ...input,
    question_key: questionKey,
    type,
    stem,
    options: normalizedOptions,
    question_order: Number(input.question_order ?? input.questionOrder ?? fallbackOrder),
  });

  if (!getCorrectOption(merged)) {
    throw createTrainerAgentError('TRAINER_INVALID_QUESTION', '训练师返回题目缺少标准答案', 502);
  }

  return merged;
}

function buildQuestionCreateData({ fullQuestion, courseId, knowledgePointId, userId }) {
  const publicQuestion = sanitizePublicQuestion(fullQuestion, fullQuestion.question_order || 1);
  const correctAnswer = buildQuestionCorrectAnswer(fullQuestion);
  const analysis = fullQuestion.explanation == null
    ? null
    : (typeof fullQuestion.explanation === 'string'
        ? fullQuestion.explanation
        : JSON.stringify(fullQuestion.explanation));

  return {
    course_id: courseId,
    knowledge_point_id: knowledgePointId,
    question_type: normalizeQuestionType(fullQuestion.type),
    title: truncate(publicQuestion.stem, 200),
    content: publicQuestion.stem,
    correct_answer: correctAnswer,
    analysis,
    difficulty_level: normalizeDifficulty(fullQuestion.difficulty),
    score: QUESTION_SCORE,
    is_ai_generated: true,
    source_type: 'ORIGINAL',
    generation_mode: 'ORIGINAL',
    generated_by_user_id: userId,
    model_name: 'bailian-langchain-trainer',
    prompt_version: 'trainer-agent-v1',
    content_hash: sha256(`${publicQuestion.stem}:${correctAnswer.answer}`),
    is_reusable: false,
    status: 'active',
    options: {
      create: (fullQuestion.options || []).map((option, index) => ({
        option_key: option.key,
        option_content: option.content,
        option_order: index + 1,
        is_correct: option.is_correct === true,
      })),
    },
  };
}

async function assertCourseAccess(userId, courseId, knowledgePointId) {
  const [student, course, knowledgePoint, enrollment] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: userId },
      include: { profile: true },
    }),
    prisma.course.findUnique({
      where: { course_id: courseId },
    }),
    prisma.knowledgePoint.findUnique({
      where: { knowledge_point_id: knowledgePointId },
      include: { chapter: true },
    }),
    prisma.studentCourseEnrollment.findFirst({
      where: {
        student_user_id: userId,
        course_id: courseId,
        enrollment_status: { in: ['active', 'ACTIVE'] },
      },
      include: { teachingClass: true },
    }),
  ]);

  if (!student) throw createTrainerAgentError('STUDENT_NOT_FOUND', '学生不存在', 404);
  if (!course) throw createTrainerAgentError('COURSE_NOT_FOUND', '课程不存在', 404);
  if (!knowledgePoint) throw createTrainerAgentError('KNOWLEDGE_POINT_NOT_FOUND', '知识点不存在', 404);
  if (knowledgePoint.course_id !== courseId) {
    throw createTrainerAgentError('COURSE_KNOWLEDGE_POINT_MISMATCH', '知识点不属于该课程', 400);
  }
  if (!enrollment) {
    throw createTrainerAgentError('COURSE_ACCESS_DENIED', '当前学生没有该课程访问权', 403);
  }

  return { student, course, knowledgePoint, enrollment };
}

async function getTrainerContext(userId, params) {
  const { courseId, knowledgePointId } = params;
  const { student, course, knowledgePoint, enrollment } = await assertCourseAccess(userId, courseId, knowledgePointId);

  const [mastery, portrait, recentAnswers, wrongQuestions, recentSessions, activeSession] = await Promise.all([
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
    prisma.answerRecord.findMany({
      where: {
        student_user_id: userId,
        question: {
          course_id: courseId,
          knowledge_point_id: knowledgePointId,
        },
      },
      orderBy: [{ submitted_at: 'desc' }, { created_at: 'desc' }],
      take: 20,
      select: {
        answer_record_id: true,
        is_correct: true,
        score: true,
        max_score: true,
        submitted_at: true,
        created_at: true,
      },
    }),
    prisma.wrongQuestion.findMany({
      where: {
        student_user_id: userId,
        course_id: courseId,
        knowledge_point_id: knowledgePointId,
        status: { not: 'REMOVED' },
      },
      orderBy: { updated_at: 'desc' },
      take: 10,
      select: {
        wrong_question_id: true,
        wrong_reason: true,
        review_status: true,
        last_wrong_at: true,
        updated_at: true,
      },
    }),
    prisma.practiceSession.findMany({
      where: {
        student_user_id: userId,
        course_id: courseId,
        OR: [
          { knowledge_point_id: knowledgePointId },
          { questions: { some: { question: { knowledge_point_id: knowledgePointId } } } },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: 5,
      select: {
        practice_session_id: true,
        source_type: true,
        status: true,
        correct_count: true,
        wrong_count: true,
        question_count: true,
        created_at: true,
        submitted_at: true,
      },
    }),
    prisma.practiceSession.findFirst({
      where: {
        student_user_id: userId,
        course_id: courseId,
        knowledge_point_id: knowledgePointId,
        source_type: SOURCE_TYPE,
        status: { in: ACTIVE_STATUSES },
      },
      include: { trainer_detail: true },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  const answeredCount = recentAnswers.length;
  const correctCount = recentAnswers.filter((item) => item.is_correct === true).length;

  return {
    student: {
      userId: student.user_id,
      username: student.username,
      role: lower(student.role),
      profile: student.profile
        ? {
            realName: student.profile.real_name,
            major: student.profile.major,
            grade: student.profile.grade,
          }
        : null,
    },
    course: courseDto(course),
    chapter: chapterDto(knowledgePoint.chapter),
    knowledgePoint: knowledgePointDto(knowledgePoint),
    enrollment: {
      enrollmentId: enrollment.enrollment_id,
      teachingClassId: enrollment.teaching_class_id,
      teachingClassName: enrollment.teachingClass?.teaching_class_name || null,
      status: enrollment.enrollment_status,
    },
    mastery: {
      masteryScore: mastery?.mastery_score ?? null,
      masteryLevel: lower(mastery?.mastery_level),
      profileDataSufficient: Boolean(mastery),
      updatedAt: toIso(mastery?.updated_at),
    },
    studentPortrait: {
      profileDataSufficient: Boolean(portrait),
      learningTotalScore: portrait?.learning_total_score ?? null,
      masteryScore: portrait?.mastery_score ?? null,
      testScore: portrait?.test_score ?? null,
      wrongQuestionScore: portrait?.wrong_question_score ?? null,
      updatedAt: toIso(portrait?.updated_at),
    },
    recentPractice: {
      answerCount: answeredCount,
      correctCount,
      accuracy: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null,
      latestAnsweredAt: toIso(recentAnswers[0]?.submitted_at || recentAnswers[0]?.created_at),
      sessions: recentSessions.map((session) => ({
        sessionId: session.practice_session_id,
        sourceType: session.source_type,
        status: session.status,
        questionCount: session.question_count,
        correctCount: session.correct_count,
        wrongCount: session.wrong_count,
        createdAt: toIso(session.created_at),
        submittedAt: toIso(session.submitted_at),
      })),
    },
    recentErrors: wrongQuestions.map((item) => ({
      wrongQuestionId: item.wrong_question_id,
      wrongReason: lower(item.wrong_reason),
      reviewStatus: lower(item.review_status),
      lastWrongAt: toIso(item.last_wrong_at),
      updatedAt: toIso(item.updated_at),
    })),
    // 学习流节点只复用绑定到同一个 nodeExecution 的会话；普通训练页才受课程级活动会话约束。
    activeSession: workflowBinding(params) ? null : activeSession
      ? {
          sessionId: activeSession.practice_session_id,
          status: activeSession.status,
          currentPhase: activeSession.trainer_detail?.current_phase || null,
          currentQuestionKey: activeSession.trainer_detail?.current_question_key || null,
          startedAt: toIso(activeSession.started_at),
        }
      : null,
  };
}

function buildDiagnosticPayload(context, params) {
  const workflowCourse = {
    ...context.course,
    id: context.course.courseId,
    name: context.course.courseName,
    code: context.course.courseCode,
  };
  const workflowChapter = context.chapter
    ? {
        ...context.chapter,
        id: context.chapter.chapterId,
        name: context.chapter.chapterName,
      }
    : null;
  const workflowKnowledgePoint = {
    ...context.knowledgePoint,
    id: context.knowledgePoint.knowledgePointId,
    name: context.knowledgePoint.knowledgePointName,
    code: context.knowledgePoint.knowledgePointCode,
    difficulty: context.knowledgePoint.difficultyLevel,
  };

  return {
    student_profile: {
      profile_data_sufficient: context.studentPortrait.profileDataSufficient,
      mastery_score: context.mastery.masteryScore,
      mastery_level: context.mastery.masteryLevel,
      recent_accuracy: context.recentPractice.accuracy,
      recent_answer_count: context.recentPractice.answerCount,
    },
    course: workflowCourse,
    chapter: workflowChapter,
    knowledge_point: workflowKnowledgePoint,
    recent_practice: context.recentPractice,
    historical_error_patterns: context.recentErrors,
    active_session: context.activeSession,
    requested_question_count: params.questionCount,
  };
}

function buildInputSummary(context, payload) {
  return {
    courseId: context.course.courseId,
    knowledgePointId: context.knowledgePoint.knowledgePointId,
    masteryScore: context.mastery.masteryScore,
    profileDataSufficient: context.studentPortrait.profileDataSufficient,
    requestedQuestionCount: payload.requested_question_count,
  };
}

async function createRunRecord({ userId, courseId, practiceSessionId, requestId, mode, inputSummary }) {
  return prisma.agentRunRecord.create({
    data: {
      user_id: userId,
      student_user_id: userId,
      course_id: courseId,
      practice_session_id: practiceSessionId,
      agent_type: 'TRAINER',
      request_id: requestId,
      mode,
      status: 'RUNNING',
      input_summary: inputSummary,
      input_json: null,
    },
  });
}

function metadataElapsedMs(metadata) {
  if (metadata?.response_time_ms != null) return Math.round(Number(metadata.response_time_ms));
  if (metadata?.elapsed_time != null) return Math.round(Number(metadata.elapsed_time) * 1000);
  return null;
}

async function markRunSuccess(runId, metadata, outputSummary) {
  return prisma.agentRunRecord.updateMany({
    where: { agent_run_id: runId, status: 'RUNNING' },
    data: {
      status: 'SUCCESS',
      dify_workflow_run_id: metadata?.workflow_run_id || null,
      response_time_ms: metadata?.response_time_ms == null ? null : Math.round(Number(metadata.response_time_ms)),
      total_tokens: metadata?.total_tokens == null ? null : Math.round(Number(metadata.total_tokens)),
      elapsed_ms: metadataElapsedMs(metadata),
      output_summary: outputSummary,
      output_json: outputSummary,
    },
  });
}

async function markRunFailed(runId, err) {
  return prisma.agentRunRecord.updateMany({
    where: { agent_run_id: runId, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      error_code: err?.code || 'TRAINER_INTERNAL_ERROR',
      error_message: String(err?.message || '训练师调用失败').slice(0, 2000),
      output_summary: summarizeObject(err?.data || null),
    },
  }).catch(() => null);
}

async function failPracticeSession(sessionId, err) {
  await prisma.practiceSession.update({
    where: { practice_session_id: sessionId },
    data: {
      status: 'FAILED',
      submit_reason: 'WORKFLOW_FAILED',
      last_active_at: new Date(),
    },
  }).catch(() => null);

  await prisma.trainerSessionDetail.update({
    where: { practice_session_id: sessionId },
    data: {
      current_phase: 'workflow_failed',
      diagnostic_summary_json: {
        errorCode: err?.code || 'TRAINER_INTERNAL_ERROR',
        message: err?.message || '训练师调用失败',
      },
    },
  }).catch(() => null);
}

async function persistTrainerQuestion(tx, {
  sessionId,
  courseId,
  knowledgePointId,
  userId,
  fullQuestion,
  questionOrder,
  adaptiveAction = null,
}) {
  const normalized = normalizeFullQuestion({
    ...fullQuestion,
    question_order: questionOrder,
  }, questionOrder);
  const publicQuestion = sanitizePublicQuestion(normalized, questionOrder);
  const question = await tx.question.create({
    data: buildQuestionCreateData({
      fullQuestion: normalized,
      courseId,
      knowledgePointId,
      userId,
    }),
  });

  await tx.practiceSessionQuestion.create({
    data: {
      practice_session_id: sessionId,
      question_id: question.question_id,
      question_order: questionOrder,
    },
  });

  const trainerQuestion = await tx.trainerSessionQuestion.create({
    data: {
      practice_session_id: sessionId,
      question_id: question.question_id,
      question_key: publicQuestion.questionKey,
      question_order: questionOrder,
      full_question_json: normalized,
      public_question_json: publicQuestion,
      target_pitfall_id: normalized.target_pitfall?.id == null ? null : String(normalized.target_pitfall.id).slice(0, 100),
      target_pitfall_json: safeJson(normalized.target_pitfall, null),
      difficulty: publicQuestion.difficulty == null ? null : String(publicQuestion.difficulty).slice(0, 20),
      adaptive_action: adaptiveAction == null ? null : String(adaptiveAction).slice(0, 50),
      status: 'active',
    },
  });

  return { question, trainerQuestion, publicQuestion, fullQuestion: normalized };
}

async function createTrainerSession(userId, params) {
  // 传统 Trainer API 的 questionCount 仅表示首批诊断题数；学习流才通过 practiceConfig 声明节点退出题量。
  const practiceConfig = normalizePracticeConfig(
    params.practiceConfig || {},
    params.practiceConfig ? params.questionCount : TRAINER_NODE_DEFAULTS.targetQuestionCount,
  );
  const normalizedParams = { ...params, questionCount: practiceConfig.targetQuestionCount };
  const binding = workflowBinding(normalizedParams);
  const context = await getTrainerContext(userId, normalizedParams);

  // 幂等: 如果已有活动会话, 直接返回 (不抛错)
  if (context.activeSession) {
    const existingSession = await getTrainerSession(userId, context.activeSession.sessionId);
    return { ...existingSession, reused: true };
  }

  const existingRun = await prisma.agentRunRecord.findFirst({
    where: {
      user_id: userId,
      request_id: normalizedParams.requestId,
      agent_type: 'TRAINER',
      mode: 'diagnostic_pre_test',
      status: 'SUCCESS',
      practice_session_id: { not: null },
    },
    orderBy: { created_at: 'desc' },
  });
  if (existingRun?.practice_session_id) {
    return getTrainerSession(userId, existingRun.practice_session_id);
  }

  const payload = buildDiagnosticPayload(context, normalizedParams);
  let session;
  let runRecord;

  await prisma.$transaction(async (tx) => {
    session = await tx.practiceSession.create({
      data: {
        student_user_id: userId,
          course_id: normalizedParams.courseId,
          knowledge_point_id: normalizedParams.knowledgePointId,
        teaching_class_id: context.enrollment.teachingClassId,
        mode: PRACTICE_MODE,
        answer_mode: 'SINGLE',
        question_count: 0,
        status: 'IN_PROGRESS',
        current_item_index: 0,
        last_active_at: new Date(),
        max_score: 0,
        source_type: SOURCE_TYPE,
          navigation_config: {
            navigationMode: 'ADAPTIVE',
            allowModifyConfirmedAnswer: false,
            showResultAfterItemSubmit: true,
            practiceConfig,
            ...(binding ? { learningWorkflow: binding } : {}),
          },
      },
    });

    await tx.trainerSessionDetail.create({
      data: {
        practice_session_id: session.practice_session_id,
        current_phase: 'diagnostic_generating',
        mastery_before: context.mastery.masteryScore,
          question_count: practiceConfig.targetQuestionCount,
          diagnostic_summary_json: {
            contextLoaded: true,
            requestedQuestionCount: practiceConfig.targetQuestionCount,
            practiceConfig,
            ...(binding ? { learningWorkflow: binding } : {}),
          },
        },
      });

      if (binding) {
        const linked = await tx.learningSessionNodeRun.updateMany({
          where: {
            node_run_id: binding.nodeExecutionId,
            session_id: binding.learningSessionId,
            status: 'RUNNING',
            execution_version: binding.executionVersion,
          },
          data: { trainer_session_id: session.practice_session_id, agent_type: 'TRAINER' },
        });
        if (!linked.count) {
          throw createTrainerAgentError('TRAINER_RUN_CANCELLED', '学习流节点已经结束，不能创建训练会话', 409);
        }
      }

    runRecord = await tx.agentRunRecord.create({
      data: {
        user_id: userId,
        student_user_id: userId,
          course_id: normalizedParams.courseId,
        practice_session_id: session.practice_session_id,
        agent_type: 'TRAINER',
          request_id: normalizedParams.requestId,
        mode: 'diagnostic_pre_test',
        status: 'RUNNING',
        input_summary: buildInputSummary(context, payload),
        input_json: null,
      },
    });
  });

  try {
    const { businessResult, metadata } = await trainerRuntimeService.runTrainerWorkflow({
      mode: 'diagnostic_pre_test',
      requestId: normalizedParams.requestId,
      payload,
      locale: normalizedParams.locale,
    });

    // 模型调用结束后，在任何题目落库前重新确认学习流 nodeExecution 仍有效。
    await assertWorkflowExecutionActive(session.practice_session_id, binding);

    const questions = extractDiagnosticQuestions(businessResult)
      .slice(0, practiceConfig.targetQuestionCount)
      .map((question, index) => normalizeFullQuestion(question, index + 1));

    if (questions.length === 0) {
      throw createTrainerAgentError('TRAINER_NO_QUESTIONS', '训练师未返回可用诊断题', 502);
    }

    await prisma.$transaction(async (tx) => {
      const persisted = [];
      for (let i = 0; i < questions.length; i += 1) {
        persisted.push(await persistTrainerQuestion(tx, {
          sessionId: session.practice_session_id,
          courseId: normalizedParams.courseId,
          knowledgePointId: normalizedParams.knowledgePointId,
          userId,
          fullQuestion: questions[i],
          questionOrder: i + 1,
        }));
      }

      await tx.practiceSession.update({
        where: { practice_session_id: session.practice_session_id },
        data: {
          question_count: persisted.length,
          max_score: persisted.length * QUESTION_SCORE,
          current_item_id: persisted[0].question.question_id,
          current_item_index: 0,
          source_id: runRecord.agent_run_id,
          last_active_at: new Date(),
        },
      });

      await tx.trainerSessionDetail.update({
        where: { practice_session_id: session.practice_session_id },
        data: {
          current_phase: 'pretest_ready',
          current_question_key: persisted[0].publicQuestion.questionKey,
          question_count: persisted.length,
          diagnostic_summary_json: {
            requestId: businessResult.request_id || normalizedParams.requestId,
          mode: businessResult.mode || 'diagnostic_pre_test',
          questionCount: persisted.length,
          practiceConfig,
          ...(binding ? { learningWorkflow: binding } : {}),
            summary: getBusinessResultPayload(businessResult).summary || null,
          },
        },
      });
    });

    await markRunSuccess(runRecord.agent_run_id, metadata, {
      requestId: businessResult.request_id || normalizedParams.requestId,
      mode: businessResult.mode || 'diagnostic_pre_test',
      questionCount: questions.length,
    });

    return getTrainerSession(userId, session.practice_session_id);
  } catch (err) {
    if (isCancelledError(err)) {
      return { cancelled: true, session: await getTrainerSession(userId, session.practice_session_id).catch(() => null) };
    }
    await markRunFailed(runRecord.agent_run_id, err);
    await failPracticeSession(session.practice_session_id, err);
    throw err;
  }
}

async function loadTrainerSession(userId, sessionId) {
  const session = await prisma.practiceSession.findUnique({
    where: { practice_session_id: sessionId },
    include: {
      course: true,
      knowledge_point: { include: { chapter: true } },
      trainer_detail: true,
      trainer_questions: {
        orderBy: { question_order: 'asc' },
        include: {
          question: true,
          answer_details: {
            include: { answer_record: true },
          },
        },
      },
      answer_records: {
        orderBy: { created_at: 'asc' },
        include: { trainer_answer_detail: true },
      },
      agent_run_records: {
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (!session || session.source_type !== SOURCE_TYPE) {
    throw createTrainerAgentError('SESSION_NOT_FOUND', '训练师会话不存在', 404);
  }
  if (session.student_user_id !== userId) {
    throw createTrainerAgentError('SESSION_ACCESS_DENIED', '无权访问该训练师会话', 403);
  }
  return session;
}

function findAnswerForTrainerQuestion(session, trainerQuestion) {
  return (session.answer_records || []).find((record) => record.question_id === trainerQuestion.question_id);
}

function trainerQuestionPublicDto(trainerQuestion) {
  return trainerQuestion?.public_question_json || null;
}

function answerFeedbackDto(answerRecord, trainerDetail, trainerQuestion) {
  if (!answerRecord) return null;
  const fullQuestion = trainerQuestion?.full_question_json || {};
  return {
    answerResult: {
      ...answerRecordDto(answerRecord),
      correctOption: getCorrectOption(fullQuestion),
      explanation: fullQuestion.explanation || null,
      distractorAnalysis: fullQuestion.distractor_analysis || fullQuestion.distractorAnalysis || null,
      targetPitfall: fullQuestion.target_pitfall || null,
    },
    evaluation: trainerDetail?.deep_evaluation_json || null,
    adaptiveDecision: trainerDetail?.adaptive_decision_json || null,
  };
}

function buildSessionView(session) {
  const answerByQuestionId = new Map((session.answer_records || []).map((record) => [record.question_id, record]));
  const completedQuestions = [];
  let currentQuestion = null;
  let latestFeedback = null;
  let latestAdaptiveDecision = null;

  for (const trainerQuestion of session.trainer_questions || []) {
    const answerRecord = answerByQuestionId.get(trainerQuestion.question_id);
    if (answerRecord) {
      const detail = answerRecord.trainer_answer_detail;
      const feedback = answerFeedbackDto(answerRecord, detail, trainerQuestion);
      completedQuestions.push({
        question: trainerQuestionPublicDto(trainerQuestion),
        ...feedback,
      });
      latestFeedback = feedback;
      latestAdaptiveDecision = detail?.adaptive_decision_json || latestAdaptiveDecision;
    } else if (!currentQuestion && !isFinalStatus(session.status)) {
      currentQuestion = trainerQuestionPublicDto(trainerQuestion);
    }
  }

  const correctCount = (session.answer_records || []).filter((record) => record.is_correct === true).length;
  const progress = progressDto({
    completedCount: completedQuestions.length,
    totalCount: session.trainer_questions?.length || session.question_count || 0,
    correctCount,
  });

  return {
    session: sessionDto(session),
    course: courseDto(session.course),
    chapter: chapterDto(session.knowledge_point?.chapter),
    knowledgePoint: knowledgePointDto(session.knowledge_point),
    currentQuestion,
    completedQuestions,
    progress,
    latestFeedback,
    latestAdaptiveDecision,
    practiceConfig: normalizePracticeConfig(
      session.trainer_detail?.diagnostic_summary_json?.practiceConfig
        || session.navigation_config?.practiceConfig
        || {},
      session.trainer_detail?.question_count || session.question_count,
    ),
  };
}

async function getTrainerSession(userId, sessionId) {
  const session = await loadTrainerSession(userId, sessionId);
  const mastery = await prisma.studentMasteryRecord.findUnique({
    where: {
      student_user_id_course_id_knowledge_point_id: {
        student_user_id: Number(userId),
        course_id: session.course_id,
        knowledge_point_id: session.knowledge_point_id,
      },
    },
  }).catch(() => null);
  const practiceConfig = normalizePracticeConfig(
    session.trainer_detail?.diagnostic_summary_json?.practiceConfig
      || session.navigation_config?.practiceConfig
      || {},
    session.trainer_detail?.question_count || session.question_count,
  );
  const completion = shouldCompleteTrainerNode(buildCompletionContext(session, mastery?.mastery_score ?? null, practiceConfig));
  return {
    ...buildSessionView(session),
    practiceConfig,
    currentMastery: mastery?.mastery_score ?? session.trainer_detail?.mastery_after ?? null,
    completion,
    events: buildEventsFromSession(session),
  };
}

async function listTrainerSessions(userId, query = {}) {
  const courseId = query.courseId || query.course_id ? Number.parseInt(query.courseId ?? query.course_id, 10) : null;
  const sessions = await prisma.practiceSession.findMany({
    where: {
      student_user_id: userId,
      source_type: SOURCE_TYPE,
      ...(courseId ? { course_id: courseId } : {}),
    },
    include: {
      course: true,
      knowledge_point: true,
      trainer_detail: true,
    },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  return sessions.map((session) => ({
    session: sessionDto(session),
    course: courseDto(session.course),
    knowledgePoint: knowledgePointDto(session.knowledge_point),
  }));
}

function deterministicGrade(fullQuestion, selectedOption) {
  const correctOption = getCorrectOption(fullQuestion);
  const selected = String(selectedOption || '').trim().toUpperCase();
  const correct = String(correctOption || '').trim().toUpperCase();
  const isCorrect = Boolean(correct) && selected === correct;
  return {
    selectedOption: selected,
    correctOption,
    isCorrect,
    score: isCorrect ? QUESTION_SCORE : 0,
    maxScore: QUESTION_SCORE,
    gradingStatus: 'AUTO_GRADED',
  };
}

async function getNextUnansweredQuestion(sessionId, excludeQuestionId = null) {
  const records = await prisma.answerRecord.findMany({
    where: { practice_session_id: sessionId },
    select: { question_id: true },
  });
  const answered = new Set(records.map((item) => item.question_id));
  if (excludeQuestionId) answered.add(excludeQuestionId);

  return prisma.trainerSessionQuestion.findFirst({
    where: {
      practice_session_id: sessionId,
      status: 'active',
      question_id: { notIn: [...answered] },
    },
    orderBy: { question_order: 'asc' },
  });
}

async function persistAdaptiveQuestionIfNeeded({ session, businessResult, userId }) {
  const practiceConfig = normalizePracticeConfig(
    session.trainer_detail?.diagnostic_summary_json?.practiceConfig
      || session.navigation_config?.practiceConfig
      || {},
    session.trainer_detail?.question_count || session.question_count,
  );
  if ((session.trainer_questions || []).length >= practiceConfig.maxQuestionCount) return null;
  await assertWorkflowExecutionActive(session.practice_session_id, getWorkflowBinding(session));
  const nextExisting = await getNextUnansweredQuestion(session.practice_session_id);
  if (nextExisting) return nextExisting.public_question_json;

  const nextQuestion = extractAdaptiveNextQuestion(businessResult);
  if (!nextQuestion) return null;

  const decision = extractAdaptiveDecision(businessResult);
  const adaptiveAction = decision?.action || nextQuestion.adaptive_action || null;
  const maxOrder = (session.trainer_questions || []).reduce((max, item) => Math.max(max, item.question_order || 0), 0);

  let publicQuestion;
  await prisma.$transaction(async (tx) => {
    const persisted = await persistTrainerQuestion(tx, {
      sessionId: session.practice_session_id,
      courseId: session.course_id,
      knowledgePointId: session.knowledge_point_id,
      userId,
      fullQuestion: nextQuestion,
      questionOrder: maxOrder + 1,
      adaptiveAction,
    });
    publicQuestion = persisted.publicQuestion;

    await tx.practiceSession.update({
      where: { practice_session_id: session.practice_session_id },
      data: {
        question_count: { increment: 1 },
        max_score: { increment: QUESTION_SCORE },
        current_item_id: persisted.question.question_id,
        current_item_index: maxOrder,
        last_active_at: new Date(),
      },
    });

    await tx.trainerSessionDetail.update({
      where: { practice_session_id: session.practice_session_id },
      data: {
        current_phase: 'adaptive',
        current_question_key: publicQuestion.questionKey,
        question_count: { increment: 1 },
      },
    });
  });

  return publicQuestion;
}

function buildDeepEvaluationPayload({ session, trainerQuestion, fullQuestion, answerResult, context }) {
  return {
    course: {
      ...courseDto(session.course),
      id: session.course?.course_id,
      name: session.course?.course_name,
      code: session.course?.course_code,
    },
    chapter: session.knowledge_point?.chapter
      ? {
          ...chapterDto(session.knowledge_point.chapter),
          id: session.knowledge_point.chapter.chapter_id,
          name: session.knowledge_point.chapter.chapter_name,
        }
      : null,
    knowledge_point: {
      ...knowledgePointDto(session.knowledge_point),
      id: session.knowledge_point?.knowledge_point_id,
      name: session.knowledge_point?.knowledge_point_name,
      code: session.knowledge_point?.knowledge_point_code,
      difficulty: lower(session.knowledge_point?.difficulty_level),
    },
    question: fullQuestion,
    current_question: fullQuestion,
    standard_answer: fullQuestion.standard_answer || fullQuestion.standardAnswer || buildQuestionCorrectAnswer(fullQuestion),
    student_answer: {
      selected_option: answerResult.selectedOption,
      confidence_level: context.confidenceLevel,
      time_spent_seconds: context.timeSpentSeconds,
    },
    deterministic_result: {
      is_correct: answerResult.isCorrect,
      correct_option: answerResult.correctOption,
      score: answerResult.score,
      max_score: answerResult.maxScore,
    },
    session_progress: {
      session_id: session.practice_session_id,
      question_key: trainerQuestion.question_key,
      question_order: trainerQuestion.question_order,
    },
  };
}

async function loadPendingTrainerIntervention(userId, session) {
  return claimPendingIntervention({
    studentUserId: userId,
    targetAgent: 'trainer',
    courseId: session.course_id,
    knowledgePointId: session.knowledge_point_id,
    practiceSessionId: session.practice_session_id,
  });
}

function interventionPayload(intervention) {
  if (!intervention) return null;
  return {
    id: intervention.intervention_uid,
    action: intervention.action,
    params: intervention.params_json || {},
    reason: intervention.trigger_reason || '',
    source: intervention.source,
  };
}

function buildAdaptivePayload({ session, trainerQuestion, answerResult, evaluation, pendingIntervention = null }) {
  const fullQuestion = trainerQuestion.full_question_json || {};
  return {
    session: {
      session_id: session.practice_session_id,
      question_count: session.trainer_questions?.length || session.question_count,
      answered_count: session.answer_records?.length || 0,
    },
    current_question: fullQuestion,
    public_question: trainerQuestion.public_question_json,
    standard_answer: fullQuestion.standard_answer || fullQuestion.standardAnswer || buildQuestionCorrectAnswer(fullQuestion),
    student_answer: {
      selected_option: answerResult.selectedOption,
      answer: answerResult.selectedOption,
    },
    deterministic_result: {
      is_correct: answerResult.isCorrect,
      correct_option: answerResult.correctOption,
      selected_option: answerResult.selectedOption,
    },
    deep_evaluation: evaluation,
    diagnostician_instruction: interventionPayload(pendingIntervention),
    recent_questions: (session.trainer_questions || []).map((item) => ({
      question_key: item.question_key,
      question_order: item.question_order,
      difficulty: item.difficulty,
      adaptive_action: item.adaptive_action,
    })),
  };
}

// ========================
// Trainer 节点退出规则 (硬性上限 + 业务完成条件)
// ========================

function shouldCompleteTrainerNode(context) {
  const {
    answeredCount, targetQuestionCount, minQuestionCount, maxQuestionCount,
    consecutiveCorrect, currentMastery, targetMastery,
    consecutiveCorrectToFinish,
  } = context;

  // maxQuestionCount 是硬上限：无论 Agent 给出何种策略，都不能继续生成题目。
  if (answeredCount >= maxQuestionCount) {
    return { shouldComplete: true, reason: 'max_questions_reached' };
  }
  if (answeredCount >= targetQuestionCount) {
    return { shouldComplete: true, reason: 'target_questions_reached' };
  }
  if (answeredCount >= minQuestionCount && currentMastery != null && Number(currentMastery) >= targetMastery) {
    return { shouldComplete: true, reason: 'target_mastery_reached', earlyReached: true };
  }
  if (answeredCount >= minQuestionCount && consecutiveCorrect >= consecutiveCorrectToFinish) {
    return { shouldComplete: true, reason: 'consecutive_correct_reached', earlyReached: true };
  }
  return { shouldComplete: false, reason: 'in_progress' };
}

function buildCompletionContext(session, currentMastery = null, practiceConfig = null) {
  const answered = session.answer_records || [];
  const answeredCount = answered.length;
  const config = practiceConfig || normalizePracticeConfig(
    session.trainer_detail?.diagnostic_summary_json?.practiceConfig
      || session.navigation_config?.practiceConfig
      || {},
    session.trainer_detail?.question_count || session.question_count,
  );
  let consecutiveCorrect = 0;
  for (const record of answered) {
    consecutiveCorrect = record.is_correct === true ? consecutiveCorrect + 1 : 0;
  }

  const correctCount = answered.filter((r) => r.is_correct === true).length;
  const accuracy = answeredCount > 0 ? correctCount / answeredCount : 0;

  return {
    answeredCount,
    correctCount,
    targetQuestionCount: config.targetQuestionCount,
    minQuestionCount: config.minQuestionCount,
    maxQuestionCount: config.maxQuestionCount,
    consecutiveCorrect,
    currentMastery,
    targetMastery: config.targetMastery,
    consecutiveCorrectToFinish: config.consecutiveCorrectToFinish,
    accuracy,
  };
}

async function submitTrainerAnswer(userId, sessionId, params) {
  let session = await loadTrainerSession(userId, sessionId);
  await assertWorkflowExecutionActive(sessionId, getWorkflowBinding(session));
  if (isFinalStatus(session.status)) {
    throw createTrainerAgentError('SESSION_CLOSED', '完成或放弃后的会话不能继续答题', 400);
  }

  // 检查是否已完成 (shouldComplete=true 后拒绝继续生成题目)
  if (session.trainer_detail?.current_phase === 'completed') {
    throw createTrainerAgentError('SESSION_ALREADY_COMPLETED', '训练师练习已完成，不能继续答题', 400);
  }

  const trainerQuestion = (session.trainer_questions || []).find((item) => item.question_key === params.questionKey);
  if (!trainerQuestion) {
    throw createTrainerAgentError('QUESTION_NOT_IN_SESSION', '题目不属于该训练师会话', 404);
  }

  const existingAnswer = findAnswerForTrainerQuestion(session, trainerQuestion);
  if (existingAnswer) {
    const nextQuestion = await getNextUnansweredQuestion(sessionId);
    return {
      ...answerFeedbackDto(existingAnswer, existingAnswer.trainer_answer_detail, trainerQuestion),
      nextQuestion: nextQuestion?.public_question_json || null,
      sessionProgress: buildSessionView(session).progress,
      agentEvents: buildEventsFromSession(session),
      duplicated: true,
    };
  }

  const fullQuestion = trainerQuestion.full_question_json || {};
  const answerResult = deterministicGrade(fullQuestion, params.selectedOption);
  const now = new Date();
  let answerRecord;

  await prisma.$transaction(async (tx) => {
    answerRecord = await tx.answerRecord.create({
      data: {
        student_user_id: userId,
        question_id: trainerQuestion.question_id,
        practice_session_id: sessionId,
        answer_content: {
          answer: answerResult.selectedOption,
          selected_option: answerResult.selectedOption,
        },
        started_at: session.started_at || now,
        submitted_at: now,
        duration_seconds: params.timeSpentSeconds,
        attempt_no: 1,
        item_status: 'GRADED',
        is_correct: answerResult.isCorrect,
        score: answerResult.score,
        max_score: answerResult.maxScore,
        grading_status: 'AUTO_GRADED',
        feedback: answerResult.isCorrect ? '回答正确。' : `正确答案是 ${answerResult.correctOption}。`,
        auto_added_wrong_book: !answerResult.isCorrect,
        saved_at: now,
        graded_at: now,
      },
    });
  });

  const evalRequestId = `${params.requestId}_${sessionId}_${trainerQuestion.question_key}`;
  const evalRun = await createRunRecord({
    userId,
    courseId: session.course_id,
    practiceSessionId: sessionId,
    requestId: evalRequestId.slice(0, 128),
    mode: 'deep_evaluation',
    inputSummary: {
      questionKey: trainerQuestion.question_key,
      selectedOption: answerResult.selectedOption,
      isCorrect: answerResult.isCorrect,
    },
  });

  let evaluation;
  let evaluationFailed = false;
  try {
    const payload = buildDeepEvaluationPayload({
      session,
      trainerQuestion,
      fullQuestion,
      answerResult,
      context: params,
    });
    const { businessResult, metadata } = await trainerRuntimeService.runTrainerWorkflow({
      mode: 'deep_evaluation',
      requestId: evalRequestId.slice(0, 128),
      payload,
      locale: params.locale,
    });
    await assertWorkflowExecutionActive(sessionId, getWorkflowBinding(session));
    evaluation = extractEvaluationResult(businessResult);
    await markRunSuccess(evalRun.agent_run_id, metadata, {
      mode: businessResult.mode || 'deep_evaluation',
      questionKey: trainerQuestion.question_key,
      verdict: evaluation.verdict || null,
      errorType: evaluation.error_type || null,
    });
  } catch (err) {
    if (isCancelledError(err)) throw err;
    evaluationFailed = true;
    evaluation = {
      status: 'unavailable',
      errorCode: err?.code || 'TRAINER_DEEP_EVALUATION_FAILED',
      message: '深度批改暂不可用，已保存确定性判分结果。',
    };
    await markRunFailed(evalRun.agent_run_id, err);
  }

  const deterministicResultJson = {
    isCorrect: answerResult.isCorrect,
    selectedOption: answerResult.selectedOption,
    correctOption: answerResult.correctOption,
    score: answerResult.score,
    maxScore: answerResult.maxScore,
  };

  let adaptiveDecision = null;
  let nextQuestion = null;

  await prisma.trainerAnswerDetail.create({
    data: {
      answer_record_id: answerRecord.answer_record_id,
      trainer_session_question_id: trainerQuestion.trainer_session_question_id,
      confidence_level: params.confidenceLevel,
      deep_evaluation_json: evaluation,
      deterministic_result_json: deterministicResultJson,
    },
  });

  const questionMap = {
    [trainerQuestion.question_id]: {
      question_id: trainerQuestion.question_id,
      course_id: session.course_id,
      knowledge_point_id: session.knowledge_point_id,
    },
  };
  const answerResults = [{
    question_id: trainerQuestion.question_id,
    is_correct: answerResult.isCorrect,
    score: answerResult.score,
    max_score: answerResult.maxScore,
    grading_status: 'AUTO_GRADED',
  }];

  const [masteryUpdates, wrongQuestionUpdates] = await Promise.all([
    masteryService.updateMasteryAfterSubmission({
      studentId: userId,
      courseId: session.course_id,
      answerResults,
      questionMap,
    }),
    wrongQuestionService.createOrUpdateWrongQuestions({
      studentId: userId,
      submissionId: null,
      answerResults,
      questionMap,
      sourceType: 'ai_trainer',
    }),
  ]);

  session = await loadTrainerSession(userId, sessionId);

  const currentMasteryRecord = await prisma.studentMasteryRecord.findUnique({
    where: {
      student_user_id_course_id_knowledge_point_id: {
        student_user_id: Number(userId),
        course_id: session.course_id,
        knowledge_point_id: session.knowledge_point_id,
      },
    },
  }).catch(() => null);
  const practiceConfig = normalizePracticeConfig(
    session.trainer_detail?.diagnostic_summary_json?.practiceConfig
      || session.navigation_config?.practiceConfig
      || {},
    session.trainer_detail?.question_count || session.question_count,
  );
  const completionContext = buildCompletionContext(session, currentMasteryRecord?.mastery_score ?? null, practiceConfig);
  const completion = shouldCompleteTrainerNode(completionContext);

  if (!completion.shouldComplete && !evaluationFailed) {
    const adaptiveRequestId = `${params.requestId}_adaptive_${sessionId}_${trainerQuestion.question_key}`.slice(0, 128);
    const adaptiveRun = await createRunRecord({
      userId,
      courseId: session.course_id,
      practiceSessionId: sessionId,
      requestId: adaptiveRequestId,
      mode: 'adaptive_training',
      inputSummary: {
        questionKey: trainerQuestion.question_key,
        isCorrect: answerResult.isCorrect,
      },
    });
    const pendingTrainerIntervention = await loadPendingTrainerIntervention(userId, session);
    if (pendingTrainerIntervention) {
      adaptiveRun.input_summary = {
        ...(adaptiveRun.input_summary || {}),
        diagnosticianInstruction: interventionPayload(pendingTrainerIntervention),
      };
      await prisma.agentRunRecord.update({
        where: { agent_run_id: adaptiveRun.agent_run_id },
        data: { input_summary: adaptiveRun.input_summary },
      }).catch(() => null);
    }

    try {
      const { businessResult, metadata } = await trainerRuntimeService.runTrainerWorkflow({
        mode: 'adaptive_training',
        requestId: adaptiveRequestId,
        payload: buildAdaptivePayload({
          session,
          trainerQuestion,
          answerResult,
          evaluation,
          pendingIntervention: pendingTrainerIntervention,
        }),
        locale: params.locale,
      });
      adaptiveDecision = extractAdaptiveDecision(businessResult);
      nextQuestion = await persistAdaptiveQuestionIfNeeded({
        session,
        businessResult,
        userId,
      });
      await markRunSuccess(adaptiveRun.agent_run_id, metadata, {
        mode: businessResult.mode || 'adaptive_training',
        questionKey: trainerQuestion.question_key,
        action: adaptiveDecision?.action || null,
        hasNextQuestion: Boolean(nextQuestion),
        appliedIntervention: pendingTrainerIntervention?.intervention_uid || null,
      });
      if (pendingTrainerIntervention) {
        await applyClaimedIntervention(pendingTrainerIntervention, {
          runId: adaptiveRun.agent_run_id,
          result: {
            adaptiveAction: adaptiveDecision?.action || null,
            nextQuestion: Boolean(nextQuestion),
          },
        }).catch(() => null);
      }
    } catch (err) {
      if (isCancelledError(err)) throw err;
      adaptiveDecision = {
        status: 'unavailable',
        errorCode: err?.code || 'TRAINER_ADAPTIVE_FAILED',
        message: '自适应策略暂不可用，请继续完成已有题目。',
      };
      nextQuestion = (await getNextUnansweredQuestion(sessionId))?.public_question_json || null;
      await markRunFailed(adaptiveRun.agent_run_id, err);
      if (pendingTrainerIntervention) {
        await failClaimedIntervention(pendingTrainerIntervention, {
          runId: adaptiveRun.agent_run_id,
          error: err,
        }).catch(() => null);
      }
    }
  } else if (!completion.shouldComplete) {
    nextQuestion = (await getNextUnansweredQuestion(sessionId))?.public_question_json || null;
  }

  await prisma.trainerAnswerDetail.update({
    where: { answer_record_id: answerRecord.answer_record_id },
    data: {
      adaptive_decision_json: safeJson(adaptiveDecision, null),
    },
  });

  const latestRecords = await prisma.answerRecord.findMany({
    where: { practice_session_id: sessionId },
    select: { is_correct: true, score: true, max_score: true, duration_seconds: true },
  });
  const correctCount = latestRecords.filter((record) => record.is_correct === true).length;
  const totalScore = latestRecords.reduce((sum, record) => sum + (record.score || 0), 0);
  const maxScore = latestRecords.reduce((sum, record) => sum + (record.max_score || 0), 0);
  const totalDuration = latestRecords.reduce((sum, record) => sum + (record.duration_seconds || 0), 0);

  await prisma.practiceSession.update({
    where: { practice_session_id: sessionId },
    data: {
      correct_count: correctCount,
      wrong_count: Math.max(0, latestRecords.length - correctCount),
      total_score: totalScore,
      max_score: maxScore || session.max_score,
      duration_seconds: totalDuration || null,
      last_active_at: new Date(),
    },
  });

  if (nextQuestion) {
    await prisma.trainerSessionDetail.update({
      where: { practice_session_id: sessionId },
      data: {
        current_phase: 'answering',
        current_question_key: nextQuestion.questionKey,
      },
    }).catch(() => null);
  }

  const refreshed = await loadTrainerSession(userId, sessionId);

  // 如果应该完成，清空 nextQuestion 并标记练习完成
  if (completion.shouldComplete) {
    nextQuestion = null;
    await prisma.trainerSessionDetail.update({
      where: { practice_session_id: sessionId },
      data: { current_phase: 'completed' },
    }).catch(() => null);

    console.log('[trainer.service] Trainer 节点完成:', {
      sessionId,
      reason: completion.reason,
      answeredCount: completionContext.answeredCount,
      correctCount: completionContext.correctCount,
      accuracy: Math.round(completionContext.accuracy * 100) + '%',
    });
  }

  let diagnosticianIntervention = null;
  try {
    diagnosticianIntervention = await diagnosticianService.maybeGenerateInterventionAfterTrainerAnswer(userId, sessionId, {
      locale: params.locale,
      requestId: `${params.requestId}_diagnostician_${sessionId}_${trainerQuestion.question_key}`.slice(0, 128),
    });
  } catch (err) {
    console.warn('[trainer.service] 诊断师干预触发失败:', {
      sessionId,
      questionKey: trainerQuestion.question_key,
      code: err?.code || 'DIAGNOSTICIAN_TRIGGER_FAILED',
      message: err?.message,
    });
  }

  return {
    answerResult: {
      answerRecordId: answerRecord.answer_record_id,
      questionKey: trainerQuestion.question_key,
      selectedOption: answerResult.selectedOption,
      correctOption: answerResult.correctOption,
      isCorrect: answerResult.isCorrect,
      score: answerResult.score,
      maxScore: answerResult.maxScore,
      explanation: fullQuestion.explanation || null,
      distractorAnalysis: fullQuestion.distractor_analysis || fullQuestion.distractorAnalysis || null,
      targetPitfall: fullQuestion.target_pitfall || null,
      wrongQuestionUpdates,
      masteryUpdates,
    },
    evaluation,
    adaptiveDecision,
    nextQuestion,
    sessionProgress: buildSessionView(refreshed).progress,
    agentEvents: buildEventsFromSession(refreshed),
    diagnosticianIntervention,
    duplicated: false,
    completion: {
      shouldComplete: completion.shouldComplete,
      reason: completion.reason,
      answeredCount: completionContext.answeredCount,
      correctCount: completionContext.correctCount,
      accuracy: Math.round(completionContext.accuracy * 100) / 100,
      maxQuestionCount: completionContext.maxQuestionCount,
      targetQuestionCount: completionContext.targetQuestionCount,
      minQuestionCount: completionContext.minQuestionCount,
      currentMastery: completionContext.currentMastery,
      targetMastery: completionContext.targetMastery,
      consecutiveCorrect: completionContext.consecutiveCorrect,
      consecutiveCorrectToFinish: completionContext.consecutiveCorrectToFinish,
      earlyReached: completion.earlyReached || false,
    },
  };
}

function buildErrorTypeDistribution(answerDetails) {
  const distribution = {};
  for (const detail of answerDetails) {
    const errorType = detail.deep_evaluation_json?.error_type || detail.deep_evaluation_json?.errorType;
    if (!errorType) continue;
    distribution[errorType] = (distribution[errorType] || 0) + 1;
  }
  return distribution;
}

function buildPitfallDistribution(trainerQuestions) {
  const distribution = {};
  for (const item of trainerQuestions || []) {
    const pitfall = item.target_pitfall_json;
    const key = item.target_pitfall_id || pitfall?.id || pitfall?.name;
    if (!key) continue;
    distribution[key] = {
      id: key,
      name: pitfall?.name || key,
      count: (distribution[key]?.count || 0) + 1,
    };
  }
  return Object.values(distribution);
}

async function buildTrainerReport(userId, sessionId) {
  const session = await loadTrainerSession(userId, sessionId);
  const answerDetails = (session.answer_records || [])
    .map((record) => record.trainer_answer_detail)
    .filter(Boolean);
  const answered = session.answer_records || [];
  const correctCount = answered.filter((record) => record.is_correct === true).length;
  const totalScore = answered.reduce((sum, record) => sum + (record.score || 0), 0);
  const maxScore = answered.reduce((sum, record) => sum + (record.max_score || 0), 0);
  const totalTimeSeconds = answered.reduce((sum, record) => sum + (record.duration_seconds || 0), 0);
  const masteryAfter = await prisma.studentMasteryRecord.findUnique({
    where: {
      student_user_id_course_id_knowledge_point_id: {
        student_user_id: userId,
        course_id: session.course_id,
        knowledge_point_id: session.knowledge_point_id,
      },
    },
  });

  const questionResults = (session.trainer_questions || []).map((trainerQuestion) => {
    const answerRecord = findAnswerForTrainerQuestion(session, trainerQuestion);
    const detail = answerRecord?.trainer_answer_detail;
    return {
      question: trainerQuestion.public_question_json,
      answerResult: answerRecord ? answerRecordDto(answerRecord) : null,
      deterministicResult: detail?.deterministic_result_json || null,
      evaluation: detail?.deep_evaluation_json || null,
      adaptiveDecision: detail?.adaptive_decision_json || null,
    };
  });

  const report = {
    title: '训练师训练总结',
    course: courseDto(session.course),
    chapter: chapterDto(session.knowledge_point?.chapter),
    knowledgePoint: knowledgePointDto(session.knowledge_point),
    sessionSummary: {
      sessionId: session.practice_session_id,
      completedCount: answered.length,
      correctCount,
      accuracy: answered.length > 0 ? Math.round((correctCount / answered.length) * 100) : 0,
      totalScore,
      maxScore,
      totalTimeSeconds,
      completedAt: toIso(session.submitted_at),
    },
    questionResults,
    errorTypeDistribution: buildErrorTypeDistribution(answerDetails),
    pitfallDistribution: buildPitfallDistribution(session.trainer_questions),
    masteryChange: {
      masteryBefore: session.trainer_detail?.mastery_before ?? null,
      masteryAfter: masteryAfter?.mastery_score ?? session.trainer_detail?.mastery_after ?? null,
    },
    trainerRecommendations: answerDetails
      .map((detail) => detail.deep_evaluation_json?.remediation || detail.deep_evaluation_json?.recommendation)
      .filter(Boolean),
    nextActions: [
      answered.length === 0 ? '完成至少一道训练题后查看薄弱点。' : null,
      correctCount < answered.length ? '优先回看本次错题的解析和补救建议。' : '保持当前节奏，可进入下一知识点训练。',
    ].filter(Boolean),
  };

  return report;
}

async function completeTrainerSession(userId, sessionId) {
  const session = await loadTrainerSession(userId, sessionId);
  if (session.status === 'ABANDONED') {
    throw createTrainerAgentError('SESSION_CLOSED', '已放弃的会话不能完成', 400);
  }

  const report = await buildTrainerReport(userId, sessionId);
  const masteryAfter = report.masteryChange.masteryAfter;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.practiceSession.update({
      where: { practice_session_id: sessionId },
      data: {
        status: 'SUBMITTED',
        submitted_at: session.submitted_at || now,
        submit_reason: 'TRAINER_COMPLETED',
        duration_seconds: report.sessionSummary.totalTimeSeconds || session.duration_seconds,
        correct_count: report.sessionSummary.correctCount,
        wrong_count: Math.max(0, report.sessionSummary.completedCount - report.sessionSummary.correctCount),
        total_score: report.sessionSummary.totalScore,
        max_score: report.sessionSummary.maxScore || session.max_score,
        last_active_at: now,
      },
    });
    await tx.trainerSessionDetail.update({
      where: { practice_session_id: sessionId },
      data: {
        current_phase: 'summary',
        mastery_after: masteryAfter,
        covered_pitfall_count: report.pitfallDistribution.length,
        final_report_json: report,
      },
    });
  });

  return {
    session: sessionDto(await prisma.practiceSession.findUnique({
      where: { practice_session_id: sessionId },
      include: { trainer_detail: true },
    })),
    report,
  };
}

async function abandonTrainerSession(userId, sessionId) {
  const session = await loadTrainerSession(userId, sessionId);
  if (isFinalStatus(session.status)) {
    return {
      abandoned: false,
      session: sessionDto(session),
    };
  }

  const now = new Date();
  const updated = await prisma.practiceSession.update({
    where: { practice_session_id: sessionId },
    data: {
      status: 'ABANDONED',
      submit_reason: 'USER_ABANDONED',
      last_active_at: now,
      duration_seconds: session.started_at
        ? Math.max(0, Math.round((now - new Date(session.started_at)) / 1000))
        : session.duration_seconds,
    },
    include: { trainer_detail: true },
  });
  await prisma.trainerSessionDetail.update({
    where: { practice_session_id: sessionId },
    data: { current_phase: 'abandoned' },
  }).catch(() => null);

  return {
    abandoned: true,
    session: sessionDto(updated),
  };
}

async function getTrainerReport(userId, sessionId) {
  const session = await loadTrainerSession(userId, sessionId);
  if (session.trainer_detail?.final_report_json) {
    return session.trainer_detail.final_report_json;
  }
  return buildTrainerReport(userId, sessionId);
}

function eventAt(type, at, title, data = {}) {
  return {
    type,
    title,
    at: toIso(at),
    data,
  };
}

function buildEventsFromSession(session) {
  const events = [];
  events.push(eventAt('session_created', session.created_at, '训练会话已创建', {
    sessionId: session.practice_session_id,
  }));
  events.push(eventAt('context_loaded', session.created_at, '已装配学生上下文', {
    courseId: session.course_id,
    knowledgePointId: session.knowledge_point_id,
  }));

  for (const run of session.agent_run_records || []) {
    events.push(eventAt('workflow_started', run.created_at, '训练师 Workflow 已启动', {
      mode: run.mode,
      requestId: run.request_id,
      status: run.status,
    }));
    if (run.status === 'FAILED') {
      events.push(eventAt('workflow_failed', run.created_at, '训练师 Workflow 调用失败', {
        mode: run.mode,
        errorCode: run.error_code,
      }));
    }
  }

  for (const question of session.trainer_questions || []) {
    events.push(eventAt(
      question.adaptive_action ? 'next_question_generated' : 'diagnostic_generated',
      question.created_at,
      question.adaptive_action ? '已生成自适应下一题' : '已生成诊断题',
      {
        questionKey: question.question_key,
        questionOrder: question.question_order,
        adaptiveAction: question.adaptive_action,
      },
    ));
  }

  for (const answer of session.answer_records || []) {
    events.push(eventAt('answer_submitted', answer.submitted_at || answer.created_at, '学生已提交答案', {
      questionId: answer.question_id,
      isCorrect: answer.is_correct,
    }));
    if (answer.trainer_answer_detail) {
      events.push(eventAt('deep_evaluation_completed', answer.trainer_answer_detail.created_at, '深度批改已完成', {
        answerRecordId: answer.answer_record_id,
      }));
      if (answer.is_correct === false) {
        events.push(eventAt('misconception_detected', answer.trainer_answer_detail.created_at, '已识别薄弱点', {
          answerRecordId: answer.answer_record_id,
          errorType: answer.trainer_answer_detail.deep_evaluation_json?.error_type || null,
        }));
      }
      if (answer.trainer_answer_detail.adaptive_decision_json) {
        events.push(eventAt('adaptive_decision_created', answer.trainer_answer_detail.updated_at, '已生成自适应策略', {
          answerRecordId: answer.answer_record_id,
          action: answer.trainer_answer_detail.adaptive_decision_json?.action || null,
        }));
      }
      events.push(eventAt('mastery_updated', answer.trainer_answer_detail.updated_at, '已更新掌握度记录', {
        answerRecordId: answer.answer_record_id,
      }));
    }
  }

  if (session.status === 'SUBMITTED') {
    events.push(eventAt('session_completed', session.submitted_at || session.updated_at, '训练会话已完成', {
      sessionId: session.practice_session_id,
    }));
  }

  return events
    .filter((event) => event.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

async function getTrainerEvents(userId, sessionId) {
  const session = await loadTrainerSession(userId, sessionId);
  return buildEventsFromSession(session);
}

module.exports = {
  SOURCE_TYPE,
  abandonTrainerSession,
  buildEventsFromSession,
  completeTrainerSession,
  createTrainerSession,
  deterministicGrade,
  getTrainerContext,
  getTrainerEvents,
  getTrainerReport,
  getTrainerSession,
  listTrainerSessions,
  normalizeFullQuestion,
  normalizePracticeConfig,
  shouldCompleteTrainerNode,
  buildCompletionContext,
  submitTrainerAnswer,
};
