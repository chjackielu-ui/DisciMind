const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./generated-artifact.controller');

const router = Router();
router.use(auth, roles(['student', 'teacher', 'admin']));
router.get('/', controller.list);
router.get('/:id', controller.detail);
router.get('/:id/download', controller.download);
router.post('/:id/export', controller.exportDocument);
router.delete('/:id', controller.remove);

module.exports = router;
