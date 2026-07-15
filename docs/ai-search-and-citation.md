# 原生联网搜索与引用规范

更新日期：2026-07-15

## Provider 协议

`qwen3.7-plus` 通过 DashScope 原生 `multimodal-generation/generation` SSE 接口执行联网搜索。OpenAI 兼容接口继续用于 Function Calling；两条协议职责分开，兼容接口不伪造 `search_info`。

请求使用后端凭据，消息转换为 Multimodal Generation 的 `content: [{ text }]` 结构。客户端识别 HTTP 错误、HTTP 200 内嵌错误帧、断流和超时，并保留不含内容和密钥的 request id/usage 证据。

## 搜索模式

- `off`：绝不发送联网搜索请求，即使问题包含“最新”。
- `auto`：服务端实时性词典命中后搜索；普通稳定知识问题不搜索。
- `force`：始终设置 `forced_search=true`；如果没有 `search_info` 或搜索插件使用证据，任务失败而不是静默当成搜索成功。

共同参数包括 `enable_source`、`enable_citation`、`citation_format`、`prepend_search_result` 和 `search_strategy`。当前模型确认支持 `turbo`、`max`、来源、引用、前置来源和 search extension。`agent` 策略、freshness、指定站点、自然语言干预和图文混搜没有确认支持，能力矩阵会在前端禁用并在后端裁剪，不能无条件透传。

## 来源与顺序

来源从 `search_info.search_results` 归一化为：

```json
{
  "index": 1,
  "title": "来源标题",
  "url": "https://example.com/page",
  "site": "example.com",
  "snippet": "摘要",
  "sourceType": "WEB_SEARCH"
}
```

只接受 HTTP/HTTPS URL。来源写入 `AiTraceRetrieval`，学生 Subject Chat 还同步写 `SubjectChatSource`，最终消息写 `sourcesJson`。事件序列保证 `search.sources` 早于首个 `answer.delta`；前端可在模型仍流式回答时先展示来源。

## 引用规则

- 支持 `[ref_n]` 和 `[n]`，内部统一映射到来源序号。
- 引用渲染发生在 Markdown 清洗后，并使用 DOMPurify；点击角标聚焦对应来源卡。
- 代码块、行内代码、KaTeX 公式和既有 Markdown 链接先占位保护，避免误把其内容替换成引用。
- 只有能映射到安全来源 URL 的引用才变成可点击角标；无对应来源时保留普通文本。
- 知识库、网页和 Agent 来源使用同一面板，但保留 `sourceType` 标签，不能把知识库命中伪装成网页来源。

## 能力探测

`GET /api/ai-assistant/capabilities` 合并静态白名单与 `SystemConfig` 中最近一次真实探测结果。前端依据每项 `supported/reason/verifiedAt` 显示或禁用高级开关；后端仍执行同一裁剪，防止绕过 UI。

本轮真实探测确认：模型 `qwen3.7-plus`、协议 `dashscope-multimodal-generation`、联网发生、10 个来源、引用可观察、Function Calling 可观察。原 text-generation URL 的真实返回为 HTTP 200 错误帧 `InvalidParameter: url error`，已改为模型实际可用的 multimodal-generation 接口。
