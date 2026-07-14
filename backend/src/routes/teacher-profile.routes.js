const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-profile.controller');

const router = Router();
const teacherOnly = [authMiddleware, roleMiddleware(['teacher', 'admin'])];
router.get('/profile', ...teacherOnly, controller.getProfile);
router.patch('/profile', ...teacherOnly, controller.updateProfile);

module.exports = router;
