// 教师端 AI 功能控制器（占位实现）
// 所有 AI 功能统一返回"开发中"提示

const { success } = require('../utils/response');

const PLACEHOLDER_MESSAGE = '该功能正在开发中，敬请期待';

function handlePlaceholder(req, res, featureName) {
  return success(res, {
    feature: featureName,
    status: 'coming_soon',
    message: PLACEHOLDER_MESSAGE,
  }, PLACEHOLDER_MESSAGE);
}

async function generateQuestions(req, res) {
  return handlePlaceholder(req, res, 'ai_generate_questions');
}

async function generateSummary(req, res) {
  return handlePlaceholder(req, res, 'ai_generate_summary');
}

async function videoGeneration(req, res) {
  return handlePlaceholder(req, res, 'ai_video_generation');
}

async function learningAnalysis(req, res) {
  return handlePlaceholder(req, res, 'ai_learning_analysis');
}

module.exports = {
  generateQuestions,
  generateSummary,
  videoGeneration,
  learningAnalysis,
};
