const { StateGraph, START, END } = require('@langchain/langgraph');
const { FileGeneratorState } = require('./file-generator.state');
const nodes = require('./file-generator.nodes');

let compiled;
function getFileGeneratorGraph() {
  if (!compiled) compiled = new StateGraph(FileGeneratorState)
    .addNode('resolve_learning_context', nodes.resolveLearningContext)
    .addNode('plan_artifact', nodes.planArtifact)
    .addNode('retrieve_knowledge', nodes.retrieveKnowledge)
    .addNode('build_outline', nodes.buildOutline)
    .addNode('generate_sections', nodes.generateSections)
    .addNode('validate_schema', nodes.validateSchema)
    .addNode('repair_content', nodes.repairContent)
    .addNode('quality_check', nodes.qualityCheck)
    .addNode('build_preview', nodes.buildPreview)
    .addNode('persist_artifact', nodes.persistArtifact)
    .addNode('export_docx', nodes.exportDocx)
    .addNode('export_pdf', nodes.exportPdf)
    .addNode('export_pptx', nodes.exportPptx)
    .addNode('finalize', nodes.finalize)
    .addEdge(START, 'resolve_learning_context')
    .addEdge('resolve_learning_context', 'plan_artifact')
    .addEdge('plan_artifact', 'retrieve_knowledge')
    .addEdge('retrieve_knowledge', 'build_outline')
    .addEdge('build_outline', 'generate_sections')
    .addEdge('generate_sections', 'validate_schema')
    .addEdge('validate_schema', 'repair_content')
    .addEdge('repair_content', 'quality_check')
    .addEdge('quality_check', 'build_preview')
    .addEdge('build_preview', 'persist_artifact')
    .addEdge('persist_artifact', 'export_docx')
    .addEdge('export_docx', 'export_pdf')
    .addEdge('export_pdf', 'export_pptx')
    .addEdge('export_pptx', 'finalize')
    .addEdge('finalize', END)
    .compile();
  return compiled;
}

async function runFileGeneratorGraph(artifactId, { taskId, signal } = {}) {
  return getFileGeneratorGraph().invoke(
    { artifactId: Number(artifactId), taskId: taskId ? Number(taskId) : null },
    signal ? { signal } : undefined,
  );
}
module.exports = { getFileGeneratorGraph, runFileGeneratorGraph };
