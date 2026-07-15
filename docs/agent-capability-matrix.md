# Agent 能力矩阵

更新日期：2026-07-15

`agent-registry.service.js` 对每个候选 Agent 输出统一能力结构：`id`、`name`、`description`、`capabilityTags`、`supportedIntents`、`forbiddenIntents`、`inputTypes`、`outputTypes`、`requiredContext`、`optionalContext`、`supportedRoles`、`canUseKnowledgeBase`、`requiresKnowledgeBase`、`canGenerateArtifact`、`supportedArtifactTypes`、`priority`、`confidenceThreshold`、`timeout`、`fallbackAgentIds`。

| Agent 类别 | 允许 intent | 禁止 intent | 输入 | 输出 | 知识库 | 成果 |
| --- | --- | --- | --- | --- | --- | --- |
| 学科答疑 Agent | 概念解释、教材问答、课程知识库问答、学科例题、学科推理 | 问候、本人数据、成绩/图表、错题列表、文件导出、实时新闻、任务管理、附件缺失 | text、knowledge context | answer、citations | 可用；显式知识问答优先 | 否 |
| 文件生成 Agent | 文件需求与结构化内容 | 普通问候、实时搜索、本人数据直查 | confirmed requirements、attachments | structured artifact content | 可选 | DOCX/PDF/XLSX（按配置） |
| 通用/直接模型 | 简单对话、降级综合 | 无权数据读取、未经确认写入 | text、validated tool results | answer | 不直接绕过权限检索 | 否 |

自动选择规则：

- 高置信 owner-bound、图表、问候、文件、联网和附件路由禁止自动学科 Agent。
- 普通自动匹配默认最多一个 Agent，必须达到 `confidenceThreshold`。
- 手动 Agent 优先用户选择，但仍重新校验所有权、公开状态、角色、助手模式、课程范围和运行时。
- 多 Agent 只在用户显式选择多个 Agent 或复杂规划确需协作时启用；计划持久化串行依赖或并行独立分支。
- Agent 失败后只使用 `fallbackAgentIds` 中仍通过权限和能力校验的候选；无合格候选时安全降级。

真实验收：问候、错题、学习图表均未调用学科 Agent；知识库问答只调用“机器学习概念助手”，并返回 5 条真实知识库来源。
