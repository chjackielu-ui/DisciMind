const { tool } = require('@langchain/core/tools');
const { z } = require('zod');
const analyticsService = require('../../../services/teacher-analytics-workbench.service');

const analyticsInput = z.object({
  course_id: z.number().int().positive(),
  teaching_class_id: z.number().int().positive().optional(),
  range: z.enum(['7d', '30d', 'semester', 'custom']).default('7d'),
  start_at: z.string().optional(),
  end_at: z.string().optional(),
  chapter_id: z.number().int().positive().optional(),
  knowledge_point_id: z.number().int().positive().optional(),
});

function createTeacherAnalyticsTools(authenticatedUser) {
  // authenticatedUser 来自 JWT。工具 schema 故意不接收 teacherUserId，防止模型越权替换身份。
  const studentQuestionAnalyticsTool = tool(
    async (input) => analyticsService.getDialogueInsights(authenticatedUser, input),
    {
      name: 'student_question_analytics',
      description: '读取当前教师有权访问的教学班学生疑问、关键词、趋势和来源。禁止自由 SQL。',
      schema: analyticsInput,
    },
  );

  const dialogueKeywordTool = tool(
    async (input) => {
      const result = await analyticsService.getDialogueInsights(authenticatedUser, input);
      return { filters: result.filters, keywords: result.keywords, trend: result.trend, sources: result.sources };
    },
    {
      name: 'dialogue_keyword',
      description: '返回教师权限范围内的学生学科对话高频关键词和时间趋势。',
      schema: analyticsInput,
    },
  );

  const misconceptionClusterTool = tool(
    async (input) => {
      const result = await analyticsService.getDialogueInsights(authenticatedUser, input);
      return { filters: result.filters, misconceptions: result.misconceptions, unresolved_count: result.unresolved_count, sources: result.sources };
    },
    {
      name: 'misconception_cluster',
      description: '读取已经过受控分析的常见误解标签，不执行模型生成的数据库语句。',
      schema: analyticsInput,
    },
  );

  const classLearningSummaryTool = tool(
    async (input) => {
      const result = await analyticsService.buildWorkbench(authenticatedUser, input);
      return {
        filters: result.filters,
        overview: result.overview,
        weak_knowledge_points: result.weak_knowledge_points,
        risk_students: result.risk_students,
        teaching_focus: result.teaching_focus,
        sources: result.data_sources,
      };
    },
    {
      name: 'class_learning_summary',
      description: '汇总当前教师有权访问的课程/教学班真实学情，用于教师 AI 与智慧备课。',
      schema: analyticsInput,
    },
  );

  return {
    StudentQuestionAnalyticsTool: studentQuestionAnalyticsTool,
    DialogueKeywordTool: dialogueKeywordTool,
    MisconceptionClusterTool: misconceptionClusterTool,
    ClassLearningSummaryTool: classLearningSummaryTool,
    list: [studentQuestionAnalyticsTool, dialogueKeywordTool, misconceptionClusterTool, classLearningSummaryTool],
  };
}

module.exports = { createTeacherAnalyticsTools, analyticsInput };
