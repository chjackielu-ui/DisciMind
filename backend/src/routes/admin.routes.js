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
const traceController = require('../controllers/admin-trace.controller');
const governanceController = require('../controllers/admin-governance.controller');
const aiSafetyController = require('../controllers/admin-ai-safety.controller');
const rbacController = require('../controllers/admin-rbac.controller');
const { requireAdminPermission } = require('../services/admin-permission.service');

const router = Router();

// 所有管理员端接口需要认证 + admin 角色
router.use(authMiddleware, roleMiddleware(['admin']));

// ==================== 1. 仪表盘 ====================
router.get('/dashboard', requireAdminPermission('admin.dashboard.view'), dashboardController.getDashboard);

// ==================== 2. 用户管理 ====================
router.get('/users', requireAdminPermission('admin.users.view'), userController.getUserList);
router.post('/users', requireAdminPermission('admin.users.manage'), userController.createUser);
router.put('/users/:user_id/status', requireAdminPermission('admin.users.manage'), userController.updateUserStatus);
router.put('/users/:user_id/password', requireAdminPermission('admin.users.manage'), userController.resetUserPassword);
router.put('/users/:user_id', requireAdminPermission('admin.users.manage'), userController.updateUser);
router.delete('/users/:user_id', requireAdminPermission('admin.users.manage'), userController.deleteUser);

// ==================== 3. 课程管理 ====================
router.get('/courses', requireAdminPermission('admin.teaching.view'), courseController.getCourseList);
router.post('/courses', requireAdminPermission('admin.teaching.manage'), courseController.createCourse);
router.get('/courses/:course_id', requireAdminPermission('admin.teaching.view'), courseController.getCourseDetail);
router.put('/courses/:course_id', requireAdminPermission('admin.teaching.manage'), courseController.updateCourse);
router.delete('/courses/:course_id', requireAdminPermission('admin.teaching.manage'), courseController.deleteCourse);
router.post('/courses/:course_id/teachers', requireAdminPermission('admin.teaching.manage'), courseController.bindTeacher);
router.delete('/courses/:course_id/teachers/:teacher_user_id', requireAdminPermission('admin.teaching.manage'), courseController.unbindTeacher);

// ==================== 4. 章节管理 ====================
router.get('/courses/:course_id/chapters', requireAdminPermission('admin.teaching.view'), courseController.getChapterList);
router.post('/courses/:course_id/chapters', requireAdminPermission('admin.teaching.manage'), courseController.createChapter);
router.put('/chapters/:chapter_id', requireAdminPermission('admin.teaching.manage'), courseController.updateChapter);
router.delete('/chapters/:chapter_id', requireAdminPermission('admin.teaching.manage'), courseController.deleteChapter);

// ==================== 5. 知识点管理 ====================
router.get('/courses/:course_id/knowledge-points', requireAdminPermission('admin.teaching.view'), courseController.getKnowledgePointList);
router.post('/knowledge-points', requireAdminPermission('admin.teaching.manage'), courseController.createKnowledgePoint);
router.put('/knowledge-points/:knowledge_point_id', requireAdminPermission('admin.teaching.manage'), courseController.updateKnowledgePoint);
router.delete('/knowledge-points/:knowledge_point_id', requireAdminPermission('admin.teaching.manage'), courseController.deleteKnowledgePoint);

// ==================== 6. 行政班级管理 ====================
router.get('/admin-classes', requireAdminPermission('admin.teaching.view'), classController.getAdminClassList);
router.post('/admin-classes', requireAdminPermission('admin.teaching.manage'), classController.createAdminClass);
router.put('/admin-classes/:admin_class_id', requireAdminPermission('admin.teaching.manage'), classController.updateAdminClass);
router.delete('/admin-classes/:admin_class_id', requireAdminPermission('admin.teaching.manage'), classController.deleteAdminClass);
router.get('/admin-classes/:admin_class_id/students', requireAdminPermission('admin.teaching.view'), classController.getAdminClassStudentList);
router.post('/admin-classes/:admin_class_id/students', requireAdminPermission('admin.teaching.manage'), classController.addAdminClassStudents);
router.delete('/admin-classes/:admin_class_id/students/:student_user_id', requireAdminPermission('admin.teaching.manage'), classController.removeAdminClassStudent);

// ==================== 7. 教学班级管理 ====================
router.get('/teaching-classes', requireAdminPermission('admin.teaching.view'), classController.getTeachingClassPage);
router.get('/courses/:course_id/teaching-classes', requireAdminPermission('admin.teaching.view'), classController.getTeachingClassList);
router.post('/courses/:course_id/teaching-classes', requireAdminPermission('admin.teaching.manage'), classController.createTeachingClass);
router.put('/teaching-classes/:teaching_class_id', requireAdminPermission('admin.teaching.manage'), classController.updateTeachingClass);
router.delete('/teaching-classes/:teaching_class_id', requireAdminPermission('admin.teaching.manage'), classController.deleteTeachingClass);
router.get('/teaching-classes/:teaching_class_id/students', requireAdminPermission('admin.teaching.view'), classController.getClassStudentList);
router.post('/teaching-classes/:teaching_class_id/students', requireAdminPermission('admin.teaching.manage'), classController.addClassStudents);
router.delete('/teaching-classes/:teaching_class_id/students/:student_user_id', requireAdminPermission('admin.teaching.manage'), classController.removeClassStudent);

// ==================== 8. 知识库管理 ====================
router.get('/knowledge-documents', requireAdminPermission('admin.knowledge.view'), knowledgeController.getDocumentList);
router.put('/knowledge-documents/:document_id/review', requireAdminPermission('admin.knowledge.manage'), knowledgeController.reviewDocument);

// ==================== 9. 操作日志 ====================
router.get('/operation-logs', requireAdminPermission('admin.audit.view'), logController.getOperationLogs);

// ==================== 10. 通知管理 ====================
router.get('/notifications', requireAdminPermission('admin.system.view'), notificationController.getNotificationList);
router.post('/notifications', requireAdminPermission('admin.system.manage'), notificationController.createNotification);
router.put('/notifications/:notification_id/read', requireAdminPermission('admin.system.manage'), notificationController.markNotificationRead);
router.put('/notifications/read-all', requireAdminPermission('admin.system.manage'), notificationController.markAllNotificationsRead);

// ==================== 11. AI 配置中心 ====================
router.get('/ai-model-configs', requireAdminPermission('admin.ai.models.view'), aiController.getAiModelConfigs);
router.post('/ai-model-configs', requireAdminPermission('admin.ai.models.manage'), aiController.createAiModelConfig);
router.get('/ai-call-logs', requireAdminPermission('admin.traces.view'), aiController.getAiCallLogs);

router.get('/ai/providers', requireAdminPermission('admin.ai.providers.view'), aiController.getProviders);
router.post('/ai/providers', requireAdminPermission('admin.ai.providers.manage'), aiController.createProvider);
router.get('/ai/providers/:id', requireAdminPermission('admin.ai.providers.view'), aiController.getProvider);
router.put('/ai/providers/:id', requireAdminPermission('admin.ai.providers.manage'), aiController.updateProvider);
router.post('/ai/providers/:id/test', requireAdminPermission('admin.ai.providers.manage'), aiController.testProvider);
router.post('/ai/providers/:id/enable', requireAdminPermission('admin.ai.providers.manage'), aiController.enableProvider);
router.post('/ai/providers/:id/disable', requireAdminPermission('admin.ai.providers.manage'), aiController.disableProvider);
router.post('/ai/providers/:id/replace-secret', requireAdminPermission('admin.ai.secrets.manage'), aiController.replaceProviderSecret);
router.post('/ai/providers/:id/clear-secret', requireAdminPermission('admin.ai.secrets.manage'), aiController.clearProviderSecret);

router.get('/ai/models', requireAdminPermission('admin.ai.models.view'), aiController.getModels);
router.post('/ai/models', requireAdminPermission('admin.ai.models.manage'), aiController.createModel);
router.get('/ai/models/:id', requireAdminPermission('admin.ai.models.view'), aiController.getModel);
router.put('/ai/models/:id', requireAdminPermission('admin.ai.models.manage'), aiController.updateModel);
router.post('/ai/models/:id/test', requireAdminPermission('admin.ai.models.manage'), aiController.testModel);
router.post('/ai/models/:id/enable', requireAdminPermission('admin.ai.models.manage'), aiController.enableModel);
router.post('/ai/models/:id/disable', requireAdminPermission('admin.ai.models.manage'), aiController.disableModel);
router.post('/ai/models/:id/set-default', requireAdminPermission('admin.ai.models.manage'), aiController.setDefaultModel);

router.get('/agents', requireAdminPermission('admin.agents.view'), aiController.getAgents);
router.post('/agents', requireAdminPermission('admin.agents.manage'), aiController.createAgent);
router.get('/agents/:id', requireAdminPermission('admin.agents.view'), aiController.getAgent);
router.put('/agents/:id', requireAdminPermission('admin.agents.manage'), aiController.updateAgent);
router.post('/agents/:id/test', requireAdminPermission('admin.agents.manage'), aiController.testAgent);
router.post('/agents/:id/publish', requireAdminPermission('admin.agents.publish'), aiController.publishAgent);
router.post('/agents/:id/rollback', requireAdminPermission('admin.agents.publish'), aiController.rollbackAgent);

router.get('/system/environment-status', requireAdminPermission('admin.system.view'), aiController.getEnvironmentStatus);

// ==================== 12. AI 教学决策证据链 ====================
router.get('/traces', requireAdminPermission('admin.traces.view'), traceController.getTraces);
router.get('/traces/:id', requireAdminPermission('admin.traces.view'), traceController.getTrace);
router.post('/traces/:id/mark-risk', requireAdminPermission('admin.risks.manage'), traceController.markTraceRisk);

// ==================== 13. 教学与 AI 治理中心 ====================
const governancePermission = {
  'learning-flows': { view: 'admin.workflows.view', manage: 'admin.workflows.manage' },
  'knowledge-health': { view: 'admin.knowledge.view', manage: 'admin.knowledge.manage' },
  'teaching-issues': { view: 'admin.interventions.view', manage: 'admin.interventions.manage' },
  evaluations: { view: 'admin.evaluations.view', manage: 'admin.evaluations.manage' },
  experiments: { view: 'admin.experiments.view', manage: 'admin.experiments.manage' },
  'digital-twin': { view: 'admin.teaching.view', manage: 'admin.teaching.manage' },
  assets: { view: 'admin.assets.view', manage: 'admin.assets.manage' },
  'strategy-profiles': { view: 'admin.teaching.view', manage: 'admin.teaching.manage' },
  risks: { view: 'admin.risks.view', manage: 'admin.risks.manage' },
};
function requireGovernancePermission(mode) {
  return (req, res, next) => {
  const permission = governancePermission[req.params.module]?.[mode];
  if (!permission) return res.status(404).json({ code: 40401, message: '未知治理模块', data: null });
  return requireAdminPermission(permission)(req, res, next);
  };
}
router.get('/governance/:module/overview', requireGovernancePermission('view'), governanceController.getOverview);
router.get('/governance/:module', requireGovernancePermission('view'), governanceController.getList);
router.post('/governance/:module/actions/:action', requireGovernancePermission('manage'), governanceController.runAction);

// ==================== 14. AI 安全治理 ====================
router.get('/ai-safety/overview', requireAdminPermission('admin.risks.view'), aiSafetyController.getOverview);
router.post('/ai-safety/standards/sync', requireAdminPermission('admin.risks.manage'), aiSafetyController.syncStandards);
router.put('/ai-safety/rules/:rule_id/enabled', requireAdminPermission('admin.risks.manage'), aiSafetyController.setRuleEnabled);

// ==================== 15. 管理员角色与权限 ====================
router.get('/rbac/me', rbacController.getMyAccess);
router.get('/rbac/overview', requireAdminPermission('admin.system.view'), rbacController.getOverview);
router.put('/rbac/users/:user_id/roles', requireAdminPermission('admin.system.manage'), rbacController.replaceUserRoles);
router.put('/rbac/roles/:role_code/permissions', requireAdminPermission('admin.system.manage'), rbacController.replaceRolePermissions);

module.exports = router;
