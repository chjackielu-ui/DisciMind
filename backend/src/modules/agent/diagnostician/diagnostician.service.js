const prisma = require('../../../config/prisma');
const {
  buildDifyUser,
  hasUsableConfig,
  metadataElapsedMs,
  runDiagnosticianWorkflow: runDifyDiagnosticianWorkflow,
} = require('../../dify/agent-dify.service');
const { createAgentError } = require('../common/agent.errors');
const { validateDiagnosticianAnalyzeBody } = require('./diagnostician.validator');

const TRAINER_ACTIONS = new Set([
  'reduce_difficulty_and_focus',
  'insert_diagnostic_question',
  'increase_difficulty',
  'variant_pursuit',
  'skip_remaining_practice',
]);

const EXPLAINER_ACTIONS = new Set([
  'switch_strategy',
  'focus_misconception',
  'review_prerequisite',
  'provide_analogy',
  'summarize_and_confirm',
]);

const ORCHESTRATOR_ACTIONS = new Set([
  'suggest_break',
  'continue_current_plan',
  'advance_to_next_stage',
]);

const STRATEGIES = new Set([
  'direct_instruction',
  'socratic_dialogue',
  'analogy_bridge',
  'misconception_confrontation',
]);

const STRATEGY_ALIASES = {
  direct: 'direct_instruction',
  socratic: 'socratic_dialogue',
  analogy: 'analogy_bridge',
  misconception: 'misconception_confrontation',
};

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function cleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function toLower(value) {
  return value == null ? null : String(value).toLowerCase();
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function resolveStudentId(actor, params) {
  if (!actor?.user_id) throw createAgentError('AUTH_CONTEXT_ERROR', '无法获取用户身份', 401);
  const role = String(actor.role || '').toLowerCase();
  if (role === 'student') {
    if (params.requestedStudentId && params.requestedStudentId !== actor.user_id) {
      throw createAgentError('STUDENT_ACCESS_DENIED', '普通学生只能分析自己的学习数据', 403);
    }
    return actor.user_id;
  }
  if (!['teacher', 'admin'].includes(role)) {
    throw createAgentError('ROLE_ACCESS_DENIED', '无权调用诊断师', 403);
  }
  if (!params.requestedStudentId) {
    throw createAgentError('INVALID_INPUT', '教师或管理员调用时必须提供 studentId', 400);
  }
  return params.requestedStudentId;
}

async function resolveScope(actor, studentId, params) {
  const [student, knowledgePoint, session, fallbackEnrollment] = await Promise.all([
    prisma.user.findUnique({ where: { user_id: studentId }, include: { profile: true } }),
    params.knowledgePointId
      ? prisma.knowledgePoint.findUnique({
          where: { knowledge_point_id: params.knowledgePointId },
          include: { course: true, chapter: true, parent: true },
        })
      : Promise.resolve(null),
    params.sessionId
      ? prisma.practiceSession.findUnique({
          where: { practice_session_id: params.sessionId },
          include: { course: true, knowledge_point: { include: { course: true, chapter: true, parent: true } } },
        })
      : Promise.resolve(null),
    prisma.studentCourseEnrollment.findFirst({
      where: { student_user_id: studentId, enrollment_status: { in: ['active', 'ACTIVE'] } },
      include: { course: true },
      orderBy: { enrollment_id: 'asc' },
    }),
  ]);

  if (!student) throw createAgentError('STUDENT_NOT_FOUND', '学生不存在', 404);
  if (params.knowledgePointId && !knowledgePoint) {
    throw createAgentError('KNOWLEDGE_POINT_NOT_FOUND', '知识点不存在', 404);
  }
  if (params.sessionId && (!session || session.student_user_id !== studentId)) {
    throw createAgentError('SESSION_ACCESS_DENIED', '学习会话不存在或无权访问', 403);
  }

  const scopedKnowledgePoint = knowledgePoint || session?.knowledge_point || null;
  const course = scopedKnowledgePoint?.course || session?.course || fallbackEnrollment?.course || null;
  if (!course) throw createAgentError('COURSE_NOT_FOUND', '无法确定诊断课程范围', 404);

  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: studentId,
      course_id: course.course_id,
      enrollment_status: { in: ['active', 'ACTIVE'] },
    },
  });
  if (!enrollment) throw createAgentError('COURSE_ACCESS_DENIED', '学生没有该课程访问权', 403);

  const role = String(actor.role || '').toLowerCase();
  if (role === 'teacher') {
    const relation = await prisma.courseTeacherRelation.findFirst({
      where: { course_id: course.course_id, teacher_user_id: actor.user_id },
    });
    if (!relation) throw createAgentError('COURSE_ACCESS_DENIED', '教师无权分析该课程学生', 403);
  }

  return {
    student,
    course,
    knowledgePoint: scopedKnowledgePoint,
    session,
  };
}

function answerWhere(studentId, scope, params) {
  const where = {
    student_user_id: studentId,
    question: {
      course_id: scope.course.course_id,
    },
  };
  if (scope.knowledgePoint?.knowledge_point_id) {
    where.question.knowledge_point_id = scope.knowledgePoint.knowledge_point_id;
  }
  if (params.sessionId) where.practice_session_id = params.sessionId;
  if (params.reportPeriod) {
    where.submitted_at = {
      gte: params.reportPeriod.fromDate,
      lte: new Date(params.reportPeriod.toDate.getTime() + 24 * 60 * 60 * 1000 - 1),
    };
  }
  return where;
}

async function loadLearningData(studentId, scope, params) {
  const kpId = scope.knowledgePoint?.knowledge_point_id || null;
  const [masteryRecords, parentMastery, portrait, snapshots, answers, sessions, recentRuns, reports] = await Promise.all([
    prisma.studentMasteryRecord.findMany({
      where: {
        student_user_id: studentId,
        course_id: scope.course.course_id,
        ...(kpId ? { knowledge_point_id: kpId } : {}),
      },
      include: { knowledge_point: true },
      orderBy: { updated_at: 'desc' },
      take: kpId ? 1 : 20,
    }),
    scope.knowledgePoint?.parent_id
      ? prisma.studentMasteryRecord.findUnique({
          where: {
            student_user_id_course_id_knowledge_point_id: {
              student_user_id: studentId,
              course_id: scope.course.course_id,
              knowledge_point_id: scope.knowledgePoint.parent_id,
            },
          },
        })
      : Promise.resolve(null),
    prisma.studentPortrait.findUnique({
      where: {
        student_user_id_course_id: {
          student_user_id: studentId,
          course_id: scope.course.course_id,
        },
      },
    }),
    prisma.studentPortraitSnapshot.findMany({
      where: {
        student_user_id: studentId,
        course_id: scope.course.course_id,
        ...(params.reportPeriod
          ? {
              snapshot_date: {
                gte: params.reportPeriod.fromDate,
                lte: params.reportPeriod.toDate,
              },
            }
          : {}),
      },
      orderBy: { snapshot_date: 'asc' },
      take: 60,
    }),
    prisma.answerRecord.findMany({
      where: answerWhere(studentId, scope, params),
      include: {
        question: {
          select: {
            question_id: true,
            knowledge_point_id: true,
            difficulty_level: true,
            question_type: true,
          },
        },
        trainer_answer_detail: true,
      },
      orderBy: [{ submitted_at: 'desc' }, { created_at: 'desc' }],
      take: 100,
    }),
    prisma.practiceSession.findMany({
      where: {
        student_user_id: studentId,
        course_id: scope.course.course_id,
        ...(kpId ? { knowledge_point_id: kpId } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
    prisma.agentRunRecord.findMany({
      where: {
        student_user_id: studentId,
        course_id: scope.course.course_id,
        ...(params.sessionId ? { practice_session_id: params.sessionId } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 30,
    }),
    prisma.agentDiagnosticReport.findMany({
      where: {
        student_user_id: studentId,
        course_id: scope.course.course_id,
        ...(kpId ? { knowledge_point_id: kpId } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 5,
    }).catch(() => []),
  ]);

  return {
    masteryRecords,
    parentMastery,
    portrait,
    snapshots,
    answers,
    sessions,
    recentRuns,
    reports,
  };
}

function buildErrorDistribution(answers) {
  const distribution = {};
  for (const answer of answers) {
    const detail = answer.trainer_answer_detail?.deep_evaluation_json || {};
    const errorType = detail.error_type || detail.errorType;
    if (errorType) distribution[errorType] = (distribution[errorType] || 0) + 1;
  }
  return distribution;
}

function buildConfidenceCalibration(answers) {
  let highWrong = 0;
  let lowCorrect = 0;
  let totalWithConfidence = 0;
  for (const answer of answers) {
    const confidence = toLower(answer.trainer_answer_detail?.confidence_level);
    if (!confidence || confidence === 'unknown') continue;
    totalWithConfidence += 1;
    if (confidence === 'high' && answer.is_correct === false) highWrong += 1;
    if (confidence === 'low' && answer.is_correct === true) lowCorrect += 1;
  }
  const label = highWrong >= 2 ? 'overconfident' : (lowCorrect >= 2 ? 'underconfident' : 'unknown');
  return { label, high_wrong_count: highWrong, low_correct_count: lowCorrect, sample_size: totalWithConfidence };
}

function extractFocusPitfall(answer) {
  const detail = answer.trainer_answer_detail?.deep_evaluation_json || {};
  const candidates = [
    detail.focus_pitfall,
    detail.focusPitfall,
    detail.pitfall,
    detail.misconception,
    detail.error_analysis?.focus_pitfall,
    detail.error_analysis?.mental_model_gap,
    detail.error_analysis?.root_cause,
    detail.remediation?.focus_pitfall,
    detail.remediation?.explainer_hint,
  ];
  return candidates
    .map((item) => cleanText(item, 200))
    .find(Boolean) || '';
}

function buildFocusPitfall(answers) {
  for (const answer of answers) {
    const pitfall = extractFocusPitfall(answer);
    if (pitfall) return pitfall;
  }
  return '';
}

function buildAttentionTrend(answers) {
  const chronological = [...answers].reverse().filter((item) => item.duration_seconds != null);
  if (chronological.length < 4) return { profile: 'unknown', sample_size: chronological.length };
  const half = Math.floor(chronological.length / 2);
  const first = chronological.slice(0, half);
  const second = chronological.slice(half);
  const avg = (items) => items.reduce((sum, item) => sum + (item.duration_seconds || 0), 0) / Math.max(1, items.length);
  const firstAvg = avg(first);
  const secondAvg = avg(second);
  if (secondAvg > firstAvg * 1.5) return { profile: 'declining', first_avg_seconds: firstAvg, second_avg_seconds: secondAvg, sample_size: chronological.length };
  return { profile: 'sustained', first_avg_seconds: firstAvg, second_avg_seconds: secondAvg, sample_size: chronological.length };
}

function consecutiveCounts(answers) {
  let wrong = 0;
  let correct = 0;
  const latest = answers[0];
  if (!latest) return { wrong, correct };
  if (latest.is_correct === false) {
    for (const answer of answers) {
      if (answer.is_correct === false) wrong += 1;
      else break;
    }
  }
  if (latest.is_correct === true) {
    for (const answer of answers) {
      if (answer.is_correct === true) correct += 1;
      else break;
    }
  }
  return { wrong, correct };
}

function computeStatistics(data, scope) {
  const answers = data.answers || [];
  const answeredCount = answers.length;
  const correctCount = answers.filter((item) => item.is_correct === true).length;
  const wrongCount = answers.filter((item) => item.is_correct === false).length;
  const totalDuration = answers.reduce((sum, item) => sum + (item.duration_seconds || 0), 0);
  const currentMastery = data.masteryRecords[0] || null;
  const errorDistribution = buildErrorDistribution(answers);
  const confidence = buildConfidenceCalibration(answers);
  const attention = buildAttentionTrend(answers);
  const streak = consecutiveCounts(answers);
  const recentErrorType = Object.entries(errorDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
  const focusPitfall = buildFocusPitfall(answers);
  const allCorrectLong = answeredCount >= 3 && wrongCount === 0 && totalDuration / Math.max(1, answeredCount) > 120;
  const allWrongHighConfidence = answeredCount >= 3 && correctCount === 0 && confidence.high_wrong_count >= 2;

  return {
    student_id: String(scope.student.user_id),
    course: {
      id: String(scope.course.course_id),
      name: scope.course.course_name,
    },
    knowledge_point: scope.knowledgePoint
      ? {
          id: String(scope.knowledgePoint.knowledge_point_id),
          name: scope.knowledgePoint.knowledge_point_name,
          difficulty: toLower(scope.knowledgePoint.difficulty_level),
          parent_id: scope.knowledgePoint.parent_id ? String(scope.knowledgePoint.parent_id) : null,
        }
      : null,
    mastery: {
      current_score: currentMastery?.mastery_score ?? null,
      current_level: toLower(currentMastery?.mastery_level),
      prerequisite_score: data.parentMastery?.mastery_score ?? null,
      records: data.masteryRecords.map((record) => ({
        knowledge_point_id: String(record.knowledge_point_id),
        knowledge_point_name: record.knowledge_point?.knowledge_point_name || '',
        mastery_score: record.mastery_score,
        mastery_level: toLower(record.mastery_level),
        updated_at: toIso(record.updated_at),
      })),
    },
    answer_stats: {
      answer_count: answeredCount,
      correct_count: correctCount,
      wrong_count: wrongCount,
      accuracy: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null,
      avg_duration_seconds: answeredCount > 0 ? Math.round(totalDuration / answeredCount) : null,
      consecutive_wrong_count: streak.wrong,
      consecutive_correct_count: streak.correct,
      all_correct_long_time: allCorrectLong,
      all_wrong_high_confidence: allWrongHighConfidence,
    },
    error_type_distribution: errorDistribution,
    confidence_calibration: confidence,
    attention_trend: attention,
    strategy_history: data.recentRuns
      .filter((run) => run.agent_type === 'EXPLAINER' || run.agent_type === 'TRAINER')
      .map((run) => ({
        agent: toLower(run.agent_type),
        mode: run.mode,
        status: toLower(run.status),
        strategy: run.output_summary?.strategy || run.input_summary?.selectedStrategy || null,
        created_at: toIso(run.created_at),
      })),
    recent_error_type: recentErrorType,
    focus_pitfall: focusPitfall || recentErrorType,
    sample_quality: {
      sufficient: answeredCount >= 5,
      answer_count: answeredCount,
      session_count: data.sessions.length,
      limitations: answeredCount >= 5 ? [] : ['近期作答样本量不足，诊断结论需谨慎使用'],
    },
  };
}

function historicalComparison(data, params) {
  const snapshots = data.snapshots || [];
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const current = data.masteryRecords[0] || null;
  return {
    report_period: params.reportPeriod ? { from: params.reportPeriod.from, to: params.reportPeriod.to } : null,
    snapshot_count: snapshots.length,
    mastery_before: first?.mastery_summary || null,
    mastery_after: last?.mastery_summary || (current ? { [current.knowledge_point_id]: current.mastery_score } : null),
    knowledge_growth: current
      ? [{
          kp: String(current.knowledge_point_id),
          before: null,
          after: current.mastery_score,
          delta: null,
        }]
      : [],
  };
}

function buildCurrentState(stats, params) {
  const mastery = stats.mastery.current_score ?? 0;
  let abnormal = params.anomalyFlag || '';
  if (!abnormal && stats.answer_stats.consecutive_wrong_count >= 3) abnormal = 'consecutive_wrong_3';
  if (!abnormal && stats.answer_stats.all_correct_long_time) abnormal = 'all_correct_long_time';
  if (!abnormal && stats.answer_stats.all_wrong_high_confidence) abnormal = 'all_wrong_high_confidence';
  if (!abnormal && stats.attention_trend.profile === 'declining') abnormal = 'attention_declining';

  return {
    mastery_level: mastery,
    current_phase: params.mode,
    recent_error_type: stats.recent_error_type,
    consecutive_wrong_count: stats.answer_stats.consecutive_wrong_count,
    consecutive_correct_count: stats.answer_stats.consecutive_correct_count,
    current_strategy: stats.strategy_history[0]?.strategy || 'unknown',
    current_strategy_failure_count: stats.answer_stats.consecutive_wrong_count,
    attention_profile: stats.attention_trend.profile,
    abnormal_pattern: abnormal,
    focus_pitfall: stats.focus_pitfall || stats.recent_error_type,
  };
}

function buildPayload(studentId, scope, params, data, stats) {
  // Flatten internal stats to avoid Dify "Depth limit 5" recursion errors.
  // mastery.records is the deepest path. We flatten mastery into top-level scalars
  // and serialize records to a JSON string so the total depth stays ≤ 4.
  const { mastery, ...statsRest } = stats;
  const masteryRecords = mastery?.records || [];
  const flattenedStats = {
    ...statsRest,
    mastery_current_score: mastery?.current_score ?? null,
    mastery_current_level: mastery?.current_level ?? null,
    mastery_prerequisite_score: mastery?.prerequisite_score ?? null,
    mastery_records_json: masteryRecords.length > 0 ? JSON.stringify(masteryRecords) : '[]',
  };

  return {
    student_id: String(studentId),
    knowledge_point_id: scope.knowledgePoint ? String(scope.knowledgePoint.knowledge_point_id) : '',
    session_id: params.sessionId ? String(params.sessionId) : '',
    anomaly_flag: params.anomalyFlag || '',
    preprocessed_data: flattenedStats,
    current_state: buildCurrentState(stats, params),
    historical_comparison: params.mode === 'growth_report' ? historicalComparison(data, params) : {},
    report_period: params.reportPeriod ? { from: params.reportPeriod.from, to: params.reportPeriod.to } : {},
  };
}

function normalizeStrategy(value, fallback = 'direct_instruction') {
  const raw = String(value || '').trim();
  return STRATEGY_ALIASES[raw] || (STRATEGIES.has(raw) ? raw : fallback);
}

function detectDeterministicInterventions(stats) {
  const interventions = [];
  const wrong = stats.answer_stats.consecutive_wrong_count || 0;
  const correct = stats.answer_stats.consecutive_correct_count || 0;
  const avgDuration = stats.answer_stats.avg_duration_seconds || 0;
  const mastery = stats.mastery.current_score || 0;
  const focus = stats.focus_pitfall || (stats.recent_error_type === 'unknown' ? 'recent_error_pattern' : stats.recent_error_type);

  if (wrong >= 3) {
    interventions.push({
      trigger: `连续 ${wrong} 题错误`,
      target_agent: 'trainer',
      instruction: {
        action: 'reduce_difficulty_and_focus',
        params: { difficulty: 'basic', focus_pitfall: focus, max_questions: 3 },
      },
      priority: 20,
      reasoning: '连续错误优先降低训练难度并聚焦单一薄弱点。',
    });
  }
  if ((stats.strategy_history[0]?.agent === 'explainer' && wrong >= 2) || wrong >= 2) {
    interventions.push({
      trigger: '当前教法连续失败 2 次',
      target_agent: 'explainer',
      instruction: {
        action: 'switch_strategy',
        params: { strategy: 'analogy_bridge', focus_misconception: focus },
      },
      priority: 25,
      reasoning: '已有讲解策略没有转化为正确作答，切换讲解方式。',
    });
  }
  if (stats.answer_stats.all_correct_long_time || (correct >= 3 && avgDuration > 120)) {
    interventions.push({
      trigger: '全对但耗时异常长',
      target_agent: 'trainer',
      instruction: {
        action: 'insert_diagnostic_question',
        params: { reason: 'correct_but_slow', focus_pitfall: focus },
      },
      priority: 30,
      reasoning: '正确率尚可但耗时过长，需要确认是否只是套公式。',
    });
  }
  if (stats.answer_stats.all_wrong_high_confidence) {
    interventions.push({
      trigger: '全错且信心高',
      target_agent: 'trainer',
      instruction: {
        action: 'insert_diagnostic_question',
        params: { reason: 'confidence_calibration', focus_pitfall: focus },
      },
      priority: 15,
      reasoning: '高信心错误通常意味着心智模型偏差。',
    });
  }
  if (stats.attention_trend.profile === 'declining') {
    interventions.push({
      trigger: '注意力持续下降',
      target_agent: 'orchestrator',
      instruction: {
        action: 'suggest_break',
        params: { duration_minutes: 5 },
      },
      priority: 40,
      reasoning: '耗时趋势明显上升，建议短休息后继续。',
    });
  }
  if (mastery >= 85 && correct >= 3) {
    interventions.push({
      trigger: '已明显掌握当前知识点',
      target_agent: 'orchestrator',
      instruction: {
        action: 'advance_to_next_stage',
        params: { reason: 'mastery_sufficient' },
      },
      priority: 60,
      reasoning: '重复同层级练习收益较低。',
    });
  }
  return interventions;
}

function normalizeTargetAgent(value) {
  const target = String(value || '').trim().toLowerCase();
  if (target === 'frontend') return 'orchestrator';
  if (['trainer', 'explainer', 'orchestrator'].includes(target)) return target;
  return target || 'orchestrator';
}

function normalizeAction(targetAgent, action) {
  const raw = String(action || '').trim();
  if (raw === 'recommend_skip') return 'advance_to_next_stage';
  if (raw === 'continue_current_strategy') return 'continue_current_plan';
  if (targetAgent === 'trainer' && raw === 'recommend_skip') return 'skip_remaining_practice';
  return raw;
}

function validateParams(targetAgent, action, params = {}) {
  const safeParams = params && typeof params === 'object' && !Array.isArray(params) ? { ...params } : {};
  if (action === 'switch_strategy') {
    const normalized = {
      strategy: normalizeStrategy(safeParams.strategy, 'direct_instruction'),
    };
    const focus = cleanText(safeParams.focus_misconception || safeParams.focusMisconception || safeParams.focus_pitfall || '', 200);
    if (focus) normalized.focus_misconception = focus;
    return normalized;
  }
  if (action === 'reduce_difficulty_and_focus') {
    const difficulty = String(safeParams.difficulty || 'basic').toLowerCase();
    return {
      difficulty: ['basic', 'medium', 'hard'].includes(difficulty) ? difficulty : 'basic',
      focus_pitfall: cleanText(safeParams.focus_pitfall || safeParams.focusPitfall || 'recent_error_pattern', 200),
      max_questions: Math.min(10, Math.max(1, Number.parseInt(safeParams.max_questions || 3, 10))),
    };
  }
  if (action === 'suggest_break') {
    return {
      duration_minutes: Math.min(30, Math.max(1, Number.parseInt(safeParams.duration_minutes || 5, 10))),
    };
  }
  return safeParams;
}

function validateInstruction(rawTargetAgent, instruction) {
  const targetAgent = normalizeTargetAgent(rawTargetAgent);
  const rawAction = instruction?.action;
  const action = normalizeAction(targetAgent, rawAction);
  const allowed = (targetAgent === 'trainer' && TRAINER_ACTIONS.has(action))
    || (targetAgent === 'explainer' && EXPLAINER_ACTIONS.has(action))
    || (targetAgent === 'orchestrator' && ORCHESTRATOR_ACTIONS.has(action));

  if (!allowed) {
    return {
      valid: false,
      targetAgent,
      action: action || 'unknown',
      params: instruction?.params || {},
      reason: '未知或不允许的干预动作',
    };
  }
  return {
    valid: true,
    targetAgent,
    action,
    params: validateParams(targetAgent, action, instruction?.params || {}),
    reason: '',
  };
}

function collectBranchInterventions(branchResult) {
  const result = branchResult.result || {};
  const collected = [];
  const push = (item, suffix = '') => {
    if (!item || !item.instruction) return;
    collected.push({
      uid: item.intervention_id ? `${item.intervention_id}${suffix}` : '',
      trigger: item.trigger || result.trigger || '',
      target_agent: item.target_agent || result.target_agent,
      instruction: item.instruction,
      priority: item.priority || 50,
      reasoning: item.reasoning || result.reasoning || '',
    });
  };
  push(result);
  if (result.parallel_instruction_to_explainer) {
    push({
      intervention_id: result.intervention_id,
      trigger: result.trigger,
      target_agent: 'explainer',
      instruction: result.parallel_instruction_to_explainer,
      priority: 35,
      reasoning: result.reasoning,
    }, '_explainer');
  }
  if (Array.isArray(result.all_interventions)) {
    result.all_interventions.slice(0, 5).forEach((item, index) => push(item, `_candidate_${index + 1}`));
  }

  const seen = new Set();
  return collected.filter((item) => {
    const key = `${item.target_agent}:${item.instruction?.action}:${JSON.stringify(item.instruction?.params || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function interventionResultItem(item) {
  return {
    trigger: item.trigger || '',
    target_agent: item.target_agent,
    instruction: item.instruction,
    priority: item.priority || 50,
    reasoning: item.reasoning || '',
  };
}

function mergeDeterministicInterventions(branchResult, deterministic = []) {
  if (!Array.isArray(deterministic) || deterministic.length === 0) return branchResult;
  const result = { ...(branchResult.result || {}) };
  const deterministicItems = deterministic.map(interventionResultItem);
  const sorted = [...deterministicItems].sort((a, b) => (a.priority || 50) - (b.priority || 50));
  const primary = sorted.find((item) => item.target_agent === 'trainer') || sorted[0];
  const explainer = sorted.find((item) => item.target_agent === 'explainer');

  if (primary?.instruction) {
    result.trigger = primary.trigger || result.trigger || '';
    result.target_agent = primary.target_agent;
    result.instruction = primary.instruction;
    result.priority = primary.priority;
    result.reasoning = primary.reasoning || result.reasoning || '';
  }
  if (explainer?.instruction) {
    result.parallel_instruction_to_explainer = explainer.instruction;
  }

  const combined = [
    ...deterministicItems,
    ...(Array.isArray(result.all_interventions) ? result.all_interventions : []),
  ];
  const seen = new Set();
  result.all_interventions = combined.filter((item) => {
    const checked = validateInstruction(item.target_agent, item.instruction || { action: item.action, params: item.params });
    const key = checked.valid
      ? `${checked.targetAgent}:${checked.action}:${JSON.stringify(checked.params || {})}`
      : `${item.target_agent}:${item.instruction?.action || item.action}:${JSON.stringify(item.instruction?.params || item.params || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ...branchResult,
    result,
    meta: {
      ...(branchResult.meta || {}),
      deterministic_intervention_count: deterministic.length,
    },
  };
}

async function createRunRecord({ studentId, userId, scope, params, inputSummary }) {
  return prisma.agentRunRecord.create({
    data: {
      user_id: userId,
      student_user_id: studentId,
      course_id: scope.course.course_id,
      practice_session_id: params.sessionId || null,
      agent_type: 'DIAGNOSTICIAN',
      request_id: params.requestId,
      mode: params.mode,
      status: 'RUNNING',
      input_summary: inputSummary,
      input_json: null,
    },
  });
}

async function markRunSuccess(runId, metadata, outputSummary) {
  return prisma.agentRunRecord.update({
    where: { agent_run_id: runId },
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
  return prisma.agentRunRecord.update({
    where: { agent_run_id: runId },
    data: {
      status: 'FAILED',
      error_code: err?.code || 'DIAGNOSTICIAN_INTERNAL_ERROR',
      error_message: String(err?.message || '诊断师调用失败').slice(0, 2000),
      output_summary: err?.data || null,
    },
  }).catch(() => null);
}

async function persistDiagnosticReport({ studentId, scope, params, runRecord, branchResult, data, stats }) {
  const result = branchResult.result || branchResult;
  const dataQuality = result.data_quality || branchResult.meta?.data_quality || stats.sample_quality || {};
  return prisma.agentDiagnosticReport.create({
    data: {
      student_user_id: studentId,
      course_id: scope.course.course_id,
      knowledge_point_id: scope.knowledgePoint?.knowledge_point_id || null,
      practice_session_id: params.sessionId || null,
      agent_run_id: runRecord.agent_run_id,
      mode: params.mode,
      request_id: params.requestId,
      report_period_start: params.reportPeriod ? dateOrNull(params.reportPeriod.fromDate) : null,
      report_period_end: params.reportPeriod ? dateOrNull(params.reportPeriod.toDate) : null,
      result_json: branchResult,
      statistics_snapshot_json: {
        preprocessed_data: stats,
        historical_comparison: historicalComparison(data, params),
      },
      data_quality_json: dataQuality,
    },
  });
}

async function persistInterventions({ studentId, scope, params, runRecord, branchResult, deterministic = [] }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const candidates = [
    ...deterministic.map((item, index) => ({
      ...item,
      uid: `rule_${params.requestId}_${index + 1}`,
      source: 'backend_rule',
    })),
    ...collectBranchInterventions(branchResult).map((item, index) => ({
      ...item,
      uid: item.uid || `dify_${params.requestId}_${index + 1}`,
      source: 'diagnostician',
    })),
  ];

  const saved = [];
  const seenCandidates = new Set();
  for (const candidate of candidates) {
    const checked = validateInstruction(candidate.target_agent, candidate.instruction);
    const candidateKey = `${checked.targetAgent}:${checked.action}:${JSON.stringify(checked.params || {})}`;
    if (seenCandidates.has(candidateKey)) continue;
    seenCandidates.add(candidateKey);
    const status = checked.valid ? 'pending' : 'ignored';
    const existing = await prisma.agentIntervention.findUnique({
      where: { intervention_uid: candidate.uid },
    });
    if (existing && ['applied', 'failed', 'expired', 'ignored'].includes(existing.status)) {
      saved.push(existing);
      continue;
    }

    const data = {
      target_agent: checked.targetAgent,
      action: checked.action,
      params_json: checked.params,
      trigger_reason: cleanText(candidate.trigger || candidate.reasoning || checked.reason, 1000),
      status,
      result_json: checked.valid ? null : { reason: checked.reason, raw_instruction: candidate.instruction },
      ...(checked.valid ? {} : { ignored_at: now }),
    };

    const savedItem = existing
      ? await prisma.agentIntervention.update({
        where: { agent_intervention_id: existing.agent_intervention_id },
        data,
      })
      : await prisma.agentIntervention.create({
        data: {
        intervention_uid: candidate.uid,
        student_user_id: studentId,
        course_id: scope.course.course_id,
        knowledge_point_id: scope.knowledgePoint?.knowledge_point_id || null,
        practice_session_id: params.sessionId || null,
        source_agent_run_id: runRecord?.agent_run_id || null,
        source: candidate.source || 'diagnostician',
        target_agent: checked.targetAgent,
        action: checked.action,
        params_json: checked.params,
        trigger_reason: cleanText(candidate.trigger || candidate.reasoning || checked.reason, 1000),
        status,
        priority: Number.isFinite(Number(candidate.priority)) ? Number(candidate.priority) : 50,
        expires_at: checked.valid ? expiresAt : null,
        ignored_at: checked.valid ? null : now,
        result_json: checked.valid ? null : { reason: checked.reason, raw_instruction: candidate.instruction },
      },
      });
    saved.push(savedItem);
  }
  return saved;
}

async function runDiagnosticianWorkflow({ actor, params, studentId, scope, payload, stats, data, deterministicInterventions = [] }) {
  const runRecord = await createRunRecord({
    studentId,
    userId: actor.user_id,
    scope,
    params,
    inputSummary: {
      mode: params.mode,
      knowledgePointId: scope.knowledgePoint?.knowledge_point_id || null,
      sessionId: params.sessionId || null,
      answerCount: stats.answer_stats.answer_count,
      deterministicInterventionCount: deterministicInterventions.length,
    },
  });

  try {
    const difyUser = buildDifyUser('diagnostician', studentId);
    const { branchResult: rawBranchResult, metadata } = await runDifyDiagnosticianWorkflow({
      mode: params.mode,
      requestId: params.requestId,
      payload,
      locale: params.locale,
      debug: params.debug,
      difyUser,
    });
    const branchResult = params.mode === 'strategy_intervention'
      ? mergeDeterministicInterventions(rawBranchResult, deterministicInterventions)
      : rawBranchResult;

    const interventions = params.mode === 'strategy_intervention'
      ? await persistInterventions({ studentId, scope, params, runRecord, branchResult, deterministic: deterministicInterventions })
      : [];
    const report = await persistDiagnosticReport({ studentId, scope, params, runRecord, branchResult, data, stats });

    await markRunSuccess(runRecord.agent_run_id, metadata, {
      mode: branchResult.mode || params.mode,
      success: true,
      interventionCount: interventions.length,
      diagnosticReportId: report.diagnostic_report_id,
    });

    return {
      mode: params.mode,
      requestId: params.requestId,
      result: branchResult.result || {},
      meta: branchResult.meta || {},
      interventions: interventions.map(interventionDto),
      diagnosticReportId: report.diagnostic_report_id,
    };
  } catch (err) {
    await markRunFailed(runRecord.agent_run_id, err);
    throw err;
  }
}

function interventionDto(item) {
  return {
    id: item.agent_intervention_id,
    uid: item.intervention_uid,
    targetAgent: item.target_agent,
    action: item.action,
    params: item.params_json || {},
    status: item.status,
    priority: item.priority,
    triggerReason: item.trigger_reason,
    expiresAt: toIso(item.expires_at),
    createdAt: toIso(item.created_at),
  };
}

async function analyze(actor, rawBody) {
  const params = validateDiagnosticianAnalyzeBody(rawBody);
  const studentId = await resolveStudentId(actor, params);
  const scope = await resolveScope(actor, studentId, params);
  const data = await loadLearningData(studentId, scope, params);
  const stats = computeStatistics(data, { ...scope, student: scope.student || { user_id: studentId } });
  const payload = buildPayload(studentId, scope, params, data, stats);
  const deterministicInterventions = params.mode === 'strategy_intervention'
    ? detectDeterministicInterventions(stats)
    : [];
  return runDiagnosticianWorkflow({
    actor,
    params,
    studentId,
    scope,
    payload,
    stats,
    data,
    deterministicInterventions,
  });
}

async function buildMentalModel(actor, rawBody) {
  return analyze(actor, { ...rawBody, mode: 'mental_model' });
}

async function generateIntervention(actor, rawBody) {
  return analyze(actor, { ...rawBody, mode: 'strategy_intervention' });
}

async function generateGrowthReport(actor, rawBody) {
  return analyze(actor, { ...rawBody, mode: 'growth_report' });
}

async function maybeGenerateInterventionAfterTrainerAnswer(userId, sessionId, extra = {}) {
  const session = await prisma.practiceSession.findUnique({
    where: { practice_session_id: sessionId },
    include: { knowledge_point: true },
  });
  if (!session || session.student_user_id !== userId || !session.knowledge_point_id) return null;

  const actor = { user_id: userId, role: 'student' };
  const params = {
    mode: 'strategy_intervention',
    knowledgePointId: session.knowledge_point_id,
    sessionId,
    anomalyFlag: extra.anomalyFlag || '',
    locale: extra.locale || 'zh-CN',
    debug: false,
    requestId: extra.requestId || `trainer_trigger_${sessionId}_${Date.now()}`,
    requestedStudentId: null,
  };
  const scope = await resolveScope(actor, userId, params);
  const data = await loadLearningData(userId, scope, params);
  const stats = computeStatistics(data, { ...scope, student: scope.student || { user_id: userId } });
  const deterministic = detectDeterministicInterventions(stats);
  if (deterministic.length === 0) return null;

  const payload = buildPayload(userId, scope, params, data, stats);
  if (!hasUsableConfig('diagnostician')) {
    const fakeRun = await createRunRecord({
      studentId: userId,
      userId,
      scope,
      params,
      inputSummary: {
        mode: params.mode,
        sessionId,
        deterministicInterventionCount: deterministic.length,
        difySkipped: true,
      },
    });
    const branchResult = {
      success: true,
      mode: params.mode,
      request_id: params.requestId,
      result: {},
      meta: { source: 'backend_rule_only' },
    };
    const interventions = await persistInterventions({ studentId: userId, scope, params, runRecord: fakeRun, branchResult, deterministic });
    await markRunSuccess(fakeRun.agent_run_id, { response_time_ms: 0 }, {
      mode: params.mode,
      success: true,
      interventionCount: interventions.length,
      difySkipped: true,
    });
    return { interventions: interventions.map(interventionDto), difySkipped: true };
  }

  return runDiagnosticianWorkflow({
    actor,
    params,
    studentId: userId,
    scope,
    payload,
    stats,
    data,
    deterministicInterventions: deterministic,
  });
}

module.exports = {
  analyze,
  buildMentalModel,
  buildPayload,
  computeStatistics,
  detectDeterministicInterventions,
  generateGrowthReport,
  generateIntervention,
  maybeGenerateInterventionAfterTrainerAnswer,
  persistInterventions,
  runDiagnosticianWorkflow,
  validateInstruction,
  mergeDeterministicInterventions,
};
