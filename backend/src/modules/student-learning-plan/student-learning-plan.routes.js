const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./student-learning-plan.controller');

const router = Router();
router.use(auth, roles(['student']));
router.get('/current', controller.current);
router.post('/current/rematch', controller.rematchCurrent);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.detail);
router.post('/:id/rematch', controller.rematch);
router.post('/:id/transition', controller.transition);
router.post('/:id/prepare', controller.prepare);
router.post('/:id/start', controller.start);
router.get('/:id/reference-materials', controller.referenceMaterials);

module.exports = router;
