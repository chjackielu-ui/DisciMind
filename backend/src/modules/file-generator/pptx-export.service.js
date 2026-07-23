const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const {
  STORAGE_ROOT,
  safeArtifactPath,
  resolveStoredPath,
  MAX_FILE_BYTES,
} = require('./document-export.service');
const { examPaperSchema, studyHandoutSchema } = require('./file-content.schemas');

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const FONT_FACE = 'Microsoft YaHei';
const COLORS = Object.freeze({ accent: '315B74', secondary: '3D8B70', ink: '1F2F38', muted: '60717A', pale: 'EAF0F3', canvas: 'F7FAFB' });

function exportError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function cleanText(value, fallback = '') {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim() || fallback;
}

function compact(value, max = 180) {
  const text = cleanText(value).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function handoutSlides(content, requirements = {}) {
  const slides = [{ type: 'cover', title: content.title, subtitle: `${content.course} · ${content.knowledgePoints.join('、')}` }];
  slides.push({ title: '学习目标', bullets: content.learningObjectives.map(item => compact(item)) });
  slides.push({ title: '先备知识', bullets: content.prerequisites.map(item => compact(item)) });
  slides.push({ title: '公式与原理', bullets: content.principles.map(item => compact(item)) });
  for (const section of content.sections) {
    const groups = chunk(section.content.map(item => compact(item)), 6);
    groups.forEach((bullets, index) => slides.push({ title: groups.length > 1 ? `${section.title}（${index + 1}/${groups.length}）` : section.title, bullets }));
  }
  if (content.examples.length) slides.push({ title: '例题与示例', bullets: content.examples.slice(0, 6).map(item => `${compact(item.title, 45)}：${compact(item.content, 135)}`) });
  if (content.keyPoints.length) slides.push({ title: '核心要点', bullets: content.keyPoints.slice(0, 7).map(item => compact(item)) });
  if (content.commonMistakes.length) slides.push({ title: '常见错误', bullets: content.commonMistakes.slice(0, 7).map(item => compact(item)) });
  if (content.practice.length) {
    const practice = content.practice.map((item, index) => {
      const answer = requirements.includeAnswers === false ? '' : `\n答案：${compact(item.answer, 100)}`;
      const analysis = requirements.includeAnswers === false || requirements.includeAnalysis === false
        ? ''
        : `\n解析：${compact(item.analysis, 110)}`;
      return `${index + 1}. ${compact(item.question, 145)}${answer}${analysis}`;
    });
    chunk(practice, 4).forEach((bullets, index) => slides.push({
      title: practice.length > 4 ? `课堂练习（${index + 1}/${Math.ceil(practice.length / 4)}）` : '课堂练习',
      bullets,
    }));
  }
  slides.push({ title: '学习总结', bullets: content.summary.slice(0, 7).map(item => compact(item)) });
  slides.push({ title: '参考资料', bullets: content.references.slice(0, 7).map(item => compact(item)) });
  return slides;
}

function examSlides(content, artifact) {
  const requirements = artifact.requirementsJson || {};
  const role = artifact.artifactRole || 'STUDENT_PAPER';
  const subtitle = role === 'ANSWER_KEY'
    ? `${content.course} · 参考答案与解析`
    : role === 'ANSWER_SHEET'
      ? `${content.course} · 答题卷`
      : `${content.course} · ${content.totalScore} 分 · ${content.duration} 分钟`;
  const slides = [{ type: 'cover', title: artifact.title || content.title, subtitle }];
  if (role === 'ANSWER_KEY') {
    chunk(content.questions, 4).forEach((group, index) => slides.push({
      title: `参考答案与解析${content.questions.length > 4 ? `（${index + 1}/${Math.ceil(content.questions.length / 4)}）` : ''}`,
      bullets: group.map((item) => {
        const answer = requirements.includeAnswers ? `答案：${compact(Array.isArray(item.answer) ? item.answer.join('、') : item.answer, 100)}` : '';
        const analysis = requirements.includeAnalysis ? `解析：${compact(item.analysis, 115)}` : '';
        return `${item.id} ${answer}${answer && analysis ? '\n' : ''}${analysis}`.trim();
      }),
    }));
    return slides;
  }
  if (role === 'ANSWER_SHEET') {
    slides.push({ title: '考生信息', bullets: ['姓名：________________', '学号：________________', '班级：________________'] });
    chunk(content.questions, 6).forEach((group, index) => slides.push({
      title: `答题区${content.questions.length > 6 ? `（${index + 1}/${Math.ceil(content.questions.length / 6)}）` : ''}`,
      bullets: group.map(item => `${item.id}（${item.score} 分）\n________________________________________________`),
    }));
    return slides;
  }
  slides.push({ title: '作答说明', bullets: content.instructions.map(item => compact(item)) });
  const questionMap = new Map(content.questions.map(item => [item.id, item]));
  for (const section of content.sections) {
    const questions = section.questionIds.map(id => questionMap.get(id)).filter(Boolean);
    chunk(questions, 3).forEach((group, index) => slides.push({
      title: questions.length > 3 ? `${section.title}（${index + 1}/${Math.ceil(questions.length / 3)}）` : section.title,
      bullets: group.map((item) => {
        const options = item.options.map((option, optionIndex) => `${String.fromCharCode(65 + optionIndex)}. ${compact(option, 70)}`).join('  ');
        return `${item.id}（${item.score} 分）${compact(item.stem, 135)}${options ? `\n${options}` : ''}`;
      }),
    }));
  }
  return slides;
}

function buildSlides(artifact) {
  if (artifact.artifactType === 'EXAM_PAPER') return examSlides(examPaperSchema.parse(artifact.contentSchemaJson), artifact);
  const raw = artifact.contentSchemaJson || {};
  const compatible = {
    ...raw,
    principles: raw.principles?.length ? raw.principles : (raw.keyPoints || []).slice(0, 8),
    references: raw.references?.length ? raw.references : ['DisciMind 历史讲义内容，请结合课程教材核验。'],
  };
  return handoutSlides(studyHandoutSchema.parse(compatible), artifact.requirementsJson || {});
}

function addCover(pptx, slideData, courseName) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.canvas };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: 7.5, line: { color: COLORS.accent, transparency: 100 }, fill: { color: COLORS.accent } });
  slide.addText(slideData.title, { x: 0.9, y: 1.35, w: 9.1, h: 1.45, fontFace: FONT_FACE, fontSize: slideData.title.length > 28 ? 28 : 34, bold: true, color: COLORS.ink, margin: 0, valign: 'mid', fit: 'shrink' });
  slide.addText(slideData.subtitle || courseName, { x: 0.92, y: 3.08, w: 8.4, h: 0.65, fontFace: FONT_FACE, fontSize: 17, color: COLORS.muted, margin: 0, fit: 'shrink' });
  slide.addShape(pptx.ShapeType.roundRect, { x: 10.05, y: 2.05, w: 2.25, h: 2.25, rectRadius: 0.06, line: { color: COLORS.secondary, width: 1.3 }, fill: { color: COLORS.pale } });
  slide.addText('PPT', { x: 10.43, y: 2.91, w: 1.5, h: 0.45, fontFace: FONT_FACE, fontSize: 23, bold: true, color: COLORS.accent, align: 'center', margin: 0 });
  slide.addText('DisciMind 学习交付', { x: 0.92, y: 6.28, w: 4.6, h: 0.3, fontFace: FONT_FACE, fontSize: 10, color: COLORS.accent, margin: 0 });
}

function addContent(pptx, slideData, page, total, courseName) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.canvas };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.14, line: { color: COLORS.accent, transparency: 100 }, fill: { color: COLORS.accent } });
  slide.addText(slideData.title, { x: 0.7, y: 0.5, w: 11.9, h: 0.65, fontFace: FONT_FACE, fontSize: slideData.title.length > 26 ? 20 : 24, bold: true, color: COLORS.ink, margin: 0, fit: 'shrink' });
  slide.addShape(pptx.ShapeType.line, { x: 0.7, y: 1.38, w: 11.95, h: 0, line: { color: COLORS.pale, width: 1.2 } });
  const bullets = slideData.bullets?.length ? slideData.bullets : ['本页暂无内容。'];
  slide.addText(bullets.map(item => `• ${item}`).join('\n\n'), { x: 0.9, y: 1.72, w: 11.45, h: 4.95, fontFace: FONT_FACE, fontSize: bullets.length > 6 ? 14 : bullets.join('').length > 480 ? 15 : 18, color: COLORS.ink, margin: 0.04, valign: 'top', breakLine: false, paraSpaceAfterPt: 8, fit: 'shrink' });
  slide.addText(courseName, { x: 0.72, y: 7.03, w: 5.5, h: 0.2, fontFace: FONT_FACE, fontSize: 8.5, color: COLORS.muted, margin: 0 });
  slide.addText(`${page} / ${total}`, { x: 11.55, y: 7.0, w: 0.95, h: 0.22, fontFace: FONT_FACE, fontSize: 8.5, color: COLORS.accent, align: 'right', margin: 0 });
}

async function validatePptx(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size < 1024 || stat.size > MAX_FILE_BYTES) throw exportError('PPTX 文件无效或过大', 'PPTX_INVALID', { permanent: true });
  const buffer = await fs.readFile(filePath);
  const manifest = buffer.toString('latin1');
  if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    || buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0
    || !manifest.includes('[Content_Types].xml') || !manifest.includes('ppt/presentation.xml')) {
    throw exportError('PPTX OpenXML 结构不完整', 'PPTX_INVALID', { permanent: true });
  }
  return { stat, buffer };
}

async function exportArtifact(artifactId, { taskId, signal } = {}) {
  const artifact = await prisma.generatedArtifact.findUnique({ where: { id: Number(artifactId) } });
  if (!artifact || artifact.deletedAt) throw exportError('Artifact 不存在', 'ARTIFACT_NOT_FOUND', { permanent: true });
  if (!artifact.contentSchemaJson) throw exportError('结构化内容尚未生成', 'ARTIFACT_CONTENT_NOT_READY', { permanent: true });
  const record = await prisma.generatedArtifactExport.findUnique({ where: { artifactId_format: { artifactId: artifact.id, format: 'PPTX' } } });
  const previousPath = record?.storagePath ? resolveStoredPath(record.storagePath) : null;
  const fileName = `${artifact.id}-${crypto.randomUUID()}.pptx`;
  const target = safeArtifactPath(artifact.ownerUserId, artifact.id, fileName);
  try {
    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', progress: 10, stage: '正在排版 PPTX' });
    if (signal?.aborted) throw Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' });
    const slides = buildSlides(artifact);
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'DisciMind'; pptx.company = 'DisciMind'; pptx.subject = artifact.contentSchemaJson.course; pptx.title = artifact.title; pptx.lang = 'zh-CN';
    slides.forEach((item, index) => item.type === 'cover' ? addCover(pptx, item, artifact.contentSchemaJson.course) : addContent(pptx, item, index + 1, slides.length, artifact.contentSchemaJson.course));
    await fs.mkdir(target.directory, { recursive: true });
    await pptx.writeFile({ fileName: target.absolute, compression: true });
    if (signal?.aborted) throw Object.assign(new Error('任务已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' });
    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', progress: 80, stage: '正在校验 PPTX' });
    const { stat, buffer } = await validatePptx(target.absolute);
    if (previousPath && previousPath !== target.absolute) await fs.unlink(previousPath).catch(() => null);
    return {
      storagePath: path.relative(STORAGE_ROOT, target.absolute).replace(/\\/g, '/'),
      fileSizeBytes: BigInt(stat.size),
      checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
      mimeType: PPTX_MIME,
    };
  } catch (error) {
    await fs.unlink(target.absolute).catch(() => null);
    throw error;
  }
}

module.exports = { PPTX_MIME, buildSlides, validatePptx, exportArtifact };
