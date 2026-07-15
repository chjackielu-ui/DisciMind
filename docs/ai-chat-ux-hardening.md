# AI 对话与学习卡片加固审计

审计日期：2026-07-15  
范围：学生 AI 对话、统一 AI Assistant、学科会话编排、系统文件 Agent、异步任务中心、学习流预加载、Trainer 节点与共享输入组件。

## 审计边界

- 只读检查当前 dirty worktree、Prisma 模型、现有路由/服务/共享组件与真实运行记录。
- 使用登录学生账号在本地真实页面复现；没有读取或输出任何密钥。
- 不新建平行会话、成果、任务或学习流数据栈，后续修复复用 `AiConversation`、`SubjectChatRun`、`AsyncTask`、`GeneratedArtifact` 与学习流预加载缓存。

## 真实复现

| 场景 | 真实结果 | 结论 |
| --- | --- | --- |
| “查看我最近的错题” | 9/9 完成，约 12 秒；只返回“26 道未解决、1 个薄弱点”的画像摘要，正文声称无法访问个人后台 | 登录身份已经存在，但编排未调用本人错题明细 Tool |
| “帮我生成一份机器学习期末试卷” | 约 40 秒后仅返回长文本试卷；没有确认卡、任务或文件成果 | 高置信文件意图被普通模型/聊天 Agent 消化，未进入受控文件 Skill |
| “分析我最近一个月成绩变化和知识点掌握情况” | 约 41 秒后仍声称无法读取明细；没有图表；运行中事件增长到 322 条 | 缺少本人学习数据 Tool 与受控 ChartSpec，心跳/协议事件还需回归检查 |
| 截图中的“线性回归试卷”失败会话 | `MarketplaceAgentInvocation` 266、`FILE_GENERATOR` Agent 95、文件需求会话 1062；需求草稿已经 `READY_TO_CONFIRM`，之后仍调用规划模型并在约 9.3 秒失败 | 文件 Agent 选择本身正确，失败发生在“完整草稿后再次规划”；异常被折叠为通用错误，后续步骤全部跳过 |
| 学习会话 50 的 Trainer 节点 | 页面恢复后显示历史生成耗时 86.1 秒；等待区域没有即时知识卡片 | 当前预加载只准备基础包/安全首节点/语音，没有知识卡片缓存与独立展示通道 |

## 根因矩阵

### 用户上下文与学习数据

- `subject-chat-context.service`、画像加载和统一 Assistant 之间没有同一份 owner-bound `UserContext`。
- 当前 Tool 只有 `student_learning_profile` 与 `wrong_question_summary`，且 Schema 暴露 `studentUserId`；学生请求本人的数据时仍依赖模型正确传参。
- 普通模型只拿到安全摘要，无法据实回答错题、成绩趋势、掌握度、最近会话、学习时长和任务完成情况，所以产生了“无法访问后台”的错误陈述。
- 通用模式课程推断对空 subject 的回退过宽，存在把首门选课误当成显式课程的风险。

### 文件意图与确认

- 现有 `workflow-planner` 主要依赖简单关键词和 Skill trigger；“试卷”不一定进入系统文件生成链。
- 学科会话手动选择 `FILE_GENERATOR` 时，`prefillFromOrchestration` 已经生成完整草稿，但代码仍无条件调用 `planRequirements`。
- 草稿完整后没有持久化的 pending action；现有路径反而直接 `confirmRequirements`，无法满足刷新恢复、防重复确认和任务中心“等待确认”。
- 失败记录只保存“智能体调用失败，请稍后重试”，丢失失败阶段、可公开错误码与恢复动作。

### 图表

- 现有图表工具只校验标题、类型、分类和 series；没有指标定义、单位、来源、时间范围、空态和维度一致性。
- 学习分析没有先执行真实数据 Tool，因此也没有可供 ECharts 渲染的可信数据源。

### 知识卡片与 Trainer

- `LEARNING_FLOW_PRELOAD` 当前只缓存学习流 manifest、首节点内容与语音；没有卡片 Schema、cache key、过期策略或 stale-while-revalidate。
- Trainer 正式调用与内容容器绑定，等待期间没有独立的即时学习区域。
- 没有通用卡片/个性化卡片两层数据，也没有掌握、收藏和保存到成果的用户状态。

## 增量修复方案

1. 后端建立认证用户派生的 `UserContext`，学生本人 Tool 参数不再接收学号或学生 ID。
2. 增加 8 个 owner-bound 学习数据 Tool，并用确定性意图路由优先执行真实查询。
3. 用 `AsyncTask.WAITING_EXTERNAL`、`requiresUserAction` 和会话运行态实现持久确认；确认后复用原会话/Run 上下文，幂等进入现有文件生成器。
4. 建立严格 `ChartSpec`，从真实 Tool 结果生成成果；前端用现有 ECharts 工具渲染并保留表格/空态。
5. 在学习流预加载模块增加原子 JSON 卡片缓存、后台刷新和快速确定性回退；卡片区域与 Trainer 正式输出并行。
6. 共享输入组件继续保留学生冷色与教师暖色主题，只替换为本地图标、可访问标签与明确状态。

## 保护策略

- 不执行 `reset`、`clean`、`checkout` 或 `restore`。
- 不修改真实 `.env`，不安装依赖。
- 不重建数据库、不删真实业务数据；验收数据仅按本轮主键精确清理。
- 所有修改在当前 dirty worktree 上窄范围叠加。
