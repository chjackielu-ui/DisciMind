const { success } = require('../../utils/response');
const schemas = require('./learning-card.schemas');
const daily = require('./daily-learning-card-recommendation.service');
const service = require('./learning-card.service');

function fail(res, error) {
  const status = Number(error.status || (error.code === 40301 ? 403 : error.code === 40401 ? 404 : 400));
  const numericCode = Number(error.code);
  return res.status(status).json({
    code: Number.isFinite(numericCode) ? numericCode : status >= 500 ? 50001 : 40001,
    message: error.expose === false ? '学习卡片服务暂时不可用' : error.message,
    data: error.details || null,
    error: { code: error.publicCode || (typeof error.code === 'string' ? error.code : 'LEARNING_CARD_REQUEST_FAILED') },
  });
}

const wrap = handler => async (req, res) => { try { return await handler(req, res); } catch (error) { return fail(res, error); } };

const dailyCards = wrap(async (req, res) => success(res, await daily.getDailyCards(req.user)));
const refresh = wrap(async (req, res) => success(res, await daily.refreshDailyCards(req.user, schemas.parse(schemas.dailyRefreshSchema, req.body || {})), '已换一组今日智学卡'));
const scene = wrap(async (req, res) => success(res, await service.getSceneCards(req.user, schemas.parse(schemas.sceneQuerySchema, req.query))));
const detail = wrap(async (req, res) => success(res, await service.getCard(req.user, req.params.id)));
const action = wrap(async (req, res) => success(res, await service.performAction(req.user, req.params.id, schemas.parse(schemas.cardActionSchema, req.body || {})), '卡片状态已更新'));
const addToPlan = wrap(async (req, res) => success(res, await service.addToPlan(req.user, req.params.id), '已加入复习计划'));
const startPractice = wrap(async (req, res) => success(res, await service.startPractice(req.user, req.params.id, req.body || {}), '练习已创建'));
const askAi = wrap(async (req, res) => success(res, await service.askAi(req.user, req.params.id, req.body || {}), '已创建带卡片上下文的 AI 对话'));
const courseLibrary = wrap(async (req, res) => success(res, await service.getCourseLibrary(req.user, req.params.courseId, schemas.parse(schemas.courseLibraryQuerySchema, req.query))));
const repairCard = wrap(async (req, res) => success(res, await service.getWrongQuestionRepairCard(req.user, req.params.id)));
const generate = wrap(async (req, res) => success(res, await service.generateCardsArtifact(req.user, schemas.parse(schemas.aiGenerateSchema, req.body || {})), 'LearningCard 成果已生成'));

module.exports = { dailyCards, refresh, scene, detail, action, addToPlan, startPractice, askAi, courseLibrary, repairCard, generate };
