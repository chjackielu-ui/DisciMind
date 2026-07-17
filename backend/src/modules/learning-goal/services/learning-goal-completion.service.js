const prisma = require('../../../config/prisma');

function calculateGoalResult({ goal, session }) {
  const graphNodes = session.runtime_graph_json?.nodes || [];
  const completedNodeIds = new Set((session.node_runs || []).filter((run) => ['COMPLETED', 'SKIPPED'].includes(run.status)).map((run) => String(run.node_id)));
  const subGoals = goal.sub_goals || [];
  const completedSubGoals = subGoals.filter((subGoal) => graphNodes.some((node) => node.config?.subGoalId === subGoal.id && completedNodeIds.has(String(node.id))));
  const completedIds = new Set(completedSubGoals.map((item) => item.id));
  const unresolvedSubGoals = subGoals.filter((item) => !completedIds.has(item.id));
  const answered = Number(session.total_correct || 0) + Number(session.total_wrong || 0);
  const accuracy = answered ? Number(session.total_correct || 0) / answered : 0;
  const completionRatio = subGoals.length ? completedSubGoals.length / subGoals.length : (session.status === 'COMPLETED' ? 1 : 0);
  const masteryRatio = Math.min(1, Number(session.mastery_after ?? session.mastery_current ?? 0) / Math.max(1, Number(goal.target_mastery || 80)));
  const goalScore = Math.round(Math.min(1, completionRatio * 0.5 + accuracy * 0.4 + masteryRatio * 0.1) * 100);
  const goalAchieved = session.status === 'COMPLETED' && goalScore >= Number(goal.target_mastery || 80);
  return {
    goalAchieved, goalScore,
    primaryMasteryBefore: session.mastery_before,
    primaryMasteryAfter: session.mastery_after ?? session.mastery_current,
    completedSubGoals: completedSubGoals.map((item) => item.title),
    unresolvedSubGoals: unresolvedSubGoals.map((item) => item.title),
    wrongQuestionCount: Number(session.total_wrong || 0),
    recommendation: unresolvedSubGoals.length ? `继续完成：${unresolvedSubGoals[0].title}` : '继续用综合练习巩固本次学习目标',
  };
}

async function completeFromSession(goalId, studentId, db = prisma) {
  const goal = await db.learningGoal.findFirst({ where: { goal_id: Number(goalId), student_user_id: Number(studentId) } });
  if (!goal) return null;
  const session = await db.learningSession.findFirst({
    where: { learning_goal_id: goal.goal_id, student_user_id: Number(studentId) },
    include: { node_runs: true },
  });
  if (!session || session.status !== 'COMPLETED') return null;
  if (goal.status === 'COMPLETED' && goal.result_snapshot) return goal.result_snapshot;
  const result = calculateGoalResult({ goal, session });
  await db.learningGoal.update({
    where: { goal_id: goal.goal_id },
    data: {
      status: 'COMPLETED', result_snapshot: result,
      completed_sub_goals: result.completedSubGoals,
      unresolved_sub_goals: result.unresolvedSubGoals,
      completed_at: session.completed_at || new Date(),
    },
  });
  return result;
}

module.exports = { completeFromSession, calculateGoalResult };
