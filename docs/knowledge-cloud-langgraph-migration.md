# 智能体与知识库云端迁移说明

## 1. 迁移结论

本次修改仅涉及后端、数据库迁移、种子数据、测试和部署文档，未修改前端代码，也未改变现有前端使用的主要业务路由和响应字段。

生产可达的智能体执行链路已从 Dify 切换为 LangChain + LangGraph。本地 Dify Chat/Workflow 不再被调用；历史 `/api/dify/*` 路由仅保留 HTTP 410 兼容响应，训练师原路由 `/api/ai/trainer/run` 保持可用并转发到本地 learning-agent runtime。

“我的知识库”已具备后端统一中转能力：原始文件可选择本地目录或阿里云 OSS，向量可选择数据库 JSON 兼容存储或 Qdrant。前端只访问 DisciMind 后端，不接触 OSS、Qdrant、百炼或其他模型服务密钥。

## 2. 功能完成情况

| 功能 | 状态 | 实现说明 |
| --- | --- | --- |
| 默认 Agent 模式切换为 LangGraph | 已实现 | `agent-runtime.js` 固定返回 LangGraph，旧环境变量不能恢复 Dify 执行 |
| 智能体运行、写作和模型调用后端封装 | 已实现 | 复用 learning-agent、LangChain、LangGraph 和后端 AI provider |
| 训练师从 Dify Workflow 迁移 | 已实现 | `trainer-runtime.service.js` 将本地 learning-agent 输出映射为原接口结构 |
| 学习流总结和错题修复使用诊断师 | 已实现 | 学习工作流调用本地 diagnostician/explainer，不再调用 Dify |
| “我的知识库”文件云存储 | 已实现 | `local/oss` 双驱动，上传、解析、预览、删除均经过后端存储适配器 |
| 知识库向量云存储 | 已实现 | `database/qdrant` 双驱动，索引、检索和删除由后端 provider 统一处理 |
| 历史本地文件迁移 OSS | 已实现 | 提供可续跑迁移脚本，上传后校验对象大小，默认保留本地文件 |
| 历史数据库向量迁移 Qdrant | 已实现 | 提供可续跑迁移脚本，迁移后移除数据库 JSON 中的大向量值 |
| 历史 Dify 数据导入 | 部分实现 | 支持将从 Dify 导出的原始文件按 manifest 重新上传并建立索引；不能直接读取已停用的 Dify 实例 |
| PDF 多浏览器与无沙箱 fallback | 已实现 | 依次尝试可用 Chrome/Edge，常规沙箱失败后再尝试 `--no-sandbox` |
| 408 种子课程名前缀 | 已实现 | 四门 408 课程统一增加 `408` 前缀 |
| 公共知识库真实种子文件 | 已实现 | 种子程序写入真实 Markdown 文件并创建 `KNOWLEDGE_INDEXING` 任务，不伪造已向量化状态 |
| 学生课程置顶索引 | 已实现 | Prisma schema 与既有迁移均包含 `(student_user_id, is_pinned, pinned_at)` 索引 |

## 3. 后端数据流

### 3.1 智能体

```text
前端现有接口
  -> 后端 Controller / Service
  -> learning-agent runtime
  -> LangGraph 状态图
  -> LangChain 模型适配器
  -> 百炼或后端配置的兼容模型服务
```

模型密钥只从后端环境变量或加密后的 AI 配置表读取。浏览器不会获得第三方密钥。

### 3.2 知识库

```text
上传文件 -> 后端校验 -> local 或 OSS -> 异步解析/分片
         -> 百炼 Embedding -> database JSON 或 Qdrant
检索请求 -> 后端鉴权 -> Embedding -> 向量检索 -> 权限过滤 -> 原接口响应
```

OSS 数据库字段为 `storage_key`、`storage_bucket`、`storage_etag`、`storage_version_id`。`file_url` 在 OSS 模式下保存 `oss://bucket/key` 定位符，不向前端下发带长期密钥的 URL。文档预览时由后端下载到临时目录，响应结束后清理。

## 4. 主要修改文件

运行时与智能体：

- `backend/src/config/agent-runtime.js`
- `backend/src/modules/agent/trainer/trainer-runtime.service.js`
- `backend/src/modules/agent/diagnostician/diagnostician.service.js`
- `backend/src/modules/agent/explainer/explainer.service.js`
- `backend/src/modules/learning-workflow/`
- `backend/src/modules/learning-agent/`
- `backend/src/modules/dify/`，仅保留历史路由兼容代码

知识库与云端中转：

- `backend/src/modules/knowledge-base/knowledge-storage.service.js`
- `backend/src/modules/knowledge-base/knowledge-vector-store.service.js`
- `backend/src/modules/knowledge-base/knowledge-provider.service.js`
- `backend/src/modules/knowledge-base/knowledge-base.service.js`
- `backend/src/modules/knowledge-base/knowledge-document-pipeline.service.js`
- `backend/src/modules/learning-agent/services/knowledge-router.service.js`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260723120000_knowledge_cloud_storage/migration.sql`

迁移、验收与数据：

- `backend/scripts/migrate-knowledge-files-to-oss.js`
- `backend/scripts/migrate-knowledge-vectors-to-qdrant.js`
- `backend/scripts/import-dify-knowledge-export.js`
- `backend/scripts/test-knowledge-cloud-live.js`
- `backend/scripts/dify-knowledge-export.manifest.example.json`
- `backend/prisma/seed-assets/408-public-knowledge.md`

依赖与配置：

- `backend/package.json` 和 `backend/package-lock.json`
- `.env.example` 和 `backend/.env.example`
- `backend/src/config/env.js`

## 5. 生产配置

推荐将知识文件放在 OSS，将向量放在独立 Qdrant 服务：

```env
AGENT_MODE=langgraph
LANGGRAPH_ENABLED=true

KNOWLEDGE_STORAGE_DRIVER=oss
KNOWLEDGE_OSS_REGION=oss-cn-hangzhou
KNOWLEDGE_OSS_BUCKET=REPLACE_WITH_BUCKET
KNOWLEDGE_OSS_ACCESS_KEY_ID=REPLACE_WITH_RAM_ACCESS_KEY_ID
KNOWLEDGE_OSS_ACCESS_KEY_SECRET=REPLACE_WITH_RAM_ACCESS_KEY_SECRET
KNOWLEDGE_OSS_PREFIX=agent-knowledge
KNOWLEDGE_OSS_INTERNAL=false
KNOWLEDGE_OSS_SECURE=true

KNOWLEDGE_VECTOR_STORE=qdrant
QDRANT_URL=https://REPLACE_WITH_QDRANT_ENDPOINT
QDRANT_COLLECTION=discimind_knowledge
QDRANT_API_KEY=REPLACE_WITH_QDRANT_API_KEY

KNOWLEDGE_EMBEDDING_PROVIDER=BAILIAN
KNOWLEDGE_EMBEDDING_API_KEY=REPLACE_WITH_BAILIAN_API_KEY
KNOWLEDGE_EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
KNOWLEDGE_EMBEDDING_MODEL=text-embedding-v4
```

使用 OSS 内网 endpoint 前，必须确认轻量应用服务器所在网络可以访问该 endpoint。无法确认时使用 OSS 公网 HTTPS endpoint，并通过 RAM 用户最小权限、私有 Bucket 和服务端下载控制访问。

生产启动会校验驱动名称和必填项。配置 `oss` 或 `qdrant` 后缺少对应参数时，后端会直接拒绝启动，避免上传或索引到一半才失败。该校验只确认配置完整，不替代云服务连通性验收。

## 6. 部署与迁移顺序

先备份 MySQL 和本地 `storage/`、`backend/storage/`，再执行：

```bash
cd /opt/discimind/backend
npm ci --omit=dev
npx prisma generate
npx prisma validate
npx prisma migrate deploy
```

将已有本地知识文件迁移到 OSS：

```bash
npm run migrate:knowledge:files
```

脚本默认从 checkpoint 继续并保留本地文件。确认 OSS 对象可读取、数据库字段正确且已完成备份后，才可再次使用 `--delete-local`。不要在首次生产迁移时直接删除源文件。

将数据库 metadata 中已有向量迁移到 Qdrant：

```bash
npm run migrate:knowledge:vectors
```

脚本只迁移存在有效向量的分片。被跳过的分片需要重新触发知识库索引。

仅存在于 Dify 的历史资料必须先从原平台导出原始文件，再参考示例 manifest 执行：

```bash
npm run import:dify-knowledge -- --manifest=/secure/path/manifest.json
```

导入会复用现有上传和异步索引流程。manifest 和导出文件可能包含敏感资料，不应放入 Git 仓库。

使用专用测试 Bucket 和 Qdrant collection 做真实云验收：

```bash
KNOWLEDGE_CLOUD_LIVE_ACCEPTANCE=true npm run test:knowledge-cloud:live
```

## 7. 阿里云轻量应用服务器评估

可以部署，但必须满足以下条件：

- Node.js 22.12+、MySQL、Nginx、HTTPS 和单 PM2 fork 进程。
- 2 核 2G 只适合低并发演示；不要在同一台 2G 主机同时运行 Node、MySQL 和 Qdrant。优先使用外部 Qdrant/托管向量服务，或将服务器升级到至少 4 GB 内存后单独压测。
- 只开放 80/443。MySQL、Node 3000 和 Qdrant 6333 不应直接暴露到公网。
- 即使知识文件已经使用 OSS，`storage/` 和 `backend/storage/` 仍需持久化且可写，因为生成文件、上传附件、TTS 缓存和 LangGraph checkpoint 仍使用本地目录。
- PM2 保持 `instances: 1`。当前异步 worker、SQLite checkpoint 和本地文件行为不适合直接改为 cluster。
- 服务器需要通过 HTTPS/WSS 出站访问百炼、OSS、Qdrant、图片生成和 TTS 服务，不再需要访问 Dify。
- Linux PDF 导出需要安装 Chrome/Chromium，或显式设置 `PDF_CHROMIUM_PATH`。`--no-sandbox` 仅为容器或受限运行环境的最后 fallback，不替代系统级隔离。

## 8. GitHub 上传检查

代码可以上传 GitHub，但应同时满足：

- 提交 `backend/package.json` 和 `backend/package-lock.json`，否则生产 `npm ci` 不会安装 `ali-oss` 与 Qdrant 客户端。
- 提交 Prisma schema 和迁移 SQL，部署时使用 `prisma migrate deploy`。
- 只提交空值或占位值的 `.env.example`；真实 `.env`、AccessKey、API Key、数据库密码和 manifest 不得提交。
- `.gitignore` 已排除根目录及后端 `.env`、知识文件、本地上传、生成产物、LangGraph SQLite checkpoint 和运行缓存。
- 推送前仍应执行密钥扫描，并检查暂存内容，而不能只依赖 `.gitignore`。已经进入 Git 历史的密钥必须立即轮换，单纯删除文件不能撤销泄露。

建议推送前执行：

```bash
git diff --check
git diff --name-only -- frontend
git grep -n -I -E "(AccessKeySecret|sk-[A-Za-z0-9_-]{16,}|DASHSCOPE_API_KEY=.+)" -- . ":(exclude)*.example"
```

## 9. 风险与缺口

- 未提供真实阿里云和 Qdrant 测试资源，因此当前只完成了适配器单元测试和注入客户端集成测试，真实网络、RAM 权限、Bucket 策略、限流和账单需要上线前验收。
- 项目没有自动调用 Dify 导出 API。只有 Dify 远端分片而没有原始文件的数据无法自动恢复，必须人工导出原文件后重新索引。
- Qdrant 不随本项目部署，也没有自动备份任务。必须单独准备服务、监控、快照和恢复方案。
- `database` 向量模式适合兼容和小数据量；大规模数据应使用 Qdrant。迁移前后需抽样比较检索结果。
- OSS 当前使用后端长期 RAM AccessKey 或 STS Token 配置，不向前端暴露。生产应使用专用 RAM 用户和最小 Bucket 权限，并建立密钥轮换流程。
- `/api/health` 仍以数据库和本地持久目录为基础健康门禁；OSS/Qdrant 的真实连通性由上线验收脚本和外部监控负责。
- 旧 Dify 字段仍保留在数据库中用于历史数据识别和离线导入，不代表仍有 Dify 外连路径。

## 10. 回退原则

出现云端故障时，可在停机并确认数据库状态后将 `KNOWLEDGE_STORAGE_DRIVER` 临时切回 `local`、将 `KNOWLEDGE_VECTOR_STORE` 切回 `database`。但已经删除本地源文件或已从 metadata 移除向量的数据不能仅靠切换变量恢复，必须从备份还原或重新索引。因此云迁移完成、抽样验收和备份确认之前，不应使用 `--delete-local`，也不应删除 Qdrant 快照。
