const crypto = require('crypto');
const { getLearningNarrationModule } = require('../learning-narration');
const { buildNarrationScript } = require('../learning-narration/services/narration-script.service');
const { NarrationOrchestrator } = require('../learning-narration/services/narration-orchestrator.service');
const cache = require('./learning-flow-preload-cache.service');
const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');

function logicalVoiceKey(preload, nodeId, contentHash, config) {
  return cache.hash({
    workflowVersion: preload.workflowVersion,
    goalSnapshotHash: preload.goalSnapshotHash,
    nodeId,
    contentHash,
    voice: config.voice,
    speed: config.speechRate,
    language: process.env.BAILIAN_TTS_LANGUAGE_TYPE || 'Chinese',
  });
}

async function synthesizeOne(preload, item, signal) {
  const narration = getLearningNarrationModule();
  if (!narration.config.enabled) throw Object.assign(new Error('语音服务未启用'), { code: narration.config.unavailableReason || 'TTS_DISABLED' });
  const contentHash = cache.hash(item.text);
  const logicalKey = logicalVoiceKey(preload, item.nodeId, contentHash, narration.config);
  const metrics = {};
  const script = buildNarrationScript({
    jobId: `prewarm-${preload.id}-${item.nodeId}`, sessionId: null, nodeRunId: null,
    nodeType: item.nodeType || 'concept_explanation', agentType: 'EXPLAINER',
    content: { content: [item.text] }, purpose: 'node_content', config: narration.config, metrics,
  });
  script.scriptHash = crypto.createHash('sha256').update(`${logicalKey}|${script.scriptHash}`).digest('hex');
  const job = { script, metrics };
  const orchestrator = new NarrationOrchestrator({ adapter: narration.adapter, cache: narration.cache, config: narration.config });
  const result = await orchestrator.run(job, signal || new AbortController().signal);
  return { logicalKey, physicalCacheKey: narration.cache.key(script.scriptHash), nodeId: item.nodeId, contentHash, cacheHit: Boolean(result.cacheHit) };
}

async function prewarmPreload(preload, manifest, signal) {
  const items = [{ nodeId: '__intro__', nodeType: 'concept_explanation', text: manifest.introText }];
  const firstNodeId = manifest.preparedNodeIds?.[0];
  const firstContent = firstNodeId && manifest.preparedContent?.[firstNodeId];
  if (firstContent) items.push({ nodeId: firstNodeId, nodeType: manifest.nodeSummaries.find((node) => node.id === firstNodeId)?.type, text: firstContent });
  const audioCacheKeys = [];
  for (const item of items.filter((entry) => entry.text)) audioCacheKeys.push(await synthesizeOne(preload, item, signal));
  return audioCacheKeys;
}

async function processVoiceTask(task, signal) {
  const preloadId = Number(task.relatedResourceId || task.metadataJson?.preloadId);
  const preload = await prisma.learningFlowPreload.findUnique({ where: { id: preloadId } });
  if (!preload?.manifestJson) throw Object.assign(new Error('语音准备缺少有效的预加载基础包'), { code: 'PRELOAD_NOT_FOUND', permanent: true });
  try {
    const manifest = { ...preload.manifestJson };
    manifest.audioCacheKeys = await prewarmPreload(preload, manifest, signal);
    const status = preload.preparedContentCount > 0 && manifest.audioCacheKeys.length > 0 ? 'READY' : 'PARTIAL';
    await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: {
      status, stage: status === 'READY' ? '学习流已准备完成' : '学习准备部分完成', progress: 100,
      manifestJson: manifest, preparedAudioCount: manifest.audioCacheKeys.length, completedAt: new Date(),
      errorCode: status === 'PARTIAL' ? 'VOICE_PRELOAD_PARTIAL' : null,
      errorMessage: status === 'PARTIAL' ? '语音准备部分完成，文字学习不受影响。' : null,
    } });
    await tasks.updateTask(task.id, { status: 'SUCCEEDED', stage: '学习引导语音已准备', progress: 100 });
  } catch (error) {
    await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: { status: 'PARTIAL', stage: '学习准备部分完成', progress: 100, errorCode: String(error.code || 'VOICE_PRELOAD_FAILED'), errorMessage: '语音准备失败，文字学习不受影响。', completedAt: new Date() } });
    await tasks.updateTask(task.id, { status: 'FAILED', stage: '学习引导语音准备失败', errorCode: String(error.code || 'VOICE_PRELOAD_FAILED'), errorMessage: '语音准备失败，文字学习不受影响。' });
  }
}

module.exports = { logicalVoiceKey, synthesizeOne, prewarmPreload, processVoiceTask };
