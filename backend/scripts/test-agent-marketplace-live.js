const fs = require('fs/promises');
const path = require('path');

const BASE = process.env.AGENT_MARKETPLACE_TEST_BASE_URL || 'http://localhost:3010/api';
const PREFIX = process.env.AGENT_MARKETPLACE_TEST_PREFIX || 'live-acceptance-20260711';
const TEST_PASSWORD = process.env.DISCIMIND_TEST_PASSWORD;
const TEST_ACCOUNTS = {
  student: process.env.DISCIMIND_TEST_STUDENT_ACCOUNT,
  studentB: process.env.DISCIMIND_TEST_SECONDARY_STUDENT_ACCOUNT,
  admin: process.env.DISCIMIND_TEST_ADMIN_ACCOUNT,
};
if (!TEST_PASSWORD || !Object.values(TEST_ACCOUNTS).every(Boolean)) throw new Error('DisciMind test account and password environment variables are required');

function check(condition, message) { if (!condition) throw new Error(message); }
function op(name) { return `${PREFIX}-${name}`; }
function log(message) { console.log(`[agent-market-live] ${message}`); }

async function request(method, route, token, body) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${BASE}${route}`, { method, headers, body: payload });
  const result = await response.json().catch(() => ({ code: response.status, message: '非 JSON 响应' }));
  if (!response.ok || result.code !== 0) {
    const error = new Error(result.message || `HTTP ${response.status}`); error.status = response.status; error.code = result.code; throw error;
  }
  return result.data;
}

async function expectDenied(fn, message) {
  try { await fn(); } catch (error) { check(error.status === 403, `${message}：期望 403，实际 ${error.status}/${error.message}`); return; }
  throw new Error(`${message}：请求意外成功`);
}

async function login(account) {
  const data = await request('POST', '/auth/login', null, { account, password: TEST_PASSWORD });
  return { token: data.accessToken || data.token, user: data.user };
}

function agentInput(overrides = {}) {
  return {
    description: '创建一个帮助本科生理解验收资料概念的学习助手，回答耐心并给出清晰步骤。',
    name: '真实闭环验收助手', category: '概念讲解',
    tags: { purpose: ['概念讲解'], style: ['耐心详细'], audience: ['本科生'] },
    responseMode: 'DEFAULT', knowledgeBaseIds: [], memoryEnabledByDefault: false,
    topK: 5, scoreThreshold: 0.55, maxOutputTokens: 800, operationId: op('create-default-agent'),
    ...overrides,
  };
}

async function main() {
  log('登录学生 A、学生 B 和管理员');
  const [studentA, studentB, admin] = await Promise.all([login(TEST_ACCOUNTS.student), login(TEST_ACCOUNTS.studentB), login(TEST_ACCOUNTS.admin)]);

  log('场景一：公开发现、私有隔离与默认智能体创建');
  const publicList = await request('GET', '/agents', studentB.token);
  check(publicList.total >= 6, '公开智能体不足 6 个');
  const mineB = await request('GET', '/agents/mine', studentB.token);
  const privateB = mineB.list.find((item) => item.status === 'PRIVATE');
  check(privateB, '学生 B 私有智能体不存在');
  await expectDenied(() => request('GET', `/agents/${privateB.id}`, studentA.token), '学生 A 不应看到学生 B 私有智能体');
  await expectDenied(() => request('GET', '/admin/agent-reviews', studentA.token), '学生不应访问管理员接口');

  const defaultAgent = await request('POST', '/agents', studentA.token, agentInput());
  check(defaultAgent.status === 'PRIVATE' && defaultAgent.version.responseMode === 'DEFAULT', '默认智能体状态或模式错误');
  check(defaultAgent.version.systemPrompt.length > 30, 'System Prompt 未真实生成');
  const defaultConversation = await request('POST', `/agents/${defaultAgent.id}/conversations`, studentA.token, { title: '默认模式验收', operationId: op('default-conversation') });
  const defaultAnswer = await request('POST', `/agent-conversations/${defaultConversation.id}/messages`, studentA.token, { content: '请用一句话解释什么是监督学习。', operationId: op('default-message') });
  check(defaultAnswer.message.answerSource === 'GENERAL' && defaultAnswer.message.sources.length === 0, '默认模式不应调用或展示知识库引用');

  log('场景二：创建真实 Dify 知识库并上传 TXT 文档');
  const kb = await request('POST', '/knowledge-bases', studentA.token, { name: '真实闭环验收知识库', description: '用于 Dify 上传、索引与引用验收。', category: '课程学习', operationId: op('create-kb') });
  check(!Object.hasOwn(kb, 'difyDatasetId'), '前端响应泄露 Dataset ID');
  await expectDenied(() => request('GET', `/knowledge-bases/${kb.id}`, studentB.token), '学生 B 不应查看学生 A 私有知识库');
  await expectDenied(() => request('POST', '/agents', studentB.token, agentInput({ name: '非法绑定测试', responseMode: 'KNOWLEDGE_FIRST', knowledgeBaseIds: [kb.id], operationId: op('b-illegal-bind') })), '学生 B 不应绑定学生 A 私有知识库');

  const fixturePath = path.resolve(__dirname, '../test/fixtures/agent-knowledge-sample.txt');
  const form = new FormData();
  form.append('file', new Blob([await fs.readFile(fixturePath)], { type: 'text/plain' }), 'agent-knowledge-sample.txt');
  form.append('operationId', op('upload-document'));
  await request('POST', `/knowledge-bases/${kb.id}/documents`, studentA.token, form);
  let kbStatus; let lastStatus;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    kbStatus = await request('GET', `/knowledge-bases/${kb.id}/status`, studentA.token);
    if (kbStatus.status !== lastStatus) { log(`Dify 索引阶段：${kbStatus.status}`); lastStatus = kbStatus.status; }
    const documentsReady = (kbStatus.documents || []).length > 0 && kbStatus.documents.every((doc) => doc.status === 'READY');
    if (documentsReady || kbStatus.status === 'FAILED') break;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  check((kbStatus.documents || []).length > 0 && kbStatus.documents.every((doc) => doc.status === 'READY'), `真实 Dify 文档索引未 READY：${kbStatus.status}`);

  const knowledgeAgent = await request('POST', '/agents', studentA.token, agentInput({
    name: '蓝鲸复习法资料助手', responseMode: 'KNOWLEDGE_FIRST', knowledgeBaseIds: [kb.id],
    scoreThreshold: 0.55, operationId: op('create-knowledge-agent'),
  }));
  const knowledgeConversation = await request('POST', `/agents/${knowledgeAgent.id}/conversations`, studentA.token, { title: '知识库模式验收', operationId: op('knowledge-conversation') });
  const hit = await request('POST', `/agent-conversations/${knowledgeConversation.id}/messages`, studentA.token, { content: '蓝鲸复习法包含哪三个步骤？', operationId: op('knowledge-hit') });
  check(hit.message.sources.length > 0 && hit.message.answerSource === 'KNOWLEDGE', '文档内问题未返回真实引用');
  check(hit.message.sources.every((source) => source.documentName && source.quote && (source.pageNumber === null || Number.isInteger(source.pageNumber))), '引用字段或页码真实性不符合要求');

  const miss = await request('POST', `/agent-conversations/${knowledgeConversation.id}/messages`, studentA.token, { content: '请介绍火星大气的主要成分，并说明是否来自当前资料。', operationId: op('knowledge-miss') });
  check(miss.message.knowledgeFallbackUsed && /未找到直接依据|知识库暂时不可用/.test(miss.message.content), '知识库外问题未使用通用模型并显示提示');

  log('场景三：知识库与智能体分别公开审核');
  if (kbStatus.visibility !== 'PUBLIC') {
    await request('POST', `/knowledge-bases/${kb.id}/apply-public`, studentA.token, { operationId: op('apply-kb-public') });
    const kbReviews = await request('GET', '/admin/knowledge-base-reviews', admin.token);
    const review = kbReviews.list.find((item) => item.knowledgeBase.id === kb.id);
    check(review, '管理员未看到知识库审核任务');
    await request('POST', `/admin/knowledge-base-reviews/${review.id}/approve`, admin.token, { operationId: op('approve-kb') });
  }
  const publicKb = await request('GET', `/knowledge-bases/${kb.id}`, studentB.token);
  check(publicKb.visibility === 'PUBLIC' && !Object.hasOwn(publicKb, 'difyDatasetId'), '知识库未公开或泄露 Dataset ID');

  let publicAgent = await request('GET', `/agents/${knowledgeAgent.id}`, studentA.token);
  if (publicAgent.status !== 'PUBLIC') {
    await request('POST', `/agents/${knowledgeAgent.id}/apply-public`, studentA.token, { operationId: op('apply-agent-public-v1') });
    const reviews = await request('GET', '/admin/agent-reviews', admin.token);
    const review = reviews.list.find((item) => item.agent.id === knowledgeAgent.id);
    check(review, '管理员未看到智能体审核任务');
    await request('POST', `/admin/agent-reviews/${review.id}/approve`, admin.token, { operationId: op('approve-agent-v1') });
  }
  publicAgent = await request('GET', `/agents/${knowledgeAgent.id}`, studentB.token);
  check(publicAgent.status === 'PUBLIC', '学生 B 未发现审核通过的智能体');

  log('场景四：学生 B 使用、收藏、评分、复制与会话隔离');
  const bConversation = await request('POST', `/agents/${knowledgeAgent.id}/conversations`, studentB.token, { title: '学生 B 使用验收', operationId: op('b-public-conversation') });
  await request('POST', `/agent-conversations/${bConversation.id}/messages`, studentB.token, { content: '简要说明蓝鲸复习法。', operationId: op('b-public-message') });
  await expectDenied(() => request('GET', `/agent-conversations/${bConversation.id}`, studentA.token), '创建者不应查看学生 B 对话');
  await request('POST', `/agents/${knowledgeAgent.id}/favorite`, studentB.token, {});
  await request('POST', `/agents/${knowledgeAgent.id}/favorite`, studentB.token, {});
  await request('POST', `/agents/${knowledgeAgent.id}/rating`, studentB.token, { rating: 5 });
  const copied = await request('POST', `/agents/${knowledgeAgent.id}/copy`, studentB.token, { operationId: op('b-copy-agent') });
  check(copied.status === 'PRIVATE' && copied.creator.id === studentB.user.user_id, '复制智能体未成为学生 B 私有副本');
  check(copied.id !== knowledgeAgent.id && copied.copiedFromAgentId === knowledgeAgent.id, '副本来源或资源隔离不正确');
  check(copied.version.knowledgeBases.some((item) => item.id === kb.id && item.visibility === 'PUBLIC'), '公开知识库未被副本只读复用');
  await expectDenied(() => request('PUT', `/knowledge-bases/${kb.id}`, studentB.token, {
    name: '不应允许修改的公开知识库', description: '越权更新测试', operationId: op('b-update-public-kb'),
  }), '学生 B 不应修改学生 A 的公开知识库');

  log('场景五：公开智能体编辑生成新草稿，旧版本继续服务');
  const ownerBefore = await request('GET', `/agents/${knowledgeAgent.id}`, studentA.token);
  const privateKb = await request('POST', '/knowledge-bases', studentA.token, {
    name: '复制隔离私有知识库', description: '只绑定草稿，用于验证复制时忽略私有知识库。', operationId: op('create-private-copy-kb'),
  });
  const privateDraft = await request('PUT', `/agents/${knowledgeAgent.id}`, studentA.token, agentInput({
    description: '包含公开与私有知识库的新草稿，仅用于复制隔离验收。', name: '蓝鲸复习法资料助手',
    responseMode: 'KNOWLEDGE_FIRST', knowledgeBaseIds: [kb.id, privateKb.id], systemPrompt: ownerBefore.version.systemPrompt,
    operationId: op('update-agent-private-kb-draft'), changeSummary: '验证公开版本与私有草稿隔离',
  }));
  check(privateDraft.version.knowledgeBases.some((item) => item.id === privateKb.id && item.visibility === 'PRIVATE'), '私有知识库未绑定到创建者草稿');
  const bWhilePrivateDraft = await request('GET', `/agents/${knowledgeAgent.id}`, studentB.token);
  check(bWhilePrivateDraft.version.versionNumber === ownerBefore.version.versionNumber, '私有草稿不应替换旧公开版本');
  check(!bWhilePrivateDraft.version.knowledgeBases.some((item) => item.id === privateKb.id), '学生 B 不应看到公开智能体的私有草稿知识库');
  const copiedWhilePrivateDraft = await request('POST', `/agents/${knowledgeAgent.id}/copy`, studentB.token, { operationId: op('b-copy-agent-private-draft') });
  check(copiedWhilePrivateDraft.version.knowledgeBases.some((item) => item.id === kb.id), '复制时未复用公开知识库');
  check(!copiedWhilePrivateDraft.version.knowledgeBases.some((item) => item.id === privateKb.id), '复制时错误复制了私有知识库');
  const updated = await request('PUT', `/agents/${knowledgeAgent.id}`, studentA.token, agentInput({
    description: '更新后的蓝鲸复习法助手，回答更简洁但仍保留真实引用。', name: '蓝鲸复习法资料助手',
    responseMode: 'KNOWLEDGE_FIRST', knowledgeBaseIds: [kb.id], systemPrompt: ownerBefore.version.systemPrompt,
    operationId: op('update-agent-v2'), changeSummary: '调整回答说明与版本文案',
  }));
  check(updated.version.versionNumber > privateDraft.version.versionNumber, '编辑未在隔离草稿后生成新版本');
  const bOld = await request('GET', `/agents/${knowledgeAgent.id}`, studentB.token);
  check(bOld.version.versionNumber === ownerBefore.version.versionNumber, '新草稿不应立即影响公开版本');
  await request('POST', `/agents/${knowledgeAgent.id}/apply-public`, studentA.token, { operationId: op('apply-agent-public-v2') });
  const v2Reviews = await request('GET', '/admin/agent-reviews', admin.token);
  const v2Review = v2Reviews.list.find((item) => item.agent.id === knowledgeAgent.id && item.version.versionNumber === updated.version.versionNumber);
  check(v2Review, '管理员未看到新版本审核任务');
  await request('POST', `/admin/agent-reviews/${v2Review.id}/approve`, admin.token, { operationId: op('approve-agent-v2') });
  const bNew = await request('GET', `/agents/${knowledgeAgent.id}`, studentB.token);
  check(bNew.version.versionNumber === updated.version.versionNumber, '新版本审核后未替换公开版本');

  log('场景六：长期记忆默认关闭、可管理且私有隔离');
  check(defaultConversation.memoryEnabled === false, '长期记忆应默认关闭');
  await request('PUT', `/agent-conversations/${defaultConversation.id}`, studentA.token, { memoryEnabled: true });
  const savedMemory = await request('POST', `/agents/${defaultAgent.id}/memories`, studentA.token, { type: 'STYLE_PREFERENCE', title: '回答偏好', content: '喜欢循序渐进并配合例子' });
  const memories = await request('GET', `/agents/${defaultAgent.id}/memories`, studentA.token);
  check(memories.list.some((item) => item.id === savedMemory.id), '长期记忆保存或查看失败');
  const updatedMemory = await request('PUT', `/agents/${defaultAgent.id}/memories/${savedMemory.id}`, studentA.token, {
    type: 'STYLE_PREFERENCE', title: '更新后的回答偏好', content: '喜欢先给结论，再循序渐进举例',
  });
  check(updatedMemory.title === '更新后的回答偏好', '长期记忆编辑失败');
  await expectDenied(() => request('GET', `/agents/${defaultAgent.id}/memories`, studentB.token), '学生 B 不应查看学生 A 私有智能体记忆');
  await request('DELETE', `/agents/${defaultAgent.id}/memories/${savedMemory.id}`, studentA.token);

  log('场景七：多会话创建、重命名、继续与删除');
  const extraConversation = await request('POST', `/agents/${defaultAgent.id}/conversations`, studentA.token, { title: '待重命名会话', operationId: op('extra-conversation') });
  const renamedConversation = await request('PUT', `/agent-conversations/${extraConversation.id}`, studentA.token, { title: '已重命名学习会话' });
  check(renamedConversation.title === '已重命名学习会话', '会话重命名失败');
  await request('POST', `/agent-conversations/${extraConversation.id}/messages`, studentA.token, { content: '继续这个会话：一句话说明无监督学习。', operationId: op('extra-conversation-message') });
  const continuedConversation = await request('GET', `/agent-conversations/${extraConversation.id}`, studentA.token);
  check(continuedConversation.messages.length >= 2 && continuedConversation.title === '已重命名学习会话', '会话继续或历史读取失败');
  const conversationList = await request('GET', `/agents/${defaultAgent.id}/conversations`, studentA.token);
  check(conversationList.list.some((item) => item.id === defaultConversation.id) && conversationList.list.some((item) => item.id === extraConversation.id), '多会话列表不完整');
  await request('DELETE', `/agent-conversations/${extraConversation.id}`, studentA.token);
  const afterConversationDelete = await request('GET', `/agents/${defaultAgent.id}/conversations`, studentA.token);
  check(!afterConversationDelete.list.some((item) => item.id === extraConversation.id), '删除的会话仍出现在列表中');
  await expectDenied(() => request('GET', `/agent-conversations/${extraConversation.id}`, studentA.token), '删除的会话不应继续可见');

  log('场景八：长期记忆批量清理、举报处理与管理员下架');
  await request('POST', `/agents/${defaultAgent.id}/memories`, studentA.token, { type: 'LEARNING_GOAL', title: '阶段目标', content: '掌握机器学习基础概念' });
  await request('POST', `/agents/${defaultAgent.id}/memories`, studentA.token, { type: 'COURSE_BACKGROUND', title: '课程背景', content: '正在学习机器学习导论' });
  await request('DELETE', `/agents/${defaultAgent.id}/memories`, studentA.token);
  const afterMemoryClear = await request('GET', `/agents/${defaultAgent.id}/memories`, studentA.token);
  check(afterMemoryClear.list.length === 0, '长期记忆批量清理失败');

  const report = await request('POST', `/agents/${knowledgeAgent.id}/report`, studentB.token, {
    reason: '内容不准确', detail: '阶段一验收举报，测试管理员处理流程。', operationId: op('b-report-agent'),
  });
  const reports = await request('GET', '/admin/agent-reports', admin.token);
  check(reports.list.some((item) => item.id === report.id && item.agent.id === knowledgeAgent.id), '管理员未看到学生 B 的举报');
  const resolved = await request('POST', `/admin/agent-reports/${report.id}/resolve`, admin.token, {
    resolution: '已人工核查并记录，先完成举报处理再单独下架。', offlineAgent: false, operationId: op('admin-resolve-report'),
  });
  check(resolved.resolved && !resolved.offline, '管理员举报处理失败');
  await request('POST', `/admin/agents/${knowledgeAgent.id}/offline`, admin.token, { operationId: op('admin-offline-agent') });
  await expectDenied(() => request('GET', `/agents/${knowledgeAgent.id}`, studentB.token), '智能体下架后学生 B 不应继续访问');
  const ownerOffline = await request('GET', `/agents/${knowledgeAgent.id}`, studentA.token);
  check(ownerOffline.status === 'OFFLINE', '管理员下架状态未写入');

  log('八个真实验收场景全部通过');
}

main().catch((error) => {
  console.error(`[agent-market-live] FAILED: ${error.message}`);
  process.exitCode = 1;
});
