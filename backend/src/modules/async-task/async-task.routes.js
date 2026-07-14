const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./async-task.controller');

const router = Router();
router.use(auth, roles(['student', 'teacher', 'admin']));
router.get('/active', controller.active);
router.get('/stream', controller.stream);
router.get('/', controller.list);
router.post('/dismiss-terminal', controller.dismissTerminal);
router.post('/bulk/cancel', controller.bulkCancel);
router.post('/bulk/dismiss', controller.bulkDismiss);
router.post('/bulk/delete', controller.bulkDelete);
router.get('/:id', controller.detail);
router.post('/:id/cancel', controller.cancel);
router.post('/:id/retry', controller.retry);
router.post('/:id/dismiss', controller.dismiss);

module.exports = router;
