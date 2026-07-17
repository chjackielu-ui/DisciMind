// 教师端练习统计控制器

const { success, fail } = require('../utils/response');
const teacherPracticeService = require('../services/teacher-practice.service');

function getUser(req) {
  return req.user;
}

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
  console.error(`[teacher-practice.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

async function getOverview(req, res) {
  try {
    const data = await teacherPracticeService.getOverview(getUser(req), req.query || {});
    return success(res, data, '获取练习总览成功');
  } catch (err) {
    return handleError(res, 'getOverview', err);
  }
}

async function getClassAnalytics(req, res) {
  try {
    const classId = parsePositiveInt(req.params.classId || req.params.class_id, 'classId');
    const data = await teacherPracticeService.getClassAnalytics(getUser(req), classId, req.query || {});
    return success(res, data, '获取班级练习分析成功');
  } catch (err) {
    return handleError(res, 'getClassAnalytics', err);
  }
}

async function getStudentAnalytics(req, res) {
  try {
    const studentId = parsePositiveInt(req.params.studentId || req.params.student_id, 'studentId');
    const data = await teacherPracticeService.getStudentAnalytics(getUser(req), studentId, req.query || {});
    return success(res, data, '获取学生练习分析成功');
  } catch (err) {
    return handleError(res, 'getStudentAnalytics', err);
  }
}

async function getQuestionAnalytics(req, res) {
  try {
    const data = await teacherPracticeService.getQuestionAnalytics(getUser(req), req.query || {});
    return success(res, data, '获取题目练习分析成功');
  } catch (err) {
    return handleError(res, 'getQuestionAnalytics', err);
  }
}

async function getAiQuestions(req, res) {
  try {
    const data = await teacherPracticeService.getAiQuestions(getUser(req), req.query || {});
    return success(res, data, '获取 AI 生成题列表成功');
  } catch (err) {
    return handleError(res, 'getAiQuestions', err);
  }
}

async function updateQuestionStatus(req, res) {
  try {
    const questionId = parsePositiveInt(req.params.questionId || req.params.question_id, 'questionId');
    const { status } = req.body || {};
    if (!status) return fail(res, 40001, 'status 不能为空');

    const data = await teacherPracticeService.updateQuestionStatus(getUser(req), questionId, status);
    return success(res, data, '题目状态更新成功');
  } catch (err) {
    return handleError(res, 'updateQuestionStatus', err);
  }
}

module.exports = {
  getOverview,
  getClassAnalytics,
  getStudentAnalytics,
  getQuestionAnalytics,
  getAiQuestions,
  updateQuestionStatus,
};
