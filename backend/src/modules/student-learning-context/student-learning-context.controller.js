const { success } = require('../../utils/response');
const schemas = require('./student-learning-context.schemas');
const service = require('./student-learning-context.service');
const wrap = handler => async (req, res, next) => {
  try { await handler(req, res); } catch (error) {
    const requestId = req.get('x-request-id') || `learning_context_${Date.now().toString(36)}`;
    console.error(`[student-learning-context][${requestId}]`, error?.code || 'UNEXPECTED', error?.message || error);
    next(error);
  }
};

const get = wrap(async (req, res) => success(res, await service.getContext(req.user, { refresh: req.query.refresh === 'true' })));
const put = wrap(async (req, res) => success(res, await service.putContext(req.user, schemas.parse(schemas.updateSchema, req.body)), '当前学习上下文已更新'));
const clear = wrap(async (req, res) => success(res, await service.clearContext(req.user), '当前学习上下文已清除'));
module.exports = { get, put, clear };
