// 教师端课程管理路由
// 前缀：/api/teacher

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-course.controller');

const router = Router();

// ---- 课程 ----
router.get('/courses', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listCourses);
router.post('/courses', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createCourse);
router.get('/courses/:course_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getCourse);
router.put('/courses/:course_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.updateCourse);
router.delete('/courses/:course_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteCourse);

// ---- 教学班级 ----
router.get('/classes', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listAllTeachingClasses);
router.get('/courses/:course_id/teaching-classes', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listTeachingClasses);
router.post('/courses/:course_id/teaching-classes', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createTeachingClass);
router.put('/teaching-classes/:class_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.updateTeachingClass);
router.delete('/teaching-classes/:class_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteTeachingClass);
router.get('/teaching-classes/:class_id/students', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listClassStudents);
router.post('/teaching-classes/:class_id/students', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.addClassStudents);
router.delete('/teaching-classes/:class_id/students/:student_user_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.removeClassStudent);

// ---- 章节 ----
router.get('/courses/:course_id/chapters', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listChapters);
router.post('/courses/:course_id/chapters', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createChapter);
router.put('/chapters/:chapter_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.updateChapter);
router.delete('/chapters/:chapter_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteChapter);

// ---- 知识点 ----
router.get('/courses/:course_id/knowledge-points', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listKnowledgePoints);
router.post('/chapters/:chapter_id/knowledge-points', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createKnowledgePoint);
router.put('/knowledge-points/:kp_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.updateKnowledgePoint);
router.delete('/knowledge-points/:kp_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteKnowledgePoint);

module.exports = router;
