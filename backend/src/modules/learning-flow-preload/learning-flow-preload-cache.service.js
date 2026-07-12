const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../../config/prisma');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_ROOT = path.resolve(process.cwd(), process.env.LEARNING_FLOW_PRELOAD_CACHE_DIR || './storage/learning-flow-preloads');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => { result[key] = stable(value[key]); return result; }, {});
}

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}

function expiresAt(now = new Date(), ttlMs = DEFAULT_TTL_MS) {
  return new Date(now.getTime() + ttlMs);
}

function safeFile(key) {
  if (!/^[a-f0-9]{64}$/.test(String(key))) throw Object.assign(new Error('缓存键不合法'), { code: 'INVALID_PRELOAD_CACHE_KEY' });
  return path.join(CACHE_ROOT, `${key}.json`);
}

async function putContent(preloadKey, nodeId, content, metadata = {}) {
  const contentHash = hash(content);
  const cacheKey = hash({ preloadKey, nodeId, contentHash });
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  const target = safeFile(cacheKey);
  const tmp = `${target}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ cacheKey, preloadKey, nodeId, contentHash, content, metadata, createdAt: new Date().toISOString() }), { flag: 'wx' });
  await fs.rename(tmp, target);
  return { cacheKey, contentHash };
}

async function getContent(cacheKey) {
  try {
    const parsed = JSON.parse(await fs.readFile(safeFile(cacheKey), 'utf8'));
    return parsed.cacheKey === cacheKey ? parsed : null;
  } catch {
    return null;
  }
}

async function expireDue(now = new Date()) {
  return prisma.learningFlowPreload.updateMany({
    where: { deletedAt: null, activeKey: { not: null }, expiresAt: { lte: now }, status: { not: 'EXPIRED' } },
    data: { status: 'EXPIRED', progress: 0, stage: '准备内容已过期', activeKey: null },
  });
}

function isUsable(preload, now = new Date()) {
  return Boolean(preload && !preload.deletedAt && preload.activeKey === preload.preloadKey
    && new Date(preload.expiresAt).getTime() > now.getTime() && ['PARTIAL', 'READY'].includes(preload.status));
}

module.exports = { DEFAULT_TTL_MS, CACHE_ROOT, stable, hash, expiresAt, putContent, getContent, expireDue, isUsable };
