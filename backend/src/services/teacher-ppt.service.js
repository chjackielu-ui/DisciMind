const crypto = require('crypto');
const path = require('path');
const OpenAI = require('openai');
const prisma = require('../config/prisma');
const teacherPreparationService = require('./teacher-preparation.service');
const pptRenderer = require('./teacher-ppt-renderer.service');
const imageGenerateService = require('../modules/ai-generate/image-generate.service');

const pptQueue = [];
const activePptUsers = new Set();
let activePptGenerations = 0;

function positiveIntegerEnv(name, fallback, maximum = 20) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(maximum, parsed) : fallback;
}

function acquirePptGenerationSlot(userId) {
  const normalizedUserId = Number(userId);
  if (activePptUsers.has(normalizedUserId)) {
    throw Object.assign(new Error('你已有PPT正在生成，请等待当前任务完成'), { code: 40901 });
  }
  const concurrency = positiveIntegerEnv('PPT_GENERATION_CONCURRENCY', 1, 4);
  const queueLimit = positiveIntegerEnv('PPT_GENERATION_QUEUE_LIMIT', 4, 20);
  if (activePptGenerations >= concurrency && pptQueue.length >= queueLimit) {
    throw Object.assign(new Error('PPT生成队列已满，请稍后重试'), { code: 42901 });
  }
  activePptUsers.add(normalizedUserId);
  return new Promise((resolve) => {
    const grant = () => {
      activePptGenerations += 1;
      resolve(() => {
        activePptGenerations = Math.max(0, activePptGenerations - 1);
        activePptUsers.delete(normalizedUserId);
        const next = pptQueue.shift();
        if (next) next();
      });
    };
    if (activePptGenerations < concurrency) grant();
    else pptQueue.push(grant);
  });
}

const STYLE_LABELS = {
  teaching: '教学型',
  competition: '竞赛展示型',
  minimal: '简洁型',
  academic: '学术型',
  lecture: '课堂讲授型',
};

const STYLE_ALIASES = {
  teaching: 'teaching', '教学型': 'teaching',
  competition: 'competition', '竞赛展示型': 'competition',
  minimal: 'minimal', '简洁型': 'minimal',
  academic: 'academic', '学术型': 'academic',
  lecture: 'lecture', '课堂讲授型': 'lecture',
};

function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error(`${field} 参数不合法`), { code: 40001 });
  return parsed;
}

function stringList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => stringList(item)).filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => stringList(item)).filter(Boolean);
  return String(value || '').split(/\r?\n|[；;]/).map((item) => item.replace(/^[\s•*-]+/, '').trim()).filter(Boolean);
}

function text(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback;
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function normalizeStyle(value) {
  const raw = String(value || 'teaching').trim();
  const style = STYLE_ALIASES[raw] || STYLE_ALIASES[raw.toLowerCase()];
  if (!style) throw Object.assign(new Error('style 仅支持教学型、竞赛展示型、简洁型、学术型或课堂讲授型'), { code: 40001 });
  return style;
}

function normalizePageCount(value) {
  const count = Number(value || 10);
  if (!Number.isFinite(count)) throw Object.assign(new Error('pageCount 参数不合法'), { code: 40001 });
  return Math.min(30, Math.max(6, Math.round(count)));
}

async function loadGenerationContext(user, body = {}) {
  const syllabusId = optionalId(body.syllabusId ?? body.syllabus_id, 'syllabusId');
  const lessonPlanId = optionalId(body.lessonPlanId ?? body.lesson_plan_id, 'lessonPlanId');
  const [syllabus, plan] = await Promise.all([
    syllabusId ? teacherPreparationService.getSyllabus(user, syllabusId) : null,
    lessonPlanId ? teacherPreparationService.ensurePlanAccess(user, lessonPlanId) : null,
  ]);
  if (syllabus && plan && Number(syllabus.course_id) !== Number(plan.course_id)) {
    throw Object.assign(new Error('教学大纲与教案不属于同一课程'), { code: 40001 });
  }
  const sourceText = text(body.sourceText ?? body.source_text).slice(0, 28000);
  const suppliedPoints = stringList(body.knowledgePoints ?? body.knowledge_points).slice(0, 30);
  const topic = text(body.topic, text(plan?.topic, text(syllabus?.title, text(body.courseName ?? body.course_name, suppliedPoints[0] || (sourceText ? '课程内容教学设计' : '')))));
  if (!topic) throw Object.assign(new Error('请至少提供教学大纲、教案或课程主题'), { code: 40001 });
  const style = normalizeStyle(body.style);
  const pageCount = normalizePageCount(body.pageCount ?? body.page_count);
  const content = plan?.versions?.[0]?.merged_content_json || {};
  const courseName = text(body.courseName ?? body.course_name, text(syllabus?.course_name, text(plan?.course?.course_name, '未指定课程')));
  return {
    syllabusId,
    lessonPlanId,
    topic,
    pageCount,
    style,
    styleLabel: STYLE_LABELS[style],
    courseId: Number(syllabus?.course_id || plan?.course_id) || null,
    courseName,
    generationSource: text(body.generationSource ?? body.generation_source, syllabus ? 'syllabus' : plan ? 'lesson-plan' : sourceText ? 'text' : 'topic'),
    sourceText,
    suppliedPoints,
    syllabus,
    lessonPlan: plan ? {
      lessonPlanId: plan.lesson_plan_id,
      topic: plan.topic,
      lessonType: plan.lesson_type,
      durationMinutes: plan.duration_minutes,
      content,
    } : null,
  };
}

function slide(title, bullets, imageSuggestion, speakerNotes) {
  return {
    title: text(title, '教学内容'),
    bullets: stringList(bullets).slice(0, 6),
    imageSuggestion: text(imageSuggestion, '使用简洁的课程概念示意图'),
    speakerNotes: text(speakerNotes, '结合课堂节奏讲解本页要点，并通过提问确认学生理解。'),
  };
}

function toPublicResult(model, extra = {}) {
  return {
    title: model.title,
    subtitle: model.subtitle,
    courseName: model.courseName,
    style: model.style,
    slides: model.slides.map((item) => ({
      page: item.page,
      pageNumber: item.page,
      type: item.type,
      title: item.title,
      subtitle: item.subtitle,
      bullets: item.bullets,
      imagePrompt: item.imagePrompt,
      imageSuggestion: item.imagePrompt,
      imageUrl: item.imageUrl,
      notes: item.notes,
      speakerNotes: item.notes,
    })),
    status: 'completed',
    ...extra,
  };
}

function buildDemoResult(context) {
  const syllabus = context.syllabus || {};
  const lesson = context.lessonPlan?.content || {};
  const objectives = stringList(syllabus.objectives).length
    ? stringList(syllabus.objectives)
    : stringList(lesson.teachingObjectives).slice(0, 5);
  const knowledgePoints = [...new Set([
    ...context.suppliedPoints,
    ...stringList(syllabus.knowledge_points),
    ...stringList(lesson.keyPoints),
    ...stringList(lesson.difficultPoints),
  ])].slice(0, 18);
  const chapters = Array.isArray(syllabus.chapters) ? syllabus.chapters : [];
  const activities = Array.isArray(lesson.activities) ? lesson.activities : [];
  const homework = lesson.homework || {};
  const resolvedObjectives = objectives.length ? objectives : [
    `理解${context.topic}的核心概念与知识结构`,
    '能够运用所学方法分析典型问题',
    '通过练习与反馈形成迁移应用能力',
  ];
  const resolvedPoints = knowledgePoints.length ? knowledgePoints : [context.topic, '核心概念', '典型方法', '实践应用'];
  const bodySlides = [
    slide('学习目标', resolvedObjectives, '目标阶梯或能力达成路径图', `用可观察的学习结果说明本节课目标，突出${resolvedObjectives[0]}。`),
    slide('知识结构与学习路径', resolvedPoints.slice(0, 6), '知识图谱，标注前置关系与本节重点', `先呈现整体结构，再说明${resolvedPoints.slice(0, 3).join('、')}之间的关系。`),
    ...chapters.map((chapter, index) => slide(
      chapter.title || `核心内容 ${index + 1}`,
      [chapter.objective, ...(chapter.knowledgePoints || [])].filter(Boolean),
      `${chapter.title || context.topic}的结构示意图或真实案例图`,
      chapter.objective || `围绕${chapter.title || context.topic}进行概念讲解、案例分析和即时检查。`,
    )),
    ...activities.slice(0, 4).map((activity, index) => slide(
      activity.name || activity.stage || `课堂活动 ${index + 1}`,
      [activity.teacherAction, activity.studentAction, activity.designIntent].filter(Boolean),
      '课堂任务流程图或师生互动场景图',
      `建议用时 ${activity.duration || activity.minutes || 8} 分钟，组织学生先独立思考，再交流反馈。`,
    )),
    slide('课堂练习与形成性评价', ['概念辨析：判断关键条件', '典型任务：完成方法选择与过程分析', '即时反馈：根据答案定位薄弱知识点'], '一道典型题及分步作答区域', '先给学生独立作答时间，再展示分步提示；根据错误类型决定是否回讲。'),
  ];

  let fillerIndex = 0;
  while (bodySlides.length < context.pageCount - 2) {
    const point = resolvedPoints[fillerIndex % resolvedPoints.length];
    bodySlides.push(slide(
      `核心知识解析：${point}`,
      [`概念边界与适用条件`, `关键步骤与常见误区`, `结合${context.topic}完成迁移应用`],
      `${point}的对比图、流程图或可视化示例`,
      `围绕${point}按“定义、示例、辨析、应用”的顺序讲解，并安排一次即时提问。`,
    ));
    fillerIndex += 1;
  }

  const resultSlides = [
    slide(
      context.topic,
      [context.courseName, `${context.styleLabel}课件`, context.lessonPlan?.lessonType || '课堂教学设计'],
      '课程主题相关的清晰主视觉，保留标题可读区域',
      `开场说明本节课主题、课程位置和学习价值，控制在 1 分钟内。`,
    ),
    ...bodySlides.slice(0, context.pageCount - 2),
    slide(
      '总结与课后任务',
      [`回顾：${resolvedPoints.slice(0, 3).join('、')}`, text(homework.title, '完成分层巩固练习'), text(homework.requirements, '整理易错点并预习下一知识点')],
      '本节知识路线回顾图与课后任务清单',
      '邀请学生用自己的语言复述核心结论，说明课后任务标准和下一节课衔接内容。',
    ),
  ].map((item, index) => ({ pageNumber: index + 1, ...item }));

  return toPublicResult(pptRenderer.normalizeSlidesJson({
    title: `${context.topic}教学课件`,
    subtitle: `${context.courseName} · ${context.styleLabel}`,
    courseName: context.courseName,
    style: context.style,
    slides: resultSlides,
  }, { style: context.style, courseName: context.courseName }));
}

function providerConfig() {
  const apiKey = String(process.env.ALIYUN_API_KEY || process.env.BAILIAN_API_KEY || '').trim();
  const requestedProvider = String(process.env.PPT_GENERATION_PROVIDER || (apiKey ? 'aliyun-bailian' : 'demo')).trim().toLowerCase();
  return {
    apiKey,
    provider: requestedProvider,
    baseURL: String(process.env.PPT_GENERATION_BASE_URL || process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, ''),
    model: String(process.env.PPT_GENERATION_MODEL || process.env.BAILIAN_MODEL || 'qwen3.7-plus'),
    enabled: Boolean(apiKey) && !['demo', 'mock', 'disabled'].includes(requestedProvider),
  };
}

function parseJsonContent(content) {
  const source = text(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(source);
}

function normalizeGeneratedResult(value, context) {
  if (!value || !Array.isArray(value.slides) || value.slides.length !== context.pageCount) throw new Error('PPT 生成结果页数不完整');
  const model = pptRenderer.normalizeSlidesJson({
    ...value,
    title: text(value.title, `${context.topic}教学课件`),
    subtitle: text(value.subtitle, `${context.courseName} · ${context.styleLabel}`),
    courseName: context.courseName,
    style: context.style,
  }, { style: context.style, courseName: context.courseName });
  if (model.slides.some((item, index) => index > 0 && !item.bullets.length)) throw new Error('PPT 生成结果缺少页面要点');
  return toPublicResult(model);
}

async function generateWithProvider(context, config, signal) {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: Number(process.env.PPT_GENERATION_TIMEOUT_MS || 90000), maxRetries: 1 });
  const compactContext = JSON.stringify({
    topic: context.topic,
    courseName: context.courseName,
    style: context.styleLabel,
    pageCount: context.pageCount,
    syllabus: context.syllabus ? {
      title: context.syllabus.title,
      objectives: context.syllabus.objectives,
      requirements: context.syllabus.requirements,
      chapters: context.syllabus.chapters,
      knowledgePoints: context.syllabus.knowledge_points,
    } : null,
    lessonPlan: context.lessonPlan,
    suppliedKnowledgePoints: context.suppliedPoints,
    sourceText: context.sourceText,
  }).slice(0, 28000);
  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: '你是高校教师课件设计专家。只输出合法 JSON，不要输出 Markdown。内容使用简体中文，真实、准确、适合课堂与比赛演示。' },
      { role: 'user', content: `请生成恰好 ${context.pageCount} 页 PPT 结构。JSON 格式：{"title":"课件标题","subtitle":"副标题","slides":[{"page":1,"type":"cover或objectives或content或example或interaction或summary或homework","title":"页面标题","subtitle":"可选副标题","bullets":["3到5条要点"],"imagePrompt":"建议配图描述","imageUrl":"可选图片地址，没有则为空","notes":"讲解备注"}]}。封面为第1页，末页包含总结与课后任务。输入：${compactContext}` },
    ],
    temperature: 0.45,
    max_tokens: 7000,
    response_format: { type: 'json_object' },
    enable_thinking: false,
  }, signal ? { signal } : undefined);
  return normalizeGeneratedResult(parseJsonContent(completion.choices?.[0]?.message?.content), context);
}

function publicStatus(status) {
  return ({ QUEUED: 'queued', RUNNING: 'generating', WAITING_EXTERNAL: 'generating', SUCCEEDED: 'completed', FAILED: 'failed', CANCELLED: 'failed' })[status] || 'queued';
}

function serializeTask(task) {
  const metadata = task.metadataJson || {};
  const result = metadata.result || null;
  return {
    taskId: task.id,
    task_id: task.id,
    status: publicStatus(task.status),
    stage: task.stage,
    progress: task.progress || 0,
    provider: metadata.provider || 'demo',
    isDemo: Boolean(metadata.isDemo),
    notice: metadata.notice || null,
    title: result?.title || task.title,
    slides: result?.slides || [],
    downloadUrl: task.resultUrl || result?.downloadUrl || null,
    resultUrl: task.resultUrl || null,
    artifactId: Number(task.resultId || metadata.artifactId) || null,
    downloadStatus: task.resultUrl ? 'file_ready' : result ? 'outline_ready' : 'pending',
    errorMessage: task.errorMessage || null,
    createdAt: task.createdAt?.toISOString?.() || task.createdAt,
    completedAt: task.completedAt?.toISOString?.() || task.completedAt,
    message: task.status === 'SUCCEEDED' ? (metadata.isDemo ? '当前为演示生成结果，未配置真实外部生成接口；PPTX 文件已由本地渲染器生成' : 'PPTX 生成成功') : null,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function buildPreviewHtml(model, isDemo) {
  const pages = model.slides.map((item) => `<section><small>第 ${item.page} 页 · ${escapeHtml(item.type)}</small><h3>${escapeHtml(item.title)}</h3>${item.subtitle ? `<p>${escapeHtml(item.subtitle)}</p>` : ''}<ul>${item.bullets.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul><p><strong>讲解备注：</strong>${escapeHtml(item.notes)}</p></section>`).join('');
  return `<article class="ppt-artifact-preview"><header><h2>${escapeHtml(model.title)}</h2><p>${escapeHtml(model.subtitle)}</p>${isDemo ? '<em>当前为演示生成结果，已生成可下载的真实 PPTX 文件。</em>' : ''}</header>${pages}</article>`;
}

async function markTaskFailed(taskId, error) {
  await prisma.asyncTask.update({
    where: { id: taskId },
    data: {
      status: 'FAILED',
      stage: 'PPTX 文件生成失败',
      progress: 100,
      errorCode: String(error.code || 'PPTX_GENERATION_FAILED').slice(0, 100),
      errorMessage: String(error.message || 'PPTX 文件生成失败').slice(0, 1000),
      completedAt: new Date(),
    },
  }).catch(() => {});
}

async function generateNow(user, body = {}, signal) {
  const context = await loadGenerationContext(user, body);
  const config = providerConfig();
  const operationId = `ppt-${crypto.randomUUID()}`;
  const task = await prisma.asyncTask.create({
    data: {
      userId: user.user_id,
      operationId,
      taskType: 'FILE_GENERATION',
      title: `${context.topic} PPT 生成`,
      description: `根据${context.syllabus ? '教学大纲' : context.lessonPlan ? '教案' : '课程主题'}生成 ${context.pageCount} 页${context.styleLabel}课件结构`,
      // PPT 由当前请求内的专用流程持有；使用 WAITING_EXTERNAL 可避免通用
      // FILE_GENERATION Worker 将 PPT_STRUCTURE 误当成普通 Artifact 抢占。
      status: 'WAITING_EXTERNAL',
      stage: '正在生成 PPT 结构',
      progress: 15,
      progressMode: 'DETERMINATE',
      relatedResourceType: 'PPT_STRUCTURE',
      relatedResourceId: String(context.lessonPlanId || context.syllabusId || operationId),
      requestPayloadJson: {
        syllabusId: context.syllabusId,
        lessonPlanId: context.lessonPlanId,
        topic: context.topic,
        pageCount: context.pageCount,
        style: context.style,
        courseName: context.courseName,
        generationSource: context.generationSource,
        knowledgePoints: context.suppliedPoints,
        sourceText: context.sourceText,
      },
      metadataJson: { provider: config.enabled ? config.provider : 'mock', isDemo: !config.enabled },
      startedAt: new Date(),
    },
  });

  let result;
  let provider = config.enabled ? config.provider : 'mock';
  let isDemo = !config.enabled;
  let notice = isDemo ? '当前为演示生成结果，未配置真实外部生成接口' : null;
  let fallbackReason = null;
  let imageGeneration = { enabled: false, generated: 0, failed: 0, skipped: 0 };
  try {
    result = config.enabled ? await generateWithProvider(context, config, signal) : buildDemoResult(context);
  } catch (error) {
    if (signal?.aborted) {
      await markTaskFailed(task.id, Object.assign(new Error('PPT生成超过服务器允许的最长时间'), { code: 'PPT_GENERATION_TIMEOUT' }));
      throw Object.assign(new Error('PPT生成超时，请减少页数或稍后重试'), { code: 50002 });
    }
    console.error('[teacher-ppt.service] provider fallback:', error.message);
    result = buildDemoResult(context);
    provider = 'mock-fallback';
    isDemo = true;
    notice = '外部 PPT 服务暂不可用，当前为演示生成结果';
    fallbackReason = String(error.message || 'provider_error').slice(0, 300);
  }

  try {
    if (body.includeImages === true || body.include_images === true) {
      await prisma.asyncTask.update({ where: { id: task.id }, data: { stage: '正在生成 PPT 配图', progress: 55 } });
      const enriched = await imageGenerateService.enrichSlides(result, { userId: user.user_id, signal });
      result = enriched.model;
      imageGeneration = { enabled: enriched.enabled, generated: enriched.generated, failed: enriched.failed, skipped: enriched.skipped };
      if (!enriched.enabled) notice = [notice, '图片生成服务未配置，已保留教学配图占位区'].filter(Boolean).join('；');
      else if (enriched.failed) notice = [notice, `${enriched.failed} 页配图生成失败，已使用占位区`].filter(Boolean).join('；');
    }
    if (signal?.aborted) throw Object.assign(new Error('PPT生成超时，请减少页数或稍后重试'), { code: 'PPT_GENERATION_TIMEOUT' });
    const model = pptRenderer.normalizeSlidesJson(result, { style: context.style, courseName: context.courseName });
    result = toPublicResult(model);
    await prisma.asyncTask.update({ where: { id: task.id }, data: { stage: '正在渲染 PPTX 文件', progress: 70 } });
    const rendered = await pptRenderer.renderTeachingPptx(model, {
      style: context.style,
      courseName: context.courseName,
      teacherName: text(user.real_name ?? user.nickname ?? user.username, 'DisciMind 教师'),
      outputDir: path.join(pptRenderer.ARTIFACT_STORAGE_ROOT, String(user.user_id), 'ppt'),
      fileName: `${model.title}-${Date.now()}.pptx`,
      includeNotes: true,
    });
    const artifact = await prisma.generatedArtifact.create({
      data: {
        ownerUserId: Number(user.user_id),
        lessonPlanId: context.lessonPlanId,
        taskId: task.id,
        operationId,
        artifactType: 'TEACHING_PPT',
        title: model.title.slice(0, 200),
        description: `根据${context.syllabus ? '教学大纲' : context.lessonPlan ? '教案' : context.generationSource === 'text' ? '文本内容' : '课程主题'}生成的 ${model.slides.length} 页${context.styleLabel}课件`,
        courseId: context.courseId,
        knowledgePointIdsJson: [],
        requirementsJson: {
          sourceType: context.generationSource,
          syllabusId: context.syllabusId,
          lessonPlanId: context.lessonPlanId,
          topic: context.topic,
          courseName: context.courseName,
          pageCount: model.slides.length,
          style: context.style,
          knowledgePoints: context.suppliedPoints,
          provider,
          isDemo,
        },
        contentSchemaJson: model,
        previewHtml: buildPreviewHtml(model, isDemo),
        fileFormat: 'PPTX',
        storagePath: rendered.storagePath,
        fileName: rendered.fileName,
        mimeType: rendered.mimeType,
        fileSizeBytes: BigInt(rendered.fileSizeBytes),
        checksum: rendered.checksum,
        status: 'READY',
        generator: String(provider || 'demo').slice(0, 64),
        metadataJson: {
          ppt: { style: context.style, slideCount: model.slides.length, includeNotes: true },
          imageGeneration,
          providerModel: isDemo ? null : config.model,
          notice,
          fallbackReason,
        },
      },
    });
    const downloadUrl = `${String(process.env.PPT_PUBLIC_BASE_URL || '/api/generated-artifacts').replace(/\/$/, '')}/${artifact.id}/download`;
    result = { ...result, artifactId: artifact.id, downloadUrl, fileName: rendered.fileName, fileSizeBytes: rendered.fileSizeBytes };
    const completed = await prisma.asyncTask.update({
      where: { id: task.id },
      data: {
        status: 'SUCCEEDED',
        stage: 'PPTX 文件已生成',
        progress: 100,
        resultType: 'GENERATED_ARTIFACT',
        resultId: String(artifact.id),
        resultUrl: downloadUrl,
        metadataJson: { provider, providerModel: isDemo ? null : config.model, isDemo, notice, fallbackReason, imageGeneration, artifactId: artifact.id, result },
        completedAt: new Date(),
      },
    });
    return serializeTask(completed);
  } catch (error) {
    console.error('[teacher-ppt.service] pptx generation failed:', error.message);
    await markTaskFailed(task.id, error);
    throw Object.assign(new Error(`PPT 内容已生成，但 PPTX 文件生成失败：${error.message || '请稍后重试'}`), { code: error.code || 50003, status: 500 });
  }
}

async function generate(user, body = {}) {
  const release = await acquirePptGenerationSlot(user.user_id);
  const controller = new AbortController();
  const timeoutMs = Math.max(60_000, Number(process.env.PPT_GENERATION_TOTAL_TIMEOUT_MS || 10 * 60_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await generateNow(user, body, controller.signal);
  } finally {
    clearTimeout(timer);
    release();
  }
}

async function getTask(user, taskId) {
  const id = optionalId(taskId, 'taskId');
  const task = await prisma.asyncTask.findFirst({
    where: { id, userId: user.user_id, relatedResourceType: 'PPT_STRUCTURE' },
  });
  if (!task) throw Object.assign(new Error('PPT 生成任务不存在'), { code: 40002 });
  return serializeTask(task);
}

async function recoverInterruptedTasks(cutoff = new Date()) {
  const interrupted = await prisma.asyncTask.findMany({
    where: {
      relatedResourceType: 'PPT_STRUCTURE',
      status: 'WAITING_EXTERNAL',
      updatedAt: { lt: cutoff },
    },
    select: { id: true, metadataJson: true },
  });
  let recovered = 0;
  let failed = 0;
  for (const task of interrupted) {
    const artifact = await prisma.generatedArtifact.findFirst({
      where: { taskId: task.id, status: 'READY', deletedAt: null },
      orderBy: { id: 'desc' },
    });
    if (artifact) {
      const downloadUrl = `/api/generated-artifacts/${artifact.id}/download`;
      const model = artifact.contentSchemaJson || {};
      const result = Array.isArray(model.slides)
        ? toPublicResult(model, {
          artifactId: artifact.id,
          downloadUrl,
          fileName: artifact.fileName,
          fileSizeBytes: artifact.fileSizeBytes == null ? null : Number(artifact.fileSizeBytes),
        })
        : null;
      const updated = await prisma.asyncTask.updateMany({
        where: { id: task.id, status: 'WAITING_EXTERNAL' },
        data: {
          status: 'SUCCEEDED',
          stage: 'PPTX 文件已生成（启动恢复）',
          progress: 100,
          resultType: 'GENERATED_ARTIFACT',
          resultId: String(artifact.id),
          resultUrl: downloadUrl,
          metadataJson: { ...(task.metadataJson || {}), artifactId: artifact.id, ...(result ? { result } : {}), recoveredAtStartup: true },
          completedAt: new Date(),
        },
      });
      recovered += updated.count;
      continue;
    }
    const updated = await prisma.asyncTask.updateMany({
      where: { id: task.id, status: 'WAITING_EXTERNAL' },
      data: {
        status: 'FAILED',
        stage: 'PPT生成被服务重启中断',
        progress: 100,
        errorCode: 'PPT_GENERATION_INTERRUPTED',
        errorMessage: 'PPT生成曾被服务重启中断，可以重新生成；已完成的其他学习资料不会丢失。',
        completedAt: new Date(),
      },
    });
    failed += updated.count;
  }
  return { scanned: interrupted.length, recovered, failed };
}

module.exports = { generate, getTask, buildDemoResult, acquirePptGenerationSlot, recoverInterruptedTasks };
