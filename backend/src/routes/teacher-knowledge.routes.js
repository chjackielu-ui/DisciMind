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

// ---- 文件上传配置 ----
const uploadDir = path.join(__dirname, '../../../storage/uploads/documents');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.md'];

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.txt';
      const safeName = `teacher-doc-${req.user?.user_id || 'unknown'}-${Date.now()}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('不支持的文件类型，仅支持 PDF、DOCX、DOC、TXT、MD 格式'));
  },
});

// ---- 路由 ----

router.get('/knowledge-documents', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listDocuments);
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
          return res.status(400).json({ code: 40001, message: '文件大小超过 20MB 限制', data: null });
        }
        return res.status(400).json({ code: 40001, message: err.message || '文件上传失败', data: null });
      }
      next();
    });
  },
  controller.uploadDocument,
);

module.exports = router;
