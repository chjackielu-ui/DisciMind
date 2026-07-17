# LearningCard 缓存与 SWR

每日卡使用内存、原子 JSON 和 MySQL 三层事实链。缓存键包含命名空间、用户和日期；单卡持久化键还包含用户、上下文、模型、Prompt、知识库与个性化版本。JSON 通过临时文件 + rename 原子写入，并在读取时再次执行 LearningCard 1.0 校验。

READY 直接返回；GENERATING 返回规则卡；STALE/FAILED 先返回旧缓存，再由进程内去重的 `activeRefreshes` 调度后台刷新。刷新页面只读当天缓存，不触发 Qwen；首次缺失才同步构建规则卡并排队 AI。AI 失败继续提供旧缓存/规则卡，数据库错误不被静默降级。

学习事件在 stale 缓存中记录 `pendingRefresh`，下一次读取按事件执行单槽刷新。任务使用 snapshot version、generation token、operationId 和 dedupeKey 四重保护，避免并发覆盖与重复调用。
