# AI 与多智能体设计

> 当前实现状态：已落地。统一运行时采用 LangChain + LangGraph；历史 Dify 字段仅用于旧数据兼容，不再作为新多智能体链路。

## 1. 总体架构

DisciMind 将教学任务拆分为 Planner、Skill、Agent、Tool、Knowledge 和 Trace 六层：

1. Workflow Planner 识别角色、意图、时效性、复杂度和串并行需求。
2. Skill Registry 在角色允许范围内选择最多三个能力流程。
3. Agent Registry 解析用户手动选择，或从可调用的 MODEL Agent 中自动匹配。
4. Tool Registry 对参数、角色、风险、确认、超时、重试和幂等执行统一约束。
5. LangGraph 运行多个 Agent，并对部分失败、取消、超时和恢复进行状态管理。
6. 最终答案、引用、事件、工具审计和生成成果写入数据库 Trace。

## 2. 主要智能体

| Agent | 作用 | 主要源码 |
| --- | --- | --- |
| Explainer | 分层知识讲解和知识库引用 | `backend/src/modules/learning-agent/agents/explainer.agent.js` |
| Diagnostician | 学情、错题和薄弱点诊断 | `backend/src/modules/learning-agent/agents/diagnostician.agent.js` |
| Trainer | 递进训练与反馈 | `backend/src/modules/learning-agent/agents/trainer.agent.js` |
| Lesson Plan Agents | 教案采集、分析和生成 | `backend/src/modules/learning-agent/agents/lesson-plan-*.agent.js` |
| User MODEL Agent | 智能体广场中的自定义版本化 Agent | `backend/src/modules/agent-chat/`、`backend/src/modules/agent-marketplace/` |
| File Generator | 讲义、试卷、DOCX、PDF、PPT 等成果 | `backend/src/modules/file-generator/` |

## 3. 编排模式

- 默认串行：后一个 Agent 显式接收前一个 Agent 的结果。
- 明确并行：独立分支通过 `Promise.all` 执行，随后统一综合。
- 部分失败：保留成功分支；全部失败才使运行失败。
- 可恢复运行：事件、状态、心跳和检查点持久化，页面刷新后可继续读取。
- 写入确认：DOCX、XLSX 等高风险工具必须先返回确认请求。

## 4. 模型与知识库

- 模型适配：阿里云百炼 OpenAI 兼容接口。
- 本地知识链路：文件解析、数据库向量或 Qdrant、权限检索。
- 远程知识链路：可绑定百炼知识库/应用 ID，由后端统一中转。
- 前端从不直接持有模型或知识库密钥。

配置模板位于 `backend/.env.example` 和 `deploy/model/bailian.env.example`。提交包不包含模型权重和第三方密钥。

## 5. 安全边界

- Tool Registry 不开放任意 Shell、SQL、任意代码执行或客户端 URL 抓取。
- 学生、教师、管理员分别受 Skill、Tool、课程、班级和知识库授权约束。
- Agent、知识库与成果下载均在后端校验所有权，不能依赖前端隐藏。
- 工具循环、调用数量、并行数、输出大小和总时长均有硬限制。
- C/Python 用户代码只在 Judge0 isolate 沙箱内执行，不属于 Agent Tool 权限。

详细源码映射见 `docs/多智能体源码与运行说明.md`，协议与状态机见 `docs/ai-orchestrator-design.md` 和 `docs/ai-function-skill-agent.md`。
