# DisciMind 学生/教师通用 AI 加固审计

审计日期：2026-07-15  
审计方式：只读代码索引、Prisma schema 分析、只读数据库目录查询、环境变量名存在性检查。审计脚本不读取或输出任何密钥值。

## 1. 结论

项目已经具备可复用的真实 AI 能力，但分散在学生通用聊天、学科 LangGraph 工作台、教师 AI、智能体市场和文件生成图五条链路中。当前主要缺口不是“没有 Agent”，而是学生与教师缺少共同的搜索策略、Function/Skill 注册、稳定 SSE 事件、搜索来源持久化和引用渲染层。

本轮应在现有 `AiConversation/AiMessage`、`AiRequestTrace/AiTraceStep/AiTraceRetrieval/AiTraceToolCall`、`UserAgent/UserAgentVersion`、`GeneratedArtifact/AsyncTask` 上增量建设统一核心，不新建第二套聊天、Agent 市场、知识库或成果中心。

## 2. 当前架构

### 2.1 学生通用 AI

- 页面：`frontend/src/pages/student-ai-chat.js`，路由 `#/student/ai-chat`。
- API：`/api/ai-chat/conversations/*`；所有模式目前都会进入 `/api/ai-chat/subject-chat/runs` 的可恢复 LangGraph 运行。
- 已有：历史、多轮、图片/文件、语音、`@知识库`、`\智能体`、执行步骤、来源卡片、Agent 调用记录、成果卡片、停止/重试/刷新恢复。
- 服务：`backend/src/services/ai-chat.service.js`、`backend/src/modules/subject-chat/*`、`backend/src/modules/agent-orchestration/*`。
- 已发现问题：基础模型调用仍走 OpenAI 兼容 Chat Completions；没有 `enable_search/search_info`，不存在搜索 OFF/AUTO/FORCE；学生原始 `prepareTurn` 只解析引用，实际执行由 Subject Chat 编排接管，直接流接口不能单独完成知识库/Agent 协同。

### 2.2 教师通用 AI

- 页面：`frontend/src/pages/teacher-ai-chat.js`，路由 `#/teacher/ai`。
- API：`/api/teacher/ai/*`。
- 已有：暖色工作台、课程/教学班/时间范围、教师知识库、教师安全 Agent 列表、真实学情聚合、图表、附件、语音、历史、SSE、保存重试。
- 服务：`backend/src/services/teacher-ai.service.js`；课程、教学班和 Agent 都经过后端权限过滤。
- 已发现问题：事件仍为 `meta/delta/done` 的薄协议；没有可恢复统一 Run、联网搜索、搜索状态、引用角标和完整 Tool/Skill 轨迹；学生与教师各自渲染来源。

### 2.3 模型和 Provider

- `backend/src/services/bailian-openai.service.js` 默认模型为 `qwen3.7-plus`，API Key 只从后端环境变量读取。
- `backend/src/modules/ai/provider.adapter.js` 和管理员 Provider 配置支持数据库配置与环境变量回退，但统一适配器当前只覆盖 OpenAI 兼容 chat/stream/embed/rerank。
- 环境检查仅确认变量名存在：`BAILIAN_API_KEY`、`BAILIAN_BASE_URL`、`BAILIAN_MODEL`、`BAILIAN_TIMEOUT_MS`、`BAILIAN_MAX_RETRIES`、`BAILIAN_ENABLE_THINKING`、`QWEN_API_KEY` 等；没有读取或输出值。
- 缺少 DashScope 原生 Multimodal Generation SSE 客户端，因此无法可靠判断是否真的搜索，也无法提前取得 `search_info.search_results`。

### 2.4 Agent 与 LangChain

- 市场 Agent：`UserAgent/UserAgentVersion`；运行入口在 `agent-runtime.service.js`，MODEL 路径使用 LangChain `ChatOpenAI`，支持流式、知识上下文、长期记忆。
- 编排：`agent-orchestration` 使用 LangGraph，支持顺序执行、结构化工具包装、上限和受控文件生成。
- 当前数据库可用目录：公开/私有 CHAT Agent、系统 `学习讲义生成助手`、`考试试卷生成助手` 和历史测试 Agent。公开 CHAT Agent 的实际运行 Provider 为 MODEL；系统文件 Agent 为 `FILE_GENERATOR`。
- 管理侧 `AiAgentConfig` 当前没有启用记录；本轮不得凭空用它替代真实 `UserAgent`。
- 教师端已在 `teacher-ai.service.js` 做教师向 Agent 后端过滤；必须保留该边界。

### 2.5 知识库

- 数据：`KnowledgeBase`、`KnowledgeDocument`、`KnowledgeDocumentChunk`、审核记录和 Agent 绑定表。
- 权限：`agent-context.service.js` 统一校验所有者、公开范围、课程和教学班。
- 检索：现有知识库通过已配置 Dataset 做真实召回，并保留文档、分片、页码、分数和外链；本轮新 Agent 执行仍复用 LangChain 运行时，不使用 Dify Agent/Workflow。
- 数据库只读检查发现 8 个未删除知识库，其中部分有真实 Dataset/文档，部分为空或待审核；不可把空库伪装为 READY。

### 2.6 文件与成果

- 已有：结构化试卷/学习讲义、HTML 安全预览、DOCX、PDF、独立导出任务、成果中心、所有权下载、学习流关联。
- 已有 `GeneratedArtifact`、`GeneratedArtifactExport`、`AsyncTask`；数据库存在 READY/CONTENT_READY/GENERATING 的真实记录。
- 缺失：XLSX 原生生成、通用图表 JSON 产物、结构化层叠知识卡片。现有前端可渲染 ECharts，但没有统一 Artifact Schema。
- PPTX、Markdown 和图片没有形成可复用的统一生成 Tool，本轮不应伪造支持。

### 2.7 审计和运行记录

- 管理员恢复工作已经新增 `AiRequestTrace`、`AiTraceStep`、`AiTraceRetrieval`、`AiTraceToolCall`，当前表可读且无历史记录。
- 学生 Subject Chat 另有 `SubjectChatRun/Task/Event/Source`，适合保留旧页面恢复语义。
- 复用方案：统一核心写 `AiRequestTrace` 系列表；学生 Subject Chat 同时继续维护既有 Run/Event，教师直接消费统一事件。搜索来源写入 Trace Retrieval，并同步保存到最终 `AiMessage.sourcesJson`，旧消息无需回填。

## 3. 可复用能力

- JWT/角色中间件、教师课程和教学班权限、学生选课权限。
- LangChain/ LangGraph、Agent 版本、手动 Agent 引用、顺序协同和部分失败降级。
- 知识库引用解析、权限校验、真实检索和来源字段。
- `AiConversation/AiMessage` 历史和附件；SSE 读取器。
- `AsyncTask` 任务中心的取消与隐藏语义。
- 系统 DOCX/PDF 文件 Agent、质量检查、成果中心、所有权下载。
- 管理 AI Provider、密钥脱敏和 Trace 基础表。
- 前端 Markdown、DOMPurify、KaTeX、ECharts。

## 4. 缺失能力

- DashScope 原生 Generation SSE、`search_info`、真实搜索发生判定和 15 RPS 本地节流。
- OFF/AUTO/FORCE 和服务端强制策略；统一 SearchOptions 校验和能力裁剪。
- 提前搜索来源、版本化统一 SSE、搜索/模型思考/系统轨迹的明确区分。
- Markdown 安全的 `[ref_n]`/`[n]` 角标渲染与来源联动。
- 面向学生/教师的同一 ToolRegistry、SkillRegistry、AgentRegistry 和 Function Calling 多轮循环。
- Agent 自动匹配、手动优先、半自动补充和结构化 Workflow Plan。
- XLSX、图表、知识卡片三类统一成果。
- Qwen 参数能力探测结果的持久化和前端动态禁用。

## 5. 风险

- qwen3.7-plus 支持基础联网，但所附官方资料没有把它列入 `agent` 搜索策略、freshness、站点限定、自然语言干预或图文混合的支持模型；这些控件必须动态禁用，不能把参数无条件透传。
- 强制搜索可能因 15 RPS 限流而被服务端静默跳过；必须同时检查 `search_info` 或 `usage.plugins.search`。
- 原生搜索与 OpenAI Function Calling 是两种协议；qwen3.7-plus 搜索回答走原生 Multimodal Generation，通用工具循环走兼容工具调用，不能假装兼容接口返回来源。
- 当前工作区包含大量未提交管理员/跨端改动；公共 schema、app、环境示例文件修改必须精确叠加。
- 真实 Agent 数据含历史测试记录；自动选择必须只考虑当前用户可调用且状态有效的版本。
- 工具调用不得直接运行 Shell、代码或 SQL；L2/L3 必须确认，本轮学生不开放 L3。

## 6. 计划修改

### 后端

- 新增 `backend/src/modules/ai-assistant/*`：搜索策略、DashScope 客户端、事件、引用、注册表、规划、Function Calling、统一 Orchestrator、成果工具。
- 扩展学生/教师现有 Controller/Service，仅接入统一核心和兼容事件，不重建会话。
- 新增统一能力路由并挂载到 `backend/src/app.js`。
- 增量扩展 Trace 和 Artifact 字段，新增一条仅 ADD COLUMN/INDEX 的 Prisma migration。
- 更新后端环境示例；不修改真实 `.env`。

### 前端

- 新增共享搜索控件、执行轨迹、来源面板、引用渲染和成果渲染组件。
- 学生页保留冷色布局和现有可恢复 Run；教师页保留暖色三栏教学布局。
- 两端发送同一 SearchOptions，消费同一版本化事件；继续兼容旧 `meta/delta/done`。

### 文档与测试

- 新增统一架构、搜索引用、Function/Skill/Agent、API、测试报告。
- 新增后端专项测试、真实 Qwen 控量探针和前端静态契约测试；最终执行全量后端、前端 build、API、浏览器和残留检查。

## 7. 预计数据结构增量

- `AiRequestTrace`：会话 ID、用户角色、搜索模式、意图 JSON、计划 JSON、上下文 JSON。
- `AiTraceRetrieval`：来源类型、序号、站点、图标、策略、Provider request ID、检索时间。
- `AiTraceToolCall`：重试次数和权限决策。
- `GeneratedArtifact`：来源 Trace、来源 AI Message、生成器和通用 metadata。

所有字段可空或有安全默认值，旧消息和旧成果不回填；迁移不删除字段、不重建表、不清理数据。
