// 教师端题库管理路由
// 前缀：/api/teacher

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const controller = require('../controllers/teacher-question.controller');

const router = Router();

router.get('/questions', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.listQuestions);
router.post('/questions', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.createQuestion);
router.get('/questions/:question_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.getQuestion);
router.put('/questions/:question_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.updateQuestion);
router.delete('/questions/:question_id', authMiddleware, roleMiddleware(['teacher', 'admin']), controller.deleteQuestion);

module.exports = router;
