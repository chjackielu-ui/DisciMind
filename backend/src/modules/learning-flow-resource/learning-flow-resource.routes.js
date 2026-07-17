const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./learning-flow-resource.controller');

function secured() {
  const router = Router();
  router.use(auth, roles(['student']));
  return router;
}

const resourceRoutes = secured();
resourceRoutes.get('/', controller.list);
resourceRoutes.get('/:id', controller.detail);

const linkRoutes = secured();
linkRoutes.delete('/:id', controller.remove);

module.exports = { resourceRoutes, linkRoutes };
