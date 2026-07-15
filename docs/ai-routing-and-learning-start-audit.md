# AI 动态路由与学习启动链路审计

审计日期：2026-07-15  
审计范围：学生端通用学习助手、Subject Chat 运行编排、Function Calling/Skill/Tool/Agent 契约、图表产物、学习计划 readiness 与启动幂等链路。

## 1. 审计方法与保护边界

- 先读取现有后端服务、SSE/运行状态、Prisma 模型、前端渲染与测试，再进行真实浏览器、数据库只读查询和受控启动复现。
- 未执行 `git reset --hard`、`git clean`、`git checkout` 或 `git restore`；未修改真实 `.env`；未清理真实业务数据。
- 现有工作区包含大量未提交改动。本轮仅在 AI 路由、工具契约、学习启动、对应前端与文档范围内做增量修复。

## 2. AI 失败链路真实证据

### 2.1 浏览器复现

学生会话 68、Subject Chat 运行 `7d14f4d7-ff6c-479c-8715-0c4351b6a3e6` 对问题“请你以图表的形式分析我的学习状态”显示：

- 固定 `9` 个步骤，失败时停在 `5/9（56%）`；
- “调用学科答疑 Agent”耗时约 47 秒后失败；
- 顶部错误为 `工具“create_chart_artifact”参数错误：Invalid input`；
- 后续“整理引用来源 / 检查答案质量 / 生成最终回答”被标记为跳过。

这不是纯前端展示问题：数据库中的运行任务本身就是固定九步，前端只是忠实渲染了持久化任务。

### 2.2 固定九步根因

`subject-chat-run.service.js` 使用模块级固定 `TASK_DEFINITIONS` 创建每一次运行：分析问题、识别范围、读取上下文、读取学生画像、检索知识库、调用学科 Agent、整理来源、质量检查、生成回答。完成率与重试也按固定数组长度计算。

`subject-chat-orchestrator.service.js` 同样按这套固定步骤串行执行，即使通用学习场景的真实工作只需要工具查询或普通对话。因此简单问候、直接数据查询、图表请求都会出现无关步骤，尚未执行的步骤只能被标记为“跳过”。

### 2.3 Agent 误选根因

当前意图路由把问候、通用概念解释、新闻、上传 PDF 总结等大量请求归为低置信度 `learning_qa`。Agent 注册表又对 `learning_qa` 统一增加偏好分，缺少以下硬约束：

- 支持与禁止意图；
- 是否允许数据查询、图表、联网、附件、文件生成；
- 必需上下文与可选上下文；
- 角色权限、超时和降级策略；
- 自动选择阈值与“直接工具路径禁止自动 Agent”的规则。

受控路由矩阵显示：`你好`、`什么是逻辑回归`、联网新闻、上传 PDF 总结均自动选中 Agent 1、14、17。真实失败运行进一步记录了 Agent 1“机器学习概念助手”和 Agent 14“蓝鲸复习法资料助手”的串行调用；后者与当前请求无关。学科 Agent 因而被错误地当成通用兜底。

### 2.4 当前十类请求路由基线

| 请求 | 当前结果 | 问题 |
| --- | --- | --- |
| 你好 | `learning_qa` + 3 个 Agent | 问候不应调用 Agent |
| 什么是逻辑回归 | `learning_qa` + 3 个 Agent | 未按概念/知识库需求精确路由 |
| 请引用知识库解释逻辑回归 | knowledge skill + 3 个 Agent | 可检索，但 Agent 选择过宽 |
| 查看最近错题 | 错题工具 | 方向正确，但计划仍混入多余 skill/综合步骤 |
| 分析最近一个月学习成绩 | `learning_qa` + 联网 + 3 个 Agent | 时间窗数据意图被误判为实时联网 |
| 用图表展示知识点掌握度 | 掌握度工具 | 缺少统一图表后处理契约 |
| 生成试卷 | 文件确认 | 方向正确 |
| 在对话中出五道题，不生成文件 | 文件确认 | “不生成文件”否定意图未被识别 |
| 联网查询 AI 最新新闻 | 联网 + 3 个 Agent | 联网路径不应自动调用学科 Agent |
| 总结我上传的 PDF | `learning_qa` + 3 个 Agent | 附件能力与缺失附件确认未建模 |

## 3. `create_chart_artifact` 契约审计

### 3.1 已确认的失败链路

统一 AI 运行 `b2b021c8-93ea-4a18-90b2-15d3c572ee9b` 及重试运行 `0ccf390c-d470-4015-81d8-f2d14891e65d` 均在 `create_chart_artifact` 校验失败。Subject Chat 将底层 `AI_TOOL_VALIDATION_FAILED` 转换成运行失败，最终呈现为通用的 `Invalid input`。

### 3.2 契约问题

- 工具注册给模型的 JSON Schema 只声明 `spec` 是 object，没有声明内部必填字段、数组结构和数值类型；模型无法可靠构造参数。
- 后端 Zod 契约主要接受旧式 `chartType/categories/series`，而需求侧和模型常见输出还会使用 `type/labels/datasets/values/dataPoints/xAxis`；当前无统一 normalizer。
- `tool.started` 在参数预校验之前发出，造成 UI 显示“工具已启动”，实际却尚未通过契约。
- 参数校验失败发生在审计持久化之前，失败调用的原始参数未进入 `AiTraceToolCall`。因此本次历史失败无法从数据库恢复“原始入参全文”；只能确认工具名、调用 ID 和校验错误。这是可观测性缺口，修复必须让后续失败记录脱敏参数摘要与字段级错误。
- 错误只返回 `Invalid input`，缺少 `toolName / argumentPath / expectedType / receivedType / receivedValueSummary / recoverable / requestId`。

### 3.3 目标标准契约

后续统一为：

```json
{
  "version": "1.0",
  "chart": {
    "type": "bar",
    "title": "知识点掌握度",
    "subtitle": "最近 30 天",
    "xAxis": ["逻辑回归", "线性回归"],
    "series": [{ "name": "掌握度", "data": [90, 72] }],
    "unit": "%"
  },
  "table": {
    "columns": ["知识点", "掌握度"],
    "rows": [["逻辑回归", 90], ["线性回归", 72]]
  },
  "insights": ["逻辑回归掌握度最高"],
  "source": { "type": "student_mastery", "range": "P30D" }
}
```

Normalizer 只负责把受支持的别名安全转换到此契约；缺少关键数据时不猜造。图表创建不可恢复失败时降级为可读表格和文字总结，并明确标注降级原因。

## 4. 学习启动 500 审计

### 4.1 浏览器与数据库复现

当前学生计划 4 处于 `READY`，预加载记录为 `PARTIAL`：内容已成功、音频因 `TTS_UPSTREAM_ERROR` 未完成。浏览器连续两次点击“开始学习”均收到：`服务器暂时无法完成请求，请稍后重试`。

直接调用真实 `studentLearningPlanService.start(4, 3)` 得到 Prisma `P2002`：

- 约束：`student_learning_plans_learning_session_id_key`；
- 冲突 session：50；
- 失败位置：`student-learning-plan.service.js` 的计划同步更新。

### 4.2 根因

计划 4 与历史计划 2 共享学习目标 16。目标 16 已有关联的完成态学习会话 50，而 session 50 已被计划 2 的 `learningSessionId` 占用。当前 `resolveSessionForPlan()` 只按学习目标复用既有会话，没有判断：

- 会话是否已被另一计划占用；
- 会话是否完成/废弃；
- 当前计划是否应进入旧结果页还是创建新一轮；
- 并发启动时计划与会话绑定是否具备数据库级幂等语义。

随后 `syncPlanToSession()` 尝试把 session 50 再绑定给计划 4，触发唯一约束。现有 `P2002` 恢复逻辑只覆盖 `learning_sessions.learning_goal_id` 的并发创建，不覆盖计划侧唯一绑定。

### 4.3 Readiness 问题

前端 readiness 已能显示“部分完成”，但启动接口本身没有执行结构化 readiness 校验。内容成功而音频失败时，产品允许降级开始；关键内容失败时则应返回明确的 readiness 错误，不能统一转换为 500。

### 4.4 目标错误模型

启动接口需要区分并返回稳定业务码和 `requestId`：

- `PLAN_NOT_READY`
- `PRELOAD_BLOCKED`
- `SESSION_CONFLICT`
- `SESSION_COMPLETED`
- `PLAN_ALREADY_STARTED`
- `START_DEPENDENCY_UNAVAILABLE`

同一计划重复或并发开始必须返回同一会话；完成态会话必须明确进入结果页或创建新一轮，不能再次写入冲突绑定。

## 5. 修复验收边界

本轮将以以下可执行证据作为完成条件：

1. 动态路由至少覆盖 30 个请求案例，并验证执行模式、工具、Skill、Agent 与步骤数。
2. 工具参数先 preflight，再发 `tool.started`；失败记录字段级详情与脱敏原始参数摘要。
3. 图表合法参数成功，常见别名可规范化，非法参数返回详细错误，可恢复失败执行一次安全修复重试，不可恢复失败降级为表格/文字。
4. 学习启动覆盖普通开始、重复开始、并发开始、部分预加载、关键预加载失败、已完成、孤儿关系和唯一约束冲突。
5. 后端定向测试、全量测试、前端构建、真实 API/数据库检查和 1440×900、1024×768、390×844 浏览器验收均需真实执行；任何外部依赖失败单列为阻塞，不伪造通过。

## 6. 修复后结论

- 固定九步已由动态 plan/taskDefinitions 替换；新运行只持久化真实需要的步骤。
- Agent Registry 已补齐允许/禁止意图和完整能力元数据；高置信本人数据、图表、问候、文件、联网与附件任务存在硬禁止学科 Agent 规则。
- ChartSpec 统一为 1.0；preflight 在 `tool.started` 之前，参数错误带字段路径和安全摘要；不可恢复图表错误保留表格/文字。
- 自然语言“机器学习知识库”会解析到当前用户有权访问的真实知识库，检索来源贯通 Trace、Run、消息和来源卡片。
- 学习计划 4 不再错误复用已被计划 2 占用的完成态 session 50；新一轮 goal 30/session 51 合法绑定。并发启动复用同一 session，PARTIAL/TTS 失败按可降级项处理。
- 最终结果：相关专项 50/50、后端全量 503/503、前端 963 modules、Prisma validate/migrate status、真实 Qwen/数据库/浏览器均通过；测试数据残留为 0。
