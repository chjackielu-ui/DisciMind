const { randomUUID } = require('crypto');
const { getBailianClient } = require('../../services/bailian-openai.service');
const { createPlan } = require('./workflow-planner');
const { getCapabilities } = require('./capability.service');
const { DashScopeSearchClient } = require('./dashscope-search.client');
const { buildRegistry } = require('./tool-handlers.service');
const { FunctionCallExecutor, executeTool } = require('./function-call-executor');
const agentRegistry = require('./agent-registry.service');
const traceRepository = require('./trace-repository.service');
const { normalizeCitations } = require('./citation-normalizer');
const { StreamEventFactory } = require('./stream-event.service');
const userContextService = require('./user-context.service');
const learningData = require('./student-learning-data.service');
const { INTENTS, shouldCreateChart } = require('./intent-router.service');
const artifactService = require('./artifact.service');
const pendingActions = require('./pending-action.service');

function textContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(item => item?.type === 'text').map(item => item.text || '').join('\n');
}

function searchMessages(messages) {
  return (messages || []).map(message => ({ role: message.role, content: textContent(message.content) })).filter(message => message.content);
}

function emitFactory(factory, callback) {
  return (type, payload = {}) => {
    const event = factory.create(type, payload);
    callback?.(event);
    return event;
  };
}

function sourceContext(result) {
  if (!result?.content && !result?.sources?.length) return '';
  return `<web_search_result>\n搜索回答草稿：\n${result.content || ''}\n\n实际网页来源：\n${(result.sources || []).map(item => `[ref_${item.index}] ${item.title} ${item.url}`).join('\n')}\n</web_search_result>`;
}

function formatLearningResult(tool, result, userContext) {
  const scope = [userContext.selectedCourse?.name, userContext.selectedKnowledgePoint?.name].filter(Boolean).join(' · ') || '全部已选课程';
  const lines = [`已按当前登录身份读取本人数据。范围：${scope}。`, '', result.message || '查询完成。'];
  if (tool === 'get_student_wrong_questions' && result.items?.length) {
    lines.push('', '最近错题：', ...result.items.slice(0, 8).map((item, index) => `${index + 1}. ${item.title}${item.knowledgePoint?.name ? `（${item.knowledgePoint.name}）` : ''} · ${item.status}`));
    if (result.items.length > 8) lines.push(`另有 ${result.items.length - 8} 道未在正文展开。`);
  } else if (tool === 'get_student_score_trend' && result.points?.length) {
    const first = result.points[0]; const last = result.points[result.points.length - 1];
    lines.push('', `起点 ${first.scoreRate}%（${first.label}），终点 ${last.scoreRate}%（${last.label}），变化 ${Math.round((last.scoreRate - first.scoreRate) * 100) / 100} 个百分点。`);
  } else if (tool === 'get_student_mastery' && result.items?.length) {
    lines.push('', '掌握度较低的知识点：', ...result.items.slice(0, 8).map(item => `- ${item.name}：${item.score}%（${item.level}）`));
  } else if (tool === 'get_student_learning_records' && result.items?.length) {
    lines.push('', ...result.items.slice(0, 8).map(item => `- ${new Date(item.occurredAt).toLocaleDateString('zh-CN')} · ${item.actionType} · ${Math.round(item.durationSeconds / 60)} 分钟`));
  } else if (tool === 'get_student_recent_sessions' && result.items?.length) {
    lines.push('', ...result.items.slice(0, 8).map(item => `- ${item.type} #${item.id} · ${item.knowledgePointName || item.courseName || '当前课程'} · ${item.status}`));
  } else if (tool === 'get_student_learning_time') {
    lines.push('', `已记录总时长：${result.totalMinutes || 0} 分钟。`);
  } else if (tool === 'get_student_task_completion') {
    lines.push('', `完成 ${result.completed || 0} 个，进行中 ${result.inProgress || 0} 个，未开始 ${result.notStarted || 0} 个；完成率 ${result.completionRate || 0}%。`);
  } else if (tool === 'get_current_student_context' && result.current) {
    lines.push('', `课程：${result.current.course?.name || '未选择'}`, `知识点：${result.current.knowledgePoint?.name || '未选择'}`, `教学班：${result.current.teachingClass?.name || '未选择'}`);
  }
  if (result.metricDefinition) lines.push('', `统计口径：${result.metricDefinition}`);
  lines.push(`数据来源：${result.source?.label || 'DisciMind 学习数据库'}。`);
  if (result.no_data || result.noData) lines.push('没有数据时未补造趋势或示例值。');
  return lines.join('\n');
}

function toolArgumentsForIntent(query, toolName) {
  const text = String(query || '');
  const month = /(?:最近|近)\s*(?:一个月|1\s*个?月|30\s*天)/iu.test(text);
  const week = /(?:最近|近)\s*(?:一周|一个星期|7\s*天)/iu.test(text);
  const days = month ? 30 : week ? 7 : undefined;
  if (['get_student_learning_records', 'get_student_wrong_questions', 'get_student_recent_sessions'].includes(toolName)) {
    return { ...(days && toolName === 'get_student_learning_records' ? { days } : {}), limit: toolName === 'get_student_recent_sessions' ? 10 : toolName === 'get_student_wrong_questions' ? 20 : 50 };
  }
  if (['get_student_score_trend', 'get_student_learning_time', 'get_student_task_completion'].includes(toolName)) return days ? { days } : {};
  return {};
}

function chartFallbackText(spec, error) {
  const table = spec?.table;
  const rows = Array.isArray(table?.rows) ? table.rows.slice(0, 12) : [];
  const lines = rows.length
    ? ['图表暂未创建，以下保留同一份真实数据表：', '', `| ${(table.columns || []).join(' | ')} |`, `| ${(table.columns || []).map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(value => value == null ? '—' : String(value)).join(' | ')} |`)]
    : ['图表暂未创建；已保留查询结果，没有填充示例数据。'];
  lines.push('', `降级原因：${error?.details?.issue || error?.message || '图表参数未通过契约校验'}`, '你可以点击“重新生成图表”再次使用这份数据，不会重新查询数据库。');
  return lines.join('\n');
}

function resolveAgentExecutionMode(input = {}, query = '') {
  const requested = String(input.agentExecutionMode || input.agent_execution_mode || '').toLowerCase();
  if (requested === 'parallel' || requested === 'serial') return requested;
  return /(?:并行|同时|分别分析|独立检索|parallel|concurrent)/iu.test(String(query || '')) ? 'parallel' : 'serial';
}

function buildAgentSteps(selectedAgents = [], mode = 'serial') {
  let previousId = null;
  return selectedAgents.map((selected, index) => {
    const id = `agent_${index + 1}_${selected.agent.id}`;
    const step = {
      id,
      type: 'agent',
      agentId: selected.agent.id,
      title: selected.version.name,
      order: index + 1,
      dependsOn: mode === 'serial' && previousId ? [previousId] : [],
      inputFromPrevious: mode === 'serial' && index > 0,
      status: 'pending',
    };
    previousId = id;
    return step;
  });
}

function serialAgentQuery(query, results = []) {
  if (!results.length) return query;
  const upstream = results.map((item, index) => {
    const content = String(item?.content || '').slice(-6000);
    return `[上游 Agent ${index + 1}：${item?.agentName || item?.agentId || 'unknown'}]\n${content}`;
  }).join('\n\n');
  return `${query}\n\n请在完成原任务时显式继承以下已执行上游 Agent 的真实输出；不得声称重新执行它们：\n${upstream}`;
}

async function streamPlainCompletion(messages, input, emit) {
  const { client, model } = getBailianClient();
  const stream = await client.chat.completions.create({
    model, messages, stream: true, temperature: 0.45, enable_thinking: false,
    max_tokens: Math.max(128, Math.min(16384, Number(input.maxTokens) || 2200)),
  }, { signal: input.signal });
  let content = ''; let usage = null;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) { content += delta; emit('answer.delta', { content: delta }); input.onDelta?.(delta); }
    if (chunk.usage) { usage = chunk.usage; emit('usage.updated', chunk.usage); }
  }
  return { content, usage, calls: [] };
}

async function run(input = {}) {
  const user = input.user;
  const query = String(input.query || '').trim();
  const plan = input.plan || createPlan({
    query, role: user?.role, searchOptions: input.searchOptions,
    manualAgentRefs: input.manualAgentRefs || input.resolvedAgents || [],
    knowledgeBaseIds: input.knowledgeBaseIds || [], attachments: input.attachments || [],
  });
  const userContext = input.userContext || await userContextService.buildUserContext({
    user, query, conversationId: input.conversationId, courseId: input.courseId,
    knowledgePointId: input.knowledgePointId, subjectCode: input.subjectCode,
  });
  const trace = await traceRepository.start({
    user_id: user?.user_id, user_role: user?.role, conversation_id: input.conversationId,
    course_id: input.courseId, teaching_class_id: input.teachingClassId,
    entry_point: input.entryPoint || 'ai-assistant', scene: input.scene || 'unified_task_center',
    search_mode: plan.searchOptions.mode, intent: plan.intent, plan,
    context: { ...(input.context || {}), userContext: userContextService.publicUserContext(userContext) },
    input: { query, manualAgentRefs: input.manualAgentRefs || [], knowledgeBaseIds: input.knowledgeBaseIds || [] },
  });
  const factory = new StreamEventFactory(trace.trace_id || randomUUID());
  const emit = emitFactory(factory, input.onEvent);
  const startedAt = Date.now(); let sources = []; let searchResult = null; let agentResults = []; let result = null;
  try {
    emit('run.started', { traceId: trace.trace_id, traceDatabaseId: trace.id, entryPoint: input.entryPoint });
    emit('module.started', { module: 'planning' });
    emit('intent.detected', plan.intent);
    const capabilities = await getCapabilities();
    const manualAgents = Array.isArray(input.resolvedAgents) && input.resolvedAgents.length ? input.resolvedAgents : null;
    const selectedAgents = manualAgents || (plan.intent.subjectAgentAllowed ? await agentRegistry.resolvePlan(user.user_id, {
      query, skills: plan.skills, manualAgentRefs: input.manualAgentRefs,
      auto: input.autoAgent !== false, assistantMode: input.assistantMode,
      courseId: input.courseId, subjectCode: input.subjectCode, intent: plan.intent.kind,
    }) : []);
    const publicAgents = selectedAgents.map(agentRegistry.publicAgent);
    const agentExecutionMode = resolveAgentExecutionMode(input, query);
    const agentSteps = buildAgentSteps(selectedAgents, agentExecutionMode);
    const plannedAgentSteps = plan.steps.filter(step => step.type === 'agent');
    const runtimeSteps = plannedAgentSteps.length
      ? plan.steps.map(step => {
        if (step.type !== 'agent') return step;
        const selected = selectedAgents[Number(step.agentIndex) || 0];
        return selected
          ? { ...step, agentId: selected.agent.id, title: selected.version.name }
          : { ...step, taskType: `direct_model_fallback_${Number(step.agentIndex || 0) + 1}`, type: 'model', title: '降级到主模型回答', description: '未匹配到通过能力阈值的学科 Agent，使用主模型安全降级。', fallbackReason: 'NO_CAPABLE_AGENT' };
      })
      : [...plan.steps, ...agentSteps];
    const runtimePlan = { ...plan, steps: runtimeSteps, agents: publicAgents, agentExecutionMode, agentSteps };
    emit('plan.created', runtimePlan);
    emit('module.completed', { module: 'planning', stepCount: runtimeSteps.length });
    await traceRepository.updatePlan(trace.id, { plan: runtimePlan }).catch(() => null);

    if (plan.intent.search.enabled) {
      emit('search.started', { decision: plan.intent.search, requested: plan.searchOptions });
      const searchClient = input.searchClient || new DashScopeSearchClient();
      let searchContent = ''; let reasoning = ''; let completed = null;
      for await (const event of searchClient.stream({ messages: searchMessages(input.messages), searchOptions: plan.searchOptions, capabilities, signal: input.signal, maxTokens: input.maxTokens })) {
        if (event.type === 'sources') {
          sources = event.sources || [];
          emit('search.sources', { sources, requestId: event.requestId });
          await Promise.all(sources.map(source => traceRepository.addRetrieval(trace.id, null, source).catch(() => null)));
        } else if (event.type === 'reasoning') {
          reasoning += event.content; emit('reasoning.delta', { content: event.content });
        } else if (event.type === 'delta') {
          searchContent += event.content;
          if (!plan.intent.complex && !selectedAgents.length) { emit('answer.delta', { content: event.content }); input.onDelta?.(event.content); }
        } else if (event.type === 'usage') emit('usage.updated', event.usage);
        else if (event.type === 'completed') completed = event;
      }
      searchResult = { content: searchContent, reasoning, sources, ...(completed || {}) };
      emit('search.completed', { searchOccurred: searchResult.searchOccurred, requestId: searchResult.requestId, sourceCount: sources.length, omitted: searchResult.omitted || [] });
      if (!plan.intent.complex && !selectedAgents.length) result = { content: searchContent, usage: searchResult.usage, calls: [] };
    }

    const registry = input.registry || buildRegistry({ searchClient: input.searchClient });
    const toolContext = {
      user, role: user.role, signal: input.signal, traceId: trace.id,
      conversationId: input.conversationId, messageId: input.messageId,
      courseId: input.courseId, teachingClassId: input.teachingClassId, subjectCode: input.subjectCode,
      assistantMode: input.assistantMode || 'general', confirmed: input.confirmed === true, capabilities, userContext,
      requestId: input.requestId || null,
    };
    if (plan.intent.kind === INTENTS.FILE) {
      emit('tool.started', { tool: 'create_file_confirmation', riskLevel: 'high' });
      const confirmation = await pendingActions.createFileConfirmation({
        user, userContext, query, aiConversationId: input.conversationId,
        sourceRunId: input.sourceRunId, sourceMessageId: input.messageId,
        fileIntent: plan.intent.file, knowledgeBaseRefs: input.knowledgeBaseIds || [], attachments: input.attachments || [],
      });
      let content;
      if (confirmation.needsInput) {
        content = `我会使用当前登录身份准备文件，不需要学号。生成前还需要确认：\n\n${(confirmation.questions || []).map(item => `- ${item.question}`).join('\n')}`;
      } else {
        const summary = confirmation.pendingAction.summary;
        content = `已匹配系统文件生成助手，并建立可恢复的生成确认。\n\n- 文件：${summary.title}\n- 课程：${summary.courseName || '当前课程'}\n- 范围：${summary.knowledgePointNames?.join('、') || '课程范围'}\n- 题量：${summary.questionCount || '按讲义结构'}\n- 格式：${(summary.outputFormats || []).join('、')}\n\n确认前不会生成文件；你可以生成、预览、修改要求或取消。`;
      }
      emit('tool.completed', { tool: 'create_file_confirmation', pendingActionId: confirmation.pendingAction?.id || null, needsInput: Boolean(confirmation.needsInput) });
      emit('answer.delta', { content }); input.onDelta?.(content);
      result = { content, calls: [], confirmationRequired: !confirmation.needsInput, confirmationSkills: ['file_generation'], pendingAction: confirmation.pendingAction || null };
    } else if ((plan.intent.tools || []).length) {
      const calls = [];
      const results = [];
      for (const toolName of plan.intent.tools) {
        const args = toolArgumentsForIntent(query, toolName);
        const call = { id: randomUUID(), function: { name: toolName, arguments: JSON.stringify(args) } };
        let preflight;
        try { preflight = registry.preflight(toolName, args, toolContext); }
        catch (error) {
          emit('tool.validation_failed', { toolName, code: error.publicCode || 'AI_TOOL_VALIDATION_FAILED', message: error.message, details: error.details || null });
          throw error;
        }
        emit('tool.started', { tool: toolName, ownerBound: true, preflight: { repaired: preflight.repaired, repairs: preflight.repairs } });
        const executed = await executeTool(registry, call, toolContext, { preflight, seen: new Set() });
        const toolResult = executed.result;
        calls.push({ name: toolName, result: toolResult, audit: executed.audit });
        results.push({ toolName, result: toolResult });
        emit('tool.completed', { tool: toolName, ownerBound: true, noData: Boolean(toolResult.no_data || toolResult.noData), latencyMs: executed.audit.latency_ms });
      }
      const primary = results[0];
      let chartFailure = null;
      if (primary?.result?.chartSpec && shouldCreateChart(query, plan.intent)) {
        const chartArgs = { spec: primary.result.chartSpec };
        const chartCall = { id: randomUUID(), function: { name: 'create_chart_artifact', arguments: JSON.stringify(chartArgs) } };
        try {
          const chartPreflight = registry.preflight('create_chart_artifact', chartArgs, toolContext);
          emit('tool.started', { tool: 'create_chart_artifact', schemaVersion: '1.0', preflight: { repaired: chartPreflight.repaired, repairs: chartPreflight.repairs } });
          const executed = await executeTool(registry, chartCall, toolContext, { preflight: chartPreflight, seen: new Set() });
          calls.push({ name: 'create_chart_artifact', result: executed.result, audit: executed.audit });
          emit('tool.completed', { tool: 'create_chart_artifact', artifactId: executed.result.id });
        } catch (error) {
          chartFailure = error;
          emit('tool.validation_failed', { toolName: 'create_chart_artifact', code: error.publicCode || error.code || 'AI_CHART_CREATION_FAILED', message: error.message, details: error.details || null, fallback: 'table_and_text' });
        }
      }
      let content = primary ? formatLearningResult(primary.toolName, primary.result, userContext) : '没有可执行的学习数据工具。';
      if (primary?.result?.chartSpec?.insights?.length) content += `\n\n图表洞察：\n${primary.result.chartSpec.insights.map(item => `- ${item}`).join('\n')}`;
      if (chartFailure) content += `\n\n${chartFallbackText(primary?.result?.chartSpec, chartFailure)}`;
      emit('answer.delta', { content }); input.onDelta?.(content);
      result = { content, calls, learningData: results.map(item => ({ tool: item.toolName, result: item.result })), chartFallback: chartFailure ? { retryable: true, error: chartFailure.details || { message: chartFailure.message } } : null };
    }
    const agentFailures = [];
    const executeSelectedAgent = async (selected, index, agentQuery) => {
      const publicAgent = agentRegistry.publicAgent(selected);
      emit('agent.started', { ...publicAgent, executionMode: agentExecutionMode, order: index + 1, dependsOn: agentSteps[index]?.dependsOn || [] });
      try {
        if (input.knowledgeBaseIds?.length) emit('knowledge.started', { agentId: selected.agent.id, knowledgeBaseIds: input.knowledgeBaseIds });
        const call = { id: randomUUID(), function: { name: 'execute_agent', arguments: JSON.stringify({ agentId: selected.agent.id, query: agentQuery, knowledgeBaseIds: input.knowledgeBaseIds || [] }) } };
        const executed = await executeTool(registry, call, toolContext, { seen: new Set() });
        const agentSources = Array.isArray(executed.result?.sources) ? executed.result.sources : [];
        for (const source of agentSources) {
          const key = `${source.knowledgeBaseId || ''}:${source.documentId || source.title || ''}:${source.segmentId || source.snippet || ''}`;
          const duplicate = sources.some(item => `${item.knowledgeBaseId || ''}:${item.documentId || item.title || ''}:${item.segmentId || item.snippet || ''}` === key);
          if (duplicate) continue;
          const persisted = { ...source, index: sources.length + 1 };
          sources.push(persisted);
          await traceRepository.addRetrieval(trace.id, null, persisted).catch(() => null);
        }
        const sourceCount = agentSources.length;
        if (input.knowledgeBaseIds?.length) {
          if (sourceCount) emit('knowledge.hits', { agentId: selected.agent.id, sourceCount });
          emit('knowledge.completed', { agentId: selected.agent.id, sourceCount });
        }
        if (executed.result?.content) emit('agent.first_delta', { ...publicAgent, order: index + 1 });
        emit('agent.completed', { ...publicAgent, status: 'success', executionMode: agentExecutionMode, order: index + 1, contentLength: String(executed.result?.content || '').length });
        return executed.result;
      } catch (error) {
        const failure = { ...publicAgent, status: 'failed', executionMode: agentExecutionMode, order: index + 1, code: error.publicCode || error.code || 'AI_TASK_FAILED' };
        agentFailures.push(failure);
        emit('agent.failed', failure);
        emit('agent.completed', failure);
        return null;
      }
    };
    if (agentExecutionMode === 'parallel') {
      const outcomes = await Promise.all(selectedAgents.map((selected, index) => executeSelectedAgent(selected, index, query)));
      agentResults.push(...outcomes.filter(Boolean));
    } else {
      for (let index = 0; index < selectedAgents.length; index += 1) {
        const value = await executeSelectedAgent(selectedAgents[index], index, serialAgentQuery(query, agentResults));
        if (value) agentResults.push(value);
      }
    }
    if (selectedAgents.length && !agentResults.length) throw Object.assign(new Error('所选 Agent 均执行失败。'), { publicCode: 'AI_TASK_FAILED', expose: true });

    if (!result) {
      if (plan.intent.kind === INTENTS.ATTACHMENT && plan.intent.attachmentRequired) {
        const content = '当前消息没有可处理的上传文件。请先添加 PDF、文档或图片，再让我总结；我不会假装读取不存在的附件。';
        emit('answer.delta', { content }); input.onDelta?.(content);
        result = { content, calls: [], missingContext: ['attachments'] };
      }
    }
    if (!result) {
      const confirmationSkills = plan.skills.filter(skill => skill.riskLevel === 'high');
      if (confirmationSkills.length && input.confirmed !== true) {
        const names = confirmationSkills.map(skill => skill.name).join('、');
        const content = `已完成任务分析。${names}会创建可下载成果，需要你确认后执行。请点击“确认生成”继续；确认前不会写入成果文件。`;
        emit('answer.delta', { content }); input.onDelta?.(content);
        result = { content, calls: [], confirmationRequired: true, confirmationSkills: confirmationSkills.map(skill => skill.id) };
      } else {
        const additions = [];
        if (searchResult) additions.push(sourceContext(searchResult));
        const knowledgeSources = sources.filter(item => String(item.sourceType || '').toLowerCase().includes('knowledge'));
        if (knowledgeSources.length) additions.push(`<knowledge_sources>\n${knowledgeSources.map(item => `[ref_${item.index}] ${item.knowledgeBaseName || item.siteName || '课程知识库'} / ${item.title}\n${item.snippet || ''}`).join('\n\n')}\n</knowledge_sources>`);
        if (agentResults.length) additions.push(`<agent_collaboration>\n${agentResults.map(item => `[${item.agentName}]\n${item.content}`).join('\n\n')}\n</agent_collaboration>`);
        const messages = [...(input.messages || [])];
        if (additions.length) messages.splice(Math.max(1, messages.length - 1), 0, { role: 'system', content: `以下是已通过权限校验并实际执行的工具结果。只能据实使用，不得编造：\n${additions.join('\n\n')}` });
        const constrainedDirect = plan.intent.deterministic && [INTENTS.GREETING, INTENTS.CHAT_QUESTIONS, INTENTS.ATTACHMENT, INTENTS.CONCEPT, INTENTS.KNOWLEDGE, INTENTS.MANUAL_AGENT].includes(plan.intent.kind);
        if (!constrainedDirect && (plan.intent.complex || plan.skills.length || selectedAgents.length)) {
          const executor = new FunctionCallExecutor(registry, { clientFactory: input.clientFactory });
          result = await executor.run({ messages, context: toolContext, maxTokens: input.maxTokens, onEvent: emit });
          if (result.content) { emit('answer.delta', { content: result.content }); input.onDelta?.(result.content); }
        } else result = await streamPlainCompletion(messages, input, emit);
      }
    }
    const normalized = normalizeCitations(result.content, sources);
    emit('module.started', { module: 'finalizing' });
    sources = normalized.sources.map(source => ({ ...source, cited: normalized.citations.includes(source.index) }));
    emit('citations.updated', { citations: normalized.citations, missing: normalized.missing, sources });
    const artifacts = (result.calls || []).map(call => call.result).filter(value => value?.artifactType);
    artifacts.forEach(artifact => emit('artifact.completed', artifact));
    emit('module.completed', { module: 'finalizing', sourceCount: sources.length, artifactCount: artifacts.length });
    emit('run.completed', {
      traceId: trace.trace_id, content: normalized.text, sources, artifacts,
      agents: publicAgents, calls: (result.calls || []).map(call => ({ name: call.name, latencyMs: call.audit?.latency_ms })),
      agentExecutionMode, agentFailures,
      confirmationRequired: Boolean(result.confirmationRequired), latencyMs: Date.now() - startedAt,
      pendingAction: result.pendingAction || null,
    });
    // run.completed is the final protocol event by contract; no further event may be emitted.
    await traceRepository.completeTrace(trace.id, {
      status: 'success', output: { content: normalized.text, sourceCount: sources.length, artifactIds: artifacts.map(item => item.id) },
      retrieval_hit: sources.length > 0, retry_count: (result.calls || []).reduce((sum, call) => sum + (call.audit?.retry_count || 0), 0),
      risk_flag: Boolean(result.confirmationRequired || artifacts.length), latency_ms: Date.now() - startedAt,
      prompt_tokens: result.usage?.prompt_tokens || result.usage?.input_tokens,
      completion_tokens: result.usage?.completion_tokens || result.usage?.output_tokens,
      total_tokens: result.usage?.total_tokens,
    }).catch(() => null);
    return { ...result, content: normalized.text, sources, artifacts, agents: publicAgents, agentExecutionMode, agentFailures, traceId: trace.trace_id, traceDatabaseId: trace.id, userContext: userContextService.publicUserContext(userContext) };
  } catch (error) {
    if (!factory.terminalType) emit('run.failed', { traceId: trace.trace_id, code: error.publicCode || 'AI_TASK_FAILED', message: error.expose ? error.message : 'AI 任务执行失败' });
    await traceRepository.completeTrace(trace.id, { status: 'failed', output: null, retrieval_hit: sources.length > 0, risk_flag: false, latency_ms: Date.now() - startedAt, error_type: error.publicCode || error.name, error_message: error.message }).catch(() => null);
    throw error;
  }
}

module.exports = { run, textContent, searchMessages, sourceContext, formatLearningResult, toolArgumentsForIntent, chartFallbackText, resolveAgentExecutionMode, buildAgentSteps, serialAgentQuery, streamPlainCompletion };
