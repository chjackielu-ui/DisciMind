const crypto = require('crypto');
const prisma = require('../config/prisma');
const tasks = require('../modules/async-task/async-task.service');
const fileGeneration = require('../modules/file-generator/file-generation.service');
const documentExport = require('../modules/file-generator/document-export.service');
const { examPaperSchema, studyHandoutSchema } = require('../modules/file-generator/file-content.schemas');
const learningCards = require('../modules/learning-card/learning-card.service');
const cardProtocol = require('../modules/learning-card/learning-card.protocol');
const { learningCardSchema } = require('../modules/learning-card/learning-card.schemas');
const aiArtifacts = require('../modules/ai-assistant/artifact.service');
const learningMedia = require('./student-learning-media.service');

const PACKAGE_KIND = 'KNOWLEDGE_RESOURCE_PACKAGE';
const PACKAGE_RESOURCE_TYPE = 'KNOWLEDGE_RESOURCE_PACKAGE';
const RESOURCE_ORDER = ['handout', 'ppt', 'cards', 'exam', 'video'];
const packageCreationLocks = new Map();
const RESOURCE_LABELS = Object.freeze({
  handout: '个性化讲义',
  ppt: '个性化PPT',
  cards: '知识点卡片',
  exam: '自适应试卷',
  video: '知识点讲解视频',
});

function packageError(message, code = 40001, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function positiveId(value, field) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw packageError(`${field} 参数不合法`);
  return id;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('学习资源包生成已取消'), { name: 'AbortError', code: 'RESOURCE_PACKAGE_CANCELLED' });
}

function initialResources() {
  return Object.fromEntries(RESOURCE_ORDER.map((key) => [key, {
    key,
    label: RESOURCE_LABELS[key],
    status: 'pending',
    artifactId: null,
    taskId: null,
    errorMessage: null,
  }]));
}

function safeOperationId(value) {
  const operationId = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(operationId)) return crypto.randomUUID();
  return operationId;
}

async function loadContext(user, courseIdValue, knowledgePointIdValue) {
  const userId = positiveId(user?.user_id, 'userId');
  const courseId = positiveId(courseIdValue, 'courseId');
  const knowledgePointId = positiveId(knowledgePointIdValue, 'knowledgePointId');
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: userId, course_id: courseId, enrollment_status: 'active' },
    include: { course: true },
  });
  if (!enrollment) throw packageError('未加入该课程或课程不存在', 40301, 403);
  const knowledgePoint = await prisma.knowledgePoint.findFirst({
    where: { knowledge_point_id: knowledgePointId, course_id: courseId },
    include: { chapter: true },
  });
  if (!knowledgePoint) throw packageError('知识点不存在或不属于当前课程', 40301, 403);
  const mastery = await prisma.studentMasteryRecord.findUnique({
    where: {
      student_user_id_course_id_knowledge_point_id: {
        student_user_id: userId,
        course_id: courseId,
        knowledge_point_id: knowledgePointId,
      },
    },
  }).catch(() => null);
  return {
    userId,
    user: { user_id: userId, role: 'student', username: user.username, real_name: user.real_name },
    courseId,
    courseName: enrollment.course.course_name,
    knowledgePointId,
    knowledgePointName: knowledgePoint.knowledge_point_name,
    knowledgePointDescription: String(knowledgePoint.description || '').trim(),
    chapterName: knowledgePoint.chapter?.chapter_name || null,
    masteryScore: mastery?.mastery_score == null ? null : Number(mastery.mastery_score),
  };
}

function buildDocumentRequirements(type, context) {
  const common = {
    artifactType: type,
    courseId: context.courseId,
    courseName: context.courseName,
    knowledgePointIds: [context.knowledgePointId],
    knowledgePointNames: [context.knowledgePointName],
    difficulty: context.masteryScore != null && context.masteryScore < 60 ? 'BASIC' : 'INTERMEDIATE',
    outputFormats: ['DOCX'],
    generationStyle: '结构清晰、概念准确、围绕单个知识点并适合当前学生学习阶段',
  };
  if (type === 'EXAM_PAPER') return {
    ...common,
    title: `${context.knowledgePointName}自适应练习试卷`,
    examType: 'QUIZ',
    questionCount: 8,
    totalScore: 100,
    duration: 45,
    questionTypes: [
      { type: 'SINGLE_CHOICE', count: 5, score: 8 },
      { type: 'SHORT_ANSWER', count: 3, score: 20 },
    ],
    includeAnswers: false,
    includeAnalysis: false,
    includeAnswerSheet: false,
    specialRequirements: '只考查当前单一知识点，题目由基础理解逐步过渡到应用，不在学生试卷中泄露答案。',
  };
  return {
    ...common,
    title: `${context.knowledgePointName}个性化学习讲义`,
    targetAudience: '本科生',
    handoutLength: 'MEDIUM',
    learningObjectives: [
      `准确解释${context.knowledgePointName}的核心概念`,
      `能够使用${context.knowledgePointName}解决一个典型问题`,
      `识别${context.knowledgePointName}的常见误区`,
    ],
    includeExamples: true,
    includeExercises: true,
    includeAnswers: false,
    specialRequirements: context.masteryScore == null
      ? '围绕单一知识点生成，包含原理、例子、误区和自测。'
      : `参考学生当前约 ${Math.round(context.masteryScore)}% 的掌握度调整解释层次，但不得虚构其他学习数据。`,
  };
}

function fallbackHandoutContent(context, requirements) {
  const description = context.knowledgePointDescription || `${context.knowledgePointName}是${context.courseName}课程中的核心知识点。`;
  return studyHandoutSchema.parse({
    title: requirements.title,
    course: context.courseName,
    knowledgePoints: [context.knowledgePointName],
    learningObjectives: requirements.learningObjectives,
    prerequisites: [`复习${context.chapterName || context.courseName}中的基础概念与术语。`],
    sections: [
      { id: 'S1', title: '核心概念', content: [description, `学习${context.knowledgePointName}时，应同时说明研究对象、成立条件和作用。`] },
      { id: 'S2', title: '分析步骤', content: ['先识别题目给出的条件，再选择对应概念或方法，最后检查结论是否符合原始条件。', `遇到应用问题时，用“已知条件 - ${context.knowledgePointName}方法 - 推导过程 - 结果解释”的顺序作答。`] },
      { id: 'S3', title: '巩固与迁移', content: [`用自己的语言复述${context.knowledgePointName}，并举出一个符合条件的例子。`, '改变例子中的一个条件，判断原结论是否仍然成立。'] },
    ],
    examples: [{ title: '四步分析示例', content: `针对一个${context.knowledgePointName}问题，依次写出已知条件、采用的方法、得到的结果以及结果含义。` }],
    keyPoints: ['概念必须和成立条件一起理解。', '推导过程要能对应题目给出的条件。', '结论需要通过反例或边界条件检查。'],
    commonMistakes: ['只记结论而忽略适用条件。', '混淆相邻概念，未说明选择当前方法的理由。', '得到结果后没有检查其含义和合理性。'],
    practice: [
      { question: `请用自己的语言解释${context.knowledgePointName}，并说明它解决什么问题。`, answer: description, analysis: '答案应包含概念对象、核心作用和至少一个成立条件。' },
      { question: `请给出一个${context.knowledgePointName}的应用场景，并按四步分析法说明。`, answer: '答案应依次包含已知条件、方法选择、分析过程和结果解释。', analysis: '重点检查方法是否与条件匹配，以及结论是否可以解释。' },
    ],
    principles: [description, `使用${context.knowledgePointName}前必须先确认适用条件，使用后必须检查结果。`],
    references: [`系统课程数据：${context.courseName} / ${context.chapterName || '课程知识点'} / ${context.knowledgePointName}`],
    summary: [`掌握${context.knowledgePointName}需要做到：能解释、会分析、可举例、能辨错。`],
    sourceNotice: 'AI 增强服务暂不可用，本基础讲义依据系统课程与知识点数据生成，请结合课程教材核验。',
  });
}

function fallbackExamContent(context, requirements) {
  const description = context.knowledgePointDescription || `${context.knowledgePointName}是${context.courseName}课程中的核心知识点。`;
  const choiceDefs = [
    ['学习该知识点时最先需要确认的是', ['研究对象与成立条件', '页面配色', '文件名称', '学习设备型号'], 'A', '概念学习首先要明确对象、条件与作用。'],
    ['分析相关问题时，较合理的步骤是', ['先猜结论再补条件', '识别条件、选择方法、推导并检查', '只记录最终结果', '忽略边界情况'], 'B', '完整分析需要从条件出发，并对结果进行检查。'],
    ['判断结论是否合理时，应重点检查', ['字体大小', '适用条件与结果含义', '题目长度', '答案格式'], 'B', '结论必须满足原始条件，并能够解释问题。'],
    ['复习该知识点的有效方式是', ['只背标题', '只看一次例题', '解释概念、完成练习并复盘误区', '跳过条件直接套用'], 'C', '解释、练习与复盘共同构成可验证的学习闭环。'],
    ['遇到相邻概念容易混淆时，应当', ['比较研究对象、条件和作用', '任选一个概念使用', '忽略差异', '只记缩写'], 'A', '通过对象、条件和作用进行对比可以减少概念混用。'],
  ];
  const questions = choiceDefs.map((item, index) => ({
    id: `Q${index + 1}`, type: 'SINGLE_CHOICE', stem: `关于“${context.knowledgePointName}”，${item[0]}？`, options: item[1], answer: item[2], analysis: item[3], score: 8,
    knowledgePoint: context.knowledgePointName, difficulty: 'BASIC',
  }));
  questions.push(
    { id: 'Q6', type: 'SHORT_ANSWER', stem: `请根据课程数据解释${context.knowledgePointName}的核心含义。`, options: [], answer: description, analysis: '应围绕系统知识点描述作答，不扩展未经课程数据支持的结论。', score: 20, knowledgePoint: context.knowledgePointName, difficulty: 'BASIC' },
    { id: 'Q7', type: 'SHORT_ANSWER', stem: `分析${context.knowledgePointName}问题时，为什么要同时说明适用条件和结果含义？`, options: [], answer: '适用条件决定方法能否使用，结果含义用于判断推导是否解决了原问题。', analysis: '答案需建立条件、方法与结果之间的逻辑关系。', score: 20, knowledgePoint: context.knowledgePointName, difficulty: 'BASIC' },
    { id: 'Q8', type: 'SHORT_ANSWER', stem: `请设计一个${context.knowledgePointName}的学习示例，并按“条件、方法、过程、结论”说明。`, options: [], answer: '示例应包含明确条件、匹配的方法、可检查的过程和能够解释的结论。', analysis: '按四步结构检查答案是否完整。', score: 20, knowledgePoint: context.knowledgePointName, difficulty: 'BASIC' },
  );
  return examPaperSchema.parse({
    title: requirements.title,
    course: context.courseName,
    knowledgePoints: [context.knowledgePointName],
    difficulty: 'BASIC',
    duration: requirements.duration,
    totalScore: requirements.totalScore,
    instructions: ['请独立完成全部题目。', '选择题每题 8 分，简答题每题 20 分，满分 100 分。'],
    sections: [
      { id: 'S1', title: '单项选择题', questionIds: questions.slice(0, 5).map((item) => item.id) },
      { id: 'S2', title: '简答题', questionIds: questions.slice(5).map((item) => item.id) },
    ],
    questions,
    answers: questions.map((item) => ({ questionId: item.id, answer: item.answer })),
    analysis: questions.map((item) => ({ questionId: item.id, analysis: item.analysis })),
    sourceNotice: 'AI 增强服务暂不可用，本基础试卷依据系统课程与知识点数据生成，题目用于自测，请结合课程教材核验。',
  });
}

function isDocumentModelUnavailable(error) {
  return ['CONTENT_MODEL_CALL_FAILED', 'CONTENT_SCHEMA_REPAIR_FAILED'].includes(String(error?.code || ''));
}

async function persistFallbackDocument(artifact, type, context, requirements) {
  const content = type === 'EXAM_PAPER'
    ? fallbackExamContent(context, requirements)
    : fallbackHandoutContent(context, requirements);
  return prisma.generatedArtifact.update({
    where: { id: artifact.id },
    data: {
      contentSchemaJson: content,
      previewHtml: fileGeneration.renderPreview(type, content, artifact.artifactRole, requirements),
      status: 'CONTENT_READY',
      errorCode: null,
      metadataJson: { ...(artifact.metadataJson || {}), fallback: true, fallbackReason: 'model_unavailable' },
    },
  });
}

async function generateDocument(task, kind, type, context, signal) {
  const operationId = `resource-package-${task.id}-${kind}`.slice(0, 64);
  let artifact = await prisma.generatedArtifact.findFirst({
    where: { ownerUserId: context.userId, operationId, deletedAt: null },
    orderBy: { id: 'desc' },
  });
  if (!artifact) {
    const requirements = buildDocumentRequirements(type, context);
    artifact = await prisma.generatedArtifact.create({
      data: {
        ownerUserId: context.userId,
        operationId,
        artifactType: type,
        artifactRole: type === 'EXAM_PAPER' ? 'STUDENT_PAPER' : 'PRIMARY',
        title: requirements.title,
        description: `${context.knowledgePointName}个性化单知识点学习资源包中的${RESOURCE_LABELS[kind]}`,
        courseId: context.courseId,
        knowledgePointIdsJson: [context.knowledgePointId],
        requirementsJson: requirements,
        fileFormat: 'DOCX',
        status: 'GENERATING',
        generator: 'resource-package',
        metadataJson: { packageTaskId: task.id, packageResource: kind },
      },
    });
  }
  assertNotAborted(signal);
  if (!artifact.contentSchemaJson || !['CONTENT_READY', 'READY'].includes(artifact.status)) {
    try {
      artifact = await fileGeneration.generateArtifact(artifact.id, { queueDefaultExport: false, signal });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || !isDocumentModelUnavailable(error)) throw error;
      artifact = await persistFallbackDocument(artifact, type, context, buildDocumentRequirements(type, context));
    }
  }
  assertNotAborted(signal);
  if (!artifact.storagePath || artifact.status !== 'READY') artifact = await documentExport.exportArtifact(artifact.id, { signal });
  return {
    artifactId: artifact.id,
    status: 'ready',
    fileName: artifact.fileName || `${artifact.title}.docx`,
    fileFormat: 'DOCX',
    downloadUrl: `/api/generated-artifacts/${artifact.id}/download`,
    fallback: Boolean(artifact.metadataJson?.fallback),
    warning: artifact.metadataJson?.fallback ? 'AI 增强暂不可用，已生成基于系统课程数据的基础版本。' : null,
  };
}

function fallbackCards(context) {
  const description = context.knowledgePointDescription || `${context.knowledgePointName}是${context.courseName}课程中的一个核心知识点。`;
  const source = [{
    type: 'KNOWLEDGE_POINT',
    id: context.knowledgePointId,
    title: context.knowledgePointName,
    excerpt: description.slice(0, 1000),
    url: null,
  }];
  const definitions = [
    ['concept', '核心概念', description, `先用自己的话解释“${context.knowledgePointName}”，再核对它解决的问题、输入条件与输出结果。`],
    ['formula', '原理与条件', `学习${context.knowledgePointName}时，结论必须和成立条件一起理解。`, '记录关键符号或步骤的含义，并检查每一步使用了什么前提。'],
    ['example', '应用示例', `把${context.knowledgePointName}放入一个具体问题中，按“已知条件—方法—结果—解释”四步分析。`, '尝试替换一个条件，观察方法或结论是否仍然成立。'],
    ['pitfall', '常见误区', `不要只背结论，也不要把${context.knowledgePointName}与相邻概念混用。`, '重点检查适用范围、变量含义、计算顺序以及结果能否解释。'],
    ['review', '自测清单', `完成学习后，应能解释概念、复现步骤、举出例子并识别误区。`, `自测：${context.knowledgePointName}是什么？何时使用？如何判断结果是否合理？`],
  ];
  return definitions.map(([cardType, suffix, summary, content], index) => {
    const migrated = cardProtocol.legacyToLearningCard({
      id: `lc_pkg_${context.userId}_${context.knowledgePointId}_${index + 1}`,
      scope: 'personalized',
      cardType,
      title: `${context.knowledgePointName}·${suffix}`,
      summary,
      courseId: context.courseId,
      courseName: context.courseName,
      knowledgePointId: context.knowledgePointId,
      knowledgePointName: context.knowledgePointName,
      chapterName: context.chapterName,
      difficulty: context.masteryScore != null && context.masteryScore < 60 ? 'basic' : 'medium',
      personalizedReason: context.masteryScore == null
        ? '依据当前课程和所选单一知识点生成。'
        : `结合本人当前约 ${Math.round(context.masteryScore)}% 的掌握度生成。`,
      sections: [{ type: 'text', title: suffix, content }],
      sourceRefs: source,
    }, { courseName: context.courseName, model: 'resource-package-rule', promptVersion: 'resource-package-fallback-v1' });
    return learningCardSchema.parse({
      ...migrated,
      generator: { model: 'resource-package-rule', promptVersion: 'resource-package-fallback-v1', knowledgeBaseVersion: null, generationMode: 'RULE' },
    });
  });
}

async function persistFallbackCards(context, cards, taskId) {
  for (const card of cards) {
    const data = cardProtocol.persistenceData(card, {
      ownerUserId: context.userId,
      contextVersion: `resource-package:${taskId}`,
      personalizationVersion: String(context.masteryScore ?? 'unknown'),
    });
    const { id, ...update } = data;
    await prisma.learningCard.upsert({ where: { id }, create: data, update });
  }
  const operationId = `resource-package-${taskId}-cards`.slice(0, 64);
  const existing = await prisma.generatedArtifact.findFirst({
    where: { ownerUserId: context.userId, operationId, artifactType: 'KNOWLEDGE_CARDS', deletedAt: null },
    orderBy: { id: 'desc' },
  });
  if (existing) return existing;
  return aiArtifacts.createCards({ user: context.user, courseId: context.courseId }, {
    operationId,
    title: `${context.knowledgePointName}知识点卡片`,
    description: `个性化单知识点学习资源包 · ${cards.length} 张规则降级卡片`,
    cards,
    knowledgePointIds: [context.knowledgePointId],
    requirements: { source: 'resource-package-fallback', schemaVersion: '1.0' },
    metadata: { kind: 'learning_cards', packageTaskId: taskId, fallback: true, cardIds: cards.map((card) => card.id) },
  });
}

async function generateCards(task, context, signal) {
  try {
    const generated = await learningCards.generateCardsArtifact(context.user, {
      topic: context.knowledgePointName,
      title: `${context.knowledgePointName}知识点卡片`,
      courseId: context.courseId,
      knowledgePointId: context.knowledgePointId,
      cardTypes: ['CONCEPT', 'FORMULA', 'EXAMPLE', 'PITFALL', 'REVIEW'],
      count: 5,
      learningGoal: `系统理解并能应用${context.knowledgePointName}`,
      includeChart: true,
    }, { signal });
    return {
      artifactId: generated.artifact.id,
      status: 'ready',
      cardCount: generated.cards.length,
      cardIds: generated.cards.map((card) => card.id),
      fallback: false,
    };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    console.warn('[resource-package] knowledge cards fallback', { taskId: task.id, code: error.code || error.name });
    const cards = fallbackCards(context);
    const artifact = await persistFallbackCards(context, cards, task.id);
    return {
      artifactId: artifact.id,
      status: 'ready',
      cardCount: cards.length,
      cardIds: cards.map((card) => card.id),
      fallback: true,
      warning: 'AI卡片增强暂不可用，已生成可学习的规则卡片。',
    };
  }
}

function safeResource(resource, key) {
  const value = resource || {};
  const rawError = value.errorMessage ? String(value.errorMessage) : '';
  const errorMessage = /(?:Invalid `?prisma\.|PrismaClient|[A-Z]:[\\/]|node_modules[\\/]|\bat\s+\S+\s*\()/i.test(rawError)
    ? `${RESOURCE_LABELS[key]}生成失败，可以稍后重新生成。`
    : rawError.slice(0, 500) || null;
  return {
    key,
    label: RESOURCE_LABELS[key],
    status: String(value.status || 'pending'),
    artifactId: Number(value.artifactId) || null,
    taskId: Number(value.taskId) || null,
    videoTaskId: Number(value.videoTaskId) || null,
    fileName: value.fileName ? String(value.fileName).slice(0, 255) : null,
    fileFormat: value.fileFormat ? String(value.fileFormat).slice(0, 16) : null,
    downloadUrl: value.downloadUrl && /^\/api\//.test(String(value.downloadUrl)) ? String(value.downloadUrl) : null,
    cardCount: Number(value.cardCount) || 0,
    cardIds: Array.isArray(value.cardIds) ? value.cardIds.map(String).slice(0, 20) : [],
    fallback: Boolean(value.fallback),
    warning: value.warning ? String(value.warning).slice(0, 500) : null,
    errorMessage,
  };
}

function publicStatus(task, videoState) {
  if (task.status === 'FAILED') return 'failed';
  if (['QUEUED', 'RUNNING'].includes(task.status)) return 'generating';
  if (task.metadataJson?.packageStatus === 'PARTIAL') return 'partial';
  if (videoState === 'success' || task.metadataJson?.packageStatus === 'COMPLETED') return 'completed';
  if (videoState === 'ready') return 'video_ready';
  return 'generating';
}

async function serializePackage(task, options = {}) {
  const metadata = task.metadataJson || {};
  const resources = { ...initialResources(), ...(metadata.resources || {}) };
  const pptArtifactId = Number(resources.ppt?.artifactId);
  const pptArtifact = pptArtifactId ? await prisma.generatedArtifact.findFirst({
    where: { id: pptArtifactId, ownerUserId: task.userId, deletedAt: null },
    select: { id: true, title: true, contentSchemaJson: true, fileName: true, metadataJson: true },
  }) : null;
  let videoTask = options.videoTask;
  const videoTaskId = Number(resources.video?.videoTaskId);
  if (videoTask === undefined && videoTaskId) {
    videoTask = await learningMedia.getVideoTask({ user_id: task.userId, role: 'student' }, videoTaskId).catch((error) => ({ status: 'failed', errorMessage: error.message }));
  }
  if (videoTask) {
    const videoDownloadUrl = videoTask.resultUrl || resources.video.downloadUrl;
    resources.video = {
      ...resources.video,
      status: videoTask.status === 'success' ? 'ready' : videoTask.status,
      taskId: videoTask.taskId || resources.video.taskId,
      resultUrl: videoDownloadUrl,
      downloadUrl: /^\/api\//.test(String(videoDownloadUrl || '')) ? videoDownloadUrl : resources.video.downloadUrl,
      fileFormat: videoTask.status === 'success' ? 'MP4' : resources.video.fileFormat,
      errorMessage: videoTask.errorMessage || resources.video.errorMessage,
    };
  }
  const publicResources = RESOURCE_ORDER.map((key) => safeResource(resources[key], key));
  const readyCount = publicResources.filter((resource) => resource.status === 'ready').length;
  const failedCount = publicResources.filter((resource) => resource.status === 'failed').length;
  const baseProgress = Number(task.progress || 0);
  const progress = ['QUEUED', 'RUNNING'].includes(task.status)
    ? baseProgress
    : videoTask?.status === 'generating'
      ? Math.max(baseProgress, Math.min(94, 90 + Math.round(Number(videoTask.progress || 0) * 0.04)))
      : videoTask?.status === 'ready' ? Math.max(baseProgress, 95) : baseProgress;
  const stage = videoTask?.status === 'ready'
    ? (readyCount < RESOURCE_ORDER.length
      ? (failedCount
        ? `视频素材已就绪，已完成 ${readyCount}/5 类资料；失败项可重试，MP4仍可在浏览器渲染`
        : `视频素材已就绪，已完成 ${readyCount}/5 类资料；其余资料正在生成`)
      : '五类学习资料已齐备，请在浏览器中渲染并保存MP4')
    : task.stage;
  return {
    packageTaskId: task.id,
    kind: PACKAGE_KIND,
    status: publicStatus(task, videoTask?.status),
    stage,
    progress,
    readyCount,
    failedCount,
    courseId: Number(metadata.courseId),
    courseName: metadata.courseName || null,
    knowledgePointId: Number(metadata.knowledgePointId),
    knowledgePointName: metadata.knowledgePointName || null,
    resources: publicResources,
    ppt: pptArtifact ? {
      artifactId: pptArtifact.id,
      title: pptArtifact.title,
      slides: Array.isArray(pptArtifact.contentSchemaJson?.slides) ? pptArtifact.contentSchemaJson.slides : [],
      fileName: pptArtifact.fileName,
      notice: pptArtifact.metadataJson?.notice || resources.ppt?.notice || null,
    } : null,
    videoTask: videoTask || null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

async function updateResource(task, metadata, resources, key, patch, taskPatch = {}) {
  resources[key] = { ...resources[key], ...patch, key, label: RESOURCE_LABELS[key] };
  const nextMetadata = { ...metadata, resources };
  await tasks.updateTask(task.id, { ...taskPatch, metadataJson: nextMetadata });
  return nextMetadata;
}

async function runResource(task, metadata, resources, key, progress, stage, fn, signal) {
  assertNotAborted(signal);
  if (resources[key]?.status === 'ready') return { metadata, result: resources[key] };
  if (key === 'video' && resources.video?.status === 'generating' && resources.video?.videoTaskId) {
    return { metadata, result: resources.video };
  }
  metadata = await updateResource(task, metadata, resources, key, { status: 'generating', errorMessage: null }, {
    status: 'RUNNING', progress, stage,
  });
  try {
    const result = await fn();
    return { metadata: await updateResource(task, metadata, resources, key, { ...result, status: result.status || 'ready' }), result };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    const failed = { status: 'failed', errorMessage: String(error.userMessage || error.message || `${RESOURCE_LABELS[key]}生成失败`).slice(0, 500) };
    console.error('[resource-package] resource failed', { taskId: task.id, resource: key, code: error.code || error.name });
    return { metadata: await updateResource(task, metadata, resources, key, failed), result: failed };
  }
}

async function processPackageTask(task, signal) {
  const payload = task.requestPayloadJson || {};
  const context = await loadContext({ user_id: task.userId, role: 'student' }, payload.courseId, payload.knowledgePointId);
  let metadata = {
    kind: PACKAGE_KIND,
    courseId: context.courseId,
    courseName: context.courseName,
    knowledgePointId: context.knowledgePointId,
    knowledgePointName: context.knowledgePointName,
    packageStatus: 'GENERATING',
    resources: { ...initialResources(), ...(task.metadataJson?.resources || {}) },
  };
  const resources = metadata.resources;
  await tasks.updateTask(task.id, { status: 'RUNNING', stage: '正在生成个性化PPT', progress: 5, metadataJson: metadata });

  let outcome = await runResource(task, metadata, resources, 'ppt', 8, '正在生成个性化PPT与教学配图', async () => {
    const result = await learningMedia.createPpt(context.user, context.courseId, {
      topic: context.knowledgePointName,
      knowledgePointId: context.knowledgePointId,
      pageCount: Number(payload.pageCount || 8),
      style: 'teaching',
      includeImages: payload.includeImages !== false,
      learningPlanId: payload.learningPlanId || null,
    });
    return {
      artifactId: result.artifactId,
      taskId: result.taskId,
      fileName: result.fileName || `${result.title || context.knowledgePointName}.pptx`,
      fileFormat: 'PPTX',
      downloadUrl: result.artifactId ? `/api/generated-artifacts/${result.artifactId}/download` : null,
      notice: result.notice || null,
    };
  }, signal);
  metadata = outcome.metadata;

  outcome = await runResource(task, metadata, resources, 'handout', 34, '正在生成详细讲义', () => generateDocument(task, 'handout', 'STUDY_HANDOUT', context, signal), signal);
  metadata = outcome.metadata;

  outcome = await runResource(task, metadata, resources, 'cards', 54, '正在生成知识点卡片', () => generateCards(task, context, signal), signal);
  metadata = outcome.metadata;

  outcome = await runResource(task, metadata, resources, 'exam', 70, '正在生成自适应试卷', () => generateDocument(task, 'exam', 'EXAM_PAPER', context, signal), signal);
  metadata = outcome.metadata;

  if (resources.ppt?.artifactId) {
    outcome = await runResource(task, metadata, resources, 'video', 88, '正在创建详细讲稿与配音任务', async () => {
      const video = await learningMedia.createVideoTask(context.user, {
        pptArtifactId: resources.ppt.artifactId,
        courseId: context.courseId,
        knowledgePointId: context.knowledgePointId,
        style: 'focused-ppt-narration',
        scriptPrompt: `围绕单一知识点“${context.knowledgePointName}”生成详细讲解；逐条解释PPT概念，并为每个要点生成可同步的聚焦时间轴。`,
      });
      return { status: 'generating', videoTaskId: video.videoTaskId, taskId: video.taskId };
    }, signal);
    metadata = outcome.metadata;
  } else {
    metadata = await updateResource(task, metadata, resources, 'video', {
      status: 'failed', errorMessage: 'PPT未生成，无法继续准备视频。',
    });
  }

  const readyCount = RESOURCE_ORDER.filter((key) => resources[key]?.status === 'ready').length;
  const videoQueued = resources.video?.status === 'generating' && resources.video?.videoTaskId;
  if (!readyCount && !videoQueued) {
    throw Object.assign(new Error('五类学习资料均未生成成功'), {
      code: 'RESOURCE_PACKAGE_ALL_FAILED',
      userMessage: '学习资源服务暂时不可用，可以稍后重试。',
    });
  }
  metadata = {
    ...metadata,
    packageStatus: videoQueued ? 'WAITING_VIDEO' : (readyCount === RESOURCE_ORDER.length ? 'COMPLETED' : 'PARTIAL'),
    resources,
  };
  await tasks.updateTask(task.id, videoQueued ? {
    status: 'WAITING_EXTERNAL',
    stage: `已完成 ${readyCount}/5 类资料，视频讲稿与配音正在后台准备`,
    progress: 90,
    requiresUserAction: false,
    metadataJson: metadata,
    lockedBy: null,
    lockedAt: null,
  } : {
    status: 'SUCCEEDED',
    stage: readyCount === RESOURCE_ORDER.length ? '个性化学习资源包已完成' : `已完成 ${readyCount}/5 类资料，其余资源可稍后重试`,
    progress: 100,
    requiresUserAction: false,
    metadataJson: metadata,
  });
  return { waitingForVideo: Boolean(videoQueued), readyCount };
}

function activePackageLimit() {
  const configured = Number(process.env.RESOURCE_PACKAGE_ACTIVE_LIMIT_PER_USER || 1);
  return Number.isInteger(configured) ? Math.min(5, Math.max(1, configured)) : 1;
}

async function createPackageUnlocked(user, courseIdValue, knowledgePointIdValue, body = {}) {
  const context = await loadContext(user, courseIdValue, knowledgePointIdValue);
  const active = await prisma.asyncTask.findFirst({
    where: {
      userId: context.userId,
      relatedResourceType: PACKAGE_RESOURCE_TYPE,
      relatedResourceId: `${context.courseId}:${context.knowledgePointId}`,
      status: { in: tasks.ACTIVE_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (active) return serializePackage(active);
  const activeGenerationCount = await prisma.asyncTask.count({
    where: {
      userId: context.userId,
      relatedResourceType: PACKAGE_RESOURCE_TYPE,
      status: { in: ['QUEUED', 'RUNNING'] },
    },
  });
  if (activeGenerationCount >= activePackageLimit()) {
    throw packageError('已有学习资源包正在生成，请等待当前任务进入视频渲染阶段后再创建新的资源包', 40901, 409);
  }
  const operationId = safeOperationId(body.operationId || body.operation_id);
  const created = await tasks.createTask(context.userId, {
    operationId: `resource-package-${operationId}`,
    taskType: 'LEARNING_FLOW_PRELOAD',
    title: `${context.knowledgePointName}个性化学习资源包`,
    description: '串行生成讲义、PPT、知识点卡片、试卷与浏览器端讲解视频',
    status: 'QUEUED',
    stage: '等待生成五类学习资料',
    progressMode: 'DETERMINATE',
    progress: 0,
    relatedResourceType: PACKAGE_RESOURCE_TYPE,
    relatedResourceId: `${context.courseId}:${context.knowledgePointId}`,
    cancellable: true,
    maxAttempts: 2,
    dedupeKey: `resource-package:${context.courseId}:${context.knowledgePointId}`,
    metadataJson: {
      kind: PACKAGE_KIND,
      courseId: context.courseId,
      courseName: context.courseName,
      knowledgePointId: context.knowledgePointId,
      knowledgePointName: context.knowledgePointName,
      packageStatus: 'QUEUED',
      resources: initialResources(),
    },
    requestPayloadJson: {
      courseId: context.courseId,
      knowledgePointId: context.knowledgePointId,
      pageCount: [6, 8, 10, 12].includes(Number(body.pageCount)) ? Number(body.pageCount) : 8,
      includeImages: body.includeImages !== false,
      learningPlanId: body.learningPlanId || body.learning_plan_id || null,
    },
  });
  await tasks.updateTask(created.id, {
    resultType: PACKAGE_RESOURCE_TYPE,
    resultId: created.id,
    resultUrl: `#/student/courses/${context.courseId}?section=learning-media&packageId=${created.id}`,
  });
  const task = await prisma.asyncTask.findUnique({ where: { id: created.id } });
  return serializePackage(task);
}

function createPackage(user, courseIdValue, knowledgePointIdValue, body = {}) {
  const userId = positiveId(user?.user_id, 'userId');
  const lockKey = String(userId);
  const previous = packageCreationLocks.get(lockKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => createPackageUnlocked(user, courseIdValue, knowledgePointIdValue, body));
  packageCreationLocks.set(lockKey, current);
  return current.finally(() => {
    if (packageCreationLocks.get(lockKey) === current) packageCreationLocks.delete(lockKey);
  });
}

async function getPackage(user, taskIdValue) {
  const taskId = positiveId(taskIdValue, 'packageTaskId');
  const task = await prisma.asyncTask.findFirst({
    where: { id: taskId, userId: Number(user.user_id), relatedResourceType: PACKAGE_RESOURCE_TYPE },
  });
  if (!task) throw packageError('学习资源包任务不存在或无权访问', 40301, 403);
  if (!task.resultUrl) {
    await tasks.updateTask(task.id, {
      resultType: PACKAGE_RESOURCE_TYPE,
      resultId: task.id,
      resultUrl: `#/student/courses/${Number(task.metadataJson?.courseId)}?section=learning-media&packageId=${task.id}`,
    });
  }
  const resources = task.metadataJson?.resources || {};
  const videoTaskId = Number(resources.video?.videoTaskId);
  let videoTask = null;
  if (videoTaskId) videoTask = await learningMedia.getVideoTask(user, videoTaskId).catch((error) => ({ status: 'failed', errorMessage: error.message }));
  if (task.status === 'WAITING_EXTERNAL' && videoTask?.status === 'ready' && task.progress < 95) {
    const failedCount = RESOURCE_ORDER.filter((key) => resources[key]?.status === 'failed').length;
    const stage = failedCount
      ? `视频素材已就绪，已有 ${5 - failedCount}/5 类资料可用；失败项可重试，MP4仍可渲染`
      : '五类学习资料已齐备，请在浏览器中渲染并保存MP4';
    await tasks.updateTask(task.id, {
      stage,
      progress: 95,
      requiresUserAction: true,
      metadataJson: { ...task.metadataJson, packageStatus: failedCount ? 'WAITING_RENDER_PARTIAL' : 'WAITING_RENDER' },
    });
    task.stage = stage;
    task.progress = 95;
    task.metadataJson = { ...task.metadataJson, packageStatus: failedCount ? 'WAITING_RENDER_PARTIAL' : 'WAITING_RENDER' };
  } else if (task.status === 'WAITING_EXTERNAL' && videoTask?.status === 'failed') {
    const nextResources = {
      ...resources,
      video: { ...resources.video, status: 'failed', errorMessage: videoTask.errorMessage || '视频素材生成失败' },
    };
    await tasks.updateTask(task.id, {
      status: 'SUCCEEDED',
      stage: '其余四类资料已完成，视频生成失败，可单独重新生成',
      progress: 100,
      requiresUserAction: false,
      metadataJson: { ...task.metadataJson, packageStatus: 'PARTIAL', resources: nextResources },
    });
    task.status = 'SUCCEEDED';
    task.stage = '其余四类资料已完成，视频生成失败，可单独重新生成';
    task.progress = 100;
    task.metadataJson = { ...task.metadataJson, packageStatus: 'PARTIAL', resources: nextResources };
  }
  return serializePackage(task, { videoTask });
}

async function retryPackage(user, taskIdValue, body = {}) {
  const taskId = positiveId(taskIdValue, 'packageTaskId');
  const task = await prisma.asyncTask.findFirst({
    where: { id: taskId, userId: Number(user.user_id), relatedResourceType: PACKAGE_RESOURCE_TYPE },
  });
  if (!task) throw packageError('学习资源包任务不存在或无权访问', 40301, 403);
  if (['QUEUED', 'RUNNING'].includes(task.status)) throw packageError('学习资源包正在生成，无需重复提交重试', 40901, 409);
  if (task.status === 'CANCELLED') throw packageError('已取消的资源包不能局部重试，请重新创建', 40901, 409);

  const resources = { ...initialResources(), ...(task.metadataJson?.resources || {}) };
  const requested = Array.isArray(body.resources)
    ? [...new Set(body.resources.map((key) => String(key || '').trim().toLowerCase()).filter(Boolean))]
    : [];
  if (requested.some((key) => !RESOURCE_ORDER.includes(key))) throw packageError('包含不支持的资源类型');
  const retryKeys = (requested.length ? requested : RESOURCE_ORDER)
    .filter((key) => resources[key]?.status === 'failed');
  if (!retryKeys.length) throw packageError('当前没有可重试的失败资源', 40901, 409);

  for (const key of retryKeys) {
    resources[key] = {
      ...resources[key],
      status: 'pending',
      errorMessage: null,
      warning: null,
      ...(key === 'video' ? { taskId: null, videoTaskId: null, artifactId: null, downloadUrl: null } : {}),
    };
  }
  await tasks.updateTask(task.id, {
    status: 'QUEUED',
    stage: `等待重试：${retryKeys.map((key) => RESOURCE_LABELS[key]).join('、')}`,
    progress: 5,
    requiresUserAction: false,
    errorCode: null,
    errorMessage: null,
    attemptCount: 0,
    nextRunAt: new Date(),
    startedAt: null,
    completedAt: null,
    lockedBy: null,
    lockedAt: null,
    metadataJson: {
      ...(task.metadataJson || {}),
      packageStatus: 'RETRYING',
      resources,
      retriedResources: retryKeys,
      manuallyRetriedAt: new Date().toISOString(),
    },
  });
  return getPackage(user, task.id);
}

async function completePackageVideo(user, videoTaskIdValue, videoResult) {
  const videoTaskId = positiveId(videoTaskIdValue, 'videoTaskId');
  const candidates = await prisma.asyncTask.findMany({
    where: {
      userId: Number(user.user_id),
      relatedResourceType: PACKAGE_RESOURCE_TYPE,
      status: { in: ['WAITING_EXTERNAL', 'RUNNING', 'SUCCEEDED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const matched = candidates.filter((task) => Number(task.metadataJson?.resources?.video?.videoTaskId) === videoTaskId);
  for (const task of matched) {
    const resources = {
      ...task.metadataJson.resources,
      video: {
        ...task.metadataJson.resources.video,
        status: 'ready',
        artifactId: Number(videoResult.artifactId) || null,
        fileName: videoResult.fileName || null,
        fileFormat: 'MP4',
        downloadUrl: videoResult.resultUrl || `/api/student/videos/generated/${videoTaskId}/media`,
        errorMessage: null,
      },
    };
    const failedCount = RESOURCE_ORDER.filter((key) => resources[key]?.status === 'failed').length;
    await tasks.updateTask(task.id, {
      status: 'SUCCEEDED',
      stage: failedCount ? `学习资源包已完成，${failedCount} 类资料使用降级或需重试` : '个性化单知识点学习资源包已完成',
      progress: 100,
      requiresUserAction: false,
      metadataJson: { ...task.metadataJson, packageStatus: failedCount ? 'PARTIAL' : 'COMPLETED', resources },
    });
  }
  return { updated: matched.length };
}

module.exports = {
  PACKAGE_KIND,
  PACKAGE_RESOURCE_TYPE,
  RESOURCE_ORDER,
  RESOURCE_LABELS,
  initialResources,
  buildDocumentRequirements,
  fallbackHandoutContent,
  fallbackExamContent,
  isDocumentModelUnavailable,
  fallbackCards,
  serializePackage,
  createPackage,
  getPackage,
  retryPackage,
  processPackageTask,
  completePackageVideo,
};
