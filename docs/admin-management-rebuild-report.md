# DisciMind 管理端 0–15 重建边界报告

> 报告日期：2026-07-15  
> 结论：**0–15 广义重建未完成，当前保持冻结。**  
> 本文用途：说明紧急恢复中哪些基础能力已经可复用、哪些扩展仅有有限实现，以及重新启动重建前必须补齐的证据。本文不是“建设完成报告”。

## 一、执行结论

本轮完成的是管理端紧急恢复：共享壳层、Dashboard v1、通知全链路、基础用户/课程/班级/知识/日志契约和自动化门禁已经恢复。后端全量 426/426、前端生产构建、API/DB/路由/UI 检查均有可重复证据。

原 0–15 计划没有因此完成。恢复现场包含 AI 配置、trace、治理、RBAC、密钥和环境代码；紧急恢复六视口浏览器验收虽然已经通过，但外部服务、完整交互、最小权限、业务处置闭环与生产验收仍不足，必须继续标为有限或未验收。

## 二、可作为后续基础的已恢复能力

### 共享前端基础

- 管理员与学生/教师共用 `renderDashboardLayout`、品牌、侧栏、用户区和移动端导航。
- `.role-admin` 提供克制紫色 token；桌面 expanded/collapsed Grid 列、sticky in-flow 侧栏和移动端留白已进入静态门禁。
- 活动入口不再使用 `admin-v2.css` 和自定义“DisciMind Console”壳。
- 活动管理源码未检测到原生 `alert/confirm/prompt`、`Math.random`、显式 mock-data 和 catch-to-empty。

### 基础业务与接口

- Dashboard：`admin-dashboard.v1`、9 项真实 summary、系统/服务状态、可选模块显式降级、最近操作。
- 通知：15 enum、真实查询/筛选/分页、事务发送、单条/筛选范围全部已读和 OperationLog。
- 用户、课程、课程详情、班级、知识文档、日志、Agent 审核、个人中心保留现有真实数据库契约；知识列表、分页计数和审核统一排除历史软删除行。
- 路由矩阵：23 条管理路由，144/144 前端请求变体匹配后端，0 unmatched、0 unparsed。

### 数据与安全基础

- Prisma validate 通过，44 个 migration 已应用且数据库 up to date。
- DB 完整性为 74 PASS、4 WARN、0 FAIL；关键表、字段、引用和唯一性无 critical failure。
- DB-backed AI Provider/Model/Agent、密钥加密元数据、环境状态、trace 与治理 Service 已有代码和路由基础。

这些能力可复用，但不能跳过各阶段独立验收。

## 三、0–15 完成度边界

| 阶段组 | 已有证据 | 当前结论 |
| --- | --- | --- |
| 0 审计 | 仓库、路由、API、DB、UI 确定性报告 | **复核完成** |
| 1–2 架构/权限/迁移 | 部分 RBAC、密钥、Schema、前向迁移和完整性门禁 | **未完成**：RBAC assignment 与未跟踪已应用迁移仍告警 |
| 3 AI 配置 | 5 条 Provider 记录，Model/Agent/环境 API 可达 | **有限**：Provider 实时可用 0/5，Model/Agent 为 0，外部调用未验收 |
| 4 trace | 列表/详情/风险标记路由与真实空列表 | **有限**：无端到端样本和证据链验收 |
| 5–13 治理 | 九类 overview/list/action 的静态闭环和只读烟测 | **有限**：不是完整治理业务或处置闭环 |
| 14 首页/视觉 | 共享壳层与 Dashboard 紧急恢复、响应式静态门禁 | **部分**：广义视觉重构和遗留页组件化未完成 |
| 15 联调/验收 | 后端、构建、API、DB、路由、静态 UI；紧急恢复六视口与关键页面浏览器证据 | **部分**：外部集成、完整治理写流程、生产和跨浏览器验收未完成 |

## 四、自动化证据

| 证据 | 结果 | 正确解释 |
| --- | --- | --- |
| 后端 `npm.cmd test` | 426/426，21 suites，fail/cancel/skip/todo 均为 0 | 当前代码和测试数据库回归通过；含新增 2 条 Knowledge 软删除回归 |
| 前端 Vite 生产构建 | 通过 | 最终命令 `node.exe node_modules/vite/bin/vite.js build`，950 modules；既有 chunk/dynamic-import 警告仍在 |
| API 只读烟测 | 25/25 | 重启 3000 端口后，未授权边界、登录、基础及隔离扩展 GET 契约通过；知识列表 `total=16` |
| API 受控写校验 | 27/27 | 两条非法通知写在持久化前被 400 拒绝；不是完整成功写流程 |
| DB 完整性 | 74 PASS/4 WARN/0 FAIL | DB ready with warnings，不是无条件 clean |
| 路由矩阵 | 23 routes；144/144 matches | 静态挂载闭环，不替代运行时浏览器行为 |
| 静态 UI | 9 PASS/2 WARN/0 FAIL | 共享壳层等关键项通过；110 无 class、252 inline style 留作 backlog |

## 五、不得隐藏的限制

### 环境与外部服务

环境状态接口 HTTP 200、返回 9 个组件，只证明探测契约可用。当前系统总体为 degraded，Provider 实时可用 0/5；Dify、Qdrant、LibreOffice、语音和其他外部组件未配置或不可用时必须保持 unavailable，不能启用 fallback Mock。

### 治理与 trace

trace 当前无真实列表样本；治理页面主要是通用 overview/list/action 和有限状态。缺少完整业务规则、批量处置、回滚、效果评估、权限矩阵和浏览器交互，因此阶段 4–13 均不能标完成。

### 数据库与权限

- KnowledgeDocument 只读对账确认 21 条物理行由 16 条有效数据和 5 条历史软删除行组成，不是测试污染；紧急恢复未删除或改写这些历史行。该契约修复不等于阶段 6 “知识库健康”完整治理已完成。
- 5 个历史 migration 有 rolled-back 记录。
- 15 个已应用 migration 有纯换行符 checksum 差异；不得改写历史文件消除告警。
- `20260715030000_admin_management_rebuild` 已应用但未被 Git 跟踪。
- 1 个活跃管理员没有 enabled、未过期的细粒度 RBAC 角色分配。

### UI backlog

静态扫描仍记录 110 个无 class 原生控件和 252 个 inline style，主要集中在用户、课程详情和班级等遗留页。紧急恢复保证共享壳层和 scoped 样式重新生效，但没有冒充全量组件化完成。

## 六、浏览器验收边界

`docs/admin-browser-acceptance.md` 已完成真实管理员登录验收：23/23 条管理路由保持认证且无页面错误/整体溢出/侧栏重叠；六个目标分辨率均通过；侧栏展开/收起、表格容器滚动、Modal、真实数据页面、trace 空态和九类治理有限态均已检查；最终控制台 0 error/0 warning。该证据只签收紧急恢复范围，不给广义阶段 15 “通过”。

## 七、恢复建设前的准入条件

1. **紧急恢复范围已完成**：全部 `/admin` 契约由矩阵/API 覆盖，关键恢复页面和六视口由真实浏览器覆盖；后续新增阶段需另行定义生产、跨浏览器和成功写流程。
2. 跟踪并评审已应用 migration，确认部署仓库与数据库历史一致。
3. 补齐活跃管理员 RBAC assignment，并新增最小权限正反向测试。
4. 为 AI Provider、环境与 trace 提供真实可重复样本；不可用环境保持显式降级。
5. 为每个治理阶段定义独立数据来源、写操作、审计、清理、测试和交互验收。
6. 分批处理 UI backlog，不以再次引入独立全局壳层的方式“统一”样式。

## 八、历史基线说明

最初 `docs/admin-current-state-audit.md` 与旧进度记录描述的是 2026-07-15 02:26 左右的工作区：当时 AI 配置被判定为占位、路由数量较少，并误记工作树干净。紧急恢复复核发现大规模 dirty worktree 和已应用未跟踪迁移，并完成上述基础恢复。旧基线已在原文中保留并标注 superseded，用于审计决策演变，不再代表当前状态。

## 九、证据索引

- `docs/admin-emergency-recovery-progress.md`
- `docs/admin-emergency-recovery-report.md`
- `docs/admin-current-state-audit.md`
- `docs/admin-management-rebuild-progress.md`
- `docs/admin-db-integrity-result.md`
- `docs/admin-route-api-matrix.md`
- `docs/admin-ui-regression-result.md`
- `docs/admin-api-smoke-result.json`
- `docs/admin-api-smoke-write-guard-result.json`
- `docs/admin-browser-acceptance.md`
