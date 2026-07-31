# Judge0 部署说明

## 0. ECS 安装顺序

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx mysql-server ufw python3.10 python3.10-venv
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get install -y docker-compose-plugin
sudo systemctl enable --now docker mysql nginx
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw deny 2358/tcp && sudo ufw --force enable
```

Node.js 后端按仓库既有版本安装并监听 `127.0.0.1:3000`；不要把 Node 或 Judge0 端口绑定公网。

## 1. 安装并启动

在 Ubuntu 22.04 ECS 上先安装 Docker Engine 和 Compose 插件，然后执行：

```bash
cd /opt/discimind/deploy/judge0
cp .env.example .env
# 把 .env 中的 JUDGE0_DB_PASSWORD 替换为随机强密码，文件不要提交到 Git。
docker compose pull
docker compose up -d
curl -fsS http://127.0.0.1:2358/languages | grep -q '"name":"C (GCC'
curl -fsS http://127.0.0.1:2358/languages | grep -q '"name":"Python'
```

2 核 2GB ECS 保持 `COUNT=1`，并配置至少 2GB swap；该规格适合演示和低并发，不适合课堂集中提交。

## 2. 应用发布顺序

```bash
cd /opt/discimind
git fetch origin
git checkout main
git pull --ff-only origin main
cd backend && npm ci && npx prisma migrate deploy && npx prisma generate
cd ../frontend && npm ci && npm run build
sudo systemctl reload nginx
pm2 reload /opt/discimind/deploy/pm2/ecosystem.config.cjs --update-env
curl --fail http://127.0.0.1:3000/api/health
```

本次开发阶段仍在 `dev`，不要在当前任务中执行上述 `checkout main` 或合并操作；只有验收通过后才由发布人员按 main 流程执行。

若你的 Judge0 官方发行包包含独立的 `judge0.conf`、`redis.conf` 和 `docker-compose.yml`，以官方文件为基础，仅合并本文件的 loopback 端口、资源限制和 `ENABLE_NETWORK=false` 配置。Judge0 镜像标签升级前，先在 dev 环境验证 `/languages` 和 C language id。

Judge0 1.13.1 官方 Compose 要求 `judge0-server` 和 `judge0-workers` 保留 `privileged: true`。Judge0 依靠容器内的 `sudo`、setuid 和 isolate/cgroup 创建执行沙箱，设置 `no-new-privileges` 或删除全部 capabilities 会导致提交返回 `Internal Error`。API 端口仍只绑定 `127.0.0.1`，浏览器和公网不得直接访问 Judge0。

## 3. 网络边界

只允许后端通过 `http://127.0.0.1:2358` 调用。ECS 安全组和 UFW 都不要开放 2358：

```bash
sudo ufw deny 2358/tcp
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

后端 `JUDGE0_BASE_URL` 也会拒绝公网地址。浏览器只能请求 `/api/compiler/*`。
