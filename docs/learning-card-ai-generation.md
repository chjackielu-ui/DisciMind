# LearningCard AI 生成

每日推荐先同步生成真实规则卡，再由既有 AsyncTask Worker 使用 `qwen3.7-plus` 增强最多 3 张。Prompt 只传最小必要画像，包含课程、知识点、卡片类型、目标、薄弱/错题摘要、难度、严格 Schema、Markdown/LaTeX、来源和“不得伪造图表数据”约束；默认关闭 thinking 并限制 token。

输出先提取 JSON、修复 JSON 控制字符造成的常见 LaTeX 反斜杠损坏，再经过 Zod、来源和 ChartSpec 质量检查。同一卡片 ID 原位持久化，前端不会因增强完成跳位。网络、模型和输出错误只计入 `aiFallbackCount` 并保留规则卡；Prisma 等持久化错误继续失败，避免伪成功。

每次生成轮次有完整 `generationToken`，任务 operation/dedupe 使用其安全前缀；Worker 同时核对快照版本和完整令牌。旧任务无法覆盖新轮次，增量任务还会按 `targetCardIds` 仅增强受影响槽位。
