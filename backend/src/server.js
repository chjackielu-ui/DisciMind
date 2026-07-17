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
let artifactCleanupTimer = null;
let httpServer = null;
let shutdownPromise = null;

function startArtifactCleanupScheduler() {
  if (String(process.env.ARTIFACT_CLEANUP_ENABLED || 'true').toLowerCase() === 'false') return;
  const intervalMs = Math.max(60_000, Number(process.env.ARTIFACT_CLEANUP_INTERVAL_MS || 24 * 60 * 60 * 1000));
  const run = () => require('./modules/file-generator/artifact-cleanup.service').scheduleCleanup()
    .catch((error) => console.error('[artifact-cleanup] 调度失败:', error.message));
  artifactCleanupTimer = setTimeout(function tick() { void run(); artifactCleanupTimer = setTimeout(tick, intervalMs); artifactCleanupTimer.unref?.(); }, 60_000);
  artifactCleanupTimer.unref?.();
}

function stopArtifactCleanupScheduler() {
  if (artifactCleanupTimer) clearTimeout(artifactCleanupTimer);
  artifactCleanupTimer = null;
}

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

function closeHttpServer(server, timeoutMs = 8000) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    timer.unref?.();
    server.close(finish);
    server.closeIdleConnections?.();
  });
}

// 优雅关闭
function setupGracefulShutdown() {
  const shutdown = (signal) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
    console.log(`[server] 收到 ${signal} 信号，正在关闭...`);
      let exitCode = 0;
      try {
        stopExpirationScanner();
        stopArtifactCleanupScheduler();
        generationRegistry.cancelAll();
        await getAsyncTaskWorker().stop().catch((error) => console.error('[tasks] Worker 停止失败:', error.message));
        getLearningNarrationModule().close();
        await require('./modules/learning-agent/graph/checkpointer.service').closeCheckpointer()
          .catch((error) => console.error('[checkpointer] 关闭失败:', error.message));
        await closeHttpServer(httpServer);
      } catch (error) {
        exitCode = 1;
        console.error('[server] 关闭服务失败:', error.message);
      } finally {
        await prisma.$disconnect().catch((error) => {
          exitCode = 1;
          console.error('[db] 断开数据库连接失败:', error.message);
        });
        console.log('[server] 已安全关闭');
        process.exit(exitCode);
      }
    })();
    return shutdownPromise;
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
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

  await require('./modules/file-generator/system-file-agents.service').ensureSystemFileAgents()
    .then((items) => console.log(`[system-agents] 已确保 ${items.length} 个系统文件智能体可用`))
    .catch((error) => console.error('[system-agents] 初始化失败:', error.message));

  startExpirationScanner();
  startArtifactCleanupScheduler();
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
