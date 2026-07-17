# 学习流启动加固

更新日期：2026-07-15

## 根因与修复

真实计划 4 与历史计划 2 共享学习目标 16；完成态会话 50 已被计划 2 唯一绑定。旧逻辑按 goal 直接复用 50，再把它写入计划 4，触发 `student_learning_plans_learning_session_id_key` 的 Prisma `P2002`，控制器最终把它折叠成通用服务器错误。

新链路在用户/计划锁内执行：校验所有权 → 构建结构化 readiness → 解析当前计划已有会话 → 复用 RUNNING/PAUSED/PREPARING → 对被其他计划占用的完成态 goal 创建当前计划的新一轮 goal → 事务创建/绑定会话 → `P2002` 竞争恢复到获胜会话 → 返回明确导航。

## Readiness

启动必需：有效计划、有效 WorkflowSnapshot、首节点存在、首节点文本已就绪或可即时生成、当前用户拥有计划、会话可创建或复用。

可降级：TTS、下一节点预加载、知识卡片个性化、PDF 预览和后续节点内容。TTS `TTS_UPSTREAM_ERROR` 不阻止文字学习。

```json
{
  "canStart": true,
  "required": { "plan": "ready", "workflowSnapshot": "ready", "firstNode": "ready" },
  "optional": { "tts": "degraded", "nextNode": "pending", "cards": "ready" },
  "blockingReasons": []
}
```

## 幂等与状态

- 相同用户/计划的进程内请求共享同一 Promise；数据库事务和唯一键处理跨请求竞争。
- RUNNING 返回原会话；PAUSED 恢复并返回；PREPARING 继续准备；终态按产品规则进入结果或创建新一轮。
- 重复点击、并发请求、刷新后再点均返回同一 session。
- `node_1` 必须属于冻结的 workflow snapshot；0% + `node_1` 是合法初态。

稳定业务码包括 `LEARNING_PLAN_NOT_FOUND`、`LEARNING_PLAN_FORBIDDEN`、`WORKFLOW_SNAPSHOT_MISSING`、`FIRST_NODE_NOT_READY`、`SESSION_CONFLICT`、`SESSION_CREATE_FAILED`、`PRELOAD_REQUIRED_FAILED`、`INVALID_SESSION_STATE`、`LEARNING_START_TIMEOUT`。公开响应携带 `requestId` 和恢复动作，不暴露 Prisma/路径/堆栈。

前端点击后立即禁用；根据响应提供继续旧会话、重新准备、重试或查看准备状态。成功使用 `navigation.route` 进入 `#/student/learning/session/:id`。
