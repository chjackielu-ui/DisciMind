# 教师端文件 — Git 协作分类清单

> 本文档按 Git 协作要求对教师端相关文件进行分类，
> 帮助开发者理解哪些文件可独立修改、哪些为共享文件需协调。

---

## 一、文件分类总表

### 1. 教师端后端（独立文件，不会冲突）

```
backend/src/routes/
  ├── teacher-dashboard.routes.js      # 看板 + 学情分析
  ├── teacher-course.routes.js          # 课程/班级/章节/知识点
  ├── teacher-student.routes.js         # 学生管理
  ├── teacher-task.routes.js            # 任务/提交
  ├── teacher-question.routes.js        # 题库
  ├── teacher-knowledge.routes.js       # 知识库
  ├── teacher-notification.routes.js    # 消息通知
  └── teacher-ai.routes.js             # AI 占位

backend/src/controllers/
  ├── teacher-dashboard.controller.js
  ├── teacher-course.controller.js
  ├── teacher-student.controller.js
  ├── teacher-task.controller.js
  ├── teacher-question.controller.js
  ├── teacher-knowledge.controller.js
  ├── teacher-notification.controller.js
  ├── teacher-practice.controller.js
  └── teacher-ai.controller.js

backend/src/services/
  ├── teacher-dashboard.service.js
  ├── teacher-course.service.js
  ├── teacher-student.service.js
  ├── teacher-task.service.js
  ├── teacher-question.service.js
  ├── teacher-knowledge.service.js
  ├── teacher-notification.service.js
  ├── teacher-practice.service.js
```

### 2. 教师端前端（独立文件，不会冲突）

```
frontend/src/api/teacher.js             # 教师端 API 封装

frontend/src/pages/
  ├── teacher-dashboard.js
  ├── teacher-courses.js
  ├── teacher-course-detail.js
  ├── teacher-students.js
  ├── teacher-student-detail.js
  ├── teacher-tasks.js
  ├── teacher-task-create.js
  ├── teacher-task-detail.js
  ├── teacher-questions.js
  ├── teacher-question-create.js
  ├── teacher-knowledge.js
  ├── teacher-analytics.js
  └── teacher-profile.js
```

### 3. 共享文件（修改需在指定区域）

| 文件 | 修改限制 |
|:-----|:---------|
| `backend/src/app.js` | 仅在「教师端路由」注释区域追加 |
| `frontend/src/utils/router.js` | 仅在「教师端路由」注释区域追加 |
| `frontend/src/main.js` | 仅在末尾追加 import |
| `frontend/src/utils/dashboard.js` | 仅在 `user.role` 判断处添加 class |
| `frontend/src/api/request.js` | 已添加 params 序列化，不再修改 |

### 4. 通用工具 / 样式

| 文件 | 说明 |
|:-----|:------|
| `frontend/src/utils/auto-resize.js` | 自适应文本域，挂 `.role-teacher` 作用域 |
| `frontend/src/styles/theme.css` | 教师端暖色主题，`.role-teacher` 隔离 |

### 5. 数据库（改前需通知）

```
backend/prisma/schema.prisma           # 新增表/字段需两人协调
```

---

## 二、Git 协作指引

### 分支策略

```
main ─────────────────────────── 稳定版本
  └── dev ────────────────────── 日常开发
        └── feature/teacher-xxx  教师端功能分支
```

### 提交信息规范

| 前缀 | 示例 |
|:-----|:------|
| `feat:` | `feat(teacher): 添加学生手动创建` |
| `fix:` | `fix(teacher): 修复 Prisma 字段名` |
| `style:` | `style(teacher): 统一暖色调配色` |
| `docs:` | `docs(teacher): 补充接口说明` |
| `refactor:` | `refactor(teacher): 抽取通用方法` |

### 合并注意事项

1. 先提交再合并：`git add` → `git commit` → `git pull origin dev`
2. 共享文件冲突通常只在末尾追加内容，选"保留双方修改"
3. **禁止 `git push --force`**

---

## 三、.gitignore 内容（当前已生效）

```
# dependencies
node_modules/
frontend/node_modules/
backend/node_modules/

# environment
.env
.env.local
.env.development
.env.production
.env.staging
frontend/.env
backend/.env

# logs
logs/*
*.log

# build
dist/
frontend/dist/
build/

# upload files
storage/uploads/*
storage/parsed/*
storage/temp/*
!storage/uploads/.gitkeep

# database
backend/prisma/dev.db
backend/prisma/dev.db-journal

# OS system files
.DS_Store
Thumbs.db
Desktop.ini
*.swp
*.swo
*~
*.bak

# editor
.vscode/
.idea/
*.sublime-project

# cache
.cache/
.temp/

# local AI rules
CLAUDE.local.md

# generated docs
docs/CLAUDE_CODE_DATABASE_PROMPT.md
```

> **注意**：`backend/prisma/migrations/` **不忽略**，需随代码提交。
