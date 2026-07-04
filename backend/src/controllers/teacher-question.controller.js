// 教师端题库管理控制器

const { success, fail } = require('../utils/response');
const teacherQuestionService = require('../services/teacher-question.service');

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
  console.error(`[teacher-question.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

async function listQuestions(req, res) {
  try {
    const data = await teacherQuestionService.listQuestions(req.user, req.query || {});
    return success(res, data, '获取题目列表成功');
  } catch (err) {
    return handleError(res, 'listQuestions', err);
  }
}

async function createQuestion(req, res) {
  try {
    const data = await teacherQuestionService.createQuestion(req.user, req.body || {});
    return success(res, data, '创建题目成功');
  } catch (err) {
    return handleError(res, 'createQuestion', err);
  }
}

async function getQuestion(req, res) {
  try {
    const questionId = parsePositiveInt(req.params.question_id, 'question_id');
    const data = await teacherQuestionService.getQuestion(req.user, questionId);
    return success(res, data, '获取题目详情成功');
  } catch (err) {
    return handleError(res, 'getQuestion', err);
  }
}

async function updateQuestion(req, res) {
  try {
    const questionId = parsePositiveInt(req.params.question_id, 'question_id');
    const data = await teacherQuestionService.updateQuestion(req.user, questionId, req.body || {});
    return success(res, data, '更新题目成功');
  } catch (err) {
    return handleError(res, 'updateQuestion', err);
  }
}

async function deleteQuestion(req, res) {
  try {
    const questionId = parsePositiveInt(req.params.question_id, 'question_id');
    await teacherQuestionService.deleteQuestion(req.user, questionId);
    return success(res, null, '删除题目成功');
  } catch (err) {
    return handleError(res, 'deleteQuestion', err);
  }
}

module.exports = {
  listQuestions,
  createQuestion,
  getQuestion,
  updateQuestion,
  deleteQuestion,
};
