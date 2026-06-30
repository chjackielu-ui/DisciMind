const express = require('express');
const cors = require('cors');

const errorHandler = require('./middlewares/error.middleware');

const app = express();

// ---------- 全局中间件 ----------

// 允许跨域请求
app.use(cors());

// 解析 JSON 请求体
app.use(express.json());

// 解析 URL 编码的请求体（表单提交场景）
app.use(express.urlencoded({ extended: true }));

// ---------- 健康检查（无需 /api 前缀）----------

app.get('/api/health', (req, res) => {
  res.json({
    code: 200,
    message: 'ok',
    data: {
      name: 'DisciMind Backend',
      status: 'running',
    },
  });
});

// ---------- 业务路由（挂载到 /api 前缀）----------

// ---------- 认证模块 ----------
const authRoutes = require('./routes/auth.routes');
app.use('/api/auth', authRoutes);

// ---------- 学生端模块 ----------
const studentRoutes = require('./routes/student.routes');
app.use('/api/student', studentRoutes);

// ---------- 根路径 ----------

app.get('/', (req, res) => {
  res.send('DisciMind backend is running');
});

// ---------- 统一错误处理（必须放在所有路由之后）----------

app.use(errorHandler);

module.exports = app;
