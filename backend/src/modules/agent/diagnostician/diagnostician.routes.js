const { Router } = require('express');
const authMiddleware = require('../../../middlewares/auth.middleware');
const roleMiddleware = require('../../../middlewares/role.middleware');
const controller = require('./diagnostician.controller');

const router = Router();

router.use(authMiddleware, roleMiddleware(['student', 'teacher', 'admin']));

router.post('/analyze', controller.analyze);

module.exports = router;
