const { StateGraph, START, END } = require('@langchain/langgraph');
const prisma = require('../../../config/prisma');
const { LessonPlanState } = require('../graph/lesson-plan.state');
const nodes = require('./preparation.nodes');
const events = require('./preparation-events');

let compiled;

function getPreparationGraph() {
  if (!compiled) {
    compiled = new StateGraph(LessonPlanState)
      .addNode('collect_context', nodes.collectContext)
      .addNode('student_analytics_agent', nodes.studentAnalyticsAgent)
      .addNode('dialogue_insight_agent', nodes.dialogueInsightAgent)
      .addNode('curriculum_planner_agent', nodes.curriculumPlannerAgent)
      .addNode('lesson_introduction_agent', nodes.introductionAgent)
      .addNode('content_design_agent', nodes.contentDesignAgent)
      .addNode('question_design_agent', nodes.questionDesignAgent)
      .addNode('exercise_design_agent', nodes.exerciseDesignAgent)
      .addNode('assessment_agent', nodes.assessmentAgent)
      .addNode('resource_recommendation_agent', nodes.resourceRecommendationAgent)
      .addNode('lesson_quality_review_agent', nodes.qualityReviewAgent)
      .addNode('document_generation_agent', nodes.documentGenerationAgent)
      .addEdge(START, 'collect_context')
      .addEdge('collect_context', 'student_analytics_agent')
      .addEdge('collect_context', 'dialogue_insight_agent')
      .addEdge(['student_analytics_agent', 'dialogue_insight_agent'], 'curriculum_planner_agent')
      .addEdge('curriculum_planner_agent', 'lesson_introduction_agent')
      .addEdge('curriculum_planner_agent', 'content_design_agent')
      .addEdge('curriculum_planner_agent', 'question_design_agent')
      .addEdge('curriculum_planner_agent', 'exercise_design_agent')
      .addEdge('curriculum_planner_agent', 'assessment_agent')
      .addEdge('curriculum_planner_agent', 'resource_recommendation_agent')
      .addEdge([
        'lesson_introduction_agent', 'content_design_agent', 'question_design_agent',
        'exercise_design_agent', 'assessment_agent', 'resource_recommendation_agent',
      ], 'lesson_quality_review_agent')
      .addEdge('lesson_quality_review_agent', 'document_generation_agent')
      .addEdge('document_generation_agent', END)
      .compile();
  }
  return compiled;
}

async function runPreparationGraph(initialState) {
  try {
    return await getPreparationGraph().invoke(initialState, { recursionLimit: 40 });
  } catch (error) {
    console.error('[teacher-preparation] graph failed:', error);
    const friendly = error.publicCode === 'LESSON_PLAN_SAVE_FAILED'
      ? error.message
      : '智慧备课流程暂时中断，已保留草稿和已完成阶段，可稍后重试。';
    await prisma.lessonPlan.update({
      where: { lesson_plan_id: Number(initialState.lessonPlanId) },
      data: { status: 'DRAFT', errors_json: [{ code: error.publicCode || 'LESSON_PLAN_GENERATION_INTERRUPTED', message: friendly, retryable: true }] },
    }).catch(() => {});
    if (initialState.taskId) {
      await prisma.asyncTask.update({
        where: { id: Number(initialState.taskId) },
        data: { status: 'FAILED', stage: '生成中断，可从草稿重试', errorCode: String(error.publicCode || 'LESSON_PLAN_GENERATION_INTERRUPTED'), errorMessage: friendly, completedAt: new Date() },
      }).catch(() => {});
    }
    events.publish(initialState.lessonPlanId, { type: 'complete', status: 'draft', progress: initialState.progress || 5, message: friendly, retryable: true });
    throw error;
  }
}

module.exports = { getPreparationGraph, runPreparationGraph };
