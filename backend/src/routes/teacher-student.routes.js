// 教师端学生管理路由
// 前缀：/api/teacher

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-student.controller');

const router = Router();

router.get('/students', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listStudents);
router.post('/students', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createStudent);
router.post('/students/batch-import', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.batchImportStudents);
router.get('/students/template', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.exportStudentTemplate);
router.put('/students/:student_user_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.updateStudent);
router.delete('/students/:student_user_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteStudent);
router.get('/students/:student_user_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getStudent);
router.get('/students/:student_user_id/mastery', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getStudentMastery);
router.put('/students/:student_user_id/mastery/:kp_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.markMastery);
router.get('/students/:student_user_id/portrait', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getStudentPortrait);
router.post('/students/:student_user_id/refresh', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.refreshPortrait);

module.exports = router;
