// 前端 Hash 路由 — 支持动态路由匹配
// 包含路由守卫：未登录跳转登录页，已登录访问登录页自动跳转对应首页

import { isLoggedIn, getUser, initializeAuth, getAuthStatus, AUTH_STATUS } from './auth.js'
import { getActivePracticeAttempt } from '../api/student.js'
<<<<<<< Updated upstream
=======
import { renderTeacherDashboard } from '../pages/teacher-dashboard.js'
import { renderTeacherCourses } from '../pages/teacher-courses.js'
import { renderTeacherCourseDetail } from '../pages/teacher-course-detail.js'
import { renderTeacherStudents } from '../pages/teacher-students.js'
import { renderTeacherStudentDetail } from '../pages/teacher-student-detail.js'
import { renderTeacherTasks } from '../pages/teacher-tasks.js'
import { renderTeacherTaskCreate } from '../pages/teacher-task-create.js'
import { renderTeacherTaskDetail } from '../pages/teacher-task-detail.js'
import { renderTeacherQuestions } from '../pages/teacher-questions.js'
import { renderTeacherQuestionCreate } from '../pages/teacher-question-create.js'
import { renderTeacherKnowledge } from '../pages/teacher-knowledge.js'
import { renderTeacherAnalytics } from '../pages/teacher-analytics.js'
import { renderTeacherProfile } from '../pages/teacher-profile.js'
import { renderTeacherClasses } from '../pages/teacher-classes.js'
import { renderTeacherSystemManagement } from '../pages/teacher-system-management.js'
import { renderTeacherClassWorkspace } from '../pages/teacher-class-workspace.js'
import { renderTeacherLessonPlan } from '../pages/teacher-lesson-plan.js'
import { renderTeacherHomework } from '../pages/teacher-homework.js'
import { renderTeacherAiChat } from '../pages/teacher-ai-chat.js'
import { renderTeacherPreparation } from '../pages/teacher-preparation.js'
import { renderTeacherPreparationImmersive } from '../pages/teacher-preparation-immersive.js'
import { renderTeacherArtifacts } from '../pages/teacher-artifacts.js'
import { renderTeacherAgentMarketplace } from '../pages/teacher-agent-marketplace.js'
import { renderAdminDashboard } from '../pages/admin-dashboard.js'
import { renderAdminUsers } from '../pages/admin-users.js'
import { renderAdminCourses } from '../pages/admin-courses.js'
import { renderAdminCourseDetail } from '../pages/admin-course-detail.js'
import { renderAdminClasses } from '../pages/admin-classes.js'
import { renderAdminTeachingClasses } from '../pages/admin-teaching-classes.js'
import { renderAdminKnowledge } from '../pages/admin-knowledge.js'
import { renderAdminLogs } from '../pages/admin-logs.js'
import { renderAdminNotifications } from '../pages/admin-notifications.js'
import { renderAdminAiConfig } from '../pages/admin-ai-config.js'
import { renderAdminProfile } from '../pages/admin-profile.js'
import { renderAdminAgentReviews } from '../pages/admin-agent-reviews.js'
import { renderAdminTraces } from '../pages/admin-traces.js'
import { renderAdminPermissions } from '../pages/admin-permissions.js'
import { renderAdminAiSafety } from '../pages/admin-ai-safety.js'
import {
  renderAdminLearningFlows, renderAdminKnowledgeHealth, renderAdminTeachingIssues,
  renderAdminEvaluations, renderAdminExperiments, renderAdminDigitalTwin,
  renderAdminAssets, renderAdminStrategyProfiles, renderAdminRisks,
} from '../pages/admin-governance.js'
>>>>>>> Stashed changes
import { loadAdminAccess, hasAdminPermission } from './admin-access.js'
import { ADMIN_MENU_ITEMS } from './admin-menu.js'
import { renderDashboardLayout } from './dashboard.js'
import { unmountUnifiedTaskMessageCenter } from '../components/unified-task-message-center.js'
import { escapeHtml } from './format.js'

// Route modules are loaded on demand. Keeping every student, teacher and admin
// page in the entry chunk made even the login screen download the whole app.
const lazyRender = (loader, exportName) => async (...args) => {
  const module = await loader()
  const renderer = module[exportName]
  if (typeof renderer !== 'function') throw new Error(`页面模块缺少导出：${exportName}`)
  return renderer(...args)
}

const renderLoginPage = lazyRender(() => import('../pages/login.js'), 'renderLoginPage')
const renderRegisterPage = lazyRender(() => import('../pages/register.js'), 'renderRegisterPage')
const renderStudentDashboard = lazyRender(() => import('../pages/student-dashboard.js'), 'renderStudentDashboard')
const renderStudentCourses = lazyRender(() => import('../pages/student-courses.js'), 'renderStudentCourses')
const renderStudentCourseDetail = lazyRender(() => import('../pages/student-course-detail.js'), 'renderStudentCourseDetail')
const renderStudentWrongQuestions = lazyRender(() => import('../pages/student-wrong-questions.js'), 'renderStudentWrongQuestions')
const renderStudentRecommendations = lazyRender(() => import('../pages/student-recommendations.js'), 'renderStudentRecommendations')
const renderStudentPortrait = lazyRender(() => import('../pages/student-portrait.js'), 'renderStudentPortrait')
const renderStudentDiagnostician = lazyRender(() => import('../pages/student-diagnostician.js'), 'renderStudentDiagnostician')
const renderStudentProfile = lazyRender(() => import('../pages/student-profile.js'), 'renderStudentProfile')
const renderStudentAiChat = lazyRender(() => import('../pages/student-ai-chat.js'), 'renderStudentAiChat')
const renderStudentPracticeCenter = lazyRender(() => import('../pages/student-practice-center.js'), 'renderStudentPracticeCenter')
const renderStudentPracticeSession = lazyRender(() => import('../pages/student-practice-session.js'), 'renderStudentPracticeSession')
const renderStudentTrainerSession = lazyRender(() => import('../pages/student-trainer-session.js'), 'renderStudentTrainerSession')
const renderStudentTaskAnswer = lazyRender(() => import('../pages/student-task-answer.js'), 'renderStudentTaskAnswer')
const renderStudentTeachingTasks = lazyRender(() => import('../pages/student-teaching-tasks.js'), 'renderStudentTeachingTasks')
const renderStudentSubmissionResult = lazyRender(() => import('../pages/student-submission-result.js'), 'renderStudentSubmissionResult')
const renderStudentDocuments = lazyRender(() => import('../pages/student-documents.js'), 'renderStudentDocuments')
const renderStudentVideos = lazyRender(() => import('../pages/student-videos.js'), 'renderStudentVideos')
const renderStudentAgentDetail = lazyRender(() => import('../pages/agent/AgentDetailPage.js'), 'renderStudentAgentDetail')
const renderAgentMarket = lazyRender(() => import('../pages/agent/AgentMarketPage.js'), 'renderAgentMarket')
const renderMyAgents = lazyRender(() => import('../pages/agent/AgentMarketPage.js'), 'renderMyAgents')
const renderFavoriteAgents = lazyRender(() => import('../pages/agent/AgentMarketPage.js'), 'renderFavoriteAgents')
const renderMarketplaceAgentDetail = lazyRender(() => import('../pages/agent/AgentMarketPage.js'), 'renderAgentDetail')
const renderAgentCreate = lazyRender(() => import('../pages/agent/AgentCreatePage.js'), 'renderAgentCreate')
const renderAgentEdit = lazyRender(() => import('../pages/agent/AgentCreatePage.js'), 'renderAgentEdit')
const renderKnowledgeBases = lazyRender(() => import('../pages/agent/KnowledgeBasesPage.js'), 'renderKnowledgeBases')
const renderAgentChat = lazyRender(() => import('../pages/agent/AgentChatPage.js'), 'renderAgentChat')
const renderGeneratedArtifacts = lazyRender(() => import('../pages/agent/GeneratedArtifactsPage.js'), 'renderGeneratedArtifacts')
const renderGeneratedArtifactDetail = lazyRender(() => import('../pages/agent/GeneratedArtifactsPage.js'), 'renderGeneratedArtifactDetail')
const renderAgentTasks = lazyRender(() => import('../pages/agent/AgentTasksPage.js'), 'renderAgentTasks')
const renderStudentLearningFlows = lazyRender(() => import('../pages/student-learning-flows.js'), 'renderStudentLearningFlows')
const renderStudentLearningFlowEditor = lazyRender(() => import('../pages/student-learning-flow-editor.js'), 'renderStudentLearningFlowEditor')
const renderStudentLearningSession = lazyRender(() => import('../pages/student-learning-session.js'), 'renderStudentLearningSession')
const renderStudentLearningSummary = lazyRender(() => import('../pages/student-learning-summary.js'), 'renderStudentLearningSummary')

const renderTeacherDashboard = lazyRender(() => import('../pages/teacher-dashboard.js'), 'renderTeacherDashboard')
const renderTeacherCourseDetail = lazyRender(() => import('../pages/teacher-course-detail.js'), 'renderTeacherCourseDetail')
const renderTeacherStudentDetail = lazyRender(() => import('../pages/teacher-student-detail.js'), 'renderTeacherStudentDetail')
const renderTeacherTasks = lazyRender(() => import('../pages/teacher-tasks.js'), 'renderTeacherTasks')
const renderTeacherTaskCreate = lazyRender(() => import('../pages/teacher-task-create.js'), 'renderTeacherTaskCreate')
const renderTeacherTaskDetail = lazyRender(() => import('../pages/teacher-task-detail.js'), 'renderTeacherTaskDetail')
const renderTeacherQuestions = lazyRender(() => import('../pages/teacher-questions.js'), 'renderTeacherQuestions')
const renderTeacherQuestionCreate = lazyRender(() => import('../pages/teacher-question-create.js'), 'renderTeacherQuestionCreate')
const renderTeacherKnowledge = lazyRender(() => import('../pages/teacher-knowledge.js'), 'renderTeacherKnowledge')
const renderTeacherAnalytics = lazyRender(() => import('../pages/teacher-analytics.js'), 'renderTeacherAnalytics')
const renderTeacherProfile = lazyRender(() => import('../pages/teacher-profile.js'), 'renderTeacherProfile')
const renderTeacherSystemManagement = lazyRender(() => import('../pages/teacher-system-management.js'), 'renderTeacherSystemManagement')
const renderTeacherLessonPlan = lazyRender(() => import('../pages/teacher-lesson-plan.js'), 'renderTeacherLessonPlan')
const renderTeacherHomework = lazyRender(() => import('../pages/teacher-homework.js'), 'renderTeacherHomework')
const renderTeacherAiChat = lazyRender(() => import('../pages/teacher-ai-chat.js'), 'renderTeacherAiChat')
const renderTeacherPreparation = lazyRender(() => import('../pages/teacher-preparation.js'), 'renderTeacherPreparation')
const renderTeacherPreparationImmersive = lazyRender(() => import('../pages/teacher-preparation-immersive.js'), 'renderTeacherPreparationImmersive')
const renderTeacherArtifacts = lazyRender(() => import('../pages/teacher-artifacts.js'), 'renderTeacherArtifacts')
const renderTeacherArtifactDetail = lazyRender(() => import('../pages/teacher-artifacts.js'), 'renderTeacherArtifactDetail')
const renderTeacherAgentMarketplace = lazyRender(() => import('../pages/teacher-agent-marketplace.js'), 'renderTeacherAgentMarketplace')

function usesTeacherPortal() {
  return ['teacher', 'admin'].includes(String(getUser()?.role || '').toLowerCase())
}

function renderRoleAwareArtifactList(app) {
  if (usesTeacherPortal()) return navigateTo('#/teacher/artifacts')
  return renderGeneratedArtifacts(app)
}

function renderRoleAwareArtifactDetail(app, params) {
  if (usesTeacherPortal()) return navigateTo(`#/teacher/artifacts/${params.id}`)
  return renderGeneratedArtifactDetail(app, params)
}

const renderAdminDashboard = lazyRender(() => import('../pages/admin-dashboard.js'), 'renderAdminDashboard')
const renderAdminUsers = lazyRender(() => import('../pages/admin-users.js'), 'renderAdminUsers')
const renderAdminCourses = lazyRender(() => import('../pages/admin-courses.js'), 'renderAdminCourses')
const renderAdminCourseDetail = lazyRender(() => import('../pages/admin-course-detail.js'), 'renderAdminCourseDetail')
const renderAdminClasses = lazyRender(() => import('../pages/admin-classes.js'), 'renderAdminClasses')
const renderAdminTeachingClasses = lazyRender(() => import('../pages/admin-teaching-classes.js'), 'renderAdminTeachingClasses')
const renderAdminKnowledge = lazyRender(() => import('../pages/admin-knowledge.js'), 'renderAdminKnowledge')
const renderAdminLogs = lazyRender(() => import('../pages/admin-logs.js'), 'renderAdminLogs')
const renderAdminNotifications = lazyRender(() => import('../pages/admin-notifications.js'), 'renderAdminNotifications')
const renderAdminAiConfig = lazyRender(() => import('../pages/admin-ai-config.js'), 'renderAdminAiConfig')
const renderAdminProfile = lazyRender(() => import('../pages/admin-profile.js'), 'renderAdminProfile')
const renderAdminAgentReviews = lazyRender(() => import('../pages/admin-agent-reviews.js'), 'renderAdminAgentReviews')
const renderAdminTraces = lazyRender(() => import('../pages/admin-traces.js'), 'renderAdminTraces')
const renderAdminPermissions = lazyRender(() => import('../pages/admin-permissions.js'), 'renderAdminPermissions')
const renderAdminLearningFlows = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminLearningFlows')
const renderAdminKnowledgeHealth = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminKnowledgeHealth')
const renderAdminTeachingIssues = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminTeachingIssues')
const renderAdminEvaluations = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminEvaluations')
const renderAdminExperiments = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminExperiments')
const renderAdminDigitalTwin = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminDigitalTwin')
const renderAdminAssets = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminAssets')
const renderAdminStrategyProfiles = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminStrategyProfiles')
const renderAdminRisks = lazyRender(() => import('../pages/admin-governance.js'), 'renderAdminRisks')

// ============================================================
// 教师端页面导入区域（教师端开发者在此添加 import）
// ============================================================

// ============================================================
// 管理端页面导入区域（管理端开发者在此添加 import）
// ============================================================

// ========================
// 路由表定义
// ========================

// 静态路由（精确匹配）
const staticRoutes = {
  '/login': { render: renderLoginPage, auth: false },
  '/register': { render: renderRegisterPage, auth: false },
  '/artifacts': { render: renderRoleAwareArtifactList, auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/dashboard': { render: renderStudentDashboard, auth: true, roles: ['student'] },
  '/student/courses': { render: renderStudentCourses, auth: true, roles: ['student'] },
  '/student/practice': { render: renderStudentPracticeCenter, auth: true, roles: ['student'] },
  '/student/trainer': { render: renderStudentTrainerSession, auth: true, roles: ['student'] },
  '/student/wrong-questions': { render: renderStudentWrongQuestions, auth: true, roles: ['student'] },
  '/student/recommendations': { render: renderStudentRecommendations, auth: true, roles: ['student'] },
  '/student/portrait': { render: renderStudentPortrait, auth: true, roles: ['student'] },
  '/student/diagnostician': { render: renderStudentDiagnostician, auth: true, roles: ['student'] },
  '/student/profile': { render: renderStudentProfile, auth: true, roles: ['student'] },
  '/student/ai-chat': { render: renderStudentAiChat, auth: true, roles: ['student'] },
  '/student/teaching-tasks': { render: renderStudentTeachingTasks, auth: true, roles: ['student'] },
  '/student/documents': { render: renderStudentDocuments, auth: true, roles: ['student'] },
  '/student/videos': { render: renderStudentVideos, auth: true, roles: ['student'] },
  '/student/agents/trainer': { render: renderStudentAgentDetail, auth: true, roles: ['student'] },
  '/student/agents': { render: renderAgentMarket, auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/agents/mine': { render: renderMyAgents, auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/agents/knowledge': { render: renderKnowledgeBases, auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/agents/favorites': { render: renderFavoriteAgents, auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/agents/create': { render: renderAgentCreate, auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/agent-tasks': { render: renderAgentTasks, auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/artifacts': { render: renderRoleAwareArtifactList, auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/generated-artifacts': { render: () => navigateTo(usesTeacherPortal() ? '#/teacher/artifacts' : '#/student/artifacts'), auth: true, roles: ['student', 'teacher', 'admin'] },
  '/student/learning-flows': { render: renderStudentLearningFlows, auth: true, roles: ['student'] },
  '/student/learning-context': { render: () => navigateTo('#/student/learning-flows?panel=learning-plan'), auth: true, roles: ['student'] },
  '/teacher/dashboard': { render: renderTeacherDashboard, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/courses': { render: () => navigateTo('#/teacher/system?tab=courses'), auth: true, roles: ['teacher', 'admin'] },
  '/teacher/students': { render: () => navigateTo('#/teacher/system?tab=students'), auth: true, roles: ['teacher', 'admin'] },
  '/teacher/tasks': { render: renderTeacherTasks, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/tasks/create': { render: renderTeacherTaskCreate, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/questions': { render: renderTeacherQuestions, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/questions/create': { render: renderTeacherQuestionCreate, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/knowledge': { render: renderTeacherKnowledge, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/analytics': { render: renderTeacherAnalytics, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/profile': { render: renderTeacherProfile, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/classes': { render: () => navigateTo('#/teacher/system?tab=classes'), auth: true, roles: ['teacher', 'admin'] },
  '/teacher/system': { render: renderTeacherSystemManagement, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/lesson-plan': { render: renderTeacherLessonPlan, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/preparation': { render: renderTeacherPreparation, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/preparation/immersive': { render: renderTeacherPreparationImmersive, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/ai': { render: renderTeacherAiChat, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/homework': { render: renderTeacherHomework, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/agents': { render: renderTeacherAgentMarketplace, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/agents/mine': { render: () => navigateTo('#/teacher/agents'), auth: true, roles: ['teacher', 'admin'] },
  '/teacher/agents/knowledge': { render: renderKnowledgeBases, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/agents/favorites': { render: () => navigateTo('#/teacher/agents'), auth: true, roles: ['teacher', 'admin'] },
  '/teacher/agents/create': { render: renderAgentCreate, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/agent-tasks': { render: renderAgentTasks, auth: true, roles: ['teacher', 'admin'] },
  '/teacher/artifacts': { render: renderTeacherArtifacts, auth: true, roles: ['teacher', 'admin'] },

  // ========== 教师端路由（教师端开发者在此区域添加）==========

  '/admin/dashboard': { render: renderAdminDashboard, auth: true, roles: ['admin'], permission: 'admin.dashboard.view' },
  '/admin/users': { render: renderAdminUsers, auth: true, roles: ['admin'], permission: 'admin.users.view' },
  '/admin/courses': { render: renderAdminCourses, auth: true, roles: ['admin'], permission: 'admin.teaching.view' },
  '/admin/classes': { render: renderAdminClasses, auth: true, roles: ['admin'], permission: 'admin.teaching.view' },
  '/admin/teaching-classes': { render: renderAdminTeachingClasses, auth: true, roles: ['admin'], permission: 'admin.teaching.view' },
  '/admin/knowledge': { render: renderAdminKnowledge, auth: true, roles: ['admin'], permission: 'admin.knowledge.view' },
  '/admin/logs': { render: renderAdminLogs, auth: true, roles: ['admin'], permission: 'admin.audit.view' },
  '/admin/notifications': { render: renderAdminNotifications, auth: true, roles: ['admin'], permission: 'admin.system.view' },
  '/admin/ai-config': { render: renderAdminAiConfig, auth: true, roles: ['admin'], permission: ['admin.ai.providers.view', 'admin.ai.models.view'] },
  '/admin/profile': { render: renderAdminProfile, auth: true, roles: ['admin'] },
  '/admin/agent-reviews': { render: renderAdminAgentReviews, auth: true, roles: ['admin'], permission: ['admin.agents.view', 'admin.knowledge.view', 'admin.risks.view'] },
  '/admin/traces': { render: renderAdminTraces, auth: true, roles: ['admin'], permission: 'admin.traces.view' },
  '/admin/learning-flows': { render: renderAdminLearningFlows, auth: true, roles: ['admin'], permission: 'admin.workflows.view' },
  '/admin/agents': { render: renderAdminAiConfig, auth: true, roles: ['admin'], permission: 'admin.agents.view' },
  '/admin/evaluations': { render: renderAdminEvaluations, auth: true, roles: ['admin'], permission: 'admin.evaluations.view' },
  '/admin/experiments': { render: renderAdminExperiments, auth: true, roles: ['admin'], permission: 'admin.experiments.view' },
  '/admin/knowledge-health': { render: renderAdminKnowledgeHealth, auth: true, roles: ['admin'], permission: 'admin.knowledge.view' },
  '/admin/teaching-issues': { render: renderAdminTeachingIssues, auth: true, roles: ['admin'], permission: 'admin.interventions.view' },
  '/admin/digital-twin': { render: renderAdminDigitalTwin, auth: true, roles: ['admin'], permission: 'admin.teaching.view' },
  '/admin/assets': { render: renderAdminAssets, auth: true, roles: ['admin'], permission: 'admin.assets.view' },
  '/admin/strategy-profiles': { render: renderAdminStrategyProfiles, auth: true, roles: ['admin'], permission: 'admin.teaching.view' },
  '/admin/risks': { render: renderAdminRisks, auth: true, roles: ['admin'], permission: 'admin.risks.view' },
  '/admin/ai-safety': { render: renderAdminAiSafety, auth: true, roles: ['admin'], permission: 'admin.risks.view' },
  '/admin/environment': { render: renderAdminAiConfig, auth: true, roles: ['admin'], permission: 'admin.system.view' },
  '/admin/permissions': { render: renderAdminPermissions, auth: true, roles: ['admin'], permission: 'admin.system.view' },

  // ========== 管理端路由（管理端开发者在此区域添加）==========
}

// 动态路由（正则匹配）
const dynamicRoutes = [
  {
    pattern: /^\/artifacts\/(\d+)$/,
    render: renderRoleAwareArtifactDetail,
    auth: true,
    roles: ['student', 'teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/student\/artifacts\/(\d+)$/,
    render: renderRoleAwareArtifactDetail,
    auth: true,
    roles: ['student', 'teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/student\/generated-artifacts\/(\d+)$/,
    render: (_app, params) => navigateTo(usesTeacherPortal() ? `#/teacher/artifacts/${params.id}` : `#/student/artifacts/${params.id}`),
    auth: true,
    roles: ['student', 'teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/student\/agents\/(\d+)\/detail$/,
    render: renderMarketplaceAgentDetail,
    auth: true,
    roles: ['student', 'teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/student\/agents\/(\d+)\/edit$/,
    render: renderAgentEdit,
    auth: true,
    roles: ['student', 'teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/student\/agents\/(\d+)\/chat\/(\d+)$/,
    render: renderAgentChat,
    auth: true,
    roles: ['student', 'teacher', 'admin'],
    paramNames: ['id', 'conversationId'],
  },
  {
    pattern: /^\/student\/agents\/(\d+)\/chat$/,
    render: renderAgentChat,
    auth: true,
    roles: ['student', 'teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/teacher\/artifacts\/(\d+)$/,
    render: renderTeacherArtifactDetail,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/teacher\/agents\/(\d+)\/detail$/,
    render: renderTeacherAgentMarketplace,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/teacher\/agents\/(\d+)\/edit$/,
    render: renderAgentEdit,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    pattern: /^\/teacher\/agents\/(\d+)\/chat\/(\d+)$/,
    render: renderAgentChat,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['id', 'conversationId'],
  },
  {
    pattern: /^\/teacher\/agents\/(\d+)\/chat$/,
    render: renderAgentChat,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['id'],
  },
  {
    // #/student/practice/sessions/:practice_session_id
    pattern: /^\/student\/practice\/sessions\/(\d+)$/,
    render: renderStudentPracticeSession,
    auth: true,
    roles: ['student'],
    paramNames: ['practice_session_id'],
  },
  {
    // #/student/trainer/sessions/:session_id
    pattern: /^\/student\/trainer\/sessions\/(\d+)$/,
    render: renderStudentTrainerSession,
    auth: true,
    roles: ['student'],
    paramNames: ['session_id'],
  },
  {
    // #/student/courses/:course_id
    pattern: /^\/student\/courses\/(\d+)$/,
    render: renderStudentCourseDetail,
    auth: true,
    roles: ['student'],
    paramNames: ['course_id'],
  },
  {
    // #/student/tasks/:task_id/answer
    pattern: /^\/student\/tasks\/(\d+)\/answer$/,
    render: renderStudentTaskAnswer,
    auth: true,
    roles: ['student'],
    paramNames: ['task_id'],
  },
  {
    // #/student/submissions/:submission_id/result
    pattern: /^\/student\/submissions\/(\d+)\/result$/,
    render: renderStudentSubmissionResult,
    auth: true,
    roles: ['student'],
    paramNames: ['submission_id'],
  },
  {
    // #/student/knowledge-points/:kp_id (预留)
    pattern: /^\/student\/knowledge-points\/(\d+)$/,
    render: () => {
      // 暂未实现独立知识点详情页，跳转到课程列表
      window.location.hash = '#/student/courses'
    },
    auth: true,
    roles: ['student'],
    paramNames: ['kp_id'],
  },
  {
    // #/student/learning-flow/editor/:workflowId
    pattern: /^\/student\/learning-flow\/editor\/(.+)$/,
    render: renderStudentLearningFlowEditor,
    auth: true,
    roles: ['student'],
    paramNames: ['workflowId'],
  },
  {
    // #/student/learning/session/:sessionId
    pattern: /^\/student\/learning\/session\/(\d+)$/,
    render: renderStudentLearningSession,
    auth: true,
    roles: ['student'],
    paramNames: ['sessionId'],
  },
  {
    // #/student/learning/session/:sessionId/summary
    pattern: /^\/student\/learning\/session\/(\d+)\/summary$/,
    render: renderStudentLearningSummary,
    auth: true,
    roles: ['student'],
    paramNames: ['sessionId'],
  },
  // ========== 教师端动态路由 ==========
  {
    // #/teacher/classes/:class_id
    pattern: /^\/teacher\/classes\/(\d+)$/,
    render: renderTeacherClassWorkspace,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['class_id'],
  },
  {
    // #/teacher/courses/:course_id
    pattern: /^\/teacher\/courses\/(\d+)$/,
    render: renderTeacherCourseDetail,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['course_id'],
  },
  {
    // #/teacher/students/:student_user_id
    pattern: /^\/teacher\/students\/(\d+)$/,
    render: renderTeacherStudentDetail,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['student_user_id'],
  },
  {
    // #/teacher/tasks/:task_id
    pattern: /^\/teacher\/tasks\/(\d+)$/,
    render: renderTeacherTaskDetail,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['task_id'],
  },
  {
    // #/teacher/tasks/:task_id/edit
    pattern: /^\/teacher\/tasks\/(\d+)\/edit$/,
    render: renderTeacherTaskCreate,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['task_id'],
  },
  {
    // #/teacher/questions/:question_id
    pattern: /^\/teacher\/questions\/(\d+)$/,
    render: renderTeacherQuestionCreate,
    auth: true,
    roles: ['teacher', 'admin'],
    paramNames: ['question_id'],
  },
  // ========== 管理端动态路由 ==========
  {
    // #/admin/courses/:course_id
    pattern: /^\/admin\/courses\/(\d+)$/,
    render: renderAdminCourseDetail,
    auth: true,
    roles: ['admin'],
    permission: 'admin.teaching.view',
    paramNames: ['course_id'],
  },
]

// 角色 → 默认首页路由
const ROLE_HOME = {
  admin: '/admin/dashboard',
  teacher: '/teacher/dashboard',
  student: '/student/dashboard',
}

function getCurrentPath() {
  const raw = window.location.hash.slice(1) || '/login'
  return raw.split('?')[0] || '/login'
}

function isPracticeSessionPath(path, attemptId) {
  const expected = `/student/practice/sessions/${attemptId}`
  return path === expected
}

async function guardActiveExam(path, user) {
  if (user?.role !== 'student') return false
  if (!path.startsWith('/student/')) return false
  try {
    const result = await getActivePracticeAttempt()
    const data = result.data || {}
    if (!data.hasActiveAttempt) return false

    // 只有 forceResume 为 true 时才强制重定向
    // 普通练习不强制恢复
    if (data.forceResume !== true) return false

    const attemptId = data.attemptId || data.attempt?.practice_session_id || data.session?.practice_session_id
    if (!attemptId) return false
    if (isPracticeSessionPath(path, attemptId)) return false

    // 同时匹配任务答题路由
    if (isTaskAnswerPath(path)) return false

    window.location.hash = `#/student/practice/sessions/${attemptId}`
    return true
  } catch {
    return false
  }
}

function isTaskAnswerPath(path) {
  return /^\/student\/tasks\/\d+\/answer$/.test(path)
}

function matchRoute(path) {
  // 先尝试精确匹配
  if (staticRoutes[path]) {
    return { route: staticRoutes[path], params: {} }
  }

  // 再尝试动态匹配
  for (const dr of dynamicRoutes) {
    const match = path.match(dr.pattern)
    if (match) {
      const params = {}
      const names = dr.paramNames || ['id']
      names.forEach((name, idx) => { params[name] = match[idx + 1] })
      return { route: dr, params }
    }
  }

  return null
}

let renderSeq = 0
let activePageCleanup = null
let renderQueue = Promise.resolve()

function buildAuthCheckingHTML() {
  return `
    <div class="complex-shell">
      <div class="complex-loading">
        <div class="complex-spinner"></div>
        <p>正在检查登录状态...</p>
      </div>
    </div>`
}

function buildRouteLoadingHTML() {
  return `
    <div class="complex-shell" role="status" aria-live="polite">
      <div class="complex-loading">
        <div class="complex-spinner"></div>
        <p>正在载入页面...</p>
      </div>
    </div>`
}

function renderRouteError(app, error) {
  app.innerHTML = `
    <div class="complex-shell">
      <div class="complex-error" role="alert">
        <h2>页面载入失败</h2>
        <p>${escapeHtml(error?.message || '页面资源暂时不可用，请稍后重试。')}</p>
        <button type="button" data-route-retry>重新载入</button>
      </div>
    </div>`
  app.querySelector('[data-route-retry]')?.addEventListener('click', render, { once: true })
}

function renderAdminAccessState(app, user, title, message) {
  renderDashboardLayout(app, {
    user,
    title,
    menuItems: ADMIN_MENU_ITEMS,
    contentHTML: `<div class="admin-page"><div class="admin-error" role="alert"><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div></div></div>`,
  })
}

function render() {
  const seq = ++renderSeq
  const pendingRender = renderQueue.then(
    () => renderRoute(seq),
    () => renderRoute(seq),
  )
  renderQueue = pendingRender.catch((error) => {
    console.error('页面渲染失败', error)
  })
  return pendingRender
}

async function renderRoute(seq) {
  if (seq !== renderSeq) return
  const app = document.getElementById('app')
  if (!app) return

  if (activePageCleanup) {
    const cleanup = activePageCleanup
    activePageCleanup = null
    try { await cleanup() } catch (error) { console.warn('页面清理未完全完成', error) }
    if (seq !== renderSeq) return
  }

  if (getAuthStatus() === AUTH_STATUS.INITIALIZING) {
    app.innerHTML = buildAuthCheckingHTML()
    await initializeAuth()
    if (seq !== renderSeq) return
  }

  const path = getCurrentPath()
  if (!/^\/(student|teacher|admin)\//.test(path)) {
    unmountUnifiedTaskMessageCenter()
    document.getElementById('discimind-global-overlays')?.remove()
  }
  const matched = matchRoute(path)

  // 路由不存在 → 跳转到合适的默认页
  if (!matched) {
    if (isLoggedIn()) {
      const user = getUser()
      const home = ROLE_HOME[user?.role] || '/login'
      window.location.hash = `#${home}`
    } else {
      window.location.hash = '#/login'
    }
    return
  }

  const { route, params } = matched

  // 需要登录但未登录 → 跳转登录页
  if (route.auth && !isLoggedIn()) {
    window.location.hash = '#/login'
    return
  }

  // 已登录但访问登录/注册页 → 跳转对应首页
  if (!route.auth && isLoggedIn()) {
    const user = getUser()
    const home = ROLE_HOME[user?.role]
    if (home) {
      window.location.hash = `#${home}`
      return
    }
  }

  // 角色权限检查
  if (route.roles && isLoggedIn()) {
    const user = getUser()
    if (!route.roles.includes(user?.role)) {
      const home = ROLE_HOME[user?.role] || '/login'
      window.location.hash = `#${home}`
      return
    }
  }

  if (path.startsWith('/admin/') && isLoggedIn()) {
    const user = getUser()
    try {
      const access = await loadAdminAccess(user?.user_id)
      if (seq !== renderSeq) return
      const requiredPermissions = Array.isArray(route.permission) ? route.permission : route.permission ? [route.permission] : []
      if (requiredPermissions.length && !requiredPermissions.some((permission) => hasAdminPermission(access, permission))) {
        renderAdminAccessState(app, user, '无权访问此页面', '当前管理员角色未被授予此模块的查看权限。请联系超级管理员调整显式角色授权。')
        return
      }
    } catch (error) {
      if (seq !== renderSeq) return
      renderAdminAccessState(app, user, '权限校验失败', error.message || '无法读取当前管理员的显式权限，请稍后重试。')
      return
    }
  }

  if (route.auth && isLoggedIn()) {
    const redirected = await guardActiveExam(path, getUser())
    if (seq !== renderSeq) return
    if (redirected) return
  }

  // 渲染页面
<<<<<<< Updated upstream
  app.innerHTML = buildRouteLoadingHTML()
=======
  if (seq !== renderSeq) return
  app.innerHTML = ''
>>>>>>> Stashed changes
  if (path.startsWith('/admin/')) {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
  let cleanup
  try {
    cleanup = await route.render(app, params)
  } catch (error) {
    if (seq !== renderSeq) return
    console.error('页面载入失败', error)
    renderRouteError(app, error)
    return
  }
  if (seq !== renderSeq) {
    if (typeof cleanup === 'function') await cleanup()
    return
  }
  if (path.startsWith('/admin/')) {
    window.scrollTo(0, 0)
  }
  activePageCleanup = typeof cleanup === 'function' ? cleanup : null
}

export function initRouter() {
  window.addEventListener('hashchange', render)
  render()
}

export function navigateTo(hash) {
  window.location.hash = hash
}
