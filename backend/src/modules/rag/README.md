# RAG 检索增强生成模块

本模块是自研 RAG 能力的预留目录。

核心组件：
- rag.service.js：RAG 主服务（检索 + 生成）
- retriever.service.js：向量检索服务（Qdrant）
- source-trace.service.js：来源追溯服务

后续实现：
- 文本切片存储与索引
- 向量相似度检索
- 上下文增强生成
- 来源文件、页码、片段追溯
