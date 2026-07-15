const { Router } = require('express');
const auth = require('../middlewares/auth.middleware');
const roles = require('../middlewares/role.middleware');
const controller = require('../controllers/work-center.controller');

const router = Router();
router.use(auth, roles(['student', 'teacher', 'admin']));
router.get('/summary', controller.summary);
router.get('/feed', controller.feed);
router.get('/messages', controller.messages);
router.get('/messages/:id', controller.messageDetail);
router.get('/tasks', controller.tasks);
router.post('/messages/read-all', controller.markAllMessagesRead);
router.post('/messages/:id/read', controller.markMessageRead);

module.exports = router;
