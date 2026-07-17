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
const cancel = wrap(async (req, res) => {
  const task = await service.cancelTask(req.user.user_id, req.params.id);
  require('./async-task.worker').getAsyncTaskWorker().cancel(task.id);
  return success(res, task, '任务已取消');
});
const retry = wrap(async (req, res) => success(res, await service.retryTask(req.user.user_id, req.params.id), '任务已重新进入队列'));
const dismiss = wrap(async (req, res) => success(res, await service.dismissTask(req.user.user_id, req.params.id), '任务记录已关闭'));
const dismissTerminal = wrap(async (req, res) => success(res, await service.dismissTerminalTasks(req.user.user_id, schemas.parse(schemas.dismissTerminalSchema, req.body || {}).statuses), '已清除结束任务'));
const bulkCancel = wrap(async (req, res) => success(res, await service.bulkCancel(req.user.user_id, schemas.parse(schemas.bulkSchema, req.body || {}).ids), '批量取消已处理'));
const bulkDismiss = wrap(async (req, res) => success(res, await service.bulkDismiss(req.user.user_id, schemas.parse(schemas.bulkSchema, req.body || {}).ids), '批量关闭已处理'));
const bulkDelete = wrap(async (req, res) => success(res, await service.bulkDelete(req.user.user_id, schemas.parse(schemas.bulkSchema, req.body || {}).ids), '批量删除已处理'));

async function stream(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  let lastSignature = '';
  let closed = false;
  const cleanup = () => { closed = true; clearInterval(timer); clearTimeout(expiry); };
  const push = async () => {
    if (closed || res.destroyed || res.writableEnded) return cleanup();
    try {
      const data = await service.listTasks(req.user.user_id, { page: 1, pageSize: 50, includeDismissed: false });
      const signature = data.list.map(item => `${item.id}:${item.status}:${item.progress}:${item.stage}:${new Date(item.updatedAt).getTime()}`).join('|');
      if (signature !== lastSignature) {
        lastSignature = signature;
        res.write(`event: tasks\ndata: ${JSON.stringify(data)}\n\n`);
      } else res.write(': heartbeat\n\n');
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ code: 50001, message: '任务状态同步失败' })}\n\n`);
    }
  };
  const timer = setInterval(push, 1000);
  timer.unref?.();
  const expiry = setTimeout(() => { if (!res.writableEnded) res.end(); cleanup(); }, 25 * 60 * 1000);
  expiry.unref?.();
  req.once('close', cleanup);
  await push();
}

module.exports = { list, active, detail, cancel, retry, stream, dismiss, dismissTerminal, bulkCancel, bulkDismiss, bulkDelete, handle };
