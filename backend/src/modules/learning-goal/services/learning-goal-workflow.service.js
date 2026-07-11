const generationService = require('../../learning-workflow/workflow-generation.service');
const workflowTemplateService = require('../../learning-workflow/workflow-template.service');
const { validateGraphJson, validateSettingsJson } = require('../../learning-workflow/workflow-schema');
const { createAgentError } = require('../../agent/common/agent.errors');
const { injectGoalContextIntoGraph } = require('./learning-goal-context.service');
const { WORKFLOW_TEMPLATE_KEYS, getLearningGoalConfig } = require('../constants/learning-goal.constants');

const TEMPLATE_PROMPTS = Object.freeze({
  standard: '标准学习：先讲解概念，再完成基础练习和总结',
  practice_driven: '练习驱动：完成基础练习并根据表现巩固',
  weakness_repair: '薄弱错题修复：先分析错题，再讲解和巩固练习',
  socratic_inquiry: '苏格拉底探究：通过提问理解原理，再完成应用练习',
  exam_sprint: '考试冲刺复习：扫描重点、练习、检测和总结',
});

function logFailure({ goalId, userId, stage, error }) {
  console.error(JSON.stringify({
    event: 'learning_goal_workflow_generation_failed',
    goalId: String(goalId),
    userId: String(userId).slice(0, 8),
    stage,
    errorCode: String(error.code || 'UNKNOWN').slice(0, 100),
    message: String(error.message || '').slice(0, 300),
  }));
}

async function generateWorkflowPreview({ goal, userId }) {
  const snapshot = goal.goal_snapshot;
  if (!snapshot) throw createAgentError('GOAL_NOT_CONFIRMED', '请先确认学习目标', 409);
  const planner = goal.planner_snapshot || {};

  // Stage: template_mapping — map planner recommendation to system whitelist
  let key;
  try {
    key = WORKFLOW_TEMPLATE_KEYS.includes(planner.recommendedTemplateKey) ? planner.recommendedTemplateKey : 'standard';
    if (planner.recommendedTemplateKey && !WORKFLOW_TEMPLATE_KEYS.includes(planner.recommendedTemplateKey)) {
      console.warn(JSON.stringify({
        event: 'learning_goal_template_fallback',
        goalId: String(goal.goal_id),
        requested: String(planner.recommendedTemplateKey).slice(0, 100),
        fallback: key,
      }));
    }
  } catch (error) {
    logFailure({ goalId: goal.goal_id, userId, stage: 'template_mapping', error });
    throw error;
  }

  const config = getLearningGoalConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.workflowTimeoutMs);
  try {
    // Stage: draft_generation — reuse existing rule-backed workflow generator
    let generated;
    try {
      generated = generationService.generateDraftFromTemplate(key, {
        estimatedMinutes: snapshot.estimatedMinutes,
        targetMastery: snapshot.targetMastery,
      });
    } catch (error) {
      logFailure({ goalId: goal.goal_id, userId, stage: 'draft_generation', error });
      throw error;
    }

    // Stage: validation — inject goal context, validate graph and settings
    let graph;
    let settings;
    try {
      graph = injectGoalContextIntoGraph(generated.graph, snapshot);
      settings = {
        ...generated.settings,
        completion_mode: 'mastery_target',
        target_mastery: snapshot.targetMastery,
        estimated_minutes: snapshot.estimatedMinutes,
        adjustment_mode: 'ask_before_adjust',
      };
      const graphValidation = validateGraphJson(graph);
      const settingsValidation = validateSettingsJson(settings);
      if (!graphValidation.valid || !settingsValidation.valid) {
        throw createAgentError('GOAL_WORKFLOW_INVALID', [...(graphValidation.errors || []), ...(settingsValidation.errors || [])].join('；'), 500);
      }
    } catch (error) {
      logFailure({ goalId: goal.goal_id, userId, stage: 'validation', error });
      throw error;
    }

    // Stage: persistence — create template in DB
    let template;
    try {
      template = await workflowTemplateService.createTemplate({
        title: snapshot.normalizedTitle,
        description: `学习目标：${snapshot.focusQuestion || snapshot.normalizedTitle}`,
        course_id: goal.course_id,
        knowledge_point_id: goal.primary_knowledge_point_id,
        graph_json: graph,
        settings_json: settings,
      }, userId);
    } catch (error) {
      logFailure({ goalId: goal.goal_id, userId, stage: 'persistence', error });
      throw error;
    }

    return {
      templateId: template.template_id,
      versionId: template.latestVersion?.version_id,
      templateKey: key,
      graph: template.latestVersion?.graph_json || graph,
      settings: template.latestVersion?.settings_json || settings,
      matchedReason: generated.matchedReason,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generateWorkflowPreview, TEMPLATE_PROMPTS };
