// 统一 Agent 结果解析器
// 职责: 将 Dify/Agent 各种格式的原始返回标准化为统一业务结构
// 支持: 普通对象、JSON字符串、双重编码、Markdown代码块、Dify包装、百炼 Repair

const crypto = require('crypto');

// ========================
// 常量
// ========================

const MAX_PARSE_DEPTH = 4;
const MAX_RESULT_LENGTH = 500000; // 500KB
const MAX_SAFE_LOG_LENGTH = 500;

const EMPTY_RESULT = Object.freeze({
  success: false,
  code: 'AGENT_RESULT_EMPTY',
  message: 'Agent 返回内容为空',
  agent: null,
  requestId: null,
  details: { rawType: 'null', parseDepth: 0, repairAttempted: false },
});

const WRAPPER_FIELD_PRIORITY = [
  'data.outputs',
  'outputs',
  'answer',
  'result',
  'branch_result',
  'output',
  'text',
  'teaching_result',
];

/**
 * Compatibility reader for historic node_run payloads.
 * New writes stay as objects in JSON columns; this is only for old TEXT or
 * wrapper-heavy records at the response boundary.
 */
function normalizeStoredAgentOutput(value) {
  let current = value;
  for (let depth = 0; depth <= MAX_PARSE_DEPTH; depth += 1) {
    if (current == null || current === '') return null;
    if (typeof current === 'string') {
      const cleaned = preprocessText(current).trim();
      try {
        current = JSON.parse(cleaned);
        continue;
      } catch {
        return cleaned || null;
      }
    }
    if (Array.isArray(current)) return current;
    if (typeof current !== 'object') return current;

    const isBusinessPayload = Boolean(
      current.protocolVersion || current.mode || current.strategy || current.sections
      || current.questions || current.question || current.diagnosis || current.recommendations,
    );
    if (isBusinessPayload) return current;

    const nested = current.branch_result ?? current.result ?? current.output ?? current.content ?? current.data;
    if (nested !== undefined && nested !== current) {
      current = nested;
      continue;
    }
    return current;
  }
  return current;
}

// ========================
// 主入口
// ========================

/**
 * 解析 Agent 原始返回为标准化业务结果
 * @param {any} raw - Agent/Dify 原始返回
 * @param {object} options
 * @param {string} options.agent - Agent 类型: explainer | trainer | diagnostician | guide
 * @param {string} options.requestId - 请求 ID
 * @param {object} options.schema - JSON Schema 用于校验
 * @param {boolean} options.allowRepair - 是否允许百炼 JSON Repair (默认 false)
 * @returns {object} 标准化结果
 */
async function parseAgentResult(raw, options = {}) {
  const {
    agent = 'unknown',
    requestId = '',
    schema = null,
    allowRepair = false,
  } = options;

  const baseMeta = { agent, requestId, rawType: typeof raw, parseDepth: 0, repairAttempted: false };

  // Step 1: 类型识别
  if (raw === null || raw === undefined) {
    return { ...EMPTY_RESULT, agent, requestId, details: { ...baseMeta } };
  }

  // Step 2: 已经是对象 — 字段解包
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return parseFromObject(raw, { ...options, depth: 0, meta: baseMeta });
  }

  // Step 3: 数组 — 按 Agent 类型判断
  if (Array.isArray(raw)) {
    return parseFromArray(raw, options);
  }

  // Step 4: 字符串 — 文本预处理 + 递归解析
  if (typeof raw === 'string') {
    return parseFromString(raw, { ...options, depth: 0, meta: baseMeta });
  }

  return buildParseFailed(baseMeta, '不支持的输入类型: ' + typeof raw);
}

// ========================
// 字符串解析
// ========================

function parseFromString(text, options) {
  const { depth = 0, meta = {} } = options;
  const currentMeta = { ...meta, parseDepth: depth, rawType: 'string' };

  if (depth > MAX_PARSE_DEPTH) {
    return buildParseFailed(currentMeta, '超过最大解析深度');
  }
  if (text.length > MAX_RESULT_LENGTH) {
    return buildParseFailed(currentMeta, '结果超过最大长度限制');
  }

  // Step 2.1: 文本预处理
  let work = preprocessText(text);

  // Step 2.2: 尝试直接 JSON.parse
  try {
    const parsed = JSON.parse(work);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parseFromObject(parsed, { ...options, depth: depth + 1, meta: currentMeta });
    }
    if (Array.isArray(parsed)) {
      return parseFromArray(parsed, options);
    }
    // 解析结果是简单值 — 包装为文本内容
    return buildFallbackText(currentMeta, String(parsed), options.agent);
  } catch {
    // 不是合法 JSON，继续处理
  }

  // Step 2.3: 平衡括号提取
  const extracted = balancedBracketExtract(work);
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parseFromObject(parsed, { ...options, depth: depth + 1, meta: currentMeta });
      }
      if (Array.isArray(parsed)) {
        return parseFromArray(parsed, options);
      }
    } catch {
      // 提取后仍解析失败
    }
  }

  // Step 2.4: 安全格式修复后重试
  const repaired = safeJsonRepair(work);
  if (repaired !== work) {
    try {
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parseFromObject(parsed, { ...options, depth: depth + 1, meta: { ...currentMeta, repairedText: true } });
      }
      if (Array.isArray(parsed)) {
        return parseFromArray(parsed, options);
      }
    } catch {
      // 修复后仍失败
    }
  }

  // Step 2.5: 看起来像 JSON 但无法解析 — 尝试百炼 Repair (如果允许)
  if (options.allowRepair && looksLikeJson(work)) {
    return {
      success: false,
      code: 'AGENT_RESULT_NEEDS_REPAIR',
      message: 'Agent 返回内容需要 JSON 修复',
      agent: options.agent,
      requestId: options.requestId,
      details: { ...currentMeta, repairAttempted: false, rawSnippet: safeSnippet(work) },
      _rawForRepair: work, // 调用方使用此字段传给 Repair
    };
  }

  // Step 2.6: 纯文本 — 包装为 fallback
  return buildFallbackText(currentMeta, text, options.agent);
}

// ========================
// 文本预处理
// ========================

function preprocessText(text) {
  let work = text;

  // 去除 BOM
  if (work.charCodeAt(0) === 0xFEFF) {
    work = work.slice(1);
  }

  // Trim 首尾空白
  work = work.trim();

  // 去除 Markdown 代码围栏 ```json ... ``` 或 ``` ... ```
  work = work.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/i, '');

  // 不改变正文中的换行
  // 不删除合法中文标点

  return work;
}

// ========================
// 平衡括号提取（字符串感知）
// ========================

function balancedBracketExtract(text) {
  // 找到第一个 { 或 [
  const firstBrace = findFirstUnescaped(text, '{');
  const firstBracket = findFirstUnescaped(text, '[');

  let startChar, endChar, startIdx;

  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
    startChar = '{'; endChar = '}'; startIdx = firstBrace;
  } else if (firstBracket >= 0) {
    startChar = '['; endChar = ']'; startIdx = firstBracket;
  } else {
    return null;
  }

  // 使用字符串感知的括号栈找到匹配结束位置
  const stack = [];
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === startChar) {
      stack.push(ch);
    } else if (ch === endChar) {
      stack.pop();
      if (stack.length === 0) {
        return text.slice(startIdx, i + 1);
      }
    } else if (ch === '{' && startChar === '[') {
      stack.push(ch);
    } else if (ch === '}' && startChar === '[') {
      stack.pop();
    } else if (ch === '[' && startChar === '{') {
      stack.push(ch);
    } else if (ch === ']' && startChar === '{') {
      stack.pop();
    }
  }

  return null; // 括号不匹配
}

function findFirstUnescaped(text, char) {
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === '\\') { escaped = true; }
      else if (ch === stringChar) { inString = false; }
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === char) return i;
  }
  return -1;
}

// ========================
// 安全 JSON 修复
// ========================

function safeJsonRepair(text) {
  let work = text;

  // 1. 去除尾随逗号 (在 } 或 ] 前)
  work = work.replace(/,(\s*[}\]])/g, '$1');

  // 2. 中文引号替换为英文引号 (仅限键名外围)
  // 只替换看起来像键名的中文引号: "key":
  work = work.replace(/“([a-zA-Z_]\w*)”\s*:/g, '"$1":');
  // 也处理值中的中文引号 (不太可能但安全处理)
  work = work.replace(/“/g, '"').replace(/”/g, '"');

  // 3. 单独 BOM
  if (work.charCodeAt(0) === 0xFEFF) {
    work = work.slice(1);
  }

  // 不自动改写正文内容
  // 不把解析失败的普通教学文本强行改成 JSON

  return work;
}

// ========================
// 判断是否像 JSON
// ========================

function looksLikeJson(text) {
  const trimmed = text.trim();
  return (trimmed.startsWith('{') || trimmed.startsWith('['))
    && (trimmed.endsWith('}') || trimmed.endsWith(']'))
    && (trimmed.includes('"') || trimmed.includes("'"));
}

// ========================
// 对象解析
// ========================

function parseFromObject(obj, options) {
  const { depth = 0, meta = {} } = options;
  const currentMeta = { ...meta, parseDepth: depth, rawType: 'object' };

  if (depth > MAX_PARSE_DEPTH) {
    return buildParseFailed(currentMeta, '超过最大解析深度');
  }

  // 字段解包: 按优先级寻找包装字段
  let unpacked = null;

  // data.outputs 包装
  if (obj.data && obj.data.outputs && typeof obj.data.outputs === 'object') {
    unpacked = unwrapOutputs(obj.data.outputs, options, depth, currentMeta);
    if (unpacked) return unpacked;
  }

  // outputs 包装
  if (obj.outputs && typeof obj.outputs === 'object' && !obj.sections) {
    unpacked = unwrapOutputs(obj.outputs, options, depth, currentMeta);
    if (unpacked) return unpacked;
  }

  // answer 字段
  if (obj.answer !== undefined && !obj.sections) {
    const inner = tryParseValue(obj.answer, options, depth + 1, currentMeta);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return parseFromObject(inner, { ...options, depth: depth + 1, meta: currentMeta });
    }
    if (Array.isArray(inner)) {
      return parseFromArray(inner, options);
    }
  }

  // result 字段
  if (obj.result !== undefined && !obj.sections) {
    const inner = tryParseValue(obj.result, options, depth + 1, currentMeta);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return parseFromObject(inner, { ...options, depth: depth + 1, meta: currentMeta });
    }
    if (Array.isArray(inner)) {
      return parseFromArray(inner, options);
    }
  }

  // branch_result
  if (obj.branch_result !== undefined && !obj.sections) {
    const inner = tryParseValue(obj.branch_result, options, depth + 1, currentMeta);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return parseFromObject(inner, { ...options, depth: depth + 1, meta: currentMeta });
    }
  }

  // output
  if (obj.output !== undefined && !obj.sections) {
    const inner = tryParseValue(obj.output, options, depth + 1, currentMeta);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return parseFromObject(inner, { ...options, depth: depth + 1, meta: currentMeta });
    }
  }

  // text
  if (obj.text !== undefined && !obj.sections) {
    const inner = tryParseValue(obj.text, options, depth + 1, currentMeta);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return parseFromObject(inner, { ...options, depth: depth + 1, meta: currentMeta });
    }
  }

  // teaching_result
  if (obj.teaching_result !== undefined && !obj.sections) {
    const inner = tryParseValue(obj.teaching_result, options, depth + 1, currentMeta);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return parseFromObject(inner, { ...options, depth: depth + 1, meta: currentMeta });
    }
  }

  // 对象本身已经有 sections — 这就是教学结果
  if (obj.sections && Array.isArray(obj.sections)) {
    return normalizeByAgent(obj, options);
  }

  // 其他已知字段 — 直接标准化
  return normalizeByAgent(obj, options);
}

function unwrapOutputs(outputs, options, depth, meta) {
  for (const field of ['answer', 'result', 'output', 'text', 'branch_result', 'teaching_result', 'questions', 'next_question']) {
    if (outputs[field] !== undefined) {
      const inner = tryParseValue(outputs[field], options, depth + 1, meta);
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        return parseFromObject(inner, { ...options, depth: depth + 1, meta });
      }
      if (Array.isArray(inner)) {
        return parseFromArray(inner, options);
      }
      if (typeof inner === 'string') {
        // 字符串结果 — 包装
        return buildFallbackText(meta, inner, options.agent);
      }
    }
  }
  return null;
}

function tryParseValue(value, options, depth, meta) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // 尝试预处理后再解析
      const preprocessed = preprocessText(trimmed);
      try {
        const parsed = JSON.parse(preprocessed);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // 失败
      }
    }
  }
  return value;
}

// ========================
// 数组解析
// ========================

function parseFromArray(arr, options) {
  // 数组可能直接是 sections 或 questions
  const { agent } = options;

  if (agent === 'trainer' || agent === 'diagnostician') {
    // 可能是题组或诊断结果
    return normalizeByAgent({ items: arr }, options);
  }

  // Explainer: 数组转为 sections
  return normalizeByAgent({
    sections: arr.map((item, i) => {
      if (typeof item === 'string') return { type: 'text', title: '', content: item, order: i + 1 };
      if (typeof item === 'object') {
        return {
          type: item.type || 'text',
          title: item.title || '',
          content: item.content || item.text || '',
          order: item.order || i + 1,
        };
      }
      return { type: 'text', title: '', content: String(item), order: i + 1 };
    }),
  }, options);
}

// ========================
// 按 Agent 类型标准化
// ========================

function normalizeByAgent(obj, options) {
  const { agent } = options;

  switch (agent) {
    case 'explainer':
      return normalizeExplainerResult(obj, options);
    case 'trainer':
      return normalizeTrainerResult(obj, options);
    case 'diagnostician':
      return normalizeDiagnosticianResult(obj, options);
    case 'guide':
      return normalizeGuideResult(obj, options);
    default:
      return normalizeExplainerResult(obj, options); // 默认按 Explainer
  }
}

// ========================
// Explainer 标准化
// ========================

function normalizeExplainerResult(obj, options) {
  const strategy = normalizeStrategy(obj.strategy || obj.strategy_decision || {});
  const sections = normalizeSections(obj.sections || []);
  const knowledgeSources = normalizeSources(
    obj.knowledgeSources || obj.knowledge_sources || obj.knowledge?.sources || []
  );
  const estimatedReadingMinutes = obj.estimated_reading_time_minutes
    || obj.estimatedReadingMinutes
    || Math.max(1, Math.ceil(sections.reduce((sum, s) => sum + (s.content?.length || 0), 0) / 500))
    || 3;

  return {
    success: true,
    agent: 'explainer',
    requestId: options.requestId || obj.request_id || obj.requestId || '',
    knowledgePoint: {
      id: String(obj.knowledge_point?.id || obj.knowledgePoint?.id || ''),
      name: String(obj.knowledge_point?.name || obj.knowledgePoint?.name || ''),
    },
    strategy,
    sections,
    knowledgeSources,
    estimatedReadingMinutes,
  };
}

function normalizeSections(rawSections) {
  if (!rawSections || !Array.isArray(rawSections)) return [];
  return rawSections
    .filter(Boolean)
    .map((section, index) => {
      if (typeof section === 'string') {
        return { type: 'text', title: '', content: section, order: index + 1 };
      }
      if (typeof section === 'object') {
        return {
          type: safeString(section.type, 'text'),
          title: safeString(section.title, ''),
          content: safeString(section.content || section.text || '', ''),
          order: safeNumber(section.order, index + 1),
        };
      }
      return { type: 'text', title: '', content: String(section), order: index + 1 };
    });
}

function normalizeStrategy(strategyObj) {
  if (!strategyObj || typeof strategyObj !== 'object') {
    return { code: 'auto', name: '自动选择', reason: '' };
  }
  return {
    code: safeString(strategyObj.code || strategyObj.source, 'auto'),
    name: safeString(strategyObj.name, '自动选择'),
    reason: safeString(strategyObj.reason || '', ''),
  };
}

function normalizeSources(rawSources) {
  if (!Array.isArray(rawSources)) return [];
  return rawSources.filter(Boolean).map((s) => ({
    name: safeString(s.name || s.document_name || s.file_name || s.title, '未知文档'),
    score: safeNumber(s.score, 0),
    matchPercent: typeof s.score === 'number' ? Math.round(s.score * 100) : null,
  }));
}

// ========================
// Trainer 标准化
// ========================

function normalizeTrainerResult(obj, options) {
  // 判断是哪个阶段的结果
  const mode = safeString(obj.mode || options.mode, 'adaptive_training');
  const status = safeString(obj.status, 'IDLE');

  // 题目
  const question = obj.question || obj.current_question || obj.currentQuestion || null;
  const normalizedQuestion = question ? normalizeTrainerQuestion(question) : null;

  // 进度
  const answeredCount = safeNumber(obj.answeredCount || obj.progress?.answeredCount, 0);
  const correctCount = safeNumber(obj.correctCount || obj.progress?.correctCount, 0);
  const plannedQuestionCount = safeNumber(obj.plannedQuestionCount || obj.progress?.plannedQuestionCount || obj.config?.plannedQuestionCount, 5);
  const maxQuestionCount = safeNumber(obj.maxQuestionCount || obj.progress?.maxQuestionCount || obj.config?.maxQuestionCount, 8);

  // 答题记录
  const answerRecord = obj.answerRecord || obj.answer_record || obj.answerResult || null;
  const normalizedAnswer = answerRecord ? normalizeAnswerRecord(answerRecord) : null;

  // 完成状态
  const completion = obj.completion || {};
  const shouldComplete = completion.shouldComplete === true || obj.shouldComplete === true;

  // Trainer session ID
  const trainerSessionId = safeString(obj.trainerSessionId || obj.session?.sessionId || obj.session?.practice_session_id, '');

  return {
    success: true,
    agent: 'trainer',
    trainerSessionId,
    mode,
    status,
    question: normalizedQuestion,
    answerRecord: normalizedAnswer,
    nextQuestion: obj.nextQuestion || obj.next_question || null,
    progress: {
      answeredCount,
      correctCount,
      plannedQuestionCount,
      maxQuestionCount,
      currentAccuracy: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) / 100 : null,
    },
    completion: {
      shouldComplete,
      reason: safeString(completion.reason, shouldComplete ? 'completed' : null),
    },
  };
}

function normalizeTrainerQuestion(question) {
  if (!question || typeof question !== 'object') return null;
  const options = (question.options || []).map((o) => ({
    key: safeString(o.key || o.option_key, ''),
    text: safeString(o.content || o.text || o.option_content, ''),
  }));

  return {
    id: safeString(question.id || question.question_id || question.questionKey || question.question_key, ''),
    type: safeString(question.type || question.question_type, 'single_choice'),
    stem: safeString(question.stem || question.content || question.title, ''),
    options,
    difficulty: safeString(question.difficulty, 'medium'),
    knowledgePointId: safeString(question.knowledgePointId || question.knowledge_point_id, ''),
    sequence: safeNumber(question.sequence || question.question_order || question.questionOrder, 1),
  };
}

function normalizeAnswerRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    questionId: safeString(record.questionId || record.question_id, ''),
    studentAnswer: safeString(record.studentAnswer || record.selectedOption || record.selected_option || record.answer, ''),
    correctAnswer: safeString(record.correctAnswer || record.correctOption || record.correct_option, ''),
    isCorrect: record.isCorrect === true || record.is_correct === true,
    score: safeNumber(record.score, 0),
    analysis: safeString(record.analysis || record.explanation || record.analysisSummary, ''),
    errorType: safeString(record.errorType || record.error_type, null),
    submittedAt: safeString(record.submittedAt || record.submitted_at, ''),
  };
}

// ========================
// Diagnostician 标准化
// ========================

function normalizeDiagnosticianResult(obj, options) {
  const diagnosis = (obj.diagnosis || []).map((d) => ({
    code: safeString(d.code || d.type, ''),
    name: safeString(d.name || d.description, ''),
    severity: safeString(d.severity || d.level, 'medium'),
    detail: safeString(d.detail || d.content || '', ''),
  }));

  const recommendations = (obj.recommendations || obj.recommendation || []).map((r) => ({
    action: safeString(r.action || r.type, ''),
    description: safeString(r.description || r.content || '', ''),
    priority: safeNumber(r.priority || r.order, 1),
  }));

  return {
    success: true,
    agent: 'diagnostician',
    mode: safeString(obj.mode || options.mode, 'diagnostic'),
    summary: safeString(obj.summary || obj.conclusion || '', ''),
    diagnosis,
    recommendations,
    mastery: {
      before: safeNumber(obj.mastery?.before || obj.masteryBefore, null),
      after: safeNumber(obj.mastery?.after || obj.masteryAfter, null),
    },
    completion: {
      shouldComplete: obj.completion?.shouldComplete !== false,
      reason: safeString(obj.completion?.reason || 'diagnosis_completed', 'diagnosis_completed'),
    },
  };
}

// ========================
// Guide 标准化
// ========================

function normalizeGuideResult(obj, options) {
  const blocks = (obj.blocks || []).map((b, i) => ({
    index: safeNumber(b.index, i + 1),
    text: safeString(b.text || b.content || '', ''),
    blockId: safeString(b.blockId || b.id, `guide-block-${i + 1}`),
  }));

  return {
    success: true,
    agent: 'guide',
    requestId: options.requestId || obj.requestId || '',
    phase: safeString(obj.phase || 'enter', 'enter'),
    blocks,
    status: safeString(obj.status, 'completed'),
  };
}

// ========================
// 降级和错误
// ========================

function buildFallbackText(meta, text, agent) {
  const content = typeof text === 'string' ? text : String(text || '');

  return {
    success: true,
    agent: agent || 'unknown',
    requestId: meta.requestId || '',
    knowledgePoint: { id: '', name: '' },
    strategy: { code: 'auto', name: '自动生成', reason: '' },
    sections: [{
      type: 'text',
      title: '教学内容',
      content: content || '（内容生成中）',
      order: 1,
    }],
    knowledgeSources: [],
    estimatedReadingMinutes: Math.max(1, Math.ceil(content.length / 500)),
  };
}

function buildParseFailed(meta, message) {
  return {
    success: false,
    code: 'AGENT_RESULT_PARSE_FAILED',
    message: 'Agent 返回内容格式无法识别: ' + message,
    agent: meta.agent || 'unknown',
    requestId: meta.requestId || '',
    details: {
      agent: meta.agent,
      rawType: meta.rawType || 'unknown',
      parseDepth: meta.parseDepth || 0,
      repairAttempted: meta.repairAttempted || false,
      requestId: meta.requestId || '',
    },
  };
}

// ========================
// 百炼 JSON Repair
// ========================

/**
 * 调用百炼模型修复 JSON
 * @param {string} rawText - 原始文本
 * @param {object} schema - 目标 Schema
 * @param {object} options
 * @returns {Promise<object>} 修复后的标准化结果
 */
async function bailianJsonRepair(rawText, schema, options = {}) {
  const { agent, requestId } = options;

  // 构建 Repair 提示词
  const schemaDesc = schema ? JSON.stringify(schema, null, 2) : '根据 Agent 类型推断';
  const prompt = `你只负责修复 JSON 语法和字段包装，不得修改字段的语义内容，不得补充原文中不存在的知识，不得删减正文。

原始内容 (已截断):
"""
${rawText.slice(0, 8000)}
"""

目标 Schema:
${schemaDesc}

Agent 类型: ${agent || 'unknown'}

请输出修复后的合法 JSON，不要添加任何解释文字，只输出 JSON。`;

  try {
    if (!process.env.BAILIAN_API_KEY) {
      return null; // 没有 API Key，跳过 repair
    }
    const { bailianModelCall } = require('../learning-agent/adapters/bailian-model.adapter');
    const response = await bailianModelCall([{ role: 'user', content: prompt }], {
      jsonMode: true,
      enableThinking: false,
      temperature: 0.1,
      timeout: 30_000,
    });
    const repairedText = response.content || '';

    // 提取 JSON
    const extracted = balancedBracketExtract(repairedText.trim()) || repairedText.trim();
    const parsed = JSON.parse(extracted);

    // 再次标准化
    return normalizeByAgent(parsed, { ...options, requestId });
  } catch (err) {
    console.warn('[AgentResultParser] Bailian JSON repair failed:', err.message);
    return null;
  }
}

// ========================
// 公开的便捷方法
// ========================

async function parseWithRepair(raw, options = {}) {
  const result = await parseAgentResult(raw, options);

  // 如果需要 repair 且有原始文本
  if (result._rawForRepair && options.allowRepair) {
    const repaired = await bailianJsonRepair(result._rawForRepair, options.schema, options);
    if (repaired && repaired.success) {
      repaired._wasRepaired = true;
      return repaired;
    }
    // Repair 失败 — 返回错误
    return {
      ...result,
      details: { ...result.details, repairAttempted: true },
    };
  }

  return result;
}

// ========================
// 工具函数
// ========================

function safeString(value, fallback) {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function safeNumber(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

function safeSnippet(text, maxLength = MAX_SAFE_LOG_LENGTH) {
  const str = String(text || '');
  return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
}

// ========================
// 导出
// ========================

module.exports = {
  parseAgentResult,
  parseWithRepair,
  normalizeExplainerResult,
  normalizeTrainerResult,
  normalizeDiagnosticianResult,
  normalizeGuideResult,
  bailianJsonRepair,
  balancedBracketExtract,
  preprocessText,
  safeJsonRepair,
  normalizeStoredAgentOutput,
  EMPTY_RESULT,
  MAX_PARSE_DEPTH,
  MAX_RESULT_LENGTH,
};
