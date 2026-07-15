# 每日学习卡推荐

候选来自真实选课、知识点、掌握度、近 30 天学习记录、未解决错题、当前计划和待办任务。默认评分由薄弱度、遗忘风险、近期错误、任务紧迫度、计划相关性和教师优先级组成，可用 `LEARNING_CARD_RECOMMENDATION_WEIGHTS` 覆盖并自动归一化；重复曝光、已掌握和不感兴趣形成惩罚，收藏未掌握形成复习加权。

每日优先组成 WEAKNESS、WRONG、CONCEPT、TASK、PROGRESS 五槽；同类型最多 2 张，同一知识点不得相邻，候选键不得重复。无学习数据时只使用真实选课/任务和明确的新手引导，不伪造趋势。手动“换一组”按旋转偏移替换候选并记录当天新轮次。

学习事件使用 `affectedSlot` 先按 cardId、knowledgePointId、事件对应来源类型定位一个槽位，`chooseAffectedReplacement` 在其余四槽约束下选替代卡。未受影响卡 ID 和顺序保持不变，Worker 请求只携带目标卡 ID；无可用候选时才安全退回整组重算。
