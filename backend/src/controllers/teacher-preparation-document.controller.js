const path = require('path');
const { success, fail } = require('../utils/response');
const service = require('../services/teacher-preparation-document.service');
const conversionService = require('../services/document-conversion.service');

function id(value, field = 'id') {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw Object.assign(new Error(`${field} 参数不合法`), { code: 40001 });
  return parsed;
}

function handle(res, scope, error) {
  console.error(`[teacher-preparation-document.controller] ${scope}:`, error.message);
  const data = error.serverRevision || error.resource || error.scanned
    ? { server_revision: error.serverRevision || null, scanned: Boolean(error.scanned), resource: error.resource || null }
    : null;
  return fail(res, error.code || 50001, error.code ? error.message : '服务器错误', data);
}

async function list(req, res) { try { return success(res, await service.listDocuments(req.user, req.query || {})); } catch (error) { return handle(res, 'list', error); } }
async function create(req, res) { try { return success(res, await service.createDocument(req.user, req.body || {}), '教案草稿已创建'); } catch (error) { return handle(res, 'create', error); } }
async function detail(req, res) { try { return success(res, await service.getDocument(req.user, id(req.params.id))); } catch (error) { return handle(res, 'detail', error); } }
async function save(req, res) { try { return success(res, await service.saveDraft(req.user, id(req.params.id), req.body || {}), '教案草稿已保存'); } catch (error) { return handle(res, 'save', error); } }
async function createVersion(req, res) { try { return success(res, await service.createVersion(req.user, id(req.params.id), req.body || {}), '教案版本已创建'); } catch (error) { return handle(res, 'createVersion', error); } }
async function versions(req, res) { try { return success(res, await service.listVersions(req.user, id(req.params.id))); } catch (error) { return handle(res, 'versions', error); } }
async function version(req, res) { try { return success(res, await service.getVersion(req.user, id(req.params.id), id(req.params.versionId, 'version_id'))); } catch (error) { return handle(res, 'version', error); } }
async function compare(req, res) { try { return success(res, await service.compareVersions(req.user, id(req.params.id), id(req.query.from, 'from'), id(req.query.to, 'to'))); } catch (error) { return handle(res, 'compare', error); } }
async function restore(req, res) { try { return success(res, await service.restoreVersion(req.user, id(req.params.id), id(req.params.versionId, 'version_id')), '已从旧版本创建新草稿'); } catch (error) { return handle(res, 'restore', error); } }
async function importFile(req, res) { try { return success(res, await service.importDocument(req.user, req.file, req.body || {}), '文件已处理'); } catch (error) { return handle(res, 'import', error); } }
async function selectable(req, res) { try { return success(res, await service.listSelectableResources(req.user, req.query || {})); } catch (error) { return handle(res, 'selectable', error); } }
async function aiRevise(req, res) { try { return success(res, await service.aiRevise(req.user, id(req.params.id), req.body || {}), 'AI 建议已生成，确认后才会应用'); } catch (error) { return handle(res, 'aiRevise', error); } }
async function syncStage(req, res) { try { return success(res, await service.syncStage(req.user, id(req.params.id), req.body || {})); } catch (error) { return handle(res, 'syncStage', error); } }
async function exportFile(req, res) { try { return success(res, await service.exportDocument(req.user, id(req.params.id), req.body || {}), '导出任务已创建'); } catch (error) { return handle(res, 'export', error); } }
async function studentMaterial(req, res) { try { return success(res, await service.generateStudentMaterial(req.user, id(req.params.id), req.body || {}), req.body?.preview_only === false ? '学生材料任务已创建' : '学生材料预览已生成'); } catch (error) { return handle(res, 'studentMaterial', error); } }
async function conversionStatus(req, res) { try { return success(res, await conversionService.conversionStatus(req.user, id(req.params.id))); } catch (error) { return handle(res, 'conversionStatus', error); } }
async function retryConversion(req, res) { try { return success(res, await conversionService.startConversion(req.user, id(req.params.id), { retry: true }), 'PPT 转换任务已重新提交'); } catch (error) { return handle(res, 'retryConversion', error); } }

async function sourceFile(req, res) {
  try {
    const source = await service.getSourceFile(req.user, String(req.query.source_kind || 'resource'), id(req.query.id, 'source_id'), req.query.format);
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', source.mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="workspace-file${path.extname(source.fileName || '')}"; filename*=UTF-8''${encodeURIComponent(source.fileName || 'workspace-file')}`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.sendFile(source.absolute);
  } catch (error) { return handle(res, 'sourceFile', error); }
}

module.exports = {
  list, create, detail, save, createVersion, versions, version, compare, restore,
  importFile, selectable, aiRevise, syncStage, exportFile, studentMaterial, conversionStatus, retryConversion, sourceFile,
};
