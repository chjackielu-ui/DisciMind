/**
 * Learning Agent public entrypoint.
 *
 * Modules outside learning-agent must import from here instead of reaching into
 * agents/ or graph/ with fragile relative paths.
 */
const explainer = require('./agents/explainer.agent');
const trainer = require('./agents/trainer.agent');
const diagnostician = require('./agents/diagnostician.agent');
const graph = require('./graph/learning-flow.graph');

function assertLearningAgentModules() {
  const required = {
    runExplainer: explainer.runExplainer,
    runTrainer: trainer.runTrainer,
    evaluateTrainerAnswer: trainer.evaluateAnswer,
    runDiagnostician: diagnostician.runDiagnostician,
    invokeGraph: graph.invokeGraph,
    resumeGraph: graph.resumeGraph,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => typeof value !== 'function')
    .map(([name]) => name);
  if (missing.length) {
    const error = new Error(`Learning Agent 模块导出不完整: ${missing.join(', ')}`);
    error.code = 'LEARNING_AGENT_SMOKE_FAILED';
    throw error;
  }
  return Object.keys(required);
}

module.exports = {
  runExplainer: explainer.runExplainer,
  runTrainer: trainer.runTrainer,
  evaluateTrainerAnswer: trainer.evaluateAnswer,
  runDiagnostician: diagnostician.runDiagnostician,
  deterministicDiagnosis: diagnostician.deterministicDiagnosis,
  invokeGraph: graph.invokeGraph,
  resumeGraph: graph.resumeGraph,
  inspectGraph: graph.inspectGraph,
  rebuildGraphThread: graph.rebuildGraphThread,
  buildInitialState: graph.buildInitialState,
  assertLearningAgentModules,
};
