const path = require('path');
const fs = require('fs/promises');
const { hash } = require('./learning-card.protocol');
const { learningCardSchema } = require('./learning-card.schemas');
const { atomicWrite } = require('../learning-flow-preload/knowledge-card-cache.service');

const PLATFORM_CACHE_ROOT = path.resolve(
  process.cwd(),
  process.env.LEARNING_CARD_PLATFORM_CACHE_DIR || './storage/learning-cards/platform',
);
const MEMORY_TTL_MS = Math.max(5_000, Number(process.env.LEARNING_CARD_MEMORY_TTL_MS) || 60_000);
const memory = new Map();

function dailyKey(userId, dateKey) {
  return hash({ namespace: 'daily-learning-card-set-v1', userId: Number(userId), date: String(dateKey) });
}

function cachePath(key) {
  if (!/^[a-f0-9]{64}$/.test(String(key))) throw Object.assign(new Error('学习卡片平台缓存键不合法'), { code: 'INVALID_LEARNING_CARD_PLATFORM_CACHE_KEY' });
  return path.join(PLATFORM_CACHE_ROOT, `${key}.json`);
}

function validateDaily(value, userId, dateKey) {
  if (!value || value.version !== '1.0' || Number(value.userId) !== Number(userId) || String(value.date) !== String(dateKey)) return null;
  if (!['READY', 'GENERATING', 'STALE', 'FAILED'].includes(String(value.status))) return null;
  const cards = Array.isArray(value.cards) ? value.cards.map(card => learningCardSchema.parse(card)) : [];
  return { ...value, cards };
}

async function readDaily(userId, dateKey) {
  const key = dailyKey(userId, dateKey);
  const cached = memory.get(key);
  if (cached && Date.now() - cached.cachedAt < MEMORY_TTL_MS) return cached.value;
  try {
    const parsed = validateDaily(JSON.parse(await fs.readFile(cachePath(key), 'utf8')), userId, dateKey);
    if (!parsed) return null;
    memory.set(key, { cachedAt: Date.now(), value: parsed });
    return parsed;
  } catch { return null; }
}

async function writeDaily(value) {
  const validated = validateDaily(value, value?.userId, value?.date);
  if (!validated) throw Object.assign(new Error('每日学习卡片缓存内容不合法'), { code: 'INVALID_DAILY_LEARNING_CARD_CACHE' });
  const key = dailyKey(validated.userId, validated.date);
  await atomicWrite(cachePath(key), validated);
  memory.set(key, { cachedAt: Date.now(), value: validated });
  return validated;
}

async function markDailyStale(userId, dateKey, reason, pendingRefresh = null) {
  const current = await readDaily(userId, dateKey);
  if (!current) return null;
  return writeDaily({
    ...current,
    status: 'STALE',
    reasonSummary: reason || current.reasonSummary,
    pendingRefresh: pendingRefresh || current.pendingRefresh || null,
    refreshedAt: new Date().toISOString(),
  });
}

function clearMemory(userId, dateKey) {
  if (userId != null && dateKey) memory.delete(dailyKey(userId, dateKey));
  else memory.clear();
}

module.exports = {
  PLATFORM_CACHE_ROOT, MEMORY_TTL_MS, dailyKey, cachePath,
  readDaily, writeDaily, markDailyStale, clearMemory,
};
