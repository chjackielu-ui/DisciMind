const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const { requireAdminPermission } = require('../../services/admin-permission.service');
const controller = require('./agent-review.controller');

const router = Router();
router.use(auth, roles(['admin']));
router.get('/agent-reviews', requireAdminPermission('admin.agents.view'), controller.listAgentReviews);
router.get('/agent-reviews/:id', requireAdminPermission('admin.agents.view'), controller.getAgentReview);
router.post('/agent-reviews/:id/approve', requireAdminPermission('admin.agents.manage'), controller.approveAgent);
router.post('/agent-reviews/:id/reject', requireAdminPermission('admin.agents.manage'), controller.rejectAgent);
router.post('/agents/:id/offline', requireAdminPermission('admin.agents.manage'), controller.offlineAgent);
router.get('/knowledge-base-reviews', requireAdminPermission('admin.knowledge.view'), controller.listKnowledgeReviews);
router.get('/knowledge-base-reviews/:id', requireAdminPermission('admin.knowledge.view'), controller.getKnowledgeReview);
router.post('/knowledge-base-reviews/:id/approve', requireAdminPermission('admin.knowledge.manage'), controller.approveKnowledge);
router.post('/knowledge-base-reviews/:id/reject', requireAdminPermission('admin.knowledge.manage'), controller.rejectKnowledge);
router.get('/agent-reports', requireAdminPermission('admin.risks.view'), controller.listReports);
router.post('/agent-reports/:id/resolve', requireAdminPermission('admin.risks.manage'), controller.resolveReport);

module.exports = router;
