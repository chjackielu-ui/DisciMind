# DisciMind 智能体平台与学习准备体系二期进度

> 本文件用于任务中断恢复。每完成一个阶段或出现阻塞时更新。

## 2026-07-15 AI 对话、本人学习数据与 Trainer 知识卡片（完成）

- 统一身份上下文：新增认证用户派生 `UserContext` 和 8 个 owner-bound 学习数据 Tool；学生请求不接收 studentId，宽泛分析不默认取首门课程，所有无数据场景返回真实空态与来源。
- 确定性路由：高置信文件意图进入系统试卷/讲义 Agent，学习分析先执行真实数据 Tool；通用、学科和 Agent 模式继续复用 Subject Chat 九步运行，不创建第二套聊天栈。
- 文件闭环：完整需求不再重复规划；复用 `AsyncTask.WAITING_EXTERNAL` 与会话运行态提供刷新可恢复确认卡，支持 generate/preview/modify/cancel，确认后幂等进入现有 GeneratedArtifact/导出图，完成后原卡显示预览与下载。
- 学习分析：严格 `ChartSpec 1.0` 包含 metric、unit、range、source、series 和 table；前端只安全映射 ECharts，支持表格、全屏、保存 PNG 和解释性空态。真实数据中一条 204.44% 源记录已单列为数据质量异常。
- Trainer 等待体验：新增通用/个性化两层原子 JSON 卡片缓存、SWR 重新排队和即时回退；复用 `LEARNING_FLOW_PRELOAD` Worker，学习会话打开/节点进入/Trainer 启动并行预热。卡片支持翻页、展开、收藏、保存和掌握状态，不写 LangGraph checkpoint。
- 前端：共享输入工具栏改为本地 SVG+紧凑标签/ARIA，保留知识库、Agent、文件、语音、停止和联网模式；学生冷色/教师暖色主题与既有统一输入链不变。
- 验收：专项 22/22；后端全量 479/479；前端 build 963 modules；Prisma validate/status 退出码 0；`git diff --check` 通过。真实 Qwen 学习分析约 2.1 秒并产出图表；真实试卷生成约 82.7 秒，DOCX HTTP 200、13,966 bytes、ZIP/MIME 有效；学习会话 50 返回 5 张 READY 卡片。
- 浏览器：1440×900、1024×768、390×844 下图表、数据表、持久文件成果卡和知识卡片通过，无页面横向溢出，Console 0 error；手机端翻页和展开真实可用。
- 缓存失效回归：全量测试改变知识版本哈希后，两层缓存正确进入 stale；真实 GET 触发 SWR，约 17.7 秒后通用/个性化重新 READY 并合并 5 张卡片。
- 清理：删除 2 个验收会话、4 个验收成果、3 个导出、54 条本轮探针/全量测试/刷新任务、对应 DOCX、3 个临时脚本、重复缓存和测试展开状态；会话 50 恢复 PAUSED，保留最新 READY 卡片缓存。未删除真实历史学习数据。
- 工作区保护：保留既有 admin/跨端 dirty worktree；未执行 reset/clean/checkout/restore，未改真实 `.env`，未重建数据库，未安装依赖。

## 2026-07-15 学生/教师通用 AI 加固（完成；Dify Dataset 本地上游 502 单列）

- 已完成只读审计并生成 `docs/ai-assistant-hardening-audit.md`。根因是学生 Subject Chat、教师 AI、知识库、LangChain Agent 和成果中心的真实能力分散，缺少共用搜索策略、注册表、事件协议与引用层；本轮以增量核心复用原链路，没有新建第二套聊天、市场、知识库或成果中心。
- 后端新增统一 `ai-assistant` 模块：qwen3.7-plus DashScope Multimodal Generation 原生搜索、OFF/AUTO/FORCE、能力矩阵与裁剪、版本化 SSE、来源/引用、Tool/Skill/Agent Registry、多轮 Function Calling、Trace、DOCX/XLSX/图表/知识卡片成果和所有权下载。新路径只执行 LangChain MODEL Agent，不调用 Dify Agent/Workflow；知识库继续复用既有 Dataset 检索。
- 学生端继续使用可恢复的九步 Subject Chat 并同步统一 protocol 事件；教师端继续使用课程/教学班/时间范围真实上下文与旧 `meta/delta/done` 兼容事件。两端复用搜索控件、来源、引用、轨迹和成果组件，旧消息无新字段时正常降级。
- 增量 migration `20260715110000_ai_assistant_hardening` 已通过 format/validate/generate 并由 `prisma migrate deploy` 应用。迁移后真实 Trace/Tool Audit/Artifact/XLSX 写读通过，临时数据库记录和文件已精确清理。
- 自动化：专项 13/13、后端全量 466/466、前端 Vite build 961 modules 通过；Prisma validate 与 48 migrations 最新状态通过。真实 Qwen 控量探针确认原生搜索发生、10 个来源、引用和 Function Calling；text-generation 的真实 `InvalidParameter: url error` 已纠偏为 multimodal-generation。
- 真实编排：学生错题 DOCX、教师学情 XLSX/ECharts、知识卡片、两 MODEL Agent 真串行（B 输入含 A 输出）和真并行（独立输入、并发执行、统一综合）均通过；测试 Trace、会话、Run、成果和文件已精确清理。
- 浏览器：新 Chrome 标签恢复交互后，两端在 1366×768、1440×900、1920×1080 三个实际视口均无横向溢出；教师 FORCE 来源先出、引用联动、轨迹和 Console 0 error 通过；学生 9/9、来源先于正文、刷新恢复和 Console 0 error 通过。学生新闻提示带验收前缀时触发现有学习域拒答，搜索与恢复通过但正文质量不计通过。
- 外部阻塞：显式知识库且搜索 OFF 的真实调用已进入 `knowledge_retrieve`，但当前本地 Dify Dataset `http://localhost/v1` 返回 HTTP 502；未伪造检索结果，按现有契约降级并保留回答。
- 工作区保护：发现并保留大量既有管理员与跨端 dirty worktree；未执行 reset/clean/checkout/restore，未修改真实 `.env`，未删除真实业务数据。

## 2026-07-12 最后闭环阶段 1：学习目标与准备（完成）

- 精确复现并修复 `StudentLearningContext` PUT 500：学情快照错误使用 `LearningFlowResourceLink.userId`，实际 Prisma 字段为 `ownerUserId`；空 GET 返回默认结构，首次保存继续使用 upsert，服务级保存/再读有效且 `contextHash` 为 64 位。
- 上下文校验已细分为课程权限 403、非法知识点 400、目标不存在 404、目标/范围冲突 409、工作流不可见 403、工作流/范围冲突 409；JSON 写入先移除 `undefined`，统一错误日志保留 requestId，生产 500 响应不暴露 Prisma 堆栈或本机路径。
- 学生导航已移除独立“当前学习上下文”；旧 `#/student/learning-context` 保留并重定向到 `#/student/learning-flows?panel=learning-plan`。
- 学习流中心新增紧凑“学习目标与准备”摘要与三级向导：课程→课程内知识点、当前范围可用目标/自然语言创建、按范围/目标/可见性排序的工作流；课程或知识点变化会清空下游选择，高级配置默认折叠。
- 学习准备、开始学习、课前讲义和智能推荐共享同一 `StudentLearningContext`；缺失时在当前页打开向导。讲义安全预填包含目标掌握度、学习偏好、学生掌握度、薄弱点、已绑定资料数与服务端 contextHash。
- `StudentLearningContext.contextHash` 已纳入 preload 的学生上下文哈希；目标或偏好变化会让旧 preload 失效。学习流 LangGraph 核心、runtime、checkpoint、execution protocol、节点推进和会话状态机未修改。
- 按要求只执行一次最小 HTTP smoke；该次成功验证 GET 空结构并暴露 PUT 的真实字段错误，修复后未重复整套 smoke，改用服务级 PUT→GET 确认保存、读取、快照和哈希均成功。

## 2026-07-12 最后闭环阶段 2：DOCX/PDF 导出闭环（完成）

- Artifact 内容状态与 DOCX/PDF Export 状态已解耦；每格式独立进入 `EXPORTING/READY/FAILED`，Artifact 仅按“内容存在且至少一个 READY Export”汇总为 READY，单格式失败不会覆盖另一格式 READY。
- 导出请求按 Artifact+format 查找并复用 READY 文件或活跃任务；FAILED/CANCELLED/缺文件场景重置同一格式任务。任务创建补充唯一键并发冲突回读，双击不会创建重复任务，也不会重新调用内容生成模型。
- Worker 成功后写入格式状态、受保护 storagePath、fileSizeBytes、MIME、lastAccessedAt，并将任务置为 SUCCEEDED；失败只写当前格式安全错误并将对应任务置为 FAILED，Artifact 内容与其他格式保留。
- 所有新文件生成/导出任务 resultUrl 已改为统一产物详情，并携带 `?format=DOCX|PDF` 高亮；旧生成文件任务 URL 仍在白名单中保持兼容。
- 下载严格校验 owner、Export 属于 Artifact、READY、受保护目录、文件存在、数据库 MIME 与 DOCX/PDF 文件签名一致；下载后更新 Export 与 Artifact 最近访问时间，API 序列化不暴露 storagePath。

## 2026-07-12 最后闭环阶段 3～4：产物中心与任务批量清理（完成）

- 学生侧新增独立“产物”导航和 `#/student/artifacts` 列表/详情；原 `#/student/generated-artifacts` 及详情路由兼容跳转，不创建第二套 Artifact 数据或页面。
- “我的产物”支持讲义/试卷/生成中/可下载/失败/已加入学习流筛选，按标题、课程、知识点、来源智能体搜索，并支持最近生成、最近访问、文件大小和标题排序。
- 卡片显示来源智能体、课程、知识点、内容状态、DOCX/PDF 独立状态和学习流关联；提供预览、双格式下载/单格式重导、加入学习流、来源对话和删除。
- 详情每次进入均重新请求 Artifact，包含生成要求、安全 iframe HTML 预览、来源智能体/会话、课程/知识点/学习目标、双格式 Export、学习流关联、时间、AI 声明和知识库来源说明；任务格式参数会高亮并只默认勾选失败格式。
- “使用生成助手”进入智能体广场并固定 `agentType=FILE_GENERATOR`，页面显示“文件生成智能体”筛选标签，仍可继续用能力标签筛选讲义、试卷、DOCX、PDF 和知识库增强。
- 新增 `POST /api/tasks/dismiss-terminal`，默认仅批量设置当前用户 SUCCEEDED/FAILED/CANCELLED 的 dismissedAt，幂等跳过已清除记录，不影响运行中任务或其他用户。
- 任务中心仅在存在终态任务时显示“清除已结束任务”，带指定二次确认；成功后同步清理本地隐藏快照并立即刷新。导出任务文案与操作已改为“正在导出/已生成/导出失败”“查看产物/重新导出”。

## 2026-07-12 最后闭环阶段 5：系统助手核验与智能体广场（完成）

- 数据库只读核验：`system_study_handout_generator`、`system_exam_paper_generator` 均为系统内置 FILE_GENERATOR，Agent 状态/可见性为 PUBLIC，当前公开版本为 APPROVED，各绑定 3 个真实公开知识库。
- 本轮唯一一次 Dify retrieve 成功：所用知识库 `marketplace_visibility=PUBLIC`、`marketplace_status=PUBLIC`、`status=active`、真实 Dataset 已配置；返回 1 个含正文片段。未再次调用 Dify，也未伪造 Dataset、READY、引用或检索结果。
- 智能体广场卡片重排为头像/名称/系统与类型标识/Portal 更多菜单、三行简介、限量能力标签与 `+N`、知识库和导出能力、使用/评分/更新时间、统一主操作；CHAT 显示“立即对话”，FILE_GENERATOR 显示“生成文件”。
- 搜索输入、清空、独立搜索按钮、带数量筛选按钮、可删除筛选标签、行内排序和筛选抽屉完成；桌面 3 列、中等 2 列、移动 1 列，热门榜保持 sticky 且中窄屏回到正常文档流。
- 卡片等高、轻微 hover、统一低饱和配色与按钮层级已完成；更多菜单继续使用 body Portal，支持外部点击/Esc/滚动/resize/路由关闭、底部翻转和移动端宽度约束。

## 2026-07-12 产品体验优化与系统助手补全（功能开发完成，待统一验收）

- 当前功能阶段：本轮第一至第四阶段代码已完成，进入第五阶段统一代码审计、migration、构建、专项/全量测试和浏览器验收。
- 智能体广场：顶部全文搜索与独立筛选抽屉、URL 状态、类型/分类/能力/模式/知识库/来源/评分/排序组合筛选、桌面三列、Body Portal 更多菜单、所有导航项 SVG 箭头完成。
- 双格式导出：新增 `GeneratedArtifactExport`，同一结构化内容支持 DOCX/PDF 独立任务、READY 复用、失败重试、鉴权下载、物理文件清理与生成文件页双格式状态；Chromium PDF 使用禁网 CSP、临时目录、超时、大小/签名校验和原子落盘。
- 系统助手：新增幂等 `学习讲义生成助手`、`考试试卷生成助手`，稳定 `systemKey`、公开 APPROVED 版本、受控配置与真实公开知识库只读绑定；无真实可用知识库时不伪造状态并允许通用模型降级。
- 文件生成图：新增独立 LangGraph，包含学习上下文解析、规划、真实知识检索、提纲、分段生成、Schema 校验、受控修复、质量检查、预览、持久化、DOCX/PDF 排队和 finalize；不使用学习流 checkpoint。
- 学习上下文：新增 `StudentLearningContext`、权限/一致性校验、学情安全快照、独立页面、导航入口；学习准备、LearningFlowPreload、quick-start、FILE_GENERATOR 安全预填、推荐入口、讲义生成、卡片准备状态和课前资料查询已统一读取后端上下文。
- 新增 migration：`20260712100000_add_artifact_exports_learning_context_system_agents`，仅 ADD COLUMN/CREATE TABLE/CREATE INDEX/FOREIGN KEY；尚未应用，待统一 Prisma 安全检查通过后应用。
- 当前错误：尚未进入统一测试阶段；既有 TTS `TTS_UPSTREAM_ERROR` 与 in-app Browser 初始化阻塞仍按基线记录，不阻碍功能代码。
- 下一步：新增专项测试，执行一次新增文件语法/模块检查、Prisma format/validate/diff/deploy、前端 build、专项测试、全量测试、Seed 两次、单次外部探针和浏览器验收。
- 学习流保护：未修改学习流 LangGraph 核心图、runtime、checkpoint、execution protocol、interrupt/resume、submit/skip/retry/continue、节点推进、会话状态机、错题/掌握度/画像回写；仅修改 quick-start 外层以可选读取上下文和可失败 preload 旁路。

## 2026-07-12 阶段 6～10 最新接手结论

- 当前阶段：阶段 6 功能实现完成，完整浏览器验收延后阶段 10；阶段 7、8、9 功能代码完成；阶段 10 自动化、数据库与真实 HTTP 验收完成，浏览器运行时和真实 TTS 探针仍有阻塞。
- 阶段 7：`LearningFlowResourceLink`、确定性 `linkKey` 幂等、权限/目标一致性校验、加入/查询/解除关联、Artifact 409 删除保护、课前资料区、直接生成课前讲义安全预填、90 天清理服务与 AsyncTask Worker/受控调度完成。
- 阶段 8：`LearningFlowPreload`、24 小时缓存与失效、基础 manifest、安全首节点白名单、非安全节点 PARTIAL、学习准备 API/卡片 DTO、quick-start 可选 `preloadId`、缓存软降级完成。
- 阶段 9：复用现有 narration/TTS/音频缓存的 voice prewarm、完整语音逻辑键、READY/PARTIAL 汇总、下一确定安全节点 fire-and-record 旁路触发完成。
- 前端：Artifact 详情加入学习流选择器、二次 HTML 消毒、文件缺失提示；学习流课前资料、生成课前讲义、学习准备状态/进度、任务中心文案与移动端布局完成。生产 build 909 modules 通过。
- 新 migration：`20260712050000_add_learning_flow_resources_preloads`，已应用；当前 29 migrations，status 最新，schema diff empty。前 28 个 migration 未修改。
- 测试：新增九组专项 16/16；后端全量 317/317；Prisma validate 通过；Seed 连续两次通过；真实 HTTP 验证资源/preload 列表、Artifact 43 READY/文件存在、storagePath 不暴露、跨用户 403、无 preload quick-start 原行为通过。
- 外部服务：Dify 单次探针成功；qwen3.7-plus 单次探针成功；TTS 单次探针失败 `TTS_UPSTREAM_ERROR`，未按规则重复调用，代码会降级为 PARTIAL。
- 当前错误：Codex in-app Browser 插件两次在初始化阶段报 Windows 路径错误，未能执行 Console/Network/移动端可视化验收；不得以其他浏览器框架绕过技能约束。
- 下一步：修复/恢复 Browser 插件后集中做 Artifact、资源关联、讲义生成入口、学习准备 READY/PARTIAL/FAILED、缓存命中和移动端浏览器验收；TTS 上游恢复后只复验一次。无需重跑阶段 6 真实生成。
- 学习流保护：未修改 LangGraph 核心图、workflow runtime、checkpoint、execution protocol、interrupt/resume、submit/skip/retry/continue、节点推进规则或学习会话状态机。仅在外层 Controller 成功路径、模板 DTO 和百炼适配层增加可失败旁路；缓存不写 checkpoint。

## 1. 当前阶段

阶段 5：FILE_GENERATOR Planner（完成）。阶段 6：GeneratedArtifact、内容生成、预览与 DOCX（开始）。阶段 1～5 已完成并封存。

## 2. 总体完成度

总体约 58%。环境恢复、阶段 1～5 全部完成；下一步按锁定顺序实施阶段 6 Artifact 与文件生成，尚未开始学习准备预加载。

## 阶段 3～4 完成记录（2026-07-12）

- 阶段 3：广场桌面三栏、移动端筛选→榜单→卡片、sticky 热门榜、卡片与详情唯一动作均完成；热门榜严格使用 7 日成功回答 `log1p`、0～3 增长、7 日新收藏 `log1p`、贝叶斯评分和 14 日活跃衰减，缓存 5 分钟，30 日 3 个不同未处理举报用户隐藏。
- 阶段 4：Marketplace 对话成为统一 CHAT 后端；SSE、AbortController、客户端断开、停止、重新生成、部分回答保留、单会话单生成、幂等、引用、记忆、重命名、删除、复制回答和按用户/会话草稿恢复完成。
- AI 对话“Agent 专属助手”改为动态 CHAT Agent；标准验收环境列出 13 个真实 Agent，选择后进入同一 Marketplace `conversationId=12`，历史、RAG 引用、知识库降级提示和版本一致。旧固定 Agent 数据保留但不再作为新入口。
- 浏览器：桌面三栏实测 220/273/260px，右栏 sticky；390×844 无横向溢出；共享会话移动端无横向溢出；本轮标准 5173 环境 Console 0 warning / 0 error。
- 回归：新增生成/榜单专项 11/11；后端全量 280/280；Worker 专项 7/7；前端生产 build 704 modules；Prisma validate 通过，26 migrations 最新，schema diff empty。
- 修复全量测试环境污染：Worker 测试使用可选 operationId 候选过滤，仅隔离测试认领范围，生产 Worker 默认行为不变。
- 学习流保护：未修改 LangGraph 核心图、checkpoint、runtime、execution protocol、interrupt/resume、节点推进、会话状态机或画像回写。

## 阶段 5 完成记录（2026-07-12）

- 已新增 additive migration `20260712010000_add_file_generator_agent_type` 并成功应用；当前共 27 migrations，数据库最新，schema diff empty。
- 新增独立 `MarketplaceAgentType = CHAT | FILE_GENERATOR`，既有 Agent 通过默认值保持 CHAT，不与学习流 AgentType 混用。
- FILE_GENERATOR 配置只接受 EXAM_PAPER/STUDY_HANDOUT、EASY/MEDIUM/HARD、DOCX、最多 50 题及受控模板/风格/知识库开关；拒绝 PDF、超限题数和缺失配置。
- Marketplace 会话新增独立结构化需求草稿与状态字段；CHAT 会话列表只返回 CHAT，CHAT SSE 明确拒绝 FILE_GENERATOR，防止绕过受控生成链路。
- 专项 40/40；最新全量后端 281/281；seed 连续两次成功；前端 build 704 modules；`git diff --check` 通过。
- qwen3.7-plus JSON mode Planner、哈希候选键→真实 ID 私有映射、真实 ID 注入拒绝、增量草稿、显式字段保护、每轮最多两个必要追问、确认摘要和每用户最多两个活跃文件任务均已实现。
- `file-plan` / `file-requirements` / `file-confirm` 复用 Marketplace Conversation/Message；确认在同一事务创建 GeneratedArtifact 骨架和 FILE_GENERATION AsyncTask；userId+conversationId+operationId 幂等。
- 新增第 28 个 additive migration `20260712023000_add_generated_artifacts` 并已应用；未修改前 27 个 migration；Prisma validate/status 通过，schema diff empty。
- 阶段 5 专项与关联回归 48/48；全量后端 289/289；前端 build 705 modules；Seed 两次成功。
- 真实 HTTP/qwen：teacher_demo 创建 FILE_GENERATOR，Planner 只追问 1 项，确认摘要完成，两次确认返回同一 Artifact 6 / Task 220。
- 浏览器：student_demo 会话 154 显示完整逻辑回归试卷摘要和“确认生成”；390×844 无横向溢出，Console 0 warning/error，任务中心单例。
- 阶段 6 下一步：两套 Zod 内容 Schema、分 section 生成、一次修复、质量检查、消毒预览、DOCUMENT_EXPORT 与 DOCX。
- 本轮仅清理自己启动的 5199 临时前端；旧 3000/3010 后端、5173/5174/5175 前端和用户浏览器进程均未停止。

## 阶段 2 完成记录（2026-07-11）

本节是阶段 2 的最新权威记录；下方阶段 1 与环境恢复内容保留为历史审计，不覆盖本节结论。

### 已完成实现

- 保留既有 24 个 migration，不修改 `20260711223000_add_async_tasks`；新增第 25 个 additive migration `20260711233000_add_async_task_worker_leases`，增加 `lockedBy`、`lockedAt`、`nextRunAt`、`(status, nextRunAt)` 和 `lockedAt` 索引。
- 取消条件按本次跨账号交接的最新锁定口径实现为仅 `RUNNING && cancellable=true`；QUEUED、WAITING_EXTERNAL、终态或 `cancellable=false` 均返回 409。
- 卡片关闭只更新按用户隔离的前端隐藏快照，不调用 cancel/dismiss；dismiss 是独立任务记录操作，只允许 SUCCEEDED、FAILED、CANCELLED，审计行不删除。
- Worker 使用进程唯一 instance ID 和带状态、到期时间、attemptCount、nextRunAt、空闲/过期锁条件的原子 `updateMany` 认领；60 秒租约、20 秒续租、3 秒本地扫描、15 秒外部扫描。
- 仅恢复超过 5 分钟的遗留 RUNNING；锁过期后才允许其他实例接管；达到 maxAttempts 后失败，外部等待超过 24 小时也会明确失败，避免无限轮询。
- 服务关闭时释放轮询器、abort 本实例处理器、最多等待 5 秒，并只释放本实例持有的锁。
- 知识库页面与 Worker 复用同一状态同步服务；远端仍处理时保持 WAITING_EXTERNAL 并设置 nextRunAt，远端明确成功/失败后才进入终态；同步异常进入有限重试。
- 任务 API 保持 list/active/detail/cancel/dismiss；所有权隔离、operationId 幂等、resultUrl 白名单及点击详情二次权限校验已完成，metadataJson、Dataset ID、密钥、storagePath 和 Worker 锁字段不序列化。
- 历史任务中若已有 Prisma 栈、本机路径或 node_modules 路径，API 序列化时统一替换为安全提示。
- 任务卡重要事件判定抽成无 DOM 纯模块；首次跨越 90%、首次进入任一终态、首次 requiresUserAction、首次出现或变更有效 resultUrl 才恢复显示，终态二次关闭保持隐藏。
- 任务中心是跨路由单例；活跃任务每 3 秒同步，无活跃任务停止；聚焦同步一次；失败保留已有数据并按 1/2/4 秒重试三次，随后展示固定提示和手动重新同步入口。

### 阶段 2 测试与验收

- 阶段 2 专项：33/33 通过（服务状态、HTTP 权限、Worker 原子认领/租约/关闭、纯状态模块、关闭语义、轮询退避）。
- 全量后端：269/269 通过，较阶段 2 开始前 240 项基线增加 29 项且无回退。
- 保护回归：agent-marketplace 28/28、learning-goal 45/45、learning-workflow 47/47、learning-flow-blockers 18/18。
- 浏览器实际验收 23 项通过：右上角挂载、展开、收起、单卡关闭、关闭不改后端、三类取消按钮约束、90% 首次恢复/不重复、成功/失败/取消终态恢复、终态二次关闭、结果二次鉴权跳转、跨页面、刷新、双用户隔离、移动端、50 卡片内部滚动、同步失败三次退避、手动恢复、跨路由单例和实际请求频率、Console。
- 实际请求日志显示活跃轮询相邻 GET 间隔约 3.02 秒；跨路由后 DOM 仍只有一个 `#global-task-center`，未出现重复请求风暴。
- 50 张任务卡时面板 `clientHeight=634`、`scrollHeight=7117`，页面无横向溢出，主界面仍可访问；移动端 390×844 验收无横向溢出。
- 两个浏览器会话 Console 均为 0 warning / 0 error。
- 前端生产构建通过（704 modules transformed；仅既存 chunk/dynamic-import 警告）。
- Prisma validate 通过；migrate status 为 25 migrations 且数据库最新；migrate diff 为 empty migration；`git diff --check` 通过。

### 阶段 2 变更文件摘要

- 新增：`backend/prisma/migrations/20260711233000_add_async_task_worker_leases/migration.sql`、`backend/src/modules/async-task/async-task.worker.js`、`backend/test/async-task-http.test.js`、`backend/test/async-task-worker.test.js`、`backend/test/task-center-state.test.js`、`frontend/src/components/task-center-state.js`。
- 扩展：`backend/prisma/schema.prisma`、AsyncTask service/controller/routes/tests、知识库状态服务、`backend/src/server.js`、`frontend/src/components/task-center.js`、`frontend/src/api/tasks.js`、任务中心样式及全局挂载。
- 发现并修复：旧测试任务会把 Prisma ValidationError 栈暴露到任务卡；现在 Worker 写安全错误，序列化层也对历史数据兜底脱敏。
- 未删除任何文件，未回退用户修改，未提交 Git。

### 阶段 2 学习流保护结论

未修改 LangGraph 节点、checkpoint、workflow runtime 执行协议、execution protocol、interrupt/resume、submit/skip/retry/continue、节点推进、答题状态机或学习会话执行器。四组学习流保护回归全部通过。

## 3. 已完成内容

- 已读取本轮完整需求。
- 已执行首次 `git status --short`。
- 已创建本进度文件。
- 已审计两次智能体广场 migration：第一份新增 13 张表并 additive 扩展现有知识库表，第二份仅为版本表新增 operation id；未发现 DROP、DELETE、TRUNCATE 或 RENAME。
- 已确认 agent-chat 挂载在 `/api`，其 `/agents` 与 `/agent-conversations` 路由认证作用域正确。
- 已确认管理员审核路由挂载在 `/api/admin`，路由内部不再重复 `/admin`，并统一要求 admin 角色。
- 已审计共享 Dify Knowledge Adapter；新增 Dataset、上传、索引状态、删除和多 Dataset 引用归属逻辑复用了原适配器。
- 已确认已有 `learning-narration` TTS、WebSocket 流、确定性脚本、语音缓存与并发合并服务，后续必须复用。
- 已确认全局 AsyncTask/任务中心尚不存在；现有稳定 SSE 仅属于学习工作流运行流，不应直接挪作全局任务通道。
- 已完成不依赖数据库的学习目标、学习工作流、学习流阻断回归和前端生产构建。
- 已将 Prisma MariaDB 连接配置改为：仅本地回环数据库默认允许 MySQL 8 RSA 公钥检索，远程数据库仍需显式开启。该修改使底层错误从 RSA 缺失明确收敛为当前凭据被 MySQL 拒绝。
- 本轮重新确认 `backend/.env` 可由正式入口正确加载，DATABASE_URL、Dify Knowledge Key 和百炼 Key 均已配置（只验证布尔状态）。
- MySQL、Prisma、migration status/diff/deploy、seed 两次幂等、后端启动、真实登录、Agent 接口、管理员权限和前端浏览器页面均已恢复验证。
- 默认 CHAT Agent 真实百炼对话成功，回答来源为 GENERAL 且没有伪造引用。
- 原始 `npm test` 已在补充 Prisma 测试 teardown 后自然退出，236/236 通过。
- Dify Embedding 供应商凭据经用户修复后，availability、Dataset 列表、Dataset 详情和真实 retrieve 四段探针全部通过。
- Dify retrieve 使用真实非空 Dataset 和真实自然语言查询，HTTP 200，返回 records，片段数 1，首片段含正文。
- 复核确认不存在 InvalidApiKey、Embedding、向量维度或 Weaviate 错误。
- 阶段 1 新建真实 Dify Dataset，上传 TXT 后真实经历 INDEXING → READY。
- KNOWLEDGE_FIRST Agent 的文档内问题返回真实引用，文档外问题降级通用模型并显示 AI 生成提示。
- 知识库与智能体公开申请、管理员审核、学生 B 发现/使用/收藏/评分/复制全部通过。
- 副本保持 PRIVATE，源 Agent 不受影响；公开知识库只读复用，私有草稿知识库不会复制或向学生 B 暴露。
- 公开 Agent 编辑生成新草稿，审核期间旧公开版本继续服务，新版本审核后正确替换。
- 多会话创建、重命名、继续、列表和软删除真实 HTTP 验收通过。
- 长期记忆开启、创建、查看、编辑、删除、批量清空和跨用户隔离通过。
- 举报提交、管理员查看/处理以及管理员下架通过；下架后普通用户不能继续访问，创建者可看到 OFFLINE 状态。
- 扩展后的八个真实验收场景全部通过，验收后 `npm test` 仍为 236/236。

## 4. 部分完成内容

- 阶段 2 无部分完成项。阶段 3 尚未产生实现改动。

## 5. 未开始内容

- 阶段 3：智能体广场重构与热门榜单。
- 阶段 4：CHAT Agent 接入 AI 对话。
- 阶段 5：FILE_GENERATOR 数据模型与运行链。
- 阶段 6：试卷、讲义与 DOCX 输出。
- 阶段 7：GeneratedArtifact 与学习流关联。
- 阶段 8：LearningFlowPreload。
- 阶段 9：语音和首节点预加载。
- 阶段 10：全量测试与六个真实场景。

## 6. 已新增文件

- `docs/implementation/agent-platform-phase2-progress.md`：本轮进度与中断恢复记录。

## 7. 已修改文件

- `backend/src/config/database.js`：新增本地 MySQL 8 RSA 公钥检索兼容配置；不修改数据、不涉及学习流核心。
- `backend/scripts/test-agent-marketplace-live.js`：支持外部验收前缀，并补齐公开知识库只读复用、私有知识库不复制、多会话 CRUD、记忆 CRUD、举报处理和下架断言。
- `backend/test/agent-marketplace.test.js`：补充 Prisma 测试 teardown，确保原始 `npm test` 自然退出。
- 工作区在本轮开始前已有第一阶段未提交业务文件，详见“当前 git status”；本轮未覆盖或回退这些改动。

## 8. 已删除文件

无。

## 9. 数据库 migration

- `backend/prisma/migrations/20260711170000_add_agent_marketplace/migration.sql`：13 个 CREATE TABLE、现有表 additive ALTER、索引和外键；无破坏性 SQL。
- `backend/prisma/migrations/20260711173000_add_agent_version_operation_id/migration.sql`：为 `user_agent_versions` additive 新增 operation id 与唯一索引；无破坏性 SQL。
- migration 已执行：两次智能体广场 migration 均在 `_prisma_migrations` 中完成。
- `prisma migrate status`：25 个 migration，数据库 schema 为最新。
- `prisma migrate diff`：空 migration，无 DROP、DROP COLUMN、TRUNCATE、DELETE、RENAME 或破坏性 ALTER。
- `prisma migrate deploy`：成功，无待应用 migration。

## 10. seed

`node prisma/seed.js` 连续执行两次均成功。执行前、第一次后、第二次后的聚合数据一致：用户 5、student_b 1、重复用户名 0、智能体演示数据 12（PUBLIC 6 / PRIVATE 3 / PENDING 2 / REJECTED 1）。演示知识库保持 EMPTY 且没有伪造 Dify Dataset ID。

## 11. 已运行命令

- `git status --short`：成功；工作区包含第一阶段未提交修改及新增文件。
- 读取需求附件：成功。
- `git diff --stat`、`git diff --name-only`：成功；开始时跟踪文件约 1759 additions / 774 deletions（不含未跟踪文件）。
- `npx prisma validate`：成功。
- `npx prisma migrate status`：失败，Schema Engine error；底层数据库探针确认凭据被拒绝。
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`：失败，P1000 数据库认证失败。
- `npm test`：执行完成，220/236 通过，16 个数据库型测试因同一凭据问题失败。
- `node --test test/learning-goal.test.js`：45/45 通过。
- `node --test test/learning-workflow.test.js`：47/47 通过。
- `node --test test/learning-flow-blockers.test.js`：18/18 通过。
- `npm run build`（frontend）：成功，700 modules transformed；仅有既存 chunk size/dynamic import 警告。
- `node prisma/seed.js`：失败，MySQL 1045 Access denied。
- Dify Knowledge Adapter availability/list 探针：失败，未配置 `DIFY_KNOWLEDGE_API_KEY`。
- 本轮环境恢复：`git diff --check` 通过，无冲突标记、0 字节核心文件或相关 JS 语法错误。
- 本轮环境变量：从 `E:/DisciMind/backend/.env` 读取，三个关键变量布尔状态均为 configured=true。
- 本轮数据库只读探针：连接成功，数据库为 discimind，103 张表可读，用户表可读。
- 本轮 migration status/diff/deploy：全部完成且无破坏性差异。
- 本轮 seed：连续两次成功且聚合数量不变。
- 本轮 Dify：availability/list/detail 成功，retrieve 失败；Dify 内部 Embedding 模型供应商返回 InvalidApiKey。
- 本轮后端：健康检查、学生/管理员登录、公开 Agent 列表、管理员授权/拒绝均通过。
- 本轮浏览器：学生首页及全部智能体基础页面、Agent 对话页、管理员审核页和 hash 路由刷新通过；Console 无未捕获 error/warning。
- 本轮默认 Agent：真实 GENERAL 回答成功。
- 本轮 `npm test`：236/236 通过并自然退出。
- Dify 修复后四段探针：availability/list/detail/retrieve 全部 HTTP 200，retrieve 返回 1 个含正文片段。
- `backend/scripts/test-agent-marketplace-live.js`：先验证原六场景，再扩展为八场景；新前缀完整运行成功。
- 阶段 1 验收后 `npm test`：236/236 通过。
- 阶段 1 最近数据快照：3 个新知识库、2 个 READY 文档、7 个新 Agent、1 个 OFFLINE Agent、最高 3 个版本、1 个软删除会话、1 个已处理举报。

## 12. 测试结果

- 最新全量后端：269 项，269 通过，0 失败，0 跳过。
- 阶段 2 专项：33 通过，0 失败。
- learning-goal：45 通过，0 失败。
- learning-workflow：47 通过，0 失败。
- learning-flow-blockers：18 通过，0 失败。
- agent-marketplace：28 通过，0 失败，0 跳过。
- 前端生产构建：通过。
- Prisma validate：通过。
- seed：连续两次成功，幂等验证通过。
- 默认智能体对话和基础真实 HTTP：成功。
- Dify availability/list/detail/retrieve：全部成功。

## 13. 当前失败命令

无环境闸门失败命令。

## 14. 当前错误堆栈摘要

无当前环境错误。Dify、数据库、前后端和回归测试均通过。

## 15. 最后一个成功验收场景

阶段 2 最后成功场景为跨路由任务中心实际请求追踪：每约 3.02 秒仅一次 GET，路由切换后仍只有一个任务中心根节点，Console 无错误。

## 16. 下一步准确操作

1. 阶段 3 开始前审计 Marketplace conversation/message、收藏/评分/举报和 AI 对话入口的当前模型与路由，保留阶段 1 数据兼容。
2. 新 migration 前先执行 Prisma validate 与 migrate diff 安全检查，只允许 additive SQL。
3. 增加 generationStatus/generationId、会话 activeGenerationId、消息统计索引和真实 SSE 中断协议。
4. 实现只统计 COMPLETED assistant 的 60 秒热门榜缓存及写操作主动失效。
5. 完成阶段 3 进度文档与专项/保护回归后，才进入下一阶段。

## 17. 是否修改学习流保护区

否。未修改 LangGraph 核心图、learning-workflow runtime、execution protocol、interrupt/resume、submit/skip/retry/continue、节点推进规则、答题状态机、学习会话执行器、自定义学习目标核心或学习画像回写。

## 18. 当前 git status

```text
 M .gitignore
 M backend/prisma/schema.prisma
 M backend/prisma/seed.js
 M backend/src/app.js
 M backend/src/config/database.js
 M backend/src/modules/agent-market/agent-market.controller.js
 M backend/src/modules/agent-market/agent-market.routes.js
 M backend/src/modules/agent-market/agent-market.service.js
 M backend/src/modules/learning-agent/adapters/dify-knowledge.adapter.js
 M frontend/src/main.js
 M frontend/src/modules/agent-market/agent-market.api.js
 M frontend/src/modules/agent-market/agent-market.service.js
 M frontend/src/pages/agent/AgentMarketPage.js
 M frontend/src/pages/agent/MyAgentsPage.js
 M frontend/src/styles/dashboard.css
 M frontend/src/styles/global.css
 M frontend/src/styles/student-complex.css
 M frontend/src/styles/theme.css
 M frontend/src/utils/icons.js
 M frontend/src/utils/router.js
 M frontend/src/utils/student-menu.js
?? backend/prisma/migrations/20260711170000_add_agent_marketplace/
?? backend/prisma/migrations/20260711173000_add_agent_version_operation_id/
?? backend/prisma/seeds/seedAgentMarketplace.js
?? backend/scripts/test-agent-marketplace-live.js
?? backend/src/modules/agent-chat/
?? backend/src/modules/agent-marketplace/
?? backend/src/modules/agent-review/
?? backend/src/modules/knowledge-base/
?? backend/storage/
?? backend/test/agent-marketplace.test.js
?? backend/test/fixtures/
?? docs/implementation/
?? frontend/src/api/marketplace.js
?? frontend/src/pages/admin-agent-reviews.js
?? frontend/src/pages/agent/AgentChatPage.js
?? frontend/src/pages/agent/AgentCreatePage.js
?? frontend/src/pages/agent/KnowledgeBasesPage.js
?? frontend/src/pages/agent/marketplace-shared.js
?? frontend/src/styles/agent-marketplace.css
```

## 19. 当前 git diff --name-only

```text
.gitignore
backend/prisma/schema.prisma
backend/prisma/seed.js
backend/src/app.js
backend/src/config/database.js
backend/src/modules/agent-market/agent-market.controller.js
backend/src/modules/agent-market/agent-market.routes.js
backend/src/modules/agent-market/agent-market.service.js
backend/src/modules/learning-agent/adapters/dify-knowledge.adapter.js
frontend/src/main.js
frontend/src/modules/agent-market/agent-market.api.js
frontend/src/modules/agent-market/agent-market.service.js
frontend/src/pages/agent/AgentMarketPage.js
frontend/src/pages/agent/MyAgentsPage.js
frontend/src/styles/dashboard.css
frontend/src/styles/global.css
frontend/src/styles/student-complex.css
frontend/src/styles/theme.css
frontend/src/utils/icons.js
frontend/src/utils/router.js
frontend/src/utils/student-menu.js
```

## 20. 环境恢复验证

### 本轮验证原则

- 以用户人工修复后的当前文件为准，不沿用上一轮对 `database.js` 或环境阻塞的判断。
- 先执行代码完整性、环境变量、数据库、migration、seed、Dify、后端、前端和全量回归验证。
- 闸门全部通过前，不开发 AsyncTask、排行榜、文件生成智能体或学习流预加载。
- 不输出任何数据库密码、DATABASE_URL、Dify Key 或百炼 Key。
- 不执行 reset、drop、truncate、clean、checkout 或覆盖用户修复的操作。

### 当前状态

- 已重新读取本轮需求、进度文件、`git status --short` 与 `git diff --name-only`。
- 代码完整性通过：`git diff --check` 无输出；无冲突标记、0 字节核心文件、相关 JS 语法错误、硬编码项目密钥或完整配置日志。
- 环境变量通过：正式入口读取 `E:/DisciMind/backend/.env`；DATABASE_URL、DIFY_KNOWLEDGE_API_KEY、BAILIAN_API_KEY 均 configured=true。
- 数据库通过：discimind 连接成功，103 张表可读，Prisma validate/status/deploy 成功；diff 为空且无破坏性 SQL。
- Seed 通过：连续执行两次，聚合数据完全一致，无重复 student_b/用户名，无伪造 Dataset 或 READY。
- Dify 全部通过：availability/list/detail/retrieve 均为 HTTP 200；retrieve 返回 1 个含正文的真实片段。
- 后端通过：启动、健康检查、学生/管理员登录、Agent 列表、管理员授权与学生 403 均正确。
- 前端通过：build、标准 5173 dev server、学生/Agent/Admin 页面、hash 刷新和浏览器 Console 检查均正常。
- 回归通过：全量后端 236/236、agent-marketplace 28/28、learning-goal 45/45、learning-workflow 47/47、learning-flow-blockers 18/18。
- 默认 CHAT Agent 真实模型对话通过。

### 环境闸门结论

满足，可以继续开发。已按顺序进入阶段 1；阶段 1 完成前仍禁止开始后续模块。

### Dify 修复后复验记录

- 实际环境文件：`E:/DisciMind/backend/.env`。
- DATABASE_URL / DIFY_KNOWLEDGE_API_KEY / BAILIAN_API_KEY：均 configured=true，仅记录布尔状态。
- availability：HTTP 200。
- Dataset 列表：HTTP 200，共 5 个 Dataset。
- Dataset 详情：HTTP 200。
- retrieve：HTTP 200，存在 records，片段数 1，首片段含正文。
- 英文真实复核查询：`What are the three steps of the Blue Whale review method?`。
- InvalidApiKey：否。
- Embedding 错误：否。
- 向量维度错误：否。
- Weaviate 错误：否。
- 修复后全量后端：236/236 通过。
- agent-marketplace：28/28 通过。
- learning-goal：45/45 通过。
- learning-workflow：47/47 通过。
- learning-flow-blockers：18/18 通过。
- Prisma validate：通过。
- frontend build：通过。

## 21. 2026-07-15 智能任务运行态与学习流加固

### 21.1 当前阶段

- 阶段：运行态基线审计、后端/前端加固、真实运行、浏览器验收、全量回归与测试数据清理均已完成。
- 工作区保护：继续保留现有脏工作区，不执行 `git reset --hard`、`git clean`、`git checkout`、`git restore`，不重建数据库。
- 验收口径：只记录真实代码、数据库、API 与浏览器结果，不使用 mock 数据冒充完成。

### 21.2 已确认事实

- 已在学生端“通用学习”新建真实会话并提交“怎样高效刷题复习线性代数？”。
- 浏览器约 1.2 秒进入 `5/9 · 56%`，随后持续停留在该位置，耗时固定显示 `1 秒`，执行轨迹仅显示“任务开始 / 生成计划”。
- 对应后端 Run 实际在约 29 秒后完成全部 9 个步骤并保存最终答案，说明问题不是本次模型调用未返回，而是前端订阅链路提前退出。
- 根因已定位到 `frontend/src/pages/student-ai-chat.js` 的 `refreshMessages()`：函数内合法宿主变量是 `host`，但附件下载绑定错误引用了未定义的 `root`。首批运行事件触发刷新后异常被 SSE 连接层捕获并显示为 `root is not defined`，随后页面不再消费事件。
- 静态计时的独立根因是运行面板只在收到事件时重绘，`connectRunStream()` 还会停止计时器但没有启动逐秒更新；服务端快照同时缺少 `serverNow`、`lastHeartbeatAt` 与持久化耗时字段。
- 当前服务端对每个极小模型 delta 都持久化一条 `answer_delta`，单次回答会产生数百条事件；需要批量化 delta，并保留数据库单调 sequence、断线重放与终态幂等。

### 21.3 本阶段计划

1. 增加 Run/Step 强状态机、心跳、超时、重试计数、错误码、持续时间与终态幂等。
2. 加固 SSE 的 eventId、sequence、Last-Event-ID、快照补偿、去重与 2–5 秒心跳。
3. 修复前端 `root` 异常、动态计时、刷新恢复与重连补偿。
4. 把后台运行中的学科任务合并进统一任务与消息中心，并在完成/失败/停滞时生成可回跳通知。
5. 完成学习计划、课前资料、学习会话 PDF/全屏/底部操作区与节点渲染加固。
6. 执行迁移、聚焦测试、构建、真实 API/数据库核验、浏览器验收，并精确删除本轮测试会话及关联运行数据。

### 21.4 已完成实现

- Run 与 Task 使用统一强状态机，支持 `queued/planning/running/waiting_tool/waiting_agent/generating/finalizing/completed/failed/cancelled/stalled`、终态保护、心跳、超时、错误码、重试计数、首 token 与持续时间。
- Prisma 增量 migration `20260715143000_subject_chat_runtime_hardening` 已应用；未删除、重命名或重建现有表。
- SSE 增加稳定 event type、单调 sequence、事件时间、4 秒连接心跳、终态单次发送、快照补偿与 `/runs/:runId/snapshot` 别名。
- 学科编排器增加 3 秒运行心跳、全局/步骤 AbortController 超时和 delta 批量持久化；旧问题复现 Run 产生 414 条 `answer_delta`，新通用 Run 仅 1 条，新学科 Run 仅 2 条。
- 学生 AI 页面修复 `root is not defined`，使用服务端时间偏移逐秒计时，按 sequence 去重并在重连时读取快照；执行轨迹已展示阶段、模块、Agent 心跳、首 token 与失败/停滞事件。
- 手动 Agent 保持权限校验，自动匹配仍只选择 MODEL；手动选择支持已配置的 MODEL、DIFY_CHATFLOW、DIFY_WORKFLOW，并将用户 ID、取消信号与超时传给运行时。
- 统一任务与消息中心合并 AsyncTask、学科答疑 Run 与通知；收起态仅保留图标和两位计数，悬停/聚焦/展开时显示摘要，支持点击固定、Escape/外部点击关闭、分类筛选和原对话回跳。
- 学习中心新增六项真实准备清单与真实成果库导入；学习会话底部操作条回到学习列文档流并使用 sticky，PDF 多标签/连续阅读保持可用，新增沉浸学习与安全退出。

### 21.5 真实运行结果

- 通用 Run `cb39fdd5-8558-4626-aa5f-7fbbd0d4dcd1`：9/9、`completed`、17.567 秒、56 个持久化事件，9 个任务均记录 duration；Agent 首 token、5 次心跳、引用和终态通知均落库。
- 手动 MODEL Agent Run `980d4b69-3f02-40f7-ba3d-c8efca58be3e`：9/9、`completed`、36.741 秒、66 个事件；包含 `agent.started`、12 次 `agent_heartbeat`、`agent.first_delta`、`agent.completed`，最终回答真实保存。
- 学科专属 Run `f100630e-30ae-4f20-adc2-ab78dec4ddc5`：`SUBJECT / machine_learning`、9/9、`completed`、4.591 秒、54 个事件，9 个任务全部完成且生成真实引用。
- Dify 训练师当前环境实测：学生 3 的真实机器学习选课与逻辑回归知识点，`diagnostic_pre_test` 一次成功，上游 `succeeded`，74.692 秒，工作流 Run `20ffbdaf-2bf1-4e79-9333-ca9b68647a3f`，未打印密钥。
- 当前数据库的 UserAgentVersion 运行时分布为 `MODEL=45`、Dify Agent 版本为 0；因此不能伪造“手动 Dify Marketplace Agent 浏览器运行”。代码与单测已覆盖手动 Dify 调用入口，真实 Dify 由已配置的训练师 Workflow 完成验收。

### 21.6 浏览器验收

- 任务中心能显示最近完成的学科任务，并从任务卡回跳 `#/student/ai-chat?conversationId=54&runId=980d4b69-3f02-40f7-ba3d-c8efca58be3e`；Escape 与外部点击均关闭面板。
- 学习中心显示目标、工作流版本、学习画像、薄弱点、学习资料、首节点预加载六项清单；导入弹窗读取当前账号 8 个 READY 真实成果，没有使用 mock。
- 学习会话 50 中操作条计算样式为 `position: sticky`、`right: auto`，且为学习列子节点；PDF 工作区真实加载 4 页连续阅读。
- 沉浸学习在 in-app browser 不授予原生 Fullscreen 时使用同页 fallback，侧栏隐藏、PDF 保持打开，可正常退出；语音播放失败时显示“文字学习不受影响”，播放/停止/重播/上下段仍可用。
- 当前浏览器没有未捕获 error；后端重启窗口曾记录 1 条 `ai-chat-artifact-stream network error` warning，Vite 重连后恢复。

### 21.7 回归结果

- 全量后端：471/471 通过，0 失败、0 跳过，耗时 70.061 秒。
- 聚焦运行态、Dify、任务中心、学习 PDF：40/40 通过。
- 前端生产构建：961 modules transformed，通过；保留既存 chunk size 与 ineffective dynamic import 警告。
- `prisma validate`：通过；`prisma migrate status`：49 个 migration，数据库为最新。
- `git diff --check`：通过，无空白错误。

### 21.8 清理与工作区保护

- 精确删除本轮验收会话 51–55：5 个会话、10 条消息、5 个 Run、45 个 Task、670 个 Event、5 个 Trace、1 个 Trace Tool Call、3 条终态通知由事务删除或级联删除。
- 清理后对 51–55 复核：conversation、run、message、notification、trace、attachment、invocation、artifact 均为 0。
- 临时审计脚本 `scripts/ai_learning_runtime_audit.py` 已删除。
- 未执行 `git reset --hard`、`git clean`、`git checkout`、`git restore`、数据库重建或无关文件清理；现有脏工作区完整保留。

## 22. 动态 AI 编排与学习启动收口（2026-07-15）

### 22.1 完成范围

- 废除新运行固定九步，新增 9 种执行模式和 32 条确定性路由矩阵；Subject Chat 按 `plan.created.taskDefinitions` 持久化真实步骤。
- 补齐 Agent/Skill/Tool 能力与参数契约；owner-bound、图表、问候、文件、联网、附件路径硬禁止错误学科 Agent。
- 统一 ChartSpec 1.0、参数规范化、调用前 preflight、字段级错误、一次修复和表格/文字降级。
- 自然语言指定知识库可解析到有权访问的真实 Dataset；内部无公开 URL 的资料也能进入引用、Trace、Run Source 与前端来源卡片。
- 学习启动新增结构化 readiness、必需/可降级项、计划级锁、Session 复用、`P2002` 竞争恢复、新一轮 goal 和稳定公开错误码。
- 前端动态进度分母、重规划更新、字段级技术详情、图表重试、学习启动禁用/恢复动作与响应路由完成。

### 22.2 真实验收

- 问候 2/2；本人错题 3/3、20 条真实记录；图表 6/6、10 个真实掌握度、ECharts 正常；知识库问答 4/4、5 条真实来源；文件确认与 13,969-byte DOCX 下载通过。
- 计划 4 两个并发 start 均 HTTP 200，复用 session 51；goal 30 的 session 数为 1。浏览器展示首节点并支持刷新恢复。
- 1440×900、1024×768、390×844 无横向溢出；应用 Console 0 error，Network 无未处理 500。

### 22.3 回归与清理

- 新增专项 24/24，相关专项 50/50；后端全量 503/503，0 失败、0 跳过，75.67 秒。
- 前端构建 963 modules、1.87 秒；Prisma schema 有效，49 个 migration 全部最新。
- 精确删除会话 71–75、5 个 Run、5 个 Trace、5 条通知、成果 578、导出 221、任务 2124、文件会话 1122、物理目录和 3 个临时审计脚本；二次残留全部为 0。
- 保留当前真实计划 4、goal 30、session 51、图表会话 68、真实知识库和所有无关 dirty worktree；未执行 reset/clean/checkout/restore，未修改真实 `.env`，未删除真实业务数据。

## 23. 个性化 LearningCard 中枢（2026-07-16）

### 23.1 完成范围

- 建立 LearningCard 1.0、5 个持久化模型及第 50 个增量迁移；统一主页、学习中心、Trainer、错题、AI 对话、课程库和消息中心。
- 每日推荐使用真实数据、可配置权重、五槽多样性、冷启动、反馈惩罚和单槽事件刷新；规则卡即时返回，Qwen3.7 Plus 通过既有 Worker 增强。
- 内存/原子 JSON/数据库缓存、SWR、任务去重、完整 generation token 和旧任务防覆盖闭环完成。
- 前端完成扇形交互、统一无障碍详情、Markdown、KaTeX、ECharts 数据表/全屏/PNG、桌面/平板/手机及 reduced-motion。

### 23.2 验收与保护

- LearningCard 专项 11/11，后端全量 515/515；前端 966 modules 构建通过；Prisma 50 migrations 最新。
- 真实 Qwen 7/7；真实动作闭环与 1440/933/390 浏览器场景通过；推荐单槽刷新和并发轮次令牌通过数据库级验证。
- 精确清理本轮卡片、集合、状态、事件、通知、任务、成果/会话标记及平台缓存，相关残留为 0。
- 未执行 reset、clean、checkout、restore，未修改真实 `.env`，未删除真实业务数据，保留全部无关 dirty worktree。
