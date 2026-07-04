// 管理员端 AI 配置控制器（占位）
// AI 相关功能暂不实现，仅返回"该功能正在开发中，敬请期待"

const { success } = require('../utils/response');

const PLACEHOLDER_DATA = {
  list: [],
  total: 0,
  page: 1,
  page_size: 10,
  placeholder: true,
  hint: '该功能正在开发中，敬请期待',
};

const PLACEHOLDER_MESSAGE = '该功能正在开发中，敬请期待';

async function getAiModelConfigs(req, res) {
  return success(res, PLACEHOLDER_DATA, 'success');
}

async function createAiModelConfig(req, res) {
  return success(res, null, PLACEHOLDER_MESSAGE);
}

async function getAiCallLogs(req, res) {
  return success(res, PLACEHOLDER_DATA, 'success');
}

module.exports = { getAiModelConfigs, createAiModelConfig, getAiCallLogs };
