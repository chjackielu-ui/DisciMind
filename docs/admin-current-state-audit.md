# DisciMind 管理端现状审计

> 初始审计日期：2026-07-15 02:26（历史基线）  
> 紧急恢复复核：2026-07-15  
> 审计范围：`frontend`、`backend`、Prisma Schema、迁移、管理端路由、共享布局、AI 调用入口、知识库、学习流、通知、日志与 Agent 审核。  
> **复核优先级：下方“2026-07-15 紧急恢复复核”是当前结论；后半部分原始审计全文只保留历史上下文，已被复核取代，不应再作为当前实现说明。**

## 0. 2026-07-15 紧急恢复复核（当前结论）

### 0.1 总体判断

基础管理端的代码、API、数据库和自动化回归已经恢复：共享壳层、Dashboard v1、通知全链路、用户/课程/班级/知识/日志等真实契约均有证据；后端 426/426、前端生产构建、API 烟测、DB 完整性、路由矩阵与静态 UI 门禁均通过其关键项。

这不代表 0–15 广义管理平台重建完成。AI 配置、环境、trace 与治理页面只达到恢复隔离和有限契约；但紧急恢复的真实浏览器多分辨率验收已在 `docs/admin-browser-acceptance.md` 签收，六个目标视口均无页面级横向溢出，最终控制台 0 error/0 warning。

### 0.2 初始判断与当前事实对照

| 初始基线判断 | 2026-07-15 复核后的当前事实 |
| --- | --- |
| 管理端只有 10 个静态路由和 1 个动态路由 | 当前为 22 个静态、1 个动态路由；144/144 前端请求变体匹配后端挂载，0 unmatched、0 unparsed |
| AI 配置页和 Controller 是固定空列表占位 | 当前已有 DB-backed Provider/Model/Agent、密钥与环境状态契约；但模型/Agent 当前为 0、Provider 实时可用数 0/5，仍不能宣称 AI 配置中心完成 |
| 通知交互使用原生弹窗且业务闭环不足 | 活动通知页已使用受控确认/Toast，支持真实筛选、分页、发送、单条/全部已读和事务审计；专项真实 DB 测试纳入全量回归 |
| Dashboard 只有少量扁平指标 | 当前固定 `admin-dashboard.v1`，提供 9 项 summary、系统/服务状态、最近操作和显式模块降级；当前总体为 degraded |
| 管理端需要新建独立 Grid Layout | 独立 Console 壳被证明是回归源；当前方案是在共享 `renderDashboardLayout` 中用 `.role-admin` token 和 scoped Grid 列恢复布局，不创建第二套活动壳层 |
| 页面存在大量原生弹窗、随机/Mock 与统一状态缺失 | 活动管理源码静态门禁未发现原生 `alert/confirm/prompt`、`Math.random`、显式 mock-data 或 catch-to-empty；Dashboard/通知具备 loading/error/empty/retry |
| 内联样式和控件一致性风险 | 风险仍存在：110 个无 class 原生控件、252 个 inline style，被明确保留为 UI backlog |
| 只有 admin 角色级权限 | 扩展路由已出现细粒度权限检查，但基础路由仍以 JWT + admin role 为主，且 1 个活跃管理员缺少有效 RBAC assignment；最小权限闭环未完成 |
| 数据库迁移状态尚未验证 | Prisma validate 通过，44 个 migration 已应用且 DB up to date；DB 完整性 74 PASS/4 WARN/0 FAIL |

### 0.3 当前功能与数据来源

| 模块 | 当前数据/契约 | 复核结论 |
| --- | --- | --- |
| Dashboard | User、Course、AdminClass/TeachingClass、KnowledgeDocument、AiCallLog、Notification、OperationLog 及可选健康模块 | `admin-dashboard.v1` 已恢复；0/5 Provider 时正确 degraded，不用空结构伪装健康 |
| 用户 | User、UserProfile 与教学关系 | 真实分页/筛选/CRUD 契约保留；API 烟测和全量测试通过 |
| 课程/详情 | Course、Chapter、KnowledgePoint、教师与 TeachingClass | 真实查询；辅助请求采用显式部分失败，不再 catch-to-empty |
| 班级 | AdminClass、TeachingClass、Enrollment | 真实契约；关联完整性检查无 critical failure |
| 知识/日志/Agent 审核/个人中心 | 既有真实表与 Service | 基础入口保留；知识列表、计数和审核统一排除 `deleted_at` 非空记录；重启后烟测 `total=16` |
| 通知 | Notification、User、OperationLog | 查询、发送、已读和审计事务闭环；15 enum 覆盖 |
| AI 配置/环境 | Provider、Model、Agent、Version、密钥元数据和组件探测 | API 可达但外部运行环境未就绪；不能把配置记录等同于 Provider 可用 |
| trace/治理 | Trace 与既有学习/知识/教学/Agent/资产/风险聚合 | 仅有限 overview/list/action 与真实空/有限状态；广义治理未验收 |

### 0.4 当前证据与警告

- 后端：`npm.cmd test` 426/426，21 suites，fail/cancel/skip/todo 均为 0；包含新增的 2 条 Knowledge 软删除回归。
- 前端：生产构建通过，仅既有 dynamic-import/chunk-size 警告。
- API：重启 3000 端口后只读 25/25，知识列表 `total=16`；受控写校验 27/27，其中两条非法通知写在持久化前返回 400。
- DB：74 PASS、4 WARN、0 FAIL；26 张恢复必需表和关键列存在。
- 静态 UI：9 PASS、2 WARN、0 FAIL；两项 WARN 为 110 个无 class 控件和 252 个 inline style。
- 浏览器：23/23 条管理路由保持认证且无页面错误/整体溢出/侧栏重叠；六个目标视口通过；共享侧栏展开/收起、表格容器滚动、Modal、真实数据/空态/有限态及管理员个人资料入口已实际验证。
- 保留数据库警告：历史 rollback、换行符 checksum 差异、已应用但未跟踪的 `20260715030000_admin_management_rebuild`、1 个活跃管理员缺少有效 RBAC assignment。
- KnowledgeDocument 只读核对为 21 条物理行 = 16 条有效 + 5 条历史软删除；这是查询条件遗漏，不是测试污染。本轮未对这 5 条历史行做清理或改写。
- `admin-v2.css` 和 `admin-layout.js` 仍可能作为未跟踪现场文件存在，但当前活动入口不再引用；不得重新接回。

---

## 历史基线（已由上方复核取代）

以下第 1–8 节保留 2026-07-15 02:26 的原始审计原文，用于解释恢复前判断和决策演变。文中的“当前”“尚未实现”“路由不存在”等表述均以当时工作区为准。

## 1. 技术基线

| 层级 | 当前实现 | 审计结论 |
| --- | --- | --- |
| 前端 | Vite 8、原生 ES Modules、Hash Router、模板字符串渲染 | 不引入第二套前端框架，继续使用现有路由和请求封装 |
| 状态管理 | 页面局部状态、`sessionStorage` 鉴权状态 | 无独立状态库；管理端折叠状态需单独持久化 |
| UI | 自研 CSS 与组件、少量共享工具 | 管理端基础控件不完整，存在大量内联样式和原生 `alert/prompt` |
| 图标 | `utils/icons.js` 内联 SVG | 可复用；现有管理页仍混有 emoji，必须清理 |
| 图表 | ECharts 6 | 可直接用于驾驶舱和治理指标 |
| 后端 | Express 5、CommonJS、Controller/Service 分层 | 延续现有分层、错误响应和请求 ID 中间件 |
| ORM/数据库 | Prisma 7 + MariaDB/MySQL adapter | 只扩展 Prisma，不引入第二套 ORM；迁移只允许向前兼容 |
| 参数校验 | 新模块主要使用 Zod 4，旧管理接口多为手工校验 | 新增管理接口统一使用 Zod |
| 认证 | JWT Access Token + Refresh Token + AuthSession | 认证闭环已存在，可复用 |
| 权限 | `roleMiddleware(['admin'])` | 只有角色级权限，缺少细粒度 RBAC 和密钥独立权限 |

## 2. 已有管理端功能与数据来源

| 模块 | 页面/接口 | 数据来源 | 完整度 |
| --- | --- | --- | --- |
| 首页 | `/admin/dashboard`、`GET /api/admin/dashboard` | User、Course、KnowledgeDocument、AiCallLog | 真实聚合，但指标少、无趋势/健康/风险/待办 |
| 用户管理 | `/admin/users` | User、UserProfile 及教学关系 | 真实 CRUD；界面存在 emoji、内联样式和原生弹窗 |
| 课程管理 | `/admin/courses`、详情页 | Course、Chapter、KnowledgePoint、教师关系 | 真实 CRUD，可复用 |
| 班级管理 | `/admin/classes` | AdminClass、TeachingClass、Enrollment | 真实 CRUD，可复用 |
| 知识库管理 | `/admin/knowledge` | KnowledgeDocument、ReviewStatus | 真实审核；仅文档审核，不是健康治理 |
| Agent 审核 | `/admin/agent-reviews` | UserAgentVersion、KnowledgeBase、AgentReport、OperationLog | 真实审核、举报处理和下架，可迁移到智能体运营 |
| 通知管理 | `/admin/notifications` | Notification | 真实存储和发送；交互仍使用原生弹窗 |
| 操作日志 | `/admin/logs` | OperationLog | 真实查询；字段不足，且仅部分业务主动写入 |
| AI 配置 | `/admin/ai-config` | 占位接口返回固定空列表 | 静态占位，核心功能未实现 |
| 个人中心 | `/admin/profile` | 当前用户 | 只读；修改密码仍是占位提示 |

## 3. 可复用业务资产

- 组织教学：User、UserProfile、College、Major、AdminClass、Course、CourseOffering、TeachingClass、Enrollment。
- 知识治理：KnowledgeBase、KnowledgeDocument、KnowledgeDocumentChunk、KnowledgePoint、KnowledgeDocumentReview、Dify/Qdrant 配置入口。
- 智能体：AiAgentConfig、AgentRunRecord、UserAgent、UserAgentVersion、AgentReviewRecord、AgentReport、MarketplaceAgentInvocation。
- 学习流：LearningWorkflowTemplate、LearningWorkflowVersion、LearningSession、LearningSessionNodeRun、LearningSessionEvent、LearningGoal。
- 教学分析：AnswerRecord、WrongQuestion、StudentMasteryRecord、TeacherAnalyticsSnapshot、TeacherStudentIntervention。
- AI 运行：AiModelConfig、AiCallLog、AgentRunRecord、SubjectChatRun/Task/Event/Source。
- 安全审计：SafetyCheckRecord、OperationLog、request-id 中间件、统一公共错误结构。
- 通用前端：`api/request.js`、`utils/router.js`、`utils/icons.js`、ECharts 工具、Toast 工具、现有 Dashboard Layout。

## 4. 不完整或静态功能

1. `admin-ai-config.js` 是完整占位页，供应商、模型、密钥、Agent 绑定、环境状态均未实现。
2. `admin-ai.controller.js` 返回固定空列表和“开发中”消息，属于生产 Mock/占位接口。
3. `modules/ai/provider.factory.js` 与 `modules/ai/ai.service.js` 仍为 TODO。
4. 旧 `services/ai.service.js` 默认允许 `fallbackMock=true`，会在未配置、限额或连接失败时生成生产 Mock 内容。
5. 权限仅区分 admin/teacher/student，没有供应商查看、密钥管理、发布、审计等权限点。
6. 学习流、知识库、Agent、教学分析已有大量真实数据，但没有面向管理员的治理聚合与闭环操作。
7. AI 调用日志只有 provider/model/token/status/latency，缺少 request/trace、执行步骤、检索引用、工具调用和反馈证据链。
8. 操作日志缺少 request_id、成功状态、失败原因、变更前后摘要、更新时间；写入覆盖面不足。
9. 风险记录只有 SafetyCheckRecord，缺少可处理的风险事件、证据与处置动作。
10. 管理端页面大量使用 emoji、内联 CSS、原生 `alert/prompt/confirm`，基础控件状态不统一。

## 5. 路由与挂载审计

- 前端已挂载 10 个管理端静态路由及课程详情动态路由；AI 治理、证据链、学习流治理、风险中心等入口不存在。
- 后端 `/api/admin` 已统一经过 JWT 与 admin 角色中间件。
- Agent 审核路由单独挂载在 `/api/admin`，与核心管理路由并存，可保留兼容。
- 管理端现有 API 与页面基本一一对应；AI 配置是页面与接口同时存在但均为占位。
- 新路由应在现有 `/api/admin` 与 Hash Router 中增量挂载，不删除旧路由。

## 6. 视觉与布局风险

- `renderDashboardLayout` 使用全角色共享的悬浮侧栏，侧栏展开主要依赖覆盖与二级悬浮面板；管理端没有独立 Grid Layout，这是侧栏遮挡内容的直接风险。
- 侧栏首次展开后自动收起，状态不按管理端需求长期记忆；平板/移动端没有管理端抽屉语义。
- 当前首页卡片信息密度低、无趋势与异常层级，欢迎区包含 emoji，紫色与透明效果过度。
- 页面大量内联宽度和颜色，使 1366×768、1280×720 下容易换行、溢出和纵向浪费。
- 表单、表格、弹窗尚未形成统一管理端组件状态，存在浏览器原生样式退化风险。

## 7. 数据与安全风险

- `AiModelConfig.api_key_encrypted` 的命名与实际使用不一致：旧 AI 服务直接把字段作为 Bearer Token 使用，无法证明已加密。
- 密钥没有统一 AES-256-GCM 服务、最后四位元数据、替换/清除语义和独立权限。
- 错误日志与操作描述缺少统一字段级脱敏器。
- AI Provider 调用分散读取环境变量，尚无“数据库配置 > 环境变量 > 安全默认”的统一解析层。
- 学生画像、风险与证据链属于敏感数据，现有角色级权限无法满足最小权限原则。
- 真实数据库迁移需先执行 `prisma migrate status` 与备份策略检查；不得重建或删除表。

## 8. 与目标架构的差距及实施建议

1. 在现有 Prisma 中新增统一 Provider/Model/AgentVersion、权限、追踪与治理模型，并用手写前向迁移保留旧表。
2. 建立密钥认证加密、脱敏、统一审计、权限校验、Provider Adapter、健康检查与环境状态服务。
3. 用真实聚合查询将现有学习流、知识库、作答、掌握度、Agent 运行数据接入治理中心；样本不足返回 `insufficient_data`。
4. 将现有 Agent 审核、知识文档审核、通知、日志入口迁移进新信息架构，同时保留旧 Hash 路由兼容。
5. 新建管理端专用 Grid Layout、主题 Token 与基础组件；用 SVG 图标替换 emoji，危险操作使用受控确认弹窗。
6. 首页改为真实教学智能运营驾驶舱，所有指标由后端聚合服务返回。
7. 使用 Node 测试覆盖服务与接口，使用 Python 脚本做仓库/数据库/路由/敏感信息审计，使用真实浏览器完成多视口验收。
