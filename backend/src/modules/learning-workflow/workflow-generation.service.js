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
      { id: 'e6', source: 'node_6', target: 'node_7', condition: { type: 'mastery_gte', params: { threshold: 75 } }, label: '掌握度 >= 75' },
      { id: 'e7', source: 'node_6', target: 'node_3', condition: { type: 'mastery_lt', params: { threshold: 75 } }, label: '掌握度 < 75' },
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
      { id: 'e5', source: 'node_5', target: 'node_6', condition: { type: 'mastery_gte', params: { threshold: 80 } }, label: '掌握度 >= 80' },
      { id: 'e6', source: 'node_5', target: 'node_2', condition: { type: 'mastery_lt', params: { threshold: 80 } }, label: '掌握度 < 80' },
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

  // 阶段一：立即生成草稿
  const draft = await generateDraft(inputText, userId, courseId, knowledgePointId);

  // 创建数据库记录
  const job = await prisma.aiFlowGenerationJob.create({
    data: {
      user_id: Number(userId),
      input_text: String(inputText).trim(),
      course_id: courseId ? Number(courseId) : null,
      knowledge_point_id: knowledgePointId ? Number(knowledgePointId) : null,
      draft_json: { graph: draft.graph, settings: draft.settings },
      status: 'PENDING',
    },
  });

  // 阶段二：后台异步 AI 优化
  setImmediate(() => {
    optimizeWithAI(job.job_id, inputText, draft, userId, courseId);
  });

  return {
    jobId: job.job_id,
    draft,
    status: 'draft_ready',
  };
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
};
