# DisciMind 跨端重构现状审计

更新时间：2026-07-15

## 工作区与运行基线

- 工作区包含上一阶段已验收的管理端修改，本轮保留全部现有改动，未执行 `reset`、`clean` 或 `restore`。
- Prisma 共 47 个迁移，当前数据库与迁移历史一致。
- 后端 3000、前端 5173 均已监听。
- 上一阶段基线：后端 450/450、前端生产构建通过、管理端浏览器 33/33。本报告只把它作为回归基线，不代表本轮功能已完成。

## 任务、消息与浮层挂载审计

1. 学生任务中心由 `frontend/src/utils/dashboard.js` 调用 `mountTaskCenter`，组件位于 `frontend/src/components/task-center.js`。
2. 学生消息浮窗由同一共享布局调用 `mountStudentNotificationCenter`，组件位于 `frontend/src/components/student-notification-center.js`。
3. 教师任务、消息和教师 AI 浮层统一由 `renderTeacherGlobalOverlays` / `mountTeacherGlobalOverlays` 挂载，但内部仍是教师专用实现。
4. 管理端没有独立任务中心挂载；共享浮层容器此前未在所有角色切换时统一销毁，因此从其他角色或路由切换后可能保留旧 DOM。
5. 重复入口：学生端同时存在任务岛和消息岛；教师端任务岛内部混合任务与消息，另有 AI 浮层；管理截图还出现了残留的浮动入口。
6. 学生未读数来自 `GET /api/notifications/unread-count`；教师旧入口来自 `/api/teacher/notifications/unread-count`；两者最终读取同一 `notifications` 表，但前端契约重复。
7. 异步任务来自 `/api/tasks`，数据模型是 `AsyncTask`；消息来自 `Notification`。两者语义不同，不应合表，适合由聚合服务转换为统一 Feed 契约。
8. 任务已有 `/api/tasks/stream` SSE；学生任务组件还具备可见性轮询；学生和教师消息旧实现均为 20 秒轮询。统一中心将复用任务数据并采用页面可见时 30 秒、面板打开时 15 秒的轻量轮询。
9. 学生 AI 学习助手由 `frontend/src/utils/dashboard.js` 直接渲染和初始化。教师另有 `teacher-ai-float`；教师浮层历史角色判断还接受 `admin`，共享容器又没有对所有角色进行一致清空，这是管理端出现错误浮层的根因组合。

## 课程文件链路审计

10. 可复用表为 `courses`、`teaching_classes`、`teaching_class_teacher_authorizations`、`student_course_enrollments`、`knowledge_documents`、`resource_distributions`、`resource_recipients`、`notifications`，另有生成产物表用于其他业务，不需复制新的存储系统。
11. 现有教师接口包括知识文档上传、教学资源维护、资源下发和资源下载；学生接口包括资源列表、打开、下载和完成回执。
12. 现有资源可关联 `course_id` 和 `teaching_class_id`，下发记录也可关联两者，但旧上传入口允许独立资源，课程详情尚未成为核心入口。
13. 学生旧下载通过 `recipient_id + student_user_id` 校验接收关系，能阻止直接读取其他学生的接收记录；但尚无用户要求的课程/教学班/文件三重 URL 契约和教学班成员二次校验。
14. 教师旧分享会调用 `ensureTeachingClassAccess`，可校验负责关系；旧上传本身在文件写入前没有强制选择教学班并校验教师负责关系。
15. 学生路由仅允许 `student`，教师上传路由只允许 `teacher/admin`，因此学生不能调用旧上传接口；课程文件新接口仍需保留后端 403 门禁。
16. 立即下发和到期激活会创建 `RESOURCE_SHARED` 通知，并使用幂等键防重复；但上传、发布、班级学生通知和受控下载尚未形成一个课程详情闭环。
17. 旧上传路径位于 `/uploads/documents` 且应用公开挂载 `/uploads`。新课程文件必须写入非静态目录并仅通过鉴权下载接口读取。

## 实施决定

- 任务与消息保留各自数据库表，新增共享聚合服务和唯一共享前端组件。
- 三端共享浮层容器每次布局渲染都先完整卸载，再按角色挂载；AI 学习助手仅在学生路由懒加载和初始化。
- 课程文件复用 `KnowledgeDocument + ResourceDistribution + ResourceRecipient`，不新增重复文件表；用受控元数据补齐描述、发布状态和上传者角色视图。
- 新文件存入 `storage/course-files`，不通过静态目录暴露；课程、教学班、教师负责关系和学生有效选课关系全部由后端校验。
