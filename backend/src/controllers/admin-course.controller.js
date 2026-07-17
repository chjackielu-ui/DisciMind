// 管理员端课程管理控制器
// 包含课程、章节、知识点的 CRUD

const { success, fail } = require('../utils/response');
const courseService = require('../services/admin-course.service');

function parseId(value, name) {
  const id = parseInt(value, 10);
  if (!id || id < 1) {
    throw Object.assign(new Error(`${name} 不合法`), { code: 40001 });
  }
  return id;
}

async function handleError(res, scope, err) {
  console.error(`[admin-course] ${scope} error:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

// ==================== 课程 ====================

async function getCourseList(req, res) {
  try {
    const data = await courseService.getCourseList(req.query || {});
    return success(res, data, '获取课程列表成功');
  } catch (err) {
    return handleError(res, 'getCourseList', err);
  }
}

async function createCourse(req, res) {
  try {
    const { course_name, course_code, subject_category, description, cover_url, status } = req.body;
    if (!course_name || !course_code || !subject_category) {
      return fail(res, 40001, '课程名称、课程编码、学科分类为必填项');
    }
    const data = await courseService.createCourse({ course_name, course_code, subject_category, description, cover_url, status }, req);
    return success(res, data, '课程创建成功');
  } catch (err) {
    return handleError(res, 'createCourse', err);
  }
}

async function getCourseDetail(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const data = await courseService.getCourseDetail(courseId);
    return success(res, data, '获取课程详情成功');
  } catch (err) {
    return handleError(res, 'getCourseDetail', err);
  }
}

async function updateCourse(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const data = await courseService.updateCourse(courseId, req.body || {}, req);
    return success(res, data, '课程更新成功');
  } catch (err) {
    return handleError(res, 'updateCourse', err);
  }
}

async function deleteCourse(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const data = await courseService.deleteCourse(courseId, req);
    return success(res, data, '课程已归档');
  } catch (err) {
    return handleError(res, 'deleteCourse', err);
  }
}

async function bindTeacher(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const { teacher_user_id, teacher_role } = req.body;
    if (!teacher_user_id || !teacher_role) {
      return fail(res, 40001, '教师 ID 和教师角色为必填项');
    }
    const data = await courseService.bindTeacher(courseId, parseInt(teacher_user_id, 10), teacher_role, req);
    return success(res, data, '教师绑定成功');
  } catch (err) {
    return handleError(res, 'bindTeacher', err);
  }
}

async function unbindTeacher(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const teacherUserId = parseId(req.params.teacher_user_id, 'teacher_user_id');
    const data = await courseService.unbindTeacher(courseId, teacherUserId, req);
    return success(res, data, '教师已解绑');
  } catch (err) {
    return handleError(res, 'unbindTeacher', err);
  }
}

// ==================== 章节 ====================

async function getChapterList(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const data = await courseService.getChapterList(courseId);
    return success(res, data, '获取章节列表成功');
  } catch (err) {
    return handleError(res, 'getChapterList', err);
  }
}

async function createChapter(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const { chapter_name, chapter_order, description } = req.body;
    if (!chapter_name) {
      return fail(res, 40001, '章节名称为必填项');
    }
    const data = await courseService.createChapter(courseId, { chapter_name, chapter_order, description }, req);
    return success(res, data, '章节创建成功');
  } catch (err) {
    return handleError(res, 'createChapter', err);
  }
}

async function updateChapter(req, res) {
  try {
    const chapterId = parseId(req.params.chapter_id, 'chapter_id');
    const data = await courseService.updateChapter(chapterId, req.body || {}, req);
    return success(res, data, '章节更新成功');
  } catch (err) {
    return handleError(res, 'updateChapter', err);
  }
}

async function deleteChapter(req, res) {
  try {
    const chapterId = parseId(req.params.chapter_id, 'chapter_id');
    const data = await courseService.deleteChapter(chapterId, req);
    return success(res, data, '章节已删除');
  } catch (err) {
    return handleError(res, 'deleteChapter', err);
  }
}

// ==================== 知识点 ====================

async function getKnowledgePointList(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const data = await courseService.getKnowledgePointList(courseId, req.query || {});
    return success(res, data, '获取知识点列表成功');
  } catch (err) {
    return handleError(res, 'getKnowledgePointList', err);
  }
}

async function createKnowledgePoint(req, res) {
  try {
    const { course_id, chapter_id, knowledge_point_name, knowledge_point_code, description, difficulty_level, parent_id, aliases, sort_order } = req.body;
    if (!course_id || !knowledge_point_name || !knowledge_point_code) {
      return fail(res, 40001, '课程 ID、知识点名称、知识点编码为必填项');
    }
    const data = await courseService.createKnowledgePoint({
      course_id: parseInt(course_id, 10),
      chapter_id: chapter_id ? parseInt(chapter_id, 10) : null,
      knowledge_point_name,
      knowledge_point_code,
      description,
      difficulty_level,
      parent_id: parent_id ? parseInt(parent_id, 10) : null,
      aliases,
      sort_order,
    }, req);
    return success(res, data, '知识点创建成功');
  } catch (err) {
    return handleError(res, 'createKnowledgePoint', err);
  }
}

async function updateKnowledgePoint(req, res) {
  try {
    const pointId = parseId(req.params.knowledge_point_id, 'knowledge_point_id');
    const data = await courseService.updateKnowledgePoint(pointId, req.body || {}, req);
    return success(res, data, '知识点更新成功');
  } catch (err) {
    return handleError(res, 'updateKnowledgePoint', err);
  }
}

async function deleteKnowledgePoint(req, res) {
  try {
    const pointId = parseId(req.params.knowledge_point_id, 'knowledge_point_id');
    const data = await courseService.deleteKnowledgePoint(pointId, req);
    return success(res, data, '知识点已删除');
  } catch (err) {
    return handleError(res, 'deleteKnowledgePoint', err);
  }
}

module.exports = {
  getCourseList, createCourse, getCourseDetail, updateCourse, deleteCourse,
  bindTeacher, unbindTeacher,
  getChapterList, createChapter, updateChapter, deleteChapter,
  getKnowledgePointList, createKnowledgePoint, updateKnowledgePoint, deleteKnowledgePoint,
};
