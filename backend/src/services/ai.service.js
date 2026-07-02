// AI 统一调用服务
// 提供统一的 AI 调用入口，支持真实 API 调用和 mock 降级
// 从 ai_model_configs 表读取配置，记录 ai_call_logs
//
// 支持的 usageType: qa / grading / question_generation / recommendation / summary
//
// question_generation 已重写为直接使用 DeepSeek OpenAI SDK，
// 不再依赖 ai_model_configs 表配置。

const prisma = require('../config/prisma');
const axios = require('axios');
const OpenAI = require('openai');

// ========================
// 工具函数
// ========================

/**
 * 将 Prisma 枚举值转为小写
 */
function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

/**
 * 计算文本中的 token 数量（粗略估算：中文每字 1 token，英文每词 1 token）
 */
function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const englishWords = (text.replace(/[一-鿿]/g, '').match(/\b\w+\b/g) || []).length;
  return chineseChars + englishWords;
}

// ========================
// Mock 响应生成
// ========================

function generateMockResponse(usageType, messages) {
  const lastMessage = Array.isArray(messages) && messages.length > 0
    ? messages[messages.length - 1]
    : { content: '' };
  const userContent = typeof lastMessage === 'string' ? lastMessage : (lastMessage.content || '');

  switch (usageType) {
    case 'qa':
      return {
        content: `以下内容由 AI 生成，仅供学习参考，请结合课程资料核对。\n\n关于"${userContent.slice(0, 50)}${userContent.length > 50 ? '...' : ''}"的问题：\n\n当前 AI 服务处于离线模式。系统使用预置知识库进行回答。建议您参考课程讲义和教材中的相关章节获取更详细的信息。如果这个问题对您的学习很重要，可以向任课教师请教或在课程讨论区提问。`,
        model: 'mock',
        provider: 'mock',
        tokens: { prompt: estimateTokens(userContent), completion: 100, total: estimateTokens(userContent) + 100 },
      };

    case 'grading':
      return {
        content: JSON.stringify({
          score: null,
          comment: 'AI 评分服务未配置，请教师手动评分。',
          rubric_matched: [],
          rubric_missing: [],
        }),
        model: 'mock',
        provider: 'mock',
        tokens: { prompt: 0, completion: 0, total: 0 },
      };

    case 'question_generation':
      return {
        content: JSON.stringify([]),
        model: 'mock',
        provider: 'mock',
        tokens: { prompt: 0, completion: 0, total: 0 },
      };

    case 'recommendation':
      return {
        content: JSON.stringify({
          reason_summary: '基于当前学习数据，系统建议复习薄弱知识点。',
          items: [],
        }),
        model: 'mock',
        provider: 'mock',
        tokens: { prompt: 0, completion: 0, total: 0 },
      };

    case 'summary':
      return {
        content: 'AI 摘要服务未配置。请阅读原始文档获取完整内容。',
        model: 'mock',
        provider: 'mock',
        tokens: { prompt: 0, completion: 0, total: 0 },
      };

    default:
      return {
        content: '当前 AI 服务不可用，请稍后再试。',
        model: 'mock',
        provider: 'mock',
        tokens: { prompt: 0, completion: 0, total: 0 },
      };
  }
}

// ========================
// AI 配置查询
// ========================

/**
 * 获取指定用途的 AI 模型配置
 */
async function getAiConfig(usageType) {
  // 优先查精确匹配
  let config = await prisma.aiModelConfig.findFirst({
    where: {
      enabled: true,
      usage_type: usageType.toUpperCase(),
    },
    orderBy: { created_at: 'asc' },
  });

  // 如果没有精确匹配，查找通用配置
  if (!config) {
    config = await prisma.aiModelConfig.findFirst({
      where: { enabled: true },
      orderBy: { created_at: 'asc' },
    });
  }

  return config;
}

// ========================
// 核心调用函数
// ========================

/**
 * 统一 AI 调用入口
 *
 * @param {Object} options
 * @param {string} options.usageType - 用途类型: qa / grading / question_generation / recommendation / summary
 * @param {number} options.userId - 用户 ID
 * @param {Array<{role: string, content: string}>} options.messages - 消息列表
 * @param {Object} options.options - 额外选项 (temperature, maxTokens 等)
 * @param {boolean} options.fallbackMock - 无配置时是否降级到 mock（默认 true）
 * @returns {Promise<{content: string, model: string, provider: string, tokens: object}>}
 */
async function callAI({ usageType, userId, messages, options = {}, fallbackMock = true }) {
  const startTime = Date.now();
  const prismaUsageType = usageType.toUpperCase();

  try {
    // 1. 查询配置
    const config = await getAiConfig(usageType);

    if (!config) {
      if (fallbackMock) {
        console.log(`[ai.service] 无可用 AI 配置 (usageType=${usageType})，使用 mock 响应`);
        return generateMockResponse(usageType, messages);
      }
      throw Object.assign(new Error('无可用的 AI 模型配置'), { code: 50002 });
    }

    // 2. 检查日调用限制
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (config.single_user_daily_limit > 0 && userId) {
      const userCallCount = await prisma.aiCallLog.count({
        where: {
          user_id: userId,
          usage_type: prismaUsageType,
          created_at: { gte: today },
        },
      });
      if (userCallCount >= config.single_user_daily_limit) {
        console.log(`[ai.service] 用户 ${userId} 达到日调用限制 (${config.single_user_daily_limit})，降级 mock`);
        if (fallbackMock) return generateMockResponse(usageType, messages);
        throw Object.assign(new Error('今日 AI 调用次数已达上限'), { code: 50002 });
      }
    }

    if (config.daily_call_limit > 0) {
      const totalCallCount = await prisma.aiCallLog.count({
        where: {
          provider: config.provider,
          model_name: config.model_name,
          created_at: { gte: today },
        },
      });
      if (totalCallCount >= config.daily_call_limit) {
        console.log(`[ai.service] 模型 ${config.model_name} 达到日调用限制，降级 mock`);
        if (fallbackMock) return generateMockResponse(usageType, messages);
        throw Object.assign(new Error('模型日调用次数已达上限'), { code: 50002 });
      }
    }

    // 3. 构建请求
    const baseUrl = config.base_url || 'https://api.openai.com/v1';
    const apiKey = config.api_key_encrypted || '';
    const modelName = config.model_name || 'gpt-3.5-turbo';
    const temperature = options.temperature ?? config.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? config.max_context_length ?? 2048;

    // 过滤消息，只保留 role 和 content
    const sanitizedMessages = messages.map((m) => ({
      role: m.role || 'user',
      content: m.content || '',
    }));

    const promptTokens = sanitizedMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

    // 4. 调用 AI API（OpenAI 兼容接口）
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: modelName,
        messages: sanitizedMessages,
        temperature,
        max_tokens: maxTokens,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 60000,
      },
    );

    const completionTokens = response.data.usage?.completion_tokens || estimateTokens(
      response.data.choices?.[0]?.message?.content || '',
    );
    const totalTokens = (response.data.usage?.total_tokens || 0) || (promptTokens + completionTokens);
    const responseTimeMs = Date.now() - startTime;
    const content = response.data.choices?.[0]?.message?.content || '';

    // 5. 记录调用日志
    try {
      await prisma.aiCallLog.create({
        data: {
          user_id: userId,
          provider: config.provider,
          model_name: modelName,
          usage_type: prismaUsageType,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          status: 'SUCCESS',
          response_time_ms: responseTimeMs,
        },
      });
    } catch (logErr) {
      console.error('[ai.service] 记录 ai_call_logs 失败:', logErr.message);
    }

    return {
      content,
      model: modelName,
      provider: config.provider,
      tokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
    };

  } catch (err) {
    const responseTimeMs = Date.now() - startTime;

    // Axios 错误
    if (err.response || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.error(`[ai.service] AI API 调用失败:`, err.message);

      // 记录失败日志
      try {
        await prisma.aiCallLog.create({
          data: {
            user_id: userId,
            provider: 'unknown',
            model_name: 'unknown',
            usage_type: prismaUsageType,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            status: 'FAILED',
            response_time_ms: responseTimeMs,
            error_message: err.message,
          },
        });
      } catch (logErr) {
        console.error('[ai.service] 记录失败日志异常:', logErr.message);
      }

      if (fallbackMock) {
        console.log('[ai.service] AI 调用失败，降级到 mock');
        return generateMockResponse(usageType, messages);
      }
      throw Object.assign(new Error('AI 服务调用失败'), { code: 50002 });
    }

    // 业务错误（带 code 的）
    if (err.code) throw err;

    throw Object.assign(new Error('AI 服务异常: ' + err.message), { code: 50002 });
  }
}

/**
 * 调用 AI 进行简答题评分
 *
 * @param {Object} params
 * @param {string} params.questionContent - 题目内容
 * @param {string} params.correctAnswer - 标准答案/评分标准
 * @param {Array<string>} params.answerKeywords - 评分关键词
 * @param {string} params.studentAnswer - 学生答案
 * @param {number} params.maxScore - 满分
 * @param {number} params.userId - 用户 ID
 * @returns {Promise<{score: number|null, comment: string, rubric_matched: Array, rubric_missing: Array, is_ai_generated: boolean, ai_provider: string, model_name: string}>}
 */
async function gradeShortAnswer({ questionContent, correctAnswer, answerKeywords, studentAnswer, maxScore, userId }) {
  const systemPrompt = `你是一位严格的学科教师，需要根据评分标准对学生答案进行评分。

评分规则：
1. 仔细对比学生答案与标准答案/评分关键词
2. 根据匹配程度给出 0 到 ${maxScore} 之间的分数
3. 如果学生答案完全偏离或空白，给 0 分
4. 评分要客观公正，不要过于宽松

请返回 JSON 格式：
{
  "score": 数字,
  "comment": "评分评语",
  "rubric_matched": ["命中的评分点"],
  "rubric_missing": ["未命中的评分点"]
}`;

  const userPrompt = `题目：${questionContent}
标准答案/评分关键词：${JSON.stringify(answerKeywords || [])}
${correctAnswer ? `参考评分标准：${correctAnswer}` : ''}
学生答案：${studentAnswer || '（未作答）'}
满分：${maxScore}

请评分并返回 JSON。`;

  try {
    const result = await callAI({
      usageType: 'grading',
      userId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: { temperature: 0.3 },
      fallbackMock: true,
    });

    // 如果返回的是 mock 内容，说明 AI 不可用
    if (result.provider === 'mock') {
      return {
        score: null,
        comment: 'AI 评分服务不可用，请教师手动评分',
        rubric_matched: [],
        rubric_missing: [],
        is_ai_generated: false,
        ai_provider: null,
        model_name: null,
      };
    }

    // 尝试解析 AI 返回的 JSON
    let parsed;
    try {
      // 提取 JSON（容错处理）
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('无法从 AI 返回中提取 JSON');
      }
    } catch (parseErr) {
      console.error('[ai.service] AI 评分结果 JSON 解析失败:', parseErr.message);
      return {
        score: null,
        comment: 'AI 评分结果解析失败',
        rubric_matched: [],
        rubric_missing: [],
        is_ai_generated: true,
        ai_provider: result.provider,
        model_name: result.model,
      };
    }

    return {
      score: typeof parsed.score === 'number' ? Math.max(0, Math.min(maxScore, parsed.score)) : null,
      comment: parsed.comment || '',
      rubric_matched: parsed.rubric_matched || [],
      rubric_missing: parsed.rubric_missing || [],
      is_ai_generated: true,
      ai_provider: result.provider,
      model_name: result.model,
    };
  } catch (err) {
    console.error('[ai.service] gradeShortAnswer 异常:', err.message);
    return {
      score: null,
      comment: 'AI 评分异常: ' + err.message,
      rubric_matched: [],
      rubric_missing: [],
      is_ai_generated: false,
      ai_provider: null,
      model_name: null,
    };
  }
}

// ========================
// 题目生成（DeepSeek 直连，不依赖 ai_model_configs）
// ========================

/**
 * 获取 DeepSeek 客户端（与 practice.service.js / ai-chat.service.js 一致）
 */
function getDeepSeekClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey || apiKey.includes('请在这里')) {
    return null;
  }
  return {
    client: new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    }),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
  };
}

/**
 * 清理 AI 返回内容中的 Markdown 代码块包装
 */
function stripMarkdownCodeBlock(text) {
  let content = String(text || '').trim();
  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) content = fencedMatch[1].trim();
  content = content.replace(/^`{1,3}\s*/, '').replace(/\s*`{1,3}$/, '');
  return content;
}

/**
 * 从 AI 返回内容中提取 JSON 题目数组
 */
function extractJsonFromContent(content) {
  const cleaned = stripMarkdownCodeBlock(content);
  // 尝试 {"questions": [...]}
  const objMatch = cleaned.match(/\{\s*"questions"\s*:\s*\[[\s\S]*\]\s*\}/);
  if (objMatch) {
    try { const p = JSON.parse(objMatch[0]); if (p.questions && Array.isArray(p.questions)) return p.questions; } catch {}
  }
  // 尝试直接 JSON 数组
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { const p = JSON.parse(arrMatch[0]); if (Array.isArray(p)) return p; } catch {}
  }
  // 尝试整体解析
  try { const p = JSON.parse(cleaned); if (p.questions && Array.isArray(p.questions)) return p.questions; if (Array.isArray(p)) return p; } catch {}
  return null;
}

const QUESTION_TYPE_ALIASES = {
  '单选题': 'single_choice', '多选题': 'multiple_choice',
  '判断题': 'true_false', '填空题': 'fill_blank', '简答题': 'short_answer',
  'single_choice': 'single_choice', 'multiple_choice': 'multiple_choice',
  'true_false': 'true_false', 'fill_blank': 'fill_blank', 'blank': 'fill_blank', 'short_answer': 'short_answer',
  'SINGLE_CHOICE': 'single_choice', 'MULTIPLE_CHOICE': 'multiple_choice',
  'TRUE_FALSE': 'true_false', 'FILL_BLANK': 'fill_blank', 'BLANK': 'fill_blank', 'SHORT_ANSWER': 'short_answer',
};

function normalizeGenType(type) {
  const key = String(type || '').trim();
  return QUESTION_TYPE_ALIASES[key] || null;
}

const DIFFICULTY_ALIASES = {
  '基础': 'basic', '容易': 'basic', '简单': 'basic', 'easy': 'basic', 'basic': 'basic', 'EASY': 'basic', 'BASIC': 'basic',
  '普通': 'medium', '中等': 'medium', '一般': 'medium', 'normal': 'medium', 'medium': 'medium', 'NORMAL': 'medium', 'MEDIUM': 'medium',
  '提高': 'hard', '困难': 'hard', '较难': 'hard', 'hard': 'hard', 'HARD': 'hard',
  '综合': 'comprehensive', 'comprehensive': 'comprehensive', 'COMPREHENSIVE': 'comprehensive',
};

function normalizeGenDifficulty(diff) {
  const key = String(diff || '').trim();
  return DIFFICULTY_ALIASES[key] || 'medium';
}

function validateAndCleanQuestion(raw, index) {
  const type = normalizeGenType(raw.type || raw.question_type);
  if (!type) return null;
  const content = String(raw.title || raw.question_content || raw.content || '').trim();
  if (!content || content.length < 4) return null;
  const difficulty = normalizeGenDifficulty(raw.difficulty || raw.difficulty_level);
  const analysis = String(raw.analysis || raw.answer_analysis || '').trim();
  const kps = Array.isArray(raw.knowledgePoints || raw.knowledge_points)
    ? (raw.knowledgePoints || raw.knowledge_points).map(String).filter(Boolean) : [];
  const rawAnswer = raw.answer || raw.correct_answer || {};
  let correctAnswer;
  if (type === 'single_choice') {
    const labels = rawAnswer.correctOptionLabels || rawAnswer.correct_option_labels || (Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer]);
    const answerLabels = Array.isArray(labels) ? labels.map(String).filter(Boolean) : [String(labels || '')];
    correctAnswer = { type: 'single_choice', answer: answerLabels.slice(0, 1) };
  } else if (type === 'multiple_choice') {
    const labels = rawAnswer.correctOptionLabels || rawAnswer.correct_option_labels || (Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer]);
    const answerLabels = Array.isArray(labels) ? labels.map(String).filter(Boolean) : [String(labels || '')];
    correctAnswer = { type: 'multiple_choice', answer: answerLabels };
  } else if (type === 'true_false') {
    correctAnswer = { type: 'true_false', answer: rawAnswer.correct !== undefined ? Boolean(rawAnswer.correct) : (String(rawAnswer) === 'true') };
  } else if (type === 'fill_blank') {
    const blanks = rawAnswer.blanks || [];
    if (blanks.length > 0) {
      correctAnswer = { type: 'fill_blank', answer: blanks.map((b, i) => ({ index: b.index || i + 1, answers: Array.isArray(b.answers) ? b.answers.map(String) : [String(b.answer || b || '')], caseSensitive: Boolean(b.caseSensitive || b.case_sensitive) })) };
    } else {
      const answers = Array.isArray(rawAnswer) ? rawAnswer : [String(rawAnswer || '')];
      correctAnswer = { type: 'fill_blank', answer: answers.map((a, i) => ({ index: i + 1, answers: [String(a)], caseSensitive: false })) };
    }
  } else {
    correctAnswer = { type: 'short_answer', answer: { referenceAnswer: rawAnswer.referenceAnswer || rawAnswer.reference_answer || rawAnswer.answer || '', keywords: rawAnswer.keywords || [], rubric: rawAnswer.rubric || [] } };
  }
  let options = [];
  if (['single_choice', 'multiple_choice'].includes(type)) {
    const rawOptions = raw.options || [];
    options = rawOptions.map((opt, oi) => ({ option_label: String(opt.label || opt.option_label || opt.option_key || opt.key || String.fromCharCode(65 + oi)).trim(), option_content: String(opt.content || opt.option_content || opt.text || '').trim(), is_correct: Boolean(opt.isCorrect || opt.is_correct) })).filter(o => o.option_label && o.option_content);
    if (options.length < 2) { console.warn('[ai.service] choice question #' + index + ' has too few options: ' + options.length); return null; }
  }
  return { question_type: type, question_content: content, options, correct_answer: correctAnswer, answer_analysis: analysis, difficulty_level: difficulty, score: Number(raw.score) > 0 ? Number(raw.score) : 10, knowledge_points: kps };
}

/**
 * 使用 DeepSeekV4Pro 生成题目（直连，不依赖 ai_model_configs）
 */
async function generateQuestions({ courseName, knowledgePoints, count, questionTypes, difficultyLevel, userId }) {
  const ds = getDeepSeekClient();
  if (!ds) throw Object.assign(new Error('AI 题目生成服务未配置，请联系管理员设置 DEEPSEEK_API_KEY'), { code: 50002 });

  const qCount = Math.max(1, Math.min(Number(count) || 5, 20));
  const types = (questionTypes || ['single_choice']).map(t => normalizeGenType(t) || 'single_choice');
  const diff = normalizeGenDifficulty(difficultyLevel);
  const kpNames = (knowledgePoints || []).map(kp => typeof kp === 'string' ? kp : (kp.knowledge_point_name || kp.name || '')).filter(Boolean);

  const systemPrompt = '你是学研智擎平台的题库生成助手。根据指定科目、题型、难度和数量生成结构化练习题。只返回 JSON，不要 Markdown，不要代码块，不要解释。\n\n格式：\n{"questions":[{"type":"SINGLE_CHOICE","title":"题干","difficulty":"MEDIUM","knowledgePoints":["知识点"],"options":[{"label":"A","content":"内容","isCorrect":false},{"label":"B","content":"内容","isCorrect":true},{"label":"C","content":"内容","isCorrect":false},{"label":"D","content":"内容","isCorrect":false}],"answer":{"type":"SINGLE_CHOICE","correctOptionLabels":["B"]},"analysis":"详细解析"}]}\n\n规则：SINGLE_CHOICE 4选项1正确；MULTIPLE_CHOICE 4选项2-3正确；TRUE_FALSE 无options，answer为{"type":"TRUE_FALSE","correct":true/false}；FILL_BLANK 题干用___标记空，answer为{"type":"FILL_BLANK","blanks":[{"index":1,"answers":["答案"],"caseSensitive":false}]}；SHORT_ANSWER 无options，answer为{"type":"SHORT_ANSWER","referenceAnswer":"参考","keywords":["词"],"rubric":[{"point":"点","score":5}]}。题目必须与科目相关，解析不能为空，knowledgePoints不能空。';

  const userPrompt = '请生成 ' + qCount + ' 道练习题。科目：' + (courseName || '通用') + '。题型：' + types.join('、') + '。难度：' + diff + (kpNames.length > 0 ? '。参考知识点：' + kpNames.join('、') : '') + '。必须返回恰好 ' + qCount + ' 道题。';

  console.log('[ai.service] generateQuestions: count=' + qCount + ', types=' + types.join(',') + ', diff=' + diff);

  let responseContent = '';
  try {
    const completion = await ds.client.chat.completions.create({
      model: ds.model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.7, max_tokens: 4096,
    });
    responseContent = completion.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[ai.service] DeepSeek API failed:', err.message);
    if (err.status === 401 || err.status === 403) throw Object.assign(new Error('AI 服务认证失败，请检查 DEEPSEEK_API_KEY'), { code: 50002 });
    if (err.status === 429) throw Object.assign(new Error('AI 服务请求过于频繁，请稍后重试'), { code: 50002 });
    throw Object.assign(new Error('AI 题目生成失败: ' + (err.message || '未知错误')), { code: 50002 });
  }

  if (!responseContent || responseContent.trim().length < 20) throw Object.assign(new Error('AI 未返回有效题目数据'), { code: 50002 });

  const questions = extractJsonFromContent(responseContent);
  if (!questions || !Array.isArray(questions)) {
    console.error('[ai.service] JSON parse failed, first 300 chars:', responseContent.slice(0, 300));
    throw Object.assign(new Error('AI 返回的题目格式无法解析，请稍后重试'), { code: 50002 });
  }

  const cleaned = questions.map((q, i) => validateAndCleanQuestion(q, i)).filter(Boolean);
  console.log('[ai.service] parsed ' + questions.length + ' questions, ' + cleaned.length + ' valid');
  if (cleaned.length === 0) throw Object.assign(new Error('AI 生成的题目均未通过校验，请稍后重试'), { code: 50002 });
  return cleaned;
}

module.exports = {
  callAI,
  gradeShortAnswer,
  generateQuestions,
  generateMockResponse,
};
