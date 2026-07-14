const fs = require('fs');
const path = require('path');
const service = require('../services/student-resource.service');
const { success, fail } = require('../utils/response');

function handle(res, operation, error) {
  console.error(`[StudentResource] ${operation}`, error);
  return fail(res, error, error.message || '资源服务暂时不可用');
}

async function listResources(req, res) {
  try { return success(res, await service.listResources(req.user, req.query || {})); } catch (error) { return handle(res, 'listResources', error); }
}

async function openResource(req, res) {
  try { return success(res, await service.openResource(req.user, req.params.recipient_id)); } catch (error) { return handle(res, 'openResource', error); }
}

async function completeResource(req, res) {
  try { return success(res, await service.completeResource(req.user, req.params.recipient_id)); } catch (error) { return handle(res, 'completeResource', error); }
}

async function downloadResource(req, res) {
  try {
    const resource = await service.getDownload(req.user, req.params.recipient_id);
    if (/^https?:\/\//i.test(String(resource.external_url || ''))) return res.redirect(resource.external_url);
    const storageRoot = path.resolve(__dirname, '../../../storage');
    const absolute = path.resolve(storageRoot, `.${resource.file_url}`);
    if (!absolute.startsWith(`${storageRoot}${path.sep}`) || !fs.existsSync(absolute)) return fail(res, 40002, '资源文件不存在');
    return res.download(absolute, resource.original_filename);
  } catch (error) { return handle(res, 'downloadResource', error); }
}

module.exports = { listResources, openResource, completeResource, downloadResource };
