const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { knowledgeCardDeckSchema } = require('./knowledge-card.schemas');

const CACHE_ROOT = path.resolve(process.cwd(), process.env.LEARNING_CARD_CACHE_DIR || './storage/learning-cards');
const STATE_ROOT = path.join(CACHE_ROOT, 'states');
const READY_TTL_MS = Math.max(60_000, Number(process.env.LEARNING_CARD_CACHE_TTL_MS) || 7 * 24 * 60 * 60 * 1000);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
}

function hash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}

function assertHash(key) {
  if (!/^[a-f0-9]{64}$/.test(String(key))) throw Object.assign(new Error('知识卡片缓存键不合法'), { code: 'INVALID_KNOWLEDGE_CARD_CACHE_KEY' });
}

function deckPath(key) { assertHash(key); return path.join(CACHE_ROOT, `${key}.json`); }
function statePath(userId, cardId) { return path.join(STATE_ROOT, `${hash({ userId: Number(userId), cardId: String(cardId) })}.json`); }

async function atomicWrite(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
  try { await fs.rename(temporary, target); }
  catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
  }
}

async function readDeck(cacheKey) {
  try {
    const parsed = knowledgeCardDeckSchema.parse(JSON.parse(await fs.readFile(deckPath(cacheKey), 'utf8')));
    if (parsed.cacheKey !== cacheKey) return null;
    const stale = parsed.status === 'ready' && new Date(parsed.expiresAt).getTime() <= Date.now();
    return stale ? { ...parsed, status: 'stale' } : parsed;
  } catch { return null; }
}

async function writeDeck(deck) {
  const validated = knowledgeCardDeckSchema.parse(deck);
  await atomicWrite(deckPath(validated.cacheKey), validated);
  return validated;
}

async function markStaleByCourse(courseId) {
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  const files = (await fs.readdir(CACHE_ROOT, { withFileTypes: true })).filter(item => item.isFile() && /^[a-f0-9]{64}\.json$/.test(item.name));
  let count = 0;
  for (const file of files) {
    const key = file.name.slice(0, -5);
    const deck = await readDeck(key);
    if (!deck || Number(deck.courseId) !== Number(courseId) || deck.status === 'stale') continue;
    await writeDeck({ ...deck, status: 'stale' });
    count += 1;
  }
  return { staleCount: count };
}

async function readCardState(userId, cardId) {
  try {
    const state = JSON.parse(await fs.readFile(statePath(userId, cardId), 'utf8'));
    return state.userId === Number(userId) && state.cardId === String(cardId) ? state : null;
  } catch { return null; }
}

async function writeCardState(userId, cardId, patch) {
  const previous = await readCardState(userId, cardId);
  const state = { userId: Number(userId), cardId: String(cardId), favorite: false, mastered: false, expanded: false, ...(previous || {}), ...patch, updatedAt: new Date().toISOString() };
  await atomicWrite(statePath(userId, cardId), state);
  return state;
}

module.exports = { CACHE_ROOT, STATE_ROOT, READY_TTL_MS, stable, hash, deckPath, statePath, atomicWrite, readDeck, writeDeck, markStaleByCourse, readCardState, writeCardState };
