# Dify 模块

本模块负责封装 Dify API，包括：

- Chat 对话接口
- Workflow 工作流接口
- RAG 知识库检索接口

Dify 在本项目中作为主要的智能体编排平台。
所有 Dify API Key 必须从环境变量读取，前端不得直接暴露。
