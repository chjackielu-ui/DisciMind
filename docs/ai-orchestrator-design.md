# DisciMind 统一 AI Orchestrator 设计

更新日期：2026-07-15

## 目标与边界

统一核心位于 `backend/src/modules/ai-assistant/`，同时服务学生 `#/student/ai-chat`、教师 `#/teacher/ai` 和版本化 `/api/ai-assistant/*`。它复用现有会话、Subject Chat 可恢复运行、教师学情服务、Dify Dataset 知识检索、LangChain MODEL Agent 和成果中心；不新建第二套聊天、知识库或 Agent 市场，也不调用 Dify Agent/Workflow。

## 执行链路

1. `workflow-planner` 解析角色、实时性、复杂度和搜索设置，形成版本 `1.0` 的 Intent/Plan。
2. `skill-registry` 从十项内置 Skill 中匹配最多三项，并仅返回当前角色可用项。
3. `agent-registry` 先解析手动 Agent；未手动指定且允许自动选择时，只从当前用户可调用的 CHAT + MODEL 版本中评分选择。
4. `assistant-orchestrator` 创建 `AiRequestTrace`，按计划执行原生搜索、Agent 和 Function Calling。
5. `tool-registry` 对每次工具调用执行角色、Zod 参数、风险、确认、超时、重试、幂等和循环上限检查。
6. 搜索来源先写 Trace 并发出 `search.sources`；答案增量随后发出 `answer.delta`。
7. 引用归一化后写最终消息；DOCX/XLSX/图表/卡片写 `GeneratedArtifact` 并发出成果事件。
8. 学生链路继续写 `SubjectChatRun/Task/Event/Source` 以保留刷新恢复；教师链路继续兼容 `meta/delta/done`。

## 复用关系

- 统一核心：搜索策略、能力矩阵、事件协议、引用、工具、Skill、Agent、产物、Trace。
- 学生适配：现有九步 Subject Chat 任务、附件、历史、停止、重连和课程上下文不变。
- 教师适配：现有课程/教学班/时间范围权限、三栏暖色布局、历史保存和图表能力不变。
- 旧消息：没有来源、引用、轨迹或成果时按原结构渲染，不要求回填。

## 自动与手动编排

- 手动 Agent 优先，顺序与用户选择顺序一致；非法、越权或非 MODEL 版本明确拒绝。
- 自动 Agent 仅在 `autoAgent !== false` 且没有手动 Agent 时启用，最多选三项，范围由所有权、公开状态和版本状态约束。
- 多 Agent 默认串行；`agentSteps[].dependsOn` 记录依赖，后一个 Agent 的实际输入显式拼接前序输出。请求可声明 `agentExecutionMode=parallel`，含“并行”等明确意图时规划器也会选择并行；并行分支使用 `Promise.all` 独立执行，最终统一综合。
- 每个 Agent 的开始、完成、耗时和失败均写入版本化事件与 Trace。部分分支失败时保留成功结果并交给综合步骤；全部分支失败才使 Run 失败。
- 高风险 Skill 或写文件 Tool 在 `confirmed !== true` 时只返回确认请求，不执行写入。

## 失败与恢复

- 搜索 OFF 不调用外网；AUTO 仅对时效性问题搜索；FORCE 没有真实搜索证据时返回 `AI_SEARCH_NOT_TRIGGERED`。
- Agent、检索和产物错误记录到 Trace；不可恢复错误通过 `run.failed` 返回公共错误码。
- 工具最多 4 轮、8 次调用（可用环境变量收紧），重复签名触发 `AI_WORKFLOW_LOOP`。
- 请求断开会触发 AbortSignal；学生 Subject Chat 仍可凭持久化事件恢复。

## 安全边界

- API Key 只从后端环境/Provider 配置读取，不写请求正文、Trace 或前端。
- 学生不能看到或调用教师学情工具；教师学情服务再次校验课程和教学班授权。
- 知识库与 Agent 均复用后端权限解析，不能靠前端过滤代替。
- 成果下载要求登录、所有权或管理员身份，并再次校验文件状态、路径和 OOXML ZIP 签名。
- ToolRegistry 不开放 Shell、SQL、任意代码执行或客户端提供的 URL 抓取工具。
