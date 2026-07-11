// 后端服务入口
// 读取环境变量并启动 Express 服务

const { loadEnv } = require('./config/env');
const { describeDatabaseError } = require('./config/database');
const http = require('http');
const app = require('./app');
const prisma = require('./config/prisma');
const { getLearningNarrationModule } = require('./modules/learning-narration');
const { getAsyncTaskWorker } = require('./modules/async-task/async-task.worker');
const generationRegistry = require('./modules/agent-chat/generation-registry');
const { recoverInterruptedGenerations } = require('./modules/agent-chat/agent-generation.service');

loadEnv();

const PORT = process.env.PORT || 3000;

// 定时扫描器引用
let expirationInterval = null;
let httpServer = null;

function startExpirationScanner() {
  const { scanAndSubmitExpiredAttempts } = require('./services/attempt-expiration.service');

  // 启动时先扫描一次
  scanAndSubmitExpiredAttempts().catch((err) => {
    console.error('[expiration] 启动扫描失败:', err.message);
  });

  const intervalMs = Number(process.env.ATTEMPT_EXPIRATION_SCAN_INTERVAL_MS);
  if (intervalMs === 0) {
    console.log('[expiration] 定时扫描已关闭（ATTEMPT_EXPIRATION_SCAN_INTERVAL_MS=0）');
    return;
  }

  const delay = isNaN(intervalMs) || intervalMs < 10000 ? 60000 : intervalMs;
  expirationInterval = setInterval(() => {
    scanAndSubmitExpiredAttempts().catch((err) => {
      console.error('[expiration] 定时扫描异常:', err.message);
    });
  }, delay);

  // 允许事件循环在无其他任务时退出（避免阻止进程关闭）
  if (expirationInterval.unref) expirationInterval.unref();

  console.log(`[expiration] 定时扫描已启动，间隔 ${delay / 1000}s`);
}

function stopExpirationScanner() {
  if (expirationInterval) {
    clearInterval(expirationInterval);
    expirationInterval = null;
    console.log('[expiration] 定时扫描已停止');
  }
}

// 优雅关闭
function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    console.log(`[server] 收到 ${signal} 信号，正在关闭...`);
    stopExpirationScanner();
    generationRegistry.cancelAll();
    await getAsyncTaskWorker().stop().catch((error) => console.error('[tasks] Worker 停止失败:', error.message));
    getLearningNarrationModule().close();
    httpServer?.close();
    // 给正在处理的请求一点时间完成
    setTimeout(() => process.exit(0), 2000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// 启动前测试数据库连接，避免启动后出现连接池超时
async function start() {
  // 学习目标功能开关诊断日志（只记录布尔值）
  console.log(`[LearningGoal] enabled=${process.env.LEARNING_GOAL_ENABLED === 'true'}`);

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('[db] 数据库连接成功');
  } catch (err) {
    console.error('[db] 数据库连接失败:', describeDatabaseError(err));
    process.exit(1);
  }

  startExpirationScanner();
  const recoveredGenerations = await recoverInterruptedGenerations();
  if (recoveredGenerations) console.log(`[agent-generation] 已将 ${recoveredGenerations} 个遗留生成标记为 INTERRUPTED`);
  await getAsyncTaskWorker().start();
  setupGracefulShutdown();

  httpServer = http.createServer(app);
  getLearningNarrationModule().attach(httpServer);
  httpServer.listen(PORT, () => {
    console.log(`DisciMind backend server is running at http://localhost:${PORT}`);
  });
}

start();
