const crypto = require('crypto');
const prisma = require('../config/prisma');
const { ensureCourseAccess, ensureTeachingClassAccess, isAdmin } = require('./teacher-access.service');
const { runPreparationGraph } = require('../modules/lesson-plan/workbench/preparation.graph');
const preparationEvents = require('../modules/lesson-plan/workbench/preparation-events');
const artifactExportService = require('../modules/file-generator/artifact-export.service');
const aiChatService = require('./ai-chat.service');
const teacherAnalyticsService = require('./teacher-analytics-workbench.service');

const LESSON_TEMPLATES = {
  '新授课': ['classProfile','studentAnalytics','teachingObjectives','keyAndDifficultPoints','timeAllocation','lessonIntroduction','activities','questions','exercises','assessments','homework','resources','reviewResult'],
  '复习课': ['studentAnalytics','teachingObjectives','keyAndDifficultPoints','timeAllocation','activities','questions','exercises','differentiatedInstruction','assessments','homework','reviewResult'],
  '实验课': ['classProfile','teachingObjectives','keyAndDifficultPoints','timeAllocation','activities','questions','assessments','resources','reviewResult'],
  '研讨课': ['studentAnalytics','teachingObjectives','lessonIntroduction','activities','questions','differentiatedInstruction','assessments','reviewResult'],
  '项目式课程': ['classProfile','studentAnalytics','teachingObjectives','keyAndDifficultPoints','timeAllocation','activities','differentiatedInstruction','assessments','resources','reviewResult'],
  '翻转课堂': ['studentAnalytics','teachingObjectives','lessonIntroduction','activities','questions','exercises','assessments','homework','reviewResult'],
  '混合式教学': ['classProfile','studentAnalytics','teachingObjectives','timeAllocation','lessonIntroduction','activities','questions','differentiatedInstruction','assessments','resources','reviewResult'],
  '任务驱动课': ['studentAnalytics','teachingObjectives','keyAndDifficultPoints','timeAllocation','activities','questions','exercises','assessments','reviewResult'],
  '概念课': ['studentAnalytics','teachingObjectives','keyAndDifficultPoints','lessonIntroduction','activities','questions','assessments','reviewResult'],
  '习题课': ['studentAnalytics','teachingObjectives','keyAndDifficultPoints','questions','exercises','differentiatedInstruction','assessments','reviewResult'],
};

function lower(value) { return value == null ? null : String(value).toLowerCase(); }

async function completeTeacherText(messages, maxOutputTokens = 1600) {
  aiChatService.getBailianConfig();
  const stream = await aiChatService.createCompletionStream(messages, undefined, { maxOutputTokens });
  let content = '';
  for await (const chunk of stream) content += chunk.choices?.[0]?.delta?.content || '';
  return content.trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function ensurePlanAccess(user, lessonPlanId) {
  const plan = await prisma.lessonPlan.findUnique({
    where: { lesson_plan_id: Number(lessonPlanId) },
    include: { course: true, teaching_class: true, versions: { orderBy: { version_number: 'desc' }, take: 1 } },
  });
  if (!plan) throw Object.assign(new Error('备课方案不存在'), { code: 40002 });
  if (!isAdmin(user) && plan.teacher_user_id !== user.user_id) {
    if (!plan.teaching_class_id) throw Object.assign(new Error('无权访问该备课方案'), { code: 40301 });
    await ensureTeachingClassAccess(user, plan.teaching_class_id);
  }
  return plan;
}

function serializePlan(plan) {
  return {
    lesson_plan_id: plan.lesson_plan_id,
    teacher_user_id: plan.teacher_user_id,
    course_id: plan.course_id,
    course_name: plan.course?.course_name || null,
    course_offering_id: plan.course_offering_id,
    teaching_class_id: plan.teaching_class_id,
    teaching_class_name: plan.teaching_class?.teaching_class_name || null,
    chapter_id: plan.chapter_id,
    topic: plan.topic,
    teaching_date: plan.teaching_date?.toISOString() || null,
    duration_minutes: plan.duration_minutes,
    lesson_type: plan.lesson_type,
    location: plan.location,
    textbook: plan.textbook,
    input: plan.input_json,
    status: lower(plan.status),
    current_version: plan.current_version,
    progress: plan.progress,
    errors: plan.errors_json,
    generation_task_id: plan.generation_task_id,
    updated_at: plan.updated_at.toISOString(),
    created_at: plan.created_at.toISOString(),
    content: plan.versions?.[0]?.merged_content_json || null,
    locked_blocks: plan.versions?.[0]?.locked_blocks_json || [],
  };
}

async function listPlans(user, query = {}) {
  const where = isAdmin(user) ? {} : { teacher_user_id: user.user_id };
  if (query.course_id) {
    await ensureCourseAccess(user, Number(query.course_id));
    where.course_id = Number(query.course_id);
  }
  if (query.teaching_class_id) {
    await ensureTeachingClassAccess(user, Number(query.teaching_class_id));
    where.teaching_class_id = Number(query.teaching_class_id);
  }
  if (query.status) where.status = query.status.toUpperCase();
  if (query.keyword) where.topic = { contains: query.keyword };
  const rows = await prisma.lessonPlan.findMany({
    where,
    include: { course: true, teaching_class: true, versions: { orderBy: { version_number: 'desc' }, take: 1 } },
    orderBy: { updated_at: 'desc' },
  });
  return { list: rows.map(serializePlan), total: rows.length };
}

async function createPlan(user, body) {
  const courseId = Number(body.course_id);
  const classId = Number(body.teaching_class_id);
  if (!courseId || !classId || !body.topic) throw Object.assign(new Error('course_id、teaching_class_id、topic 为必填项'), { code: 40001 });
  await ensureCourseAccess(user, courseId);
  const teachingClass = await ensureTeachingClassAccess(user, classId);
  if (teachingClass.course_id !== courseId) throw Object.assign(new Error('教学班不属于所选课程'), { code: 40001 });
  const lessonType = LESSON_TEMPLATES[body.lesson_type] ? body.lesson_type : '新授课';
  const plan = await prisma.lessonPlan.create({
    data: {
      teacher_user_id: user.user_id,
      course_id: courseId,
      course_offering_id: teachingClass.course_offering_id,
      teaching_class_id: classId,
      chapter_id: body.chapter_id ? Number(body.chapter_id) : null,
      topic: body.topic,
      teaching_date: body.teaching_date ? new Date(body.teaching_date) : null,
      duration_minutes: Number(body.duration_minutes || body.duration || 45),
      lesson_type: lessonType,
      location: body.location || teachingClass.location || null,
      textbook: body.textbook || null,
      input_json: {
        knowledgePointIds: body.knowledge_point_ids || [],
        resourceIds: body.resource_ids || [],
        studentFoundation: body.student_foundation || null,
        teachingMethodPreferences: body.teaching_method_preferences || [],
        useCase: body.use_case ?? true,
        projectBased: body.project_based ?? false,
        discussion: body.discussion ?? true,
        inClassPractice: body.in_class_practice ?? true,
        includeHomework: body.include_homework ?? true,
        analyticsRange: body.analytics_range || '30d',
        templateStages: LESSON_TEMPLATES[lessonType],
        generationConfirmation: null,
      },
      status: 'DRAFT',
    },
    include: { course: true, teaching_class: true, versions: true },
  });
  return serializePlan(plan);
}

async function getPlan(user, lessonPlanId) {
  return serializePlan(await ensurePlanAccess(user, lessonPlanId));
}

async function saveDraft(user, lessonPlanId, body) {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  const latest = plan.versions?.[0];
  const merged = body.content || latest?.merged_content_json || {};
  const locked = body.locked_blocks || latest?.locked_blocks_json || [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const maximum = await prisma.lessonPlanVersion.aggregate({
      where: { lesson_plan_id: plan.lesson_plan_id },
      _max: { version_number: true },
    });
    const versionNumber = Math.max(plan.current_version || 0, latest?.version_number || 0, maximum._max.version_number || 0) + 1;
    try {
      const version = await prisma.$transaction(async (tx) => {
        const created = await tx.lessonPlanVersion.create({
          data: {
            lesson_plan_id: plan.lesson_plan_id,
            version_number: versionNumber,
            created_by_user_id: user.user_id,
            change_summary: body.change_summary || '教师编辑保存',
            ai_content_json: latest?.ai_content_json || {},
            teacher_content_json: body.teacher_content || merged,
            merged_content_json: merged,
            locked_blocks_json: locked,
            data_range_json: latest?.data_range_json,
            agents_json: latest?.agents_json,
            data_sources_json: latest?.data_sources_json,
          },
        });
        await tx.lessonPlan.update({
          where: { lesson_plan_id: plan.lesson_plan_id },
          data: {
            status: body.status === 'review' ? 'REVIEW' : 'DRAFT',
            current_version: versionNumber,
            topic: body.topic || plan.topic,
            teaching_date: body.teaching_date ? new Date(body.teaching_date) : plan.teaching_date,
            duration_minutes: body.duration_minutes ? Number(body.duration_minutes) : plan.duration_minutes,
          },
        });
        return created;
      });
      return { lesson_plan_id: plan.lesson_plan_id, version_id: version.lesson_plan_version_id, version_number: version.version_number };
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      if (attempt === 2) break;
    }
  }
  throw Object.assign(new Error('备课版本保存冲突，请刷新后重试'), { code: 40901 });
}

async function startGeneration(user, lessonPlanId, body = {}) {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  if (!plan.teaching_class_id) throw Object.assign(new Error('备课方案缺少教学班'), { code: 40001 });
  await ensureTeachingClassAccess(user, plan.teaching_class_id);
  const input = plan.input_json || {};
  const suppliedToken = String(body.confirmation_token || '');
  const pendingConfirmation = input.generationConfirmation;
  if (!pendingConfirmation || pendingConfirmation.status !== 'awaiting' || suppliedToken !== pendingConfirmation.token) {
    const token = crypto.randomUUID();
    const confirmation = {
      token,
      status: 'awaiting',
      stage: body.sections?.length ? 'partial_generation' : 'full_generation',
      sections: body.sections || [],
      requestedAt: new Date().toISOString(),
      summary: {
        lessonType: plan.lesson_type || '新授课',
        topic: plan.topic,
        courseId: plan.course_id,
        teachingClassId: plan.teaching_class_id,
        analyticsRange: input.analyticsRange || '30d',
        lockedBlocks: body.locked_blocks || plan.versions?.[0]?.locked_blocks_json || [],
      },
    };
    await prisma.lessonPlan.update({ where: { lesson_plan_id: plan.lesson_plan_id }, data: { input_json: { ...input, generationConfirmation: confirmation } } });
    return { lesson_plan_id: plan.lesson_plan_id, status: 'awaiting_confirmation', confirmation };
  }
  await prisma.lessonPlan.update({
    where: { lesson_plan_id: plan.lesson_plan_id },
    data: { input_json: { ...input, generationConfirmation: { ...pendingConfirmation, status: 'confirmed', confirmedAt: new Date().toISOString() } } },
  });
  const operationId = body.operation_id || `lesson-plan-${plan.lesson_plan_id}-${crypto.randomUUID()}`;
  const task = await prisma.asyncTask.create({
    data: {
      userId: user.user_id,
      operationId,
      taskType: 'LESSON_PLAN_GENERATION',
      title: `智慧备课：${plan.topic}`,
      description: body.sections?.length ? `局部生成：${body.sections.join('、')}` : '多智能体完整生成',
      status: 'RUNNING',
      stage: '正在读取学情数据',
      progress: 5,
      progressMode: 'DETERMINATE',
      relatedResourceType: 'LESSON_PLAN',
      relatedResourceId: String(plan.lesson_plan_id),
      requestPayloadJson: body,
      startedAt: new Date(),
    },
  });
  await prisma.lessonPlan.update({
    where: { lesson_plan_id: plan.lesson_plan_id },
    data: { status: 'GENERATING', progress: 5, generation_task_id: task.id, errors_json: [] },
  });
  const current = plan.versions?.[0]?.merged_content_json || {};
  const initialState = {
    taskId: task.id,
    userId: user.user_id,
    teacherUserId: user.user_id,
    courseId: plan.course_id,
    teachingClassId: plan.teaching_class_id,
    lessonPlanId: plan.lesson_plan_id,
    topic: plan.topic,
    date: plan.teaching_date?.toISOString() || null,
    duration: plan.duration_minutes,
    params: {
      ...(plan.input_json || {}),
      topic: plan.topic,
      teachingDate: plan.teaching_date?.toISOString() || null,
      lessonType: plan.lesson_type,
      venue: plan.location,
      teachingMaterial: plan.textbook,
      analyticsRange: body.analytics_range || plan.input_json?.analyticsRange || '30d',
      chapterId: plan.chapter_id,
      knowledgePointId: plan.input_json?.knowledgePointIds?.[0],
    },
    targetSections: body.sections || [],
    lockedBlocks: body.locked_blocks || plan.versions?.[0]?.locked_blocks_json || [],
    teachingObjectives: current.teachingObjectives,
    keyPoints: current.keyPoints,
    difficultPoints: current.difficultPoints,
    timeAllocation: current.timeAllocation,
    lessonIntroduction: current.lessonIntroduction,
    activities: current.activities,
    questions: current.questions,
    exercises: current.exercises,
    assessments: current.assessments,
    homework: current.homework,
    resources: current.resources,
  };
  preparationEvents.publish(plan.lesson_plan_id, { type: 'start', status: 'generating', progress: 5, task_id: task.id });
  queueMicrotask(() => {
    runPreparationGraph(initialState).catch((error) => console.error('[teacher-preparation] generation failed:', error.message));
  });
  return { lesson_plan_id: plan.lesson_plan_id, task_id: task.id, operation_id: operationId, status: 'generating' };
}

async function refineStage(user, lessonPlanId, body = {}) {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  const stageKey = String(body.stage_key || '').trim();
  const instruction = String(body.instruction || '').trim();
  const templateStages = plan.input_json?.templateStages || LESSON_TEMPLATES[plan.lesson_type] || LESSON_TEMPLATES['新授课'];
  if (!templateStages.includes(stageKey)) throw Object.assign(new Error('当前模板不包含该备课阶段'), { code: 40001 });
  if (!instruction || instruction.length > 1000) throw Object.assign(new Error('请输入 1-1000 字的优化要求'), { code: 40001 });
  const latest = plan.versions?.[0];
  if (!latest) throw Object.assign(new Error('请先生成或保存一个备课版本'), { code: 40001 });
  if ((latest.locked_blocks_json || []).includes(stageKey)) throw Object.assign(new Error('该阶段已锁定，请先取消锁定'), { code: 40901 });
  const content = latest.merged_content_json || {};
  const currentNarrative = content.teacherNarratives?.[stageKey] || asText(content[stageKey]);
  let analyticsContext = null;
  try {
    const analytics = await teacherAnalyticsService.buildWorkbench(user, {
      course_id: plan.course_id,
      teaching_class_id: plan.teaching_class_id || undefined,
      range: plan.input_json?.analyticsRange || plan.input_json?.analytics_range || '30d',
    }, { persist: false });
    analyticsContext = {
      overview: analytics.overview,
      weak_knowledge_points: (analytics.weak_knowledge_points || []).slice(0, 8),
      frequent_questions: (analytics.dialogue?.question_samples || []).slice(0, 8),
      keywords: (analytics.dialogue?.keywords || []).slice(0, 12),
      data_sources: analytics.data_sources,
    };
  } catch (error) {
    console.error('[teacher-preparation] refinement analytics context unavailable:', error.message);
  }
  let narrative;
  try {
    const trustedContext = JSON.stringify({
      course: plan.course?.course_name,
      teaching_class: plan.teaching_class?.teaching_class_name,
      lesson_type: plan.lesson_type,
      topic: plan.topic,
      class_profile: content.classProfile,
      teaching_objectives: content.teachingObjectives,
      key_points: content.keyPoints,
      difficult_points: content.difficultPoints,
      analytics: analyticsContext,
    }).slice(0, 12000);
    narrative = await completeTeacherText([
      { role: 'system', content: '你是教师备课编辑助手。只优化指定阶段，以自然、可直接编辑的中文教学文本输出；不得输出 JSON、代码块，不得编造班级统计。只能使用提供的真实学情上下文；缺少数据时明确说明，不得猜测。' },
      { role: 'user', content: `真实备课上下文：\n${trustedContext}\n\n阶段：${stageKey}\n当前内容：\n${currentNarrative || '暂无'}\n\n教师要求：${instruction}` },
    ], 1600);
  } catch (cause) {
    console.error('[teacher-preparation] stage refinement failed:', cause);
    throw Object.assign(new Error('AI 局部优化暂时不可用，当前阶段内容未被修改。'), { code: 50001, publicCode: 'PREPARATION_REFINE_UNAVAILABLE', retryable: true, expose: true, cause });
  }
  if (!narrative) throw Object.assign(new Error('AI 未返回有效的自然语言内容，请重试'), { code: 50001, publicCode: 'PREPARATION_REFINE_EMPTY', retryable: true, expose: true });
  if (body.preview_only === true) {
    return {
      lesson_plan_id: plan.lesson_plan_id,
      status: 'preview_ready',
      stage_key: stageKey,
      narrative,
      original_narrative: currentNarrative || '',
      base_version: latest.version_number,
    };
  }
  const merged = { ...content, teacherNarratives: { ...(content.teacherNarratives || {}), [stageKey]: narrative } };
  const saved = await saveDraft(user, lessonPlanId, { content: merged, locked_blocks: latest.locked_blocks_json || [], change_summary: `自然语言优化：${stageKey}` });
  return { ...saved, stage_key: stageKey, narrative };
}

async function getGenerationStatus(user, lessonPlanId) {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  const [executions, task] = await Promise.all([
    prisma.lessonPlanAgentExecution.findMany({ where: { lesson_plan_id: plan.lesson_plan_id }, orderBy: { created_at: 'asc' } }),
    plan.generation_task_id ? prisma.asyncTask.findUnique({ where: { id: plan.generation_task_id } }) : null,
  ]);
  return {
    lesson_plan_id: plan.lesson_plan_id,
    status: lower(plan.status),
    progress: plan.progress,
    task: task ? { task_id: task.id, status: lower(task.status), stage: task.stage, error: task.errorMessage } : null,
    agents: executions.map((item) => ({
      execution_id: item.execution_id,
      agent: item.agent_key,
      stage: item.stage_key,
      status: item.status,
      output: item.output_json,
      error: item.error_message,
      started_at: item.started_at?.toISOString() || null,
      completed_at: item.completed_at?.toISOString() || null,
    })),
  };
}

async function listVersions(user, lessonPlanId) {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  const versions = await prisma.lessonPlanVersion.findMany({
    where: { lesson_plan_id: plan.lesson_plan_id },
    include: { creator: { include: { profile: true } } },
    orderBy: { version_number: 'desc' },
  });
  return { list: versions.map((item) => ({
    version_id: item.lesson_plan_version_id,
    version_number: item.version_number,
    change_summary: item.change_summary,
    content: item.merged_content_json,
    locked_blocks: item.locked_blocks_json,
    data_range: item.data_range_json,
    agents: item.agents_json,
    data_sources: item.data_sources_json,
    creator_name: item.creator.profile?.real_name || item.creator.username,
    created_at: item.created_at.toISOString(),
  })) };
}

async function compareVersions(user, lessonPlanId, fromVersion, toVersion) {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  const versions = await prisma.lessonPlanVersion.findMany({
    where: { lesson_plan_id: plan.lesson_plan_id, version_number: { in: [Number(fromVersion), Number(toVersion)] } },
  });
  if (versions.length !== 2) throw Object.assign(new Error('版本不存在'), { code: 40002 });
  const from = versions.find((item) => item.version_number === Number(fromVersion));
  const to = versions.find((item) => item.version_number === Number(toVersion));
  const keys = [...new Set([...Object.keys(from.merged_content_json || {}), ...Object.keys(to.merged_content_json || {})])];
  return {
    from: from.version_number,
    to: to.version_number,
    changes: keys.filter((key) => JSON.stringify(from.merged_content_json?.[key]) !== JSON.stringify(to.merged_content_json?.[key])).map((key) => ({ key, before: from.merged_content_json?.[key], after: to.merged_content_json?.[key] })),
  };
}

async function restoreVersion(user, lessonPlanId, versionNumber) {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  const source = await prisma.lessonPlanVersion.findUnique({
    where: { lesson_plan_id_version_number: { lesson_plan_id: plan.lesson_plan_id, version_number: Number(versionNumber) } },
  });
  if (!source) throw Object.assign(new Error('版本不存在'), { code: 40002 });
  return saveDraft(user, lessonPlanId, { content: source.merged_content_json, locked_blocks: source.locked_blocks_json, change_summary: `恢复自版本 V${source.version_number}` });
}

async function publishPlan(user, lessonPlanId) {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  if (!plan.current_version) throw Object.assign(new Error('备课方案尚无可发布版本'), { code: 40001 });
  await prisma.lessonPlan.update({ where: { lesson_plan_id: plan.lesson_plan_id }, data: { status: 'PUBLISHED', published_at: new Date() } });
  return { lesson_plan_id: plan.lesson_plan_id, status: 'published' };
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('；');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}：${asText(item)}`).join('；');
  return String(value);
}

function buildHandoutContent(plan, content, studentHandout = false) {
  const narrative = (key, fallback) => content.teacherNarratives?.[key] || fallback;
  const sections = [
    ['学情分析', narrative('studentAnalytics', content.studentAnalytics)], ['教学目标', narrative('teachingObjectives', content.teachingObjectives)], ['教学重点', narrative('keyAndDifficultPoints', content.keyPoints)],
    ['教学难点', narrative('keyAndDifficultPoints', content.difficultPoints)], ['教学准备', narrative('resources', content.teachingPreparation)], ['时间分配', narrative('timeAllocation', content.timeAllocation)],
    ['课堂引入', narrative('lessonIntroduction', content.lessonIntroduction)], ['教学过程', narrative('activities', content.activities)], ['课堂提问', narrative('questions', content.questions)],
    ['例题与练习', narrative('exercises', content.exercises)], ['课堂评价', narrative('assessments', content.assessments)], ['作业设计', narrative('homework', content.homework)],
    ['板书设计', content.boardDesign], ['教学反思', content.teachingReflection || '（课后填写）'], ['数据来源', content.dataSources],
  ].map(([title, value], index) => ({ id: `section-${index + 1}`, title, content: [asText(value) || '暂无'] }));
  return {
    title: `${plan.topic} ${studentHandout ? '学生讲义' : '教学设计'}`,
    course: plan.course.course_name,
    knowledgePoints: (content.keyPoints || [plan.topic]).map(asText).filter(Boolean).slice(0, 20),
    learningObjectives: (content.teachingObjectives || ['完成本课学习目标']).map(asText),
    prerequisites: [asText(content.classProfile) || '基于当前教学班学情快照'],
    sections,
    examples: (content.exercises || []).slice(0, 5).map((item, index) => ({ title: item.title || `练习 ${index + 1}`, content: asText(item) })),
    keyPoints: (content.keyPoints || [plan.topic]).map(asText),
    commonMistakes: (content.dialogueInsights?.misconceptions || []).map((item) => asText(item.tag || item)).slice(0, 10).concat(['根据课堂反馈动态补充']).slice(0, 10),
    practice: (content.exercises || []).map((item) => ({ question: item.prompt || item.title || '课堂练习', answer: '课堂讨论后形成', analysis: item.purpose || item.level || '用于形成性评价' })).slice(0, 10),
    principles: ['目标、活动与评价保持一致', '基于真实学情进行分层教学'],
    references: (content.resources || []).map((item) => item.title).filter(Boolean).slice(0, 10).concat(['DisciMind 学情分析快照']).slice(0, 10),
    summary: (content.keyPoints || [plan.topic]).map(asText),
    sourceNotice: '统计数据来自 DisciMind 授权范围内的作业、考试、掌握度、学习记录与学生学科对话；AI 生成内容需由教师复核。',
  };
}

function buildPreviewHtml(plan, content) {
  const narrative = (key, fallback) => content.teacherNarratives?.[key] || fallback;
  const sections = [
    ['学情分析', narrative('studentAnalytics', content.studentAnalytics)], ['教学目标', narrative('teachingObjectives', content.teachingObjectives)], ['教学重难点', narrative('keyAndDifficultPoints', { keyPoints: content.keyPoints, difficultPoints: content.difficultPoints })],
    ['教学准备', narrative('resources', content.teachingPreparation)], ['教学过程与时间分配', narrative('activities', { timeAllocation: content.timeAllocation, introduction: content.lessonIntroduction, activities: content.activities })],
    ['课堂提问', narrative('questions', content.questions)], ['例题和练习', narrative('exercises', content.exercises)], ['评价方式', narrative('assessments', content.assessments)], ['作业', narrative('homework', content.homework)],
    ['板书设计', content.boardDesign], ['教学反思', '（课后填写）'], ['数据来源', content.dataSources],
  ];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:18mm 16mm}body{font-family:"Microsoft YaHei",sans-serif;color:#30271f;line-height:1.65;font-size:12px}h1{color:#8c5b21;text-align:center;margin:0 0 6px}h2{color:#7a4b18;border-bottom:1px solid #d9c4a8;padding-bottom:4px;margin-top:18px}.meta{text-align:center;color:#76685a;margin-bottom:18px}pre{white-space:pre-wrap;font-family:inherit;background:#fbf7f1;padding:10px;border-radius:6px}.footer{margin-top:28px;color:#8a7c6d;font-size:10px}
  </style></head><body><h1>${escapeHtml(plan.topic)} 教学设计</h1><div class="meta">${escapeHtml(plan.course.course_name)} · ${escapeHtml(plan.teaching_class?.teaching_class_name)} · ${plan.duration_minutes} 分钟</div>
  ${sections.map(([title, value]) => `<h2>${escapeHtml(title)}</h2><pre>${escapeHtml(asText(value) || '暂无')}</pre>`).join('')}
  <div class="footer">DisciMind 学研智擎 · 教师复核后使用 · 页码由导出引擎生成</div></body></html>`;
}

function buildStudentPreviewHtml(plan, content) {
  const narrative = (key, fallback) => content.teacherNarratives?.[key] || fallback;
  const sections = [
    ['学习目标', narrative('teachingObjectives', content.teachingObjectives)],
    ['本课重点', narrative('keyAndDifficultPoints', content.keyPoints)],
    ['课前导入', narrative('lessonIntroduction', content.lessonIntroduction)],
    ['课堂任务', narrative('activities', content.activities)],
    ['例题与练习', narrative('exercises', content.exercises)],
    ['课后复习', narrative('homework', content.homework)],
  ];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:18mm 16mm}body{font-family:"Microsoft YaHei",sans-serif;color:#263238;line-height:1.7;font-size:12px}h1{color:#315b74;text-align:center;margin:0 0 6px}h2{color:#315b74;border-bottom:1px solid #cbd8df;padding-bottom:4px;margin-top:18px}.meta{text-align:center;color:#647680;margin-bottom:18px}pre{white-space:pre-wrap;font-family:inherit;background:#f5f9fb;padding:10px;border-radius:6px}.footer{margin-top:28px;color:#778892;font-size:10px}
  </style></head><body><h1>${escapeHtml(plan.topic)} 学生讲义</h1><div class="meta">${escapeHtml(plan.course.course_name)} · ${escapeHtml(plan.teaching_class?.teaching_class_name || '')}</div>
  ${sections.map(([title, value]) => `<h2>${escapeHtml(title)}</h2><pre>${escapeHtml(asText(value) || '暂无')}</pre>`).join('')}
  <div class="footer">DisciMind 学研智擎 · 教师审核后下发 · 请按课堂要求完成</div></body></html>`;
}

async function exportPlan(user, lessonPlanId, format, artifactRole = 'TEACHER_LESSON_PLAN') {
  const plan = await ensurePlanAccess(user, lessonPlanId);
  const normalized = String(format || 'DOCX').toUpperCase();
  const studentHandout = String(artifactRole).toUpperCase() === 'STUDENT_HANDOUT';
  if (!['DOCX', 'PDF'].includes(normalized)) throw Object.assign(new Error('仅支持 DOCX 或 PDF'), { code: 40001 });
  const latest = plan.versions?.[0];
  if (!latest) throw Object.assign(new Error('备课方案尚无可导出版本'), { code: 40001 });
  const operationId = `lpexp:${plan.lesson_plan_id}:v${latest.version_number}:${studentHandout ? 'S' : 'T'}:${normalized}`;
  let task = await prisma.asyncTask.findUnique({
    where: { userId_operationId: { userId: user.user_id, operationId } },
    include: { generatedArtifact: true },
  });
  if (task?.generatedArtifact) {
    return {
      task_id: task.id,
      artifact_id: task.generatedArtifact.id,
      status: task.generatedArtifact.status === 'READY' ? 'ready' : 'exporting',
      format: normalized,
      reused: true,
    };
  }
  if (task) {
    task = await prisma.asyncTask.update({
      where: { id: task.id },
      data: { status: 'RUNNING', stage: `正在生成 ${normalized}`, progress: 5, errorCode: null, errorMessage: null, startedAt: new Date(), finishedAt: null },
    });
  } else {
    task = await prisma.asyncTask.create({
      data: {
        userId: user.user_id, operationId, taskType: 'LESSON_PLAN_EXPORT', title: `${plan.topic} ${studentHandout ? '学生讲义' : '教师教案'} ${normalized} 导出`,
        status: 'RUNNING', stage: `正在生成 ${normalized}`, progress: 5, progressMode: 'DETERMINATE',
        relatedResourceType: 'LESSON_PLAN', relatedResourceId: String(plan.lesson_plan_id), startedAt: new Date(),
      },
    });
  }
  const content = latest.merged_content_json;
  const artifact = await prisma.generatedArtifact.create({
    data: {
      ownerUserId: user.user_id,
      lessonPlanId: plan.lesson_plan_id,
      taskId: task.id,
      operationId,
      artifactType: 'STUDY_HANDOUT',
      artifactRole: studentHandout ? 'STUDENT_HANDOUT' : 'TEACHER_LESSON_PLAN',
      title: `${plan.topic} ${studentHandout ? '学生讲义' : '教学设计'}`,
      description: `${plan.course.course_name} / ${plan.teaching_class?.teaching_class_name || ''}`,
      courseId: plan.course_id,
      requirementsJson: { lessonPlanId: plan.lesson_plan_id, version: latest.version_number, format: normalized },
      contentSchemaJson: buildHandoutContent(plan, content, studentHandout),
      previewHtml: studentHandout ? buildStudentPreviewHtml(plan, content) : buildPreviewHtml(plan, content),
      fileFormat: normalized,
      status: 'CONTENT_READY',
    },
  });
  queueMicrotask(async () => {
    try {
      const exported = await artifactExportService.exportFormat(artifact.id, normalized, { taskId: task.id });
      if (studentHandout) {
        const existingResource = await prisma.knowledgeDocument.findFirst({ where: { source_artifact_id: artifact.id, deleted_at: null } });
        if (!existingResource) await prisma.knowledgeDocument.create({
          data: {
            title: artifact.title,
            original_filename: `${artifact.title}.${normalized.toLowerCase()}`,
            file_ext: normalized.toLowerCase(),
            file_size_bytes: Number(exported.fileSizeBytes || 0) || null,
            mime_type: exported.mimeType,
            storage_type: 'LOCAL',
            file_url: `/generated-artifacts/${exported.storagePath}`,
            scope_type: plan.teaching_class_id ? 'CLASS' : 'COURSE',
            visibility: 'PRIVATE',
            course_id: plan.course_id,
            teaching_class_id: plan.teaching_class_id,
            lesson_plan_id: plan.lesson_plan_id,
            source_artifact_id: artifact.id,
            owner_user_id: user.user_id,
            is_teaching_resource: true,
            resource_kind: 'student_handout',
            resource_category: '学生讲义',
            metadata_json: { artifactId: artifact.id, lessonPlanVersion: latest.version_number },
            resource_group_id: `artifact-${artifact.id}`,
            resource_version: 1,
            version_source: 'AI_GENERATED',
            parse_status: 'PARSED',
            review_status: 'APPROVED',
            marketplace_status: 'READY',
          },
        });
      }
      await prisma.notification.create({
        data: {
          receiver_user_id: user.user_id, notification_type: 'FILE_GENERATED', title: `${plan.topic} ${normalized} 已生成`,
          content: '文件已进入任务中心和产物中心。', target_type: 'generated_artifact', target_id: artifact.id,
          business_type: 'lesson_plan_artifact', business_id: artifact.id,
        },
      });
    } catch (error) {
      console.error('[teacher-preparation] export failed:', error.message);
    }
  });
  return { task_id: task.id, artifact_id: artifact.id, status: 'exporting', format: normalized };
}

module.exports = {
  listPlans, createPlan, getPlan, saveDraft, startGeneration, getGenerationStatus,
  listVersions, compareVersions, restoreVersion, publishPlan, exportPlan, refineStage,
  ensurePlanAccess, subscribe: preparationEvents.subscribe,
};
