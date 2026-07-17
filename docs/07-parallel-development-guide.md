# 并行开发守则 — 教师端 & 管理端

> 适用时期：两人同时开发教师端和管理端功能
> 目标：最小化 Git 冲突，确保各自独立开发，合并时顺畅

---

## 一、核心原则

1. **每人只改自己的文件** — 教师端开发者只动 `teacher` 相关文件，管理端开发者只动 `admin` 相关文件
2. **共享文件按规则修改** — 必须修改共享文件时，严格在指定区域内添加代码
3. **改前拉取，改后沟通** — 修改共享文件前先 `git pull`，改完后在群内告知
4. **不要重构公共代码** — 不要因为"觉得可以优化"而去改对方的代码或公共工具函数

---

## 二、文件修改权限表

### 前端文件

| 文件路径 | 教师端 | 管理端 | 备注 |
|---|---|---|---|
| `frontend/src/pages/teacher-*.js` | ✅ 自由修改 | ❌ 禁止 | 教师端页面 |
| `frontend/src/pages/admin-*.js` | ❌ 禁止 | ✅ 自由修改 | 管理端页面 |
| `frontend/src/pages/login.js` | ❌ 禁止 | ❌ 禁止 | 公共页面，除非明确要求 |
| `frontend/src/pages/register.js` | ❌ 禁止 | ❌ 禁止 | 公共页面，除非明确要求 |
| `frontend/src/pages/student-*.js` | ❌ 禁止 | ❌ 禁止 | 学生端页面，已完成 |
| `frontend/src/utils/router.js` | ⚠️ 指定区域 | ⚠️ 指定区域 | 见下方规则 |
| `frontend/src/main.js` | ⚠️ 指定区域 | ⚠️ 指定区域 | 见下方规则 |
| `frontend/src/utils/dashboard.js` | ❌ 禁止 | ❌ 禁止 | 公共布局，除非明确需要 |
| `frontend/src/utils/auth.js` | ❌ 禁止 | ❌ 禁止 | 认证工具，已稳定 |
| `frontend/src/utils/icons.js` | ⚠️ 如需新图标 | ⚠️ 如需新图标 | 仅在文件末尾追加 |
| `frontend/src/utils/toast.js` | ❌ 禁止 | ❌ 禁止 | 已稳定 |
| `frontend/src/utils/echarts.js` | ❌ 禁止 | ❌ 禁止 | 已稳定 |
| `frontend/src/api/request.js` | ❌ 禁止 | ❌ 禁止 | HTTP 封装，已稳定 |
| `frontend/src/api/auth.js` | ❌ 禁止 | ❌ 禁止 | 认证 API，已稳定 |
| `frontend/src/api/student.js` | ❌ 禁止 | ❌ 禁止 | 学生端 API |
| `frontend/src/styles/global.css` | ⚠️ 仅追加末尾 | ⚠️ 仅追加末尾 | 不要修改已有样式 |
| `frontend/src/styles/dashboard.css` | ⚠️ 仅追加末尾 | ⚠️ 仅追加末尾 | 不要修改已有样式 |
| `frontend/src/styles/login.css` | ❌ 禁止 | ❌ 禁止 | 登录页样式，已稳定 |
| `frontend/src/styles/student.css` | ❌ 禁止 | ❌ 禁止 | 学生端样式 |
| `frontend/src/styles/student-complex.css` | ❌ 禁止 | ❌ 禁止 | 学生端样式 |
| `frontend/src/components/practice/*.js` | ❌ 禁止 | ❌ 禁止 | 练习组件，学生端使用 |
| `frontend/src/pages/agent/*.js` | ❌ 禁止 | ❌ 禁止 | 预留模块，暂不开发 |
| `frontend/src/pages/ai/*.js` | ❌ 禁止 | ❌ 禁止 | 预留模块，暂不开发 |
| `frontend/src/modules/**/*.js` | ❌ 禁止 | ❌ 禁止 | 预留模块，暂不开发 |

### 后端文件

| 文件路径 | 教师端 | 管理端 | 备注 |
|---|---|---|---|
| `backend/src/routes/teacher-*.routes.js` | ✅ 自由修改 | ❌ 禁止 | 教师端路由 |
| `backend/src/controllers/teacher-*.controller.js` | ✅ 自由修改 | ❌ 禁止 | 教师端控制器 |
| `backend/src/services/teacher-*.service.js` | ✅ 自由修改 | ❌ 禁止 | 教师端服务层 |
| `backend/src/routes/admin*.routes.js` | ❌ 禁止 | ✅ 自由修改 | 管理端路由 |
| `backend/src/controllers/admin*.controller.js` | ❌ 禁止 | ✅ 自由修改 | 管理端控制器 |
| `backend/src/services/admin*.service.js` | ❌ 禁止 | ✅ 自由修改 | 管理端服务层 |
| `backend/src/app.js` | ⚠️ 指定区域 | ⚠️ 指定区域 | 见下方规则 |
| `backend/src/routes/auth.routes.js` | ❌ 禁止 | ❌ 禁止 | 认证路由，已稳定 |
| `backend/src/controllers/auth.controller.js` | ❌ 禁止 | ❌ 禁止 | 认证控制器，已稳定 |
| `backend/src/services/auth.service.js` | ❌ 禁止 | ❌ 禁止 | 认证服务，已稳定 |
| `backend/src/routes/student*.routes.js` | ❌ 禁止 | ❌ 禁止 | 学生端路由 |
| `backend/src/controllers/student*.controller.js` | ❌ 禁止 | ❌ 禁止 | 学生端控制器 |
| `backend/src/services/student*.service.js` | ❌ 禁止 | ❌ 禁止 | 学生端服务层 |
| `backend/src/routes/practice.routes.js` | ❌ 禁止 | ❌ 禁止 | 练习路由，学生端 |
| `backend/src/routes/ai-chat.routes.js` | ❌ 禁止 | ❌ 禁止 | AI 对话路由，学生端 |
| `backend/src/middlewares/auth.middleware.js` | ❌ 禁止 | ❌ 禁止 | JWT 中间件，已稳定 |
| `backend/src/middlewares/role.middleware.js` | ❌ 禁止 | ❌ 禁止 | 角色中间件，已稳定 |
| `backend/src/middlewares/error.middleware.js` | ❌ 禁止 | ❌ 禁止 | 错误处理，已稳定 |
| `backend/src/utils/jwt.js` | ❌ 禁止 | ❌ 禁止 | JWT 工具，已稳定 |
| `backend/src/utils/response.js` | ❌ 禁止 | ❌ 禁止 | 响应格式，已稳定 |
| `backend/src/config/prisma.js` | ❌ 禁止 | ❌ 禁止 | Prisma 客户端 |
| `backend/prisma/schema.prisma` | ⚠️ 需协调 | ⚠️ 需协调 | 见下方规则 |
| `backend/src/modules/**/*.js` | ❌ 禁止 | ❌ 禁止 | 预留模块，暂不涉及 |
| `backend/src/prompts/**/*.md` | ❌ 禁止 | ❌ 禁止 | Prompt 模板，暂不涉及 |

---

## 三、共享文件修改规则

### 规则 1：`frontend/src/utils/router.js` — 路由注册

**两人都需要在这里添加自己的路由。** 为避免冲突，按以下方式操作：

文件中有明确的区域标记（建议在开发前由一个人先在文件中添加注释分隔线）：

```js
// ========================
// 路由表定义
// ========================

// ---- 公共路由 ----
const staticRoutes = {
  '/login': { ... },
  '/register': { ... },
  // ... 已有路由
}

// ---- 教师端路由（教师端开发者在此区域添加）----
// '/teacher/xxx': { ... }

// ---- 管理端路由（管理端开发者在此区域添加）----
// '/admin/xxx': { ... }
```

**实际操作规则：**
- 教师端开发者：在静态路由对象中，将自己的路由追加在教师端注释区域
- 管理端开发者：在静态路由对象中，将自己的路由追加在管理端注释区域
- import 语句：各自在文件顶部追加自己的 import，加在已有 import 后面即可
- 动态路由：分别追加在 dynamicRoutes 数组中，用注释标明归属

### 规则 2：`backend/src/app.js` — 路由挂载

**两人都需要在这里挂载新的路由模块。** 操作规则：

文件中已有注释分隔线，按以下区域添加：

```js
// ---------- 教师端路由 ----------
// （教师端开发者在此区域添加）

// ---------- 管理端路由 ----------
// （管理端开发者在此区域添加）
```

**实际操作规则：**
- 教师端开发者：在"教师端路由"注释下方添加 `app.use('/api/teacher', xxxRoutes)`
- 管理端开发者：在"管理端路由"注释下方添加 `app.use('/api/admin', xxxRoutes)`
- 各自只在自己的区域内添加代码

### 规则 3：`backend/prisma/schema.prisma` — 数据库表结构

**最危险的文件！应尽量避免同时修改。**

**操作规则：**
1. 如果需要新增 model 或 enum：先在一个人的分支上完成并合并，另一个人再 `git pull` 后继续
2. 如果两人都必须改：
   - 教师端新增的 model/enum 放在文件末尾，加上 `// Teacher module` 注释
   - 管理端新增的 model/enum 放在文件末尾，加上 `// Admin module` 注释
3. 绝对不要修改已有的 model 字段，只能新增 model 或在已有 model 末尾追加字段
4. 改之前务必在群里说一声："我要改 schema 了，加一个 XXX 表"

**强烈建议：数据库变更由一个人统一负责，或者分阶段进行。**

### 规则 4：CSS 文件 — `global.css` / `dashboard.css`

**操作规则：**
- 绝对不要修改已有的 CSS 规则
- 如需新增样式：在文件末尾添加，用注释标明归属
  ```css
  /* ===== 教师端新增样式 (by XXX) ===== */
  .teacher-xxx { ... }
  ```
- 各自角色的页面样式建议写在各自的页面 JS 文件内的 `<style>` 标签中（内联样式），而非全局 CSS 文件

### 规则 5：`frontend/src/main.js`

**操作规则：**
- 如需引入新的全局 CSS：在已有的 import 列表末尾追加，用注释标明归属
  ```js
  // 教师端样式
  import './styles/teacher.css'
  ```

---

## 四、前端 API 封装规则

每个人在自己的页面文件中直接使用 `request.js` 提供的基础方法：

```js
import { get, post, put, del } from '../api/request.js'

// 教师端 API 调用示例
const data = await get('/teacher/courses')

// 管理端 API 调用示例
const data = await get('/admin/users')
```

**如果需要封装多个 API 方法**，可以创建专属的 API 文件（不会冲突）：

- 教师端：`frontend/src/api/teacher.js`
- 管理端：`frontend/src/api/admin.js`

---

## 五、后端开发规范

### 文件命名规范（强制）

| 层级 | 教师端命名 | 管理端命名 |
|---|---|---|
| 路由 | `backend/src/routes/teacher-{功能}.routes.js` | `backend/src/routes/admin-{功能}.routes.js` |
| 控制器 | `backend/src/controllers/teacher-{功能}.controller.js` | `backend/src/controllers/admin-{功能}.controller.js` |
| 服务层 | `backend/src/services/teacher-{功能}.service.js` | `backend/src/services/admin-{功能}.service.js` |

### 接口前缀规范（强制）

- 教师端：`/api/teacher/{功能}`  例如：`GET /api/teacher/courses`
- 管理端：`/api/admin/{功能}`  例如：`GET /api/admin/users`

**绝对不要混用前缀！** 管理端不要注册 `/api/teacher/...`，教师端不要注册 `/api/admin/...`。

### 通用 API 前缀（如需使用）

如果某个接口教师和管理员都需要调用（如获取用户列表），由**管理端开发者**负责创建路由，放在 `/api/admin/` 前缀下，教师端通过相同接口调用即可。

---

## 六、Git 操作规范

### 分支策略

```
main ───────────────────────────────────────────── (主分支，稳定版本)
  └── dev ──────────────────────────────────────── (开发分支，当前)
        ├── feature/teacher-{功能名} ───────────── (教师端功能分支)
        └── feature/admin-{功能名} ─────────────── (管理端功能分支)
```

### 操作流程

1. **每天开始工作前**：
   ```bash
   git checkout dev
   git pull origin dev
   ```

2. **在自己的功能分支上开发**：
   ```bash
   git checkout -b feature/teacher-xxx
   # 或
   git checkout -b feature/admin-xxx
   ```

3. **修改共享文件前**：
   - 在群里说一声 "我要改 router.js 了" 或 "我要改 app.js 了"
   - 改完后尽快提交推送，让另一个人可以拉取

4. **合并回 dev 的顺序**：
   - 先完成的人先合并
   - 后完成的人先 `git pull origin dev` 获取最新代码，解决冲突后再合并
   - **不要用 `git push --force`**

5. **遇到冲突时**：
   - 不要自己猜怎么解决
   - 截图发群里，两个人一起看
   - 共享文件的冲突通常很简单（都是在末尾添加内容），选择"保留双方修改"即可

---

## 七、开发前准备（一次性操作，建议由一个人完成）

为了避免后续每天都冲突，建议在开始并行开发前，**由一个人在 `dev` 分支上先做好以下标记**，然后两人都 pull 下来：

### 1. 在 `frontend/src/utils/router.js` 中添加区域标记

```js
// ========== 教师端导入区域 ==========

// ========== 管理端导入区域 ==========
```

并在静态路由对象中添加：
```js
  // ========== 教师端路由 ==========

  // ========== 管理端路由 ==========
```

### 2. 在 `backend/src/app.js` 中添加区域标记

```js
// ---------- 教师端路由 ----------

// ---------- 管理端路由 ----------
```

### 3. 创建空的 API 封装文件

- `frontend/src/api/teacher.js`（教师端 API）
- `frontend/src/api/admin.js`（管理端 API）

---

## 八、快速检查清单

每个人在提交代码前，自问：

- [ ] 我是否修改了对方的文件？（如果是，立刻回退）
- [ ] 我是否修改了学生端的文件？（如果是，立刻回退）
- [ ] 我修改共享文件时，是否只在指定区域内添加？（如果不是，调整）
- [ ] 我的后端路由前缀是否正确？（teacher 用 `/api/teacher`，admin 用 `/api/admin`）
- [ ] 我是否改了 `schema.prisma`？如果是，是否和对方沟通过？
- [ ] 我有没有改全局 CSS 中已有的样式？（如果有，回退）
- [ ] 提交前有没有 `git pull origin dev`？

---

## 九、遇到问题怎么办

| 问题 | 处理方式 |
|---|---|
| 不确定某个文件能不能改 | 先问对方，不要直接改 |
| 需要修改共享文件但另一个人刚改过 | 等对方推送后 pull 下来再改 |
| 合并时出现冲突 | 截图发群里，一起看 |
| 需要新增数据库表 | 通知对方，协调先后顺序 |
| 需要修改已有公共组件的逻辑 | 在群里讨论，由一个人统一改 |
