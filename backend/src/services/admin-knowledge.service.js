// 管理员端知识库管理服务
// 提供知识库文档列表查看、审核管理等功能

const prisma = require('../config/prisma');

/**
 * 获取知识库文档列表（分页 + 筛选）
 */
async function getDocumentList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const where = {};

  if (query.scope_type) {
    const scopeMap = { platform: 'PLATFORM', course: 'COURSE', class: 'CLASS', personal: 'PERSONAL' };
    const ps = scopeMap[query.scope_type];
    if (ps) where.scope_type = ps;
  }

  if (query.course_id) {
    where.course_id = parseInt(query.course_id, 10);
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
    where.title = { contains: String(query.keyword).trim() };
  }

  const [documents, total] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where,
      include: {
        owner: { include: { profile: true } },
        course: { select: { course_name: true } },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.knowledgeDocument.count({ where }),
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

  return { list, total, page, page_size: pageSize };
}

/**
 * 审核知识库文档
 */
async function reviewDocument(documentId, reviewStatus, reviewComment, reviewerUserId) {
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { document_id: documentId },
  });
  if (!doc) {
    throw Object.assign(new Error('文档不存在'), { code: 40002 });
  }

  const statusMap = { approved: 'APPROVED', rejected: 'REJECTED' };
  const prismaStatus = statusMap[reviewStatus];
  if (!prismaStatus) {
    throw Object.assign(new Error('无效的审核状态'), { code: 40001 });
  }

  const updated = await prisma.knowledgeDocument.update({
    where: { document_id: documentId },
    data: {
      review_status: prismaStatus,
      reviewer_user_id: reviewerUserId,
      review_comment: reviewComment || null,
    },
  });

  // 记录审核操作到 knowledge_document_reviews
  await prisma.knowledgeDocumentReview.create({
    data: {
      document_id: documentId,
      reviewer_user_id: reviewerUserId,
      review_status: prismaStatus,
      review_comment: reviewComment || null,
    },
  });

  return {
    document_id: updated.document_id,
    review_status: reviewStatus,
    review_comment: reviewComment || null,
  };
}

module.exports = { getDocumentList, reviewDocument };
