const { Router } = require('express');
const auth = require('../middlewares/auth.middleware');
const roles = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-artifact.controller');

const router = Router();
router.use(auth, roles(['teacher', 'admin']));
router.get('/artifacts', controller.list);
router.post('/artifacts/batch', controller.batch);
router.get('/artifacts/:source_type/:id', controller.detail);
router.patch('/artifacts/:source_type/:id', controller.rename);

module.exports = router;
