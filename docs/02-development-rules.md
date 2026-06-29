# 开发规范

## 1. 通用规范

- 前后端代码分离，各在独立目录
- 后端使用 CommonJS 模块规范
- 前端使用 ES Module 规范
- 环境变量统一从 .env 文件读取
- 不硬编码敏感信息

## 2. AI / Agent / Dify 模块开发规则

### 2.1 分阶段开发

AI、Agent、Dify 相关模块必须分阶段进行，不允许一次性生成完整智能体系统。

开发顺序：
1. 目录结构和占位文件预留
2. Dify API 后端封装（转发层）
3. 智能体广场基础列表
4. 自研 Agent 简单调度器
5. AI Provider 接入（逐个接入）
6. AI 对话前端页面
7. AI 图文视频生成

### 2.2 Dify API Key 安全

- Dify API Key 必须放在后端环境变量中，不得写在前端代码
- 前端所有 Dify 请求必须通过后端转发
- 前端不能直接暴露 Dify API Key

### 2.3 AI Provider 接入规范

- 每个 AI Provider 独立封装在单独文件中
- 所有 API Key 从环境变量读取
- 通过 factory 模式统一管理 Provider 实例

### 2.4 Prompt 模板管理

- Prompt 模板统一放在 `backend/src/prompts/` 目录
- 按用途分子目录：system、rag、agent、generate
- 禁止将长 Prompt 硬编码在 controller 或 service 中

## 3. 目录规范

- 后端模块放在 `backend/src/modules/`
- 前端模块放在 `frontend/src/modules/`
- 前端页面放在 `frontend/src/pages/`
- 前端组件放在 `frontend/src/components/`
- 项目文档放在 `docs/`

## 4. 协作规范

- 修改公共文件前必须说明原因
- 不擅自安装依赖
- 不擅自执行 Git 操作
- 不擅自执行数据库迁移
