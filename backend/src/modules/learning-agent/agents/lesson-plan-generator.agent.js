/**
 * Lesson Plan Generator Agent（教案生成智能体）— 13 模块模板完整版
 *
 * 职责：基于 Analyzer 分析结果 + Collector 学情数据 + 教师输入，
 *       用 LLM 按照《教师综合教案模板（A4打印版）》生成 13 模块完整教案 JSON。
 *
 * Agent 模式严格对齐 trainer.agent.js：
 *   SYSTEM_PROMPT → buildMessages → bailianModelCall(jsonMode)
 *   → parseAndValidate(Zod) → repairOutput → 返回 structured result
 */

const { bailianModelCall } = require('../adapters/bailian-model.adapter');
const {
  LessonPlanGeneratorOutput,
  LessonPlanGeneratorFallback,
} = require('../schemas/lesson-plan.schema');

// ---------------------------------------------------------------------------
// System Prompt — 完整 13 模块教案模板
// ---------------------------------------------------------------------------

const GENERATOR_SYSTEM_PROMPT = `你是一名资深教学设计专家（Lesson Plan Generator Agent），隶属于"学研智擎"教学平台。

你的唯一任务是基于提供的学情数据、关键词分析结果和教师输入参数，生成一份完整的、符合《教师综合教案模板（A4打印版）》规范的课堂教学教案。

===== 教案编写总则 =====
1. 所有内容必须基于提供的真实数据，不可凭空编造。
2. 语言必须使用正式的中文学术表达，适合直接写入正式教案。
3. 内容必须适合 A4 纸打印输出。
4. 每个模块必须完整填充，不可出现"略"、"待补充"等占位词。
5. 上一节课复盘模块中权重越高的关键词，必须优先体现在教学重点和难点中。
6. 教学重点引用高频概念类关键词，教学难点引用易错理解类关键词。

===== 模块一：基本信息 =====
basic_info 对象，包含以下字段。直接从教师输入参数中提取，无需生成：
- course_name: 课程名称
- topic: 授课主题（如教师未指定则与课程名称相同）
- teacher_name: 授课教师
- class_name: 授课班级
- teaching_date: 授课日期
- period: 课时安排
- lesson_type: 课型（新授课/复习课/讲评课/实验课/练习课）
- venue: 授课地点
- teaching_material: 使用教材/资源

===== 模块二：学情分析 =====
student_analysis 对象，必须包含以下 5 个维度的具体分析：
1. knowledge_foundation: 学生已有知识基础——基于 "平均掌握度"和"薄弱知识点"数据描述
2. cognitive_characteristics: 学生认知特点与学习习惯——基于"学生分段"数据和学科特点
3. common_problems: 学生常见问题与薄弱点——基于"薄弱知识点"和"错题记录"数据
4. class_participation: 班级整体参与度与差异情况——基于学生人数和分段分布
5. teaching_entry_point: 本节课教学切入点——基于上述分析给出具体的教学策略选择

===== 模块三：上一节课复盘模块（不可弱化）=====
review_module 对象，基于 Analyzer Agent 的关键词分析结果生成：
- keyword_sources: 数据来源说明（列出具体的数据源类型）
- keyword_summary: 关键词分析摘要（100-200字，概括提取到的关键词数量、分类、得分分布）
- concept_keywords: 核心概念类关键词（直接引用 Analyzer 输出的关键词名称）
- method_keywords: 方法步骤类关键词
- mistake_keywords: 易错理解类关键词
- emotion_keywords: 情绪反馈类关键词
- student_focus_points: 学生最关注的知识点（引用 Analyzer 的 student_focus_points，每点含分析和频次）
- student_confusion_points: 学生最集中的困惑点（引用 Analyzer 的 student_confusion_points）
- student_error_prone_steps: 学生最容易出错的环节（引用 Analyzer 的 student_error_prone_steps）
- review_conclusion: 复盘结论（150-300字，引用数据、命名知识点、区分概念类 vs 操作类困难）
- teaching_adjustments: 教学调整策略（5条，每条可操作、关联关键词）

核心规则：
- 词云中得分越高、学生覆盖越广的关键词，难度评价越高
- review_conclusion 必须具体，不可泛泛而谈
- teaching_adjustments 中的复习承接策略应直接命名高频关键词

===== 模块四：教学目标 =====
teaching_goals 对象，按三维目标输出：
1. knowledge: 知识目标（可衡量的知识掌握目标，如"学生能够准确描述...的定义和性质"）
2. ability: 能力目标（可观察的能力提升目标，如"学生能够运用...方法解决...问题"）
3. emotion: 素养/情感目标（与学科素养相关的情感态度目标）

===== 模块五：教学重点 =====
key_points 数组，输出 3 项：
- 优先引用高频概念类关键词
- 表述为"掌握/理解/运用 + 具体知识点"
- 注意与"教学难点"的区别——重点是学生必须掌握的

===== 模块六：教学难点 =====
difficulties 数组，输出 3 项：
- 优先引用易错理解类关键词
- 表述为"辨析/突破/理解 + 具体难点"
- 注意与"教学重点"的区别——难点是学生普遍感到困难的

===== 模块七：教学方法与教学策略 =====
teaching_methods 数组，每项含 name（方法名称）和 description（100-200字说明该方法在本节课的具体应用方式）。
从以下方法中选取 5-8 种：
- 讲授法、问题驱动法、任务教学法、案例分析法
- 分组讨论法、项目化学习法、演示法、练习反馈法
- AI辅助教学法（如：利用AI平台实时分析学生练习数据，精准定位薄弱环节）
- 如词云数据反映学生在特定概念上有系统性困惑，建议增加"对比教学法"

===== 模块八：教学准备 =====
teaching_preparation 对象：
1. teacher: 教师准备——具体列出教具、课件、教学平台、案例素材、练习题等
2. student: 学生准备——复习上节课内容、预习教材章节、准备笔记本/学习工具等

===== 模块九：教学过程设计 =====
teaching_process 数组，按以下 7 个标准环节依次生成，每环节包含 5 个字段：
  { stage, time_suggestion, teaching_content, teacher_activity, student_activity, design_intent }

标准 7 环节：
1. 导入（3-5分钟）——通过情境/问题/复习引入本节课主题
2. 复盘承接（5-8分钟）——基于词云关键词简要回顾上节课，针对性解答学生的共同困惑
3. 新知讲授（15-20分钟）——系统讲解本节课核心概念和原理，重点突破高频关键词对应的难点
4. 互动探究（8-12分钟）——设计小组讨论/案例分析/课堂练习任务，关注学生的实操表现
5. 练习巩固（7-10分钟）——布置与重难点相关的练习题，重点关注易错理解类关键词对应的练习
6. 总结提升（3-5分钟）——总结本节课核心内容，强调重点难点，构建知识框架
7. 作业布置（2分钟）——布置分层作业，明确要求和提交时间

===== 模块十：课堂评价设计 =====
evaluation_design 对象：
1. process: 过程性评价——通过课堂提问、小组讨论表现、练习完成情况评价
2. result: 结果性评价——通过课后作业和阶段测验检验效果
3. data_assisted: 数据辅助评价——结合学习平台答题数据、提问数据、词云分析数据进行辅助评价

===== 模块十一：板书设计 =====
board_design 对象，包含 5 个字段：
1. theme: 板书主题（本节课标题）
2. core_concepts: 核心概念（列出 3-5 个核心概念及简要定义）
3. key_steps: 关键步骤（列出解题/推导/操作的关键步骤）
4. common_mistakes: 易错提醒（标注 1-2 个常见错误）
5. summary: 总结归纳（1-2 句总结性表述）

===== 模块十二：作业设计 =====
homework_design 对象，分 4 层：
1. basic: 基础作业——巩固核心概念的基础练习
2. advanced: 提升作业——综合应用题，培养知识迁移能力
3. tiered: 分层作业——根据"学生分段"数据为优秀/良好/一般/薄弱学生设计差异化任务
4. preview: 预习作业——预习下节课内容的具体任务

===== 模块十三：课后反思 =====
reflection 对象，以下 6 个字段均用"____________________"作为教师填写占位符：
1. goal_achievement: 教学目标达成情况
2. key_points_implementation: 教学重点落实情况
3. difficulty_breakthrough: 教学难点突破情况
4. student_participation: 学生参与与反馈情况
5. review_teaching_connection: 词云复盘与本节教学衔接效果
6. improvement_suggestions: 后续改进建议

输出要求：
你必须严格以 JSON 格式输出，不得添加任何 markdown 代码块标记。所有必填字段完整填充。`;

// ---------------------------------------------------------------------------
// 构建用户消息（13 模块完整版）
// ---------------------------------------------------------------------------

function buildGeneratorMessages({ params, learningData, keywordAnalysis, hasStudentQuestions }) {
  const p = params || {};
  const ld = learningData || {};
  const ka = keywordAnalysis || {};
  const skipReview = hasStudentQuestions === false;  // 无学生提问数据时跳过复盘模块

  // 关键词详情
  const topKwLines = (ka.top_keywords || []).slice(0, 10).map((k, i) =>
    `${i + 1}. "${k.keyword}" | 得分:${k.weight || k.score || '-'} | 类型:${k.type || '-'} | 难度:${k.difficulty_level || k.difficulty || '-'} | 学生:${k.student_count || '-'}人`
  ).join('\n');

  // Analyzer 的结构化结果（如有）
  const focusPointsLines = (ka.student_focus_points || []).map(fp =>
    `- ${fp.knowledge_point}（提问${fp.question_frequency}次/${fp.student_count}名学生）：${fp.analysis}`
  ).join('\n');

  const confusionLines = (ka.student_confusion_points || []).map(cp =>
    `- ${cp.topic}（${cp.affected_student_count}名学生）：${cp.confusion_description}`
  ).join('\n');

  const errorStepsLines = (ka.student_error_prone_steps || []).map(es =>
    `- ${es.step} [严重度:${es.severity}]：${es.error_pattern}`
  ).join('\n');

  const userMessage = [
    // ========== 教师输入 ==========
    `【一、教师输入参数 — 直接用于基本信息模块】`,
    `课程名称：${p.courseName || ''}`,
    `授课主题：${p.topic || p.courseName || ''}`,
    `学科类别：${p.subjectCategory || ''}`,
    `授课教师：${p.teacherName || ''}`,
    `授课班级：${p.className || ''}`,
    `授课日期：${p.teachingDate || ''}`,
    `课时安排：${p.period || '1课时（45分钟）'}`,
    `课型：${p.lessonType || '新授课'}`,
    `授课地点：${p.venue || '标准教室'}`,
    `教材/资源：${p.teachingMaterial || '指定教材'}`,
    ``,
    // ========== 学情数据 ==========
    `【二、学情数据 — 用于学情分析模块】`,
    `学生总数：${ld.student_count || 0}人`,
    `班级平均掌握度：${ld.average_mastery || 0}分`,
    `薄弱知识点：${(ld.weak_knowledge_points || []).join('、') || '暂无数据'}`,
    `近期提问总数：${ld.question_count || 0}条`,
    `错题记录总数：${ld.wrong_question_count || 0}条`,
    `学生分段统计：优秀(≥85分)${ld.student_segments?.excellent || 0}人 | 良好(70-84)${ld.student_segments?.good || 0}人 | 一般(50-69)${ld.student_segments?.general || 0}人 | 薄弱(<50)${ld.student_segments?.weak || 0}人`,
    ``,
    // ========== 关键词分析 ==========
    `【三、上一节课复盘关键词分析 — 用于复盘模块 + 重点难点 + 教学过程】`,
    ...(skipReview ? [
      `⚠️ 重要：当前课程暂无学生学科专属助手对话数据，请跳过 review_module（模块三）。`,
      `教案 JSON 中不要包含 review_module 字段。直接从模块四（教学目标）开始输出。`,
      `教学过程中的"复盘承接"环节替换为"知识回顾"环节（基于课程体系回顾上一节课基础知识）。`,
      ``,
    ] : []),
    `--- 精选关键词 TOP10 ---`,
    topKwLines || '暂无关键词数据',
    ``,
    `--- 学生最关注的知识点 ---`,
    focusPointsLines || '暂无数据',
    ``,
    `--- 学生最集中的困惑点 ---`,
    confusionLines || '暂无数据',
    ``,
    `--- 学生最容易出错的环节 ---`,
    errorStepsLines || '暂无数据',
    ``,
    `--- 复盘结论 ---`,
    ka.review_conclusion || '暂无',
    ``,
    `--- 教学调整策略 ---`,
    (ka.teaching_adjustments || []).map((a, i) => `${i + 1}. ${a}`).join('\n') || '暂无',
    ``,
    `--- 补充数据 ---`,
    `高频概念：${(ka.high_frequency_concepts || []).join('、') || '暂无'}`,
    `易错理解点：${(ka.common_misunderstandings || []).join('、') || '暂无'}`,
    `方法步骤障碍：${(ka.method_barriers || []).join('、') || '暂无'}`,
    `情绪反馈：${ka.emotional_feedback_summary || '暂无'}`,
    ``,
    // ========== 输出要求 ==========
    `【四、输出要求】`,
    `请严格按照 SYSTEM_PROMPT 中定义的 13 个模块模板，生成完整教案 JSON。`,
    `关键要求：`,
    `1. 教学重点(module 5)直接引用高频概念类关键词，教学难点(module 6)直接引用易错理解类关键词`,
    `2. 教学过程(module 9)必须包含 7 个标准环节，第 2 个环节必须为"复盘承接"`,
    `3. 板书设计(module 11)中 core_concepts 和 common_mistakes 必须引用真实关键词`,
    `4. 课后反思(module 13)全部用"____________________"作为占位符`,
    `5. 所有描述使用中文学术语言，适合正式教案和 A4 打印`,
  ].join('\n');

  return [
    { role: 'system', content: GENERATOR_SYSTEM_PROMPT },
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
    const validated = LessonPlanGeneratorOutput.parse(parsed);
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
      content: `输出格式不正确。错误详情: ${previousError}。请严格按照 JSON 格式重新输出完整的教案，确保 13 个模块的必填字段全部存在且格式正确。只输出 JSON，不要加 markdown 代码块。`,
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

async function runGenerator(params = {}) {
  const { params: planParams, learningData, keywordAnalysis, hasStudentQuestions } = params;

  const result = {
    rawOutput: null,
    normalizedOutput: null,
    validationError: null,
    modelTiming: { totalMs: 0, firstTokenMs: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    repairTiming: null,
  };

  const messages = buildGeneratorMessages({
    params: planParams || {},
    learningData: learningData || {},
    keywordAnalysis: keywordAnalysis || {},
    hasStudentQuestions: hasStudentQuestions !== false,
  });

  let rawContent;
  try {
    const response = await bailianModelCall(messages, {
      jsonMode: true,
      temperature: 0.2,
      enableThinking: false,
      maxTokens: 8000,
      timeoutMs: 180_000,
    });
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
    result.normalizedOutput = LessonPlanGeneratorFallback.parse({
      error: 'GENERATOR_MODEL_FAILED',
      is_fallback: true,
      message: `教案生成服务暂时不可用: ${err.message}。请稍后重试。`,
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
    result.normalizedOutput = LessonPlanGeneratorFallback.parse({
      error: 'GENERATOR_VALIDATION_FAILED',
      is_fallback: true,
      message: `教案生成结果格式异常: ${validation.error}。请重试。`,
    });
    result.validationError = validation.error;
  }

  return result;
}

module.exports = { runGenerator, GENERATOR_SYSTEM_PROMPT };
