const { z } = require('zod');
const { success, fail } = require('../utils/response');
const service = require('../services/admin-ai-config.service');
const schemas = require('../services/admin-ai-config.schemas');
const environmentService = require('../services/admin-environment.service');

function parse(schema, value) {
  const result = schema.safeParse(value || {});
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.') || '参数'}：${issue.message}`).join('；');
    throw Object.assign(new Error(message), { code: 40001 });
  }
  return result.data;
}

function action(handler, message) {
  return async (req, res) => {
    try { return success(res, await handler(req), message); }
    catch (error) { return fail(res, error.code || 50001, error.message); }
  };
}

const getProviders = action(() => service.listProviders(), '获取供应商列表成功');
const getProvider = action((req) => service.getProvider(req.params.id), '获取供应商成功');
const createProvider = action((req) => service.createProvider(parse(schemas.providerInput, req.body), req), '创建供应商成功');
const updateProvider = action((req) => service.updateProvider(req.params.id, parse(schemas.providerUpdate, req.body), req), '更新供应商成功');
const testProvider = action((req) => service.testProvider(req.params.id, req), '连接测试成功');
const enableProvider = action((req) => service.setProviderEnabled(req.params.id, true, req), '供应商已启用');
const disableProvider = action((req) => service.setProviderEnabled(req.params.id, false, req), '供应商已停用');
const replaceProviderSecret = action((req) => service.replaceProviderSecret(req.params.id, parse(schemas.providerSecretInput, req.body), req), '供应商密钥已替换');
const clearProviderSecret = action((req) => {
  parse(schemas.providerSecretClear, req.body);
  return service.clearProviderSecret(req.params.id, req);
}, '供应商密钥已清除');

const getModels = action((req) => service.listModels(req.query), '获取模型列表成功');
const getModel = action((req) => service.getModel(req.params.id), '获取模型成功');
const createModel = action((req) => service.createModel(parse(schemas.modelInput, req.body), req), '创建模型成功');
const updateModel = action((req) => service.updateModel(req.params.id, parse(schemas.modelUpdate, req.body), req), '更新模型成功');
const testModel = action((req) => service.testModel(req.params.id, req), '模型测试成功');
const enableModel = action((req) => service.setModelEnabled(req.params.id, true, req), '模型已启用');
const disableModel = action((req) => service.setModelEnabled(req.params.id, false, req), '模型已停用');
const setDefaultModel = action((req) => service.setDefaultModel(req.params.id, req), '默认模型已更新');

const getAgents = action(() => service.listAgents(), '获取 Agent 列表成功');
const getAgent = action((req) => service.getAgent(req.params.id), '获取 Agent 成功');
const createAgent = action((req) => service.createAgent(parse(schemas.agentInput, req.body), req), '创建 Agent 成功');
const updateAgent = action((req) => service.updateAgent(req.params.id, parse(schemas.agentUpdate, req.body), req), '更新 Agent 成功');
const testAgent = action((req) => service.testAgent(req.params.id, req), 'Agent 测试成功');
const publishAgent = action((req) => service.publishAgent(req.params.id, req), 'Agent 发布成功');
const rollbackAgent = action((req) => service.rollbackAgent(req.params.id, parse(z.object({ version_id: z.coerce.number().int().positive() }).strict(), req.body).version_id, req), 'Agent 回滚成功');

const getEnvironmentStatus = action(() => environmentService.getEnvironmentStatus(), '获取环境状态成功');

// Legacy compatibility: old admin clients now receive real normalized model data.
const getAiModelConfigs = getModels;
const createAiModelConfig = createModel;
const getAiCallLogs = action(async (req) => {
  const prisma = require('../config/prisma');
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
  const [list, total] = await Promise.all([
    prisma.aiCallLog.findMany({ orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.aiCallLog.count(),
  ]);
  return { list, total, page, page_size: pageSize };
}, '获取 AI 调用日志成功');

module.exports = {
  getProviders, getProvider, createProvider, updateProvider, testProvider, enableProvider, disableProvider, replaceProviderSecret, clearProviderSecret,
  getModels, getModel, createModel, updateModel, testModel, enableModel, disableModel, setDefaultModel,
  getAgents, getAgent, createAgent, updateAgent, testAgent, publishAgent, rollbackAgent,
  getEnvironmentStatus, getAiModelConfigs, createAiModelConfig, getAiCallLogs,
};
