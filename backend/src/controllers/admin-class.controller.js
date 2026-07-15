// 管理员端班级管理控制器
// 包含行政班级和教学班级的 CRUD

const { success, fail } = require('../utils/response');
const classService = require('../services/admin-class.service');

function parseId(value, name) {
  const id = parseInt(value, 10);
  if (!id || id < 1) {
    throw Object.assign(new Error(`${name} 不合法`), { code: 40001 });
  }
  return id;
}

async function handleError(res, scope, err) {
  console.error(`[admin-class] ${scope} error:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

// ==================== 行政班级 ====================

async function getAdminClassList(req, res) {
  try {
    const data = await classService.getAdminClassList(req.query || {});
    return success(res, data, '获取行政班级列表成功');
  } catch (err) {
    return handleError(res, 'getAdminClassList', err);
  }
}

async function createAdminClass(req, res) {
  try {
    const { class_name } = req.body;
    if (!class_name) {
      return fail(res, 40001, '班级名称为必填项');
    }
    const data = await classService.createAdminClass(req.body || {}, req);
    return success(res, data, '行政班级创建成功');
  } catch (err) {
    return handleError(res, 'createAdminClass', err);
  }
}

async function updateAdminClass(req, res) {
  try {
    const classId = parseId(req.params.admin_class_id, 'admin_class_id');
    const data = await classService.updateAdminClass(classId, req.body || {}, req);
    return success(res, data, '行政班级更新成功');
  } catch (err) {
    return handleError(res, 'updateAdminClass', err);
  }
}

async function deleteAdminClass(req, res) {
  try {
    const classId = parseId(req.params.admin_class_id, 'admin_class_id');
    const data = await classService.deleteAdminClass(classId, req);
    return success(res, data, '行政班级已删除');
  } catch (err) {
    return handleError(res, 'deleteAdminClass', err);
  }
}

async function getAdminClassStudentList(req, res) {
  try {
    const classId = parseId(req.params.admin_class_id, 'admin_class_id');
    return success(res, await classService.getAdminClassStudentList(classId, req.query || {}), '获取行政班学生成功');
  } catch (err) {
    return handleError(res, 'getAdminClassStudentList', err);
  }
}

async function addAdminClassStudents(req, res) {
  try {
    const classId = parseId(req.params.admin_class_id, 'admin_class_id');
    const ids = req.body?.student_user_ids;
    if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error('学生 ID 列表不能为空'), { code: 40001 });
    return success(res, await classService.addAdminClassStudents(classId, ids, req), '行政班学生已更新');
  } catch (err) {
    return handleError(res, 'addAdminClassStudents', err);
  }
}

async function removeAdminClassStudent(req, res) {
  try {
    const classId = parseId(req.params.admin_class_id, 'admin_class_id');
    const studentUserId = parseId(req.params.student_user_id, 'student_user_id');
    return success(res, await classService.removeAdminClassStudent(classId, studentUserId, req), '学生已移出行政班');
  } catch (err) {
    return handleError(res, 'removeAdminClassStudent', err);
  }
}

// ==================== 教学班级 ====================

async function getTeachingClassList(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const data = await classService.getTeachingClassList(courseId);
    return success(res, data, '获取教学班级列表成功');
  } catch (err) {
    return handleError(res, 'getTeachingClassList', err);
  }
}

async function getTeachingClassPage(req, res) {
  try {
    return success(res, await classService.getTeachingClassPage(req.query || {}), '获取教学班列表成功');
  } catch (err) {
    return handleError(res, 'getTeachingClassPage', err);
  }
}

async function createTeachingClass(req, res) {
  try {
    const courseId = parseId(req.params.course_id, 'course_id');
    const { teaching_class_name } = req.body;
    if (!teaching_class_name) {
      return fail(res, 40001, '教学班级名称为必填项');
    }
    const data = await classService.createTeachingClass(courseId, req.body || {}, req);
    return success(res, data, '教学班级创建成功');
  } catch (err) {
    return handleError(res, 'createTeachingClass', err);
  }
}

async function updateTeachingClass(req, res) {
  try {
    const classId = parseId(req.params.teaching_class_id, 'teaching_class_id');
    const data = await classService.updateTeachingClass(classId, req.body || {}, req);
    return success(res, data, '教学班级更新成功');
  } catch (err) {
    return handleError(res, 'updateTeachingClass', err);
  }
}

async function deleteTeachingClass(req, res) {
  try {
    const classId = parseId(req.params.teaching_class_id, 'teaching_class_id');
    const data = await classService.deleteTeachingClass(classId, req);
    return success(res, data, data.deletion_mode === 'soft' ? '教学班级已归档' : '教学班级已删除');
  } catch (err) {
    return handleError(res, 'deleteTeachingClass', err);
  }
}

async function getClassStudentList(req, res) {
  try {
    const classId = parseId(req.params.teaching_class_id, 'teaching_class_id');
    const data = await classService.getClassStudentList(classId, req.query || {});
    return success(res, data, '获取学生列表成功');
  } catch (err) {
    return handleError(res, 'getClassStudentList', err);
  }
}

async function addClassStudents(req, res) {
  try {
    const classId = parseId(req.params.teaching_class_id, 'teaching_class_id');
    const { student_user_ids } = req.body;
    if (!student_user_ids || !Array.isArray(student_user_ids) || student_user_ids.length === 0) {
      return fail(res, 40001, '学生 ID 列表不能为空');
    }
    const data = await classService.addClassStudents(classId, student_user_ids, req);
    return success(res, data, '学生添加成功');
  } catch (err) {
    return handleError(res, 'addClassStudents', err);
  }
}

async function removeClassStudent(req, res) {
  try {
    const classId = parseId(req.params.teaching_class_id, 'teaching_class_id');
    const studentUserId = parseId(req.params.student_user_id, 'student_user_id');
    const data = await classService.removeClassStudent(classId, studentUserId, req);
    return success(res, data, '学生已移除');
  } catch (err) {
    return handleError(res, 'removeClassStudent', err);
  }
}

module.exports = {
  getAdminClassList, createAdminClass, updateAdminClass, deleteAdminClass,
  getAdminClassStudentList, addAdminClassStudents, removeAdminClassStudent,
  getTeachingClassPage,
  getTeachingClassList, createTeachingClass, updateTeachingClass, deleteTeachingClass,
  getClassStudentList, addClassStudents, removeClassStudent,
};
