/**
 * Multimodal Metrics Service
 *
 * 多模态学习能力指标计算。
 * 所有计算由后端规则执行，不由 LLM 评分。
 *
 * 指标构成（总分 0-100）:
 *   - 40% 多模态任务正确率
 *   - 30% 纠错完成率
 *   - 20% 多模态任务完成率
 *   - 10% 使用多样性
 *
 * 不修改现有画像指标（learning_total_score, mastery_score 等）。
 * 作为独立指标追加到 student_portraits 的 JSON 扩展字段中。
 */

const prisma = require('../../../config/prisma');

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const METRIC_WEIGHTS = Object.freeze({
  multimodalAccuracy: 0.40,  // 多模态任务正确率
  correctionCompletion: 0.30, // 纠错完成率
  taskCompletion: 0.20,       // 多模态任务完成率
  usageDiversity: 0.10,        // 使用多样性
});

const MIN_SAMPLE_SIZE = 3; // 最少样本数，低于此值标记为数据不足

// ---------------------------------------------------------------------------
// 数据聚合
// ---------------------------------------------------------------------------

/**
 * 获取学生在指定课程的多模态任务统计
 */
async function getMultimodalStats(studentId, courseId) {
  // 从 node_runs 中查找包含多模态任务的记录
  const nodeRuns = await prisma.learningSessionNodeRun.findMany({
    where: {
      session: {
        student_user_id: Number(studentId),
        course_id: Number(courseId),
      },
      input_summary_json: {
        path: ['uploadedFiles'],
        not: null,
      },
    },
    include: {
      session: {
        select: {
          session_id: true,
          knowledge_point_id: true,
        },
      },
    },
    orderBy: { created_at: 'desc' },
    take: 100,
  });

  // 从 agent_conversations 中查找多模态对话
  const multimodalConversations = await prisma.agentConversation.findMany({
    where: {
      student_user_id: Number(studentId),
      course_id: Number(courseId),
      metadata_json: {
        path: ['has_multimodal'],
        equals: true,
      },
    },
    select: {
      agent_conversation_id: true,
      knowledge_point_id: true,
      metadata_json: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  return {
    multimodalNodeRuns: nodeRuns.map((r) => ({
      nodeRunId: r.node_run_id,
      knowledgePointId: r.session?.knowledge_point_id,
      status: r.status,
      files: (r.input_summary_json?.uploadedFiles || []).length,
      outputSummary: r.output_summary_json || {},
    })),
    multimodalConversations: multimodalConversations.map((c) => ({
      conversationId: c.agent_conversation_id,
      knowledgePointId: c.knowledge_point_id,
      metadata: c.metadata_json || {},
    })),
  };
}

// ---------------------------------------------------------------------------
// 指标计算
// ---------------------------------------------------------------------------

/**
 * 计算多模态任务正确率（40% 权重）
 *
 * 正确率 = 正确完成的多模态任务数 / 总多模态任务数 × 100
 */
function calculateMultimodalAccuracy(nodeRuns) {
  if (!nodeRuns || nodeRuns.length < MIN_SAMPLE_SIZE) {
    return { score: null, insufficientData: true, sampleSize: nodeRuns?.length || 0 };
  }

  const completed = nodeRuns.filter((r) => r.status === 'COMPLETED');
  let correctTasks = 0;
  let totalTasks = 0;

  for (const run of completed) {
    const summary = run.outputSummary || {};
    if (summary.accuracy !== undefined) {
      correctTasks += summary.correctCount || 0;
      totalTasks += summary.totalCount || 0;
    }
  }

  if (totalTasks === 0) {
    return { score: null, insufficientData: true, sampleSize: nodeRuns.length };
  }

  const accuracy = Math.round((correctTasks / totalTasks) * 100);
  return {
    score: Math.min(100, Math.max(0, accuracy)),
    insufficientData: false,
    sampleSize: nodeRuns.length,
    raw: { correctTasks, totalTasks },
  };
}

/**
 * 计算纠错完成率（30% 权重）
 *
 * 纠错完成率 = 学生通过多模态输入被纠正后改进的比率
 */
function calculateCorrectionCompletion(nodeRuns) {
  if (!nodeRuns || nodeRuns.length < MIN_SAMPLE_SIZE) {
    return { score: null, insufficientData: true, sampleSize: nodeRuns?.length || 0 };
  }

  let correctionAttempts = 0;
  let correctionsSucceeded = 0;

  for (const run of nodeRuns) {
    const summary = run.outputSummary || {};
    if (summary.correctionApplied) {
      correctionAttempts++;
      if (summary.correctionSucceeded) {
        correctionsSucceeded++;
      }
    }
  }

  if (correctionAttempts === 0) {
    return { score: null, insufficientData: true, sampleSize: nodeRuns.length };
  }

  const completionRate = Math.round((correctionsSucceeded / correctionAttempts) * 100);
  return {
    score: Math.min(100, Math.max(0, completionRate)),
    insufficientData: false,
    sampleSize: nodeRuns.length,
    raw: { correctionAttempts, correctionsSucceeded },
  };
}

/**
 * 计算多模态任务完成率（20% 权重）
 *
 * 完成率 = 已提交/完成的多模态任务 / 所有开始的多模态任务
 */
function calculateTaskCompletion(nodeRuns) {
  if (!nodeRuns || nodeRuns.length < MIN_SAMPLE_SIZE) {
    return { score: null, insufficientData: true, sampleSize: nodeRuns?.length || 0 };
  }

  const totalStarted = nodeRuns.length;
  const completed = nodeRuns.filter((r) =>
    r.status === 'COMPLETED' || r.status === 'SKIPPED',
  ).length;

  const completionRate = Math.round((completed / totalStarted) * 100);
  return {
    score: Math.min(100, Math.max(0, completionRate)),
    insufficientData: false,
    sampleSize: nodeRuns.length,
    raw: { totalStarted, completed },
  };
}

/**
 * 计算使用多样性（10% 权重）
 *
 * 多样性 = 使用不同模态类型的多样性得分
 * 图片类型: 题目截图, 手写解题, 数学公式, 图表, 知识图
 */
function calculateUsageDiversity(nodeRuns, conversations) {
  const imageTypes = new Set();
  let totalMultimodalTasks = 0;

  // 从 node_runs 统计
  for (const run of nodeRuns || []) {
    const files = run.files || 0;
    if (files > 0) {
      totalMultimodalTasks += files;
      const summary = run.outputSummary || {};
      if (summary.imageTypes) {
        for (const type of summary.imageTypes) {
          imageTypes.add(type);
        }
      }
    }
  }

  // 从 conversations 统计
  for (const conv of conversations || []) {
    const meta = conv.metadata || {};
    if (meta.image_types) {
      for (const type of meta.image_types) {
        imageTypes.add(type);
      }
    }
  }

  const totalInteractions = totalMultimodalTasks + (conversations?.length || 0);
  if (totalInteractions < MIN_SAMPLE_SIZE) {
    return { score: null, insufficientData: true, sampleSize: totalInteractions };
  }

  // 多样性得分 = 使用的不同图片类型数 / 5（最大类型数）× 100
  const maxTypes = 5; // 题目截图, 手写解题, 数学公式, 图表, 知识图
  const diversity = Math.round((imageTypes.size / maxTypes) * 100);

  return {
    score: Math.min(100, Math.max(0, diversity)),
    insufficientData: false,
    sampleSize: totalInteractions,
    raw: { uniqueImageTypes: imageTypes.size, types: Array.from(imageTypes), totalMultimodalTasks },
  };
}

// ---------------------------------------------------------------------------
// 综合评分
// ---------------------------------------------------------------------------

/**
 * 计算多模态学习能力综合得分
 *
 * @param {Object} stats - 从 getMultimodalStats 获取的统计数据
 * @returns {{
 *   multimodal_learning_score: number|null,
 *   insufficient_data: boolean,
 *   sub_scores: Object,
 *   raw_stats: Object
 * }}
 */
function calculateMultimodalLearningScore(stats) {
  const { multimodalNodeRuns = [], multimodalConversations = [] } = stats;

  const totalSamples = multimodalNodeRuns.length + multimodalConversations.length;

  // 没有足够样本
  if (totalSamples < MIN_SAMPLE_SIZE) {
    return {
      multimodal_learning_score: null,
      insufficient_data: true,
      sample_size: totalSamples,
      message: `多模态任务样本不足（当前 ${totalSamples}，需要至少 ${MIN_SAMPLE_SIZE}）`,
      sub_scores: {
        multimodal_accuracy: null,
        correction_completion: null,
        task_completion: null,
        usage_diversity: null,
      },
      raw_stats: stats,
    };
  }

  // 计算各子指标
  const accuracyResult = calculateMultimodalAccuracy(multimodalNodeRuns);
  const correctionResult = calculateCorrectionCompletion(multimodalNodeRuns);
  const completionResult = calculateTaskCompletion(multimodalNodeRuns);
  const diversityResult = calculateUsageDiversity(multimodalNodeRuns, multimodalConversations);

  const subScores = {
    multimodal_accuracy: accuracyResult,
    correction_completion: correctionResult,
    task_completion: completionResult,
    usage_diversity: diversityResult,
  };

  // 加权综合得分
  let totalWeight = 0;
  let weightedSum = 0;

  const scoreEntries = [
    { score: accuracyResult.score, weight: METRIC_WEIGHTS.multimodalAccuracy, insufficient: accuracyResult.insufficientData },
    { score: correctionResult.score, weight: METRIC_WEIGHTS.correctionCompletion, insufficient: correctionResult.insufficientData },
    { score: completionResult.score, weight: METRIC_WEIGHTS.taskCompletion, insufficient: completionResult.insufficientData },
    { score: diversityResult.score, weight: METRIC_WEIGHTS.usageDiversity, insufficient: diversityResult.insufficientData },
  ];

  for (const entry of scoreEntries) {
    if (!entry.insufficient && entry.score !== null) {
      weightedSum += entry.score * entry.weight;
      totalWeight += entry.weight;
    }
  }

  if (totalWeight === 0) {
    return {
      multimodal_learning_score: null,
      insufficient_data: true,
      sample_size: totalSamples,
      message: '所有子指标数据不足',
      sub_scores: subScores,
      raw_stats: stats,
    };
  }

  // 按实际权重归一化
  const finalScore = Math.round(weightedSum / totalWeight);

  return {
    multimodal_learning_score: Math.min(100, Math.max(0, finalScore)),
    insufficient_data: false,
    sample_size: totalSamples,
    sub_scores: subScores,
    weights: METRIC_WEIGHTS,
    raw_stats: {
      totalNodeRuns: multimodalNodeRuns.length,
      totalConversations: multimodalConversations.length,
    },
  };
}

/**
 * 更新学生画像中的多模态指标
 */
async function updateMultimodalPortrait(studentId, courseId) {
  const stats = await getMultimodalStats(studentId, courseId);
  const scoreResult = calculateMultimodalLearningScore(stats);

  // 查找或创建 portrait
  const existing = await prisma.studentPortrait.findUnique({
    where: {
      student_user_id_course_id: {
        student_user_id: Number(studentId),
        course_id: Number(courseId),
      },
    },
  });

  // 将多模态指标存储为 JSON 扩展（不修改现有字段）
  const multimodalData = {
    multimodal_learning_score: scoreResult.multimodal_learning_score,
    insufficient_data: scoreResult.insufficient_data,
    sample_size: scoreResult.sample_size,
    sub_scores: scoreResult.sub_scores,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // 合并到现有的扩展数据中
    const existingExtensions = (existing.portrait_extensions_json || {});
    await prisma.studentPortrait.update({
      where: { portrait_id: existing.portrait_id },
      data: {
        // 不修改 learning_total_score, mastery_score 等现有字段
        // 使用 raw SQL 更新 JSON 扩展（如果 schema 支持）
      },
    });

    // 由于 schema 中没有 portrait_extensions_json 字段，我们使用 portrait_snapshot 来存储
    await prisma.studentPortraitSnapshot.create({
      data: {
        student_user_id: Number(studentId),
        course_id: Number(courseId),
        snapshot_date: new Date(),
        learning_scores: {
          type: 'multimodal_metrics',
          ...multimodalData,
        },
      },
    });
  } else {
    // Portrait 不存在，创建基本 portrait + 多模态快照
    await prisma.studentPortrait.create({
      data: {
        student_user_id: Number(studentId),
        course_id: Number(courseId),
        learning_total_score: 0,
      },
    });

    await prisma.studentPortraitSnapshot.create({
      data: {
        student_user_id: Number(studentId),
        course_id: Number(courseId),
        snapshot_date: new Date(),
        learning_scores: {
          type: 'multimodal_metrics',
          ...multimodalData,
        },
      },
    });
  }

  return scoreResult;
}

module.exports = {
  getMultimodalStats,
  calculateMultimodalLearningScore,
  updateMultimodalPortrait,
  METRIC_WEIGHTS,
  MIN_SAMPLE_SIZE,
};
