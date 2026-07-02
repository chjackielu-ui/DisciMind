// 学生自主练习服务
// 负责抽题、AI 补题、练习提交、AI 追问和错题操作

const prisma = require('../config/prisma');
const gradingService = require('./grading.service');
const wrongQuestionService = require('./wrong-question.service');
const masteryService = require('./mastery.service');
const aiService = require('./ai.service');
const OpenAI = require('openai');

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
  selectedQuestions,
}) {
  const maxScore = selectedQuestions.reduce((sum, question) => sum + (question.score || 0), 0);
  const session = await prisma.practiceSession.create({
    data: {
      student_user_id: userId,
      course_id: courseId,
      teaching_class_id: classId || null,
      mode,
      question_count: selectedQuestions.length,
      status: 'in_progress',
      max_score: maxScore,
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
      status: session.status,
      question_count: session.question_count,
      total_score: null,
      max_score: session.max_score,
      started_at: session.started_at.toISOString(),
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
  const mode = normalizeMode(params.mode);
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
    mode,
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
  if (session.status !== 'in_progress') {
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
    const finalStatus = pendingCount > 0 ? 'submitted' : 'graded';

    await tx.practiceSession.update({
      where: { practice_session_id: sessionId },
      data: {
        status: finalStatus,
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
  if (session.status === 'in_progress') {
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
  if (session.status === 'in_progress') {
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
    mode: 'similar',
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

module.exports = {
  startPractice,
  submitPractice,
  askAiForQuestion,
  buildPracticeAiMessages,
  createPracticeAiCompletionStream,
  generateAnalysis,
  getWrongQuestions,
  markWrongQuestionMastered,
  startSimilarPractice,
};
