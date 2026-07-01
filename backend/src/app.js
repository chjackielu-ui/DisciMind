const express = require('express');
const cors = require('cors');
const path = require('path');

const errorHandler = require('./middlewares/error.middleware');

const app = express();

// ---------- 全局中间件 ----------

// 允许跨域请求
app.use(cors());

// 解析 JSON 请求体
app.use(express.json());

// 解析 URL 编码的请求体（表单提交场景）
app.use(express.urlencoded({ extended: true }));

// 对外提供本地上传文件访问能力：/uploads/avatars/xxx.png
app.use('/uploads', express.static(path.join(__dirname, '../../storage/uploads')));

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

// ---------- 学生端基础模块 ----------
const studentRoutes = require('./routes/student.routes');
app.use('/api/student', studentRoutes);

// ---------- 学生端扩展模块 ----------
// 在线答题模块
const studentAnswerRoutes = require('./routes/student-answer.routes');
app.use('/api/student', studentAnswerRoutes);

// AI 问答模块
const studentChatRoutes = require('./routes/student-chat.routes');
app.use('/api/student', studentChatRoutes);

// 知识库文档模块
const studentDocumentRoutes = require('./routes/student-document.routes');
app.use('/api/student', studentDocumentRoutes);

// 视频推荐模块
const studentVideoRoutes = require('./routes/student-video.routes');
app.use('/api/student', studentVideoRoutes);

// ---------- 根路径 ----------

app.get('/', (req, res) => {
  res.send('DisciMind backend is running');
});

// ---------- 统一错误处理（必须放在所有路由之后）----------

app.use(errorHandler);

module.exports = app;
