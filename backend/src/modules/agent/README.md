# Agent 调度模块

本模块聚合 Trainer、Explainer、Diagnostician 三类正式教学 Agent 的路由、控制器和服务。

智能体运行统一由 LangChain + LangGraph 和本地 learning-agent 封装完成。第三方模型请求、知识库检索和运行时鉴权均由后端中转，前端不接触模型或云服务密钥。

Agent 按请求或异步任务队列执行，统一入口为 `/api/agent`；常驻任务由全局异步任务 Worker 管理。
