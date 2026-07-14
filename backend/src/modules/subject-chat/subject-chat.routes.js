const { Router } = require('express');
const controller = require('./subject-chat.controller');

const router = Router();

router.post('/runs', controller.createRun);
router.get('/conversations/:conversationId/runs/latest', controller.getLatestRun);
router.get('/runs/:runId/stream', controller.streamRun);
router.get('/runs/:runId/events', controller.getEvents);
router.get('/runs/:runId', controller.getRun);
router.post('/runs/:runId/cancel', controller.cancelRun);
router.post('/runs/:runId/tasks/:taskId/retry', controller.retryTask);

module.exports = router;
