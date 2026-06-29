# Prompt 模板目录

本目录用于存放 Prompt 模板文件。

子目录说明：
- system/：系统级 Prompt（角色设定、行为约束、输出格式等）
- rag/：RAG 问答 Prompt 模板
- agent/：Agent 调度 Prompt 模板
- generate/：AI 生成 Prompt 模板（文本、图片、视频）

Prompt 模板建议以 .prompt.txt 或 .md 格式存放，便于团队成员阅读和维护。
避免将复杂长 Prompt 硬编码在 controller 或 service 中。
