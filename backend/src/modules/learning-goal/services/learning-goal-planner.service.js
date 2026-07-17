const prisma = require('../../../config/prisma');
const { getLearningGoalConfig, WORKFLOW_TEMPLATE_KEYS } = require('../constants/learning-goal.constants');
const { planSchema } = require('../schemas/learning-goal-plan.schema');

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function makeSubGoals({ goalType, primary, related = [], focusQuestion, goalText, maxSubGoals }) {
  const items = [];
  const push = (title, type, knowledgePointId) => {
    const cleaned = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (cleaned && !items.some((item) => item.title === cleaned) && items.length < maxSubGoals) {
      items.push({ id: `sg_${items.length + 1}`, title: cleaned, type, knowledgePointId: knowledgePointId || primary.knowledgePointId });
    }
  };
  if (goalType === 'MULTI_TOPIC') {
    push(`理解${primary.name}的核心原理`, 'concept', primary.knowledgePointId);
    related.forEach((point) => push(`理解${point.name}及其与${primary.name}的关系`, 'concept', point.knowledgePointId));
    push(`比较${[primary, ...related].map((point) => point.name).join('、')}的差异与适用场景`, 'concept', primary.knowledgePointId);
    push('完成综合比较练习', 'practice', primary.knowledgePointId);
  } else if (goalType === 'SUBTOPIC') {
    push(`回顾${primary.name}的必要基础`, 'review', primary.knowledgePointId);
    push(focusQuestion || `理解${primary.name}的关键原理`, 'concept', primary.knowledgePointId);
    if (/计算|做题|练习|应用/.test(goalText)) push(`完成${primary.name}基础计算与应用练习`, 'practice', primary.knowledgePointId);
    else push(`用例子验证对${primary.name}的理解`, 'practice', primary.knowledgePointId);
  } else {
    push(`理解${primary.name}的核心概念`, 'concept', primary.knowledgePointId);
    push(`理解${primary.name}的基本原理与适用场景`, 'concept', primary.knowledgePointId);
    push(`完成${primary.name}基础练习`, 'practice', primary.knowledgePointId);
  }
  if (items.length < 2) push(`完成${primary.name}学习检测`, 'diagnostic', primary.knowledgePointId);
  return items.slice(0, maxSubGoals).map((item, index) => ({ ...item, id: `sg_${index + 1}` }));
}

async function loadStudentContext({ studentId, courseId, knowledgePointId, db = prisma }) {
  const [mastery, wrongQuestions] = await Promise.all([
    db.studentMasteryRecord.findUnique({
      where: { student_user_id_course_id_knowledge_point_id: { student_user_id: Number(studentId), course_id: Number(courseId), knowledge_point_id: Number(knowledgePointId) } },
      select: { mastery_score: true, mastery_level: true },
    }).catch(() => null),
    db.wrongQuestion.findMany({
      where: { student_user_id: Number(studentId), course_id: Number(courseId), knowledge_point_id: Number(knowledgePointId), status: 'UNRESOLVED' },
      select: { wrong_question_id: true, wrong_reason: true }, orderBy: { updated_at: 'desc' }, take: 5,
    }).catch(() => []),
  ]);
  return { currentMastery: mastery?.mastery_score ?? null, masteryLevel: mastery?.mastery_level ?? null, recentErrors: wrongQuestions.map((item) => String(item.wrong_reason || '').slice(0, 120)).filter(Boolean) };
}

function chooseTemplate({ goalType, goalText, studentContext, preferences }) {
  if (studentContext.recentErrors.length >= 3 || /错题|薄弱|修复/.test(goalText)) return 'weakness_repair';
  if ((preferences.practiceWeight || 0) > (preferences.explanationWeight || 0) || /练习|做题|刷题|计算/.test(goalText)) return 'practice_driven';
  if (goalType === 'SUBTOPIC' && /为什么|原理|推导/.test(goalText)) return 'socratic_inquiry';
  return 'standard';
}

function finalizePlanForCoverage(plan, coverage) {
  const next = { ...plan };
  const warnings = [];
  if (next.targetDepth === 'advanced' && !['sufficient'].includes(coverage?.status)) {
    next.targetDepth = 'basic';
    warnings.push('课程资料不足以支持高级深度，已降级为基础学习。');
  }
  return { plan: planSchema.parse(next), warnings };
}

async function buildPlan({ studentId, courseId, goalText, resolverResult, preferences = {}, db = prisma }) {
  const config = getLearningGoalConfig();
  const primary = resolverResult.primaryKnowledgePoint;
  const related = (resolverResult.relatedKnowledgePoints || []).slice(0, config.maxRelatedKnowledgePoints);
  const studentContext = await loadStudentContext({ studentId, courseId, knowledgePointId: primary.knowledgePointId, db });
  const subGoals = makeSubGoals({
    goalType: resolverResult.goalType, primary, related, focusQuestion: resolverResult.focusQuestion,
    goalText, maxSubGoals: config.maxSubGoals,
  });
  const prerequisites = [];
  if (primary.parentKnowledgePointId && primary.parentName) prerequisites.push({ title: primary.parentName, required: true, knowledgePointId: primary.parentKnowledgePointId });
  if (resolverResult.goalType === 'SUBTOPIC' && related[0]) prerequisites.push({ title: related[0].name, required: false, knowledgePointId: related[0].knowledgePointId });
  const targetDepth = preferences.targetDepth || resolverResult.targetDepth || (studentContext.currentMastery >= 75 ? 'intermediate' : 'basic');
  const targetMastery = clamp(preferences.targetMastery, 60, 95, config.defaultTargetMastery);
  const ruleMinutes = subGoals.reduce((total, item) => total + (item.type === 'practice' ? 7 : item.type === 'diagnostic' ? 5 : item.type === 'review' ? 4 : 5), 3);
  const estimatedMinutes = clamp(preferences.availableMinutes || ruleMinutes, 10, 120, config.defaultEstimatedMinutes);
  const recommendedTemplateKey = chooseTemplate({ goalType: resolverResult.goalType, goalText, studentContext, preferences });
  if (!WORKFLOW_TEMPLATE_KEYS.includes(recommendedTemplateKey)) throw new Error('推荐模板不在白名单');
  const recommendedNodeIntents = subGoals.map((item) => ({
    intent: item.type === 'practice' ? 'basic_practice' : item.type === 'review' ? 'prerequisite_review' : 'concept_explanation',
    subGoalId: item.id,
  })).concat({ intent: 'learning_summary' }).slice(0, 8);
  const plan = planSchema.parse({ subGoals, prerequisites, targetDepth, targetMastery, estimatedMinutes, recommendedTemplateKey, recommendedNodeIntents });
  return { plan, studentContext };
}

module.exports = { buildPlan, finalizePlanForCoverage, makeSubGoals, loadStudentContext, chooseTemplate, clamp };
