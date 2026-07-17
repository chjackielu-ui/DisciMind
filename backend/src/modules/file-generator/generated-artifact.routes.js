const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./generated-artifact.controller');
const learningResourceController = require('../learning-flow-resource/learning-flow-resource.controller');

const router = Router();
router.use(auth, roles(['student', 'teacher', 'admin']));
router.get('/', controller.list);
router.post('/bulk-delete', controller.bulkRemove);
router.get('/:id', controller.detail);
router.get('/:id/download', controller.download);
router.get('/:id/exports/:format/download', controller.downloadExport);
router.post('/:id/export', controller.exportDocument);
router.patch('/:id', controller.rename);
router.post('/:id/learning-flow-links', learningResourceController.create);
router.delete('/:id', controller.remove);

module.exports = router;
