const { Annotation, StateGraph, START, END } = require('@langchain/langgraph');
const prisma = require('../../config/prisma');
const contextService = require('../subject-chat/subject-chat-context.service');
const agentContext = require('../agent-chat/agent-context.service');
const { createOrchestrationTool, invokeStructured } = require('./orchestration-tools');

const GRAPH_VERSION = 'agent-orchestration-v1';
const MAX_AGENT_REFS = Math.max(1, Number(process.env.AGENT_GRAPH_MAX_AGENTS || 6));
const MAX_KB_REFS = Math.max(1, Number(process.env.AGENT_GRAPH_MAX_KNOWLEDGE_BASES || 8));
const MAX_GRAPH_STEPS = Math.max(8, Number(process.env.AGENT_GRAPH_MAX_STEPS || 16));
const MAX_PARALLEL_TOOLS = Math.max(1, Number(process.env.AGENT_GRAPH_MAX_PARALLEL_TOOLS || 3));

const GraphState = Annotation.Root({
  runId: Annotation(), userId: Annotation(), conversationId: Annotation(), question: Annotation(), content: Annotation(), assistantMode: Annotation(),
  conversation: Annotation(), courseId: Annotation(), subjectCode: Annotation(), attachments: Annotation(),
  agentRefs: Annotation(), knowledgeBaseRefs: Annotation(), resolvedAgents: Annotation(), resolvedKnowledgeBases: Annotation(),
  scope: Annotation(), intent: Annotation(), executionPlan: Annotation(), route: Annotation(), retrievedSources: Annotation(),
  agentResults: Annotation(), generatedTasks: Annotation(), generatedArtifacts: Annotation(), finalAnswer: Annotation(),
  policy: Annotation(), status: Annotation(), progress: Annotation(), currentNode: Annotation(), errors: Annotation(),
});

const AgentPlanState = Annotation.Root({
  runId: Annotation(), userId: Annotation(), conversationId: Annotation(), assistantMode: Annotation(),
  operationId: Annotation(), permissionContext: Annotation(), targets: Annotation(), index: Annotation(),
  results: Annotation(), errors: Annotation(), finalAnswer: Annotation(), currentNode: Annotation(),
});

function persisted(state, node) {
  return {
    graphVersion: GRAPH_VERSION, currentNode: node, assistantMode: state.assistantMode,
    questionLength: state.question?.length || 0, attachmentCount: state.attachments?.length || 0, courseId: state.scope?.course?.course_id || state.courseId || null,
    knowledgePointId: state.scope?.knowledgePoint?.knowledge_point_id || null,
    intent: state.intent || null, executionPlan: state.executionPlan || [], route: state.route || null,
    policy: state.policy || null, updatedAt: new Date().toISOString(),
  };
}
async function checkpoint(state, node, patch = {}) {
  const next = { ...state, ...patch, currentNode: node };
  await prisma.subjectChatRun.update({ where: { id: state.runId }, data: { graphVersion: GRAPH_VERSION, currentNode: node, stateJson: persisted(next, node) } });
  return { ...patch, currentNode: node };
}

function compileGraph() {
  return new StateGraph(GraphState)
    .addNode('validate_input', async (state) => {
      if (!state.question?.trim() && !(state.attachments || []).length) throw Object.assign(new Error('请输入问题或添加可分析的附件'), { code: 40001 });
      if ((state.agentRefs || []).length > MAX_AGENT_REFS) throw Object.assign(new Error(`单次最多调用 ${MAX_AGENT_REFS} 个智能体`), { code: 40001 });
      if ((state.knowledgeBaseRefs || []).length > MAX_KB_REFS) throw Object.assign(new Error(`单次最多引用 ${MAX_KB_REFS} 个知识库`), { code: 40001 });
      return checkpoint(state, 'validate_input', { policy: { maxAgents: MAX_AGENT_REFS, maxKnowledgeBases: MAX_KB_REFS, maxGraphSteps: MAX_GRAPH_STEPS, maxParallelTools: MAX_PARALLEL_TOOLS } });
    })
    .addNode('resolve_context', async (state) => {
      const scope = await contextService.resolveScope(state.userId, state.conversation, state.question);
      return checkpoint(state, 'resolve_context', { scope });
    })
    .addNode('enforce_permissions', async (state) => {
      const callContext = await agentContext.loadAgentCallContext(state.userId, {
        assistantMode: state.assistantMode,
        courseId: state.scope?.course?.course_id,
        subjectCode: state.conversation?.subject,
      });
      for (const target of state.agentRefs || []) {
        if (!agentContext.canCallAgentInContext(target.agent, callContext)) throw Object.assign(new Error('智能体已不在当前课程可调用范围内'), { code: 40301 });
      }
      return checkpoint(state, 'enforce_permissions');
    })
    .addNode('classify_intent', async (state) => {
      const hasFileAgent = (state.agentRefs || []).some(item => item.agent?.agentType === 'FILE_GENERATOR');
      const asksForFile = /(试卷|讲义|文档|导出|生成.*(?:pdf|docx|文件))/i.test(state.question);
      const intent = hasFileAgent || asksForFile ? 'file_generation' : (state.knowledgeBaseRefs?.length ? 'knowledge_qa' : 'learning_qa');
      return checkpoint(state, 'classify_intent', { intent });
    })
    .addNode('build_execution_plan', async (state) => {
      const executionPlan = [
        'retrieve_knowledge',
        ...(state.intent === 'file_generation' ? ['create_file_tasks'] : []),
        ...((state.agentRefs || []).some(item => item.agent?.agentType === 'CHAT') ? ['invoke_subject_agents', 'invoke_utility_agents'] : []),
        ...(!(state.agentRefs || []).length ? ['invoke_subject_agents'] : []),
        'collect_results', 'synthesize_answer', 'persist_messages', 'emit_artifacts', 'finalize',
      ];
      return checkpoint(state, 'build_execution_plan', { executionPlan, route: state.intent === 'file_generation' ? 'file' : 'answer' });
    })
    .addNode('file_route', state => checkpoint(state, 'create_file_tasks'))
    .addNode('answer_route', state => checkpoint(state, 'invoke_subject_agents'))
    .addNode('ready', state => checkpoint(state, 'ready'))
    .addEdge(START, 'validate_input')
    .addEdge('validate_input', 'resolve_context')
    .addEdge('resolve_context', 'enforce_permissions')
    .addEdge('enforce_permissions', 'classify_intent')
    .addEdge('classify_intent', 'build_execution_plan')
    .addConditionalEdges('build_execution_plan', state => state.route, { file: 'file_route', answer: 'answer_route' })
    .addEdge('file_route', 'ready')
    .addEdge('answer_route', 'ready')
    .addEdge('ready', END)
    .compile();
}

const graph = compileGraph();

async function prepare({ runId, userId, turn, question }) {
  return graph.invoke({
    runId, userId, conversationId: turn.conversation.id, question, content: question, conversation: turn.conversation,
    assistantMode: String(turn.conversation.mode || 'general').toLowerCase(),
    courseId: null, subjectCode: turn.conversation.subject || null, attachments: turn.userMessage?.attachments || [],
    agentRefs: turn.resolvedAgentRefs || [], knowledgeBaseRefs: turn.resolvedKnowledgeBases || [],
    resolvedAgents: turn.resolvedAgentRefs || [], resolvedKnowledgeBases: turn.resolvedKnowledgeBases || [],
    retrievedSources: [], agentResults: [], generatedTasks: [], generatedArtifacts: [], finalAnswer: '',
    status: 'running', progress: 0, errors: [],
  });
}

async function markExecutionNode(runId, state, node, patch = {}) {
  const merged = { ...persisted(state, node), ...(patch || {}) };
  await prisma.subjectChatRun.update({ where: { id: runId }, data: { currentNode: node, stateJson: merged } });
}

async function executeAgentPlan({ runId, userId, conversationId, assistantMode, operationId, permissionContext, targets, executeTarget, synthesizeResults }) {
  if (!Array.isArray(targets) || targets.length > MAX_AGENT_REFS) throw Object.assign(new Error(`单次最多调用 ${MAX_AGENT_REFS} 个智能体`), { code: 40001 });
  const graph = new StateGraph(AgentPlanState)
    .addNode('select_agent', async (state) => {
      const target = state.targets[state.index];
      const agentType = target?.agent?.agentType;
      const toolName = agentType === 'FILE_GENERATOR'
        ? 'FileRequirementExtractionTool'
        : state.assistantMode === 'subject' ? 'SubjectAgentTool' : 'GeneralAgentTool';
      const current = await prisma.subjectChatRun.findUnique({ where: { id: state.runId }, select: { stateJson: true } });
      await prisma.subjectChatRun.update({ where: { id: state.runId }, data: {
        currentNode: `invoke_agent:${state.index + 1}`,
        stateJson: { ...(current?.stateJson || {}), graphVersion: GRAPH_VERSION, currentNode: `invoke_agent:${state.index + 1}`, agentIndex: state.index, agentId: target?.agent?.id || null, toolName, updatedAt: new Date().toISOString() },
      } });
      return { currentNode: toolName };
    })
    .addNode('invoke_agent_tool', async (state) => {
      const target = state.targets[state.index];
      const toolName = target?.agent?.agentType === 'FILE_GENERATOR'
        ? 'FileRequirementExtractionTool'
        : state.assistantMode === 'subject' ? 'SubjectAgentTool' : 'GeneralAgentTool';
      const tool = createOrchestrationTool(toolName, () => executeTarget(target, state.index));
      try {
        const result = await invokeStructured(tool, {
          userId: state.userId, conversationId: state.conversationId,
          operationId: `${state.operationId}:agent:${state.index}`,
          permissionContext: state.permissionContext,
          payload: { agentId: target?.agent?.id, sequence: state.index },
        });
        return { index: state.index + 1, results: [...state.results, result] };
      } catch (error) {
        if (error?.cause?.name === 'AbortError' || error?.name === 'AbortError') throw (error.cause || error);
        return { index: state.index + 1, errors: [...state.errors, { agentId: target?.agent?.id || null, message: error.message }] };
      }
    })
    .addNode('collect_results', async (state) => {
      await prisma.subjectChatRun.update({ where: { id: state.runId }, data: { currentNode: 'collect_results' } });
      return { currentNode: 'collect_results' };
    })
    .addNode('synthesize_answer', async (state) => {
      if (typeof synthesizeResults !== 'function') return { finalAnswer: '', currentNode: 'synthesize_answer' };
      const tool = createOrchestrationTool('ResultSynthesisTool', () => synthesizeResults(state.results, state.errors));
      const result = await invokeStructured(tool, {
        userId: state.userId, conversationId: state.conversationId,
        operationId: `${state.operationId}:synthesize`, permissionContext: state.permissionContext,
        payload: { resultCount: state.results.length, errorCount: state.errors.length },
      }, { retries: 0 });
      await prisma.subjectChatRun.update({ where: { id: state.runId }, data: { currentNode: 'synthesize_answer' } });
      return { finalAnswer: String(result?.finalAnswer || result || ''), currentNode: 'synthesize_answer' };
    })
    .addEdge(START, 'select_agent')
    .addEdge('select_agent', 'invoke_agent_tool')
    .addConditionalEdges('invoke_agent_tool', state => state.index < state.targets.length ? 'next' : 'done', { next: 'select_agent', done: 'collect_results' })
    .addEdge('collect_results', 'synthesize_answer')
    .addEdge('synthesize_answer', END)
    .compile();
  if (!targets.length) return { results: [], errors: [] };
  return graph.invoke({
    runId, userId, conversationId, assistantMode, operationId,
    permissionContext, targets, index: 0, results: [], errors: [], finalAnswer: '', currentNode: 'select_agent',
  }, { recursionLimit: MAX_GRAPH_STEPS });
}

module.exports = { GRAPH_VERSION, prepare, markExecutionNode, executeAgentPlan };
