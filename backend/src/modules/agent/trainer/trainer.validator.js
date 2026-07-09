const { randomUUID } = require('crypto');
const { createTrainerAgentError } = require('./trainer.errors');

const DEFAULT_LOCALE = 'zh-CN';
const MAX_QUESTION_COUNT = 10;
const MAX_REQUEST_ID_LENGTH = 128;
const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high', 'unknown']);

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function parsePositiveInt(value, fieldName, required = true) {
  if (value == null || value === '') {
    if (!required) return null;
    throw createTrainerAgentError('INVALID_INPUT', `${fieldName} 不能为空`, 400);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw createTrainerAgentError('INVALID_INPUT', `${fieldName} 参数不合法`, 400);
  }
  return parsed;
}

function parseQuestionCount(value) {
  const count = parsePositiveInt(value ?? 3, 'questionCount');
  if (count > MAX_QUESTION_COUNT) {
    throw createTrainerAgentError('INVALID_INPUT', `questionCount 不能超过 ${MAX_QUESTION_COUNT}`, 400);
  }
  return count;
}

function normalizeLocale(value) {
  if (value == null || value === '') return DEFAULT_LOCALE;
  if (typeof value !== 'string') {
    throw createTrainerAgentError('INVALID_INPUT', 'locale 必须是字符串', 400);
  }
  const locale = value.trim();
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(locale)) {
    throw createTrainerAgentError('INVALID_INPUT', 'locale 不合法', 400);
  }
  return locale;
}

function normalizeRequestId(value, prefix = 'trainer') {
  if (value == null || value === '') return `${prefix}_${randomUUID()}`;
  if (typeof value !== 'string') {
    throw createTrainerAgentError('INVALID_INPUT', 'requestId 必须是字符串', 400);
  }
  const requestId = value.trim();
  if (!requestId || requestId.length > MAX_REQUEST_ID_LENGTH) {
    throw createTrainerAgentError('INVALID_INPUT', `requestId 不能为空且不能超过 ${MAX_REQUEST_ID_LENGTH} 个字符`, 400);
  }
  return requestId;
}

function validateContextQuery(query = {}) {
  return {
    courseId: parsePositiveInt(query.courseId ?? query.course_id, 'courseId'),
    knowledgePointId: parsePositiveInt(query.knowledgePointId ?? query.knowledge_point_id, 'knowledgePointId'),
  };
}

function validateCreateSessionBody(body = {}) {
  if (!isPlainObject(body)) {
    throw createTrainerAgentError('INVALID_INPUT', '请求体必须是 JSON 对象', 400);
  }

  return {
    courseId: parsePositiveInt(body.courseId ?? body.course_id, 'courseId'),
    knowledgePointId: parsePositiveInt(body.knowledgePointId ?? body.knowledge_point_id, 'knowledgePointId'),
    questionCount: parseQuestionCount(body.questionCount ?? body.question_count),
    locale: normalizeLocale(body.locale),
    requestId: normalizeRequestId(body.requestId ?? body.request_id, 'trainer_diag'),
  };
}

function validateSessionId(value) {
  return parsePositiveInt(value, 'sessionId');
}

function validateAnswerBody(body = {}) {
  if (!isPlainObject(body)) {
    throw createTrainerAgentError('INVALID_INPUT', '请求体必须是 JSON 对象', 400);
  }
  const questionKey = String(body.questionKey ?? body.question_key ?? '').trim();
  if (!questionKey) {
    throw createTrainerAgentError('INVALID_INPUT', 'questionKey 不能为空', 400);
  }

  const selectedOption = String(body.selectedOption ?? body.selected_option ?? '').trim();
  if (!selectedOption) {
    throw createTrainerAgentError('INVALID_INPUT', 'selectedOption 不能为空', 400);
  }

  const rawSeconds = body.timeSpentSeconds ?? body.time_spent_seconds ?? body.durationSeconds ?? body.duration_seconds;
  const parsedSeconds = rawSeconds == null || rawSeconds === ''
    ? null
    : Number.parseInt(rawSeconds, 10);
  if (parsedSeconds != null && (!Number.isFinite(parsedSeconds) || parsedSeconds < 0)) {
    throw createTrainerAgentError('INVALID_INPUT', 'timeSpentSeconds 参数不合法', 400);
  }

  const confidence = String(body.confidenceLevel ?? body.confidence_level ?? 'unknown').trim().toLowerCase();
  if (!CONFIDENCE_LEVELS.has(confidence)) {
    throw createTrainerAgentError('INVALID_INPUT', 'confidenceLevel 不合法', 400);
  }

  return {
    questionKey,
    selectedOption,
    timeSpentSeconds: parsedSeconds,
    confidenceLevel: confidence,
    requestId: normalizeRequestId(body.requestId ?? body.request_id, 'trainer_eval'),
    locale: normalizeLocale(body.locale),
  };
}

module.exports = {
  DEFAULT_LOCALE,
  isPlainObject,
  normalizeRequestId,
  parsePositiveInt,
  validateAnswerBody,
  validateContextQuery,
  validateCreateSessionBody,
  validateSessionId,
};
