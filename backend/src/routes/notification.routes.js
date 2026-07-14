const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-notification.controller');

const router = Router();
const authenticatedUser = [authMiddleware, roleMiddleware(['student', 'teacher', 'admin'])];

router.get('/', ...authenticatedUser, controller.listNotifications);
router.get('/unread-count', ...authenticatedUser, controller.getUnreadCount);
router.put('/read-all', ...authenticatedUser, controller.markAllRead);
router.put('/:notification_id/read', ...authenticatedUser, controller.markRead);
router.delete('/', ...authenticatedUser, controller.deleteNotifications);

module.exports = router;
