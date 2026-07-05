// 后端服务入口
// 读取环境变量并启动 Express 服务

const { loadEnv } = require('./config/env');
const { describeDatabaseError } = require('./config/database');
const app = require('./app');
const prisma = require('./config/prisma');

loadEnv();

const PORT = process.env.PORT || 3000;

// 定时扫描器引用
let expirationInterval = null;

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
  const shutdown = (signal) => {
    console.log(`[server] 收到 ${signal} 信号，正在关闭...`);
    stopExpirationScanner();
    // 给正在处理的请求一点时间完成
    setTimeout(() => process.exit(0), 2000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// 启动前测试数据库连接，避免启动后出现连接池超时
async function start() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('[db] 数据库连接成功');
  } catch (err) {
    console.error('[db] 数据库连接失败:', describeDatabaseError(err));
    process.exit(1);
  }

  startExpirationScanner();
  setupGracefulShutdown();

  app.listen(PORT, () => {
    console.log(`DisciMind backend server is running at http://localhost:${PORT}`);
  });
}

start();
