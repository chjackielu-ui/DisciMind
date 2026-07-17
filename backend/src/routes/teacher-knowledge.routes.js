// 教师端知识库管理路由
// 前缀：/api/teacher

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-knowledge.controller');

const router = Router();
const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

// ---- 文件上传配置 ----
const uploadDir = path.join(__dirname, '../../../storage/uploads/documents');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_FILE_TYPES = new Map([
  ['.pdf', new Set(['application/pdf'])],
  ['.docx', new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])],
  ['.doc', new Set(['application/msword'])],
  ['.pptx', new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation'])],
  ['.ppt', new Set(['application/vnd.ms-powerpoint'])],
  ['.xlsx', new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])],
  ['.xls', new Set(['application/vnd.ms-excel'])],
  ['.txt', new Set(['text/plain'])],
  ['.md', new Set(['text/markdown', 'text/plain'])],
  ['.png', new Set(['image/png'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.webp', new Set(['image/webp'])],
  ['.gif', new Set(['image/gif'])],
]);

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.txt';
      const safeName = `teacher-doc-${req.user?.user_id || 'unknown'}-${Date.now()}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_FILE_TYPES.get(ext)?.has(String(file.mimetype || '').toLowerCase())) {
      cb(null, true);
      return;
    }
    cb(new Error('文件扩展名与 MIME 类型不匹配或不受支持'));
  },
});

// ---- 路由 ----

router.get('/knowledge-documents', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listDocuments);
router.get('/resources', authMiddleware, roleMiddleware(['teacher', 'admin']), (req, _res, next) => { req.query.resource_only = true; next(); }, controller.listDocuments);
router.post('/resources/external', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createExternalResource);
router.put('/resources/:document_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.updateResource);
router.delete('/resources/:document_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteResource);
router.post('/resources/:document_id/share', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.shareResource);
router.get('/resources/:document_id/distributions', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getResourceDistributionStats);
router.get('/resources/:document_id/download', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.downloadResource);
router.get('/knowledge-base-applications', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listKnowledgeBaseApplications);
router.post('/knowledge-base-applications/batch-review', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.batchReviewKnowledgeBaseApplications);
router.post('/knowledge-base-applications/:review_id/review', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.reviewKnowledgeBaseApplication);
router.post('/knowledge-bases/:knowledge_base_id/revoke-public', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.revokeKnowledgeBasePublic);
router.get('/knowledge-documents/:document_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getDocument);
router.put('/knowledge-documents/:document_id/review', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.reviewDocument);

// 上传文档
router.post(
  '/knowledge-documents/upload',
  authMiddleware,
  roleMiddleware(['teacher', 'admin']),
  (req, res, next) => {
    documentUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ code: 40001, message: '文件大小超过 30MB 限制', data: null });
        }
        return res.status(400).json({ code: 40001, message: err.message || '文件上传失败', data: null });
      }
      next();
    });
  },
  controller.uploadDocument,
);

module.exports = router;
