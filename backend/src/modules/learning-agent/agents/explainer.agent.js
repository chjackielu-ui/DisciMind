/**
 * Explainer Agent (讲解者) - LangChain 原生实现
 *
 * 支持策略: direct, analogy, example_analysis, socratic, misconception_repair, summary
 * 使用 qwen3.7-plus 模型 + Zod 结构化输出
 */

const { z } = require('zod');
const { bailianModelCall } = require('../adapters/bailian-model.adapter');
const {
  ExplainerOutput,
  ExplainerFallbackOutput,
  ExplainerResult,
  STRATEGY_TO_SCHEMA,
} = require('../schemas/explainer.schema');

// ---------------------------------------------------------------------------
// System Prompts
// ---------------------------------------------------------------------------

const EXPLAINER_SYSTEM_PROMPT = `你是一名专业的学科讲解者（Explainer Agent），隶属于"学研智擎"教学平台。

你的核心职责：
1. 根据学生的掌握度、学习风格和当前知识点，提供个性化的概念讲解
2. 使用多种教学策略：直接讲解、类比桥接、例题分析、苏格拉底式提问、误区修复、知识总结
3. 基于课程知识库内容进行教学，确保内容准确、来源可追溯

教学原则：
- 从学生当前理解水平出发，逐步深入
- 使用具体例子和类比帮助理解抽象概念
- 鼓励学生思考，而非直接给出答案（苏格拉底模式）
- 识别并纠正常见误解
- 所有讲解应结构清晰、层次分明

输出格式要求：
你必须严格以 JSON 格式输出，不得添加任何 markdown 代码块标记，不得有额外的解释文字。
根据 strategy 字段的不同，输出格式也不同。具体格式由调用方指定。`;

// 策略专属 prompt 后缀
const STRATEGY_PROMPTS = {
  direct: `
【当前策略: direct - 直接讲解】
输出格式:
{
  "strategy": "direct",
  "title": "讲解标题",
  "sections": [
    {"heading": "小节标题", "content": "讲解内容", "key_points": ["要点1", "要点2"]}
  ],
  "summary": "总结",
  "knowledge_sources": [{"document_name": "来源文档", "segment_id": "分段ID"}],
  "estimated_reading_minutes": 5
}`,

  analogy: `
【当前策略: analogy - 类比讲解】
输出格式:
{
  "strategy": "analogy",
  "concept": "概念名称",
  "analogies": [
    {"domain": "类比领域", "mapping": "映射说明", "limitation": "类比局限"}
  ],
  "bridge_back": "如何从类比回到原概念",
  "knowledge_sources": [{"document_name": "来源文档"}]
}`,

  example_analysis: `
【当前策略: example_analysis - 例题分析】
输出格式:
{
  "strategy": "example_analysis",
  "problem_statement": "题目陈述",
  "solution_steps": [
    {"step_number": 1, "description": "步骤描述", "rationale": "理由"}
  ],
  "final_answer": "最终答案",
  "key_insights": ["关键洞察"],
  "common_mistakes": ["常见错误"],
  "knowledge_sources": [{"document_name": "来源文档"}]
}`,

  socratic: `
【当前策略: socratic - 苏格拉底式提问】
通过提问引导学生自己发现答案。注意：不要直接给出答案！
输出格式:
{
  "strategy": "socratic",
  "starting_question": "引导性的起始问题",
  "guidance_hints": ["提示1", "提示2"],
  "expected_insight": "期望学生达到的理解",
  "knowledge_sources": [{"document_name": "来源文档"}]
}`,

  misconception_repair: `
【当前策略: misconception_repair - 误区修复】
识别并纠正学生的错误理解。
输出格式:
{
  "strategy": "misconception_repair",
  "identified_misconception": "识别到的误区",
  "why_it_is_wrong": "为什么这是错误的",
  "correct_understanding": "正确的理解",
  "contrast_examples": [{"wrong": "错误示例", "right": "正确示例"}],
  "practice_question": "用于检验的练习题",
  "knowledge_sources": [{"document_name": "来源文档"}]
}`,

  summary: `
【当前策略: summary - 知识总结】
对当前知识点进行系统性总结。
输出格式:
{
  "strategy": "summary",
  "topic": "主题",
  "key_concepts": [{"name": "概念名", "explanation": "解释"}],
  "concept_map": "概念之间的关系说明",
  "review_questions": ["复习问题"],
  "next_steps": ["下一步建议"],
  "knowledge_sources": [{"document_name": "来源文档"}]
}`,
};

// ---------------------------------------------------------------------------
// 构建消息
// ---------------------------------------------------------------------------

function buildUserMessage({ strategy, query, knowledgePointName, retrievalContext, imageAnalysisSummary, studentContext }) {
  let message = '';

  if (knowledgePointName) {
    message += `【知识点】${knowledgePointName}\n\n`;
  }

  if (studentContext) {
    message += `【学生掌握度】${studentContext.masteryScore ?? '未知'}\n`;
    message += `【学习风格】${studentContext.learningStyle ?? '未知'}\n`;
    if (studentContext.misconceptions?.length) {
      message += `【已知误区】${studentContext.misconceptions.join('; ')}\n`;
    }
    message += '\n';
  }

  if (retrievalContext) {
    message += `【课程知识库内容】\n${retrievalContext}\n\n`;
  } else {
    message += `【注意】当前未检索到课程知识库内容，请基于你的知识进行讲解，但要标记为未基于课程知识库。\n\n`;
  }

  if (imageAnalysisSummary) {
    message += `【图片分析结果】${imageAnalysisSummary}\n\n`;
  }

  message += `【讲解请求】${query}\n\n`;

  // 添加策略提示
  message += STRATEGY_PROMPTS[strategy] || STRATEGY_PROMPTS.direct;

  return message;
}

function buildMessages({ strategy, query, knowledgePointName, retrievalContext, imageAnalysisSummary, studentContext, conversationHistory }) {
  const systemPrompt = EXPLAINER_SYSTEM_PROMPT;

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // 最近的对话历史（最多 6 条）
  if (conversationHistory?.length) {
    const recent = conversationHistory.slice(-6);
    for (const msg of recent) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({
    role: 'user',
    content: buildUserMessage({ strategy, query, knowledgePointName, retrievalContext, imageAnalysisSummary, studentContext }),
  });

  return messages;
}

// ---------------------------------------------------------------------------
// 结构化输出验证与修复
// ---------------------------------------------------------------------------

const MAX_REPAIR_ATTEMPTS = 1;

function parseAndValidate(rawContent, expectedStrategy) {
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { valid: false, error: 'JSON 解析失败', rawContent };
  }

  // 尝试用对应的 strategy schema 校验
  const schema = STRATEGY_TO_SCHEMA[expectedStrategy];
  if (!schema) {
    return { valid: false, error: `未知策略: ${expectedStrategy}` };
  }

  try {
    const validated = ExplainerOutput.parse(parsed);
    return { valid: true, data: validated, rawContent };
  } catch (validationError) {
    return { valid: false, error: validationError.message, rawContent, parsed };
  }
}

/**
 * 自动修复一次：让模型重新生成符合格式的输出
 */
async function repairOutput(originalMessages, expectedStrategy, previousError) {
  const repairMessages = [
    ...originalMessages.slice(0, -1),
    {
      role: 'assistant',
      content: '[上一次的输出格式不正确，需要重新生成]',
    },
    {
      role: 'user',
      content: `你上一次的输出格式不正确。错误: ${previousError}

请严格按 JSON 格式重新输出，不要添加 markdown 代码块标记（即不要使用 \`\`\`json 或 \`\`\`），直接从 { 开始输出。
确保 strategy 字段为 "${expectedStrategy}"。`,
    },
  ];

  try {
    const response = await bailianModelCall(repairMessages, { jsonMode: true, temperature: 0.1 });
    return response.content;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 主调用
// ---------------------------------------------------------------------------

/**
 * 执行讲解
 *
 * @param {Object} params
 * @param {string} params.strategy          - 讲解策略 (direct|analogy|example_analysis|socratic|misconception_repair|summary)
 * @param {string} params.query             - 用户查询/讲解请求
 * @param {string} [params.knowledgePointName] - 知识点名称
 * @param {string} [params.retrievalContext] - 知识库检索结果（文本形式）
 * @param {string} [params.imageAnalysisSummary] - 图片分析结果
 * @param {Object} [params.studentContext]   - 学生上下文
 * @param {Array}  [params.conversationHistory] - 对话历史
 * @param {Array}  [params.retrievalRefs]    - 知识库检索引用
 * @param {AbortSignal} [params.signal]      - 取消信号
 * @returns {Promise<Object>} ExplainerResult
 */
async function runExplainer(params) {
  const {
    strategy = 'direct',
    query,
    knowledgePointName,
    retrievalContext,
    imageAnalysisSummary,
    studentContext,
    conversationHistory,
    retrievalRefs = [],
    signal,
  } = params;

  const result = {
    rawOutput: null,
    normalizedOutput: null,
    validationError: null,
    knowledgeBased: !!retrievalContext,
    retrievalRefs,
    modelTiming: { totalMs: 0, firstTokenMs: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    repairTiming: null,
  };

  // 1. 构建消息
  const messages = buildMessages({
    strategy,
    query,
    knowledgePointName,
    retrievalContext,
    imageAnalysisSummary,
    studentContext,
    conversationHistory,
  });

  // 2. 调用模型
  let rawContent;
  const modelStart = process.hrtime.bigint();
  try {
    const response = await bailianModelCall(messages, { signal, jsonMode: true });
    rawContent = response.content;
    result.modelTiming = {
      totalMs: response.timing?.totalMs || 0,
      firstTokenMs: response.timing?.firstTokenMs || 0,
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      reasoningTokens: response.usage?.reasoning_tokens || 0,
    };
  } catch (err) {
    result.modelTiming.totalMs = Math.round(Number(process.hrtime.bigint() - modelStart) / 1e6);
    // 返回降级结果
    result.normalizedOutput = {
      strategy: strategy,
      content: `讲解服务暂时不可用: ${err.message}。请稍后重试或联系教师获取帮助。`,
      validation_error: err.message,
      is_fallback: true,
    };
    result.validationError = err.message;
    return result;
  }

  result.rawOutput = rawContent;

  // 3. 解析和验证
  let validation = parseAndValidate(rawContent, strategy);

  // 4. 自动修复（最多一次）
  if (!validation.valid) {
    const repairStart = process.hrtime.bigint();
    const repairedContent = await repairOutput(messages, strategy, validation.error);
    if (repairedContent) {
      validation = parseAndValidate(repairedContent, strategy);
      if (validation.valid) {
        result.rawOutput = repairedContent;
      }
    }
    result.repairTiming = { totalMs: Math.round(Number(process.hrtime.bigint() - repairStart) / 1e6) };
  }

  // 5. 返回结果 — 标记交互需求
  if (validation.valid) {
    result.normalizedOutput = validation.data;
    if (validation.fallback) {
      result.validationError = validation.data.validation_error;
    }
    // 标记是否需要学生交互
    if (strategy === 'socratic' && validation.data.starting_question) {
      result.normalizedOutput.requires_student_input = true;
    }
    if (strategy === 'misconception_repair' && validation.data.practice_question) {
      result.normalizedOutput.requires_student_input = true;
    }
    if (strategy === 'direct' && (validation.data.starting_question || validation.data.guidance_hints)) {
      result.normalizedOutput.requires_student_input = true;
    }
  } else {
    // 确定性的降级结果
    result.normalizedOutput = {
      strategy: strategy,
      content: rawContent,
      validation_error: validation.error,
      is_fallback: true,
    };
    result.validationError = validation.error;
  }

  return result;
}

module.exports = {
  runExplainer,
  EXPLAINER_SYSTEM_PROMPT,
  STRATEGY_PROMPTS,
  buildMessages,
  parseAndValidate,
};
