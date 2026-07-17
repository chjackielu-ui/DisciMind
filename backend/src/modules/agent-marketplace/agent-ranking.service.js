const prisma = require('../../config/prisma');

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map();

function invalidateRankingCache() { cache.clear(); }
function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function logNormalize(value, maximum) {
  return maximum > 0 ? clamp(Math.log1p(Math.max(0, value)) / Math.log1p(maximum)) : 0;
}
function growthScore(recent, prior) {
  return clamp((recent - prior) / Math.max(prior, 1), 0, 3) / 3;
}

async function hotRankings(rawLimit = 10) {
  const limit = Math.min(10, Math.max(1, Number(rawLimit || 10)));
  const cached = cache.get(limit);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };
  const agents = await prisma.userAgent.findMany({
    where: {
      status: 'PUBLIC', visibility: 'PUBLIC', deletedAt: null,
      currentPublicVersion: { reviewStatus: 'APPROVED' }, creator: { status: 'ACTIVE' },
    },
    include: { currentPublicVersion: true, creator: { include: { profile: true } } },
  });
  if (!agents.length) return { list: [], cached: false, cacheTtlSeconds: CACHE_TTL_MS / 1000 };
  const ids = agents.map(item => item.id);
  const placeholders = ids.map(() => '?').join(',');
  const [answers, favorites, reports] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT c.agent_id AS agentId,
        SUM(CASE WHEN m.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS recentCount,
        SUM(CASE WHEN m.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS priorCount,
        COUNT(DISTINCT CASE WHEN m.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN c.user_id END) AS recentUsers,
        MAX(m.created_at) AS lastActiveAt
      FROM agent_market_conversations c
      JOIN agent_market_messages m FORCE INDEX (agent_market_messages_conversation_id_role_generation_status_idx)
        ON m.conversation_id = c.id AND m.role = 'ASSISTANT' AND m.generation_status = 'COMPLETED'
      WHERE c.agent_id IN (${placeholders}) AND c.deleted_at IS NULL
        AND CHAR_LENGTH(TRIM(m.content)) > 0
        AND m.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      GROUP BY c.agent_id`, ...ids),
    prisma.agentFavorite.groupBy({ where: { agentId: { in: ids }, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, by: ['agentId'], _count: { _all: true } }),
    prisma.agentReport.findMany({ where: { agentId: { in: ids }, status: 'PENDING', createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, select: { agentId: true, userId: true } }),
  ]);
  const hidden = new Set();
  const reporterSets = new Map();
  for (const report of reports) {
    if (!reporterSets.has(report.agentId)) reporterSets.set(report.agentId, new Set());
    reporterSets.get(report.agentId).add(report.userId);
  }
  for (const [agentId, users] of reporterSets) if (users.size >= 3) hidden.add(agentId);
  const answerMap = new Map(answers.map(row => [Number(row.agentId), row]));
  const favoriteMap = new Map(favorites.map(row => [row.agentId, row._count._all]));
  const maxAnswers = Math.max(1, ...answers.map(row => Number(row.recentCount)));
  const maxFavorites = Math.max(1, ...favorites.map(row => row._count._all));
  const now = Date.now();
  const ranked = agents.filter(agent => !hidden.has(agent.id)).map(agent => {
    const activity = answerMap.get(agent.id) || {};
    const recent = Number(activity.recentCount || 0);
    const prior = Number(activity.priorCount || 0);
    const growth = clamp((recent - prior) / Math.max(1, prior), 0, 3);
    const bayesian = ((agent.ratingCount / (agent.ratingCount + 5)) * agent.ratingAverage + (5 / (agent.ratingCount + 5)) * 4) / 5;
    const ageDays = activity.lastActiveAt ? (now - new Date(activity.lastActiveAt).getTime()) / 86400_000 : 14;
    const score = 100 * (
      0.35 * logNormalize(recent, maxAnswers) +
      0.20 * growthScore(recent, prior) +
      0.15 * logNormalize(favoriteMap.get(agent.id) || 0, maxFavorites) +
      0.20 * clamp(bayesian) +
      0.10 * clamp(1 - ageDays / 14)
    );
    return {
      agentId: agent.id, name: agent.currentPublicVersion.name,
      shortDescription: agent.currentPublicVersion.shortDescription,
      creator: agent.creator.profile?.real_name || agent.creator.username,
      successfulAnswers7d: recent, successfulUsers7d: Number(activity.recentUsers || 0),
      growth: Math.round(growth * 1000) / 1000, newFavorites7d: favoriteMap.get(agent.id) || 0,
      ratingAverage: agent.ratingAverage, ratingCount: agent.ratingCount,
      lastActiveAt: activity.lastActiveAt || null, score: Math.round(score * 100) / 100,
    };
  }).sort((a, b) => b.score - a.score
      || b.successfulAnswers7d - a.successfulAnswers7d
      || b.ratingCount - a.ratingCount
      || new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime()
      || a.agentId - b.agentId).slice(0, limit)
    .map((item, index) => ({ rank: index + 1, ...item }));
  const value = { list: ranked, cached: false, cacheTtlSeconds: CACHE_TTL_MS / 1000 };
  cache.set(limit, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

module.exports = { CACHE_TTL_MS, hotRankings, invalidateRankingCache, clamp, logNormalize, growthScore };
