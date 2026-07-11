const prisma = require('../../../config/prisma');
const {
  buildDifyUser,
  metadataElapsedMs,
  openExplainerChatStream,
} = require('../../dify/agent-dify.service');
const { createAgentError } = require('../common/agent.errors');
const {
  applyClaimedIntervention,
  claimPendingIntervention,
  failClaimedIntervention,
} = require('../common/intervention.service');
const { DIFY_STRATEGY, validateExplainerChatBody } = require('./explainer.validator');

// ---- LangGraph 模式支持 ----
const AGENT_MODE = process.env.AGENT_MODE || 'dify';

function isLangGraphMode() {
  return AGENT_MODE === 'langgraph' && process.env.LANGGRAPH_ENABLED === 'true';
}

const CANONICAL_BY_DIFY = {
  direct: 'direct_instruction',
  socratic: 'socratic_dialogue',
  analogy: 'analogy_bridge',
  misconception: 'misconception_confrontation',
  auto: 'auto',
};

const STRATEGY_BY_ACTION = {
  focus_misconception: 'misconception_confrontation',
  provide_analogy: 'analogy_bridge',
  review_prerequisite: 'direct_instruction',
  summarize_and_confirm: 'direct_instruction',
};

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function clampText(value, length = 500) {
  const text = String(value || '').trim();
  return text.length > length ? text.slice(0, length) : text;
}

function safeJsonString(value, maxLength = 5000) {
  try {
    return JSON.stringify(value, null, 0).slice(0, maxLength);
  } catch {
    return '[]';
  }
}

async function assertKnowledgePointAccess(userId, knowledgePointId, practiceSessionId = null) {
  const [student, knowledgePoint, enrollment, practiceSession] = await Promise.all([
    prisma.user.findUnique({
      where: { user_id: userId },
      include: { profile: true },
    }),
    prisma.knowledgePoint.findUnique({
      where: { knowledge_point_id: knowledgePointId },
      include: {
        course: true,
        chapter: true,
        parent: true,
      },
    }),
    prisma.studentCourseEnrollment.findFirst({
      where: {
        student_user_id: userId,
        course: { knowledge_points: { some: { knowledge_point_id: knowledgePointId } } },
        enrollment_status: { in: ['active', 'ACTIVE'] },
      },
      include: { teachingClass: true },
    }),
    practiceSessionId
      ? prisma.practiceSession.findUnique({
          where: { practice_session_id: practiceSessionId },
          select: {
            practice_session_id: true,
            student_user_id: true,
            course_id: true,
            knowledge_point_id: true,
            status: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!student) throw createAgentError('STUDENT_NOT_FOUND', '学生不存在', 404);
  if (!knowledgePoint) throw createAgentError('KNOWLEDGE_POINT_NOT_FOUND', '知识点不存在', 404);
  if (!enrollment) throw createAgentError('COURSE_ACCESS_DENIED', '当前学生没有该知识点访问权', 403);
  if (practiceSession && (
    practiceSession.student_user_id !== userId
    || practiceSession.course_id !== knowledgePoint.course_id
    || (practiceSession.knowledge_point_id && practiceSession.knowledge_point_id !== knowledgePointId)
  )) {
    throw createAgentError('SESSION_ACCESS_DENIED', '学习会话不属于当前学生或知识点', 403);
  }

  return {
    student,
    knowledgePoint,
    course: knowledgePoint.course,
    chapter: knowledgePoint.chapter,
    enrollment,
    practiceSession,
  };
}

async function loadExplainerContext(userId, knowledgePoint, courseId, practiceSessionId = null) {
  const parentId = knowledgePoint.parent_id || null;
  const [mastery, parentMastery, portrait, recentAnswers, recentDetails, wrongQuestions, recentReports, pendingIntervention] = await Promise.all([
    prisma.studentMasteryRecord.findUnique({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: userId,
          course_id: courseId,
          knowledge_point_id: knowledgePoint.knowledge_point_id,
        },
      },
    }),
    parentId
      ? prisma.studentMasteryRecord.findUnique({
          where: {
            student_user_id_course_id_knowledge_point_id: {
              student_user_id: userId,
              course_id: courseId,
              knowledge_point_id: parentId,
            },
          },
        })
      : Promise.resolve(null),
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
          knowledge_point_id: knowledgePoint.knowledge_point_id,
        },
      },
      orderBy: [{ submitted_at: 'desc' }, { created_at: 'desc' }],
      take: 20,
      select: {
        is_correct: true,
        duration_seconds: true,
        submitted_at: true,
        created_at: true,
      },
    }),
    prisma.trainerAnswerDetail.findMany({
      where: {
        answer_record: {
          student_user_id: userId,
          question: {
            course_id: courseId,
            knowledge_point_id: knowledgePoint.knowledge_point_id,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
      include: {
        answer_record: {
          select: {
            is_correct: true,
            duration_seconds: true,
            submitted_at: true,
          },
        },
      },
    }),
    prisma.wrongQuestion.findMany({
      where: {
        student_user_id: userId,
        course_id: courseId,
        knowledge_point_id: knowledgePoint.knowledge_point_id,
        status: { not: 'REMOVED' },
      },
      orderBy: { updated_at: 'desc' },
      take: 10,
      select: {
        wrong_reason: true,
        review_status: true,
        last_wrong_at: true,
        updated_at: true,
      },
    }),
    prisma.agentDiagnosticReport.findMany({
      where: {
        student_user_id: userId,
        knowledge_point_id: knowledgePoint.knowledge_point_id,
      },
      orderBy: { created_at: 'desc' },
      take: 3,
      select: {
        mode: true,
        result_json: true,
        created_at: true,
      },
    }).catch(() => []),
    claimPendingIntervention({
      studentUserId: userId,
      targetAgent: 'explainer',
      courseId,
      knowledgePointId: knowledgePoint.knowledge_point_id,
      practiceSessionId,
    }).catch(() => null),
  ]);

  const answeredCount = recentAnswers.length;
  const correctCount = recentAnswers.filter((item) => item.is_correct === true).length;
  const errorTypes = {};
  const misconceptions = [];
  for (const detail of recentDetails) {
    const evaluation = detail.deep_evaluation_json || {};
    const errorType = evaluation.error_type || evaluation.errorType;
    if (errorType) errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
    const gap = evaluation.error_analysis?.mental_model_gap
      || evaluation.error_analysis?.root_cause
      || evaluation.mental_model_gap
      || evaluation.remediation?.explainer_hint;
    if (gap) misconceptions.push({ description: clampText(gap, 240), error_type: errorType || 'unknown' });
  }

  return {
    mastery,
    parentMastery,
    portrait,
    recentPractice: {
      answer_count: answeredCount,
      correct_count: correctCount,
      accuracy: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null,
      avg_duration_seconds: answeredCount > 0
        ? Math.round(recentAnswers.reduce((sum, item) => sum + (item.duration_seconds || 0), 0) / answeredCount)
        : null,
      latest_answered_at: toIso(recentAnswers[0]?.submitted_at || recentAnswers[0]?.created_at),
    },
    errorTypes,
    misconceptions,
    wrongQuestions,
    recentReports,
    pendingIntervention,
  };
}

function inferExposureAndDepth(context) {
  const score = context.mastery?.mastery_score;
  if (score == null) return { exposureLevel: 'unknown', understandingDepth: 'unknown' };
  if (score < 30) return { exposureLevel: 'new', understandingDepth: 'shallow' };
  if (score < 60) return { exposureLevel: 'familiar_but_shallow', understandingDepth: 'shallow' };
  if (score < 85) return { exposureLevel: 'familiar', understandingDepth: 'moderate' };
  return { exposureLevel: 'mastered', understandingDepth: 'deep' };
}

function inferLearningStyle(context) {
  const latestMentalModel = context.recentReports
    .map((item) => item.result_json?.result?.mental_model_summary || item.result_json?.mental_model_summary)
    .find(Boolean);
  const style = latestMentalModel?.learning_style_indicators?.preferred_modality;
  if (['visual', 'verbal', 'example_driven', 'practice_driven', 'mixed'].includes(style)) return style;

  if ((context.portrait?.wrong_question_score ?? 100) < 60) return 'example_driven';
  return 'unknown';
}

function strategyFromIntervention(intervention) {
  if (!intervention) return null;
  const params = intervention.params_json || {};
  if (intervention.action === 'switch_strategy' && params.strategy) {
    return CANONICAL_BY_DIFY[params.strategy] || params.strategy;
  }
  return STRATEGY_BY_ACTION[intervention.action] || null;
}

function selectExplainerStrategy({ strategyHint, context }) {
  if (strategyHint && strategyHint !== 'auto') {
    return {
      strategy: strategyHint,
      source: 'manual',
      reason: '调用方明确指定教学策略',
    };
  }

  const interventionStrategy = strategyFromIntervention(context.pendingIntervention);
  if (interventionStrategy) {
    return {
      strategy: interventionStrategy,
      source: 'diagnostician_intervention',
      reason: context.pendingIntervention.trigger_reason || `诊断师建议执行 ${context.pendingIntervention.action}`,
    };
  }

  if (context.misconceptions.length > 0 || Object.keys(context.errorTypes).length > 0) {
    return {
      strategy: 'misconception_confrontation',
      source: 'error_pattern',
      reason: '最近训练记录中存在可定位的典型误解或错误类型',
    };
  }

  const masteryScore = context.mastery?.mastery_score;
  const learningStyle = inferLearningStyle(context);
  if (learningStyle === 'visual') {
    return {
      strategy: 'analogy_bridge',
      source: 'learning_style',
      reason: '学生画像显示视觉/类比线索更可能有效',
    };
  }
  if (masteryScore == null || masteryScore < 35) {
    return {
      strategy: 'direct_instruction',
      source: 'mastery',
      reason: '当前知识点掌握度较低或缺少有效记录，先建立基础概念',
    };
  }
  if (masteryScore < 75) {
    return {
      strategy: 'socratic_dialogue',
      source: 'mastery',
      reason: '学生已有基础但理解深度仍需确认',
    };
  }

  return {
    strategy: 'direct_instruction',
    source: 'default',
    reason: '未检测到需要特殊切换的误解或学习风格信号',
  };
}

function buildProfileSummary({ userId, student, course, knowledgePoint, chapter, context, depth, decision }) {
  const { exposureLevel, understandingDepth } = inferExposureAndDepth(context);
  const payload = {
    student_id: String(userId),
    profile: student.profile
      ? {
          grade: student.profile.grade,
          major: student.profile.major,
        }
      : {},
    course: {
      id: String(course.course_id),
      name: course.course_name,
    },
    chapter: chapter ? { id: String(chapter.chapter_id), name: chapter.chapter_name } : null,
    knowledge_point: {
      id: String(knowledgePoint.knowledge_point_id),
      name: knowledgePoint.knowledge_point_name,
      difficulty: String(knowledgePoint.difficulty_level || '').toLowerCase(),
      parent_id: knowledgePoint.parent_id ? String(knowledgePoint.parent_id) : null,
      parent_name: knowledgePoint.parent?.knowledge_point_name || null,
    },
    mastery: {
      current_score: context.mastery?.mastery_score ?? null,
      current_level: String(context.mastery?.mastery_level || '').toLowerCase() || null,
      prerequisite_score: context.parentMastery?.mastery_score ?? null,
    },
    portrait: {
      learning_total_score: context.portrait?.learning_total_score ?? null,
      mastery_score: context.portrait?.mastery_score ?? null,
      wrong_question_score: context.portrait?.wrong_question_score ?? null,
      activity_score: context.portrait?.activity_score ?? null,
    },
    recent_practice: context.recentPractice,
    error_type_distribution: context.errorTypes,
    known_weaknesses: context.wrongQuestions.map((item) => ({
      wrong_reason: String(item.wrong_reason || '').toLowerCase(),
      review_status: String(item.review_status || '').toLowerCase(),
      last_wrong_at: toIso(item.last_wrong_at || item.updated_at),
    })),
    diagnostician_instruction: context.pendingIntervention
      ? {
          id: context.pendingIntervention.intervention_uid,
          action: context.pendingIntervention.action,
          params: context.pendingIntervention.params_json || {},
          reason: context.pendingIntervention.trigger_reason || '',
        }
      : null,
    strategy_decision: decision,
    requested_depth: depth,
  };

  return {
    profileSummary: safeJsonString(payload, 5000),
    exposureLevel,
    understandingDepth,
    learningStyle: inferLearningStyle(context),
    detectedMisconceptions: safeJsonString(context.misconceptions.slice(0, 6), 5000),
    interestTags: safeJsonString([], 2000),
  };
}

async function resolveConversation(userId, params, knowledgePoint, courseId) {
  if (params.conversationId) {
    const conversation = await prisma.agentConversation.findUnique({
      where: {
        student_user_id_agent_type_dify_conversation_id: {
          student_user_id: userId,
          agent_type: 'EXPLAINER',
          dify_conversation_id: params.conversationId,
        },
      },
    });
    if (!conversation || conversation.status !== 'active') {
      throw createAgentError('CONVERSATION_NOT_FOUND', '讲解者会话不存在或无权访问', 404);
    }
    if (conversation.knowledge_point_id && conversation.knowledge_point_id !== knowledgePoint.knowledge_point_id) {
      throw createAgentError('CONVERSATION_SCOPE_MISMATCH', '该 conversation_id 不属于当前知识点', 403);
    }
    return conversation;
  }

  if (params.newConversation || !params.learningSessionId) return null;

  return prisma.agentConversation.findFirst({
    where: {
      student_user_id: userId,
      agent_type: 'EXPLAINER',
      course_id: courseId,
      knowledge_point_id: knowledgePoint.knowledge_point_id,
      learning_session_id: params.learningSessionId,
      status: 'active',
    },
    orderBy: { updated_at: 'desc' },
  });
}

async function createRunRecord({ userId, courseId, knowledgePointId, practiceSessionId, requestId, inputSummary }) {
  return prisma.agentRunRecord.create({
    data: {
      user_id: userId,
      student_user_id: userId,
      course_id: courseId,
      practice_session_id: practiceSessionId || null,
      agent_type: 'EXPLAINER',
      request_id: requestId,
      mode: 'chat',
      status: 'RUNNING',
      input_summary: inputSummary,
      input_json: null,
    },
  });
}

async function markRunFailed(runId, err, status = 'FAILED') {
  return prisma.agentRunRecord.update({
    where: { agent_run_id: runId },
    data: {
      status,
      error_code: err?.code || (status === 'STOPPED' ? 'CLIENT_DISCONNECTED' : 'EXPLAINER_INTERNAL_ERROR'),
      error_message: String(err?.message || '讲解者调用失败').slice(0, 2000),
      output_summary: err?.data || null,
    },
  }).catch(() => null);
}

async function markRunSuccess({ runId, metadata, outputSummary }) {
  return prisma.agentRunRecord.update({
    where: { agent_run_id: runId },
    data: {
      status: 'SUCCESS',
      dify_workflow_run_id: metadata.workflow_run_id || metadata.task_id || null,
      response_time_ms: metadata.response_time_ms == null ? null : Math.round(Number(metadata.response_time_ms)),
      total_tokens: metadata.total_tokens == null ? null : Math.round(Number(metadata.total_tokens)),
      elapsed_ms: metadataElapsedMs(metadata),
      output_summary: outputSummary,
      output_json: outputSummary,
    },
  });
}

async function upsertConversation({ userId, courseId, knowledgePointId, practiceSessionId, learningSessionId, conversationId, strategy, metadata }) {
  if (!conversationId) return null;
  return prisma.agentConversation.upsert({
    where: {
      student_user_id_agent_type_dify_conversation_id: {
        student_user_id: userId,
        agent_type: 'EXPLAINER',
        dify_conversation_id: conversationId,
      },
    },
    update: {
      course_id: courseId,
      knowledge_point_id: knowledgePointId,
      practice_session_id: practiceSessionId || null,
      learning_session_id: learningSessionId || null,
      status: 'active',
      last_strategy: strategy,
      metadata_json: metadata,
    },
    create: {
      student_user_id: userId,
      course_id: courseId,
      knowledge_point_id: knowledgePointId,
      practice_session_id: practiceSessionId || null,
      agent_type: 'EXPLAINER',
      dify_conversation_id: conversationId,
      learning_session_id: learningSessionId || null,
      status: 'active',
      last_strategy: strategy,
      metadata_json: metadata,
    },
  });
}

function parseSseBlock(block) {
  let event = '';
  const data = [];
  for (const line of String(block || '').split('\n')) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join('\n') };
}

function parseDifyPayload(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { answer: raw };
  }
}

function transformDifyStreamEvent(eventName, payload) {
  const difyEvent = payload?.event || eventName || '';
  if (difyEvent === 'message' || difyEvent === 'agent_message') {
    return [{
      event: 'delta',
      data: {
        text: payload.answer || payload.delta || '',
        conversationId: payload.conversation_id || null,
        messageId: payload.message_id || payload.id || null,
      },
    }];
  }

  if (difyEvent === 'message_end') {
    return [
      {
        event: 'metadata',
        data: {
          conversationId: payload.conversation_id || null,
          messageId: payload.message_id || payload.id || null,
          metadata: payload.metadata || {},
          usage: payload.metadata?.usage || payload.usage || null,
        },
      },
      {
        event: 'done',
        data: {
          conversationId: payload.conversation_id || null,
          messageId: payload.message_id || payload.id || null,
        },
      },
    ];
  }

  if (difyEvent === 'error') {
    return [{
      event: 'error',
      data: {
        code: payload.code || 'EXPLAINER_STREAM_ERROR',
        message: payload.message || '讲解者流式响应异常',
      },
    }];
  }

  if (difyEvent === 'workflow_started' || difyEvent === 'node_started' || difyEvent === 'node_finished' || difyEvent === 'ping') {
    return [{
      event: 'metadata',
      data: {
        type: difyEvent,
        payload,
      },
    }];
  }

  // workflow_finished: 提取最终教学结果 (data.outputs.answer)
  if (difyEvent === 'workflow_finished') {
    const outputs = payload?.data?.outputs || payload?.outputs || {};
    const answer = outputs.answer || outputs.result || outputs.text || outputs.output || null;

    // 如果有 answer，先发 metadata 再发 result
    const events = [{
      event: 'metadata',
      data: {
        type: 'workflow_finished',
        status: payload?.data?.status || payload?.status || 'succeeded',
        elapsed_time: payload?.data?.elapsed_time || payload?.elapsed_time || null,
        total_tokens: payload?.data?.total_tokens || payload?.total_tokens || null,
      },
    }];

    if (answer) {
      events.push({
        event: 'result',
        data: {
          answer,
          status: payload?.data?.status || payload?.status || 'succeeded',
        },
      });
    }

    return events;
  }

  return [];
}

function writeSse(res, event, data) {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data ?? {})}\n\n`);
    return true;
  } catch {
    return false;
  }
}

async function prepareExplainerChat(userId, rawBody, options = {}) {
  const params = validateExplainerChatBody(rawBody);
  const access = await assertKnowledgePointAccess(userId, params.knowledgePointId, params.practiceSessionId);
  const context = await loadExplainerContext(userId, access.knowledgePoint, access.course.course_id, params.practiceSessionId);
  const decision = selectExplainerStrategy({ strategyHint: params.strategyHint, context });
  const profile = buildProfileSummary({
    userId,
    student: access.student,
    course: access.course,
    knowledgePoint: access.knowledgePoint,
    chapter: access.chapter,
    context,
    depth: params.depth,
    decision,
  });
  const conversation = await resolveConversation(userId, params, access.knowledgePoint, access.course.course_id);

  const inputs = {
    request_id: params.requestId,
    knowledge_point_id: String(access.knowledgePoint.knowledge_point_id),
    knowledge_point_name: access.knowledgePoint.knowledge_point_name,
    student_profile_summary: profile.profileSummary,
    strategy_hint: DIFY_STRATEGY[decision.strategy] || 'direct',
    exposure_level: profile.exposureLevel,
    understanding_depth: profile.understandingDepth,
    learning_style: profile.learningStyle,
    detected_misconceptions: profile.detectedMisconceptions,
    interest_tags: profile.interestTags,
    knowledge_context_override: '',
  };

  let runRecord;
  try {
    runRecord = await createRunRecord({
      userId,
      courseId: access.course.course_id,
      knowledgePointId: access.knowledgePoint.knowledge_point_id,
      practiceSessionId: params.practiceSessionId,
      requestId: params.requestId,
      inputSummary: {
        knowledgePointId: access.knowledgePoint.knowledge_point_id,
        strategyHint: params.strategyHint,
        selectedStrategy: decision.strategy,
        strategySource: decision.source,
        diagnosticianInstruction: context.pendingIntervention
          ? {
              id: context.pendingIntervention.intervention_uid,
              action: context.pendingIntervention.action,
              params: context.pendingIntervention.params_json || {},
            }
          : null,
        conversationId: conversation?.dify_conversation_id || params.conversationId || null,
        messageLength: params.message.length,
      },
    });
  } catch (err) {
    await failClaimedIntervention(context.pendingIntervention, { error: err }).catch(() => null);
    throw err;
  }

  const difyUser = options.difyUser || buildDifyUser('explainer', userId);
  return {
    params,
    access,
    context,
    decision,
    inputs,
    conversation,
    runRecord,
    difyUser,
  };
}

async function streamExplainerChat({ req, res, userId, body, options = {} }) {
  // ---- LangGraph 模式 ----
  if (isLangGraphMode()) {
    return streamExplainerChatLangGraph({ req, res, userId, body, options });
  }

  // ---- Dify 模式 (legacy) ----
  let prepared;
  try {
    prepared = await prepareExplainerChat(userId, body, options);
  } catch (err) {
    throw err;
  }

  const abortController = new AbortController();
  let upstream;
  try {
    upstream = options.streamResponse || await openExplainerChatStream({
      inputs: prepared.inputs,
      query: prepared.params.message,
      conversationId: prepared.conversation?.dify_conversation_id || prepared.params.conversationId,
      difyUser: prepared.difyUser,
      signal: abortController.signal,
    }, options);
  } catch (err) {
    await markRunFailed(prepared.runRecord.agent_run_id, err);
    throw err;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const startedAt = Date.now();
  let finished = false;
  let doneSent = false;
  let buffer = '';
  let answerPreview = '';
  const finalInfo = {
    conversationId: prepared.conversation?.dify_conversation_id || prepared.params.conversationId || null,
    messageId: null,
    totalTokens: null,
    elapsedMs: null,
  };

  writeSse(res, 'start', {
    requestId: prepared.params.requestId,
    strategy: prepared.decision.strategy,
    strategySource: prepared.decision.source,
    conversationId: finalInfo.conversationId,
  });

  const completeSuccessfully = async () => {
    if (finished) return;
    finished = true;
    const elapsedMs = Date.now() - startedAt;
    await upsertConversation({
      userId,
      courseId: prepared.access.course.course_id,
      knowledgePointId: prepared.access.knowledgePoint.knowledge_point_id,
      practiceSessionId: prepared.params.practiceSessionId,
      learningSessionId: prepared.params.learningSessionId,
      conversationId: finalInfo.conversationId,
      strategy: prepared.decision.strategy,
      metadata: {
        messageId: finalInfo.messageId,
        lastRequestId: prepared.params.requestId,
      },
    });
    await markRunSuccess({
      runId: prepared.runRecord.agent_run_id,
      metadata: {
        response_time_ms: elapsedMs,
        elapsed_time: elapsedMs / 1000,
        total_tokens: finalInfo.totalTokens,
        workflow_run_id: finalInfo.messageId,
      },
      outputSummary: {
        conversationId: finalInfo.conversationId,
        messageId: finalInfo.messageId,
        strategy: prepared.decision.strategy,
        answerPreview: answerPreview.slice(0, 1000),
      },
    });
    if (prepared.context.pendingIntervention) {
      await applyClaimedIntervention(prepared.context.pendingIntervention, {
        runId: prepared.runRecord.agent_run_id,
        result: {
          strategy: prepared.decision.strategy,
          conversationId: finalInfo.conversationId,
        },
      }).catch(() => null);
    }
  };

  const failStream = async (err) => {
    if (finished) return;
    finished = true;
    await markRunFailed(prepared.runRecord.agent_run_id, err);
    await failClaimedIntervention(prepared.context.pendingIntervention, {
      runId: prepared.runRecord.agent_run_id,
      error: err,
    }).catch(() => null);
    writeSse(res, 'error', {
      code: err?.code || 'EXPLAINER_STREAM_ERROR',
      message: err?.message || '讲解者流式响应异常',
    });
    if (!res.writableEnded) res.end();
  };

  const stopForClientDisconnect = () => {
    if (finished || res.writableEnded) return;
    abortController.abort();
    finished = true;
    markRunFailed(prepared.runRecord.agent_run_id, {
      code: 'CLIENT_DISCONNECTED',
      message: '客户端已断开 SSE 连接',
    }, 'STOPPED');
    failClaimedIntervention(prepared.context.pendingIntervention, {
      runId: prepared.runRecord.agent_run_id,
      error: {
        code: 'CLIENT_DISCONNECTED',
        message: '客户端已断开 SSE 连接',
      },
    });
  };

  req.on('close', stopForClientDisconnect);
  res.on('close', stopForClientDisconnect);

  const stream = upstream.data || upstream;
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    buffer = buffer.replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseBlock(block);
      const payload = parseDifyPayload(parsed.data);
      const transformed = transformDifyStreamEvent(parsed.event, payload);

      for (const item of transformed) {
        if (item.event === 'delta' && item.data.text) {
          answerPreview = (answerPreview + item.data.text).slice(0, 16000);
        }
        if (item.data?.conversationId) finalInfo.conversationId = item.data.conversationId;
        if (item.data?.messageId) finalInfo.messageId = item.data.messageId;
        const usage = item.data?.usage;
        if (usage?.total_tokens != null) finalInfo.totalTokens = Number(usage.total_tokens);
        const wrote = writeSse(res, item.event, {
          ...item.data,
          requestId: prepared.params.requestId,
          strategy: prepared.decision.strategy,
        });
        if (!wrote) {
          stopForClientDisconnect();
          return;
        }
        if (item.event === 'done') doneSent = true;
        if (item.event === 'error') {
          failStream(createAgentError(item.data.code, item.data.message, 502));
          return;
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  });

  stream.on('error', (err) => {
    failStream(createAgentError('EXPLAINER_STREAM_ERROR', err.message || '讲解者流式响应异常', 502));
  });

  stream.on('end', async () => {
    if (!finished) {
      if (res.destroyed && !res.writableEnded) {
        stopForClientDisconnect();
        return;
      }
      if (!doneSent) {
        writeSse(res, 'done', {
          requestId: prepared.params.requestId,
          conversationId: finalInfo.conversationId,
          messageId: finalInfo.messageId,
          strategy: prepared.decision.strategy,
        });
      }
      await completeSuccessfully();
      if (!res.writableEnded) res.end();
    }
  });
}

// ========================
// LangGraph 模式 Explainer 流式讲解
// ========================

async function streamExplainerChatLangGraph({ req, res, userId, body, options = {} }) {
  const params = validateExplainerChatBody(body);

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const startedAt = Date.now();
  let finished = false;
  const abortController = new AbortController();
  const requestId = params.requestId || `explainer_${Date.now()}`;
  const strategy = params.strategyHint || 'direct';
  const knowledgePointId = params.knowledgePointId;

  writeSse(res, 'start', { requestId, strategy, mode: 'langgraph' });

  try {
    // 获取知识点信息
    let knowledgePointName = '';
    let courseId = null;
    if (knowledgePointId) {
      const kp = await prisma.knowledgePoint.findUnique({
        where: { knowledge_point_id: knowledgePointId },
        select: { knowledge_point_id: true, knowledge_point_name: true, course_id: true },
      });
      if (kp) {
        knowledgePointName = kp.knowledge_point_name;
        courseId = kp.course_id;
      }
    }

    // 知识库检索
    let retrievalContext = null;
    let retrievalRefs = [];
    try {
      const router = require('../../learning-agent/services/knowledge-router.service');
      const kbResult = await router.buildRetrievalRequest({
        courseId,
        knowledgePointId,
        nodeType: params.strategyHint === 'socratic' ? 'socratic_questioning' : 'concept_explanation',
        query: params.message,
        knowledgePointName,
        topK: 5,
      });
      retrievalRefs = kbResult.records || [];
      if (retrievalRefs.length > 0) {
        retrievalContext = retrievalRefs
          .map((r, i) => `[${i + 1}] (${r.documentName || '未知文档'})\n${r.content}`)
          .join('\n\n');
      }
    } catch (err) {
      console.warn('[LangGraph Explainer] Knowledge retrieval failed:', err.message);
    }

    // 直接使用百炼流式接口。旧实现等完整 JSON 生成后再切块，视觉上像流式，
    // 实际首字延迟仍等于整次模型耗时；这里让 token 到达即转发。
    const { createBailianModel } = require('../../learning-agent/adapters/bailian-model.adapter');
    const model = createBailianModel({
      enableThinking: false,
      maxTokens: 900,
      temperature: 0.35,
      maxRetries: 1,
    });
    const systemMessage = `你是 DisciMind 的学习引导老师。请结合学生刚完成的学习流、作答评价和知识库内容继续深入答疑。
要求：先直接回应学生当前问题；必要时指出它与本轮学习节点、薄弱点或掌握度的关系；使用清晰 Markdown；不要输出 JSON；不要重复整份学习总结；结尾给出一个可继续追问的方向。`;
    const userMessage = `${retrievalContext ? `【知识库参考】\n${retrievalContext.slice(0, 5000)}\n\n` : ''}${params.message}`;
    const stream = await model.stream([
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage },
    ], { signal: abortController.signal });
    let outputText = '';
    let firstTokenMs = 0;
    for await (const chunk of stream) {
      if (res.destroyed || finished) break;
      const content = chunk?.content;
      const text = typeof content === 'string'
        ? content
        : (Array.isArray(content) ? content.map((part) => part?.text || '').join('') : '');
      if (!text) continue;
      if (!firstTokenMs) firstTokenMs = Date.now() - startedAt;
      outputText += text;
      writeSse(res, 'delta', { text, requestId, strategy });
    }

    // 发送元数据
    writeSse(res, 'metadata', {
      requestId,
      strategy,
      mode: 'langgraph',
      knowledgeBased: !!retrievalContext,
      retrievalCount: retrievalRefs.length,
      validationError: null,
      elapsedMs: Date.now() - startedAt,
      firstTokenMs,
    });

    // 发送完成事件
    writeSse(res, 'done', { requestId, strategy, mode: 'langgraph' });

    // 持久化运行记录
    try {
      await prisma.agentRunRecord.create({
        data: {
          user_id: userId,
          student_user_id: userId,
          course_id: courseId,
          agent_type: 'EXPLAINER',
          request_id: requestId,
          mode: 'langgraph',
          status: 'SUCCESS',
          response_time_ms: Date.now() - startedAt,
          output_summary: {
            strategy,
            knowledgeBased: !!retrievalContext,
            retrievalCount: retrievalRefs.length,
            contentLength: outputText.length,
          },
          output_json: { content: outputText },
        },
      });
    } catch (dbErr) {
      console.warn('[LangGraph Explainer] Failed to persist run record:', dbErr.message);
    }

    finished = true;
    if (!res.writableEnded) res.end();
  } catch (err) {
    if (finished) return;
    finished = true;
    console.error(`[LangGraph Explainer] request failed code=${err.code || 'EXPLAINER_LANGGRAPH_ERROR'}`, err);
    writeSse(res, 'error', {
      code: err.code || 'EXPLAINER_LANGGRAPH_ERROR',
      message: '学习内容暂时生成失败，请重新尝试或跳过当前节点。',
      requestId,
    });
    if (!res.writableEnded) res.end();
  }

  // 处理客户端断开
  const cleanup = () => { finished = true; abortController.abort(); };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

module.exports = {
  parseSseBlock,
  prepareExplainerChat,
  selectExplainerStrategy,
  streamExplainerChat,
  transformDifyStreamEvent,
};
