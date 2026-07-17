const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const prisma = require('../src/config/prisma');
const courseService = require('../src/services/admin-course.service');
const { getUserPermissions } = require('../src/services/admin-permission.service');

const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
let req;
let teacher;
let course;

test.before(async () => {
  const admin = await prisma.user.findFirst({
    where: {
      role: 'ADMIN',
      status: 'ACTIVE',
      admin_role_assignments: { some: { role: { role_code: 'super_admin', enabled: true } } },
    },
    select: { user_id: true, role: true },
  });
  assert.ok(admin);
  teacher = await prisma.user.findFirst({
    where: { role: 'TEACHER', status: 'ACTIVE' },
    select: { user_id: true },
  });
  assert.ok(teacher, 'an active teacher is required');
  req = {
    user: admin,
    id: `admin-course-management-${suffix}`,
    ip: '127.0.0.1',
    adminPermissions: await getUserPermissions(admin.user_id, 'admin'),
  };
});

test.after(async () => {
  await prisma.operationLog.deleteMany({ where: { request_id: req?.id } });
  if (course?.course_id) await prisma.course.deleteMany({ where: { course_id: course.course_id } });
  await prisma.$disconnect();
});

test('course, teacher, chapter and knowledge-point lifecycle is persisted, protected and audited', async () => {
  course = await courseService.createCourse({
    course_name: `课程闭环-${suffix}`,
    course_code: `COURSE_${suffix}`,
    subject_category: '测试学科',
    description: '用于课程管理专项测试',
  }, req);
  assert.equal(course.status, 'active');

  const filtered = await courseService.getCourseList({ keyword: suffix, page: 1, page_size: 5 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.list[0].course_id, course.course_id);

  const updated = await courseService.updateCourse(course.course_id, { course_name: `课程闭环已更新-${suffix}` }, req);
  assert.match(updated.course_name, /已更新/);

  const bound = await courseService.bindTeacher(course.course_id, teacher.user_id, 'main_teacher', req);
  assert.equal(bound.teacher_role, 'main_teacher');
  const roleChanged = await courseService.bindTeacher(course.course_id, teacher.user_id, 'assistant', req);
  assert.equal(roleChanged.teacher_role, 'assistant');

  const chapter = await courseService.createChapter(course.course_id, {
    chapter_name: '第一章', chapter_order: 1, description: '章节说明',
  }, req);
  const point = await courseService.createKnowledgePoint({
    course_id: course.course_id,
    chapter_id: chapter.chapter_id,
    knowledge_point_name: '核心概念',
    knowledge_point_code: 'KP_CORE',
    difficulty_level: 'medium',
    aliases: ['核心', '关键概念', '核心'],
    sort_order: 1,
  }, req);
  assert.deepEqual(point.aliases.sort(), ['关键概念', '核心'].sort());

  const child = await courseService.createKnowledgePoint({
    course_id: course.course_id,
    chapter_id: chapter.chapter_id,
    parent_id: point.knowledge_point_id,
    knowledge_point_name: '子概念',
    knowledge_point_code: 'KP_CHILD',
  }, req);
  await assert.rejects(
    () => courseService.updateKnowledgePoint(point.knowledge_point_id, { parent_id: child.knowledge_point_id }, req),
    /不能把子知识点设置为父级/,
  );
  await assert.rejects(
    () => courseService.deleteKnowledgePoint(point.knowledge_point_id, req),
    /仍被.*引用/,
  );
  await assert.rejects(
    () => courseService.deleteChapter(chapter.chapter_id, req),
    /仍有关联/,
  );

  const detail = await courseService.getCourseDetail(course.course_id);
  assert.equal(detail.teacher_count, 1);
  assert.equal(detail.teachers[0].teacher_role, 'assistant');
  const chapters = await courseService.getChapterList(course.course_id);
  assert.equal(chapters[0].knowledge_point_count, 2);
  const points = await courseService.getKnowledgePointList(course.course_id, { chapter_id: chapter.chapter_id });
  assert.equal(points.length, 2);

  await courseService.deleteKnowledgePoint(child.knowledge_point_id, req);
  await courseService.updateKnowledgePoint(point.knowledge_point_id, {
    knowledge_point_name: '核心概念已更新', aliases: ['核心知识'], difficulty_level: 'hard',
  }, req);
  await courseService.deleteKnowledgePoint(point.knowledge_point_id, req);
  await courseService.updateChapter(chapter.chapter_id, { chapter_name: '第一章已更新' }, req);
  await courseService.deleteChapter(chapter.chapter_id, req);
  await courseService.unbindTeacher(course.course_id, teacher.user_id, req);

  const archived = await courseService.deleteCourse(course.course_id, req);
  assert.equal(archived.deletion_mode, 'soft');
  assert.equal((await courseService.getCourseDetail(course.course_id)).status, 'archived');
  await assert.rejects(
    () => courseService.createChapter(course.course_id, { chapter_name: '归档后章节' }, req),
    /已归档课程/,
  );
  await courseService.updateCourse(course.course_id, { status: 'active' }, req);

  const auditTypes = (await prisma.operationLog.findMany({
    where: { request_id: req.id }, select: { operation_type: true },
  })).map((item) => item.operation_type);
  for (const expected of [
    'CREATE_COURSE', 'UPDATE_COURSE', 'BIND_COURSE_TEACHER', 'UPDATE_COURSE_TEACHER',
    'UNBIND_COURSE_TEACHER', 'CREATE_CHAPTER', 'UPDATE_CHAPTER', 'DELETE_CHAPTER',
    'CREATE_KNOWLEDGE_POINT', 'UPDATE_KNOWLEDGE_POINT', 'DELETE_KNOWLEDGE_POINT', 'ARCHIVE_COURSE',
  ]) {
    assert.ok(auditTypes.includes(expected), `missing audit operation ${expected}`);
  }
});

test('course validation rejects duplicate codes and cross-course knowledge relations', async () => {
  await assert.rejects(
    () => courseService.createCourse({
      course_name: '重复编码课程', course_code: course.course_code, subject_category: '测试',
    }, req),
    /已存在/,
  );
  const foreignChapter = await prisma.chapter.findFirst({
    where: { course_id: { not: course.course_id } },
    select: { chapter_id: true },
  });
  if (foreignChapter) {
    await assert.rejects(
      () => courseService.createKnowledgePoint({
        course_id: course.course_id,
        chapter_id: foreignChapter.chapter_id,
        knowledge_point_name: '跨课程知识点',
        knowledge_point_code: 'KP_CROSS',
      }, req),
      /不属于当前课程/,
    );
  }
});
