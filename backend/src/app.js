const express = require('express');
const cors = require('cors');
const path = require('path');

const { loadEnv } = require('./config/env');
const errorHandler = require('./middlewares/error.middleware');
const requestIdMiddleware = require('./middlewares/request-id.middleware');

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
app.disable('x-powered-by');
<<<<<<< Updated upstream
=======

// 生产环境只信任本机 Nginx 注入的转发头，确保限流与审计拿到真实客户端 IP。
const trustProxy = process.env.TRUST_PROXY || (process.env.NODE_ENV === 'production' ? 'loopback' : '');
if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
>>>>>>> Stashed changes

// ---------- 全局中间件 ----------

app.use(requestIdMiddleware);
<<<<<<< Updated upstream
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
=======
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
>>>>>>> Stashed changes
  next();
});

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

// 认证报文不需要大请求体，先应用更小的上限，避免在限流前解析超大 JSON。
app.use('/api/auth', express.json({ limit: '64kb' }));
// 多模态对话使用 data URL 传输图片；后端随后落盘，数据库只保存附件元数据。
app.use(express.json({ limit: '18mb' }));

// 解析 URL 编码的请求体（表单提交场景）
app.use(express.urlencoded({ extended: true }));

<<<<<<< Updated upstream
// 头像是唯一允许匿名读取的上传内容。知识库、学习流附件与对话附件必须走各自的鉴权下载路由。
app.use('/uploads/avatars', express.static(path.join(__dirname, '../../storage/uploads/avatars'), {
  dotfiles: 'deny',
  fallthrough: false,
  index: false,
  maxAge: '1h',
}));
=======
// 仅公开确需由 <img> 直接读取的随机命名图片。文档和聊天附件必须走鉴权下载接口。
const publicUploadRoot = path.join(__dirname, '../../storage/uploads');
const publicUploadOptions = {
  dotfiles: 'deny',
  fallthrough: true,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'public, max-age=86400');
  },
};
for (const folder of ['avatars', 'generated-ppt-images', 'learning']) {
  app.use(`/uploads/${folder}`, express.static(path.join(publicUploadRoot, folder), publicUploadOptions));
}
>>>>>>> Stashed changes

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

// ---------- 全角色统一消息中心 ----------
const notificationRoutes = require('./routes/notification.routes');
app.use('/api/notifications', notificationRoutes);

// ---------- 三端统一任务与消息中心（聚合任务和通知，不合并底层表） ----------
const workCenterRoutes = require('./routes/work-center.routes');
app.use('/api/work-center', workCenterRoutes);

// ---------- 课程 -> 教学班 -> 课程文件（所有下载必须经过鉴权） ----------
const courseFileRoutes = require('./routes/course-file.routes');
app.use('/api/courses', courseFileRoutes);

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
const teacherReminderRoutes = require('./routes/teacher-reminder.routes');
app.use('/api/teacher', teacherReminderRoutes);
const teacherArtifactRoutes = require('./routes/teacher-artifact.routes');
app.use('/api/teacher', teacherArtifactRoutes);

// 教师端 AI 题目、摘要、视频检索与学习分析
const teacherAiRoutes = require('./routes/teacher-ai.routes');
app.use('/api/teacher', teacherAiRoutes);

// 教师端智能教案生成
const teacherLessonPlanRoutes = require('./routes/teacher-lesson-plan.routes');
app.use('/api/teacher', teacherLessonPlanRoutes);

const teacherPreparationRoutes = require('./routes/teacher-preparation.routes');
app.use('/api/teacher', teacherPreparationRoutes);

const teacherProfileRoutes = require('./routes/teacher-profile.routes');
app.use('/api/teacher', teacherProfileRoutes);

// 教师端作业管理（独立 homework 模块）
const homeworkRoutes = require('./modules/homework/homework.routes');
app.use('/api/teacher/homework', homeworkRoutes);

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

// 学生与教师共用的 AI 任务中心协议、搜索能力与执行轨迹。
const aiAssistantRoutes = require('./modules/ai-assistant/ai-assistant.routes');
app.use('/api/ai-assistant', aiAssistantRoutes);

// 统一个性化学习卡片中枢（每日推荐、场景卡片、行为与 AI 成果）。
const learningCardRoutes = require('./modules/learning-card/learning-card.routes');
app.use('/api', learningCardRoutes);

// 用户智能体广场（独立于学习流和内置教学 Agent）
const agentMarketplaceRoutes = require('./modules/agent-marketplace/agent-marketplace.routes');
const knowledgeBaseMarketplaceRoutes = require('./modules/knowledge-base/knowledge-base.routes');
const agentChatMarketplaceRoutes = require('./modules/agent-chat/agent-chat.routes');
const agentReviewRoutes = require('./modules/agent-review/agent-review.routes');
app.use('/api/agents', agentMarketplaceRoutes);
app.use('/api/knowledge-bases', knowledgeBaseMarketplaceRoutes);
app.use('/api', agentChatMarketplaceRoutes);
app.use('/api/admin', agentReviewRoutes);

// 全局异步任务中心（独立于学习流执行协议）
const asyncTaskRoutes = require('./modules/async-task/async-task.routes');
app.use('/api/tasks', asyncTaskRoutes);

// FILE_GENERATOR 生成物（结构化预览、独立 DOCX 导出与鉴权下载）
const generatedArtifactRoutes = require('./modules/file-generator/generated-artifact.routes');
app.use('/api/generated-artifacts', generatedArtifactRoutes);
const learningFlowResourceRoutes = require('./modules/learning-flow-resource/learning-flow-resource.routes');
app.use('/api/learning-flow-resources', learningFlowResourceRoutes.resourceRoutes);
app.use('/api/learning-flow-resource-links', learningFlowResourceRoutes.linkRoutes);
const learningFlowPreloadRoutes = require('./modules/learning-flow-preload/learning-flow-preload.routes');
app.use('/api/learning-flow-preloads', learningFlowPreloadRoutes);
const studentLearningContextRoutes = require('./modules/student-learning-context/student-learning-context.routes');
app.use('/api/student-learning-context', studentLearningContextRoutes);
const studentLearningPlanRoutes = require('./modules/student-learning-plan/student-learning-plan.routes');
app.use('/api/student-learning-plans', studentLearningPlanRoutes);

// Dify 训练师 Workflow
const difyRoutes = require('./modules/dify/dify.routes');
app.use('/api/dify', difyRoutes);
const trainerRoutes = require('./modules/dify/trainer.routes');
app.use('/api/ai/trainer', trainerRoutes);

// 教学 Agent 聚合入口：Trainer / Explainer / Diagnostician
app.use('/api/agent', require('./modules/agent/agent.routes'));

// 知识库文档模块
const studentDocumentRoutes = require('./routes/student-document.routes');
app.use('/api/student', studentDocumentRoutes);

// 教师下发资源：学生接收、阅读、下载与完成状态回流
const studentResourceRoutes = require('./routes/student-resource.routes');
app.use('/api/student', studentResourceRoutes);

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
