# DisciMind 管理端紧急恢复进度

> 启动时间：2026-07-15（Asia/Shanghai）  
> 当前分支：`feature/more-fun-up-lyj-0715`  
> 基线提交：`2e53f4b3c0f78a5b16a2e0379a0f3f6234dcc946`  
> 当前状态：**紧急恢复完成；代码、接口、数据库、自动化门禁与真实浏览器多分辨率验收均已签收。**  
> 执行原则：保护现场、最小修改、共享壳层、真实数据、显式降级、不用 Mock 或空数组掩盖错误。

## 当前阶段

紧急恢复阶段 1–9 已完成：现场保护、根因定位、共享壳层恢复、Dashboard v1、通知全链路、基础页面/API 契约、数据库检查、构建与自动化回归，以及真实管理员登录下的六视口浏览器验收均已有证据。浏览器页面、控制台、侧栏展开/收起、横向溢出与截图详见 `docs/admin-browser-acceptance.md`。

原 `docs/admin-management-rebuild-progress.md` 所列 0–15 广义重建继续冻结。恢复期间出现的 AI 配置、trace、治理、RBAC、密钥和环境探测代码不等于这些阶段已经完成。

## 现场保护与历史基线

- 未执行 `git reset`、`git restore`、`git checkout .`、`git clean`、数据库重建、drop 或 destructive migrate。
- 紧急恢复启动时的真实现场为：27 个已跟踪文件有修改，约 2,130 行新增、1,117 行删除；没有暂存修改。此前“工作树初始状态干净”的记录已被本次 2026-07-15 复核取代。
- `backend/prisma/migrations/20260715030000_admin_management_rebuild/migration.sql` 已在数据库中应用，但目录仍未被 Git 跟踪。不得删除、重写或重复迁移；合并前必须将其纳入版本控制并复核 SQL。
- `frontend/src/styles/admin-v2.css` 与 `frontend/src/utils/admin-layout.js` 仍可作为未跟踪恢复现场存在，但已从活动入口和路由渲染链中隔离；不得重新接回全局入口。

## 已确认根因与恢复动作

### 1. 视觉与布局退化

根因是活动入口同时接入了独立 `admin-v2.css` 和自定义 `renderAdminLayout`/“DisciMind Console”分支，绕开了学生端、教师端共用的 `renderDashboardLayout`，导致 `.role-admin` 作用域失效、原生控件暴露和侧栏/主内容结构分叉。

恢复后：

- 管理页面重新通过共享 `renderDashboardLayout` 与 `student-dashboard-wrapper role-admin` 渲染。
- `frontend/src/main.js` 不再活动导入 `admin-v2.css`；`frontend/src/utils/dashboard.js` 不再分派自定义 Console 壳层。
- `frontend/src/styles/admin.css` 只在 `.role-admin` 下提供克制、实色的紫色语义；桌面使用真实网格列和 in-flow sticky 侧栏，移动端继续继承共享底部导航。
- 主导航恢复为稳定基础入口；未完成的治理扩展路由不占据主导航。
- 共享侧栏用户区现按角色进入 student、teacher、admin 各自个人资料页；管理员入口已在 1024×768 下实际点击验证。

### 2. `/admin/dashboard` 的 `overall` 异常

根因不是数据库空值，而是部署契约错位：Vite/HMR 已加载期待 `system_status`/`service_health` 的新页面，旧 Node 进程仍返回七个扁平统计字段，页面因读取不存在对象的 `overall` 崩溃。

恢复后：

- 后端固定返回 `contract_version: admin-dashboard.v1`，核心 `summary` 聚合查询失败时 fail-fast，学习流、知识、风险、Provider 等可选模块单独降级并写入 `module_errors`。
- 0/5 Provider 可用时系统如实返回 `degraded`，不伪造 operational。
- 前端 API 边界统一执行 `normalizeAdminDashboardData`，兼容旧/current/v1 三种历史形态；旧契约显式标记 `LEGACY_DASHBOARD_CONTRACT` 和 degraded。
- 页面在读取 `summary`、`system_status`、`service_health.services`、`module_errors`、`recent_events` 前执行结构断言，并提供 loading/error/empty/retry 状态。
- 当前真实 API 烟测返回 HTTP 200、`admin-dashboard.v1`、9 个 summary 字段、6 个服务项、0 个模块错误；系统总状态为 degraded，符合当前外部环境实际状态。

### 3. `/admin/notifications` 业务断链

原实现把“全部已读”错误限定到当前管理员接收的通知，类型覆盖不全，非法 `target_role` 可能退化为广播，顺序写入存在部分成功风险，且缺少接收人/日期/关键词等真实筛选。

恢复后：

- 后端覆盖 Prisma 的 15 个通知类型，排除软删除和过期记录，支持关键词、类型、已读、接收人、开始/结束日期与分页。
- 发送通知验证 `all/admin/teacher/student`，用事务完成 `createMany` 和 `OperationLog`；创建返回 201。
- 单条已读和当前筛选范围“全部已读”均在事务内更新并落审计，不再信任前端传入任意 `user_id`。
- 页面提供真实列表、筛选、分页、发送、单条已读、筛选范围全部已读、loading/error/empty/retry 与受控确认；数据库返回内容经过转义。
- `admin-notification-recovery.test.js` 的真实数据库广播/筛选/全部已读/审计、非法角色拒绝和 15 类型覆盖测试均已纳入全量回归。

### 4. `/admin/knowledge` 软删除计数偏差

最终复核发现，Dashboard 已按有效文档统计 16 条，但管理列表的列表与计数查询遗漏 `deleted_at: null`，因而可把 5 条历史软删除行计入列表总数。

恢复后：

- 列表和 `total` 共用 `deleted_at: null` 条件，审核入口也拒绝已软删除文档。
- 只读数据核对确认 21 条物理行 = 16 条有效 + 5 条历史软删除，不存在本轮测试污染；本次没有删除或清理历史行。
- 新增 2 条专项回归，分别锁定列表/总数过滤与软删除文档不可审核，已纳入全量 426 条测试。
- 重启 3000 端口的后端进程后，最终 API smoke 25/25，知识列表 `total=16`。

## 已恢复页面与接口

| 范围 | 当前恢复结论 | 证据边界 |
| --- | --- | --- |
| Dashboard | v1 契约、真实聚合、服务健康、显式降级、重试恢复 | API 烟测与专项/全量测试通过；1920×1080 展开/收起及响应式浏览器验收通过 |
| 用户 | 真实 User/UserProfile 查询、筛选、分页与 CRUD 契约保留 | API 烟测返回真实分页结构；路由/API/Service/Prisma 静态闭环 |
| 课程与课程详情 | Course、Chapter、KnowledgePoint、教师关系、教学班真实查询；辅助模块失败显式展示 | API 烟测和全量测试通过；不再 catch-to-empty |
| 班级 | AdminClass、TeachingClass、Enrollment 真实查询与管理契约保留 | API 烟测返回真实分页结构；DB 关系完整性通过 |
| 知识库、日志、Agent 审核、个人中心 | 保留基础管理路由和真实数据契约；知识列表/审核排除软删除行 | 静态矩阵闭环；基础 GET 烟测覆盖知识文档与日志；知识 `total=16` |
| 通知 | 查询、筛选、分页、发送、单条/全部已读、审计闭环 | 专项真实 DB 测试、全量测试、API 查询烟测通过 |
| AI 配置、环境、trace、治理 | 路由/API 可达且错误状态显式，不污染基础导航 | 仅恢复隔离和有限契约；不等于 0–15 功能完成 |

## 自动化验证结果

| 门禁 | 当前结果 | 说明 |
| --- | --- | --- |
| 后端全量测试 | **426/426 通过，0 失败** | `cd backend && npm.cmd test`；21 suites，fail/cancel/skip/todo 均为 0；59,572.1442 ms；新增 2 条 Knowledge 软删除回归已纳入 |
| 前端生产构建 | **通过** | 最终复核命令为 `cd frontend && node.exe node_modules/vite/bin/vite.js build`（同一项目 Vite 入口，950 modules）；仅保留既有 dynamic-import/chunk-size 警告 |
| API 只读烟测 | **25/25 通过** | 重启 3000 端口后执行；未授权边界、真实管理员登录、基础接口及隔离扩展 GET；0 warning；知识 `total=16` |
| API 受控写校验 | **27/27 通过** | 在只读烟测基础上验证两条非法通知写请求均在持久化前返回 400；不是成功写入冒烟 |
| DB 完整性 | **74 PASS、4 WARN、0 FAIL** | 只执行 allow-list SELECT/INFORMATION_SCHEMA；26 张必需表、关键列与外键/唯一性检查通过 |
| Prisma | **通过** | `prisma validate` 通过；44 个 migration 均已应用、数据库 up to date |
| 路由/API 矩阵 | **通过** | 23 条前端管理路由；144/144 请求变体匹配挂载后端；0 unmatched、0 unparsed；扫描 90 条后端路由和 178 个 Prisma 映射 |
| 静态 UI 回归 | **9 PASS、2 WARN、0 FAIL** | 共享壳层、Dashboard v1、异步状态和响应式关键项通过；110 个无 class 控件、252 个 inline style 作为 backlog |

## 数据库警告与待处理边界

`docs/admin-db-integrity-result.md` 当前结论为 READY WITH WARNINGS，四项警告必须保留：

1. 历史上存在 5 个 rolled-back migration 记录，需要保留审计，不应擅自清除。
2. 15 个已应用 migration 仅存在换行符导致的 checksum 差异；不要为消除告警改写历史迁移。
3. 已应用的 `20260715030000_admin_management_rebuild` 迁移尚未被 Git 跟踪。
4. 1 个活跃管理员没有 enabled、未过期的细粒度 RBAC role assignment；基础 role=admin 路由可用，但不能据此宣称最小权限闭环完成。

## 当前诚实限制

- Dashboard 总状态仍为 degraded：数据库和基础 API 可用不代表 AI Provider、Dify、Qdrant、LibreOffice、语音或其他外部组件可用。环境接口可返回 9 个组件的结构化状态，但当前未配置/不可用项必须继续显示为不可用。
- trace 当前真实列表为空；治理页面主要是有限 overview/list/action 壳和恢复隔离提示，数据量不足时只显示真实空态/有限态。
- AI Provider 表中存在 5 条记录，但烟测时模型和 Agent 列表为 0，Provider 可用数为 0/5；不能把“配置记录存在”写成“外部调用已可用”。
- 静态 UI 仍有 110 个无 class 原生控件和 252 个 inline style，集中在用户、课程详情、班级等遗留页面；它们是后续一致性 backlog，不是本次用 Mock 掩盖的通过项。
- 路由矩阵、API 烟测和真实浏览器证据各自保留边界：前两者证明全部 `/admin` 契约闭环，浏览器报告证明关键恢复页面的计算布局、横向溢出、控制台和交互状态。

## 浏览器验收状态

`docs/admin-browser-acceptance.md` 已签收。真实管理员登录下逐页打开了路由表中的 23/23 条 `/admin` 路由；全部保持认证，0 页面错误文本、0 页面级横向溢出、0 侧栏/主区重叠。六个目标视口 1920×1080、1600×900、1440×900、1366×768、1280×720、1024×768 均通过；1920×1080 的侧栏展开/收起、1024×768 的表格容器内滚动和 Modal 边界符合预期，最终控制台为 0 error、0 warning。

## 证据文件

- `docs/admin-emergency-recovery-report.md`
- `docs/admin-api-smoke-result.json`
- `docs/admin-api-smoke-write-guard-result.json`
- `docs/admin-db-integrity-result.md`
- `docs/admin-route-api-matrix.md`
- `docs/admin-ui-regression-result.md`
- `docs/admin-emergency-audit-result.md`
- `docs/admin-browser-acceptance.md`
