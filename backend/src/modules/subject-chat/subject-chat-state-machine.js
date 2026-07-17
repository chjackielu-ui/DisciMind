const RUN_STATUSES = Object.freeze([
  'queued',
  'planning',
  'running',
  'waiting_tool',
  'waiting_agent',
  'generating',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
  'stalled',
]);

const TASK_STATUSES = Object.freeze([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'cancelled',
  'retrying',
]);

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'stalled']);
const ACTIVE_RUN_STATUSES = new Set(RUN_STATUSES.filter((status) => !TERMINAL_RUN_STATUSES.has(status)));
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'skipped', 'cancelled']);

const LEGACY_RUN_STATUS = Object.freeze({ pending: 'queued', success: 'completed' });
const LEGACY_TASK_STATUS = Object.freeze({ success: 'completed' });

function normalizeRunStatus(status) {
  return LEGACY_RUN_STATUS[status] || status || 'queued';
}

function normalizeTaskStatus(status) {
  return LEGACY_TASK_STATUS[status] || status || 'pending';
}

function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(normalizeRunStatus(status));
}

function isActiveRunStatus(status) {
  return ACTIVE_RUN_STATUSES.has(normalizeRunStatus(status));
}

function assertRunStatus(status) {
  const normalized = normalizeRunStatus(status);
  if (!RUN_STATUSES.includes(normalized)) {
    const error = new Error(`不支持的运行状态：${status}`);
    error.code = 'INVALID_RUN_STATUS';
    throw error;
  }
  return normalized;
}

function assertTaskStatus(status) {
  const normalized = normalizeTaskStatus(status);
  if (!TASK_STATUSES.includes(normalized)) {
    const error = new Error(`不支持的步骤状态：${status}`);
    error.code = 'INVALID_TASK_STATUS';
    throw error;
  }
  return normalized;
}

function assertRunTransition(fromStatus, toStatus) {
  const from = assertRunStatus(fromStatus);
  const to = assertRunStatus(toStatus);
  if (from === to) return to;
  if (TERMINAL_RUN_STATUSES.has(from)) {
    const error = new Error(`运行已处于终态 ${from}，不能迁移到 ${to}`);
    error.code = 'TERMINAL_RUN_TRANSITION';
    throw error;
  }
  return to;
}

module.exports = {
  RUN_STATUSES,
  TASK_STATUSES,
  TERMINAL_RUN_STATUSES,
  ACTIVE_RUN_STATUSES,
  TERMINAL_TASK_STATUSES,
  normalizeRunStatus,
  normalizeTaskStatus,
  isTerminalRunStatus,
  isActiveRunStatus,
  assertRunStatus,
  assertTaskStatus,
  assertRunTransition,
};
