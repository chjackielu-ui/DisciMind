const { Router } = require('express');
const authMiddleware = require('../../../middlewares/auth.middleware');
const roleMiddleware = require('../../../middlewares/role.middleware');
const controller = require('./trainer.controller');

const router = Router();

router.use(authMiddleware, roleMiddleware(['student']));

router.get('/context', controller.getContext);
router.post('/sessions', controller.createSession);
router.get('/sessions', controller.listSessions);
router.get('/sessions/:sessionId', controller.getSession);
router.post('/sessions/:sessionId/answers', controller.submitAnswer);
router.post('/sessions/:sessionId/complete', controller.completeSession);
router.post('/sessions/:sessionId/abandon', controller.abandonSession);
router.get('/sessions/:sessionId/report', controller.getReport);
router.get('/sessions/:sessionId/events', controller.getEvents);

module.exports = router;
