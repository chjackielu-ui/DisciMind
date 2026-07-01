// AI 统一调用服务
// 提供统一的 AI 调用入口，支持真实 API 调用和 mock 降级
// 从 ai_model_configs 表读取配置，记录 ai_call_logs
//
// 支持的 usageType: qa / grading / question_generation / recommendation / summary

const prisma = require('../config/prisma');
const axios = require('axios');

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

/**
 * 批量调用 AI 生成题目
 */
async function generateQuestions({ courseName, knowledgePoints, count, questionTypes, difficultyLevel, userId }) {
  const systemPrompt = `你是一位经验丰富的学科教师，需要根据指定知识点生成高质量的测验题目。

要求：
1. 题目要覆盖指定的知识点
2. 题目类型包括：single_choice（单选题）、multiple_choice（多选题）、true_false（判断题）、blank（填空题）、short_answer（简答题）
3. 每道题必须包含正确答案和解析
4. 难度分为 basic（基础）、medium（中等）、hard（困难）
5. 返回严格的 JSON 数组格式

JSON 格式示例：
[
  {
    "question_type": "single_choice",
    "question_content": "题目内容",
    "options": [
      { "option_label": "A", "option_content": "选项A内容" }
    ],
    "correct_answer": "A",
    "answer_analysis": "解析内容",
    "difficulty_level": "medium",
    "score": 10
  }
]`;

  const userPrompt = `课程：${courseName || '未知课程'}
知识点：${(knowledgePoints || []).map(kp => kp.knowledge_point_name || kp).join('、')}
需要题目数量：${count || 5}
题型要求：${(questionTypes || ['single_choice', 'multiple_choice']).join('、')}
难度：${difficultyLevel || 'medium'}

请生成题目并返回 JSON 数组。`;

  try {
    const result = await callAI({
      usageType: 'question_generation',
      userId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: { temperature: 0.8 },
      fallbackMock: true,
    });

    if (result.provider === 'mock') {
      return [];
    }

    // 尝试解析 JSON
    let parsed;
    try {
      const jsonMatch = result.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('无法从 AI 返回中提取 JSON 数组');
      }
    } catch (parseErr) {
      console.error('[ai.service] AI 生成题目 JSON 解析失败:', parseErr.message);
      return [];
    }

    // 验证和清理
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((q) => q.question_type && q.question_content).map((q, idx) => ({
      question_type: toLower(q.question_type),
      question_content: q.question_content || '',
      options: (q.options || []).map((opt) => ({
        option_label: opt.option_label || opt.label || String.fromCharCode(65 + (opt.option_order || 0)),
        option_content: opt.option_content || opt.content || '',
      })),
      correct_answer: q.correct_answer || '',
      answer_analysis: q.answer_analysis || q.analysis || '',
      difficulty_level: toLower(q.difficulty_level) || 'medium',
      score: q.score || 10,
    }));
  } catch (err) {
    console.error('[ai.service] generateQuestions 异常:', err.message);
    return [];
  }
}

module.exports = {
  callAI,
  gradeShortAnswer,
  generateQuestions,
  generateMockResponse,
};
