const { AgentIntegrationError } = require('../common/agent.errors');
const explainerService = require('./explainer.service');

function getUserId(req) {
  return req.user?.user_id;
}

function sendError(res, scope, err) {
  const knownError = err instanceof AgentIntegrationError;
  const code = knownError ? err.code : (err.code || 'EXPLAINER_INTERNAL_ERROR');
  const status = knownError ? err.status : (err.status || 500);
  const message = knownError ? err.message : '讲解者服务异常，请稍后重试';

  console.error(`[Explainer][${scope}] ERROR code=${code} status=${status}`, err.message);

  if (res.headersSent) {
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ code, message, retryable: status >= 500 })}\n\n`);
      res.end();
    }
    return null;
  }

  return res.status(status).json({
    code,
    message,
    data: knownError ? err.data : null,
  });
}

async function chat(req, res) {
  const requestId = req.body?.requestId || ('req_' + Date.now().toString(36));
  const userId = getUserId(req);
  const kpId = req.body?.knowledgePointId;
  const sessionId = req.body?.learningSessionId;
  const nodeId = req.body?.nodeId;

  console.log(`[Agent][${requestId}] express_route_entered agent=explainer`);
  console.log(`[Agent][${requestId}] local_jwt_verified userId=${userId}`);
  console.log(`[Agent][${requestId}] session_loaded sessionId=${sessionId || 'N/A'} nodeId=${nodeId || 'N/A'} kpId=${kpId}`);
  console.log(`[Agent][${requestId}] explainer_controller_entered`);

  try {
    if (!userId) {
      console.log(`[Agent][${requestId}] failed stage=local_jwt_authentication status=401 reason=userId_missing`);
      return res.status(401).json({
        code: 'LOCAL_AUTH_TOKEN_INVALID',
        source: 'discimind',
        stage: 'local_jwt_authentication',
        message: '无法获取用户身份',
        data: null,
      });
    }

    console.log(`[Agent][${requestId}] explainer_service_entered`);
    await explainerService.streamExplainerChat({
      req,
      res,
      userId,
      body: { ...(req.body || {}), requestId },
    });
    return null;
  } catch (err) {
    console.log(`[Agent][${requestId}] failed stage=explainer_service error=${err.code || err.message}`);
    return sendError(res, 'chat', err);
  }
}

module.exports = {
  chat,
};
