// 教师端任务管理路由
// 前缀：/api/teacher

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-task.controller');

const router = Router();

router.get('/tasks', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listTasks);
router.post('/tasks', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createTask);
router.get('/tasks/:task_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getTask);
router.put('/tasks/:task_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.updateTask);
router.delete('/tasks/:task_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteTask);
router.get('/tasks/:task_id/submissions', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listSubmissions);
router.get('/tasks/:task_id/submissions/:submission_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getSubmission);

module.exports = router;
