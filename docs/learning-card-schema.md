# LearningCard 1.0 协议

后端唯一校验入口为 `backend/src/modules/learning-card/learning-card.schemas.js`，前端通过 `normalizeLearningCard` 兼容旧卡后统一消费。

核心字段包括：`version`、`id`、`scope`、`cardType`、课程/知识点上下文、标题/摘要/推荐原因、阅读时长、优先级、`markdownContent`、`sections`、`sourceRefs`、`actions`、`state`、`generator` 和时间字段。`sections` 只允许 MARKDOWN、FORMULA、CHART、TABLE、EXAMPLE、CALLOUT；图表必须是 ChartSpec 1.0，表格要求行列一致。学生个性化卡必须有推荐原因和至少一个来源。

持久化由 `LearningCard` 保存完整 `contentJson` 与检索字段，`UserLearningCardState` 保存跨场景状态，`LearningCardEvent` 保存行为，`DailyLearningCardSet` / `Item` 固定当天槽位。旧 Trainer 卡通过迁移适配器标记为 `generator.generationMode=MIGRATED`，无需复制另一份前端协议。

安全边界：Zod strict 拒绝未知/畸形结构；Markdown 由 DOMPurify 清洗；禁止 script/iframe/object/embed；前端从不执行模型 JavaScript；公式失败显示原文；来源 URL 仍受现有路由白名单约束。
