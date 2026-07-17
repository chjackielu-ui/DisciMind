const express = require('express');

const router = express.Router();

router.use('/trainer', require('./trainer/trainer.routes'));
router.use('/explainer', require('./explainer/explainer.routes'));
router.use('/diagnostician', require('./diagnostician/diagnostician.routes'));

module.exports = router;
