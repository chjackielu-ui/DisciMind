# Agent 自研调度模块

本模块聚合 Trainer、Explainer、Diagnostician 三类正式教学 Agent 的路由、控制器和服务。

与 Dify 互补：
- Dify 负责成熟的 Agent、Workflow、RAG 编排
- 本模块负责项目特色能力展示和轻量任务调度扩展

Agent 按请求或异步任务队列执行，统一入口为 `/api/agent`；常驻任务由全局异步任务 Worker 管理。
