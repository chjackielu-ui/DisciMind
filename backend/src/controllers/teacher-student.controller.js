// 教师端学生管理控制器

const { success, fail } = require('../utils/response');
const teacherStudentService = require('../services/teacher-student.service');

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
  console.error(`[teacher-student.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

async function listStudents(req, res) {
  try {
    const data = await teacherStudentService.listStudents(req.user, req.query || {});
    return success(res, data, '获取学生列表成功');
  } catch (err) {
    return handleError(res, 'listStudents', err);
  }
}

async function getStudent(req, res) {
  try {
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    const data = await teacherStudentService.getStudent(req.user, studentUserId);
    return success(res, data, '获取学生详情成功');
  } catch (err) {
    return handleError(res, 'getStudent', err);
  }
}

async function getStudentMastery(req, res) {
  try {
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    const data = await teacherStudentService.getStudentMastery(req.user, studentUserId, req.query || {});
    return success(res, data, '获取学生掌握度成功');
  } catch (err) {
    return handleError(res, 'getStudentMastery', err);
  }
}

async function markMastery(req, res) {
  try {
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    const kpId = parsePositiveInt(req.params.kp_id, 'kp_id');
    const data = await teacherStudentService.markMastery(req.user, studentUserId, kpId, req.body || {});
    return success(res, data, '标记掌握度成功');
  } catch (err) {
    return handleError(res, 'markMastery', err);
  }
}

async function getStudentPortrait(req, res) {
  try {
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    const data = await teacherStudentService.getStudentPortrait(req.user, studentUserId, req.query || {});
    return success(res, data, '获取学生画像成功');
  } catch (err) {
    return handleError(res, 'getStudentPortrait', err);
  }
}

async function refreshPortrait(req, res) {
  try {
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    const data = await teacherStudentService.refreshPortrait(req.user, studentUserId, req.body || {});
    return success(res, data, '刷新学生画像成功');
  } catch (err) {
    return handleError(res, 'refreshPortrait', err);
  }
}

async function createStudent(req, res) {
  try {
    const data = await teacherStudentService.createStudent(req.user, req.body || {});
    return success(res, data, '添加学生成功');
  } catch (err) {
    return handleError(res, 'createStudent', err);
  }
}

module.exports = {
  listStudents,
  getStudent,
  getStudentMastery,
  markMastery,
  getStudentPortrait,
  refreshPortrait,
  createStudent,
};
