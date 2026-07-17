# 管理员更新用户资料接口

> 接口版本：v1.0
> 所属模块：管理员端 — 用户管理
> 更新日期：2026-07-06

---

## 1. 接口说明

管理员更新指定用户的个人资料，支持更新学生和教师的基本信息。

该接口适用于以下场景：
- 管理员修改学生信息（真实姓名、邮箱、手机号、学院、专业、学号）
- 管理员修改教师信息（真实姓名、邮箱、手机号、学院、专业）

---

## 2. 接口定义

| 项目 | 内容 |
|------|------|
| 方法 | `PUT` |
| 路径 | `/api/admin/users/:user_id` |
| 权限 | `admin` |
| 请求体 | `application/json` |

---

## 3. 请求参数

### 路径参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| user_id | integer | 是 | 目标用户的 ID |

### 请求体

```json
{
  "real_name": "张三",
  "email": "zhangsan@example.com",
  "phone": "13800000000",
  "college": "计算机与软件工程学院",
  "major": "软件工程",
  "student_no": "2403001",
  "gender": "male"
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| real_name | string | 否 | 真实姓名（传空字符串会清空）|
| email | string | 否 | 邮箱地址 |
| phone | string | 否 | 手机号 |
| college | string | 否 | 所属学院 |
| major | string | 否 | 专业 |
| student_no | string | 否 | 学号（仅学生角色有效）|
| gender | string | 否 | 性别：`male` / `female` / `unknown` |

> 注意：只传需要更新的字段即可，未传的字段保持不变。

---

## 4. 响应格式

### 成功响应

```json
{
  "code": 200,
  "message": "用户信息已更新",
  "data": {
    "user_id": 1
  }
}
```

### 错误响应

```json
{
  "code": 40002,
  "message": "用户不存在",
  "data": null
}
```

---

## 5. 错误码说明

| 错误码 | 含义 | 触发场景 |
|--------|------|---------|
| 40001 | 参数错误 | user_id 不合法 |
| 40002 | 用户不存在 | 指定的 user_id 在数据库中不存在 |
| 50001 | 服务器错误 | 数据库更新异常 |

---

## 6. 实现位置

| 层级 | 文件路径 | 说明 |
|------|---------|------|
| 前端 API 封装 | `frontend/src/api/admin.js` | `updateAdminUser(userId, data)` 函数 |
| 前端页面 | `frontend/src/pages/admin-users.js` | "编辑"按钮 → 编辑弹窗 → 保存逻辑 |
| 后端路由 | `backend/src/routes/admin.routes.js` | `PUT /users/:user_id` → `userController.updateUser` |
| 后端控制器 | `backend/src/controllers/admin-user.controller.js` | `updateUser` — 参数校验与调用 service |
| 后端服务 | `backend/src/services/admin-user.service.js` | `updateUser` — 更新 users 和 user_profiles 表 |

---

## 7. 数据更新范围

### users 表

| 字段 | 映射来源 |
|------|---------|
| `email` | `data.email` |
| `phone` | `data.phone` |

### user_profiles 表

| 字段 | 映射来源 |
|------|---------|
| `real_name` | `data.real_name` |
| `college` | `data.college` |
| `major` | `data.major` |
| `gender` | `data.gender`（经 `male→MALE` 枚举映射）|
| `student_no` | `data.student_no` |
| `teacher_no` | `data.teacher_no` |

---

## 8. 权限说明

- 仅 `admin` 角色可调用此接口
- 接口通过 `roleMiddleware(['admin'])` 进行角色校验
- 管理员可以更新任意学生和教师的资料
- 管理员不能通过此接口修改用户的角色（role）和状态（status）
