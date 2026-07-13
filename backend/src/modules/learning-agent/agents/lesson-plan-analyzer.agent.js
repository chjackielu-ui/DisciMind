/**
 * Lesson Plan Analyzer Agent（关键词分析智能体）— 复盘模块专项增强版
 *
 * 职责：
 *   接收 keyword-cloud 服务输出的结构化关键词 + Collector 学情数据，
 *   用 LLM 做深度语义分析，输出面向"上一节课复盘模块"的完整分析结果。
 *
 * 两层处理：
 *   第一层：keyword-cloud.service.js（统计提取 — 停用词/同义词/加权评分/初分类）
 *   第二层：本 Agent（LLM 深度语义分析 — 复盘结论/教学调整/四类关键词精准归类）
 *
 * Agent 模式严格对齐 trainer.agent.js：
 *   SYSTEM_PROMPT → buildMessages → bailianModelCall(jsonMode)
 *   → parseAndValidate → repairOutput → 返回 structured result
 */

const { bailianModelCall } = require('../adapters/bailian-model.adapter');
const {
  LessonPlanAnalyzerOutput,
  LessonPlanAnalyzerFallback,
} = require('../schemas/lesson-plan.schema');

// ---------------------------------------------------------------------------
// System Prompt（复盘模块专项）
// ---------------------------------------------------------------------------

const ANALYZER_SYSTEM_PROMPT = `你是一名专业的教学数据分析师（Lesson Plan Analyzer Agent），隶属于"学研智擎"教学平台。

你的核心职责是：基于学生上一节课的提问数据、错题数据、学科专属助手对话数据、词云关键词统计数据，生成一份"上一节课复盘分析报告"，供教师直接用于编写正式教案。

==== 关键词来源说明 ====
你收到的关键词数据来自以下真实数据源（不可编造新的数据源）：
1. 学生端学科专属助手对话（AiConversation mode=SUBJECT）
2. 学生课程问答记录（ChatConversation agent_type=COURSE_QA）
3. 学生提问记录（StudentQuestionRecord）
4. AI 已提取的关键词（QuestionKeyword）
5. AI 已标注的混淆标签（QuestionConfusionTag）
6. 错题关联知识点（WrongQuestion）
7. 学生掌握度记录（StudentMasteryRecord）

==== 词云词大小映射规则（核心）====
词云中词的大小不是随机的，而是严格映射以下维度：
1. 综合得分(score, 0-10)：越高 → 词越大 ⭐ 最重要
   - score = 频次分(F)×0.30 + 学生覆盖分(S)×0.35 + 错题加权分(W)×0.20 + 知识点层级分(K)×0.15
   - S(学生覆盖分)权重最高=0.35，因为多人提问比一人反复提问更有教学价值
2. 学生覆盖(student_count)：提问学生越多 → 词越大
   - 同一个学生反复问同一词会被衰减避免刷分
3. 难度(difficulty)：高 → 词越大
   - ratio≥0.7为"高"、≥0.4为"中"、<0.4为"低"
4. 字符长度(char_length)：长概念词天然需要更大的渲染空间
5. 数据来源多样性(sources/source_count)：来源越丰富 → 越可信
最终渲染权重 = score × 0.5 + studentCoverageNormalized × 0.3 + charLengthNormalized × 0.2

==== 关键词权重解读规则 ====
- score 越高 → 学生关注越集中、知识难度越高、困惑越明显
- student_count 越大 → 受影响学生面越广，需要优先关注
- difficulty 为"高" → 该知识点是教学重点和难点的首选
- 同类型关键词聚集 → 说明该领域存在系统性困难
- teacher_note 是系统预生成的辅助建议，可参考但最终判断以学科上下文为准

==== 四类关键词归类标准 ====
1. "核心概念类"：学科基础概念、理论、定理、定义、原理、框架
   特征：包含"概念/理论/定理/定律/定义/原理/机制/结构/框架"或为专有学科术语
2. "方法步骤类"：操作流程、计算步骤、解题方法、算法流程
   特征：包含"方法/步骤/计算/推导/求解/算法/流程/公式/过程"
3. "易错理解类"：学生反复出错、容易混淆、理解偏差的知识点
   特征：包含"区别/差异/混淆/错误/误区/为什么/不是/搞混"
4. "情绪反馈类"：反映学生学习体验和态度的表述
   特征：包含"难/简单/复杂/有趣/无聊/不懂/困惑/焦虑"

==== 复盘结论生成规则 ====
复盘结论必须：
1. 引用真实数据（如"共提取关键词X个，覆盖Y名学生"）
2. 命名具体知识点（如"'导数定义'被18名学生反复提问"）
3. 描述困惑集中点（如"学生在链式法则的应用方向上存在系统性误解"）
4. 区分概念类困惑 vs 操作类困难
5. 给出可操作的教学建议

==== 教学调整策略生成规则 ====
每条调整策略必须：
1. 与具体关键词直接关联（引用关键词名称）
2. 给出可执行的教学动作（"复讲/案例/练习/提问/板书"等）
3. 指明优先级
4. 至少包含：复习承接策略、重难点突破策略、分层关注策略

输出要求：
你必须严格以 JSON 格式输出，不得添加任何 markdown 代码块标记。
所有字段必须完整填充，字符串不能为空。
复盘结论和教学调整策略必须使用中文学术语言，适合直接写入正式教案。`;

// ---------------------------------------------------------------------------
// 构建用户消息（增强版）
// ---------------------------------------------------------------------------

function buildAnalyzerMessages({ keywordCloud, learningData, courseName }) {
  const cloud = keywordCloud || {};
  const ld = learningData || {};

  // 按分类组织关键词摘要
  const conceptKws = (cloud.word_cloud || []).filter(k => k.category === '核心概念类');
  const methodKws = (cloud.word_cloud || []).filter(k => k.category === '方法步骤类');
  const mistakeKws = (cloud.word_cloud || []).filter(k => k.category === '易错理解类');
  const emotionKws = (cloud.word_cloud || []).filter(k => k.category === '情绪反馈类');
  const highDiffKws = (cloud.word_cloud || []).filter(k => k.difficulty === '高');

  const userMessage = [
    // ===== 课程上下文 =====
    `【课程名称】${courseName || '未知课程'}`,
    ``,
    // ===== 学情数据 =====
    `【班级学情数据】`,
    `学生总数：${ld.student_count || 0} 人`,
    `班级平均掌握度：${ld.average_mastery || 0} 分`,
    `近期提问总数：${ld.question_count || 0} 条`,
    `错题记录总数：${ld.wrong_question_count || 0} 条`,
    `薄弱知识点：${(ld.weak_knowledge_points || []).join('、') || '暂无数据'}`,
    `学生分段：优秀(≥85分) ${ld.student_segments?.excellent || 0}人 | 良好(70-84) ${ld.student_segments?.good || 0}人 | 一般(50-69) ${ld.student_segments?.general || 0}人 | 薄弱(<50) ${ld.student_segments?.weak || 0}人`,
    ``,
    // ===== 词云关键词（含完整维度）=====
    `【词云关键词 TOP15 — 按综合得分降序排列】`,
    (cloud.word_cloud || []).slice(0, 15).map((k, i) =>
      `${i + 1}. "${k.keyword}" | 得分:${k.score} | 频次:${k.count} | 字符长:${k.char_length || k.keyword.length} | 学生:${k.student_count}人 | 类型:${k.category} | 难度:${k.difficulty} | 知识点:${k.related_kp || '-'} | 数据源:${(k.sources || []).join('/')} | 教师备注:${k.teacher_note || '-'}`
    ).join('\n'),
    ``,
    `【词大小映射规则 — 请严格遵循】`,
    `词云中词的大小按以下规则映射：`,
    `1. 得分(score)越高 → 词越大（score 综合了频次30% + 学生覆盖35% + 错题20% + 知识点广度15%）`,
    `2. 字符长度(char_length)越长 → 词越大（长概念词需要更大空间才能清晰显示）`,
    `3. 学生覆盖(student_count)越广 → 词越大（多人提问的词更需要被关注）`,
    `4. 难度(difficulty)越高 → 词越大（高难度词=学生困惑集中，需要优先关注）`,
    `最终词大小 = score × 0.5 + charLengthFactor × 0.2 + studentCoverageFactor × 0.3`,
    ``,
    `【难度为"高"的关键词 — 教学重点难点首选】`,
    highDiffKws.length > 0
      ? highDiffKws.map(k => `"${k.keyword}"（得分${k.score}，${k.student_count}名学生，教师建议：${k.teacher_note || '重点关注'}）`).join('\n')
      : '暂无难度为高的关键词',
    ``,
    // ===== 分析任务（精确指令）=====
    `【分析任务 — 请逐项完成，每项输出到对应字段】`,
    ``,
    `1. 数据来源确认(keyword_sources)：`,
    `   列出实际使用的关键词来源类型。当前数据来自：`,
    `   - ai_subject_conversation（学生端学科专属助手对话）`,
    `   - student_question（学生课程问答记录）`,
    `   - confusion_tag（AI标注的混淆标签）`,
    `   - wrong_question（错题关联知识点）`,
    ``,
    `2. 关键词归类与精选(top_keywords)：`,
    `   从词云中精选 TOP10 关键词，每词标注：`,
    `   - keyword, weight(=score×10映射到0-100), difficulty_level(=difficulty映射为high/medium/low)`,
    `   - type(核心概念类/方法步骤类/易错理解类/情绪反馈类)`,
    `   - student_count, related_knowledge_point, sources, source_count, teacher_note`,
    ``,
    `3. 高频概念识别(student_focus_points)：`,
    `   从核心概念类中提取学生最关注的知识点，按 score 和 student_count 排序，`,
    `   每点含 knowledge_point(query最多的概念名), question_frequency(count), student_count, analysis(为什么被高频提问)`,
    ``,
    `4. 易错理解点识别(student_confusion_points)：`,
    `   从易错理解类中提取，描述具体理解偏差，`,
    `   每点含 topic, confusion_description(具体偏差描述), affected_student_count`,
    ``,
    `5. 方法步骤障碍识别(student_error_prone_steps)：`,
    `   从方法步骤类中提取操作层面的障碍，`,
    `   每点含 step, error_pattern, severity(高/中/低)`,
    ``,
    `6. 情绪反馈总结(emotional_feedback_summary)：`,
    `   基于情绪反馈类关键词总结学生的学习体验（100字内）`,
    ``,
    `7. 复盘结论撰写(review_conclusion)：`,
    `   撰写 150-300 字的复盘结论，必须：`,
    `   - 引用真实数据（如"'导数定义'被18名学生反复提问，得分7.8/10"）`,
    `   - 命名具体知识点和困惑点`,
    `   - 区分"概念理解困难"和"操作技能困难"`,
    `   - 使用中文学术语言"`,
    ``,
    `8. 教学调整策略(teaching_adjustments)：5条，每条必须关联关键词、给出可执行动作`,
    ``,
    `【注意事项】`,
    `- score 和 student_count 是可解释的词大小映射因素，请直接引用`,
    `- teacher_note 是系统生成的辅助建议，请结合学科上下文判断是否采纳`,
    `- 如果某类数据为空，标注"暂无数据"，不要编造`,
    `- 所有分析面向上节课复盘，不要泛泛而谈`,
  ].join('\n');

  return [
    { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];
}

// ---------------------------------------------------------------------------
// JSON 解析与校验
// ---------------------------------------------------------------------------

function parseAndValidate(rawContent) {
  let parsed;
  try {
    parsed = JSON.parse(String(rawContent || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  } catch {
    return { valid: false, error: 'JSON 解析失败', rawContent };
  }

  try {
    const validated = LessonPlanAnalyzerOutput.parse(parsed);
    return { valid: true, data: validated, rawContent };
  } catch (validationError) {
    return { valid: false, error: validationError.message, rawContent, parsed };
  }
}

// ---------------------------------------------------------------------------
// 修复输出
// ---------------------------------------------------------------------------

async function repairOutput(messages, previousError) {
  const repairMessages = [
    ...messages,
    {
      role: 'user',
      content: `输出格式不正确。错误详情: ${previousError}。请严格按照 JSON 格式重新输出完整的分析结果，确保所有必填字段存在且字符串不为空。只输出 JSON，不要加 markdown 代码块。`,
    },
  ];
  try {
    const response = await bailianModelCall(repairMessages, { jsonMode: true, temperature: 0.1, enableThinking: false });
    return response.content;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * @param {Object} params
 * @param {Object} params.keywordCloud   - keyword-cloud.service 的输出
 * @param {Object} params.learningData   - Collector Agent 的输出
 * @param {string} params.courseName     - 课程名称
 * @returns {Promise<{rawOutput: any, normalizedOutput: object, validationError: string|null, modelTiming: object, repairTiming: object|null}>}
 */
async function runAnalyzer(params = {}) {
  const { keywordCloud, learningData, courseName } = params;

  const result = {
    rawOutput: null,
    normalizedOutput: null,
    validationError: null,
    modelTiming: { totalMs: 0, firstTokenMs: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    repairTiming: null,
  };

  const messages = buildAnalyzerMessages({ keywordCloud, learningData, courseName });

  let rawContent;
  try {
    const response = await bailianModelCall(messages, { jsonMode: true, temperature: 0.2, enableThinking: false, maxTokens: 4000 });
    rawContent = response.content;
    result.modelTiming = {
      totalMs: response.timing?.totalMs || 0,
      firstTokenMs: response.timing?.firstTokenMs || 0,
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      reasoningTokens: response.usage?.reasoning_tokens || 0,
    };
  } catch (err) {
    result.modelTiming.totalMs = 0;
    result.normalizedOutput = LessonPlanAnalyzerFallback.parse({
      error: 'ANALYZER_MODEL_FAILED',
      is_fallback: true,
      message: `关键词分析服务暂时不可用: ${err.message}。将使用基础统计分析结果。`,
    });
    result.validationError = err.message;
    return result;
  }

  result.rawOutput = rawContent;

  let validation = parseAndValidate(rawContent);

  if (!validation.valid) {
    const repairStart = process.hrtime.bigint();
    const repaired = await repairOutput(messages, validation.error);
    if (repaired) {
      validation = parseAndValidate(repaired);
      if (validation.valid) {
        result.rawOutput = repaired;
      }
    }
    result.repairTiming = { totalMs: Math.round(Number(process.hrtime.bigint() - repairStart) / 1e6) };
  }

  if (validation.valid) {
    result.normalizedOutput = validation.data;
  } else {
    result.normalizedOutput = LessonPlanAnalyzerFallback.parse({
      error: 'ANALYZER_VALIDATION_FAILED',
      is_fallback: true,
      message: `关键词分析结果格式异常: ${validation.error}。将使用基础统计分析结果。`,
    });
    result.validationError = validation.error;
  }

  return result;
}

module.exports = { runAnalyzer, ANALYZER_SYSTEM_PROMPT };
