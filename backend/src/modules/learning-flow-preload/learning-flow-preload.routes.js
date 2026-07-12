const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./learning-flow-preload.controller');

const router = Router();
router.use(auth, roles(['student']));
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.detail);
router.post('/:id/retry', controller.retry);
module.exports = router;
