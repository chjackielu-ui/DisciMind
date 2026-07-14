const { Router } = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-preparation.controller');
const documentController = require('../controllers/teacher-preparation-document.controller');

const router = Router();
const teacherOnly = [authMiddleware, roleMiddleware(['teacher', 'admin'])];
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

function normalizeMultipartFilename(file) {
  if (!file?.originalname || !/[\u0080-\u009fÃÂæåçä]/.test(file.originalname)) return;
  const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
  if (!decoded.includes('\uFFFD') && /[\u3400-\u9fff]/.test(decoded)) file.originalname = decoded;
}

function acceptWorkspaceFile(req, res, next) {
  documentUpload.single('file')(req, res, (error) => {
    if (!error) { normalizeMultipartFilename(req.file); return next(); }
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, code: 40001, message: '文件超过 20MB 限制', data: null });
    return res.status(400).json({ success: false, code: 40001, message: '文件上传失败', data: null });
  });
}

router.get('/preparation/plans', ...teacherOnly, controller.list);
router.post('/preparation/plans', ...teacherOnly, controller.create);
router.get('/preparation/plans/:id', ...teacherOnly, controller.detail);
router.put('/preparation/plans/:id', ...teacherOnly, controller.save);
router.post('/preparation/plans/:id/generate', ...teacherOnly, controller.generate);
router.post('/preparation/plans/:id/refine-stage', ...teacherOnly, controller.refine);
router.get('/preparation/plans/:id/status', ...teacherOnly, controller.status);
router.get('/preparation/plans/:id/events', ...teacherOnly, controller.stream);
router.get('/preparation/plans/:id/versions', ...teacherOnly, controller.versions);
router.get('/preparation/plans/:id/compare', ...teacherOnly, controller.compare);
router.post('/preparation/plans/:id/versions/:version/restore', ...teacherOnly, controller.restore);
router.post('/preparation/plans/:id/publish', ...teacherOnly, controller.publish);
router.post('/preparation/plans/:id/export', ...teacherOnly, controller.exportFile);

router.get('/preparation/documents', ...teacherOnly, documentController.list);
router.post('/preparation/documents', ...teacherOnly, documentController.create);
router.post('/preparation/documents/import', ...teacherOnly, acceptWorkspaceFile, documentController.importFile);
router.get('/preparation/resources/selectable', ...teacherOnly, documentController.selectable);
router.get('/preparation/resources/:id/conversion', ...teacherOnly, documentController.conversionStatus);
router.post('/preparation/resources/:id/conversion/retry', ...teacherOnly, documentController.retryConversion);
router.get('/preparation/files/content', ...teacherOnly, documentController.sourceFile);
router.get('/preparation/documents/:id', ...teacherOnly, documentController.detail);
router.put('/preparation/documents/:id/draft', ...teacherOnly, documentController.save);
router.post('/preparation/documents/:id/versions', ...teacherOnly, documentController.createVersion);
router.get('/preparation/documents/:id/versions', ...teacherOnly, documentController.versions);
router.get('/preparation/documents/:id/versions/compare', ...teacherOnly, documentController.compare);
router.get('/preparation/documents/:id/versions/:versionId', ...teacherOnly, documentController.version);
router.post('/preparation/documents/:id/versions/:versionId/restore', ...teacherOnly, documentController.restore);
router.post('/preparation/documents/:id/ai-revise', ...teacherOnly, documentController.aiRevise);
router.post('/preparation/documents/:id/sync-stage', ...teacherOnly, documentController.syncStage);
router.post('/preparation/documents/:id/export', ...teacherOnly, documentController.exportFile);
router.post('/preparation/documents/:id/generate-student-material', ...teacherOnly, documentController.studentMaterial);

module.exports = router;
