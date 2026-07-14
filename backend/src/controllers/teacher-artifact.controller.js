const service = require('../services/teacher-artifact.service');
const { success, fail } = require('../utils/response');

function handle(res, error) {
  const status = Number(error.status) || (error.code === 40301 ? 403 : error.code === 40901 ? 409 : 400);
  if (status < 500) return res.status(status).json({ code: error.code || 40001, message: error.message, data: null });
  return fail(res, 50001, '产物中心服务暂时不可用');
}

async function list(req, res) { try { return success(res, await service.list(req.user, req.query || {}), '获取教师产物成功'); } catch (error) { return handle(res, error); } }
async function detail(req, res) { try { return success(res, await service.detail(req.user, req.params.source_type, req.params.id), '获取产物详情成功'); } catch (error) { return handle(res, error); } }
async function rename(req, res) { try { return success(res, await service.rename(req.user, req.params.source_type, req.params.id, req.body?.title), '产物已重命名'); } catch (error) { return handle(res, error); } }
async function batch(req, res) { try { return success(res, await service.batch(req.user, req.body || {}), '批量操作完成'); } catch (error) { return handle(res, error); } }

module.exports = { list, detail, rename, batch };
