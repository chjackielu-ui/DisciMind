// 教师端任务管理控制器

const { success, fail } = require('../utils/response');
const teacherTaskService = require('../services/teacher-task.service');

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
  console.error(`[teacher-task.controller] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, '服务器错误');
}

async function listTasks(req, res) {
  try {
    const data = await teacherTaskService.listTasks(req.user, req.query || {});
    return success(res, data, '获取任务列表成功');
  } catch (err) {
    return handleError(res, 'listTasks', err);
  }
}

async function createTask(req, res) {
  try {
    const data = await teacherTaskService.createTask(req.user, req.body || {});
    return success(res, data, '创建任务成功');
  } catch (err) {
    return handleError(res, 'createTask', err);
  }
}

async function getTask(req, res) {
  try {
    const taskId = parsePositiveInt(req.params.task_id, 'task_id');
    const data = await teacherTaskService.getTask(req.user, taskId);
    return success(res, data, '获取任务详情成功');
  } catch (err) {
    return handleError(res, 'getTask', err);
  }
}

async function updateTask(req, res) {
  try {
    const taskId = parsePositiveInt(req.params.task_id, 'task_id');
    const data = await teacherTaskService.updateTask(req.user, taskId, req.body || {});
    return success(res, data, '更新任务成功');
  } catch (err) {
    return handleError(res, 'updateTask', err);
  }
}

async function deleteTask(req, res) {
  try {
    const taskId = parsePositiveInt(req.params.task_id, 'task_id');
    await teacherTaskService.deleteTask(req.user, taskId);
    return success(res, null, '删除任务成功');
  } catch (err) {
    return handleError(res, 'deleteTask', err);
  }
}

async function listSubmissions(req, res) {
  try {
    const taskId = parsePositiveInt(req.params.task_id, 'task_id');
    const data = await teacherTaskService.listSubmissions(req.user, taskId, req.query || {});
    return success(res, data, '获取提交列表成功');
  } catch (err) {
    return handleError(res, 'listSubmissions', err);
  }
}

async function getSubmission(req, res) {
  try {
    const taskId = parsePositiveInt(req.params.task_id, 'task_id');
    const submissionId = parsePositiveInt(req.params.submission_id, 'submission_id');
    const data = await teacherTaskService.getSubmission(req.user, taskId, submissionId);
    return success(res, data, '获取提交详情成功');
  } catch (err) {
    return handleError(res, 'getSubmission', err);
  }
}

module.exports = {
  listTasks,
  createTask,
  getTask,
  updateTask,
  deleteTask,
  listSubmissions,
  getSubmission,
};
