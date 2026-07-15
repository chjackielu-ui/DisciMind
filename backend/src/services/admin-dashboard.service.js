const prisma = require('../config/prisma');
const governance = require('./admin-governance.service');

const CONTRACT_VERSION = 'admin-dashboard.v1';

const OPTIONAL_MODULE_LABELS = Object.freeze({
  providers: 'AI 供应商状态',
  'governance.learning': '学习流程治理',
  'governance.knowledge': '知识库治理',
  'governance.teaching': '教学问题治理',
  'governance.evaluation': '智能体评测治理',
  'governance.risks': '风险治理',
  'governance.todo': '治理待办',
  trends: '趋势统计',
  teaching_issues: '教学问题排行',
  knowledge_blind_spots: '知识盲区排行',
  learning_flow_ranking: '学习流程排行',
  agents: '智能体运行状态',
  course_class_ranking: '课程教学班排行',
  ai_failure_reasons: 'AI 调用失败原因',
  frequent_admin_events: '高频管理事件',
});

function number(value) {
  if (typeof value === 'bigint') return Number(value);
  const converted = Number(value ?? 0);
  return Number.isFinite(converted) ? converted : 0;
}

function nullableNumber(value) {
  if (value == null) return null;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function unavailableError(module) {
  return {
    module,
    code: 'OPTIONAL_MODULE_UNAVAILABLE',
    status: 'unavailable',
    message: `${OPTIONAL_MODULE_LABELS[module] || '可选模块'}暂不可用。`,
  };
}

async function captureOptional(module, loader) {
  try {
    return { module, ok: true, value: await loader(), error: null };
  } catch (_error) {
    // Optional failures are intentionally sanitized. The dashboard exposes the
    // affected module without leaking database, credential, or network details.
    return { module, ok: false, value: null, error: unavailableError(module) };
  }
}

function resultStatus(result) {
  return result.ok ? 'available' : 'unavailable';
}

function aggregateStatus(results, warning = false) {
  const available = results.filter((item) => item.ok).length;
  if (!available) return 'unavailable';
  if (available !== results.length) return 'degraded';
  return warning ? 'warning' : 'available';
}

function providerHealth(result) {
  if (!result.ok) {
    return {
      status: 'unavailable',
      available: null,
      enabled: null,
      message: '无法读取已启用 AI 供应商的连接状态。',
    };
  }

  const rows = result.value;
  const available = rows.filter((item) => String(item.connection_status).toLowerCase() === 'available').length;
  const unhealthy = rows.filter((item) => String(item.connection_status).toLowerCase() !== 'available').length;
  const status = rows.length > 0 && available > 0 && unhealthy === 0 ? 'available' : 'degraded';
  let message = `${available}/${rows.length} 个已启用供应商可用。`;
  if (!rows.length) message = '没有已启用的 AI 供应商。';
  else if (!available) message = `${rows.length} 个已启用供应商均未确认可用。`;
  else if (unhealthy) message = `${unhealthy} 个已启用供应商未检测或不可用。`;

  return { status, available, enabled: rows.length, message };
}

function buildTrend(rows, trendStart) {
  const aiTrendRows = rows.ai;
  const learningTrendRows = rows.learning;
  const aiMap = new Map(aiTrendRows.map((row) => [dayKey(row.day), row]));
  const learningMap = new Map(learningTrendRows.map((row) => [dayKey(row.day), row]));

  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(trendStart);
    date.setDate(date.getDate() + index);
    const key = dayKey(date);
    const ai = aiMap.get(key);
    const flow = learningMap.get(key);
    return {
      date: key,
      ai_calls: number(ai?.calls),
      ai_successes: number(ai?.successes),
      total_tokens: number(ai?.tokens),
      learning_sessions: number(flow?.sessions),
      completed_sessions: number(flow?.completed),
    };
  });
}

function serviceEntry(key, name, status, message) {
  return { key, name, status, message };
}

function classifyAiFailure(message) {
  const value = String(message || '').toLowerCase();
  if (/timeout|timed out|超时/.test(value)) return '请求超时';
  if (/401|403|credential|api.?key|unauthor|鉴权|密钥/.test(value)) return '鉴权或密钥';
  if (/429|rate.?limit|quota|限流|配额/.test(value)) return '限流或配额';
  if (/network|connect|socket|dns|网络|连接/.test(value)) return '网络或连接';
  if (/model|provider|upstream|模型|供应商/.test(value)) return '模型或供应商';
  return '其他失败';
}

function createDashboardService({
  prismaClient = prisma,
  governanceService = governance,
  clock = () => new Date(),
} = {}) {
  async function getDashboard() {
    const now = new Date(clock());
    if (Number.isNaN(now.getTime())) throw new TypeError('Dashboard clock returned an invalid date');

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const trendStart = new Date(today);
    trendStart.setDate(trendStart.getDate() - 13);
    const activeStart = new Date(now);
    activeStart.setDate(activeStart.getDate() - 7);

    // These reads form the stable dashboard contract. Any failure here must
    // reject the request instead of returning a plausible-looking partial total.
    const [
      userCounts,
      courseCount,
      adminClassCount,
      teachingClassCount,
      knowledgeDocumentCount,
      pendingReviewDocumentCount,
      knowledgeReviewCounts,
      agentVersionReviewCounts,
      pendingAgentReviewCount,
      agentReportCounts,
      aiStatusRows,
      activeStudents,
      learningToday,
      unreadNotificationCount,
      recentEvents,
    ] = await Promise.all([
      prismaClient.user.groupBy({ by: ['role'], _count: { user_id: true }, where: { status: 'ACTIVE' } }),
      prismaClient.course.count({ where: { status: 'ACTIVE' } }),
      prismaClient.adminClass.count({ where: { status: 'active' } }),
      prismaClient.teachingClass.count({ where: { status: 'active' } }),
      prismaClient.knowledgeDocument.count({ where: { deleted_at: null } }),
      prismaClient.knowledgeDocument.count({ where: { review_status: 'PENDING', deleted_at: null } }),
      prismaClient.knowledgeDocument.groupBy({
        by: ['review_status'],
        where: { deleted_at: null },
        _count: { document_id: true },
      }),
      prismaClient.userAgentVersion.groupBy({
        by: ['reviewStatus'],
        _count: { id: true },
      }),
      prismaClient.agentReviewRecord.count({
        where: { action: 'SUBMITTED', agentVersion: { reviewStatus: 'PENDING' } },
      }),
      prismaClient.agentReport.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      prismaClient.aiCallLog.groupBy({
        by: ['status'],
        where: { created_at: { gte: today } },
        _count: { ai_call_log_id: true },
        _avg: { response_time_ms: true },
        _sum: { total_tokens: true },
      }),
      prismaClient.studyRecord.groupBy({
        by: ['student_user_id'],
        where: { created_at: { gte: activeStart } },
        _count: { study_record_id: true },
      }),
      prismaClient.learningSession.count({ where: { created_at: { gte: today } } }),
      prismaClient.notification.count({
        where: {
          is_read: false,
          deleted_at: null,
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        },
      }),
      prismaClient.operationLog.findMany({
        select: {
          operation_log_id: true,
          operation_type: true,
          action_status: true,
          target_type: true,
          created_at: true,
        },
        orderBy: { created_at: 'desc' },
        take: 8,
      }),
    ]);

    const optional = await Promise.all([
      captureOptional('providers', () => prismaClient.aiProvider.findMany({
        where: { enabled: true },
        select: {
          id: true,
          display_name: true,
          connection_status: true,
          last_latency_ms: true,
          last_checked_at: true,
        },
      })),
      captureOptional('governance.learning', () => governanceService.learningOverview()),
      captureOptional('governance.knowledge', () => governanceService.knowledgeOverview()),
      captureOptional('governance.teaching', () => governanceService.teachingOverview()),
      captureOptional('governance.evaluation', () => governanceService.evaluationOverview()),
      captureOptional('governance.risks', () => governanceService.riskOverview()),
      captureOptional('governance.todo', async () => ({
        pending_interventions: await prismaClient.teachingIntervention.count({
          where: { status: { in: ['draft', 'scheduled', 'executing'] } },
        }),
      })),
      captureOptional('trends', async () => {
        const [ai, learning] = await Promise.all([
          prismaClient.$queryRaw`SELECT DATE(created_at) AS day, COUNT(*) AS calls, SUM(status = 'success') AS successes, SUM(total_tokens) AS tokens FROM ai_call_logs WHERE created_at >= ${trendStart} GROUP BY DATE(created_at) ORDER BY day`,
          prismaClient.$queryRaw`SELECT DATE(created_at) AS day, COUNT(*) AS sessions, SUM(status = 'completed') AS completed FROM learning_sessions WHERE created_at >= ${trendStart} GROUP BY DATE(created_at) ORDER BY day`,
        ]);
        return { ai, learning };
      }),
      captureOptional('teaching_issues', () => prismaClient.teachingIssue.findMany({
        where: { status: 'open' },
        select: { id: true, title: true, severity: true, affected_count: true, confidence: true },
        orderBy: [{ severity: 'desc' }, { detected_at: 'desc' }],
        take: 6,
      })),
      captureOptional('knowledge_blind_spots', () => prismaClient.knowledgeQueryFailure.findMany({
        where: { status: 'open' },
        select: {
          id: true,
          query_redacted: true,
          occurrence_count: true,
          affected_user_count: true,
          highest_score: true,
        },
        orderBy: { occurrence_count: 'desc' },
        take: 6,
      })),
      captureOptional('learning_flow_ranking', () => prismaClient.$queryRaw`SELECT t.template_id, t.title, COUNT(s.session_id) AS executions, SUM(s.status = 'completed') AS completed FROM learning_workflow_templates t LEFT JOIN learning_sessions s ON s.workflow_template_id = t.template_id GROUP BY t.template_id, t.title HAVING executions > 0 ORDER BY completed / executions DESC, executions DESC LIMIT 6`),
      captureOptional('agents', async () => {
        const [online, efficiency] = await Promise.all([
          prismaClient.aiAgentConfig.count({ where: { enabled: true, status: 'published' } }),
          prismaClient.agentRunRecord.groupBy({
            by: ['agent_type'],
            _count: { agent_run_id: true },
            _avg: { response_time_ms: true },
            where: { created_at: { gte: trendStart } },
          }),
        ]);
        return { online, efficiency };
      }),
      captureOptional('course_class_ranking', async () => {
        const courses = await prismaClient.course.findMany({
          where: { status: 'ACTIVE' },
          select: {
            course_id: true,
            course_name: true,
            teaching_classes: {
              where: { status: 'active' },
              select: { teaching_class_id: true },
            },
          },
        });
        return courses
          .map((course) => ({
            course_id: course.course_id,
            course_name: course.course_name,
            teaching_class_count: course.teaching_classes.length,
          }))
          .sort((left, right) => right.teaching_class_count - left.teaching_class_count || left.course_id - right.course_id)
          .slice(0, 6);
      }),
      captureOptional('ai_failure_reasons', async () => {
        const failures = await prismaClient.aiCallLog.findMany({
          where: { status: 'FAILED', created_at: { gte: trendStart } },
          select: { error_message: true },
          take: 1000,
        });
        const counts = new Map();
        failures.forEach((row) => {
          const label = classifyAiFailure(row.error_message);
          counts.set(label, (counts.get(label) || 0) + 1);
        });
        return [...counts.entries()]
          .map(([label, value]) => ({ label, value }))
          .sort((left, right) => right.value - left.value);
      }),
      captureOptional('frequent_admin_events', async () => prismaClient.operationLog.groupBy({
        by: ['operation_type'],
        where: { created_at: { gte: trendStart } },
        _count: { operation_log_id: true },
        orderBy: { _count: { operation_log_id: 'desc' } },
        take: 6,
      })),
    ]);

    const modules = Object.fromEntries(optional.map((item) => [item.module, item]));
    const moduleErrors = optional.filter((item) => !item.ok).map((item) => item.error);
    const providers = modules.providers;
    const providerState = providerHealth(providers);
    const learning = modules['governance.learning'];
    const knowledge = modules['governance.knowledge'];
    const teaching = modules['governance.teaching'];
    const evaluation = modules['governance.evaluation'];
    const risks = modules['governance.risks'];
    const governanceTodo = modules['governance.todo'];
    const trends = modules.trends;
    const teachingIssues = modules.teaching_issues;
    const blindSpots = modules.knowledge_blind_spots;
    const flowRanking = modules.learning_flow_ranking;
    const agents = modules.agents;
    const courseClassRanking = modules.course_class_ranking;
    const aiFailureReasons = modules.ai_failure_reasons;
    const frequentAdminEvents = modules.frequent_admin_events;

    const governanceResults = [learning, knowledge, teaching, evaluation, risks, governanceTodo];
    const governanceWarning = (
      (learning.ok && number(learning.value.abnormal_flow_count) > 0)
      || (knowledge.ok && number(knowledge.value.open_issue_count) > 0)
      || (teaching.ok && number(teaching.value.open_issue_count) > 0)
      || (risks.ok && number(risks.value.critical_count) > 0)
    );
    const governanceStatus = aggregateStatus(governanceResults, governanceWarning);
    const rankingResults = [teachingIssues, blindSpots, flowRanking];
    const rankingStatus = aggregateStatus(rankingResults);
    const trendStatus = resultStatus(trends);
    const agentStatus = resultStatus(agents);

    const services = [
      serviceEntry('database', '数据库', 'available', '基础统计查询成功。'),
      serviceEntry('ai_providers', 'AI 供应商', providerState.status, providerState.message),
      serviceEntry('governance', '治理模块', governanceStatus,
        governanceStatus === 'available' ? '治理指标读取成功。' : governanceStatus === 'warning' ? '治理指标存在待处理事项。' : '部分治理指标暂不可用。'),
      serviceEntry('trends', '趋势统计', trendStatus,
        trends.ok ? '最近 14 天趋势读取成功。' : '趋势统计暂不可用。'),
      serviceEntry('rankings', '排行与洞察', rankingStatus,
        rankingStatus === 'available' ? '排行与洞察读取成功。' : '部分排行与洞察暂不可用。'),
      serviceEntry('agents', '智能体运行', agentStatus,
        agents.ok ? '智能体运行指标读取成功。' : '智能体运行指标暂不可用。'),
    ];
    const overall = services.slice(1).every((item) => item.status === 'available')
      ? 'operational'
      : 'degraded';

    const userMap = Object.fromEntries(userCounts.map((item) => [
      String(item.role).toLowerCase(),
      number(item._count.user_id),
    ]));
    const knowledgeReviewMap = Object.fromEntries(knowledgeReviewCounts.map((item) => [
      String(item.review_status).toLowerCase(),
      number(item._count.document_id),
    ]));
    const agentVersionReviewMap = Object.fromEntries(agentVersionReviewCounts.map((item) => [
      String(item.reviewStatus).toLowerCase(),
      number(item._count.id),
    ]));
    const agentReportMap = Object.fromEntries(agentReportCounts.map((item) => [
      String(item.status).toLowerCase(),
      number(item._count.id),
    ]));
    const aiMap = Object.fromEntries(aiStatusRows.map((item) => [String(item.status).toLowerCase(), item]));
    const aiCalls = aiStatusRows.reduce((sum, item) => sum + number(item._count.ai_call_log_id), 0);
    const aiSuccess = number(aiMap.success?._count.ai_call_log_id);
    const summary = {
      user_count: userCounts.reduce((sum, item) => sum + number(item._count.user_id), 0),
      student_count: userMap.student || 0,
      teacher_count: userMap.teacher || 0,
      admin_count: userMap.admin || 0,
      course_count: number(courseCount),
      admin_class_count: number(adminClassCount),
      teaching_class_count: number(teachingClassCount),
      class_count: number(adminClassCount) + number(teachingClassCount),
      knowledge_document_count: number(knowledgeDocumentCount),
      ai_call_count_today: aiCalls,
      pending_review_document_count: number(pendingReviewDocumentCount),
      pending_agent_review_count: number(pendingAgentReviewCount),
      pending_agent_report_count: agentReportMap.pending || 0,
      unread_notification_count: number(unreadNotificationCount),
    };

    const pendingAgentReviews = number(pendingAgentReviewCount);
    const pendingKnowledgeIssues = knowledge.ok ? number(knowledge.value.open_issue_count) : null;
    const pendingRisks = risks.ok ? number(risks.value.open_event_count) : null;
    const pendingInterventions = governanceTodo.ok ? number(governanceTodo.value.pending_interventions) : null;
    const pendingCoreTasks = summary.pending_review_document_count
      + pendingAgentReviews
      + summary.pending_agent_report_count;
    const pendingTasks = [pendingKnowledgeIssues, pendingRisks, pendingInterventions]
      .filter((value) => value != null)
      .reduce((sum, value) => sum + value, pendingCoreTasks);

    const moduleStatus = Object.fromEntries(optional.map((item) => [item.module, {
      status: resultStatus(item),
    }]));
    moduleStatus.providers.status = providerState.status;

    return {
      contract_version: CONTRACT_VERSION,
      summary,

      // Legacy flattened fields retained for existing clients.
      user_count: summary.user_count,
      student_count: summary.student_count,
      teacher_count: summary.teacher_count,
      admin_count: summary.admin_count,
      course_count: summary.course_count,
      admin_class_count: summary.admin_class_count,
      teaching_class_count: summary.teaching_class_count,
      class_count: summary.class_count,
      knowledge_document_count: summary.knowledge_document_count,
      ai_call_count_today: summary.ai_call_count_today,
      pending_review_document_count: summary.pending_review_document_count,
      pending_agent_review_count: summary.pending_agent_review_count,
      pending_agent_report_count: summary.pending_agent_report_count,
      unread_notification_count: summary.unread_notification_count,

      generated_at: now,
      module_errors: moduleErrors,
      module_status: moduleStatus,
      system_status: {
        overall,
        database: 'available',
        ai_providers_available: providerState.available,
        ai_providers_enabled: providerState.enabled,
        online_agents: agents.ok ? number(agents.value.online) : null,
        today_risks: risks.ok ? number(risks.value.today_event_count) : null,
        pending_tasks: pendingTasks,
      },
      metrics: {
        today_ai_calls: aiCalls,
        ai_success_rate: aiCalls ? Number((aiSuccess / aiCalls).toFixed(4)) : null,
        active_students_7d: activeStudents.length,
        today_learning_flows: number(learningToday),
        average_mastery_delta: learning.ok ? nullableNumber(learning.value.average_mastery_delta) : null,
        knowledge_health_score: knowledge.ok ? nullableNumber(knowledge.value.health_score) : null,
        open_teaching_issues: teaching.ok ? number(teaching.value.open_issue_count) : null,
        high_risk_events: risks.ok ? number(risks.value.critical_count) : null,
        ai_token_count: aiStatusRows.reduce((sum, item) => sum + number(item._sum.total_tokens), 0),
        sample_status: {
          ai: aiCalls ? 'sufficient' : 'insufficient_data',
          learning: learning.ok ? learning.value.data_status : 'unavailable',
          knowledge: knowledge.ok ? knowledge.value.data_status : 'unavailable',
          review: (number(knowledgeDocumentCount) + Object.values(agentVersionReviewMap).reduce((sum, value) => sum + value, 0))
            ? 'sufficient'
            : 'insufficient_data',
        },
      },
      trend: trends.ok ? buildTrend(trends.value, trendStart) : [],
      distributions: {
        users: [
          { key: 'student', label: '学生', value: summary.student_count },
          { key: 'teacher', label: '教师', value: summary.teacher_count },
          { key: 'admin', label: '管理员', value: summary.admin_count },
        ],
        classes: [
          { key: 'administrative', label: '行政班', value: summary.admin_class_count },
          { key: 'teaching', label: '教学班', value: summary.teaching_class_count },
        ],
        knowledge_reviews: [
          { key: 'pending', label: '待审核', value: knowledgeReviewMap.pending || 0 },
          { key: 'approved', label: '已通过', value: knowledgeReviewMap.approved || 0 },
          { key: 'rejected', label: '已拒绝', value: knowledgeReviewMap.rejected || 0 },
        ],
      },
      review_flow: {
        knowledge_documents: {
          pending: knowledgeReviewMap.pending || 0,
          approved: knowledgeReviewMap.approved || 0,
          rejected: knowledgeReviewMap.rejected || 0,
        },
        agent_versions: {
          pending: pendingAgentReviews,
          approved: agentVersionReviewMap.approved || 0,
          rejected: agentVersionReviewMap.rejected || 0,
        },
        reports: {
          pending: agentReportMap.pending || 0,
          resolved: agentReportMap.resolved || 0,
        },
      },
      service_health: {
        overall,
        services,
        providers: providers.ok ? providers.value.map((item) => ({
          id: item.id,
          name: item.display_name,
          status: item.connection_status,
          latency_ms: item.last_latency_ms,
          checked_at: item.last_checked_at,
        })) : [],
        learning_flows: learning.ok ? {
          status: number(learning.value.abnormal_flow_count) ? 'warning' : 'available',
          abnormal_count: number(learning.value.abnormal_flow_count),
        } : { status: 'unavailable', abnormal_count: null },
        knowledge: knowledge.ok ? {
          status: number(knowledge.value.open_issue_count) ? 'warning' : 'available',
          issue_count: number(knowledge.value.open_issue_count),
        } : { status: 'unavailable', issue_count: null },
      },
      teaching_issues: teachingIssues.ok ? teachingIssues.value : [],
      knowledge_blind_spots: blindSpots.ok ? blindSpots.value : [],
      learning_flow_ranking: flowRanking.ok ? flowRanking.value.map((item) => ({
        template_id: number(item.template_id),
        title: item.title,
        executions: number(item.executions),
        completed: number(item.completed),
        completion_rate: number(item.executions)
          ? Number((number(item.completed) / number(item.executions)).toFixed(4))
          : null,
      })) : [],
      agent_efficiency: agents.ok ? agents.value.efficiency.map((item) => ({
        agent_type: String(item.agent_type).toLowerCase(),
        runs: number(item._count.agent_run_id),
        average_latency_ms: nullableNumber(item._avg.response_time_ms),
      })) : [],
      course_class_ranking: courseClassRanking.ok ? courseClassRanking.value : [],
      ai_failure_reasons: aiFailureReasons.ok ? aiFailureReasons.value : [],
      frequent_admin_events: frequentAdminEvents.ok ? frequentAdminEvents.value.map((item) => ({
        operation_type: item.operation_type,
        count: number(item._count.operation_log_id),
      })) : [],
      evaluation: evaluation.ok ? evaluation.value : null,
      todo: {
        pending_agent_reviews: pendingAgentReviews,
        pending_knowledge_reviews: summary.pending_review_document_count,
        pending_agent_reports: summary.pending_agent_report_count,
        pending_knowledge_issues: pendingKnowledgeIssues,
        pending_risks: pendingRisks,
        pending_interventions: pendingInterventions,
      },
      recent_events: recentEvents,
    };
  }

  return { getDashboard };
}

const dashboardService = createDashboardService();

module.exports = {
  CONTRACT_VERSION,
  createDashboardService,
  getDashboard: dashboardService.getDashboard,
};
