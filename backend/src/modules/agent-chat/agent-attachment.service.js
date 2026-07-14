const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../../config/prisma');
const { assert } = require('../agent-marketplace/agent-marketplace.errors');

const STORAGE_DIR = path.resolve(__dirname, '../../../storage/uploads/agent-chat');
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
});
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

async function persistImages(images = []) {
  if (!images.length) return [];
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const saved = [];
  let total = 0;
  try {
    for (const [index, image] of images.entries()) {
      const mimeType = String(image.mimeType || '').toLowerCase();
      assert(MIME_EXTENSIONS[mimeType], `第 ${index + 1} 张图片格式不支持`);
      const match = String(image.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i);
      assert(match && match[1].toLowerCase() === mimeType, `第 ${index + 1} 张图片内容不合法`);
      const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
      assert(buffer.length > 0 && buffer.length <= MAX_IMAGE_BYTES, '每张图片不能超过 5MB');
      total += buffer.length;
      assert(total <= MAX_TOTAL_BYTES, '图片总大小不能超过 12MB');
      const fileName = `${Date.now()}_${crypto.randomBytes(12).toString('hex')}.${MIME_EXTENSIONS[mimeType]}`;
      await fs.writeFile(path.join(STORAGE_DIR, fileName), buffer, { flag: 'wx' });
      saved.push({
        id: crypto.randomUUID(),
        name: String(image.name || `image-${index + 1}.${MIME_EXTENSIONS[mimeType]}`).slice(0, 180),
        mimeType,
        size: buffer.length,
        fileName,
      });
    }
    return saved;
  } catch (error) {
    await removeAttachments(saved);
    throw error;
  }
}

async function removeAttachments(attachments = []) {
  await Promise.all(attachments.map((item) => fs.unlink(path.join(STORAGE_DIR, path.basename(String(item.fileName || '')))).catch(() => null)));
}

async function attachmentDataUrls(attachments = [], limit = 4) {
  const result = [];
  for (const item of attachments.slice(0, limit)) {
    const safeName = path.basename(String(item.fileName || ''));
    if (!safeName || !MIME_EXTENSIONS[item.mimeType]) continue;
    const data = await fs.readFile(path.join(STORAGE_DIR, safeName)).catch(() => null);
    if (data) result.push({ id: item.id, name: item.name, mimeType: item.mimeType, dataUrl: `data:${item.mimeType};base64,${data.toString('base64')}` });
  }
  return result;
}

function serializeAttachments(message) {
  return (Array.isArray(message.attachmentsJson) ? message.attachmentsJson : []).map((item) => ({
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size,
    url: `/api/agent-conversations/${message.conversationId}/messages/${message.id}/attachments/${item.id}`,
  }));
}

async function getAttachment(userId, conversationId, messageId, attachmentId) {
  const message = await prisma.marketplaceAgentMessage.findFirst({
    where: {
      id: Number(messageId),
      conversationId: Number(conversationId),
      conversation: { userId: Number(userId), deletedAt: null },
    },
  });
  assert(message, '消息不存在或无权访问', 40301, 403);
  const attachment = (Array.isArray(message.attachmentsJson) ? message.attachmentsJson : []).find((item) => item.id === String(attachmentId));
  assert(attachment, '图片不存在', 40002, 404);
  const safeName = path.basename(String(attachment.fileName || ''));
  assert(safeName && MIME_EXTENSIONS[attachment.mimeType], '图片信息不合法', 40002, 404);
  const filePath = path.join(STORAGE_DIR, safeName);
  await fs.access(filePath).catch(() => { throw Object.assign(new Error('图片文件不存在'), { code: 40002, status: 404 }); });
  return { filePath, mimeType: attachment.mimeType, name: attachment.name };
}

module.exports = {
  STORAGE_DIR, MIME_EXTENSIONS, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES,
  persistImages, removeAttachments, attachmentDataUrls, serializeAttachments, getAttachment,
};
