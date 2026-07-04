// 管理员端操作日志服务
// 提供操作日志的查询和筛选功能

const prisma = require('../config/prisma');
const { fromPrismaRole } = require('../utils/enum');

/**
 * 获取操作日志列表（分页 + 筛选）
 */
async function getOperationLogs(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const where = {};

  if (query.operation_type) {
    where.operation_type = String(query.operation_type);
  }

  if (query.user_id) {
    where.user_id = parseInt(query.user_id, 10);
  }

  if (query.target_type) {
    where.target_type = String(query.target_type);
  }

  if (query.start_date || query.end_date) {
    where.created_at = {};
    if (query.start_date) {
      where.created_at.gte = new Date(query.start_date);
    }
    if (query.end_date) {
      where.created_at.lte = new Date(query.end_date);
    }
  }

  const [logs, total] = await Promise.all([
    prisma.operationLog.findMany({
      where,
      include: {
        user: { include: { profile: true } },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.operationLog.count({ where }),
  ]);

  const list = logs.map((log) => ({
    operation_log_id: log.operation_log_id,
    user_id: log.user_id,
    username: log.user?.username || null,
    real_name: log.user?.profile?.real_name || null,
    role: log.role ? fromPrismaRole(log.role) : null,
    operation_type: log.operation_type,
    operation_desc: log.operation_desc,
    target_type: log.target_type,
    target_id: log.target_id,
    ip_address: log.ip_address,
    created_at: log.created_at,
  }));

  return { list, total, page, page_size: pageSize };
}

module.exports = { getOperationLogs };
