# AI 对话与学习知识卡片加固审计

审计日期：2026-07-15  
审计范围：学生 AI 对话、Subject Chat、统一 AI Assistant、系统文件 Agent、AsyncTask、GeneratedArtifact、学习流预加载、Trainer 节点和共享输入组件。

## 真实复现结论

| 场景 | 修复前证据 | 根因 |
| --- | --- | --- |
| 查看最近错题 | 九步运行完成，但回答只重复画像聚合值并声称无法访问后台 | 登录身份没有转换成 owner-bound 学习数据 Tool 调用 |
| 生成机器学习期末试卷 | 等待约 40 秒后只得到聊天文本，没有确认卡和文件 | 文件意图被普通回答链消费，没有稳定进入受控文件 Skill |
| 最近 30 天成绩与掌握度 | 等待约 41 秒后仍称无数据，没有图表 | 缺少本人学习数据工具和严格 ChartSpec |
| 截图中的试卷生成失败 | 已选中 FILE_GENERATOR，需求也已完整，之后仍调用规划模型并失败 | 完整确定性草稿被重复规划；失败阶段被通用错误折叠 |
| 学习会话 50 Trainer | 历史内容生成约 86.1 秒，等待区没有可学习内容 | 预加载只有流程、内容和语音，没有独立知识卡片缓存 |

## 现状审计

- 会话继续复用 `AiConversation`、`AiMessage`、`SubjectChatRun` 和九步事件协议，没有创建第二套聊天栈。
- 文件确认复用 `AsyncTask.WAITING_EXTERNAL`、`requiresUserAction`、会话运行态和现有 `GeneratedArtifact`/导出链。
- 学习数据读取从认证用户派生所有权，学生端 API 和 Tool Schema 不接收 `studentId`。
- 图表只接受 `ChartSpec 1.0`，渲染层不执行任意 JavaScript；空数据返回解释性空态。
- 知识卡片复用 `LEARNING_FLOW_PRELOAD` Worker，以通用卡片与个性化卡片两层缓存服务 Trainer 等待期。

## 修复边界

- 确定性识别高置信文件意图与学习分析意图；模型继续负责开放式回答，不承担权限边界。
- 系统试卷/讲义 Agent 只生成确认草稿，用户点击“生成”后才复用同一任务进入正式文件生成。
- 学生宽泛分析不会被静默缩小到首门课程；只有显式课程、显式知识点或唯一可推断课程才进入窄范围。
- 卡片生成失败或超时时立即展示安全回退卡片，后台可继续刷新，不阻塞 Trainer 正式输出。

## 工作区保护

本轮仅在当前 dirty worktree 上增量修改；未执行 Git reset、clean、checkout 或 restore，未改真实 `.env`，未重建数据库，也未删除真实业务数据。
