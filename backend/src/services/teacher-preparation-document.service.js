const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { TextDecoder } = require('util');
const mammoth = require('mammoth');
const katex = require('katex');
const { Marked } = require('marked');
const { imageSize } = require('image-size');
const {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun,
  LevelFormat, Math: OfficeMath, MathFraction, MathRadical, MathRun, MathSubScript,
  MathSubSuperScript, MathSuperScript, Packer, PageBreak, PageNumber, Paragraph,
  Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType,
} = require('docx');
const prisma = require('../config/prisma');
const teacherAiService = require('./teacher-ai.service');
const preparationService = require('./teacher-preparation.service');
const documentConversionService = require('./document-conversion.service');
const artifactExportService = require('../modules/file-generator/artifact-export.service');
const { parseFile, cleanText } = require('../modules/knowledge-base/knowledge-document-pipeline.service');
const {
  ensureCourseAccess, ensureDocumentAccess, ensureTeachingClassAccess,
  getAccessibleCourseIds, getAccessibleTeachingClassIds, isAdmin,
} = require('./teacher-access.service');

const PROJECT_STORAGE_ROOT = path.resolve(__dirname, '../../../storage');
const BACKEND_STORAGE_ROOT = path.resolve(__dirname, '../../storage');
const ARTIFACT_STORAGE_ROOT = path.resolve(BACKEND_STORAGE_ROOT, 'generated-artifacts');
const IMPORT_STORAGE_ROOT = path.resolve(PROJECT_STORAGE_ROOT, 'lesson-plans/imports');
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const DOCX_CONTENT_WIDTH_DXA = 10200;
const DOCX_CELL_MARGINS = { top: 90, bottom: 90, left: 120, right: 120 };
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PPT_MIME = 'application/vnd.ms-powerpoint';
const ALLOWED_EXTENSIONS = new Set(['.docx', '.pdf', '.md', '.txt', '.ppt', '.pptx']);
const MIME_BY_EXTENSION = {
  '.docx': new Set([WORD_MIME, 'application/octet-stream']),
  '.pdf': new Set(['application/pdf', 'application/octet-stream']),
  '.md': new Set(['text/markdown', 'text/plain', 'application/octet-stream']),
  '.txt': new Set(['text/plain', 'application/octet-stream']),
  '.ppt': new Set([PPT_MIME, 'application/octet-stream']),
  '.pptx': new Set([PPTX_MIME, 'application/zip', 'application/octet-stream']),
};
const REVISION_TYPES = new Set([
  'teacher_manual', 'ai_insert', 'ai_replace', 'docx_import', 'pdf_extract',
  'platform_resource', 'ppt_context', 'stage_sync', 'version_restore',
]);
const SECTION_MAP = {
  classProfile: '教学背景', studentAnalytics: '学情分析', teachingObjectives: '教学目标',
  keyPoints: '教学重点', difficultPoints: '教学难点', timeAllocation: '教学过程',
  lessonIntroduction: '课堂引入', activities: '教学活动', questions: '提问设计',
  exercises: '例题与练习', differentiatedInstruction: '分层教学', assessments: '课堂评价',
  homework: '作业设计', resources: '教学资源', blackboardDesign: '板书设计', reflection: '教学反思',
};
const STANDARD_SECTIONS = Object.values(SECTION_MAP);

function formulaSpan(latex, display) {
  return `<span class="formula" data-formula="${escapeHtml(String(latex || '').trim())}" data-display="${display ? 'block' : 'inline'}">${escapeHtml(String(latex || '').trim())}</span>`;
}

const markdownParser = new Marked({ gfm: true, breaks: false });
markdownParser.use({ extensions: [
  {
    name: 'discimindBlockFormula', level: 'block',
    start: (source) => source.indexOf('$$'),
    tokenizer(source) {
      const match = /^\$\$\s*([\s\S]+?)\s*\$\$(?:\n|$)/.exec(source);
      return match ? { type: 'discimindBlockFormula', raw: match[0], latex: match[1] } : undefined;
    },
    renderer: (token) => `<p style="text-align:center">${formulaSpan(token.latex, true)}</p>\n`,
  },
  {
    name: 'discimindInlineFormula', level: 'inline',
    start: (source) => source.indexOf('$'),
    tokenizer(source) {
      const match = /^\$(?!\$)((?:\\.|[^$\\])+?)\$/.exec(source);
      return match ? { type: 'discimindInlineFormula', raw: match[0], latex: match[1] } : undefined;
    },
    renderer: (token) => formulaSpan(token.latex, false),
  },
] });

function serviceError(message, code = 40001, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function positiveId(value, name = 'id') {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw serviceError(`${name} 参数不合法`);
  return parsed;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function decodeHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return named[entity.toLowerCase()] || '';
  });
}

function plainTextFromHtml(html) {
  return decodeHtml(String(html || '')
    .replace(/<(script|style|iframe|object|svg)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(h[1-4]|p|div|li|blockquote|pre|tr|table)>/gi, '\n')
    .replace(/<t[dh]\b[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function codeTextFromHtml(html) {
  return decodeHtml(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+|\n+$/g, '');
}

function sanitizeAttributes(tag, rawAttributes) {
  const attributes = [];
  const parsed = String(rawAttributes || '').matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g);
  for (const match of parsed) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name.startsWith('on')) continue;
    if (name === 'id' && /^section-[a-z0-9-]{1,80}$/i.test(value)) attributes.push(`id="${escapeHtml(value)}"`);
    else if (name === 'data-section-key' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)) attributes.push(`${name}="${escapeHtml(value)}"`);
    else if (name === 'data-formula' && value.length <= 2000) attributes.push(`${name}="${escapeHtml(value)}"`);
    else if (name === 'data-display' && ['inline', 'block'].includes(value)) attributes.push(`${name}="${value}"`);
    else if (name === 'data-page-break' && value === 'true') attributes.push(`${name}="true"`);
    else if (name === 'class' && /^(formula|document-table|page-break|callout)(\s+(formula|document-table|page-break|callout))*$/.test(value)) attributes.push(`class="${value}"`);
    else if (name === 'style') {
      const safe = [];
      const align = value.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1];
      const indent = value.match(/margin-left\s*:\s*(\d{1,3})px/i)?.[1];
      if (align) safe.push(`text-align:${align.toLowerCase()}`);
      if (indent && Number(indent) <= 120) safe.push(`margin-left:${Number(indent)}px`);
      if (safe.length) attributes.push(`style="${safe.join(';')}"`);
    } else if (['colspan', 'rowspan'].includes(name) && /^\d{1,2}$/.test(value) && Number(value) <= 20) attributes.push(`${name}="${value}"`);
    else if (['alt', 'title'].includes(name)) attributes.push(`${name}="${escapeHtml(value.slice(0, 500))}"`);
    else if (name === 'href' && (value.startsWith('#') || value.startsWith('/api/'))) attributes.push(`href="${escapeHtml(value)}"`);
    else if (name === 'src' && tag === 'img') {
      const dataImage = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
      const internal = /^\/api\/teacher\/preparation\//.test(value);
      if (dataImage || internal) attributes.push(`src="${escapeHtml(value)}"`);
    }
  }
  return attributes.length ? ` ${attributes.join(' ')}` : '';
}

function sanitizeHtml(input) {
  const allowed = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'img', 'hr', 'span', 'a', 'sub', 'sup']);
  let html = String(input || '').slice(0, MAX_HTML_BYTES);
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[\s\S]*?>/gi, '');
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|video|audio|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|video|audio|svg|math)\b[^>]*\/?\s*>/gi, '');
  html = html.replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi, (whole, rawTag, rawAttributes) => {
    const tag = rawTag.toLowerCase();
    if (!allowed.has(tag)) return '';
    if (whole.startsWith('</')) return ['br', 'img', 'hr'].includes(tag) ? '' : `</${tag}>`;
    const attributes = sanitizeAttributes(tag, rawAttributes);
    return `<${tag}${attributes}>`;
  });
  return html.trim() || '<p><br></p>';
}

function slug(value, index) {
  const ascii = String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `section-${ascii || index + 1}-${index + 1}`;
}

function addHeadingIds(html) {
  let index = 0;
  return String(html).replace(/<h([1-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (whole, level, attrs, body) => {
    const text = plainTextFromHtml(body);
    const existing = attrs.match(/\bid="(section-[^"]+)"/i)?.[1];
    const id = existing || slug(text, index);
    index += 1;
    const cleanAttrs = attrs.replace(/\s+id="[^"]*"/gi, '');
    return `<h${level}${cleanAttrs} id="${id}">${body}</h${level}>`;
  });
}

function outlineFromHtml(html) {
  const outline = [];
  for (const match of String(html).matchAll(/<h([1-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)) {
    const title = plainTextFromHtml(match[3]).slice(0, 240);
    if (!title) continue;
    outline.push({ id: match[2].match(/\bid="([^"]+)"/i)?.[1] || slug(title, outline.length), level: Number(match[1]), title });
  }
  return outline;
}

function inlineNodes(html) {
  const atoms = [];
  const marker = (atom) => { atoms.push(atom); return `\uE000${atoms.length - 1}\uE001`; };
  let source = String(html || '')
    .replace(/<span\b([^>]*)data-formula="([^"]*)"([^>]*)>[\s\S]*?<\/span>/gi, (_, before, encoded, after) => marker({ type: 'formula', attrs: { latex: decodeHtml(encoded), display: /data-display="block"/i.test(`${before} ${after}`) } }))
    .replace(/<img\b([^>]*)>/gi, (_, attrs) => {
      const src = decodeHtml(attrs.match(/\bsrc="([^"]*)"/i)?.[1] || '');
      const alt = decodeHtml(attrs.match(/\balt="([^"]*)"/i)?.[1] || '');
      return marker({ type: 'image', attrs: { src, alt } });
    });
  const nodes = [];
  const counts = { bold: 0, italic: 0, underline: 0, strike: 0, code: 0, subscript: 0, superscript: 0 };
  const markByTag = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline', s: 'strike', del: 'strike', code: 'code', sub: 'subscript', sup: 'superscript' };
  const appendText = (value) => {
    const decoded = decodeHtml(value);
    if (!decoded) return;
    const marks = Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0).map(([key]) => [key, true]));
    const parts = decoded.split(/(\uE000\d+\uE001)/g).filter(Boolean);
    for (const part of parts) {
      const atomIndex = part.match(/^\uE000(\d+)\uE001$/)?.[1];
      if (atomIndex !== undefined) nodes.push(atoms[Number(atomIndex)]);
      else nodes.push({ type: 'text', text: part, ...(Object.keys(marks).length ? { marks } : {}) });
    }
  };
  for (const token of source.match(/<[^>]+>|[^<]+/g) || []) {
    if (!token.startsWith('<')) { appendText(token); continue; }
    const tagMatch = token.match(/^<\s*(\/)?\s*([a-z0-9]+)/i);
    if (!tagMatch) continue;
    const closing = Boolean(tagMatch[1]);
    const tag = tagMatch[2].toLowerCase();
    if (tag === 'br' && !closing) { appendText('\n'); continue; }
    const mark = markByTag[tag];
    if (mark) counts[mark] = Math.max(0, counts[mark] + (closing ? -1 : 1));
  }
  return nodes.length ? nodes : [{ type: 'text', text: '' }];
}

function contentJsonFromHtml(html, metadata = {}) {
  const content = [];
  const blockPattern = /<(h[1-4]|p|div|blockquote|pre|ul|ol|table)\b([^>]*)>([\s\S]*?)<\/\1>|<(hr|img)\b([^>]*)>/gi;
  for (const match of String(html).matchAll(blockPattern)) {
    const tag = (match[1] || match[4]).toLowerCase();
    const attrs = match[2] || match[5] || '';
    const body = match[3] || '';
    const style = attrs.match(/style="([^"]+)"/i)?.[1] || '';
    const align = style.match(/text-align:(left|center|right|justify)/i)?.[1] || null;
    if (/^h[1-4]$/.test(tag)) content.push({ type: 'heading', attrs: { level: Number(tag[1]), id: attrs.match(/id="([^"]+)"/i)?.[1] || null, align }, content: inlineNodes(body) });
    else if (tag === 'p' || tag === 'div') content.push({ type: 'paragraph', attrs: { align, indent: Number(style.match(/margin-left:(\d+)px/i)?.[1] || 0) }, content: inlineNodes(body) });
    else if (tag === 'blockquote') content.push({ type: 'blockquote', content: inlineNodes(body) });
    else if (tag === 'pre') content.push({ type: 'code_block', content: [{ type: 'text', text: codeTextFromHtml(body) }] });
    else if (tag === 'ul' || tag === 'ol') {
      const items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => ({ type: 'list_item', content: inlineNodes(item[1]) }));
      content.push({ type: 'list', attrs: { ordered: tag === 'ol' }, content: items });
    } else if (tag === 'table') {
      const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => ({ type: 'table_row', content: [...row[1].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((cell) => ({ type: 'table_cell', attrs: { header: cell[1].toLowerCase() === 'h' }, content: inlineNodes(cell[2]) })) }));
      content.push({ type: 'table', content: rows });
    } else if (tag === 'hr') content.push({ type: attrs.includes('data-page-break="true"') ? 'page_break' : 'horizontal_rule' });
    else if (tag === 'img') content.push({ type: 'image', attrs: { src: attrs.match(/src="([^"]+)"/i)?.[1] || '', alt: decodeHtml(attrs.match(/alt="([^"]*)"/i)?.[1] || '') } });
  }
  if (!content.length) content.push({ type: 'paragraph', content: [{ type: 'text', text: plainTextFromHtml(html) }] });
  return { type: 'doc', content, metadata };
}

function normalizeRichDocument({ html, title, metadata = {} }) {
  if (Buffer.byteLength(String(html || ''), 'utf8') > MAX_HTML_BYTES) throw serviceError('教案内容过大，单份教案最多 4MB');
  const sanitizedHtml = addHeadingIds(sanitizeHtml(html));
  const plainText = plainTextFromHtml(sanitizedHtml);
  const outline = outlineFromHtml(sanitizedHtml);
  return {
    title: String(title || outline[0]?.title || '未命名教案').trim().slice(0, 240) || '未命名教案',
    sanitizedHtml, plainText, outline,
    contentJson: contentJsonFromHtml(sanitizedHtml, { ...metadata, formatVersion: 1 }),
    metadata: { ...metadata, formatVersion: 1, wordCount: plainText.replace(/\s/g, '').length },
  };
}

function narrative(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => narrative(item)).filter(Boolean).join('\n');
  return Object.entries(value).filter(([key]) => key !== 'teacherNarratives').map(([key, item]) => `${key}：${narrative(item)}`).join('\n');
}

function planToHtml(plan, content) {
  const teacherNarratives = content?.teacherNarratives || {};
  const sections = Object.entries(SECTION_MAP).map(([key, label]) => {
    const value = teacherNarratives[key] || narrative(content?.[key]);
    return `<h2 data-section-key="${key}">${escapeHtml(label)}</h2>${String(value || '').split(/\n{2,}/).filter(Boolean).map((item) => `<p>${escapeHtml(item).replace(/\n/g, '<br>')}</p>`).join('') || '<p><br></p>'}`;
  }).join('');
  return `<h1>${escapeHtml(plan.topic)}教学设计</h1><p>${escapeHtml(plan.course?.course_name || '')} · ${escapeHtml(plan.teaching_class?.teaching_class_name || '')} · ${plan.duration_minutes || 45} 分钟</p>${sections}`;
}

function blankTemplate(title, mode = 'blank') {
  if (mode === 'blank') return `<h1>${escapeHtml(title)}</h1><p><br></p>`;
  return `<h1>${escapeHtml(title)}</h1>${STANDARD_SECTIONS.map((section) => `<h2>${escapeHtml(section)}</h2><p><br></p>`).join('')}`;
}

async function ensurePlanAccess(user, lessonPlanId) {
  const id = positiveId(lessonPlanId, 'lesson_plan_id');
  const plan = await prisma.lessonPlan.findFirst({
    where: { lesson_plan_id: id, archived_at: null, ...(isAdmin(user) ? {} : { teacher_user_id: user.user_id }) },
    include: { course: true, teaching_class: true, versions: { orderBy: { version_number: 'desc' }, take: 1 } },
  });
  if (!plan) throw serviceError('备课方案不存在或无权访问', 40301);
  return plan;
}

async function ensureEditableAccess(user, documentId) {
  const document = await prisma.editableTeachingDocument.findFirst({
    where: { id: positiveId(documentId, 'document_id'), deleted_at: null, ...(isAdmin(user) ? {} : { owner_user_id: user.user_id }) },
    include: { current_version: true, course: true, teaching_class: true, lesson_plan: true, source_resource: true, source_artifact: true },
  });
  if (!document) throw serviceError('教案文档不存在或无权访问', 40301);
  return document;
}

function serializeVersion(version, includeContent = true) {
  if (!version) return null;
  return {
    id: version.id, version_number: version.version_number, parent_version_id: version.parent_version_id,
    title: version.title, source_type: String(version.source_type || '').toLowerCase(),
    change_summary: version.change_summary, created_at: version.created_at?.toISOString?.() || version.created_at,
    published_at: version.published_at?.toISOString?.() || version.published_at || null,
    creator_name: version.creator?.profile?.real_name || version.creator?.username || null,
    ...(includeContent ? { content: version.content_json, sanitized_html: version.sanitized_html, plain_text: version.plain_text, outline: version.outline_json, metadata: version.metadata_json || {} } : {}),
  };
}

function serializeDocument(document) {
  return {
    id: document.id, lesson_plan_id: document.lesson_plan_id, course_id: document.course_id,
    teaching_class_id: document.teaching_class_id, title: document.title,
    document_type: String(document.document_type || '').toLowerCase(), source_type: String(document.source_type || '').toLowerCase(),
    source_resource_id: document.source_resource_id, source_artifact_id: document.source_artifact_id,
    current_version_id: document.current_version_id, revision: document.revision, status: String(document.status || '').toLowerCase(),
    course_name: document.course?.course_name || null, teaching_class_name: document.teaching_class?.teaching_class_name || null,
    lesson_plan_title: document.lesson_plan?.topic || null, updated_at: document.updated_at?.toISOString?.() || document.updated_at,
    current_version: serializeVersion(document.current_version),
  };
}

async function persistNewDocument(user, input) {
  const rich = normalizeRichDocument(input);
  return prisma.$transaction(async (tx) => {
    const document = await tx.editableTeachingDocument.create({ data: {
      owner_user_id: user.user_id, lesson_plan_id: input.lessonPlanId || null, course_id: input.courseId || null,
      teaching_class_id: input.teachingClassId || null, title: rich.title, document_type: input.documentType || 'LESSON_PLAN',
      source_type: input.sourceType || 'BLANK', source_resource_id: input.sourceResourceId || null,
      source_artifact_id: input.sourceArtifactId || null, status: 'DRAFT', revision: 1,
    } });
    const version = await tx.editableTeachingDocumentVersion.create({ data: {
      document_id: document.id, version_number: 1, title: rich.title, content_json: rich.contentJson,
      sanitized_html: rich.sanitizedHtml, plain_text: rich.plainText, outline_json: rich.outline,
      metadata_json: rich.metadata, source_type: input.sourceType || 'BLANK',
      change_summary: input.changeSummary || '创建教案草稿', created_by_user_id: user.user_id,
    } });
    await tx.editableTeachingDocument.update({ where: { id: document.id }, data: { current_version_id: version.id } });
    await tx.documentRevision.create({ data: {
      document_id: document.id, version_id: version.id, operation_id: input.operationId || crypto.randomUUID(),
      revision_type: String(input.revisionType || input.sourceType || 'teacher_manual').toLowerCase(),
      instruction: input.changeSummary || null, after_content: rich.contentJson,
      source_context: input.sourceContext || null, created_by_user_id: user.user_id,
    } });
    return document.id;
  });
}

async function listDocuments(user, query = {}) {
  const where = { deleted_at: null, ...(isAdmin(user) ? {} : { owner_user_id: user.user_id }) };
  if (query.lesson_plan_id) where.lesson_plan_id = positiveId(query.lesson_plan_id, 'lesson_plan_id');
  if (query.course_id) { await ensureCourseAccess(user, query.course_id); where.course_id = Number(query.course_id); }
  const rows = await prisma.editableTeachingDocument.findMany({
    where, orderBy: { updated_at: 'desc' }, take: 100,
    include: { current_version: true, course: true, teaching_class: true, lesson_plan: true },
  });
  return { list: rows.map(serializeDocument) };
}

async function createDocument(user, body = {}) {
  const lessonPlanId = body.lesson_plan_id ? positiveId(body.lesson_plan_id, 'lesson_plan_id') : null;
  let plan = null;
  if (lessonPlanId) plan = await ensurePlanAccess(user, lessonPlanId);
  const courseId = plan?.course_id || (body.course_id ? await ensureCourseAccess(user, body.course_id) : null);
  const teachingClassId = plan?.teaching_class_id || (body.teaching_class_id ? positiveId(body.teaching_class_id, 'teaching_class_id') : null);
  if (teachingClassId) await ensureTeachingClassAccess(user, teachingClassId);
  const title = String(body.title || (plan ? `${plan.topic}教学设计` : '未命名教案')).trim().slice(0, 240);
  const mode = String(body.creation_mode || 'blank').toLowerCase();
  let html = body.sanitized_html || blankTemplate(title, mode === 'template' ? 'template' : 'blank');
  let sourceType = 'BLANK';
  let sourceContext = null;
  if (mode === 'plan' && plan) { html = planToHtml(plan, plan.versions[0]?.merged_content_json || {}); sourceType = 'LESSON_PLAN'; }
  if (mode === 'ppt') {
    const pptContext = await resolvePptContext(user, { pptResourceId: body.ppt_resource_id, slideIndex: body.slide_index });
    if (!pptContext) throw serviceError('请先在左侧选择 PPT/PPTX 课件页面');
    const slideParagraphs = String(pptContext.slideText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean);
    const noteParagraphs = String(pptContext.slideNotes || '').split(/\n+/).map((item) => item.trim()).filter(Boolean);
    html = `<h1>${escapeHtml(title)}</h1><h2>当前页教学主题</h2><p>${escapeHtml(pptContext.slideTitle)}</p><h2>课件要点</h2>${slideParagraphs.map((item) => `<p>${escapeHtml(item)}</p>`).join('') || '<p><br></p>'}<h2>演讲与过渡提示</h2>${noteParagraphs.map((item) => `<p>${escapeHtml(item)}</p>`).join('') || '<p><br></p>'}<h2>教学活动</h2><p><br></p><h2>课堂提问</h2><p><br></p>`;
    sourceType = 'PPT_CONTEXT';
    sourceContext = { pptResourceId: pptContext.pptResourceId, slideIndex: pptContext.slideIndex, slideTitle: pptContext.slideTitle };
  }
  const id = await persistNewDocument(user, { title, html, lessonPlanId, courseId, teachingClassId, sourceType, revisionType: sourceType === 'PPT_CONTEXT' ? 'ppt_context' : sourceType.toLowerCase(), sourceContext, changeSummary: mode === 'ppt' ? '根据当前 PPT 页面创建教案框架' : '创建教案草稿' });
  return getDocument(user, id);
}

async function getDocument(user, documentId) {
  return serializeDocument(await ensureEditableAccess(user, documentId));
}

function normalizeRevisionType(value) {
  const normalized = String(value || 'teacher_manual').toLowerCase();
  if (!REVISION_TYPES.has(normalized)) throw serviceError('revision_type 不受支持');
  return normalized;
}

async function saveDraft(user, documentId, body = {}) {
  const document = await ensureEditableAccess(user, documentId);
  const expected = Number.parseInt(body.revision, 10);
  if (!Number.isInteger(expected)) throw serviceError('缺少当前 revision');
  if (expected !== document.revision) throw serviceError('教案已在其他位置更新，请先比较服务器版本', 40901, { serverRevision: document.revision });
  const operationId = String(body.operation_id || crypto.randomUUID()).slice(0, 80);
  const existing = await prisma.documentRevision.findUnique({ where: { operation_id: operationId } });
  if (existing) return getDocument(user, document.id);
  const revisionType = normalizeRevisionType(body.revision_type);
  const rich = normalizeRichDocument({ html: body.sanitized_html, title: body.title || document.title, metadata: body.metadata || {} });
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.editableTeachingDocument.updateMany({ where: { id: document.id, revision: expected }, data: { revision: { increment: 1 }, title: rich.title, status: 'DRAFT' } });
    if (claimed.count !== 1) throw serviceError('教案出现保存冲突，请比较服务器版本', 40901);
    let version = document.current_version;
    if (!version || version.published_at) {
      const maximum = await tx.editableTeachingDocumentVersion.aggregate({ where: { document_id: document.id }, _max: { version_number: true } });
      version = await tx.editableTeachingDocumentVersion.create({ data: {
        document_id: document.id, version_number: (maximum._max.version_number || 0) + 1,
        parent_version_id: document.current_version_id, title: rich.title, content_json: rich.contentJson,
        sanitized_html: rich.sanitizedHtml, plain_text: rich.plainText, outline_json: rich.outline,
        metadata_json: rich.metadata, source_type: revisionType.toUpperCase(), change_summary: '发布版本后的新草稿', created_by_user_id: user.user_id,
      } });
      await tx.editableTeachingDocument.update({ where: { id: document.id }, data: { current_version_id: version.id } });
    } else {
      version = await tx.editableTeachingDocumentVersion.update({ where: { id: version.id }, data: {
        title: rich.title, content_json: rich.contentJson, sanitized_html: rich.sanitizedHtml,
        plain_text: rich.plainText, outline_json: rich.outline, metadata_json: rich.metadata,
        source_type: revisionType.toUpperCase(), change_summary: body.change_summary || '自动保存草稿',
      } });
    }
    await tx.documentRevision.create({ data: {
      document_id: document.id, version_id: version.id, operation_id: operationId,
      revision_type: revisionType, instruction: String(body.instruction || body.change_summary || '').slice(0, 5000) || null,
      before_content: document.current_version?.content_json || null, after_content: rich.contentJson,
      source_context: body.source_context || null, created_by_user_id: user.user_id,
    } });
  });
  return getDocument(user, document.id);
}

async function createVersion(user, documentId, body = {}) {
  const document = await ensureEditableAccess(user, documentId);
  if (!document.current_version) throw serviceError('当前教案没有可保存内容');
  const created = await prisma.$transaction(async (tx) => {
    const maximum = await tx.editableTeachingDocumentVersion.aggregate({ where: { document_id: document.id }, _max: { version_number: true } });
    const version = await tx.editableTeachingDocumentVersion.create({ data: {
      document_id: document.id, version_number: (maximum._max.version_number || 0) + 1,
      parent_version_id: document.current_version.id, title: document.title,
      content_json: document.current_version.content_json, sanitized_html: document.current_version.sanitized_html,
      plain_text: document.current_version.plain_text, outline_json: document.current_version.outline_json,
      metadata_json: document.current_version.metadata_json, source_type: String(body.source_type || 'TEACHER_MANUAL').toUpperCase(),
      change_summary: String(body.change_summary || '教师创建版本').slice(0, 500), created_by_user_id: user.user_id,
      published_at: body.publish === true ? new Date() : null,
    } });
    await tx.editableTeachingDocument.update({ where: { id: document.id }, data: { current_version_id: version.id, revision: { increment: 1 }, status: body.publish === true ? 'PUBLISHED' : 'DRAFT' } });
    return version;
  });
  return serializeVersion(created);
}

async function listVersions(user, documentId) {
  const document = await ensureEditableAccess(user, documentId);
  const versions = await prisma.editableTeachingDocumentVersion.findMany({
    where: { document_id: document.id }, orderBy: { version_number: 'desc' },
    include: { creator: { include: { profile: true } } },
  });
  return { current_version_id: document.current_version_id, list: versions.map((version) => serializeVersion(version, false)) };
}

async function getVersion(user, documentId, versionId) {
  const document = await ensureEditableAccess(user, documentId);
  const version = await prisma.editableTeachingDocumentVersion.findFirst({
    where: { id: positiveId(versionId, 'version_id'), document_id: document.id },
    include: { creator: { include: { profile: true } } },
  });
  if (!version) throw serviceError('教案版本不存在', 40002);
  return serializeVersion(version);
}

function lineDiff(before, after) {
  const oldLines = String(before || '').split('\n');
  const newLines = String(after || '').split('\n');
  const limit = Math.max(oldLines.length, newLines.length);
  const changes = [];
  for (let index = 0; index < limit && changes.length < 500; index += 1) {
    if (oldLines[index] !== newLines[index]) changes.push({ line: index + 1, before: oldLines[index] || '', after: newLines[index] || '' });
  }
  return changes;
}

async function compareVersions(user, documentId, fromId, toId) {
  const [from, to] = await Promise.all([getVersion(user, documentId, fromId), getVersion(user, documentId, toId)]);
  return { from, to, changes: lineDiff(from.plain_text, to.plain_text) };
}

async function restoreVersion(user, documentId, versionId) {
  const document = await ensureEditableAccess(user, documentId);
  const source = await getVersion(user, document.id, versionId);
  const maximum = await prisma.editableTeachingDocumentVersion.aggregate({ where: { document_id: document.id }, _max: { version_number: true } });
  const restored = await prisma.$transaction(async (tx) => {
    const version = await tx.editableTeachingDocumentVersion.create({ data: {
      document_id: document.id, version_number: (maximum._max.version_number || 0) + 1,
      parent_version_id: source.id, title: source.title, content_json: source.content,
      sanitized_html: source.sanitized_html, plain_text: source.plain_text, outline_json: source.outline,
      metadata_json: source.metadata, source_type: 'VERSION_RESTORE', change_summary: `恢复自 V${source.version_number}`,
      created_by_user_id: user.user_id,
    } });
    await tx.editableTeachingDocument.update({ where: { id: document.id }, data: { current_version_id: version.id, revision: { increment: 1 }, title: source.title, status: 'DRAFT' } });
    await tx.documentRevision.create({ data: {
      document_id: document.id, version_id: version.id, operation_id: crypto.randomUUID(), revision_type: 'version_restore',
      instruction: `恢复自 V${source.version_number}`, before_content: document.current_version?.content_json || null,
      after_content: source.content, created_by_user_id: user.user_id,
    } });
    return version;
  });
  return serializeVersion(restored);
}

function safeOriginalName(name) {
  const normalized = String(name || '').normalize('NFKC');
  const base = path.basename(normalized);
  if (!base || base !== normalized || /[\x00-\x1f<>:"/\\|?*]/.test(base)) throw serviceError('文件名不安全');
  return base.slice(0, 180);
}

function validateUpload(file) {
  if (!file?.buffer?.length) throw serviceError('请选择要导入的文件');
  if (file.buffer.length > MAX_FILE_BYTES) throw serviceError('文件超过 20MB 限制');
  const name = safeOriginalName(file.originalname);
  const extension = path.extname(name).toLowerCase();
  if (extension === '.docm') throw serviceError('不支持含宏的 DOCM 文件；宏不会被执行');
  if (!ALLOWED_EXTENSIONS.has(extension)) throw serviceError('仅支持 PPT/PPTX、DOCX、PDF、Markdown 和 TXT');
  const mime = String(file.mimetype || 'application/octet-stream').toLowerCase();
  if (!MIME_BY_EXTENSION[extension].has(mime)) throw serviceError('文件 MIME 与扩展名不一致');
  if (extension === '.docx' && !file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw serviceError('DOCX 文件头校验失败');
  if (extension === '.pptx' && !file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw serviceError('PPTX 文件头校验失败');
  if (extension === '.pptx') {
    const manifest = file.buffer.toString('latin1');
    if (!manifest.includes('[Content_Types].xml') || !manifest.includes('ppt/presentation.xml')) throw serviceError('PPTX 文件结构校验失败');
  }
  if (extension === '.ppt' && !file.buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw serviceError('PPT 文件头校验失败');
  if (extension === '.pdf' && file.buffer.subarray(0, 5).toString() !== '%PDF-') throw serviceError('PDF 文件头校验失败');
  if (['.txt', '.md'].includes(extension) && (file.buffer.subarray(0, 4).toString('hex').startsWith('7f454c46') || file.buffer.subarray(0, 2).toString() === 'MZ' || file.buffer.includes(0))) throw serviceError('文本文件内容校验失败');
  if (['.txt', '.md'].includes(extension)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(file.buffer); }
    catch { throw serviceError('文本文件必须使用 UTF-8 编码，请转换编码后重试'); }
  }
  return { name, extension, mime, checksum: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}

function markdownToHtml(markdown) {
  const source = String(markdown || '').replace(/^\uFEFF/, '').slice(0, MAX_HTML_BYTES);
  return markdownParser.parse(source, { async: false });
}

function extractedTextToHtml(text, title) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^\[\[PAGE:\d+\]\]$/.test(line));
  const html = [`<h1>${escapeHtml(title)}</h1>`];
  lines.forEach((line, index) => {
    if (/^#{1,4}\s/.test(line)) {
      const level = Math.min(4, line.match(/^#+/)[0].length); html.push(`<h${level}>${escapeHtml(line.replace(/^#{1,4}\s*/, ''))}</h${level}>`);
    } else if (STANDARD_SECTIONS.some((section) => line === section || line.startsWith(`${section}：`))) html.push(`<h2>${escapeHtml(line.replace(/：$/, ''))}</h2>`);
    else if (index < 3 && line.length < 40 && !/[。！？：；]$/.test(line)) html.push(`<h2>${escapeHtml(line)}</h2>`);
    else html.push(`<p>${escapeHtml(line)}</p>`);
  });
  return html.join('');
}

async function saveImportFile(userId, descriptor, buffer) {
  const directory = path.resolve(IMPORT_STORAGE_ROOT, String(userId));
  const absolute = path.resolve(directory, `${descriptor.checksum}${descriptor.extension}`);
  if (!absolute.startsWith(`${directory}${path.sep}`)) throw serviceError('文件存储路径不安全');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(absolute, buffer, { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
  return { absolute, fileUrl: `/lesson-plans/imports/${userId}/${descriptor.checksum}${descriptor.extension}` };
}

async function createSourceResource(user, descriptor, saved, body, extra = {}) {
  return prisma.knowledgeDocument.create({ data: {
    title: String(body.title || descriptor.name.replace(/\.[^.]+$/, '')).slice(0, 200), original_filename: descriptor.name,
    file_ext: descriptor.extension.slice(1), file_size_bytes: extra.fileSize || null, mime_type: descriptor.mime,
    storage_type: 'LOCAL', file_url: saved.fileUrl, scope_type: 'PERSONAL', visibility: 'PRIVATE',
    course_id: body.course_id ? Number(body.course_id) : null, teaching_class_id: body.teaching_class_id ? Number(body.teaching_class_id) : null,
    lesson_plan_id: body.lesson_plan_id ? Number(body.lesson_plan_id) : null, owner_user_id: user.user_id,
    is_teaching_resource: true, resource_kind: ['.ppt', '.pptx'].includes(descriptor.extension) ? 'presentation' : descriptor.extension === '.pdf' ? 'reference' : 'lesson_plan_source',
    resource_category: ['.ppt', '.pptx'].includes(descriptor.extension) ? '演示课件' : descriptor.extension === '.pdf' ? 'PDF 参考' : '教案源文件', resource_group_id: `import-${descriptor.checksum.slice(0, 32)}`,
    version_source: extra.versionSource || 'LOCAL_IMPORT', parse_status: extra.parsed ? 'PARSED' : 'UPLOADED', review_status: 'APPROVED',
    file_checksum: descriptor.checksum, marketplace_status: 'READY', processing_state: ['.ppt', '.pptx'].includes(descriptor.extension) ? 'preview_unavailable' : extra.parsed ? 'ready' : 'uploaded',
    cleaned_text: extra.cleanedText || null, page_count: extra.pageCount || null, source_artifact_id: extra.sourceArtifactId || null,
    metadata_json: extra.metadataJson || undefined,
  } });
}

async function readResourcePath(resource) {
  const relative = String(resource.file_url || '').replace(/^\/+/, '').replace(/\//g, path.sep);
  if (!relative || relative.includes(`..${path.sep}`)) throw serviceError('资源文件路径不安全');
  const candidates = [path.resolve(PROJECT_STORAGE_ROOT, relative), path.resolve(BACKEND_STORAGE_ROOT, relative)];
  for (const absolute of candidates) {
    const root = absolute.startsWith(BACKEND_STORAGE_ROOT) ? BACKEND_STORAGE_ROOT : PROJECT_STORAGE_ROOT;
    if (!absolute.startsWith(`${root}${path.sep}`)) continue;
    try { await fs.access(absolute); return absolute; } catch {}
  }
  throw serviceError('资源文件不存在', 40002);
}

async function importBufferAsDocument(user, descriptor, buffer, body, source = {}) {
  let html; let warnings = []; let cleanedText = null; let pageCount = 1;
  if (descriptor.extension === '.docx') {
    const result = await mammoth.convertToHtml({ buffer }, {
      includeDefaultStyleMap: true,
      convertImage: mammoth.images.imgElement((image) => image.read('base64').then((data) => ({ src: `data:${image.contentType};base64,${data}` }))),
    });
    html = result.value; warnings = (result.messages || []).map((message) => message.message || String(message));
  } else if (descriptor.extension === '.md') html = markdownToHtml(buffer.toString('utf8'));
  else if (descriptor.extension === '.txt') html = extractedTextToHtml(buffer.toString('utf8'), body.title || descriptor.name.replace(/\.[^.]+$/, ''));
  else if (descriptor.extension === '.pdf') {
    const temporary = source.absolutePath;
    const parsed = await parseFile(temporary, '.pdf');
    pageCount = parsed.pageCount || 1;
    try { cleanedText = cleanText(parsed.text, pageCount); } catch (error) {
      if (error.code === 'DOCUMENT_TEXT_EMPTY') throw serviceError('当前 PDF 为扫描文档，暂时无法直接提取正文；原 PDF 已保留为参考资料', 42202, { scanned: true });
      throw error;
    }
    html = extractedTextToHtml(cleanedText, body.title || `${descriptor.name.replace(/\.[^.]+$/, '')}（可编辑副本）`);
  }
  const documentId = await persistNewDocument(user, {
    title: body.title || descriptor.name.replace(/\.[^.]+$/, ''), html,
    lessonPlanId: body.lesson_plan_id ? Number(body.lesson_plan_id) : null,
    courseId: body.course_id ? Number(body.course_id) : null,
    teachingClassId: body.teaching_class_id ? Number(body.teaching_class_id) : null,
    sourceType: descriptor.extension === '.docx' ? 'DOCX_IMPORT' : descriptor.extension === '.pdf' ? 'PDF_EXTRACT' : 'LOCAL_IMPORT',
    revisionType: descriptor.extension === '.docx' ? 'docx_import' : descriptor.extension === '.pdf' ? 'pdf_extract' : 'platform_resource',
    sourceResourceId: source.resourceId || null, sourceArtifactId: source.artifactId || null,
    changeSummary: descriptor.extension === '.pdf' ? '从 PDF 提取为可编辑副本' : `导入 ${descriptor.name}`,
    sourceContext: { checksum: descriptor.checksum, warnings, pageCount },
  });
  return { document: await getDocument(user, documentId), warnings, cleanedText, pageCount };
}

async function importDocument(user, file, body = {}) {
  if (body.lesson_plan_id) await ensurePlanAccess(user, body.lesson_plan_id);
  if (body.course_id) await ensureCourseAccess(user, body.course_id);
  if (body.teaching_class_id) await ensureTeachingClassAccess(user, body.teaching_class_id);
  if (!file && body.resource_id) return importPlatformResource(user, body);
  if (!file && body.artifact_id) return importPlatformArtifact(user, body);
  const descriptor = validateUpload(file);
  const duplicate = await prisma.knowledgeDocument.findFirst({ where: { owner_user_id: user.user_id, file_checksum: descriptor.checksum, deleted_at: null }, include: { editable_documents: { where: { deleted_at: null }, take: 1 } } });
  if (duplicate?.editable_documents?.[0] && descriptor.extension !== '.pdf') {
    return { duplicate: true, document: await getDocument(user, duplicate.editable_documents[0].id), message: '该文件已导入，已打开现有教案' };
  }
  const saved = await saveImportFile(user.user_id, descriptor, file.buffer);
  let resource = duplicate;
  if (!resource) resource = await createSourceResource(user, descriptor, saved, body, { fileSize: file.buffer.length });
  if (['.ppt', '.pptx'].includes(descriptor.extension)) {
    if (resource.metadata_json?.slides?.length) return { kind: 'ppt', resource: serializeSelectableResource(resource), conversion: { status: 'succeeded', reused: true }, message: 'PPT 课件已打开并复用现有页级预览' };
    return preparePptPreview(user, resource, 'PPT 课件已上传，正在转换为 PDF');
  }
  if (descriptor.extension === '.pdf' && String(body.pdf_action || 'reference') === 'reference') {
    return { kind: 'pdf', resource: serializeSelectableResource(resource), message: 'PDF 以只读参考方式打开；原 PDF 不会被修改' };
  }
  try {
    const result = await importBufferAsDocument(user, descriptor, file.buffer, body, { resourceId: resource.document_id, absolutePath: saved.absolute });
    if (result.cleanedText) await prisma.knowledgeDocument.update({ where: { document_id: resource.document_id }, data: { cleaned_text: result.cleanedText, page_count: result.pageCount, parse_status: 'PARSED', processing_state: 'ready' } });
    return { kind: 'editable', ...result, source_resource: serializeSelectableResource(resource), format_notice: descriptor.extension === '.docx' ? '已保留标题、段落、列表、表格和可提取图片；SmartArt、宏、特殊域及复杂浮动布局不会原样还原，原文件仍可下载。' : null };
  } catch (error) {
    if (error.scanned) error.resource = serializeSelectableResource(resource);
    throw error;
  }
}

function safeSlideImage(value) {
  const image = String(value || '');
  return image.length <= 2 * 1024 * 1024 && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(image) ? image : null;
}

function resourceGroup(resource, context = {}) {
  if (context.lessonPlanId && resource.lesson_plan_id === context.lessonPlanId) return 'current_plan';
  if (resource.source_artifact_id) return 'generated';
  if (resource.knowledge_base_id) return 'knowledge_base';
  if (resource.teaching_class_id) return 'class_resource';
  if (resource.course_id) return 'course_resource';
  if (resource.is_teaching_resource) return 'teacher_resource';
  return 'recent';
}

function serializeSelectableResource(resource, context = {}) {
  const slides = Array.isArray(resource.metadata_json?.slides) ? resource.metadata_json.slides : [];
  const conversion = resource.metadata_json?.conversion || null;
  return {
    id: resource.document_id, source_kind: 'resource', title: resource.title, file_name: resource.original_filename,
    file_ext: String(resource.file_ext || '').toLowerCase(), mime_type: resource.mime_type,
    status: String(resource.marketplace_status || resource.resource_status || 'READY').toLowerCase(),
    group: resourceGroup(resource, context),
    course_id: resource.course_id, teaching_class_id: resource.teaching_class_id, lesson_plan_id: resource.lesson_plan_id,
    slide_count: Number(resource.metadata_json?.slideCount || slides.length || 0),
    preview_status: slides.length || conversion?.status === 'succeeded' ? 'ready' : String(resource.processing_state || 'preview_unavailable').toLowerCase(),
    conversion: conversion ? {
      status: String(conversion.status || resource.processing_state || '').toLowerCase(), task_id: conversion.taskId || null,
      source_resource_id: conversion.sourceResourceId || resource.document_id, output_resource_id: conversion.outputResourceId || null,
      error_code: conversion.errorCode || resource.error_code || null, error_message: conversion.errorMessage || resource.error_message || null,
      retry_count: Number(conversion.retryCount || 0), started_at: conversion.startedAt || null, completed_at: conversion.completedAt || null,
    } : null,
    slides: slides.slice(0, 300).map((slide, index) => ({ index, title: String(slide.title || `第 ${index + 1} 页`).slice(0, 300), text: String(slide.text || '').slice(0, 5000), notes: String(slide.notes || '').slice(0, 3000), image: safeSlideImage(slide.image) })),
    updated_at: resource.updated_at?.toISOString?.() || resource.updated_at,
  };
}

async function preparePptPreview(user, resource, baseMessage) {
  const conversion = await documentConversionService.startConversion(user, resource.document_id);
  const refreshed = await prisma.knowledgeDocument.findUnique({ where: { document_id: resource.document_id } });
  const serialized = serializeSelectableResource(refreshed);
  const ready = serialized.preview_status === 'ready';
  const failed = conversion.status === 'failed';
  return {
    kind: 'ppt', resource: serialized, conversion,
    message: ready ? 'PPT 已转换为 PDF，可连续预览' : failed ? (conversion.error_message || 'PPT 转换失败，原文件仍可下载') : (baseMessage || 'PPT 已上传，正在转换为 PDF'),
  };
}

async function importPlatformResource(user, body) {
  const resource = await ensureDocumentAccess(user, body.resource_id);
  const extension = `.${String(resource.file_ext || '').toLowerCase().replace(/^\./, '')}`;
  if (!ALLOWED_EXTENSIONS.has(extension)) throw serviceError('该平台文件不能在教案工作区打开');
  if (['.ppt', '.pptx'].includes(extension)) return resource.metadata_json?.slides?.length
    ? { kind: 'ppt', resource: serializeSelectableResource(resource), conversion: { status: 'succeeded', reused: true }, message: '已打开平台课件预览' }
    : preparePptPreview(user, resource, '平台课件已打开，正在转换为 PDF');
  if (extension === '.pdf' && String(body.pdf_action || 'reference') === 'reference') return { kind: 'pdf', resource: serializeSelectableResource(resource), message: 'PDF 以只读参考方式打开；原 PDF 不会被修改' };
  const absolute = await readResourcePath(resource);
  const buffer = await fs.readFile(absolute);
  const descriptor = validateUpload({ originalname: resource.original_filename, mimetype: resource.mime_type || MIME_BY_EXTENSION[extension].values().next().value, buffer });
  const result = await importBufferAsDocument(user, descriptor, buffer, { ...body, title: body.title || resource.title }, { resourceId: resource.document_id, absolutePath: absolute });
  return { kind: 'editable', ...result, source_resource: serializeSelectableResource(resource) };
}

async function artifactFile(user, artifactId, requestedFormat) {
  const artifact = await prisma.generatedArtifact.findFirst({
    where: { id: positiveId(artifactId, 'artifact_id'), deletedAt: null, ...(isAdmin(user) ? {} : { ownerUserId: user.user_id }) },
    include: { exports: { where: { status: 'READY', deletedAt: null } } },
  });
  if (!artifact) throw serviceError('产物不存在或无权访问', 40301);
  if (!['READY', 'CONTENT_READY'].includes(artifact.status)) throw serviceError('文件仍在生成，请等待真实任务完成', 40902);
  const preferred = String(requestedFormat || artifact.fileFormat || '').toUpperCase();
  const exported = artifact.exports.find((item) => item.format === preferred) || artifact.exports[0];
  const storagePath = exported?.storagePath || artifact.storagePath;
  if (!storagePath) throw serviceError('产物文件尚未生成', 40902);
  const absolute = path.resolve(ARTIFACT_STORAGE_ROOT, String(storagePath).replace(/\//g, path.sep));
  if (!absolute.startsWith(`${ARTIFACT_STORAGE_ROOT}${path.sep}`)) throw serviceError('产物路径不安全');
  await fs.access(absolute).catch(() => { throw serviceError('产物文件不存在', 40002); });
  const format = exported?.format || preferred;
  return { artifact, absolute, extension: `.${String(format).toLowerCase()}`, mimeType: exported?.mimeType || artifact.mimeType, fileName: artifact.fileName || `${artifact.title}.${String(format).toLowerCase()}` };
}

async function importPlatformArtifact(user, body) {
  const source = await artifactFile(user, body.artifact_id, body.format);
  const buffer = await fs.readFile(source.absolute);
  const descriptor = validateUpload({ originalname: source.fileName, mimetype: source.mimeType || MIME_BY_EXTENSION[source.extension].values().next().value, buffer });
  if (['.ppt', '.pptx'].includes(descriptor.extension)) {
    const duplicate = await prisma.knowledgeDocument.findFirst({ where: { owner_user_id: user.user_id, file_checksum: descriptor.checksum, deleted_at: null } });
    let resource = duplicate;
    if (!resource) {
      const saved = await saveImportFile(user.user_id, descriptor, buffer);
      resource = await createSourceResource(user, descriptor, saved, body, { fileSize: buffer.length, sourceArtifactId: source.artifact.id, versionSource: 'GENERATED_ARTIFACT' });
    }
    return preparePptPreview(user, resource, 'PPT 产物已加入课件工作区，正在转换为 PDF');
  }
  if (descriptor.extension === '.pdf' && String(body.pdf_action || 'reference') === 'reference') {
    return { kind: 'pdf', artifact: { id: source.artifact.id, source_kind: 'artifact', title: source.artifact.title, file_ext: 'pdf', status: 'ready' }, message: 'PDF 以只读参考方式打开；原 PDF 不会被修改' };
  }
  const result = await importBufferAsDocument(user, descriptor, buffer, { ...body, title: body.title || source.artifact.title }, { artifactId: source.artifact.id, absolutePath: source.absolute });
  return { kind: 'editable', ...result };
}

async function listSelectableResources(user, query = {}) {
  const context = {
    lessonPlanId: Number.parseInt(query.context_lesson_plan_id, 10) || null,
    courseId: Number.parseInt(query.context_course_id, 10) || null,
    teachingClassId: Number.parseInt(query.context_teaching_class_id, 10) || null,
  };
  const [courseIds, classIds] = await Promise.all([getAccessibleCourseIds(user), getAccessibleTeachingClassIds(user)]);
  const resourceWhere = {
    deleted_at: null,
    ...(isAdmin(user) ? {} : { OR: [{ owner_user_id: user.user_id }, { course_id: { in: courseIds || [] } }, { teaching_class_id: { in: classIds } }] }),
  };
  if (query.lesson_plan_id) resourceWhere.lesson_plan_id = Number(query.lesson_plan_id);
  if (query.course_id) { await ensureCourseAccess(user, query.course_id); resourceWhere.course_id = Number(query.course_id); }
  if (query.teaching_class_id) { await ensureTeachingClassAccess(user, query.teaching_class_id); resourceWhere.teaching_class_id = Number(query.teaching_class_id); }
  const [resources, documents, artifacts] = await Promise.all([
    prisma.knowledgeDocument.findMany({ where: resourceWhere, orderBy: { updated_at: 'desc' }, take: 100 }),
    prisma.editableTeachingDocument.findMany({ where: { deleted_at: null, ...(isAdmin(user) ? {} : { owner_user_id: user.user_id }) }, orderBy: { updated_at: 'desc' }, take: 50, include: { current_version: true } }),
    prisma.generatedArtifact.findMany({ where: { deletedAt: null, ...(isAdmin(user) ? {} : { ownerUserId: user.user_id }), ...(query.lesson_plan_id ? { lessonPlanId: Number(query.lesson_plan_id) } : {}) }, orderBy: { updatedAt: 'desc' }, take: 50, include: { exports: { where: { deletedAt: null } }, task: true } }),
  ]);
  return {
    list: [
      ...documents.map((item) => ({ id: item.id, source_kind: 'editable', title: item.title, file_ext: 'internal', status: String(item.status).toLowerCase(), group: context.lessonPlanId && item.lesson_plan_id === context.lessonPlanId ? 'current_plan' : 'my_lessons', lesson_plan_id: item.lesson_plan_id, updated_at: item.updated_at.toISOString() })),
      ...resources.filter((item) => ALLOWED_EXTENSIONS.has(`.${String(item.file_ext).toLowerCase()}`) || ['ppt', 'pptx'].includes(String(item.file_ext).toLowerCase())).map((item) => serializeSelectableResource(item, context)),
      ...artifacts.map((item) => {
        const preferredReady = item.exports.find((entry) => entry.status === 'READY' && entry.format === item.fileFormat);
        const readyExport = preferredReady || item.exports.find((entry) => entry.status === 'READY');
        return { id: item.id, source_kind: 'artifact', title: item.title, file_ext: String(readyExport?.format || item.fileFormat || '').toLowerCase(), status: String(item.status).toLowerCase(), task_status: item.task?.status ? String(item.task.status).toLowerCase() : null, group: context.lessonPlanId && item.lessonPlanId === context.lessonPlanId ? 'current_plan' : 'generated', lesson_plan_id: item.lessonPlanId, exports: item.exports.map((entry) => ({ format: String(entry.format).toLowerCase(), status: String(entry.status).toLowerCase() })), updated_at: item.updatedAt.toISOString() };
      }),
    ],
  };
}

async function resolvePptContext(user, input = {}) {
  if (!input.pptResourceId) return null;
  const resource = await ensureDocumentAccess(user, input.pptResourceId);
  if (!['ppt', 'pptx'].includes(String(resource.file_ext).toLowerCase())) throw serviceError('所选资源不是 PPT 课件');
  const slides = Array.isArray(resource.metadata_json?.slides) ? resource.metadata_json.slides : [];
  const requestedIndex = Math.max(0, Number.parseInt(input.slideIndex, 10) || 0);
  const slideIndex = slides.length ? Math.min(slides.length - 1, requestedIndex) : 0;
  const slide = slides[slideIndex] || {};
  return {
    pptResourceId: resource.document_id, slideIndex, slideTitle: String(slide.title || `第 ${slideIndex + 1} 页`).slice(0, 300),
    slideText: String(slide.text || '').slice(0, 5000), slideNotes: String(slide.notes || '').slice(0, 3000),
    slideImage: safeSlideImage(slide.image) ? { available: true, resourceId: resource.document_id, slideIndex } : null,
    previousSlideSummary: String(slides[slideIndex - 1]?.summary || slides[slideIndex - 1]?.text || '').slice(0, 1000),
    nextSlideSummary: String(slides[slideIndex + 1]?.summary || slides[slideIndex + 1]?.text || '').slice(0, 1000),
    previewAvailable: slides.length > 0,
  };
}

async function resolvePdfContext(user, input = {}) {
  if (!input.resourceId) return null;
  const resource = await ensureDocumentAccess(user, input.resourceId);
  if (String(resource.file_ext).toLowerCase() !== 'pdf') throw serviceError('所选参考资料不是 PDF');
  const page = Math.max(1, Number.parseInt(input.pageNumber, 10) || 1);
  const pages = Array.isArray(resource.metadata_json?.pageTexts) ? resource.metadata_json.pageTexts : [];
  return { resourceId: resource.document_id, pageNumber: page, title: resource.title, pageText: String(pages[page - 1] || '').slice(0, 5000), textLayerAvailable: Boolean(pages[page - 1] || resource.cleaned_text) };
}

async function aiRevise(user, documentId, body = {}) {
  const document = await ensureEditableAccess(user, documentId);
  if (Number(body.current_version) !== document.current_version?.version_number) throw serviceError('教案版本已变化，请重新选择文本', 40901);
  const selectedText = String(body.selected_text || '').slice(0, 12000);
  const selectedRange = body.selected_range || {};
  const selectionStart = Number.parseInt(selectedRange.start, 10);
  const selectionEnd = Number.parseInt(selectedRange.end, 10);
  if (selectedText) {
    if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd) || selectionStart < 0 || selectionEnd < selectionStart || selectionEnd - selectionStart !== selectedText.length) throw serviceError('所选文字范围已失效，请重新选择', 40901);
    if (!String(document.current_version?.plain_text || '').includes(selectedText)) throw serviceError('所选文字已不在当前教案版本中，请重新选择', 40901);
  }
  const instruction = String(body.instruction || '').trim();
  if (!instruction) throw serviceError('请输入 AI 修改要求');
  if (Array.from(instruction).length > 5000) throw serviceError('教师当前输入不能超过 5000 字（教案、PPT、PDF 上下文不计入此限制）');
  const [pptContext, pdfContext] = await Promise.all([resolvePptContext(user, body.ppt_context || {}), resolvePdfContext(user, body.pdf_context || {})]);
  const conversation = body.conversation_id ? { id: positiveId(body.conversation_id, 'conversation_id') } : await teacherAiService.createConversation(user, { title: `${document.title} · 教案协同` });
  const result = await teacherAiService.sendMessage(user, conversation.id, {
    content: instruction,
    context: { course_id: document.course_id, teaching_class_id: document.teaching_class_id, lesson_plan_id: document.lesson_plan_id },
    preparation_context: {
      surface: 'preparation_document_revision',
      instruction_policy: '只输出供教师预览的建议正文，不要声称已经修改文档',
      teaching_document: {
        id: document.id,
        version: document.current_version?.version_number,
        selected_text: selectedText || null,
        current_section_text: selectedText ? null : String(document.current_version?.plain_text || '').slice(0, 8000),
      },
      ppt: pptContext,
      pdf: pdfContext,
    },
    assistant_surface: 'preparation_document',
  });
  return {
    proposal: result.assistant_message?.content || '', conversation_id: conversation.id,
    current_version: document.current_version?.version_number, selected_text: selectedText,
    instruction, ppt_context: pptContext, pdf_context: pdfContext, degraded: Boolean(result.provider?.degraded), applied: false,
  };
}

function sectionText(html, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html).match(new RegExp(`<h[1-4]\\b[^>]*>\\s*${escaped}\\s*<\\/h[1-4]>([\\s\\S]*?)(?=<h[1-4]\\b|$)`, 'i'));
  return match ? plainTextFromHtml(match[1]) : '';
}

async function syncStage(user, documentId, body = {}) {
  const document = await ensureEditableAccess(user, documentId);
  if (!document.lesson_plan_id) throw serviceError('当前教案未绑定智慧备课方案');
  const plan = await ensurePlanAccess(user, document.lesson_plan_id);
  const stageKey = String(body.stage_key || '');
  const title = SECTION_MAP[stageKey];
  if (!title) throw serviceError('无法识别要同步的备课阶段');
  const latest = plan.versions[0];
  const locked = Array.isArray(latest?.locked_blocks_json) ? latest.locked_blocks_json : [];
  if (locked.includes(stageKey)) throw serviceError('该智慧备课阶段已锁定，不能直接覆盖', 40903);
  const text = sectionText(document.current_version?.sanitized_html, title);
  if (body.preview_only !== false) return { preview: true, stage_key: stageKey, stage_title: title, content: text, affected_version: latest?.version_number || 0, locked: false };
  const content = { ...(latest?.merged_content_json || {}), teacherNarratives: { ...(latest?.merged_content_json?.teacherNarratives || {}), [stageKey]: text } };
  const saved = await preparationService.saveDraft(user, plan.lesson_plan_id, { content, locked_blocks: locked, change_summary: `从教案同步：${title}` });
  return { preview: false, stage_key: stageKey, lesson_plan_version: saved.version_number };
}

function renderFormulaHtml(html) {
  return String(html).replace(/<span\b([^>]*)data-formula="([^"]*)"([^>]*)>[\s\S]*?<\/span>/gi, (_, before, encoded, after) => {
    const latex = decodeHtml(encoded);
    const displayMode = /data-display="block"/i.test(`${before} ${after}`);
    try { return katex.renderToString(latex, { displayMode, throwOnError: true, output: 'htmlAndMathml', strict: 'ignore', trust: false }); }
    catch (error) { console.warn('[teacher-preparation-document] formula preview degraded:', error.message); return `<code class="formula-fallback">公式降级：${escapeHtml(latex)}</code>`; }
  });
}

function nodeText(node) {
  return (node?.content || []).map((item) => item.type === 'formula' ? item.attrs?.latex || '' : item.text || '').join('');
}

function imageRunFromNode(node) {
  const match = String(node?.attrs?.src || '').match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/is);
  if (!match) return null;
  try {
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > 8 * 1024 * 1024) return null;
    const dimensions = imageSize(data);
    const width = Math.max(1, Number(dimensions.width || 1));
    const height = Math.max(1, Number(dimensions.height || 1));
    // Keep enough vertical room for captions and surrounding rich content. Word can
    // otherwise enter a pagination loop when a tall image, OMML and a code block
    // compete for the same page boundary.
    const scale = Math.min(1, 480 / width, 540 / height);
    return new ImageRun({ data, transformation: { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }, type: match[1].toLowerCase().startsWith('jp') ? 'jpg' : match[1].toLowerCase() });
  } catch (error) {
    console.warn('[teacher-preparation-document] image export degraded:', error.message);
    return null;
  }
}

const LATEX_SYMBOLS = Object.freeze({
  theta: 'θ', sigma: 'σ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', lambda: 'λ', mu: 'μ', pi: 'π',
  sum: '∑', prod: '∏', int: '∫', cdot: '·', times: '×', leq: '≤', geq: '≥', neq: '≠', approx: '≈', infty: '∞',
});
const MATH_SUPERSCRIPT = Object.freeze({ 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', i: 'ⁱ', n: 'ⁿ', m: 'ᵐ', T: 'ᵀ', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾' });
const MATH_SUBSCRIPT = Object.freeze({ 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' });

function compactMathScript(value, alphabet, marker) {
  const normalized = String(value || '').replace(/\\([a-zA-Z]+)/g, (_, name) => LATEX_SYMBOLS[name] || name).replace(/[{}\s]/g, '');
  const converted = [...normalized].map(character => alphabet[character]).join('');
  return converted.length === normalized.length ? converted : `${marker}(${normalized})`;
}

function readLatexArgument(source, start) {
  let cursor = start;
  while (/\s/.test(source[cursor] || '')) cursor += 1;
  if (source[cursor] === '{') {
    let depth = 1;
    let index = cursor + 1;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') depth -= 1;
      index += 1;
    }
    if (depth !== 0) throw new Error('unbalanced formula group');
    return { value: source.slice(cursor + 1, index - 1), end: index };
  }
  if (source[cursor] === '\\') {
    const command = source.slice(cursor).match(/^\\[a-zA-Z]+/)?.[0] || source.slice(cursor, cursor + 2);
    return { value: command, end: cursor + command.length };
  }
  return { value: source[cursor] || '', end: Math.min(source.length, cursor + 1) };
}

function readLatexScripts(source, start) {
  let cursor = start;
  let subScript = null;
  let superScript = null;
  for (let count = 0; count < 2; count += 1) {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    const marker = source[cursor];
    if (marker !== '_' && marker !== '^') break;
    const argument = readLatexArgument(source, cursor + 1);
    if (marker === '_') subScript = argument.value;
    else superScript = argument.value;
    cursor = argument.end;
  }
  return { subScript, superScript, end: cursor };
}

function latexToMathComponents(value) {
  const source = String(value || '').trim().slice(0, 2000);
  if (!source) throw new Error('empty formula');
  const components = [];
  let buffer = '';
  const flush = (isScriptBase = false) => {
    const normalized = buffer.replace(/\s+/g, ' ');
    if (normalized && isScriptBase) {
      const characters = [...normalized];
      const base = characters.pop();
      if (characters.length) components.push(new MathRun(characters.join('')));
      components.push(new MathRun(base));
    } else if (normalized) components.push(new MathRun(normalized));
    buffer = '';
  };
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '\\') {
      flush();
      const commandMatch = source.slice(cursor).match(/^\\([a-zA-Z]+)/);
      if (!commandMatch) {
        buffer += source[cursor + 1] || '';
        cursor += 2;
        continue;
      }
      const command = commandMatch[1];
      cursor += commandMatch[0].length;
      if (command === 'left' || command === 'right') continue;
      if (command === 'frac') {
        const numerator = readLatexArgument(source, cursor);
        const denominator = readLatexArgument(source, numerator.end);
        components.push(new MathFraction({ numerator: latexToMathComponents(numerator.value), denominator: latexToMathComponents(denominator.value) }));
        cursor = denominator.end;
        continue;
      }
      if (command === 'sqrt') {
        const radicand = readLatexArgument(source, cursor);
        components.push(new MathRadical({ children: latexToMathComponents(radicand.value) }));
        cursor = radicand.end;
        continue;
      }
      if (command === 'sum') {
        const scripts = readLatexScripts(source, cursor);
        // Word's PDF renderer can deadlock on a scripted sum when the same
        // document also contains drawings and code. Unicode bounds remain a
        // native editable equation run and avoid exposing raw LaTeX.
        components.push(new MathRun(`${LATEX_SYMBOLS.sum}${scripts.superScript == null ? '' : compactMathScript(scripts.superScript, MATH_SUPERSCRIPT, '^')}${scripts.subScript == null ? '' : compactMathScript(scripts.subScript, MATH_SUBSCRIPT, '_')}`));
        cursor = scripts.end;
        continue;
      }
      if (['text', 'mathrm', 'mathbf', 'operatorname'].includes(command)) {
        const argument = readLatexArgument(source, cursor);
        components.push(...latexToMathComponents(argument.value));
        cursor = argument.end;
        continue;
      }
      components.push(new MathRun(LATEX_SYMBOLS[command] || command));
      continue;
    }
    if (character === '_' || character === '^') {
      flush(true);
      const scripts = readLatexScripts(source, cursor);
      const base = components.pop();
      if (!base) throw new Error('formula script has no base');
      const options = {
        children: [base],
        ...(scripts.subScript == null ? {} : { subScript: latexToMathComponents(scripts.subScript) }),
        ...(scripts.superScript == null ? {} : { superScript: latexToMathComponents(scripts.superScript) }),
      };
      if (scripts.subScript != null && scripts.superScript != null) components.push(new MathSubSuperScript(options));
      else if (scripts.subScript != null) components.push(new MathSubScript(options));
      else components.push(new MathSuperScript(options));
      cursor = scripts.end;
      continue;
    }
    if (character === '{' || character === '}') {
      cursor += 1;
      continue;
    }
    buffer += character;
    cursor += 1;
  }
  flush();
  if (!components.length) throw new Error('empty normalized formula');
  return components;
}

function formulaMath(node) {
  try { return new OfficeMath({ children: latexToMathComponents(node?.attrs?.latex) }); }
  catch (error) {
    console.warn('[teacher-preparation-document] formula DOCX degraded:', error.message);
    return new TextRun({ text: `公式降级：${String(node?.attrs?.latex || '').slice(0, 2000)}`, italics: true, color: '9A3412', font: 'Cambria Math' });
  }
}

function codeParagraphs(node) {
  const lines = String(nodeText(node)).replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line, index) => new Paragraph({
    keepLines: true,
    keepNext: index < lines.length - 1,
    shading: { fill: 'F4F0EA' },
    spacing: { before: index === 0 ? 80 : 0, after: index === lines.length - 1 ? 120 : 0, line: 280 },
    children: [new TextRun({ text: line, font: 'Consolas' })],
  }));
}

function textRuns(node, defaults = {}) {
  const runs = [];
  for (const item of node?.content || []) {
    if (item.type === 'image') {
      const image = imageRunFromNode(item);
      runs.push(image || new TextRun({ text: item.attrs?.alt ? `[图片：${item.attrs.alt}]` : '[图片]' }));
    } else if (item.type === 'formula') {
      runs.push(formulaMath(item));
    } else {
      const marks = item.marks || {};
      runs.push(new TextRun({
        text: item.text || '', bold: defaults.bold || marks.bold || undefined,
        italics: defaults.italics || marks.italic || undefined, underline: marks.underline ? {} : undefined,
        strike: marks.strike || undefined, font: marks.code ? 'Consolas' : defaults.font,
        subScript: marks.subscript || undefined, superScript: marks.superscript || undefined,
        color: defaults.color,
      }));
    }
  }
  return runs.length ? runs : [new TextRun('')];
}

function documentChildren(contentJson) {
  const children = [];
  const headingLevels = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };
  for (const node of contentJson?.content || []) {
    const text = nodeText(node);
    if (node.type === 'heading') children.push(new Paragraph({ heading: headingLevels[node.attrs?.level] || HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 180, after: 100 }, children: textRuns(node, { bold: true, color: '7A4B22' }) }));
    else if (node.type === 'paragraph') {
      const displayFormula = node.content?.length === 1 && node.content[0]?.type === 'formula' && node.content[0]?.attrs?.display;
      children.push(new Paragraph({ alignment: displayFormula ? AlignmentType.CENTER : ({ center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }[node.attrs?.align] || AlignmentType.LEFT), indent: node.attrs?.indent ? { left: Math.min(1440, node.attrs.indent * 12) } : undefined, spacing: { after: displayFormula ? 180 : 100, line: 320 }, children: textRuns(node) }));
    }
    else if (node.type === 'blockquote') children.push(new Paragraph({ indent: { left: 420 }, border: { left: { style: BorderStyle.SINGLE, color: 'C69A68', size: 8, space: 12 } }, children: textRuns(node, { italics: true, color: '6B5A49' }) }));
    else if (node.type === 'code_block') children.push(...codeParagraphs(node));
    else if (node.type === 'list') (node.content || []).forEach((item) => children.push(new Paragraph({ numbering: { reference: node.attrs?.ordered ? 'document-numbering' : 'document-bullets', level: 0 }, children: textRuns(item) })));
    else if (node.type === 'horizontal_rule') children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: 'CFC4B5', size: 4, space: 8 } } }));
    else if (node.type === 'page_break') children.push(new Paragraph({ children: [new PageBreak()] }));
    else if (node.type === 'image') {
      const image = imageRunFromNode(node);
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [image || new TextRun({ text: node.attrs?.alt ? `[图片：${node.attrs.alt}]` : '[图片]' })] }));
    } else if (node.type === 'table') {
      const sourceRows = node.content || [];
      const columnCount = Math.max(0, ...sourceRows.map(row => row.content?.length || 0));
      if (!columnCount) continue;
      const weights = Array.from({ length: columnCount }, (_, column) => Math.max(4, Math.min(32, ...sourceRows.map(row => nodeText(row.content?.[column]).length || 1))));
      const totalWeight = weights.reduce((sum, value) => sum + value, 0);
      const widths = weights.map(value => Math.floor(DOCX_CONTENT_WIDTH_DXA * value / totalWeight));
      widths[widths.length - 1] += DOCX_CONTENT_WIDTH_DXA - widths.reduce((sum, value) => sum + value, 0);
      const rows = sourceRows.map((row, rowIndex) => new TableRow({
        tableHeader: rowIndex === 0 && row.content?.some(cell => cell.attrs?.header), cantSplit: rowIndex === 0,
        children: Array.from({ length: columnCount }, (_, column) => {
          const cell = row.content?.[column] || { content: [{ type: 'text', text: '' }] };
          const header = Boolean(cell.attrs?.header || (rowIndex === 0 && row.content?.some(item => item.attrs?.header)));
          return new TableCell({
            width: { size: widths[column], type: WidthType.DXA }, margins: DOCX_CELL_MARGINS,
            verticalAlign: VerticalAlign.CENTER, shading: header ? { fill: 'EDE6DC' } : undefined,
            children: [new Paragraph({ spacing: { after: 0, line: 280 }, children: textRuns(cell, { bold: header }) })],
          });
        }),
      }));
      children.push(new Table({
        width: { size: DOCX_CONTENT_WIDTH_DXA, type: WidthType.DXA }, indent: { size: 120, type: WidthType.DXA },
        columnWidths: widths, layout: TableLayoutType.FIXED,
        borders: {
          top: { style: BorderStyle.SINGLE, color: 'B9AA98', size: 2 }, bottom: { style: BorderStyle.SINGLE, color: 'B9AA98', size: 2 },
          left: { style: BorderStyle.SINGLE, color: 'B9AA98', size: 2 }, right: { style: BorderStyle.SINGLE, color: 'B9AA98', size: 2 },
          insideHorizontal: { style: BorderStyle.SINGLE, color: 'D8CFC3', size: 1 }, insideVertical: { style: BorderStyle.SINGLE, color: 'D8CFC3', size: 1 },
        }, rows,
      }));
    }
  }
  return children.length ? children : [new Paragraph('')];
}

function buildEditableDocxDocument(title, contentJson, options = {}) {
  const documentTitle = String(title || '未命名教学材料').slice(0, 240);
  const cover = options.includeCover === false ? [] : [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1800, after: 220 }, children: [new TextRun({ text: documentTitle, bold: true, size: 52, color: '7A4B22' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 140 }, children: [new TextRun({ text: options.subtitle || '正式教学设计', size: 26, color: '746352' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: [new TextRun({ text: `DisciMind 学研智擎 · ${new Date().toISOString().slice(0, 10)}`, size: 20, color: '8A7A6A' })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  return new Document({
    creator: 'DisciMind / 学研智擎', title: documentTitle, description: 'DisciMind formal teaching document',
    numbering: { config: [
      { reference: 'document-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 260 } } } }] },
      { reference: 'document-numbering', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 260 } } } }] },
    ] },
    styles: {
      default: { document: { run: { font: { ascii: 'Aptos', hAnsi: 'Aptos', eastAsia: 'Microsoft YaHei' }, size: 22, color: '2F2923' }, paragraph: { spacing: { line: 320 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: '7A4B22' }, paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 29, bold: true, color: '7A4B22' }, paragraph: { spacing: { before: 260, after: 140 }, keepNext: true, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true, color: '5F4935' }, paragraph: { spacing: { before: 220, after: 120 }, keepNext: true, outlineLevel: 2 } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1134, right: 1020, bottom: 1134, left: 1020, header: 620, footer: 620 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: documentTitle, color: '746352', size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'DisciMind 学研智擎  |  第 ', color: '746352', size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: '746352', size: 18 }), new TextRun({ text: ' 页', color: '746352', size: 18 })] })] }) },
      children: [...cover, ...documentChildren(contentJson)],
    }],
  });
}

async function exportDocxArtifact(artifact, version, taskId) {
  const doc = buildEditableDocxDocument(artifact.title, version.content_json, { subtitle: artifact.artifactRole === 'STUDENT_HANDOUT' ? '学生学习材料' : '正式教学设计' });
  const buffer = await Packer.toBuffer(doc);
  if (buffer.length > MAX_FILE_BYTES) throw serviceError('导出的 DOCX 超过 20MB 限制');
  const directory = path.resolve(ARTIFACT_STORAGE_ROOT, String(artifact.ownerUserId), String(artifact.id));
  const fileName = `${artifact.id}-${crypto.randomUUID()}.docx`;
  const absolute = path.resolve(directory, fileName);
  if (!absolute.startsWith(`${directory}${path.sep}`)) throw serviceError('导出路径不安全');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(absolute, buffer, { flag: 'wx' });
  const storagePath = path.relative(ARTIFACT_STORAGE_ROOT, absolute).replace(/\\/g, '/');
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  await prisma.generatedArtifactExport.upsert({ where: { artifactId_format: { artifactId: artifact.id, format: 'DOCX' } }, create: { artifactId: artifact.id, ownerUserId: artifact.ownerUserId, format: 'DOCX', status: 'READY', storagePath, fileSizeBytes: BigInt(buffer.length), mimeType: WORD_MIME, checksum }, update: { status: 'READY', storagePath, fileSizeBytes: BigInt(buffer.length), mimeType: WORD_MIME, checksum, errorCode: null, errorMessage: null, deletedAt: null } });
  await Promise.all([
    prisma.generatedArtifact.update({ where: { id: artifact.id }, data: { status: 'READY', storagePath, fileName: `${version.title}.docx`, mimeType: WORD_MIME, fileSizeBytes: BigInt(buffer.length), checksum } }),
    prisma.asyncTask.update({ where: { id: taskId }, data: { status: 'SUCCEEDED', progress: 100, stage: 'DOCX 已生成', resultType: 'ARTIFACT', resultId: String(artifact.id), resultUrl: `#/teacher/artifacts/${artifact.id}` } }),
  ]);
  return { storagePath, checksum, size: buffer.length };
}

async function retryLessonPlanExportTask(task, options = {}) {
  const artifact = await prisma.generatedArtifact.findUnique({ where: { taskId: Number(task.id) } });
  if (!artifact || artifact.deletedAt || !artifact.contentSchemaJson) {
    throw Object.assign(new Error('教案导出任务缺少可恢复的结构化产物'), {
      code: 'LESSON_PLAN_ARTIFACT_MISSING',
      permanent: true,
      userMessage: '原导出内容已不可用，请从教案页面重新发起导出。',
    });
  }
  if (options.signal?.aborted) throw Object.assign(new Error('教案导出已取消'), { name: 'AbortError', code: 'TASK_CANCELLED' });
  const normalized = String(artifact.fileFormat || artifact.requirementsJson?.format || 'DOCX').toUpperCase();
  if (!['DOCX', 'PDF'].includes(normalized)) {
    throw Object.assign(new Error('教案导出格式不受支持'), { code: 'EXPORT_FORMAT_UNSUPPORTED', permanent: true });
  }
  await prisma.generatedArtifact.update({
    where: { id: artifact.id },
    data: { status: 'CONTENT_READY', errorCode: null },
  });
  if (artifact.artifactType === 'TEACHING_DOCUMENT' && normalized === 'DOCX') {
    return exportDocxArtifact(artifact, { title: artifact.title, content_json: artifact.contentSchemaJson }, task.id);
  }
  return artifactExportService.exportFormat(artifact.id, normalized, { taskId: task.id, signal: options.signal });
}

function studentSafeHtml(html, options = {}) {
  let safe = String(html || '')
    .replace(/<[^>]+class="[^"]*teacher-only[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
    .replace(/<[^>]+data-student-hidden="true"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
  if (!options.include_answers) safe = safe.replace(/<h[1-4]\b[^>]*>\s*(参考答案|答案|教师话术|教学反思)\s*<\/h[1-4]>[\s\S]*?(?=<h[1-4]\b|$)/gi, '');
  return safe;
}

async function createExportTask(user, document, version, format, options = {}) {
  const normalized = String(format || 'DOCX').toUpperCase();
  if (!['DOCX', 'PDF'].includes(normalized)) throw serviceError('仅支持 DOCX 或 PDF 导出');
  const role = options.student ? 'STUDENT_HANDOUT' : 'TEACHER_LESSON_PLAN';
  const operationId = `editdoc:${document.id}:v${version.id}:r${document.revision}:${role}:${normalized}`;
  const previous = await prisma.asyncTask.findUnique({ where: { userId_operationId: { userId: user.user_id, operationId } }, include: { generatedArtifact: true } });
  if (previous?.generatedArtifact) {
    if (previous.generatedArtifact.status === 'READY') return { task_id: previous.id, artifact_id: previous.generatedArtifact.id, status: 'ready', reused: true };
    let status = previous.status;
    if (['FAILED', 'CANCELLED'].includes(status)) {
      const retried = await require('../modules/async-task/async-task.service').retryTask(user.user_id, previous.id);
      status = retried.status;
    }
    return { task_id: previous.id, artifact_id: previous.generatedArtifact.id, status: String(status).toLowerCase(), reused: true, retried: status === 'QUEUED' };
  }
  const task = await prisma.asyncTask.create({ data: { userId: user.user_id, operationId, taskType: 'LESSON_PLAN_EXPORT', title: `${document.title} ${options.student ? '学生材料' : '教案'} ${normalized} 导出`, status: 'RUNNING', stage: `正在生成 ${normalized}`, progress: 5, progressMode: 'DETERMINATE', relatedResourceType: 'EDITABLE_TEACHING_DOCUMENT', relatedResourceId: String(document.id), startedAt: new Date() } });
  const previewHtml = options.student ? studentSafeHtml(version.sanitized_html, options) : version.sanitized_html;
  const artifact = await prisma.generatedArtifact.create({ data: {
    ownerUserId: user.user_id, lessonPlanId: document.lesson_plan_id, taskId: task.id, operationId,
    artifactType: 'TEACHING_DOCUMENT', artifactRole: role, title: options.title || document.title,
    description: options.student ? '由教师教案过滤生成的学生版材料' : '可编辑教案导出', courseId: document.course_id,
    requirementsJson: { editableDocumentId: document.id, versionId: version.id, revision: document.revision, format: normalized, student: Boolean(options.student) },
    contentSchemaJson: contentJsonFromHtml(previewHtml, version.metadata_json || {}),
    previewHtml: renderFormulaHtml(previewHtml), fileFormat: normalized, status: 'CONTENT_READY',
  } });
  queueMicrotask(async () => {
    try {
      if (normalized === 'DOCX') await exportDocxArtifact(artifact, { ...version, content_json: artifact.contentSchemaJson }, task.id);
      else await artifactExportService.exportFormat(artifact.id, 'PDF', { taskId: task.id });
      if (options.student) await createStudentResource(user, document, artifact, normalized, options);
      await prisma.notification.create({ data: { receiver_user_id: user.user_id, notification_type: 'FILE_GENERATED', title: `${artifact.title} ${normalized} 已生成`, content: '文件已进入任务中心和产物中心。', target_type: 'generated_artifact', target_id: artifact.id, business_type: 'editable_teaching_document', business_id: document.id } })
        .catch((error) => console.error('[teacher-preparation-document] export notification failed:', error.message));
    } catch (error) {
      console.error('[teacher-preparation-document] export failed:', error.message);
      await prisma.asyncTask.update({ where: { id: task.id }, data: { status: 'FAILED', stage: `${normalized} 导出失败`, errorCode: String(error.code || 'DOCUMENT_EXPORT_FAILED').slice(0, 100), errorMessage: '教案导出失败，请稍后重试。' } }).catch(() => {});
    }
  });
  return { task_id: task.id, artifact_id: artifact.id, status: 'exporting', format: normalized };
}

async function exportDocument(user, documentId, body = {}) {
  const document = await ensureEditableAccess(user, documentId);
  const version = body.version_id ? await prisma.editableTeachingDocumentVersion.findFirst({ where: { id: Number(body.version_id), document_id: document.id } }) : document.current_version;
  if (!version) throw serviceError('没有可导出的教案版本');
  return createExportTask(user, document, version, body.format);
}

async function createStudentResource(user, document, artifact, format, options) {
  const exported = await prisma.generatedArtifactExport.findUnique({ where: { artifactId_format: { artifactId: artifact.id, format } } });
  if (!exported || exported.status !== 'READY') return null;
  const resource = await prisma.knowledgeDocument.create({ data: {
    title: artifact.title, original_filename: `${artifact.title}.${format.toLowerCase()}`, file_ext: format.toLowerCase(),
    file_size_bytes: Number(exported.fileSizeBytes || 0), mime_type: exported.mimeType, storage_type: 'LOCAL',
    file_url: `/generated-artifacts/${exported.storagePath}`, scope_type: document.teaching_class_id ? 'CLASS' : 'COURSE', visibility: 'PRIVATE',
    course_id: document.course_id, teaching_class_id: document.teaching_class_id, lesson_plan_id: document.lesson_plan_id,
    source_artifact_id: artifact.id, owner_user_id: user.user_id, is_teaching_resource: true,
    resource_kind: options.material_type || 'student_handout', resource_category: '学生材料',
    metadata_json: { editableDocumentId: document.id, versionId: document.current_version_id, filteredForStudents: true },
    resource_group_id: `artifact-${artifact.id}`, resource_version: 1, version_source: 'AI_GENERATED',
    parse_status: 'PARSED', review_status: 'APPROVED', marketplace_status: 'READY', processing_state: 'ready',
  } });
  if (options.publish === true && document.teaching_class_id) {
    const students = await prisma.studentCourseEnrollment.findMany({ where: { teaching_class_id: document.teaching_class_id, enrollment_status: 'active' }, select: { student_user_id: true } });
    const distribution = await prisma.resourceDistribution.create({ data: {
      resource_id: resource.document_id, sender_user_id: user.user_id, course_id: document.course_id,
      teaching_class_id: document.teaching_class_id, title: artifact.title, description: '教师从教案工作区生成并确认下发',
      distribution_type: options.material_type || 'student_handout', resource_version: 1,
      publish_at: options.publish_at ? new Date(options.publish_at) : new Date(), operation_id: `editdoc-share:${artifact.id}`,
      recipients: { create: students.map((item) => ({ student_user_id: item.student_user_id })) },
    } });
    if (students.length) await prisma.notification.createMany({ data: students.map((item) => ({ receiver_user_id: item.student_user_id, sender_user_id: user.user_id, notification_type: 'RESOURCE_SHARED', title: artifact.title, content: '教师已下发新的学习资料。', target_type: 'resource_distribution', target_id: distribution.distribution_id, business_type: 'teaching_resource', business_id: resource.document_id })) });
  }
  return resource;
}

async function generateStudentMaterial(user, documentId, body = {}) {
  const document = await ensureEditableAccess(user, documentId);
  const version = document.current_version;
  if (!version) throw serviceError('当前教案没有可生成的内容');
  const previewHtml = studentSafeHtml(version.sanitized_html, body);
  if (body.preview_only !== false) return { preview: true, sanitized_html: previewHtml, plain_text: plainTextFromHtml(previewHtml), notice: '已默认移除答案、教师话术、教师内部备注和教学反思，请确认后再生成或下发。' };
  return createExportTask(user, document, version, body.format || 'DOCX', { ...body, student: true, title: body.title || `${document.title}·${body.material_type || '学生讲义'}` });
}

async function getSourceFile(user, sourceKind, sourceId, format) {
  if (sourceKind === 'artifact') {
    const source = await artifactFile(user, sourceId, format);
    const fallbackMime = source.extension === '.pdf' ? 'application/pdf' : source.extension === '.docx' ? WORD_MIME : 'application/octet-stream';
    return { absolute: source.absolute, mimeType: !source.mimeType || source.mimeType === 'application/octet-stream' ? fallbackMime : source.mimeType, fileName: source.fileName };
  }
  const resource = await ensureDocumentAccess(user, sourceId);
  const extension = String(resource.file_ext || '').toLowerCase();
  const fallbackMime = extension === 'pdf' ? 'application/pdf' : extension === 'docx' ? WORD_MIME : extension === 'pptx' ? PPTX_MIME : extension === 'ppt' ? PPT_MIME : ['md', 'txt'].includes(extension) ? 'text/plain; charset=utf-8' : 'application/octet-stream';
  const mimeType = !resource.mime_type || resource.mime_type === 'application/octet-stream' ? fallbackMime : resource.mime_type;
  return { absolute: await readResourcePath(resource), mimeType, fileName: resource.original_filename };
}

module.exports = {
  MAX_FILE_BYTES, ALLOWED_EXTENSIONS, SECTION_MAP,
  sanitizeHtml, plainTextFromHtml, outlineFromHtml, contentJsonFromHtml, normalizeRichDocument, buildEditableDocxDocument, latexToMathComponents,
  validateUpload, markdownToHtml, extractedTextToHtml, studentSafeHtml,
  listDocuments, createDocument, getDocument, saveDraft, createVersion, listVersions, getVersion,
  compareVersions, restoreVersion, importDocument, listSelectableResources, aiRevise, syncStage,
  exportDocument, generateStudentMaterial, getSourceFile, retryLessonPlanExportTask,
};
