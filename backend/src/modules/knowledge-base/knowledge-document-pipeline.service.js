const crypto = require('crypto');
const fs = require('fs/promises');
const mammoth = require('mammoth');
const prisma = require('../../config/prisma');
const asyncTasks = require('../async-task/async-task.service');
const knowledgeProvider = require('./knowledge-provider.service');
const knowledgeStorage = require('./knowledge-storage.service');
const { normalizeUploadFileName } = require('./knowledge-ingestion.utils');

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 120;
const MIN_TEXT_LENGTH = 20;

function pipelineError(code, stage, message, retryable = true) {
  return Object.assign(new Error(message), { code, stage, retryable, permanent: retryable === false, userMessage: message });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw pipelineError('KNOWLEDGE_TASK_CANCELLED', 'cancelled', '知识库处理已取消。', true);
}

function decodeHtml(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    }
    return entities[entity.toLowerCase()] || ' ';
  });
}

function htmlToStructuredText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(li|p|div|tr|table)>/gi, '\n')
    .replace(/<t[dh]\b[^>]*>/gi, '\t')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

async function parsePdf(buffer) {
  const pdfModule = require('pdf-parse');
  if (typeof pdfModule === 'function') {
    const result = await pdfModule(buffer);
    return { text: result.text || '', pageCount: result.numpages || 1 };
  }
  const PDFParse = pdfModule.PDFParse || pdfModule.default?.PDFParse;
  if (!PDFParse) throw pipelineError('PDF_PARSER_UNAVAILABLE', 'parsing', 'PDF 解析组件不可用，请稍后重试。', true);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = Array.isArray(result.pages) ? result.pages : [];
    const text = pages.length
      ? pages.map((page, index) => `[[PAGE:${index + 1}]]\n${page.text || ''}`).join('\n\n')
      : result.text || '';
    return { text, pageCount: Number(result.total || result.numpages || pages.length || 1) };
  } finally {
    await parser.destroy?.().catch(() => {});
  }
}

async function parseFile(absolutePath, extension) {
  const buffer = await fs.readFile(absolutePath);
  const ext = String(extension || '').toLowerCase();
  if (ext === '.pdf') return parsePdf(buffer);
  if (ext === '.docx') {
    const result = await mammoth.convertToHtml({ buffer }, { includeDefaultStyleMap: true });
    return { text: htmlToStructuredText(result.value), pageCount: 1, warnings: result.messages || [] };
  }
  if (ext === '.txt' || ext === '.md') {
    return { text: buffer.toString('utf8').replace(/<script\b[\s\S]*?<\/script>/gi, ''), pageCount: 1 };
  }
  throw pipelineError('FILE_TYPE_UNSUPPORTED', 'validation', '该文件类型暂不支持解析。', false);
}

function removeRepeatedPageLines(text, pageCount) {
  if (pageCount < 3) return text;
  const lines = String(text).split('\n');
  const counts = new Map();
  lines.forEach((line) => {
    const normalized = line.trim();
    if (normalized && normalized.length <= 100 && !/^\[\[PAGE:\d+\]\]$/.test(normalized)) counts.set(normalized, (counts.get(normalized) || 0) + 1);
  });
  const threshold = Math.max(3, Math.ceil(pageCount * 0.6));
  return lines.filter((line) => (counts.get(line.trim()) || 0) < threshold || /^#{1,6}\s/.test(line.trim())).join('\n');
}

function cleanText(rawText, pageCount = 1) {
  const text = removeRepeatedPageLines(String(rawText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+$/gm, '')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n\n'), pageCount).trim();
  const damaged = (text.match(/\uFFFD|锟斤拷|\?{4,}/g) || []).length;
  if (text.length < MIN_TEXT_LENGTH) throw pipelineError('DOCUMENT_TEXT_EMPTY', 'parsing', '文档没有提取到有效正文；如果是扫描 PDF，请先进行 OCR。', false);
  if (damaged > Math.max(3, text.length / 300)) throw pipelineError('DOCUMENT_TEXT_GARBLED', 'parsing', '文档正文存在较多乱码，请检查文件编码或重新导出。', false);
  return text;
}

function sentenceTail(text, size) {
  const tail = String(text || '').slice(-size);
  const boundary = tail.search(/[。！？!?；;]\s*/u);
  return boundary >= 0 ? tail.slice(boundary + 1).trim() : tail.trim();
}

function structuredBlocks(text) {
  const blocks = [];
  let pageNumber = null;
  let titlePath = [];
  let paragraph = [];
  const flush = () => {
    const value = paragraph.join('\n').trim();
    if (value) blocks.push({ text: value, pageNumber, titlePath: titlePath.join(' / ') || null });
    paragraph = [];
  };
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim();
    const page = line.match(/^\[\[PAGE:(\d+)\]\]$/);
    if (page) { flush(); pageNumber = Number(page[1]); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/) || (line.length <= 60 && /[：:]$/.test(line) ? ['#', '#', line.replace(/[：:]$/, '')] : null);
    if (heading) {
      flush();
      const level = heading[1].length;
      titlePath = [...titlePath.slice(0, level - 1), heading[2].trim()];
      blocks.push({ text: heading[2].trim(), pageNumber, titlePath: titlePath.join(' / ') });
      continue;
    }
    if (!line) { flush(); continue; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function chunkStructuredText(text, options = {}) {
  const chunkSize = Math.max(200, Math.min(2000, Number(options.chunkSize) || DEFAULT_CHUNK_SIZE));
  const overlap = Math.max(0, Math.min(Math.floor(chunkSize / 3), Number(options.chunkOverlap) || DEFAULT_CHUNK_OVERLAP));
  const chunks = [];
  let current = '';
  let metadata = null;
  let overlapOnly = false;
  const push = (keepOverlap = true) => {
    const value = current.trim();
    if (!value) return;
    chunks.push({ text: value, ...metadata });
    current = keepOverlap && overlap ? sentenceTail(value, overlap) : '';
    overlapOnly = Boolean(current);
    if (!current) metadata = null;
  };
  for (const block of structuredBlocks(text)) {
    const boundaryChanged = metadata && (
      metadata.pageNumber !== block.pageNumber || metadata.titlePath !== block.titlePath
    );
    if (boundaryChanged) {
      if (!overlapOnly) push(false);
      else { current = ''; metadata = null; overlapOnly = false; }
    }
    const pieces = block.text.match(new RegExp(`[\\s\\S]{1,${chunkSize}}`, 'g')) || [];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > chunkSize) push();
      if (current && current.length + piece.length + 2 > chunkSize) {
        current = '';
        metadata = null;
        overlapOnly = false;
      }
      if (!current) metadata = { titlePath: block.titlePath, pageNumber: block.pageNumber };
      current += `${current ? '\n\n' : ''}${piece}`;
      overlapOnly = false;
      if (current.length >= chunkSize) push();
    }
  }
  if (!overlapOnly) push(false);
  return chunks.map((chunk, index) => ({
    document_id: Number(options.documentId),
    chunk_index: index + 1,
    chunk_text: chunk.text,
    page_number: chunk.pageNumber || null,
    token_count: Math.ceil(chunk.text.length * 0.75),
    title_path: chunk.titlePath?.slice(0, 500) || null,
    char_count: chunk.text.length,
    chunk_hash: crypto.createHash('sha256').update(chunk.text).digest('hex'),
    metadata_json: { separatorStrategy: 'structure', pageNumber: chunk.pageNumber || null, titlePath: chunk.titlePath || null },
    status: 'ready',
  }));
}

async function taskStage(taskId, documentId, state, parseStatus, stage) {
  await Promise.all([
    prisma.knowledgeDocument.update({ where: { document_id: documentId }, data: {
      processing_state: state, parse_status: parseStatus, marketplace_status: state === 'indexing' ? 'INDEXING' : state.toUpperCase(),
      error_code: null, error_stage: null, error_message: null, failed_at: null,
    } }),
    asyncTasks.updateTask(taskId, { status: 'RUNNING', stage, progressMode: 'STAGE_ONLY', errorCode: null, errorMessage: null }),
  ]);
}

async function recalculateKnowledgeBaseStatus(knowledgeBaseId) {
  const [docs, knowledgeBase] = await Promise.all([
    prisma.knowledgeDocument.findMany({ where: { knowledge_base_id: knowledgeBaseId, deleted_at: null }, select: { marketplace_status: true } }),
    prisma.knowledgeBase.findUnique({ where: { knowledge_base_id: knowledgeBaseId }, select: { marketplace_visibility: true } }),
  ]);
  const available = docs.filter((doc) => doc.marketplace_status === 'READY').length;
  const failed = docs.filter((doc) => doc.marketplace_status === 'FAILED').length;
  let status = !docs.length ? 'EMPTY' : failed && available ? 'PARTIAL' : failed === docs.length ? 'FAILED' : available === docs.length ? 'READY' : 'PROCESSING';
  if (knowledgeBase?.marketplace_visibility === 'PUBLIC' && available === docs.length && docs.length) status = 'PUBLIC';
  await prisma.knowledgeBase.update({ where: { knowledge_base_id: knowledgeBaseId }, data: { marketplace_status: status } });
  return status;
}

async function failDocument(document, taskId, error) {
  const stage = error.stage || 'indexing';
  const code = String(error.code || `KNOWLEDGE_${stage.toUpperCase()}_FAILED`).slice(0, 100);
  const publicMessage = String(error.userMessage || ({
    validation: '文件校验失败，请检查文件格式。', parsing: '文档解析失败，请检查文件内容。',
    chunking: '文档没有产生有效分片。', indexing: '知识库向量索引服务暂时不可用。',
  }[stage] || '知识库处理失败。')).slice(0, 1000);
  const task = taskId ? await prisma.asyncTask.findUnique({ where: { id: Number(taskId) } }).catch(() => null) : null;
  const canRetry = error.retryable !== false && task && Number(task.attemptCount || 0) < Number(task.maxAttempts || 1);
  const retryState = {
    parsing: { processing_state: 'uploaded', parse_status: 'UPLOADED' },
    chunking: { processing_state: 'parsed', parse_status: 'PARSED' },
    indexing: { processing_state: 'chunked', parse_status: 'CHUNKED' },
  }[stage] || { processing_state: 'uploaded', parse_status: 'UPLOADED' };
  await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: canRetry ? {
    ...retryState, marketplace_status: 'PROCESSING',
    error_code: code, error_stage: stage, error_message: publicMessage,
    retryable: true, failed_at: null,
  } : {
    processing_state: 'failed', parse_status: 'FAILED', marketplace_status: 'FAILED',
    error_code: code, error_stage: stage, error_message: publicMessage,
    retryable: error.retryable !== false, failed_at: new Date(),
  } }).catch(() => {});
  await recalculateKnowledgeBaseStatus(document.knowledge_base_id).catch(() => {});
  if (taskId && !canRetry) await asyncTasks.updateTask(taskId, {
    status: 'FAILED', stage: stage.toUpperCase(), errorCode: code, errorMessage: publicMessage,
    requiresUserAction: error.retryable === false,
  }).catch(() => {});
  error.code = code;
  error.userMessage = publicMessage;
  error.permanent = !canRetry;
  throw error;
}

async function processDocumentTask(task, signal) {
  let document = await prisma.knowledgeDocument.findUnique({
    where: { document_id: Number(task.relatedResourceId) },
    include: { knowledge_base: true, _count: { select: { chunks: true } } },
  });
  if (!document || document.deleted_at) throw pipelineError('KNOWLEDGE_DOCUMENT_MISSING', 'validation', '知识库文档不存在。', false);
  if (Number(document.owner_user_id) !== Number(task.userId)) throw pipelineError('KNOWLEDGE_DOCUMENT_FORBIDDEN', 'validation', '无权处理该知识库文档。', false);
  let materialized;
  try {
    throwIfAborted(signal);
    await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { attempt_count: { increment: 1 } } });
    try {
      materialized = await knowledgeStorage.materializeDocument(document);
    } catch (error) {
      error.stage = 'validation';
      error.userMessage = error.message;
      throw error;
    }
    const { absolutePath } = materialized;

    let cleanedText = document.cleaned_text;
    let pageCount = document.page_count || 1;
    if (!cleanedText) {
      await taskStage(task.id, document.document_id, 'parsing', 'PARSING', 'PARSING');
      throwIfAborted(signal);
      const parsed = await parseFile(absolutePath, document.file_ext);
      cleanedText = cleanText(parsed.text, parsed.pageCount);
      pageCount = parsed.pageCount || 1;
      await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: {
        cleaned_text: cleanedText, page_count: pageCount, processing_state: 'parsed', parse_status: 'PARSED', marketplace_status: 'PARSED',
      } });
    }

    document = await prisma.knowledgeDocument.findUnique({ where: { document_id: document.document_id }, include: { knowledge_base: true, _count: { select: { chunks: true } } } });
    if (!document._count.chunks) {
      await taskStage(task.id, document.document_id, 'chunking', 'CHUNKING', 'CHUNKING');
      throwIfAborted(signal);
      const chunks = chunkStructuredText(cleanedText, {
        documentId: document.document_id, chunkSize: document.chunk_size, chunkOverlap: document.chunk_overlap,
      });
      if (!chunks.length) throw pipelineError('DOCUMENT_CHUNKS_EMPTY', 'chunking', '文档未产生有效分片。', false);
      await prisma.$transaction(async (tx) => {
        await tx.knowledgeDocumentChunk.deleteMany({ where: { document_id: document.document_id } });
        await tx.knowledgeDocumentChunk.createMany({ data: chunks });
        await tx.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { processing_state: 'chunked', parse_status: 'CHUNKED', marketplace_status: 'CHUNKED' } });
      });
    }

    throwIfAborted(signal);
    const repairedFileName = normalizeUploadFileName(document.original_filename);
    if (repairedFileName && repairedFileName !== document.original_filename) {
      await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: {
        original_filename: repairedFileName, title: repairedFileName,
      } });
      document.original_filename = repairedFileName;
    }
    await taskStage(task.id, document.document_id, 'indexing', 'EMBEDDING', 'INDEXING');
    throwIfAborted(signal);
    await knowledgeProvider.indexDocument(document.document_id, { signal });
    throwIfAborted(signal);
    await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: {
      processing_state: 'available', parse_status: 'EMBEDDED', marketplace_status: 'READY',
      dify_batch_id: null,
      error_code: null, error_stage: null, error_message: null, failed_at: null,
    } });
    await recalculateKnowledgeBaseStatus(document.knowledge_base_id);
    if (document.knowledge_base?.marketplace_visibility === 'PUBLIC') {
      await require('../file-generator/system-file-agents.service').ensureSystemFileAgents().catch(() => null);
    }
    await asyncTasks.updateTask(task.id, {
      status: 'SUCCEEDED', stage: 'READY', progressMode: 'STAGE_ONLY',
      errorCode: null, errorMessage: null, cancellable: false,
    });
    return { terminal: true };
  } catch (error) {
    if (signal?.aborted) {
      await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { processing_state: 'cancelled', marketplace_status: 'CANCELLED' } }).catch(() => {});
      throw error;
    }
    return failDocument(document, task.id, error);
  } finally {
    await materialized?.cleanup?.();
  }
}

module.exports = {
  DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP, MIN_TEXT_LENGTH,
  parseFile, cleanText, structuredBlocks, chunkStructuredText,
  recalculateKnowledgeBaseStatus, processDocumentTask,
};
