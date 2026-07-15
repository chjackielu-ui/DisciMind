# Skill / Tool 参数契约报告

更新日期：2026-07-15

## 审计结论

Skill Registry 已统一提供 `id / description / intents / requiredInputs / optionalInputs / tools / agents / workflow / outputTypes / allowedRoles`。Tool Registry 的模型参数、Zod 输入、handler 入参和 service 入参使用同一名称；所有 object schema 默认 `additionalProperties: false`。

| 需求能力 | Registry Tool | 核心必填参数 | Handler / Service 对齐 |
| --- | --- | --- | --- |
| 图表成果 | `create_chart_artifact` | `spec.version/chart/table/insights/source` | `artifactService.createChart(context, input)` |
| DOCX | `create_docx_artifact` | `title, sections[]` | `artifactService.createDocx` |
| XLSX | `create_xlsx_artifact` | `title, sheetName, columns, rows` | `artifactService.createSpreadsheet` |
| 学习记录 | `get_student_learning_records` | owner context；可选范围 | `student-learning-data.service` |
| 成绩趋势 | `get_student_score_trend` | owner context；可选 `range` | `student-learning-data.service` |
| 掌握度 | `get_student_mastery` | owner context；可选课程/知识点 | `student-learning-data.service` |
| 错题 | `get_student_wrong_questions` | owner context；可选筛选 | `student-learning-data.service` |
| Agent | `execute_agent` | `agentId, query, knowledgeBaseIds[]` | Agent 权限、检索、runtime |
| 知识库 | `knowledge_retrieve` | `query, knowledgeBaseIds[]` | Dify Dataset 检索 |

学生 owner-bound Tool 不接受客户端 `studentId`，目标用户来自认证上下文。教师跨用户分析必须先通过课程/教学班授权校验。

## Preflight 顺序

1. 工具存在；2. 角色允许；3. 输入可解析；4. normalizer 只做白名单转换；5. Zod 严格校验；6. 确认门禁；7. handler 可用；8. 通过后才发 `tool.started`。

参数错误统一公开结构：

```json
{
  "code": "AI_TOOL_VALIDATION_FAILED",
  "details": {
    "toolName": "create_chart_artifact",
    "argumentPath": "spec.chart.series.0.data",
    "expectedType": "array<number>",
    "receivedType": "undefined",
    "receivedValueSummary": "undefined",
    "recoverable": true,
    "requestId": "request-id"
  }
}
```

验证失败不会调用 handler；Function Calling 只允许一次结构化修复，第二次仍不合法即安全降级。测试覆盖 Registry 契约、字段级错误、事件顺序和 handler 零调用。
