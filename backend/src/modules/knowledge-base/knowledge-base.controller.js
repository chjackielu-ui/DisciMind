const { success } = require('../../utils/response');
const service = require('./knowledge-base.service');
const { knowledgeBaseSchema, retrievalSchema, parse } = require('./knowledge-base.schemas');

function handle(res, error) {
  return res.status(Number(error.status || (error.code === 40301 ? 403 : error.code === 40002 ? 404 : 400))).json({
    code: Number(error.code || 50001), message: error.message || '服务器错误', data: error.details || null,
  });
}
const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (error) { return handle(res, error); } };

const list = wrap(async (req, res) => success(res, await service.listKnowledgeBases(req.user.user_id, req.query)));
const accessible = wrap(async (req, res) => success(res, { list: await require('../agent-chat/agent-context.service').listAccessibleKnowledgeBases(req.user.user_id, req.query) }));
const create = wrap(async (req, res) => success(res, await service.createKnowledgeBase(req.user.user_id, parse(knowledgeBaseSchema, req.body)), '知识库创建成功'));
const difyDatasets = wrap(async (req, res) => success(res, await service.listDifyDatasets(req.user.user_id)));
const bindDify = wrap(async (req, res) => success(res, await service.bindDifyDatasets(req.user.user_id, req.body?.datasetIds), 'Dify 知识库已绑定'));
const syncDify = wrap(async (req, res) => success(res, await service.syncDifyBinding(req.user.user_id, req.params.id), 'Dify 知识库已同步'));
const detail = wrap(async (req, res) => success(res, await service.getKnowledgeBase(req.user.user_id, req.params.id)));
const update = wrap(async (req, res) => success(res, await service.updateKnowledgeBase(req.user.user_id, req.params.id, parse(knowledgeBaseSchema, req.body)), '保存成功'));
const remove = wrap(async (req, res) => success(res, await service.deleteKnowledgeBase(req.user.user_id, req.params.id), '删除成功'));
const upload = wrap(async (req, res) => success(res, await service.uploadDocument(
  req.user.user_id,
  req.params.id,
  req.file,
  String(req.body.operationId || ''),
  String(req.body.originalName || ''),
), '文件已上传，正在生成索引'));
const removeDocument = wrap(async (req, res) => success(res, await service.deleteDocument(req.user.user_id, req.params.id, req.params.documentId), '文档已删除'));
const previewDocument = wrap(async (req, res) => {
  const file = await service.getDocumentPreview(req.user.user_id, req.params.id, req.params.documentId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(file.absolutePath);
});
const retryDocument = wrap(async (req, res) => success(res, await service.retryDocument(req.user.user_id, req.params.id, req.params.documentId), '文档已重新进入处理队列'));
const applyPublic = wrap(async (req, res) => success(res, await service.applyPublic(req.user.user_id, req.params.id, req.body.operationId), '已提交审核'));
const status = wrap(async (req, res) => success(res, await service.refreshStatus(req.user.user_id, req.params.id)));
const testRetrieval = wrap(async (req, res) => success(res, await service.testRetrieval(req.user.user_id, req.params.id, parse(retrievalSchema, req.body).query)));

module.exports = { list, accessible, create, difyDatasets, bindDify, syncDify, detail, update, remove, upload, removeDocument, previewDocument, retryDocument, applyPublic, status, testRetrieval, handle };
