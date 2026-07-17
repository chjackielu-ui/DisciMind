const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const trainerController = require('./trainer.controller');

const router = Router();

router.post('/run', authMiddleware, trainerController.run);

module.exports = router;
