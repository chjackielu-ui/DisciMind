const path = require('path');
const service = require('../services/course-file.service');
const { success } = require('../utils/response');

function handle(res, error) {
  const status = Number(error.status || (error.code === 40301 ? 403 : error.code === 40401 ? 404 : 400));
  return res.status(status).json({ code: Number(error.code || 50001), message: error.message || '课程文件服务暂不可用', data: null });
}

async function authorizeUpload(req, res, next) {
  try { req.courseFileTeachingClass = await service.ensureTeacherClassAccess(req.user, req.params.courseId, req.params.classId); return next(); }
  catch (error) { return handle(res, error); }
}

async function list(req, res) {
  try { return success(res, await service.list(req.user, req.params.courseId, req.params.classId, req.query || {}), '获取课程文件成功'); }
  catch (error) { return handle(res, error); }
}

async function upload(req, res) {
  try {
    const data = await service.upload(req.user, req.params.courseId, req.params.classId, req.file, req.body || {});
    res.status(data.duplicate ? 200 : 201);
    return success(res, data, data.duplicate ? '相同文件已存在' : '课程文件上传成功');
  } catch (error) { return handle(res, error); }
}

async function update(req, res) {
  try { return success(res, await service.update(req.user, req.params.courseId, req.params.classId, req.params.fileId, req.body || {}), '课程文件已更新'); }
  catch (error) { return handle(res, error); }
}

async function publish(req, res) {
  try { return success(res, await service.publish(req.user, req.params.courseId, req.params.classId, req.params.fileId), '课程文件已发布'); }
  catch (error) { return handle(res, error); }
}

async function unpublish(req, res) {
  try { return success(res, await service.unpublish(req.user, req.params.courseId, req.params.classId, req.params.fileId), '课程文件已下架'); }
  catch (error) { return handle(res, error); }
}

async function remove(req, res) {
  try { return success(res, await service.remove(req.user, req.params.courseId, req.params.classId, req.params.fileId), '课程文件已删除'); }
  catch (error) { return handle(res, error); }
}

async function download(req, res) {
  try {
    const file = await service.authorizeDownload(req.user, req.params.courseId, req.params.classId, req.params.fileId);
    const asciiFallback = `course-file${path.extname(file.filename || '')}`.replace(/[^\x20-\x7e]/g, '') || 'course-file';
    const encoded = encodeURIComponent(file.filename)
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/\*/g, '%2A');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`);
    return res.sendFile(file.absolutePath);
  } catch (error) { return handle(res, error); }
}

module.exports = { authorizeUpload, list, upload, update, publish, unpublish, remove, download };
