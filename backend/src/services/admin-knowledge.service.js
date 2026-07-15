// 管理员端知识库管理服务
// 提供知识库文档列表查看、审核管理等功能

const prisma = require('../config/prisma');
const { buildAdminOperationData } = require('./admin-audit.service');

function publicError(message, code = 40001) {
  return Object.assign(new Error(message), { code });
}

/**
 * 获取知识库文档列表（分页 + 筛选）
 */
async function getDocumentList(query = {}, prismaClient = prisma) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  // The management list represents live knowledge resources. Soft-deleted
  // documents remain in the database for audit/history, but must not reappear
  // in pagination totals or review queues.
  const where = { deleted_at: null };

  if (query.scope_type) {
    const scopeMap = { platform: 'PLATFORM', course: 'COURSE', class: 'CLASS', personal: 'PERSONAL' };
    const ps = scopeMap[query.scope_type];
    if (ps) where.scope_type = ps;
  }

  if (query.course_id) {
    const courseId = parseInt(query.course_id, 10);
    if (Number.isInteger(courseId) && courseId > 0) where.course_id = courseId;
  }

  if (query.parse_status) {
    const psMap = {
      uploaded: 'UPLOADED', parsing: 'PARSING', parsed: 'PARSED',
      chunking: 'CHUNKING', chunked: 'CHUNKED',
      embedding: 'EMBEDDING', embedded: 'EMBEDDED', failed: 'FAILED',
    };
    const ps = psMap[query.parse_status];
    if (ps) where.parse_status = ps;
  }

  if (query.review_status) {
    const rsMap = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };
    const rs = rsMap[query.review_status];
    if (rs) where.review_status = rs;
  }

  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    if (keyword) where.OR = [
      { title: { contains: keyword } },
      { original_filename: { contains: keyword } },
    ];
  }

  const [documents, total] = await Promise.all([
    prismaClient.knowledgeDocument.findMany({
      where,
      include: {
        owner: { include: { profile: true } },
        course: { select: { course_name: true } },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prismaClient.knowledgeDocument.count({ where }),
  ]);

  const scopeTypeLabels = {
    PLATFORM: 'platform', COURSE: 'course', CLASS: 'class', PERSONAL: 'personal',
  };

  const parseStatusLabels = {
    UPLOADED: 'uploaded', PARSING: 'parsing', PARSED: 'parsed',
    CHUNKING: 'chunking', CHUNKED: 'chunked',
    EMBEDDING: 'embedding', EMBEDDED: 'embedded', FAILED: 'failed',
  };

  const reviewStatusLabels = {
    PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected',
  };

  const list = documents.map((doc) => ({
    document_id: doc.document_id,
    title: doc.title,
    original_filename: doc.original_filename,
    file_ext: doc.file_ext,
    file_size_bytes: doc.file_size_bytes,
    mime_type: doc.mime_type,
    scope_type: scopeTypeLabels[doc.scope_type] || doc.scope_type,
    course_id: doc.course_id,
    course_name: doc.course?.course_name || null,
    owner_user_id: doc.owner_user_id,
    owner_name: doc.owner?.profile?.real_name || doc.owner?.username || null,
    parse_status: parseStatusLabels[doc.parse_status] || doc.parse_status,
    review_status: reviewStatusLabels[doc.review_status] || doc.review_status,
    created_at: doc.created_at,
  }));

  return { list, total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * 审核知识库文档
 */
async function reviewDocument(documentId, reviewStatus, reviewComment, reviewerOrRequest, prismaClient = prisma) {
  const targetId = Number(documentId);
  if (!Number.isInteger(targetId) || targetId < 1) throw publicError('文档 ID 不合法');
  const statusMap = { approved: 'APPROVED', rejected: 'REJECTED' };
  const prismaStatus = statusMap[reviewStatus];
  if (!prismaStatus) throw publicError('无效的审核状态');
  const req = reviewerOrRequest && typeof reviewerOrRequest === 'object'
    ? reviewerOrRequest
    : { user: { user_id: Number(reviewerOrRequest), role: 'ADMIN' } };
  const reviewerUserId = Number(req?.user?.user_id);
  if (!Number.isInteger(reviewerUserId) || reviewerUserId < 1) throw publicError('审核人身份不合法');
  const comment = reviewComment == null ? null : String(reviewComment).trim();
  if (comment && comment.length > 1000) throw publicError('审核意见不能超过 1000 个字符');
  if (reviewStatus === 'rejected' && !comment) throw publicError('驳回必须填写审核意见');

  const execute = async (tx) => {
    const doc = await tx.knowledgeDocument.findFirst({
      where: { document_id: targetId, deleted_at: null },
    });
    if (!doc) throw publicError('文档不存在', 40002);
    if (doc.review_status !== 'PENDING') throw publicError('文档已经审核，请刷新后重试', 40901);

    const updatedCount = await tx.knowledgeDocument.updateMany({
      where: { document_id: targetId, deleted_at: null, review_status: 'PENDING' },
      data: { review_status: prismaStatus, reviewer_user_id: reviewerUserId, review_comment: comment },
    });
    if (updatedCount.count !== 1) throw publicError('审核状态已发生变化，请刷新后重试', 40901);
    await tx.knowledgeDocumentReview.create({
      data: { document_id: targetId, reviewer_user_id: reviewerUserId, review_status: prismaStatus, review_comment: comment },
    });
    if (tx.operationLog) {
      await tx.operationLog.create({ data: buildAdminOperationData({
        req,
        operationType: prismaStatus === 'APPROVED' ? 'APPROVE_KNOWLEDGE_DOCUMENT' : 'REJECT_KNOWLEDGE_DOCUMENT',
        targetType: 'knowledge_document',
        targetId,
        before: { review_status: doc.review_status, reviewer_user_id: doc.reviewer_user_id, review_comment: doc.review_comment },
        after: { review_status: prismaStatus, reviewer_user_id: reviewerUserId, review_comment: comment },
      }) });
    }
    return { document_id: targetId, review_status: reviewStatus, review_comment: comment };
  };

  return typeof prismaClient.$transaction === 'function'
    ? prismaClient.$transaction(execute)
    : execute(prismaClient);
}

module.exports = { getDocumentList, reviewDocument };
