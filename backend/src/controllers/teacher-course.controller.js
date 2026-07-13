// 教师端课程管理控制器

const { success, fail } = require('../utils/response');
const teacherCourseService = require('../services/teacher-course.service');

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    const err = new Error(`${name} 参数不合法`);
    err.code = 40001;
    throw err;
  }
  return parsed;
}

function handleError(res, scope, err) {
  console.error(`[teacher-course.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

// ---- 课程 ----

async function listCourses(req, res) {
  try {
    const data = await teacherCourseService.listCourses(req.user, req.query || {});
    return success(res, data, '获取课程列表成功');
  } catch (err) {
    return handleError(res, 'listCourses', err);
  }
}

async function createCourse(req, res) {
  try {
    const data = await teacherCourseService.createCourse(req.user, req.body || {});
    return success(res, data, '创建课程成功');
  } catch (err) {
    return handleError(res, 'createCourse', err);
  }
}

async function getCourse(req, res) {
  try {
    const courseId = parsePositiveInt(req.params.course_id, 'course_id');
    const data = await teacherCourseService.getCourse(req.user, courseId);
    return success(res, data, '获取课程详情成功');
  } catch (err) {
    return handleError(res, 'getCourse', err);
  }
}

async function updateCourse(req, res) {
  try {
    const courseId = parsePositiveInt(req.params.course_id, 'course_id');
    const data = await teacherCourseService.updateCourse(req.user, courseId, req.body || {});
    return success(res, data, '更新课程成功');
  } catch (err) {
    return handleError(res, 'updateCourse', err);
  }
}

async function deleteCourse(req, res) {
  try {
    const courseId = parsePositiveInt(req.params.course_id, 'course_id');
    await teacherCourseService.deleteCourse(req.user, courseId);
    return success(res, null, '删除课程成功');
  } catch (err) {
    return handleError(res, 'deleteCourse', err);
  }
}

// ---- 教学班级 ----

async function listTeachingClasses(req, res) {
  try {
    const courseId = parsePositiveInt(req.params.course_id, 'course_id');
    const data = await teacherCourseService.listTeachingClasses(req.user, courseId, req.query || {});
    return success(res, data, '获取教学班级列表成功');
  } catch (err) {
    return handleError(res, 'listTeachingClasses', err);
  }
}

async function createTeachingClass(req, res) {
  try {
    const courseId = parsePositiveInt(req.params.course_id, 'course_id');
    const data = await teacherCourseService.createTeachingClass(req.user, courseId, req.body || {});
    return success(res, data, '创建教学班级成功');
  } catch (err) {
    return handleError(res, 'createTeachingClass', err);
  }
}

async function updateTeachingClass(req, res) {
  try {
    const classId = parsePositiveInt(req.params.class_id, 'class_id');
    const data = await teacherCourseService.updateTeachingClass(req.user, classId, req.body || {});
    return success(res, data, '更新教学班级成功');
  } catch (err) {
    return handleError(res, 'updateTeachingClass', err);
  }
}

async function deleteTeachingClass(req, res) {
  try {
    const classId = parsePositiveInt(req.params.class_id, 'class_id');
    await teacherCourseService.deleteTeachingClass(req.user, classId);
    return success(res, null, '删除教学班级成功');
  } catch (err) {
    return handleError(res, 'deleteTeachingClass', err);
  }
}

async function listClassStudents(req, res) {
  try {
    const classId = parsePositiveInt(req.params.class_id, 'class_id');
    const data = await teacherCourseService.listClassStudents(req.user, classId, req.query || {});
    return success(res, data, '获取班级学生列表成功');
  } catch (err) {
    return handleError(res, 'listClassStudents', err);
  }
}

async function addClassStudents(req, res) {
  try {
    const classId = parsePositiveInt(req.params.class_id, 'class_id');
    const data = await teacherCourseService.addClassStudents(req.user, classId, req.body || {});
    return success(res, data, '添加学生成功');
  } catch (err) {
    return handleError(res, 'addClassStudents', err);
  }
}

async function removeClassStudent(req, res) {
  try {
    const classId = parsePositiveInt(req.params.class_id, 'class_id');
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    await teacherCourseService.removeClassStudent(req.user, classId, studentUserId);
    return success(res, null, '移除学生成功');
  } catch (err) {
    return handleError(res, 'removeClassStudent', err);
  }
}

// ---- 章节 ----

async function listChapters(req, res) {
  try {
    const courseId = parsePositiveInt(req.params.course_id, 'course_id');
    const data = await teacherCourseService.listChapters(req.user, courseId);
    return success(res, data, '获取章节列表成功');
  } catch (err) {
    return handleError(res, 'listChapters', err);
  }
}

async function createChapter(req, res) {
  try {
    const courseId = parsePositiveInt(req.params.course_id, 'course_id');
    const data = await teacherCourseService.createChapter(req.user, courseId, req.body || {});
    return success(res, data, '创建章节成功');
  } catch (err) {
    return handleError(res, 'createChapter', err);
  }
}

async function updateChapter(req, res) {
  try {
    const chapterId = parsePositiveInt(req.params.chapter_id, 'chapter_id');
    const data = await teacherCourseService.updateChapter(req.user, chapterId, req.body || {});
    return success(res, data, '更新章节成功');
  } catch (err) {
    return handleError(res, 'updateChapter', err);
  }
}

async function deleteChapter(req, res) {
  try {
    const chapterId = parsePositiveInt(req.params.chapter_id, 'chapter_id');
    await teacherCourseService.deleteChapter(req.user, chapterId);
    return success(res, null, '删除章节成功');
  } catch (err) {
    return handleError(res, 'deleteChapter', err);
  }
}

// ---- 知识点 ----

async function listKnowledgePoints(req, res) {
  try {
    const courseId = parsePositiveInt(req.params.course_id, 'course_id');
    const data = await teacherCourseService.listKnowledgePoints(req.user, courseId, req.query || {});
    return success(res, data, '获取知识点列表成功');
  } catch (err) {
    return handleError(res, 'listKnowledgePoints', err);
  }
}

async function createKnowledgePoint(req, res) {
  try {
    const chapterId = parsePositiveInt(req.params.chapter_id, 'chapter_id');
    const data = await teacherCourseService.createKnowledgePoint(req.user, chapterId, req.body || {});
    return success(res, data, '创建知识点成功');
  } catch (err) {
    return handleError(res, 'createKnowledgePoint', err);
  }
}

async function updateKnowledgePoint(req, res) {
  try {
    const kpId = parsePositiveInt(req.params.kp_id, 'kp_id');
    const data = await teacherCourseService.updateKnowledgePoint(req.user, kpId, req.body || {});
    return success(res, data, '更新知识点成功');
  } catch (err) {
    return handleError(res, 'updateKnowledgePoint', err);
  }
}

async function deleteKnowledgePoint(req, res) {
  try {
    const kpId = parsePositiveInt(req.params.kp_id, 'kp_id');
    await teacherCourseService.deleteKnowledgePoint(req.user, kpId);
    return success(res, null, '删除知识点成功');
  } catch (err) {
    return handleError(res, 'deleteKnowledgePoint', err);
  }
}

// ---- 全局班级列表（跨课程）----

async function listAllTeachingClasses(req, res) {
  try {
    const data = await teacherCourseService.listAllTeachingClasses(req.user, req.query || {});
    return success(res, data, '获取班级列表成功');
  } catch (err) {
    return handleError(res, 'listAllTeachingClasses', err);
  }
}

module.exports = {
  listCourses,
  createCourse,
  getCourse,
  updateCourse,
  deleteCourse,
  listAllTeachingClasses,
  listTeachingClasses,
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
};
