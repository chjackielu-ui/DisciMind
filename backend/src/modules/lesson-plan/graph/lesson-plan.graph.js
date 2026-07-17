/**
 * 教师端智能教案生成 — LangGraph 定义
 *
 * 采用与 file-generator.graph.js 同款的线性 StateGraph 模式。
 * 6 节点、无分支、无 checkpointer（独立于学习流 graph）。
 *
 * 调用入口：runLessonPlanGraph(taskId)
 */

const { StateGraph, START, END } = require('@langchain/langgraph');
const { LessonPlanState } = require('./lesson-plan.state');
const nodes = require('./lesson-plan.nodes');

let compiled;

function getLessonPlanGraph() {
  if (!compiled) {
    compiled = new StateGraph(LessonPlanState)
      .addNode('resolve_params', nodes.resolveParams)
      .addNode('collect_learning_data', nodes.collectLearningData)
      .addNode('analyze_keywords', nodes.analyzeKeywords)
      .addNode('generate_content', nodes.generateContent)
      .addNode('build_docx', nodes.buildDocx)
      .addNode('persist_and_finalize', nodes.persistAndFinalize)
      .addEdge(START, 'resolve_params')
      .addEdge('resolve_params', 'collect_learning_data')
      .addEdge('collect_learning_data', 'analyze_keywords')
      .addEdge('analyze_keywords', 'generate_content')
      .addEdge('generate_content', 'build_docx')
      .addEdge('build_docx', 'persist_and_finalize')
      .addEdge('persist_and_finalize', END)
      .compile();
  }
  return compiled;
}

/**
 * 执行教案生成 Graph
 * @param {number} taskId - AsyncTask ID
 * @returns {Promise<object>} 最终 state
 */
async function runLessonPlanGraph(taskId) {
  return getLessonPlanGraph().invoke({ taskId: Number(taskId) });
}

module.exports = { getLessonPlanGraph, runLessonPlanGraph };
