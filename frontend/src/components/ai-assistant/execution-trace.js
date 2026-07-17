import { escapeHtml } from '../../utils/format.js'

const LABELS = {
  'run.started': '任务开始', 'intent.detected': '识别意图', 'plan.created': '生成计划',
  'search.started': '联网检索', 'search.sources': '发现来源', 'search.completed': '检索完成',
  'knowledge.started': '知识检索', 'knowledge.hits': '知识命中', 'knowledge.completed': '知识检索完成',
  'module.started': '模块启动', 'module.completed': '模块完成', 'step.started': '步骤开始', 'step.progress': '步骤进展', 'step.completed': '步骤完成',
  'run.phase': '运行阶段', 'run.heartbeat': '运行心跳', 'agent.started': 'Agent 启动', 'agent.first_delta': 'Agent 首次输出',
  'agent.heartbeat': 'Agent 心跳', 'agent.completed': 'Agent 完成', 'agent.failed': 'Agent 失败', 'tool.validation_failed': '工具参数预检失败', 'tool.started': '工具调用',
  'tool.completed': '工具完成', 'artifact.completed': '成果完成', 'run.completed': '任务完成', 'run.failed': '任务失败', 'run.stalled': '任务超时', 'run.cancelled': '任务取消',
}

export function createExecutionTrace(root) {
  const state = { events: [], expanded: false }
  function render() {
    if (!root) return
    const compact = state.expanded ? state.events : state.events.slice(-4)
    root.innerHTML = state.events.length ? `<section class="ai-execution-trace">
      <button type="button" data-trace-toggle><b>执行轨迹</b><span>${state.events.length} 个事件 ${state.expanded ? '收起' : '展开'}</span></button>
      <ol>${compact.map(event => `<li class="${event.type === 'run.failed' ? 'failed' : ''}"><i></i><span><b>${escapeHtml(LABELS[event.type] || event.type)}</b><small>${escapeHtml(event.payload?.toolName || event.payload?.title || event.payload?.requestId || '')}</small></span></li>`).join('')}</ol>
    </section>` : ''
    root.querySelector('[data-trace-toggle]')?.addEventListener('click', () => { state.expanded = !state.expanded; render() })
  }
  return { push(event) { if (!event?.type || state.events.some(item => item.sequence === event.sequence && item.runId === event.runId)) return; state.events.push(event); state.events.sort((a, b) => a.sequence - b.sequence); render() }, reset() { state.events = []; render() }, getEvents: () => [...state.events] }
}
