// 学生端在线答题控制器

const { success, fail } = require('../utils/response');
const studentAnswerService = require('../services/student-answer.service');

function getUserId(req) {
  return req.user?.user_id;
}

// ========================
// 1. 开始答题
// ========================

async function startQuiz(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const taskId = parseInt(req.params.task_id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return fail(res, 40001, 'task_id 参数不合法');
    }

    const mode = req.body?.mode || 'normal';

    const data = await studentAnswerService.startQuiz(userId, taskId, mode);
    return success(res, data, '开始答题成功');
  } catch (err) {
    console.error('[student-answer.controller] startQuiz 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 2. 保存答案草稿
// ========================

async function saveAnswers(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const submissionId = parseInt(req.params.submission_id, 10);
    if (isNaN(submissionId) || submissionId < 1) {
      return fail(res, 40001, 'submission_id 参数不合法');
    }

    const { answers } = req.body;
    if (!answers || !Array.isArray(answers)) {
      return fail(res, 40001, 'answers 参数不合法，应为数组');
    }

    const data = await studentAnswerService.saveAnswers(userId, submissionId, answers);
    return success(res, data, '答案已保存');
  } catch (err) {
    console.error('[student-answer.controller] saveAnswers 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 3. 提交答案并自动批改
// ========================

async function submitTask(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const taskId = parseInt(req.params.task_id, 10);
    if (isNaN(taskId) || taskId < 1) {
      return fail(res, 40001, 'task_id 参数不合法');
    }

    const { submission_id, answers } = req.body;
    if (!submission_id) {
      return fail(res, 40001, 'submission_id 不能为空');
    }

    const submissionId = parseInt(submission_id, 10);
    if (isNaN(submissionId) || submissionId < 1) {
      return fail(res, 40001, 'submission_id 参数不合法');
    }

    const data = await studentAnswerService.submitTask(userId, taskId, submissionId, answers);
    return success(res, data, '提交成功');
  } catch (err) {
    console.error('[student-answer.controller] submitTask 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 4. 查看提交详情
// ========================

async function getSubmission(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const submissionId = parseInt(req.params.submission_id, 10);
    if (isNaN(submissionId) || submissionId < 1) {
      return fail(res, 40001, 'submission_id 参数不合法');
    }

    const data = await studentAnswerService.getSubmission(userId, submissionId);
    return success(res, data, '获取提交详情成功');
  } catch (err) {
    console.error('[student-answer.controller] getSubmission 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

// ========================
// 5. 查看题目解析
// ========================

async function getQuestionAnalysis(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(res, 40101, '无法获取用户身份');

    const questionId = parseInt(req.params.question_id, 10);
    if (isNaN(questionId) || questionId < 1) {
      return fail(res, 40001, 'question_id 参数不合法');
    }

    const submissionId = req.query.submission_id
      ? parseInt(req.query.submission_id, 10)
      : null;

    const data = await studentAnswerService.getQuestionAnalysis(userId, questionId, submissionId);
    return success(res, data, '获取题目解析成功');
  } catch (err) {
    console.error('[student-answer.controller] getQuestionAnalysis 异常:', err.message);
    if (err.code) return fail(res, err.code, err.message);
    return fail(res, 50001, '服务器错误');
  }
}

module.exports = {
  startQuiz,
  saveAnswers,
  submitTask,
  getSubmission,
  getQuestionAnalysis,
};
