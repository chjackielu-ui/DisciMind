const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./async-task.controller');

const router = Router();
router.use(auth, roles(['student', 'teacher', 'admin']));
router.get('/active', controller.active);
router.get('/', controller.list);
router.post('/dismiss-terminal', controller.dismissTerminal);
router.get('/:id', controller.detail);
router.post('/:id/cancel', controller.cancel);
router.post('/:id/dismiss', controller.dismiss);

module.exports = router;
