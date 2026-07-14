const { Router } = require('express');
const multer = require('multer');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./knowledge-base.controller');
const { MAX_FILE_BYTES } = require('./knowledge-base.service');
const { rateLimit } = require('../agent-marketplace/marketplace-rate-limit');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
router.use(auth, roles(['student', 'teacher']));
router.get('/', controller.list);
router.get('/accessible', controller.accessible);
router.get('/dify/datasets', controller.difyDatasets);
router.post('/dify/bind', rateLimit({ max: 10, keyPrefix: 'kb-bind-dify' }), controller.bindDify);
router.post('/', rateLimit({ max: 10, keyPrefix: 'kb-create' }), controller.create);
router.post('/:id/sync-dify', controller.syncDify);
router.get('/:id/status', controller.status);
router.post('/:id/test-retrieval', rateLimit({ max: 20, keyPrefix: 'kb-test' }), controller.testRetrieval);
router.post('/:id/apply-public', controller.applyPublic);
router.post('/:id/documents', rateLimit({ max: 10, keyPrefix: 'kb-upload' }), (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE' ? '文件上传失败：单个文件不能超过 30 MB。' : `文件上传失败：${error.message}`;
    return res.status(400).json({ code: 40001, message, data: null });
  });
}, controller.upload);
router.get('/:id/documents/:documentId/preview', controller.previewDocument);
router.post('/:id/documents/:documentId/retry', controller.retryDocument);
router.delete('/:id/documents/:documentId', controller.removeDocument);
router.get('/:id', controller.detail);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
