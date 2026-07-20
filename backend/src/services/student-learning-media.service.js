const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const teacherPptService = require('./teacher-ppt.service');
const pptRenderer = require('./teacher-ppt-renderer.service');
const { getBailianClient, mapBailianError } = require('./bailian-openai.service');
const { getLearningNarrationModule } = require('../modules/learning-narration');
const learningFlowResourceService = require('../modules/learning-flow-resource/learning-flow-resource.service');
const documentConversionService = require('./document-conversion.service');

const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;
const VIDEO_FPS = 24;
const MAX_VIDEO_MB = Math.max(20, Math.min(500, Number(process.env.GENERATED_VIDEO_MAX_MB || 120)));
const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;
const videoCreationLocks = new Map();
const videoCompletionLocks = new Map();

function mediaError(message, code = 40001, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function positiveId(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw mediaError(`${field} 参数不合法`);
  return parsed;
}

async function ensureStudentCourse(userId, courseId) {
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: Number(userId), course_id: Number(courseId), enrollment_status: 'active' },
    include: { course: true },
  });
  if (!enrollment) throw mediaError('未加入该课程或课程不存在', 40301, 403);
  return enrollment;
}

async function resolveKnowledgePoint(courseId, value) {
  if (value == null || value === '') return null;
  const id = positiveId(value, 'knowledgePointId');
  const point = await prisma.knowledgePoint.findFirst({ where: { knowledge_point_id: id, course_id: courseId } });
  if (!point) throw mediaError('知识点不存在或不属于当前课程', 40301, 403);
  return point;
}

async function publishPptAsLearningReference(user, enrollment, point, artifactId, learningPlanId) {
  const artifact = await prisma.generatedArtifact.findFirst({ where: { id: Number(artifactId), ownerUserId: Number(user.user_id), deletedAt: null } });
  if (!artifact) return null;
  const operationId = `student-ppt-reference-${artifact.id}`;
  const data = {
    title: `${artifact.title} · 学习流课件`, original_filename: artifact.fileName || `${artifact.title}.pptx`, file_ext: 'pptx',
    file_size_bytes: artifact.fileSizeBytes == null ? null : Number(artifact.fileSizeBytes), mime_type: artifact.mimeType || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    storage_type: 'LOCAL', file_url: `/generated-artifacts/${String(artifact.storagePath || '').replace(/^\/+/, '')}`, scope_type: 'CLASS', visibility: 'CLASS', course_id: enrollment.course_id,
    teaching_class_id: enrollment.teaching_class_id, source_artifact_id: artifact.id, owner_user_id: Number(user.user_id), is_teaching_resource: true,
    resource_kind: 'learning_ppt', resource_category: '学习流课件', metadata_json: { source: 'student_learning_flow', learningPlanId: learningPlanId || null, knowledgePointId: point?.knowledge_point_id || null, artifactId: artifact.id },
    resource_status: 'ACTIVE', parse_status: 'UPLOADED', review_status: 'APPROVED', marketplace_status: 'READY', processing_state: 'queued', operation_id: operationId,
  };
  const document = await prisma.knowledgeDocument.upsert({ where: { operation_id: operationId }, update: data, create: data });
  let link = null;
  if (learningPlanId) {
    link = await learningFlowResourceService.createLink(user, artifact.id, {
      learningPlanId: Number(learningPlanId), courseId: enrollment.course_id, knowledgePointId: point?.knowledge_point_id || null, resourceRole: 'REFERENCE_MATERIAL',
    });
  }
  let conversion = null;
  try { conversion = await documentConversionService.startConversion(user, document.document_id); }
  catch (error) { conversion = { status: 'failed', error_code: error.code || 'PPT_CONVERSION_FAILED', error_message: error.message }; }
  return { document_id: document.document_id, learning_flow_link: link, conversion };
}

async function createPpt(user, courseIdValue, body = {}) {
  const courseId = positiveId(courseIdValue, 'courseId');
  const enrollment = await ensureStudentCourse(user.user_id, courseId);
  const point = await resolveKnowledgePoint(courseId, body.knowledgePointId ?? body.knowledge_point_id);
  const topic = String(body.topic || point?.knowledge_point_name || enrollment.course.course_name).trim();
  const generated = await teacherPptService.generate(user, {
    topic,
    courseName: enrollment.course.course_name,
    knowledgePoints: point ? [point.knowledge_point_name] : (body.knowledgePoints || []),
    sourceText: body.sourceText || body.source_text || '',
    pageCount: body.pageCount || body.page_count || 8,
    style: body.style || 'teaching',
    generationSource: point ? 'knowledge-point' : 'student-course',
    includeImages: body.includeImages !== false && body.include_images !== false,
  });
  if (generated.artifactId) {
    await prisma.generatedArtifact.updateMany({
      where: { id: Number(generated.artifactId), ownerUserId: Number(user.user_id) },
      data: {
        artifactType: 'LEARNING_PPT',
        courseId,
        knowledgePointIdsJson: point ? [point.knowledge_point_id] : [],
        description: `学生根据${point ? `知识点“${point.knowledge_point_name}”` : `课程“${enrollment.course.course_name}”`}生成的个性化学习PPT`,
      },
    });
  }
  const reference = generated.artifactId
    ? await publishPptAsLearningReference(user, enrollment, point, generated.artifactId, body.learningPlanId || body.learning_plan_id)
    : null;
  return { ...generated, courseId, knowledgePointId: point?.knowledge_point_id || null, learningReference: reference };
}

async function getPptTask(user, taskId) {
  return teacherPptService.getTask(user, taskId);
}

function estimateDurationMs(text) {
  return Math.max(4_000, Math.min(90_000, Math.round(String(text || '').length * 180 + 1_800)));
}

function wavFromPcm(pcm, sampleRate, bitsPerSample = 16, channels = 1) {
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function subtitlesFor(text, durationMs) {
  const parts = String(text || '').match(/[^。！？；.!?]+[。！？；.!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [];
  const resolved = parts.length ? parts : [String(text || '').trim()].filter(Boolean);
  const total = resolved.reduce((sum, item) => sum + item.length, 0) || 1;
  let cursor = 0;
  return resolved.map((item, index) => {
    const length = index === resolved.length - 1 ? durationMs - cursor : Math.max(500, Math.round(durationMs * item.length / total));
    const subtitle = { startMs: cursor, endMs: Math.min(durationMs, cursor + length), text: item };
    cursor = subtitle.endMs;
    return subtitle;
  });
}

function focusTokens(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tokens = normalized.match(/[a-z0-9]{2,}|[\p{Script=Han}]{2,}/gu) || [];
  const expanded = [];
  for (const token of tokens) {
    expanded.push(token);
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 4) {
      for (let index = 0; index <= token.length - 2; index += 2) expanded.push(token.slice(index, index + 4));
    }
  }
  return [...new Set(expanded.filter((token) => token.length >= 2))].slice(0, 12);
}

function focusCuesFor(slide, narrationText, durationMs, subtitles = subtitlesFor(narrationText, durationMs)) {
  const bullets = (Array.isArray(slide?.bullets) ? slide.bullets : []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6);
  if (!bullets.length || durationMs < 1_000) return [];
  const usableStart = Math.min(1_200, Math.round(durationMs * 0.08));
  const usableDuration = Math.max(1_000, durationMs - usableStart - Math.min(700, Math.round(durationMs * 0.04)));
  return bullets.map((bullet, index) => {
    const tokens = focusTokens(bullet);
    let best = null;
    for (const subtitle of subtitles || []) {
      const haystack = String(subtitle.text || '').toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? Math.min(6, token.length) : 0), 0);
      if (score > 0 && (!best || score > best.score)) best = { subtitle, score };
    }
    const fallbackStart = usableStart + Math.round(usableDuration * index / bullets.length);
    const fallbackEnd = usableStart + Math.round(usableDuration * (index + 1) / bullets.length);
    const startMs = Math.max(0, Math.min(durationMs - 500, Number(best?.subtitle?.startMs ?? fallbackStart)));
    const rawEnd = Number(best?.subtitle?.endMs ?? fallbackEnd);
    const endMs = Math.min(durationMs, Math.max(startMs + 800, rawEnd));
    return { target: 'bullet', index, startMs, endMs, label: bullet.slice(0, 120) };
  });
}

function narrationForSlide(slide) {
  const notes = String(slide.notes || slide.speakerNotes || '').trim();
  if (notes) return notes;
  return [slide.title, ...(slide.bullets || [])].filter(Boolean).join('。');
}

function compactNarrationText(value, maxLength = 500) {
  return String(value || '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\s{0,3}(?:[-*#]+|\d+[.、])\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function fallbackNarrationForSlide(slide, index = 0, total = 1, maxLength = 500) {
  const title = String(slide?.title || `第 ${index + 1} 页`).trim();
  const subtitle = String(slide?.subtitle || '').trim();
  const bullets = (Array.isArray(slide?.bullets) ? slide.bullets : []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6);
  const notes = narrationForSlide(slide);
  if (notes.length >= 140) return compactNarrationText(notes, maxLength);

  if (index === 0 || slide?.type === 'cover') {
    return compactNarrationText(`大家好，本次学习的主题是“${title}”。${subtitle ? `它属于${subtitle}这一学习范围。` : ''}接下来我们不会只浏览目录，而会依次理解${bullets.length ? bullets.join('、') : '核心概念、关键方法和实际应用'}。学习过程中请特别关注每个概念解决什么问题、在什么条件下适用，以及它与后续知识之间的联系。完成本次讲解后，你应当能够用自己的语言复述主要结论，并尝试把方法迁移到具体问题中。`, maxLength);
  }

  if (index === total - 1 || ['summary', 'homework'].includes(slide?.type)) {
    return compactNarrationText(`这一页对“${title}”进行收束。我们刚才重点学习了${bullets.length ? bullets.join('、') : '本节的核心概念与方法'}。复习时不要只记住这些标题，可以逐项回答三个问题：它是什么、为什么成立或有用、遇到什么情境时应该使用。${notes ? `本页原有提示是：${notes}。` : ''}建议你暂停视频，用一分钟复述知识之间的关系，再完成相应练习；如果某一步无法说明原因，就回到对应页面重新理解。`, maxLength);
  }

  const detail = bullets.length
    ? bullets.map((bullet, bulletIndex) => `${['首先', '接着', '然后', '同时', '最后', '进一步'][bulletIndex] || '另外'}看“${bullet}”。这里需要理解它表达的对象、条件与作用，而不是只把这句话当作结论记忆。`).join('')
    : `先明确这一主题讨论的对象和问题，再分析它成立的条件、解决问题的步骤以及可能出现的误区。`;
  return compactNarrationText(`现在进入“${title}”的具体讲解。${subtitle ? `${subtitle}。` : ''}${detail}${notes ? `结合本页提示，还要注意：${notes}。` : ''}学习完这一页后，请尝试举出一个符合条件的例子，并说明为什么它能体现本页知识；如果只能复述标题，说明还需要继续理解概念之间的因果和步骤关系。下一页将在这个基础上继续展开。`, maxLength);
}

function parseNarrationScripts(content, slides, maxLength = 500) {
  const source = String(content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(source);
  const scripts = Array.isArray(parsed) ? parsed : parsed?.scripts;
  if (!Array.isArray(scripts)) throw new Error('详细讲解稿返回格式不正确');
  return slides.map((slide, index) => {
    const match = scripts.find((item) => Number(item?.page) === index + 1) || scripts[index];
    const text = compactNarrationText(typeof match === 'string' ? match : match?.text, maxLength);
    return text.length >= 80 ? text : fallbackNarrationForSlide(slide, index, slides.length, maxLength);
  });
}

async function generateDetailedNarrations(slides, options = {}) {
  const maxLength = Math.max(120, Math.min(800, Number(options.maxLength) || 500));
  const fallback = slides.map((slide, index) => fallbackNarrationForSlide(slide, index, slides.length, maxLength));
  try {
    const { client, model } = getBailianClient();
    const input = slides.map((slide, index) => ({
      page: index + 1,
      type: slide.type || 'content',
      title: slide.title || '',
      subtitle: slide.subtitle || '',
      bullets: Array.isArray(slide.bullets) ? slide.bullets.slice(0, 7) : [],
      existingNotes: narrationForSlide(slide),
    }));
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: '你是面向高校学生的知识讲解教师。任务是把PPT大纲改写为可直接配音的逐页详细讲解稿。内容必须准确、连贯、口语自然，不得只复述标题和要点，不得虚构来源或数据。只输出合法JSON。',
        },
        {
          role: 'user',
          content: `请为下面 ${slides.length} 页PPT生成逐页讲解稿，主题是“${String(options.topic || '').slice(0, 160)}”。输出格式必须为 {"scripts":[{"page":1,"text":"讲解稿"}]}，页码与输入完全对应。要求：1）封面页和总结页120到220个汉字，内容页220到420个汉字，单页绝不超过${maxLength}字；2）内容页要解释概念含义、成立条件或步骤、一个贴近学习的例子/类比、常见误区和与前后页的衔接；3）公式和英文缩写要转成适合朗读的表达；4）不要说“这一页列出了几个要点”之类的大纲话术，不使用Markdown或项目符号；5）existingNotes只作参考，需要扩写而不是照抄。PPT页面：${JSON.stringify(input).slice(0, 24000)}`,
        },
      ],
      temperature: 0.35,
      max_tokens: Math.min(10000, Math.max(3000, slides.length * 750)),
      response_format: { type: 'json_object' },
      enable_thinking: false,
    }, options.signal ? { signal: options.signal } : undefined);
    return {
      texts: parseNarrationScripts(completion.choices?.[0]?.message?.content, slides, maxLength),
      source: 'ai-detailed',
      warning: null,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    const mapped = mapBailianError(error, '详细讲解稿生成失败，已使用本地扩写稿');
    console.warn('[student-learning-media] narration script fallback', { message: mapped.message });
    return { texts: fallback, source: 'structured-fallback', warning: 'NARRATION_SCRIPT_FALLBACK' };
  }
}

function publicManifest(manifest) {
  if (!manifest) return null;
  return {
    ...manifest,
    slides: (manifest.slides || []).map(({ audioStoragePath, ...slide }) => slide),
  };
}

function videoFailureState(task, error) {
  const attemptCount = Number(task?.attemptCount);
  const maxAttempts = Number(task?.maxAttempts);
  const canRetry = !error?.permanent
    && Number.isFinite(attemptCount)
    && Number.isFinite(maxAttempts)
    && attemptCount < maxAttempts;
  return {
    status: canRetry ? 'PENDING' : 'FAILED',
    error_message: canRetry ? null : String(error?.message || '视频素材生成失败').slice(0, 1000),
  };
}

function publicVideoTaskStatus(videoTaskStatus, asyncTaskStatus) {
  const videoStatus = String(videoTaskStatus || '').toUpperCase();
  const taskStatus = String(asyncTaskStatus || '').toUpperCase();
  if (videoStatus === 'SUCCESS') return 'success';
  if (taskStatus === 'WAITING_EXTERNAL') return 'ready';
  if (taskStatus === 'QUEUED' || taskStatus === 'RUNNING') return 'generating';
  if (taskStatus === 'FAILED' || videoStatus === 'FAILED') return 'failed';
  return 'generating';
}

async function createVideoTaskUnlocked(user, body = {}) {
  const pptArtifactId = positiveId(body.pptArtifactId ?? body.ppt_artifact_id, 'pptArtifactId');
  const artifact = await prisma.generatedArtifact.findFirst({
    where: { id: pptArtifactId, ownerUserId: Number(user.user_id), status: 'READY', fileFormat: 'PPTX' },
  });
  if (!artifact) throw mediaError('PPT成果不存在、未完成或无权访问', 40002, 404);
  const courseId = positiveId(body.courseId ?? body.course_id ?? artifact.courseId, 'courseId');
  await ensureStudentCourse(user.user_id, courseId);
  if (artifact.courseId && Number(artifact.courseId) !== courseId) throw mediaError('PPT不属于当前课程', 40301, 403);
  const point = await resolveKnowledgePoint(courseId, body.knowledgePointId ?? body.knowledge_point_id ?? artifact.knowledgePointIdsJson?.[0]);
  const voiceType = String(body.voiceType || body.voice_type || getLearningNarrationModule().config.voice || 'default').slice(0, 50);
  const activeTasks = await prisma.asyncTask.findMany({
    where: {
      userId: Number(user.user_id),
      taskType: 'VOICE_PRELOAD',
      relatedResourceType: 'VIDEO_GENERATION_TASK',
      status: { in: ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  const active = activeTasks.find((task) => Number(task.metadataJson?.pptArtifactId) === pptArtifactId);
  if (active) {
    const activeVideoTaskId = Number(active.metadataJson?.videoGenerationTaskId || active.relatedResourceId);
    if (activeVideoTaskId) {
      try {
        return await getVideoTask(user, activeVideoTaskId);
      } catch (error) {
        if (error.code !== 40002) throw error;
      }
    }
  }

  const created = await prisma.$transaction(async (transaction) => {
    const videoTask = await transaction.videoGenerationTask.create({
      data: {
        course_id: courseId,
        knowledge_point_id: point?.knowledge_point_id || null,
        created_by_user_id: Number(user.user_id),
        script_prompt: String(body.scriptPrompt || body.script_prompt || `根据PPT“${artifact.title}”生成逐页知识讲解`).slice(0, 4000),
        style: String(body.style || 'ppt-narration').slice(0, 100),
        voice_type: voiceType,
        status: 'PENDING',
      },
    });
    const asyncTask = await transaction.asyncTask.create({
      data: {
        userId: Number(user.user_id),
        operationId: `ppt-video-${videoTask.video_generation_task_id}-${crypto.randomUUID()}`,
        taskType: 'VOICE_PRELOAD',
        title: `${artifact.title} 视频讲解`,
        description: '准备逐页演讲稿、配音、字幕和Remotion视频清单',
        status: 'QUEUED',
        stage: '等待生成视频素材',
        progress: 0,
        progressMode: 'DETERMINATE',
        relatedResourceType: 'VIDEO_GENERATION_TASK',
        relatedResourceId: String(videoTask.video_generation_task_id),
        metadataJson: { kind: 'PPT_VIDEO_NARRATION', pptArtifactId, videoGenerationTaskId: videoTask.video_generation_task_id },
        requestPayloadJson: { pptArtifactId, courseId, knowledgePointId: point?.knowledge_point_id || null, voiceType },
        dedupeKey: `ppt-video:${Number(user.user_id)}:${pptArtifactId}`.slice(0, 128),
        cancellable: true,
        maxAttempts: 2,
      },
    });
    return { videoTask, asyncTask };
  });
  return {
    videoTaskId: created.videoTask.video_generation_task_id,
    taskId: created.asyncTask.id,
    status: 'pending',
    stage: created.asyncTask.stage,
    progress: 0,
  };
}

function createVideoTask(user, body = {}) {
  const pptArtifactId = positiveId(body.pptArtifactId ?? body.ppt_artifact_id, 'pptArtifactId');
  const lockKey = `${Number(user.user_id)}:${pptArtifactId}`;
  const previous = videoCreationLocks.get(lockKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => createVideoTaskUnlocked(user, { ...body, pptArtifactId }));
  videoCreationLocks.set(lockKey, current);
  return current.finally(() => {
    if (videoCreationLocks.get(lockKey) === current) videoCreationLocks.delete(lockKey);
  });
}

async function synthesizeSlides(slides, narrationTexts, outputDir, videoTaskId, signal) {
  const narration = getLearningNarrationModule();
  const texts = slides.map((slide, index) => compactNarrationText(narrationTexts?.[index] || narrationForSlide(slide), narration.config.maxTextLength));
  if (!narration.config.enabled) return { audioBySlide: [], texts, warning: narration.config.unavailableReason || 'TTS_NOT_CONFIGURED' };
  const segments = texts.map((text, index) => ({ segmentId: `slide_${index + 1}`, order: index, text }));
  const scriptHash = crypto.createHash('sha256').update(segments.map((item) => item.text).join('\n')).digest('hex');
  let audioBySlide;
  const cached = await narration.cache.get(scriptHash);
  if (cached) audioBySlide = cached.audioBySegment;
  else {
    const metrics = { startedAt: Date.now(), characterCount: texts.join('').length };
    const synthesized = await narration.adapter.synthesize({ segments, signal, metrics });
    audioBySlide = synthesized.audioBySegment;
    await narration.cache.put(scriptHash, segments, audioBySlide, synthesized.usage);
  }
  await fs.mkdir(outputDir, { recursive: true });
  const bits = Math.max(8, Number(process.env.BAILIAN_TTS_PCM_BITS || 16));
  const channels = Math.max(1, Number(process.env.BAILIAN_TTS_CHANNELS || 1));
  const results = [];
  for (let index = 0; index < audioBySlide.length; index += 1) {
    const pcm = audioBySlide[index] || Buffer.alloc(0);
    if (!pcm.length) { results.push(null); continue; }
    const wav = wavFromPcm(pcm, narration.config.sampleRate, bits, channels);
    const fileName = `slide-${String(index + 1).padStart(2, '0')}.wav`;
    const absolute = path.join(outputDir, fileName);
    await fs.writeFile(absolute, wav);
    results.push({
      durationMs: Math.max(1_000, Math.round(pcm.length / (narration.config.sampleRate * channels * (bits / 8)) * 1000)),
      storagePath: path.relative(pptRenderer.ARTIFACT_STORAGE_ROOT, absolute).replace(/\\/g, '/'),
      url: `/api/student/videos/generation-tasks/${videoTaskId}/audio/${index + 1}`,
    });
  }
  return { audioBySlide: results, texts, warning: null };
}

async function processVideoTask(task, signal) {
  const videoTaskId = positiveId(task.relatedResourceId || task.metadataJson?.videoGenerationTaskId, 'videoTaskId');
  const videoTask = await prisma.videoGenerationTask.findUnique({ where: { video_generation_task_id: videoTaskId } });
  if (!videoTask) throw Object.assign(mediaError('视频生成任务不存在', 'VIDEO_TASK_NOT_FOUND'), { permanent: true });
  try {
    await prisma.videoGenerationTask.update({ where: { video_generation_task_id: videoTaskId }, data: { status: 'GENERATING', error_message: null } });
    await prisma.asyncTask.update({ where: { id: task.id }, data: { status: 'RUNNING', stage: '正在读取PPT内容', progress: 10 } });
    const artifact = await prisma.generatedArtifact.findFirst({
      where: { id: Number(task.metadataJson?.pptArtifactId), ownerUserId: videoTask.created_by_user_id, status: 'READY' },
    });
    const slides = artifact?.contentSchemaJson?.slides;
    if (!artifact || !Array.isArray(slides) || !slides.length) throw Object.assign(mediaError('PPT缺少可用于视频生成的页面内容', 'PPT_CONTENT_MISSING'), { permanent: true });
    const outputDir = path.join(pptRenderer.ARTIFACT_STORAGE_ROOT, String(videoTask.created_by_user_id), 'video', String(videoTaskId), 'audio');
    await prisma.asyncTask.update({ where: { id: task.id }, data: { stage: '正在生成详细逐页讲解稿', progress: 20 } });
    const narration = getLearningNarrationModule();
    if (signal?.aborted) throw Object.assign(new Error('视频素材生成已取消'), { name: 'AbortError' });
    const script = await generateDetailedNarrations(slides, {
      topic: `${artifact.title}；${videoTask.script_prompt || ''}`,
      maxLength: narration.config.maxTextLength,
      signal,
    });
    await prisma.asyncTask.update({ where: { id: task.id }, data: { stage: '正在生成逐页配音', progress: 40 } });
    let voice;
    try {
      voice = await synthesizeSlides(slides, script.texts, outputDir, videoTaskId, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('[student-learning-media] TTS fallback', { videoTaskId, message: error.message });
      voice = { audioBySlide: [], texts: script.texts, warning: error.code || 'TTS_GENERATION_FAILED' };
    }
    if (signal?.aborted) throw Object.assign(new Error('视频素材生成已取消'), { name: 'AbortError' });
    await prisma.asyncTask.update({ where: { id: task.id }, data: { stage: '正在生成字幕与视频时间轴', progress: 65 } });
    let totalFrames = 0;
    let totalDurationMs = 0;
    const manifestSlides = slides.map((slide, index) => {
      const narrationText = voice.texts[index] || narrationForSlide(slide);
      const audio = voice.audioBySlide[index] || null;
      const durationMs = audio?.durationMs || estimateDurationMs(narrationText);
      const durationInFrames = Math.max(1, Math.ceil(durationMs / 1000 * VIDEO_FPS));
      const subtitles = subtitlesFor(narrationText, durationMs);
      const result = {
        page: Number(slide.page || slide.pageNumber || index + 1),
        type: slide.type || (index === 0 ? 'cover' : 'content'),
        title: slide.title || artifact.title,
        subtitle: slide.subtitle || '',
        bullets: Array.isArray(slide.bullets) ? slide.bullets.slice(0, 6) : [],
        imageUrl: slide.imageUrl || null,
        imagePrompt: slide.imagePrompt || slide.imageSuggestion || '',
        narrationText,
        audioUrl: audio?.url || null,
        audioStoragePath: audio?.storagePath || null,
        durationMs,
        durationInFrames,
        startFrame: totalFrames,
        subtitles,
        focusCues: focusCuesFor(slide, narrationText, durationMs, subtitles),
      };
      totalFrames += durationInFrames;
      totalDurationMs += durationMs;
      return result;
    });
    const manifest = {
      version: 1,
      videoTaskId,
      pptArtifactId: artifact.id,
      title: artifact.title,
      courseId: videoTask.course_id,
      knowledgePointId: videoTask.knowledge_point_id,
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
      fps: VIDEO_FPS,
      totalDurationMs,
      totalDurationFrames: totalFrames,
      ttsAvailable: !voice.warning,
      warning: voice.warning,
      scriptSource: script.source,
      scriptWarning: script.warning,
      slides: manifestSlides,
    };
    await prisma.asyncTask.update({
      where: { id: task.id },
      data: {
        status: 'WAITING_EXTERNAL', stage: '视频素材已就绪，请在浏览器中渲染', progress: 80,
        requiresUserAction: true, lockedBy: null, lockedAt: null,
        metadataJson: { ...task.metadataJson, manifest, ttsWarning: voice.warning },
      },
    });
    return publicManifest(manifest);
  } catch (error) {
    await prisma.videoGenerationTask.update({
      where: { video_generation_task_id: videoTaskId },
      // The worker increments attemptCount before invoking this handler. Keep
      // the domain task retryable until the claimed attempt reaches maxAttempts.
      data: videoFailureState(task, error),
    }).catch(() => {});
    throw error;
  }
}

async function getVideoTask(user, value) {
  const videoTaskId = positiveId(value, 'videoTaskId');
  const videoTask = await prisma.videoGenerationTask.findFirst({
    where: { video_generation_task_id: videoTaskId, created_by_user_id: Number(user.user_id) },
  });
  if (!videoTask) throw mediaError('视频生成任务不存在', 40002, 404);
  const task = await prisma.asyncTask.findFirst({
    where: { userId: Number(user.user_id), relatedResourceType: 'VIDEO_GENERATION_TASK', relatedResourceId: String(videoTaskId) },
    orderBy: { id: 'desc' },
  });
  const status = publicVideoTaskStatus(videoTask.status, task?.status);
  return {
    videoTaskId,
    taskId: task?.id || null,
    status,
    stage: task?.stage || null,
    progress: task?.progress || 0,
    manifest: status === 'ready' || status === 'success' ? publicManifest(task?.metadataJson?.manifest) : null,
    resultUrl: videoTask.result_url,
    errorMessage: status === 'failed' ? (videoTask.error_message || task?.errorMessage || null) : null,
  };
}

async function getAudioFile(user, taskValue, pageValue) {
  const videoTaskId = positiveId(taskValue, 'videoTaskId');
  const page = positiveId(pageValue, 'page');
  const videoTask = await prisma.videoGenerationTask.findFirst({ where: { video_generation_task_id: videoTaskId, created_by_user_id: Number(user.user_id) } });
  if (!videoTask) throw mediaError('无权访问该语音文件', 40301, 403);
  const task = await prisma.asyncTask.findFirst({ where: { relatedResourceType: 'VIDEO_GENERATION_TASK', relatedResourceId: String(videoTaskId) }, orderBy: { id: 'desc' } });
  const slide = task?.metadataJson?.manifest?.slides?.find((item) => Number(item.page) === page);
  if (!slide?.audioStoragePath) throw mediaError('当前页面没有可用配音', 40002, 404);
  const root = pptRenderer.ARTIFACT_STORAGE_ROOT;
  const absolutePath = path.resolve(root, slide.audioStoragePath.replace(/\//g, path.sep));
  if (!absolutePath.startsWith(`${root}${path.sep}`) || !fsSync.existsSync(absolutePath)) throw mediaError('配音文件不存在', 40002, 404);
  return { absolutePath, fileName: `slide-${page}.wav`, mimeType: 'audio/wav' };
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function completeVideoTaskUnlocked(user, taskValue, file) {
  const videoTaskId = positiveId(taskValue, 'videoTaskId');
  if (!file?.path) throw mediaError('请上传浏览器渲染完成的MP4文件');
  const videoTask = await prisma.videoGenerationTask.findFirst({ where: { video_generation_task_id: videoTaskId, created_by_user_id: Number(user.user_id) } });
  if (!videoTask) throw mediaError('视频生成任务不存在或无权访问', 40301, 403);
  if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) throw mediaError(`视频文件为空或超过${MAX_VIDEO_MB}MB限制`);
  const header = Buffer.alloc(12);
  const handle = await fs.open(file.path, 'r');
  try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
  if (header.subarray(4, 8).toString() !== 'ftyp') throw mediaError('上传文件不是有效的MP4视频');
  const task = await prisma.asyncTask.findFirst({
    where: { userId: Number(user.user_id), relatedResourceType: 'VIDEO_GENERATION_TASK', relatedResourceId: String(videoTaskId) },
    orderBy: { id: 'desc' },
  });
  if (!task?.metadataJson?.manifest) throw mediaError('视频素材尚未准备完成', 40901, 409);
  const folder = path.join(pptRenderer.ARTIFACT_STORAGE_ROOT, String(user.user_id), 'video', String(videoTaskId));
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, `learning-video-${Date.now()}.mp4`);
  await fs.rename(file.path, target);
  const stat = await fs.stat(target);
  const checksum = await sha256File(target);
  const storagePath = path.relative(pptRenderer.ARTIFACT_STORAGE_ROOT, target).replace(/\\/g, '/');
  const manifest = publicManifest(task.metadataJson.manifest);
  const resultUrl = `/api/student/videos/generated/${videoTaskId}/media`;
  const operationId = `learning-video-${videoTaskId}`;
  const existingArtifact = await prisma.generatedArtifact.findUnique({ where: { taskId: task.id } });
  const previousStoragePath = existingArtifact?.storagePath || null;
  const artifactData = {
    ownerUserId: Number(user.user_id), parentArtifactId: Number(manifest.pptArtifactId), operationId,
    artifactType: 'LEARNING_VIDEO', title: manifest.title.slice(0, 200), description: 'PPT、逐页讲稿、阿里语音和字幕合成的知识点讲解视频',
    courseId: videoTask.course_id, knowledgePointIdsJson: videoTask.knowledge_point_id ? [videoTask.knowledge_point_id] : [],
    requirementsJson: { videoGenerationTaskId: videoTaskId, sourceArtifactId: manifest.pptArtifactId, renderMode: 'remotion-web' },
    contentSchemaJson: manifest, fileFormat: 'MP4', storagePath, fileName: `${manifest.title}.mp4`, mimeType: 'video/mp4',
    fileSizeBytes: BigInt(stat.size), checksum, status: 'READY', generator: 'remotion-web',
    metadataJson: { videoGenerationTaskId: videoTaskId, durationMs: manifest.totalDurationMs, width: manifest.width, height: manifest.height, fps: manifest.fps },
  };
  const artifact = existingArtifact
    ? await prisma.generatedArtifact.update({ where: { id: existingArtifact.id }, data: artifactData })
    : await prisma.generatedArtifact.create({ data: { ...artifactData, taskId: task.id } });
  let videoResourceId = Number(task.metadataJson?.videoResourceId) || null;
  if (!videoResourceId) {
    const resource = await prisma.videoResource.create({
      data: {
        course_id: videoTask.course_id, knowledge_point_id: videoTask.knowledge_point_id,
        title: manifest.title.slice(0, 200), source: 'SELF_GENERATED', original_url: resultUrl,
        cover_url: manifest.slides.find((item) => item.imageUrl)?.imageUrl || null,
        duration_seconds: Math.ceil(manifest.totalDurationMs / 1000), recommend_reason: '根据课程PPT自动生成的知识点讲解视频',
        created_by_user_id: Number(user.user_id),
      },
    });
    videoResourceId = resource.video_id;
  }
  await prisma.$transaction([
    prisma.videoGenerationTask.update({ where: { video_generation_task_id: videoTaskId }, data: { status: 'SUCCESS', result_url: resultUrl, error_message: null } }),
    prisma.asyncTask.update({ where: { id: task.id }, data: {
      status: 'SUCCEEDED', stage: 'MP4视频已生成', progress: 100, requiresUserAction: false,
      resultType: 'GENERATED_ARTIFACT', resultId: String(artifact.id), resultUrl, completedAt: new Date(),
      metadataJson: { ...task.metadataJson, artifactId: artifact.id, videoResourceId },
    } }),
  ]);
  if (previousStoragePath && previousStoragePath !== storagePath) {
    const previousAbsolute = path.resolve(pptRenderer.ARTIFACT_STORAGE_ROOT, previousStoragePath.replace(/\//g, path.sep));
    if (previousAbsolute.startsWith(`${pptRenderer.ARTIFACT_STORAGE_ROOT}${path.sep}`)) {
      await fs.unlink(previousAbsolute).catch((error) => {
        if (error.code !== 'ENOENT') console.warn('[student-learning-media] previous video cleanup failed', { videoTaskId, message: error.message });
      });
    }
  }
  const completed = { videoTaskId, artifactId: artifact.id, videoResourceId, resultUrl, fileName: artifact.fileName, fileSizeBytes: Number(stat.size), status: 'success' };
  await require('./student-learning-package.service').completePackageVideo(user, videoTaskId, completed).catch((error) => {
    console.warn('[student-learning-media] resource package completion sync failed', { videoTaskId, message: error.message });
  });
  return completed;
}

function completeVideoTask(user, taskValue, file) {
  const lockKey = String(taskValue);
  const previous = videoCompletionLocks.get(lockKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => completeVideoTaskUnlocked(user, taskValue, file));
  videoCompletionLocks.set(lockKey, current);
  return current.finally(() => {
    if (videoCompletionLocks.get(lockKey) === current) videoCompletionLocks.delete(lockKey);
  });
}

async function getVideoFile(user, taskValue) {
  const videoTaskId = positiveId(taskValue, 'videoTaskId');
  const videoTask = await prisma.videoGenerationTask.findUnique({ where: { video_generation_task_id: videoTaskId } });
  if (!videoTask || videoTask.status !== 'SUCCESS') throw mediaError('视频不存在或尚未生成', 40002, 404);
  if (Number(videoTask.created_by_user_id) !== Number(user.user_id)) await ensureStudentCourse(user.user_id, videoTask.course_id);
  const task = await prisma.asyncTask.findFirst({ where: { relatedResourceType: 'VIDEO_GENERATION_TASK', relatedResourceId: String(videoTaskId) }, orderBy: { id: 'desc' } });
  const artifactId = Number(task?.resultId || task?.metadataJson?.artifactId);
  const artifact = artifactId ? await prisma.generatedArtifact.findUnique({ where: { id: artifactId } }) : null;
  if (!artifact?.storagePath) throw mediaError('视频文件不存在', 40002, 404);
  const root = pptRenderer.ARTIFACT_STORAGE_ROOT;
  const absolutePath = path.resolve(root, artifact.storagePath.replace(/\//g, path.sep));
  if (!absolutePath.startsWith(`${root}${path.sep}`) || !fsSync.existsSync(absolutePath)) throw mediaError('视频文件不存在', 40002, 404);
  await prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { lastAccessedAt: new Date() } }).catch(() => {});
  return { absolutePath, fileName: artifact.fileName || `${artifact.title}.mp4`, mimeType: 'video/mp4' };
}

module.exports = {
  MAX_VIDEO_MB, MAX_VIDEO_BYTES, createPpt, getPptTask, createVideoTask, processVideoTask, getVideoTask,
  getAudioFile, completeVideoTask, getVideoFile, wavFromPcm, subtitlesFor, publicManifest,
  videoFailureState, publicVideoTaskStatus,
  focusTokens, focusCuesFor, compactNarrationText, fallbackNarrationForSlide, parseNarrationScripts, generateDetailedNarrations,
};
