# 学习流启动测试报告

测试日期：2026-07-15

## 自动化矩阵

| 场景 | 结果 |
| --- | --- |
| 全新计划首次开始 / 首节点可即时生成 | PASS |
| 首节点完整准备 | PASS |
| 文本准备、TTS 失败 | PASS，`canStart=true`、optional degraded |
| PARTIAL 预加载 | PASS，非关键失败不阻止 |
| 已有 PAUSED | PASS，复用并恢复 |
| 已有 RUNNING | PASS，返回同一会话 |
| 连续/并发点击 | PASS，共享同一 Promise/Session |
| 刷新后再次开始 | PASS，返回已绑定会话 |
| 创建竞争 `P2002` | PASS，恢复获胜会话 |
| WorkflowSnapshot 缺失 | PASS，稳定阻塞码 |
| `node_1` 缺失 | PASS，稳定阻塞码 |
| 必需预加载失败 | PASS，阻止且可重新准备 |
| 非本人计划 | PASS，所有权校验 |
| 已完成计划重新开始 | PASS，显式产品动作 |

新增的 `learning-start-hardening.test.js` 与 `learning-session-idempotency.test.js` 共 10 项专项测试全部通过；系统既有 session recovery 回归 3 项继续通过。

## 真实 API / 数据库

计划 4（机器学习 / 逻辑回归 / 考试冲刺流 v1）创建新一轮 goal 30，并绑定 session 51。两次并发 `POST /api/student-learning-plans/4/start` 均返回 HTTP 200、业务码 0、session 51、plan `RUNNING`；数据库中 goal 30 的 session 数量为 1。`GET current` 返回同一 session。

## 浏览器

- 页面 readiness 显示 plan、workflow snapshot、first node 全部 ready；TTS 明确为可降级项。
- 点击开始进入 `#/student/learning/session/51`；首节点“问题引入”可展示，刷新可恢复。
- 1440×900、1024×768、390×844 均无页面横向溢出。
- 没有未处理 500；同一计划未生成重复 Session。

session 51、goal 30 和计划 4 是当前真实计划的有效运行态，按要求保留；未作为测试垃圾删除。
