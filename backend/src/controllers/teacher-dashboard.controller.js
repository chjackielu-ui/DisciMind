// 教师端看板与学情分析控制器

const { success, fail } = require('../utils/response');
const teacherDashboardService = require('../services/teacher-dashboard.service');

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
  console.error(`[teacher-dashboard.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

async function getDashboard(req, res) {
  try {
    const data = await teacherDashboardService.getDashboard(req.user, req.query || {});
    return success(res, data, '获取看板数据成功');
  } catch (err) {
    return handleError(res, 'getDashboard', err);
  }
}

async function getProgress(req, res) {
  try {
    const data = await teacherDashboardService.getProgress(req.user, req.query || {});
    return success(res, data, '获取学习进度成功');
  } catch (err) {
    return handleError(res, 'getProgress', err);
  }
}

async function getKnowledgeHeatmap(req, res) {
  try {
    const data = await teacherDashboardService.getKnowledgeHeatmap(req.user, req.query || {});
    return success(res, data, '获取知识热力图成功');
  } catch (err) {
    return handleError(res, 'getKnowledgeHeatmap', err);
  }
}

async function getScoreDistribution(req, res) {
  try {
    const data = await teacherDashboardService.getScoreDistribution(req.user, req.query || {});
    return success(res, data, '获取成绩分布成功');
  } catch (err) {
    return handleError(res, 'getScoreDistribution', err);
  }
}

async function getQuestionFrequency(req, res) {
  try {
    const data = await teacherDashboardService.getQuestionFrequency(req.user, req.query || {});
    return success(res, data, '获取高频提问统计成功');
  } catch (err) {
    return handleError(res, 'getQuestionFrequency', err);
  }
}

async function getWeakKnowledgePoints(req, res) {
  try {
    const data = await teacherDashboardService.getWeakKnowledgePoints(req.user, req.query || {});
    return success(res, data, '获取薄弱知识点排行成功');
  } catch (err) {
    return handleError(res, 'getWeakKnowledgePoints', err);
  }
}

async function getStudentRadar(req, res) {
  try {
    const studentUserId = parsePositiveInt(req.params.student_user_id, 'student_user_id');
    const data = await teacherDashboardService.getStudentRadar(req.user, studentUserId, req.query || {});
    return success(res, data, '获取学生雷达图数据成功');
  } catch (err) {
    return handleError(res, 'getStudentRadar', err);
  }
}

module.exports = {
  getDashboard,
  getProgress,
  getKnowledgeHeatmap,
  getScoreDistribution,
  getQuestionFrequency,
  getWeakKnowledgePoints,
  getStudentRadar,
};
