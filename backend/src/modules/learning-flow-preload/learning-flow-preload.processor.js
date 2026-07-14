const prisma = require('../../config/prisma');
const tasks = require('../async-task/async-task.service');
const preloadService = require('./learning-flow-preload.service');
const contentCache = require('./learning-flow-preload-cache.service');
const voicePrewarm = require('./voice-prewarm.service');
const { bailianModelCall } = require('../learning-agent/adapters/bailian-model.adapter');
const { STRATEGY_TO_SCHEMA } = require('../learning-agent/schemas/explainer.schema');

const SAFE_NODE_TYPES = new Set(['concept_explanation', 'analogy_explanation', 'worked_example_analysis', 'socratic_questioning']);

function normalizeType(value) {
  return String(value || '').trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
}

function firstNode(graph) {
  const nodes = graph.nodes || [];
  return nodes.find((node) => String(node.id) === String(graph.entryNodeId)) || nodes[0] || null;
}

async function knowledgeResults(goal) {
  const bases = await prisma.knowledgeBase.findMany({
    where: { course_id: goal.course_id, status: 'active', dify_dataset_id: { not: null } },
    select: { knowledge_base_id: true, name: true, dify_dataset_id: true }, take: 5,
  });
  if (!bases.length) return { datasets: [], records: [], unavailable: false };
  try {
    const adapter = require('../learning-agent/adapters/dify-knowledge.adapter');
    const result = await adapter.retrieveFromMultipleDatasets(bases.map((item) => item.dify_dataset_id), goal.raw_goal || goal.normalized_title, { topK: 4, scoreThreshold: 0.25 });
    const records = Array.isArray(result) ? result : (result.records || result.data || []);
    return {
      datasets: bases.map((item) => ({ id: item.knowledge_base_id, name: item.name })),
      records: records.slice(0, 8).map((item) => ({ content: String(item.content || item.segment?.content || item.text || '').slice(0, 1200), score: item.score ?? null })),
      unavailable: false,
    };
  } catch {
    return { datasets: bases.map((item) => ({ id: item.knowledge_base_id, name: item.name })), records: [], unavailable: true };
  }
}

async function generateSafeNodeContent(context, node, knowledge) {
  const nodeType = normalizeType(node.type);
  const strategy = ({ concept_explanation: 'direct', analogy_explanation: 'analogy', worked_example_analysis: 'example_analysis', socratic_questioning: 'socratic' })[nodeType];
  const guard = nodeType === 'socratic_questioning' ? '只生成启发式开场问题，不提供答案、解析或评价。' : '只生成当前独立讲解，不生成后续练习答案、诊断结论、掌握度结论或未来分支反馈。';
  const shape = strategy === 'direct' ? '{"strategy":"direct","title":"...","sections":[{"heading":"...","content":"...","key_points":["..."]}],"summary":"...","knowledge_sources":[],"estimated_reading_minutes":3}'
    : strategy === 'analogy' ? '{"strategy":"analogy","concept":"...","analogies":[{"domain":"...","mapping":"...","limitation":"..."}],"bridge_back":"...","knowledge_sources":[]}'
      : strategy === 'example_analysis' ? '{"strategy":"example_analysis","problem_statement":"独立示例题","solution_steps":[{"step_number":1,"description":"...","rationale":"..."}],"final_answer":"该独立示例的结果","key_insights":["..."],"common_mistakes":["..."],"knowledge_sources":[]}'
        : '{"strategy":"socratic","starting_question":"...","guidance_hints":["..."],"expected_insight":"...","follow_up_questions":["..."],"knowledge_sources":[]}';
  const prompt = `为学习准备缓存生成一个安全的首节点内容。\n目标：${context.goal.normalized_title}\n课程：${context.goal.course?.course_name || ''}\n知识点：${context.goal.primary_knowledge_point?.knowledge_point_name || ''}\n节点：${node.title || node.id} (${nodeType})\n${guard}\n使用清晰中文，控制在 500 字以内。\n可用知识摘要：${knowledge.records.map((item) => item.content).join('\n').slice(0, 3500)}`;
  const result = await bailianModelCall([
    { role: 'system', content: '你负责预生成不依赖学生作答的安全学习内容。严禁泄露题目答案或生成自适应反馈。' },
    { role: 'user', content: `${prompt}\n只输出符合以下结构的 JSON：${shape}` },
  ], { jsonMode: true, enableThinking: false, temperature: 0.2, maxTokens: 900, timeout: 120000 });
  const parsed = typeof result.content === 'string' ? JSON.parse(result.content.replace(/^```(?:json)?\s*|\s*```$/g, '')) : result.content;
  const modelContent = STRATEGY_TO_SCHEMA[strategy].parse(parsed);
  const narrationText = [modelContent.title, modelContent.concept, modelContent.problem_statement, modelContent.starting_question,
    ...(modelContent.sections || []).map((item) => `${item.heading}。${item.content}`),
    ...(modelContent.analogies || []).map((item) => `${item.domain}。${item.mapping}`),
    ...(modelContent.solution_steps || []).map((item) => item.description), modelContent.summary, modelContent.bridge_back,
  ].filter(Boolean).join('。');
  return { modelContent, narrationText };
}

async function buildBaseManifest(preload, context) {
  const graph = context.graph;
  const resources = await prisma.learningFlowResourceLink.findMany({
    where: {
      ownerUserId: preload.userId, deletedAt: null,
      OR: [
        { learningGoalId: preload.learningGoalId }, { workflowTemplateId: preload.workflowTemplateId },
        { courseId: context.goal.course_id, knowledgePointId: context.goal.primary_knowledge_point_id || undefined },
      ],
    },
    include: { artifact: { select: { id: true, title: true, artifactType: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const knowledge = await knowledgeResults(context.goal);
  const nodes = graph.nodes || [];
  return {
    workflowTemplateId: preload.workflowTemplateId,
    workflowVersion: preload.workflowVersion,
    learningGoalId: preload.learningGoalId,
    courseId: context.goal.course_id,
    knowledgePointIds: [context.goal.primary_knowledge_point_id, ...(context.goal.related_knowledge_points || [])].filter((value, index, values) => Number.isInteger(Number(value)) && values.indexOf(value) === index),
    resourceLinks: resources.map((link) => ({ id: link.id, role: link.resourceRole, artifact: link.artifact })),
    introText: `本次学习将围绕“${context.goal.normalized_title}”展开。请先查看课前资料，再按节点逐步完成学习。`,
    learningGoal: { title: context.goal.normalized_title, focusQuestion: context.goal.focus_question, targetMastery: context.goal.target_mastery },
    preLearningNotes: ['预加载内容不包含练习答案。', '学习中仍会根据你的真实作答实时调整后续内容。'],
    nodeSummaries: nodes.map((node) => ({ id: String(node.id), type: normalizeType(node.type), title: node.title || String(node.id) })),
    knowledgeResults: knowledge,
    preparedNodeIds: [], contentCacheKeys: [], audioCacheKeys: [], preparedContent: {},
    createdAt: new Date().toISOString(), expiresAt: preload.expiresAt.toISOString(),
  };
}

async function processPreload(preloadId, { taskId, signal } = {}) {
  const preload = await prisma.learningFlowPreload.findUnique({ where: { id: Number(preloadId) } });
  if (!preload || preload.deletedAt) throw Object.assign(new Error('学习准备记录不存在'), { code: 'PRELOAD_NOT_FOUND', permanent: true });
  try {
    await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: { status: 'PRELOADING', stage: '正在生成学习基础包', progress: 10, startedAt: preload.startedAt || new Date(), errorCode: null, errorMessage: null } });
    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', stage: '正在生成学习基础包', progress: 10 });
    const context = await preloadService.contextFor(preload.userId, { learningPlanId: preload.learningPlanId, workflowTemplateId: preload.workflowTemplateId, learningGoalId: preload.learningGoalId, learningSessionId: preload.learningSessionId });
    if (context.preloadKey !== preload.preloadKey) throw Object.assign(new Error('学习准备依赖已变化'), { code: 'PRELOAD_KEY_STALE', permanent: true });
    const manifest = await buildBaseManifest(preload, context);
    await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: { manifestJson: manifest, stage: '学习基础包已完成', progress: 40 } });
    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', stage: '正在生成首节点内容', progress: 45 });

    let contentReady = false;
    const entry = firstNode(context.graph);
    const entryType = normalizeType(entry?.type);
    if (entry && SAFE_NODE_TYPES.has(entryType)) {
      try {
        const content = await generateSafeNodeContent(context, entry, manifest.knowledgeResults);
        if (content?.modelContent) {
          const stored = await contentCache.putContent(preload.preloadKey, String(entry.id), content, { nodeType: entryType });
          manifest.preparedNodeIds.push(String(entry.id));
          manifest.contentCacheKeys.push({ nodeId: String(entry.id), ...stored });
          manifest.preparedContent[String(entry.id)] = content.narrationText;
          contentReady = true;
        }
      } catch (error) {
        manifest.contentWarning = String(error.code || 'SAFE_NODE_PRELOAD_FAILED');
      }
    } else {
      manifest.contentWarning = 'FIRST_NODE_NOT_SAFE_FOR_PRELOAD';
    }

    if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', stage: '正在准备学习引导语音', progress: 70 });
    let audioReady = false;
    let voiceTask = null;
    try {
      const created = await tasks.createTask(preload.userId, {
        operationId: `voice-preload-${preload.id}-${preload.voiceConfigHash}`,
        taskType: 'VOICE_PRELOAD', title: '正在准备学习引导语音', description: '预热开场语和安全首节点语音缓存',
        status: 'RUNNING', stage: '正在准备学习引导语音', progressMode: 'DETERMINATE', progress: 20,
        relatedResourceType: 'LEARNING_FLOW_PRELOAD', relatedResourceId: preload.id,
        resultType: 'LEARNING_FLOW_PRELOAD', resultId: preload.id,
        resultUrl: `#/student/learning-flows?flowId=${preload.workflowTemplateId}&preloadId=${preload.id}`,
        cancellable: false, maxAttempts: 2, metadataJson: { preloadId: preload.id },
      });
      voiceTask = created;
      manifest.audioCacheKeys = await voicePrewarm.prewarmPreload(preload, manifest, signal);
      audioReady = manifest.audioCacheKeys.length > 0;
      await tasks.updateTask(created.id, { status: 'SUCCEEDED', stage: '学习引导语音已准备', progress: 100 });
    } catch (error) {
      manifest.voiceWarning = String(error.code || 'VOICE_PRELOAD_FAILED');
      if (voiceTask) await tasks.updateTask(voiceTask.id, { status: 'FAILED', stage: '学习引导语音准备失败', errorCode: manifest.voiceWarning, errorMessage: '语音准备失败，文字学习不受影响。' }).catch(() => {});
    }
    const status = contentReady && audioReady ? 'READY' : 'PARTIAL';
    const stage = status === 'READY' ? '学习流已准备完成' : '学习准备部分完成';
    const updated = await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: {
      status, stage, progress: 100, manifestJson: manifest, preparedNodeIdsJson: manifest.preparedNodeIds,
      preparedContentCount: manifest.contentCacheKeys.length, preparedAudioCount: manifest.audioCacheKeys.length,
      completedAt: new Date(), errorCode: status === 'PARTIAL' ? (manifest.voiceWarning || manifest.contentWarning || 'PRELOAD_PARTIAL') : null,
      errorMessage: status === 'PARTIAL' ? '部分准备未完成，仍可直接开始学习。' : null,
    } });
    if (taskId) await tasks.updateTask(taskId, { status: 'SUCCEEDED', stage, progress: 100, resultType: 'LEARNING_FLOW_PRELOAD', resultId: preload.id, resultUrl: `#/student/learning-flows?flowId=${preload.workflowTemplateId}&preloadId=${preload.id}` });
    return updated;
  } catch (error) {
    await prisma.learningFlowPreload.update({ where: { id: preload.id }, data: { status: 'FAILED', activeKey: preload.activeKey, stage: '学习准备失败', progress: 0, errorCode: String(error.code || 'PRELOAD_FAILED').slice(0, 100), errorMessage: '学习准备未完成，仍可直接开始学习。', completedAt: new Date() } }).catch(() => {});
    if (taskId) await tasks.updateTask(taskId, { status: 'FAILED', stage: '学习准备失败', errorCode: String(error.code || 'PRELOAD_FAILED'), errorMessage: '学习准备未完成，仍可直接开始学习。' }).catch(() => {});
    return null;
  }
}

module.exports = { SAFE_NODE_TYPES, normalizeType, firstNode, knowledgeResults, generateSafeNodeContent, buildBaseManifest, processPreload };
