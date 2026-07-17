# AI Provider 模块

本模块负责大模型 Provider 的统一封装。

规划接入的模型：
- 讯飞星火（Spark）
- DeepSeek
- 通义千问（Qwen）

架构说明：
- provider.factory.js：根据配置返回对应的 Provider 实例
- spark.provider.js：讯飞星火 API 封装
- deepseek.provider.js：DeepSeek API 封装
- qwen.provider.js：通义千问 API 封装
- ai.service.js：统一 AI 调用服务

所有 API Key 必须从环境变量读取。
