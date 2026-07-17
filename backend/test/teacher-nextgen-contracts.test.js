const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { toPublicError, sseError } = require('../src/utils/public-error');
const { normalizeWeakKnowledgePoint, normalizeWeakKnowledgePoints } = require('../src/services/teacher-analytics-normalizer');

test('公开错误契约屏蔽 Prisma 细节并携带请求标识', () => {
  const error = Object.assign(new Error('Invalid `prisma.user.create()` invocation: Unique constraint failed'), { code: 'P2002' });
  const result = toPublicError(error, null, { id: 'req-teacher-001' });
  assert.equal(result.httpStatus, 500);
  assert.equal(result.legacyCode, 50001);
  assert.deepEqual(result.payload, {
    code: 'INTERNAL_ERROR',
    message: '服务器暂时无法完成请求，请稍后重试',
    retryable: true,
    requestId: 'req-teacher-001',
  });
  assert.equal(JSON.stringify(result.payload).includes('prisma'), false);
});

test('业务错误与 SSE 错误共享稳定公开契约', () => {
  const business = toPublicError(Object.assign(new Error('该教学班不在你的授权范围内'), { code: 40301 }), null, { id: 'req-403' });
  assert.equal(business.httpStatus, 403);
  assert.equal(business.payload.code, 'FORBIDDEN');
  assert.equal(business.payload.message, '该教学班不在你的授权范围内');
  const streamed = sseError(Object.assign(new Error('SQLSTATE connection failed'), { code: 'P1001' }), { id: 'req-sse' });
  assert.equal(streamed.code, 'INTERNAL_ERROR');
  assert.equal(streamed.requestId, 'req-sse');
  assert.equal(streamed.retryable, true);
  assert.equal(streamed.message, 'AI 服务暂时不可用，请稍后重试');
});

test('薄弱知识点统一为有限百分比、稳定名称和来源结构', () => {
  assert.deepEqual(normalizeWeakKnowledgePoint({ knowledge_point_id: 7, knowledge_point_name: '过拟合', average_mastery: '64.26', student_count: 6 }, 'mastery'), {
    knowledgePointId: 7,
    name: '过拟合',
    mastery: 64.3,
    studentCount: 6,
    source: { type: 'mastery' },
  });
  const list = normalizeWeakKnowledgePoints([
    { name: '较强项', mastery_score: 105, studentCount: 2 },
    { knowledge_point_name: '缺失值', average_mastery: undefined, student_count: 3 },
  ], { type: 'mixed-real-records' });
  assert.deepEqual(list.map((item) => item.mastery), [0, 100]);
  assert.equal(list.every((item) => Number.isFinite(item.mastery) && item.name && item.source.type), true);
});

test('学生资源路径只由分发回流路由注册，避免旧共享模型截获', () => {
  const legacyRoutes = fs.readFileSync(path.join(__dirname, '../src/routes/student.routes.js'), 'utf8');
  const distributionRoutes = fs.readFileSync(path.join(__dirname, '../src/routes/student-resource.routes.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.equal(/router\.(?:get|post)\('\/resources/.test(legacyRoutes), false);
  assert.match(distributionRoutes, /router\.get\('\/resources', controller\.listResources\)/);
  assert.equal((appSource.match(/app\.use\('\/api\/student', studentResourceRoutes\)/g) || []).length, 1);
});

test('统一任务消息中心在门户切换时清理，旧教师全局助手不再挂载', () => {
  const routerSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/router.js'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/dashboard.js'), 'utf8');
  assert.match(routerSource, /import \{ unmountUnifiedTaskMessageCenter \}/);
  const cleanupStart = routerSource.indexOf("if (!/^\\/(student|teacher|admin)\\//.test(path)) {");
  assert.notEqual(cleanupStart, -1);
  assert.match(routerSource.slice(cleanupStart, cleanupStart + 180), /unmountUnifiedTaskMessageCenter\(\)/);
  assert.match(dashboardSource, /unmountUnifiedTaskMessageCenter\(\)[\s\S]*renderUnifiedTaskMessageCenter\(user\)/);
  assert.equal(routerSource.includes('teacher-global-assistant'), false);
  assert.equal(dashboardSource.includes('teacher-global-assistant'), false);
});

test('教师二级导航只保留一级模块内部跳转', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/teacher-secondary-nav.js'), 'utf8');
  const preparationGroup = source.slice(source.indexOf("match: ['/teacher/preparation'"), source.indexOf('] }', source.indexOf("match: ['/teacher/preparation'")) + 3);
  assert.equal(preparationGroup.includes('#/teacher/analytics'), false);
  assert.equal(preparationGroup.includes('#/teacher/knowledge'), false);
  assert.equal(source.includes("match: ['/teacher/dashboard']"), false);
  assert.equal(source.includes("match: ['/teacher/analytics']"), false);
  assert.equal(source.includes("match: ['/teacher/ai','/teacher/agents'"), false);
});

test('教师日历排除通知和资源流水，并合并同日任务', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/teacher-dashboard.service.js'), 'utf8');
  const calendarBlock = source.slice(source.indexOf('const calendarEvents = ['), source.indexOf('].sort(', source.indexOf('const calendarEvents = [')));
  assert.match(calendarBlock, /taskCalendarEvents\(tasks\)/);
  assert.match(calendarBlock, /lessonPlanCalendarEvents\(lessonPlans\)/);
  assert.equal(calendarBlock.includes('documents.map'), false);
  assert.equal(calendarBlock.includes('notifications.map'), false);
  assert.match(source, /dateKey\(startAt\) === dateKey\(deadlineAt\)/);
});

test('教师 AI 采用学生端工作台结构、教师暖色语言并保持输入与提及交互', () => {
  const pageSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/teacher-ai-chat.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/styles/teacher-workbench.css'), 'utf8');
  assert.match(pageSource, /node\.innerHTML = renderMarkdownToHtml\(assistant\.content\)/);
  assert.match(pageSource, /teacher-ai-topbar/);
  assert.match(pageSource, /role="tablist" aria-label="教学助手模式"/);
  assert.match(pageSource, /teacher-ai-history-toggle/);
  assert.match(pageSource, /teacher-ai-chat-head/);
  assert.match(pageSource, /teacher-ai-input-area/);
  assert.match(pageSource, /teacher-ai-context-panel" hidden/);
  assert.match(pageSource, /teacher-ai-main is-empty/);
  assert.match(styleSource, /--teacher-accent:#b56f24/);
  assert.equal(styleSource.includes('--teacher-accent:#356fd6'), false);
  assert.match(styleSource, /\.teacher-ai-layout \{[^}]*grid-template-columns:248px minmax\(420px,1fr\)/);
  assert.match(styleSource, /\.teacher-ai-main\.is-empty \.teacher-ai-messages \{ display:grid; place-items:center/);
  assert.match(styleSource, /\.teacher-ai-input-area \{[^}]*border-top:1px solid var\(--teacher-line\)/);
  assert.match(styleSource, /\.teacher-ai-mention-popover \{[^}]*bottom:calc\(100% \+ 8px\)[^}]*max-height:min\(300px,42vh\)/);
  assert.match(pageSource, /teacher-ai-mention-icon/);
  assert.match(pageSource, /window\.matchMedia\('\(max-width: 760px\)'\)\.matches/);
  assert.match(styleSource, /height:calc\(100dvh - 48px\)/);
});

test('统一任务消息中心只停靠右侧并支持双圆计数收纳', () => {
  const pageSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/unified-task-message-center.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/styles/unified-work-center.css'), 'utf8');
  assert.match(pageSource, /discimind\.workCenterCollapsed/);
  assert.match(pageSource, /unified-center-dock-toggle/);
  assert.match(pageSource, /root\.style\.right = '0px'/);
  assert.match(pageSource, /queueDragPosition\(drag\.y \+ dy\)/);
  assert.match(pageSource, /window\.requestAnimationFrame/);
  assert.equal(pageSource.includes('protectedRects'), false);
  assert.equal(pageSource.includes('settleTimers'), false);
  assert.match(styleSource, /\.unified-work-center\{[^}]*right:0[^}]*z-index:12000/);
  assert.match(styleSource, /\.unified-work-center\.is-collapsed\{width:32px\}/);
  assert.match(styleSource, /\.unified-work-center\.is-collapsed \.unified-trigger-icon[^}]*display:none/);
  assert.match(styleSource, /background:#e4f5ec;color:#218657/);
  assert.match(styleSource, /background:#fde8e7;color:#c94e4e/);
});

test('高频关键词使用 ECharts 碰撞检测词云并保持文本可读', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/teacher-analytics.js'), 'utf8');
  const cloudBlock = source.slice(source.indexOf('function keywordCloudOption'), source.indexOf('function renderCharts'));
  assert.match(source, /function layoutCloud\(words, width, height\)/);
  assert.match(source, /context\.measureText\(item\.text\)/);
  assert.match(source, /function intersects\(rect, placed\)/);
  assert.match(cloudBlock, /type:'custom'/);
  assert.match(cloudBlock, /type:'text'/);
  assert.equal(cloudBlock.includes('rotation:'), false);
});

test('日历快捷菜单锚定日期，备课弹窗保持视口居中', () => {
  const pageSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/teacher-dashboard.js'), 'utf8');
  const styleSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/styles/teacher-workbench.css'), 'utf8');
  assert.match(pageSource, /function positionCalendarDialog\(dialog, trigger\)/);
  assert.match(pageSource, /if\(!dialog\.open\)dialog\.show\(\)/);
  assert.match(pageSource, /teacher-reminder-delete[\s\S]*dialog\.showModal\(\)/);
  assert.match(styleSource, /\.teacher-calendar-dialog\.is-anchored\s*\{[\s\S]*position:fixed/);
  assert.match(styleSource, /\.teacher-dialog\s*\{[\s\S]*inset:50% auto auto 50%/);
});

test('教师智能体广场使用独立一级入口和教师授权数据', () => {
  const menuSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/teacher-menu.js'), 'utf8');
  const routerSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/router.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/teacher-agent-marketplace.js'), 'utf8');
  assert.match(menuSource, /id: 'teacher-agent-market'[\s\S]*hash: '#\/teacher\/agents'/);
  assert.match(routerSource, /'\/teacher\/agents': \{ render: renderTeacherAgentMarketplace/);
  assert.match(pageSource, /getTeacherAiContextOptions/);
  assert.equal(pageSource.includes('AgentMarketPage'), false);
  assert.equal(pageSource.includes('学习伙伴'), false);
  assert.match(pageSource, /FORBIDDEN_STUDENT_CONTENT = \/复习\|考研/);
  assert.match(pageSource, /#\/teacher\/ai\?agentId=/);
});

test('教师产物详情使用独立页面并阻止教师落入学生路由', () => {
  const routerSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/router.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/teacher-artifacts.js'), 'utf8');
  const pendingSource = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/ai-assistant/pending-action-card.js'), 'utf8');
  assert.match(routerSource, /renderTeacherArtifactDetail/);
  assert.match(routerSource, /function renderRoleAwareArtifactDetail/);
  assert.match(routerSource, /navigateTo\(`#\/teacher\/artifacts\/\$\{params\.id\}`\)/);
  assert.match(pageSource, /export async function renderTeacherArtifactDetail/);
  assert.match(pageSource, /返回教师 AI/);
  assert.equal(pageSource.includes('加入学习流'), false);
  assert.match(pendingSource, /roleAwareArtifactUrl/);
  assert.match(pendingSource, /#\/teacher\/artifacts\/\$\{artifact\.id\}/);
  const generationSource = fs.readFileSync(path.join(__dirname, '../src/modules/file-generator/file-requirement.service.js'), 'utf8');
  assert.match(generationSource, /sourceAiConversationId:/);
  assert.match(generationSource, /resultUrl: `#\/artifacts\/\$\{artifact\.id\}`/);
  assert.match(routerSource, /pattern: \/\^\\\/artifacts\\\/(?:\\d\+|\(\\d\+\))\$\//);
});

test('教师 AI 上下文接口同步过滤学生型智能体', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/teacher-ai.service.js'), 'utf8');
  assert.match(source, /FORBIDDEN_STUDENT_AGENT_CONTENT = \/复习\|考研/);
  assert.match(source, /\(callableAgents\.list \|\| \[\]\)\.filter\(isTeacherFacingMarketplaceAgent\)\.map/);
});
