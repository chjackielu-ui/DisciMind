const { success } = require('../../utils/response');
const schemas = require('./async-task.schemas');
const service = require('./async-task.service');

function handle(res, error) {
  return res.status(Number(error.status || 400)).json({ code: Number(error.code || 50001), message: error.message || '任务状态同步失败', data: null });
}
const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (error) { return handle(res, error); } };

const list = wrap(async (req, res) => success(res, await service.listTasks(req.user.user_id, schemas.parse(schemas.listSchema, req.query))));
const active = wrap(async (req, res) => success(res, await service.listTasks(req.user.user_id, schemas.parse(schemas.listSchema, req.query), true)));
const detail = wrap(async (req, res) => success(res, await service.getTask(req.user.user_id, req.params.id)));
const cancel = wrap(async (req, res) => success(res, await service.cancelTask(req.user.user_id, req.params.id), '任务已取消'));
const dismiss = wrap(async (req, res) => success(res, await service.dismissTask(req.user.user_id, req.params.id), '任务记录已关闭'));
const dismissTerminal = wrap(async (req, res) => success(res, await service.dismissTerminalTasks(req.user.user_id, schemas.parse(schemas.dismissTerminalSchema, req.body || {}).statuses), '已清除结束任务'));

module.exports = { list, active, detail, cancel, dismiss, dismissTerminal, handle };
