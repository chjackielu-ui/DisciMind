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

async function updateStudent(req, res) {
  try {
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    const data = await teacherStudentService.updateStudent(req.user, studentUserId, req.body || {});
    return success(res, data, '更新学生信息成功');
  } catch (err) {
    return handleError(res, 'updateStudent', err);
  }
}

async function deleteStudent(req, res) {
  try {
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    const data = await teacherStudentService.deleteStudent(req.user, studentUserId);
    return success(res, data, '删除学生成功');
  } catch (err) {
    return handleError(res, 'deleteStudent', err);
  }
}

async function batchImportStudents(req, res) {
  try {
    const data = await teacherStudentService.batchImportStudents(req.user, req.body.students || []);
    return success(res, data, '批量导入完成');
  } catch (err) {
    return handleError(res, 'batchImportStudents', err);
  }
}

async function exportStudentTemplate(req, res) {
  try {
    // 生成 CSV 模板
    const headers = ['username', 'real_name', 'password', 'student_no', 'college', 'major', 'grade', 'gender', 'phone', 'email', 'class_name', 'course_name'];
    const headerRow = headers.join(',');
    const exampleRow = 'stu001,张三,123456,2024001,计算机与软件工程学院,软件工程,2024,male,13800000001,stu001@demo.com,软件2403班,机器学习';
    const csvContent = '﻿' + headerRow + '\n' + exampleRow + '\n';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="student_import_template.csv"');
    return res.send(csvContent);
  } catch (err) {
    return handleError(res, 'exportStudentTemplate', err);
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
  updateStudent,
  deleteStudent,
  batchImportStudents,
  exportStudentTemplate,
};
