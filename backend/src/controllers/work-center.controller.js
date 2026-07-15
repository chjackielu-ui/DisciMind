const { success } = require('../utils/response');
const service = require('../services/work-center.service');

function handle(res, error) {
  return res.status(Number(error.status || (error.code === 40301 ? 403 : error.code === 40401 ? 404 : 400)))
    .json({ code: Number(error.code || 50001), message: error.message || '任务与消息中心暂不可用', data: null });
}

const wrap = (operation) => async (req, res) => {
  try { return success(res, await operation(req), '操作成功'); }
  catch (error) { return handle(res, error); }
};

module.exports = {
  summary: wrap((req) => service.summary(req.user)),
  feed: wrap((req) => service.feed(req.user, req.query || {})),
  messages: wrap((req) => service.messages(req.user, req.query || {})),
  tasks: wrap((req) => service.tasks(req.user, req.query || {})),
  messageDetail: wrap((req) => service.messageDetail(req.user, req.params.id)),
  markMessageRead: wrap((req) => service.markMessageRead(req.user, req.params.id)),
  markAllMessagesRead: wrap((req) => service.markAllMessagesRead(req.user)),
};
