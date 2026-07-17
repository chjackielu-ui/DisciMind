// AI 自然语言生成学习流服务 — 双阶段生成（即时草稿 + 后台AI优化）
const prisma = require('../../config/prisma');
const { createAgentError } = require('../agent/common/agent.errors');
const {
  ALLOWED_NODE_TYPES,
  ALLOWED_CONDITION_TYPES,
  sanitizeGraphJson,
  sanitizeSettingsJson,
  validateGraphJson,
  MAX_NODES,
} = require('./workflow-schema');
const workflowTemplateService = require('./workflow-template.service');
const { bailianModelCall } = require('../learning-agent/adapters/bailian-model.adapter');

// 五套系统模板的 graph 结构（用于草稿生成）
const TEMPLATE_GRAPHS = {
  standard: {
    entryNodeId: 'node_1',
    nodes: [
      { id: 'node_1', type: 'concept_explanation', title: '概念讲解', config: { estimatedMinutes: 6, strategy: 'direct_instruction' }, position: { x: 120, y: 40 } },
      { id: 'node_2', type: 'worked_example_analysis', title: '例题分析', config: { estimatedMinutes: 5 }, position: { x: 120, y: 130 } },
      { id: 'node_3', type: 'basic_practice', title: '基础练习', config: { estimatedMinutes: 6, questionCount: 3 }, position: { x: 120, y: 220 } },
      { id: 'node_4', type: 'mastery_gate', title: '掌握度判断', config: {}, position: { x: 120, y: 310 } },
      { id: 'node_5', type: 'analogy_explanation', title: '类比讲解', config: { estimatedMinutes: 4, strategy: 'analogy_bridge' }, position: { x: 340, y: 130 } },
      { id: 'node_6', type: 'basic_practice', title: '巩固练习', config: { estimatedMinutes: 4, questionCount: 2 }, position: { x: 340, y: 220 } },
      { id: 'node_7', type: 'mastery_gate', title: '再次判断', config: {}, position: { x: 340, y: 310 } },
      { id: 'node_8', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 400 } },
    ],
    edges: [
      { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
      { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'always', params: {} } },
      { id: 'e3', source: 'node_3', target: 'node_4', condition: { type: 'always', params: {} } },
      { id: 'e4', source: 'node_4', target: 'node_8', condition: { type: 'mastery_gte', params: { threshold: 80 } }, label: '掌握度 >= 80' },
      { id: 'e5', source: 'node_4', target: 'node_5', condition: { type: 'mastery_lt', params: { threshold: 80 } }, label: '掌握度 < 80' },
      { id: 'e6', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
      { id: 'e7', source: 'node_6', target: 'node_7', condition: { type: 'always', params: {} } },
      { id: 'e8', source: 'node_7', target: 'node_8', condition: { type: 'always', params: {} } },
    ],
  },
  practice_driven: {
    entryNodeId: 'node_1',
    nodes: [
      { id: 'node_1', type: 'basic_practice', title: '快速练习', config: { estimatedMinutes: 4, questionCount: 2 }, position: { x: 120, y: 40 } },
      { id: 'node_2', type: 'adaptive_practice', title: '自适应练习', config: { estimatedMinutes: 8, questionCount: 5 }, position: { x: 120, y: 130 } },
      { id: 'node_3', type: 'wrong_question_repair', title: '错误分析', config: { estimatedMinutes: 5 }, position: { x: 120, y: 220 } },
      { id: 'node_4', type: 'concept_explanation', title: '针对性概念讲解', config: { estimatedMinutes: 4, strategy: 'misconception_confrontation' }, position: { x: 120, y: 310 } },
      { id: 'node_5', type: 'adaptive_practice', title: '变式练习', config: { estimatedMinutes: 5, questionCount: 3 }, position: { x: 120, y: 400 } },
      { id: 'node_6', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 490 } },
    ],
    edges: [
      { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
      { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'consecutive_wrong_gte', params: { threshold: 2 } }, label: '连续错误 >= 2' },
      { id: 'e3', source: 'node_2', target: 'node_5', condition: { type: 'accuracy_gte', params: { threshold: 70 } }, label: '准确率 >= 70%' },
      { id: 'e4', source: 'node_2', target: 'node_4', condition: { type: 'accuracy_lt', params: { threshold: 70 } }, label: '准确率 < 70%' },
      { id: 'e5', source: 'node_3', target: 'node_4', condition: { type: 'always', params: {} } },
      { id: 'e6', source: 'node_4', target: 'node_5', condition: { type: 'always', params: {} } },
      { id: 'e7', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
    ],
  },
  weakness_repair: {
    entryNodeId: 'node_1',
    nodes: [
      { id: 'node_1', type: 'wrong_question_repair', title: '错题分析', config: { estimatedMinutes: 5 }, position: { x: 120, y: 40 } },
      { id: 'node_2', type: 'concept_explanation', title: '概念对比', config: { estimatedMinutes: 4, strategy: 'misconception_confrontation' }, position: { x: 120, y: 130 } },
      { id: 'node_3', type: 'analogy_explanation', title: '类比讲解', config: { estimatedMinutes: 4, strategy: 'analogy_bridge' }, position: { x: 120, y: 220 } },
      { id: 'node_4', type: 'basic_practice', title: '基础练习', config: { estimatedMinutes: 5, questionCount: 3 }, position: { x: 120, y: 310 } },
      { id: 'node_5', type: 'adaptive_practice', title: '原题或同类题重做', config: { estimatedMinutes: 5, questionCount: 3 }, position: { x: 120, y: 400 } },
      { id: 'node_6', type: 'mastery_gate', title: '掌握度判断', config: {}, position: { x: 120, y: 490 } },
      { id: 'node_7', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 580 } },
    ],
    edges: [
      { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
      { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'always', params: {} } },
      { id: 'e3', source: 'node_3', target: 'node_4', condition: { type: 'always', params: {} } },
      { id: 'e4', source: 'node_4', target: 'node_5', condition: { type: 'always', params: {} } },
      { id: 'e5', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
      // 练习节点内部已经有有界的自适应出题策略。拓扑层必须保持 DAG，
      // 否则目标学习流会在持久化前被安全校验器拒绝。
      { id: 'e6', source: 'node_6', target: 'node_7', condition: { type: 'always', params: {} } },
    ],
  },
  socratic_inquiry: {
    entryNodeId: 'node_1',
    nodes: [
      { id: 'node_1', type: 'socratic_questioning', title: '问题引入', config: { estimatedMinutes: 5, strategy: 'socratic_dialogue' }, position: { x: 120, y: 40 } },
      { id: 'node_2', type: 'socratic_questioning', title: '苏格拉底提问', config: { estimatedMinutes: 6, strategy: 'socratic_dialogue' }, position: { x: 120, y: 130 } },
      { id: 'node_3', type: 'concept_explanation', title: '概念讲解', config: { estimatedMinutes: 5, strategy: 'direct_instruction' }, position: { x: 120, y: 220 } },
      { id: 'node_4', type: 'adaptive_practice', title: '应用练习', config: { estimatedMinutes: 7, questionCount: 4 }, position: { x: 120, y: 310 } },
      { id: 'node_5', type: 'mastery_gate', title: '掌握度判断', config: {}, position: { x: 120, y: 400 } },
      { id: 'node_6', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 490 } },
    ],
    edges: [
      { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
      { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'always', params: {} } },
      { id: 'e3', source: 'node_3', target: 'node_4', condition: { type: 'always', params: {} } },
      { id: 'e4', source: 'node_4', target: 'node_5', condition: { type: 'always', params: {} } },
      // 对话和练习节点分别负责多轮追问与自适应重试；流程图只负责有界推进。
      { id: 'e5', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
    ],
  },
  exam_sprint: {
    entryNodeId: 'node_1',
    nodes: [
      { id: 'node_1', type: 'concept_explanation', title: '知识重点扫描', config: { estimatedMinutes: 5, strategy: 'direct_instruction', depth: 'brief' }, position: { x: 120, y: 40 } },
      { id: 'node_2', type: 'basic_practice', title: '高频基础练习', config: { estimatedMinutes: 6, questionCount: 4 }, position: { x: 120, y: 130 } },
      { id: 'node_3', type: 'adaptive_practice', title: '自适应练习', config: { estimatedMinutes: 8, questionCount: 5 }, position: { x: 120, y: 220 } },
      { id: 'node_4', type: 'wrong_question_repair', title: '错题修复', config: { estimatedMinutes: 6 }, position: { x: 120, y: 310 } },
      { id: 'node_5', type: 'adaptive_practice', title: '限时检测', config: { estimatedMinutes: 7, questionCount: 5 }, position: { x: 120, y: 400 } },
      { id: 'node_6', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 490 } },
    ],
    edges: [
      { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
      { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'always', params: {} } },
      { id: 'e3', source: 'node_3', target: 'node_4', condition: { type: 'consecutive_wrong_gte', params: { threshold: 2 } }, label: '连续错误 >= 2' },
      { id: 'e4', source: 'node_3', target: 'node_5', condition: { type: 'accuracy_gte', params: { threshold: 70 } }, label: '准确率 >= 70%' },
      { id: 'e5', source: 'node_4', target: 'node_5', condition: { type: 'always', params: {} } },
      { id: 'e6', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
    ],
  },
};

const TEMPLATE_SETTINGS = {
  standard: { completion_mode: 'flow_complete', target_mastery: 80, adjustment_mode: 'auto_adjust', estimated_minutes: 25 },
  practice_driven: { completion_mode: 'flow_complete', target_mastery: 80, adjustment_mode: 'auto_adjust', estimated_minutes: 25 },
  weakness_repair: { completion_mode: 'mastery_target', target_mastery: 75, adjustment_mode: 'auto_adjust', estimated_minutes: 20 },
  socratic_inquiry: { completion_mode: 'mastery_target', target_mastery: 80, adjustment_mode: 'ask_before_adjust', estimated_minutes: 30 },
  exam_sprint: { completion_mode: 'mastery_target', target_mastery: 85, adjustment_mode: 'auto_adjust', estimated_minutes: 35 },
};

/**
 * 根据自然语言关键词匹配模板
 */
function matchTemplateByKeywords(inputText) {
  const text = inputText.toLowerCase();
  const scores = {};

  // 练习驱动关键词
  if (text.includes('练习') || text.includes('做题') || text.includes('刷题') || text.includes('检测')) {
    scores.practice_driven = (scores.practice_driven || 0) + 3;
  }

  // 薄弱/错题关键词
  if (text.includes('错题') || text.includes('薄弱') || text.includes('巩固') || text.includes('修复') || text.includes('补')) {
    scores.weakness_repair = (scores.weakness_repair || 0) + 4;
  }

  // 苏格拉底/探究关键词
  if (text.includes('苏格拉底') || text.includes('探究') || text.includes('提问') || text.includes('思考') || text.includes('理解原理')) {
    scores.socratic_inquiry = (scores.socratic_inquiry || 0) + 4;
  }

  // 考试/冲刺关键词
  if (text.includes('考试') || text.includes('冲刺') || text.includes('备考') || text.includes('复习') || text.includes('限时')) {
    scores.exam_sprint = (scores.exam_sprint || 0) + 3;
  }

  // 默认关键词 - 讲解/概念/学习
  if (text.includes('讲解') || text.includes('概念') || text.includes('学习') || text.includes('标准') || text.includes('基础')) {
    scores.standard = (scores.standard || 0) + 1;
  }

  // 选择最高分
  const entries = Object.entries(scores);
  if (entries.length === 0) return 'standard';

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/**
 * 解析自然语言中的参数
 */
function parseInputParams(inputText) {
  const params = {};

  // 提取时间
  const timeMatch = inputText.match(/(\d+)\s*(分钟|min)/i);
  if (timeMatch) {
    params.estimatedMinutes = parseInt(timeMatch[1], 10);
  }

  // 提取掌握度目标
  const masteryMatch = inputText.match(/掌握度?\s*(\d+)/i);
  if (masteryMatch) {
    params.targetMastery = Math.max(60, Math.min(100, parseInt(masteryMatch[1], 10)));
  }

  // 条件关键词
  if (inputText.includes('连续错') || inputText.includes('连续答错')) {
    params.hasConsecutiveWrong = true;
  }
  if (inputText.includes('类比') || inputText.includes('换个方式')) {
    params.preferAnalogy = true;
  }

  return params;
}

/**
 * 阶段一：立即生成草稿（规则匹配）
 */
async function generateDraft(inputText, userId, courseId, knowledgePointId) {
  const templateKey = matchTemplateByKeywords(inputText);
  const params = parseInputParams(inputText);

  return generateDraftFromTemplate(templateKey, params);
}

/**
 * 供受信任的后端规划层按白名单模板键复用现有生成器。
 * 外部请求不能直接调用此函数，且输出仍经过既有 sanitizer。
 */
function generateDraftFromTemplate(templateKey, params = {}) {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_GRAPHS, templateKey)) {
    throw createAgentError('INVALID_TEMPLATE_KEY', '学习流模板不在允许白名单中', 400);
  }

  const baseGraph = JSON.parse(JSON.stringify(TEMPLATE_GRAPHS[templateKey]));
  const baseSettings = { ...TEMPLATE_SETTINGS[templateKey] };

  // 应用参数调整
  if (params.estimatedMinutes) {
    baseSettings.estimated_minutes = params.estimatedMinutes;
  }
  if (params.targetMastery) {
    baseSettings.target_mastery = params.targetMastery;
  }

  const sanitizedGraph = sanitizeGraphJson(baseGraph);
  const sanitizedSettings = sanitizeSettingsJson(baseSettings);

  return {
    templateKey,
    graph: sanitizedGraph,
    settings: sanitizedSettings,
    matchedReason: getTemplateReason(templateKey),
    stage: 'draft',
  };
}

async function generateDraftWithAI(inputText, userId, courseId, knowledgePointId) {
  const [course, knowledgePoint] = await Promise.all([
    courseId ? prisma.course.findUnique({
      where: { course_id: Number(courseId) }, select: { course_id: true, course_name: true },
    }) : null,
    knowledgePointId ? prisma.knowledgePoint.findUnique({
      where: { knowledge_point_id: Number(knowledgePointId) },
      select: { knowledge_point_id: true, knowledge_point_name: true, course_id: true },
    }) : null,
  ]);
  if (courseId && !course) throw createAgentError('COURSE_NOT_FOUND', '所选课程不存在', 404);
  if (knowledgePointId && (!knowledgePoint || (courseId && Number(knowledgePoint.course_id) !== Number(courseId)))) {
    throw createAgentError('KNOWLEDGE_POINT_NOT_FOUND', '所选知识点不属于当前课程', 400);
  }

  const systemPrompt = `你是 DisciMind 的学习流规划器。根据学生自然语言目标选择学习节点和达成条件，后端会把你的紧凑计划编译成安全 DAG。
只允许节点类型：${ALLOWED_NODE_TYPES.join(', ')}。
只允许条件类型：${ALLOWED_CONDITION_TYPES.join(', ')}。
要求：
1. 生成 3-7 个节点，每个节点必须服务于学生目标，不要机械套模板；
2. nodes 按实际执行先后排序，最后通常是 learning_summary；禁止设计回跳；
3. 练习节点 questionCount 为 1-6；estimatedMinutes 为 1-20；
4. 如用户要求掌握度、正确率、连续错误或答题结果条件，在 branches 中表达；from/to 使用从 1 开始的节点序号，to 必须大于 from；
5. 输出必须简洁，少于 900 个 token，只输出纯 JSON，不要 Markdown。格式：
{"rationale":"一句生成理由","nodes":[{"type":"concept_explanation","title":"几何直觉讲解","estimatedMinutes":4,"questionCount":null}],"branches":[{"from":3,"to":5,"condition":"accuracy_gte","threshold":70,"label":"正确率 ≥ 70%"}],"targetMastery":85,"estimatedMinutes":25,"completionMode":"mastery_target"}`;
  const userPrompt = `课程：${course?.course_name || '未指定'}\n知识点：${knowledgePoint?.knowledge_point_name || '未指定'}\n学生需求：${String(inputText).trim().slice(0, 1500)}\n请根据需求选择最合适的节点、顺序、分支条件和目标。`;
  const response = await bailianModelCall([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { jsonMode: true, enableThinking: false, temperature: 0.2, timeout: 30_000 });
  let parsed;
  try { parsed = JSON.parse(response.content); } catch {
    throw createAgentError('AI_FLOW_INVALID_JSON', 'AI 返回的学习流不是有效 JSON', 502);
  }
  const planNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  if (planNodes.length < 3) throw createAgentError('AI_FLOW_INVALID_PLAN', 'AI 返回的节点计划过短', 502);
  let nodes = planNodes.slice(0, 7).filter((item) => ALLOWED_NODE_TYPES.includes(item?.type)).map((item, index) => ({
    id: `node_${index + 1}`,
    type: item.type,
    title: String(item.title || `学习节点 ${index + 1}`).slice(0, 80),
    description: '',
    config: {
      estimatedMinutes: Math.max(1, Math.min(20, Number(item.estimatedMinutes) || 4)),
      ...(/practice|evaluation|variant/.test(item.type)
        ? { questionCount: Math.max(1, Math.min(6, Number(item.questionCount) || 3)) }
        : {}),
    },
    position: { x: 120 + (index % 4) * 240, y: 80 + Math.floor(index / 4) * 150 },
  }));
  if (nodes.length < 3) throw createAgentError('AI_FLOW_INVALID_PLAN', 'AI 未返回足够的受支持节点', 502);
  if (nodes.at(-1)?.type !== 'learning_summary') {
    nodes = nodes.filter((node) => node.type !== 'learning_summary').map((node, index) => ({
      ...node, id: `node_${index + 1}`,
      position: { x: 120 + (index % 4) * 240, y: 80 + Math.floor(index / 4) * 150 },
    }));
    nodes.push({
      id: `node_${nodes.length + 1}`, type: 'learning_summary', title: '学习总结', description: '',
      config: { estimatedMinutes: 3 }, position: { x: 120 + (nodes.length % 4) * 240, y: 80 + Math.floor(nodes.length / 4) * 150 },
    });
  }
  const thresholdConditions = new Set(['mastery_gte', 'mastery_lt', 'consecutive_wrong_gte', 'accuracy_gte', 'accuracy_lt']);
  const branches = (Array.isArray(parsed.branches) ? parsed.branches : []).filter((branch) => {
    const from = Number(branch.from); const to = Number(branch.to);
    return Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to > from && to <= nodes.length
      && ALLOWED_CONDITION_TYPES.includes(branch.condition) && branch.condition !== 'always'
      && (!thresholdConditions.has(branch.condition) || Number.isFinite(Number(branch.threshold)));
  });
  const edges = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const sourceIndex = index + 1;
    const sourceBranches = branches.filter((branch) => Number(branch.from) === sourceIndex);
    const usedTargets = new Set();
    for (const branch of sourceBranches) {
      const target = nodes[Number(branch.to) - 1]?.id;
      if (!target || usedTargets.has(target)) continue;
      usedTargets.add(target);
      edges.push({
        id: `edge_${edges.length + 1}`, source: nodes[index].id, target,
        label: String(branch.label || branch.condition).slice(0, 100),
        condition: {
          type: branch.condition,
          params: thresholdConditions.has(branch.condition) ? { threshold: Number(branch.threshold) } : {},
        },
      });
    }
    const sequentialTarget = nodes[index + 1].id;
    if (!usedTargets.has(sequentialTarget)) {
      edges.push({
        id: `edge_${edges.length + 1}`, source: nodes[index].id, target: sequentialTarget,
        label: '', condition: { type: 'always', params: {} },
      });
    }
  }
  const graph = sanitizeGraphJson({ entryNodeId: nodes[0].id, nodes, edges });
  const settings = sanitizeSettingsJson({
    completion_mode: parsed.completionMode || 'mastery_target',
    target_mastery: Number(parsed.targetMastery) || 80,
    adjustment_mode: 'ask_before_adjust',
    estimated_minutes: Number(parsed.estimatedMinutes) || 25,
  });
  const validation = validateGraphJson(graph);
  if (!validation.valid) {
    throw createAgentError('AI_FLOW_INVALID_GRAPH', `AI 学习流校验失败：${validation.errors?.join('；') || validation.message || '结构无效'}`, 502);
  }
  return {
    templateKey: 'ai_custom',
    graph,
    settings,
    matchedReason: String(parsed.rationale || 'AI 已根据你的学习目标匹配节点与达成条件。').slice(0, 500),
    stage: 'ai_generated',
    aiGenerated: true,
    modelTiming: response.timing || null,
    modelUsage: response.usage || null,
  };
}

function getTemplateReason(templateKey) {
  const reasons = {
    standard: '根据你的学习需求，推荐标准学习流，从概念讲解到练习再到总结。',
    practice_driven: '根据你的练习偏好，推荐练习驱动流，以练习为核心发现薄弱点。',
    weakness_repair: '根据你的错题情况，推荐薄弱修复流，重点分析和修复薄弱环节。',
    socratic_inquiry: '根据你的探究需求，推荐苏格拉底探究流，通过提问引导深度理解。',
    exam_sprint: '根据你的冲刺需求，推荐考试冲刺流，高效覆盖高频考点。',
  };
  return reasons[templateKey] || reasons.standard;
}

/**
 * 阶段二：AI 优化（后台异步）
 */
async function optimizeWithAI(jobId, inputText, draftResult, userId, courseId) {
  try {
    // 标记为生成中
    await prisma.aiFlowGenerationJob.update({
      where: { job_id: jobId },
      data: { status: 'GENERATING' },
    });

    // 调用 Dify AI 优化
    const agentConfig = await prisma.aiAgentConfig.findFirst({
      where: { agent_type: 'EXPLAINER', enabled: true },
    });

    if (!agentConfig) {
      throw new Error('没有可用的 AI 配置');
    }

    // 使用 Dify 进行流程优化
    const { runDiagnosticianWorkflow, buildDifyUser } = require('../../dify/agent-dify.service');
    const difyUser = buildDifyUser('diagnostician', Number(userId));

    const { businessResult } = await runDiagnosticianWorkflow({
      mode: 'strategy_intervention',
      requestId: `ai_flow_gen_${jobId}`,
      payload: {
        input_text: inputText,
        draft_graph: draftResult.graph,
        draft_settings: draftResult.settings,
        course_id: courseId ? String(courseId) : null,
        task: 'optimize_learning_workflow',
      },
      locale: 'zh-CN',
      difyUser,
    }).catch(() => null);

    if (businessResult?.result?.graph || businessResult?.data?.graph) {
      const optimizedGraph = businessResult.result?.graph || businessResult.data?.graph;
      const optimizedSettings = businessResult.result?.settings || businessResult.data?.settings || draftResult.settings;

      // 校验 AI 输出
      const validatedGraph = sanitizeGraphJson(optimizedGraph);
      const validation = validateGraphJson(validatedGraph);

      if (validation.valid) {
        await prisma.aiFlowGenerationJob.update({
          where: { job_id: jobId },
          data: {
            status: 'COMPLETED',
            optimized_json: {
              graph: validatedGraph,
              settings: sanitizeSettingsJson(optimizedSettings),
            },
          },
        });
        return;
      }

      // AI 输出不合法，保留草稿
      console.warn('[ai-flow-gen] AI 优化结果校验失败:', validation.errors);
    }

    // AI 失败，标记完成但使用草稿
    await prisma.aiFlowGenerationJob.update({
      where: { job_id: jobId },
      data: { status: 'COMPLETED', optimized_json: null },
    });
  } catch (err) {
    console.error('[ai-flow-gen] AI 优化异常:', err.message);
    await prisma.aiFlowGenerationJob.update({
      where: { job_id: jobId },
      data: {
        status: 'FAILED',
        error_message: String(err.message).slice(0, 500),
      },
    }).catch(() => null);
  }
}

/**
 * 主入口：创建 AI 生成任务
 */
async function createAiGeneration(inputText, userId, courseId, knowledgePointId) {
  if (!inputText || !inputText.trim()) {
    throw createAgentError('INVALID_INPUT', '请输入学习需求描述', 400);
  }

  const job = await prisma.aiFlowGenerationJob.create({
    data: {
      user_id: Number(userId),
      input_text: String(inputText).trim(),
      course_id: courseId ? Number(courseId) : null,
      knowledge_point_id: knowledgePointId ? Number(knowledgePointId) : null,
      status: 'GENERATING',
    },
  });
  let draft;
  try {
    draft = await generateDraftWithAI(inputText, userId, courseId, knowledgePointId);
    await prisma.aiFlowGenerationJob.update({
      where: { job_id: job.job_id },
      data: { status: 'COMPLETED', draft_json: { graph: draft.graph, settings: draft.settings, rationale: draft.matchedReason } },
    });
  } catch (error) {
    console.warn(`[ai-flow-gen] real AI generation failed job=${job.job_id}: ${error.code || error.message}`);
    // 保底草稿保证入口可用，同时明确告诉前端本次是降级结果。
    draft = await generateDraft(inputText, userId, courseId, knowledgePointId);
    draft.aiGenerated = false;
    draft.stage = 'fallback_draft';
    draft.matchedReason = `AI 生成暂时不可用，已按你的关键词生成安全草稿：${draft.matchedReason}`;
    await prisma.aiFlowGenerationJob.update({
      where: { job_id: job.job_id },
      data: {
        status: 'COMPLETED',
        draft_json: { graph: draft.graph, settings: draft.settings, rationale: draft.matchedReason },
        error_message: String(error.message || error).slice(0, 500),
      },
    });
  }
  return { jobId: job.job_id, draft, matchedReason: draft.matchedReason, status: 'completed' };
}

/**
 * 获取 AI 生成状态
 */
async function getGenerationStatus(jobId, userId) {
  const job = await prisma.aiFlowGenerationJob.findUnique({
    where: { job_id: Number(jobId) },
  });

  if (!job) {
    throw createAgentError('JOB_NOT_FOUND', '生成任务不存在', 404);
  }

  if (job.user_id !== Number(userId)) {
    throw createAgentError('JOB_ACCESS_DENIED', '无权访问该生成任务', 403);
  }

  return {
    jobId: job.job_id,
    status: job.status,
    draft: job.draft_json,
    optimized: job.optimized_json,
    errorMessage: job.error_message,
  };
}

module.exports = {
  TEMPLATE_GRAPHS,
  TEMPLATE_SETTINGS,
  createAiGeneration,
  getGenerationStatus,
  generateDraft,
  generateDraftFromTemplate,
  generateDraftWithAI,
};
