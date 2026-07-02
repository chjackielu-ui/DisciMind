# DisciMind（学研智擎）

面向一流学科建设的垂类大模型教学科研创新应用平台。

## 项目简介

DisciMind 是一个面向高等教育场景的 Web 应用平台，围绕学科建设、教学辅助、科研支持和 AI 内容生成等能力，构建一个可演示、可扩展的垂类大模型应用平台。平台支持**学生端**、**教师端**和**管理员端**三种角色，提供智能答题、AI 学科答疑、知识库管理、学情画像、个性化推荐等核心功能。

### 核心功能

| 模块 | 说明 |
|------|------|
| 用户认证 | 注册/登录、JWT 鉴权、角色权限控制（学生/教师/管理员） |
| 学生端仪表盘 | 学习概览、课程列表、任务进度 |
| 课程学习 | 课程详情、章节浏览、知识点学习 |
| 智能答题 | 在线作业答题、自动批改、提交结果查看 |
| 自主练习 | 自由选题练习、AI 辅助答疑、错题管理 |
| AI 学科答疑 | 基于 DeepSeek 大模型的流式对话助手 |
| 知识库 | 文档上传（PDF/Word/Markdown）、解析、管理 |
| 错题本 | 错题收集、状态追踪、相似题推荐 |
| 学生画像 | 知识点掌握度、学习行为分析、能力雷达图 |
| 个性化推荐 | 学习路径、复习计划、视频资源推荐 |
| 教师端 | 班级管理、练习分析、学情统计 |
| 管理员端 | 系统管理、用户管理 |

## 技术栈

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Vite | ^8.1 | 构建工具 |
| 原生 JavaScript (ES Module) | — | 前端逻辑 |
| 原生 CSS | — | 样式 |
| Axios | ^1.18 | HTTP 请求 |
| ECharts | ^6.1 | 数据可视化图表 |
| KaTeX | ^0.17 | 数学公式渲染 |
| Marked | ^18.0 | Markdown 渲染 |
| DOMPurify | ^3.4 | XSS 过滤 |

### 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | — | 运行环境（建议 v18+） |
| Express | ^5.2 | Web 框架 |
| Prisma | ^7.8 | ORM（数据库操作） |
| MySQL | — | 关系型数据库 |
| JWT (jsonwebtoken) | ^9.0 | 身份认证 |
| bcryptjs | ^3.0 | 密码加密 |
| multer | ^2.2 | 文件上传 |
| pdf-parse | ^2.4 | PDF 解析 |
| mammoth | ^1.12 | Word 文档解析 |

### AI 能力

| 能力 | 说明 |
|------|------|
| DeepSeek | 学科答疑（流式对话）、AI 批改 |
| 讯飞星火 | 已预留接口 |
| 通义千问 | 已预留接口 |
| Dify | 智能体编排平台（转发代理架构） |
| Qdrant | 向量数据库（已规划） |

## 项目结构

```
DisciMind/
├── frontend/                    # 前端项目
│   ├── index.html               # HTML 入口
│   ├── package.json
│   ├── public/                  # 静态资源
│   └── src/
│       ├── main.js              # 前端入口（路由启动）
│       ├── api/                 # API 请求封装
│       │   ├── request.js       # Axios 实例（统一配置）
│       │   ├── auth.js          # 认证接口
│       │   └── student.js       # 学生端接口
│       ├── components/          # 可复用组件
│       │   ├── agent/           # 智能体相关组件
│       │   ├── ai/              # AI 对话组件
│       │   └── practice/        # 练习组件
│       ├── modules/             # 业务模块（API + Service）
│       │   ├── agent/
│       │   ├── agent-market/
│       │   └── dify/
│       ├── pages/               # 页面
│       │   ├── login.js         # 登录页
│       │   ├── register.js      # 注册页
│       │   ├── student-*.js     # 学生端页面（16 个）
│       │   ├── teacher-*.js     # 教师端页面
│       │   ├── admin-*.js       # 管理员端页面
│       │   ├── agent/           # 智能体页面
│       │   └── ai/              # AI 功能页面
│       ├── styles/              # 样式文件
│       │   ├── global.css       # 全局样式
│       │   ├── login.css
│       │   ├── dashboard.css
│       │   ├── student.css
│       │   └── student-complex.css
│       └── utils/               # 工具函数
│           ├── router.js        # Hash 路由系统
│           ├── auth.js          # 认证工具
│           ├── toast.js         # 消息提示
│           ├── markdown.js      # Markdown 渲染
│           └── ...
│
├── backend/                     # 后端项目
│   ├── package.json
│   ├── prisma/
│   │   ├── schema.prisma        # 数据库模型定义（40+ 表）
│   │   ├── seed.js              # 种子数据
│   │   └── migrations/          # 数据库迁移文件
│   └── src/
│       ├── server.js            # 服务入口
│       ├── app.js               # Express 应用配置
│       ├── config/
│       │   └── prisma.js        # Prisma 客户端单例
│       ├── controllers/         # 控制器层
│       ├── middlewares/         # 中间件（auth、role、error）
│       ├── modules/             # 功能模块
│       │   ├── agent/           # 智能体调度
│       │   ├── agent-market/    # 智能体广场
│       │   ├── ai/              # AI Provider 封装
│       │   ├── ai-generate/     # AI 生成（图文视频）
│       │   ├── dify/            # Dify 转发层
│       │   └── rag/             # RAG 检索
│       ├── prompts/             # Prompt 模板
│       ├── routes/              # 路由定义
│       ├── services/            # 业务逻辑层
│       └── utils/               # 工具函数
│           ├── jwt.js           # JWT 签发与验证
│           ├── response.js      # 统一响应格式
│           └── enum.js          # 枚举映射
│
├── docs/                        # 项目文档
│   ├── 00-project-overview.md
│   ├── 02-development-rules.md
│   ├── 03-api-design.md
│   ├── 05-ai-agent-design.md
│   ├── 运行说明.md              # 详细运行指南
│   ├── 接口说明.md              # API 接口说明
│   └── DisciMind API 接口文档 v1.0.md  # 完整 API 文档
│
├── storage/                     # 文件存储
│   ├── uploads/                 # 上传文件
│   ├── parsed/                  # 解析后文本
│   └── temp/                    # 临时文件
│
├── scripts/                     # 脚本工具
├── logs/                        # 日志文件
├── .env.example                 # 环境变量示例
├── .gitignore
└── README.md
```

## 环境要求

在开始之前，请确保你的电脑已安装以下软件：

| 软件 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | v18.0.0+ | JavaScript 运行环境 |
| npm | v9.0.0+ | 包管理器（随 Node.js 安装） |
| MySQL | v8.0+ | 关系型数据库 |

推荐使用 [nvm-windows](https://github.com/coreybutler/nvm-windows) 管理 Node.js 版本，使用 [MySQL Community Server](https://dev.mysql.com/downloads/mysql/) 或 [XAMPP](https://www.apachefriends.org/) 安装 MySQL。

## 快速开始（在另一台电脑上运行）

### 第一步：克隆项目

```bash
git clone <项目仓库地址>
cd DisciMind
```

### 第二步：安装依赖

```bash
# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install

# 回到项目根目录
cd ..
```

### 第三步：配置 MySQL 数据库

1. 确保 MySQL 服务已启动
2. 登录 MySQL 并创建数据库：

```sql
CREATE DATABASE discimind CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 第四步：配置环境变量

**后端环境变量（`backend/.env`）：**

在 `backend/` 目录下创建 `.env` 文件，参考 `backend/.env.example`（如该文件不存在，可参考项目根目录的 `.env.example`）：

```env
# 数据库连接（请修改为你的 MySQL 用户名和密码）
DATABASE_URL="mysql://你的MySQL用户名:你的MySQL密码@localhost:3306/discimind"

# JWT 密钥（请修改为随机字符串）
JWT_SECRET="请修改为随机字符串"
JWT_EXPIRES_IN=7d

# 服务端口
PORT=3000
```

**前端环境变量（`frontend/.env`）：**

在 `frontend/` 目录下创建 `.env` 文件（通常情况下使用默认值即可）：

```env
VITE_API_BASE_URL=http://localhost:3000/api
```

### 第五步：初始化数据库（执行 Prisma 迁移）

```bash
cd backend

# 生成 Prisma 客户端
npx prisma generate

# 执行数据库迁移（创建所有表）
npx prisma migrate dev --name init

# （可选）导入种子数据（演示账号和测试数据）
node prisma/seed.js
```

### 第六步：启动项目

**启动后端**（新开一个终端）：

```bash
cd backend
npm run dev
```

后端启动成功后会显示：
```
[db] 数据库连接成功
DisciMind backend server is running at http://localhost:3000
```

**启动前端**（新开另一个终端）：

```bash
cd frontend
npm run dev
```

前端启动成功后会显示 Vite 开发服务器地址，通常是：
```
VITE v8.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

### 第七步：访问项目

在浏览器中打开 **http://localhost:5173** 即可访问 DisciMind 平台。

如果导入了种子数据，可以使用以下演示账号登录：

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 学生 | student_demo | 123456 |
| 教师 | teacher_demo | 123456 |
| 管理员 | admin_demo | 123456 |

## 接口前缀说明

所有后端 API 接口统一使用 `/api` 前缀，例如：

```
GET  http://localhost:3000/api/health           # 健康检查
POST http://localhost:3000/api/auth/register    # 注册
POST http://localhost:3000/api/auth/login       # 登录
GET  http://localhost:3000/api/student/dashboard # 学生仪表盘
```

前端通过 Vite 代理将 `/api` 请求转发到后端，开发时无需手动配置跨域。

## 响应格式

所有接口返回统一格式：

```json
{
  "code": 200,
  "message": "ok",
  "data": {}
}
```

- `code`: 状态码（200 成功，4xx 客户端错误，5xx 服务端错误）
- `message`: 提示信息
- `data`: 返回数据（错误时为 null）

## 常用命令

```bash
# === 后端 ===
cd backend
npm run dev              # 开发模式启动（nodemon 热重载）
npm run start            # 生产模式启动
npx prisma generate      # 生成 Prisma 客户端
npx prisma migrate dev   # 执行数据库迁移
npx prisma db seed       # 导入种子数据
npx prisma studio        # 打开 Prisma 数据库管理界面

# === 前端 ===
cd frontend
npm run dev              # 开发模式启动
npm run build            # 生产构建
npm run preview          # 预览生产构建
```

## 文档

| 文档 | 说明 |
|------|------|
| [docs/运行说明.md](docs/运行说明.md) | 详细运行指南（含常见问题） |
| [docs/接口说明.md](docs/接口说明.md) | API 接口概览 |
| [docs/DisciMind API 接口文档 v1.0.md](docs/DisciMind%20API%20接口文档%20v1.0.md) | 完整 API 接口文档 |
| [docs/02-development-rules.md](docs/02-development-rules.md) | 开发规范 |
| [docs/05-ai-agent-design.md](docs/05-ai-agent-design.md) | AI 与 Agent 设计 |

## 开发分支说明

- `main`：稳定版本分支
- `dev`：日常开发分支

开发新功能时请基于 `dev` 分支创建 feature 分支。

## 项目团队

DisciMind（学研智擎）是一个学生团队项目，适用于课程项目、竞赛展示和教学场景。

## 许可证

本项目仅供学习和研究使用。
