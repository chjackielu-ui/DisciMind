const { success } = require('../../utils/response');
const { TrainerWorkflowError } = require('./trainer.errors');
const { TrainerAgentError } = require('../agent/trainer/trainer.errors');
const { validateTrainerRunInput } = require('./trainer.validator');
const trainerRuntimeService = require('../agent/trainer/trainer-runtime.service');

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
  if (err instanceof TrainerWorkflowError || err instanceof TrainerAgentError) {
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
    const { businessResult, metadata } = await trainerRuntimeService.runTrainerWorkflow(input);

    console.log('[trainer.controller] 训练师运行完成:', {
      user_id: userId,
      request_id: input.requestId,
      mode: input.mode,
      elapsed_time: metadata.elapsed_time,
      total_tokens: metadata.total_tokens,
    });

    return success(res, businessResult, '训练师运行成功');
  } catch (err) {
    console.warn('[trainer.controller] 训练师运行失败:', {
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
