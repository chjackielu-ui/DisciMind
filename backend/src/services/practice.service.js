// 学生自主练习服务
// 负责抽题、AI 补题、练习提交、AI 追问和错题操作

const prisma = require('../config/prisma');
const gradingService = require('./grading.service');
const wrongQuestionService = require('./wrong-question.service');
const masteryService = require('./mastery.service');
const aiService = require('./ai.service');
const OpenAI = require('openai');
const { checkAndExpireIfNeeded } = require('./attempt-expiration.service');

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
  medium: 'MEDIUM',
  hard: 'HARD',
};

const VALID_WRONG_STATUSES = new Set(['unresolved', 'mastered', 'removed']);
const SESSION_STATUS = {
  CREATED: 'CREATED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTING: 'SUBMITTING',
  SUBMITTED: 'SUBMITTED',
  EXPIRED: 'EXPIRED',
  ABANDONED: 'ABANDONED',
};
const ITEM_STATUS = {
  UNANSWERED: 'UNANSWERED',
  SAVED: 'SAVED',
  CONFIRMED: 'CONFIRMED',
  GRADED: 'GRADED',
};
const ATTEMPT_MODE = {
  SINGLE_PRACTICE: 'SINGLE_PRACTICE',
  PAPER_PRACTICE: 'PAPER_PRACTICE',
  EXAM: 'EXAM',
};
const SOURCE_TYPE = {
  SELF_PRACTICE: 'SELF_PRACTICE',
  MOCK_EXAM: 'MOCK_EXAM',
  TEACHER_TASK: 'TEACHER_TASK',
  WRONG_QUESTION_PRACTICE: 'WRONG_QUESTION_PRACTICE',
};
const ACTIVE_SESSION_STATUSES = new Set([
  SESSION_STATUS.CREATED,
  SESSION_STATUS.IN_PROGRESS,
  SESSION_STATUS.SUBMITTING,
  'created',
  'in_progress',
  'submitting',
]);
const FINAL_SESSION_STATUSES = new Set([
  SESSION_STATUS.SUBMITTED,
  SESSION_STATUS.ABANDONED,
  'submitted',
  'graded',
  'abandoned',
]);

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

function toPositiveInt(value, fieldName, required = true) {
  if (value == null || value === '') {
    if (required) {
      throw Object.assign(new Error(`${fieldName} 不能为空`), { code: 40001 });
    }
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw Object.assign(new Error(`${fieldName} 参数不合法`), { code: 40001 });
  }
  return parsed;
}

function normalizeQuestionTypes(questionTypes) {
  let values = questionTypes;
  if (values == null || values === '') {
    values = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'blank', 'short_answer'];
  }
  if (typeof values === 'string') {
    values = values.split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw Object.assign(new Error('questionTypes 参数不合法，应为数组或逗号分隔字符串'), { code: 40001 });
  }

  const publicTypes = [];
  const prismaTypes = [];
  for (const raw of values) {
    const normalized = toLower(raw);
    const prismaType = QUESTION_TYPE_TO_PRISMA[normalized];
    if (!prismaType) {
      throw Object.assign(new Error(`不支持的题型: ${raw}`), { code: 40001 });
    }
    publicTypes.push(normalized);
    prismaTypes.push(prismaType);
    if (normalized === 'fill_blank' && !prismaTypes.includes('BLANK')) {
      prismaTypes.push('BLANK');
    }
    if (normalized === 'blank' && !prismaTypes.includes('FILL_BLANK')) {
      prismaTypes.push('FILL_BLANK');
    }
  }

  return {
    publicTypes: [...new Set(publicTypes)],
    prismaTypes: [...new Set(prismaTypes)],
  };
}

function normalizeDifficulty(difficulty) {
  if (difficulty == null || difficulty === '') return null;
  const normalized = toLower(difficulty);
  const prismaDifficulty = DIFFICULTY_TO_PRISMA[normalized];
  if (!prismaDifficulty) {
    throw Object.assign(new Error('difficulty 参数不合法，可选 basic / medium / hard'), { code: 40001 });
  }
  return { publicDifficulty: normalized, prismaDifficulty };
}

function normalizeMode(mode) {
  if (mode == null || mode === '') return 'practice';
  const normalized = String(mode).trim();
  if (!/^[a-zA-Z0-9_-]{1,30}$/.test(normalized)) {
    throw Object.assign(new Error('mode 参数不合法，仅支持 1-30 位字母、数字、下划线或短横线'), { code: 40001 });
  }
  return normalized;
}

function normalizeAttemptConfig(params = {}) {
  const rawPracticeMode = String(
    params.practiceMode ?? params.practice_mode ?? params.sessionMode ?? params.session_mode ?? params.mode ?? '',
  ).trim().toUpperCase();
  const rawAnswerMode = String(params.answerMode ?? params.answer_mode ?? '').trim().toUpperCase();

  if (rawPracticeMode === 'EXAM') {
    return {
      mode: ATTEMPT_MODE.EXAM,
      answerMode: 'PAPER',
      navigationConfig: {
        navigationMode: 'FREE',
        allowModifyConfirmedAnswer: true,
        showResultAfterItemSubmit: false,
        lockNavigationUntilCurrentConfirmed: false,
      },
    };
  }

  if (rawAnswerMode === 'PAPER' || rawPracticeMode === 'PAPER_PRACTICE') {
    return {
      mode: ATTEMPT_MODE.PAPER_PRACTICE,
      answerMode: 'PAPER',
      navigationConfig: {
        navigationMode: 'FREE',
        allowModifyConfirmedAnswer: false,
        showResultAfterItemSubmit: true,
        lockNavigationUntilCurrentConfirmed: false,
      },
    };
  }

  return {
    mode: ATTEMPT_MODE.SINGLE_PRACTICE,
    answerMode: 'SINGLE',
    navigationConfig: {
      navigationMode: 'SEQUENTIAL',
      allowModifyConfirmedAnswer: false,
      showResultAfterItemSubmit: true,
      lockNavigationUntilCurrentConfirmed: true,
    },
  };
}

function normalizeStoredSessionStatus(status) {
  const raw = String(status || '').trim();
  const upper = raw.toUpperCase();
  if (upper === 'GRADED') return SESSION_STATUS.SUBMITTED;
  if (upper === 'SUBMITTED') return SESSION_STATUS.SUBMITTED;
  if (upper === 'IN_PROGRESS') return SESSION_STATUS.IN_PROGRESS;
  if (upper === 'SUBMITTING') return SESSION_STATUS.SUBMITTING;
  if (upper === 'CREATED') return SESSION_STATUS.CREATED;
  if (upper === 'EXPIRED') return SESSION_STATUS.EXPIRED;
  if (upper === 'ABANDONED') return SESSION_STATUS.ABANDONED;
  return raw || SESSION_STATUS.IN_PROGRESS;
}

function normalizeStoredAttemptMode(mode, answerMode) {
  const rawMode = String(mode || '').trim().toUpperCase();
  const rawAnswerMode = String(answerMode || '').trim().toUpperCase();
  if (rawMode === ATTEMPT_MODE.EXAM || rawMode === 'EXAM') return ATTEMPT_MODE.EXAM;
  if (rawMode === ATTEMPT_MODE.PAPER_PRACTICE || rawAnswerMode === 'PAPER') return ATTEMPT_MODE.PAPER_PRACTICE;
  if (rawMode === ATTEMPT_MODE.SINGLE_PRACTICE || rawAnswerMode === 'SINGLE') return ATTEMPT_MODE.SINGLE_PRACTICE;
  if (rawMode === 'PRACTICE' || rawMode === 'RANDOM' || rawMode === 'SIMILAR' || rawMode === '') {
    return rawAnswerMode === 'PAPER' ? ATTEMPT_MODE.PAPER_PRACTICE : ATTEMPT_MODE.SINGLE_PRACTICE;
  }
  return rawMode;
}

function isSessionActive(session) {
  return ACTIVE_SESSION_STATUSES.has(session?.status) ||
    ACTIVE_SESSION_STATUSES.has(String(session?.status || '').toLowerCase()) ||
    normalizeStoredSessionStatus(session?.status) === SESSION_STATUS.IN_PROGRESS;
}

function isSessionFinal(session) {
  return FINAL_SESSION_STATUSES.has(session?.status) ||
    FINAL_SESSION_STATUSES.has(String(session?.status || '').toLowerCase()) ||
    normalizeStoredSessionStatus(session?.status) === SESSION_STATUS.SUBMITTED;
}

function parseClientDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function flattenAnswerValues(value) {
  if (value == null) return [];
  if (typeof value === 'string') {
    try {
      return flattenAnswerValues(JSON.parse(value));
    } catch (e) {
      if (value.includes(',')) return value.split(',').map((item) => item.trim()).filter(Boolean);
      return [value];
    }
  }
  if (Array.isArray(value)) return value.flatMap((item) => flattenAnswerValues(item));
  if (typeof value === 'object') {
    if (value.answer !== undefined) return flattenAnswerValues(value.answer);
    if (value.answers !== undefined) return flattenAnswerValues(value.answers);
    if (value.value !== undefined) return flattenAnswerValues(value.value);
    if (value.correct !== undefined) return flattenAnswerValues(value.correct);
    return Object.values(value).flatMap((item) => flattenAnswerValues(item));
  }
  return [value];
}

function isPracticeAnswered(value) {
  return flattenAnswerValues(value).some((item) => String(item ?? '').trim() !== '');
}

function toJsonAnswer(value) {
  if (value === undefined) return { answer: null };
  if (Array.isArray(value)) return { answers: value };
  if (value && typeof value === 'object') return value;
  return { answer: value };
}

function getAnswerFromPayload(answer) {
  if (Object.prototype.hasOwnProperty.call(answer, 'answer')) return answer.answer;
  if (Object.prototype.hasOwnProperty.call(answer, 'answers')) return answer.answers;
  if (Object.prototype.hasOwnProperty.call(answer, 'answer_content')) return answer.answer_content;
  if (Object.prototype.hasOwnProperty.call(answer, 'value')) return answer.value;
  return undefined;
}

function normalizeSubmittedAnswers(answers) {
  if (!Array.isArray(answers)) {
    throw Object.assign(new Error('answers 参数不合法，应为数组'), { code: 40001 });
  }
  const answerMap = {};
  for (const item of answers) {
    if (!item || typeof item !== 'object') {
      throw Object.assign(new Error('answers 中每一项必须为对象'), { code: 40001 });
    }
    const questionId = toPositiveInt(item.questionId ?? item.question_id, 'questionId');
    answerMap[questionId] = toJsonAnswer(getAnswerFromPayload(item));
  }
  return answerMap;
}

function toGradingStatusEnum(status) {
  const normalized = toLower(status);
  if (normalized === 'auto_graded') return 'AUTO_GRADED';
  if (normalized === 'ai_graded') return 'AI_GRADED';
  if (normalized === 'manual_graded') return 'MANUAL_GRADED';
  if (normalized === 'failed') return 'FAILED';
  return 'PENDING';
}

function toPublicQuestion(question) {
  return {
    question_id: question.question_id,
    question_type: toLower(question.question_type),
    title: question.title,
    question_content: question.content,
    difficulty_level: toLower(question.difficulty_level),
    score: question.score,
    is_ai_generated: question.is_ai_generated,
    knowledge_point: question.knowledge_point
      ? {
          knowledge_point_id: question.knowledge_point.knowledge_point_id,
          knowledge_point_name: question.knowledge_point.knowledge_point_name,
        }
      : null,
    options: (question.options || []).map((option) => ({
      option_id: option.option_id,
      option_label: option.option_key,
      option_content: option.option_content,
    })),
  };
}

async function ensureStudentCanPractice(userId, courseId, classId) {
  const course = await prisma.course.findUnique({
    where: { course_id: courseId },
  });
  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  let teachingClass = null;
  if (classId) {
    teachingClass = await prisma.teachingClass.findUnique({
      where: { teaching_class_id: classId },
    });
    if (!teachingClass || teachingClass.course_id !== courseId) {
      throw Object.assign(new Error('班级不存在或不属于该课程'), { code: 40002 });
    }
  }

  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: userId,
      course_id: courseId,
      ...(classId ? { teaching_class_id: classId } : {}),
      enrollment_status: 'active',
    },
  });

  if (!enrollment) {
    throw Object.assign(new Error('未加入该课程或班级，无法开始练习'), { code: 40301 });
  }

  return {
    course,
    teachingClass,
    classId: classId || enrollment.teaching_class_id,
  };
}

async function fetchQuestionLinks({
  courseId,
  classId,
  prismaTypes,
  prismaDifficulty,
  knowledgePointId = null,
  excludeIds = [],
}) {
  const questionWhere = {
    status: 'active',
    question_type: { in: prismaTypes },
    ...(prismaDifficulty ? { difficulty_level: prismaDifficulty } : {}),
    ...(knowledgePointId ? { knowledge_point_id: knowledgePointId } : {}),
    ...(excludeIds.length > 0 ? { question_id: { notIn: excludeIds } } : {}),
  };

  const include = {
    question: {
      include: {
        options: { orderBy: { option_order: 'asc' } },
        knowledge_point: true,
        course: true,
      },
    },
  };

  const collected = [];
  const seen = new Set();

  async function collect(where) {
    const links = await prisma.questionBankQuestion.findMany({
      where,
      include,
      orderBy: { created_at: 'desc' },
    });
    for (const link of links) {
      if (!link.question || seen.has(link.question_id)) continue;
      seen.add(link.question_id);
      collected.push(link.question);
    }
  }

  if (classId) {
    await collect({
      question_bank: {
        course_id: courseId,
        status: 'active',
        teaching_classes: { some: { teaching_class_id: classId } },
      },
      question: questionWhere,
    });
  }

  await collect({
    question_bank: {
      course_id: courseId,
      status: 'active',
    },
    question: questionWhere,
  });

  return collected;
}

async function getKnowledgePointsForGeneration(courseId) {
  return prisma.knowledgePoint.findMany({
    where: { course_id: courseId },
    orderBy: [{ sort_order: 'asc' }, { knowledge_point_id: 'asc' }],
    take: 10,
  });
}

async function getOrCreateAiPracticeBank(courseId, classId, userId, knowledgePoints) {
  const questionBank = await prisma.questionBank.upsert({
    where: {
      course_id_name: {
        course_id: courseId,
        name: 'AI 自动练习题库',
      },
    },
    update: {
      scope_type: classId ? 'CLASS' : 'COURSE',
      status: 'active',
    },
    create: {
      course_id: courseId,
      name: 'AI 自动练习题库',
      description: '学生练习题量不足时由 AI 自动补充的题库。',
      scope_type: classId ? 'CLASS' : 'COURSE',
      created_by_user_id: userId,
      status: 'active',
    },
  });

  if (classId) {
    await prisma.questionBankTeachingClass.upsert({
      where: {
        question_bank_id_teaching_class_id: {
          question_bank_id: questionBank.question_bank_id,
          teaching_class_id: classId,
        },
      },
      update: {},
      create: {
        question_bank_id: questionBank.question_bank_id,
        teaching_class_id: classId,
      },
    });
  }

  for (const kp of knowledgePoints || []) {
    await prisma.questionBankKnowledgePoint.upsert({
      where: {
        question_bank_id_knowledge_point_id: {
          question_bank_id: questionBank.question_bank_id,
          knowledge_point_id: kp.knowledge_point_id,
        },
      },
      update: {},
      create: {
        question_bank_id: questionBank.question_bank_id,
        knowledge_point_id: kp.knowledge_point_id,
      },
    });
  }

  return questionBank;
}

function buildCorrectAnswer(questionType, rawAnswer) {
  const type = toLower(questionType);
  if (rawAnswer && typeof rawAnswer === 'object' && !Array.isArray(rawAnswer)) {
    return {
      type: rawAnswer.type || type,
      answer: rawAnswer.answer ?? rawAnswer.answers ?? rawAnswer.value ?? rawAnswer.correct ?? rawAnswer,
    };
  }
  if (type === 'multiple_choice') {
    return { type, answer: flattenAnswerValues(rawAnswer) };
  }
  return { type, answer: rawAnswer };
}

function normalizeGeneratedOptions(questionType, rawOptions, correctAnswer) {
  const type = toLower(questionType);
  if (!['single_choice', 'multiple_choice'].includes(type)) return [];

  const answerValues = flattenAnswerValues(correctAnswer).map((item) => String(item).trim());
  const correctSet = new Set(answerValues);

  return (rawOptions || []).map((option, index) => {
    const key = String(
      option.option_label ||
      option.option_key ||
      option.key ||
      option.label ||
      String.fromCharCode(65 + index),
    ).trim();
    return {
      option_key: key,
      option_content: String(option.option_content || option.content || option.text || ''),
      option_order: index + 1,
      is_correct: correctSet.has(key),
    };
  }).filter((option) => option.option_key && option.option_content);
}

function buildGeneratedQuestionTitle(content, index) {
  const normalized = String(content || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return `AI 练习题 ${index + 1}`;
  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
}

async function generateAndPersistQuestions({
  course,
  classId,
  publicTypes,
  publicDifficulty,
  count,
  userId,
  preferredKnowledgePointId = null,
}) {
  if (count <= 0) return [];

  let knowledgePoints = await getKnowledgePointsForGeneration(course.course_id);
  if (preferredKnowledgePointId) {
    const preferred = await prisma.knowledgePoint.findFirst({
      where: {
        knowledge_point_id: preferredKnowledgePointId,
        course_id: course.course_id,
      },
    });
    if (preferred) {
      knowledgePoints = [
        preferred,
        ...knowledgePoints.filter((kp) => kp.knowledge_point_id !== preferred.knowledge_point_id),
      ];
    }
  }
  const questionBank = await getOrCreateAiPracticeBank(
    course.course_id,
    classId,
    userId,
    knowledgePoints,
  );

  const generationLog = await prisma.aiQuestionGenerationLog.create({
    data: {
      course_id: course.course_id,
      teaching_class_id: classId || null,
      question_bank_id: questionBank.question_bank_id,
      knowledge_point_id: knowledgePoints[0]?.knowledge_point_id || null,
      created_by_user_id: userId,
      prompt_json: {
        source: 'practice_start',
        course_name: course.course_name,
        knowledge_points: knowledgePoints.map((kp) => kp.knowledge_point_name),
      },
      request_params: {
        count,
        question_types: publicTypes,
        difficulty: publicDifficulty || 'medium',
      },
      status: 'RUNNING',
    },
  });

  let generated = [];
  try {
    generated = await aiService.generateQuestions({
      courseName: course.course_name,
      knowledgePoints,
      count,
      questionTypes: publicTypes.map((type) => (type === 'fill_blank' ? 'blank' : type)),
      difficultyLevel: publicDifficulty || 'medium',
      userId,
    });
  } catch (err) {
    await prisma.aiQuestionGenerationLog.update({
      where: { ai_question_generation_log_id: generationLog.ai_question_generation_log_id },
      data: {
        status: 'FAILED',
        error_message: err.message,
        response_json: null,
      },
    });
    throw err;
  }

  const createdQuestions = [];

  for (const [index, item] of generated.slice(0, count).entries()) {
    const publicType = toLower(item.question_type) === 'blank'
      ? 'fill_blank'
      : toLower(item.question_type);
    const prismaType = QUESTION_TYPE_TO_PRISMA[publicType];
    if (!prismaType) continue;

    const difficulty = DIFFICULTY_TO_PRISMA[toLower(item.difficulty_level)] ||
      DIFFICULTY_TO_PRISMA[publicDifficulty] ||
      'MEDIUM';
    const content = item.question_content || item.content || '';
    if (!content) continue;

    const correctAnswer = buildCorrectAnswer(publicType, item.correct_answer);
    const options = normalizeGeneratedOptions(publicType, item.options || [], correctAnswer);
    if (['single_choice', 'multiple_choice'].includes(publicType) && options.length === 0) {
      continue;
    }

    const knowledgePoint = knowledgePoints[index % Math.max(knowledgePoints.length, 1)];
    const question = await prisma.question.create({
      data: {
        course_id: course.course_id,
        knowledge_point_id: knowledgePoint?.knowledge_point_id || null,
        question_type: prismaType,
        title: item.title || buildGeneratedQuestionTitle(content, index),
        content,
        correct_answer: correctAnswer,
        answer_keywords: item.answer_keywords || null,
        analysis: item.answer_analysis || item.analysis || '',
        difficulty_level: difficulty,
        score: Number(item.score) > 0 ? Number(item.score) : 10,
        is_ai_generated: true,
        created_by_user_id: userId,
        status: 'active',
        options: options.length > 0 ? { create: options } : undefined,
      },
      include: {
        options: { orderBy: { option_order: 'asc' } },
        knowledge_point: true,
        course: true,
      },
    });

    await prisma.questionBankQuestion.create({
      data: {
        question_bank_id: questionBank.question_bank_id,
        question_id: question.question_id,
        question_order: index + 1,
        source_type: 'ai_generated',
      },
    });

    await prisma.aiQuestionGenerationQuestion.create({
      data: {
        ai_question_generation_log_id: generationLog.ai_question_generation_log_id,
        question_id: question.question_id,
        action_status: 'accepted',
      },
    });

    createdQuestions.push(question);
  }

  await prisma.aiQuestionGenerationLog.update({
    where: { ai_question_generation_log_id: generationLog.ai_question_generation_log_id },
    data: {
      status: createdQuestions.length > 0 ? 'SUCCESS' : 'FAILED',
      generated_question_count: generated.length,
      accepted_question_count: createdQuestions.length,
      response_json: generated,
      error_message: createdQuestions.length > 0 ? null : 'AI 未返回可入库题目',
    },
  });

  return createdQuestions;
}

async function createPracticeSessionFromQuestions({
  userId,
  courseId,
  classId,
  mode,
  answerMode = 'SINGLE',
  navigationConfig = null,
  expiresAt = null,
  sourceType = SOURCE_TYPE.SELF_PRACTICE,
  sourceId = null,
  selectedQuestions,
}) {
  const maxScore = selectedQuestions.reduce((sum, question) => sum + (question.score || 0), 0);
  const session = await prisma.practiceSession.create({
    data: {
      student_user_id: userId,
      course_id: courseId,
      teaching_class_id: classId || null,
      mode,
      answer_mode: answerMode,
      question_count: selectedQuestions.length,
      status: SESSION_STATUS.IN_PROGRESS,
      max_score: maxScore,
      current_item_id: selectedQuestions[0]?.question_id || null,
      current_item_index: 0,
      last_active_at: new Date(),
      expires_at: expiresAt || null,
      navigation_config: navigationConfig,
      source_type: sourceType,
      source_id: sourceId,
      questions: {
        create: selectedQuestions.map((question, index) => ({
          question_id: question.question_id,
          question_order: index + 1,
        })),
      },
    },
  });

  return {
    session: {
      practice_session_id: session.practice_session_id,
      subject_id: session.course_id,
      class_id: session.teaching_class_id,
      mode: session.mode,
      answer_mode: session.answer_mode,
      status: session.status,
      question_count: session.question_count,
      total_score: null,
      max_score: session.max_score,
      current_item_id: session.current_item_id,
      current_item_index: session.current_item_index,
      started_at: session.started_at.toISOString(),
      expires_at: session.expires_at ? session.expires_at.toISOString() : null,
      server_time: new Date().toISOString(),
      navigation_config: session.navigation_config,
    },
    questions: selectedQuestions.map(toPublicQuestion),
  };
}

async function startPractice(userId, params) {
  const courseId = toPositiveInt(params.subjectId ?? params.subject_id ?? params.courseId ?? params.course_id, 'subjectId');
  const classId = toPositiveInt(params.classId ?? params.class_id ?? params.teachingClassId ?? params.teaching_class_id, 'classId', false);
  const questionCount = toPositiveInt(params.questionCount ?? params.question_count, 'questionCount');
  if (questionCount > 100) {
    throw Object.assign(new Error('questionCount 不能超过 100'), { code: 40001 });
  }

  const { publicTypes, prismaTypes } = normalizeQuestionTypes(params.questionTypes ?? params.question_types);
  const difficulty = normalizeDifficulty(params.difficulty);
  const attemptConfig = normalizeAttemptConfig(params);
  const durationSeconds = toPositiveInt(params.durationSeconds ?? params.duration_seconds, 'durationSeconds', false);
  const expiresAt = durationSeconds ? new Date(Date.now() + durationSeconds * 1000) : null;
  const { course, classId: resolvedClassId } = await ensureStudentCanPractice(userId, courseId, classId);

  const existingQuestions = await fetchQuestionLinks({
    courseId,
    classId: resolvedClassId,
    prismaTypes,
    prismaDifficulty: difficulty?.prismaDifficulty || null,
  });

  let selectedQuestions = shuffle(existingQuestions).slice(0, questionCount);
  let generatedCount = 0;
  let warning = null;

  if (selectedQuestions.length < questionCount) {
    const missingCount = questionCount - selectedQuestions.length;
    const generatedQuestions = await generateAndPersistQuestions({
      course,
      classId: resolvedClassId,
      publicTypes,
      publicDifficulty: difficulty?.publicDifficulty || null,
      count: missingCount,
      userId,
    });
    generatedCount = generatedQuestions.length;
    selectedQuestions = selectedQuestions.concat(generatedQuestions).slice(0, questionCount);
  }

  if (selectedQuestions.length === 0) {
    throw Object.assign(new Error('题库题目不足，且 AI 未能生成可用题目'), { code: 40002 });
  }

  if (selectedQuestions.length < questionCount) {
    warning = `题目不足，实际生成 ${selectedQuestions.length} 道题`;
  }

  const sessionPayload = await createPracticeSessionFromQuestions({
    userId,
    courseId,
    classId: resolvedClassId,
    mode: attemptConfig.mode,
    answerMode: attemptConfig.answerMode,
    navigationConfig: attemptConfig.navigationConfig,
    expiresAt,
    sourceType: SOURCE_TYPE.SELF_PRACTICE,
    selectedQuestions,
  });

  return {
    session: sessionPayload.session,
    generated_count: generatedCount,
    warning,
    questions: sessionPayload.questions,
  };
}

async function submitPractice(userId, params) {
  const requestedMode = String(params.mode || params.submitMode || params.submit_mode || '').toLowerCase();
  if (requestedMode === 'single' || requestedMode === 'item') {
    const firstAnswer = Array.isArray(params.answers) ? params.answers[0] : null;
    const questionId = toPositiveInt(firstAnswer?.questionId ?? firstAnswer?.question_id, 'questionId');
    return submitPracticeItem(
      userId,
      toPositiveInt(params.sessionId ?? params.session_id ?? params.practiceSessionId ?? params.practice_session_id, 'sessionId'),
      questionId,
      { answer: getAnswerFromPayload(firstAnswer || {}) },
    );
  }
  return submitPracticeSession(userId, toPositiveInt(params.sessionId ?? params.session_id ?? params.practiceSessionId ?? params.practice_session_id, 'sessionId'), {
    answers: params.answers,
    submitRequestId: params.submitRequestId ?? params.submit_request_id,
  });

  // ================================================================
  // 注意：以下代码为不可达的旧实现（上方 return 已提前退出）。
  // 保留以供未来重构参考，其中 finalStatus 变量未定义。
  // 如需恢复此代码段，请先补全 finalStatus 的定义。
  // ================================================================

  /* eslint-disable no-unreachable */
  const sessionId = toPositiveInt(params.sessionId ?? params.session_id ?? params.practiceSessionId ?? params.practice_session_id, 'sessionId');
  const answerMap = normalizeSubmittedAnswers(params.answers);

  const session = await prisma.practiceSession.findUnique({
    where: { practice_session_id: sessionId },
    include: {
      questions: {
        orderBy: { question_order: 'asc' },
        include: {
          question: {
            include: {
              options: { orderBy: { option_order: 'asc' } },
              knowledge_point: true,
              course: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw Object.assign(new Error('练习会话不存在'), { code: 40002 });
  }
  if (session.student_user_id !== userId) {
    throw Object.assign(new Error('无权提交该练习会话'), { code: 40301 });
  }
  if (!isSessionActive(session)) {
    throw Object.assign(new Error('该练习已提交，不能重复提交'), { code: 40001 });
  }

  const sessionQuestionIds = new Set(session.questions.map((item) => item.question_id));
  for (const questionId of Object.keys(answerMap)) {
    if (!sessionQuestionIds.has(Number(questionId))) {
      throw Object.assign(new Error(`题目 ${questionId} 不属于该练习会话`), { code: 40001 });
    }
  }

  const questions = session.questions.map((item) => item.question);
  const questionMap = {};
  for (const question of questions) {
    questionMap[question.question_id] = question;
  }

  const gradingResults = await gradingService.gradeAnswers(questions, answerMap, userId);
  const now = new Date();

  const transactionResult = await prisma.$transaction(async (tx) => {
    let totalScore = 0;
    let objectiveScore = 0;
    let aiScore = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let autoGradedCount = 0;
    let aiGradedCount = 0;
    let pendingCount = 0;
    const updatedAnswers = [];

    for (const result of gradingResults) {
      const question = questionMap[result.question_id];
      const storedAnswer = answerMap[result.question_id] || { answer: null };
      const gradingStatus = toGradingStatusEnum(result.grading_status);
      const maxScore = result.max_score ?? question?.score ?? 0;
      const score = result.score ?? 0;

      let answerRecord = await tx.answerRecord.findFirst({
        where: {
          student_user_id: userId,
          question_id: result.question_id,
          practice_session_id: sessionId,
        },
      });

      const answerData = {
        answer_content: storedAnswer,
        submitted_at: now,
        is_correct: result.is_correct,
        score,
        max_score: maxScore,
        grading_status: gradingStatus,
        feedback: result.feedback || null,
      };

      if (answerRecord) {
        answerRecord = await tx.answerRecord.update({
          where: { answer_record_id: answerRecord.answer_record_id },
          data: answerData,
        });
      } else {
        answerRecord = await tx.answerRecord.create({
          data: {
            student_user_id: userId,
            question_id: result.question_id,
            practice_session_id: sessionId,
            answer_content: storedAnswer,
            started_at: session.started_at || now,
            submitted_at: now,
            attempt_no: 1,
            is_correct: result.is_correct,
            score,
            max_score: maxScore,
            grading_status: gradingStatus,
            feedback: result.feedback || null,
          },
        });
      }

      if (result.ai_grading) {
        await tx.aiGradingRecord.create({
          data: {
            answer_record_id: answerRecord.answer_record_id,
            score: result.ai_grading.score,
            total_score: result.ai_grading.total_score,
            comment: result.ai_grading.comment || '',
            rubric_matched: result.ai_grading.rubric_matched || [],
            rubric_missing: result.ai_grading.rubric_missing || [],
            is_ai_generated: result.ai_grading.is_ai_generated || false,
            ai_provider: result.ai_grading.ai_provider || null,
            model_name: result.ai_grading.model_name || null,
          },
        });
      }

      totalScore += score;
      if (gradingStatus === 'AI_GRADED') {
        aiScore += score;
        aiGradedCount += 1;
      } else if (gradingStatus === 'AUTO_GRADED') {
        objectiveScore += score;
        autoGradedCount += 1;
      } else if (gradingStatus === 'PENDING') {
        pendingCount += 1;
      }

      if (result.is_correct === true) correctCount += 1;
      else wrongCount += 1;

      updatedAnswers.push({
        question_id: result.question_id,
        question_type: toLower(question?.question_type),
        title: question?.title || null,
        question_content: question?.content || null,
        student_answer: storedAnswer,
        correct_answer: question?.correct_answer || null,
        answer_analysis: question?.analysis || null,
        is_correct: result.is_correct,
        score,
        max_score: maxScore,
        total_score: maxScore,
        grading_status: toLower(gradingStatus),
        feedback: result.feedback || null,
      });
    }

    const maxSessionScore = questions.reduce((sum, question) => sum + (question.score || 0), 0);

    await tx.practiceSession.update({
      where: { practice_session_id: sessionId },
      data: {
        status: SESSION_STATUS.SUBMITTED,
        submitted_at: now,
        duration_seconds: session.started_at
          ? Math.max(0, Math.round((now - new Date(session.started_at)) / 1000))
          : 0,
        total_score: totalScore,
        max_score: maxSessionScore,
        objective_score: objectiveScore,
        ai_score: aiScore,
        correct_count: correctCount,
        wrong_count: wrongCount,
      },
    });

    return {
      updatedAnswers,
      totalScore,
      maxSessionScore,
      correctCount,
      wrongCount,
      autoGradedCount,
      aiGradedCount,
      pendingCount,
      finalStatus,
    };
  });

  const wrongQuestionResult = await wrongQuestionService.createOrUpdateWrongQuestions({
    studentId: userId,
    submissionId: sessionId,
    sourceType: 'practice',
    answerResults: transactionResult.updatedAnswers,
    questionMap,
  });

  const masteryResults = await masteryService.updateMasteryAfterSubmission({
    studentId: userId,
    courseId: session.course_id,
    answerResults: transactionResult.updatedAnswers,
    questionMap,
  });

  return {
    session: {
      practice_session_id: sessionId,
      subject_id: session.course_id,
      class_id: session.teaching_class_id,
      status: transactionResult.finalStatus,
      score: transactionResult.totalScore,
      total_score: transactionResult.maxSessionScore,
      submitted_at: now.toISOString(),
      duration_seconds: now - new Date(session.started_at)
        ? Math.max(0, Math.round((now - new Date(session.started_at)) / 1000))
        : 0,
    },
    summary: {
      question_count: questions.length,
      correct_count: transactionResult.correctCount,
      wrong_count: transactionResult.wrongCount,
      auto_graded_count: transactionResult.autoGradedCount,
      ai_graded_count: transactionResult.aiGradedCount,
      pending_count: transactionResult.pendingCount,
      wrong_question_created_count: wrongQuestionResult.created,
      wrong_question_updated_count: wrongQuestionResult.updated,
    },
    results: transactionResult.updatedAnswers,
    mastery_changes: masteryResults.map((item) => ({
      knowledge_point_id: item.knowledge_point_id,
      mastery_score: item.mastery_score,
      mastery_level: item.mastery_level,
      score_change: item.adjustment,
    })),
  };
}

function isExamSession(session) {
  return normalizeStoredAttemptMode(session?.mode, session?.answer_mode) === ATTEMPT_MODE.EXAM;
}

function getNavigationConfig(session) {
  return session?.navigation_config || {
    navigationMode: isExamSession(session) ? 'FREE' : 'SEQUENTIAL',
    allowModifyConfirmedAnswer: isExamSession(session),
    showResultAfterItemSubmit: !isExamSession(session),
    lockNavigationUntilCurrentConfirmed: !isExamSession(session),
  };
}

function publicItemStatus(record) {
  return record?.item_status || (record?.is_correct != null ? ITEM_STATUS.GRADED : (record ? ITEM_STATUS.SAVED : ITEM_STATUS.UNANSWERED));
}

function answerResultPayload({ result, question, storedAnswer }) {
  const gradingStatus = toGradingStatusEnum(result.grading_status);
  const score = result.score ?? 0;
  const maxScore = result.max_score ?? question?.score ?? 0;
  return {
    question_id: result.question_id,
    question_type: toLower(question?.question_type),
    title: question?.title || null,
    question_content: question?.content || null,
    student_answer: storedAnswer,
    correct_answer: question?.correct_answer || null,
    answer_analysis: question?.analysis || null,
    is_correct: result.is_correct,
    score,
    max_score: maxScore,
    total_score: maxScore,
    grading_status: toLower(gradingStatus),
    feedback: result.feedback || null,
    item_status: ITEM_STATUS.GRADED,
  };
}

function serializeSession(session) {
  const status = normalizeStoredSessionStatus(session.status);
  return {
    practice_session_id: session.practice_session_id,
    subject_id: session.course_id,
    course_id: session.course_id,
    class_id: session.teaching_class_id,
    mode: normalizeStoredAttemptMode(session.mode, session.answer_mode),
    answer_mode: String(session.answer_mode || '').toUpperCase() || null,
    status,
    question_count: session.question_count,
    score: session.total_score,
    total_score: session.max_score,
    max_score: session.max_score,
    current_item_id: session.current_item_id,
    current_item_index: session.current_item_index || 0,
    started_at: session.started_at ? session.started_at.toISOString() : null,
    submitted_at: session.submitted_at ? session.submitted_at.toISOString() : null,
    expires_at: session.expires_at ? session.expires_at.toISOString() : null,
    duration_seconds: session.duration_seconds,
    server_time: new Date().toISOString(),
    navigation_config: getNavigationConfig(session),
  };
}

function serializeQuestionWithAnswer(link, answerRecord, session) {
  const question = link.question;
  const itemStatus = publicItemStatus(answerRecord);
  const canReveal = normalizeStoredSessionStatus(session.status) === SESSION_STATUS.SUBMITTED ||
    (itemStatus === ITEM_STATUS.GRADED && !isExamSession(session));
  return {
    ...toPublicQuestion(question),
    question_order: link.question_order,
    draft_answer: answerRecord?.answer_content ?? null,
    item_status: itemStatus,
    saved_at: answerRecord?.saved_at ? answerRecord.saved_at.toISOString() : null,
    confirmed_at: answerRecord?.confirmed_at ? answerRecord.confirmed_at.toISOString() : null,
    graded_at: answerRecord?.graded_at ? answerRecord.graded_at.toISOString() : null,
    result: canReveal && answerRecord
      ? {
          question_id: question.question_id,
          student_answer: answerRecord.answer_content,
          correct_answer: question.correct_answer,
          answer_analysis: question.analysis || answerRecord.feedback || null,
          is_correct: answerRecord.is_correct,
          score: answerRecord.score,
          max_score: answerRecord.max_score || question.score || 0,
          total_score: answerRecord.max_score || question.score || 0,
          grading_status: toLower(answerRecord.grading_status),
          feedback: answerRecord.feedback,
          item_status: itemStatus,
        }
      : null,
  };
}

async function loadPracticeSessionForUser(userId, sessionId) {
  const session = await prisma.practiceSession.findUnique({
    where: { practice_session_id: sessionId },
    include: {
      course: true,
      questions: {
        orderBy: { question_order: 'asc' },
        include: {
          question: {
            include: {
              options: { orderBy: { option_order: 'asc' } },
              knowledge_point: true,
              course: true,
            },
          },
        },
      },
      answer_records: true,
    },
  });

  if (!session) {
    throw Object.assign(new Error('练习会话不存在'), { code: 40002 });
  }
  if (session.student_user_id !== userId) {
    throw Object.assign(new Error('无权访问该练习会话'), { code: 40301 });
  }
  return session;
}

function assertSessionMutable(session) {
  if (!isSessionActive(session)) {
    throw Object.assign(new Error('该答题会话已结束，不能继续修改'), { code: 40001 });
  }
  if (session.expires_at && new Date(session.expires_at) <= new Date()) {
    throw Object.assign(new Error('考试已超时，不能继续修改答案'), { code: 40001 });
  }
}

function findSessionQuestion(session, questionId) {
  const link = (session.questions || []).find((item) => item.question_id === questionId);
  if (!link) {
    throw Object.assign(new Error('题目不属于该答题会话'), { code: 40002 });
  }
  return link;
}

async function getPracticeSessionDetail(userId, sessionId) {
  // 静默检查超时（不抛异常，让学生看到已提交的结果）
  await checkAndExpireIfNeeded(sessionId).catch(() => {});

  const session = await loadPracticeSessionForUser(userId, sessionId);
  const answerMap = new Map((session.answer_records || []).map((record) => [record.question_id, record]));
  const questions = session.questions.map((link) => serializeQuestionWithAnswer(link, answerMap.get(link.question_id), session));
  const results = questions.map((q) => q.result).filter(Boolean);
  return {
    session: serializeSession(session),
    subject: session.course
      ? { course_id: session.course.course_id, course_name: session.course.course_name }
      : null,
    questions,
    answers: Object.fromEntries(questions.map((q) => [q.question_id, q.draft_answer])),
    results,
    submitted: normalizeStoredSessionStatus(session.status) === SESSION_STATUS.SUBMITTED,
  };
}

async function savePracticeAnswer(userId, sessionId, questionId, params = {}) {
  // 请求时兜底：检查是否超时
  const expired = await checkAndExpireIfNeeded(sessionId);
  if (expired) {
    throw Object.assign(new Error('答题时间已截止，系统已自动交卷'), { code: 40001 });
  }

  const session = await loadPracticeSessionForUser(userId, sessionId);
  assertSessionMutable(session);
  const link = findSessionQuestion(session, questionId);
  const now = new Date();
  const currentIndex = Math.max(0, session.questions.findIndex((item) => item.question_id === questionId));
  const answerContent = toJsonAnswer(params.answer ?? params.answer_content ?? params.value);
  const existing = (session.answer_records || []).find((record) => record.question_id === questionId);
  const navConfig = getNavigationConfig(session);

  if (existing?.item_status === ITEM_STATUS.GRADED) {
    throw Object.assign(new Error('本题已判分，不能直接修改答案'), { code: 40001 });
  }
  if (existing?.item_status === ITEM_STATUS.CONFIRMED && !navConfig.allowModifyConfirmedAnswer) {
    throw Object.assign(new Error('本题已确认，不能直接修改答案'), { code: 40001 });
  }

  const itemStatus = isPracticeAnswered(answerContent) ? ITEM_STATUS.SAVED : ITEM_STATUS.UNANSWERED;
  let answerRecord;
  if (existing) {
    answerRecord = await prisma.answerRecord.update({
      where: { answer_record_id: existing.answer_record_id },
      data: {
        answer_content: answerContent,
        item_status: itemStatus,
        saved_at: now,
        client_updated_at: parseClientDate(params.clientUpdatedAt ?? params.client_updated_at),
      },
    });
  } else {
    answerRecord = await prisma.answerRecord.create({
      data: {
        student_user_id: userId,
        question_id: questionId,
        practice_session_id: sessionId,
        answer_content: answerContent,
        started_at: session.started_at || now,
        attempt_no: 1,
        item_status: itemStatus,
        saved_at: now,
        client_updated_at: parseClientDate(params.clientUpdatedAt ?? params.client_updated_at),
      },
    });
  }

  await prisma.practiceSession.update({
    where: { practice_session_id: sessionId },
    data: {
      current_item_id: questionId,
      current_item_index: currentIndex,
      last_active_at: now,
    },
  });

  return {
    practice_session_id: sessionId,
    question_id: questionId,
    item_id: questionId,
    item_status: answerRecord.item_status,
    saved_at: answerRecord.saved_at ? answerRecord.saved_at.toISOString() : now.toISOString(),
    current_item_index: currentIndex,
    question: toPublicQuestion(link.question),
  };
}

async function submitPracticeItem(userId, sessionId, questionId, params = {}) {
  // 请求时兜底：检查是否超时
  const expired = await checkAndExpireIfNeeded(sessionId);
  if (expired) {
    throw Object.assign(new Error('答题时间已截止，系统已自动交卷'), { code: 40001 });
  }

  let saved = null;
  if (Object.prototype.hasOwnProperty.call(params, 'answer') || Object.prototype.hasOwnProperty.call(params, 'answer_content')) {
    saved = await savePracticeAnswer(userId, sessionId, questionId, params);
  }

  const session = await loadPracticeSessionForUser(userId, sessionId);
  assertSessionMutable(session);
  const link = findSessionQuestion(session, questionId);
  const answerRecord = (session.answer_records || []).find((record) => record.question_id === questionId);
  if (!answerRecord || !isPracticeAnswered(answerRecord.answer_content)) {
    throw Object.assign(new Error('请先完成本题作答'), { code: 40001 });
  }

  const now = new Date();
  if (isExamSession(session)) {
    const updated = await prisma.answerRecord.update({
      where: { answer_record_id: answerRecord.answer_record_id },
      data: {
        item_status: ITEM_STATUS.CONFIRMED,
        confirmed_at: now,
        submitted_at: now,
      },
    });
    return {
      practice_session_id: sessionId,
      question_id: questionId,
      item_id: questionId,
      itemStatus: ITEM_STATUS.CONFIRMED,
      item_status: ITEM_STATUS.CONFIRMED,
      saved: true,
      saved_at: updated.saved_at ? updated.saved_at.toISOString() : saved?.saved_at || null,
      confirmed_at: now.toISOString(),
      session: serializeSession(session),
    };
  }

  if (answerRecord.item_status === ITEM_STATUS.GRADED) {
    const detail = await getPracticeSessionDetail(userId, sessionId);
    const result = detail.results.find((item) => item.question_id === questionId);
    return {
      practice_session_id: sessionId,
      question_id: questionId,
      itemStatus: ITEM_STATUS.GRADED,
      item_status: ITEM_STATUS.GRADED,
      results: result ? [result] : [],
      session: detail.session,
    };
  }

  const gradingResults = await gradingService.gradeAnswers([link.question], {
    [questionId]: answerRecord.answer_content,
  }, userId);
  const result = gradingResults[0];
  const gradingStatus = toGradingStatusEnum(result.grading_status);
  const maxScore = result.max_score ?? link.question.score ?? 0;
  const score = result.score ?? 0;

  const updatedAnswer = await prisma.answerRecord.update({
    where: { answer_record_id: answerRecord.answer_record_id },
    data: {
      item_status: ITEM_STATUS.GRADED,
      submitted_at: now,
      confirmed_at: now,
      graded_at: now,
      is_correct: result.is_correct,
      score,
      max_score: maxScore,
      grading_status: gradingStatus,
      feedback: result.feedback || null,
    },
  });

  if (result.ai_grading) {
    await prisma.aiGradingRecord.create({
      data: {
        answer_record_id: updatedAnswer.answer_record_id,
        score: result.ai_grading.score,
        total_score: result.ai_grading.total_score,
        comment: result.ai_grading.comment || '',
        rubric_matched: result.ai_grading.rubric_matched || [],
        rubric_missing: result.ai_grading.rubric_missing || [],
        is_ai_generated: result.ai_grading.is_ai_generated || false,
        ai_provider: result.ai_grading.ai_provider || null,
        model_name: result.ai_grading.model_name || null,
      },
    });
  }

  const answerPayload = answerResultPayload({ result, question: link.question, storedAnswer: answerRecord.answer_content });
  const questionMap = { [questionId]: link.question };

  // 错题练习：更新原错题的 review_status
  if (session.source_type === SOURCE_TYPE.WRONG_QUESTION_PRACTICE && session.navigation_config) {
    const navConfig = session.navigation_config || {};
    const wrongQuestionIds = navConfig.wrongQuestionIds || [];
    if (wrongQuestionIds.length > 0) {
      // wrongQuestionIds 与 session.questions 按索引一一对应
      const sessionQuestionIndex = session.questions.findIndex(q => q.question_id === questionId);
      if (sessionQuestionIndex >= 0 && sessionQuestionIndex < wrongQuestionIds.length) {
        await wrongQuestionService.updateReviewStatus(userId, wrongQuestionIds[sessionQuestionIndex], {
          isCorrect: result.is_correct,
        }).catch(err => console.error('[practice] updateReviewStatus failed:', err.message));
      }
    }
  }

  await wrongQuestionService.createOrUpdateWrongQuestions({
    studentId: userId,
    submissionId: sessionId,
    sourceType: 'practice',
    answerResults: [answerPayload],
    questionMap,
  });
  await masteryService.updateMasteryAfterSubmission({
    studentId: userId,
    courseId: session.course_id,
    answerResults: [answerPayload],
    questionMap,
  });

  let finalSessionStatus = SESSION_STATUS.IN_PROGRESS;
  let finalSessionPayload = serializeSession(session);
  const gradedRecords = await prisma.answerRecord.findMany({
    where: {
      practice_session_id: sessionId,
      item_status: ITEM_STATUS.GRADED,
    },
  });
  if (!isExamSession(session) && gradedRecords.length >= session.questions.length) {
    const maxSessionScore = session.questions.reduce((sum, item) => sum + (item.question?.score || 0), 0);
    const totalScore = gradedRecords.reduce((sum, record) => sum + (record.score || 0), 0);
    const correctCount = gradedRecords.filter((record) => record.is_correct === true).length;
    const wrongCount = gradedRecords.filter((record) => record.is_correct !== true).length;
    const completedAt = new Date();
    const updatedSession = await prisma.practiceSession.update({
      where: { practice_session_id: sessionId },
      data: {
        status: SESSION_STATUS.SUBMITTED,
        submitted_at: completedAt,
        duration_seconds: session.started_at
          ? Math.max(0, Math.round((completedAt - new Date(session.started_at)) / 1000))
          : 0,
        total_score: totalScore,
        max_score: maxSessionScore,
        correct_count: correctCount,
        wrong_count: wrongCount,
        last_active_at: completedAt,
      },
    });
    finalSessionStatus = SESSION_STATUS.SUBMITTED;
    finalSessionPayload = serializeSession(updatedSession);
  }

  return {
    practice_session_id: sessionId,
    question_id: questionId,
    item_id: questionId,
    itemStatus: ITEM_STATUS.GRADED,
    item_status: ITEM_STATUS.GRADED,
    correct: result.is_correct,
    score,
    correctAnswer: link.question.correct_answer,
    correct_answer: link.question.correct_answer,
    analysis: link.question.analysis || result.feedback || null,
    results: [answerPayload],
    session: {
      ...finalSessionPayload,
      status: finalSessionStatus,
    },
  };
}

async function buildPracticeSessionResult(userId, sessionId) {
  const session = await loadPracticeSessionForUser(userId, sessionId);
  const questionMap = {};
  const results = [];
  for (const link of session.questions) {
    questionMap[link.question_id] = link.question;
    const record = (session.answer_records || []).find((item) => item.question_id === link.question_id);
    if (!record) continue;
    results.push({
      question_id: link.question_id,
      question_type: toLower(link.question.question_type),
      title: link.question.title,
      question_content: link.question.content,
      student_answer: record.answer_content,
      correct_answer: link.question.correct_answer,
      answer_analysis: link.question.analysis || record.feedback || null,
      is_correct: record.is_correct,
      score: record.score,
      max_score: record.max_score || link.question.score || 0,
      total_score: record.max_score || link.question.score || 0,
      grading_status: toLower(record.grading_status),
      feedback: record.feedback || null,
      item_status: publicItemStatus(record),
    });
  }
  const correctCount = results.filter((item) => item.is_correct === true).length;
  const wrongCount = results.filter((item) => item.is_correct !== true).length;
  return {
    session: serializeSession(session),
    summary: {
      question_count: session.questions.length,
      answered_count: session.answer_records.filter((item) => isPracticeAnswered(item.answer_content)).length,
      correct_count: correctCount,
      wrong_count: wrongCount,
      auto_graded_count: results.filter((item) => item.grading_status === 'auto_graded').length,
      ai_graded_count: results.filter((item) => item.grading_status === 'ai_graded').length,
      pending_count: results.filter((item) => item.grading_status === 'pending').length,
      already_submitted: true,
    },
    results,
  };
}

async function submitPracticeSession(userId, sessionId, params = {}) {
  // 请求时兜底：检查是否超时（防止重复提交）
  const expired = await checkAndExpireIfNeeded(sessionId);
  if (expired) {
    throw Object.assign(new Error('答题时间已截止，系统已自动交卷'), { code: 40001 });
  }

  if (Array.isArray(params.answers) && params.answers.length > 0) {
    for (const item of params.answers) {
      const questionId = toPositiveInt(item.questionId ?? item.question_id, 'questionId');
      try {
        await savePracticeAnswer(userId, sessionId, questionId, {
          answer: getAnswerFromPayload(item),
          clientUpdatedAt: item.clientUpdatedAt ?? item.client_updated_at,
        });
      } catch (err) {
        if (!/已判分/.test(err.message || '')) throw err;
      }
    }
  }

  let session = await loadPracticeSessionForUser(userId, sessionId);
  if (isSessionFinal(session)) {
    return buildPracticeSessionResult(userId, sessionId);
  }
  if (!isSessionActive(session) && normalizeStoredSessionStatus(session.status) !== SESSION_STATUS.EXPIRED) {
    throw Object.assign(new Error('该答题会话不能提交'), { code: 40001 });
  }

  const now = new Date();
  const submitRequestId = params.submitRequestId ? String(params.submitRequestId).slice(0, 100) : null;
  await prisma.practiceSession.update({
    where: { practice_session_id: sessionId },
    data: {
      status: SESSION_STATUS.SUBMITTING,
      submit_request_id: submitRequestId || session.submit_request_id,
      last_active_at: now,
    },
  });

  session = await loadPracticeSessionForUser(userId, sessionId);
  const questions = session.questions.map((item) => item.question);
  const answerMap = {};
  for (const record of session.answer_records || []) {
    answerMap[record.question_id] = record.answer_content;
  }

  const gradingResults = await gradingService.gradeAnswers(questions, answerMap, userId);
  const questionMap = {};
  for (const question of questions) questionMap[question.question_id] = question;

  const transactionResult = await prisma.$transaction(async (tx) => {
    let totalScore = 0;
    let objectiveScore = 0;
    let aiScore = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let autoGradedCount = 0;
    let aiGradedCount = 0;
    let pendingCount = 0;
    const updatedAnswers = [];

    for (const result of gradingResults) {
      const question = questionMap[result.question_id];
      const existing = (session.answer_records || []).find((record) => record.question_id === result.question_id);
      const storedAnswer = answerMap[result.question_id] || { answer: null };
      const gradingStatus = toGradingStatusEnum(result.grading_status);
      const maxScore = result.max_score ?? question?.score ?? 0;
      const score = result.score ?? 0;

      const answerData = {
        answer_content: storedAnswer,
        submitted_at: now,
        confirmed_at: existing?.confirmed_at || now,
        graded_at: now,
        item_status: ITEM_STATUS.GRADED,
        is_correct: result.is_correct,
        score,
        max_score: maxScore,
        grading_status: gradingStatus,
        feedback: result.feedback || null,
      };

      let answerRecord;
      if (existing) {
        answerRecord = await tx.answerRecord.update({
          where: { answer_record_id: existing.answer_record_id },
          data: answerData,
        });
      } else {
        answerRecord = await tx.answerRecord.create({
          data: {
            student_user_id: userId,
            question_id: result.question_id,
            practice_session_id: sessionId,
            started_at: session.started_at || now,
            attempt_no: 1,
            saved_at: now,
            ...answerData,
          },
        });
      }

      if (result.ai_grading) {
        await tx.aiGradingRecord.create({
          data: {
            answer_record_id: answerRecord.answer_record_id,
            score: result.ai_grading.score,
            total_score: result.ai_grading.total_score,
            comment: result.ai_grading.comment || '',
            rubric_matched: result.ai_grading.rubric_matched || [],
            rubric_missing: result.ai_grading.rubric_missing || [],
            is_ai_generated: result.ai_grading.is_ai_generated || false,
            ai_provider: result.ai_grading.ai_provider || null,
            model_name: result.ai_grading.model_name || null,
          },
        });
      }

      totalScore += score;
      if (gradingStatus === 'AI_GRADED') {
        aiScore += score; aiGradedCount += 1;
      } else if (gradingStatus === 'AUTO_GRADED') {
        objectiveScore += score; autoGradedCount += 1;
      } else if (gradingStatus === 'PENDING') {
        pendingCount += 1;
      }
      if (result.is_correct === true) correctCount += 1;
      else wrongCount += 1;

      updatedAnswers.push(answerResultPayload({ result, question, storedAnswer }));
    }

    const maxSessionScore = questions.reduce((sum, question) => sum + (question.score || 0), 0);
    await tx.practiceSession.update({
      where: { practice_session_id: sessionId },
      data: {
        status: SESSION_STATUS.SUBMITTED,
        submitted_at: now,
        duration_seconds: session.started_at
          ? Math.max(0, Math.round((now - new Date(session.started_at)) / 1000))
          : 0,
        total_score: totalScore,
        max_score: maxSessionScore,
        objective_score: objectiveScore,
        ai_score: aiScore,
        correct_count: correctCount,
        wrong_count: wrongCount,
      },
    });

    return {
      updatedAnswers,
      totalScore,
      maxSessionScore,
      correctCount,
      wrongCount,
      autoGradedCount,
      aiGradedCount,
      pendingCount,
    };
  });

  // 错题练习：更新原错题的 review_status
  if (session.source_type === SOURCE_TYPE.WRONG_QUESTION_PRACTICE && session.navigation_config) {
    const navConfig = session.navigation_config || {};
    const storedWrongQuestionIds = navConfig.wrongQuestionIds || [];
    for (const answer of transactionResult.updatedAnswers) {
      // 通过 question_id 找到对应的 wrong_question
      const wq = await prisma.wrongQuestion.findFirst({
        where: {
          student_user_id: userId,
          question_id: answer.question_id,
          status: 'UNRESOLVED',
        },
        orderBy: { created_at: 'desc' },
      });
      if (wq) {
        try {
          await wrongQuestionService.updateReviewStatus(userId, wq.wrong_question_id, {
            isCorrect: answer.is_correct,
          });
        } catch (err) {
          console.error('[practice] review status update failed:', err.message);
        }
      }
    }
  }

  const wrongQuestionResult = await wrongQuestionService.createOrUpdateWrongQuestions({
    studentId: userId,
    submissionId: sessionId,
    sourceType: 'practice',
    answerResults: transactionResult.updatedAnswers,
    questionMap,
  });

  const masteryResults = await masteryService.updateMasteryAfterSubmission({
    studentId: userId,
    courseId: session.course_id,
    answerResults: transactionResult.updatedAnswers,
    questionMap,
  });

  return {
    session: {
      practice_session_id: sessionId,
      subject_id: session.course_id,
      course_id: session.course_id,
      class_id: session.teaching_class_id,
      mode: normalizeStoredAttemptMode(session.mode, session.answer_mode),
      answer_mode: String(session.answer_mode || '').toUpperCase(),
      status: SESSION_STATUS.SUBMITTED,
      score: transactionResult.totalScore,
      total_score: transactionResult.maxSessionScore,
      submitted_at: now.toISOString(),
      duration_seconds: session.started_at
        ? Math.max(0, Math.round((now - new Date(session.started_at)) / 1000))
        : 0,
      server_time: new Date().toISOString(),
    },
    summary: {
      question_count: questions.length,
      answered_count: Object.values(answerMap).filter(isPracticeAnswered).length,
      correct_count: transactionResult.correctCount,
      wrong_count: transactionResult.wrongCount,
      auto_graded_count: transactionResult.autoGradedCount,
      ai_graded_count: transactionResult.aiGradedCount,
      pending_count: transactionResult.pendingCount,
      wrong_question_created_count: wrongQuestionResult.created,
      wrong_question_updated_count: wrongQuestionResult.updated,
    },
    results: transactionResult.updatedAnswers,
    mastery_changes: masteryResults.map((item) => ({
      knowledge_point_id: item.knowledge_point_id,
      mastery_score: item.mastery_score,
      mastery_level: item.mastery_level,
      score_change: item.adjustment,
    })),
  };
}

function isPracticeHistorySource(session) {
  const sourceType = String(session?.source_type || '').toUpperCase();
  return !sourceType || [
    SOURCE_TYPE.SELF_PRACTICE,
    SOURCE_TYPE.MOCK_EXAM,
    SOURCE_TYPE.WRONG_QUESTION_PRACTICE,
  ].includes(sourceType);
}

function sessionListStatusFilter(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized || normalized === 'all') return {};
  if (normalized === 'active' || normalized === 'unfinished') {
    return { status: { in: [SESSION_STATUS.CREATED, SESSION_STATUS.IN_PROGRESS, SESSION_STATUS.SUBMITTING, 'created', 'in_progress', 'submitting'] } };
  }
  if (normalized === 'history' || normalized === 'finished') {
    return { status: { in: [SESSION_STATUS.SUBMITTED, SESSION_STATUS.ABANDONED, SESSION_STATUS.EXPIRED, 'submitted', 'abandoned', 'expired'] } };
  }
  const upper = normalized.toUpperCase();
  if ([SESSION_STATUS.CREATED, SESSION_STATUS.IN_PROGRESS, SESSION_STATUS.SUBMITTING, SESSION_STATUS.SUBMITTED, SESSION_STATUS.ABANDONED, SESSION_STATUS.EXPIRED].includes(upper)) {
    return { status: upper };
  }
  return {};
}

function serializeSessionListItem(session) {
  const status = normalizeStoredSessionStatus(session.status);
  const mode = normalizeStoredAttemptMode(session.mode, session.answer_mode);
  const isExam = mode === ATTEMPT_MODE.EXAM;
  const answerRecords = session.answer_records || [];
  const questionCount = session.question_count || session._count?.questions || 0;
  const answeredCount = answerRecords.filter((record) => isPracticeAnswered(record.answer_content)).length;
  const gradedWrongCount = answerRecords.filter((record) => record.is_correct === false).length;
  const wrongCount = status === SESSION_STATUS.SUBMITTED
    ? (session.wrong_count || gradedWrongCount || 0)
    : gradedWrongCount;
  const canContinue = isSessionActive(session) &&
    !isExam &&
    isPracticeHistorySource(session);
  const lastActiveAt = session.last_active_at || session.updated_at || session.started_at;

  return {
    practice_session_id: session.practice_session_id,
    course_id: session.course_id,
    course_name: session.course?.course_name || '自主练习',
    mode,
    answer_mode: String(session.answer_mode || '').toUpperCase() || null,
    status,
    is_exam: isExam,
    can_continue: canContinue,
    question_count: questionCount,
    answered_count: answeredCount,
    wrong_count: wrongCount,
    correct_count: session.correct_count || 0,
    score: session.total_score,
    total_score: session.max_score,
    started_at: session.started_at ? session.started_at.toISOString() : null,
    submitted_at: session.submitted_at ? session.submitted_at.toISOString() : null,
    last_active_at: lastActiveAt ? lastActiveAt.toISOString() : null,
    duration_seconds: session.duration_seconds,
    source_type: session.source_type || (isExam ? SOURCE_TYPE.MOCK_EXAM : SOURCE_TYPE.SELF_PRACTICE),
    route: `#/student/practice/sessions/${session.practice_session_id}`,
  };
}

async function listPracticeSessions(userId, query = {}) {
  const { page, pageSize, skip } = parsePagination(query);
  const where = {
    student_user_id: userId,
    OR: [
      { source_type: null },
      { source_type: { in: [SOURCE_TYPE.SELF_PRACTICE, SOURCE_TYPE.MOCK_EXAM, SOURCE_TYPE.WRONG_QUESTION_PRACTICE] } },
    ],
    ...sessionListStatusFilter(query.status),
  };

  const courseId = toPositiveInt(query.courseId ?? query.course_id ?? query.subjectId ?? query.subject_id, 'courseId', false);
  if (courseId) where.course_id = courseId;

  const [sessions, total] = await Promise.all([
    prisma.practiceSession.findMany({
      where,
      orderBy: [{ updated_at: 'desc' }, { practice_session_id: 'desc' }],
      skip,
      take: pageSize,
      include: {
        course: true,
        answer_records: {
          select: {
            question_id: true,
            answer_content: true,
            item_status: true,
            is_correct: true,
          },
        },
        _count: { select: { questions: true } },
      },
    }),
    prisma.practiceSession.count({ where }),
  ]);

  const list = sessions.map(serializeSessionListItem);
  return {
    list,
    active: list.filter((item) => item.can_continue),
    total,
    page,
    page_size: pageSize,
  };
}

async function abandonPracticeSession(userId, sessionId) {
  const session = await loadPracticeSessionForUser(userId, sessionId);
  if (!isPracticeHistorySource(session)) {
    throw Object.assign(new Error('该答题会话不支持在练习中心放弃'), { code: 40301 });
  }
  if (isSessionFinal(session)) {
    return {
      abandoned: false,
      session: serializeSession(session),
    };
  }

  const now = new Date();
  const updated = await prisma.practiceSession.update({
    where: { practice_session_id: sessionId },
    data: {
      status: SESSION_STATUS.ABANDONED,
      submit_reason: 'USER_ABANDONED',
      last_active_at: now,
      duration_seconds: session.started_at
        ? Math.max(0, Math.round((now - new Date(session.started_at)) / 1000))
        : session.duration_seconds,
    },
    include: {
      course: true,
      answer_records: {
        select: {
          question_id: true,
          answer_content: true,
          item_status: true,
          is_correct: true,
        },
      },
      _count: { select: { questions: true } },
    },
  });

  return {
    abandoned: true,
    session: serializeSessionListItem(updated),
  };
}

async function getActiveAttempt(userId) {
  // 查找所有进行中的答题会话（不限 mode）
  // 优先返回需要 forceResume 的会话（考试/限时测验 > 普通练习）
  const activeSessions = await prisma.practiceSession.findMany({
    where: {
      student_user_id: userId,
      status: { in: [SESSION_STATUS.CREATED, SESSION_STATUS.IN_PROGRESS, SESSION_STATUS.SUBMITTING, 'in_progress'] },
    },
    orderBy: { updated_at: 'desc' },
    take: 10, // 取最近10条，避免查询过多
  });

  if (activeSessions.length === 0) return { active: false, attempt: null, hasActiveAttempt: false };

  // 优先选择 forceResume 的会话（考试/限时测验），否则取最近更新的
  let active = activeSessions[0];
  for (const s of activeSessions) {
    const st = s.source_type || SOURCE_TYPE.SELF_PRACTICE;
    if (st === SOURCE_TYPE.MOCK_EXAM || (st === SOURCE_TYPE.TEACHER_TASK && s.expires_at)) {
      active = s;
      break; // 强制恢复类型的会话优先
    }
  }

  const detail = await getPracticeSessionDetail(userId, active.practice_session_id);

  // 根据来源类型决定是否强制恢复
  let forceResume = false;
  const sourceType = active.source_type || SOURCE_TYPE.SELF_PRACTICE;

  if (sourceType === SOURCE_TYPE.MOCK_EXAM) {
    forceResume = true;
  } else if (sourceType === SOURCE_TYPE.TEACHER_TASK) {
    // 教师限时测验需强制恢复
    forceResume = !!active.expires_at;
  }
  // SELF_PRACTICE 和 WRONG_QUESTION_PRACTICE 不强制恢复

  return {
    hasActiveAttempt: true,
    active: true,
    attemptId: active.practice_session_id,
    sourceType,
    status: toLower(active.status),
    forceResume,
    expiresAt: active.expires_at ? active.expires_at.toISOString() : null,
    attempt: {
      ...detail.session,
      route: `#/student/practice/sessions/${active.practice_session_id}`,
    },
    session: detail.session,
    questions: detail.questions,
    answers: detail.answers,
  };
}

/**
 * 为教师任务创建/恢复答题 attempt
 * 复用统一 PracticeSession 体系，不再使用独立 TaskSubmission
 */
async function startTaskAttempt(userId, taskId) {
  // 1. 校验任务存在
  const task = await prisma.learningTask.findUnique({
    where: { task_id: taskId },
    include: {
      course: true,
      question_links: {
        orderBy: { question_order: 'asc' },
        include: {
          question: {
            include: {
              options: { orderBy: { option_order: 'asc' } },
              knowledge_point: true,
            },
          },
        },
      },
    },
  });

  if (!task) {
    throw Object.assign(new Error('任务不存在'), { code: 40002 });
  }

  // 2. 校验学生已选修课程
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: userId, course_id: task.course_id, enrollment_status: 'active' },
  });
  if (!enrollment) {
    throw Object.assign(new Error('未加入该课程'), { code: 40301 });
  }

  // 3. 校验任务状态
  if (task.status !== 'PUBLISHED') {
    throw Object.assign(new Error('任务未发布或已关闭'), { code: 40001 });
  }

  // 4. 校验截止时间
  const now = new Date();
  if (task.deadline && new Date(task.deadline) < now && !task.allow_late_submit) {
    throw Object.assign(new Error('任务已截止'), { code: 40001 });
  }

  // 5. 题目数量检查
  if (task.question_links.length === 0) {
    throw Object.assign(new Error('该任务暂无题目'), { code: 40002 });
  }

  // 6. 查找现有进行中的 attempt
  const existingAttempt = await prisma.practiceSession.findFirst({
    where: {
      student_user_id: userId,
      source_type: SOURCE_TYPE.TEACHER_TASK,
      source_id: taskId,
      status: { in: ['IN_PROGRESS', 'CREATED'] },
    },
    orderBy: { created_at: 'desc' },
  });

  if (existingAttempt) {
    // 恢复已有 attempt
    const detail = await getPracticeSessionDetail(userId, existingAttempt.practice_session_id);
    return {
      ...detail,
      task: {
        task_id: task.task_id,
        task_title: task.title,
        task_type: toLower(task.task_type),
        deadline: task.deadline ? task.deadline.toISOString() : null,
        allow_late_submit: task.allow_late_submit,
      },
      isResumed: true,
    };
  }

  // 7. 确定 mode 和 answer_mode
  const isQuizType = task.task_type === 'QUIZ';
  const mode = isQuizType ? ATTEMPT_MODE.EXAM : ATTEMPT_MODE.PAPER_PRACTICE;
  const answerMode = 'PAPER';

  // 8. 构建题目列表（不含正确答案）
  const questions = task.question_links.map((link) => {
    const q = link.question;
    return {
      question_id: q.question_id,
      question_type: toLower(q.question_type),
      question_content: q.content,
      title: q.title,
      difficulty_level: toLower(q.difficulty_level),
      score: q.score,
      question_order: link.question_order,
      is_ai_generated: q.is_ai_generated || false,
      knowledge_points: q.knowledge_point
        ? [{ knowledge_point_id: q.knowledge_point.knowledge_point_id, knowledge_point_name: q.knowledge_point.knowledge_point_name }]
        : [],
      options: q.options.map((opt) => ({
        option_id: opt.option_id,
        option_label: opt.option_key,
        option_content: opt.option_content,
      })),
    };
  });

  const totalScore = task.question_links.reduce((sum, l) => sum + (l.question.score || 0), 0);

  // 9. 计算过期时间（限时任务）
  let expiresAt = null;
  if (task.deadline) {
    expiresAt = new Date(task.deadline);
  }

  // 10. 创建 PracticeSession
  const session = await prisma.practiceSession.create({
    data: {
      student_user_id: userId,
      course_id: task.course_id,
      mode,
      answer_mode: answerMode,
      question_count: questions.length,
      status: SESSION_STATUS.IN_PROGRESS,
      started_at: now,
      expires_at: expiresAt,
      max_score: totalScore,
      source_type: SOURCE_TYPE.TEACHER_TASK,
      source_id: taskId,
      task_id: taskId,
      navigation_config: {
        navigationMode: 'FREE',
        allowModifyConfirmedAnswer: false,
        showResultAfterItemSubmit: isQuizType ? false : true,
        lockNavigationUntilCurrentConfirmed: false,
      },
    },
  });

  // 11. 创建 PracticeSessionQuestion 关联
  await prisma.practiceSessionQuestion.createMany({
    data: questions.map((q, idx) => ({
      practice_session_id: session.practice_session_id,
      question_id: q.question_id,
      question_order: idx + 1,
    })),
  });

  return {
    session: {
      practice_session_id: session.practice_session_id,
      course_id: session.course_id,
      mode: toLower(session.mode),
      answer_mode: toLower(session.answer_mode),
      question_count: session.question_count,
      status: toLower(session.status),
      started_at: session.started_at.toISOString(),
      expires_at: session.expires_at ? session.expires_at.toISOString() : null,
      total_score: totalScore,
      source_type: session.source_type,
      source_id: session.source_id,
    },
    task: {
      task_id: task.task_id,
      task_title: task.title,
      task_type: toLower(task.task_type),
      deadline: task.deadline ? task.deadline.toISOString() : null,
      allow_late_submit: task.allow_late_submit,
    },
    questions,
    isResumed: false,
  };
}

// DeepSeek client — 与 ai-chat.service.js 使用完全相同的模式
function getDeepSeekClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey || apiKey.includes('请在这里')) {
    console.error('[practice.service] DEEPSEEK_API_KEY 未配置或为占位符，无法调用 DeepSeek');
    return null;
  }
  return {
    client: new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    }),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  };
}

// 构建 AI 提问的 messages 数组（流式和非流式共用）
async function buildPracticeAiMessages(userId, questionId, sessionId) {
  const session = await prisma.practiceSession.findUnique({
    where: { practice_session_id: sessionId },
    include: {
      questions: {
        where: { question_id: questionId },
        include: {
          question: {
            include: {
              options: { orderBy: { option_order: 'asc' } },
              knowledge_point: true,
              course: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw Object.assign(new Error('练习会话不存在'), { code: 40002 });
  }
  if (session.student_user_id !== userId) {
    throw Object.assign(new Error('无权访问该练习会话'), { code: 40301 });
  }
  if (isSessionActive(session)) {
    throw Object.assign(new Error('练习提交后才允许使用 AI 追问'), { code: 40301 });
  }
  if (session.questions.length === 0) {
    throw Object.assign(new Error('题目不属于该练习会话'), { code: 40002 });
  }

  const pq = session.questions[0];
  const question = pq.question;
  const answerRecord = await prisma.answerRecord.findFirst({
    where: {
      student_user_id: userId,
      question_id: questionId,
      practice_session_id: sessionId,
    },
  });

  const courseName = question.course?.course_name || '未知科目';
  const typeLabel = question.question_type || '未知题型';
  const difficultyLabel = question.difficulty_level || 'medium';
  const kpName = question.knowledge_point?.knowledge_point_name || '未标注';

  const optionText = (question.options || [])
    .map((opt) => `${opt.option_key}. ${opt.option_content}`)
    .join('\n');

  const studentAnswer = JSON.stringify(answerRecord?.answer_content ?? null);
  const correctAnswer = JSON.stringify(question.correct_answer);
  const analysis = question.analysis || '暂无解析';

  const systemPrompt = `你是学研智擎平台中的学科答疑小助手，只能围绕当前题目进行讲解。你需要根据题干、选项、学生答案、正确答案和官方解析，帮助学生理解这道题。

回答要求：
1. 语言清晰、分步骤、适合大学生学习。
2. 先判断学生是否答对，再针对性地讲解。
3. 如果学生答错，请指出错误原因、分析学生可能的思路误区，再给出正确解题思路。
4. 如果学生答对，可以补充知识点梳理、易错点提醒和举一反三的思路。
5. 不要扩展到与题目无关的内容，不要编造题目中没有的信息。
6. 不要回答与学习无关的问题。如果学生询问与本题无关的内容，请友好地引导回本题的讲解。
7. 讲解时尽量引用题目中的具体内容，让学生感受到针对性。`;

  const userPrompt = `【当前题目信息】
科目：${courseName}
题型：${typeLabel}
难度：${difficultyLabel}
知识点：${kpName}

【题干】
${question.content || '暂无题干'}

${optionText ? '【选项】\n' + optionText + '\n' : ''}
【你的答案】
${studentAnswer}

【正确答案】
${correctAnswer}

【官方解析】
${analysis}`;

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    meta: { courseName, typeLabel, difficultyLabel, kpName, sessionId, questionId },
  };
}

// 创建 DeepSeek 流式 completion（复用 ai-chat.service.js 的模式）
async function createPracticeAiCompletionStream(messages, signal) {
  const ds = getDeepSeekClient();
  if (!ds) {
    throw Object.assign(new Error('AI 服务未配置，请联系管理员设置 DEEPSEEK_API_KEY'), { code: 50002 });
  }
  console.log('[practice.service] createPracticeAiCompletionStream, model=', ds.model);
  try {
    return await ds.client.chat.completions.create(
      {
        model: ds.model,
        messages,
        stream: true,
        temperature: 0.5,
        max_tokens: 2048,
      },
      { signal },
    );
  } catch (err) {
    console.error('[practice.service] DeepSeek 流式调用失败:', err.message);
    if (err.status === 401 || err.status === 403) {
      throw Object.assign(new Error('AI 服务认证失败，请检查 API Key 配置'), { code: 50002 });
    }
    if (err.status === 429) {
      throw Object.assign(new Error('AI 服务请求过于频繁，请稍后重试'), { code: 50002 });
    }
    throw Object.assign(new Error('AI 服务调用失败: ' + (err.message || '未知错误')), { code: 50002 });
  }
}

async function askAiForQuestion(userId, questionId, params) {
  const sessionId = toPositiveInt(params.sessionId ?? params.session_id ?? params.practiceSessionId ?? params.practice_session_id, 'sessionId');
  const followUp = String(params.question || params.message || params.prompt || '请帮我讲解这道题。').trim();
  if (!followUp) {
    throw Object.assign(new Error('追问内容不能为空'), { code: 40001 });
  }

  console.log('[practice.service] askAiForQuestion 开始, sessionId=', sessionId, 'questionId=', questionId);

  const { messages } = await buildPracticeAiMessages(userId, questionId, sessionId);

  // 将学生的追问作为新的 user 消息追加
  messages.push({ role: 'user', content: followUp });

  // 调用 DeepSeek V4 Pro
  const ds = getDeepSeekClient();
  if (!ds) {
    throw Object.assign(new Error('AI 服务未配置，请联系管理员设置 DEEPSEEK_API_KEY'), { code: 50002 });
  }

  console.log('[practice.service] 正在调用 DeepSeek, model=', ds.model);

  let aiContent;
  try {
    const completion = await ds.client.chat.completions.create({
      model: ds.model,
      messages,
      temperature: 0.5,
      max_tokens: 2048,
    });
    aiContent = completion.choices?.[0]?.message?.content || '';
    console.log('[practice.service] DeepSeek 返回成功, 内容长度=', aiContent.length);
  } catch (dsErr) {
    console.error('[practice.service] DeepSeek API 调用失败:', dsErr.message);
    if (dsErr.status === 401 || dsErr.status === 403) {
      throw Object.assign(new Error('AI 服务认证失败，请检查 API Key 配置'), { code: 50002 });
    }
    if (dsErr.status === 429) {
      throw Object.assign(new Error('AI 服务请求过于频繁，请稍后重试'), { code: 50002 });
    }
    throw Object.assign(new Error('AI 服务调用失败: ' + (dsErr.message || '未知错误')), { code: 50002 });
  }

  if (!aiContent || aiContent.trim().length < 10) {
    console.error('[practice.service] DeepSeek 返回内容为空或过短:', aiContent);
    throw Object.assign(new Error('AI 未返回有效回答，请稍后重试'), { code: 50002 });
  }

  return {
    practice_session_id: sessionId,
    question_id: questionId,
    explanation: aiContent,
    ai_provider: 'deepseek',
    model_name: ds.model,
  };
}

async function generateAnalysis(userId, questionId, params) {
  const sessionId = toPositiveInt(params.sessionId ?? params.session_id ?? params.practiceSessionId ?? params.practice_session_id, 'sessionId');

  const session = await prisma.practiceSession.findUnique({
    where: { practice_session_id: sessionId },
    include: {
      questions: {
        where: { question_id: questionId },
        include: {
          question: {
            include: {
              options: { orderBy: { option_order: 'asc' } },
              knowledge_point: true,
              course: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw Object.assign(new Error('练习会话不存在'), { code: 40002 });
  }
  if (session.student_user_id !== userId) {
    throw Object.assign(new Error('无权访问该练习会话'), { code: 40301 });
  }
  if (isSessionActive(session)) {
    throw Object.assign(new Error('练习提交后才允许生成解析'), { code: 40301 });
  }
  if (session.questions.length === 0) {
    throw Object.assign(new Error('题目不属于该练习会话'), { code: 40002 });
  }

  const pq = session.questions[0];
  const question = pq.question;
  const answerRecord = await prisma.answerRecord.findFirst({
    where: {
      student_user_id: userId,
      question_id: questionId,
      practice_session_id: sessionId,
    },
  });

  const courseName = question.course?.course_name || '未知科目';
  const typeLabel = question.question_type || '未知题型';
  const difficultyLabel = question.difficulty_level || 'medium';
  const kpName = question.knowledge_point?.knowledge_point_name || '未标注';

  const optionText = (question.options || [])
    .map((option) => `${option.option_key}. ${option.option_content}`)
    .join('\n');

  const studentAnswer = JSON.stringify(answerRecord?.answer_content ?? null);
  const correctAnswer = JSON.stringify(question.correct_answer);
  const analysis = question.analysis || '暂无解析';

  const systemPrompt = `你是学研智擎平台的学科答疑助手。请根据当前题目、选项、学生答案、正确答案和官方解析，为学生生成一份清晰易懂的题目解析。

解析要求：
1. 先说明本题考查的知识点是什么。
2. 分析正确答案为什么正确，解题思路是什么。
3. 如果学生答案存在且与正确答案不一致，分析学生为什么错、可能的思路误区。
4. 如果学生答对了，补充知识点梳理和易错点提醒。
5. 总结解题关键步骤和方法。
6. 语言清晰、结构分明，适合大学生学习。
7. 只围绕当前题目回答，不要扩展无关内容。`;

  const userPrompt = `【当前题目信息】
科目：${courseName}
题型：${typeLabel}
难度：${difficultyLabel}
知识点：${kpName}

【题干】
${question.content || '暂无题干'}

${optionText ? '【选项】\n' + optionText + '\n' : ''}
【学生答案】
${studentAnswer}

【正确答案】
${correctAnswer}

【官方解析】
${analysis}

请根据以上信息，生成一份详细的题目解析。`;

  const ds = getDeepSeekClient();
  if (!ds) {
    throw Object.assign(new Error('AI 服务未配置，请联系管理员设置 DEEPSEEK_API_KEY'), { code: 50002 });
  }

  console.log('[practice.service] generateAnalysis 正在调用 DeepSeek, model=', ds.model);

  let aiContent;
  try {
    const completion = await ds.client.chat.completions.create({
      model: ds.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    });
    aiContent = completion.choices?.[0]?.message?.content || '';
  } catch (dsErr) {
    console.error('[practice.service] DeepSeek API 调用失败:', dsErr.message);
    if (dsErr.status === 401 || dsErr.status === 403) {
      throw Object.assign(new Error('AI 服务认证失败，请检查 API Key 配置'), { code: 50002 });
    }
    if (dsErr.status === 429) {
      throw Object.assign(new Error('AI 服务请求过于频繁，请稍后重试'), { code: 50002 });
    }
    throw Object.assign(new Error('AI 服务调用失败: ' + (dsErr.message || '未知错误')), { code: 50002 });
  }

  if (!aiContent || aiContent.trim().length < 10) {
    throw Object.assign(new Error('AI 未返回有效解析，请稍后重试'), { code: 50002 });
  }

  return {
    practice_session_id: sessionId,
    question_id: questionId,
    analysis: aiContent,
    ai_provider: 'deepseek',
    model_name: ds.model,
  };
}

async function startSimilarPractice(userId, wrongQuestionId, params = {}) {
  const questionCount = toPositiveInt(params.questionCount ?? params.question_count ?? 1, 'questionCount');
  if (questionCount > 20) {
    throw Object.assign(new Error('相似题数量不能超过 20'), { code: 40001 });
  }

  const wrongQuestion = await prisma.wrongQuestion.findUnique({
    where: { wrong_question_id: wrongQuestionId },
    include: {
      question: {
        include: {
          options: { orderBy: { option_order: 'asc' } },
          knowledge_point: true,
          course: true,
        },
      },
      course: true,
      knowledge_point: true,
    },
  });

  if (!wrongQuestion || !wrongQuestion.question) {
    throw Object.assign(new Error('错题记录不存在或题目已被删除'), { code: 40002 });
  }
  if (wrongQuestion.student_user_id !== userId) {
    throw Object.assign(new Error('无权操作该错题记录'), { code: 40301 });
  }

  const originQuestion = wrongQuestion.question;
  const courseId = originQuestion.course_id || wrongQuestion.course_id;
  const requestedClassId = toPositiveInt(
    params.classId ?? params.class_id ?? params.teachingClassId ?? params.teaching_class_id,
    'classId',
    false,
  );
  const { course, classId: resolvedClassId } = await ensureStudentCanPractice(
    userId,
    courseId,
    requestedClassId,
  );

  const publicType = toLower(originQuestion.question_type);
  const { publicTypes, prismaTypes } = normalizeQuestionTypes([publicType]);
  const originDifficulty = toLower(originQuestion.difficulty_level) || 'medium';
  const difficulty = normalizeDifficulty(params.difficulty || originDifficulty);
  const knowledgePointId = wrongQuestion.knowledge_point_id || originQuestion.knowledge_point_id || null;
  const excludeIds = [originQuestion.question_id];

  const sameKnowledgeQuestions = await fetchQuestionLinks({
    courseId,
    classId: resolvedClassId,
    prismaTypes,
    prismaDifficulty: difficulty?.prismaDifficulty || null,
    knowledgePointId,
    excludeIds,
  });

  let selectedQuestions = shuffle(sameKnowledgeQuestions).slice(0, questionCount);
  const selectedIds = new Set(selectedQuestions.map((question) => question.question_id));
  let databaseCount = selectedQuestions.length;

  if (selectedQuestions.length < questionCount) {
    const fallbackQuestions = await fetchQuestionLinks({
      courseId,
      classId: resolvedClassId,
      prismaTypes,
      prismaDifficulty: difficulty?.prismaDifficulty || null,
      excludeIds: excludeIds.concat([...selectedIds]),
    });
    const needed = questionCount - selectedQuestions.length;
    const more = shuffle(fallbackQuestions).slice(0, needed);
    more.forEach((question) => selectedIds.add(question.question_id));
    selectedQuestions = selectedQuestions.concat(more);
    databaseCount = selectedQuestions.length;
  }

  let generatedCount = 0;
  if (selectedQuestions.length < questionCount) {
    const missingCount = questionCount - selectedQuestions.length;
    const generatedQuestions = await generateAndPersistQuestions({
      course,
      classId: resolvedClassId,
      publicTypes,
      publicDifficulty: difficulty?.publicDifficulty || originDifficulty,
      count: missingCount,
      userId,
      preferredKnowledgePointId: knowledgePointId,
    });
    generatedCount = generatedQuestions.length;
    selectedQuestions = selectedQuestions.concat(generatedQuestions).slice(0, questionCount);
  }

  if (selectedQuestions.length === 0) {
    throw Object.assign(new Error('未找到相似题，且 AI 未能生成可用题目'), { code: 40002 });
  }

  const sessionPayload = await createPracticeSessionFromQuestions({
    userId,
    courseId,
    classId: resolvedClassId,
    mode: ATTEMPT_MODE.SINGLE_PRACTICE,
    answerMode: 'SINGLE',
    navigationConfig: {
      navigationMode: 'SEQUENTIAL',
      allowModifyConfirmedAnswer: false,
      showResultAfterItemSubmit: true,
      lockNavigationUntilCurrentConfirmed: true,
      source: 'wrong_question_similar',
    },
    sourceType: SOURCE_TYPE.WRONG_QUESTION_PRACTICE,
    sourceId: wrongQuestionId,
    selectedQuestions,
  });

  return {
    session: sessionPayload.session,
    generated_count: generatedCount,
    database_count: databaseCount,
    source_wrong_question_id: wrongQuestionId,
    source_question_id: originQuestion.question_id,
    source: generatedCount > 0 && databaseCount > 0
      ? 'database_and_ai'
      : (generatedCount > 0 ? 'ai_generated' : 'database'),
    warning: selectedQuestions.length < questionCount ? `相似题不足，实际生成 ${selectedQuestions.length} 道题` : null,
    questions: sessionPayload.questions,
  };
}

function parsePagination(query) {
  let page = Number.parseInt(query.page, 10);
  let pageSize = Number.parseInt(query.pageSize ?? query.page_size, 10);
  if (Number.isNaN(page) || page < 1) page = 1;
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 10;
  if (pageSize > 100) pageSize = 100;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

async function getWrongQuestions(userId, query) {
  const { page, pageSize, skip } = parsePagination(query);
  const courseId = toPositiveInt(query.subjectId ?? query.subject_id ?? query.courseId ?? query.course_id, 'subjectId', false);
  const knowledgePointId = toPositiveInt(query.knowledgePointId ?? query.knowledge_point_id, 'knowledgePointId', false);
  const status = query.status ? toLower(query.status) : null;
  if (status && !VALID_WRONG_STATUSES.has(status)) {
    throw Object.assign(new Error('status 参数不合法，可选 unresolved / mastered / removed'), { code: 40001 });
  }

  const where = {
    student_user_id: userId,
    ...(status ? { status: status.toUpperCase() } : { status: { not: 'REMOVED' } }),
    ...(courseId ? { course_id: courseId } : {}),
    ...(knowledgePointId ? { knowledge_point_id: knowledgePointId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.wrongQuestion.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        course: true,
        knowledge_point: true,
        question: {
          include: {
            options: { orderBy: { option_order: 'asc' } },
          },
        },
      },
    }),
    prisma.wrongQuestion.count({ where }),
  ]);

  return {
    list: items.map((item) => ({
      wrong_question_id: item.wrong_question_id,
      question_id: item.question_id,
      source_type: item.source_type,
      status: toLower(item.status),
      course_id: item.course_id,
      course_name: item.course?.course_name || null,
      knowledge_point_id: item.knowledge_point_id,
      knowledge_point_name: item.knowledge_point?.knowledge_point_name || null,
      question: item.question
        ? {
            ...toPublicQuestion(item.question),
            correct_answer: item.question.correct_answer,
            answer_analysis: item.question.analysis,
          }
        : null,
      mastered_at: item.mastered_at ? item.mastered_at.toISOString() : null,
      created_at: item.created_at.toISOString(),
      updated_at: item.updated_at.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  };
}

async function markWrongQuestionMastered(userId, wrongQuestionId) {
  const record = await prisma.wrongQuestion.findUnique({
    where: { wrong_question_id: wrongQuestionId },
  });
  if (!record) {
    throw Object.assign(new Error('错题记录不存在'), { code: 40002 });
  }
  if (record.student_user_id !== userId) {
    throw Object.assign(new Error('无权操作该错题记录'), { code: 40301 });
  }

  const updated = await prisma.wrongQuestion.update({
    where: { wrong_question_id: wrongQuestionId },
    data: {
      status: 'MASTERED',
      mastered_at: new Date(),
    },
  });

  return {
    wrong_question_id: updated.wrong_question_id,
    status: toLower(updated.status),
    mastered_at: updated.mastered_at ? updated.mastered_at.toISOString() : null,
  };
}

/**
 * 从错题列表创建练习（原题顺序/打乱重做）
 * 复用统一 PracticeSession 体系
 */
async function startWrongQuestionPractice(userId, params = {}) {
  const wrongQuestionIds = (params.wrongQuestionIds || [])
    .map((id) => parseInt(id, 10))
    .filter((id) => !isNaN(id) && id > 0);

  if (wrongQuestionIds.length === 0) {
    throw Object.assign(new Error('wrongQuestionIds 不能为空'), { code: 40001 });
  }
  if (wrongQuestionIds.length > 50) {
    throw Object.assign(new Error('单次最多练习50道错题'), { code: 40001 });
  }

  const practiceMode = String(params.practiceMode || params.mode || 'ORIGINAL_ORDER').toUpperCase();
  if (!['ORIGINAL_ORDER', 'ORIGINAL_SHUFFLE'].includes(practiceMode)) {
    throw Object.assign(new Error('practiceMode 参数不合法，可选 ORIGINAL_ORDER / ORIGINAL_SHUFFLE'), { code: 40001 });
  }

  // 查询所有错题并验证归属
  const wrongQuestions = await prisma.wrongQuestion.findMany({
    where: {
      wrong_question_id: { in: wrongQuestionIds },
      student_user_id: userId,
    },
    include: {
      question: {
        include: {
          options: { orderBy: { option_order: 'asc' } },
          knowledge_point: true,
          course: true,
        },
      },
    },
  });

  if (wrongQuestions.length === 0) {
    throw Object.assign(new Error('没有找到有效的错题记录'), { code: 40002 });
  }

  // 检查是否所有请求的错题都找到了
  if (wrongQuestions.length !== wrongQuestionIds.length) {
    throw Object.assign(new Error('部分错题记录不存在或无权操作'), { code: 40301 });
  }

  // 确定课程（取第一道错题的课程）
  const courseId = wrongQuestions[0].course_id || wrongQuestions[0].question?.course_id;
  if (!courseId) {
    throw Object.assign(new Error('错题缺少课程信息'), { code: 40002 });
  }

  // 构建题目列表
  let questions = wrongQuestions.map((wq, index) => {
    const q = wq.question;
    const questionData = {
      question_id: q.question_id,
      question_type: toLower(q.question_type),
      question_content: q.content,
      title: q.title,
      difficulty_level: toLower(q.difficulty_level),
      score: q.score,
      question_order: index + 1,
      is_ai_generated: q.is_ai_generated || false,
      knowledge_point: q.knowledge_point
        ? { knowledge_point_id: q.knowledge_point.knowledge_point_id, knowledge_point_name: q.knowledge_point.knowledge_point_name }
        : null,
      options: q.options.map((opt) => ({
        option_id: opt.option_id,
        option_label: opt.option_key,
        option_content: opt.option_content,
        is_correct: opt.is_correct,
      })),
      // 保存错题关联信息
      wrong_question_id: wq.wrong_question_id,
      source_question_id: wq.question_id,
    };

    if (practiceMode === 'ORIGINAL_SHUFFLE') {
      // 打乱选项顺序
      if (questionData.options.length >= 2) {
        const shuffled = shuffle(questionData.options);
        // 构建答案映射
        const answerMapping = {};
        shuffled.forEach((opt, newIndex) => {
          if (opt.is_correct) {
            const newLabel = String.fromCharCode(65 + newIndex);
            if (!answerMapping[newLabel]) answerMapping[newLabel] = [];
            answerMapping[newLabel].push(true);
          }
        });
        questionData.optionOrder = shuffled.map((opt, i) => ({
          originalLabel: opt.option_label,
          newLabel: String.fromCharCode(65 + i),
          option_content: opt.option_content,
          is_correct: opt.is_correct,
        }));
        // 更新选项标签
        questionData.options = shuffled.map((opt, i) => ({
          ...opt,
          option_label: String.fromCharCode(65 + i),
        }));
        questionData.answerMapping = answerMapping;
      }
    }

    return questionData;
  });

  // 打乱题目顺序
  if (practiceMode === 'ORIGINAL_SHUFFLE') {
    questions = shuffle(questions).map((q, i) => ({ ...q, question_order: i + 1 }));
  }

  const totalScore = wrongQuestions.reduce((sum, wq) => sum + (wq.question?.score || 0), 0);

  const now = new Date();
  const answerMode = params.answerMode === 'PAPER' ? 'PAPER' : 'SINGLE';

  // 创建 PracticeSession
  const session = await prisma.practiceSession.create({
    data: {
      student_user_id: userId,
      course_id: courseId,
      mode: answerMode === 'PAPER' ? ATTEMPT_MODE.PAPER_PRACTICE : ATTEMPT_MODE.SINGLE_PRACTICE,
      answer_mode: answerMode,
      question_count: questions.length,
      status: SESSION_STATUS.IN_PROGRESS,
      started_at: now,
      max_score: totalScore,
      source_type: SOURCE_TYPE.WRONG_QUESTION_PRACTICE,
      source_id: null,
      navigation_config: {
        navigationMode: answerMode === 'PAPER' ? 'FREE' : 'SEQUENTIAL',
        allowModifyConfirmedAnswer: false,
        showResultAfterItemSubmit: true,
        lockNavigationUntilCurrentConfirmed: answerMode !== 'PAPER',
        generationMode: practiceMode,
        wrongQuestionIds,
      },
    },
  });

  // 创建 PracticeSessionQuestion 关联
  await prisma.practiceSessionQuestion.createMany({
    data: questions.map((q, idx) => ({
      practice_session_id: session.practice_session_id,
      question_id: q.question_id,
      question_order: idx + 1,
    })),
  });

  // 构建返回题目列表（不含正确答案，与 startTaskAttempt 保持一致）
  const publicQuestions = questions.map((q) => ({
    question_id: q.question_id,
    question_type: q.question_type,
    question_content: q.question_content,
    title: q.title,
    difficulty_level: q.difficulty_level,
    score: q.score,
    question_order: q.question_order,
    is_ai_generated: q.is_ai_generated || false,
    knowledge_points: q.knowledge_point ? [q.knowledge_point] : [],
    options: q.options.map((opt) => ({
      option_id: opt.option_id,
      option_label: opt.option_label,
      option_content: opt.option_content,
    })),
    wrong_question_id: q.wrong_question_id,
    optionOrder: q.optionOrder || null,
  }));

  return {
    session: {
      practice_session_id: session.practice_session_id,
      course_id: session.course_id,
      mode: toLower(session.mode),
      answer_mode: toLower(session.answer_mode),
      question_count: session.question_count,
      status: toLower(session.status),
      started_at: session.started_at.toISOString(),
      total_score: totalScore,
      source_type: session.source_type,
      generation_mode: practiceMode,
      wrong_question_ids: wrongQuestionIds,
    },
    questions: publicQuestions,
    wrong_question_count: wrongQuestions.length,
    practice_mode: practiceMode,
  };
}

module.exports = {
  SOURCE_TYPE,
  startPractice,
  submitPractice,
  getActiveAttempt,
  listPracticeSessions,
  abandonPracticeSession,
  startTaskAttempt,
  getPracticeSessionDetail,
  savePracticeAnswer,
  submitPracticeItem,
  submitPracticeSession,
  askAiForQuestion,
  buildPracticeAiMessages,
  createPracticeAiCompletionStream,
  generateAnalysis,
  getWrongQuestions,
  markWrongQuestionMastered,
  startSimilarPractice,
  startWrongQuestionPractice,
};
