// 自动批改服务
// 负责对不同题型的答案进行自动批改
// 支持: single_choice / multiple_choice / true_false / blank / short_answer / programming

const prisma = require('../config/prisma');
const aiService = require('./ai.service');

// ========================
// 工具函数
// ========================

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

/**
 * 标准化学生答案文本：trim、全角半角转换
 */
function normalizeText(text) {
  if (text == null) return '';
  let result = String(text).trim();
  // 全角转半角（ASCII 范围）
  result = result.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0),
  );
  // 全角空格转半角
  result = result.replace(/　/g, ' ');
  return result;
}

/**
 * 判断两个集合是否相等（忽略顺序）
 */
function setEquals(arr1, arr2) {
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) return false;
  if (arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].map((v) => normalizeText(v)).sort();
  const sorted2 = [...arr2].map((v) => normalizeText(v)).sort();
  return sorted1.every((v, i) => v === sorted2[i]);
}

// ========================
// 各题型批改
// ========================

/**
 * 批改单选题
 * 完全匹配 correct_answer
 */
function gradeSingleChoice(question, answerContent) {
  const correctAnswer = normalizeText(parseAnswer(question.correct_answer));
  const studentAnswer = normalizeText(parseAnswer(answerContent));

  const isCorrect = correctAnswer !== '' && studentAnswer === correctAnswer;
  const score = isCorrect ? (question.score || 0) : 0;
  const feedback = isCorrect ? '回答正确。' : `正确答案是 ${correctAnswer}。`;

  return {
    is_correct: isCorrect,
    score,
    max_score: question.score || 0,
    grading_status: 'auto_graded',
    feedback,
    needs_ai_grading: false,
  };
}

/**
 * 批改多选题
 * 集合完全一致（忽略顺序）得满分
 */
function gradeMultipleChoice(question, answerContent) {
  const correctAnswers = ensureArray(parseAnswer(question.correct_answer));
  const studentAnswers = ensureArray(parseAnswer(answerContent));

  const isCorrect = setEquals(correctAnswers, studentAnswers);
  const score = isCorrect ? (question.score || 0) : 0;

  let feedback;
  if (isCorrect) {
    feedback = '回答正确。';
  } else {
    feedback = `正确答案是 ${correctAnswers.join('、')}。`;
  }

  return {
    is_correct: isCorrect,
    score,
    max_score: question.score || 0,
    grading_status: 'auto_graded',
    feedback,
    needs_ai_grading: false,
  };
}

/**
 * 批改判断题
 * 兼容 true/false, 对/错, 正确/错误, 1/0, yes/no
 */
function gradeTrueFalse(question, answerContent) {
  const correctAnswer = normalizeTrueFalse(parseAnswer(question.correct_answer));
  const studentAnswer = normalizeTrueFalse(parseAnswer(answerContent));

  let isCorrect = false;
  if (correctAnswer !== null && studentAnswer !== null) {
    isCorrect = correctAnswer === studentAnswer;
  }

  const score = isCorrect ? (question.score || 0) : 0;
  const correctLabel = correctAnswer ? '正确' : '错误';
  const feedback = isCorrect ? '回答正确。' : `正确答案是：${correctLabel}。`;

  return {
    is_correct: isCorrect,
    score,
    max_score: question.score || 0,
    grading_status: 'auto_graded',
    feedback,
    needs_ai_grading: false,
  };
}

/**
 * 批改填空题
 * 支持多个标准答案，匹配任一答案
 */
function gradeBlank(question, answerContent) {
  // 获取标准答案关键词
  const answerKeywords = question.answer_keywords
    ? (typeof question.answer_keywords === 'string'
        ? JSON.parse(question.answer_keywords)
        : question.answer_keywords)
    : JSON.parse(question.correct_answer || '{}');

  // 解析学生答案
  let studentAnswer = answerContent;
  if (typeof studentAnswer === 'string') {
    try {
      studentAnswer = JSON.parse(studentAnswer);
    } catch (e) {
      studentAnswer = { answer: studentAnswer };
    }
  }

  const studentText = normalizeText(
    studentAnswer.answer || studentAnswer.content || studentAnswer.text || studentAnswer.blank_1 || studentAnswer[Object.keys(studentAnswer)[0]] || '',
  );

  // 从 answer_keywords 提取所有可能的正确答案
  let allKeywords = [];
  if (Array.isArray(answerKeywords)) {
    allKeywords = answerKeywords;
  } else if (typeof answerKeywords === 'object') {
    // 格式: { "blank_1": ["答案1", "答案2"] }
    for (const key of Object.keys(answerKeywords)) {
      if (Array.isArray(answerKeywords[key])) {
        allKeywords = allKeywords.concat(answerKeywords[key]);
      } else if (typeof answerKeywords[key] === 'string') {
        allKeywords.push(answerKeywords[key]);
      }
    }
  } else if (typeof answerKeywords === 'string') {
    allKeywords = [answerKeywords];
  }

  if (allKeywords.length === 0) {
    allKeywords = [JSON.parse(question.correct_answer || '""')].flat();
  }

  // 检查是否匹配任一关键词
  const normalizedKeywords = allKeywords.map((k) => normalizeText(String(k)));
  const isCorrect = normalizedKeywords.length > 0 && normalizedKeywords.some(
    (keyword) => studentText.includes(keyword) || keyword.includes(studentText) || studentText === keyword,
  );

  const score = isCorrect ? (question.score || 0) : 0;
  const feedback = isCorrect
    ? '回答正确。'
    : `正确答案参考：${normalizedKeywords.join(' / ')}。`;

  return {
    is_correct: isCorrect,
    score,
    max_score: question.score || 0,
    grading_status: 'auto_graded',
    feedback,
    needs_ai_grading: false,
  };
}

/**
 * 批改简答题（关键词匹配 mock / AI 辅助）
 */
async function gradeShortAnswer(question, answerContent, userId) {
  const studentAnswer = typeof answerContent === 'string'
    ? answerContent
    : (answerContent?.answer || answerContent?.content || JSON.stringify(answerContent));

  const studentText = normalizeText(studentAnswer);

  // 如果学生答案为空
  if (!studentText) {
    return {
      is_correct: false,
      score: 0,
      max_score: question.score || 0,
      grading_status: 'auto_graded',
      feedback: '未作答。',
      needs_ai_grading: false,
    };
  }

  // 获取标准答案关键词
  let keywords = [];
  try {
    if (question.answer_keywords) {
      keywords = typeof question.answer_keywords === 'string'
        ? JSON.parse(question.answer_keywords)
        : question.answer_keywords;
    } else if (question.correct_answer) {
      const ca = typeof question.correct_answer === 'string'
        ? JSON.parse(question.correct_answer)
        : question.correct_answer;
      keywords = Array.isArray(ca) ? ca : (ca.keywords || [ca]);
    }
  } catch (e) {
    keywords = [];
  }

  // 确保 keywords 是字符串数组
  keywords = (Array.isArray(keywords) ? keywords : [String(keywords)]).map((k) =>
    typeof k === 'string' ? k : (k.keyword || k.text || String(k)),
  );

  const maxScore = question.score || 0;

  // 尝试 AI 评分
  try {
    const aiResult = await aiService.gradeShortAnswer({
      questionContent: question.content || question.title || '',
      correctAnswer: typeof question.correct_answer === 'string'
        ? question.correct_answer
        : JSON.stringify(question.correct_answer),
      answerKeywords: keywords,
      studentAnswer: studentText,
      maxScore,
      userId,
    });

    if (aiResult.score !== null && aiResult.ai_provider) {
      // AI 评分成功
      const score = Math.max(0, Math.min(maxScore, Math.round(aiResult.score)));
      const isCorrect = score >= maxScore * 0.6;
      return {
        is_correct: isCorrect,
        score,
        max_score: maxScore,
        grading_status: 'ai_graded',
        feedback: aiResult.comment || `AI 评分：${score}/${maxScore}`,
        needs_ai_grading: false,
        ai_grading: {
          score,
          total_score: maxScore,
          comment: aiResult.comment,
          rubric_matched: aiResult.rubric_matched || [],
          rubric_missing: aiResult.rubric_missing || [],
          is_ai_generated: true,
          ai_provider: aiResult.ai_provider,
          model_name: aiResult.model_name,
        },
      };
    }
  } catch (err) {
    console.error('[grading.service] AI 简答题评分失败:', err.message);
  }

  // Mock 关键词匹配评分
  if (keywords.length > 0) {
    const normalizedKeywords = keywords.map((k) => normalizeText(String(k)));
    const matchedCount = normalizedKeywords.filter((kw) =>
      studentText.includes(kw),
    ).length;
    const matchRatio = normalizedKeywords.length > 0 ? matchedCount / normalizedKeywords.length : 0;

    let score;
    if (matchRatio >= 0.8) {
      score = Math.round(maxScore * 0.9);
    } else if (matchRatio >= 0.6) {
      score = Math.round(maxScore * 0.7);
    } else if (matchRatio >= 0.4) {
      score = Math.round(maxScore * 0.5);
    } else if (matchRatio > 0) {
      score = Math.round(maxScore * 0.3);
    } else {
      // 无关键词匹配，根据字数给基础分
      const charCount = studentText.length;
      if (charCount >= 100) {
        score = Math.round(maxScore * 0.4);
      } else if (charCount >= 30) {
        score = Math.round(maxScore * 0.25);
      } else if (charCount >= 10) {
        score = Math.round(maxScore * 0.15);
      } else {
        score = 0;
      }
    }

    const isCorrect = score >= maxScore * 0.6;
    return {
      is_correct: isCorrect,
      score,
      max_score: maxScore,
      grading_status: 'auto_graded',
      feedback: `关键词匹配评分：${score}/${maxScore}（命中 ${matchedCount}/${normalizedKeywords.length} 个关键词）。AI 评分服务未配置，使用关键词匹配。`,
      needs_ai_grading: false,
    };
  }

  // 无关键词，按字数评分
  const charCount = studentText.length;
  let score;
  if (charCount >= 200) {
    score = Math.round(maxScore * 0.5);
  } else if (charCount >= 100) {
    score = Math.round(maxScore * 0.4);
  } else if (charCount >= 50) {
    score = Math.round(maxScore * 0.3);
  } else if (charCount >= 10) {
    score = Math.round(maxScore * 0.2);
  } else {
    score = 0;
  }

  const isCorrect = score >= maxScore * 0.6;
  return {
    is_correct: isCorrect,
    score,
    max_score: maxScore,
    grading_status: 'auto_graded',
    feedback: `内容评分：${score}/${maxScore}。请教师确认评分。`,
    needs_ai_grading: true,
  };
}

/**
 * 批改编程题（预留）
 */
function gradeProgramming(question, answerContent) {
  return {
    is_correct: null,
    score: null,
    max_score: question.score || 0,
    grading_status: 'pending',
    feedback: '编程题需要在线判题系统支持，当前暂不支持自动评分。',
    needs_ai_grading: false,
  };
}

// ========================
// 辅助函数
// ========================

/**
 * 解析答案值，处理 JSON 字符串和直接值
 */
function parseAnswer(value) {
  if (value == null) return '';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed;
    } catch (e) {
      return value;
    }
  }
  return value;
}

/**
 * 确保返回数组
 */
function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch (e) {
      // 如果是以逗号分隔的字符串
      if (value.includes(',')) return value.split(',').map((s) => s.trim());
      return [value];
    }
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).filter((v) => v != null);
  }
  return [String(value)];
}

/**
 * 标准化 true/false 为统一布尔值
 */
function normalizeTrueFalse(value) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  const str = normalizeText(String(value)).toLowerCase();
  if (['true', '1', 'yes', '对', '正确', '是'].includes(str)) return true;
  if (['false', '0', 'no', '错', '错误', '否'].includes(str)) return false;
  return null;
}

// ========================
// 统一批改入口
// ========================

/**
 * 根据题目类型进行批改
 *
 * @param {Object} question - 题目对象（含 question_type, correct_answer, answer_keywords, score）
 * @param {*} answerContent - 学生答案
 * @param {number} userId - 用户 ID（AI 批改需要）
 * @returns {Promise<Object>} 批改结果
 */
async function gradeQuestion(question, answerContent, userId) {
  const questionType = toLower(question.question_type);

  switch (questionType) {
    case 'single_choice':
      return gradeSingleChoice(question, answerContent);

    case 'multiple_choice':
      return gradeMultipleChoice(question, answerContent);

    case 'true_false':
      return gradeTrueFalse(question, answerContent);

    case 'blank':
      return gradeBlank(question, answerContent);

    case 'short_answer':
      return await gradeShortAnswer(question, answerContent, userId);

    case 'programming':
      return gradeProgramming(question, answerContent);

    default:
      return {
        is_correct: false,
        score: 0,
        max_score: question.score || 0,
        grading_status: 'failed',
        feedback: `不支持的题型: ${questionType}`,
        needs_ai_grading: false,
      };
  }
}

/**
 * 批量批改
 */
async function gradeAnswers(questions, answerMap, userId) {
  const results = [];

  for (const question of questions) {
    const answerContent = answerMap[question.question_id];
    if (answerContent === undefined || answerContent === null) {
      results.push({
        question_id: question.question_id,
        is_correct: false,
        score: 0,
        max_score: question.score || 0,
        grading_status: 'auto_graded',
        feedback: '未作答。',
        needs_ai_grading: false,
      });
      continue;
    }

    const result = await gradeQuestion(question, answerContent, userId);
    results.push({
      question_id: question.question_id,
      ...result,
    });
  }

  return results;
}

module.exports = {
  gradeQuestion,
  gradeAnswers,
  gradeSingleChoice,
  gradeMultipleChoice,
  gradeTrueFalse,
  gradeBlank,
  gradeShortAnswer,
  gradeProgramming,
};
