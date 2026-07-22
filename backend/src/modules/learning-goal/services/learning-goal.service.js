const crypto = require('crypto');
const prisma = require('../../../config/prisma');
const { createAgentError } = require('../../agent/common/agent.errors');
const runtimeService = require('../../learning-workflow/workflow-runtime.service');
const { resolveInputSchema, patchInputSchema, cleanGoalText } = require('../schemas/learning-goal-input.schema');
const { getLearningGoalConfig, MUTABLE_STATUSES } = require('../constants/learning-goal.constants');
const { buildCandidates } = require('./learning-goal-candidate.service');
const { resolveGoal: runResolver, materializeSelection } = require('./learning-goal-resolver.service');
const { buildPlan, finalizePlanForCoverage } = require('./learning-goal-planner.service');
const { checkCoverage } = require('./learning-goal-coverage.service');
const { buildGoalSnapshot } = require('./learning-goal-context.service');
const { generateWorkflowPreview } = require('./learning-goal-workflow.service');
const { completeFromSession } = require('./learning-goal-completion.service');

const GOAL_INCLUDE = {
  course: { select: { course_id: true, course_name: true, course_code: true } },
  primary_knowledge_point: { select: { knowledge_point_id: true, knowledge_point_name: true, chapter: { select: { chapter_name: true } } } },
  learning_session: { select: { session_id: true, status: true, completed_at: true } },
};

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function featureGuard() {
  if (!getLearningGoalConfig().enabled) throw createAgentError('FEATURE_DISABLED', '自然语言学习目标功能当前未开启，固定知识点学习仍可正常使用', 404);
}
function validationError(result) {
  const issue = result.error?.issues?.[0];
  return createAgentError(issue?.params?.businessCode || 'INVALID_INPUT', issue?.message || '请求参数不合法', 400);
}
function parseResolveInput(input) {
  const parsed = resolveInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed);
  return { ...parsed.data, goalText: cleanGoalText(parsed.data.goalText) };
}
function parseGoalId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw createAgentError('INVALID_GOAL_ID', '学习目标 ID 不合法', 400);
  return id;
}
function hasSemanticMatch(candidate) {
  return (candidate?.matchReasons || []).some((reason) => ['exact', 'name', 'alias', 'chapter', 'parent', 'overlap'].includes(reason));
}
function isExplicitSelectionOnly(goalText, selectedKnowledgePoint) {
  if (!selectedKnowledgePoint) return false;
  const compact = cleanGoalText(goalText).replace(/[。！!？?]/g, '');
  const selectedName = cleanGoalText(selectedKnowledgePoint.knowledge_point_name);
  return compact === `我想学习${selectedName}` || compact === `学习${selectedName}`;
}

async function assertCourseAccess(studentId, courseId, db = prisma) {
  const [course, enrollment] = await Promise.all([
    db.course.findUnique({ where: { course_id: Number(courseId) }, select: { course_id: true, course_name: true, status: true } }),
    db.studentCourseEnrollment.findFirst({ where: { student_user_id: Number(studentId), course_id: Number(courseId), enrollment_status: 'active' }, select: { enrollment_id: true } }),
  ]);
  if (!course) throw createAgentError('COURSE_NOT_FOUND', '所选课程不存在', 404);
  if (!enrollment) throw createAgentError('COURSE_ACCESS_DENIED', '你尚未加入所选课程', 403);
  return course;
}

async function assertKnowledgePointInCourse(courseId, knowledgePointId, db = prisma) {
  if (!knowledgePointId) return null;
  const point = await db.knowledgePoint.findFirst({
    where: { knowledge_point_id: Number(knowledgePointId), course_id: Number(courseId) },
    select: { knowledge_point_id: true, knowledge_point_name: true },
  });
  if (!point) throw createAgentError('KNOWLEDGE_POINT_NOT_FOUND', '所选知识点不属于当前课程', 400);
  return point;
}

async function ownedGoal(goalId, studentId, db = prisma) {
  const goal = await db.learningGoal.findUnique({ where: { goal_id: parseGoalId(goalId) }, include: GOAL_INCLUDE });
  if (!goal) throw createAgentError('GOAL_NOT_FOUND', '学习目标不存在', 404);
  if (goal.student_user_id !== Number(studentId)) throw createAgentError('GOAL_ACCESS_DENIED', '无权访问该学习目标', 403);
  return goal;
}

function publicGoal(goal, extra = {}) {
  const related = Array.isArray(goal.related_knowledge_points) ? goal.related_knowledge_points : [];
  const coverage = goal.coverage_details || {};
  const message = goal.status === 'OUT_OF_SCOPE' ? '当前课程知识库暂不包含该主题，无法保证学习内容的可靠性。'
    : goal.status === 'NEEDS_CLARIFICATION' ? (goal.goal_type === 'TOO_BROAD' ? '这个目标范围较大，建议先选择一个更具体的方向。' : '需要进一步明确你的学习目标。')
      : goal.status === 'INSUFFICIENT_COVERAGE' ? (goal.coverage_status === 'unavailable' ? '课程知识库当前不可用，暂不能生成可靠学习流。' : '当前课程资料对该目标的覆盖不足。') : null;
  return {
    goalId: goal.goal_id,
    rawGoal: goal.raw_goal,
    normalizedTitle: goal.normalized_title,
    goalType: goal.goal_type,
    status: goal.status,
    message,
    course: goal.course ? { courseId: goal.course.course_id, courseName: goal.course.course_name } : null,
    primaryKnowledgePoint: goal.primary_knowledge_point ? {
      knowledgePointId: goal.primary_knowledge_point.knowledge_point_id,
      name: goal.primary_knowledge_point.knowledge_point_name,
      chapterName: goal.primary_knowledge_point.chapter?.chapter_name || null,
    } : null,
    relatedKnowledgePoints: related,
    focusQuestion: goal.focus_question,
    subGoals: goal.sub_goals || [],
    prerequisites: goal.prerequisite_goals || [],
    clarificationOptions: goal.clarification_options || [],
    clarificationQuestion: goal.resolver_snapshot?.clarificationQuestion || null,
    targetDepth: goal.target_depth,
    targetMastery: goal.target_mastery,
    estimatedMinutes: goal.estimated_minutes,
    knowledgeBaseCoverage: goal.coverage_status ? {
      status: goal.coverage_status, score: goal.coverage_score,
      coveredSubGoalCount: coverage.coveredSubGoalCount || 0,
      totalSubGoalCount: coverage.totalSubGoalCount || 0,
      sources: coverage.sources || [],
    } : null,
    warnings: coverage.warnings || [],
    requiresConfirmation: goal.status === 'RESOLVED',
    workflow: goal.workflow_template_id ? { templateId: goal.workflow_template_id, versionId: goal.workflow_version_id } : null,
    learningSession: goal.learning_session ? { sessionId: goal.learning_session.session_id, status: goal.learning_session.status } : null,
    result: goal.result_snapshot || null,
    createdAt: goal.created_at, confirmedAt: goal.confirmed_at, startedAt: goal.started_at, completedAt: goal.completed_at,
    ...extra,
  };
}

async function createResolvingGoal({ studentId, courseId, goalText, operationId, normalizedHash, preferences }, db = prisma) {
  const deterministicOperationId = operationId || `resolve:${courseId}:${normalizedHash}`;
  const existing = await db.learningGoal.findFirst({
    where: { student_user_id: Number(studentId), operation_id: deterministicOperationId }, include: GOAL_INCLUDE,
  });
  if (existing) return { goal: existing, reused: true };
  try {
    const goal = await db.learningGoal.create({
      data: {
        student_user_id: Number(studentId), course_id: Number(courseId), raw_goal: goalText,
        normalized_goal_hash: normalizedHash, normalized_title: goalText.slice(0, 255), goal_type: 'AMBIGUOUS', status: 'RESOLVING',
        operation_id: deterministicOperationId,
        target_depth: preferences.targetDepth || 'basic', target_mastery: preferences.targetMastery || getLearningGoalConfig().defaultTargetMastery,
        estimated_minutes: preferences.availableMinutes || getLearningGoalConfig().defaultEstimatedMinutes,
      }, include: GOAL_INCLUDE,
    });
    return { goal, reused: false };
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const goal = await db.learningGoal.findFirst({ where: { student_user_id: Number(studentId), operation_id: deterministicOperationId }, include: GOAL_INCLUDE });
    return { goal, reused: true };
  }
}

async function resolveGoal(input, studentId, dependencies = {}) {
  featureGuard();
  const parsed = parseResolveInput(input);
  const db = dependencies.db || prisma;
  const course = await assertCourseAccess(studentId, parsed.courseId, db);
  const selectedKnowledgePoint = await assertKnowledgePointInCourse(parsed.courseId, parsed.knowledgePointId, db);
  const normalizedHash = hash(`${parsed.courseId}:${selectedKnowledgePoint?.knowledge_point_id || ''}:${cleanGoalText(parsed.goalText).toLowerCase()}:${JSON.stringify(parsed.preferences || {})}`);
  const { goal, reused } = await createResolvingGoal({ studentId, ...parsed, normalizedHash }, db);
  if (reused && goal.status !== 'RESOLVING') return publicGoal(goal, { idempotentReplay: true });
  if (reused && goal.status === 'RESOLVING' && Date.now() - new Date(goal.updated_at).getTime() < getLearningGoalConfig().resolveTimeoutMs * 2) {
    return publicGoal(goal, { idempotentReplay: true });
  }
  const started = Date.now();
  const timings = {};
  try {
    const candidateStarted = Date.now();
    const candidates = await (dependencies.buildCandidates || buildCandidates)({
      courseId: parsed.courseId,
      goalText: parsed.goalText,
      selectedKnowledgePointId: selectedKnowledgePoint?.knowledge_point_id || null,
      db,
    });
    timings.candidateBuildMs = Date.now() - candidateStarted;
    const resolverStarted = Date.now();
    const rawResult = await (dependencies.runResolver || runResolver)({
      goalText: parsed.goalText, courseName: course.course_name, candidates,
      preferredDepth: parsed.preferences.targetDepth || 'basic',
      explicitSelectionOnly: isExplicitSelectionOnly(parsed.goalText, selectedKnowledgePoint),
      modelCall: dependencies.modelCall,
    });
    timings.modelResolveMs = Date.now() - resolverStarted;
    const resolved = materializeSelection(rawResult, candidates);
    if (rawResult.fallback && rawResult.resolverErrorCode) {
      const updated = await db.learningGoal.update({
        where: { goal_id: goal.goal_id },
        data: {
          status: 'NEEDS_CLARIFICATION',
          goal_type: 'AMBIGUOUS',
          normalized_title: parsed.goalText.slice(0, 255),
          focus_question: null,
          clarification_options: [],
          resolver_snapshot: {
            goalType: 'AMBIGUOUS',
            reasonSummary: 'LLM 校验暂时不可用，未将确定性候选降级结果作为合法性结论。',
            clarificationQuestion: 'AI 暂时无法完成自然语言校验，请稍后重试或直接选择系统内置知识点。',
            resolverErrorCode: rawResult.resolverErrorCode,
            selectedKnowledgePointId: selectedKnowledgePoint?.knowledge_point_id || null,
          },
        }, include: GOAL_INCLUDE,
      });
      return publicGoal(updated, { clarificationQuestion: 'AI 暂时无法完成自然语言校验，请稍后重试或直接选择系统内置知识点。' });
    }
    const selectedCandidate = selectedKnowledgePoint
      ? candidates.find((candidate) => Number(candidate.knowledgePointId) === Number(selectedKnowledgePoint.knowledge_point_id))
      : null;
    const competingCandidate = selectedCandidate && !hasSemanticMatch(selectedCandidate)
      ? candidates.find((candidate) => Number(candidate.knowledgePointId) !== Number(selectedKnowledgePoint.knowledge_point_id) && candidate.matchScore >= 45 && hasSemanticMatch(candidate))
      : null;
    if (selectedKnowledgePoint && resolved.primaryKnowledgePoint
      && (Number(resolved.primaryKnowledgePoint.knowledgePointId) !== Number(selectedKnowledgePoint.knowledge_point_id) || (resolved.fallback && competingCandidate))) {
      const resolvedPointName = Number(resolved.primaryKnowledgePoint.knowledgePointId) === Number(selectedKnowledgePoint.knowledge_point_id)
        ? competingCandidate.name
        : resolved.primaryKnowledgePoint.name;
      const resolvedPointId = Number(resolved.primaryKnowledgePoint.knowledgePointId) === Number(selectedKnowledgePoint.knowledge_point_id)
        ? competingCandidate.knowledgePointId
        : resolved.primaryKnowledgePoint.knowledgePointId;
      const updated = await db.learningGoal.update({
        where: { goal_id: goal.goal_id },
        data: {
          status: 'NEEDS_CLARIFICATION',
          goal_type: 'AMBIGUOUS',
          normalized_title: parsed.goalText.slice(0, 255),
          focus_question: null,
          clarification_options: [
            { title: `学习${selectedKnowledgePoint.knowledge_point_name}`, goalText: `我想学习${selectedKnowledgePoint.knowledge_point_name}` },
            { title: `改为${resolvedPointName}`, goalText: parsed.goalText },
          ],
          resolver_snapshot: {
            goalType: 'AMBIGUOUS',
            reasonSummary: '所选知识点与自然语言目标匹配结果不一致，需要学生确认。',
            clarificationQuestion: '你选择的知识点和目标描述指向不同主题，请确认学习范围。',
            selectedKnowledgePointId: selectedKnowledgePoint.knowledge_point_id,
            resolvedKnowledgePointId: resolvedPointId,
          },
        }, include: GOAL_INCLUDE,
      });
      return publicGoal(updated, { clarificationQuestion: '你选择的知识点和目标描述指向不同主题，请确认学习范围。' });
    }
    if (['TOO_BROAD', 'AMBIGUOUS'].includes(resolved.goalType)) {
      const updated = await db.learningGoal.update({
        where: { goal_id: goal.goal_id },
        data: {
          status: 'NEEDS_CLARIFICATION', goal_type: resolved.goalType,
          normalized_title: resolved.normalizedTitle, focus_question: resolved.focusQuestion || null,
          clarification_options: resolved.clarificationOptions || [], target_depth: resolved.targetDepth,
          resolver_snapshot: { goalType: resolved.goalType, reasonSummary: resolved.reasonSummary, clarificationQuestion: resolved.clarificationQuestion },
        }, include: GOAL_INCLUDE,
      });
      return publicGoal(updated, { clarificationQuestion: resolved.clarificationQuestion });
    }
    if (resolved.goalType === 'OUT_OF_SCOPE' || !resolved.primaryKnowledgePoint) {
      const updated = await db.learningGoal.update({
        where: { goal_id: goal.goal_id }, data: {
          status: 'OUT_OF_SCOPE', goal_type: 'OUT_OF_SCOPE', normalized_title: resolved.normalizedTitle,
          resolver_snapshot: { reasonSummary: resolved.reasonSummary },
        }, include: GOAL_INCLUDE,
      });
      return publicGoal(updated, { suggestions: ['重新选择课程', '输入当前课程相关目标'] });
    }
    const plannerStarted = Date.now();
    const { plan: initialPlan, studentContext } = await (dependencies.buildPlan || buildPlan)({
      studentId, courseId: parsed.courseId, goalText: parsed.goalText, resolverResult: resolved, preferences: parsed.preferences, db,
    });
    timings.plannerMs = Date.now() - plannerStarted;
    const coverageStarted = Date.now();
    const coverage = await (dependencies.checkCoverage || checkCoverage)({
      courseId: parsed.courseId, knowledgePointId: resolved.primaryKnowledgePoint.knowledgePointId,
      knowledgePointName: resolved.primaryKnowledgePoint.name, normalizedTitle: resolved.normalizedTitle,
      focusQuestion: resolved.focusQuestion, subGoals: initialPlan.subGoals, prerequisites: initialPlan.prerequisites,
      db,
    });
    timings.coverageCheckMs = Date.now() - coverageStarted;
    const { plan, warnings } = finalizePlanForCoverage(initialPlan, coverage);
    const blocked = ['insufficient', 'unavailable'].includes(coverage.status);
    const related = (resolved.relatedKnowledgePoints || []).slice(0, getLearningGoalConfig().maxRelatedKnowledgePoints).map((item) => ({ knowledgePointId: item.knowledgePointId, name: item.name }));
    const updated = await db.learningGoal.update({
      where: { goal_id: goal.goal_id },
      data: {
        status: blocked ? 'INSUFFICIENT_COVERAGE' : 'RESOLVED',
        goal_type: blocked ? resolved.goalType : resolved.goalType,
        normalized_title: resolved.normalizedTitle,
        focus_question: resolved.focusQuestion || null,
        primary_knowledge_point_id: resolved.primaryKnowledgePoint.knowledgePointId,
        related_knowledge_points: related,
        sub_goals: plan.subGoals, prerequisite_goals: plan.prerequisites,
        target_depth: plan.targetDepth, target_mastery: plan.targetMastery, estimated_minutes: plan.estimatedMinutes,
        coverage_status: coverage.status, coverage_score: coverage.score,
        coverage_details: { coveredSubGoalCount: coverage.coveredSubGoalCount, totalSubGoalCount: coverage.totalSubGoalCount, sources: coverage.sources, queryCoverage: coverage.queryCoverage, warnings },
        resolver_snapshot: {
          goalType: resolved.goalType, selectedPrimaryCandidateKey: resolved.selectedPrimaryCandidateKey,
          relatedCandidateKeys: resolved.relatedCandidateKeys, reasonSummary: resolved.reasonSummary,
          candidateCount: candidates.length, modelAttemptCount: resolved.modelAttemptCount || 0, repairAttemptCount: resolved.repairAttemptCount || 0,
        },
        planner_snapshot: { ...plan, studentContext: { currentMastery: studentContext.currentMastery, recentErrorCount: studentContext.recentErrors.length } },
        error_code: blocked ? (coverage.status === 'unavailable' ? 'KNOWLEDGE_COVERAGE_UNAVAILABLE' : 'INSUFFICIENT_COVERAGE') : null,
        error_message: null,
      }, include: GOAL_INCLUDE,
    });
    console.log(JSON.stringify({
      event: 'learning_goal_resolved', goalId: updated.goal_id, studentId: hash(studentId).slice(0, 12), courseId: updated.course_id,
      goalType: updated.goal_type, candidateCount: candidates.length, primaryKnowledgePointId: updated.primary_knowledge_point_id,
      coverageStatus: updated.coverage_status, ...timings, totalMs: Date.now() - started,
      modelAttemptCount: resolved.modelAttemptCount || 0, repairAttemptCount: resolved.repairAttemptCount || 0,
      retrievalDatasetCount: coverage.retrievalDatasetCount, retrievedChunkCount: coverage.retrievedChunkCount,
    }));
    return publicGoal(updated);
  } catch (error) {
    await db.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { status: 'FAILED', error_code: String(error.code || 'GOAL_RESOLVE_FAILED').slice(0, 100), error_message: String(error.message || '').slice(0, 500) } }).catch(() => null);
    throw error;
  }
}

async function getGoal(goalId, studentId) {
  featureGuard();
  let goal = await ownedGoal(goalId, studentId);
  if (goal.learning_session?.status === 'COMPLETED' && goal.status !== 'COMPLETED') {
    await completeFromSession(goal.goal_id, studentId);
    goal = await ownedGoal(goalId, studentId);
  }
  return publicGoal(goal);
}

async function listGoals(studentId, query = {}) {
  featureGuard();
  const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20));
  const availableOnly = String(query.availableOnly || '').toLowerCase() === 'true';
  const pointId = query.knowledgePointId ? Number(query.knowledgePointId) : null;
  const where = {
    student_user_id: Number(studentId),
    ...(query.courseId ? { course_id: Number(query.courseId) } : {}),
    ...(availableOnly ? { status: { in: ['RESOLVED', 'CONFIRMED', 'WORKFLOW_READY'] } } : {}),
  };
  const rows = await prisma.learningGoal.findMany({ where, include: GOAL_INCLUDE, orderBy: { updated_at: 'desc' } });
  const compatible = pointId ? rows.filter((goal) => {
    if (Number(goal.primary_knowledge_point_id) === pointId) return true;
    return Array.isArray(goal.related_knowledge_points)
      && goal.related_knowledge_points.some(item => Number(item?.knowledgePointId) === pointId);
  }) : rows;
  const total = compatible.length;
  const items = compatible.slice((page - 1) * pageSize, page * pageSize);
  return { items: items.map((item) => publicGoal(item)), pagination: { page, pageSize, total } };
}

async function updateGoal(goalId, studentId, input) {
  featureGuard();
  const parsed = patchInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed);
  const goal = await ownedGoal(goalId, studentId);
  if (!MUTABLE_STATUSES.has(goal.status)) throw createAgentError('GOAL_NOT_EDITABLE', '已确认、开始或结束的目标不能修改', 409);
  if (parsed.data.clarificationGoalText) {
    await prisma.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { status: 'CANCELLED', operation_id: null } });
    const selectedKnowledgePointId = goal.primary_knowledge_point_id || goal.resolver_snapshot?.selectedKnowledgePointId || undefined;
    return resolveGoal({ courseId: goal.course_id, knowledgePointId: selectedKnowledgePointId, goalText: parsed.data.clarificationGoalText, preferences: { targetDepth: goal.target_depth, targetMastery: goal.target_mastery, availableMinutes: goal.estimated_minutes } }, studentId);
  }
  const data = {};
  if (parsed.data.normalizedTitle !== undefined) data.normalized_title = parsed.data.normalizedTitle;
  if (parsed.data.focusQuestion !== undefined) data.focus_question = parsed.data.focusQuestion;
  if (parsed.data.targetDepth !== undefined) data.target_depth = parsed.data.targetDepth;
  if (parsed.data.targetMastery !== undefined) data.target_mastery = parsed.data.targetMastery;
  if (parsed.data.estimatedMinutes !== undefined) data.estimated_minutes = parsed.data.estimatedMinutes;
  return publicGoal(await prisma.learningGoal.update({ where: { goal_id: goal.goal_id }, data, include: GOAL_INCLUDE }));
}

async function confirmGoal(goalId, studentId) {
  featureGuard();
  const goal = await ownedGoal(goalId, studentId);
  if (['CONFIRMED', 'WORKFLOW_READY', 'STARTED', 'COMPLETED'].includes(goal.status) && goal.goal_snapshot) return publicGoal(goal, { idempotentReplay: true });
  if (goal.status !== 'RESOLVED') throw createAgentError('GOAL_NOT_RESOLVED', '只有资料覆盖通过且解析完成的目标可以确认', 409);
  await assertCourseAccess(studentId, goal.course_id);
  const point = await prisma.knowledgePoint.findFirst({ where: { knowledge_point_id: goal.primary_knowledge_point_id, course_id: goal.course_id }, select: { knowledge_point_id: true } });
  if (!point) throw createAgentError('KNOWLEDGE_POINT_NOT_FOUND', '主知识点不属于当前课程', 400);
  const snapshot = buildGoalSnapshot(goal);
  const updated = await prisma.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { status: 'CONFIRMED', goal_snapshot: snapshot, confirmed_at: new Date() }, include: GOAL_INCLUDE });
  return publicGoal(updated);
}

async function createWorkflowPreview(goalId, studentId) {
  featureGuard();
  let goal = await ownedGoal(goalId, studentId);
  if (goal.status === 'WORKFLOW_READY' && goal.workflow_template_id) {
    const template = await prisma.learningWorkflowTemplate.findUnique({ where: { template_id: goal.workflow_template_id }, include: { versions: { where: { version_id: goal.workflow_version_id }, take: 1 } } });
    const version = template?.versions?.[0];
    if (!version) throw createAgentError('WORKFLOW_VERSION_NOT_FOUND', '历史学习目标缺少固定工作流版本，请重新生成', 409);
    const learningPlan = await require('../../student-learning-plan/student-learning-plan.service').createPlan(
      { user_id: studentId },
      {
        courseId: goal.course_id, knowledgePointId: goal.primary_knowledge_point_id,
        learningGoalId: goal.goal_id, workflowTemplateId: goal.workflow_template_id, workflowVersionId: goal.workflow_version_id,
        creationMode: 'goal_based', status: 'ready', targetMastery: goal.target_mastery,
        completionMode: version.settings_json?.completion_mode || 'mastery_target', estimatedMinutes: goal.estimated_minutes,
      },
    );
    return { goal: publicGoal(goal), preview: { templateId: goal.workflow_template_id, versionId: goal.workflow_version_id, graph: version.graph_json, settings: version.settings_json }, learningPlan, idempotentReplay: true };
  }
  if (!['CONFIRMED', 'GENERATING_WORKFLOW'].includes(goal.status)) throw createAgentError('GOAL_NOT_CONFIRMED', '请先确认学习目标', 409);
  await prisma.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { status: 'GENERATING_WORKFLOW' } });
  try {
    goal = await ownedGoal(goalId, studentId);
    const preview = await generateWorkflowPreview({ goal, userId: studentId });
    goal = await prisma.learningGoal.update({
      where: { goal_id: goal.goal_id },
      data: {
        status: 'WORKFLOW_READY',
        workflow_template_id: preview.templateId,
        workflow_version_id: preview.versionId,
        error_code: null,
        error_message: null,
      },
      include: GOAL_INCLUDE,
    });
    const learningPlan = await require('../../student-learning-plan/student-learning-plan.service').createPlan(
      { user_id: studentId },
      {
        courseId: goal.course_id, knowledgePointId: goal.primary_knowledge_point_id,
        learningGoalId: goal.goal_id, workflowTemplateId: preview.templateId, workflowVersionId: preview.versionId,
        creationMode: 'goal_based', status: 'ready', targetMastery: goal.target_mastery,
        completionMode: preview.settings?.completion_mode || 'mastery_target', estimatedMinutes: goal.estimated_minutes,
      },
    );
    return { goal: publicGoal(goal), preview, learningPlan };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'learning_goal_workflow_preview_failed',
      goalId: String(goalId),
      studentId: String(studentId).slice(0, 8),
      errorCode: String(error.code || 'UNKNOWN').slice(0, 100),
      message: String(error.message || '').slice(0, 300),
    }));
    await prisma.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { status: 'CONFIRMED', error_code: String(error.code || 'WORKFLOW_GENERATION_FAILED').slice(0, 100), error_message: String(error.message || '').slice(0, 500) } }).catch(() => null);
    throw error;
  }
}

async function attachSessionToGoalPlan(studentId, goal, session) {
  const plan = await prisma.studentLearningPlan.findFirst({
    where: { studentUserId: Number(studentId), learningGoalId: goal.goal_id, workflowVersionId: session.workflow_version_id || goal.workflow_version_id },
    orderBy: { updatedAt: 'desc' },
  });
  if (!plan) return null;
  return prisma.$transaction(async (tx) => {
    await tx.studentLearningPlan.updateMany({ where: { studentUserId: Number(studentId), activeKey: { not: null }, id: { not: plan.id } }, data: { activeKey: null } });
    return tx.studentLearningPlan.update({
      where: { id: plan.id },
      data: {
        learningSessionId: session.session_id,
        status: session.status === 'COMPLETED' ? 'COMPLETED' : 'RUNNING',
        activeKey: `student:${Number(studentId)}`,
        startedAt: plan.startedAt || session.started_at || new Date(),
      },
    });
  });
}

async function startGoal(goalId, studentId) {
  featureGuard();
  let goal = await ownedGoal(goalId, studentId);
  const existing = await prisma.learningSession.findFirst({ where: { learning_goal_id: goal.goal_id, student_user_id: Number(studentId) } });
  if (existing) {
    if (['CREATED', 'PAUSED'].includes(existing.status)) await runtimeService.startSession(existing.session_id, studentId);
    await attachSessionToGoalPlan(studentId, goal, existing);
    goal = await prisma.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { status: existing.status === 'COMPLETED' ? 'COMPLETED' : 'STARTED', started_at: goal.started_at || existing.started_at || new Date() }, include: GOAL_INCLUDE });
    return { goal: publicGoal(goal), session: await runtimeService.getPublicSession(existing.session_id, studentId), idempotentReplay: true };
  }
  if (goal.status !== 'WORKFLOW_READY') throw createAgentError('WORKFLOW_NOT_READY', '请先生成并确认学习流预览', 409);
  const session = await runtimeService.createSession({
    userId: studentId, courseId: goal.course_id, knowledgePointId: goal.primary_knowledge_point_id,
    templateId: goal.workflow_template_id, versionId: goal.workflow_version_id,
    completionMode: 'mastery_target', targetMastery: goal.target_mastery,
    adjustmentMode: 'ask_before_adjust', estimatedMinutes: goal.estimated_minutes,
    learningGoalId: goal.goal_id, goalSnapshot: goal.goal_snapshot,
  });
  await attachSessionToGoalPlan(studentId, goal, session);
  await runtimeService.startSession(session.session_id, studentId);
  goal = await prisma.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { status: 'STARTED', started_at: new Date() }, include: GOAL_INCLUDE });
  return { goal: publicGoal(goal), session: await runtimeService.getPublicSession(session.session_id, studentId) };
}

async function cancelGoal(goalId, studentId) {
  featureGuard();
  const goal = await ownedGoal(goalId, studentId);
  if (['STARTED', 'COMPLETED'].includes(goal.status) || goal.learning_session) throw createAgentError('GOAL_CANNOT_CANCEL', '已开始的学习目标不能取消', 409);
  return publicGoal(await prisma.learningGoal.update({ where: { goal_id: goal.goal_id }, data: { status: 'CANCELLED', operation_id: null }, include: GOAL_INCLUDE }));
}

module.exports = {
  resolveGoal, getGoal, listGoals, updateGoal, confirmGoal, createWorkflowPreview, startGoal, cancelGoal,
  assertCourseAccess, assertKnowledgePointInCourse, isExplicitSelectionOnly, ownedGoal, publicGoal, parseResolveInput, featureGuard, GOAL_INCLUDE,
};
