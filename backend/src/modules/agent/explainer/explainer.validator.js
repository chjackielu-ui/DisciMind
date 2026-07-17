const { randomUUID } = require('crypto');
const { createAgentError } = require('../common/agent.errors');

const MAX_MESSAGE_LENGTH = 4000;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CONVERSATION_ID_LENGTH = 255;
const MAX_LEARNING_SESSION_ID_LENGTH = 128;

const STRATEGY_ALIASES = {
  auto: 'auto',
  direct: 'direct_instruction',
  direct_instruction: 'direct_instruction',
  socratic: 'socratic_dialogue',
  socratic_dialogue: 'socratic_dialogue',
  analogy: 'analogy_bridge',
  analogy_bridge: 'analogy_bridge',
  misconception: 'misconception_confrontation',
  misconception_confrontation: 'misconception_confrontation',
};

const DIFY_STRATEGY = {
  auto: 'auto',
  direct_instruction: 'direct',
  socratic_dialogue: 'socratic',
  analogy_bridge: 'analogy',
  misconception_confrontation: 'misconception',
};

const DEPTH_VALUES = new Set(['brief', 'moderate', 'deep']);

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function parsePositiveInt(value, fieldName, required = true) {
  if (value == null || value === '') {
    if (!required) return null;
    throw createAgentError('INVALID_INPUT', `${fieldName} 不能为空`, 400);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw createAgentError('INVALID_INPUT', `${fieldName} 参数不合法`, 400);
  }
  return parsed;
}

function normalizeRequestId(value) {
  if (value == null || value === '') return `explainer_${randomUUID()}`;
  if (typeof value !== 'string') {
    throw createAgentError('INVALID_INPUT', 'requestId 必须是字符串', 400);
  }
  const requestId = value.trim();
  if (!requestId || requestId.length > MAX_REQUEST_ID_LENGTH) {
    throw createAgentError('INVALID_INPUT', `requestId 不能为空且不能超过 ${MAX_REQUEST_ID_LENGTH} 个字符`, 400);
  }
  return requestId;
}

function normalizeOptionalString(value, fieldName, maxLength) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') {
    throw createAgentError('INVALID_INPUT', `${fieldName} 必须是字符串`, 400);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw createAgentError('INVALID_INPUT', `${fieldName} 不能超过 ${maxLength} 个字符`, 400);
  }
  return normalized;
}

function normalizeStrategy(value) {
  const key = String(value || 'auto').trim().toLowerCase();
  const strategy = STRATEGY_ALIASES[key];
  if (!strategy) {
    throw createAgentError('INVALID_INPUT', 'strategyHint 不合法', 400, {
      allowed: Object.keys(STRATEGY_ALIASES),
    });
  }
  return strategy;
}

function normalizeDepth(value) {
  const depth = String(value || 'moderate').trim().toLowerCase();
  if (!DEPTH_VALUES.has(depth)) {
    throw createAgentError('INVALID_INPUT', 'depth 不合法', 400, {
      allowed: Array.from(DEPTH_VALUES),
    });
  }
  return depth;
}

function validateExplainerChatBody(body = {}) {
  if (!isPlainObject(body)) {
    throw createAgentError('INVALID_INPUT', '请求体必须是 JSON 对象', 400);
  }

  const message = String(body.message ?? body.query ?? '').trim();
  if (!message) {
    throw createAgentError('INVALID_INPUT', 'message 不能为空', 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw createAgentError('INVALID_INPUT', `message 不能超过 ${MAX_MESSAGE_LENGTH} 个字符`, 400);
  }

  return {
    knowledgePointId: parsePositiveInt(body.knowledgePointId ?? body.knowledge_point_id, 'knowledgePointId'),
    message,
    strategyHint: normalizeStrategy(body.strategyHint ?? body.strategy_hint),
    conversationId: normalizeOptionalString(
      body.conversationId ?? body.conversation_id,
      'conversationId',
      MAX_CONVERSATION_ID_LENGTH,
    ),
    learningSessionId: normalizeOptionalString(
      body.learningSessionId ?? body.learning_session_id,
      'learningSessionId',
      MAX_LEARNING_SESSION_ID_LENGTH,
    ),
    practiceSessionId: parsePositiveInt(body.practiceSessionId ?? body.practice_session_id, 'practiceSessionId', false),
    depth: normalizeDepth(body.depth),
    requestId: normalizeRequestId(body.requestId ?? body.request_id),
    locale: normalizeOptionalString(body.locale, 'locale', 20) || 'zh-CN',
    newConversation: body.newConversation === true || body.new_conversation === true,
  };
}

module.exports = {
  DIFY_STRATEGY,
  STRATEGY_ALIASES,
  validateExplainerChatBody,
};
