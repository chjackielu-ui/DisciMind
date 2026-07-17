const prisma = require('../../config/prisma');
const cache = require('./learning-flow-preload-cache.service');

async function cachedNode(preload, nodeId = null) {
  if (!cache.isUsable(preload)) return null;
  const entry = nodeId == null ? preload.manifestJson?.preparedNodeIds?.[0] : String(nodeId);
  const descriptor = preload.manifestJson?.contentCacheKeys?.find((item) => String(item.nodeId) === String(entry));
  if (!entry || !descriptor?.cacheKey) return null;
  const stored = await cache.getContent(descriptor.cacheKey);
  if (!stored || stored.preloadKey !== preload.preloadKey || String(stored.nodeId) !== String(entry)) return null;
  return { nodeId: String(entry), content: stored.content?.modelContent || stored.content, narrationText: stored.content?.narrationText || '', contentHash: stored.contentHash, cacheKey: descriptor.cacheKey };
}

const cachedFirstNode = preload => cachedNode(preload);

async function attachToSession(preload, sessionId) {
  if (!preload) return null;
  return prisma.learningFlowPreload.update({ where: { id: preload.id }, data: { learningSessionId: Number(sessionId) } });
}

module.exports = { cachedNode, cachedFirstNode, attachToSession };
