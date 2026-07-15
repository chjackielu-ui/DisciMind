const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { TextDecoder } = require('util');
const prisma = require('../config/prisma');

const STORAGE_ROOT = path.resolve(__dirname, '../../../storage/course-files');
const CATEGORIES = new Set(['courseware', 'reading', 'assignment', 'reference', 'dataset', 'other']);

function serviceError(message, code = 40001, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function positiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw serviceError(`${label}不合法`);
  return parsed;
}

function isAdmin(user) {
  return String(user?.role || '').toLowerCase() === 'admin';
}

function roleName(user) {
  return String(user?.role || '').toLowerCase();
}

function safeMetadata(document) {
  const metadata = document?.metadata_json && typeof document.metadata_json === 'object' && !Array.isArray(document.metadata_json)
    ? document.metadata_json : {};
  const courseFile = metadata.course_file && typeof metadata.course_file === 'object' ? metadata.course_file : {};
  return { metadata, courseFile };
}

function category(value) {
  const normalized = String(value || 'courseware').trim().toLowerCase();
  if (!CATEGORIES.has(normalized)) throw serviceError('文件分类不合法');
  return normalized;
}

function sanitizeTitle(value, fallback) {
  const result = String(value || fallback || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!result) throw serviceError('文件标题不能为空');
  if (result.length > 200) throw serviceError('文件标题不能超过 200 个字符');
  return result;
}

function sanitizeDescription(value) {
  const result = String(value || '').trim();
  if (result.length > 5000) throw serviceError('文件说明不能超过 5000 个字符');
  return result;
}

function normalizeOriginalFilename(value) {
  const raw = String(value || 'course-file').replace(/\\/g, '/');
  let normalized = path.posix.basename(raw);
  try {
    const decoded = Buffer.from(normalized, 'latin1').toString('utf8');
    if (decoded !== normalized && !decoded.includes('\uFFFD') && /[^\x00-\x7f]/.test(decoded)) normalized = decoded;
  } catch {}
  normalized = normalized.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return normalized.slice(0, 255) || 'course-file';
}

function validateFileBytes(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  const starts = (...bytes) => bytes.every((value, index) => buffer[index] === value);
  const valid = {
    '.pdf': () => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
    '.png': () => starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    '.jpg': () => starts(0xff, 0xd8, 0xff),
    '.jpeg': () => starts(0xff, 0xd8, 0xff),
    '.webp': () => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
    '.zip': () => starts(0x50, 0x4b) && [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]].some(([a, b]) => buffer[2] === a && buffer[3] === b),
    '.docx': () => starts(0x50, 0x4b),
    '.pptx': () => starts(0x50, 0x4b),
    '.xlsx': () => starts(0x50, 0x4b),
    '.txt': () => { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return !buffer.includes(0); },
    '.md': () => { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return !buffer.includes(0); },
    '.csv': () => { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return !buffer.includes(0); },
  }[ext];
  try {
    if (!valid || !valid()) throw serviceError('文件内容与扩展名不匹配');
  } catch (error) {
    if (error?.code) throw error;
    throw serviceError('文件内容与扩展名不匹配');
  }
}

function auditData(user, operation, targetId, summary) {
  return {
    user_id: Number(user.user_id),
    role: String(user.role).toUpperCase(),
    operation_type: operation,
    operation_desc: '课程文件操作',
    target_type: 'course_file',
    target_id: targetId || null,
    action_status: 'success',
    after_summary_json: summary,
  };
}

async function getClass(courseId, classId) {
  const teachingClass = await prisma.teachingClass.findUnique({
    where: { teaching_class_id: positiveInt(classId, '教学班 ID') },
    include: { course: { select: { course_id: true, course_name: true } } },
  });
  if (!teachingClass || teachingClass.status !== 'active') throw serviceError('教学班不存在', 40401, 404);
  if (teachingClass.course_id !== positiveInt(courseId, '课程 ID')) throw serviceError('课程与教学班不匹配', 40001, 400);
  return teachingClass;
}

async function ensureTeacherClassAccess(user, courseId, classId) {
  const teachingClass = await getClass(courseId, classId);
  if (isAdmin(user)) return teachingClass;
  if (roleName(user) !== 'teacher') throw serviceError('只有负责教师可以管理课程文件', 40301, 403);
  const userId = Number(user.user_id);
  const allowed = teachingClass.teacher_user_id === userId || await prisma.teachingClassTeacherAuthorization.findFirst({
    where: { teaching_class_id: teachingClass.teaching_class_id, teacher_user_id: userId, status: 'active' },
    select: { authorization_id: true },
  }) || await prisma.courseTeacherRelation.findFirst({
    where: { course_id: teachingClass.course_id, teacher_user_id: userId },
    select: { relation_id: true },
  });
  if (!allowed) throw serviceError('你不是该教学班的负责教师', 40301, 403);
  return teachingClass;
}

async function ensureStudentClassAccess(user, courseId, classId) {
  if (roleName(user) !== 'student') throw serviceError('学生身份不合法', 40301, 403);
  const teachingClass = await getClass(courseId, classId);
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: Number(user.user_id),
      course_id: teachingClass.course_id,
      teaching_class_id: teachingClass.teaching_class_id,
      enrollment_status: 'active',
    },
    select: { enrollment_id: true },
  });
  if (!enrollment) throw serviceError('无权访问该教学班文件', 40301, 403);
  return teachingClass;
}

async function ensureFile(courseId, classId, fileId, { includeDistributions = true } = {}) {
  const document = await prisma.knowledgeDocument.findFirst({
    where: {
      document_id: positiveInt(fileId, '文件 ID'),
      course_id: positiveInt(courseId, '课程 ID'),
      teaching_class_id: positiveInt(classId, '教学班 ID'),
      is_teaching_resource: true,
      resource_kind: 'course_file',
      deleted_at: null,
    },
    include: includeDistributions ? {
      owner: { include: { profile: true } },
      distributions: {
        orderBy: { publish_at: 'desc' },
        include: { recipients: { select: { student_user_id: true, read_at: true, downloaded_at: true, completed_at: true } } },
      },
    } : undefined,
  });
  if (!document) throw serviceError('课程文件不存在', 40401, 404);
  return document;
}

function serialize(document, viewerUserId = null) {
  const { courseFile } = safeMetadata(document);
  const distributions = document.distributions || [];
  const published = distributions.find((item) => item.status === 'PUBLISHED') || null;
  const recipients = distributions.flatMap((item) => item.recipients || []);
  const viewerRecipient = viewerUserId == null ? null : recipients.find((item) => item.student_user_id === Number(viewerUserId));
  return {
    file_id: document.document_id,
    course_id: document.course_id,
    teaching_class_id: document.teaching_class_id,
    uploader_user_id: document.owner_user_id,
    uploader_role: courseFile.uploader_role || 'teacher',
    uploader_name: document.owner?.profile?.real_name || document.owner?.username || null,
    original_filename: document.original_filename,
    mime_type: document.mime_type,
    size_bytes: document.file_size_bytes,
    checksum: document.file_checksum,
    title: document.title,
    description: courseFile.description || '',
    category: document.resource_category || courseFile.category || 'other',
    version: document.resource_version,
    status: String(document.resource_status || 'DRAFT').toLowerCase(),
    published_at: published?.publish_at || courseFile.published_at || null,
    created_at: document.created_at,
    updated_at: document.updated_at,
    downloaded_count: recipients.filter((item) => item.downloaded_at).length,
    recipient_count: recipients.length,
    unread_count: recipients.filter((item) => !item.read_at).length,
    is_unread: viewerRecipient ? !viewerRecipient.read_at : false,
    is_downloaded: viewerRecipient ? Boolean(viewerRecipient.downloaded_at) : false,
    download_url: `/api/courses/${document.course_id}/teaching-classes/${document.teaching_class_id}/files/${document.document_id}/download`,
  };
}

async function publishInTransaction(tx, user, teachingClass, document) {
  const operationId = `course-file:${document.document_id}:publish:v${document.resource_version}`;
  const existing = await tx.resourceDistribution.findUnique({ where: { operation_id: operationId } });
  if (existing) {
    if (existing.status !== 'PUBLISHED') {
      await tx.resourceDistribution.update({ where: { distribution_id: existing.distribution_id }, data: { status: 'PUBLISHED', publish_at: new Date() } });
    }
    return existing;
  }
  const students = await tx.studentCourseEnrollment.findMany({
    where: {
      course_id: teachingClass.course_id,
      teaching_class_id: teachingClass.teaching_class_id,
      enrollment_status: 'active',
      student: { status: 'ACTIVE' },
    },
    select: { student_user_id: true },
  });
  const distribution = await tx.resourceDistribution.create({
    data: {
      resource_id: document.document_id,
      sender_user_id: Number(user.user_id),
      course_id: teachingClass.course_id,
      teaching_class_id: teachingClass.teaching_class_id,
      title: document.title,
      description: safeMetadata(document).courseFile.description || null,
      distribution_type: 'course_material',
      resource_version: document.resource_version,
      publish_at: new Date(),
      status: 'PUBLISHED',
      operation_id: operationId,
    },
  });
  if (students.length) {
    await tx.resourceRecipient.createMany({
      data: students.map((student) => ({ distribution_id: distribution.distribution_id, student_user_id: student.student_user_id })),
      skipDuplicates: true,
    });
    await tx.notification.createMany({
      data: students.map((student) => ({
        receiver_user_id: student.student_user_id,
        sender_user_id: Number(user.user_id),
        notification_type: 'RESOURCE_SHARED',
        title: `《${teachingClass.course.course_name}》发布了新文件：${document.original_filename}`,
        content: safeMetadata(document).courseFile.description || `教学班 ${teachingClass.teaching_class_name} 发布了新的课程文件。`,
        target_type: 'resource_distribution',
        target_id: distribution.distribution_id,
        business_type: 'course_file',
        business_id: document.document_id,
        idempotency_key: `course-file:${document.document_id}:student:${student.student_user_id}`,
      })),
      skipDuplicates: true,
    });
  }
  return distribution;
}

async function upload(user, courseId, classId, file, body = {}) {
  const teachingClass = await ensureTeacherClassAccess(user, courseId, classId);
  if (!file?.buffer?.length) throw serviceError('请选择要上传的文件');
  const originalFilename = normalizeOriginalFilename(file.originalname);
  validateFileBytes(originalFilename, file.buffer);
  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const duplicate = await prisma.knowledgeDocument.findFirst({
    where: {
      course_id: teachingClass.course_id,
      teaching_class_id: teachingClass.teaching_class_id,
      owner_user_id: Number(user.user_id),
      file_checksum: checksum,
      is_teaching_resource: true,
      resource_kind: 'course_file',
      deleted_at: null,
    },
    include: { owner: { include: { profile: true } }, distributions: { include: { recipients: true } } },
  });
  if (duplicate) return { file: serialize(duplicate), duplicate: true };

  const fileExt = path.extname(originalFilename).toLowerCase();
  const storageKey = `${crypto.randomBytes(24).toString('hex')}${fileExt}`;
  const absolutePath = path.join(STORAGE_ROOT, storageKey);
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  await fs.writeFile(absolutePath, file.buffer, { flag: 'wx' });
  const publishNow = body.publish_now === true || body.publish_now === 'true';
  const description = sanitizeDescription(body.description);
  const fileCategory = category(body.category);
  const title = sanitizeTitle(body.title, originalFilename);
  try {
    const createdId = await prisma.$transaction(async (tx) => {
      const document = await tx.knowledgeDocument.create({
        data: {
          title,
          original_filename: originalFilename,
          file_ext: fileExt.replace('.', ''),
          file_size_bytes: file.size,
          mime_type: file.mimetype,
          storage_type: 'LOCAL',
          file_url: `course-files/${storageKey}`,
          scope_type: 'CLASS',
          visibility: 'CLASS',
          course_id: teachingClass.course_id,
          teaching_class_id: teachingClass.teaching_class_id,
          owner_user_id: Number(user.user_id),
          is_teaching_resource: true,
          resource_kind: 'course_file',
          resource_category: fileCategory,
          metadata_json: { course_file: { description, category: fileCategory, uploader_role: roleName(user), storage_key: storageKey, published_at: publishNow ? new Date().toISOString() : null } },
          resource_group_id: crypto.randomUUID(),
          resource_version: 1,
          version_source: 'COURSE_FILE_UPLOAD',
          resource_status: publishNow ? 'ACTIVE' : 'DRAFT',
          review_status: 'APPROVED',
          file_checksum: checksum,
          marketplace_status: 'READY',
          operation_id: crypto.randomUUID(),
          processing_state: 'uploaded',
        },
      });
      if (publishNow) await publishInTransaction(tx, user, teachingClass, document);
      await tx.operationLog.create({ data: auditData(user, publishNow ? 'UPLOAD_AND_PUBLISH_COURSE_FILE' : 'UPLOAD_COURSE_FILE', document.document_id, {
        course_id: teachingClass.course_id, teaching_class_id: teachingClass.teaching_class_id, checksum, size_bytes: file.size,
      }) });
      return document.document_id;
    });
    return { file: serialize(await ensureFile(teachingClass.course_id, teachingClass.teaching_class_id, createdId)), duplicate: false };
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => {});
    throw error;
  }
}

async function list(user, courseId, classId, query = {}) {
  const teachingClass = roleName(user) === 'student'
    ? await ensureStudentClassAccess(user, courseId, classId)
    : await ensureTeacherClassAccess(user, courseId, classId);
  const where = {
    course_id: teachingClass.course_id,
    teaching_class_id: teachingClass.teaching_class_id,
    is_teaching_resource: true,
    resource_kind: 'course_file',
    deleted_at: null,
  };
  if (roleName(user) === 'student') {
    where.resource_status = 'ACTIVE';
    where.distributions = { some: { status: 'PUBLISHED', recipients: { some: { student_user_id: Number(user.user_id) } } } };
  }
  if (query.category) where.resource_category = category(query.category);
  const keyword = String(query.keyword || '').trim();
  if (keyword) where.OR = [{ title: { contains: keyword } }, { original_filename: { contains: keyword } }];
  const rows = await prisma.knowledgeDocument.findMany({
    where,
    include: { owner: { include: { profile: true } }, distributions: { orderBy: { publish_at: 'desc' }, include: { recipients: true } } },
    orderBy: query.sort === 'oldest' ? { created_at: 'asc' } : { created_at: 'desc' },
    take: 200,
  });
  return { list: rows.map((document) => serialize(document, roleName(user) === 'student' ? user.user_id : null)), total: rows.length };
}

async function update(user, courseId, classId, fileId, body = {}) {
  await ensureTeacherClassAccess(user, courseId, classId);
  const document = await ensureFile(courseId, classId, fileId);
  if (!isAdmin(user) && document.owner_user_id !== Number(user.user_id)) throw serviceError('只有上传教师可以编辑文件', 40301, 403);
  const { metadata, courseFile } = safeMetadata(document);
  const data = {
    ...(body.title !== undefined ? { title: sanitizeTitle(body.title, document.original_filename) } : {}),
    ...(body.category !== undefined ? { resource_category: category(body.category) } : {}),
    metadata_json: { ...metadata, course_file: { ...courseFile, ...(body.description !== undefined ? { description: sanitizeDescription(body.description) } : {}), ...(body.category !== undefined ? { category: category(body.category) } : {}) } },
  };
  await prisma.$transaction([
    prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data }),
    prisma.resourceDistribution.updateMany({ where: { resource_id: document.document_id }, data: { ...(data.title ? { title: data.title } : {}), ...(body.description !== undefined ? { description: sanitizeDescription(body.description) || null } : {}) } }),
    prisma.operationLog.create({ data: auditData(user, 'UPDATE_COURSE_FILE', document.document_id, { title: data.title, category: data.resource_category }) }),
  ]);
  return { file: serialize(await ensureFile(courseId, classId, fileId)) };
}

async function publish(user, courseId, classId, fileId) {
  const teachingClass = await ensureTeacherClassAccess(user, courseId, classId);
  const document = await ensureFile(courseId, classId, fileId);
  if (!isAdmin(user) && document.owner_user_id !== Number(user.user_id)) throw serviceError('只有上传教师可以发布文件', 40301, 403);
  await prisma.$transaction(async (tx) => {
    const { metadata, courseFile } = safeMetadata(document);
    const publishedAt = new Date();
    await tx.knowledgeDocument.update({
      where: { document_id: document.document_id },
      data: { resource_status: 'ACTIVE', metadata_json: { ...metadata, course_file: { ...courseFile, published_at: publishedAt.toISOString() } } },
    });
    await publishInTransaction(tx, user, teachingClass, document);
    await tx.operationLog.create({ data: auditData(user, 'PUBLISH_COURSE_FILE', document.document_id, { course_id: teachingClass.course_id, teaching_class_id: teachingClass.teaching_class_id }) });
  });
  return { file: serialize(await ensureFile(courseId, classId, fileId)) };
}

async function unpublish(user, courseId, classId, fileId) {
  await ensureTeacherClassAccess(user, courseId, classId);
  const document = await ensureFile(courseId, classId, fileId);
  if (!isAdmin(user) && document.owner_user_id !== Number(user.user_id)) throw serviceError('只有上传教师可以下架文件', 40301, 403);
  await prisma.$transaction([
    prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { resource_status: 'UNPUBLISHED' } }),
    prisma.resourceDistribution.updateMany({ where: { resource_id: document.document_id, status: 'PUBLISHED' }, data: { status: 'WITHDRAWN' } }),
    prisma.operationLog.create({ data: auditData(user, 'UNPUBLISH_COURSE_FILE', document.document_id, {}) }),
  ]);
  return { file: serialize(await ensureFile(courseId, classId, fileId)) };
}

async function remove(user, courseId, classId, fileId) {
  await ensureTeacherClassAccess(user, courseId, classId);
  const document = await ensureFile(courseId, classId, fileId);
  if (!isAdmin(user) && document.owner_user_id !== Number(user.user_id)) throw serviceError('只有上传教师可以删除文件', 40301, 403);
  const now = new Date();
  await prisma.$transaction([
    prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { deleted_at: now, resource_status: 'DELETED', marketplace_status: 'DELETED' } }),
    prisma.resourceDistribution.updateMany({ where: { resource_id: document.document_id }, data: { status: 'WITHDRAWN' } }),
    prisma.operationLog.create({ data: auditData(user, 'DELETE_COURSE_FILE', document.document_id, { deleted_at: now.toISOString() }) }),
  ]);
  return { deleted: true, file_id: document.document_id };
}

async function authorizeDownload(user, courseId, classId, fileId) {
  const role = roleName(user);
  if (role === 'student') await ensureStudentClassAccess(user, courseId, classId);
  else await ensureTeacherClassAccess(user, courseId, classId);
  const document = await ensureFile(courseId, classId, fileId);
  const distribution = document.distributions.find((item) => item.status === 'PUBLISHED');
  if (role === 'student') {
    if (document.resource_status !== 'ACTIVE' || !distribution) throw serviceError('课程文件不存在或尚未发布', 40401, 404);
    const recipient = await prisma.resourceRecipient.findFirst({
      where: { distribution_id: distribution.distribution_id, student_user_id: Number(user.user_id) },
      select: { recipient_id: true, read_at: true, completed_at: true },
    });
    if (!recipient) throw serviceError('无权下载该教学班文件', 40301, 403);
    await prisma.$transaction([
      prisma.resourceRecipient.update({ where: { recipient_id: recipient.recipient_id }, data: { read_at: recipient.read_at || new Date(), downloaded_at: new Date(), status: recipient.completed_at ? 'COMPLETED' : 'DOWNLOADED' } }),
      prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { last_used_at: new Date() } }),
    ]);
  } else {
    await prisma.knowledgeDocument.update({ where: { document_id: document.document_id }, data: { last_used_at: new Date() } });
  }
  const absolutePath = path.resolve(STORAGE_ROOT, path.basename(document.file_url));
  if (!absolutePath.startsWith(`${STORAGE_ROOT}${path.sep}`)) throw serviceError('文件存储路径不合法', 50001, 500);
  try { await fs.access(absolutePath); } catch { throw serviceError('课程文件实体不存在', 40401, 404); }
  return { absolutePath, filename: document.original_filename, mimeType: document.mime_type || 'application/octet-stream' };
}

module.exports = {
  STORAGE_ROOT,
  CATEGORIES,
  ensureTeacherClassAccess,
  ensureStudentClassAccess,
  upload,
  list,
  update,
  publish,
  unpublish,
  remove,
  authorizeDownload,
  serialize,
};
