const test = require('node:test');
const assert = require('node:assert/strict');
const { canCallAgentInContext } = require('../src/modules/agent-chat/agent-context.service');
const { TOOL_NAMES, createOrchestrationTool, invokeStructured } = require('../src/modules/agent-orchestration/orchestration-tools');

test('general mode can call authorized general and subject agents while subject mode stays course-scoped', () => {
  const general = { assistantMode: 'general', courseId: null, subjectCode: null };
  const machineLearning = { assistantMode: 'subject', courseId: 11, subjectCode: 'ml-101' };
  assert.equal(canCallAgentInContext({ agentType: 'CHAT', subjectScope: 'GENERAL' }, general), true);
  assert.equal(canCallAgentInContext({ agentType: 'CHAT', subjectScope: 'SUBJECT', courseId: 99, subjectCode: 'english' }, general), true);
  assert.equal(canCallAgentInContext({ agentType: 'CHAT', subjectScope: 'SUBJECT', courseId: 11 }, machineLearning), true);
  assert.equal(canCallAgentInContext({ agentType: 'CHAT', subjectScope: 'SUBJECT', courseId: 99, subjectCode: 'english' }, machineLearning), false);
  assert.equal(canCallAgentInContext({ agentType: 'FILE_GENERATOR', subjectScope: 'GENERAL' }, machineLearning), true);
  assert.equal(canCallAgentInContext({ agentType: 'CHAT', subjectScope: 'GENERAL', isCrossSubjectUtility: true }, machineLearning), true);
});

test('orchestration capability registry contains the required LangChain tools and enforces permission context', async () => {
  for (const name of ['KnowledgeBaseRetrievalTool', 'DifyChatflowTool', 'DifyWorkflowTool', 'SubjectAgentTool', 'GeneralAgentTool', 'FileRequirementExtractionTool', 'HandoutGenerationTool', 'ExamGenerationTool', 'AttachmentTextExtractionTool', 'ImageUnderstandingTool', 'ArtifactLookupTool', 'TaskStatusTool']) {
    assert.ok(TOOL_NAMES.includes(name), `${name} must be registered`);
  }
  const tool = createOrchestrationTool('TaskStatusTool', async input => ({ operationId: input.operationId, status: 'RUNNING' }));
  await assert.rejects(() => invokeStructured(tool, { userId: 1, conversationId: 2, operationId: 'operation-123', permissionContext: {}, payload: {} }, { retries: 0 }), /权限上下文/);
  const result = await invokeStructured(tool, { userId: 1, conversationId: 2, operationId: 'operation-123', permissionContext: { assistantMode: 'general' }, payload: {} }, { retries: 0 });
  assert.deepEqual(result, { operationId: 'operation-123', status: 'RUNNING' });
});
