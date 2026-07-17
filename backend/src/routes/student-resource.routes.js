const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/student-resource.controller');

const router = Router();
router.use(authMiddleware, roleMiddleware(['student']));
router.get('/resources', controller.listResources);
router.post('/resources/:recipient_id/open', controller.openResource);
router.get('/resources/:recipient_id/download', controller.downloadResource);
router.post('/resources/:recipient_id/complete', controller.completeResource);

module.exports = router;
