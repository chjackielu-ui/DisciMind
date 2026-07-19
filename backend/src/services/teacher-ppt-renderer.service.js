const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const ARTIFACT_STORAGE_ROOT = path.resolve(__dirname, '../../storage/generated-artifacts');
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 6000;
const FONT_FACE = 'Microsoft YaHei';

const THEMES = {
  teaching: { accent: '315B74', secondary: '3D8B70', ink: '1F2F38', muted: '60717A', pale: 'EAF0F3', canvas: 'F7FAFB' },
  competition: { accent: 'A7582C', secondary: '2E728F', ink: '342820', muted: '78665B', pale: 'F5E9DD', canvas: 'FCF9F5' },
  minimal: { accent: '2F596B', secondary: '78915C', ink: '26343A', muted: '6A777C', pale: 'EDF1F1', canvas: 'FFFFFF' },
  academic: { accent: '344B66', secondary: '8A6A3E', ink: '202A35', muted: '626E7B', pale: 'E9EDF2', canvas: 'F8F9FB' },
  lecture: { accent: '6B4E35', secondary: '407C68', ink: '302820', muted: '74685E', pale: 'F1E9E0', canvas: 'FCFAF7' },
};

const STYLE_ALIASES = {
  teaching: 'teaching', '教学型': 'teaching',
  competition: 'competition', '竞赛展示型': 'competition',
  minimal: 'minimal', '简洁型': 'minimal',
  academic: 'academic', '学术型': 'academic',
  lecture: 'lecture', '课堂讲授型': 'lecture',
};

function rendererError(message, code = 'PPTX_RENDER_FAILED') {
  return Object.assign(new Error(message), { code });
}

function cleanText(value, fallback = '') {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim() || fallback;
}

function stringList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => stringList(item)).filter(Boolean);
  return String(value || '').split(/\r?\n|[；;]/).map((item) => item.replace(/^[\s•*-]+/, '').trim()).filter(Boolean);
}

function normalizeStyle(value) {
  return STYLE_ALIASES[String(value || '').trim()] || STYLE_ALIASES[String(value || '').trim().toLowerCase()] || 'teaching';
}

function inferSlideType(item, index, total) {
  const provided = cleanText(item?.type).toLowerCase();
  if (['cover', 'objectives', 'content', 'example', 'interaction', 'summary', 'homework'].includes(provided)) return provided;
  if (index === 0) return 'cover';
  if (index === total - 1) return 'summary';
  if (/目标/.test(item?.title || '')) return 'objectives';
  if (/互动|练习|讨论/.test(item?.title || '')) return 'interaction';
  if (/作业|任务/.test(item?.title || '')) return 'homework';
  return 'content';
}

function normalizeSlidesJson(value = {}, options = {}) {
  const rawSlides = Array.isArray(value.slides) ? value.slides : Array.isArray(value) ? value : [];
  if (!rawSlides.length) throw rendererError('PPT 内容中没有可渲染的页面', 'PPTX_SLIDES_EMPTY');
  const style = normalizeStyle(options.style || value.style);
  const title = cleanText(value.title || rawSlides[0]?.title, '教学课件');
  const courseName = cleanText(options.courseName || value.courseName, '课程教学');
  const subtitle = cleanText(value.subtitle || rawSlides[0]?.subtitle, `${courseName}课堂教学课件`);
  const slides = rawSlides.map((item, index) => ({
    page: index + 1,
    type: inferSlideType(item, index, rawSlides.length),
    title: cleanText(item?.title, index === 0 ? title : `第 ${index + 1} 页`),
    subtitle: cleanText(item?.subtitle),
    bullets: stringList(item?.bullets).slice(0, 7),
    imagePrompt: cleanText(item?.imagePrompt ?? item?.imageSuggestion),
    imageUrl: cleanText(item?.imageUrl),
    notes: cleanText(item?.notes ?? item?.speakerNotes, '结合本页内容组织讲解，并通过提问确认学生理解。'),
  }));
  return { title, subtitle, courseName, style, slides };
}

function safeFileName(value) {
  const base = cleanText(value, `teaching-ppt-${Date.now()}.pptx`).normalize('NFKC')
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/\s+/g, '-').slice(0, 180);
  return /\.pptx$/i.test(base) ? base : `${base}.pptx`;
}

async function ensureOutputDir(outputDir) {
  const configuredValue = String(process.env.PPT_OUTPUT_DIR || '').trim();
  const configuredRoot = configuredValue
    ? path.resolve(path.isAbsolute(configuredValue) ? configuredValue : path.resolve(__dirname, '../..', configuredValue))
    : ARTIFACT_STORAGE_ROOT;
  if (configuredRoot !== ARTIFACT_STORAGE_ROOT && !configuredRoot.startsWith(`${ARTIFACT_STORAGE_ROOT}${path.sep}`)) {
    throw rendererError('PPT_OUTPUT_DIR 必须位于现有 generated-artifacts 存储目录内', 'PPTX_OUTPUT_DIR_UNSAFE');
  }
  const resolved = path.resolve(outputDir || configuredRoot);
  if (resolved !== configuredRoot && !resolved.startsWith(`${configuredRoot}${path.sep}`)) {
    throw rendererError('PPTX 输出目录不安全', 'PPTX_OUTPUT_DIR_UNSAFE');
  }
  await fs.mkdir(resolved, { recursive: true });
  return { root: configuredRoot, outputDir: resolved };
}

function imageMime(value) {
  const normalized = String(value || '').split(';')[0].trim().toLowerCase();
  return ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'].includes(normalized) ? normalized : null;
}

async function remoteImageData(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) return null;
    const mime = imageMime(response.headers.get('content-type'));
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (!mime || declaredSize > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function localUploadImage(url) {
  if (!String(url).startsWith('/uploads/')) return null;
  const storageRoot = path.resolve(__dirname, '../../../storage/uploads');
  const absolute = path.resolve(storageRoot, String(url).replace(/^\/uploads\//, '').replace(/\//g, path.sep));
  if (!absolute.startsWith(`${storageRoot}${path.sep}`)) return null;
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) return null;
    return { path: absolute };
  } catch {
    return null;
  }
}

async function resolveImageForSlide(item = {}) {
  const url = cleanText(item.imageUrl);
  if (!url) return null;
  if (/^data:image\/(?:png|jpeg|gif|svg\+xml);base64,/i.test(url) && Buffer.byteLength(url, 'utf8') <= MAX_IMAGE_BYTES * 1.5) return { data: url };
  if (/^https?:\/\//i.test(url)) {
    const data = await remoteImageData(url);
    return data ? { data } : null;
  }
  return localUploadImage(url);
}

function titleSize(value, normal = 23) {
  const length = cleanText(value).length;
  return length > 32 ? normal - 5 : length > 22 ? normal - 2 : normal;
}

function bulletSize(items) {
  const total = items.join('').length;
  if (items.length > 6 || total > 230) return 14;
  if (items.length > 4 || total > 150) return 16;
  return 18;
}

function addSpeakerNotes(slide, notes, includeNotes) {
  if (includeNotes !== false && cleanText(notes)) slide.addNotes(cleanText(notes));
}

function createCoverSlide(pptx, model, item, theme, options) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.canvas };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, line: { color: theme.canvas, transparency: 100 }, fill: { color: theme.canvas } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: 7.5, line: { color: theme.accent, transparency: 100 }, fill: { color: theme.accent } });
  slide.addShape(pptx.ShapeType.rect, { x: 0.85, y: 1.05, w: 1.05, h: 0.08, line: { color: theme.secondary, transparency: 100 }, fill: { color: theme.secondary } });
  slide.addText(item.title || model.title, { x: 0.85, y: 1.45, w: 8.9, h: 1.35, fontFace: FONT_FACE, fontSize: titleSize(item.title || model.title, 34), bold: true, color: theme.ink, margin: 0, breakLine: false, valign: 'mid' });
  slide.addText(item.subtitle || model.subtitle, { x: 0.88, y: 3.0, w: 8.45, h: 0.72, fontFace: FONT_FACE, fontSize: 17, color: theme.muted, margin: 0, valign: 'mid' });
  slide.addText(model.courseName, { x: 0.88, y: 5.35, w: 5.8, h: 0.35, fontFace: FONT_FACE, fontSize: 12, bold: true, color: theme.accent, margin: 0 });
  slide.addText(options.teacherName ? `授课教师：${options.teacherName}` : 'DisciMind 智慧备课', { x: 0.88, y: 5.83, w: 5.8, h: 0.3, fontFace: FONT_FACE, fontSize: 10, color: theme.muted, margin: 0 });
  slide.addText(new Date().toLocaleDateString('zh-CN'), { x: 0.88, y: 6.27, w: 3.1, h: 0.28, fontFace: FONT_FACE, fontSize: 9, color: theme.muted, margin: 0 });
  slide.addShape(pptx.ShapeType.ellipse, { x: 10.55, y: 1.45, w: 1.35, h: 1.35, line: { color: theme.secondary, transparency: 30, width: 1.3 }, fill: { color: theme.pale, transparency: 5 } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.8, y: 2.75, w: 2.1, h: 2.1, line: { color: theme.accent, transparency: 55, width: 1 }, fill: { color: theme.canvas, transparency: 100 } });
  slide.addText('PPT', { x: 10.2, y: 3.48, w: 1.3, h: 0.42, fontFace: FONT_FACE, fontSize: 18, bold: true, color: theme.accent, align: 'center', margin: 0 });
  addSpeakerNotes(slide, item.notes, options.includeNotes);
  return slide;
}

async function createContentSlide(pptx, model, item, theme, options) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.canvas };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.15, line: { color: theme.accent, transparency: 100 }, fill: { color: theme.accent } });
  slide.addText(item.title, { x: 0.65, y: 0.48, w: 11.9, h: 0.62, fontFace: FONT_FACE, fontSize: titleSize(item.title), bold: true, color: theme.ink, margin: 0, valign: 'mid' });
  if (item.subtitle) slide.addText(item.subtitle, { x: 0.67, y: 1.08, w: 11.7, h: 0.35, fontFace: FONT_FACE, fontSize: 10, color: theme.muted, margin: 0 });
  slide.addShape(pptx.ShapeType.line, { x: 0.65, y: 1.52, w: 12.0, h: 0, line: { color: theme.pale, width: 1.2 } });
  const bullets = item.bullets.length ? item.bullets : ['围绕本页主题开展概念讲解、案例分析和课堂反馈。'];
  slide.addText(bullets.map((point) => `• ${point}`).join('\n\n'), {
    x: 0.78, y: 1.85, w: 7.15, h: 4.75, fontFace: FONT_FACE, fontSize: bulletSize(bullets), color: theme.ink,
    margin: 0.06, breakLine: false, valign: 'top', paraSpaceAfterPt: 10, lineSpacingMultiple: 1.05, fit: 'shrink',
  });
  const image = await resolveImageForSlide(item);
  slide.addShape(pptx.ShapeType.roundRect, { x: 8.38, y: 1.82, w: 4.25, h: 4.72, rectRadius: 0.06, line: { color: theme.pale, width: 1.2 }, fill: { color: theme.pale, transparency: 25 } });
  if (image) {
    try {
      slide.addImage({ ...image, x: 8.52, y: 1.96, w: 3.97, h: 4.44, transparency: 0 });
    } catch {
      slide.addText('教学配图区域', { x: 9.15, y: 3.62, w: 2.7, h: 0.38, fontFace: FONT_FACE, fontSize: 14, bold: true, color: theme.accent, align: 'center', margin: 0 });
    }
  } else {
    slide.addText('教学配图区域', { x: 9.15, y: 3.24, w: 2.7, h: 0.38, fontFace: FONT_FACE, fontSize: 14, bold: true, color: theme.accent, align: 'center', margin: 0 });
    slide.addText(item.imagePrompt || '可结合课程内容补充示意图、流程图或案例图片', { x: 8.85, y: 3.8, w: 3.35, h: 0.9, fontFace: FONT_FACE, fontSize: 9, color: theme.muted, align: 'center', margin: 0.02, valign: 'mid', fit: 'shrink' });
  }
  slide.addText(model.courseName, { x: 0.68, y: 7.02, w: 5.6, h: 0.22, fontFace: FONT_FACE, fontSize: 8.5, color: theme.muted, margin: 0 });
  slide.addText(String(item.page), { x: 12.1, y: 7.0, w: 0.48, h: 0.24, fontFace: FONT_FACE, fontSize: 9, color: theme.accent, bold: true, align: 'right', margin: 0 });
  addSpeakerNotes(slide, item.notes, options.includeNotes);
  return slide;
}

async function renderTeachingPptx(slidesJson, options = {}) {
  const model = normalizeSlidesJson(slidesJson, options);
  const theme = THEMES[model.style] || THEMES.teaching;
  const location = await ensureOutputDir(options.outputDir);
  const fileName = safeFileName(options.fileName || `teaching-ppt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pptx`);
  const filePath = path.resolve(location.outputDir, fileName);
  if (!filePath.startsWith(`${location.outputDir}${path.sep}`)) throw rendererError('PPTX 文件路径不安全', 'PPTX_FILE_PATH_UNSAFE');

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = cleanText(options.teacherName, 'DisciMind 教师');
  pptx.company = 'DisciMind';
  pptx.subject = model.courseName;
  pptx.title = model.title;
  pptx.lang = 'zh-CN';
  pptx.theme = {
    headFontFace: FONT_FACE,
    bodyFontFace: FONT_FACE,
    lang: 'zh-CN',
  };

  for (let index = 0; index < model.slides.length; index += 1) {
    const item = model.slides[index];
    if (item.type === 'cover' || index === 0) createCoverSlide(pptx, model, item, theme, options);
    else await createContentSlide(pptx, model, item, theme, options);
  }

  try {
    await pptx.writeFile({ fileName: filePath, compression: true });
    const buffer = await fs.readFile(filePath);
    if (buffer.length < 1024 || !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw rendererError('生成的 PPTX 文件结构不完整', 'PPTX_FILE_INVALID');
    }
    return {
      filePath,
      fileName,
      storagePath: path.relative(ARTIFACT_STORAGE_ROOT, filePath).replace(/\\/g, '/'),
      fileUrl: null,
      mimeType: PPTX_MIME,
      fileSizeBytes: buffer.length,
      checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
      slidesJson: model,
    };
  } catch (error) {
    await fs.unlink(filePath).catch(() => {});
    if (error.code) throw error;
    throw rendererError('PPTX 文件写入失败，请稍后重试');
  }
}

module.exports = {
  ARTIFACT_STORAGE_ROOT,
  PPTX_MIME,
  normalizeSlidesJson,
  renderTeachingPptx,
  createCoverSlide,
  createContentSlide,
  addSpeakerNotes,
  resolveImageForSlide,
  ensureOutputDir,
};
