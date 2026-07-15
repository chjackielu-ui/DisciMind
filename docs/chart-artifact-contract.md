# Chart Artifact Contract 1.0

更新日期：2026-07-15

唯一标准结构：

```json
{
  "version": "1.0",
  "chart": {
    "type": "line | bar | pie | radar | scatter",
    "title": "string",
    "subtitle": null,
    "xAxis": ["string"],
    "series": [{ "name": "string", "data": [0] }],
    "unit": "%"
  },
  "table": { "columns": ["string"], "rows": [["value", 0]] },
  "insights": ["string"],
  "source": { "type": "student_learning_data", "range": "30d" }
}
```

该结构由 Tool Schema、Zod、handler、Artifact Service、前端 ECharts Renderer、测试 fixture 和 Planner 共同使用。`series[*].data.length` 必须与 `xAxis.length` 一致，表格必须保留原始真实数据，空数据不得猜造。

`ChartArgumentNormalizer` 只支持以下安全别名：`chartType → chart.type`、`labels → chart.xAxis`、`datasets → chart.series`、`values → chart.series[0].data`、`dataPoints → chart/table`。无法恢复真实值时返回字段级错误。

失败路径：

1. 保存已取得的 owner-bound 原始数据；
2. 对结构化参数做一次白名单修复；
3. 不重新查询数据库；
4. 仍失败则返回表格与文字洞察；
5. 前端显示可重试的“重新生成图表”。

真实验收会话 68 使用 `get_student_mastery` 返回 10 个真实知识点，生成“知识点掌握度”ECharts、表格和洞察；6/6、100%，无学科 Agent、无 `Invalid input`。1440×900、1024×768、390×844 均可见且无横向溢出。
