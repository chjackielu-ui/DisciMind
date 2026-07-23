// 教师端课程管理服务

const prisma = require('../config/prisma');
const {
  getAccessibleCourseIds,
  ensureCourseAccess,
  ensureTeachingClassAccess,
  getAccessibleTeachingClassIds,
  isAdmin,
} = require('./teacher-access.service');

// ---------- 辅助函数 ----------

function toLower(value) {
  if (value == null) return null;
  return String(value).toLowerCase();
}

// ---------- 课程 ----------

async function listCourses(user, query) {
  const accessibleIds = await getAccessibleCourseIds(user);
  const where = {};
  if (accessibleIds) where.course_id = { in: accessibleIds };

  const { keyword } = query;
  if (keyword) {
    where.OR = [
      { course_name: { contains: keyword } },
      { course_code: { contains: keyword } },
    ];
  }

  const courses = await prisma.course.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      teacher_relations: {
        include: {
          teacher: { include: { profile: true } },
        },
      },
      _count: {
        select: {
          teaching_classes: true,
          enrollments: true,
        },
      },
    },
  });

  return {
    list: courses.map((c) => ({
      course_id: c.course_id,
      course_name: c.course_name,
      course_code: c.course_code,
      subject_category: c.subject_category,
      description: c.description,
      cover_url: c.cover_url,
      status: toLower(c.status),
      teacher_list: c.teacher_relations.map((tr) => ({
        user_id: tr.teacher_user_id,
        real_name: tr.teacher?.profile?.real_name || tr.teacher?.username || null,
        teacher_role: toLower(tr.teacher_role),
      })),
      teaching_class_count: c._count.teaching_classes,
      student_count: c._count.enrollments,
      created_at: c.created_at.toISOString(),
    })),
    total: courses.length,
  };
}

async function createCourse(user, body) {
  const { course_name, course_code, subject_category, description, cover_url, status } = body;
  if (!course_name || !course_code) {
    throw Object.assign(new Error('课程名称和课程编码为必填项'), { code: 40001 });
  }

  const course = await prisma.course.create({
    data: {
      course_name,
      course_code,
      subject_category: subject_category || '计算机大类学科',
      description: description || null,
      cover_url: cover_url || null,
      status: status === 'archived' ? 'ARCHIVED' : 'ACTIVE',
    },
  });

  // 自动绑定创建者为教师
  await prisma.courseTeacherRelation.create({
    data: {
      course_id: course.course_id,
      teacher_user_id: user.user_id,
      teacher_role: 'MAIN_TEACHER',
    },
  });

  return {
    course_id: course.course_id,
    course_name: course.course_name,
  };
}

async function getCourse(user, courseId) {
  await ensureCourseAccess(user, courseId);

  const course = await prisma.course.findUnique({
    where: { course_id: courseId },
    include: {
      teacher_relations: {
        include: {
          teacher: { include: { profile: true } },
        },
      },
      teaching_classes: true,
      chapters: { orderBy: { chapter_order: 'asc' } },
      _count: { select: { enrollments: true, knowledge_points: true } },
    },
  });

  if (!course) throw Object.assign(new Error('课程不存在'), { code: 40002 });

  return {
    course_id: course.course_id,
    course_name: course.course_name,
    course_code: course.course_code,
    subject_category: course.subject_category,
    description: course.description,
    cover_url: course.cover_url,
    status: toLower(course.status),
    teacher_list: course.teacher_relations.map((tr) => ({
      user_id: tr.teacher_user_id,
      real_name: tr.teacher?.profile?.real_name || tr.teacher?.username || null,
      teacher_role: toLower(tr.teacher_role),
    })),
    teaching_classes: course.teaching_classes.map((tc) => ({
      teaching_class_id: tc.teaching_class_id,
      teaching_class_name: tc.teaching_class_name,
      semester: tc.semester,
      description: tc.description,
    })),
    chapters: course.chapters.map((ch) => ({
      chapter_id: ch.chapter_id,
      chapter_name: ch.chapter_name,
      chapter_order: ch.chapter_order,
      description: ch.description,
    })),
    student_count: course._count.enrollments,
    knowledge_point_count: course._count.knowledge_points,
    created_at: course.created_at.toISOString(),
  };
}

async function updateCourse(user, courseId, body) {
  await ensureCourseAccess(user, courseId);

  const { course_name, course_code, subject_category, description, cover_url, status } = body;
  const data = {};
  if (course_name !== undefined) data.course_name = course_name;
  if (course_code !== undefined) data.course_code = course_code;
  if (subject_category !== undefined) data.subject_category = subject_category;
  if (description !== undefined) data.description = description;
  if (cover_url !== undefined) data.cover_url = cover_url;
  if (status !== undefined) data.status = status === 'archived' ? 'ARCHIVED' : 'ACTIVE';

  if (Object.keys(data).length === 0) {
    throw Object.assign(new Error('没有需要更新的字段'), { code: 40001 });
  }

  const course = await prisma.course.update({
    where: { course_id: courseId },
    data,
  });

  return { course_id: course.course_id, course_name: course.course_name };
}

async function deleteCourse(user, courseId) {
  await ensureCourseAccess(user, courseId);
  await prisma.course.update({
    where: { course_id: courseId },
    data: { status: 'ARCHIVED' },
  });
}

// ---------- 教学班级 ----------

async function listTeachingClasses(user, courseId, query) {
  await ensureCourseAccess(user, courseId);

  const where = { course_id: courseId };
  if (!isAdmin(user)) {
    const classIds = await getAccessibleTeachingClassIds(user, { course_id: courseId });
    where.teaching_class_id = { in: classIds };
  }
  if (query.keyword) where.teaching_class_name = { contains: query.keyword };
  if (query.status) where.status = query.status;
  if (query.semester_id) where.course_offering = { semester_id: Number(query.semester_id) };

  const classes = await prisma.teachingClass.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      _count: { select: { enrollments: true } },
      course_offering: { include: { semester: true } },
      primary_teacher: { include: { profile: true } },
    },
  });

  return {
    list: classes.map((tc) => ({
      teaching_class_id: tc.teaching_class_id,
      teaching_class_name: tc.teaching_class_name,
      semester: tc.semester,
      description: tc.description,
      code: tc.code,
      schedule: tc.schedule,
      location: tc.location,
      capacity: tc.capacity,
      status: tc.status,
      course_offering_id: tc.course_offering_id,
      semester_id: tc.course_offering?.semester_id || null,
      semester_name: tc.course_offering?.semester?.name || tc.semester,
      teacher_user_id: tc.teacher_user_id,
      teacher_name: tc.primary_teacher?.profile?.real_name || tc.primary_teacher?.username || null,
      student_count: tc._count.enrollments,
      created_at: tc.created_at.toISOString(),
    })),
    total: classes.length,
  };
}

async function createTeachingClass(user, courseId, body) {
  await ensureCourseAccess(user, courseId);

  const {
    teaching_class_name, code, semester, semester_id, course_offering_id, description,
    schedule, location, capacity, status, teacher_user_id,
  } = body;
  if (!teaching_class_name) {
    throw Object.assign(new Error('教学班级名称为必填项'), { code: 40001 });
  }

  let offeringId = course_offering_id ? Number(course_offering_id) : null;
  if (offeringId) {
    const offering = await prisma.courseOffering.findFirst({
      where: { course_offering_id: offeringId, course_id: courseId },
    });
    if (!offering) throw Object.assign(new Error('课程开设不存在或不属于该课程'), { code: 40002 });
  } else if (semester_id) {
    const semesterId = Number(semester_id);
    const semesterRow = await prisma.academicSemester.findUnique({ where: { semester_id: semesterId } });
    if (!semesterRow) throw Object.assign(new Error('学期不存在'), { code: 40002 });
    const offering = await prisma.courseOffering.upsert({
      where: { course_id_semester_id: { course_id: courseId, semester_id: semesterId } },
      update: { status: 'active' },
      create: { course_id: courseId, semester_id: semesterId, start_date: semesterRow.start_date, end_date: semesterRow.end_date },
    });
    offeringId = offering.course_offering_id;
  }

  const primaryTeacherId = isAdmin(user) && teacher_user_id ? Number(teacher_user_id) : user.user_id;
  const tc = await prisma.$transaction(async (tx) => {
    const created = await tx.teachingClass.create({
      data: {
        course_id: courseId,
        course_offering_id: offeringId,
        teacher_user_id: primaryTeacherId,
        teaching_class_name,
        code: code || null,
        semester: semester || null,
        description: description || null,
        schedule: schedule || undefined,
        location: location || null,
        capacity: capacity ? Number(capacity) : null,
        status: status === 'archived' ? 'archived' : 'active',
      },
    });
    await tx.teachingClassTeacherAuthorization.upsert({
      where: { teaching_class_id_teacher_user_id: { teaching_class_id: created.teaching_class_id, teacher_user_id: primaryTeacherId } },
      update: { role: 'owner', status: 'active' },
      create: { teaching_class_id: created.teaching_class_id, teacher_user_id: primaryTeacherId, role: 'owner', granted_by_user_id: user.user_id },
    });
    return created;
  });

  return {
    teaching_class_id: tc.teaching_class_id,
    teaching_class_name: tc.teaching_class_name,
  };
}

async function updateTeachingClass(user, classId, body) {
  const tc = await ensureTeachingClassAccess(user, classId);
  const { teaching_class_name, code, semester, description, schedule, location, capacity, status, course_offering_id } = body;

  const data = {};
  if (teaching_class_name !== undefined) data.teaching_class_name = teaching_class_name;
  if (semester !== undefined) data.semester = semester;
  if (description !== undefined) data.description = description;
  if (code !== undefined) data.code = code || null;
  if (schedule !== undefined) data.schedule = schedule;
  if (location !== undefined) data.location = location || null;
  if (capacity !== undefined) data.capacity = capacity ? Number(capacity) : null;
  if (status !== undefined) {
    data.status = status;
    data.archived_at = status === 'archived' ? new Date() : null;
  }
  if (course_offering_id !== undefined) {
    if (course_offering_id) {
      const offering = await prisma.courseOffering.findFirst({ where: { course_offering_id: Number(course_offering_id), course_id: tc.course_id } });
      if (!offering) throw Object.assign(new Error('课程开设不存在或不属于该课程'), { code: 40002 });
    }
    data.course_offering_id = course_offering_id ? Number(course_offering_id) : null;
  }

  if (Object.keys(data).length === 0) {
    throw Object.assign(new Error('没有需要更新的字段'), { code: 40001 });
  }

  const updated = await prisma.teachingClass.update({
    where: { teaching_class_id: classId },
    data,
  });

  return { teaching_class_id: updated.teaching_class_id, teaching_class_name: updated.teaching_class_name };
}

async function deleteTeachingClass(user, classId) {
  await ensureTeachingClassAccess(user, classId);
  const counts = await prisma.teachingClass.findUnique({
    where: { teaching_class_id: classId },
    select: { _count: { select: { enrollments: true, learning_tasks: true } } },
  });
  if ((counts?._count?.enrollments || 0) > 0 || (counts?._count?.learning_tasks || 0) > 0) {
    await prisma.teachingClass.update({
      where: { teaching_class_id: classId },
      data: { status: 'archived', archived_at: new Date() },
    });
    return { archived: true };
  }
  await prisma.teachingClass.delete({ where: { teaching_class_id: classId } });
  return { archived: false };
}

async function listClassStudents(user, classId, query) {
  const tc = await ensureTeachingClassAccess(user, classId);

  const where = {
    teaching_class_id: classId,
    enrollment_status: 'active',
  };

  const enrollments = await prisma.studentCourseEnrollment.findMany({
    where,
    include: {
      student: {
        include: { profile: true },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return {
    list: enrollments.map((e) => ({
      student_user_id: e.student_user_id,
      student_name: e.student?.profile?.real_name || e.student?.username || null,
      student_no: e.student?.profile?.student_no || null,
      college: e.student?.profile?.college || null,
      major: e.student?.profile?.major || null,
      enrollment_status: e.enrollment_status,
      enrolled_at: e.created_at.toISOString(),
    })),
    total: enrollments.length,
    class: {
      teaching_class_id: tc.teaching_class_id,
      teaching_class_name: tc.teaching_class_name,
      course_id: tc.course_id,
    },
  };
}

async function addClassStudents(user, classId, body) {
  const tc = await ensureTeachingClassAccess(user, classId);
  const { student_user_ids } = body;
  if (!student_user_ids || !Array.isArray(student_user_ids) || student_user_ids.length === 0) {
    throw Object.assign(new Error('student_user_ids 为必填项，需传入学生 ID 数组'), { code: 40001 });
  }

  const validStudents = await prisma.user.findMany({
    where: { user_id: { in: student_user_ids.map(Number) }, role: 'STUDENT', status: 'ACTIVE' },
    select: { user_id: true },
  });
  const validStudentIds = new Set(validStudents.map((item) => item.user_id));
  const currentCount = await prisma.studentCourseEnrollment.count({ where: { teaching_class_id: classId, enrollment_status: 'active' } });
  if (tc.capacity && currentCount + validStudentIds.size > tc.capacity) {
    throw Object.assign(new Error(`超过教学班容量上限 ${tc.capacity}`), { code: 40001 });
  }

  const results = [];
  for (const studentUserId of student_user_ids) {
    const normalizedStudentId = Number(studentUserId);
    if (!validStudentIds.has(normalizedStudentId)) {
      results.push({ student_user_id: normalizedStudentId, success: false, reason: '学生不存在或账号不可用' });
      continue;
    }
    try {
      await prisma.studentCourseEnrollment.upsert({
        where: {
          student_user_id_course_id_teaching_class_id: {
            student_user_id: normalizedStudentId,
            course_id: tc.course_id,
            teaching_class_id: classId,
          },
        },
        update: {
          enrollment_status: 'active',
          joined_at: new Date(),
        },
        create: {
          student_user_id: normalizedStudentId,
          course_id: tc.course_id,
          teaching_class_id: classId,
          enrollment_status: 'active',
        },
      });
      results.push({ student_user_id: normalizedStudentId, success: true });
    } catch (err) {
      results.push({ student_user_id: studentUserId, success: false, reason: err.message });
    }
  }

  return { results };
}

async function removeClassStudent(user, classId, studentUserId) {
  const tc = await ensureTeachingClassAccess(user, classId);
  const enrollment = await prisma.studentCourseEnrollment.findUnique({
    where: {
      student_user_id_course_id_teaching_class_id: {
        student_user_id: studentUserId,
        course_id: tc.course_id,
        teaching_class_id: classId,
      },
    },
  });
  if (!enrollment) {
    throw Object.assign(new Error('该学生不在本班级中'), { code: 40002 });
  }
  await prisma.studentCourseEnrollment.delete({
    where: { enrollment_id: enrollment.enrollment_id },
  });
}

// ---------- 章节 ----------

async function listChapters(user, courseId) {
  await ensureCourseAccess(user, courseId);

  const chapters = await prisma.chapter.findMany({
    where: { course_id: courseId },
    orderBy: { chapter_order: 'asc' },
    include: {
      _count: { select: { knowledge_points: true } },
    },
  });

  return {
    list: chapters.map((ch) => ({
      chapter_id: ch.chapter_id,
      chapter_name: ch.chapter_name,
      chapter_order: ch.chapter_order,
      description: ch.description,
      knowledge_point_count: ch._count.knowledge_points,
      created_at: ch.created_at.toISOString(),
    })),
    total: chapters.length,
  };
}

async function createChapter(user, courseId, body) {
  await ensureCourseAccess(user, courseId);

  const { chapter_name, chapter_order, description } = body;
  if (!chapter_name) {
    throw Object.assign(new Error('章节名称为必填项'), { code: 40001 });
  }

  const chapter = await prisma.chapter.create({
    data: {
      course_id: courseId,
      chapter_name,
      chapter_order: chapter_order ?? 0,
      description: description || null,
    },
  });

  return {
    chapter_id: chapter.chapter_id,
    chapter_name: chapter.chapter_name,
    chapter_order: chapter.chapter_order,
  };
}

async function updateChapter(user, chapterId, body) {
  const chapter = await prisma.chapter.findUnique({ where: { chapter_id: chapterId } });
  if (!chapter) throw Object.assign(new Error('章节不存在'), { code: 40002 });
  await ensureCourseAccess(user, chapter.course_id);

  const { chapter_name, chapter_order, description } = body;
  const data = {};
  if (chapter_name !== undefined) data.chapter_name = chapter_name;
  if (chapter_order !== undefined) data.chapter_order = chapter_order;
  if (description !== undefined) data.description = description;

  const updated = await prisma.chapter.update({
    where: { chapter_id: chapterId },
    data,
  });

  return { chapter_id: updated.chapter_id, chapter_name: updated.chapter_name };
}

async function deleteChapter(user, chapterId) {
  const chapter = await prisma.chapter.findUnique({ where: { chapter_id: chapterId } });
  if (!chapter) throw Object.assign(new Error('章节不存在'), { code: 40002 });
  await ensureCourseAccess(user, chapter.course_id);
  await prisma.chapter.delete({ where: { chapter_id: chapterId } });
}

// ---------- 知识点 ----------

async function listKnowledgePoints(user, courseId, query) {
  await ensureCourseAccess(user, courseId);

  const where = { course_id: courseId };
  if (query.chapter_id) {
    where.chapter_id = Number.parseInt(query.chapter_id, 10) || undefined;
  }

  const kps = await prisma.knowledgePoint.findMany({
    where,
    orderBy: [{ sort_order: 'asc' }, { knowledge_point_id: 'asc' }],
    include: {
      chapter: { select: { chapter_id: true, chapter_name: true } },
      _count: { select: { questions: true } },
    },
  });

  return {
    list: kps.map((kp) => ({
      knowledge_point_id: kp.knowledge_point_id,
      knowledge_point_name: kp.knowledge_point_name,
      knowledge_point_code: kp.knowledge_point_code,
      chapter_id: kp.chapter_id,
      chapter_name: kp.chapter?.chapter_name || null,
      difficulty_level: toLower(kp.difficulty_level),
      description: kp.description,
      question_count: kp._count.questions,
      sort_order: kp.sort_order,
    })),
    total: kps.length,
  };
}

async function createKnowledgePoint(user, chapterId, body) {
  const chapter = await prisma.chapter.findUnique({ where: { chapter_id: chapterId } });
  if (!chapter) throw Object.assign(new Error('章节不存在'), { code: 40002 });
  await ensureCourseAccess(user, chapter.course_id);

  const { knowledge_point_name, knowledge_point_code, description, difficulty_level, sort_order, parent_id } = body;
  if (!knowledge_point_name || !knowledge_point_code) {
    throw Object.assign(new Error('知识点名称和编码为必填项'), { code: 40001 });
  }

  const kp = await prisma.knowledgePoint.create({
    data: {
      course_id: chapter.course_id,
      chapter_id: chapterId,
      knowledge_point_name,
      knowledge_point_code,
      description: description || null,
      difficulty_level: difficulty_level ? difficulty_level.toUpperCase() : 'BASIC',
      parent_id: parent_id || null,
      sort_order: sort_order ?? 0,
    },
  });

  return {
    knowledge_point_id: kp.knowledge_point_id,
    knowledge_point_name: kp.knowledge_point_name,
    knowledge_point_code: kp.knowledge_point_code,
  };
}

async function updateKnowledgePoint(user, kpId, body) {
  const kp = await prisma.knowledgePoint.findUnique({ where: { knowledge_point_id: kpId } });
  if (!kp) throw Object.assign(new Error('知识点不存在'), { code: 40002 });
  await ensureCourseAccess(user, kp.course_id);

  const { knowledge_point_name, description, difficulty_level, sort_order } = body;
  const data = {};
  if (knowledge_point_name !== undefined) data.knowledge_point_name = knowledge_point_name;
  if (description !== undefined) data.description = description;
  if (difficulty_level !== undefined) data.difficulty_level = difficulty_level.toUpperCase();
  if (sort_order !== undefined) data.sort_order = sort_order;

  const updated = await prisma.knowledgePoint.update({
    where: { knowledge_point_id: kpId },
    data,
  });

  return { knowledge_point_id: updated.knowledge_point_id, knowledge_point_name: updated.knowledge_point_name };
}

async function deleteKnowledgePoint(user, kpId) {
  const kp = await prisma.knowledgePoint.findUnique({ where: { knowledge_point_id: kpId } });
  if (!kp) throw Object.assign(new Error('知识点不存在'), { code: 40002 });
  await ensureCourseAccess(user, kp.course_id);
  await prisma.knowledgePoint.delete({ where: { knowledge_point_id: kpId } });
}

// ---------- 全局班级列表 ----------

async function listAllTeachingClasses(user, query) {
  const accessibleIds = await getAccessibleCourseIds(user);
  const where = {};
  if (accessibleIds) where.course_id = { in: accessibleIds };
  if (!isAdmin(user)) {
    const classIds = await getAccessibleTeachingClassIds(user);
    where.teaching_class_id = { in: classIds };
  }

  if (query.keyword) where.teaching_class_name = { contains: query.keyword };
  if (query.course_id) {
    const cid = Number.parseInt(query.course_id, 10) || undefined;
    if (cid) where.course_id = cid;
  }
  if (query.status) where.status = query.status;
  if (query.semester_id) where.course_offering = { semester_id: Number(query.semester_id) };

  const classes = await prisma.teachingClass.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: {
      course: { select: { course_id: true, course_name: true } },
      enrollments: {
        where: { enrollment_status: 'active' },
        select: { student_user_id: true },
      },
      _count: {
        select: {
          learning_tasks: true,
          knowledge_documents: {
            where: { deleted_at: null, is_teaching_resource: true },
          },
          question_bank_links: true,
        },
      },
      course_offering: { include: { semester: true } },
      primary_teacher: { include: { profile: true } },
    },
  });

  const classIds = classes.map((item) => item.teaching_class_id);
  const studentIds = [...new Set(classes.flatMap((item) => item.enrollments.map((enrollment) => enrollment.student_user_id)))];
  const courseIds = [...new Set(classes.map((item) => item.course_id))];
  const recentThreshold = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  const [portraits, recentTasks, interventions, masteryRows, activityRows, recipients, submissions] = classIds.length
    ? await Promise.all([
      studentIds.length
        ? prisma.studentPortrait.findMany({
          where: { student_user_id: { in: studentIds }, course_id: { in: courseIds } },
          select: {
            student_user_id: true,
            course_id: true,
            learning_total_score: true,
            progress_score: true,
          },
        })
        : [],
      prisma.learningTask.findMany({
        where: {
          teaching_class_id: { in: classIds },
          created_at: { gte: recentThreshold },
          task_type: { in: ['HOMEWORK', 'EXAM', 'QUIZ', 'PRACTICE'] },
        },
        select: { teaching_class_id: true },
      }),
      prisma.teacherStudentIntervention.findMany({
        where: { teaching_class_id: { in: classIds }, status: { not: 'closed' } },
        select: { teaching_class_id: true, student_user_id: true },
      }),
      studentIds.length
        ? prisma.studentMasteryRecord.groupBy({
          by: ['student_user_id', 'course_id'],
          where: { student_user_id: { in: studentIds }, course_id: { in: courseIds } },
          _avg: { mastery_score: true },
        })
        : [],
      studentIds.length
        ? prisma.studyRecord.groupBy({
          by: ['student_user_id', 'course_id'],
          where: { student_user_id: { in: studentIds }, course_id: { in: courseIds } },
          _count: { _all: true },
          _sum: { duration_seconds: true },
        })
        : [],
      prisma.learningTaskRecipient.findMany({
        where: { teaching_class_id: { in: classIds } },
        select: { teaching_class_id: true, student_user_id: true, task_id: true },
      }),
      prisma.taskSubmission.findMany({
        where: {
          student_user_id: { in: studentIds },
          submission_status: { in: ['SUBMITTED', 'GRADED'] },
          task: { teaching_class_id: { in: classIds } },
        },
        select: {
          student_user_id: true,
          task_id: true,
          task: { select: { teaching_class_id: true } },
        },
      }),
    ])
    : [[], [], [], [], [], [], []];

  const portraitByStudentCourse = new Map(
    portraits.map((item) => [`${item.student_user_id}:${item.course_id}`, item]),
  );
  const recentTaskCount = new Map();
  recentTasks.forEach((item) => recentTaskCount.set(
    item.teaching_class_id,
    (recentTaskCount.get(item.teaching_class_id) || 0) + 1,
  ));
  const interventionStudents = new Map();
  interventions.forEach((item) => {
    const students = interventionStudents.get(item.teaching_class_id) || new Set();
    students.add(item.student_user_id);
    interventionStudents.set(item.teaching_class_id, students);
  });
  const masteryByStudentCourse = new Map(masteryRows.map((item) => [
    `${item.student_user_id}:${item.course_id}`,
    Number(item._avg.mastery_score) || 0,
  ]));
  const activityByStudentCourse = new Map(activityRows.map((item) => {
    const count = item._count?._all || 0;
    const duration = item._sum?.duration_seconds || 0;
    return [`${item.student_user_id}:${item.course_id}`, Math.min(100, Math.round(count * 4 + (duration / 3600) * 3))];
  }));
  const recipientCountByClassStudent = new Map();
  recipients.forEach((item) => {
    const key = `${item.teaching_class_id}:${item.student_user_id}`;
    recipientCountByClassStudent.set(key, (recipientCountByClassStudent.get(key) || 0) + 1);
  });
  const submittedTasksByClassStudent = new Map();
  submissions.forEach((item) => {
    const key = `${item.task.teaching_class_id}:${item.student_user_id}`;
    const taskIds = submittedTasksByClassStudent.get(key) || new Set();
    taskIds.add(item.task_id);
    submittedTasksByClassStudent.set(key, taskIds);
  });

  return {
    list: classes.map((tc) => {
      const classPortraits = tc.enrollments
        .map((enrollment) => portraitByStudentCourse.get(`${enrollment.student_user_id}:${tc.course_id}`))
        .filter(Boolean);
      const progressValues = classPortraits
        .map((portrait) => Number(portrait.progress_score))
        .filter(Number.isFinite);
      const riskStudents = new Set(interventionStudents.get(tc.teaching_class_id) || []);
      tc.enrollments.forEach((enrollment) => {
        const portrait = portraitByStudentCourse.get(`${enrollment.student_user_id}:${tc.course_id}`);
        const studentCourseKey = `${enrollment.student_user_id}:${tc.course_id}`;
        const classStudentKey = `${tc.teaching_class_id}:${enrollment.student_user_id}`;
        const recipientCount = recipientCountByClassStudent.get(classStudentKey) || 0;
        const submittedCount = submittedTasksByClassStudent.get(classStudentKey)?.size || 0;
        const completionRate = recipientCount ? (submittedCount / recipientCount) * 100 : 100;
        const masteryScore = masteryByStudentCourse.get(studentCourseKey) || 0;
        const activityScore = activityByStudentCourse.get(studentCourseKey) || 0;
        const totalScore = Number(portrait?.learning_total_score) || 0;
        if (totalScore < 72 || completionRate < 70 || masteryScore < 50 || activityScore < 60) {
          riskStudents.add(enrollment.student_user_id);
        }
      });
      const learningProgress = progressValues.length
        ? Math.round(progressValues.reduce((sum, score) => sum + score, 0) / progressValues.length)
        : 0;

      return {
      teaching_class_id: tc.teaching_class_id,
      teaching_class_name: tc.teaching_class_name,
      semester: tc.semester,
      description: tc.description,
      code: tc.code,
      schedule: tc.schedule,
      location: tc.location,
      capacity: tc.capacity,
      status: tc.status,
      course_id: tc.course_id,
      course_name: tc.course?.course_name || null,
      student_count: tc.enrollments.length,
      recent_assignment_count: recentTaskCount.get(tc.teaching_class_id) || 0,
      task_count: tc._count.learning_tasks,
      learning_progress: learningProgress,
      risk_student_count: riskStudents.size,
      resource_count: tc._count.knowledge_documents,
      question_bank_count: tc._count.question_bank_links,
      course_offering_id: tc.course_offering_id,
      semester_id: tc.course_offering?.semester_id || null,
      semester_name: tc.course_offering?.semester?.name || tc.semester,
      teacher_user_id: tc.teacher_user_id,
      teacher_name: tc.primary_teacher?.profile?.real_name || tc.primary_teacher?.username || null,
      created_at: tc.created_at.toISOString(),
      };
    }),
    total: classes.length,
  };
}

async function listSemesters(user, query = {}) {
  const where = {};
  if (query.status) where.status = query.status;
  const list = await prisma.academicSemester.findMany({ where, orderBy: { start_date: 'desc' } });
  return {
    list: list.map((item) => ({
      semester_id: item.semester_id,
      code: item.code,
      name: item.name,
      start_date: item.start_date.toISOString(),
      end_date: item.end_date.toISOString(),
      status: item.status,
    })),
    total: list.length,
  };
}

async function createSemester(user, body) {
  const { code, name, start_date, end_date } = body;
  if (!code || !name || !start_date || !end_date) {
    throw Object.assign(new Error('code、name、start_date、end_date 为必填项'), { code: 40001 });
  }
  return prisma.academicSemester.upsert({
    where: { code },
    update: { name, start_date: new Date(start_date), end_date: new Date(end_date), status: body.status || 'active' },
    create: { code, name, start_date: new Date(start_date), end_date: new Date(end_date), status: body.status || 'active' },
  });
}

async function listCourseOfferings(user, courseId, query = {}) {
  await ensureCourseAccess(user, courseId);
  const where = { course_id: courseId };
  if (query.status) where.status = query.status;
  if (query.semester_id) where.semester_id = Number(query.semester_id);
  const list = await prisma.courseOffering.findMany({
    where,
    include: { semester: true, _count: { select: { teaching_classes: true } } },
    orderBy: { created_at: 'desc' },
  });
  return {
    list: list.map((item) => ({
      course_offering_id: item.course_offering_id,
      course_id: item.course_id,
      semester_id: item.semester_id,
      semester_name: item.semester.name,
      start_date: item.start_date?.toISOString() || null,
      end_date: item.end_date?.toISOString() || null,
      teaching_progress: item.teaching_progress,
      status: item.status,
      teaching_class_count: item._count.teaching_classes,
    })),
    total: list.length,
  };
}

async function createCourseOffering(user, courseId, body) {
  await ensureCourseAccess(user, courseId);
  const semesterId = Number(body.semester_id);
  if (!semesterId) throw Object.assign(new Error('semester_id 为必填项'), { code: 40001 });
  const semester = await prisma.academicSemester.findUnique({ where: { semester_id: semesterId } });
  if (!semester) throw Object.assign(new Error('学期不存在'), { code: 40002 });
  const offering = await prisma.courseOffering.upsert({
    where: { course_id_semester_id: { course_id: courseId, semester_id: semesterId } },
    update: {
      start_date: body.start_date ? new Date(body.start_date) : semester.start_date,
      end_date: body.end_date ? new Date(body.end_date) : semester.end_date,
      teaching_progress: body.teaching_progress || undefined,
      status: body.status || 'active',
    },
    create: {
      course_id: courseId,
      semester_id: semesterId,
      start_date: body.start_date ? new Date(body.start_date) : semester.start_date,
      end_date: body.end_date ? new Date(body.end_date) : semester.end_date,
      teaching_progress: body.teaching_progress || undefined,
      status: body.status || 'active',
    },
  });
  return { course_offering_id: offering.course_offering_id, course_id: courseId, semester_id: semesterId };
}

async function listAdministrativeClasses(user, query = {}) {
  const classIds = await getAccessibleTeachingClassIds(user);
  const where = {};
  if (!isAdmin(user)) {
    where.students = {
      some: {
        user: {
          student_course_enrollments: {
            some: { teaching_class_id: { in: classIds }, enrollment_status: 'active' },
          },
        },
      },
    };
  }
  if (query.keyword) where.class_name = { contains: query.keyword };
  if (query.grade) where.grade = query.grade;
  if (query.major_id) where.major_id = Number(query.major_id);
  if (query.status) where.status = query.status;
  const rows = await prisma.adminClass.findMany({
    where,
    include: {
      college_entity: true,
      major_entity: true,
      advisor: { include: { profile: true } },
      _count: { select: { students: true } },
    },
    orderBy: [{ grade: 'desc' }, { class_name: 'asc' }],
  });
  return {
    list: rows.map((item) => ({
      administrative_class_id: item.admin_class_id,
      name: item.class_name,
      college_id: item.college_id,
      college: item.college_entity?.name || item.college,
      major_id: item.major_id,
      major: item.major_entity?.name || item.major,
      grade: item.grade,
      advisor_user_id: item.advisor_user_id,
      advisor_name: item.advisor?.profile?.real_name || item.advisor?.username || null,
      status: item.status,
      student_count: item._count.students,
    })),
    total: rows.length,
  };
}

async function listAdministrativeClassStudents(user, adminClassId) {
  const classIds = await getAccessibleTeachingClassIds(user);
  const where = { admin_class_id: adminClassId, user: { role: 'STUDENT', status: 'ACTIVE' } };
  if (!isAdmin(user)) {
    where.user.student_course_enrollments = { some: { teaching_class_id: { in: classIds }, enrollment_status: 'active' } };
  }
  const rows = await prisma.userProfile.findMany({ where, include: { user: true }, orderBy: { student_no: 'asc' } });
  return {
    list: rows.map((item) => ({
      student_user_id: item.user_id,
      student_name: item.real_name,
      student_no: item.student_no,
      major: item.major,
      grade: item.grade,
    })),
    total: rows.length,
  };
}

async function importAdministrativeClasses(user, teachingClassId, body) {
  await ensureTeachingClassAccess(user, teachingClassId);
  const adminClassIds = Array.isArray(body.admin_class_ids) ? body.admin_class_ids.map(Number).filter(Boolean) : [];
  if (!adminClassIds.length) throw Object.assign(new Error('admin_class_ids 为必填项'), { code: 40001 });
  const profiles = await prisma.userProfile.findMany({
    where: { admin_class_id: { in: adminClassIds }, user: { role: 'STUDENT', status: 'ACTIVE' } },
    select: { user_id: true },
  });
  const result = await addClassStudents(user, teachingClassId, { student_user_ids: profiles.map((item) => item.user_id) });
  await prisma.teachingClassAdminClass.createMany({
    data: adminClassIds.map((adminClassId) => ({ teaching_class_id: teachingClassId, admin_class_id: adminClassId })),
    skipDuplicates: true,
  });
  return { ...result, imported_count: result.results.filter((item) => item.success).length };
}

async function batchRemoveClassStudents(user, teachingClassId, body) {
  const tc = await ensureTeachingClassAccess(user, teachingClassId);
  const studentIds = Array.isArray(body.student_user_ids) ? body.student_user_ids.map(Number).filter(Boolean) : [];
  if (!studentIds.length) throw Object.assign(new Error('student_user_ids 为必填项'), { code: 40001 });
  const result = await prisma.studentCourseEnrollment.updateMany({
    where: { teaching_class_id: teachingClassId, course_id: tc.course_id, student_user_id: { in: studentIds } },
    data: { enrollment_status: 'removed' },
  });
  return { removed_count: result.count };
}

async function importClassRosterRows(user, teachingClassId, body) {
  await ensureTeachingClassAccess(user, teachingClassId);
  const studentNos = (Array.isArray(body.rows) ? body.rows : [])
    .map((row) => String(row.student_no || '').trim())
    .filter(Boolean);
  if (!studentNos.length) throw Object.assign(new Error('CSV 行中缺少 student_no'), { code: 40001 });
  const profiles = await prisma.userProfile.findMany({
    where: { student_no: { in: studentNos }, user: { role: 'STUDENT', status: 'ACTIVE' } },
    select: { user_id: true, student_no: true },
  });
  const result = await addClassStudents(user, teachingClassId, { student_user_ids: profiles.map((item) => item.user_id) });
  const found = new Set(profiles.map((item) => item.student_no));
  return { ...result, missing_student_nos: studentNos.filter((item) => !found.has(item)) };
}

async function getClassRoster(user, teachingClassId) {
  const data = await listClassStudents(user, teachingClassId, {});
  return data.list;
}

module.exports = {
  listCourses,
  createCourse,
  getCourse,
  updateCourse,
  deleteCourse,
  listTeachingClasses,
  listAllTeachingClasses,
  createTeachingClass,
  updateTeachingClass,
  deleteTeachingClass,
  listClassStudents,
  addClassStudents,
  removeClassStudent,
  listChapters,
  createChapter,
  updateChapter,
  deleteChapter,
  listKnowledgePoints,
  createKnowledgePoint,
  updateKnowledgePoint,
  deleteKnowledgePoint,
  listSemesters,
  createSemester,
  listCourseOfferings,
  createCourseOffering,
  listAdministrativeClasses,
  listAdministrativeClassStudents,
  importAdministrativeClasses,
  batchRemoveClassStudents,
  importClassRosterRows,
  getClassRoster,
};
