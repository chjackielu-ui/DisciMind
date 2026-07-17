const service = require('../services/learning-goal.service');
const { getLearningGoalConfig } = require('../constants/learning-goal.constants');

function sendSuccess(res, data, message = 'ok') { res.json({ code: 0, message, data }); }
function sendError(res, error) {
  const status = Number(error.status || 500);
  const internal = status >= 500;
  const code = internal && !error.code ? 'LEARNING_GOAL_INTERNAL_ERROR' : (error.code || 'LEARNING_GOAL_INTERNAL_ERROR');
  console.error(JSON.stringify({ event: 'learning_goal_error', code, status, message: String(error.message || '').slice(0, 300) }));
  res.status(status).json({ code, message: internal ? '学习目标处理暂时失败，请稍后重试；固定知识点学习仍可使用。' : error.message, data: internal ? null : (error.data || null) });
}
const wrap = (handler) => async (req, res) => { try { await handler(req, res); } catch (error) { sendError(res, error); } };

const getConfig = wrap(async (req, res) => {
  const config = getLearningGoalConfig();
  sendSuccess(res, { enabled: config.enabled, limits: { maxInputChars: config.maxInputChars, maxSubGoals: config.maxSubGoals, maxRelatedKnowledgePoints: config.maxRelatedKnowledgePoints } });
});
const resolve = wrap(async (req, res) => sendSuccess(res, await service.resolveGoal(req.body, req.user.user_id), '学习目标分析完成'));
const list = wrap(async (req, res) => sendSuccess(res, await service.listGoals(req.user.user_id, req.query)));
const get = wrap(async (req, res) => sendSuccess(res, await service.getGoal(req.params.goalId, req.user.user_id)));
const patch = wrap(async (req, res) => sendSuccess(res, await service.updateGoal(req.params.goalId, req.user.user_id, req.body), '学习目标已更新'));
const confirm = wrap(async (req, res) => sendSuccess(res, await service.confirmGoal(req.params.goalId, req.user.user_id), '学习目标已确认'));
const workflowPreview = wrap(async (req, res) => sendSuccess(res, await service.createWorkflowPreview(req.params.goalId, req.user.user_id), '学习流预览已生成'));
const start = wrap(async (req, res) => sendSuccess(res, await service.startGoal(req.params.goalId, req.user.user_id), '学习会话已启动'));
const cancel = wrap(async (req, res) => sendSuccess(res, await service.cancelGoal(req.params.goalId, req.user.user_id), '学习目标已取消'));

module.exports = { getConfig, resolve, list, get, patch, confirm, workflowPreview, start, cancel };
