# Function Calling、Skill 与 Agent 注册规范

更新日期：2026-07-15

## ToolRegistry

每项工具必须声明稳定名称、自然语言说明、Zod 输入 Schema、OpenAI JSON Schema、允许角色、风险等级、超时、重试、幂等性和是否需要确认。已注册工具：

| 工具 | 角色 | 风险/确认 | 真实实现 |
| --- | --- | --- | --- |
| `web_search` | 学生/教师/管理员 | 低 | DashScope 原生搜索 |
| `knowledge_retrieve` | 学生/教师/管理员 | 低 | 授权知识库 Dataset 检索 |
| `student_learning_profile` | 学生/教师/管理员 | 中 | 真实课程与学习画像 |
| `wrong_question_summary` | 学生/教师/管理员 | 中 | 真实错题聚合 |
| `teacher_class_analytics` | 教师/管理员 | 中 | 授权课程/教学班学情 |
| `execute_agent` | 学生/教师/管理员 | 中 | LangChain MODEL Agent |
| `create_docx_artifact` | 学生/教师/管理员 | 高/需要 | 真实 DOCX + 成果记录 |
| `create_xlsx_artifact` | 学生/教师/管理员 | 高/需要 | 真实 OOXML XLSX + 成果记录 |
| `create_chart_artifact` | 学生/教师/管理员 | 中 | ECharts 结构化成果 |
| `create_knowledge_cards` | 学生/教师/管理员 | 中 | 可展开问答卡成果 |

Function Calling 支持多轮和同轮多个 tool call。每次调用先解析 JSON、再做 Zod 和角色校验，之后执行超时/最多两次安全重试并写 `AiTraceToolCall`。重复调用签名、超过轮次或调用总数时终止，避免模型循环。

## SkillRegistry

固定 Skill 为：实时信息检索、知识讲解、学生学习诊断、班级学情分析、智慧备课、题目生成、Word 文档生成、Excel 数据表生成、图表可视化、知识卡片。Skill 只描述触发词、角色、工具、工作流、输出和风险，不直接绕过 ToolRegistry 执行。

学生看不到 `class_analytics`、`lesson_preparation` 和 `question_generation`；教师的课程/教学班边界还会在服务层再次校验。题目、DOCX 和 XLSX 等高风险写入先返回确认卡，确认请求携带同一任务内容并设置 `confirmed=true` 后才允许执行。

## AgentRegistry

- 数据源是既有 `UserAgent/UserAgentVersion`，不是新表。
- 只允许 CHAT 且 `runtimeProvider=MODEL` 的 LangChain Agent；新统一路径拒绝 Dify Agent/Workflow 和 FILE_GENERATOR。
- 手动引用先通过 `agent-context.service` 解析所有权、公开状态、版本、课程和角色范围。
- 自动选择只考虑当前用户自己的或公开可用 Agent，按名称、说明、能力、Skill 触发词、评分和使用量排序。
- 手动选择优先且顺序稳定；自动模式最多三项，越权候选安全跳过，手动越权明确报错。

## 产物契约

- DOCX：`AI_DOCUMENT/DOCX/READY`，使用现有 `docx` 库生成真实 OOXML 文件。
- XLSX：`AI_SPREADSHEET/XLSX/READY`，生成最小有效 OOXML ZIP 工作簿并校验签名。
- 图表：`AI_CHART/ECHARTS/CONTENT_READY`，存储类别、系列和图表类型。
- 卡片：`AI_KNOWLEDGE_CARDS/JSON/CONTENT_READY`，存储 front/back 结构并安全渲染。

所有产物记录 `sourceTraceId`、会话、消息、生成器和 metadata；下载不暴露服务器绝对路径。
