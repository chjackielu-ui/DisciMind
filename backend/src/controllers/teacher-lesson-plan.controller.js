// 教师端智能教案生成控制器

const { success, fail } = require('../utils/response');
const lessonPlanService = require('../services/teacher-lesson-plan.service');
const path = require('path');

function handleError(res, scope, err) {
  console.error(`[teacher-lesson-plan] ${scope} 异常:`, err.message);
  console.error(err.stack);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, err.message || '服务器错误');
}

/**
 * POST /api/teacher/lesson-plan/generate
 * 生成教案（预览）
 */
async function generate(req, res) {
  try {
    const data = await lessonPlanService.generateLessonPlan(req.user, req.body || {});
    return success(res, data, '教案生成成功');
  } catch (err) {
    return handleError(res, 'generate', err);
  }
}

/**
 * POST /api/teacher/lesson-plan/export
 * 生成并导出教案 DOCX
 */
async function exportDocx(req, res) {
  try {
    const data = await lessonPlanService.exportLessonPlanDocx(req.user, req.body || {});
    return success(res, data, '教案导出成功');
  } catch (err) {
    return handleError(res, 'exportDocx', err);
  }
}

/**
 * GET /api/teacher/lesson-plan/download
 * 下载已生成的教案文件
 */
async function download(req, res) {
  try {
    const filePath = req.query.path;
    if (!filePath) return fail(res, 40001, '文件路径不能为空');

    // 安全检查
    const normalized = path.resolve(filePath);
    const storageRoot = path.resolve(__dirname, '../../storage/lesson-plans');
    if (!normalized.startsWith(storageRoot)) {
      return fail(res, 40301, '无权访问该文件');
    }

    const fileName = req.query.name || path.basename(normalized);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    return res.sendFile(normalized);
  } catch (err) {
    return handleError(res, 'download', err);
  }
}

/**
 * POST /api/teacher/lesson-plan/create-task
 * 创建异步教案生成任务
 */
async function createTask(req, res) {
  try {
    const data = await lessonPlanService.createGenerationTask(req.user, req.body || {});
    return success(res, data, '教案生成任务已创建');
  } catch (err) {
    return handleError(res, 'createTask', err);
  }
}

/**
 * GET /api/teacher/lesson-plan/task/:taskId
 * 查询异步任务状态
 */
async function getTaskStatus(req, res) {
  try {
    const taskId = parseInt(req.params.taskId);
    if (!taskId) return fail(res, 40001, '任务 ID 不能为空');
    const data = await lessonPlanService.getGenerationTaskStatus(req.user, taskId);
    return success(res, data, '获取任务状态成功');
  } catch (err) {
    return handleError(res, 'getTaskStatus', err);
  }
}

/**
 * GET /api/teacher/lesson-plan/keywords
 * 获取课程关键词数据（用于前端展示词云）
 */
async function getKeywords(req, res) {
  try {
    const courseId = parseInt(req.query.course_id) || 0;
    if (!courseId) return fail(res, 40001, '请选择课程');
    const classId = parseInt(req.query.teaching_class_id) || 0;
    const keywords = await lessonPlanService.extractKeywords(courseId, classId, 20);
    return success(res, { keywords }, '获取关键词成功');
  } catch (err) {
    return handleError(res, 'getKeywords', err);
  }
}

module.exports = {
  generate,
  exportDocx,
  download,
  getKeywords,
  createTask,
  getTaskStatus,
};
