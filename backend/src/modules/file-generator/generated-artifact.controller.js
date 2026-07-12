const path = require('path');
const { success } = require('../../utils/response');
const schemas = require('./generated-artifact.schemas');
const service = require('./generated-artifact.service');

function handle(res, error) {
  const status = Number(error.status || 500);
  const internal = status >= 500 || /Invalid `?prisma\.|PrismaClient|[A-Z]:[\\/]|node_modules[\\/]/i.test(String(error.message || ''));
  const numericCode = Number(error.code);
  return res.status(status).json({ code: Number.isInteger(numericCode) ? numericCode : status >= 500 ? 50001 : 40001, message: internal ? '服务器内部错误，请稍后重试' : error.message, data: null });
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
  return success(res, await service.requestExport(req.user, req.params.id, input.operationId, input.formats), '导出任务已创建');
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
const downloadExport = wrap(async(req,res)=>{const file=await service.getExportDownload(req.user,req.params.id,req.params.format);const name=safeDownloadName(file.fileName);res.setHeader('Content-Type',file.mimeType);res.setHeader('Content-Length',String(file.size));res.setHeader('Content-Disposition',`attachment; filename="artifact.${file.extension}"; filename*=UTF-8''${encodeURIComponent(name)}`);return res.sendFile(file.absolutePath)});

module.exports = { list, detail, download, downloadExport, exportDocument, remove, safeDownloadName };
