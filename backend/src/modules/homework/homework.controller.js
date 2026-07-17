// 作业模块 HTTP 控制器

const { success, fail } = require('../../utils/response');
const homeworkService = require('./homework.service');
const homeworkSchema = require('./homework.schema');
const tasks = require('../async-task/async-task.service');

function handleError(res, scope, err) {
  console.error(`[homework] ${scope} 异常:`, err.message);
  if (err.code) return fail(res, err.code, err.message);
  return fail(res, 50001, err.message || '服务器错误');
}

// POST /api/teacher/homework/create
async function create(req, res) {
  try {
    const parsed = homeworkSchema.createHomeworkSchema.parse(req.body);
    const data = await homeworkService.createHomework(req.user.user_id, parsed);
    return success(res, data, '作业草稿创建成功');
  } catch (err) {
    if (err.name === 'ZodError') return fail(res, 40001, `参数校验失败: ${err.issues.map(i => i.message).join('; ')}`);
    return handleError(res, 'create', err);
  }
}

// PUT /api/teacher/homework/:id
async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = homeworkSchema.updateHomeworkSchema.parse(req.body);
    const data = await homeworkService.updateHomework(id, req.user.user_id, parsed);
    return success(res, data, '作业更新成功');
  } catch (err) {
    if (err.name === 'ZodError') return fail(res, 40001, `参数校验失败`);
    return handleError(res, 'update', err);
  }
}

// PUT /api/teacher/homework/:id/publish
async function publish(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = await homeworkService.publishHomework(id, req.user.user_id);
    return success(res, data, '作业已发布');
  } catch (err) { return handleError(res, 'publish', err); }
}

// PUT /api/teacher/homework/:id/close
async function close(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = await homeworkService.closeHomework(id, req.user.user_id);
    return success(res, data, '作业已关闭');
  } catch (err) { return handleError(res, 'close', err); }
}

// POST /api/teacher/homework/:id/import-question
async function importQuestion(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const parsed = homeworkSchema.importQuestionSchema.parse(req.body);
    const data = await homeworkService.importQuestions(id, req.user.user_id, parsed);
    return success(res, data, '试题导入成功');
  } catch (err) {
    if (err.name === 'ZodError') return fail(res, 40001, `参数校验失败`);
    return handleError(res, 'importQuestion', err);
  }
}

// GET /api/teacher/homework/list
async function list(req, res) {
  try {
    const data = await homeworkService.listHomework(req.user.user_id, req.query);
    return success(res, data, '获取作业列表成功');
  } catch (err) { return handleError(res, 'list', err); }
}

// GET /api/teacher/homework/:id/detail
async function detail(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = await homeworkService.getHomeworkDetail(id, req.user.user_id);
    return success(res, data, '获取作业详情成功');
  } catch (err) { return handleError(res, 'detail', err); }
}

// GET /api/teacher/homework/:id/submissions
async function submissions(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = await homeworkService.listSubmissions(id, req.user.user_id, req.query);
    return success(res, data, '获取提交记录成功');
  } catch (err) { return handleError(res, 'submissions', err); }
}

// POST /api/teacher/submission/:subId/ai-mark
async function aiMark(req, res) {
  try {
    const subId = parseInt(req.params.subId, 10);
    const data = await homeworkService.aiMarkSubmission(subId, req.user.user_id);
    return success(res, data, 'AI 批改完成');
  } catch (err) { return handleError(res, 'aiMark', err); }
}

// POST /api/teacher/homework/:id/batch-ai-mark
async function batchAiMark(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    // 创建异步任务
    const task = await tasks.createTask(req.user.user_id, {
      operationId: `homework-ai-mark-${id}-${Date.now()}`,
      taskType: 'DOCUMENT_EXPORT',
      title: '作业 AI 批量批改',
      description: '正在为提交记录进行 AI 自动评分',
      status: 'QUEUED',
      stage: '等待处理',
      progressMode: 'DETERMINATE',
      progress: 0,
      relatedResourceType: 'HOMEWORK',
      relatedResourceId: id,
      cancellable: false,
      metadataJson: { homeworkId: id },
    });
    // 异步执行
    homeworkService.batchAiMarkHomework(id, req.user.user_id, task.id).catch(err => {
      console.error('[homework] batch ai mark error:', err.message);
    });
    return success(res, { task_id: task.id, homework_id: id }, '批量 AI 批改任务已创建');
  } catch (err) { return handleError(res, 'batchAiMark', err); }
}

// PUT /api/teacher/submission/:subId/manual-mark
async function manualMark(req, res) {
  try {
    const subId = parseInt(req.params.subId, 10);
    const parsed = homeworkSchema.manualMarkSchema.parse(req.body);
    const data = await homeworkService.manualMarkSubmission(subId, req.user.user_id, parsed);
    return success(res, data, '手动批改保存成功');
  } catch (err) {
    if (err.name === 'ZodError') return fail(res, 40001, `参数校验失败`);
    return handleError(res, 'manualMark', err);
  }
}

// GET /api/teacher/homework/:id/score-stat
async function scoreStat(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = await homeworkService.getScoreStats(id, req.user.user_id);
    return success(res, data, '获取成绩统计成功');
  } catch (err) { return handleError(res, 'scoreStat', err); }
}

module.exports = {
  create, update, publish, close, importQuestion,
  list, detail, submissions,
  aiMark, batchAiMark, manualMark, scoreStat,
};
