// 管理员端路由总集
// 前缀：/api/admin
// 所有路由需要 admin 角色权限

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

// 控制器
const dashboardController = require('../controllers/admin-dashboard.controller');
const userController = require('../controllers/admin-user.controller');
const courseController = require('../controllers/admin-course.controller');
const classController = require('../controllers/admin-class.controller');
const knowledgeController = require('../controllers/admin-knowledge.controller');
const logController = require('../controllers/admin-log.controller');
const notificationController = require('../controllers/admin-notification.controller');
const aiController = require('../controllers/admin-ai.controller');

const router = Router();

// 所有管理员端接口需要认证 + admin 角色
router.use(authMiddleware, roleMiddleware(['admin']));

// ==================== 1. 仪表盘 ====================
router.get('/dashboard', dashboardController.getDashboard);

// ==================== 2. 用户管理 ====================
router.get('/users', userController.getUserList);
router.post('/users', userController.createUser);
router.put('/users/:user_id/status', userController.updateUserStatus);
router.put('/users/:user_id/password', userController.resetUserPassword);
router.put('/users/:user_id', userController.updateUser);
router.delete('/users/:user_id', userController.deleteUser);

// ==================== 3. 课程管理 ====================
router.get('/courses', courseController.getCourseList);
router.post('/courses', courseController.createCourse);
router.get('/courses/:course_id', courseController.getCourseDetail);
router.put('/courses/:course_id', courseController.updateCourse);
router.delete('/courses/:course_id', courseController.deleteCourse);
router.post('/courses/:course_id/teachers', courseController.bindTeacher);
router.delete('/courses/:course_id/teachers/:teacher_user_id', courseController.unbindTeacher);

// ==================== 4. 章节管理 ====================
router.get('/courses/:course_id/chapters', courseController.getChapterList);
router.post('/courses/:course_id/chapters', courseController.createChapter);
router.put('/chapters/:chapter_id', courseController.updateChapter);
router.delete('/chapters/:chapter_id', courseController.deleteChapter);

// ==================== 5. 知识点管理 ====================
router.get('/courses/:course_id/knowledge-points', courseController.getKnowledgePointList);
router.post('/knowledge-points', courseController.createKnowledgePoint);
router.put('/knowledge-points/:knowledge_point_id', courseController.updateKnowledgePoint);
router.delete('/knowledge-points/:knowledge_point_id', courseController.deleteKnowledgePoint);

// ==================== 6. 行政班级管理 ====================
router.get('/admin-classes', classController.getAdminClassList);
router.post('/admin-classes', classController.createAdminClass);
router.put('/admin-classes/:admin_class_id', classController.updateAdminClass);
router.delete('/admin-classes/:admin_class_id', classController.deleteAdminClass);

// ==================== 7. 教学班级管理 ====================
router.get('/courses/:course_id/teaching-classes', classController.getTeachingClassList);
router.post('/courses/:course_id/teaching-classes', classController.createTeachingClass);
router.put('/teaching-classes/:teaching_class_id', classController.updateTeachingClass);
router.delete('/teaching-classes/:teaching_class_id', classController.deleteTeachingClass);
router.get('/teaching-classes/:teaching_class_id/students', classController.getClassStudentList);
router.post('/teaching-classes/:teaching_class_id/students', classController.addClassStudents);
router.delete('/teaching-classes/:teaching_class_id/students/:student_user_id', classController.removeClassStudent);

// ==================== 8. 知识库管理 ====================
router.get('/knowledge-documents', knowledgeController.getDocumentList);
router.put('/knowledge-documents/:document_id/review', knowledgeController.reviewDocument);

// ==================== 9. 操作日志 ====================
router.get('/operation-logs', logController.getOperationLogs);

// ==================== 10. 通知管理 ====================
router.get('/notifications', notificationController.getNotificationList);
router.post('/notifications', notificationController.createNotification);
router.put('/notifications/:notification_id/read', notificationController.markNotificationRead);
router.put('/notifications/read-all', notificationController.markAllNotificationsRead);

// ==================== 11. AI 模型配置（占位） ====================
router.get('/ai-model-configs', aiController.getAiModelConfigs);
router.post('/ai-model-configs', aiController.createAiModelConfig);
router.get('/ai-call-logs', aiController.getAiCallLogs);

module.exports = router;
