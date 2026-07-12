const { Annotation } = require('@langchain/langgraph');

const replace = (current, next) => next === undefined ? current : next;
const FileGeneratorState = Annotation.Root({
  artifactId: Annotation({ reducer: replace, default: () => null }),
  userId: Annotation({ reducer: replace, default: () => null }),
  agentId: Annotation({ reducer: replace, default: () => null }),
  conversationId: Annotation({ reducer: replace, default: () => null }),
  artifactType: Annotation({ reducer: replace, default: () => null }),
  taskId: Annotation({ reducer: replace, default: () => null }),
  artifact: Annotation({ reducer: replace, default: () => null }),
  learningContext: Annotation({ reducer: replace, default: () => null }),
  requirements: Annotation({ reducer: replace, default: () => null }),
  knowledgeSources: Annotation({ reducer: replace, default: () => [] }),
  outline: Annotation({ reducer: replace, default: () => [] }),
  generatedSections: Annotation({ reducer: replace, default: () => [] }),
  validatedContent: Annotation({ reducer: replace, default: () => null }),
  qualityIssues: Annotation({ reducer: replace, default: () => [] }),
  previewHtml: Annotation({ reducer: replace, default: () => null }),
  generated: Annotation({ reducer: replace, default: () => null }),
  requestedFormats: Annotation({ reducer: replace, default: () => ['DOCX'] }),
  exportResults: Annotation({ reducer: replace, default: () => [] }),
  error: Annotation({ reducer: replace, default: () => null }),
  stage: Annotation({ reducer: replace, default: () => 'resolve_learning_context' }),
});

module.exports = { FileGeneratorState };
