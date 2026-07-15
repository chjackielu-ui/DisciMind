const { Router } = require('express');
const auth = require('../../middlewares/auth.middleware');
const roles = require('../../middlewares/role.middleware');
const controller = require('./learning-card.controller');

const router = Router();
router.use(auth);
router.get('/student/learning-cards/daily', roles(['student']), controller.dailyCards);
router.post('/student/learning-cards/refresh', roles(['student']), controller.refresh);
router.get('/student/learning-cards/scene', roles(['student']), controller.scene);
router.get('/student/learning-cards/:id', roles(['student']), controller.detail);
router.post('/student/learning-cards/:id/actions', roles(['student']), controller.action);
router.post('/student/learning-cards/:id/add-to-plan', roles(['student']), controller.addToPlan);
router.post('/student/learning-cards/:id/start-practice', roles(['student']), controller.startPractice);
router.post('/student/learning-cards/:id/ask-ai', roles(['student']), controller.askAi);
router.get('/courses/:courseId/learning-cards', roles(['student']), controller.courseLibrary);
router.get('/wrong-questions/:id/repair-card', roles(['student']), controller.repairCard);
router.post('/ai/cards/generate', roles(['student', 'teacher', 'admin']), controller.generate);

module.exports = router;
