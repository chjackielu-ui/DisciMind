const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./learning-flow-preload.controller');

const router = Router();
router.use(auth, roles(['student']));
router.post('/', controller.create);
router.get('/', controller.list);
router.get('/sessions/:sessionId/cards', controller.cards);
router.post('/sessions/:sessionId/cards/regenerate', controller.regenerateCards);
router.post('/sessions/:sessionId/cards/:cardId/state', controller.updateCardState);
router.post('/sessions/:sessionId/cards/:cardId/save', controller.saveCard);
router.get('/:id', controller.detail);
router.post('/:id/retry', controller.retry);
module.exports = router;
