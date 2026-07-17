const { success } = require('../../utils/response');
const { TrainerWorkflowError } = require('./trainer.errors');
const { validateTrainerRunInput } = require('./trainer.validator');
const trainerWorkflowService = require('./trainer-workflow.service');

function getUserId(req) {
  return req.user?.user_id ?? req.user?.id ?? req.user?.userId ?? req.auth?.userId;
}

function getSafeRequestInfo(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  return {
    request_id: body.request_id || body.requestId || null,
    mode: body.mode || null,
  };
}

function sendTrainerError(res, err) {
  if (err instanceof TrainerWorkflowError) {
    return res.status(err.status || 500).json({
      code: err.code,
      message: err.message,
      data: err.data ?? null,
    });
  }

  return res.status(500).json({
    code: 'TRAINER_INTERNAL_ERROR',
    message: '训练师服务异常，请稍后重试',
    data: null,
  });
}

async function run(req, res) {
  const safeInfo = getSafeRequestInfo(req);
  const userId = getUserId(req);

  try {
    if (userId == null || String(userId).trim() === '') {
      return res.status(401).json({
        code: 40101,
        message: '无法获取用户身份',
        data: null,
      });
    }

    const input = validateTrainerRunInput(req.body || {});
    const difyUser = trainerWorkflowService.buildDifyUser(userId);

    const { businessResult, metadata } = await trainerWorkflowService.runTrainerWorkflow({
      ...input,
      difyUser,
    });

    console.log('[trainer.controller] Workflow 调用完成:', {
      user_id: userId,
      request_id: input.requestId,
      mode: input.mode,
      workflow_run_id: metadata.workflow_run_id,
      elapsed_time: metadata.elapsed_time,
      total_tokens: metadata.total_tokens,
      attempts: metadata.attempts,
    });

    return success(res, businessResult, '训练师 Workflow 调用成功');
  } catch (err) {
    console.warn('[trainer.controller] Workflow 调用失败:', {
      user_id: userId || null,
      request_id: safeInfo.request_id,
      mode: safeInfo.mode,
      code: err.code || 'TRAINER_INTERNAL_ERROR',
      status: err.status || 500,
      message: err.message,
    });

    return sendTrainerError(res, err);
  }
}

module.exports = {
  run,
};
