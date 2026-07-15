const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const prisma = require('../../config/prisma');
const { STORAGE_ROOT, safeArtifactPath, resolveStoredPath } = require('../file-generator/document-export.service');
const { createXlsx } = require('./simple-xlsx');
const { aiError } = require('./errors');
const { normalizeChartArguments } = require('./chart-spec');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function operationId(prefix = 'ai-artifact') { return `${prefix}-${crypto.randomUUID()}`.slice(0, 64); }

async function createRecord(context, input) {
  return prisma.generatedArtifact.create({ data: {
    ownerUserId: Number(context.user.user_id),
    operationId: input.operationId || operationId(), artifactType: input.artifactType,
    title: String(input.title || 'AI 生成成果').slice(0, 200), description: String(input.description || '').slice(0, 5000) || null,
    courseId: Number(input.courseId || context.courseId) || null,
    knowledgePointIdsJson: Array.isArray(input.knowledgePointIds) ? input.knowledgePointIds.map(Number).filter(Number.isInteger) : [],
    requirementsJson: input.requirements || {}, contentSchemaJson: input.content || null,
    previewHtml: input.previewHtml || null, fileFormat: input.fileFormat || 'JSON', status: input.status || 'CONTENT_READY',
    sourceTraceId: context.traceId ? Number(context.traceId) : null,
    sourceAiConversationId: context.conversationId ? Number(context.conversationId) : null,
    sourceMessageId: context.messageId ? Number(context.messageId) : null,
    generator: String(input.generator || 'ai-assistant-tool').slice(0, 64),
    metadataJson: input.metadata || null,
  } });
}

async function writeFileArtifact(context, record, buffer, extension, mimeType) {
  const safeName = `${record.id}.${extension}`;
  const target = safeArtifactPath(context.user.user_id, record.id, safeName);
  await fs.mkdir(target.directory, { recursive: true });
  await fs.writeFile(target.absolute, buffer, { flag: 'wx' });
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const relative = path.relative(STORAGE_ROOT, target.absolute).replace(/\\/g, '/');
  return prisma.generatedArtifact.update({ where: { id: record.id }, data: {
    status: 'READY', storagePath: relative, fileName: safeName, mimeType,
    fileSizeBytes: BigInt(buffer.length), checksum,
  } });
}

async function createDocx(context, input) {
  const sections = Array.isArray(input.sections) ? input.sections.slice(0, 60) : [];
  const previewHtml = `<article class="ai-artifact-document"><h2>${escapeHtml(input.title)}</h2>${sections.map(section => `<section><h3>${escapeHtml(section.heading || '')}</h3><p>${escapeHtml(section.content || '').replace(/\n/g, '<br>')}</p></section>`).join('')}</article>`;
  const record = await createRecord(context, { ...input, artifactType: 'AI_DOCUMENT', fileFormat: 'DOCX', status: 'DRAFT', previewHtml, content: { kind: 'document', sections }, requirements: { confirmed: true, source: 'unified-ai-task-center' } });
  try {
    const children = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: String(input.title || 'AI 文档'), bold: true })] })];
    for (const section of sections) {
      if (section.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: String(section.heading) }));
      String(section.content || '').split(/\r?\n/).forEach(line => children.push(new Paragraph({ text: line })));
    }
    const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
    return await writeFileArtifact(context, record, buffer, 'docx', DOCX_MIME);
  } catch (error) {
    await prisma.generatedArtifact.update({ where: { id: record.id }, data: { status: 'FAILED', errorCode: 'AI_ARTIFACT_GENERATION_FAILED' } }).catch(() => null);
    throw aiError('AI_ARTIFACT_GENERATION_FAILED', undefined, 500, { cause: error.message });
  }
}

async function createSpreadsheet(context, input) {
  const rows = [input.columns || [], ...(input.rows || [])].slice(0, 10001);
  const previewHtml = `<div class="ai-artifact-table"><table><thead><tr>${(input.columns || []).map(item => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead><tbody>${(input.rows || []).slice(0, 50).map(row => `<tr>${row.map(item => `<td>${escapeHtml(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const record = await createRecord(context, { ...input, artifactType: 'AI_SPREADSHEET', fileFormat: 'XLSX', status: 'DRAFT', previewHtml, content: { kind: 'spreadsheet', columns: input.columns, rows: input.rows }, requirements: { confirmed: true, source: 'unified-ai-task-center' } });
  try {
    return await writeFileArtifact(context, record, createXlsx(rows, input.sheetName), 'xlsx', XLSX_MIME);
  } catch (error) {
    await prisma.generatedArtifact.update({ where: { id: record.id }, data: { status: 'FAILED', errorCode: 'AI_ARTIFACT_GENERATION_FAILED' } }).catch(() => null);
    throw aiError('AI_ARTIFACT_GENERATION_FAILED', undefined, 500, { cause: error.message });
  }
}

async function createChart(context, input) {
  const normalized = normalizeChartArguments(input);
  const spec = normalized.value.spec;
  const previewHtml = `<div class="ai-chart-placeholder" data-chart-spec="${escapeHtml(JSON.stringify(spec))}"><strong>${escapeHtml(spec.chart.title)}</strong><p>${escapeHtml(spec.chart.type)} · ${spec.chart.xAxis.length} 个数据点</p></div>`;
  return createRecord(context, {
    ...input,
    title: spec.chart.title,
    artifactType: 'AI_CHART',
    fileFormat: 'ECHARTS',
    status: 'CONTENT_READY',
    previewHtml,
    content: spec,
    requirements: { source: 'unified-ai-task-center', chartSource: spec.source, normalizerRepairs: normalized.repairs },
  });
}

async function createCards(context, input) {
  const cards = (input.cards || []).slice(0, 100);
  const previewHtml = `<div class="ai-knowledge-cards">${cards.map(card => {
    const title = card.title || card.front || '知识卡片';
    const summary = card.summary || card.back || '';
    return `<article><strong>${escapeHtml(title)}</strong><p>${escapeHtml(summary)}</p></article>`;
  }).join('')}</div>`;
  return createRecord(context, { ...input, artifactType: 'KNOWLEDGE_CARDS', fileFormat: 'JSON', status: 'CONTENT_READY', previewHtml, content: { kind: 'knowledge_cards', schemaVersion: '1.0', cards }, requirements: { source: 'unified-ai-task-center', ...(input.requirements || {}) } });
}

function serialize(record) {
  return { id: record.id, title: record.title, artifactType: record.artifactType, fileFormat: record.fileFormat, status: record.status, previewHtml: record.previewHtml, content: record.contentSchemaJson, mimeType: record.mimeType, sizeBytes: record.fileSizeBytes == null ? null : Number(record.fileSizeBytes), downloadUrl: record.storagePath ? `/api/ai-assistant/artifacts/${record.id}/download` : null, createdAt: record.createdAt };
}

async function getDownload(user, artifactId) {
  const record = await prisma.generatedArtifact.findFirst({ where: { id: Number(artifactId), ownerUserId: Number(user.user_id), deletedAt: null } });
  if (!record?.storagePath || record.status !== 'READY') throw aiError('AI_ARTIFACT_GENERATION_FAILED', '成果文件不存在或尚未生成完成。', 404);
  if (!['DOCX', 'XLSX'].includes(record.fileFormat)) throw aiError('AI_ARTIFACT_GENERATION_FAILED', '该成果不提供文件下载。', 409);
  const absolutePath = resolveStoredPath(record.storagePath);
  const buffer = await fs.readFile(absolutePath).catch(() => null);
  if (!buffer || buffer.length < 4 || !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw aiError('AI_ARTIFACT_GENERATION_FAILED', '成果文件结构校验失败。', 409);
  return { absolutePath, fileName: record.fileName || `${record.title}.${record.fileFormat.toLowerCase()}`, mimeType: record.mimeType || (record.fileFormat === 'XLSX' ? XLSX_MIME : DOCX_MIME) };
}

module.exports = { DOCX_MIME, XLSX_MIME, escapeHtml, createRecord, createDocx, createSpreadsheet, createChart, createCards, serialize, getDownload };
