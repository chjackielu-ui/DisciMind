// 学生端知识库文档路由
// 前缀：/api/student/documents

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/student-document.controller');

const router = Router();

// 确保上传目录存在
const uploadDir = path.join(__dirname, '../../../storage/uploads/documents');
fs.mkdirSync(uploadDir, { recursive: true });

// 允许的文件类型
const ALLOWED_MIMETYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/msword',
  'text/markdown',
  'text/x-markdown',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.md'];
const ALLOWED_MIMES_BY_EXTENSION = {
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.doc': ['application/msword'],
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/x-markdown', 'text/plain'],
};

// multer 配置
const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.txt';
      const safeName = `doc-${req.user?.user_id || 'unknown'}-${Date.now()}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
<<<<<<< Updated upstream
    const allowedMimes = ALLOWED_MIMES_BY_EXTENSION[ext] || [];
    if (ALLOWED_EXTENSIONS.includes(ext) && ALLOWED_MIMETYPES.includes(file.mimetype) && allowedMimes.includes(file.mimetype)) {
=======
    if (ALLOWED_MIMETYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext)) {
>>>>>>> Stashed changes
      cb(null, true);
      return;
    }
    cb(new Error('不支持的文件类型，仅支持 PDF、DOCX、DOC、TXT、MD 格式'));
  },
});

// 上传文档
router.post(
  '/documents/upload',
  authMiddleware,
  roleMiddleware(['student']),
  (req, res, next) => {
    documentUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            code: 40001,
            message: '文件大小超过 20MB 限制',
            data: null,
          });
        }
        return res.status(400).json({
          code: 40001,
          message: err.message || '文件上传失败',
          data: null,
        });
      }
      next();
    });
  },
  controller.uploadDocument,
);

// 解析文档
router.post(
  '/documents/:document_id/parse',
  authMiddleware,
  roleMiddleware(['student']),
  controller.parseDocument,
);

// 获取文档列表
router.get(
  '/documents',
  authMiddleware,
  roleMiddleware(['student']),
  controller.listDocuments,
);

// 获取文档详情
router.get(
  '/documents/:document_id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.getDocument,
);

// 下载必须验证资源归属或课程可见性，禁止直接暴露 storage 路径。
router.get(
  '/documents/:document_id/download',
  authMiddleware,
  roleMiddleware(['student']),
  controller.downloadDocument,
);

// 删除文档
router.delete(
  '/documents/:document_id',
  authMiddleware,
  roleMiddleware(['student']),
  controller.deleteDocument,
);

module.exports = router;
