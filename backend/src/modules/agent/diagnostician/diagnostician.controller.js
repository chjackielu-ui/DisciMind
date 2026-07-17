const { success } = require('../../../utils/response');
const { AgentIntegrationError } = require('../common/agent.errors');
const diagnosticianService = require('./diagnostician.service');

function sendError(res, scope, err) {
  const knownError = err instanceof AgentIntegrationError;
  const code = knownError ? err.code : (err.code || 'DIAGNOSTICIAN_INTERNAL_ERROR');
  const status = knownError ? err.status : (err.status || 500);
  const message = knownError ? err.message : '诊断师服务异常，请稍后重试';

  console.error(`[diagnostician.controller] ${scope} 异常:`, {
    code,
    status,
    message: err.message,
  });

  return res.status(status).json({
    code,
    message,
    data: knownError ? err.data : null,
  });
}

async function analyze(req, res) {
  try {
    if (!req.user?.user_id) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const data = await diagnosticianService.analyze(req.user, req.body || {});
    return success(res, data, '诊断师分析完成');
  } catch (err) {
    return sendError(res, 'analyze', err);
  }
}

module.exports = {
  analyze,
};
