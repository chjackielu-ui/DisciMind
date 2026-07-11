const crypto = require('crypto');
const { normalizeSpeechText } = require('./speech-text-normalizer.service');

const INTRO = {
  concept_explanation: '接下来我们一起学习这个知识点，请先关注它的核心定义和应用场景。',
  basic_practice: '接下来进入基础练习，请根据当前理解完成这道题。',
  adaptive_practice: '接下来系统会根据你刚才的表现调整题目难度。',
  wrong_question_repair: '接下来我们一起分析刚才的错误，并修复关键误区。',
  deep_evaluation: '接下来进入阶段检测，请认真完成当前题目。',
  learning_summary: '本轮学习已经结束，接下来一起回顾你的掌握情况。',
};

const BLOCKED_KEYS = /^(?:correct_?answer|standard_?answer|answer|analysis|explanation|rubric|evaluation|expected_answer_elements|rawOutput|retrievalRefs|knowledge_sources|sourceId|datasetId|documentId|segmentId|score|confidence)$/i;

function stringValues(value, keys, options = {}) {
  const result = [];
  for (const key of keys) {
    const current = value?.[key];
    if (typeof current === 'string') result.push(current);
    else if (Array.isArray(current)) {
      for (const item of current) {
        if (typeof item === 'string') result.push(item);
        else if (item && typeof item === 'object') {
          for (const [nestedKey, nestedValue] of Object.entries(item)) {
            if (!BLOCKED_KEYS.test(nestedKey) && typeof nestedValue === 'string') result.push(nestedValue);
          }
        }
      }
    }
  }
  return options.limit ? result.slice(0, options.limit) : result;
}

function trainerBeforeSubmit(data) {
  const question = data.currentQuestion || data.question || data.questions?.[Number(data.currentQuestionIndex || 0)] || data.questions?.[0];
  if (!question) return [];
  const lines = [question.question_number ? `第${question.question_number}题。` : '', question.stem || question.question || ''];
  for (const option of question.options || []) lines.push(`${option.key || option.label || ''}，${option.content || option.text || ''}。`);
  if (question.time_limit || question.timeLimit) lines.push(`作答时间为${question.time_limit || question.timeLimit}。`);
  return lines.filter(Boolean);
}

function compileAllowedText(data, { agentType, nodeType, purpose }) {
  const kind = String(agentType || data?.agentType || '').toLowerCase();
  const mode = String(data?.mode || data?.strategy || nodeType || '').toLowerCase();
  if (kind.includes('trainer') || /practice|evaluation|variant/.test(mode)) {
    if (purpose === 'feedback') {
      const latest = data.answerHistory?.at?.(-1) || data.finalAnswer || data.feedback || data;
      const correctness = latest.is_correct ?? latest.isCorrect;
      return [correctness == null ? '' : correctness ? '回答正确。' : '回答不正确。', ...stringValues(latest, ['feedback', 'error_analysis', 'remediation_hint', 'next_step'], { limit: 2 })];
    }
    return trainerBeforeSubmit(data);
  }
  if (mode === 'learning_summary' || kind.includes('summary')) {
    return stringValues(data, ['completion_summary', 'mastered_content', 'weak_content', 'wrong_answer_summary', 'mastery_change', 'next_steps'], { limit: 12 });
  }
  if (kind.includes('diagnostician') || /diagnos|misconception/.test(mode)) {
    return stringValues(data, ['diagnosis_conclusion', 'overall_assessment', 'reasonable_parts', 'root_cause', 'error_analysis', 'repair_suggestions', 'suggested_remediation', 'recommended_next_step', 'recommended_action'], { limit: 10 });
  }
  return stringValues(data, [
    'title', 'topic', 'concept', 'sections', 'content', 'summary', 'analogies', 'bridge_back',
    'problem_statement', 'solution_steps', 'key_insights', 'common_mistakes', 'starting_question',
    'guidance_hints', 'follow_up_questions', 'identified_misconception', 'why_it_is_wrong',
    'correct_understanding', 'practice_question', 'key_concepts', 'review_questions', 'next_steps',
  ], { limit: 30 });
}

function splitSpeechText(text, maxChars = 180, minChars = 40) {
  const sentences = String(text || '').match(/[^。！？；：.!?]+[。！？；：.!?]?/g) || [];
  const segments = [];
  let current = '';
  const flush = () => { if (current.trim() && !/^[\p{P}\p{S}\s]+$/u.test(current)) segments.push(current.trim()); current = ''; };
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if ((current + part).length <= maxChars) { current += part; continue; }
    if (current.length >= minChars) flush();
    if (part.length <= maxChars) { current += part; continue; }
    const words = part.match(/[A-Za-z]+|[\u3400-\u9fff]|\d+(?:\.\d+)?|[^A-Za-z\u3400-\u9fff\d]/g) || [];
    for (const word of words) {
      if ((current + word).length > maxChars) flush();
      current += word;
    }
  }
  flush();
  return segments;
}

function buildNarrationScript({ jobId, sessionId, nodeRunId, nodeType, agentType, content, purpose = 'node_content', config, metrics = {} }) {
  const started = Date.now();
  const intro = INTRO[nodeType] || '接下来由学习引导老师陪你完成当前学习任务。';
  const rawParts = compileAllowedText(content || {}, { agentType, nodeType, purpose });
  let normalized = rawParts.map((part) => normalizeSpeechText(part, metrics)).filter(Boolean).join('。');
  const maxTotal = purpose === 'feedback' ? Math.min(100, config.maxTotalChars)
    : nodeType === 'learning_summary' ? Math.min(500, config.maxTotalChars) : config.maxTotalChars;
  normalized = normalized.slice(0, maxTotal);
  const contentSegments = splitSpeechText(normalized, Math.min(config.maxSegmentChars, config.maxTextLength));
  const drafts = [];
  if (purpose !== 'feedback') drafts.push({ segmentId: 'intro', type: 'intro', text: intro });
  contentSegments.forEach((text, index) => drafts.push({ segmentId: `content_${index + 1}`, type: 'content', text }));
  const segments = drafts.filter((item) => item.text).map((item, order) => ({ ...item, order }));
  const scriptHash = crypto.createHash('sha256').update(segments.map((item) => item.text).join('\n')).digest('hex');
  metrics.scriptBuildMs = Date.now() - started;
  metrics.characterCount = segments.reduce((sum, item) => sum + item.text.length, 0);
  return { jobId, sessionId, nodeRunId, scriptHash, segments };
}

module.exports = { buildNarrationScript, splitSpeechText, compileAllowedText, INTRO };
