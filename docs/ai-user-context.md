# AI 用户上下文与所有权边界

## 单一来源

`backend/src/modules/ai-assistant/user-context.service.js` 从已认证的 `req.user.user_id` 构建 `UserContext`。上下文包含安全用户摘要、当前学习上下文、选课、可推断课程、显式知识点和受控时间范围；不包含密码、密钥、存储路径或其他用户的明细。

## 推断规则

1. 优先采用请求中已通过权限校验的显式课程。
2. 其次匹配问题中明确出现的本人已选课程名称。
3. 再采用当前有效学习上下文。
4. 只有本人恰好一门可用课程时才允许唯一推断。
5. 宽泛的跨课程分析保持跨课程，不默认取列表第一项。
6. 知识点只接受显式 ID 或明确名称匹配，不从模糊分析请求中猜测。

时间范围统一为 7、30、90 天；缺省学习趋势使用 30 天。所有日期均由服务端计算并连同范围标签返回。

## Owner-bound Tool

学生端八个工具为：

- `get_current_student_context`
- `get_student_wrong_questions`
- `get_student_learning_records`
- `get_student_score_trend`
- `get_student_mastery`
- `get_student_recent_sessions`
- `get_student_learning_time`
- `get_student_task_completion`

这些 Tool 的输入 Schema 不接受 `studentId`；服务端只用认证用户 ID 查询。教师和管理员的既有受权工具保留原角色边界，学生不能通过 Agent 参数扩大作用域。

## 无数据与来源

每个工具都返回稳定的 `metric`、`source`、`range` 和 `noData` 语义。无真实记录时返回空数组和原因，不生成伪造分数、掌握度、学习时长或任务完成率。
