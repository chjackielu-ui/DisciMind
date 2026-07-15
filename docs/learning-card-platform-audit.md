# DisciMind 个性化学习卡片中枢现状审计

审计日期：2026-07-16  
审计分支：`feature/stu-pro-lyj-0715`

## 1. 审计边界与保护基线

- 当前工作区存在大量已暂存、未暂存和未跟踪改动。本轮把这些改动全部视为既有工作，禁止使用 reset、clean、checkout 或 restore 覆盖。
- 本轮不修改真实 `.env`，不输出密钥，不重建数据库，不清空真实数据。
- 前端技术栈为原生 JavaScript + CSS + Vite；项目未使用 GSAP，因此扇形卡组应使用 CSS transform、Web Animations API 和原生 Pointer Events。
- 现有依赖已经包含 Zod、Marked、DOMPurify、KaTeX 和 ECharts，不需要新增依赖。
- 审计开始时 Prisma 共有 49 个迁移；卡片持久化必须使用增量迁移。

## 2. 已有真实能力

### 2.1 学习流等待卡片

现有 `backend/src/modules/learning-flow-preload/knowledge-card.*` 已具备：

- 通用 3 张 + 个性化 2 张的两层卡片；
- 课程、知识点、知识库版本、模型版本、Prompt 版本和个性化版本参与缓存键；
- 原子 JSON 写入、READY / GENERATING / STALE / FAILED、过期判定与 SWR；
- 通过 AsyncTask 的 `dedupeKey` 复用现有 Worker，不阻塞 Trainer；
- 缓存未命中时立即返回真实课程/知识点生成的规则卡；
- Qwen JSON mode、`enableThinking: false`、有限 token 和来源约束；
- 学习会话所有权校验、收藏/掌握/展开状态、成果中心保存；
- 前端学习会话内的卡组和 Markdown / KaTeX 展示。

这条链路必须保留，并通过统一 LearningCard 适配器升级，不能另建一套与 Trainer 割裂的等待卡片系统。

### 2.2 学生真实数据与业务动作

仓库已有可直接用于推荐的数据表和服务：

- `StudyRecord`：学习时间、进度、最近学习；
- `WrongQuestion`：错因、重复复习、再次出错和知识点；
- `StudentMasteryRecord`：掌握度、等级和更新时间；
- `StudentLearningPlan` / `LearningSession`：当前计划、节点和进度；
- `LearningTaskRecipient` / `TaskSubmission`：发布任务、截止时间和完成状态；
- `RecommendationRecord`：已有推荐记录；
- `Notification`：统一任务与消息中心可消费的幂等通知；
- `ReviewPlan`：卡片加入复习计划；
- `PracticeSession`：从卡片创建真实练习；
- `AiConversation`：创建携带卡片上下文的真实 AI 对话；
- `GeneratedArtifact`：保存 LearningCard Artifact。

### 2.3 安全渲染和图表

- `frontend/src/utils/markdown.js` 已使用 Marked + DOMPurify，并禁止信任任意 HTML；同时具备代码复制、表格横向容器和 KaTeX 安全降级。
- `backend/src/modules/ai-assistant/chart-spec.js` 已实现 ChartSpec 1.0 的 Zod 校验，支持 line、bar、pie、radar、scatter 和表格一致性校验。
- `frontend/src/utils/echarts.js` 已提供统一初始化、销毁、resize 和多种图表渲染。
- AI 只能返回受控 ChartSpec；模型返回的 JavaScript 不进入协议和前端执行路径。

## 3. 当前缺口

1. 会话卡片仍是 `concept/formula/...` 小写枚举与 `text/formula/list/...` 会话专用结构，不是严格版本化的统一 LearningCard 1.0。
2. 卡片用户状态仍是 JSON sidecar，无法形成跨页面、跨卡组的统一收藏、掌握、稍后学习、不感兴趣和行为统计。
3. 数据库没有 `LearningCard`、`DailyLearningCardSet`、`UserLearningCardState` 和 `LearningCardEvent`。
4. 没有每日推荐服务、可配置评分、多样性约束、冷启动、重复曝光惩罚和事件增量刷新。
5. 没有学生主页 DailyCardSet API 与扇形卡组。
6. 学习中心、错题详情和课程详情没有统一卡片入口。
7. AI 对话的 `create_knowledge_cards` 仍只保存 `front/back` 数组，不能声明为 LearningCard Artifact。
8. 任务与消息中心无法把学习卡片更新消息路由回首页卡片区。
9. 现有等待卡片前端只能逐张切换，没有统一详情弹窗、完整状态动作、ChartSpec 和移动端抽屉。

## 4. 实施决策

- 新增一个后端 `learning-card` 中枢模块，统一负责协议迁移、持久化、推荐、AI 生成、行为、场景接口和缓存维度；现有 `knowledge-card` 文件保留为学习流预加载适配层。
- 完整卡片内容同时写入数据库 `contentJson`；现有原子 JSON 缓存继续用于低延迟生成缓存。数据库保存索引、状态、DailyCardSet 和行为闭环。
- DailyCardSet 首次请求同步返回真实数据规则卡，随后由现有 AsyncTask Worker 去重执行 Qwen 增强；同一卡片 ID 原位更新，避免前端闪烁和中心位置重置。
- 推荐权重由环境变量覆盖默认值，不写死唯一最终权重；选择阶段强制同类型最多两张、相邻知识点不同，并优先组成薄弱点、错题修复、概念/公式、任务、进步/拓展五类。
- 用户“已掌握”只写卡片自评状态并影响推荐，不直接修改考试成绩或正式掌握度。
- 统一前端详情组件复用安全 Markdown、KaTeX、ChartSpec/ECharts；非中心卡只渲染摘要，图表只在详情打开后初始化并在关闭时销毁。

## 5. 预计修改范围

- 数据库：新增 5 个卡片相关模型和 1 个 DailyCardSet 关联模型，新增 1 个增量迁移。
- 后端：新增统一卡片模块与学生/课程/错题/AI 路由；最小修改 AsyncTask Worker、任务消息路由、学习流卡片适配器、练习事件触发和 AI 工具注册。
- 前端：新增统一卡片 API、详情、扇形与网格组件和命名空间样式；局部接入学生首页、学习中心、学习会话、错题、AI 对话、课程详情和统一消息中心。
- 测试和文档：新增卡片专项测试和附件要求的设计、缓存、交互、场景及测试报告。

## 6. 审计闭环（2026-07-16）

上述缺口均已落地：`LearningCard 1.0`、5 个持久化模型、每日推荐、Qwen 增强、两级缓存与 SWR、事件单槽增量刷新、主页扇形卡组、统一详情，以及学习中心、Trainer、错题、AI 对话、课程库和消息中心复用。增量迁移 `20260716103000_learning_card_platform` 已部署，数据库现为 50 个迁移且状态最新。详细实现和验收分别见同目录设计文档与 `learning-card-test-report.md`。
