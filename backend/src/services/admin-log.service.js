// 管理员端操作日志服务
// 提供操作日志的查询和筛选功能

const prisma = require('../config/prisma');
const { fromPrismaRole } = require('../utils/enum');

function inputError(message) {
  return Object.assign(new Error(message), { code: 40001, status: 400 });
}

function parseDate(value, label) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw inputError(`${label}格式不合法`);
  return parsed;
}

/**
 * 获取操作日志列表（分页 + 筛选）
 */
async function getOperationLogs(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const where = { AND: [] };

  const keyword = String(query.keyword || '').trim();
  if (keyword) {
    if (keyword.length > 100) throw inputError('搜索关键词不能超过 100 个字符');
    where.AND.push({ OR: [
      { operation_type: { contains: keyword } },
      { operation_desc: { contains: keyword } },
      { target_type: { contains: keyword } },
      { user: { is: { OR: [
        { username: { contains: keyword } },
        { profile: { real_name: { contains: keyword } } },
      ] } } },
    ] });
  }

  if (query.operation_type) {
    where.operation_type = String(query.operation_type);
  }

  if (query.user_id) {
    const userId = Number(query.user_id);
    if (!Number.isInteger(userId) || userId <= 0) throw inputError('用户 ID 不合法');
    where.user_id = userId;
  }

  if (query.target_type) {
    where.target_type = String(query.target_type);
  }

  if (query.start_date || query.end_date) {
    where.created_at = {};
    const start = parseDate(query.start_date, '开始日期');
    const end = parseDate(query.end_date, '结束日期');
    const endIsDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(query.end_date || ''));
    if (start) where.created_at.gte = start;
    if (end) {
      if (endIsDateOnly) {
        end.setUTCDate(end.getUTCDate() + 1);
        where.created_at.lt = end;
      } else {
        where.created_at.lte = end;
      }
    }
    if (start && end && start >= end) throw inputError('开始日期必须早于结束日期');
  }

  if (where.AND.length === 0) delete where.AND;

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

  return { list, total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { getOperationLogs };
