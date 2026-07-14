const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./agent-marketplace.controller');
const { rateLimit } = require('./marketplace-rate-limit');

const router = Router();
router.use(auth, roles(['student', 'teacher']));
router.get('/mine', controller.mine);
router.get('/favorites', controller.favorites);
router.get('/available-chat', controller.availableChat);
router.get('/chat/available', controller.availableChat);
router.get('/callable', controller.callable);
router.get('/rankings/hot', controller.hotRankings);
router.get('/', controller.list);
router.post('/', rateLimit({ max: 10, keyPrefix: 'agent-create' }), controller.create);
router.get('/:id', controller.detail);
router.put('/:id', rateLimit({ max: 15, keyPrefix: 'agent-update' }), controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/apply-public', controller.applyPublic);
router.post('/:id/copy', controller.copy);
router.post('/:id/favorite', controller.favorite);
router.delete('/:id/favorite', controller.unfavorite);
router.post('/:id/rating', controller.rating);
router.post('/:id/report', controller.report);

module.exports = router;
