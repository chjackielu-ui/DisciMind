const prisma = require('../../config/prisma');
const cache = require('./learning-flow-preload-cache.service');
const preloadService = require('./learning-flow-preload.service');
const processor = require('./learning-flow-preload.processor');
const voice = require('./voice-prewarm.service');

async function triggerNextNode({ userId, learningSessionId, nextNodeId }) {
  if (!nextNodeId) return { skipped: true, reason: 'NEXT_NODE_UNDETERMINED' };
  require('./knowledge-card.service').fireAndRecord({ userId, sessionId: learningSessionId, nodeId: nextNodeId, reason: 'next_node_preload' });
  const preload = await prisma.learningFlowPreload.findFirst({
    where: { userId: Number(userId), learningSessionId: Number(learningSessionId), activeKey: { not: null }, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
  });
  if (!cache.isUsable(preload)) return { skipped: true, reason: 'PRELOAD_UNAVAILABLE' };
  const manifest = { ...(preload.manifestJson || {}) };
  if ((manifest.preparedNodeIds || []).map(String).includes(String(nextNodeId))) return { skipped: true, reason: 'ALREADY_PREPARED' };
  const context = await preloadService.contextFor(Number(userId), {
    workflowTemplateId: preload.workflowTemplateId, learningGoalId: preload.learningGoalId, learningSessionId: preload.learningSessionId,
  });
  const node = (context.graph.nodes || []).find((item) => String(item.id) === String(nextNodeId));
  const nodeType = processor.normalizeType(node?.type);
  if (!node || !processor.SAFE_NODE_TYPES.has(nodeType)) return { skipped: true, reason: 'NEXT_NODE_NOT_SAFE' };
  const knowledge = manifest.knowledgeResults || await processor.knowledgeResults(context.goal);
  const content = await processor.generateSafeNodeContent(context, node, knowledge);
  if (!content?.modelContent) return { skipped: true, reason: 'EMPTY_CONTENT' };
  const stored = await cache.putContent(preload.preloadKey, String(node.id), content, { nodeType, trigger: 'next_determined_node' });
  manifest.preparedNodeIds = [...(manifest.preparedNodeIds || []), String(node.id)];
  manifest.contentCacheKeys = [...(manifest.contentCacheKeys || []), { nodeId: String(node.id), ...stored }];
  manifest.preparedContent = { ...(manifest.preparedContent || {}), [String(node.id)]: content.narrationText };
  try {
    const audio = await voice.synthesizeOne(preload, { nodeId: String(node.id), nodeType, text: content.narrationText });
    manifest.audioCacheKeys = [...(manifest.audioCacheKeys || []), audio];
  } catch (error) {
    console.warn('[learning-preload] next-node voice skipped', { preloadId: preload.id, nodeId: String(node.id), code: error.code || 'VOICE_PRELOAD_FAILED' });
  }
  await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: {
    manifestJson: manifest, preparedNodeIdsJson: manifest.preparedNodeIds,
    preparedContentCount: manifest.contentCacheKeys.length, preparedAudioCount: manifest.audioCacheKeys?.length || 0,
  } });
  return { prepared: true, preloadId: preload.id, nodeId: String(node.id) };
}

function fireAndRecord(input) {
  setImmediate(() => triggerNextNode(input).catch((error) => {
    console.warn('[learning-preload] next-node preload failed', {
      sessionId: Number(input.learningSessionId), nodeId: input.nextNodeId ? String(input.nextNodeId) : null,
      code: error.code || 'NEXT_NODE_PRELOAD_FAILED',
    });
  }));
}

module.exports = { triggerNextNode, fireAndRecord };
