const prisma = require('../config/prisma');
const { redact } = require('./admin-secret.service');

function safeSummary(value) {
  if (value == null) return null;
  const clean = redact(value);
  const serialized = JSON.stringify(clean);
  return serialized.length <= 12000 ? clean : { truncated: true, size: serialized.length };
}

function buildAdminOperationData({ req, operationType, targetType, targetId, before, after, success = true, failureReason }) {
  return {
    user_id: req?.user?.user_id ? Number(req.user.user_id) : null,
    role: req?.user?.role ? String(req.user.role).toUpperCase() : null,
    operation_type: String(operationType).slice(0, 100),
    operation_desc: `${success ? '成功' : '失败'}执行 ${operationType}`,
    target_type: targetType ? String(targetType).slice(0, 50) : null,
    target_id: Number.isInteger(Number(targetId)) ? Number(targetId) : null,
    ip_address: String(req?.ip || req?.socket?.remoteAddress || '').slice(0, 50) || null,
    request_id: String(req?.id || '').slice(0, 100) || null,
    action_status: success ? 'success' : 'failed',
    before_summary_json: safeSummary(before),
    after_summary_json: safeSummary(after),
    failure_reason: success ? null : String(redact(String(failureReason || 'unknown'))).slice(0, 500),
  };
}

async function recordAdminOperation(input) {
  try {
    return await prisma.operationLog.create({
      data: buildAdminOperationData(input),
    });
  } catch (error) {
    console.error('[admin-audit] failed to persist audit metadata:', error.message);
    return null;
  }
}

module.exports = { recordAdminOperation, buildAdminOperationData, safeSummary };
