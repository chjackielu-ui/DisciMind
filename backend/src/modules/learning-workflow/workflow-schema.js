// 学习流节点类型、条件类型、完成模式枚举和 JSON Schema 校验
const ALLOWED_NODE_TYPES = Object.freeze([
  'concept_explanation',
  'analogy_explanation',
  'worked_example_analysis',
  'socratic_questioning',
  'basic_practice',
  'adaptive_practice',
  'wrong_question_repair',
  'mastery_gate',
  'learning_summary',
]);

const ALLOWED_CONDITION_TYPES = Object.freeze([
  'always',
  'answer_correct',
  'answer_incorrect',
  'mastery_gte',
  'mastery_lt',
  'consecutive_wrong_gte',
  'accuracy_gte',
  'accuracy_lt',
  'student_confirmed',
  'student_rejected',
]);

const COMPLETION_MODES = Object.freeze(['flow_complete', 'mastery_target']);
const ADJUSTMENT_MODES = Object.freeze(['auto_adjust', 'ask_before_adjust', 'strict_original']);

const MAX_NODES = 30;
const MAX_EDGES = 60;
const MAX_TITLE_LENGTH = 200;
const MAX_DESC_LENGTH = 2000;
const MAX_NODE_TITLE_LENGTH = 100;
const MIN_TARGET_MASTERY = 60;
const MAX_TARGET_MASTERY = 100;
const DEFAULT_TARGET_MASTERY = 80;

// 节点类型 → Agent 映射
const NODE_TO_AGENT = {
  concept_explanation: { agent: 'EXPLAINER', defaultStrategy: 'direct_instruction' },
  analogy_explanation: { agent: 'EXPLAINER', defaultStrategy: 'analogy_bridge' },
  worked_example_analysis: { agent: 'EXPLAINER', defaultStrategy: 'direct_instruction' },
  socratic_questioning: { agent: 'EXPLAINER', defaultStrategy: 'socratic_dialogue' },
  basic_practice: { agent: 'TRAINER', defaultStrategy: 'basic_practice' },
  adaptive_practice: { agent: 'TRAINER', defaultStrategy: 'adaptive_training' },
  wrong_question_repair: { agent: 'DIAGNOSTICIAN', defaultStrategy: null },
  mastery_gate: { agent: null, defaultStrategy: null },
  learning_summary: { agent: 'DIAGNOSTICIAN', defaultStrategy: 'growth_report' },
};

// 节点类型分类
const NODE_CATEGORIES = {
  concept_explanation: 'explain',
  analogy_explanation: 'explain',
  worked_example_analysis: 'explain',
  socratic_questioning: 'explain',
  basic_practice: 'practice',
  adaptive_practice: 'practice',
  wrong_question_repair: 'repair',
  mastery_gate: 'control',
  learning_summary: 'summary',
};

// 条件表达式支持的参数引用
const ALLOWED_CONDITION_PARAMS = Object.freeze([
  'mastery',
  'consecutive_wrong',
  'accuracy',
  'answer_correct',
]);

function isPlainObject(value) {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 校验 graph_json 结构合法性
 */
function validateGraphJson(graph, options = {}) {
  const errors = [];

  if (!isPlainObject(graph)) {
    return { valid: false, errors: ['graph_json 必须是 JSON 对象'] };
  }

  // 校验 entryNodeId
  if (!graph.entryNodeId || typeof graph.entryNodeId !== 'string') {
    errors.push('缺少 entryNodeId 或类型不合法');
  }

  // 校验 nodes
  if (!Array.isArray(graph.nodes)) {
    errors.push('nodes 必须是数组');
  } else {
    if (graph.nodes.length === 0) {
      errors.push('nodes 不能为空');
    }
    if (graph.nodes.length > MAX_NODES) {
      errors.push(`nodes 数量不能超过 ${MAX_NODES}`);
    }

    const nodeIds = new Set();
    for (const node of graph.nodes) {
      if (!isPlainObject(node)) {
        errors.push(`node 必须是 JSON 对象`);
        continue;
      }
      if (!node.id || typeof node.id !== 'string') {
        errors.push(`node 缺少 id 或类型不合法`);
        continue;
      }
      if (nodeIds.has(node.id)) {
        errors.push(`node id "${node.id}" 重复`);
      }
      nodeIds.add(node.id);

      if (!ALLOWED_NODE_TYPES.includes(node.type)) {
        errors.push(`node "${node.id}" type "${node.type}" 不在允许列表中`);
      }

      if (node.title && typeof node.title === 'string' && node.title.length > MAX_NODE_TITLE_LENGTH) {
        errors.push(`node "${node.id}" title 不能超过 ${MAX_NODE_TITLE_LENGTH} 个字符`);
      }

      // 校验 config
      if (node.config && !isPlainObject(node.config)) {
        errors.push(`node "${node.id}" config 必须是 JSON 对象`);
      }
    }

    // 校验 entryNodeId 存在于 nodes 中
    if (graph.entryNodeId && !nodeIds.has(graph.entryNodeId)) {
      errors.push(`entryNodeId "${graph.entryNodeId}" 不在 nodes 中`);
    }
  }

  // 校验 edges
  if (!Array.isArray(graph.edges)) {
    errors.push('edges 必须是数组');
  } else {
    if (graph.edges.length > MAX_EDGES) {
      errors.push(`edges 数量不能超过 ${MAX_EDGES}`);
    }

    const nodeIds = new Set((graph.nodes || []).map((n) => n.id));
    const edgeIds = new Set();

    for (const edge of graph.edges) {
      if (!isPlainObject(edge)) {
        errors.push(`edge 必须是 JSON 对象`);
        continue;
      }
      if (!edge.id || typeof edge.id !== 'string') {
        errors.push(`edge 缺少 id 或类型不合法`);
        continue;
      }
      if (edgeIds.has(edge.id)) {
        errors.push(`edge id "${edge.id}" 重复`);
      }
      edgeIds.add(edge.id);

      if (!edge.source || !nodeIds.has(edge.source)) {
        errors.push(`edge "${edge.id}" source "${edge.source}" 不在 nodes 中`);
      }
      if (!edge.target || !nodeIds.has(edge.target)) {
        errors.push(`edge "${edge.id}" target "${edge.target}" 不在 nodes 中`);
      }

      // 校验 condition
      if (edge.condition) {
        if (!isPlainObject(edge.condition)) {
          errors.push(`edge "${edge.id}" condition 必须是 JSON 对象`);
        } else if (!ALLOWED_CONDITION_TYPES.includes(edge.condition.type)) {
          errors.push(`edge "${edge.id}" condition.type "${edge.condition.type}" 不在允许列表中`);
        }
        // 禁止 eval 和自定义表达式
        if (edge.condition.expression || edge.condition.code || edge.condition.eval) {
          errors.push(`edge "${edge.id}" 不允许使用自定义表达式 (expression/code/eval)`);
        }
      }

      // 校验 condition 参数
      if (edge.condition && edge.condition.params && !isPlainObject(edge.condition.params)) {
        errors.push(`edge "${edge.id}" condition.params 必须是 JSON 对象`);
      }
    }
  }

  // DAG 循环检测
  if (graph.nodes && graph.edges && errors.length === 0) {
    const edgePairs = new Set();
    for (const edge of graph.edges) {
      const pair = `${edge.source}->${edge.target}`;
      if (edgePairs.has(pair)) errors.push(`检测到重复连线: ${pair}`);
      edgePairs.add(pair);
    }

    const cycleNodes = detectCycle(graph);
    if (cycleNodes.length > 0) {
      errors.push(`检测到循环路径: ${cycleNodes.join(' -> ')}`);
    }

    // 检查可达结束节点
    const reachableEnd = checkReachableEnd(graph);
    if (!reachableEnd.valid) {
      errors.push(reachableEnd.message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 拓扑排序 + 循环检测 (Kahn 算法)
 * @returns {string[]} 循环路径中的节点，无循环返回空数组
 */
function detectCycle(graph) {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const inDegree = {};
  const adjacency = {};

  for (const id of nodeIds) {
    inDegree[id] = 0;
    adjacency[id] = [];
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency[edge.source].push(edge.target);
    inDegree[edge.target] = (inDegree[edge.target] || 0) + 1;
  }

  const queue = [];
  for (const [id, degree] of Object.entries(inDegree)) {
    if (degree === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    const current = queue.shift();
    sorted.push(current);
    for (const next of adjacency[current]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  if (sorted.length === nodeIds.size) return [];

  // 找到循环路径（找到剩余节点中的循环）
  const remaining = new Set(nodeIds);
  for (const id of sorted) remaining.delete(id);

  // 从剩余节点中尝试找到循环
  const visited = new Set();
  const path = [];
  const cycleNodes = [];

  function findCycleDFS(node) {
    if (visited.has(node)) {
      const idx = path.indexOf(node);
      if (idx >= 0) {
        cycleNodes.push(...path.slice(idx), node);
        return true;
      }
      return false;
    }
    visited.add(node);
    path.push(node);
    for (const next of (adjacency[node] || [])) {
      if (remaining.has(next) && findCycleDFS(next)) return true;
    }
    path.pop();
    return false;
  }

  for (const node of remaining) {
    if (findCycleDFS(node)) break;
  }

  return cycleNodes;
}

/**
 * 检查是否有可达的结束节点
 */
function checkReachableEnd(graph) {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const adjacency = {};
  for (const id of nodeIds) adjacency[id] = [];

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency[edge.source].push(edge.target);
  }

  // 从 entryNodeId BFS，检查是否有出度为 0 的可达节点
  const visited = new Set();
  const queue = [graph.entryNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency[current]) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  // 找到所有出度为0的可达节点（结束节点）
  const endNodes = [];
  for (const id of visited) {
    if (!adjacency[id] || adjacency[id].length === 0) {
      endNodes.push(id);
    }
  }

  if (endNodes.length === 0) {
    return {
      valid: false,
      message: '流程没有可达的结束节点，可能存在死循环',
    };
  }

  // 所有节点都应该可达
  const unreachable = [...nodeIds].filter((id) => !visited.has(id));
  if (unreachable.length > 0) {
    return {
      valid: false,
      message: `以下节点无法从入口到达: ${unreachable.join(', ')}`,
    };
  }

  return { valid: true, endNodes };
}

/**
 * 校验 settings_json
 */
function validateSettingsJson(settings) {
  const errors = [];

  if (!isPlainObject(settings)) {
    return { valid: false, errors: ['settings_json 必须是 JSON 对象'] };
  }

  if (settings.completion_mode && !COMPLETION_MODES.includes(settings.completion_mode)) {
    errors.push(`completion_mode 必须是 ${COMPLETION_MODES.join(' | ')} 之一`);
  }

  if (settings.target_mastery != null) {
    const tm = Number(settings.target_mastery);
    if (!Number.isFinite(tm) || tm < MIN_TARGET_MASTERY || tm > MAX_TARGET_MASTERY) {
      errors.push(`target_mastery 必须在 ${MIN_TARGET_MASTERY} 到 ${MAX_TARGET_MASTERY} 之间`);
    }
  }

  if (settings.adjustment_mode && !ADJUSTMENT_MODES.includes(settings.adjustment_mode)) {
    errors.push(`adjustment_mode 必须是 ${ADJUSTMENT_MODES.join(' | ')} 之一`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 清理和标准化 graph_json
 */
function sanitizeGraphJson(graph) {
  if (!isPlainObject(graph)) return graph;

  const nodeIds = new Set((graph.nodes || []).map((n) => n.id));

  return {
    entryNodeId: String(graph.entryNodeId || ''),
    nodes: (graph.nodes || []).map((node) => ({
      id: String(node.id || ''),
      type: String(node.type || ''),
      title: String(node.title || '').slice(0, MAX_NODE_TITLE_LENGTH),
      description: String(node.description || '').slice(0, MAX_DESC_LENGTH),
      config: isPlainObject(node.config) ? node.config : {},
      position: isPlainObject(node.position)
        ? { x: Number(node.position.x) || 0, y: Number(node.position.y) || 0 }
        : { x: 0, y: 0 },
    })),
    edges: (graph.edges || [])
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((edge) => ({
        id: String(edge.id || ''),
        source: String(edge.source || ''),
        target: String(edge.target || ''),
        label: String(edge.label || '').slice(0, 100),
        condition: isPlainObject(edge.condition)
          ? {
              type: String(edge.condition.type || 'always'),
              params: isPlainObject(edge.condition.params) ? edge.condition.params : {},
            }
          : { type: 'always', params: {} },
      })),
  };
}

/**
 * 标准化 settings_json
 */
function sanitizeSettingsJson(settings) {
  return {
    completion_mode: COMPLETION_MODES.includes(settings?.completion_mode)
      ? settings.completion_mode
      : 'flow_complete',
    target_mastery: Math.max(MIN_TARGET_MASTERY, Math.min(MAX_TARGET_MASTERY,
      Number(settings?.target_mastery) || DEFAULT_TARGET_MASTERY)),
    adjustment_mode: ADJUSTMENT_MODES.includes(settings?.adjustment_mode)
      ? settings.adjustment_mode
      : 'auto_adjust',
    estimated_minutes: Math.max(1, Math.min(120, Number(settings?.estimated_minutes) || 25)),
  };
}

/**
 * 评估条件表达式
 */
function evaluateCondition(condition, context) {
  if (!condition || condition.type === 'always') return true;

  const params = condition.params || {};
  const mastery = context.mastery != null ? context.mastery : 0;
  const consecutiveWrong = context.consecutiveWrong || 0;
  const accuracy = context.accuracy != null ? context.accuracy : 0;
  const lastAnswerCorrect = context.lastAnswerCorrect;

  switch (condition.type) {
    case 'answer_correct':
      return lastAnswerCorrect === true;
    case 'answer_incorrect':
      return lastAnswerCorrect === false;
    case 'mastery_gte':
      return mastery >= (Number(params.threshold) || 80);
    case 'mastery_lt':
      return mastery < (Number(params.threshold) || 80);
    case 'consecutive_wrong_gte':
      return consecutiveWrong >= (Number(params.threshold) || 3);
    case 'accuracy_gte':
      return accuracy >= (Number(params.threshold) || 80);
    case 'accuracy_lt':
      return accuracy < (Number(params.threshold) || 80);
    case 'student_confirmed':
      return params.confirmed === true;
    case 'student_rejected':
      return params.confirmed === false;
    default:
      return true;
  }
}

/**
 * 获取节点的下一个节点
 */
function getNextNodeIds(graph, currentNodeId, context) {
  const normalizedCurrentId = String(currentNodeId);
  const outgoingEdges = (graph.edges || []).filter((e) => String(e.source) === normalizedCurrentId);

  if (outgoingEdges.length === 0) return [];

  // Try conditional edges first
  const conditionalEdges = outgoingEdges.filter((e) => e.condition && e.condition.type !== 'always');
  for (const edge of conditionalEdges) {
    if (evaluateCondition(edge.condition, context)) {
      return [String(edge.target)];
    }
  }

  // Fall back to always edges
  const alwaysEdges = outgoingEdges.filter((e) => !e.condition || e.condition.type === 'always');
  if (alwaysEdges.length > 0) {
    return alwaysEdges.map((e) => String(e.target));
  }

  return [];
}

module.exports = {
  ALLOWED_NODE_TYPES,
  ALLOWED_CONDITION_TYPES,
  COMPLETION_MODES,
  ADJUSTMENT_MODES,
  MAX_NODES,
  MAX_EDGES,
  MAX_TITLE_LENGTH,
  MAX_DESC_LENGTH,
  MAX_NODE_TITLE_LENGTH,
  MIN_TARGET_MASTERY,
  MAX_TARGET_MASTERY,
  DEFAULT_TARGET_MASTERY,
  NODE_TO_AGENT,
  NODE_CATEGORIES,
  ALLOWED_CONDITION_PARAMS,
  validateGraphJson,
  detectCycle,
  checkReachableEnd,
  validateSettingsJson,
  sanitizeGraphJson,
  sanitizeSettingsJson,
  evaluateCondition,
  getNextNodeIds,
};
