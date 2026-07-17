# 文件意图、确认与生成闭环

## 路由

`intent-router.service.js` 先用确定性规则区分“需要可下载文件”和“只在对话中预览”。高置信试卷/讲义文件请求进入对应系统 FILE_GENERATOR；普通解释、示例或明确预览请求保留在聊天链。

手动选择 FILE_GENERATOR 时，如果 `file-requirement.service.js` 已补齐受控需求，就直接创建确认态，不再重复调用规划模型。需要补充的字段最多以紧凑编辑器暴露，不自动确认。

## 持久确认

`pending-action.service.js` 复用现有 `AsyncTask`：

- 初始状态为 `WAITING_EXTERNAL` 且 `requiresUserAction=true`。
- 支持 `generate`、`preview`、`modify`、`cancel` 四个动作。
- 刷新后从会话运行态和任务记录恢复同一张确认卡。
- `preview` 只返回对话预览，不创建 Artifact。
- `modify` 更新受控需求并继续复用原任务。
- `generate` 原子进入现有 FILE_GENERATION 链，重复点击复用同一任务/成果。

## 完成态

文件生成成功后，同一 pending action 返回关联 Artifact 的预览地址和 READY 导出格式。前端确认卡原位切换为“预览成果/下载 DOCX”等完成操作，不依赖临时内存状态。

## 错误契约

规划、Agent 调用、内容生成、导出和下载分别保留公开错误阶段与恢复动作；前端不显示 Prisma 栈、密钥、存储路径或上游 Authorization 信息。外部模型失败不会跳过确认门禁或伪造 READY 文件。
