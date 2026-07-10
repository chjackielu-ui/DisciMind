// Dify Agent 教学结果标准化工具
// 职责：将 Dify 返回的各种格式统一解析为标准教学结果结构
// Dify agent 根据上下文返回不同 JSON 结构——此工具处理所有已知格式

/**
 * 标准化 Dify Agent 返回结果
 * 支持所有已知格式: 嵌套对象、JSON字符串、Markdown代码块、SSE answer
 * 如果完全无法解析，返回一个包含原始内容的基础section（绝不丢失数据）
 * @param {any} raw - Dify 返回的原始数据
 * @returns {{ success: boolean, result: object|null, error: string|null }}
 */
export function normalizeLearningAgentResult(raw) {
  const result = { success: false, result: null, error: null };

  if (raw == null) {
    result.error = 'Empty input';
    return buildFallbackResult(result, '（无返回内容）');
  }

  // Step 1: 如果已经是对象，直接解析
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return buildFromObject(raw);
  }

  // Step 2: 字符串 → 尝试多层解析
  if (typeof raw === 'string') {
    return buildFromString(raw);
  }

  // Step 3: 数组 → 尝试作为sections
  if (Array.isArray(raw)) {
    return buildFromArray(raw);
  }

  result.error = 'Unsupported input type: ' + typeof raw;
  return buildFallbackResult(result, String(raw));
}

// ========================
// 字符串解析
// ========================

function buildFromString(str) {
  const result = { success: false, result: null, error: null };
  let text = str.trim();

  // Try to extract JSON from the string at multiple levels
  const parsed = extractJsonAnywhere(text, 0, 5);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return buildFromObject(parsed);
  }
  if (Array.isArray(parsed)) {
    return buildFromArray(parsed);
  }

  // If it looks like JSON but failed to parse, try cleaning more aggressively
  if (text.startsWith('{') || text.includes('"{')) {
    // Might be double-escaped JSON string
    try {
      const unescaped = text.replace(/\\"/g, '"').replace(/^"/, '').replace(/"$/, '');
      const reparsed = extractJsonAnywhere(unescaped, 0, 3);
      if (reparsed && typeof reparsed === 'object' && !Array.isArray(reparsed)) {
        return buildFromObject(reparsed);
      }
    } catch {}
  }

  // Plain text / markdown — wrap in a section
  return buildFallbackResult(result, text);
}

function extractJsonAnywhere(text, depth, maxDepth) {
  if (depth > maxDepth) return null;
  if (!text || typeof text !== 'string') return text.trim();

  let work = text.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  work = work.replace(/```(?:json)?\s*\n?/gi, '').replace(/\n?\s*```/g, '');

  // Find JSON object
  const firstBrace = work.indexOf('{');
  const lastBrace = work.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const candidate = work.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return parsed;
      }
    } catch {
      // Try with escaped characters fixed
      try {
        const fixed = candidate
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        const reparsed = JSON.parse(fixed);
        if (reparsed && typeof reparsed === 'object') {
          if (!Array.isArray(reparsed)) return reparsed;
          return reparsed;
        }
      } catch {}
    }
  }

  // If still a string after all attempts, try recursive parse
  // (handles JSON strings nested inside JSON strings)
  if (typeof work === 'string' && work.trim().startsWith('{')) {
    return extractJsonAnywhere(work, depth + 1, maxDepth);
  }

  return work;
}

// ========================
// 对象解析（核心）
// ========================

function buildFromObject(obj) {
  // Unwrap common Dify wrapper patterns

  // Pattern 1: { data: { outputs: { answer/result: ... } } }
  if (obj.data && obj.data.outputs && !obj.sections && !obj.strategy) {
    const inner = obj.data.outputs;
    if (inner.answer) {
      const parsed = tryParseValue(inner.answer);
      if (parsed && typeof parsed === 'object') return buildFromObject(parsed);
      // answer is plain text
      return buildNormalizedResult(obj, { content: inner.answer });
    }
    if (inner.result) {
      const parsed = tryParseValue(inner.result);
      if (parsed && typeof parsed === 'object') return buildFromObject(parsed);
      return buildNormalizedResult(obj, { content: inner.result });
    }
    return buildNormalizedResult(obj, { content: JSON.stringify(inner) });
  }

  // Pattern 2: { outputs: { answer/result: ... } }
  if (obj.outputs && !obj.sections && !obj.strategy) {
    const inner = obj.outputs;
    if (inner.answer) {
      const parsed = tryParseValue(inner.answer);
      if (parsed && typeof parsed === 'object') return buildFromObject(parsed);
      return buildNormalizedResult(obj, { content: inner.answer });
    }
    if (inner.result) {
      const parsed = tryParseValue(inner.result);
      if (parsed && typeof parsed === 'object') return buildFromObject(parsed);
      return buildNormalizedResult(obj, { content: inner.result });
    }
    return buildNormalizedResult(obj, { content: JSON.stringify(inner) });
  }

  // Pattern 3: { answer: "..." } — answer might be JSON string
  if (obj.answer && typeof obj.answer === 'string' && !obj.sections && !obj.strategy) {
    const parsed = tryParseValue(obj.answer);
    if (parsed && typeof parsed === 'object') return buildFromObject(parsed);
    return buildNormalizedResult(obj, { content: obj.answer });
  }

  // Pattern 4: { result: "..." } or { result: {...} }
  if (obj.result && !obj.sections) {
    if (typeof obj.result === 'string') {
      const parsed = tryParseValue(obj.result);
      if (parsed && typeof parsed === 'object') return buildFromObject(parsed);
      return buildNormalizedResult(obj, { content: obj.result });
    }
    if (typeof obj.result === 'object' && obj.result.sections) {
      // result is the teaching payload
      return buildNormalizedResult(obj, obj.result);
    }
    if (typeof obj.result === 'object') {
      // result is some object, try to extract content
      return buildNormalizedResult(obj, obj.result);
    }
  }

  // Pattern 5: Direct teaching result { strategy, sections, ... }
  if (obj.sections && Array.isArray(obj.sections)) {
    return buildNormalizedResult(obj, obj);
  }

  // Pattern 6: { text: "...", content: "..." }
  if ((obj.text || obj.content) && !obj.sections) {
    return buildNormalizedResult(obj, { content: obj.text || obj.content });
  }

  // Pattern 7: { knowledge_point: {...}, response_type: "..." }
  if (obj.response_type || obj.knowledge_point) {
    // Try to find any text-like content
    const content = obj.explanation || obj.summary || obj.content || obj.text || '';
    if (content) {
      return buildNormalizedResult(obj, { content });
    }
    // Has structure but no text — wrap the whole thing
    return buildNormalizedResult(obj, { content: JSON.stringify(obj) });
  }

  // Fallback: unknown object — extract any text-like fields or stringify
  const textContent = extractTextContent(obj);
  if (textContent) {
    return buildNormalizedResult(obj, { content: textContent });
  }

  // Last resort: save the entire object as content
  return buildNormalizedResult(obj, { content: JSON.stringify(obj) });
}

// ========================
// 数组解析
// ========================

function buildFromArray(arr) {
  // Array might be a list of sections
  return buildNormalizedResult({}, { sections: arr.map((item, i) => {
    if (typeof item === 'string') return { type: 'text', title: '', content: item, order: i + 1 };
    if (typeof item === 'object') {
      return {
        type: item.type || 'text',
        title: item.title || '',
        content: item.content || item.text || JSON.stringify(item),
        order: i + 1,
      };
    }
    return { type: 'text', title: '', content: String(item), order: i + 1 };
  })});
}

// ========================
// 标准化结果构建
// ========================

function buildNormalizedResult(rawObj, teachingPayload) {
  // teachingPayload is either the direct teaching result or extracted content
  const sections = normalizeSections(
    teachingPayload.sections ||
    (teachingPayload.content ? [{ type: 'text', title: '', content: teachingPayload.content }] : [])
  );

  const strategy = normalizeStrategy(teachingPayload.strategy || teachingPayload.strategy_decision || {});
  const knowledgeSources = normalizeSources(
    teachingPayload.knowledgeSources ||
    teachingPayload.knowledge_sources ||
    teachingPayload.knowledge?.sources ||
    []
  );
  const estimatedReadingMinutes = teachingPayload.estimated_reading_time_minutes
    || teachingPayload.estimatedReadingMinutes
    || Math.max(1, Math.ceil((teachingPayload.content || '').length / 500))
    || 3;

  const teachingResult = {
    strategy,
    sections,
    estimatedReadingMinutes,
    knowledgeSources,
  };

  return {
    success: true,
    result: teachingResult,
    error: null,
    // Metadata
    agent: teachingPayload.agent || rawObj.agent || '',
    responseType: teachingPayload.response_type || rawObj.response_type || 'teaching_result',
    requestId: teachingPayload.request_id || rawObj.request_id || '',
    knowledgePoint: teachingPayload.knowledge_point || rawObj.knowledge_point || { id: '', name: '' },
    interactionState: teachingPayload.interaction_state || rawObj.interaction_state || 'completed',
    _source: rawObj,
  };
}

function buildFallbackResult(result, content) {
  if (!content || (typeof content === 'string' && content.trim() === '')) {
    content = '（内容生成中，请稍后重试）';
  }
  return {
    success: true,
    result: {
      strategy: { code: 'auto', name: '自动生成', reason: '' },
      sections: [{ type: 'text', title: '教学内容', content: String(content), order: 1 }],
      estimatedReadingMinutes: 3,
      knowledgeSources: [],
    },
    error: null,
    agent: '',
    responseType: 'fallback',
    requestId: '',
    knowledgePoint: { id: '', name: '' },
    interactionState: 'completed',
    _source: { raw: content },
  };
}

// ========================
// 辅助函数
// ========================

function tryParseValue(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch {}
  }
  // Try extracting JSON from markdown or surrounding text
  const extracted = extractJsonAnywhere(trimmed, 0, 3);
  if (extracted && typeof extracted === 'object') return extracted;
  return value;
}

function extractTextContent(obj) {
  const textKeys = ['explanation', 'summary', 'content', 'text', 'output', 'description', 'message'];
  for (const key of textKeys) {
    if (obj[key] && typeof obj[key] === 'string' && obj[key].trim().length > 10) {
      return obj[key];
    }
  }
  return '';
}

function normalizeStrategy(strategyObj) {
  if (!strategyObj || typeof strategyObj !== 'object') {
    return { code: 'auto', name: '自动选择', reason: '', source: '' };
  }
  const code = strategyObj.code || strategyObj.source || 'auto';
  const strategyMap = {
    direct_instruction: '直接讲授',
    socratic_dialogue: '苏格拉底对话',
    analogy_bridge: '类比桥接',
    misconception_confrontation: '误解对抗',
    auto: '自动选择',
  };
  return {
    code,
    name: strategyMap[code] || strategyObj.name || '自动选择',
    reason: strategyObj.reason || '',
    source: strategyObj.source || '',
  };
}

function normalizeSources(rawSources) {
  if (!Array.isArray(rawSources)) return [];
  return rawSources.map((s) => ({
    name: s.name || s.document_name || s.file_name || s.title || '',
    score: typeof s.score === 'number' ? s.score : parseFloat(s.score) || 0,
    matchPercent: typeof s.score === 'number' ? Math.round(s.score * 100) : null,
  }));
}

function normalizeSections(rawSections) {
  if (!rawSections || !Array.isArray(rawSections)) return [];
  return rawSections.map((section, index) => {
    if (typeof section === 'string') {
      return { type: 'text', title: '', content: section, order: index + 1 };
    }
    if (typeof section === 'object') {
      return {
        type: section.type || 'text',
        title: section.title || SECTION_TITLES[section.type] || '',
        content: section.content || section.text || '',
        order: section.order || index + 1,
      };
    }
    return { type: 'text', title: '', content: String(section), order: index + 1 };
  });
}

// 段落类型 → 标题映射
const SECTION_TITLES = {
  prerequisite_bridge: '知识衔接',
  core_definition: '核心定义',
  deep_dive: '深入理解',
  example: '案例分析',
  misconception_guard: '易错辨析',
  formula: '公式解析',
  summary: '本节小结',
  question: '思考问题',
  practice: '练习任务',
  strategy_explanation: '学习策略',
  key_takeaways: '关键结论',
};

// 段落类型 UI 配置
export const SECTION_TYPE_CONFIG = {
  prerequisite_bridge: { label: '知识衔接', icon: '🔗', color: '#2f6690' },
  core_definition: { label: '核心定义', icon: '📖', color: '#177a5a' },
  deep_dive: { label: '深入理解', icon: '🔍', color: '#4b5fc0' },
  example: { label: '案例分析', icon: '💡', color: '#c65d2e' },
  misconception_guard: { label: '易错辨析', icon: '⚠️', color: '#d4632a' },
  formula: { label: '公式解析', icon: '📐', color: '#7c4cc4' },
  summary: { label: '本节小结', icon: '📋', color: '#3a7ca5' },
  question: { label: '思考问题', icon: '🤔', color: '#e07b39' },
  practice: { label: '练习任务', icon: '✏️', color: '#2d6a4f' },
  strategy_explanation: { label: '学习策略', icon: '🎯', color: '#5c4a7a' },
  key_takeaways: { label: '关键结论', icon: '✅', color: '#1a7a4c' },
  text: { label: '教学内容', icon: '📄', color: '#666' },
  unknown: { label: '补充内容', icon: '📄', color: '#666' },
};

export function getSectionConfig(type) {
  return SECTION_TYPE_CONFIG[type] || SECTION_TYPE_CONFIG.unknown;
}
