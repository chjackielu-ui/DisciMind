// 教师端知识库管理服务

const prisma = require('../config/prisma');
const path = require('path');
const crypto = require('crypto');
const {
  getAccessibleCourseIds,
  getAccessibleTeachingClassIds,
  ensureCourseAccess,
  ensureTeachingClassAccess,
  ensureDocumentAccess,
  ensureStudentAccess,
  isAdmin,
} = require('./teacher-access.service');

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

// ---------- 文档列表 ----------

async function listDocuments(user, query) {
  const courseIds = await getAccessibleCourseIds(user);
  const classIds = await getAccessibleTeachingClassIds(user);
  const where = { deleted_at: null };
  if (!isAdmin(user)) {
    where.OR = [
      { owner_user_id: user.user_id },
      { course_id: { in: courseIds || [] } },
      { teaching_class_id: { in: classIds } },
    ];
  }

  if (query.course_id) {
    await ensureCourseAccess(user, Number(query.course_id));
    where.course_id = Number.parseInt(query.course_id, 10);
  }
  if (query.teaching_class_id) {
    await ensureTeachingClassAccess(user, Number(query.teaching_class_id));
    where.teaching_class_id = Number(query.teaching_class_id);
  }
  if (query.scope_type) where.scope_type = query.scope_type.toUpperCase();
  if (query.parse_status) where.parse_status = query.parse_status.toUpperCase();
  if (query.review_status) where.review_status = query.review_status.toUpperCase();
  if (query.keyword) where.title = { contains: query.keyword };
  if (query.resource_only === 'true' || query.resource_only === true) where.is_teaching_resource = true;
  if (query.resource_kind) where.resource_kind = query.resource_kind;
  if (query.folder_path) where.folder_path = query.folder_path;
  if (query.favorite === 'true' || query.favorite === true) where.is_favorite = true;

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
        teaching_class: { select: { teaching_class_name: true } },
        lesson_plan: { select: { lesson_plan_id: true, topic: true } },
        distributions: {
          orderBy: { created_at: 'desc' },
          take: 20,
          include: { recipients: { select: { read_at: true, downloaded_at: true, completed_at: true, status: true } } },
        },
      },
    }),
    prisma.knowledgeDocument.count({ where }),
  ]);

  return {
    list: documents.map((d) => {
      const recipients = d.distributions.flatMap((distribution) => distribution.recipients);
      return ({
      document_id: d.document_id,
      title: d.title,
      original_filename: d.original_filename,
      file_ext: d.file_ext,
      mime_type: d.mime_type,
      file_size_bytes: d.file_size_bytes,
      scope_type: toLower(d.scope_type),
      visibility: toLower(d.visibility),
      course_id: d.course_id,
      course_name: d.course?.course_name || null,
      parse_status: toLower(d.parse_status),
      review_status: toLower(d.review_status),
      owner_name: d.owner?.profile?.real_name || d.owner?.username || null,
      teaching_class_id: d.teaching_class_id,
      teaching_class_name: d.teaching_class?.teaching_class_name || null,
      lesson_plan_id: d.lesson_plan_id,
      lesson_plan_topic: d.lesson_plan?.topic || null,
      is_teaching_resource: d.is_teaching_resource,
      resource_kind: d.resource_kind,
      resource_category: d.resource_category,
      resource_group_id: d.resource_group_id,
      resource_version: d.resource_version,
      version_source: d.version_source,
      folder_path: d.folder_path,
      tags: Array.isArray(d.tags_json) ? d.tags_json : [],
      is_favorite: d.is_favorite,
      resource_status: toLower(d.resource_status),
      source_artifact_id: d.source_artifact_id,
      processing_state: d.processing_state,
      error_code: d.error_code,
      retryable: d.retryable,
      conversion: d.metadata_json?.conversion ? {
        source_resource_id: d.metadata_json.conversion.sourceResourceId || d.document_id,
        output_resource_id: d.metadata_json.conversion.outputResourceId || null,
        task_id: d.metadata_json.conversion.taskId || null,
        status: d.metadata_json.conversion.status || d.processing_state,
        error_code: d.metadata_json.conversion.errorCode || d.error_code || null,
        error_message: d.metadata_json.conversion.errorMessage || d.error_message || null,
        retry_count: Number(d.metadata_json.conversion.retryCount || 0),
      } : null,
      last_used_at: d.last_used_at?.toISOString() || null,
      distribution_count: d.distributions.length,
      recipient_count: recipients.length,
      read_count: recipients.filter((item) => item.read_at).length,
      download_count: recipients.filter((item) => item.downloaded_at).length,
      completed_count: recipients.filter((item) => item.completed_at).length,
      external_url: d.external_url,
      created_at: d.created_at.toISOString(),
    }); }),
    total,
    page,
    page_size: pageSize,
  };
}

// ---------- 文档详情 ----------

async function getDocument(user, documentId) {
  await ensureDocumentAccess(user, documentId, { allowReview: true });
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

  if (!doc || doc.deleted_at) throw Object.assign(new Error('文档不存在'), { code: 40002 });

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

  const doc = await ensureDocumentAccess(user, documentId, { allowReview: true });

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
    await ensureCourseAccess(user, courseId);
  }
  if (teachingClassId) {
    const teachingClass = await ensureTeachingClassAccess(user, teachingClassId);
    if (courseId && teachingClass.course_id !== courseId) throw Object.assign(new Error('教学班不属于所选课程'), { code: 40001 });
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
      lesson_plan_id: body.lesson_plan_id ? Number(body.lesson_plan_id) : null,
      is_teaching_resource: body.is_teaching_resource === 'true' || body.is_teaching_resource === true,
      resource_kind: body.resource_kind || fileExt.replace('.', '') || 'file',
      resource_category: body.resource_category || null,
      metadata_json: body.metadata_json ? (typeof body.metadata_json === 'string' ? JSON.parse(body.metadata_json) : body.metadata_json) : undefined,
      resource_group_id: crypto.randomUUID(),
      resource_version: 1,
      version_source: body.version_source || 'LOCAL_IMPORT',
      folder_path: body.folder_path || null,
      tags_json: body.tags ? (typeof body.tags === 'string' ? body.tags.split(',').map((item) => item.trim()).filter(Boolean) : body.tags) : undefined,
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

async function createExternalResource(user, body) {
  const { title, external_url } = body;
  if (!title || !external_url) throw Object.assign(new Error('title、external_url 为必填项'), { code: 40001 });
  let parsed;
  try {
    parsed = new URL(external_url);
  } catch {
    throw Object.assign(new Error('external_url 不合法'), { code: 40001 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw Object.assign(new Error('仅支持 HTTP/HTTPS 链接'), { code: 40001 });
  const courseId = body.course_id ? Number(body.course_id) : null;
  const classId = body.teaching_class_id ? Number(body.teaching_class_id) : null;
  if (courseId) await ensureCourseAccess(user, courseId);
  if (classId) await ensureTeachingClassAccess(user, classId);
  const doc = await prisma.knowledgeDocument.create({
    data: {
      title,
      original_filename: title,
      file_ext: 'link',
      mime_type: 'text/uri-list',
      storage_type: 'LOCAL',
      file_url: external_url,
      external_url,
      scope_type: classId ? 'CLASS' : courseId ? 'COURSE' : 'PERSONAL',
      visibility: body.visibility ? body.visibility.toUpperCase() : 'PRIVATE',
      course_id: courseId,
      teaching_class_id: classId,
      lesson_plan_id: body.lesson_plan_id ? Number(body.lesson_plan_id) : null,
      owner_user_id: user.user_id,
      is_teaching_resource: true,
      resource_kind: body.resource_kind || 'video_link',
      resource_category: body.resource_category || null,
      metadata_json: body.metadata || undefined,
      resource_group_id: crypto.randomUUID(),
      resource_version: 1,
      version_source: 'LOCAL_IMPORT',
      folder_path: body.folder_path || null,
      tags_json: Array.isArray(body.tags) ? body.tags : undefined,
      parse_status: 'PARSED',
      review_status: 'APPROVED',
      marketplace_status: 'READY',
    },
  });
  return { document_id: doc.document_id, title: doc.title, external_url: doc.external_url };
}

async function updateResource(user, documentId, body) {
  const doc = await ensureDocumentAccess(user, documentId);
  if (!isAdmin(user) && doc.owner_user_id !== user.user_id) throw Object.assign(new Error('只有资源创建者可以编辑'), { code: 40301 });
  if (body.course_id) await ensureCourseAccess(user, Number(body.course_id));
  if (body.teaching_class_id) await ensureTeachingClassAccess(user, Number(body.teaching_class_id));
  const resourceGroupId = doc.resource_group_id || `resource-${doc.document_id}`;
  if (!doc.resource_group_id) await prisma.knowledgeDocument.update({ where: { document_id: documentId }, data: { resource_group_id: resourceGroupId } });
  const data = {};
  const fields = ['title', 'resource_kind', 'resource_category'];
  fields.forEach((field) => { if (body[field] !== undefined) data[field] = body[field]; });
  if (body.course_id !== undefined) data.course_id = body.course_id ? Number(body.course_id) : null;
  if (body.teaching_class_id !== undefined) data.teaching_class_id = body.teaching_class_id ? Number(body.teaching_class_id) : null;
  if (body.lesson_plan_id !== undefined) data.lesson_plan_id = body.lesson_plan_id ? Number(body.lesson_plan_id) : null;
  if (body.visibility !== undefined) data.visibility = body.visibility.toUpperCase();
  if (body.metadata !== undefined) data.metadata_json = body.metadata;
  if (body.folder_path !== undefined) data.folder_path = body.folder_path || null;
  if (body.tags !== undefined) data.tags_json = Array.isArray(body.tags) ? body.tags : [];
  if (body.is_favorite !== undefined) data.is_favorite = Boolean(body.is_favorite);
  if (body.resource_status !== undefined) {
    const resourceStatus = String(body.resource_status || '').toUpperCase();
    if (!['ACTIVE', 'ARCHIVED'].includes(resourceStatus)) throw Object.assign(new Error('资源状态不合法'), { code: 40001 });
    data.resource_status = resourceStatus;
  }
  const changesStudentVisibleContent = ['title', 'resource_kind', 'resource_category', 'course_id', 'teaching_class_id', 'lesson_plan_id', 'visibility', 'metadata']
    .some((field) => body[field] !== undefined);
  const publishedCount = changesStudentVisibleContent
    ? await prisma.resourceDistribution.count({ where: { resource_id: documentId, status: { not: 'CANCELLED' } } })
    : 0;
  if (publishedCount) {
    const latest = await prisma.knowledgeDocument.aggregate({ where: { resource_group_id: resourceGroupId }, _max: { resource_version: true } });
    const next = await prisma.knowledgeDocument.create({
      data: {
        knowledge_base_id: doc.knowledge_base_id,
        title: data.title ?? doc.title,
        original_filename: doc.original_filename,
        file_ext: doc.file_ext,
        file_size_bytes: doc.file_size_bytes,
        mime_type: doc.mime_type,
        storage_type: doc.storage_type,
        file_url: doc.file_url,
        scope_type: doc.scope_type,
        visibility: data.visibility ?? doc.visibility,
        course_id: data.course_id !== undefined ? data.course_id : doc.course_id,
        teaching_class_id: data.teaching_class_id !== undefined ? data.teaching_class_id : doc.teaching_class_id,
        lesson_plan_id: data.lesson_plan_id !== undefined ? data.lesson_plan_id : doc.lesson_plan_id,
        owner_user_id: doc.owner_user_id,
        is_teaching_resource: true,
        resource_kind: data.resource_kind ?? doc.resource_kind,
        resource_category: data.resource_category ?? doc.resource_category,
        external_url: doc.external_url,
        metadata_json: data.metadata_json !== undefined ? data.metadata_json : doc.metadata_json,
        resource_group_id: resourceGroupId,
        resource_version: (latest._max.resource_version || doc.resource_version || 1) + 1,
        version_source: 'TEACHER_EDIT',
        folder_path: data.folder_path !== undefined ? data.folder_path : doc.folder_path,
        tags_json: data.tags_json !== undefined ? data.tags_json : doc.tags_json,
        is_favorite: data.is_favorite !== undefined ? data.is_favorite : doc.is_favorite,
        parse_status: doc.parse_status,
        review_status: doc.review_status,
        marketplace_status: doc.marketplace_status,
        processing_state: doc.processing_state,
        cleaned_text: doc.cleaned_text,
        page_count: doc.page_count,
        chunk_size: doc.chunk_size,
        chunk_overlap: doc.chunk_overlap,
        separator_strategy: doc.separator_strategy,
      },
    });
    return { document_id: next.document_id, previous_document_id: documentId, title: next.title, resource_version: next.resource_version, version_created: true, student_update_required: true };
  }
  const updated = await prisma.knowledgeDocument.update({ where: { document_id: documentId }, data: { ...data, resource_group_id: resourceGroupId, version_source: body.version_source || doc.version_source } });
  return { document_id: updated.document_id, title: updated.title, resource_version: updated.resource_version, version_created: false };
}

async function deleteResource(user, documentId) {
  const doc = await ensureDocumentAccess(user, documentId);
  if (!isAdmin(user) && doc.owner_user_id !== user.user_id) throw Object.assign(new Error('只有资源创建者可以删除'), { code: 40301 });
  await prisma.knowledgeDocument.update({
    where: { document_id: documentId },
    data: { deleted_at: new Date(), marketplace_status: 'DELETED' },
  });
  return { deleted: true };
}

async function shareResource(user, documentId, body) {
  const doc = await ensureDocumentAccess(user, documentId);
  const classId = Number(body.teaching_class_id);
  if (!Number.isInteger(classId)) throw Object.assign(new Error('请选择教学班'), { code: 40001 });
  const teachingClass = await ensureTeachingClassAccess(user, classId);
  if (doc.course_id && doc.course_id !== teachingClass.course_id) throw Object.assign(new Error('资源课程与教学班课程不一致'), { code: 40001 });
  const validTypes = new Set(['course_material', 'pre_class_material', 'classroom_task', 'homework_attachment', 'exam_attachment', 'announcement']);
  const distributionType = String(body.distribution_type || 'course_material');
  if (!validTypes.has(distributionType)) throw Object.assign(new Error('资源下发类型不合法'), { code: 40001 });
  const publishAt = body.publish_at ? new Date(body.publish_at) : new Date();
  const dueAt = body.due_at ? new Date(body.due_at) : null;
  if (Number.isNaN(publishAt.getTime()) || (dueAt && Number.isNaN(dueAt.getTime()))) throw Object.assign(new Error('发布时间或截止时间不合法'), { code: 40001 });
  if (dueAt && dueAt <= publishAt) throw Object.assign(new Error('截止时间必须晚于发布时间'), { code: 40001 });
  const requestedStudentIds = [...new Set((Array.isArray(body.student_user_ids) ? body.student_user_ids : []).map(Number).filter(Number.isInteger))];
  let enrollments = await prisma.studentCourseEnrollment.findMany({
    where: { teaching_class_id: classId, enrollment_status: 'active' },
    select: { student_user_id: true },
  });
  if (requestedStudentIds.length) {
    const enrolledIds = new Set(enrollments.map((item) => item.student_user_id));
    if (!requestedStudentIds.every((id) => enrolledIds.has(id))) throw Object.assign(new Error('部分学生不属于所选教学班'), { code: 40301 });
    enrollments = enrollments.filter((item) => requestedStudentIds.includes(item.student_user_id));
  }
  if (!enrollments.length) throw Object.assign(new Error('下发范围内没有有效学生'), { code: 40002 });
  const resourceGroupId = doc.resource_group_id || `resource-${doc.document_id}`;
  const operationSeed = String(body.operation_id || crypto.randomUUID());
  const operationDigest = crypto.createHash('sha256').update(operationSeed).digest('hex').slice(0, 32);
  const operationId = `rd:${user.user_id}:${documentId}:${operationDigest}`;
  const existing = await prisma.resourceDistribution.findUnique({ where: { operation_id: operationId }, include: { recipients: true } });
  if (existing) return { distribution_id: existing.distribution_id, shared_count: existing.recipients.length, teaching_class_id: existing.teaching_class_id, idempotent: true };
  const immediate = publishAt <= new Date();
  const distribution = await prisma.$transaction(async (tx) => {
    await tx.knowledgeDocument.update({
      where: { document_id: documentId },
      data: { visibility: 'CLASS', course_id: teachingClass.course_id, is_teaching_resource: true, resource_group_id: resourceGroupId, last_used_at: new Date() },
    });
    const created = await tx.resourceDistribution.create({
      data: {
        resource_id: documentId,
        sender_user_id: user.user_id,
        course_id: teachingClass.course_id,
        teaching_class_id: classId,
        title: String(body.title || doc.title).slice(0, 200),
        description: body.description || body.message || null,
        distribution_type: distributionType,
        resource_version: doc.resource_version || 1,
        publish_at: publishAt,
        due_at: dueAt,
        status: immediate ? 'PUBLISHED' : 'SCHEDULED',
        operation_id: operationId,
      },
    });
    await tx.resourceRecipient.createMany({
      data: enrollments.map((item) => ({ distribution_id: created.distribution_id, student_user_id: item.student_user_id })),
      skipDuplicates: true,
    });
    if (immediate) {
      await tx.notification.createMany({
        data: enrollments.map((item) => ({
          receiver_user_id: item.student_user_id,
          sender_user_id: user.user_id,
          notification_type: 'RESOURCE_SHARED',
          title: `教学资源：${doc.title}`,
          content: body.message || `教师向班级分享了资源“${doc.title}”`,
          target_type: 'resource_distribution',
          target_id: created.distribution_id,
          business_type: 'resource_distribution',
          business_id: created.distribution_id,
          idempotency_key: `resource-distribution:${created.distribution_id}:student:${item.student_user_id}`,
        })),
        skipDuplicates: true,
      });
    }
    return created;
  });
  return {
    distribution_id: distribution.distribution_id,
    shared_count: enrollments.length,
    teaching_class_id: classId,
    resource_version: distribution.resource_version,
    status: distribution.status.toLowerCase(),
    publish_at: distribution.publish_at.toISOString(),
  };
}

async function getResourceDistributionStats(user, documentId) {
  await ensureDocumentAccess(user, documentId);
  const records = await prisma.resourceDistribution.findMany({
    where: { resource_id: documentId, sender_user_id: isAdmin(user) ? undefined : user.user_id },
    include: { teachingClass: { select: { teaching_class_name: true } }, recipients: true },
    orderBy: { created_at: 'desc' },
  });
  return {
    list: records.map((item) => ({
      distribution_id: item.distribution_id,
      teaching_class_id: item.teaching_class_id,
      teaching_class_name: item.teachingClass?.teaching_class_name || null,
      distribution_type: item.distribution_type,
      resource_version: item.resource_version,
      status: toLower(item.status),
      publish_at: item.publish_at.toISOString(),
      due_at: item.due_at?.toISOString() || null,
      recipient_count: item.recipients.length,
      read_count: item.recipients.filter((recipient) => recipient.read_at).length,
      download_count: item.recipients.filter((recipient) => recipient.downloaded_at).length,
      completed_count: item.recipients.filter((recipient) => recipient.completed_at).length,
    })),
  };
}

async function listKnowledgeBaseApplications(user, query = {}) {
  const courseIds = await getAccessibleCourseIds(user);
  const classIds = await getAccessibleTeachingClassIds(user);
  const where = {
    action: 'SUBMITTED',
    knowledgeBase: {
      deleted_at: null,
      marketplace_visibility: 'PUBLIC_PENDING',
      ...(!isAdmin(user) ? {
        OR: [
          { course_id: { in: courseIds || [] } },
          { teaching_class_id: { in: classIds } },
          { owner: { student_course_enrollments: { some: { teaching_class_id: { in: classIds }, enrollment_status: 'active' } } } },
        ],
      } : {}),
    },
  };
  if (query.course_id) where.knowledgeBase.course_id = Number(query.course_id);
  if (query.student_user_id) where.knowledgeBase.owner_user_id = Number(query.student_user_id);
  if (query.keyword) where.knowledgeBase.name = { contains: query.keyword };
  const records = await prisma.knowledgeBaseReviewRecord.findMany({
    where,
    include: {
      knowledgeBase: {
        include: {
          owner: { include: { profile: true } },
          course: true,
          documents: { where: { deleted_at: null } },
          agent_bindings: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return {
    list: records.map((record) => ({
      review_id: record.id,
      submitted_at: record.createdAt.toISOString(),
      application_reason: record.reason,
      applicant: {
        user_id: record.knowledgeBase.owner_user_id,
        name: record.knowledgeBase.owner?.profile?.real_name || record.knowledgeBase.owner?.username || null,
        student_no: record.knowledgeBase.owner?.profile?.student_no || null,
      },
      knowledge_base: {
        knowledge_base_id: record.knowledgeBase.knowledge_base_id,
        name: record.knowledgeBase.name,
        description: record.knowledgeBase.description,
        course_id: record.knowledgeBase.course_id,
        course_name: record.knowledgeBase.course?.course_name || null,
        document_count: record.knowledgeBase.documents.length,
        documents: record.knowledgeBase.documents.map((doc) => ({
          document_id: doc.document_id,
          name: doc.original_filename,
          mime_type: doc.mime_type,
          size_bytes: doc.file_size_bytes,
          status: doc.marketplace_status,
        })),
        agent_count: record.knowledgeBase.agent_bindings.length,
        sensitive_content_flag: false,
        created_at: record.knowledgeBase.created_at.toISOString(),
      },
    })),
    total: records.length,
  };
}

async function ensureKnowledgeBaseReviewAccess(user, reviewId) {
  const record = await prisma.knowledgeBaseReviewRecord.findUnique({
    where: { id: Number(reviewId) },
    include: { knowledgeBase: true },
  });
  if (!record) throw Object.assign(new Error('知识库审核申请不存在'), { code: 40002 });
  const kb = record.knowledgeBase;
  if (!isAdmin(user)) {
    if (kb.teaching_class_id) await ensureTeachingClassAccess(user, kb.teaching_class_id);
    else if (kb.course_id) await ensureCourseAccess(user, kb.course_id);
    else if (kb.owner_user_id) await ensureStudentAccess(user, kb.owner_user_id);
    else throw Object.assign(new Error('无权审核该知识库'), { code: 40301 });
  }
  return record;
}

async function reviewKnowledgeBaseApplication(user, reviewId, body) {
  const action = body.action;
  if (!['approved', 'rejected'].includes(action)) throw Object.assign(new Error('action 必须为 approved 或 rejected'), { code: 40001 });
  if (action === 'rejected' && !body.reason) throw Object.assign(new Error('驳回必须填写审核意见'), { code: 40001 });
  const record = await ensureKnowledgeBaseReviewAccess(user, reviewId);
  if (record.knowledgeBase.marketplace_visibility !== 'PUBLIC_PENDING') {
    throw Object.assign(new Error('审核状态已变化，请刷新后重试'), { code: 40901 });
  }
  const approved = action === 'approved';
  const operationId = `teacher:${user.user_id}:kb-review:${reviewId}:${action}`;
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeBase.update({
      where: { knowledge_base_id: record.knowledgeBaseId },
      data: { marketplace_visibility: approved ? 'PUBLIC' : 'REJECTED', marketplace_status: approved ? 'PUBLIC' : 'REJECTED' },
    });
    await tx.knowledgeBaseReviewRecord.upsert({
      where: { operationId },
      update: { reason: body.reason || null },
      create: { knowledgeBaseId: record.knowledgeBaseId, reviewerUserId: user.user_id, action: approved ? 'APPROVED' : 'REJECTED', reason: body.reason || null, operationId },
    });
    if (record.knowledgeBase.owner_user_id) {
      await tx.notification.create({
        data: {
          receiver_user_id: record.knowledgeBase.owner_user_id,
          sender_user_id: user.user_id,
          notification_type: 'DOCUMENT_REVIEW',
          title: `知识库公开申请${approved ? '已通过' : '已驳回'}`,
          content: body.reason || (approved ? '知识库已公开' : '请修改后重新提交'),
          target_type: 'knowledge_base',
          target_id: record.knowledgeBaseId,
          business_type: 'knowledge_base_review',
          business_id: record.id,
        },
      });
    }
  });
  return { review_id: Number(reviewId), knowledge_base_id: record.knowledgeBaseId, action };
}

async function batchReviewKnowledgeBaseApplications(user, body) {
  const ids = Array.isArray(body.review_ids) ? body.review_ids.map(Number).filter(Boolean) : [];
  if (!ids.length) throw Object.assign(new Error('review_ids 为必填项'), { code: 40001 });
  const results = [];
  for (const id of ids) {
    try {
      await reviewKnowledgeBaseApplication(user, id, body);
      results.push({ review_id: id, success: true });
    } catch (error) {
      results.push({ review_id: id, success: false, reason: error.message });
    }
  }
  return { results };
}

async function revokeKnowledgeBasePublic(user, knowledgeBaseId, body = {}) {
  const review = await prisma.knowledgeBaseReviewRecord.findFirst({
    where: { knowledgeBaseId: Number(knowledgeBaseId) },
    include: { knowledgeBase: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!review) throw Object.assign(new Error('知识库不存在'), { code: 40002 });
  if (!isAdmin(user)) {
    if (review.knowledgeBase.teaching_class_id) await ensureTeachingClassAccess(user, review.knowledgeBase.teaching_class_id);
    else if (review.knowledgeBase.course_id) await ensureCourseAccess(user, review.knowledgeBase.course_id);
    else await ensureStudentAccess(user, review.knowledgeBase.owner_user_id);
  }
  await prisma.knowledgeBase.update({
    where: { knowledge_base_id: Number(knowledgeBaseId) },
    data: { marketplace_visibility: 'PRIVATE', marketplace_status: 'OFFLINE' },
  });
  await prisma.knowledgeBaseReviewRecord.create({
    data: { knowledgeBaseId: Number(knowledgeBaseId), reviewerUserId: user.user_id, action: 'REVOKED', reason: body.reason || null },
  });
  return { knowledge_base_id: Number(knowledgeBaseId), revoked: true };
}

module.exports = {
  listDocuments,
  getDocument,
  reviewDocument,
  uploadDocument,
  createExternalResource,
  updateResource,
  deleteResource,
  shareResource,
  getResourceDistributionStats,
  listKnowledgeBaseApplications,
  reviewKnowledgeBaseApplication,
  batchReviewKnowledgeBaseApplications,
  revokeKnowledgeBasePublic,
};
