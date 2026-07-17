const express = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./dify.controller');

const router = express.Router();
router.use(auth, roles(['student', 'teacher', 'admin']));
router.get('/health', controller.health);
router.post('/chat', controller.chat);
router.post('/workflow', controller.workflow);

module.exports = router;
