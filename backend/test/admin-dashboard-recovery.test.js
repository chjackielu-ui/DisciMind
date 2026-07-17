const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CONTRACT_VERSION,
  createDashboardService,
} = require('../src/services/admin-dashboard.service');

const FIXED_NOW = new Date('2026-07-15T08:30:00+08:00');

function createGovernanceStub() {
  return {
    learningOverview: async () => ({
      average_mastery_delta: null,
      abnormal_flow_count: 0,
      data_status: 'insufficient_data',
    }),
    knowledgeOverview: async () => ({
      health_score: null,
      open_issue_count: 0,
      data_status: 'insufficient_data',
    }),
    teachingOverview: async () => ({ open_issue_count: 0 }),
    evaluationOverview: async () => ({
      run_count: 0,
      average_score: null,
      data_status: 'insufficient_data',
    }),
    riskOverview: async () => ({
      open_event_count: 0,
      today_event_count: 0,
      critical_count: 0,
    }),
  };
}

function createPrismaStub({ providers, providerError, coreError } = {}) {
  const observed = { notificationWhere: null };
  const providerRows = providers ?? [{
    id: 1,
    display_name: '可用供应商',
    connection_status: 'available',
    last_latency_ms: 42,
    last_checked_at: FIXED_NOW,
  }];

  const prismaClient = {
    user: {
      groupBy: async () => {
        if (coreError) throw coreError;
        return [
          { role: 'STUDENT', _count: { user_id: 4 } },
          { role: 'TEACHER', _count: { user_id: 2 } },
          { role: 'ADMIN', _count: { user_id: 1 } },
        ];
      },
    },
    course: {
      count: async () => 3,
      findMany: async () => [
        { course_id: 1, course_name: '机器学习', teaching_classes: [{ teaching_class_id: 1 }, { teaching_class_id: 2 }] },
        { course_id: 2, course_name: '数据结构', teaching_classes: [{ teaching_class_id: 3 }] },
      ],
    },
    adminClass: { count: async () => 2 },
    teachingClass: { count: async () => 5 },
    knowledgeDocument: {
      count: async ({ where }) => (where.review_status === 'PENDING' ? 2 : 11),
      groupBy: async () => [
        { review_status: 'PENDING', _count: { document_id: 2 } },
        { review_status: 'APPROVED', _count: { document_id: 9 } },
      ],
    },
    userAgentVersion: {
      groupBy: async () => [
        { reviewStatus: 'PENDING', _count: { id: 1 } },
        { reviewStatus: 'APPROVED', _count: { id: 3 } },
        { reviewStatus: 'REJECTED', _count: { id: 1 } },
      ],
    },
    agentReport: {
      groupBy: async () => [
        { status: 'PENDING', _count: { id: 2 } },
        { status: 'RESOLVED', _count: { id: 4 } },
      ],
    },
    aiCallLog: {
      groupBy: async () => [
        {
          status: 'SUCCESS',
          _count: { ai_call_log_id: 3 },
          _avg: { response_time_ms: 120 },
          _sum: { total_tokens: 900 },
        },
        {
          status: 'FAILED',
          _count: { ai_call_log_id: 1 },
          _avg: { response_time_ms: 80 },
          _sum: { total_tokens: 100 },
        },
      ],
      findMany: async () => [
        { error_message: 'provider timeout' },
        { error_message: '429 rate limit' },
      ],
    },
    studyRecord: {
      groupBy: async () => [
        { student_user_id: 1, _count: { study_record_id: 2 } },
        { student_user_id: 2, _count: { study_record_id: 1 } },
        { student_user_id: 3, _count: { study_record_id: 4 } },
      ],
    },
    learningSession: { count: async () => 8 },
    notification: {
      count: async ({ where }) => {
        observed.notificationWhere = where;
        return 6;
      },
    },
    operationLog: {
      findMany: async () => [{
        operation_log_id: 7,
        operation_type: 'UPDATE',
        action_status: 'SUCCESS',
        target_type: 'provider',
        created_at: FIXED_NOW,
      }],
      groupBy: async () => [
        { operation_type: 'UPDATE', _count: { operation_log_id: 4 } },
      ],
    },
    aiProvider: {
      findMany: async () => {
        if (providerError) throw providerError;
        return providerRows;
      },
    },
    teachingIntervention: { count: async () => 0 },
    teachingIssue: { findMany: async () => [] },
    knowledgeQueryFailure: { findMany: async () => [] },
    aiAgentConfig: { count: async () => 2 },
    agentRunRecord: {
      groupBy: async () => [{
        agent_type: 'COURSE_QA',
        _count: { agent_run_id: 5 },
        _avg: { response_time_ms: null },
      }],
    },
    agentReviewRecord: { count: async () => 1 },
    $queryRaw: async (strings) => {
      const sql = strings.join(' ');
      if (sql.includes('FROM ai_call_logs')) {
        return [{ day: '2026-07-15', calls: 4n, successes: 3n, tokens: 1000n }];
      }
      if (sql.includes('FROM learning_sessions')) {
        return [{ day: '2026-07-15', sessions: 8n, completed: 7n }];
      }
      if (sql.includes('FROM learning_workflow_templates')) {
        return [{ template_id: 9n, title: '学习流程', executions: 5n, completed: 4n }];
      }
      throw new Error('Unexpected raw query in dashboard test');
    },
  };

  return { prismaClient, observed };
}

function createService(options = {}) {
  const { prismaClient, observed } = createPrismaStub(options);
  return {
    service: createDashboardService({
      prismaClient,
      governanceService: createGovernanceStub(),
      clock: () => FIXED_NOW,
    }),
    observed,
  };
}

test('returns the fixed v1 dashboard shape with numeric summary counts from core query results', async () => {
  const { service, observed } = createService();
  const dashboard = await service.getDashboard();

  assert.equal(CONTRACT_VERSION, 'admin-dashboard.v1');
  assert.equal(dashboard.contract_version, CONTRACT_VERSION);
  assert.deepEqual(dashboard.summary, {
    user_count: 7,
    student_count: 4,
    teacher_count: 2,
    admin_count: 1,
    course_count: 3,
    admin_class_count: 2,
    teaching_class_count: 5,
    class_count: 7,
    knowledge_document_count: 11,
    ai_call_count_today: 4,
    pending_review_document_count: 2,
    pending_agent_review_count: 1,
    pending_agent_report_count: 2,
    unread_notification_count: 6,
  });
  for (const value of Object.values(dashboard.summary)) {
    assert.equal(typeof value, 'number');
    assert.equal(Number.isFinite(value), true);
  }

  assert.equal(dashboard.user_count, dashboard.summary.user_count);
  assert.equal(dashboard.class_count, dashboard.summary.class_count);
  assert.equal(dashboard.unread_notification_count, dashboard.summary.unread_notification_count);
  assert.equal(dashboard.metrics.ai_success_rate, 0.75);
  assert.equal(dashboard.metrics.average_mastery_delta, null);
  assert.equal(dashboard.agent_efficiency[0].average_latency_ms, null);
  assert.equal(dashboard.trend.length, 14);
  assert.equal(dashboard.trend.at(-1).ai_calls, 4);
  assert.deepEqual(dashboard.distributions.classes, [
    { key: 'administrative', label: '行政班', value: 2 },
    { key: 'teaching', label: '教学班', value: 5 },
  ]);
  assert.deepEqual(dashboard.review_flow.knowledge_documents, { pending: 2, approved: 9, rejected: 0 });
  assert.deepEqual(dashboard.review_flow.agent_versions, { pending: 1, approved: 3, rejected: 1 });
  assert.deepEqual(dashboard.review_flow.reports, { pending: 2, resolved: 4 });
  assert.equal(dashboard.todo.pending_knowledge_reviews, 2);
  assert.equal(dashboard.todo.pending_agent_reports, 2);
  assert.equal(dashboard.service_health.overall, 'operational');
  assert.equal(dashboard.system_status.overall, 'operational');
  assert.ok(Array.isArray(dashboard.service_health.services));
  assert.ok(dashboard.service_health.services.length > 0);
  assert.deepEqual(dashboard.module_errors, []);
  assert.equal(dashboard.course_class_ranking[0].teaching_class_count, 2);
  assert.deepEqual(dashboard.ai_failure_reasons, [
    { label: '请求超时', value: 1 },
    { label: '限流或配额', value: 1 },
  ]);
  assert.deepEqual(dashboard.frequent_admin_events, [{ operation_type: 'UPDATE', count: 4 }]);
  assert.equal(observed.notificationWhere.is_read, false);
  assert.equal(observed.notificationWhere.deleted_at, null);
  assert.ok(Array.isArray(observed.notificationWhere.OR));
});

test('an optional provider failure does not crash and is explicit without leaking the cause', async () => {
  const rawCause = 'mysql://root:super-secret@example.test/dashboard';
  const { service } = createService({ providerError: new Error(rawCause) });
  const dashboard = await service.getDashboard();

  assert.equal(dashboard.summary.user_count, 7);
  assert.equal(dashboard.system_status.ai_providers_available, null);
  assert.equal(dashboard.system_status.ai_providers_enabled, null);
  assert.equal(dashboard.system_status.overall, 'degraded');
  assert.equal(dashboard.service_health.overall, 'degraded');
  assert.deepEqual(dashboard.service_health.providers, []);
  assert.equal(dashboard.module_status.providers.status, 'unavailable');

  const moduleError = dashboard.module_errors.find((item) => item.module === 'providers');
  assert.ok(moduleError);
  assert.equal(moduleError.code, 'OPTIONAL_MODULE_UNAVAILABLE');
  assert.equal(moduleError.status, 'unavailable');
  assert.equal(JSON.stringify(moduleError).includes(rawCause), false);
  assert.equal(
    dashboard.service_health.services.find((item) => item.key === 'ai_providers').status,
    'unavailable',
  );
});

test('enabled providers that are all unchecked degrade overall health', async () => {
  const providers = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    display_name: `未检测供应商 ${index + 1}`,
    connection_status: 'unchecked',
    last_latency_ms: null,
    last_checked_at: null,
  }));
  const { service } = createService({ providers });
  const dashboard = await service.getDashboard();

  assert.equal(dashboard.system_status.ai_providers_enabled, 5);
  assert.equal(dashboard.system_status.ai_providers_available, 0);
  assert.equal(dashboard.system_status.overall, 'degraded');
  assert.equal(dashboard.service_health.overall, 'degraded');
  assert.equal(dashboard.module_status.providers.status, 'degraded');
  assert.equal(
    dashboard.service_health.services.find((item) => item.key === 'ai_providers').status,
    'degraded',
  );
});

test('a core database failure rejects the dashboard request', async () => {
  const coreError = new Error('core database unavailable');
  const { service } = createService({ coreError });
  await assert.rejects(service.getDashboard(), coreError);
});
