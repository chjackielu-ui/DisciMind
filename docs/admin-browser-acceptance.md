# 管理端真实浏览器验收报告

> 日期：2026-07-15（Asia/Shanghai）  
> 运行环境：本机 Vite `http://127.0.0.1:5173` + 后端 `http://127.0.0.1:3000` + MySQL  
> 浏览器：Codex 应用内浏览器，真实管理员登录态  
> 结论：**本轮统一导航与视觉版本终验通过**。新版正式管理入口在 1440×900 完成 19 个真实页面/状态逐页点击验收，并在 1366×768、1024×768 覆盖六个一级模块；33/33 个结构化检查通过，应用自身 Console error/warning 为 0。

## 0. 本轮统一导航与视觉版本的终验状态

2026-07-15 已使用 Codex 应用内浏览器直接访问本机 Vite 页面并完成真实管理员登录。验收全程通过页面按钮和链接导航，没有使用整页 URL 跳转绕过会话，也没有读取或修改浏览器存储。

| 分辨率 | 覆盖 | 结果 |
|---|---|---|
| 1440×900 | Dashboard；学生/教师/管理员；课程及真实课程详情；行政班/教学班；供应商/模型/环境；知识文档/智能体审核/知识库审核/举报；权限/通知/日志/个人信息 | 19/19 页面或状态通过 |
| 1366×768 | Dashboard 与用户、教学、AI、内容审核、系统六个一级模块落地页 | 6/6 通过 |
| 1024×768 | 同上六个一级模块展开态；Dashboard 展开/折叠及跨页保持 | 8/8 通过 |

所有 33 个检查均满足：`scrollY=0`、主内容顶部 20 px、根节点和 body 横向溢出 0、侧栏与主区不重叠、正式模块仅有一个持久二级导航、旧版重复子导航为 0、无可见 alert/请求失败/`undefined`。1440/1366 展开态侧栏右缘 270 px、主区 x=294；1024 折叠态侧栏右缘 100 px、主区 x=124。

真实交互发现并修复了两处导航细节：异步路由渲染完成后再次复位页面滚动；侧栏固定/收起在长页面和自动聚焦时保持稳定滚动位置。1024 下最终复验展开、收起均为 `scrollY=0`，并恢复为验收前的折叠状态。

最终浏览器日志中应用代码自身为 0 error/0 warning。日志缓冲区保留 2 条早期 Vite 开发客户端 WebSocket 连接错误，均来自 `/@vite/client`，不属于业务页面或接口异常；未发现 `Failed to load resource` 形式的 404/500。浏览器接口未提供独立 Network 面板导出，因此接口侧另以当前后端的 25/25 只读烟测和 27/27 写保护烟测确认 0 个 404/500，不把 API 烟测伪称为 Network 面板截图。

结构化证据：`artifacts/admin-recovery/final-visual-20260715/browser-acceptance-results.json`。

新版截图：

- `artifacts/admin-recovery/final-visual-20260715/dashboard-1440x900-expanded.png`
- `artifacts/admin-recovery/final-visual-20260715/users-1440x900.png`
- `artifacts/admin-recovery/final-visual-20260715/ai-config-1440x900.png`
- `artifacts/admin-recovery/final-visual-20260715/agent-reviews-1440x900.png`
- `artifacts/admin-recovery/final-visual-20260715/dashboard-1366x768-expanded.png`
- `artifacts/admin-recovery/final-visual-20260715/dashboard-1024x768-expanded.png`
- `artifacts/admin-recovery/final-visual-20260715/dashboard-1024x768-collapsed.png`

以下章节保留紧急恢复和功能封板阶段的历史基线证据，便于对照，不替代上面的新版终验。

## 1. 历史基线：视口与布局证据

| 视口 | 验收页面 | 页面级横向溢出 | 侧栏 / 主区 | 表格行为 | 截图 |
|---|---|---:|---|---|---|
| 1920×1080 | 驾驶舱（展开、收起）与通知 | 否（1914/1914） | 展开：侧栏右缘 270、主区 x=294；收起：右缘 100、主区 x=124 | 通知表 1700/1700，无内部溢出 | `dashboard-1920x1080-*-final.png`、`notifications-1920x1080-final.png` |
| 1600×900 | 通知 | 否（1594/1594） | 侧栏右缘 100、主区 x=124 | 1380/1380 | `notifications-1600x900-final.png` |
| 1440×900 | 通知 | 否（1434/1434） | 侧栏右缘 100、主区 x=124 | 1220/1220 | `notifications-1440x900-final.png` |
| 1366×768 | 通知 | 否（1360/1360） | 侧栏右缘 100、主区 x=124 | 1146/1146 | `notifications-1366x768-final.png` |
| 1280×720 | 通知 | 否（1274/1274） | 侧栏右缘 100、主区 x=124 | 1060/1060 | `notifications-1280x720-final.png` |
| 1024×768 | 通知、个人中心入口 | 否（1018/1018） | 侧栏右缘 100、主区 x=124 | 容器 804、内容 920；仅容器内横向滚动 | `notifications-1024x768-final.png` |

1600×900 下抽样的交互控件高度为：输入框 43 px、下拉框 41 px、按钮 38 px；控件没有被截断。各视口截图均在页面顶部、首屏、真实登录态下采集。

## 2. 路由与真实数据检查

浏览器逐页检查了路由表中的全部 23 条管理路由：

| 路由组 | 已打开路由 | 运行时结论 |
|---|---|---|
| 基础管理 | `/admin/dashboard`、`/admin/users`、`/admin/courses`、`/admin/courses/1`、`/admin/classes`、`/admin/knowledge`、`/admin/logs`、`/admin/notifications`、`/admin/profile`、`/admin/agent-reviews` | 均保持管理员登录态；标题和真实数据/空态存在；无页面错误、整体溢出或侧栏重叠 |
| AI 配置与证据 | `/admin/ai-config`、`/admin/agents`、`/admin/environment`、`/admin/traces` | DB-backed 配置或明确空态/环境状态；无密钥回显；trace 无样本时显示真实空态 |
| 恢复隔离治理 | `/admin/learning-flows`、`/admin/evaluations`、`/admin/experiments`、`/admin/knowledge-health`、`/admin/teaching-issues`、`/admin/digital-twin`、`/admin/assets`、`/admin/strategy-profiles`、`/admin/risks` | 全部明确标记“恢复隔离 · 有限功能”，真实 overview/list 显示且不伪造完整业务 |

汇总结果：23/23 保持认证，0 个错误文本页，0 个页面级横向溢出，0 个侧栏/主区重叠，0 个 Console warning/error。去除页面正文后的结构化结果保存于 `artifacts/admin-recovery/admin-route-browser-result.json`。

关键数据抽查如下：

- `/admin/dashboard`：契约显示 `admin-dashboard.v1`；浏览器验收当时真实计数为用户 12、学生 10、教师 1、课程 4、班级 10、有效知识文档 16、今日 AI 调用 0、待审核文档 1、未读通知 27。数据库状态可用；5 个启用供应商均未确认可用，因此总状态诚实显示“部分受限”。
- `/admin/users`：12 条真实用户；汇总为学生 10、教师 1、管理员 1、禁用 0。
- `/admin/courses`、`/admin/courses/1`、`/admin/classes`：4 门课程；机器学习课程详情正确展示 3 章、10 个知识点、2 个教学班、1 位教师；管理班级页展示 2 条真实记录。
- `/admin/agent-reviews`、`/admin/knowledge`、`/admin/logs`：真实审核、知识文档与管理日志均可读取，无静默空列表替代错误。浏览器验收未留下知识列表的可复核 `total`，因此本报告不补写该页当时的列表总数。
- `/admin/notifications`：54 条真实记录、15 类通知枚举、真实分页。接收人筛选 `student_demo` 返回 4 条；发送弹窗可打开和关闭，本次浏览器验收没有提交写入；“全部标记已读”没有被触发。
- `/admin/ai-config` 及其供应商、模型、Agent、环境标签：5 个环境型供应商可见；模型与 Agent 无记录时显示明确空态；数据库、加密、LibreOffice、LangGraph checkpoint、Chromium PDF、语音为可用，Qdrant 与 Dify 明确为不可用；供应商卡只显示公开服务 URL 与密钥配置状态/末四位，不回显明文密钥，环境页不展示本机真实路径。
- `/admin/profile`：真实账户资料可读取；修复后的共享侧栏头像区实际点击可进入个人中心。
- `/admin/traces`：真实接口为空时显示“暂无 AI 请求轨迹”，不构造模拟轨迹。
- `/admin/risks`：页面明确显示“恢复隔离 · 有限功能”，真实记录为 0，未伪装为完整治理中心。

`/admin/traces` 与治理扩展页按恢复设计不在主导航暴露，本次使用受认证的地址导航逐页验证；其全部后端契约另由 API smoke 与路由矩阵覆盖。重启 3000 端口后的最终 API smoke 为 25/25，无 required/optional 失败，知识列表 `total=16`，未出现 404/500；浏览器各页也未显示请求失败、401/403、404 或 500 状态。

## 3. 交互与诊断

- 侧栏固定展开/收起均实际点击验证；1920×1080 下对应宽度为 250 px / 80 px，主内容留白同步变化。
- 管理员头像入口原先只处理学生角色，已补齐 admin、teacher、student 的各自资料路由；1024×768 展开侧栏后实际点击到达 `/admin/profile`。
- 用户表初次截图发现 1440 宽度下学院/专业被过度压窄，随后改为最小 1580 px 的表格与容器内滚动，并固定右侧操作列。复验：1440 下容器 1268/1666、1024 下 852/1666，页面本身均无横向溢出，操作列保持可见。
- 1024×768 下实际打开“新建用户”Modal：580×657 px，边界为 x=219..799、y=56..712，完整位于视口内；取消关闭后未产生写入。
- 通知搜索、接收人筛选、刷新、分页和发送弹窗均使用页面控件操作；没有通过脚本篡改页面状态。
- 六视口首轮日志为 14 条 Vite debug 连接消息；最终 23 路由遍历后的定向检查仍为 0 error、0 warning。
- 验收结束后已恢复默认视口并关闭测试标签页。

## 4. 截图索引

截图目录：`artifacts/admin-recovery/`

- `dashboard-1920x1080-expanded-final.png`
- `dashboard-1920x1080-collapsed-final.png`
- `notifications-1920x1080-final.png`
- `notifications-1600x900-final.png`
- `notifications-1440x900-final.png`
- `notifications-1366x768-final.png`
- `notifications-1280x720-final.png`
- `notifications-1024x768-final.png`
- `users-1440x900-final.png`
- `courses-1440x900-final.png`
- `classes-1440x900-final.png`
- `agents-1440x900-final.png`
- `agent-reviews-1440x900-final.png`
- `knowledge-1440x900-final.png`
- `system-config-1440x900-final.png`
- `environment-1440x900-final.png`

## 5. 诚实边界

- 浏览器签收后才在最终数据对账中发现知识列表遗漏 `deleted_at: null`；该后端查询修复由 2 条新增回归、426/426 全量测试和重启后 25/25 API smoke 签收，未倒推为“已在浏览器中重测列表总数”。
- Qdrant、Dify 与 AI 供应商运行可用性尚未在当前环境确认；驾驶舱因此保持 degraded，而不是显示虚假健康。
- trace/治理扩展面是恢复隔离的有限读取界面，细粒度权限、完整分页和领域动作仍属于冻结的 0–15 重建范围。
- 浏览器验收证明当前本地恢复环境；它不替代生产环境部署、外部供应商连通性或跨浏览器兼容认证。
