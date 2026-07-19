# DisciMind 2 核 2G 轻量服务器部署门禁

本方案针对单机、低并发教学演示与小规模使用。视频编码在用户浏览器内完成；服务器只运行一个后端进程，负责 PPT、配图、TTS、任务状态与文件保存。

## 1. 上线前必须满足

- Node.js 使用 22.12+；前后端均执行 `npm ci`。
- `frontend/.env` 使用 `VITE_API_BASE_URL=/api`，不得写 `localhost` 或 `127.0.0.1`；同时设置 `VITE_SHOW_DEMO_ACCOUNTS=false`。
- 后端生产环境设置真实数据库、JWT、百炼、图片生成与 TTS 密钥，密钥不进入 Git。
- `AI_CONFIG_ENCRYPTION_KEY` 使用至少 32 字节的独立随机密钥；上线后不得随意更换，否则数据库内已加密的 AI 配置无法解密。
- 数据库先备份，在测试库验证迁移后再执行 `npx prisma migrate deploy`。
- 仅运行一个 PM2 fork 实例；不要开启 cluster。
- 阿里云安全组只开放 80/443，不直接开放 3000/5173。
- 生产数据库不要执行演示种子；若由测试库迁移，必须禁用或重置 `admin_demo`、`teacher_demo`、`student_demo` 等默认账号密码。
- 符合 Remotion 免费许可时让 `VITE_REMOTION_LICENSE_KEY` 保持为空；需要商业许可时填写购买的 License Key。不要伪造 `free-license` 字符串。

后端最低生产配置：

```env
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=loopback
JWT_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES
CORS_ORIGIN=https://YOUR_DOMAIN
REFRESH_TOKEN_COOKIE_SECURE=true
REFRESH_TOKEN_SAME_SITE=lax
AI_CONFIG_DB_ENABLED=true
AI_CONFIG_ENCRYPTION_KEY=REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES
DATABASE_CONNECTION_LIMIT=5
ASYNC_TASK_WORKER_CONCURRENCY=1
LEARNING_NARRATION_MAX_CONCURRENT_JOBS=1
AUTH_REGISTER_RATE_LIMIT_MAX=5
AUTH_LOGIN_RATE_LIMIT_MAX=20
AUTH_REFRESH_RATE_LIMIT_MAX=60
PUBLIC_TEACHER_REGISTRATION_ENABLED=false
GENERATED_VIDEO_MAX_MB=120
PPT_GENERATION_CONCURRENCY=1
PPT_GENERATION_QUEUE_LIMIT=4
PPT_GENERATION_TOTAL_TIMEOUT_MS=600000
VIDEO_NARRATION_TASK_TIMEOUT_MS=900000
RESOURCE_PACKAGE_ACTIVE_LIMIT_PER_USER=1
HTTP_REQUEST_TIMEOUT_MS=1860000
HTTP_HEADERS_TIMEOUT_MS=66000
HTTP_KEEP_ALIVE_TIMEOUT_MS=65000
```

`HTTP_REQUEST_TIMEOUT_MS` 是 Node 接收完整请求体的上限，31 分钟可覆盖低带宽下的 120 MB MP4 上传。`headers` 保持比 `keep-alive` 多 1 秒，减少复用连接在边界时刻中断。Node 的 socket 空闲超时固定关闭（`0`），SSE 和 TTS WebSocket 由心跳、业务任务超时及 Nginx 超时共同约束，不会被 Node 误断开。

## 2. 构建与迁移

2G 服务器不要现场执行 Vite 前端构建。先在开发机或 CI 使用与服务器一致的 Node.js 版本完成前端构建和检查，再把 `frontend/dist/` 作为发布产物上传；服务器只安装后端生产依赖、执行 Prisma 迁移并启动服务。

```bash
cd frontend
npm ci
npm run build
grep -R -E "127\\.0\\.0\\.1:3000|localhost:3000" dist/assets

# 上传构建好的 dist/ 后，在服务器执行：
cd /opt/discimind/backend
npm ci --omit=dev
npx prisma generate
npx prisma validate
npx prisma migrate status
# 先备份并在测试库验证，再执行：
npx prisma migrate deploy
```

最后一条命令必须没有输出。构建后的 `dist/pics/login/scenarios/` 应包含 6 张 WebP。

### 2.1 真实知识库绑定门禁

系统讲义和试卷智能体只有在下列条件同时满足时才会启用知识库增强：

- 知识库为启用、公开且已发布状态，并具有真实 `dify_dataset_id`；
- 至少一份文档已完成向量化、审核通过，并具有真实 `dify_document_id`；
- 后端启动后日志中没有出现“系统文件智能体未绑定真实公开知识库”的告警。

若暂时没有满足条件的知识库，五类学习资源包仍可通过通用模型生成，但讲义和试卷不具备 RAG 引用能力。不要为了通过检查写入虚假的 Dify ID。完成知识库导入、审核和发布后重启后端，启动过程会自动重新绑定。

## 3. 启动服务

```bash
cd /opt/discimind
pm2 start deploy/pm2/ecosystem.config.cjs
pm2 startup systemd
# 执行上一条命令输出的 sudo env ... 命令，然后：
pm2 save

pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

sudo cp deploy/nginx/discimind.conf.example /etc/nginx/conf.d/discimind.conf
# 将配置中的 YOUR_DOMAIN 与证书路径替换为真实值。
sudo nginx -t
sudo systemctl reload nginx
```

Nginx 模板同时代理 `/api/`、`/uploads/` 与 `/ws/learning-narration`，请求体上限为 132 MB，与后端 120 MB MP4 上限之间保留 multipart 封装余量。`/api/` 关闭响应缓冲，SSE 任务进度会立即到达浏览器。

## 4. 2G 内存与 40G 磁盘约束

- 异步任务与 TTS 并发保持为 1；生成接口应在 Nginx/WAF 做用户级限流。
- 单个学生默认只允许一个处于排队或服务端生成阶段的五类资源包；进入浏览器渲染阶段后才允许继续创建下一个。
- 可配置 2G swap 作为短时保护，但不能用 swap 代替并发限制。
- 对磁盘使用率设置 70% 预警、80% 告警；至少备份 `storage/`、`backend/storage/` 和数据库。
- 定期检查生成视频、PPT、配图和 TTS 缓存，避免 40G 磁盘被历史产物占满。
- 生成产物和缓存目录已排除出 Git；发布时不要删除这两个持久化目录，也不要在项目根目录执行 `git clean -fdx`。
- `backend/scripts/run-browser-package-render.js` 仅用于开发机验收，不得在 2C2G 服务器上定时运行；最终编码由学生浏览器完成。
- 确认后端运行用户对 `/opt/discimind/storage` 和 `/opt/discimind/backend/storage` 具有读写权限，并允许服务器通过 DNS、HTTPS 和 WebSocket 出站访问百炼、图片生成、TTS 与 Dify 服务。

## 5. 上线验收

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS https://YOUR_DOMAIN/api/health
curl -I https://YOUR_DOMAIN/
curl -I https://YOUR_DOMAIN/pics/login/scenarios/ai-tutoring.webp
free -h
df -h
pm2 status
pm2 logs discimind-backend --lines 100 --nostream
```

日志中不得出现生产配置校验失败、数据库连接失败或系统文件智能体未绑定知识库（若本次验收要求 RAG）。最后使用外部 Chrome/Edge 完整验证：登录 → 生成 PPT → 生成配图 → TTS 配音 → 浏览器渲染 MP4 → 上传 → 刷新后播放与下载，并从任务中心返回原生成页面确认任务状态不会丢失。
