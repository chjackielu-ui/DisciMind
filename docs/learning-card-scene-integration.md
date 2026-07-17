# LearningCard 场景融合

- 学生主页：总览之后、学习计划之前显示当天扇形卡组和“换一组”。
- 学习中心：展示“本次学习智学卡”，复用网格与统一详情。
- Trainer：保留原预加载与 WAITING/READY 流程，经适配器输出 LearningCard 1.0，不阻塞正式训练内容。
- 错题：展开真实错题后按需生成修复卡，保留错因、纠错建议和同点练习入口。
- AI 对话：`create_knowledge_cards` 生成真实 LearningCard Artifact，可展开、保存和加入计划。
- 课程详情：按类型、知识点和关键字筛选卡片库。
- 任务消息中心：每日完成通知回跳 `#/student/dashboard?focus=learning-cards`，标已读不关闭当前详情。

所有场景共享同一详情、Markdown/KaTeX/ChartSpec 渲染、用户状态和动作 API。收藏、掌握、稍后、不感兴趣会影响推荐；加入计划、开始练习、问 AI、查看来源和保存成果进入现有真实业务服务，不使用占位跳转。
