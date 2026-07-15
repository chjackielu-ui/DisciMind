const { z } = require('zod');

const CHART_TYPES = Object.freeze(['line', 'bar', 'pie', 'radar', 'scatter']);
const cellSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

const chartSeriesSchema = z.object({
  name: z.string().trim().min(1).max(100),
  data: z.array(z.number().finite()).max(366),
}).strict();

const chartSpecSchema = z.object({
  version: z.literal('1.0'),
  chart: z.object({
    type: z.enum(CHART_TYPES),
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(300).nullable().default(null),
    xAxis: z.array(z.string().max(100)).max(366),
    series: z.array(chartSeriesSchema).min(1).max(20),
    unit: z.string().max(30).nullable().default(null),
  }).strict(),
  table: z.object({
    columns: z.array(z.string().max(100)).min(1).max(20),
    rows: z.array(z.array(cellSchema).max(20)).max(1000),
  }).strict(),
  insights: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  source: z.object({
    type: z.string().trim().min(1).max(100),
    range: z.string().trim().max(100).nullable().default(null),
  }).strict(),
}).strict().superRefine((spec, ctx) => {
  for (const [index, series] of spec.chart.series.entries()) {
    if (series.data.length !== spec.chart.xAxis.length) {
      ctx.addIssue({ code: 'custom', path: ['chart', 'series', index, 'data'], message: 'series 数据长度必须与 chart.xAxis 一致' });
    }
  }
  for (const [index, row] of spec.table.rows.entries()) {
    if (row.length !== spec.table.columns.length) {
      ctx.addIssue({ code: 'custom', path: ['table', 'rows', index], message: '表格行列数量不一致' });
    }
  }
});

const chartToolInputSchema = z.object({ spec: chartSpecSchema }).strict();

function safeScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function stringList(value) {
  return Array.isArray(value) ? value.map(item => String(item ?? '').trim()).filter(Boolean) : [];
}

function normalizedSeries(value, fallbackValues, fallbackName) {
  const list = Array.isArray(value) ? value : [];
  const mapped = list.map(item => ({
    name: String(item?.name || item?.label || fallbackName || '').trim(),
    data: (Array.isArray(item?.data) ? item.data : Array.isArray(item?.values) ? item.values : []).map(Number),
  })).filter(item => item.name && item.data.length && item.data.every(Number.isFinite));
  if (mapped.length) return mapped;
  if (Array.isArray(fallbackValues) && fallbackValues.length && fallbackValues.map(Number).every(Number.isFinite)) {
    return [{ name: String(fallbackName || '指标值'), data: fallbackValues.map(Number) }];
  }
  return [];
}

function rowsFromSeries(xAxis, series) {
  return xAxis.map((label, index) => [label, ...series.map(item => item.data[index])]);
}

function fromDataPoints(points = []) {
  if (!Array.isArray(points) || !points.length) return null;
  const rows = points.map(point => {
    if (Array.isArray(point) && point.length >= 2) return [String(point[0]), Number(point[1])];
    const label = point?.label ?? point?.name ?? point?.x;
    const value = point?.value ?? point?.y;
    return [String(label ?? ''), Number(value)];
  });
  if (rows.some(row => !row[0] || !Number.isFinite(row[1]))) return null;
  return { xAxis: rows.map(row => row[0]), values: rows.map(row => row[1]), rows };
}

function normalizeChartArguments(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const candidate = raw.spec && typeof raw.spec === 'object' ? raw.spec : raw;
  const repairs = [];
  if (candidate.version === '1.0' && candidate.chart) {
    return { value: { spec: chartSpecSchema.parse(candidate) }, repaired: false, repairs };
  }

  const legacy = candidate.schemaVersion === '1.0' && candidate.kind === 'chart';
  const chart = candidate.chart && typeof candidate.chart === 'object' ? candidate.chart : candidate;
  const pointData = fromDataPoints(chart.dataPoints || candidate.dataPoints);
  const type = chart.type || chart.chartType || candidate.chartType;
  if (!chart.type && (chart.chartType || candidate.chartType)) repairs.push('chartType -> chart.type');
  const xAxis = stringList(chart.xAxis || chart.labels || chart.categories || candidate.categories || pointData?.xAxis);
  if (!chart.xAxis && (chart.labels || chart.categories || candidate.categories)) repairs.push('labels/categories -> chart.xAxis');
  if (!chart.xAxis && pointData) repairs.push('dataPoints -> chart.xAxis/table.rows');
  const datasets = chart.series || chart.datasets || candidate.series || candidate.datasets;
  if (!chart.series && (chart.datasets || candidate.datasets)) repairs.push('datasets -> chart.series');
  const series = normalizedSeries(datasets, chart.values || candidate.values || pointData?.values, chart.seriesName || candidate.seriesName || chart.unit || candidate.metric?.name || '指标值');
  if (!Array.isArray(datasets) && (chart.values || candidate.values)) repairs.push('values -> chart.series[0].data');
  const title = chart.title || candidate.title;
  const subtitle = chart.subtitle ?? candidate.subtitle ?? candidate.metric?.definition ?? null;
  const unit = chart.unit ?? candidate.unit ?? candidate.metric?.unit ?? null;
  const table = candidate.table && typeof candidate.table === 'object'
    ? candidate.table
    : { columns: ['分类', ...series.map(item => item.name)], rows: pointData?.rows && series.length === 1 ? pointData.rows : rowsFromSeries(xAxis, series) };
  if (!candidate.table && xAxis.length && series.length) repairs.push('chart data -> table');
  const source = candidate.source && typeof candidate.source === 'object'
    ? {
      type: String(candidate.source.type || candidate.source.tool || 'authorized_tool_data'),
      range: candidate.source.range == null ? (candidate.range?.label || null) : typeof candidate.source.range === 'string' ? candidate.source.range : candidate.source.range?.label || null,
    }
    : { type: 'authorized_tool_data', range: candidate.range?.label || null };
  if (legacy) repairs.push('legacy ChartSpec -> ChartSpec 1.0');
  const spec = chartSpecSchema.parse({
    version: '1.0',
    chart: { type, title, subtitle, xAxis, series, unit },
    table,
    insights: Array.isArray(candidate.insights) ? candidate.insights.map(String) : [],
    source,
  });
  return { value: { spec }, repaired: repairs.length > 0, repairs };
}

function insightFor(categories, values, unit) {
  if (!categories.length || !values.length) return [];
  let maxIndex = 0; let minIndex = 0;
  values.forEach((value, index) => { if (value > values[maxIndex]) maxIndex = index; if (value < values[minIndex]) minIndex = index; });
  const suffix = unit || '';
  if (maxIndex === minIndex) return [`当前仅有 ${categories.length} 个可用数据点。`];
  return [`${categories[maxIndex]}最高（${values[maxIndex]}${suffix}），${categories[minIndex]}最低（${values[minIndex]}${suffix}）。`];
}

function baseSpec({ title, subtitle, type, xAxis, series, unit, result, tool, table }) {
  return chartSpecSchema.parse({
    version: '1.0',
    chart: { type, title, subtitle: subtitle || null, xAxis, series, unit: unit || null },
    table,
    insights: insightFor(xAxis, series[0]?.data || [], unit),
    source: { type: tool, range: result.range?.label || null },
  });
}

function buildChartSpec(tool, result) {
  if (tool === 'get_student_score_trend') {
    const points = result.points || [];
    const xAxis = points.map(item => item.label);
    const values = points.map(item => safeScore(item.scoreRate));
    return baseSpec({ tool, result, type: 'line', title: '成绩变化趋势', subtitle: result.metricDefinition, xAxis, series: [{ name: '得分率', data: values }], unit: '%', table: { columns: ['日期', '项目', '得分率', '来源'], rows: points.map(item => [item.label, item.title, safeScore(item.scoreRate), item.sourceType]) } });
  }
  if (tool === 'get_student_mastery') {
    const items = result.items || [];
    const xAxis = items.map(item => item.name);
    const values = items.map(item => safeScore(item.score));
    return baseSpec({ tool, result, type: 'bar', title: '知识点掌握度', subtitle: result.metricDefinition, xAxis, series: [{ name: '掌握度', data: values }], unit: '%', table: { columns: ['知识点', '掌握度', '等级', '更新时间'], rows: items.map(item => [item.name, safeScore(item.score), item.level, item.updatedAt]) } });
  }
  if (tool === 'get_student_learning_time') {
    const items = result.daily || [];
    const xAxis = items.map(item => item.label);
    const values = items.map(item => safeScore(item.minutes));
    return baseSpec({ tool, result, type: 'bar', title: '学习时长', subtitle: result.metricDefinition, xAxis, series: [{ name: '学习时长', data: values }], unit: '分钟', table: { columns: ['日期', '学习分钟'], rows: items.map(item => [item.label, safeScore(item.minutes)]) } });
  }
  if (tool === 'get_student_task_completion') {
    const xAxis = ['已完成', '进行中', '未开始'];
    const values = [result.completed || 0, result.inProgress || 0, result.notStarted || 0].map(safeScore);
    return baseSpec({ tool, result, type: 'bar', title: '任务完成情况', subtitle: result.metricDefinition, xAxis, series: [{ name: '任务数', data: values }], unit: '个', table: { columns: ['状态', '任务数'], rows: xAxis.map((label, index) => [label, values[index]]) } });
  }
  throw Object.assign(new Error(`工具 ${tool} 没有受控图表映射`), { code: 'AI_CHART_SPEC_UNSUPPORTED', expose: true });
}

module.exports = {
  CHART_TYPES, chartSeriesSchema, chartSpecSchema, chartToolInputSchema,
  normalizeChartArguments, rowsFromSeries, buildChartSpec,
};
