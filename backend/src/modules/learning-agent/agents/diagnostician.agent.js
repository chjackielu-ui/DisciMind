/**
 * Diagnostician Agent (诊断师) - LangChain 原生实现
 *
 * 支持模式: error_type_identification, misconception_summary,
 *          consecutive_error_analysis, strategy_failure_analysis, diagnostic_decision,
 *          wrong_question_diagnosis, learning_summary
 * 使用 qwen3.7-plus 模型 + Zod 结构化输出
 */

const { bailianModelCall } = require('../adapters/bailian-model.adapter');
const {
  DiagnosticianOutput,
  DiagnosticianFallbackOutput,
  DiagnosticianResult,
} = require('../schemas/diagnostician.schema');

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const DIAGNOSTICIAN_SYSTEM_PROMPT = `你是一名专业的学习诊断师（Diagnostician Agent），隶属于"学研智擎"教学平台。

你的核心职责：
1. 分析学生的学习数据和答题记录，识别错误类型和模式
2. 总结学生的知识误区和薄弱环节
3. 分析连续错误的根本原因
4. 评估当前教学策略的有效性
5. 给出具体的诊断决策：是否需要降低难度、切换讲解策略、补充前置知识、插入补救、或结束当前节点

诊断原则：
- 基于数据做判断，不要主观臆测
- 区分概念性错误和粗心错误
- 关注错误模式而非孤立错误
- 对策略失败要有具体的证据支撑
- 掌握度、连续错误次数、最大题数和退出阈值由后端规则决定，你只做分析

输出格式要求：
你必须严格以 JSON 格式输出，不得添加任何 markdown 代码块标记。
根据 mode 字段的不同，输出格式也不同。`;

const MODE_PROMPTS = {
  error_type_identification: `
【当前模式: error_type_identification - 错误类型识别】
分析学生的答题错误，识别错误类型。
输出格式:
{
  "mode": "error_type_identification",
  "primary_error_type": "concept_misunderstanding",
  "secondary_error_types": ["calculation_error"],
  "confidence": 0.85,
  "evidence": "学生连续3次在概念辨析题上出错，且错误模式一致",
  "suggested_remediation": "建议先回到概念讲解，用对比示例澄清误区"
}`,

  misconception_summary: `
【当前模式: misconception_summary - 误区总结】
总结学生当前知识点的认知误区。
输出格式:
{
  "mode": "misconception_summary",
  "identified_misconceptions": [
    {
      "description": "学生对过拟合和欠拟合的区分不清晰",
      "frequency": 3,
      "severity": "high",
      "related_knowledge_points": ["模型评估", "正则化"]
    }
  ],
  "root_cause_analysis": "学生可能混淆了训练集和测试集性能的含义",
  "overall_pattern": "学生在涉及多个概念交叉的题目上表现较弱"
}`,

  consecutive_error_analysis: `
【当前模式: consecutive_error_analysis - 连续错误分析】
分析学生连续出错的模式。
输出格式:
{
  "mode": "consecutive_error_analysis",
  "error_sequence": [
    {"question_index": 1, "error_type": "concept_misunderstanding", "description": "..."},
    {"question_index": 2, "error_type": "calculation_error", "description": "..."}
  ],
  "pattern_detected": true,
  "pattern_description": "错误从概念理解逐渐转向计算错误，表明基础不扎实",
  "is_escalating": false,
  "recommended_action": "暂停当前练习，回顾核心概念"
}`,

  strategy_failure_analysis: `
【当前模式: strategy_failure_analysis - 策略失败分析】
评估当前教学策略是否有效。
输出格式:
{
  "mode": "strategy_failure_analysis",
  "current_strategy": "direct_instruction",
  "failure_indicators": ["学生在类比题上连续答错", "讲解后立即练习正确率仍低于40%"],
  "suggested_strategy": "analogy_bridge",
  "rationale": "学生可能需要通过类比来建立直观理解",
  "confidence": 0.7
}`,

  diagnostic_decision: `
【当前模式: diagnostic_decision - 诊断决策】
综合所有信息，给出明确的诊断决策。
输出格式:
{
  "mode": "diagnostic_decision",
  "should_reduce_difficulty": false,
  "should_switch_explanation_strategy": true,
  "should_add_prerequisite_knowledge": true,
  "should_insert_remediation": true,
  "should_end_node": false,
  "should_flag_for_teacher_review": false,
  "decisions": [
    {
      "action": "switch_strategy",
      "reason": "直接讲解效果不佳，建议切换到类比桥接",
      "priority": 90,
      "target_agent": "explainer",
      "params": {"strategy": "analogy"}
    },
    {
      "action": "review_prerequisite",
      "reason": "学生缺少前置知识，建议补充线性代数基础",
      "priority": 75,
      "target_agent": "explainer",
      "params": {"topic": "矩阵运算基础"}
    }
  ],
  "overall_assessment": "学生对核心概念有一定了解但缺少直观理解，需要切换策略并补充前置知识",
  "mastery_estimate": 45
}`,

  wrong_question_diagnosis: `
【当前模式: wrong_question_diagnosis - 错题修复诊断】
结合本轮答题记录，诊断错误类型、误区、错误原因和修复建议。即使记录较少，也要给出保守且可执行的诊断。
输出格式:
{
  "mode": "wrong_question_diagnosis",
  "diagnosis_conclusion": "诊断结论",
  "error_types": ["concept_misunderstanding"],
  "misconception": "主要误区",
  "reasonable_parts": ["学生理解中合理的部分"],
  "root_cause": "错误原因",
  "repair_suggestions": ["修复建议"],
  "recommended_next_step": "推荐下一步",
  "needs_remedial_explanation": true
}`,

  learning_summary: `
【当前模式: learning_summary - 学习总结】
总结本轮完成情况、已掌握与薄弱内容、错题情况、掌握度变化和后续建议。
输出格式:
{
  "mode": "learning_summary",
  "completion_summary": "本轮完成情况",
  "mastered_content": ["已掌握内容"],
  "weak_content": ["薄弱内容"],
  "wrong_answer_summary": "错题情况",
  "mastery_change": {"before": 60, "after": 75},
  "next_steps": ["后续建议"]
}`,
};

// ---------------------------------------------------------------------------
// 消息构建
// ---------------------------------------------------------------------------

function buildDiagnosticianMessages({ mode, studentContext, sessionContext, recentAnswers, knowledgeBaseContext }) {
  let userMsg = '';

  // 学生上下文
  if (studentContext) {
    userMsg += `【学生信息】\n`;
    userMsg += `掌握度: ${studentContext.masteryScore ?? '未知'}\n`;
    userMsg += `掌握等级: ${studentContext.masteryLevel ?? '未知'}\n`;
    userMsg += `连续正确: ${studentContext.consecutiveCorrect ?? 0}\n`;
    userMsg += `连续错误: ${studentContext.consecutiveWrong ?? 0}\n`;
    userMsg += `总正确/总错误: ${studentContext.totalCorrect ?? 0}/${studentContext.totalWrong ?? 0}\n\n`;
  }

  // 会话上下文
  if (sessionContext) {
    userMsg += `【会话信息】\n`;
    userMsg += `当前节点类型: ${sessionContext.currentNodeType ?? '未知'}\n`;
    userMsg += `节点迭代次数: ${sessionContext.nodeIterationCount ?? 0}\n`;
    userMsg += `训练题目数: ${sessionContext.trainingQuestionCount ?? 0}\n`;
    userMsg += `补救轮次: ${sessionContext.remediationRound ?? 0}\n`;
    userMsg += `当前策略: ${sessionContext.currentStrategy ?? '未知'}\n\n`;
  }

  // 最近的答题记录
  if (recentAnswers?.length) {
    userMsg += `【最近答题记录】\n`;
    for (const ans of recentAnswers.slice(-8)) {
      userMsg += `- 题目: ${ans.questionSummary ?? '未知'}, 正确: ${ans.isCorrect}, 错误类型: ${ans.errorType ?? 'N/A'}, 耗时: ${ans.duration}s\n`;
    }
    userMsg += '\n';
  }

  // 知识库上下文
  if (knowledgeBaseContext) {
    userMsg += `【知识库参考】${knowledgeBaseContext}\n\n`;
  }

  // 模式指令
  userMsg += MODE_PROMPTS[mode] || MODE_PROMPTS.diagnostic_decision;

  return [
    { role: 'system', content: DIAGNOSTICIAN_SYSTEM_PROMPT },
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
    const validated = DiagnosticianOutput.parse(parsed);
    return { valid: true, data: validated, rawContent };
  } catch (validationError) {
    return { valid: false, error: validationError.message, rawContent, parsed };
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
 * 执行诊断
 *
 * @param {Object} params
 * @param {string} params.mode                - 诊断模式
 * @param {Object} [params.studentContext]     - 学生上下文
 * @param {Object} [params.sessionContext]     - 会话上下文
 * @param {Array}  [params.recentAnswers]      - 最近答题记录
 * @param {string} [params.knowledgeBaseContext] - 知识库上下文
 * @param {Array}  [params.retrievalRefs]      - 知识库引用
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>} DiagnosticianResult
 */
async function runDiagnostician(params) {
  const {
    mode = 'diagnostic_decision',
    studentContext,
    sessionContext,
    recentAnswers,
    knowledgeBaseContext,
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

  const messages = buildDiagnosticianMessages({
    mode,
    studentContext,
    sessionContext,
    recentAnswers,
    knowledgeBaseContext,
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
      conservative_recommendation: '诊断服务暂时不可用，建议继续当前学习计划。',
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
      conservative_recommendation: '诊断结果格式异常，建议继续当前学习计划。',
    };
    result.validationError = validation.error;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 后端规则诊断（不调用 LLM，纯规则判断）
// ---------------------------------------------------------------------------

/**
 * 基于后端规则做出确定性诊断决策。
 * 这些阈值由后端控制，不由 LLM 决定。
 */
function deterministicDiagnosis(params) {
  const {
    consecutiveWrong = 0,
    consecutiveCorrect = 0,
    masteryScore = 0,
    nodeIterationCount = 0,
    trainingQuestionCount = 0,
    remediationRound = 0,
    sameErrorTypeCount = 0,
    maxNodeIterations = parseInt(process.env.LANGGRAPH_MAX_NODE_ITERATIONS || '8', 10),
    maxTrainingQuestions = parseInt(process.env.LANGGRAPH_MAX_TRAINING_QUESTIONS || '6', 10),
    maxRemediationRounds = parseInt(process.env.LANGGRAPH_MAX_REMEDIATION_ROUNDS || '1', 10),
  } = params;

  const decisions = [];

  // 达到硬上限 → 强制退出
  if (nodeIterationCount >= maxNodeIterations) {
    decisions.push({
      action: 'force_end_node',
      reason: `节点迭代次数已达上限 (${maxNodeIterations})`,
      priority: 100,
      target_agent: 'orchestrator',
    });
  }
  if (trainingQuestionCount >= maxTrainingQuestions) {
    decisions.push({
      action: 'force_end_node',
      reason: `训练题目数已达上限 (${maxTrainingQuestions})`,
      priority: 100,
      target_agent: 'orchestrator',
    });
  }
  if (remediationRound >= maxRemediationRounds) {
    decisions.push({
      action: 'skip_remediation',
      reason: `补救轮次已达上限 (${maxRemediationRounds})`,
      priority: 100,
      target_agent: 'orchestrator',
    });
  }

  // 已经有强制退出 → 不再判断其他
  if (decisions.some((d) => d.action === 'force_end_node')) {
    return {
      mode: 'diagnostic_decision',
      should_reduce_difficulty: trainingQuestionCount >= maxTrainingQuestions,
      should_switch_explanation_strategy: false,
      should_add_prerequisite_knowledge: false,
      should_insert_remediation: false,
      should_end_node: true,
      should_flag_for_teacher_review: false,
      decisions,
      overall_assessment: '已达到上限，结束当前节点。',
      mastery_estimate: masteryScore,
      is_deterministic: true,
    };
  }

  // 连续错误 >= 3 → 降难度
  if (consecutiveWrong >= 3) {
    decisions.push({
      action: 'reduce_difficulty',
      reason: `连续错误 ${consecutiveWrong} 次`,
      priority: 85,
      target_agent: 'trainer',
    });
    decisions.push({
      action: 'switch_strategy',
      reason: '可能需要更换讲解方式',
      priority: 70,
      target_agent: 'explainer',
      params: { strategy: 'analogy' },
    });
  }

  // 同类错误 >= 4 → 插入补救
  if (sameErrorTypeCount >= 4) {
    decisions.push({
      action: 'insert_remediation',
      reason: `同类错误出现 ${sameErrorTypeCount} 次，需要针对性补救`,
      priority: 80,
      target_agent: 'explainer',
      params: { strategy: 'misconception_repair' },
    });
  }

  // 连续正确 >= 3 且掌握度 >= 85 → 建议结束
  if (consecutiveCorrect >= 3 && masteryScore >= 85) {
    decisions.push({
      action: 'suggest_end_node',
      reason: `连续正确 ${consecutiveCorrect} 次且掌握度 ${masteryScore}%`,
      priority: 60,
      target_agent: 'orchestrator',
    });
  }

  // 连续无进展 ≥ 3 → 切换策略
  if (nodeIterationCount >= 3 && consecutiveCorrect === 0 && consecutiveWrong === 0) {
    decisions.push({
      action: 'switch_strategy',
      reason: '当前策略未见明显进展',
      priority: 65,
      target_agent: 'explainer',
    });
  }

  return {
    mode: 'diagnostic_decision',
    should_reduce_difficulty: decisions.some((d) => d.action === 'reduce_difficulty'),
    should_switch_explanation_strategy: decisions.some((d) => d.action === 'switch_strategy'),
    should_add_prerequisite_knowledge: masteryScore < 30,
    should_insert_remediation: decisions.some((d) => d.action === 'insert_remediation'),
    should_end_node: decisions.some((d) => d.action === 'force_end_node'),
    should_flag_for_teacher_review: consecutiveWrong >= 5,
    decisions: decisions.length > 0 ? decisions : [{ action: 'continue', reason: '无需干预', priority: 10 }],
    overall_assessment: decisions.length > 0 ? `检测到 ${decisions.length} 个干预信号` : '当前表现正常',
    mastery_estimate: masteryScore,
    is_deterministic: true,
  };
}

module.exports = {
  runDiagnostician,
  deterministicDiagnosis,
  DIAGNOSTICIAN_SYSTEM_PROMPT,
  MODE_PROMPTS,
  parseAndValidate,
};
