# AI 动态路由设计

更新日期：2026-07-15

## 目标与边界

统一 AI 任务中心不再为所有请求创建固定九步。每次运行由 `intent-router.service.js` 先做确定性路由，`workflow-planner.js` 再生成当前请求实际需要的步骤，执行前由 Agent/Skill/Tool Registry 完成能力、角色、上下文和参数校验。高置信的本人数据、图表、文件、联网、附件和问候路由不可被模型改写为学科 Agent。

## 三层路由

1. 确定性快速路由：识别问候、本人数据、学习分析、图表、文件、对话出题、实时联网、附件、知识库和手动 Agent。
2. 模型语义规划：只处理低置信或复合请求；不覆盖第一层的禁止 Agent 约束。
3. 执行前验证：校验 Skill/Agent 能力、角色、上下文、Tool 存在性、参数 Schema、确认门禁和输出类型；可恢复失败只重规划一次。

## 执行模式

| 模式 | 典型任务 | Agent 策略 |
| --- | --- | --- |
| `DIRECT_RESPONSE` | 问候、仅对话出题、缺失附件提示 | 不自动调用学科 Agent |
| `TOOL_ONLY` | 错题、成绩、时长、会话、任务数据 | 只调用 owner-bound Tool |
| `KNOWLEDGE_ONLY` | 仅检索知识库 | 无需 Agent 时不调用 |
| `WEB_SEARCH` | 新闻、天气、最新版本 | DashScope 搜索，不调用学科 Agent |
| `SINGLE_AGENT` | 概念解释、课程知识问答 | 最多一个匹配 Agent |
| `MULTI_AGENT` | 用户显式多 Agent 协作 | 按计划串行或并行 |
| `ARTIFACT_GENERATION` | DOCX/XLSX/PDF 成果 | 先确认，后生成 |
| `LEARNING_ANALYTICS` | 图表化学习分析 | owner-bound Tool + Chart Tool |
| `COMPLEX_WORKFLOW` | 复合任务 | 动态依赖图 |

## 动态步骤示例

- “你好。”：理解问题 → 生成回答（2 步）。
- “查看我最近的错题”：读取登录用户上下文 → 查询本人错题 → 生成分析（3 步）。
- “请以图表形式分析我的学习状态”：读取上下文 → 查询真实数据 → 计算指标 → 构建 ChartSpec → 创建图表 → 文字洞察（6 步）。
- “结合机器学习知识库解释逻辑回归”：识别范围 → 检索指定知识库 → 调用学科 Agent → 生成带来源回答（4 步）。
- “帮我生成一份逻辑回归试卷 DOCX”：识别文件意图 → 等待确认；确认后由持久化文件任务执行内容、质量、导出和保存链路。

`plan.created` 携带真实 `taskDefinitions`；Subject Chat 直接按该数组持久化任务。前端进度分母等于真实任务数，旧固定任务只在旧运行的技术详情中兼容显示。

## 32 条确定性路由矩阵

| 分类 | 输入样例 | intent | 模式 | 关键 Tool/能力 | 步数 |
| --- | --- | --- | --- | --- | --- |
| 直接回答 | 你好。 | greeting | DIRECT_RESPONSE | 无 | 2 |
| 直接回答 | 您好 | greeting | DIRECT_RESPONSE | 无 | 2 |
| 直接回答 | 谢谢 | greeting | DIRECT_RESPONSE | 无 | 2 |
| 直接回答 | 帮我制定一个学习建议 | qa | DIRECT_RESPONSE | 无 | 2 |
| 概念 | 什么是逻辑回归 | concept | SINGLE_AGENT | subject Agent | 3 |
| 概念 | 解释机器学习的基本原理 | concept | SINGLE_AGENT | subject Agent | 3 |
| 知识库 | 结合机器学习知识库解释逻辑回归 | knowledge | SINGLE_AGENT | KB + subject Agent | 4 |
| 知识库 | 根据教材解释注意力机制 | knowledge | SINGLE_AGENT | KB + subject Agent | 4 |
| 例题 | 讲解一道逻辑回归例题 | concept | SINGLE_AGENT | subject Agent | 3 |
| 本人数据 | 查看我最近的错题 | wrong | TOOL_ONLY | `get_student_wrong_questions` | 3 |
| 本人数据 | 分析我最近一个月的学习成绩 | score | TOOL_ONLY | `get_student_score_trend` | 3 |
| 本人数据 | 我的知识点掌握情况怎么样 | mastery | TOOL_ONLY | `get_student_mastery` | 3 |
| 本人数据 | 最近学习时长是多少 | time | TOOL_ONLY | `get_student_learning_time` | 3 |
| 本人数据 | 我的任务完成率 | tasks | TOOL_ONLY | `get_student_task_completion` | 3 |
| 本人数据 | 查看最近学习会话 | sessions | TOOL_ONLY | `get_student_recent_sessions` | 3 |
| 本人数据 | 查看我的学习记录 | records | TOOL_ONLY | `get_student_learning_records` | 3 |
| 上下文 | 当前课程和知识点是什么 | context | TOOL_ONLY | `get_current_student_context` | 3 |
| 图表 | 请以图表形式分析我的学习状态 | analytics | LEARNING_ANALYTICS | mastery + chart | 6 |
| 图表 | 以图表展示我的掌握度 | mastery | LEARNING_ANALYTICS | mastery + chart | 6 |
| 图表 | 分析最近一个月成绩趋势 | score | LEARNING_ANALYTICS | score + chart | 6 |
| 图表 | 用图表展示任务完成情况 | tasks | LEARNING_ANALYTICS | tasks + chart | 6 |
| 文件 | 帮我生成一份逻辑回归试卷 DOCX | file | ARTIFACT_GENERATION | confirmation + DOCX | 2 |
| 文件 | 生成机器学习讲义 PDF | file | ARTIFACT_GENERATION | confirmation + PDF | 2 |
| 文件 | 导出一份学习数据 Excel 文件 | file | ARTIFACT_GENERATION | confirmation + XLSX | 2 |
| 对话出题 | 在对话中给我出五道题，不生成文件 | chat_questions | DIRECT_RESPONSE | 无文件 Tool | 3 |
| 对话出题 | 只在这里给我出三道练习题，不要生成文件 | chat_questions | DIRECT_RESPONSE | 无文件 Tool | 3 |
| 对话出题 | 给我五道题，只在对话中展示 | chat_questions | DIRECT_RESPONSE | 无文件 Tool | 3 |
| 联网 | 今天 AI 领域有什么新闻 | web | WEB_SEARCH | DashScope Search | 4 |
| 联网 | 查询最新 Qwen 版本发布 | web | WEB_SEARCH | DashScope Search | 4 |
| 联网 | 今天北京天气怎么样 | web | WEB_SEARCH | DashScope Search | 4 |
| 附件 | 总结我上传的 PDF | attachment | DIRECT_RESPONSE | attachment gate | 2 |
| 附件 | 分析附件中的课程内容 | attachment | DIRECT_RESPONSE | attachment gate | 2 |

专项自动测试对以上 32 条全部校验 intent、执行模式、Tool 和步骤数；本人数据与图表路由额外断言不存在自动学科 Agent 步骤。

## 失败恢复

- Tool 参数先 preflight；失败产生 `tool.validation_failed`，不产生误导性的 `tool.started`。
- 图表参数支持一次安全规范化/修复；仍失败时复用已查询数据返回表格与文字。
- Agent 不匹配时按能力矩阵重选一次；Agent 超时允许直接模型或候选 Agent 降级。
- 知识库无命中允许直接学科回答，但不会伪造来源。
- 已取得的 owner-bound 数据和检索结果在重规划时复用，不重复查询。
