const { sanitizeGraphJson, validateGraphJson } = require('../../learning-workflow/workflow-schema');
const { createAgentError } = require('../../agent/common/agent.errors');

function buildGoalSnapshot(goal) {
  const snapshot = {
    goalId: goal.goal_id,
    rawGoal: goal.raw_goal,
    normalizedTitle: goal.normalized_title,
    primaryKnowledgePointId: goal.primary_knowledge_point_id,
    primaryKnowledgePointName: goal.primary_knowledge_point?.knowledge_point_name || null,
    relatedKnowledgePointIds: (goal.related_knowledge_points || []).map((item) => item.knowledgePointId).filter(Boolean),
    focusQuestion: goal.focus_question || null,
    subGoals: goal.sub_goals || [],
    prerequisites: goal.prerequisite_goals || [],
    targetDepth: goal.target_depth,
    targetMastery: goal.target_mastery,
    estimatedMinutes: goal.estimated_minutes,
    coverageStatus: goal.coverage_status,
    confirmedAt: new Date().toISOString(),
  };
  return Object.freeze(snapshot);
}

function injectGoalContextIntoGraph(graph, snapshot) {
  const subGoals = Array.isArray(snapshot.subGoals) ? snapshot.subGoals : [];
  let cursor = 0;
  const nodes = (graph.nodes || []).map((node) => {
    const isSummary = node.type === 'learning_summary';
    const isGate = node.type === 'mastery_gate';
    const subGoal = (!isSummary && !isGate && subGoals.length) ? subGoals[Math.min(cursor++, subGoals.length - 1)] : null;
    const focus = subGoal?.title || snapshot.focusQuestion || snapshot.normalizedTitle;
    const originalTitle = String(node.title || node.type).slice(0, 80);
    return {
      ...node,
      title: isSummary ? `总结：${snapshot.normalizedTitle}`.slice(0, 100) : `${originalTitle} · ${focus}`.slice(0, 100),
      config: {
        ...(node.config || {}),
        ...(subGoal ? { subGoalId: subGoal.id, currentSubGoal: subGoal.title } : {}),
        goalContext: {
          goalId: snapshot.goalId,
          normalizedTitle: snapshot.normalizedTitle,
          focusQuestion: snapshot.focusQuestion,
          targetDepth: snapshot.targetDepth,
          primaryKnowledgePointId: snapshot.primaryKnowledgePointId,
        },
      },
    };
  });
  const sanitized = sanitizeGraphJson({ ...graph, nodes });
  const validation = validateGraphJson(sanitized);
  if (!validation.valid) throw createAgentError('INVALID_GOAL_WORKFLOW_GRAPH', `目标上下文注入后流程校验失败：${validation.errors.join('；')}`, 500);
  return sanitized;
}

module.exports = { buildGoalSnapshot, injectGoalContextIntoGraph };
