# API 接口设计

> 本文档为接口规划，不代表已实现。

## 1. 通用规范

- 接口前缀统一使用 `/api`
- 响应格式统一为 `{ code, message, data }`
- 需要认证的接口使用 JWT Bearer Token

## 2. 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查（已实现） |

## 3. 认证接口（规划中）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 用户注册 |
| POST | /api/auth/login | 用户登录 |

## 4. Dify 接口（规划中）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/dify/chat | Dify 对话接口 |
| POST | /api/dify/workflow | Dify 工作流接口 |

说明：前端不能直接调用 Dify API，必须通过后端转发。

## 5. 智能体广场接口（规划中）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/agent-market/list | 智能体广场列表 |
| GET | /api/agent-market/:id | 智能体详情 |

## 6. 自研 Agent 接口（规划中）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/agent/run | 运行自研智能体 |
| GET | /api/agent/my | 我的智能体列表 |

## 7. AI 接口（规划中）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/ai/chat | AI 对话 |
| POST | /api/ai/generate/text | 文本生成 |
| POST | /api/ai/generate/image | 图片生成 |
| POST | /api/ai/generate/video | 视频生成 |

## 8. 知识库接口（规划中）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/knowledge/upload | 上传知识库文件 |
| GET | /api/knowledge/list | 知识库文件列表 |
| DELETE | /api/knowledge/:id | 删除知识库文件 |
