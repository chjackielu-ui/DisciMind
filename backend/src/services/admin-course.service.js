// 管理员端课程管理服务
// 课程、授课教师、章节和知识点写操作统一使用事务审计与引用保护。

const prisma = require('../config/prisma');
const { buildAdminOperationData } = require('./admin-audit.service');

function publicError(message, code = 40001) {
  return Object.assign(new Error(message), { code });
}

function parseId(value, label = 'ID') {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw publicError(`${label} 不合法`);
  return id;
}

function text(value, { label = '字段', max = 255, required = false } = {}) {
  if (value == null) {
    if (required) throw publicError(`${label}不能为空`);
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (required) throw publicError(`${label}不能为空`);
    return null;
  }
  if (normalized.length > max) throw publicError(`${label}不能超过 ${max} 个字符`);
  return normalized;
}

function integer(value, label, fallback = 0) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw publicError(`${label}必须是非负整数`);
  return parsed;
}

function translatePrismaError(error) {
  if (error?.code === 'P2002') return publicError('课程编码或同一课程下的知识点编码已存在', 40003);
  if (error?.code === 'P2003') return publicError('该记录仍被业务数据引用，不能直接删除', 40901);
  return error;
}

function formatCourse(course) {
  return {
    course_id: course.course_id,
    course_name: course.course_name,
    course_code: course.course_code,
    subject_category: course.subject_category,
    description: course.description,
    cover_url: course.cover_url,
    status: course.status === 'ACTIVE' ? 'active' : 'archived',
    teacher_count: course._count?.teacher_relations || 0,
    chapter_count: course._count?.chapters || 0,
    student_count: course._count?.enrollments || 0,
    teaching_class_count: course._count?.teaching_classes || 0,
    created_at: course.created_at,
    updated_at: course.updated_at,
  };
}

const courseListInclude = {
  _count: {
    select: {
      teacher_relations: true,
      chapters: true,
      teaching_classes: true,
      enrollments: { where: { enrollment_status: 'active' } },
    },
  },
};

async function createAudit(tx, input) {
  return tx.operationLog.create({ data: buildAdminOperationData(input) });
}

async function getCourseList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const where = {};
  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.OR = [
      { course_name: { contains: keyword } },
      { course_code: { contains: keyword } },
      { subject_category: { contains: keyword } },
    ];
  }
  if (query.subject_category) where.subject_category = { contains: String(query.subject_category).trim() };
  if (query.status) {
    if (!['active', 'archived'].includes(String(query.status))) throw publicError('课程状态不合法');
    where.status = query.status === 'active' ? 'ACTIVE' : 'ARCHIVED';
  }
  const [courses, total] = await Promise.all([
    prisma.course.findMany({
      where,
      include: courseListInclude,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.course.count({ where }),
  ]);
  return {
    list: courses.map(formatCourse),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function createCourse(data, req) {
  try {
    return await prisma.$transaction(async (tx) => {
      const status = data.status == null ? 'ACTIVE' : data.status === 'archived' ? 'ARCHIVED' : data.status === 'active' ? 'ACTIVE' : null;
      if (!status) throw publicError('课程状态不合法');
      const course = await tx.course.create({
        data: {
          course_name: text(data.course_name, { label: '课程名称', max: 100, required: true }),
          course_code: text(data.course_code, { label: '课程编码', max: 50, required: true }),
          subject_category: text(data.subject_category, { label: '学科分类', max: 100, required: true }),
          description: text(data.description, { label: '课程说明', max: 10000 }),
          cover_url: text(data.cover_url, { label: '封面地址', max: 500 }),
          status,
        },
        include: courseListInclude,
      });
      await createAudit(tx, {
        req,
        operationType: 'CREATE_COURSE',
        targetType: 'course',
        targetId: course.course_id,
        after: formatCourse(course),
      });
      return formatCourse(course);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function getCourseDetail(courseId) {
  const targetId = parseId(courseId, '课程 ID');
  const course = await prisma.course.findUnique({
    where: { course_id: targetId },
    include: {
      ...courseListInclude,
      teacher_relations: {
        include: { teacher: { include: { profile: true } } },
        orderBy: { created_at: 'asc' },
      },
      teaching_classes: {
        include: { _count: { select: { enrollments: { where: { enrollment_status: 'active' } } } } },
        orderBy: { created_at: 'asc' },
      },
    },
  });
  if (!course) throw publicError('课程不存在', 40002);
  return {
    ...formatCourse(course),
    teachers: course.teacher_relations.map((item) => ({
      user_id: item.teacher_user_id,
      real_name: item.teacher?.profile?.real_name || item.teacher?.username || null,
      teacher_role: item.teacher_role === 'MAIN_TEACHER' ? 'main_teacher'
        : item.teacher_role === 'ASSISTANT' ? 'assistant' : 'manager',
    })),
    teaching_classes: course.teaching_classes.map((item) => ({
      teaching_class_id: item.teaching_class_id,
      teaching_class_name: item.teaching_class_name,
      code: item.code,
      semester: item.semester,
      description: item.description,
      location: item.location,
      capacity: item.capacity,
      status: item.status,
      student_count: item._count.enrollments,
      created_at: item.created_at,
    })),
  };
}

async function updateCourse(courseId, data, req) {
  const targetId = parseId(courseId, '课程 ID');
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.course.findUnique({ where: { course_id: targetId }, include: courseListInclude });
      if (!current) throw publicError('课程不存在', 40002);
      const updateData = {};
      if (data.course_name !== undefined) updateData.course_name = text(data.course_name, { label: '课程名称', max: 100, required: true });
      if (data.course_code !== undefined) updateData.course_code = text(data.course_code, { label: '课程编码', max: 50, required: true });
      if (data.subject_category !== undefined) updateData.subject_category = text(data.subject_category, { label: '学科分类', max: 100, required: true });
      if (data.description !== undefined) updateData.description = text(data.description, { label: '课程说明', max: 10000 });
      if (data.cover_url !== undefined) updateData.cover_url = text(data.cover_url, { label: '封面地址', max: 500 });
      if (data.status !== undefined) {
        if (!['active', 'archived'].includes(data.status)) throw publicError('课程状态不合法');
        updateData.status = data.status === 'active' ? 'ACTIVE' : 'ARCHIVED';
      }
      const updated = await tx.course.update({ where: { course_id: targetId }, data: updateData, include: courseListInclude });
      await createAudit(tx, {
        req,
        operationType: 'UPDATE_COURSE',
        targetType: 'course',
        targetId,
        before: formatCourse(current),
        after: formatCourse(updated),
      });
      return formatCourse(updated);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function deleteCourse(courseId, req) {
  const targetId = parseId(courseId, '课程 ID');
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({ where: { course_id: targetId }, include: { _count: true } });
    if (!course) throw publicError('课程不存在', 40002);
    const dependencySummary = Object.fromEntries(Object.entries(course._count).filter(([, count]) => count > 0));
    const archived = await tx.course.update({
      where: { course_id: targetId },
      data: { status: 'ARCHIVED' },
      include: courseListInclude,
    });
    await createAudit(tx, {
      req,
      operationType: 'ARCHIVE_COURSE',
      targetType: 'course',
      targetId,
      before: formatCourse({ ...course, _count: course._count }),
      after: formatCourse(archived),
    });
    return {
      course_id: targetId,
      deletion_mode: 'soft',
      already_archived: course.status === 'ARCHIVED',
      dependency_count: Object.values(dependencySummary).reduce((sum, count) => sum + count, 0),
      dependency_summary: dependencySummary,
    };
  });
}

const teacherRoleMap = { main_teacher: 'MAIN_TEACHER', assistant: 'ASSISTANT', manager: 'MANAGER' };

async function bindTeacher(courseId, teacherUserId, teacherRole, req) {
  const targetCourseId = parseId(courseId, '课程 ID');
  const targetTeacherId = parseId(teacherUserId, '教师用户 ID');
  const prismaRole = teacherRoleMap[teacherRole];
  if (!prismaRole) throw publicError('无效的教师角色');
  try {
    return await prisma.$transaction(async (tx) => {
      const [course, teacher, current] = await Promise.all([
        tx.course.findUnique({ where: { course_id: targetCourseId }, select: { course_id: true, status: true } }),
        tx.user.findFirst({ where: { user_id: targetTeacherId, role: 'TEACHER', status: 'ACTIVE' }, include: { profile: true } }),
        tx.courseTeacherRelation.findUnique({ where: { course_id_teacher_user_id: { course_id: targetCourseId, teacher_user_id: targetTeacherId } } }),
      ]);
      if (!course) throw publicError('课程不存在', 40002);
      if (course.status !== 'ACTIVE') throw publicError('已归档课程不能绑定教师', 40901);
      if (!teacher) throw publicError('教师用户不存在或已停用', 40002);
      const relation = await tx.courseTeacherRelation.upsert({
        where: { course_id_teacher_user_id: { course_id: targetCourseId, teacher_user_id: targetTeacherId } },
        update: { teacher_role: prismaRole },
        create: { course_id: targetCourseId, teacher_user_id: targetTeacherId, teacher_role: prismaRole },
      });
      const result = {
        course_id: targetCourseId,
        teacher_user_id: targetTeacherId,
        teacher_name: teacher.profile?.real_name || teacher.username,
        teacher_role: teacherRole,
      };
      await createAudit(tx, {
        req,
        operationType: current ? 'UPDATE_COURSE_TEACHER' : 'BIND_COURSE_TEACHER',
        targetType: 'course',
        targetId: targetCourseId,
        before: current,
        after: { ...result, relation_id: relation.relation_id },
      });
      return result;
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function unbindTeacher(courseId, teacherUserId, req) {
  const targetCourseId = parseId(courseId, '课程 ID');
  const targetTeacherId = parseId(teacherUserId, '教师用户 ID');
  return prisma.$transaction(async (tx) => {
    const relation = await tx.courseTeacherRelation.findUnique({
      where: { course_id_teacher_user_id: { course_id: targetCourseId, teacher_user_id: targetTeacherId } },
    });
    if (!relation) throw publicError('该教师未绑定此课程', 40002);
    await tx.courseTeacherRelation.delete({
      where: { course_id_teacher_user_id: { course_id: targetCourseId, teacher_user_id: targetTeacherId } },
    });
    await createAudit(tx, {
      req,
      operationType: 'UNBIND_COURSE_TEACHER',
      targetType: 'course',
      targetId: targetCourseId,
      before: relation,
      after: { course_id: targetCourseId, teacher_user_id: targetTeacherId, bound: false },
    });
    return { course_id: targetCourseId, teacher_user_id: targetTeacherId };
  });
}

function formatChapter(chapter) {
  return {
    chapter_id: chapter.chapter_id,
    course_id: chapter.course_id,
    chapter_name: chapter.chapter_name,
    chapter_order: chapter.chapter_order,
    description: chapter.description,
    knowledge_point_count: chapter._count?.knowledge_points || 0,
    created_at: chapter.created_at,
    updated_at: chapter.updated_at,
  };
}

async function getChapterList(courseId) {
  const targetCourseId = parseId(courseId, '课程 ID');
  const exists = await prisma.course.findUnique({ where: { course_id: targetCourseId }, select: { course_id: true } });
  if (!exists) throw publicError('课程不存在', 40002);
  const chapters = await prisma.chapter.findMany({
    where: { course_id: targetCourseId },
    include: { _count: { select: { knowledge_points: true, wrong_questions: true, lesson_plans: true } } },
    orderBy: [{ chapter_order: 'asc' }, { chapter_id: 'asc' }],
  });
  return chapters.map(formatChapter);
}

async function createChapter(courseId, data, req) {
  const targetCourseId = parseId(courseId, '课程 ID');
  return prisma.$transaction(async (tx) => {
    const course = await tx.course.findUnique({ where: { course_id: targetCourseId }, select: { course_id: true, status: true } });
    if (!course) throw publicError('课程不存在', 40002);
    if (course.status !== 'ACTIVE') throw publicError('已归档课程不能新增章节', 40901);
    const chapter = await tx.chapter.create({
      data: {
        course_id: targetCourseId,
        chapter_name: text(data.chapter_name, { label: '章节名称', max: 100, required: true }),
        chapter_order: integer(data.chapter_order, '章节序号'),
        description: text(data.description, { label: '章节说明', max: 10000 }),
      },
      include: { _count: { select: { knowledge_points: true, wrong_questions: true, lesson_plans: true } } },
    });
    await createAudit(tx, { req, operationType: 'CREATE_CHAPTER', targetType: 'chapter', targetId: chapter.chapter_id, after: formatChapter(chapter) });
    return formatChapter(chapter);
  });
}

async function updateChapter(chapterId, data, req) {
  const targetId = parseId(chapterId, '章节 ID');
  return prisma.$transaction(async (tx) => {
    const current = await tx.chapter.findUnique({ where: { chapter_id: targetId }, include: { _count: { select: { knowledge_points: true, wrong_questions: true, lesson_plans: true } } } });
    if (!current) throw publicError('章节不存在', 40002);
    const updateData = {};
    if (data.chapter_name !== undefined) updateData.chapter_name = text(data.chapter_name, { label: '章节名称', max: 100, required: true });
    if (data.chapter_order !== undefined) updateData.chapter_order = integer(data.chapter_order, '章节序号');
    if (data.description !== undefined) updateData.description = text(data.description, { label: '章节说明', max: 10000 });
    const updated = await tx.chapter.update({ where: { chapter_id: targetId }, data: updateData, include: { _count: { select: { knowledge_points: true, wrong_questions: true, lesson_plans: true } } } });
    await createAudit(tx, { req, operationType: 'UPDATE_CHAPTER', targetType: 'chapter', targetId, before: formatChapter(current), after: formatChapter(updated) });
    return formatChapter(updated);
  });
}

async function deleteChapter(chapterId, req) {
  const targetId = parseId(chapterId, '章节 ID');
  return prisma.$transaction(async (tx) => {
    const chapter = await tx.chapter.findUnique({ where: { chapter_id: targetId }, include: { _count: true } });
    if (!chapter) throw publicError('章节不存在', 40002);
    const dependencies = Object.fromEntries(Object.entries(chapter._count).filter(([, count]) => count > 0));
    if (Object.keys(dependencies).length) throw publicError('章节仍有关联知识点、错题或教案，请先解除关联', 40901);
    await tx.chapter.delete({ where: { chapter_id: targetId } });
    await createAudit(tx, { req, operationType: 'DELETE_CHAPTER', targetType: 'chapter', targetId, before: formatChapter(chapter) });
    return { chapter_id: targetId, deletion_mode: 'hard' };
  });
}

function normalizeAliases(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw publicError('知识点别名必须是数组');
  const aliases = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (aliases.some((alias) => alias.length > 100)) throw publicError('知识点别名不能超过 100 个字符');
  return aliases;
}

function difficulty(value, fallback = 'BASIC') {
  if (value == null || value === '') return fallback;
  const result = { basic: 'BASIC', medium: 'MEDIUM', hard: 'HARD' }[String(value).toLowerCase()];
  if (!result) throw publicError('知识点难度不合法');
  return result;
}

function formatKnowledgePoint(point) {
  return {
    knowledge_point_id: point.knowledge_point_id,
    course_id: point.course_id,
    chapter_id: point.chapter_id,
    parent_id: point.parent_id,
    knowledge_point_name: point.knowledge_point_name,
    knowledge_point_code: point.knowledge_point_code,
    description: point.description,
    difficulty_level: point.difficulty_level === 'BASIC' ? 'basic' : point.difficulty_level === 'MEDIUM' ? 'medium' : 'hard',
    sort_order: point.sort_order,
    aliases: (point.aliases || []).map((alias) => alias.alias_text),
    created_at: point.created_at,
    updated_at: point.updated_at,
  };
}

async function validateKnowledgeScope(tx, courseId, chapterId, parentId, selfId = null) {
  if (chapterId != null) {
    const chapter = await tx.chapter.findFirst({ where: { chapter_id: parseId(chapterId, '章节 ID'), course_id: courseId }, select: { chapter_id: true } });
    if (!chapter) throw publicError('章节不存在或不属于当前课程', 40002);
  }
  if (parentId != null) {
    let cursor = parseId(parentId, '父知识点 ID');
    if (selfId && cursor === selfId) throw publicError('知识点不能以自身作为父级');
    const visited = new Set();
    while (cursor) {
      if (visited.has(cursor)) throw publicError('知识点层级存在循环', 40901);
      visited.add(cursor);
      const parent = await tx.knowledgePoint.findUnique({ where: { knowledge_point_id: cursor }, select: { course_id: true, parent_id: true } });
      if (!parent || parent.course_id !== courseId) throw publicError('父知识点不存在或不属于当前课程', 40002);
      if (selfId && parent.parent_id === selfId) throw publicError('不能把子知识点设置为父级', 40901);
      cursor = parent.parent_id;
    }
  }
}

async function getKnowledgePointList(courseId, query = {}) {
  const targetCourseId = parseId(courseId, '课程 ID');
  const exists = await prisma.course.findUnique({ where: { course_id: targetCourseId }, select: { course_id: true } });
  if (!exists) throw publicError('课程不存在', 40002);
  const where = { course_id: targetCourseId };
  if (query.chapter_id) where.chapter_id = parseId(query.chapter_id, '章节 ID');
  const points = await prisma.knowledgePoint.findMany({
    where,
    include: { aliases: { orderBy: { alias_text: 'asc' } } },
    orderBy: [{ sort_order: 'asc' }, { knowledge_point_id: 'asc' }],
  });
  return points.map(formatKnowledgePoint);
}

async function createKnowledgePoint(data, req) {
  const courseId = parseId(data.course_id, '课程 ID');
  try {
    return await prisma.$transaction(async (tx) => {
      const course = await tx.course.findUnique({ where: { course_id: courseId }, select: { course_id: true, status: true } });
      if (!course) throw publicError('课程不存在', 40002);
      if (course.status !== 'ACTIVE') throw publicError('已归档课程不能新增知识点', 40901);
      const chapterId = data.chapter_id == null ? null : parseId(data.chapter_id, '章节 ID');
      const parentId = data.parent_id == null ? null : parseId(data.parent_id, '父知识点 ID');
      await validateKnowledgeScope(tx, courseId, chapterId, parentId);
      const aliases = normalizeAliases(data.aliases);
      const created = await tx.knowledgePoint.create({
        data: {
          course_id: courseId,
          chapter_id: chapterId,
          parent_id: parentId,
          knowledge_point_name: text(data.knowledge_point_name, { label: '知识点名称', max: 100, required: true }),
          knowledge_point_code: text(data.knowledge_point_code, { label: '知识点编码', max: 50, required: true }),
          description: text(data.description, { label: '知识点说明', max: 10000 }),
          difficulty_level: difficulty(data.difficulty_level),
          sort_order: integer(data.sort_order, '排序号'),
          aliases: aliases.length ? { create: aliases.map((alias) => ({ alias_text: alias, source: 'manual' })) } : undefined,
        },
        include: { aliases: true },
      });
      await createAudit(tx, { req, operationType: 'CREATE_KNOWLEDGE_POINT', targetType: 'knowledge_point', targetId: created.knowledge_point_id, after: formatKnowledgePoint(created) });
      return formatKnowledgePoint(created);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function updateKnowledgePoint(pointId, data, req) {
  const targetId = parseId(pointId, '知识点 ID');
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.knowledgePoint.findUnique({ where: { knowledge_point_id: targetId }, include: { aliases: true } });
      if (!current) throw publicError('知识点不存在', 40002);
      const chapterId = data.chapter_id === undefined ? current.chapter_id : data.chapter_id == null ? null : parseId(data.chapter_id, '章节 ID');
      const parentId = data.parent_id === undefined ? current.parent_id : data.parent_id == null ? null : parseId(data.parent_id, '父知识点 ID');
      await validateKnowledgeScope(tx, current.course_id, chapterId, parentId, targetId);
      const updateData = {};
      if (data.knowledge_point_name !== undefined) updateData.knowledge_point_name = text(data.knowledge_point_name, { label: '知识点名称', max: 100, required: true });
      if (data.knowledge_point_code !== undefined) updateData.knowledge_point_code = text(data.knowledge_point_code, { label: '知识点编码', max: 50, required: true });
      if (data.description !== undefined) updateData.description = text(data.description, { label: '知识点说明', max: 10000 });
      if (data.chapter_id !== undefined) updateData.chapter_id = chapterId;
      if (data.parent_id !== undefined) updateData.parent_id = parentId;
      if (data.sort_order !== undefined) updateData.sort_order = integer(data.sort_order, '排序号');
      if (data.difficulty_level !== undefined) updateData.difficulty_level = difficulty(data.difficulty_level, current.difficulty_level);
      await tx.knowledgePoint.update({ where: { knowledge_point_id: targetId }, data: updateData });
      if (data.aliases !== undefined) {
        const aliases = normalizeAliases(data.aliases);
        await tx.knowledgePointAlias.deleteMany({ where: { knowledge_point_id: targetId, source: 'manual' } });
        if (aliases.length) await tx.knowledgePointAlias.createMany({ data: aliases.map((alias) => ({ knowledge_point_id: targetId, alias_text: alias, source: 'manual' })), skipDuplicates: true });
      }
      const updated = await tx.knowledgePoint.findUnique({ where: { knowledge_point_id: targetId }, include: { aliases: true } });
      await createAudit(tx, { req, operationType: 'UPDATE_KNOWLEDGE_POINT', targetType: 'knowledge_point', targetId, before: formatKnowledgePoint(current), after: formatKnowledgePoint(updated) });
      return formatKnowledgePoint(updated);
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

async function deleteKnowledgePoint(pointId, req) {
  const targetId = parseId(pointId, '知识点 ID');
  try {
    return await prisma.$transaction(async (tx) => {
      const point = await tx.knowledgePoint.findUnique({ where: { knowledge_point_id: targetId }, include: { aliases: true, _count: true } });
      if (!point) throw publicError('知识点不存在', 40002);
      const dependencies = Object.fromEntries(Object.entries(point._count).filter(([name, count]) => name !== 'aliases' && count > 0));
      if (Object.keys(dependencies).length) throw publicError('知识点仍被题目、任务、学习记录或子知识点引用，不能删除', 40901);
      await tx.knowledgePoint.delete({ where: { knowledge_point_id: targetId } });
      await createAudit(tx, { req, operationType: 'DELETE_KNOWLEDGE_POINT', targetType: 'knowledge_point', targetId, before: formatKnowledgePoint(point) });
      return { knowledge_point_id: targetId, deletion_mode: 'hard' };
    });
  } catch (error) {
    throw translatePrismaError(error);
  }
}

module.exports = {
  getCourseList,
  createCourse,
  getCourseDetail,
  updateCourse,
  deleteCourse,
  bindTeacher,
  unbindTeacher,
  getChapterList,
  createChapter,
  updateChapter,
  deleteChapter,
  getKnowledgePointList,
  createKnowledgePoint,
  updateKnowledgePoint,
  deleteKnowledgePoint,
};
