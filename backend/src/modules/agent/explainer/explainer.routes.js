const { Router } = require('express');
const authMiddleware = require('../../../middlewares/auth.middleware');
const roleMiddleware = require('../../../middlewares/role.middleware');
const controller = require('./explainer.controller');

const router = Router();

router.use(authMiddleware, roleMiddleware(['student']));

router.post('/chat', controller.chat);

module.exports = router;
