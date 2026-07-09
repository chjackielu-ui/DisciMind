const BLOCKED_PUBLIC_MARKERS = [
  'is_correct',
  'standard_answer',
  'correct_option',
  'answer_content',
  'distractor_analysis',
  'explanation',
  'reasoning_content',
  'authorization',
  'api_key',
  'prompt',
  'usage',
];

function pickQuestionKey(question, fallbackOrder = 1) {
  return String(
    question?.question_key ??
    question?.questionKey ??
    question?.id ??
    `q_${fallbackOrder}`,
  ).trim();
}

function sanitizePublicQuestion(fullQuestion, fallbackOrder = 1) {
  const questionKey = pickQuestionKey(fullQuestion, fallbackOrder);
  const options = Array.isArray(fullQuestion?.options)
    ? fullQuestion.options.map((option, index) => ({
        key: String(option?.key ?? option?.option_key ?? String.fromCharCode(65 + index)).trim(),
        content: String(option?.content ?? option?.option_content ?? option?.text ?? '').trim(),
      })).filter((option) => option.key && option.content)
    : [];

  return {
    questionKey,
    type: String(fullQuestion?.type ?? fullQuestion?.question_type ?? 'single_choice').trim(),
    stem: String(fullQuestion?.stem ?? fullQuestion?.content ?? fullQuestion?.title ?? '').trim(),
    options,
    difficulty: fullQuestion?.difficulty ?? fullQuestion?.difficulty_level ?? null,
    estimatedTimeSeconds: fullQuestion?.estimated_time_seconds ?? fullQuestion?.estimatedTimeSeconds ?? null,
    questionOrder: Number(fullQuestion?.question_order ?? fullQuestion?.questionOrder ?? fallbackOrder),
  };
}

function stripUnsafeInternalMeta(value) {
  if (Array.isArray(value)) return value.map(stripUnsafeInternalMeta);
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (
      normalized === 'reasoning_content' ||
      normalized === 'usage' ||
      normalized === 'prompt' ||
      normalized === 'raw_prompt' ||
      normalized === 'messages' ||
      normalized === 'authorization' ||
      normalized.includes('api_key') ||
      normalized.includes('token')
    ) {
      continue;
    }
    result[key] = stripUnsafeInternalMeta(item);
  }
  return result;
}

function stringifyHasPublicLeak(publicQuestion) {
  const serialized = JSON.stringify(publicQuestion).toLowerCase();
  return BLOCKED_PUBLIC_MARKERS.some((marker) => serialized.includes(marker));
}

module.exports = {
  BLOCKED_PUBLIC_MARKERS,
  pickQuestionKey,
  sanitizePublicQuestion,
  stringifyHasPublicLeak,
  stripUnsafeInternalMeta,
};
