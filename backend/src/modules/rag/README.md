# RAG 检索增强生成模块

本模块提供课程知识库 RAG 的统一兼容入口，并复用正式的权限校验、后端知识库 provider 与本地片段降级链路。

核心组件：
- rag.service.js：RAG 主服务（检索 + 生成）
- retriever.service.js：授权课程检索与 LangChain/Qdrant 检索适配
- source-trace.service.js：来源追溯服务

文档解析、切片、异步索引和重试状态机位于 `knowledge-base` 模块；本目录不复制数据管线，避免形成权限和状态不一致的第二套实现。
