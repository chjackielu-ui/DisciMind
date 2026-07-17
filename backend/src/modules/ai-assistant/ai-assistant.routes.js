const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const roleMiddleware = require('../../middlewares/role.middleware');
const controller = require('./ai-assistant.controller');

const router = Router();
router.use(authMiddleware, roleMiddleware(['student', 'teacher', 'admin']));
router.get('/capabilities', controller.getCapabilities);
router.post('/stream', controller.stream);
router.get('/traces/:traceId', controller.getTrace);
router.get('/conversations/:conversationId/pending-action', controller.getConversationPendingAction);
router.get('/pending-actions/:pendingActionId', controller.getPendingAction);
router.post('/pending-actions/:pendingActionId/actions', controller.actOnPendingAction);
router.get('/artifacts/:artifactId/download', controller.downloadArtifact);

module.exports = router;
