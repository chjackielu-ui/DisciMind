const { success } = require('../../../utils/response');
const { TrainerWorkflowError } = require('../../dify/trainer.errors');
const { TrainerAgentError } = require('./trainer.errors');
const trainerService = require('./trainer.service');
const {
  validateAnswerBody,
  validateContextQuery,
  validateCreateSessionBody,
  validateSessionId,
} = require('./trainer.validator');

function getUserId(req) {
  return req.user?.user_id;
}

function sendError(res, scope, err) {
  const knownError = err instanceof TrainerAgentError || err instanceof TrainerWorkflowError;
  const code = knownError
    ? err.code
    : (err.code || 'TRAINER_INTERNAL_ERROR');
  const status = knownError
    ? err.status
    : (err.status || 500);
  const message = knownError
    ? err.message
    : '训练师服务异常，请稍后重试';

  console.error(`[trainer.agent.controller] ${scope} 异常:`, {
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

async function getContext(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const params = validateContextQuery(req.query || {});
    const data = await trainerService.getTrainerContext(userId, params);
    return success(res, data, '获取训练师上下文成功');
  } catch (err) {
    return sendError(res, 'getContext', err);
  }
}

async function createSession(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const params = validateCreateSessionBody(req.body || {});
    const data = await trainerService.createTrainerSession(userId, params);
    return success(res, data, '训练师会话已创建');
  } catch (err) {
    return sendError(res, 'createSession', err);
  }
}

async function listSessions(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const data = await trainerService.listTrainerSessions(userId, req.query || {});
    return success(res, data, '获取训练师历史成功');
  } catch (err) {
    return sendError(res, 'listSessions', err);
  }
}

async function getSession(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const sessionId = validateSessionId(req.params.sessionId || req.params.session_id);
    const data = await trainerService.getTrainerSession(userId, sessionId);
    return success(res, data, '获取训练师会话成功');
  } catch (err) {
    return sendError(res, 'getSession', err);
  }
}

async function submitAnswer(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const sessionId = validateSessionId(req.params.sessionId || req.params.session_id);
    const body = validateAnswerBody(req.body || {});
    const data = await trainerService.submitTrainerAnswer(userId, sessionId, body);
    return success(res, data, data.duplicated ? '答案已提交，返回已有结果' : '答案提交成功');
  } catch (err) {
    return sendError(res, 'submitAnswer', err);
  }
}

async function completeSession(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const sessionId = validateSessionId(req.params.sessionId || req.params.session_id);
    const data = await trainerService.completeTrainerSession(userId, sessionId);
    return success(res, data, '训练师会话已完成');
  } catch (err) {
    return sendError(res, 'completeSession', err);
  }
}

async function abandonSession(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const sessionId = validateSessionId(req.params.sessionId || req.params.session_id);
    const data = await trainerService.abandonTrainerSession(userId, sessionId);
    return success(res, data, data.abandoned ? '训练师会话已放弃' : '训练师会话已结束');
  } catch (err) {
    return sendError(res, 'abandonSession', err);
  }
}

async function getReport(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const sessionId = validateSessionId(req.params.sessionId || req.params.session_id);
    const data = await trainerService.getTrainerReport(userId, sessionId);
    return success(res, data, '获取训练师报告成功');
  } catch (err) {
    return sendError(res, 'getReport', err);
  }
}

async function getEvents(req, res) {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ code: 40101, message: '无法获取用户身份', data: null });
    const sessionId = validateSessionId(req.params.sessionId || req.params.session_id);
    const data = await trainerService.getTrainerEvents(userId, sessionId);
    return success(res, data, '获取训练师时间线成功');
  } catch (err) {
    return sendError(res, 'getEvents', err);
  }
}

module.exports = {
  abandonSession,
  completeSession,
  createSession,
  getContext,
  getEvents,
  getReport,
  getSession,
  listSessions,
  submitAnswer,
};
