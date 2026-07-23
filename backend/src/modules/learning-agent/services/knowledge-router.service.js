/**
 * Knowledge Router Service
 *
 * 根据课程、知识点、节点类型和意图动态选择后端托管知识库（仅检索，不调用 Agent/Workflow）。
 *
 * 设计原则：
 *   - 后端计算并生成白名单（whitelist），LLM 永远不直接指定 dataset_id
 *   - 生产白名单从数据库中的课程知识库动态生成
 *   - 未匹配到知识库时返回空结果，不抛错误
 *
 */

const prisma = require('../../../config/prisma');
const {
  retrieveFromMultipleDatasets,
} = require('../../knowledge-base/knowledge-provider.service');

// =============================================================================
// COURSE_KNOWLEDGE_MAP — 课程-知识库映射注册表（可扩展）
// =============================================================================

/**
 * 结构:
 *   { [courseId]: { textbook: [knowledgeBaseId, ...], exercise: [knowledgeBaseId, ...] } }
 *
 * 仅用于保持旧的同步策略函数兼容；生产检索由 loadCourseKnowledgeBases 动态查询。
 */
const COURSE_KNOWLEDGE_MAP = {
  1: { textbook: [], exercise: [] },
};

function knowledgeBaseType(record) {
  const text = [
    record.name,
    record.description,
    record.category?.name,
    ...(record.documents || []).flatMap((doc) => [doc.resource_kind, doc.resource_category]),
  ].filter(Boolean).join(' ').toLowerCase();
  return /(?:习题|练习|题库|试题|worksheet|exercise|question)/i.test(text) ? 'exercise' : 'textbook';
}

async function loadCourseKnowledgeBases(courseId) {
  const id = Number(courseId);
  if (!Number.isInteger(id) || id <= 0) return { textbook: [], exercise: [] };
  const records = await prisma.knowledgeBase.findMany({
    where: {
      course_id: id,
      deleted_at: null,
      status: 'active',
      documents: { some: { deleted_at: null, parse_status: 'EMBEDDED', marketplace_status: 'READY' } },
    },
    include: {
      category: { select: { name: true } },
      documents: {
        where: { deleted_at: null, parse_status: 'EMBEDDED', marketplace_status: 'READY' },
        select: { resource_kind: true, resource_category: true },
      },
    },
    orderBy: { updated_at: 'desc' },
    take: 20,
  });
  return records.reduce((result, record) => {
    result[knowledgeBaseType(record)].push(String(record.knowledge_base_id));
    return result;
  }, { textbook: [], exercise: [] });
}

// =============================================================================
// 节点类型 → 检索策略
// =============================================================================

/**
 * 课本优先的节点类型：概念构建类节点，依赖教材原文。
 */
const TEXTBOOK_PRIORITY_TYPES = new Set([
  'concept_explanation',
  'analogy_explanation',
  'worked_example_analysis',
  'socratic_questioning',
  'misconception_repair',
  'summary',
  'multimodal_interaction',
]);

/**
 * 习题优先的节点类型：练习/诊断类节点，以习题为主、教材补充。
 */
const EXERCISE_PRIORITY_TYPES = new Set([
  'basic_practice',
  'adaptive_practice',
  'wrong_question_repair',
  'diagnostic_pre_test',
  'variant_question',
]);

/**
 * 两者均需的节点类型：综合评估/掌握度判定。
 */
const BOTH_TYPES = new Set([
  'mastery_gate',
  'deep_evaluation',
  'learning_summary',
]);

// =============================================================================
// 辅助函数
// =============================================================================

/**
 * 根据节点类型返回检索策略。
 *
 * @param {string} nodeType - 节点类型
 * @returns {{ primary: 'textbook'|'exercise'|'both', secondary?: 'textbook'|'exercise' }}
 */
function getKnowledgeBaseStrategy(nodeType) {
  if (TEXTBOOK_PRIORITY_TYPES.has(nodeType)) {
    return { primary: 'textbook' };
  }
  if (EXERCISE_PRIORITY_TYPES.has(nodeType)) {
    return { primary: 'exercise', secondary: 'textbook' };
  }
  if (BOTH_TYPES.has(nodeType)) {
    return { primary: 'both' };
  }
  // 未知类型默认走教材
  return { primary: 'textbook' };
}

/**
 * 获取课程配置的知识库 ID 列表。
 * 若课程未配置，返回 null（便于调用方统一处理空值路径）。
 *
 * @param {number} courseId
 * @returns {{ textbook: string[], exercise: string[] } | null}
 */
function getCourseDatasets(courseId) {
  const entry = COURSE_KNOWLEDGE_MAP[courseId];
  if (!entry) return null;

  return {
    textbook: entry.textbook || [],
    exercise: entry.exercise || [],
  };
}

// =============================================================================
// 公开 API
// =============================================================================

/**
 * 解析需要检索的知识库列表。
 *
 * 返回策略名称：
 *   - 'textbook_only'     — 仅检索课本知识库
 *   - 'exercise_priority' — 习题优先，课本补充
 *   - 'both'              — 课本 + 习题全检索
 *   - 'none'              — 无匹配知识库（应走降级逻辑）
 *
 * @param {Object}  params
 * @param {number}  params.courseId         - 课程 ID
 * @param {number}  [params.knowledgePointId] - 知识点 ID（预留）
 * @param {string}  params.nodeType         - 节点类型
 * @param {string}  [params.intent]         - 意图标签（可选）
 * @returns {{ datasets: Array<{id: string, type: 'textbook'|'exercise'}>, strategy: string }}
 */
function resolveDatasets({ courseId, knowledgePointId, nodeType, intent, courseDatasets: suppliedDatasets }) {
  const courseDatasets = suppliedDatasets || getCourseDatasets(courseId);

  if (!courseDatasets) {
    return { datasets: [], strategy: 'none' };
  }

  const strategy = getKnowledgeBaseStrategy(nodeType);
  const datasets = [];

  if (strategy.primary === 'both') {
    // 两者：先课本后习题
    for (const id of courseDatasets.textbook) {
      if (id) datasets.push({ id, type: 'textbook' });
    }
    for (const id of courseDatasets.exercise) {
      if (id && !datasets.find((d) => d.id === id)) {
        datasets.push({ id, type: 'exercise' });
      }
    }

    return { datasets, strategy: 'both' };
  }

  // 主选知识库
  const primaryList =
    strategy.primary === 'textbook'
      ? courseDatasets.textbook
      : courseDatasets.exercise;

  for (const id of primaryList) {
    if (id) datasets.push({ id, type: strategy.primary });
  }

  // 补充知识库
  if (strategy.secondary) {
    const secondaryList =
      strategy.secondary === 'textbook'
        ? courseDatasets.textbook
        : courseDatasets.exercise;

    for (const id of secondaryList) {
      if (id && !datasets.find((d) => d.id === id)) {
        datasets.push({ id, type: strategy.secondary });
      }
    }
  }

  // 策略名称映射
  const strategyName =
    strategy.primary === 'textbook'
      ? 'textbook_only'
      : 'exercise_priority';

  return { datasets, strategy: strategyName };
}

/**
 * 构建优化的检索查询字符串。
 *
 * 将知识点名称前置到查询开头以提升检索命中率。
 *
 * @param {Object}  params
 * @param {string}  params.query              - 用户/系统查询文本
 * @param {string}  [params.knowledgePointName] - 知识点名称
 * @param {string}  [params.nodeType]         - 节点类型
 * @param {string}  [params.intent]           - 意图标签
 * @returns {string} 优化后的检索查询字符串
 */
function buildRetrievalQuery({ query, knowledgePointName, nodeType, intent }) {
  const parts = [];

  if (knowledgePointName) {
    parts.push(knowledgePointName);
  }
  if (query) {
    parts.push(query);
  }

  return parts.filter(Boolean).join(' ');
}

/**
 * 生成白名单——允许检索的 dataset ID 列表。
 *
 * **重要**：此方法由后端计算，LLM / Agent 调用方不得自行指定 dataset_id。
 *
 * @param {Object}  params
 * @param {number}  params.courseId
 * @param {number}  [params.knowledgePointId]
 * @param {string}  params.nodeType
 * @param {string}  [params.intent]
 * @returns {string[]} 白名单 dataset ID 数组
 */
function buildWhitelist({ courseId, knowledgePointId, nodeType, intent }) {
  const { datasets } = resolveDatasets({
    courseId,
    knowledgePointId,
    nodeType,
    intent,
  });
  return datasets.map((d) => d.id);
}

/**
 * 构建并执行完整检索请求。
 *
 * 流程：
 *   1. 从数据库加载课程知识库白名单
 *   2. 根据课程 + 节点类型生成白名单
 *   3. 构建检索查询字符串
 *   4. 对白名单中的所有知识库并发检索
 *   5. 返回合并、去重、排序后的结果
 *
 * 失败策略：
 *   - API 不可用 → 返回空结果 + degraded flag
 *   - 无匹配知识库 → 返回空结果 + degraded flag
 *   - 单个知识库检索失败不影响其他知识库
 *
 * @param {Object}  params
 * @param {number}  params.courseId           - 课程 ID
 * @param {number}  [params.knowledgePointId] - 知识点 ID
 * @param {string}  params.nodeType           - 节点类型
 * @param {string}  [params.intent]           - 意图标签
 * @param {string}  params.query              - 用户/系统查询文本
 * @param {string}  [params.knowledgePointName] - 知识点名称
 * @param {number}  [params.topK=5]           - 每个知识库返回的分段数
 * @returns {Promise<{
 *   records: Array,
 *   datasetsUsed: string[],
 *   available: boolean,
 *   degraded: boolean,
 *   degradationReason?: string
 * }>}
 */
async function buildRetrievalRequest({
  courseId,
  knowledgePointId,
  nodeType,
  intent,
  query,
  knowledgePointName,
  topK = 5,
}) {
  // 1. 生成后端白名单
  const courseDatasets = await loadCourseKnowledgeBases(courseId);
  const { datasets } = resolveDatasets({
    courseId,
    knowledgePointId,
    nodeType,
    intent,
    courseDatasets,
  });
  const whitelist = datasets.map((item) => item.id);

  if (whitelist.length === 0) {
    return {
      records: [],
      datasetsUsed: [],
      available: true,
      degraded: true,
      degradationReason: '当前课程与节点类型没有匹配的知识库',
    };
  }

  // 2. 构建检索查询
  const retrievalQuery = buildRetrievalQuery({
    query,
    knowledgePointName,
    nodeType,
    intent,
  });

  // 3. 执行多知识库检索（优化参数：单库 topK=3，总分段 ≤ 6，score_threshold=0.35）
  const effectiveTopK = Math.min(topK || 3, 3);
  const { records, perDatasetTiming } = await retrieveFromMultipleDatasets(
    whitelist,
    retrievalQuery,
    {
      topK: effectiveTopK,
      scoreThreshold: 0.35,
      maxContextChars: 8000,
    },
  );

  return {
    records,
    datasetsUsed: whitelist,
    available: true,
    degraded: false,
    perDatasetTiming: perDatasetTiming || [],
  };
}

// =============================================================================
// 导出
// =============================================================================

module.exports = {
  // 配置注册表（外部可直接扩展）
  COURSE_KNOWLEDGE_MAP,

  // 核心方法
  resolveDatasets,
  buildRetrievalQuery,
  buildWhitelist,
  buildRetrievalRequest,

  // 辅助方法（供测试与扩展使用）
  getKnowledgeBaseStrategy,
  getCourseDatasets,
  knowledgeBaseType,
  loadCourseKnowledgeBases,
};
