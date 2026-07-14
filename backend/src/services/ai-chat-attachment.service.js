const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const prisma = require('../config/prisma');

const ROOT = path.resolve(__dirname, '../../storage/uploads/ai-chat-attachments');
const MAX_BYTES = Number(process.env.AI_CHAT_ATTACHMENT_MAX_MB || 20) * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = Number(process.env.AI_CHAT_ATTACHMENT_TEXT_MAX_CHARS || 120000);
const TYPES = Object.freeze({
  '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.png': ['image/png'], '.webp': ['image/webp'],
  '.pdf': ['application/pdf'], '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.txt': ['text/plain'], '.md': ['text/markdown', 'text/x-markdown', 'text/plain'],
  '.csv': ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
});

function bad(message, code = 40001) { throw Object.assign(new Error(message), { code }); }
function api(record) {
  return { id: record.id, name: record.fileName, mimeType: record.mimeType, size: Number(record.sizeBytes), status: record.status, kind: record.mimeType.startsWith('image/') ? 'image' : 'document' };
}
function assertMagic(ext, buffer) {
  if (ext === '.pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') bad('PDF 文件内容无效');
  if (ext === '.png' && buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') bad('PNG 文件内容无效');
  if (['.jpg', '.jpeg'].includes(ext) && buffer.subarray(0, 3).toString('hex') !== 'ffd8ff') bad('JPEG 文件内容无效');
  if (ext === '.webp' && (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP')) bad('WebP 文件内容无效');
  if (ext === '.docx' && buffer.subarray(0, 2).toString('ascii') !== 'PK') bad('DOCX 文件内容无效');
  if (['.txt', '.md', '.csv'].includes(ext) && buffer.includes(0)) bad('文本文件内容无效');
}
async function extractText(ext, buffer) {
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer })).value;
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try { return (await parser.getText()).text || ''; } finally { await parser.destroy(); }
  }
  if (['.txt', '.md', '.csv'].includes(ext)) return buffer.toString('utf8');
  return null;
}
async function upload(userId, file, conversationId) {
  if (!file?.buffer?.length) bad('请选择要上传的文件');
  if (file.size > MAX_BYTES) bad(`附件不能超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB`);
  const safeName = path.basename(String(file.originalname || 'attachment')).slice(0, 255);
  const ext = path.extname(safeName).toLowerCase();
  if (!TYPES[ext] || !TYPES[ext].includes(String(file.mimetype || '').toLowerCase())) bad('仅支持 JPG、PNG、WebP、PDF、DOCX、TXT、MD、CSV');
  if (file.mimetype.startsWith('image/') && file.size > MAX_IMAGE_BYTES) bad('单张图片不能超过 5MB');
  assertMagic(ext, file.buffer);
  if (conversationId) {
    const owned = await prisma.aiConversation.findFirst({ where: { id: Number(conversationId), userId: Number(userId) }, select: { id: true } });
    if (!owned) bad('会话不存在或无权访问', 40301);
  }
  await cleanupAbandoned(userId).catch(() => {});
  const id = crypto.randomUUID();
  const userDir = path.join(ROOT, String(userId));
  await fs.mkdir(userDir, { recursive: true });
  const diskName = `${id}${ext}`;
  const absolute = path.join(userDir, diskName);
  const extractedText = (await extractText(ext, file.buffer))?.slice(0, MAX_EXTRACTED_CHARS) || null;
  await fs.writeFile(absolute, file.buffer, { flag: 'wx' });
  try {
    const record = await prisma.aiChatAttachment.create({ data: {
      id, userId: Number(userId), conversationId: conversationId ? Number(conversationId) : null,
      fileName: safeName, mimeType: file.mimetype, fileExtension: ext, sizeBytes: BigInt(file.size),
      storagePath: path.relative(path.resolve(__dirname, '../..'), absolute).replace(/\\/g, '/'),
      checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'), extractedText,
      metadataJson: { extractedChars: extractedText?.length || 0 },
    } });
    return api(record);
  } catch (error) { await fs.unlink(absolute).catch(() => {}); throw error; }
}
async function resolveForTurn(userId, conversationId, refs = []) {
  const ids = [...new Set(refs.map(item => String(item?.id || item || '')).filter(Boolean))];
  if (ids.length > 8) bad('单次最多添加 8 个附件');
  if (!ids.length) return [];
  const rows = await prisma.aiChatAttachment.findMany({ where: { id: { in: ids }, userId: Number(userId), status: 'READY' } });
  if (rows.length !== ids.length) bad('部分附件不存在、未就绪或无权访问', 40301);
  rows.forEach(row => { if (row.conversationId && row.conversationId !== Number(conversationId)) bad('附件属于其他会话', 40301); });
  await prisma.aiChatAttachment.updateMany({ where: { id: { in: ids }, userId: Number(userId) }, data: { conversationId: Number(conversationId) } });
  const byId = new Map(rows.map(row => [row.id, row]));
  return ids.map(id => byId.get(id));
}
async function bindMessage(ids, messageId) {
  if (!ids.length) return;
  await prisma.aiChatAttachment.updateMany({ where: { id: { in: ids } }, data: { messageId: Number(messageId) } });
}
function absolutePath(record) {
  const root = path.resolve(__dirname, '../..');
  const resolved = path.resolve(root, record.storagePath);
  if (!resolved.startsWith(`${ROOT}${path.sep}`)) bad('附件路径不安全', 40301);
  return resolved;
}

async function removeForConversations(userId, conversationIds) {
  const ids = [...new Set((Array.isArray(conversationIds) ? conversationIds : [conversationIds]).map(Number).filter(Number.isInteger))];
  if (!ids.length) return 0;
  const rows = await prisma.aiChatAttachment.findMany({ where: { userId: Number(userId), conversationId: { in: ids } } });
  await Promise.all(rows.map(row => fs.unlink(absolutePath(row)).catch(() => {})));
  const removed = await prisma.aiChatAttachment.deleteMany({ where: { userId: Number(userId), id: { in: rows.map(row => row.id) } } });
  return removed.count;
}

async function cleanupAbandoned(userId) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.aiChatAttachment.findMany({ where: { userId: Number(userId), conversationId: null, createdAt: { lt: cutoff } } });
  if (!rows.length) return 0;
  await Promise.all(rows.map(row => fs.unlink(absolutePath(row)).catch(() => {})));
  const removed = await prisma.aiChatAttachment.deleteMany({ where: { userId: Number(userId), id: { in: rows.map(row => row.id) }, conversationId: null } });
  return removed.count;
}

module.exports = { upload, resolveForTurn, bindMessage, absolutePath, api, removeForConversations, cleanupAbandoned, MAX_BYTES };
