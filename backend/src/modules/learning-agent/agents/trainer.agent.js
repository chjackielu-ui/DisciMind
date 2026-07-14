/**
 * Trainer Agent (训练师) - LangChain 原生实现
 *
 * 支持模式: diagnostic_pre_test, basic_practice, adaptive_practice,
 *          deep_evaluation, wrong_question_repair, variant_question
 * 使用 qwen3.7-plus 模型 + Zod 结构化输出
 */

const { bailianModelCall } = require('../adapters/bailian-model.adapter');
const {
  TrainerOutput,
  TrainerFallbackOutput,
  TrainerResult,
  AnswerEvaluationOutput,
  AnswerEvaluationResult,
} = require('../schemas/trainer.schema');

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const TRAINER_SYSTEM_PROMPT = `你是一名专业的学科训练师（Trainer Agent），隶属于"学研智擎"教学平台。

你的核心职责：
1. 根据学生的学习进度和掌握度，生成合适的练习题
2. 评估学生的答题情况，给出专业的反馈和分析
3. 根据学生的薄弱环节，自适应调整题目难度和类型
4. 对错题进行深入分析并提供修复方案

教学原则：
- 题目难度应循序渐进，匹配学生当前水平
- 反馈应具体、有建设性，不只说"对"或"错"
- 对错误要分析根本原因，不只是表面现象
- 自适应练习应根据学生的实际表现调整策略
- 题目内容应基于课程知识库，确保知识点的准确性

输出格式要求：
你必须严格以 JSON 格式输出，不得添加任何 markdown 代码块标记，不得有额外的解释文字。
根据 mode 字段的不同，输出格式也不同。具体格式由调用方指定。`;

// 模式专属 prompt
const MODE_PROMPTS = {
  diagnostic_pre_test: `
【当前模式: diagnostic_pre_test - 诊断前测】
生成 1 道诊断性题目，用于评估学生对当前知识点的掌握程度。
必须只输出一个 json 对象（json object），不得使用 Markdown。json 格式:
{
  "mode": "diagnostic_pre_test",
  "questions": [
    {
      "question_id": "diag_1",
      "question_type": "single_choice",
      "stem": "题目描述",
      "options": [{"key": "A", "content": "选项A"}, {"key": "B", "content": "选项B"}, {"key": "C", "content": "选项C"}, {"key": "D", "content": "选项D"}],
      "correct_answer": "A",
      "analysis": "解析说明",
      "difficulty": "basic",
      "knowledge_point": "知识点名称",
      "is_ai_generated": true
    }
  ],
  "estimated_difficulty_range": "basic 到 medium",
  "diagnostic_focus": ["概念理解", "公式应用", "综合分析"]
}
每次只生成 1 道题。`,

  basic_practice: `
【当前模式: basic_practice - 基础练习】
根据【约束】要求的数量生成基础练习题，帮助学生巩固核心概念和基本技能。
输出格式:
{
  "mode": "basic_practice",
  "questions": [
    {
      "question_id": "bp_1",
      "question_type": "single_choice",
      "stem": "题目描述",
      "options": [{"key": "A", "content": "选项A"}, {"key": "B", "content": "选项B"}],
      "correct_answer": "A",
      "analysis": "解析说明",
      "difficulty": "basic",
      "knowledge_point": "知识点名称",
      "is_ai_generated": true
    }
  ],
  "practice_topic": "练习主题",
  "difficulty_progression": "由浅入深"
}
题目数量必须与【约束】一致。`,

  adaptive_practice: `
【当前模式: adaptive_practice - 自适应练习】
根据学生的表现和【约束】要求的数量动态生成题目。如果学生上一题做对且速度快，适当增加难度；如果做错或速度慢，降低难度或更换题型。
输出格式:
{
  "mode": "adaptive_practice",
  "questions": [
    {
      "question_id": "ap_1",
      "question_type": "single_choice",
      "stem": "题目描述",
      "options": [{"key": "A", "content": "选项A"}],
      "correct_answer": "A",
      "analysis": "解析说明",
      "difficulty": "medium",
      "knowledge_point": "知识点名称",
      "is_ai_generated": true,
      "adaptive_reason": "基于学生上一题的正确表现，适当提升难度",
      "target_pitfall": "定位的误区"
    }
  ],
  "student_level": "general",
  "adaptation_strategy": "基于正确率的动态调整"
}
题目数量必须与【约束】一致。`,

  deep_evaluation: `
【当前模式: deep_evaluation - 深度评估】
生成一道开放性或综合性题目，用于深度评估学生的理解水平。
输出格式:
{
  "mode": "deep_evaluation",
  "question": {
    "question_id": "de_1",
    "question_type": "short_answer",
    "stem": "题目描述",
    "analysis": "评分标准说明",
    "difficulty": "hard",
    "knowledge_point": "知识点名称",
    "is_ai_generated": true
  },
  "evaluation_rubric": {
    "dimensions": [
      {"name": "概念理解", "weight": 0.4, "scoring_guide": "准确描述核心概念得满分"},
      {"name": "逻辑推理", "weight": 0.3, "scoring_guide": "推理过程清晰得满分"},
      {"name": "综合应用", "weight": 0.3, "scoring_guide": "能联系相关知识得满分"}
    ],
    "total_score": 100
  },
  "expected_answer_elements": ["要素1", "要素2", "要素3"]
}`,

  wrong_question_repair: `
【当前模式: wrong_question_repair - 错题修复】
分析学生的错题，提供针对性的修复方案。
输出格式:
{
  "mode": "wrong_question_repair",
  "error_analysis": "对错误原因的深入分析",
  "remediation_content": "补救讲解内容",
  "similar_practice": [
    {
      "question_id": "wr_1",
      "question_type": "single_choice",
      "stem": "与错题类似的练习题",
      "options": [{"key": "A", "content": "选项A"}],
      "correct_answer": "A",
      "analysis": "解析",
      "difficulty": "basic",
      "knowledge_point": "知识点",
      "is_ai_generated": true
    }
  ],
  "prevention_tips": ["避免方法1", "避免方法2"]
}`,

  variant_question: `
【当前模式: variant_question - 变式题】
基于原题生成变式题，帮助学生举一反三。
输出格式:
{
  "mode": "variant_question",
  "original_question_summary": "原题摘要",
  "variants": [
    {
      "question": {
        "question_id": "v_1",
        "question_type": "single_choice",
        "stem": "变式题目",
        "options": [{"key": "A", "content": "选项A"}],
        "correct_answer": "A",
        "analysis": "解析",
        "difficulty": "medium",
        "knowledge_point": "知识点",
        "is_ai_generated": true
      },
      "variation_type": "参数变换",
      "difficulty_shift": "保持不变"
    }
  ]
}
生成 2-5 个变式。`,
};

// ---------------------------------------------------------------------------
// 答题评估 Prompt
// ---------------------------------------------------------------------------

const EVALUATION_SYSTEM_PROMPT = `你是一名专业的学科评估专家，隶属于"学研智擎"教学平台。

请评估学生的答案，给出专业的反馈。评估应包括：
1. 答案是否正确
2. 得分 (0-100)
3. 具体的反馈意见
4. 如果答错，判断错误类型
5. 提供修改建议

必须只输出一个 json 对象（json object），不得使用 Markdown。json 格式:
{
  "is_correct": true/false,
  "score": 85,
  "feedback": "对答案的详细评价",
  "error_type": null 或错误类型枚举值,
  "error_analysis": "错误原因分析",
  "remediation_hint": "修复建议",
  "confidence_level": "high/medium/low"
}

错误类型枚举值: concept_misunderstanding, memory_weak, formula_error, calculation_error, question_reading_error, method_selection_error, careless, time_insufficient, unknown, other`;

// ---------------------------------------------------------------------------
// 消息构建
// ---------------------------------------------------------------------------

function buildTrainerMessages({ mode, query, knowledgePointName, retrievalContext, studentContext, previousPerformance, maxQuestions }) {
  const messages = [
    { role: 'system', content: TRAINER_SYSTEM_PROMPT },
    { role: 'user', content: buildTrainerUserMessage({ mode, query, knowledgePointName, retrievalContext, studentContext, previousPerformance, maxQuestions }) },
  ];
  return messages;
}

function buildTrainerUserMessage({ mode, query, knowledgePointName, retrievalContext, studentContext, previousPerformance, maxQuestions }) {
  let msg = '';

  if (knowledgePointName) {
    msg += `【知识点】${knowledgePointName}\n\n`;
  }

  if (studentContext) {
    msg += `【学生掌握度】${studentContext.masteryScore ?? '未知'}\n`;
    msg += `【掌握等级】${studentContext.masteryLevel ?? '未知'}\n`;
    if (studentContext.errorTypes) {
      msg += `【常见错误类型】${JSON.stringify(studentContext.errorTypes)}\n`;
    }
    msg += '\n';
  }

  if (previousPerformance) {
    msg += `【前序表现】${JSON.stringify(previousPerformance)}\n\n`;
  }

  if (retrievalContext) {
    msg += `【课程知识库参考】\n${retrievalContext}\n\n`;
  }

  if (query) {
    msg += `【任务描述】${query}\n\n`;
  }

  msg += `【约束】请生成 ${maxQuestions || 3} 道题目，数量必须准确。\n\n`;
  msg += MODE_PROMPTS[mode] || MODE_PROMPTS.basic_practice;

  return msg;
}

function buildEvaluationMessages({ question, studentAnswer, correctAnswer, analysis }) {
  let userMsg = `【题目】${question}\n`;
  userMsg += `【学生答案】${studentAnswer}\n`;
  userMsg += `【正确答案】${correctAnswer}\n`;
  if (analysis) userMsg += `【题目解析】${analysis}\n`;

  return [
    { role: 'system', content: EVALUATION_SYSTEM_PROMPT },
    { role: 'user', content: userMsg },
  ];
}

// ---------------------------------------------------------------------------
// 结构化输出验证与修复
// ---------------------------------------------------------------------------

function parseAndValidate(rawContent, expectedMode) {
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { valid: false, error: 'JSON 解析失败', rawContent };
  }

  try {
    const validated = TrainerOutput.parse(parsed);
    return { valid: true, data: validated, rawContent };
  } catch (validationError) {
    try {
      const fallback = TrainerFallbackOutput.parse(parsed);
      return { valid: true, data: fallback, fallback: true, rawContent };
    } catch {
      return { valid: false, error: validationError.message, rawContent, parsed };
    }
  }
}

function parseEvaluation(rawContent) {
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { valid: false, error: 'JSON 解析失败' };
  }

  try {
    const validated = AnswerEvaluationOutput.parse(parsed);
    return { valid: true, data: validated };
  } catch (err) {
    return { valid: false, error: err.message, data: parsed };
  }
}

async function repairOutput(messages, expectedMode, previousError) {
  const repairMessages = [
    ...messages,
    {
      role: 'user',
      content: `输出格式不正确。错误: ${previousError}。请严格按照 JSON 格式重新输出，确保 mode 为 "${expectedMode}"。`,
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
 * 执行训练（生成题目）
 *
 * @param {Object} params
 * @param {string} params.mode              - 训练模式
 * @param {string} [params.query]           - 训练描述/指令
 * @param {string} [params.knowledgePointName] - 知识点名称
 * @param {string} [params.retrievalContext] - 知识库检索结果
 * @param {Object} [params.studentContext]   - 学生上下文
 * @param {Object} [params.previousPerformance] - 前序表现
 * @param {number} [params.maxQuestions=6]   - 最大题目数
 * @param {Array}  [params.retrievalRefs]    - 知识库引用
 * @param {AbortSignal} [params.signal]      - 取消信号
 * @returns {Promise<Object>} TrainerResult
 */
async function runTrainer(params) {
  const {
    mode = 'basic_practice',
    query,
    knowledgePointName,
    retrievalContext,
    studentContext,
    previousPerformance,
    maxQuestions = 3,
    retrievalRefs = [],
    signal,
  } = params;

  const result = {
    rawOutput: null,
    normalizedOutput: null,
    validationError: null,
    retrievalRefs,
    modelTiming: { totalMs: 0, firstTokenMs: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    repairTiming: null,
  };

  const messages = buildTrainerMessages({
    mode,
    query,
    knowledgePointName,
    retrievalContext,
    studentContext,
    previousPerformance,
    maxQuestions,
  });

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
    result.normalizedOutput = {
      mode,
      error: err.message,
      is_fallback: true,
      message: `训练师服务暂时不可用: ${err.message}。将使用现有题库中的题目。`,
    };
    result.validationError = err.message;
    return result;
  }

  result.rawOutput = rawContent;

  let validation = parseAndValidate(rawContent, mode);

  if (!validation.valid) {
    const repairStart = process.hrtime.bigint();
    const repaired = await repairOutput(messages, mode, validation.error);
    if (repaired) {
      validation = parseAndValidate(repaired, mode);
      if (validation.valid) {
        result.rawOutput = repaired;
      }
    }
    result.repairTiming = { totalMs: Math.round(Number(process.hrtime.bigint() - repairStart) / 1e6) };
  }

  if (validation.valid) {
    result.normalizedOutput = validation.data;
    if (validation.fallback) {
      result.validationError = validation.data.error;
    }
  } else {
    result.normalizedOutput = {
      mode,
      error: validation.error,
      is_fallback: true,
      message: '题目生成格式异常，请重试。',
    };
    result.validationError = validation.error;
  }

  return result;
}

/**
 * 评估学生答案
 *
 * @param {Object} params
 * @param {string} params.question      - 题目内容
 * @param {string} params.studentAnswer - 学生答案
 * @param {string} params.correctAnswer - 正确答案
 * @param {string} [params.analysis]    - 题目解析
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>}
 */
async function evaluateAnswer(params) {
  const { question, studentAnswer, correctAnswer, analysis, signal } = params;

  const result = {
    rawOutput: null,
    normalizedOutput: null,
    validationError: null,
  };

  const messages = buildEvaluationMessages({ question, studentAnswer, correctAnswer, analysis });

  try {
    const response = await bailianModelCall(messages, { signal, jsonMode: true, temperature: 0.1 });
    result.rawOutput = response.content;

    const validation = parseEvaluation(response.content);
    if (validation.valid) {
      result.normalizedOutput = validation.data;
    } else {
      // 开放回答不能用字符串全等做伪评价；格式异常时保留为未评价。
      result.normalizedOutput = {
        is_correct: null,
        score: null,
        feedback: '回答已记录，评价格式暂时无法识别。',
        error_type: null,
        confidence_level: 'low',
        evaluation_unavailable: true,
      };
      result.validationError = validation.error;
    }
  } catch (err) {
    result.normalizedOutput = {
      is_correct: null,
      score: null,
      feedback: '回答已记录，评价服务暂时不可用。',
      error_type: null,
      confidence_level: 'low',
      evaluation_unavailable: true,
    };
    result.validationError = err.message;
  }

  return result;
}

module.exports = {
  runTrainer,
  evaluateAnswer,
  TRAINER_SYSTEM_PROMPT,
  MODE_PROMPTS,
  parseAndValidate,
  parseEvaluation,
};
