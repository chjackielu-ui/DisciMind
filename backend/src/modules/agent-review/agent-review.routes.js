const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./agent-review.controller');

const router = Router();
router.use(auth, roles(['admin']));
router.get('/agent-reviews', controller.listAgentReviews);
router.get('/agent-reviews/:id', controller.getAgentReview);
router.post('/agent-reviews/:id/approve', controller.approveAgent);
router.post('/agent-reviews/:id/reject', controller.rejectAgent);
router.post('/agents/:id/offline', controller.offlineAgent);
router.get('/knowledge-base-reviews', controller.listKnowledgeReviews);
router.get('/knowledge-base-reviews/:id', controller.getKnowledgeReview);
router.post('/knowledge-base-reviews/:id/approve', controller.approveKnowledge);
router.post('/knowledge-base-reviews/:id/reject', controller.rejectKnowledge);
router.get('/agent-reports', controller.listReports);
router.post('/agent-reports/:id/resolve', controller.resolveReport);

module.exports = router;
