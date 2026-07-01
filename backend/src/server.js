// 后端服务入口
// 读取环境变量并启动 Express 服务

require('dotenv').config();

const app = require('./app');
const prisma = require('./config/prisma');

const PORT = process.env.PORT || 3000;

// 启动前测试数据库连接，避免启动后出现连接池超时
async function start() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('[db] 数据库连接成功');
  } catch (err) {
    console.error('[db] 数据库连接失败，请检查 MySQL 是否已启动:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`DisciMind backend server is running at http://localhost:${PORT}`);
  });
}

start();
