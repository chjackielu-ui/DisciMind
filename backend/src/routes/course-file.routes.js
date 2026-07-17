const { Router } = require('express');
const path = require('path');
const multer = require('multer');
const auth = require('../middlewares/auth.middleware');
const roles = require('../middlewares/role.middleware');
const controller = require('../controllers/course-file.controller');
const { requireAdminPermission } = require('../services/admin-permission.service');

const router = Router();
const adminView = requireAdminPermission('admin.teaching.view');
const adminManage = requireAdminPermission('admin.teaching.manage');
const allowed = new Map([
  ['.pdf', new Set(['application/pdf'])],
  ['.docx', new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'])],
  ['.pptx', new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/octet-stream'])],
  ['.xlsx', new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])],
  ['.txt', new Set(['text/plain', 'application/octet-stream'])],
  ['.md', new Set(['text/markdown', 'text/plain', 'application/octet-stream'])],
  ['.csv', new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain'])],
  ['.png', new Set(['image/png'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.webp', new Set(['image/webp'])],
  ['.zip', new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream'])],
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimes = allowed.get(ext);
    if (!mimes || !mimes.has(String(file.mimetype || '').toLowerCase())) return callback(new Error('文件扩展名或 MIME 类型不受支持'));
    return callback(null, true);
  },
});

function uploadOne(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE' ? '文件大小不能超过 30MB' : (error.message || '文件上传失败');
    return res.status(400).json({ code: 40001, message, data: null });
  });
}

function adminOnlyPermission(guard) {
  return (req, res, next) => String(req.user?.role || '').toLowerCase() === 'admin' ? guard(req, res, next) : next();
}

router.use(auth, roles(['student', 'teacher', 'admin']));
router.get('/:courseId/teaching-classes/:classId/files', adminOnlyPermission(adminView), controller.list);
router.post('/:courseId/teaching-classes/:classId/files', roles(['teacher', 'admin']), adminOnlyPermission(adminManage), controller.authorizeUpload, uploadOne, controller.upload);
router.patch('/:courseId/teaching-classes/:classId/files/:fileId', roles(['teacher', 'admin']), adminOnlyPermission(adminManage), controller.update);
router.post('/:courseId/teaching-classes/:classId/files/:fileId/publish', roles(['teacher', 'admin']), adminOnlyPermission(adminManage), controller.publish);
router.post('/:courseId/teaching-classes/:classId/files/:fileId/unpublish', roles(['teacher', 'admin']), adminOnlyPermission(adminManage), controller.unpublish);
router.delete('/:courseId/teaching-classes/:classId/files/:fileId', roles(['teacher', 'admin']), adminOnlyPermission(adminManage), controller.remove);
router.get('/:courseId/teaching-classes/:classId/files/:fileId/download', adminOnlyPermission(adminView), controller.download);

module.exports = router;
