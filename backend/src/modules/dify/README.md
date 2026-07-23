# Dify 模块

本目录仅保留历史 HTTP 路由兼容：

- 已停用的 Chat/Workflow 路由返回 HTTP 410 和迁移提示。
- 训练师兼容路由转发到本地 learning-agent runtime。
- 不创建 Dify 客户端，不读取 Dify 密钥，也不发起 Dify 外连。

正式智能体运行由 LangChain + LangGraph 负责，知识库由后端存储与向量 provider 负责。
