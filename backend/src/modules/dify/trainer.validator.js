const { randomUUID } = require('crypto');
const { createTrainerError } = require('./trainer.errors');

const TRAINER_MODES = Object.freeze([
  'diagnostic_pre_test',
  'adaptive_training',
  'deep_evaluation',
]);

const TRAINER_MODE_SET = new Set(TRAINER_MODES);
const DEFAULT_LOCALE = 'zh-CN';
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_LOCALE_LENGTH = 20;

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function parseBooleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function normalizeRequestId(value) {
  if (value === undefined) {
    return `trainer_${randomUUID()}`;
  }

  if (typeof value !== 'string') {
    throw createTrainerError('INVALID_INPUT', 'request_id 必须是字符串', 400);
  }

  const requestId = value.trim();
  if (!requestId) {
    throw createTrainerError('INVALID_INPUT', 'request_id 不能为空', 400);
  }
  if (requestId.length > MAX_REQUEST_ID_LENGTH) {
    throw createTrainerError('INVALID_INPUT', `request_id 不能超过 ${MAX_REQUEST_ID_LENGTH} 个字符`, 400);
  }

  return requestId;
}

function normalizeLocale(value) {
  if (value === undefined) return DEFAULT_LOCALE;

  if (typeof value !== 'string') {
    throw createTrainerError('INVALID_INPUT', 'locale 必须是字符串', 400);
  }

  const locale = value.trim();
  if (!locale || locale.length > MAX_LOCALE_LENGTH) {
    throw createTrainerError('INVALID_INPUT', 'locale 不合法', 400);
  }
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(locale)) {
    throw createTrainerError('INVALID_INPUT', 'locale 不合法', 400);
  }

  return locale;
}

function normalizeDebug(value) {
  const envDebug = parseBooleanEnv('TRAINER_DEBUG', false);

  if (value !== undefined && typeof value !== 'boolean') {
    throw createTrainerError('INVALID_INPUT', 'debug 必须是 boolean', 400);
  }

  if (process.env.NODE_ENV === 'production') {
    return envDebug;
  }

  return value === undefined ? envDebug : value;
}

function validateTrainerRunInput(body) {
  if (!isPlainObject(body)) {
    throw createTrainerError('INVALID_INPUT', '请求体必须是 JSON 对象', 400);
  }

  const { mode, payload } = body;
  const hasRequestId = Object.prototype.hasOwnProperty.call(body, 'request_id');
  const hasCamelRequestId = Object.prototype.hasOwnProperty.call(body, 'requestId');

  if (typeof mode !== 'string' || !TRAINER_MODE_SET.has(mode)) {
    throw createTrainerError('INVALID_MODE', 'mode 不合法', 400, {
      allowed_modes: TRAINER_MODES,
    });
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'payload') || !isPlainObject(payload)) {
    throw createTrainerError('INVALID_INPUT', 'payload 必须是非空普通对象', 400);
  }

  return {
    mode,
    requestId: normalizeRequestId(hasRequestId ? body.request_id : (hasCamelRequestId ? body.requestId : undefined)),
    payload,
    locale: normalizeLocale(body.locale),
    debug: normalizeDebug(body.debug),
  };
}

module.exports = {
  DEFAULT_LOCALE,
  TRAINER_MODES,
  isPlainObject,
  parseBooleanEnv,
  validateTrainerRunInput,
};
