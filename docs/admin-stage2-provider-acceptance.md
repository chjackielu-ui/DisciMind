# DisciMind 阶段 2：AI 供应商、密钥与模型中心验收

> 验收日期：2026-07-15  
> 结论：**通过并封板。按 2026-07-15 最新任务顺序，随后优先进入基础对象管理闭环，暂不进入阶段 3 Agent 与版本治理。**

## 已实现范围

- 七类统一供应商：`bailian`、`qwen`、`deepseek`、`spark`、`dify`、`openai_compatible`、`custom`。
- 统一适配器九项操作：连接测试、模型列表、对话、流式对话、向量化、重排、健康检查、错误归一化和能力声明。
- 配置解析优先级：启用的数据库配置 → 兼容环境变量 → 安全默认配置；运行时带 60 秒可配置缓存与显式失效。
- AES-256-GCM 密钥存储；主密钥只取后端环境；API、审计、错误和前端不返回明文。
- 一般供应商新增/编辑不接受密钥字段；替换密钥和清除密钥为独立接口；清除同时要求前端二次确认和后端 `confirm: true`。
- Provider 与 Model 的详情、测试、启停、默认模型和独立密钥接口齐全；模型补充 `supports_rerank`、`created_by`、`updated_by`。
- 供应商卡片和模型表复用既有管理端布局、颜色、按钮、Drawer、Toast 和权限体系。

## 自动化门禁

| 门禁 | 结果 |
| --- | --- |
| 后端完整测试 | 434/434，21 suites，0 fail/cancel/skip/todo |
| 阶段 1+2 定向测试 | 15/15；包含各 Provider 环境密钥严格隔离回归 |
| 前端生产构建 | 952 modules，通过；仅保留既有 dynamic-import/chunk-size warning |
| API 烟测 | 只读 25/25；受控写 27/27 |
| 路由/API 闭环 | 24 管理路由，156/156 请求匹配，0 unmatched |
| RBAC 审计 | 9/9 |
| 阶段 2 专项审计 | 16/16 |
| 数据库完整性 | 76 PASS / 2 历史 WARN / 0 FAIL |
| 迁移 | 47 条现库升级成功；临时空库 11/11 检查通过并删除 |
| 静态 UI | 9 PASS / 2 既有 WARN / 0 FAIL |

## 真实浏览器验收

使用真实管理员会话完成以下闭环，未使用生产 Mock：

1. 新建临时 `custom` 供应商，一般配置 Drawer 中无任何密钥输入。
2. 独立“替换密钥” Drawer 默认空白；提交后卡片只出现 `****` 加最后四位，DOM 和错误反馈无明文。
3. 对不可达本地测试端点执行连接测试，得到脱敏的“无法连接供应商服务”，Console 无 warning/error。
4. 从供应商卡片进入过滤后的模型页，新建 `rerank` 模型并验证 `supports_rerank`、停用、启用和设为默认。
5. 清除密钥前出现危险操作确认框；确认后后端清除密文三元组，卡片回到“未配置”。
6. 临时 `security_auditor` 会话只显示“查看模型/调用记录”，无新增、编辑、测试、启停、替换或清除密钥按钮；模型行显示只读且无动作按钮。
7. 1440×900 与 1024×768 均无页面横向溢出；管理页头与全局消息/任务岛无重叠。

浏览器验收曾发现全局消息/任务岛覆盖管理页头动作的真实缺陷；已在共享 `.role-admin .admin-page-header` 中为桌面宽度预留固定控件区域并复验通过。临时供应商、模型、8 条对应审计记录和临时审计员均已按精确 ID 清理。

## 外部依赖边界

数据库保留 5 个真实内置供应商配置行；当前外部服务状态仍按实际连接结果显示 `unchecked`/`unavailable`。本阶段只确认配置、加密、权限、调用适配和真实失败态闭环，不把 HTTP 200、已填环境变量或最后四位解释为外部供应商可用。

## 证据

- `docs/admin-ai-provider-audit-result.md`
- `docs/admin-migration-verify-result.md`
- `docs/admin-db-integrity-report.md`
- `docs/admin-route-api-matrix.md`
- `docs/admin-ui-regression-result.md`
- `docs/admin-api-smoke-result.json`
- `docs/admin-api-smoke-write-guard-result.json`
