const path = require('path');
const { success } = require('../../utils/response');
const schemas = require('./generated-artifact.schemas');
const service = require('./generated-artifact.service');

function handle(res, error) {
  return res.status(Number(error.status || 400)).json({ code: Number(error.code || 50001), message: error.message, data: null });
}

const wrap = (handler) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (error) {
    return handle(res, error);
  }
};

function safeDownloadName(value) {
  const base = path.basename(String(value || '学习资料.docx')).normalize('NFKC');
  return base.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 180) || '学习资料.docx';
}

const list = wrap(async (req, res) => success(res, await service.listArtifacts(req.user, schemas.parse(schemas.listSchema, req.query))));
const detail = wrap(async (req, res) => success(res, await service.getArtifact(req.user, req.params.id)));
const exportDocument = wrap(async (req, res) => {
  const input = schemas.parse(schemas.exportSchema, req.body);
  return success(res, await service.requestExport(req.user, req.params.id, input.operationId), '导出任务已创建');
});
const remove = wrap(async (req, res) => success(res, await service.deleteArtifact(req.user, req.params.id), '文件已删除'));

const download = wrap(async (req, res) => {
  const file = await service.getDownload(req.user, req.params.id);
  const fileName = safeDownloadName(file.fileName);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `attachment; filename="artifact.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return res.sendFile(file.absolutePath, (error) => {
    if (error && !res.headersSent) handle(res, Object.assign(error, { status: error.status || 500 }));
  });
});

module.exports = { list, detail, download, exportDocument, remove, safeDownloadName };
