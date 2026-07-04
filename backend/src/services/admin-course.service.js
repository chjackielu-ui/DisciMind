// 管理员端课程管理服务
// 提供课程、章节、知识点的完整 CRUD

const prisma = require('../config/prisma');

// ======================== 课程管理 ========================

/**
 * 获取课程列表（分页 + 搜索）
 */
async function getCourseList(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 10));
  const skip = (page - 1) * pageSize;

  const where = {};

  if (query.keyword) {
    const keyword = String(query.keyword).trim();
    where.OR = [
      { course_name: { contains: keyword } },
      { course_code: { contains: keyword } },
    ];
  }

  if (query.subject_category) {
    where.subject_category = { contains: String(query.subject_category) };
  }

  if (query.status) {
    where.status = query.status === 'active' ? 'ACTIVE' : 'ARCHIVED';
  }

  const [courses, total] = await Promise.all([
    prisma.course.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.course.count({ where }),
  ]);

  // 补充统计信息
  const list = await Promise.all(courses.map(async (course) => {
    const [teacherCount, chapterCount, studentCount] = await Promise.all([
      prisma.courseTeacherRelation.count({
        where: { course_id: course.course_id },
      }),
      prisma.chapter.count({
        where: { course_id: course.course_id },
      }),
      prisma.studentCourseEnrollment.count({
        where: { course_id: course.course_id, enrollment_status: 'active' },
      }),
    ]);

    return {
      course_id: course.course_id,
      course_name: course.course_name,
      course_code: course.course_code,
      subject_category: course.subject_category,
      description: course.description,
      cover_url: course.cover_url,
      status: course.status === 'ACTIVE' ? 'active' : 'archived',
      teacher_count: teacherCount,
      chapter_count: chapterCount,
      student_count: studentCount,
      created_at: course.created_at,
    };
  }));

  return { list, total, page, page_size: pageSize };
}

/**
 * 创建课程
 */
async function createCourse(data) {
  const existing = await prisma.course.findUnique({
    where: { course_code: data.course_code },
  });
  if (existing) {
    throw Object.assign(new Error('课程编码已存在'), { code: 40003 });
  }

  const course = await prisma.course.create({
    data: {
      course_name: data.course_name,
      course_code: data.course_code,
      subject_category: data.subject_category,
      description: data.description || null,
      cover_url: data.cover_url || null,
      status: data.status === 'archived' ? 'ARCHIVED' : 'ACTIVE',
    },
  });

  return formatCourse(course);
}

/**
 * 获取课程详情
 */
async function getCourseDetail(courseId) {
  const course = await prisma.course.findUnique({
    where: { course_id: courseId },
  });
  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  const [teachers, teachingClasses] = await Promise.all([
    prisma.courseTeacherRelation.findMany({
      where: { course_id: courseId },
      include: {
        teacher: { include: { profile: true } },
      },
    }),
    prisma.teachingClass.findMany({
      where: { course_id: courseId },
      orderBy: { created_at: 'asc' },
    }),
  ]);

  // 获取每个教学班的学生数
  const teachingClassesWithCount = await Promise.all(
    teachingClasses.map(async (tc) => {
      const count = await prisma.studentCourseEnrollment.count({
        where: { teaching_class_id: tc.teaching_class_id, enrollment_status: 'active' },
      });
      return {
        teaching_class_id: tc.teaching_class_id,
        teaching_class_name: tc.teaching_class_name,
        semester: tc.semester,
        description: tc.description,
        student_count: count,
        created_at: tc.created_at,
      };
    })
  );

  return {
    course_id: course.course_id,
    course_name: course.course_name,
    course_code: course.course_code,
    subject_category: course.subject_category,
    description: course.description,
    cover_url: course.cover_url,
    status: course.status === 'ACTIVE' ? 'active' : 'archived',
    created_at: course.created_at,
    teachers: teachers.map((t) => ({
      user_id: t.teacher_user_id,
      real_name: t.teacher?.profile?.real_name || t.teacher?.username || null,
      teacher_role: t.teacher_role === 'MAIN_TEACHER' ? 'main_teacher'
        : t.teacher_role === 'ASSISTANT' ? 'assistant' : 'manager',
    })),
    teaching_classes: teachingClassesWithCount,
  };
}

/**
 * 更新课程
 */
async function updateCourse(courseId, data) {
  const course = await prisma.course.findUnique({ where: { course_id: courseId } });
  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  const updateData = {};
  if (data.course_name !== undefined) updateData.course_name = data.course_name;
  if (data.course_code !== undefined) updateData.course_code = data.course_code;
  if (data.subject_category !== undefined) updateData.subject_category = data.subject_category;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.cover_url !== undefined) updateData.cover_url = data.cover_url;
  if (data.status !== undefined) {
    updateData.status = data.status === 'archived' ? 'ARCHIVED' : 'ACTIVE';
  }

  const updated = await prisma.course.update({
    where: { course_id: courseId },
    data: updateData,
  });

  return formatCourse(updated);
}

/**
 * 删除课程（归档）
 */
async function deleteCourse(courseId) {
  const course = await prisma.course.findUnique({ where: { course_id: courseId } });
  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  await prisma.course.update({
    where: { course_id: courseId },
    data: { status: 'ARCHIVED' },
  });

  return { course_id: courseId };
}

/**
 * 绑定课程教师
 */
async function bindTeacher(courseId, teacherUserId, teacherRole) {
  const course = await prisma.course.findUnique({ where: { course_id: courseId } });
  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  const teacher = await prisma.user.findUnique({ where: { user_id: teacherUserId } });
  if (!teacher || teacher.role !== 'TEACHER') {
    throw Object.assign(new Error('教师用户不存在'), { code: 40002 });
  }

  const roleMap = { main_teacher: 'MAIN_TEACHER', assistant: 'ASSISTANT', manager: 'MANAGER' };
  const prismaRole = roleMap[teacherRole];
  if (!prismaRole) {
    throw Object.assign(new Error('无效的教师角色'), { code: 40001 });
  }

  const existing = await prisma.courseTeacherRelation.findUnique({
    where: { course_id_teacher_user_id: { course_id: courseId, teacher_user_id: teacherUserId } },
  });

  if (existing) {
    // 已存在则更新角色
    await prisma.courseTeacherRelation.update({
      where: { course_id_teacher_user_id: { course_id: courseId, teacher_user_id: teacherUserId } },
      data: { teacher_role: prismaRole },
    });
  } else {
    await prisma.courseTeacherRelation.create({
      data: {
        course_id: courseId,
        teacher_user_id: teacherUserId,
        teacher_role: prismaRole,
      },
    });
  }

  return { course_id: courseId, teacher_user_id: teacherUserId, teacher_role: teacherRole };
}

/**
 * 解绑课程教师
 */
async function unbindTeacher(courseId, teacherUserId) {
  const relation = await prisma.courseTeacherRelation.findUnique({
    where: { course_id_teacher_user_id: { course_id: courseId, teacher_user_id: teacherUserId } },
  });

  if (!relation) {
    throw Object.assign(new Error('该教师未绑定此课程'), { code: 40002 });
  }

  await prisma.courseTeacherRelation.delete({
    where: { course_id_teacher_user_id: { course_id: courseId, teacher_user_id: teacherUserId } },
  });

  return { course_id: courseId, teacher_user_id: teacherUserId };
}

// ======================== 章节管理 ========================

/**
 * 获取章节列表
 */
async function getChapterList(courseId) {
  const chapters = await prisma.chapter.findMany({
    where: { course_id: courseId },
    orderBy: { chapter_order: 'asc' },
  });

  const list = await Promise.all(chapters.map(async (ch) => {
    const kpCount = await prisma.knowledgePoint.count({
      where: { chapter_id: ch.chapter_id },
    });
    return {
      chapter_id: ch.chapter_id,
      course_id: ch.course_id,
      chapter_name: ch.chapter_name,
      chapter_order: ch.chapter_order,
      description: ch.description,
      knowledge_point_count: kpCount,
      created_at: ch.created_at,
    };
  }));

  return list;
}

/**
 * 创建章节
 */
async function createChapter(courseId, data) {
  const course = await prisma.course.findUnique({ where: { course_id: courseId } });
  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  const chapter = await prisma.chapter.create({
    data: {
      course_id: courseId,
      chapter_name: data.chapter_name,
      chapter_order: data.chapter_order || 0,
      description: data.description || null,
    },
  });

  return {
    chapter_id: chapter.chapter_id,
    course_id: chapter.course_id,
    chapter_name: chapter.chapter_name,
    chapter_order: chapter.chapter_order,
    description: chapter.description,
    created_at: chapter.created_at,
  };
}

/**
 * 更新章节
 */
async function updateChapter(chapterId, data) {
  const chapter = await prisma.chapter.findUnique({ where: { chapter_id: chapterId } });
  if (!chapter) {
    throw Object.assign(new Error('章节不存在'), { code: 40002 });
  }

  const updateData = {};
  if (data.chapter_name !== undefined) updateData.chapter_name = data.chapter_name;
  if (data.chapter_order !== undefined) updateData.chapter_order = data.chapter_order;
  if (data.description !== undefined) updateData.description = data.description;

  const updated = await prisma.chapter.update({
    where: { chapter_id: chapterId },
    data: updateData,
  });

  return {
    chapter_id: updated.chapter_id,
    course_id: updated.course_id,
    chapter_name: updated.chapter_name,
    chapter_order: updated.chapter_order,
    description: updated.description,
    created_at: updated.created_at,
  };
}

/**
 * 删除章节
 */
async function deleteChapter(chapterId) {
  const chapter = await prisma.chapter.findUnique({ where: { chapter_id: chapterId } });
  if (!chapter) {
    throw Object.assign(new Error('章节不存在'), { code: 40002 });
  }

  await prisma.chapter.delete({ where: { chapter_id: chapterId } });
  return { chapter_id: chapterId };
}

// ======================== 知识点管理 ========================

/**
 * 获取知识点列表
 */
async function getKnowledgePointList(courseId, query = {}) {
  const where = { course_id: courseId };

  if (query.chapter_id) {
    where.chapter_id = parseInt(query.chapter_id, 10);
  }

  const points = await prisma.knowledgePoint.findMany({
    where,
    include: { aliases: true },
    orderBy: { sort_order: 'asc' },
  });

  return points.map((kp) => ({
    knowledge_point_id: kp.knowledge_point_id,
    course_id: kp.course_id,
    chapter_id: kp.chapter_id,
    parent_id: kp.parent_id,
    knowledge_point_name: kp.knowledge_point_name,
    knowledge_point_code: kp.knowledge_point_code,
    description: kp.description,
    difficulty_level: kp.difficulty_level === 'BASIC' ? 'basic'
      : kp.difficulty_level === 'MEDIUM' ? 'medium' : 'hard',
    sort_order: kp.sort_order,
    aliases: kp.aliases.map((a) => a.alias_text),
    created_at: kp.created_at,
  }));
}

/**
 * 创建知识点
 */
async function createKnowledgePoint(data) {
  const course = await prisma.course.findUnique({ where: { course_id: data.course_id } });
  if (!course) {
    throw Object.assign(new Error('课程不存在'), { code: 40002 });
  }

  if (data.chapter_id) {
    const chapter = await prisma.chapter.findUnique({ where: { chapter_id: data.chapter_id } });
    if (!chapter) {
      throw Object.assign(new Error('章节不存在'), { code: 40002 });
    }
  }

  const difficultyMap = { basic: 'BASIC', medium: 'MEDIUM', hard: 'HARD' };
  const prismaDifficulty = difficultyMap[data.difficulty_level] || 'BASIC';

  const point = await prisma.knowledgePoint.create({
    data: {
      course_id: data.course_id,
      chapter_id: data.chapter_id || null,
      parent_id: data.parent_id || null,
      knowledge_point_name: data.knowledge_point_name,
      knowledge_point_code: data.knowledge_point_code,
      description: data.description || null,
      difficulty_level: prismaDifficulty,
      sort_order: data.sort_order || 0,
    },
  });

  // 创建别名
  if (data.aliases && Array.isArray(data.aliases) && data.aliases.length > 0) {
    for (const alias of data.aliases) {
      await prisma.knowledgePointAlias.create({
        data: {
          knowledge_point_id: point.knowledge_point_id,
          alias_text: alias,
          source: 'manual',
        },
      }).catch(() => {}); // 忽略重复别名
    }
  }

  return {
    knowledge_point_id: point.knowledge_point_id,
    course_id: point.course_id,
    chapter_id: point.chapter_id,
    knowledge_point_name: point.knowledge_point_name,
    knowledge_point_code: point.knowledge_point_code,
    created_at: point.created_at,
  };
}

/**
 * 更新知识点
 */
async function updateKnowledgePoint(pointId, data) {
  const point = await prisma.knowledgePoint.findUnique({ where: { knowledge_point_id: pointId } });
  if (!point) {
    throw Object.assign(new Error('知识点不存在'), { code: 40002 });
  }

  const updateData = {};
  if (data.knowledge_point_name !== undefined) updateData.knowledge_point_name = data.knowledge_point_name;
  if (data.knowledge_point_code !== undefined) updateData.knowledge_point_code = data.knowledge_point_code;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.chapter_id !== undefined) updateData.chapter_id = data.chapter_id;
  if (data.parent_id !== undefined) updateData.parent_id = data.parent_id;
  if (data.sort_order !== undefined) updateData.sort_order = data.sort_order;
  if (data.difficulty_level !== undefined) {
    const dm = { basic: 'BASIC', medium: 'MEDIUM', hard: 'HARD' };
    updateData.difficulty_level = dm[data.difficulty_level] || 'BASIC';
  }

  const updated = await prisma.knowledgePoint.update({
    where: { knowledge_point_id: pointId },
    data: updateData,
  });

  // 更新别名
  if (data.aliases && Array.isArray(data.aliases)) {
    await prisma.knowledgePointAlias.deleteMany({
      where: { knowledge_point_id: pointId, source: 'manual' },
    });
    for (const alias of data.aliases) {
      await prisma.knowledgePointAlias.create({
        data: { knowledge_point_id: pointId, alias_text: alias, source: 'manual' },
      }).catch(() => {});
    }
  }

  return { knowledge_point_id: updated.knowledge_point_id };
}

/**
 * 删除知识点
 */
async function deleteKnowledgePoint(pointId) {
  const point = await prisma.knowledgePoint.findUnique({ where: { knowledge_point_id: pointId } });
  if (!point) {
    throw Object.assign(new Error('知识点不存在'), { code: 40002 });
  }

  await prisma.knowledgePoint.delete({ where: { knowledge_point_id: pointId } });
  return { knowledge_point_id: pointId };
}

// ======================== 辅助函数 ========================

function formatCourse(course) {
  return {
    course_id: course.course_id,
    course_name: course.course_name,
    course_code: course.course_code,
    subject_category: course.subject_category,
    description: course.description,
    cover_url: course.cover_url,
    status: course.status === 'ACTIVE' ? 'active' : 'archived',
    created_at: course.created_at,
  };
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
