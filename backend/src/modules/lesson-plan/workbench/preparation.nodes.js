const prisma = require('../../../config/prisma');
const aiService = require('../../../services/ai.service');
const analyticsService = require('../../../services/teacher-analytics-workbench.service');
const events = require('./preparation-events');

const AGENTS = {
  STUDENT: 'StudentAnalyticsAgent',
  DIALOGUE: 'DialogueInsightAgent',
  CURRICULUM: 'CurriculumPlannerAgent',
  INTRO: 'LessonIntroductionAgent',
  CONTENT: 'ContentDesignAgent',
  QUESTION: 'QuestionDesignAgent',
  EXERCISE: 'ExerciseDesignAgent',
  ASSESSMENT: 'AssessmentAgent',
  RESOURCE: 'ResourceRecommendationAgent',
  REVIEW: 'LessonQualityReviewAgent',
  DOCUMENT: 'DocumentGenerationAgent',
};

function parseJson(content) {
  if (!content) return null;
  const clean = String(content).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(clean); } catch {}
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch {}
  }
  return null;
}

async function callStructured(state, agentKey, instruction, fallback) {
  try {
    const response = await aiService.callAI({
      usageType: 'summary',
      userId: state.teacherUserId,
      messages: [
        { role: 'system', content: `你是 ${agentKey}。只输出合法 JSON，不得虚构班级数据，所有统计只能引用输入。${instruction}` },
        { role: 'user', content: JSON.stringify({
          topic: state.topic,
          duration: state.duration,
          params: state.params,
          classProfile: state.classProfile,
          studentAnalytics: state.studentAnalytics,
          dialogueInsights: state.dialogueInsights,
          teachingObjectives: state.teachingObjectives,
          keyPoints: state.keyPoints,
          difficultPoints: state.difficultPoints,
        }) },
      ],
      options: { temperature: 0.35, maxTokens: 1800 },
    });
    const value = parseJson(response.content);
    if (!value) throw new Error('模型未返回合法 JSON');
    return { value, aiMeta: { provider: response.provider, model: response.model }, error: null };
  } catch (error) {
    console.error(`[teacher-preparation][${agentKey}] model fallback:`, error);
    return {
      value: fallback(),
      aiMeta: { mode: 'deterministic_fallback' },
      error: '模型服务暂时不可用，已使用规则模板继续生成。',
      degraded: true,
    };
  }
}

async function recordExecution(state, agentKey, stageKey, progress, executor) {
  let execution = null;
  try {
    execution = await prisma.lessonPlanAgentExecution.create({
      data: {
        lesson_plan_id: state.lessonPlanId,
        teacher_user_id: state.teacherUserId,
        agent_key: agentKey,
        stage_key: stageKey,
        status: 'running',
        input_json: { topic: state.topic, duration: state.duration, targetSections: state.targetSections },
        started_at: new Date(),
      },
    });
  } catch (error) {
    console.error(`[teacher-preparation][${agentKey}] execution tracking unavailable:`, error);
  }
  events.publish(state.lessonPlanId, { type: 'agent', agent: agentKey, stage: stageKey, status: 'running', progress });
  try {
    const result = await executor();
    const status = result.skipped ? 'skipped' : result.degraded || result.error ? 'degraded' : 'succeeded';
    const updates = [prisma.lessonPlan.update({ where: { lesson_plan_id: state.lessonPlanId }, data: { progress } })];
    if (execution) updates.unshift(prisma.lessonPlanAgentExecution.update({
      where: { execution_id: execution.execution_id },
      data: { status, output_json: result, error_message: result.error || null, data_sources_json: state.analyticsData?.data_sources || undefined, completed_at: new Date() },
    }));
    await prisma.$transaction(updates);
    events.publish(state.lessonPlanId, { type: 'agent', agent: agentKey, stage: stageKey, status, progress, output: result.value || result, message: result.error || null });
    return result;
  } catch (error) {
    console.error(`[teacher-preparation][${agentKey}] agent execution failed:`, error);
    const friendly = agentKey === AGENTS.RESOURCE
      ? '教学资源暂时无法读取，其他备课阶段已继续执行。'
      : '该阶段暂时未完成，系统已保留现有内容并继续执行其他阶段。';
    if (execution) await prisma.lessonPlanAgentExecution.update({
      where: { execution_id: execution.execution_id },
      data: { status: agentKey === AGENTS.DOCUMENT ? 'failed' : 'degraded', error_message: friendly, completed_at: new Date() },
    }).catch((trackingError) => console.error('[teacher-preparation] failed to update execution status:', trackingError));
    events.publish(state.lessonPlanId, { type: 'agent', agent: agentKey, stage: stageKey, status: agentKey === AGENTS.DOCUMENT ? 'failed' : 'degraded', progress, message: friendly });
    if (agentKey === AGENTS.DOCUMENT) throw Object.assign(new Error('教案版本保存失败，请稍后重试生成。'), { code: 50001, publicCode: 'LESSON_PLAN_SAVE_FAILED', retryable: true, expose: true, cause: error });
    return { value: null, error: friendly, degraded: true };
  }
}

function shouldRun(state, sections) {
  const targets = state.targetSections || [];
  const locked = new Set(state.lockedBlocks || []);
  if (sections.every((section) => locked.has(section))) return false;
  return !targets.length || sections.some((section) => targets.includes(section));
}

async function collectContext(state) {
  const query = {
    course_id: state.courseId,
    teaching_class_id: state.teachingClassId,
    range: state.params?.analyticsRange || '30d',
    chapter_id: state.params?.chapterId || undefined,
    knowledge_point_id: state.params?.knowledgePointId || undefined,
  };
  const [analyticsResult, resourcesResult, teachingClassResult] = await Promise.allSettled([
    analyticsService.buildWorkbench({ user_id: state.teacherUserId, role: 'teacher' }, query, { persist: false }),
    prisma.knowledgeDocument.findMany({
      where: {
        deleted_at: null,
        is_teaching_resource: true,
        OR: [
          { owner_user_id: state.teacherUserId },
          { course_id: state.courseId },
          { teaching_class_id: state.teachingClassId },
        ],
      },
      select: { document_id: true, title: true, file_ext: true, resource_kind: true, resource_category: true, file_url: true },
      take: 30,
      orderBy: { updated_at: 'desc' },
    }),
    prisma.teachingClass.findUnique({
      where: { teaching_class_id: state.teachingClassId },
      include: { course: true, course_offering: { include: { semester: true } }, _count: { select: { enrollments: true } } },
    }),
  ]);
  const degradedSources = [];
  if (analyticsResult.status === 'rejected') {
    console.error('[teacher-preparation] analytics context unavailable:', analyticsResult.reason);
    degradedSources.push('学情数据暂时不可用');
  }
  if (resourcesResult.status === 'rejected') {
    console.error('[teacher-preparation] resource context unavailable:', resourcesResult.reason);
    degradedSources.push('教学资源暂时不可用');
  }
  if (teachingClassResult.status === 'rejected') {
    console.error('[teacher-preparation] class context unavailable:', teachingClassResult.reason);
    degradedSources.push('教学班信息暂时不可用');
  }
  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : {
    overview: { average_mastery: 0, task_completion_rate: 0, risk_student_count: 0 },
    student_layers: [], risk_students: [], weak_knowledge_points: [], frequent_errors: [],
    dialogue: { keywords: [], misconceptions: [], unresolved_count: 0, question_samples: [] },
    data_sources: { generated_at: new Date().toISOString(), counts: {}, degraded: degradedSources },
  };
  const resources = resourcesResult.status === 'fulfilled' ? resourcesResult.value : [];
  const teachingClass = teachingClassResult.status === 'fulfilled' ? teachingClassResult.value : null;
  return {
    analyticsData: analytics,
    availableResources: resources,
    classProfile: {
      teachingClassId: teachingClass?.teaching_class_id || state.teachingClassId,
      className: teachingClass?.teaching_class_name || '当前教学班',
      courseName: teachingClass?.course?.course_name || '当前课程',
      studentCount: teachingClass?._count?.enrollments || analytics.overview.student_count || 0,
      averageMastery: analytics.overview.average_mastery,
      taskCompletionRate: analytics.overview.task_completion_rate,
      riskStudentCount: analytics.overview.risk_student_count,
      weakKnowledgePoints: analytics.weak_knowledge_points,
      semester: teachingClass?.course_offering?.semester?.name || teachingClass?.semester || null,
      degradedSources,
    },
    progress: 12,
    stage: 'context_ready',
  };
}

async function studentAnalyticsAgent(state) {
  const result = await recordExecution(state, AGENTS.STUDENT, 'student_analytics', 20, async () => ({
    value: {
      overview: state.analyticsData.overview,
      layers: state.analyticsData.student_layers,
      riskStudents: state.analyticsData.risk_students,
      weakKnowledgePoints: state.analyticsData.weak_knowledge_points,
      frequentErrors: state.analyticsData.frequent_errors,
    },
  }));
  return { studentAnalytics: result.value, progress: 20 };
}

async function dialogueInsightAgent(state) {
  const result = await recordExecution(state, AGENTS.DIALOGUE, 'dialogue_insights', 20, async () => ({
    value: {
      keywords: state.analyticsData.dialogue.keywords,
      misconceptions: state.analyticsData.dialogue.misconceptions,
      unresolvedCount: state.analyticsData.dialogue.unresolved_count,
      samples: state.analyticsData.dialogue.question_samples,
    },
  }));
  return { dialogueInsights: result.value, progress: 20 };
}

async function curriculumPlannerAgent(state) {
  const result = await recordExecution(state, AGENTS.CURRICULUM, 'curriculum_planning', 34, async () => {
    if (!shouldRun(state, ['teachingObjectives', 'keyPoints', 'difficultPoints', 'timeAllocation'])) return { skipped: true, value: {} };
    return callStructured(state, AGENTS.CURRICULUM,
      '输出字段：teachingObjectives(string[])、keyPoints(string[])、difficultPoints(string[])、timeAllocation({stage,minutes}[])。总分钟必须等于 duration。',
      () => {
        const weak = state.studentAnalytics?.weakKnowledgePoints?.slice(0, 3).map((item) => item.name) || [];
        return {
          teachingObjectives: [`理解并能解释${state.topic}的核心概念`, `能运用${state.topic}解决基础问题`, '能根据反馈修正典型错误'],
          keyPoints: weak.length ? weak : [state.topic],
          difficultPoints: weak.slice(0, 2).length ? weak.slice(0, 2) : [`${state.topic}的迁移应用`],
          timeAllocation: [
            { stage: '课堂引入', minutes: Math.max(5, Math.round(state.duration * 0.12)) },
            { stage: '概念与活动', minutes: Math.max(20, Math.round(state.duration * 0.55)) },
            { stage: '练习评价', minutes: Math.max(10, Math.round(state.duration * 0.23)) },
            { stage: '总结作业', minutes: Math.max(5, state.duration - Math.max(5, Math.round(state.duration * 0.12)) - Math.max(20, Math.round(state.duration * 0.55)) - Math.max(10, Math.round(state.duration * 0.23))) },
          ],
        };
      });
  });
  const value = result.value || {};
  return {
    teachingObjectives: value.teachingObjectives || state.teachingObjectives,
    keyPoints: value.keyPoints || state.keyPoints,
    difficultPoints: value.difficultPoints || state.difficultPoints,
    timeAllocation: value.timeAllocation || state.timeAllocation,
    errors: result.error ? [{ agent: AGENTS.CURRICULUM, message: result.error }] : [],
    progress: 34,
  };
}

async function introductionAgent(state) {
  const result = await recordExecution(state, AGENTS.INTRO, 'lesson_introduction', 52, async () => {
    if (!shouldRun(state, ['lessonIntroduction'])) return { skipped: true, value: state.lessonIntroduction };
    return callStructured(state, AGENTS.INTRO, '输出字段：scenario、openingQuestion、teacherAction、studentAction、minutes。', () => ({
      scenario: `从学生近期高频问题切入${state.topic}`,
      openingQuestion: state.dialogueInsights?.samples?.[0]?.question || `为什么要学习${state.topic}？`,
      teacherAction: '展示真实问题情境，引导学生提出已有判断。',
      studentAction: '独立思考后同伴交流，记录尚不确定的关键点。',
      minutes: Math.max(5, Math.round(state.duration * 0.12)),
    }));
  });
  return { lessonIntroduction: result.value, errors: result.error ? [{ agent: AGENTS.INTRO, message: result.error }] : [], progress: 52 };
}

async function contentDesignAgent(state) {
  const result = await recordExecution(state, AGENTS.CONTENT, 'content_design', 58, async () => {
    if (!shouldRun(state, ['activities', 'contentDesign'])) return { skipped: true, value: state.activities };
    return callStructured(state, AGENTS.CONTENT, '输出字段 activities 数组，每项含 title、teacherAction、studentAction、designIntent、minutes。', () => ({ activities: [
      { title: '概念建构', teacherAction: `用结构化示例讲解${state.topic}`, studentAction: '标注概念边界并给出反例', designIntent: '建立可迁移的概念模型', minutes: Math.max(12, Math.round(state.duration * 0.28)) },
      { title: '协作探究', teacherAction: '分层投放任务并巡视诊断', studentAction: '小组完成任务并解释推理过程', designIntent: '暴露误解并促进同伴解释', minutes: Math.max(12, Math.round(state.duration * 0.27)) },
    ] }));
  });
  return { activities: result.value?.activities || result.value, errors: result.error ? [{ agent: AGENTS.CONTENT, message: result.error }] : [], progress: 58 };
}

async function questionDesignAgent(state) {
  const result = await recordExecution(state, AGENTS.QUESTION, 'question_design', 58, async () => {
    if (!shouldRun(state, ['questions'])) return { skipped: true, value: state.questions };
    return callStructured(state, AGENTS.QUESTION, '输出字段 questions 数组，每项含 level、question、purpose、expectedEvidence。', () => ({ questions: [
      { level: 'diagnostic', question: `你会如何用自己的话解释${state.topic}？`, purpose: '诊断前概念', expectedEvidence: '能指出关键属性' },
      { level: 'socratic', question: '如果改变一个条件，结论仍然成立吗？为什么？', purpose: '检验概念边界', expectedEvidence: '能用反例或条件说明' },
      { level: 'transfer', question: '如何把今天的方法迁移到新的实际问题？', purpose: '检验迁移', expectedEvidence: '能选择方法并解释理由' },
    ] }));
  });
  return { questions: result.value?.questions || result.value, errors: result.error ? [{ agent: AGENTS.QUESTION, message: result.error }] : [], progress: 58 };
}

async function exerciseDesignAgent(state) {
  const result = await recordExecution(state, AGENTS.EXERCISE, 'exercise_design', 58, async () => {
    if (!shouldRun(state, ['exercises', 'homework'])) return { skipped: true, value: { exercises: state.exercises, homework: state.homework } };
    return callStructured(state, AGENTS.EXERCISE, '输出 exercises 数组（basic、advanced、challenge 各至少一项）和 homework 数组。', () => ({
      exercises: [
        { level: 'basic', title: '概念辨析', prompt: `判断并解释关于${state.topic}的关键陈述`, score: 10 },
        { level: 'advanced', title: '方法应用', prompt: `运用${state.topic}解决一个综合情境`, score: 15 },
        { level: 'challenge', title: '开放迁移', prompt: '设计一个反例或改进方案并说明依据', score: 15 },
      ],
      homework: [{ level: 'required', title: '基础巩固', description: '完成课堂薄弱点对应练习' }, { level: 'optional', title: '迁移拓展', description: '选择真实场景形成一页分析' }],
    }));
  });
  return { exercises: result.value?.exercises || state.exercises, homework: result.value?.homework || state.homework, errors: result.error ? [{ agent: AGENTS.EXERCISE, message: result.error }] : [], progress: 58 };
}

async function assessmentAgent(state) {
  const result = await recordExecution(state, AGENTS.ASSESSMENT, 'assessment_design', 58, async () => {
    if (!shouldRun(state, ['assessments'])) return { skipped: true, value: state.assessments };
    return callStructured(state, AGENTS.ASSESSMENT, '输出 assessments 数组，每项含 stage、method、evidence、successCriteria。', () => ({ assessments: [
      { stage: '导入', method: '诊断提问', evidence: '学生初始解释', successCriteria: '能说出至少一个关键属性' },
      { stage: '活动', method: '观察量规与同伴互评', evidence: '推理过程和纠错记录', successCriteria: '能解释选择的方法' },
      { stage: '结束', method: '出口条', evidence: '独立完成迁移题', successCriteria: '核心步骤正确且理由清晰' },
    ] }));
  });
  return { assessments: result.value?.assessments || result.value, errors: result.error ? [{ agent: AGENTS.ASSESSMENT, message: result.error }] : [], progress: 58 };
}

async function resourceRecommendationAgent(state) {
  const result = await recordExecution(state, AGENTS.RESOURCE, 'resource_recommendation', 58, async () => {
    if (!shouldRun(state, ['resources'])) return { skipped: true, value: state.resources };
    return { value: (state.availableResources || []).slice(0, 10).map((item) => ({
      document_id: item.document_id,
      title: item.title,
      kind: item.resource_kind || item.file_ext,
      category: item.resource_category,
      url: item.file_url,
      reason: '与当前课程或教学班已建立真实关联',
    })) };
  });
  return { resources: result.value, progress: 58 };
}

async function qualityReviewAgent(state) {
  const result = await recordExecution(state, AGENTS.REVIEW, 'quality_review', 78, async () => {
    const activityMinutes = (state.activities || []).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
    const introMinutes = Number(state.lessonIntroduction?.minutes || 0);
    const plannedMinutes = activityMinutes + introMinutes;
    const issues = [];
    if (!(state.teachingObjectives || []).length) issues.push('缺少教学目标');
    if (!(state.assessments || []).length) issues.push('缺少形成性评价');
    if (plannedMinutes > state.duration) issues.push(`活动时间 ${plannedMinutes} 分钟超过课时 ${state.duration} 分钟`);
    if (!(state.questions || []).some((item) => item.level === 'diagnostic')) issues.push('缺少诊断性问题');
    return { value: {
      passed: issues.length === 0,
      score: Math.max(0, 100 - issues.length * 15),
      issues,
      checks: {
        objectiveActivityAssessmentAlignment: Boolean((state.teachingObjectives || []).length && (state.activities || []).length && (state.assessments || []).length),
        timeReasonable: plannedMinutes <= state.duration,
        differentiationIncluded: (state.exercises || []).some((item) => item.level === 'challenge'),
        dataGrounded: Boolean(state.analyticsData?.data_sources),
      },
    } };
  });
  return { reviewResult: result.value, progress: 78 };
}

async function documentGenerationAgent(state) {
  const result = await recordExecution(state, AGENTS.DOCUMENT, 'document_generation', 96, async () => {
    const merged = {
      courseInfo: { courseId: state.courseId, teachingClassId: state.teachingClassId, topic: state.topic, date: state.date, duration: state.duration, ...state.params },
      classProfile: state.classProfile,
      studentAnalytics: state.studentAnalytics,
      dialogueInsights: state.dialogueInsights,
      teachingObjectives: state.teachingObjectives,
      keyPoints: state.keyPoints,
      difficultPoints: state.difficultPoints,
      teachingPreparation: state.resources,
      timeAllocation: state.timeAllocation,
      lessonIntroduction: state.lessonIntroduction,
      activities: state.activities,
      questions: state.questions,
      exercises: state.exercises,
      assessments: state.assessments,
      homework: state.homework,
      boardDesign: { title: state.topic, sections: state.keyPoints || [] },
      teachingReflection: '',
      resources: state.resources,
      qualityReview: state.reviewResult,
      dataSources: state.analyticsData?.data_sources,
    };
    const latest = await prisma.lessonPlanVersion.aggregate({ where: { lesson_plan_id: state.lessonPlanId }, _max: { version_number: true } });
    const versionNumber = (latest._max.version_number || 0) + 1;
    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.lessonPlanVersion.create({
        data: {
          lesson_plan_id: state.lessonPlanId,
          version_number: versionNumber,
          created_by_user_id: state.teacherUserId,
          change_summary: state.targetSections?.length ? `局部生成：${state.targetSections.join('、')}` : '多智能体生成',
          ai_content_json: merged,
          teacher_content_json: {},
          merged_content_json: merged,
          locked_blocks_json: state.lockedBlocks || [],
          data_range_json: state.analyticsData?.filters,
          agents_json: Object.values(AGENTS),
          data_sources_json: state.analyticsData?.data_sources,
        },
      });
      await tx.lessonPlan.update({
        where: { lesson_plan_id: state.lessonPlanId },
        data: { status: state.reviewResult?.passed ? 'READY' : 'REVIEW', current_version: versionNumber, progress: 100, source_snapshot_json: state.analyticsData?.data_sources, errors_json: state.errors || [] },
      });
      if (state.taskId) {
        await tx.asyncTask.update({
          where: { id: state.taskId },
          data: { status: 'SUCCEEDED', stage: '智慧备课已生成', progress: 100, resultType: 'LESSON_PLAN', resultId: String(state.lessonPlanId), resultUrl: `#/teacher/preparation/${state.lessonPlanId}`, completedAt: new Date() },
        });
      }
      return created;
    });
    return { value: { merged, versionId: version.lesson_plan_version_id, versionNumber } };
  });
  events.publish(state.lessonPlanId, { type: 'complete', status: state.reviewResult?.passed ? 'ready' : 'review', progress: 100, version: result.value.versionNumber });
  return { lessonPlan: result.value.merged, progress: 100, stage: 'completed' };
}

module.exports = {
  AGENTS,
  collectContext,
  studentAnalyticsAgent,
  dialogueInsightAgent,
  curriculumPlannerAgent,
  introductionAgent,
  contentDesignAgent,
  questionDesignAgent,
  exerciseDesignAgent,
  assessmentAgent,
  resourceRecommendationAgent,
  qualityReviewAgent,
  documentGenerationAgent,
};
