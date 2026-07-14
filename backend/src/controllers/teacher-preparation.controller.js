const { success, fail } = require('../utils/response');
const service = require('../services/teacher-preparation.service');

function id(value, field = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error(`${field} 参数不合法`), { code: 40001 });
  return parsed;
}

function handle(res, scope, error) {
  console.error(`[teacher-preparation.controller] ${scope}:`, error.message);
  return fail(res, error.code || 50001, error.code ? error.message : '服务器错误');
}

async function list(req, res) { try { return success(res, await service.listPlans(req.user, req.query || {})); } catch (error) { return handle(res, 'list', error); } }
async function create(req, res) { try { return success(res, await service.createPlan(req.user, req.body || {}), '创建备课方案成功'); } catch (error) { return handle(res, 'create', error); } }
async function detail(req, res) { try { return success(res, await service.getPlan(req.user, id(req.params.id)), '获取备课方案成功'); } catch (error) { return handle(res, 'detail', error); } }
async function save(req, res) { try { return success(res, await service.saveDraft(req.user, id(req.params.id), req.body || {}), '草稿已保存'); } catch (error) { return handle(res, 'save', error); } }
async function generate(req, res) { try { return success(res, await service.startGeneration(req.user, id(req.params.id), req.body || {}), '多智能体任务已启动'); } catch (error) { return handle(res, 'generate', error); } }
async function refine(req, res) { try { return success(res, await service.refineStage(req.user, id(req.params.id), req.body || {}), '当前阶段已优化'); } catch (error) { return handle(res, 'refine', error); } }
async function status(req, res) { try { return success(res, await service.getGenerationStatus(req.user, id(req.params.id))); } catch (error) { return handle(res, 'status', error); } }
async function versions(req, res) { try { return success(res, await service.listVersions(req.user, id(req.params.id))); } catch (error) { return handle(res, 'versions', error); } }
async function compare(req, res) { try { return success(res, await service.compareVersions(req.user, id(req.params.id), req.query.from, req.query.to)); } catch (error) { return handle(res, 'compare', error); } }
async function restore(req, res) { try { return success(res, await service.restoreVersion(req.user, id(req.params.id), id(req.params.version, 'version'))); } catch (error) { return handle(res, 'restore', error); } }
async function publish(req, res) { try { return success(res, await service.publishPlan(req.user, id(req.params.id)), '备课方案已发布'); } catch (error) { return handle(res, 'publish', error); } }
async function exportFile(req, res) { try { return success(res, await service.exportPlan(req.user, id(req.params.id), req.body?.format, req.body?.artifact_type), '导出任务已创建'); } catch (error) { return handle(res, 'export', error); } }

async function stream(req, res) {
  try {
    const lessonPlanId = id(req.params.id);
    const snapshot = await service.getGenerationStatus(req.user, lessonPlanId);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    const unsubscribe = service.subscribe(lessonPlanId, (event) => {
      res.write(`event: ${event.type || 'progress'}\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'complete' || event.type === 'failed') res.end();
    });
    req.on('close', unsubscribe);
  } catch (error) {
    if (!res.headersSent) return handle(res, 'stream', error);
    return res.end();
  }
}

module.exports = { list, create, detail, save, generate, refine, status, versions, compare, restore, publish, exportFile, stream };
