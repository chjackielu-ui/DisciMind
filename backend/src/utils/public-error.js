const PUBLIC_MESSAGE_BY_CODE = {
  40001: '请求参数不正确',
  40002: '请求的数据不存在',
  40101: '登录状态已失效，请重新登录',
  40301: '你没有权限执行此操作',
  40401: '请求的资源不存在',
  40901: '当前数据状态已发生变化，请刷新后重试',
  50001: '服务器暂时无法完成请求，请稍后重试',
};

const PUBLIC_CODE_BY_LEGACY_CODE = {
  40001: 'BAD_REQUEST',
  40002: 'NOT_FOUND',
  40101: 'UNAUTHORIZED',
  40301: 'FORBIDDEN',
  40401: 'NOT_FOUND',
  40901: 'CONFLICT',
  50001: 'INTERNAL_ERROR',
};

function requestIdOf(requestOrResponse) {
  const request = requestOrResponse?.req || requestOrResponse;
  return request?.id || request?.get?.('x-request-id') || null;
}

function looksInternal(code, message) {
  const text = String(message || '');
  return /^P\d{4}$/i.test(String(code || ''))
    || /Invalid\s+`?prisma\.|PrismaClient|Unknown argument|Foreign key constraint|Unique constraint|database|SQLSTATE|at\s+\S+\s+\(/i.test(text);
}

function legacyCodeFor(errorOrCode) {
  const raw = typeof errorOrCode === 'object' ? errorOrCode?.code : errorOrCode;
  if (Number.isInteger(raw)) return raw;
  const status = typeof errorOrCode === 'object' ? Number(errorOrCode?.status) : 0;
  if (status === 401) return 40101;
  if (status === 403) return 40301;
  if (status === 404) return 40401;
  if (status === 409) return 40901;
  if (status >= 400 && status < 500) return 40001;
  return 50001;
}

function httpStatusFor(legacyCode, explicitStatus) {
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) return explicitStatus;
  if (legacyCode === 40101) return 401;
  if (legacyCode === 40301) return 403;
  if (legacyCode === 40401 || legacyCode === 40002) return 404;
  if (legacyCode === 40901) return 409;
  if (legacyCode >= 50000) return 500;
  return 400;
}

function toPublicError(errorOrCode, message, requestOrResponse, options = {}) {
  const error = typeof errorOrCode === 'object' && errorOrCode !== null ? errorOrCode : null;
  let legacyCode = legacyCodeFor(error || errorOrCode);
  const rawMessage = error ? error.message : message;
  const internal = looksInternal(error?.code ?? errorOrCode, rawMessage);
  if (internal) legacyCode = 50001;

  const explicitlyPublic = error?.expose === true || Number.isInteger(error?.code) || Number.isInteger(errorOrCode);
  const safeMessage = internal || (!explicitlyPublic && legacyCode >= 50000)
    ? PUBLIC_MESSAGE_BY_CODE[legacyCode] || PUBLIC_MESSAGE_BY_CODE[50001]
    : String(rawMessage || PUBLIC_MESSAGE_BY_CODE[legacyCode] || '请求失败');
  const code = internal
    ? 'INTERNAL_ERROR'
    : String(error?.publicCode || options.publicCode || PUBLIC_CODE_BY_LEGACY_CODE[legacyCode] || 'REQUEST_FAILED');
  const retryable = error?.retryable === true || options.retryable === true || legacyCode >= 50000;
  let details = null;
  if (!internal && (error?.expose === true || options.exposeDetails === true) && (error?.details || options.details)) {
    try {
      const redacted = require('../services/admin-secret.service').redact(error?.details || options.details);
      const encoded = JSON.stringify(redacted);
      details = encoded.length <= 5000 ? redacted : { truncated: true, summary: encoded.slice(0, 4800) };
    } catch {
      details = { unavailable: true };
    }
  }

  return {
    httpStatus: httpStatusFor(legacyCode, error?.status || options.status),
    legacyCode,
    payload: {
      code,
      message: safeMessage,
      retryable,
      requestId: requestIdOf(requestOrResponse),
      ...(details ? { details } : {}),
    },
  };
}

function sseError(error, request, fallback = 'AI 服务暂时不可用，请稍后重试') {
  const publicError = toPublicError(error, null, request);
  if (publicError.payload.code === 'INTERNAL_ERROR') publicError.payload.message = fallback;
  return publicError.payload;
}

module.exports = { toPublicError, sseError, requestIdOf, looksInternal };
