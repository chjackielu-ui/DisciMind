# DisciMind 管理端紧急恢复报告

> 状态：**紧急恢复完成；代码、自动化与真实浏览器多分辨率验收均已签收。**  
> 报告日期：2026-07-15（Asia/Shanghai）  
> 范围：恢复基础管理端、修复 Dashboard 与通知、隔离未完成扩展、验证真实 API/DB 契约。本文不是 0–15 广义管理平台重建完成报告。

## 一、根因总结

1. **布局/样式根因**：活动入口引入独立 `admin-v2.css`，管理员角色又被 `renderAdminLayout` 分派到“DisciMind Console”自定义壳，绕开共享 `renderDashboardLayout` 和 `.role-admin` 作用域，产生视觉语言分裂、原生控件暴露与侧栏结构退化。
2. **Dashboard 根因**：前端 HMR 已消费新嵌套结构，旧 Node 进程仍返回七个扁平统计字段；`system_status`/`service_health` 不存在时读取 `overall` 崩溃。这是部署进程与接口契约错位，不是数据库记录为空。
3. **通知根因**：页面语义是全局管理，后端“全部已读”却按当前管理员接收人更新；通知枚举、筛选、事务、审计和非法目标校验也不完整。
4. **路由/权限根因**：基础路由与扩展路由混在同一恢复现场；部分扩展有细粒度权限，基础页主要仍依赖 JWT + admin role，且数据库中有 1 个活跃管理员未分配有效细粒度 RBAC 角色。
5. **数据库风险**：大规模 Prisma/迁移变更已经进入工作区并应用到数据库，但迁移目录未被 Git 跟踪；历史 rollback 和换行符 checksum 差异不能通过改写历史迁移“修复”。

## 二、恢复的原有功能

- 恢复学生端、教师端同源的管理壳层：品牌、侧栏、主内容、用户区与移动端导航继续由共享布局生成，管理员只通过 `.role-admin` 紫色 token 表达角色语义。
- Dashboard 恢复真实数据库统计、系统/服务状态、最近操作、可选模块显式降级、loading/error/empty/retry。
- 用户、课程、课程详情、班级、知识文档、日志、通知、Agent 审核和个人中心保留原 Hash 路由与真实数据契约。
- 知识文档管理列表与审核现只面向 `deleted_at IS NULL` 的有效资源；历史软删除行保留在数据库供审计，不再进入管理列表、分页总数或审核队列。
- 共享侧栏用户区按角色进入各自个人资料页；补齐了管理员和教师角色入口，管理员实际点击已验证。
- 通知恢复关键词/类型/已读/接收人/日期筛选、分页、发送、单条已读、当前筛选范围全部已读和操作审计。
- 课程详情的章节、知识点、教学班、教师候选人改用 `Promise.allSettled`；辅助查询失败会在页面列明并允许重试，不再静默伪装为空列表。

## 三、修复的接口

### Dashboard

- `GET /api/admin/dashboard` 固定契约 `admin-dashboard.v1`。
- `summary` 包含用户、学生、教师、课程、班级、知识文档、今日 AI 调用、待审文档、未读通知九项真实聚合。
- `system_status`、`service_health.services`、`recent_events`、`module_errors` 均为固定结构；核心 DB 查询失败会失败返回，可选模块失败只降级对应模块。
- 前端只在 `frontend/src/api/admin.js` 的 API 边界归一化旧/current/v1 历史结构；旧契约明确产生 `LEGACY_DASHBOARD_CONTRACT`，不会被包装成健康状态。

### 通知

- `GET /api/admin/notifications`：真实筛选、分页、接收人信息、软删除/过期排除。
- `POST /api/admin/notifications`：验证角色和 15 个通知枚举，事务广播并记录操作日志，成功语义为 201。
- `PUT /api/admin/notifications/:notification_id/read`：事务更新单条通知与审计。
- `PUT /api/admin/notifications/read-all`：按当前筛选范围更新所有未读通知，不接受任意 `user_id` 越权缩放范围。

### 基础管理契约

- API 只读烟测对用户、课程、行政班、知识文档、操作日志和通知均取得 HTTP 200、统一 envelope、真实分页和字段结构。
- `GET /api/admin/knowledge-documents` 的列表查询和 `total` 现共用 `deleted_at: null` 条件；知识文档审核也会把已软删除文档视为不可用，防止历史记录被重新审核。
- 路由矩阵发现 23 条管理路由、144 个前端请求变体，144 个均匹配已挂载后端路由；0 unmatched、0 unparsed。
- 90 条挂载后端路由、178 个 Prisma model/table 映射已进入静态审计；静态闭环不被冒充为浏览器或成功写操作证明。

## 四、修复的数据结构

- 沿用项目既有 `code` / `data` / `message` envelope，不创建第二套响应格式；前端请求层统一解包。
- Dashboard 只在 `frontend/src/api/admin.js` 的 API 边界兼容历史结构，页面始终消费 `admin-dashboard.v1`；兼容旧契约时显式降级并记录错误码。
- 用户、课程、班级、日志和通知分页统一提供真实 `list`、`page`、`page_size`、`total`、`total_pages` 语义；页面不再自行猜测总数。
- 通知类型与 Prisma 的 15 个枚举一致，前端另做中文显示映射；接收人关联、软删除、过期和日期边界均由后端统一解释。
- 知识文档的“物理行数”与“有效资源总数”明确分开：当前 21 条物理行中有 16 条有效、5 条历史软删除；管理列表和 Dashboard 的业务口径均为 16。
- 课程详情可接受当前数组响应及分页 `data.list`，但结构断言失败会显示模块错误，不再 catch-to-empty。

## 五、修复的样式与共享组件

- 移除活动 `admin-v2.css` 全局导入和管理员自定义 Console dispatch。
- 共享 wrapper 为 `student-dashboard-wrapper role-admin`；管理员紫色只覆盖 token、active/hover/status 等语义，不创建第二套布局系统。
- 769px 以上使用 expanded/collapsed 两种真实 Grid 列，侧栏为 in-flow sticky，不覆盖主内容；900px 有平板收敛，768px 及以下继承共享底部导航和主内容留白。
- Dashboard/通知及隔离扩展页补齐受控按钮、表单、弹窗、toast、loading/error/empty/retry 样式；活动管理源码未发现原生 `alert/confirm/prompt`、`Math.random`、显式 mock-data 或 catch-to-empty。
- 仍有 110 个无 class 原生控件和 252 个 inline style，作为遗留 UI backlog 记录，而非声称已全部组件化。

## 六、隔离的未完成功能

- AI 配置、Agent、环境、trace 和九类治理路由仍保留在 router/API 中，但不进入稳定主导航；页面显示恢复隔离/有限状态。
- trace 烟测返回真实空列表；治理只验证有限 overview/list/action 契约，不代表学习流治理、数字孪生、策略画像、资产治理、实验与风险闭环完成。
- 环境状态接口可达并返回 9 个组件，但当前外部依赖未配置或不可用；Dashboard 正确显示 degraded。
- AI Provider 有 5 条配置记录，模型与 Agent 为 0，实时可用 Provider 为 0/5。配置存在不等于调用链健康。

## 七、数据库验证结果

- `npx prisma validate` 通过；`npx prisma migrate status` 显示 44 个 migration 已应用且数据库 up to date。
- 只读完整性脚本结果：74 PASS、4 WARN、0 FAIL；23 个恢复关键 Prisma model、26 张必需表和关键字段均存在。
- 用户/RBAC、课程/班级、Enrollment、通知、OperationLog、AI Provider/Model/Agent/Version 的孤立引用、唯一性和支持状态关键检查均无 FAIL。
- 四项保留警告：5 个历史 rolled-back migration；15 个仅换行符导致的 checksum 差异；已应用但未跟踪的 `20260715030000_admin_management_rebuild`；1 个活跃管理员缺少有效 RBAC role assignment。
- 对知识文档计数差异进行了只读核对：数据库中的 21 条是 16 条有效记录加 5 条历史软删除记录，不是本轮测试新增污染。本次没有删除、清理或改写这 5 条历史数据。
- 本次未 drop、reset、reseed 或改写历史 migration。

## 八、后端与 API 测试结果

| 命令/证据 | 结果 |
| --- | --- |
| `cd backend && npm.cmd test` | **426/426 通过，21 suites，fail/cancel/skip/todo 均为 0；59,572.1442 ms** |
| Dashboard 专项恢复测试 | v1 结构、核心 fail-fast、可选模块隔离、Provider degraded 语义通过 |
| Notification 专项恢复测试 | 真实 DB 广播/筛选/全部已读/审计、非法角色、15 enum 覆盖通过 |
| Knowledge 软删除专项测试 | 新增 2 条回归：列表/总数排除软删除文档，审核拒绝软删除文档；已纳入上述全量 426 条 |
| `docs/admin-api-smoke-result.json` | 重启 3000 端口后只读 25/25，通过未授权边界、登录、基础和隔离扩展 GET，0 warning；知识列表 `total=16` |
| `docs/admin-api-smoke-write-guard-result.json` | 受控写校验 27/27；两条非法通知请求均在 DB 写入前返回 400 |

受控写校验只证明非法写被拒绝，不宣称完整成功写入浏览器流程；成功通知写入由专项真实数据库测试覆盖。浏览器验收只打开/关闭发送弹窗，没有为验收制造持久化记录。

## 九、前端构建与静态测试结果

- 最终执行 `cd frontend && node.exe node_modules/vite/bin/vite.js build`（项目同一 Vite 构建入口）通过，950 个 modules 完成转换；只有既有 dynamic-import 和 chunk-size 警告。
- `python scripts/admin_route_api_matrix.py --check` 通过：23 routes、144/144 request matches、0 unmatched、0 unparsed。
- `python scripts/admin_ui_regression_check.py --check` 通过关键门禁：9 PASS、2 WARN、0 FAIL。两项 WARN 是 110 个无 class 控件和 252 个 inline style。
- `python scripts/admin_db_integrity_check.py` 返回 READY WITH WARNINGS，不含凭据、token、hash 或行样本。

## 十、浏览器验收结果

`docs/admin-browser-acceptance.md` 已记录真实管理员登录验收：

- 六个指定视口 1920×1080、1600×900、1440×900、1366×768、1280×720、1024×768 均无页面级横向溢出，侧栏与主内容没有重叠。
- 1920×1080 实际验证 250 px 展开侧栏与 80 px 收起侧栏；1024×768 的通知表格仅在容器内部横向滚动。
- 路由表中的 23/23 条 `/admin` 路由均保持真实管理员认证；基础页展示真实数据，trace/AI 空数据使用明确空态，九类治理页使用明确有限态。
- 驾驶舱在浏览器验收当时实际观测到 16 条有效知识文档。知识列表页当时未留下可复核的 `total` 指标，因此不倒推浏览器计数；修复后的 `total=16` 由全量/专项回归与重启后 API smoke 签收。
- 通知接收人筛选、发送弹窗、分页、侧栏固定状态与个人资料入口均通过页面控件操作；最终浏览器日志只有 Vite debug，0 error、0 warning。

全部 `/admin` 路由/API 同时具有 23/23 浏览器遍历、144/144 静态矩阵与 25/25 API smoke 三层证据；有限治理页虽可运行，仍不被冒充为完整业务验收。

## 十一、多分辨率截图路径

截图统一保存在 `artifacts/admin-recovery/`。核心索引：

- Dashboard：`dashboard-1920x1080-expanded-final.png`、`dashboard-1920x1080-collapsed-final.png`
- 通知：`notifications-1920x1080-final.png`、`notifications-1600x900-final.png`、`notifications-1440x900-final.png`、`notifications-1366x768-final.png`、`notifications-1280x720-final.png`、`notifications-1024x768-final.png`
- 基础页：`users-1440x900-final.png`、`courses-1440x900-final.png`、`classes-1440x900-final.png`、`knowledge-1440x900-final.png`
- Agent/系统：`agents-1440x900-final.png`、`agent-reviews-1440x900-final.png`、`system-config-1440x900-final.png`、`environment-1440x900-final.png`

完整尺寸指标与 23 路由结构化结果见 `docs/admin-browser-acceptance.md` 和 `artifacts/admin-recovery/admin-route-browser-result.json`。

## 十二、仍存在的限制与外部配置

- 系统健康为 degraded；外部 AI/向量库/文档/语音组件不可用或未配置时继续显示真实状态，不允许 fallback Mock。
- 基础 admin role 鉴权可用，但细粒度 RBAC 数据覆盖不完整；需要为活跃管理员补有效角色分配并复测最小权限。
- 已应用迁移必须进入版本控制；历史 rollback/checksum 警告保持审计可见。
- 治理与 trace 只有有限恢复边界，广义 0–15 重建仍冻结。
- 遗留管理页仍需逐步减少 inline style 和无 class 控件；本次恢复只确保它们不再因错误壳层退化为全局默认样式。

## 十三、下一阶段可以安全继续的模块

紧急恢复完成后仍不自动展开 0–15。若用户明确重启建设，安全顺序为：

1. 先将已应用迁移纳入版本控制并处理活跃管理员 RBAC assignment，再复测部署与最小权限。
2. 选择单个 AI Provider/环境模块完成真实连接、密钥操作、正反向权限和浏览器验收。
3. 在产生可重复真实 AI 调用样本后，单独完成 trace 证据链模块。
4. 九类治理模块一次只开放一个，严格按数据库 → 后端 → API 测试 → 前端 → 浏览器验收推进。

## 十四、修改与证据清单

关键恢复代码集中在：

- 前端：`frontend/src/api/admin.js`、`frontend/src/pages/admin-dashboard.js`、`frontend/src/pages/admin-notifications.js`、`frontend/src/styles/admin.css`、`frontend/src/utils/admin-ui.js`、共享路由/布局与基础管理页面。
- 后端：`backend/src/services/admin-dashboard.service.js`、`backend/src/services/admin-notification.service.js`、`backend/src/services/admin-knowledge.service.js`、相应 Controller/Route、用户/课程/日志契约修复及专项测试。
- 数据库：`backend/prisma/schema.prisma` 与已应用的 `backend/prisma/migrations/20260715030000_admin_management_rebuild/migration.sql`。
- 自动化证据：`docs/admin-db-integrity-result.md`、`docs/admin-route-api-matrix.md`、`docs/admin-ui-regression-result.md`、`docs/admin-api-smoke-result.json`、`docs/admin-api-smoke-write-guard-result.json`、`docs/admin-emergency-audit-result.md`。
- 浏览器证据：`docs/admin-browser-acceptance.md` 与 `artifacts/admin-recovery/*-final.png`。

工作区包含用户原有和多轮恢复修改；本报告按功能边界描述，不把整个 dirty worktree 归因于单次恢复，也没有通过清理工作树丢弃现场。
