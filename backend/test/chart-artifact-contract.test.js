const test = require('node:test');
const assert = require('node:assert/strict');

const { chartSpecSchema, normalizeChartArguments, buildChartSpec } = require('../src/modules/ai-assistant/chart-spec');
const { buildRegistry } = require('../src/modules/ai-assistant/tool-handlers.service');
const { chartFallbackText } = require('../src/modules/ai-assistant/assistant-orchestrator.service');

test('ChartSpec 1.0 has one strict standard structure', () => {
  const spec = buildChartSpec('get_student_mastery', {
    items: [{ name: '逻辑回归', score: 90, level: '熟练', updatedAt: '2026-07-15T00:00:00.000Z' }],
    metricDefinition: '掌握度口径', range: { label: '当前' }, source: { label: '真实数据库' },
  });
  assert.equal(spec.version, '1.0');
  assert.equal(spec.chart.type, 'bar');
  assert.deepEqual(spec.chart.xAxis, ['逻辑回归']);
  assert.equal(spec.chart.series[0].data[0], 90);
  assert.equal(spec.source.type, 'get_student_mastery');
  assert.deepEqual(chartSpecSchema.parse(spec), spec);
});

test('ChartArgumentNormalizer safely repairs supported aliases without changing values', () => {
  const normalized = normalizeChartArguments({ title: '掌握度', chartType: 'bar', labels: ['逻辑回归'], datasets: [{ label: '掌握度', values: [90] }], source: { type: 'get_student_mastery', range: '30d' } });
  assert.equal(normalized.repaired, true);
  assert.deepEqual(normalized.value.spec.chart.xAxis, ['逻辑回归']);
  assert.deepEqual(normalized.value.spec.chart.series, [{ name: '掌握度', data: [90] }]);
  assert.deepEqual(normalized.value.spec.table.rows, [['逻辑回归', 90]]);
  assert.ok(normalized.repairs.includes('datasets -> chart.series'));
});

test('dataPoints are normalized into chart and table while missing real data is rejected', () => {
  const normalized = normalizeChartArguments({ title: '趋势', type: 'line', dataPoints: [{ label: '第一周', value: 70 }, { label: '第二周', value: 80 }], source: { type: 'student_learning_data', range: '14d' } });
  assert.deepEqual(normalized.value.spec.chart.series[0].data, [70, 80]);
  assert.deepEqual(normalized.value.spec.table.rows, [['第一周', 70], ['第二周', 80]]);
  assert.throws(() => normalizeChartArguments({ title: '不能猜造', type: 'line', labels: ['第一周'] }), /too_small|Invalid input|expected/i);
});

test('chart Tool preflight returns a precise field path for malformed series', () => {
  const registry = buildRegistry();
  assert.throws(() => registry.preflight('create_chart_artifact', { spec: { version: '1.0', chart: { type: 'bar', title: '错误图表', xAxis: ['A'], series: [{ name: '值' }] }, table: { columns: ['分类', '值'], rows: [['A', 1]] }, insights: [], source: { type: 'test', range: null } } }, { user: { role: 'student' }, requestId: 'req-chart' }), error => {
    assert.equal(error.details.toolName, 'create_chart_artifact');
    assert.match(error.details.argumentPath, /series\[0\]\.data/);
    assert.equal(error.details.requestId, 'req-chart');
    return true;
  });
});

test('chart failure fallback preserves the original table and offers regeneration', () => {
  const spec = buildChartSpec('get_student_task_completion', { completed: 2, inProgress: 1, notStarted: 3, metricDefinition: '任务状态', source: { label: '数据库' } });
  const text = chartFallbackText(spec, { message: 'renderer unavailable' });
  assert.match(text, /已完成/);
  assert.match(text, /2/);
  assert.match(text, /重新生成图表/);
  assert.match(text, /renderer unavailable/);
});

