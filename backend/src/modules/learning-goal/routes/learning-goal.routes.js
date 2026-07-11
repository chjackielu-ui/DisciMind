const { Router } = require('express');
const authMiddleware = require('../../../middlewares/auth.middleware');
const roleMiddleware = require('../../../middlewares/role.middleware');
const controller = require('../controllers/learning-goal.controller');

const router = Router();
router.use(authMiddleware);
router.use(roleMiddleware(['student']));

router.get('/config', controller.getConfig);
router.post('/resolve', controller.resolve);
router.get('/', controller.list);
router.get('/:goalId', controller.get);
router.patch('/:goalId', controller.patch);
router.post('/:goalId/confirm', controller.confirm);
router.post('/:goalId/workflow-preview', controller.workflowPreview);
router.post('/:goalId/start', controller.start);
router.post('/:goalId/cancel', controller.cancel);

module.exports = router;
