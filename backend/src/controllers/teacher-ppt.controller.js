const { success, fail } = require('../utils/response');
const service = require('../services/teacher-ppt.service');

function handle(res, scope, error) {
  console.error(`[teacher-ppt.controller] ${scope}:`, error.message);
  return fail(res, error.code || 50001, error.code ? error.message : 'PPT 生成服务暂不可用');
}

async function generate(req, res) {
  try {
    return success(res, await service.generate(req.user, req.body || {}), 'PPT 生成完成');
  } catch (error) {
    return handle(res, 'generate', error);
  }
}

async function task(req, res) {
  try {
    return success(res, await service.getTask(req.user, req.params.taskId));
  } catch (error) {
    return handle(res, 'task', error);
  }
}

module.exports = { generate, task };
