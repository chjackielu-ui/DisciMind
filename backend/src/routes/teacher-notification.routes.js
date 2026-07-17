// 教师端消息通知路由
// 前缀：/api/teacher

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-notification.controller');

const router = Router();

router.get('/notifications', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listNotifications);
router.put('/notifications/:notification_id/read', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.markRead);
router.put('/notifications/read-all', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.markAllRead);
router.get('/notifications/unread-count', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getUnreadCount);
router.delete('/notifications', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteNotifications);
router.get('/notifications/sent-stats', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getSentStats);

module.exports = router;
