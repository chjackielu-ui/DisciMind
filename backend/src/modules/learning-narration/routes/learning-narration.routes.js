const { Router } = require('express');
const authMiddleware = require('../../../middlewares/auth.middleware');
const roleMiddleware = require('../../../middlewares/role.middleware');
const { success } = require('../../../utils/response');
const { CreateNarrationJobSchema } = require('../schemas/narration.schema');

function createRoutes(module) {
  const router = Router();
  router.use(authMiddleware, roleMiddleware(['student']));
  router.get('/settings', (req, res) => success(res, module.publicSettings()));
  router.post('/jobs', async (req, res, next) => {
    try {
      const parsed = CreateNarrationJobSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ code: 40001, message: '语音任务参数无效', data: null });
      return success(res, await module.jobService.createJob(req.user.user_id, parsed.data));
    } catch (error) { return next(error); }
  });
  router.get('/jobs/:jobId', async (req, res, next) => {
    try { return success(res, await module.jobService.getJob(req.user.user_id, req.params.jobId)); } catch (error) { return next(error); }
  });
  router.post('/jobs/:jobId/cancel', async (req, res, next) => {
    try { return success(res, await module.jobService.cancelJob(req.user.user_id, req.params.jobId)); } catch (error) { return next(error); }
  });
  return router;
}

module.exports = { createRoutes };
