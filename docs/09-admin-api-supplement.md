# 管理员端接口补充文档

> 本文档补充 `docs/DisciMind API 接口文档 v1.0.md` 中未明确定义的管理员端接口。
> 新增接口遵循 RESTful 风格，统一使用 `/api/admin` 前缀。

---

## 通用说明

- **权限**：所有接口均需要 `admin` 角色
- **认证**：所有接口均需携带 `Authorization: Bearer <token>`
- **响应格式**：统一返回 `{ code: 0, message: "success", data: {...} }`
- **分页格式**：`{ list: [...], total: number, page: number, page_size: number }`

---

## 1. 管理员仪表盘

### 1.1 系统总览

```
GET /api/admin/dashboard
```

**权限**：admin

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "user_count": 120,
    "student_count": 100,
    "teacher_count": 15,
    "course_count": 6,
    "knowledge_document_count": 80,
    "ai_call_count_today": 500,
    "pending_review_document_count": 8
  }
}
```

---

## 2. 用户管理

### 2.1 获取用户列表

```
GET /api/admin/users
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 否 | 搜索用户名、姓名、学号、邮箱 |
| role | string | 否 | admin / teacher / student |
| status | string | 否 | active / disabled |
| page | number | 否 | 页码，默认 1 |
| page_size | number | 否 | 每页数量，默认 10，最大 100 |

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [
      {
        "user_id": 1,
        "username": "student001",
        "role": "student",
        "real_name": "张三",
        "student_no": "2403001",
        "college": "计算机与软件工程学院",
        "major": "软件工程",
        "grade": "2024",
        "email": "student001@example.com",
        "phone": "13800000000",
        "status": "active",
        "last_login_at": "2026-07-01T10:00:00.000Z",
        "created_at": "2026-06-30T10:00:00.000Z"
      }
    ],
    "total": 100,
    "page": 1,
    "page_size": 10
  }
}
```

### 2.2 修改用户状态

```
PUT /api/admin/users/:user_id/status
```

**请求参数**：

```json
{
  "status": "disabled"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 是 | active / disabled |

### 2.3 重置用户密码

```
PUT /api/admin/users/:user_id/password
```

**请求参数**：

```json
{
  "new_password": "123456"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| new_password | string | 是 | 新密码（最少 6 位） |

### 2.4 删除用户

```
DELETE /api/admin/users/:user_id
```

**说明**：软删除，将用户状态改为 `disabled`。仅允许删除 student 角色用户。

---

## 3. 课程管理

### 3.1 获取课程列表

```
GET /api/admin/courses
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 否 | 搜索课程名称、课程编码 |
| subject_category | string | 否 | 学科分类 |
| status | string | 否 | active / archived |
| page | number | 否 | 页码，默认 1 |
| page_size | number | 否 | 每页数量，默认 10 |

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [
      {
        "course_id": 1,
        "course_name": "机器学习",
        "course_code": "ML001",
        "subject_category": "计算机大类学科",
        "description": "以机器学习课程为样板课程",
        "cover_url": "/uploads/course/ml.png",
        "status": "active",
        "teacher_count": 2,
        "chapter_count": 8,
        "student_count": 45,
        "created_at": "2026-06-30T10:00:00.000Z"
      }
    ],
    "total": 6,
    "page": 1,
    "page_size": 10
  }
}
```

### 3.2 创建课程

```
POST /api/admin/courses
```

**请求参数**：

```json
{
  "course_name": "机器学习",
  "course_code": "ML001",
  "subject_category": "计算机大类学科",
  "description": "课程说明",
  "cover_url": "/uploads/course/ml.png",
  "status": "active"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| course_name | string | 是 | 课程名称 |
| course_code | string | 是 | 课程编码（唯一） |
| subject_category | string | 是 | 学科分类 |
| description | string | 否 | 课程说明 |
| cover_url | string | 否 | 封面图片地址 |
| status | string | 否 | 默认 active |

### 3.3 获取课程详情

```
GET /api/admin/courses/:course_id
```

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "course_id": 1,
    "course_name": "机器学习",
    "course_code": "ML001",
    "subject_category": "计算机大类学科",
    "description": "机器学习样板课程",
    "cover_url": "/uploads/course/ml.png",
    "status": "active",
    "created_at": "2026-06-30T10:00:00.000Z",
    "teachers": [
      {
        "user_id": 2,
        "real_name": "李老师",
        "teacher_role": "main_teacher"
      }
    ],
    "teaching_classes": [
      {
        "teaching_class_id": 1,
        "teaching_class_name": "机器学习1班",
        "semester": "2026春季学期",
        "student_count": 45
      }
    ]
  }
}
```

### 3.4 更新课程

```
PUT /api/admin/courses/:course_id
```

**请求参数**（同创建课程，所有字段可选）：

```json
{
  "course_name": "机器学习（更新）",
  "description": "更新后的课程说明",
  "status": "active"
}
```

### 3.5 删除课程

```
DELETE /api/admin/courses/:course_id
```

**说明**：将课程状态设为 `archived`，不物理删除。已归档课程不再显示在活跃课程列表中。

### 3.6 绑定课程教师

```
POST /api/admin/courses/:course_id/teachers
```

**请求参数**：

```json
{
  "teacher_user_id": 2,
  "teacher_role": "main_teacher"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| teacher_user_id | number | 是 | 教师用户 ID |
| teacher_role | string | 是 | main_teacher / assistant / manager |

### 3.7 解绑课程教师

```
DELETE /api/admin/courses/:course_id/teachers/:teacher_user_id
```

---

## 4. 章节管理

### 4.1 获取章节列表

```
GET /api/admin/courses/:course_id/chapters
```

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "chapter_id": 1,
      "course_id": 1,
      "chapter_name": "第1章 机器学习导论",
      "chapter_order": 1,
      "description": "介绍机器学习基本概念",
      "knowledge_point_count": 3,
      "created_at": "2026-06-30T10:00:00.000Z"
    }
  ]
}
```

### 4.2 创建章节

```
POST /api/admin/courses/:course_id/chapters
```

**请求参数**：

```json
{
  "chapter_name": "第1章 机器学习导论",
  "chapter_order": 1,
  "description": "介绍机器学习基本概念、任务类型和应用场景。"
}
```

### 4.3 更新章节

```
PUT /api/admin/chapters/:chapter_id
```

**请求参数**（同创建，所有字段可选）：

```json
{
  "chapter_name": "更新后的章节名",
  "chapter_order": 2
}
```

### 4.4 删除章节

```
DELETE /api/admin/chapters/:chapter_id
```

---

## 5. 知识点管理

### 5.1 获取知识点列表

```
GET /api/admin/courses/:course_id/knowledge-points
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapter_id | number | 否 | 按章节筛选 |

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "knowledge_point_id": 1,
      "course_id": 1,
      "chapter_id": 1,
      "knowledge_point_name": "监督学习",
      "knowledge_point_code": "ML-KP-001",
      "description": "通过带标签数据训练模型",
      "difficulty_level": "basic",
      "sort_order": 1,
      "parent_id": null,
      "aliases": ["有监督学习", "supervised learning"],
      "created_at": "2026-06-30T10:00:00.000Z"
    }
  ]
}
```

### 5.2 创建知识点

```
POST /api/admin/knowledge-points
```

**请求参数**：

```json
{
  "course_id": 1,
  "chapter_id": 1,
  "knowledge_point_name": "监督学习",
  "knowledge_point_code": "ML-KP-001",
  "description": "通过带标签数据训练模型",
  "difficulty_level": "basic",
  "parent_id": null,
  "aliases": ["有监督学习", "supervised learning"]
}
```

### 5.3 更新知识点

```
PUT /api/admin/knowledge-points/:knowledge_point_id
```

### 5.4 删除知识点

```
DELETE /api/admin/knowledge-points/:knowledge_point_id
```

---

## 6. 教学班级管理

### 6.1 获取课程的教学班列表

```
GET /api/admin/courses/:course_id/teaching-classes
```

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "teaching_class_id": 1,
      "course_id": 1,
      "teaching_class_name": "机器学习1班",
      "semester": "2026春季学期",
      "description": "软件工程专业机器学习教学班",
      "student_count": 45,
      "created_at": "2026-06-30T10:00:00.000Z"
    }
  ]
}
```

### 6.2 创建教学班级

```
POST /api/admin/courses/:course_id/teaching-classes
```

**请求参数**：

```json
{
  "teaching_class_name": "机器学习1班",
  "semester": "2026春季学期",
  "description": "软件工程专业机器学习教学班"
}
```

### 6.3 更新教学班级

```
PUT /api/admin/teaching-classes/:teaching_class_id
```

### 6.4 删除教学班级

```
DELETE /api/admin/teaching-classes/:teaching_class_id
```

### 6.5 获取教学班学生列表

```
GET /api/admin/teaching-classes/:teaching_class_id/students
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 否 | 搜索学生姓名、学号 |
| page | number | 否 | 页码 |
| page_size | number | 否 | 每页数量 |

### 6.6 添加学生到教学班

```
POST /api/admin/teaching-classes/:teaching_class_id/students
```

**请求参数**：

```json
{
  "student_user_ids": [1, 3, 4]
}
```

### 6.7 从教学班移除学生

```
DELETE /api/admin/teaching-classes/:teaching_class_id/students/:student_user_id
```

---

## 7. 行政班级管理

### 7.1 获取行政班级列表

```
GET /api/admin/admin-classes
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 否 | 搜索班级名称 |
| college | string | 否 | 学院筛选 |
| grade | string | 否 | 年级筛选 |

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "admin_class_id": 1,
      "class_name": "软件2403班",
      "college": "计算机与软件工程学院",
      "major": "软件工程",
      "grade": "2024",
      "student_count": 35,
      "created_at": "2026-06-30T10:00:00.000Z"
    }
  ]
}
```

### 7.2 创建行政班级

```
POST /api/admin/admin-classes
```

**请求参数**：

```json
{
  "class_name": "软件2403班",
  "college": "计算机与软件工程学院",
  "major": "软件工程",
  "grade": "2024"
}
```

### 7.3 更新行政班级

```
PUT /api/admin/admin-classes/:admin_class_id
```

### 7.4 删除行政班级

```
DELETE /api/admin/admin-classes/:admin_class_id
```

---

## 8. 知识库管理

### 8.1 获取知识库文档列表

```
GET /api/admin/knowledge-documents
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| scope_type | string | 否 | platform / course / class / personal |
| course_id | number | 否 | 课程 ID |
| parse_status | string | 否 | 解析状态 |
| review_status | string | 否 | pending / approved / rejected |
| keyword | string | 否 | 搜索文档标题 |
| page | number | 否 | 页码 |
| page_size | number | 否 | 每页数量 |

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [
      {
        "document_id": 1,
        "title": "机器学习导论.pdf",
        "original_filename": "ml_intro.pdf",
        "file_ext": ".pdf",
        "file_size_bytes": 2048000,
        "scope_type": "course",
        "course_id": 1,
        "course_name": "机器学习",
        "owner_name": "张三",
        "parse_status": "embedded",
        "review_status": "pending",
        "created_at": "2026-07-01T10:00:00.000Z"
      }
    ],
    "total": 80,
    "page": 1,
    "page_size": 10
  }
}
```

### 8.2 审核文档

```
PUT /api/admin/knowledge-documents/:document_id/review
```

**请求参数**：

```json
{
  "review_status": "approved",
  "review_comment": "资料内容符合课程要求"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| review_status | string | 是 | approved / rejected |
| review_comment | string | 否 | 审核意见 |

---

## 9. 操作日志管理

### 9.1 获取操作日志列表

```
GET /api/admin/operation-logs
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| operation_type | string | 否 | 操作类型筛选 |
| user_id | number | 否 | 用户 ID |
| target_type | string | 否 | 目标类型 |
| start_date | string | 否 | 开始日期 |
| end_date | string | 否 | 结束日期 |
| page | number | 否 | 页码 |
| page_size | number | 否 | 每页数量 |

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [
      {
        "operation_log_id": 1,
        "user_id": 2,
        "username": "teacher_demo",
        "role": "teacher",
        "operation_type": "task_create",
        "operation_desc": "教师发布作业：PCA 基础练习",
        "target_type": "task",
        "target_id": 1,
        "ip_address": "127.0.0.1",
        "created_at": "2026-07-01T10:00:00.000Z"
      }
    ],
    "total": 500,
    "page": 1,
    "page_size": 10
  }
}
```

---

## 10. 通知管理

### 10.1 获取通知列表

```
GET /api/admin/notifications
```

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| notification_type | string | 否 | 通知类型筛选 |
| is_read | boolean | 否 | 是否已读 |
| receiver_user_id | number | 否 | 按接收者筛选 |
| page | number | 否 | 页码 |
| page_size | number | 否 | 每页数量 |

**响应示例**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [
      {
        "notification_id": 1,
        "receiver_user_id": 2,
        "receiver_name": "李老师",
        "sender_user_id": 1,
        "sender_name": "系统管理员",
        "notification_type": "system_notice",
        "title": "系统维护通知",
        "content": "系统将于今晚22:00-24:00进行维护",
        "is_read": false,
        "created_at": "2026-07-01T10:00:00.000Z"
      }
    ],
    "total": 20,
    "page": 1,
    "page_size": 10
  }
}
```

### 10.2 创建通知

```
POST /api/admin/notifications
```

**请求参数**：

```json
{
  "receiver_user_id": 2,
  "notification_type": "system_notice",
  "title": "系统维护通知",
  "content": "系统将于今晚22:00-24:00进行维护",
  "target_type": null,
  "target_id": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| receiver_user_id | number | 是 | 接收者用户 ID（0 表示全体发送） |
| notification_type | string | 是 | task_published / task_deadline / document_review / document_parsed / ai_grading_done / system_notice |
| title | string | 是 | 通知标题 |
| content | string | 否 | 通知内容 |
| target_type | string | 否 | 关联目标类型 |
| target_id | number | 否 | 关联目标 ID |

### 10.3 标记通知已读

```
PUT /api/admin/notifications/:notification_id/read
```

### 10.4 批量标记已读

```
PUT /api/admin/notifications/read-all
```

**请求参数**：

```json
{
  "user_id": 2
}
```

---

## 11. AI 模型配置（占位 — 暂不实现）

### 11.1 获取 AI 模型配置列表

```
GET /api/admin/ai-model-configs
```

**当前返回**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [],
    "total": 0,
    "page": 1,
    "page_size": 10,
    "placeholder": true,
    "hint": "该功能正在开发中，敬请期待"
  }
}
```

### 11.2 创建 AI 模型配置

```
POST /api/admin/ai-model-configs
```

**当前返回**：

```json
{
  "code": 0,
  "message": "该功能正在开发中，敬请期待",
  "data": null
}
```

### 11.3 获取 AI 调用日志

```
GET /api/admin/ai-call-logs
```

**当前返回**：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [],
    "total": 0,
    "page": 1,
    "page_size": 10,
    "placeholder": true,
    "hint": "该功能正在开发中，敬请期待"
  }
}
```

---

## 附录：新增文件对应关系

| 路由 | 控制器方法 | 服务方法 |
|------|-----------|---------|
| GET /api/admin/dashboard | getDashboard | getDashboard |
| GET /api/admin/users | getUserList | getUserList |
| PUT /api/admin/users/:user_id/status | updateUserStatus | updateUserStatus |
| PUT /api/admin/users/:user_id/password | resetUserPassword | resetUserPassword |
| DELETE /api/admin/users/:user_id | deleteUser | deleteUser |
| GET /api/admin/courses | getCourseList | getCourseList |
| POST /api/admin/courses | createCourse | createCourse |
| GET /api/admin/courses/:course_id | getCourseDetail | getCourseDetail |
| PUT /api/admin/courses/:course_id | updateCourse | updateCourse |
| DELETE /api/admin/courses/:course_id | deleteCourse | deleteCourse |
| POST /api/admin/courses/:course_id/teachers | bindTeacher | bindTeacher |
| DELETE /api/admin/courses/:course_id/teachers/:teacher_user_id | unbindTeacher | unbindTeacher |
| GET /api/admin/courses/:course_id/chapters | getChapterList | getChapterList |
| POST /api/admin/courses/:course_id/chapters | createChapter | createChapter |
| PUT /api/admin/chapters/:chapter_id | updateChapter | updateChapter |
| DELETE /api/admin/chapters/:chapter_id | deleteChapter | deleteChapter |
| GET /api/admin/courses/:course_id/knowledge-points | getKnowledgePointList | getKnowledgePointList |
| POST /api/admin/knowledge-points | createKnowledgePoint | createKnowledgePoint |
| PUT /api/admin/knowledge-points/:knowledge_point_id | updateKnowledgePoint | updateKnowledgePoint |
| DELETE /api/admin/knowledge-points/:knowledge_point_id | deleteKnowledgePoint | deleteKnowledgePoint |
| GET /api/admin/courses/:course_id/teaching-classes | getTeachingClassList | getTeachingClassList |
| POST /api/admin/courses/:course_id/teaching-classes | createTeachingClass | createTeachingClass |
| PUT /api/admin/teaching-classes/:teaching_class_id | updateTeachingClass | updateTeachingClass |
| DELETE /api/admin/teaching-classes/:teaching_class_id | deleteTeachingClass | deleteTeachingClass |
| GET /api/admin/teaching-classes/:teaching_class_id/students | getClassStudentList | getClassStudentList |
| POST /api/admin/teaching-classes/:teaching_class_id/students | addClassStudents | addClassStudents |
| DELETE /api/admin/teaching-classes/:teaching_class_id/students/:student_user_id | removeClassStudent | removeClassStudent |
| GET /api/admin/admin-classes | getAdminClassList | getAdminClassList |
| POST /api/admin/admin-classes | createAdminClass | createAdminClass |
| PUT /api/admin/admin-classes/:admin_class_id | updateAdminClass | updateAdminClass |
| DELETE /api/admin/admin-classes/:admin_class_id | deleteAdminClass | deleteAdminClass |
| GET /api/admin/knowledge-documents | getDocumentList | getDocumentList |
| PUT /api/admin/knowledge-documents/:document_id/review | reviewDocument | reviewDocument |
| GET /api/admin/operation-logs | getOperationLogs | getOperationLogs |
| GET /api/admin/notifications | getNotificationList | getNotificationList |
| POST /api/admin/notifications | createNotification | createNotification |
| PUT /api/admin/notifications/:notification_id/read | markNotificationRead | markNotificationRead |
| PUT /api/admin/notifications/read-all | markAllNotificationsRead | markAllNotificationsRead |
| GET /api/admin/ai-model-configs | getAiModelConfigs | —（占位） |
| POST /api/admin/ai-model-configs | createAiModelConfig | —（占位） |
| GET /api/admin/ai-call-logs | getAiCallLogs | —（占位） |
