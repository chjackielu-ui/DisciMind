# 统一 AI 助手 API

基础路径：`/api/ai-assistant`。所有接口要求 JWT，允许 `student`、`teacher`、`admin`，数据仍按具体角色和资源授权过滤。

## GET /capabilities

返回模型、协议、搜索能力矩阵，以及当前角色可见的 Skill 与 Tool 描述。响应沿用项目 `{ code, message, data }` 包装。

## POST /stream

请求示例：

```json
{
  "content": "请查询最近 7 天人工智能教育新闻并标注来源",
  "searchOptions": {
    "mode": "auto",
    "strategy": "turbo",
    "enableSource": true,
    "enableCitation": true,
    "citationFormat": "[ref_<number>]",
    "prependSearchResult": true,
    "enableSearchExtension": false,
    "freshness": null,
    "assignedSiteList": [],
    "promptIntervene": null,
    "enableTextImageMixed": false
  },
  "agentRefs": [{ "agentId": 1 }],
  "agentExecutionMode": "serial",
  "knowledgeBaseRefs": [{ "knowledgeBaseId": 1 }],
  "autoAgent": true,
  "confirmed": false
}
```

`agentExecutionMode` 可为 `serial` 或 `parallel`。手动选择多个 Agent 时默认按选择顺序串行并把前序输出传给后序；显式设为 `parallel` 或问题包含明确并行意图时，各分支独立并发，完成后再综合。部分 Agent 失败会写入 Trace 并保留其他成功分支，全部失败才结束 Run。

响应为 `text/event-stream`。每个版本化事件格式：

```json
{
  "version": "1.0",
  "type": "search.sources",
  "runId": "uuid",
  "sequence": 4,
  "timestamp": "2026-07-15T00:00:00.000Z",
  "payload": {}
}
```

事件类型：`run.started`、`intent.detected`、`plan.created`、`search.started`、`search.sources`、`search.completed`、`reasoning.delta`、`agent.started`、`agent.completed`、`tool.started`、`tool.completed`、`artifact.started`、`artifact.completed`、`answer.delta`、`citations.updated`、`usage.updated`、`run.completed`、`run.failed`。`sequence` 在单次 Run 内严格递增。

## GET /traces/:traceId

返回当前用户自己的完整 Trace（计划、步骤、检索和工具调用）；管理员可查看全部。其他用户返回 403。

## GET /artifacts/:artifactId/download

仅 DOCX/XLSX READY 成果可下载。服务端校验成果所有权、记录状态、文件路径和 ZIP 签名，然后用安全文件名返回二进制内容。

## 既有入口兼容

- 学生仍使用 `/api/ai-chat/subject-chat/runs`；请求新增 `searchOptions/autoAgent/agentExecutionMode/confirmed`，持久化事件中包含统一 `protocol` 事件。
- 教师仍使用 `/api/teacher/ai/*`；请求新增同名字段，响应同时发送统一事件与旧 `meta/delta/done`。
- 旧客户端和旧消息在没有新字段时按 AUTO 默认值运行并正常降级展示。

## 公共错误

常见错误包括 `AI_SEARCH_DISABLED`、`AI_SEARCH_UNSUPPORTED`、`AI_SEARCH_NOT_TRIGGERED`、`AI_TOOL_VALIDATION_FAILED`、`AI_TOOL_TIMEOUT`、`AI_AGENT_FORBIDDEN`、`AI_WORKFLOW_LOOP`、`AI_MODEL_TIMEOUT`、`AI_STREAM_INTERRUPTED` 和 `AI_ARTIFACT_GENERATION_FAILED`。错误响应不包含密钥、上游正文、服务器路径或栈信息。
