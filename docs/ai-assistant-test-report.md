# 统一 AI 助手测试报告

测试日期：2026-07-15

## 2026-07-15 动态编排、图表与学习启动收口（本轮最新）

| 范围 | 结果 |
| --- | --- |
| 新增专项（路由/契约/图表/学习） | 24/24 通过 |
| 相关专项合计 | 50/50 通过 |
| 后端全量 | 503/503 通过，0 失败、0 跳过，约 75.67 秒 |
| 前端生产构建 | 963 modules，约 1.87 秒；仅既有动态导入与大 chunk 警告 |
| Prisma | `validate` 通过；49 migrations，schema up to date |

动态路由矩阵覆盖 32 条确定性请求。问候为 2 步，错题为 3 步，图表为 6 步，知识库问答为 4 步，文件确认为 2 步；高置信本人数据、图表、问候、联网、文件与附件任务不再自动调用学科 Agent。

真实浏览器结果：

- “你好。”：2/2，无知识库、无 Agent。
- “查看我最近的错题”：3/3，真实返回 20 道本人错题，只调用 `get_student_wrong_questions`。
- “请以图表形式分析我的学习状态”：6/6，读取 10 个真实掌握度数据，生成 ChartSpec 1.0、ECharts、表格和洞察，无学科 Agent、无 `Invalid input`。
- “结合机器学习知识库解释逻辑回归。”：自然语言解析并绑定 `DisciMind-机器学习-教材原文库`，4/4，调用“机器学习概念助手”，返回 5 条真实来源；数据库 Run Source 和 Trace Retrieval 均为 5。
- “帮我生成一份逻辑回归试卷 DOCX”：先显示持久确认卡；确认后生成 20 题结构化内容、预览和 READY DOCX。下载接口 HTTP 200、13,969 bytes、ZIP/OpenXML 签名通过。
- 计划 4 并发开始两次均 HTTP 200，返回同一 session 51；数据库同一新一轮 goal 30 仅 1 个 session。浏览器进入 `#/student/learning/session/51`，首节点可展示且刷新恢复。

1440×900、1024×768、390×844 均完成 AI 图表和学习会话验收，无横向溢出。应用自身 Console 0 error，Network 无未处理 500；Chrome 扩展内部出现过与页面无关的自动化 TypeError，不计为应用错误且未被隐藏。

清理按主键精确删除会话 71–75、5 个 Run、5 个 Trace、5 条终态通知、成果 578、导出 221、AsyncTask 2124、文件会话 1122 与物理成果目录。二次检查各项均为 0；3 个临时审计脚本已删除。真实计划 4、goal 30、session 51、原图表会话 68 和真实知识库未删除。

## 2026-07-15 AI 对话与学习卡片收口（最新）

| 范围 | 结果 |
| --- | --- |
| AI Assistant + 知识卡片专项 | 22/22 通过 |
| 后端全量 | 479/479 通过，0 失败，约 78.3 秒 |
| 前端生产构建 | 963 modules，约 1.81 秒；仅保留既有动态导入与大 chunk 警告 |
| Prisma | `validate` 与 `migrate status` 均退出码 0 |
| 代码差异检查 | `git diff --check` 退出码 0 |

真实学生本人学习数据探针确认八个 owner-bound Tool 均返回数据库结果：错题、学习记录、成绩趋势、掌握度、近期会话、学习时长和任务完成情况可用，客户端无需也不能提交 studentId。真实 Qwen 学习分析在约 2.1 秒完成并产出严格 ECharts ChartSpec；源数据中一条任务按既有字段计算为 204.44%，已按真实数据异常记录而未伪造截断。

真实文件链路先返回持久确认卡，支持生成、仅对话预览、修改和取消；预览不创建成果，修改后确认复用同一 AsyncTask。Qwen 正式试卷内容生成约 82.7 秒，主卷、参考答案和答题卷均生成，DOCX 下载 HTTP 200、13,966 bytes、ZIP 签名和 MIME 校验通过。

学习会话 50 的通用层与个性化层缓存均 READY，合并返回 5 张卡片。浏览器在 1440×900、1024×768 和 390×844 验收图表/表格/全屏/PNG 操作、持久文件卡和学习卡片；各视口无页面横向溢出，本地应用 Console 0 error。手机端真实点击“下一张”和“展开”通过。

全量测试改变知识版本哈希后，两层缓存被正确标记为 stale；真实 GET 触发 SWR，约 17.7 秒后通用层/个性化层重新 READY 且合并 5 张卡片。验收完成后精确删除 2 个临时 AI 会话、4 个验收成果、3 个导出、54 条本轮探针/全量测试/刷新任务和对应生成文件；清除 3 个临时审计脚本、错误工作目录下的重复缓存及浏览器产生的卡片展开状态。学习会话 50 恢复为 PAUSED；最新 READY 卡片缓存保留。没有删除真实历史学习数据。

## 已执行结果

| 范围 | 命令/方式 | 结果 |
| --- | --- | --- |
| Prisma | `npx prisma format`、`validate`、`generate` | 通过 |
| 数据库迁移 | `npx prisma migrate deploy` | 48 条迁移全部识别；`20260715110000_ai_assistant_hardening` 已应用 |
| 迁移后真实写读 | Trace、Tool Audit、Artifact、XLSX 临时记录 | 列存在、写读通过、XLSX 为 ZIP 签名；临时记录与文件已精确清理 |
| 后端专项 | `node --test test/ai-assistant-hardening.test.js` | 13/13 通过；包含确认门禁和串/并行 Agent 依赖计划 |
| 后端全量 | `npm test` | 466/466 通过，0 失败，约 65.2 秒 |
| 前端 | `npm run build` | 通过，961 modules，约 1.52 秒；仅保留既有动态导入和大 chunk 警告 |
| 真实 Qwen | 控量原生搜索 + Function Calling 探针 | 搜索发生、10 个来源、引用可观察、Function Calling 1 次，约 16.97 秒 |

真实模型证据：模型 `qwen3.7-plus`，协议 `dashscope-multimodal-generation`，request id `afa0a728-7a1d-9333-b718-3224c40b1e81`。测试没有打印或持久化 API Key/提示正文。

## 专项覆盖

13 项测试覆盖 OFF/AUTO/FORCE、时效性识别、参数裁剪、域名校验、代码/公式/Markdown 链接保护、来源事件先于回答、强制搜索未发生错误、学生拒绝教师工具、写操作确认门禁、工具参数/循环保护、多轮多调用 Function Calling、串/并行 Agent 依赖规划和真实 XLSX OOXML。

服务层与既有全量测试继续覆盖知识库权限、教师课程/教学班授权、手动 Agent 引用、Subject Chat 持久化、教师聊天保存、成果中心和旧接口兼容。

## 真实接口纠偏

首次使用 text-generation 原生 URL 时，DashScope 返回 HTTP 200 SSE 错误帧 `InvalidParameter: url error`。实现没有把它计为成功，而是返回 `AI_SEARCH_NOT_TRIGGERED/AI_SEARCH_UNSUPPORTED`。随后按真实模型协议切换到 multimodal-generation，搜索、来源和引用探针通过。

## 真实端到端场景

| 场景 | 真实结果 |
| --- | --- |
| 教师最近 7 天 AI 教育新闻 | FORCE 搜索返回真实来源，来源卡片在正文流式输出前出现 |
| 学生/教师能力接口 | 均为 HTTP 200；学生能力不含教师学情 Tool，教师包含；OFF 流为 17 个严格递增事件且无搜索事件 |
| FORCE 版本化 SSE | HTTP 200，495 个事件，10 个来源，`search.sources` 先于 `answer.delta`，引用与 `run.completed` 可观察 |
| 显式知识库、搜索 OFF | 模型真实调用 `knowledge_retrieve` 且未联网；当前本地 Dify Dataset 上游返回 HTTP 502，工具按设计降级并保留回答 |
| 学生错题总结 | 真实调用画像、错题汇总和 DOCX Tool；生成 READY DOCX，随后精确清理 |
| 教师班级分析 | 真实调用授权学情 Tool，生成 READY XLSX 和 ECharts 图表成果，随后精确清理 |
| 知识卡片 | 生成 CONTENT_READY JSON 卡片成果，随后精确清理 |
| 两 Agent 串行 | 2 个 MODEL Agent 均成功，第二个输入真实包含第一个输出，0 个 Agent 失败 |
| 两 Agent 并行 | 两个输入彼此独立并由 `Promise.all` 同时执行，0 个 Agent 失败，最终统一综合 |

## 浏览器验收

Chrome 新标签恢复交互通道后，教师与学生入口均在 1366×768、1440×900、1920×1080 三个实际 CSS 视口完成验收；所有视口 `scrollWidth <= innerWidth`，无横向溢出。

- 教师端：三栏暖色布局、OFF/AUTO/FORCE、能力矩阵禁用态和原因均正确；FORCE 流式阶段先显示来源，结束后 9 个来源、引用联动定位第 9 张来源卡、轨迹可见，本地应用 Console 0 error。
- 学生端：九步任务 9/9 完成，数据库事件 `search.sources` seq=31 早于 `answer.delta` seq=32，结束 seq=62；刷新后仍为 9/9、100%，10 条持久化来源可展开，本地应用 Console 0 error。
- 学生端浏览器新闻验收提示带了“浏览器验收”前缀，触发现有学习域安全策略并返回拒答；真实搜索、来源、持久化与恢复均通过，但该个例不计为正文质量通过。
- 浏览器创建的临时教师/学生会话、Trace、Run 和来源均已按主键清理，测试标签已关闭并恢复视口。

## 数据清理

- 真实探针不写密钥；临时测试会话、Trace、Tool Audit、Run、Source、Artifact 与导出文件已按主键/路径精确删除。
- 二次残留检查确认 `real-test-suite` Trace、浏览器临时会话和测试 Artifact 均为 0；空测试目录已删除。
- 未执行整表删除、清库、Git reset、Git clean、checkout 或 restore。
- 临时审计脚本、JSON 和后端诊断日志已删除；未删除真实业务数据。
