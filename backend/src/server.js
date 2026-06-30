// 后端服务入口
// 读取环境变量并启动 Express 服务

require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`DisciMind backend server is running at http://localhost:${PORT}`);
});
