// 教师端知识库管理服务

const prisma = require('../config/prisma');
const path = require('path');

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

async function getAccessibleCourseIds(user) {
  if (user.role === 'admin') return null;
  const relations = await prisma.courseTeacherRelation.findMany({
    where: { teacher_user_id: user.user_id },
    select: { course_id: true },
  });
  return relations.map((item) => item.course_id);
}

// ---------- 文档列表 ----------

async function listDocuments(user, query) {
  const courseIds = await getAccessibleCourseIds(user);
  const where = {};
  if (courseIds) where.course_id = { in: courseIds };

  if (query.course_id) where.course_id = Number.parseInt(query.course_id, 10);
  if (query.scope_type) where.scope_type = query.scope_type.toUpperCase();
  if (query.parse_status) where.parse_status = query.parse_status.toUpperCase();
  if (query.review_status) where.review_status = query.review_status.toUpperCase();
  if (query.keyword) where.title = { contains: query.keyword };

  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size || query.pageSize, 10) || 20));
  const skip = (page - 1) * pageSize;

  const [documents, total] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
      include: {
        course: { select: { course_name: true } },
        owner: { include: { profile: true } },
      },
    }),
    prisma.knowledgeDocument.count({ where }),
  ]);

  return {
    list: documents.map((d) => ({
      document_id: d.document_id,
      title: d.title,
      original_filename: d.original_filename,
      file_ext: d.file_ext,
      file_size_bytes: d.file_size_bytes,
      scope_type: toLower(d.scope_type),
      visibility: toLower(d.visibility),
      course_id: d.course_id,
      course_name: d.course?.course_name || null,
      parse_status: toLower(d.parse_status),
      review_status: toLower(d.review_status),
      owner_name: d.owner?.profile?.real_name || d.owner?.username || null,
      created_at: d.created_at.toISOString(),
    })),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 文档详情 ----------

async function getDocument(user, documentId) {
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { document_id: documentId },
    include: {
      course: true,
      owner: { include: { profile: true } },
      reviewer: { include: { profile: true } },
      reviews: {
        include: { reviewer: { include: { profile: true } } },
        orderBy: { created_at: 'desc' },
      },
    },
  });

  if (!doc) throw Object.assign(new Error('文档不存在'), { code: 40002 });

  return {
    document_id: doc.document_id,
    title: doc.title,
    original_filename: doc.original_filename,
    file_ext: doc.file_ext,
    file_size_bytes: doc.file_size_bytes,
    mime_type: doc.mime_type,
    file_url: doc.file_url,
    scope_type: toLower(doc.scope_type),
    visibility: toLower(doc.visibility),
    course_id: doc.course_id,
    course_name: doc.course?.course_name || null,
    parse_status: toLower(doc.parse_status),
    review_status: toLower(doc.review_status),
    owner: {
      user_id: doc.owner_user_id,
      name: doc.owner?.profile?.real_name || doc.owner?.username || null,
    },
    reviewer: doc.reviewer ? {
      user_id: doc.reviewer_user_id,
      name: doc.reviewer?.profile?.real_name || doc.reviewer?.username || null,
    } : null,
    review_comment: doc.review_comment,
    reviews: doc.reviews.map((r) => ({
      review_id: r.review_id,
      review_status: toLower(r.review_status),
      review_comment: r.review_comment,
      reviewer_name: r.reviewer?.profile?.real_name || r.reviewer?.username || null,
      created_at: r.created_at.toISOString(),
    })),
    created_at: doc.created_at.toISOString(),
  };
}

// ---------- 审核文档 ----------

async function reviewDocument(user, documentId, body) {
  const { review_status, review_comment } = body;
  if (!review_status || !['approved', 'rejected'].includes(review_status)) {
    throw Object.assign(new Error('review_status 必须为 approved 或 rejected'), { code: 40001 });
  }

  const doc = await prisma.knowledgeDocument.findUnique({ where: { document_id: documentId } });
  if (!doc) throw Object.assign(new Error('文档不存在'), { code: 40002 });

  const updated = await prisma.knowledgeDocument.update({
    where: { document_id: documentId },
    data: {
      review_status: review_status === 'approved' ? 'APPROVED' : 'REJECTED',
      reviewer_user_id: user.user_id,
      review_comment: review_comment || null,
    },
  });

  // 记录审核历史
  await prisma.knowledgeDocumentReview.create({
    data: {
      document_id: documentId,
      reviewer_user_id: user.user_id,
      review_status: review_status === 'approved' ? 'APPROVED' : 'REJECTED',
      review_comment: review_comment || null,
    },
  });

  return {
    document_id: updated.document_id,
    review_status: toLower(updated.review_status),
    review_comment: updated.review_comment,
  };
}

// ---------- 上传文档 ----------

async function uploadDocument(user, fileInfo, body) {
  const { originalname, filename: storedFilename, path: filePath, size: fileSize, mimetype } = fileInfo;
  const fileExt = path.extname(originalname || '').toLowerCase();
  const courseId = body.course_id ? parseInt(body.course_id, 10) : null;
  const teachingClassId = body.teaching_class_id ? parseInt(body.teaching_class_id, 10) : null;
  const title = body.title || originalname;
  const scopeType = body.scope_type || 'course'; // course / class / personal
  const visibility = body.visibility || 'class';

  const validScopeTypes = ['course', 'class', 'personal'];
  if (!validScopeTypes.includes(scopeType)) {
    throw Object.assign(new Error('scope_type 不合法，可选 course / class / personal'), { code: 40001 });
  }

  const validVisibilities = ['private', 'class', 'college'];
  if (!validVisibilities.includes(visibility)) {
    throw Object.assign(new Error('visibility 不合法，可选 private / class / college'), { code: 40001 });
  }

  if (courseId) {
    const course = await prisma.course.findUnique({ where: { course_id: courseId } });
    if (!course) throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  // 确保知识库存在
  let kbWhere = { scope_type: scopeType.toUpperCase() };
  if (scopeType === 'course' && courseId) {
    kbWhere.course_id = courseId;
  } else if (scopeType === 'personal') {
    kbWhere.owner_user_id = user.user_id;
  }

  let knowledgeBase = await prisma.knowledgeBase.findFirst({ where: kbWhere });
  if (!knowledgeBase) {
    knowledgeBase = await prisma.knowledgeBase.create({
      data: {
        name: title,
        scope_type: scopeType.toUpperCase(),
        course_id: scopeType === 'course' ? courseId : null,
        teaching_class_id: teachingClassId || null,
        owner_user_id: user.user_id,
        description: body.description || null,
      },
    });
  }

  const doc = await prisma.knowledgeDocument.create({
    data: {
      knowledge_base_id: knowledgeBase.knowledge_base_id,
      title,
      original_filename: originalname,
      file_ext: fileExt.replace('.', ''),
      file_size_bytes: fileSize,
      mime_type: mimetype,
      storage_type: 'LOCAL',
      file_url: '/uploads/documents/' + storedFilename,
      scope_type: scopeType.toUpperCase(),
      visibility: visibility.toUpperCase(),
      course_id: courseId || null,
      teaching_class_id: teachingClassId || null,
      owner_user_id: user.user_id,
      parse_status: 'UPLOADED',
      review_status: 'PENDING',
    },
  });

  return {
    document_id: doc.document_id,
    title: doc.title,
    original_filename: doc.original_filename,
    file_url: doc.file_url,
    parse_status: toLower(doc.parse_status),
    review_status: toLower(doc.review_status),
  };
}

module.exports = {
  listDocuments,
  getDocument,
  reviewDocument,
  uploadDocument,
};
