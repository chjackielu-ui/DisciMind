const crypto = require('crypto');

const BASE = process.env.LIVE_API_BASE || 'http://127.0.0.1:3000/api';
async function request(method, route, token, body) {
  const response = await fetch(`${BASE}${route}`, { method, signal: AbortSignal.timeout(120_000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) throw new Error(`${method} ${route}: ${response.status} ${payload.message || 'failed'}`);
  return payload.data;
}
async function main() {
  const login = await request('POST', '/auth/login', null, { account: process.env.LIVE_STUDENT_ACCOUNT || 'student_demo', password: '123456' });
  const token = login.accessToken || login.token; const suffix = crypto.randomUUID().slice(0, 8);
  const agent = await request('POST', '/agents', token, {
    agentType: 'FILE_GENERATOR', description: '创建一个受控的机器学习试卷与学习讲义生成器，面向本科生复习。', name: `阶段5文件生成器-${suffix}`,
    category: '考试复习', tags: { purpose: ['考试复习'], style: ['严谨专业'], audience: ['本科生'] }, responseMode: 'DEFAULT', knowledgeBaseIds: [], memoryEnabledByDefault: false,
    topK: 5, scoreThreshold: 0.55, maxOutputTokens: 1200, operationId: crypto.randomUUID(),
    fileGeneratorConfig: { documentType: 'EXAM_PAPER', targetAudience: '本科生', defaultCourse: '机器学习', defaultDifficulty: 'MEDIUM', answerStyle: '清晰严谨', knowledgeEnhanced: false, outputTemplate: '', maxQuestionCount: 50, fileFormat: 'DOCX' },
  });
  const conversation = await request('POST', `/agents/${agent.id}/conversations`, token, { title: '逻辑回归试卷需求', operationId: crypto.randomUUID() });
  const planned = await request('POST', `/agent-conversations/${conversation.id}/file-plan`, token, { message: '生成一份逻辑回归基础试卷，20题，包含答案和解析，输出 DOCX。' });
  if ((planned.questions || []).length > 2) throw new Error('Planner asked more than two questions');
  if ('courseId' in planned || 'knowledgePointIds' in planned) throw new Error('Planner leaked database IDs');
  const current = await request('GET', `/agent-conversations/${conversation.id}/file-requirements`, token);
  if (!current.candidates.courses.length || !current.candidates.knowledgePoints.length) throw new Error('验收账号没有可访问的课程或知识点候选');
  const course = current.candidates.courses.find(item => item.courseName.includes('机器学习')) || current.candidates.courses[0];
  const point = current.candidates.knowledgePoints.find(item => item.courseKey === course.courseKey && item.knowledgePointName.includes('逻辑回归')) || current.candidates.knowledgePoints.find(item => item.courseKey === course.courseKey);
  const ready = await request('PATCH', `/agent-conversations/${conversation.id}/file-requirements`, token, { artifactType: 'EXAM_PAPER', courseKey: course.courseKey, knowledgePointKeys: [point.knowledgePointKey], title: '逻辑回归基础练习', difficulty: 'BASIC', questionCount: 20, includeAnswers: true, includeAnalysis: true, outputFormat: 'DOCX' });
  if (!ready.readyForConfirmation || ready.missingFields.length) throw new Error('requirements did not enter confirmation state');
  const operationId = crypto.randomUUID();
  const first = await request('POST', `/agent-conversations/${conversation.id}/file-confirm`, token, { operationId });
  const second = await request('POST', `/agent-conversations/${conversation.id}/file-confirm`, token, { operationId });
  if (first.artifact.id !== second.artifact.id || first.task.id !== second.task.id) throw new Error('confirmation is not idempotent');
  console.log(JSON.stringify({ ok: true, agentId: agent.id, conversationId: conversation.id, artifactId: first.artifact.id, taskId: first.task.id, plannerQuestions: (planned.questions || []).length, ready: ready.readyForConfirmation }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
