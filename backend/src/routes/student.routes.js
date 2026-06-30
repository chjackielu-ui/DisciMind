// 学生端路由
// 所有接口统一前缀：/api/student
// 需要登录（authMiddleware）+ 学生角色（roleMiddleware(['student'])）

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');
const studentController = require('../controllers/student.controller');

const router = Router();

// ========== 所有学生端接口都需要登录且角色为学生 ==========

// 学生首页仪表盘综合数据
router.get(
  '/dashboard',
  authMiddleware,
  roleMiddleware(['student']),
  studentController.getDashboard,
);

module.exports = router;
