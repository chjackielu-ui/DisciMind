// LangGraph State 定义
// 学习流 Graph 的完整状态结构

/**
 * LearningFlowState 注解（Annotation）
 *
 * 使用 LangGraph 的 Annotation API 定义状态结构。
 * 每个字段定义 reducer 和默认值。
 *
 * State 只保存轻量引用和当前上下文，完整历史数据写入 MySQL。
 */
const { Annotation } = require('@langchain/langgraph');

const LearningFlowState = Annotation.Root({
  /** Checkpoint schema version. Old checkpoints are rebuilt per session. */
  protocolVersion: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => 2,
  }),
  // ---- 会话标识 ----
  /** 学习运行 ID（对应 LearningSession.session_id） */
  runId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  /** LangGraph thread ID，默认等于 runId */
  threadId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  /** 学生用户 ID */
  studentId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  /** 学习流模板 ID */
  workflowId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  /** 课程 ID */
  courseId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  /** 知识点 ID */
  knowledgePointId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  // ---- 当前节点信息 ----
  /** 当前节点在节点列表中的索引 */
  currentNodeIndex: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => 0,
  }),

  /** 当前节点对象 {id, type, title, config} */
  currentNode: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  /** 节点列表（从 runtime_graph_json 解析） */
  nodeList: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),

  /** Original workflow graph, including conditional edges. */
  workflowGraph: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => ({ nodes: [], edges: [] }),
  }),

  // ---- 学生交互 ----
  /** 学生最新输入（文字或答案） */
  latestStudentInput: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  /** Last resume action returned by interrupt(). */
  latestAction: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  /** Submitted answers for the current generated practice set. */
  answerHistory: Annotation({
    reducer: (x, y) => (Array.isArray(y) ? y : x),
    default: () => [],
  }),

  /** Most recent answer evaluation returned to the API. */
  latestEvaluation: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  /** Zero-based question cursor inside the current generated practice set. */
  currentQuestionIndex: Annotation({
    reducer: (x, y) => (typeof y === 'number' ? y : (x ?? 0)),
    default: () => 0,
  }),

  /** 上传的文件引用列表 [{fileUrl, mimeType, fileName, fileSize}] */
  uploadedFileRefs: Annotation({
    reducer: (x, y) => (Array.isArray(y) ? y : x),
    default: () => [],
  }),

  // ---- 知识库检索 ----
  /** 知识库检索结果引用 */
  retrievalRefs: Annotation({
    reducer: (x, y) => (Array.isArray(y) ? y : x),
    default: () => [],
  }),

  // ---- 训练进度 ----
  /** 当前题目 ID（如有） */
  currentQuestionId: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  /** 当前题目数据（轻量引用，完整数据在 MySQL） */
  currentQuestionRef: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  // ---- 诊断信息 ----
  /** 诊断摘要 */
  diagnosisSummary: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  /** 待处理的干预建议 */
  pendingIntervention: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  // ---- 计数器 ----
  /** 当前节点内重试次数 */
  retryCount: Annotation({
    reducer: (x, y) => (typeof y === 'number' ? y : (x ?? 0)),
    default: () => 0,
  }),

  /** 当前节点迭代次数 */
  nodeIterationCount: Annotation({
    reducer: (x, y) => (typeof y === 'number' ? y : (x ?? 0)),
    default: () => 0,
  }),

  /** 当前训练节点已生成题目数 */
  trainingQuestionCount: Annotation({
    reducer: (x, y) => (typeof y === 'number' ? y : (x ?? 0)),
    default: () => 0,
  }),

  /** 补救轮次 */
  remediationRound: Annotation({
    reducer: (x, y) => (typeof y === 'number' ? y : (x ?? 0)),
    default: () => 0,
  }),

  // ---- 状态 ----
  /** Graph 执行状态: pending, running, waiting_student, completed, failed */
  status: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => 'pending',
  }),

  /** 当前阶段的 nodeRunId（幂等键） */
  currentNodeRunId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  /** 错误信息 */
  errorMessage: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  /** 错误码 */
  errorCode: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  // ---- 多模态 ----
  /** 图片分析结果（轻量摘要，不含 base64） */
  imageAnalysisSummary: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  /** 多模态任务计数 */
  multimodalTaskCount: Annotation({
    reducer: (x, y) => (typeof y === 'number' ? y : (x ?? 0)),
    default: () => 0,
  }),

  // ---- 知识库状态 ----
  /** 知识库是否可用 */
  knowledgeBaseAvailable: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => true,
  }),

  /** 降级标志 */
  isDegraded: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => false,
  }),

  // ---- 输出 ----
  /** Agent 最终输出（轻量引用） */
  agentOutputRef: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),

  /** Resolved agent type for response conversion. */
  agentType: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),

  /** 节点执行结果摘要 */
  nodeResultSummary: Annotation({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
});

/**
 * 状态约束常量（从环境变量读取）
 */
function getStateConstraints() {
  return {
    maxNodeIterations: parseInt(process.env.LANGGRAPH_MAX_NODE_ITERATIONS || '8', 10),
    maxTrainingQuestions: parseInt(process.env.LANGGRAPH_MAX_TRAINING_QUESTIONS || '6', 10),
    maxRemediationRounds: parseInt(process.env.LANGGRAPH_MAX_REMEDIATION_ROUNDS || '1', 10),
    maxConsecutiveNoProgress: 3,
    maxSameErrorType: 4,
    nodeTimeoutMs: 300000, // 5 minutes
  };
}

/**
 * 检查是否达到退出限制
 */
function checkExitConditions(state) {
  const constraints = getStateConstraints();
  const reasons = [];

  if (state.nodeIterationCount >= constraints.maxNodeIterations) {
    reasons.push(`节点迭代次数已达上限 (${constraints.maxNodeIterations})`);
  }
  if (state.trainingQuestionCount >= constraints.maxTrainingQuestions) {
    reasons.push(`训练题目数已达上限 (${constraints.maxTrainingQuestions})`);
  }
  if (state.remediationRound >= constraints.maxRemediationRounds) {
    reasons.push(`补救轮次已达上限 (${constraints.maxRemediationRounds})`);
  }

  return {
    shouldExit: reasons.length > 0,
    reasons,
  };
}

module.exports = {
  LearningFlowState,
  getStateConstraints,
  checkExitConditions,
};
