const { randomUUID } = require('crypto');
const { createAgentError } = require('../common/agent.errors');

const MODES = Object.freeze(['mental_model', 'strategy_intervention', 'growth_report']);
const MODE_SET = new Set(MODES);
const MAX_REQUEST_ID_LENGTH = 128;

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

function normalizeRequestId(value, mode) {
  if (value == null || value === '') return `diagnostician_${mode}_${randomUUID()}`;
  if (typeof value !== 'string') {
    throw createAgentError('INVALID_INPUT', 'requestId 必须是字符串', 400);
  }
  const requestId = value.trim();
  if (!requestId || requestId.length > MAX_REQUEST_ID_LENGTH) {
    throw createAgentError('INVALID_INPUT', `requestId 不能为空且不能超过 ${MAX_REQUEST_ID_LENGTH} 个字符`, 400);
  }
  return requestId;
}

function normalizeLocale(value) {
  if (value == null || value === '') return 'zh-CN';
  if (typeof value !== 'string') throw createAgentError('INVALID_INPUT', 'locale 必须是字符串', 400);
  const locale = value.trim();
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(locale)) {
    throw createAgentError('INVALID_INPUT', 'locale 不合法', 400);
  }
  return locale;
}

function normalizeReportPeriod(value) {
  if (value == null) return null;
  if (!isPlainObject(value)) {
    throw createAgentError('INVALID_INPUT', 'reportPeriod 必须是 JSON 对象', 400);
  }
  const from = value.from || value.start || value.startDate;
  const to = value.to || value.end || value.endDate;
  if (!from || !to) {
    throw createAgentError('INVALID_INPUT', 'reportPeriod.from 和 reportPeriod.to 不能为空', 400);
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    throw createAgentError('INVALID_INPUT', 'reportPeriod 时间范围不合法', 400);
  }
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    fromDate,
    toDate,
  };
}

function validateDiagnosticianAnalyzeBody(body = {}) {
  if (!isPlainObject(body)) {
    throw createAgentError('INVALID_INPUT', '请求体必须是 JSON 对象', 400);
  }
  const mode = String(body.mode || '').trim();
  if (!MODE_SET.has(mode)) {
    throw createAgentError('INVALID_MODE', 'mode 不合法', 400, { allowed_modes: MODES });
  }

  const reportPeriod = normalizeReportPeriod(body.reportPeriod || body.report_period);
  const knowledgePointId = parsePositiveInt(
    body.knowledgePointId ?? body.knowledge_point_id,
    'knowledgePointId',
    mode !== 'growth_report',
  );

  if (mode === 'growth_report' && !reportPeriod) {
    throw createAgentError('INVALID_INPUT', 'growth_report 需要 reportPeriod', 400);
  }

  return {
    mode,
    knowledgePointId,
    sessionId: parsePositiveInt(body.sessionId ?? body.session_id, 'sessionId', false),
    reportPeriod,
    anomalyFlag: String(body.anomalyFlag ?? body.anomaly_flag ?? '').trim(),
    locale: normalizeLocale(body.locale),
    debug: body.debug === true,
    requestId: normalizeRequestId(body.requestId ?? body.request_id, mode),
    requestedStudentId: parsePositiveInt(body.studentId ?? body.student_id, 'studentId', false),
  };
}

module.exports = {
  MODES,
  isPlainObject,
  validateDiagnosticianAnalyzeBody,
};
