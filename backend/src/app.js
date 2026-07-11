const express = require('express');
const cors = require('cors');
const path = require('path');

const { loadEnv } = require('./config/env');
const errorHandler = require('./middlewares/error.middleware');

loadEnv();

if ((process.env.AGENT_MODE || 'dify') === 'langgraph' && process.env.LANGGRAPH_ENABLED === 'true') {
  try {
    const loaded = require('./modules/learning-agent').assertLearningAgentModules();
    console.log(`[Startup] Learning Agent smoke check passed: ${loaded.join(', ')}`);
  } catch (error) {
    console.error('[Startup] Learning Agent smoke check failed:', error);
    throw error;
  }
}

const app = express();

// ---------- 全局中间件 ----------

function getAllowedOrigins() {
  const configured = process.env.CORS_ORIGIN || process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173';
  return configured.split(',').map((item) => item.trim()).filter(Boolean);
}

// 允许前端携带 HttpOnly Refresh Token Cookie。
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const allowed = getAllowedOrigins();
    if (allowed.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
}));

// 多模态对话使用 data URL 传输图片；后端随后落盘，数据库只保存附件元数据。
app.use(express.json({ limit: '18mb' }));

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

// 自主练习模块
const practiceRoutes = require('./routes/practice.routes');
app.use('/api/practice', practiceRoutes);
// 兼容学生端聚合前缀，避免旧页面或代理只允许 /api/student 下接口时无法访问。
app.use('/api/student/practice', practiceRoutes);

// 教师端练习分析模块
const teacherPracticeRoutes = require('./routes/teacher-practice.routes');
app.use('/api/teacher/practice', teacherPracticeRoutes);

// ---------- 教师端扩展模块 ----------
// 教师端看板与学情分析
const teacherDashboardRoutes = require('./routes/teacher-dashboard.routes');
app.use('/api/teacher', teacherDashboardRoutes);

// 教师端课程管理
const teacherCourseRoutes = require('./routes/teacher-course.routes');
app.use('/api/teacher', teacherCourseRoutes);

// 教师端学生管理
const teacherStudentRoutes = require('./routes/teacher-student.routes');
app.use('/api/teacher', teacherStudentRoutes);

// 教师端任务管理
const teacherTaskRoutes = require('./routes/teacher-task.routes');
app.use('/api/teacher', teacherTaskRoutes);

// 教师端题库管理
const teacherQuestionRoutes = require('./routes/teacher-question.routes');
app.use('/api/teacher', teacherQuestionRoutes);

// 教师端知识库管理
const teacherKnowledgeRoutes = require('./routes/teacher-knowledge.routes');
app.use('/api/teacher', teacherKnowledgeRoutes);

// 教师端消息通知
const teacherNotificationRoutes = require('./routes/teacher-notification.routes');
app.use('/api/teacher', teacherNotificationRoutes);

// 教师端 AI 功能（占位）
const teacherAiRoutes = require('./routes/teacher-ai.routes');
app.use('/api/teacher', teacherAiRoutes);

// ============================================================
// 教师端路由（教师端开发者在此区域添加新模块挂载）
// ============================================================

// ============================================================
// 管理端路由（管理端开发者在此区域添加新模块挂载）
// ============================================================
const adminRoutes = require('./routes/admin.routes');
app.use('/api/admin', adminRoutes);

// AI 问答模块
const studentChatRoutes = require('./routes/student-chat.routes');
app.use('/api/student', studentChatRoutes);

// 学科答疑小助手（百炼 qwen3.7-plus 多模态流式对话）
const aiChatRoutes = require('./routes/ai-chat.routes');
app.use('/api/ai-chat', aiChatRoutes);

// Dify 训练师 Workflow
const trainerRoutes = require('./modules/dify/trainer.routes');
app.use('/api/ai/trainer', trainerRoutes);

// 训练师 Agent 业务接口
const trainerAgentRoutes = require('./modules/agent/trainer/trainer.routes');
app.use('/api/agent/trainer', trainerAgentRoutes);

// 讲解者 Agent 业务接口
const explainerAgentRoutes = require('./modules/agent/explainer/explainer.routes');
app.use('/api/agent/explainer', explainerAgentRoutes);

// 诊断师 Agent 业务接口
const diagnosticianAgentRoutes = require('./modules/agent/diagnostician/diagnostician.routes');
app.use('/api/agent/diagnostician', diagnosticianAgentRoutes);

// 知识库文档模块
const studentDocumentRoutes = require('./routes/student-document.routes');
app.use('/api/student', studentDocumentRoutes);

// 视频推荐模块
const studentVideoRoutes = require('./routes/student-video.routes');
app.use('/api/student', studentVideoRoutes);

// 学习流系统
const learningWorkflowRoutes = require('./modules/learning-workflow/learning-workflow.routes');
app.use('/api/learning-workflows', learningWorkflowRoutes);

// 自然语言学习目标仅作为现有学习流之前的解析与绑定层。
const learningGoalRoutes = require('./modules/learning-goal').routes;
app.use('/api/learning-goals', learningGoalRoutes);

// LangGraph 学习流运行接口（复用 /api/learning-flows 前缀）
const learningAgentRoutes = require('./modules/learning-agent/routes/learning-agent.routes');
app.use('/api/learning-flows/:workflowId/runs', learningAgentRoutes);

// 实时语音导学是学习流之外的可选增强层；禁用或缺少 TTS 配置时路由仍可安全返回降级状态。
const { getLearningNarrationModule } = require('./modules/learning-narration');
app.use('/api/learning-narration', getLearningNarrationModule().routes);

// ---------- 根路径 ----------

app.get('/', (req, res) => {
  res.send('DisciMind backend is running');
});

// ---------- 统一错误处理（必须放在所有路由之后）----------

app.use(errorHandler);

module.exports = app;
