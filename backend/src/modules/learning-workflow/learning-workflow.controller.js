// 学习流系统控制器
const templateService = require('./workflow-template.service');
const runtimeService = require('./workflow-runtime.service');
const generationService = require('./workflow-generation.service');
const { createAgentError } = require('../agent/common/agent.errors');
const { normalizeWorkflowNodeType } = require('./workflow-node-type');

function getUserId(req) {
  return req.user?.user_id;
}

function getRole(req) {
  return req.user?.role;
}

function sendError(res, err) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const rawMessage = err.message || '服务器内部错误';
  const isPrismaInternal = /Invalid `prisma\.|PrismaClient|Expected WorkflowNodeType/i.test(rawMessage);
  const message = isPrismaInternal ? '学习节点初始化失败，请重新尝试' : rawMessage;
  const safeCode = isPrismaInternal ? 'NODE_RUN_INITIALIZATION_FAILED' : code;
  console.error(`[learning-workflow] ${safeCode}:`, rawMessage);
  if (res.headersSent) return;
  res.status(isPrismaInternal ? 500 : status).json({
    code: safeCode,
    message,
    data: err.data || null,
  });
}

function sendSuccess(res, data, message = 'ok') {
  res.json({ code: 0, message, data });
}

// ========================
// 模板 CRUD
// ========================

async function listTemplates(req, res) {
  try {
    const userId = getUserId(req);
    const { courseId, source, sourceType, search, page, pageSize } = req.query;
    const templates = await templateService.listTemplates({
      userId, courseId, source: source || sourceType, search, page, pageSize,
    });
    sendSuccess(res, templates);
  } catch (err) { sendError(res, err); }
}

async function getTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const template = await templateService.getTemplate(req.params.id, userId);
    sendSuccess(res, template);
  } catch (err) { sendError(res, err); }
}

async function createTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const template = await templateService.createTemplate(req.body, userId);
    sendSuccess(res, template, '模板创建成功');
  } catch (err) { sendError(res, err); }
}

async function updateTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const template = await templateService.updateTemplate(req.params.id, req.body, userId);
    sendSuccess(res, template, '模板更新成功');
  } catch (err) { sendError(res, err); }
}

async function deleteTemplate(req, res) {
  try {
    const result = await templateService.deleteTemplates([req.params.id], getUserId(req));
    sendSuccess(res, result, '学习流已删除');
  } catch (err) { sendError(res, err); }
}

async function batchDeleteTemplates(req, res) {
  try {
    const result = await templateService.deleteTemplates(req.body?.templateIds, getUserId(req));
    sendSuccess(res, result, '学习流已批量删除');
  } catch (err) { sendError(res, err); }
}

async function copyTemplate(req, res) {
  try {
    const template = await templateService.copyTemplate(req.params.id, getUserId(req));
    sendSuccess(res, template, '学习流已复制');
  } catch (err) { sendError(res, err); }
}

async function listVersions(req, res) {
  try {
    const versions = await templateService.listVersions(req.params.id, getUserId(req));
    sendSuccess(res, versions);
  } catch (err) { sendError(res, err); }
}

async function restoreVersion(req, res) {
  try {
    const userId = getUserId(req);
    const template = await templateService.restoreVersion(req.params.id, req.body.versionId, userId);
    sendSuccess(res, template, '版本恢复成功');
  } catch (err) { sendError(res, err); }
}

async function publishTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const template = await templateService.publishTemplate(req.params.id, userId);
    sendSuccess(res, template, '模板已发布');
  } catch (err) { sendError(res, err); }
}

async function setDefaultTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const template = await templateService.setDefaultTemplate(req.params.id, userId);
    sendSuccess(res, template, '已设为课程默认模板');
  } catch (err) { sendError(res, err); }
}

// ========================
// AI 生成
// ========================

async function generateDraft(req, res) {
  try {
    const userId = getUserId(req);
    const { inputText, courseId, knowledgePointId } = req.body;
    const result = await generationService.createAiGeneration(inputText, userId, courseId, knowledgePointId);
    sendSuccess(res, result, '草稿已生成');
  } catch (err) { sendError(res, err); }
}

async function getGenerationStatus(req, res) {
  try {
    const userId = getUserId(req);
    const result = await generationService.getGenerationStatus(req.params.jobId, userId);
    sendSuccess(res, result);
  } catch (err) { sendError(res, err); }
}

// ========================
// 会话管理
// ========================

async function createSession(req, res) {
  try {
    const userId = getUserId(req);
    const session = await runtimeService.createSession({ userId, ...req.body });
    sendSuccess(res, session, '学习会话已创建');
  } catch (err) { sendError(res, err); }
}

async function getSession(req, res) {
  try {
    const userId = getUserId(req);
    const session = await runtimeService.getSession(req.params.id, userId);
    sendSuccess(res, session);
  } catch (err) { sendError(res, err); }
}

async function startSession(req, res) {
  try {
    const userId = getUserId(req);
    const session = await runtimeService.startSession(req.params.id, userId);
    sendSuccess(res, session, '学习会话已启动');
  } catch (err) { sendError(res, err); }
}

async function pauseSession(req, res) {
  try {
    const userId = getUserId(req);
    const session = await runtimeService.pauseSession(req.params.id, userId);
    sendSuccess(res, session, '学习会话已暂停');
  } catch (err) { sendError(res, err); }
}

// ========================
// 节点操作
// ========================

async function executeCurrentNode(req, res) {
  try {
    const userId = getUserId(req);
    const result = await runtimeService.executeCurrentNode(req.params.id, userId, req, res);
    // executeCurrentNode 可能直接通过 SSE 响应，也可能返回 JSON
    if (result && !res.headersSent) {
      sendSuccess(res, result);
    }
  } catch (err) {
    if (!res.headersSent) sendError(res, err);
  }
}

async function submitNodeAnswer(req, res) {
  try {
    const userId = getUserId(req);
    const result = await runtimeService.submitNodeAnswer(req.params.id, userId, req.body);
    sendSuccess(res, result);
  } catch (err) { sendError(res, err); }
}

async function skipNode(req, res) {
  try {
    const userId = getUserId(req);
    const { nodeId, reason, expectedNodeExecutionId, operationId } = req.body;
    const result = await runtimeService.skipNode(req.params.id, userId, nodeId, reason, {
      expectedNodeExecutionId,
      operationId,
    });
    sendSuccess(res, result, '节点已跳过');
  } catch (err) { sendError(res, err); }
}

async function insertNode(req, res) {
  try {
    const userId = getUserId(req);
    const { nodeData, afterNodeId, reason } = req.body;
    const result = await runtimeService.insertNode(req.params.id, userId, nodeData, afterNodeId, reason);
    sendSuccess(res, result, '节点已插入');
  } catch (err) { sendError(res, err); }
}

async function applyAdjustment(req, res) {
  try {
    const userId = getUserId(req);
    const result = await runtimeService.handleDiagnosticianAdjustment(req.params.id, userId, 'apply');
    sendSuccess(res, result, '诊断师调整已应用');
  } catch (err) { sendError(res, err); }
}

async function rejectAdjustment(req, res) {
  try {
    const userId = getUserId(req);
    const result = await runtimeService.handleDiagnosticianAdjustment(req.params.id, userId, 'reject');
    sendSuccess(res, result, '已拒绝诊断师调整');
  } catch (err) { sendError(res, err); }
}

async function completeSession(req, res) {
  try {
    const userId = getUserId(req);
    const session = await runtimeService.completeSession(req.params.id, userId);
    sendSuccess(res, session, '学习会话已完成');
  } catch (err) { sendError(res, err); }
}

async function getSummary(req, res) {
  try {
    const userId = getUserId(req);
    const summary = await runtimeService.generateSummary(req.params.id, userId);
    sendSuccess(res, summary);
  } catch (err) { sendError(res, err); }
}

// ========================
// 全局学习助手
// ========================

// ========================
// 检查是否存在未完成会话（供向导使用）
// ========================

async function quickStartCheck(req, res) {
  try {
    const userId = getUserId(req);
    const { courseId, knowledgePointId, templateId } = req.body;

    if (!templateId || !courseId || !knowledgePointId) {
      sendSuccess(res, { existingSession: null });
      return;
    }

    const prisma = require('../../config/prisma');
    const existingSession = await prisma.learningSession.findFirst({
      where: {
        student_user_id: Number(userId),
        workflow_template_id: Number(templateId),
        course_id: Number(courseId),
        knowledge_point_id: Number(knowledgePointId),
        status: { in: ['CREATED', 'RUNNING', 'PAUSED'] },
      },
      orderBy: { updated_at: 'desc' },
      select: {
        session_id: true,
        status: true,
        current_node_id: true,
        updated_at: true,
      },
    });

    sendSuccess(res, {
      existingSession: existingSession ? {
        sessionId: existingSession.session_id,
        status: existingSession.status,
        currentNodeId: existingSession.current_node_id,
        updatedAt: existingSession.updated_at,
      } : null,
    });
  } catch (err) { sendError(res, err); }
}

// ========================
// 重试失败节点
// ========================

async function retryNode(req, res) {
  try {
    const userId = getUserId(req);
    const sessionId = req.params.id;
    const { nodeId } = req.body;

    const session = await runtimeService.getSession(sessionId, userId);

    if (session.status !== 'RUNNING') {
      throw createAgentError('INVALID_SESSION_STATUS', '只有运行中的会话可以重试节点', 400);
    }

    const failedRun = (session.node_runs || []).find(
      (r) => r.node_id === (nodeId || session.current_node_id) && r.status === 'FAILED'
    );

    if (!failedRun) {
      throw createAgentError('NO_FAILED_NODE', '没有可重试的失败节点', 400);
    }

    // Increment retry count
    const prisma = require('../../config/prisma');
    const retryCount = (failedRun.retry_count || 0) + 1;
    await prisma.learningSessionNodeRun.update({
      where: { node_run_id: failedRun.node_run_id },
      data: {
        status: 'RUNNING',
        error_code: null,
        error_message: null,
        retry_count: retryCount,
        started_at: new Date(),
        completed_at: null,
      },
    });

    // Reset current node to this failed node
    await prisma.learningSession.update({
      where: { session_id: Number(sessionId) },
      data: { current_node_id: failedRun.node_id },
    });

    await runtimeService.addSessionEvent(sessionId, 'NODE_RETRY', failedRun.node_id,
      `重试节点 (第 ${retryCount} 次)`);

    // Execute the node
    const result = await runtimeService.executeCurrentNode(sessionId, userId, req, res);
    if (result && !res.headersSent) {
      sendSuccess(res, result, '节点重试已启动');
    }
  } catch (err) {
    if (!res.headersSent) sendError(res, err);
  }
}

// ========================
// 获取节点运行状态
// ========================

async function getNodeStatus(req, res) {
  try {
    const userId = getUserId(req);
    const sessionId = req.params.id;
    const nodeId = req.params.nodeId;

    const session = await runtimeService.getSession(sessionId, userId);
    const nodeRun = (session.node_runs || []).find((r) => r.node_id === nodeId);

    if (!nodeRun) {
      sendSuccess(res, { status: 'WAITING', nodeId });
      return;
    }

    sendSuccess(res, {
      nodeRunId: nodeRun.node_run_id,
      nodeId: nodeRun.node_id,
      nodeType: nodeRun.node_type,
      status: nodeRun.status,
      agentType: nodeRun.agent_type,
      retryCount: nodeRun.retry_count || 0,
      startedAt: nodeRun.started_at,
      completedAt: nodeRun.completed_at,
      errorCode: nodeRun.error_code,
      errorMessage: nodeRun.error_message,
      outputSummary: nodeRun.output_summary_json,
      outputContent: nodeRun.output_content,
      skipReason: nodeRun.skip_reason,
    });
  } catch (err) { sendError(res, err); }
}

// ========================
// 学习引导老师 (DeepSeek SSE)
// ========================

async function streamLearningGuide(req, res) {
  try {
    const userId = getUserId(req);
    const sessionId = req.params.id;
    const { nodeId, phase, clientRequestId, expectedNodeExecutionId, requestVersion } = req.body;

    if (!nodeId || !phase) {
      throw createAgentError('INVALID_INPUT', '缺少 nodeId 或 phase 参数', 400);
    }

    // 校验权限并加载上下文
    const session = await runtimeService.getSession(sessionId, userId);
    const graph = session.runtime_graph_json || {};
    const nodes = graph.nodes || [];
    const node = nodes.find((n) => n.id === nodeId);
    const currentNodeIndex = nodes.findIndex((n) => n.id === nodeId) + 1;
    const totalNodeCount = nodes.length;

    // 计算下一节点
    let nextNodeName = '';
    if (currentNodeIndex < totalNodeCount) {
      const nextNode = nodes[currentNodeIndex];
      nextNodeName = nextNode?.title || nextNode?.type || '';
    }

    // 获取当前节点运行状态
    const nodeRun = session.currentNodeRun || (session.node_runs || []).find((r) => r.node_id === nodeId);
    if (String(session.current_node_id) !== String(nodeId)
      || !nodeRun
      || !['PENDING', 'RUNNING'].includes(nodeRun.status)
      || (expectedNodeExecutionId && Number(expectedNodeExecutionId) !== Number(nodeRun.node_run_id))) {
      throw createAgentError('STALE_NODE_EXECUTION', '学习节点已切换，引导请求已作废', 409);
    }
    const formalAgentStatus = nodeRun
      ? (nodeRun.status === 'COMPLETED' ? 'completed'
        : nodeRun.status === 'FAILED' ? 'failed'
        : nodeRun.status === 'RUNNING' ? 'running'
        : 'preparing')
      : 'preparing';

    const nodeTypeLabels = {
      concept_explanation: '概念讲解', analogy_explanation: '类比讲解',
      worked_example_analysis: '例题分析', socratic_questioning: '苏格拉底提问',
      basic_practice: '基础练习', adaptive_practice: '自适应练习',
      wrong_question_repair: '错题修复', mastery_gate: '掌握度判断',
      learning_summary: '学习总结',
    };

    let trainerContext = {};
    if (nodeRun.trainer_session_id) {
      const trainerService = require('../agent/trainer/trainer.service');
      const trainer = await trainerService.getTrainerSession(Number(userId), nodeRun.trainer_session_id).catch(() => null);
      if (trainer) {
        const lastCompleted = trainer.completedQuestions?.[trainer.completedQuestions.length - 1] || null;
        trainerContext = {
          trainerSessionId: nodeRun.trainer_session_id,
          currentQuestionId: trainer.currentQuestion?.questionKey || trainer.session?.currentQuestionKey || null,
          question: trainer.currentQuestion || req.body.context?.question || null,
          progress: {
            answeredCount: trainer.progress?.completedCount || 0,
            correctCount: trainer.progress?.correctCount || 0,
            plannedQuestionCount: trainer.practiceConfig?.targetQuestionCount || trainer.progress?.totalCount || 0,
            minQuestionCount: trainer.practiceConfig?.minQuestionCount || null,
            maxQuestionCount: trainer.practiceConfig?.maxQuestionCount || null,
            currentMastery: trainer.currentMastery ?? session.mastery_current ?? null,
            targetMastery: trainer.practiceConfig?.targetMastery || null,
          },
          studentAnswer: lastCompleted?.answerResult?.selectedOption || req.body.context?.studentAnswer || null,
          correctAnswer: lastCompleted?.answerResult?.correctOption || req.body.context?.correctAnswer || null,
          isCorrect: lastCompleted?.answerResult?.isCorrect ?? req.body.context?.isCorrect,
          errorType: lastCompleted?.evaluation?.error_type || req.body.context?.errorType || null,
          recentQuestions: (trainer.completedQuestions || []).slice(-3).map((item) => ({
            questionKey: item.question?.questionKey,
            isCorrect: item.answerResult?.isCorrect,
          })),
        };
      }
    }

    const context = {
      phase,
      courseName: session.course?.course_name || '',
      chapterName: session.knowledge_point?.chapter?.chapter_name || '',
      knowledgePointName: session.knowledge_point?.knowledge_point_name || '',
      currentMastery: session.mastery_current,
      flowName: session.workflow_template?.title || '',
      currentNodeName: node?.title || nodeTypeLabels[node?.type] || node?.type || '当前节点',
      currentNodeType: nodeTypeLabels[node?.type] || node?.type || '',
      currentNodeIndex: currentNodeIndex || 1,
      totalNodeCount,
      estimatedMinutes: node?.config?.minutes || 5,
      nextNodeName,
      formalAgentName: node ? getAgentLabel(node.type) : '教学Agent',
      formalAgentStatus,
      // 客户端上下文只用于补全展示，题目、答案和进度以 Trainer 持久化状态为准。
      ...(req.body.context || {}),
      ...trainerContext,
      nodeExecutionId: nodeRun.node_run_id,
      requestVersion: requestVersion || null,
    };

    const guideService = require('./learning-guide.service');
    const result = await guideService.streamGuideBlocks({
      req, res, sessionId, nodeId, phase, context,
    });

    // 如果成功返回了引导结果，持久化到 node_run
    const latestSession = await runtimeService.getSession(sessionId, userId);
    const latestRun = latestSession.currentNodeRun;
    const stillCurrent = String(latestSession.current_node_id) === String(nodeId)
      && latestRun
      && Number(latestRun.node_run_id) === Number(nodeRun.node_run_id)
      && latestRun.status === 'RUNNING';
    if (result && stillCurrent && result.blocks && result.blocks.length > 0) {
      try {
        const existingOutput = nodeRun.output_summary_json || {};
        const guideData = {
          ...existingOutput,
          guide: {
            agent: 'learning_guide',
            model: result.model || (process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro'),
             requestId: result.requestId,
             clientRequestId: clientRequestId || null,
             nodeExecutionId: nodeRun.node_run_id,
             requestVersion: requestVersion || null,
            phase: result.phase,
            blocks: result.blocks.map((b) => ({ index: b.index, text: b.text })),
            createdAt: new Date().toISOString(),
          },
        };

        await require('../../config/prisma').learningSessionNodeRun.update({
          where: { node_run_id: nodeRun.node_run_id },
          data: { output_summary_json: guideData },
        });
      } catch (persistErr) {
        console.error('[LearningGuide] persist error:', persistErr.message);
      }
    }
  } catch (err) {
    if (!res.headersSent) sendError(res, err);
  }
}

function toPrismaNodeType(graphType, context = {}) {
  return normalizeWorkflowNodeType(graphType, context);
}

// Map Prisma LearningNodeRunStatus values
const RUN_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  INSERTED: 'INSERTED',
};

function getAgentLabel(nodeType) {
  const map = {
    concept_explanation: 'Explainer', analogy_explanation: 'Explainer',
    worked_example_analysis: 'Explainer', socratic_questioning: 'Explainer',
    basic_practice: 'Trainer', adaptive_practice: 'Trainer',
    wrong_question_repair: 'Diagnostician', mastery_gate: 'Diagnostician',
    learning_summary: 'Diagnostician',
  };
  return map[nodeType] || 'Agent';
}

async function assistantChat(req, res) {
  try {
    const userId = getUserId(req);
    const { message, sessionId } = req.body;

    const explainerService = require('../agent/explainer/explainer.service');

    // 获取会话上下文
    let contextNote = '';
    if (sessionId) {
      try {
        const session = await runtimeService.getSession(sessionId, userId);
        contextNote = `当前正在学习: ${session.knowledge_point?.knowledge_point_name || '未知知识点'}。`
          + `当前节点: ${session.current_node_id || '无'}。`
          + `掌握度: ${session.mastery_current != null ? Math.round(session.mastery_current) + '%' : '未知'}。`;
      } catch { /* 忽略 */ }
    }

    // 使用 Explainer 流式服务
    await explainerService.streamExplainerChat({
      req,
      res,
      userId: Number(userId),
      body: {
        knowledgePointId: req.body.knowledgePointId || null,
        message: `${contextNote}\n\n学生问题: ${message}`,
        strategyHint: 'auto',
        depth: 'moderate',
        newConversation: false,
        learningSessionId: sessionId ? String(sessionId) : null,
      },
    });
  } catch (err) {
    if (!res.headersSent) sendError(res, err);
  }
}

// ========================
// 快捷操作
// ========================

async function quickStart(req, res) {
  try {
    const userId = getUserId(req);
    const { courseId, knowledgePointId, templateId, templateKey } = req.body;

    // 从系统模板中选择
    let template;
    if (templateId) {
      template = await templateService.getTemplate(templateId, userId);
    }
    if (!template && templateKey) {
      template = await require('../../config/prisma').learningWorkflowTemplate.findFirst({
        where: { template_key: templateKey, source_type: 'SYSTEM', status: 'active' },
      });
    }

    if (!template) {
      // 默认使用标准学习流
      template = await require('../../config/prisma').learningWorkflowTemplate.findFirst({
        where: { template_key: 'sys_standard', source_type: 'SYSTEM', status: 'active' },
      });
    }

    if (!template) {
      throw createAgentError('TEMPLATE_NOT_FOUND', '系统模板未初始化', 500);
    }

    // 获取最新版本
    const version = await require('../../config/prisma').learningWorkflowVersion.findFirst({
      where: { template_id: template.template_id },
      orderBy: { version_number: 'desc' },
    });

    // 创建会话
    const session = await runtimeService.createSession({
      userId,
      courseId: Number(courseId),
      knowledgePointId: Number(knowledgePointId),
      templateId: template.template_id,
      versionId: version?.version_id,
    });

    sendSuccess(res, {
      session,
      template: {
        id: template.template_id,
        title: template.title,
        templateKey: template.template_key,
      },
    }, '学习会话已就绪');
  } catch (err) { sendError(res, err); }
}

// ========================
// 保存节点执行结果（前端 Dify 完成后调用）
// ========================

async function completeNodeResult(req, res) {
  try {
    const userId = getUserId(req);
    const sessionId = req.params.id;
    const { nodeId, result, guide, clientActionId, expectedNodeExecutionId } = req.body;

    if (!nodeId) {
      throw createAgentError('INVALID_INPUT', '缺少 nodeId 参数', 400);
    }

    const prisma = require('../../config/prisma');
    const session = await runtimeService.getSession(sessionId, userId);
    const graph = session.runtime_graph_json || {};
    const currentNodeId = String(session.current_node_id || '');
    const requestedNodeId = String(nodeId);

    console.log(`[Next][clientActionId=${clientActionId || 'unknown'}] controller_entered session=${sessionId} node=${requestedNodeId} current=${currentNodeId}`);

    // 流式 Agent 在跳过/切换后的迟到结果是正常作废，不允许重新创建或完成历史 nodeRun。
    if (currentNodeId !== requestedNodeId
      || (expectedNodeExecutionId && Number(expectedNodeExecutionId) !== Number(session.currentNodeExecutionId))) {
      return sendSuccess(res, {
        discarded: true,
        reason: 'stale_node_execution',
        session,
      }, '旧节点响应已忽略');
    }

    // ======== Idempotency by clientActionId (via raw query for MariaDB compat) ========
    if (clientActionId) {
      try {
        const existingEvents = await prisma.$queryRawUnsafe(
          `SELECT event_id FROM learning_session_event WHERE session_id = ? AND event_type = 'NODE_COMPLETED' AND node_id = ? AND JSON_EXTRACT(data_json, '$.clientActionId') = ? LIMIT 1`,
          Number(sessionId), requestedNodeId, clientActionId
        );
        if (existingEvents && existingEvents.length > 0) {
          console.log(`[Next][clientActionId=${clientActionId}] idempotent replay`);
          const updatedSession = await runtimeService.getSession(sessionId, userId);
          return sendSuccess(res, {
            completedNodeId: requestedNodeId,
            nextNodeId: String(updatedSession.current_node_id || ''),
            isFlowCompleted: updatedSession.status === 'COMPLETED',
            idempotentReplay: true,
            reconciled: false,
            session: updatedSession,
          }, '节点已完成（幂等）');
        }
      } catch (idemErr) {
        // If JSON query fails, fall through to normal logic (non-fatal)
        console.warn(`[completeNodeResult] idempotency check failed, proceeding: ${idemErr.message}`);
      }
    }

    // ======== Find existing node runs ========
    const completedRun = (session.node_runs || []).find(
      (r) => String(r.node_id) === requestedNodeId && r.status === 'COMPLETED'
    );
    const runningRun = (session.node_runs || []).find(
      (r) => String(r.node_id) === requestedNodeId && r.status === 'RUNNING'
    );
    const skippedRun = (session.node_runs || []).find(
      (r) => String(r.node_id) === requestedNodeId && r.status === 'SKIPPED'
    );
    if (skippedRun) {
      return sendSuccess(res, { discarded: true, reason: 'node_skipped', session }, '已跳过的节点不会再写入结果');
    }

    // ======== Case C: Already completed and advanced ========
    if (completedRun && currentNodeId !== requestedNodeId) {
      console.log(`[Next][clientActionId=${clientActionId}] case=C alreadyAdvanced completed=${requestedNodeId} current=${currentNodeId}`);
      const updatedSession = await runtimeService.getSession(sessionId, userId);
      return sendSuccess(res, {
        completedNodeId: requestedNodeId,
        nextNodeId: currentNodeId,
        isFlowCompleted: updatedSession.status === 'COMPLETED',
        idempotentReplay: true,
        reconciled: false,
        session: updatedSession,
      }, '节点已完成');
    }

    // ======== Case B: Completed but session stuck at same node ========
    // (historical inconsistency — need to reconcile)
    if (completedRun && currentNodeId === requestedNodeId) {
      console.log(`[Next][clientActionId=${clientActionId}] case=B reconciled stuckAt=${requestedNodeId}`);
      // Advance to next node without creating new node run
      const advResult = await runtimeService.advanceToNextNode(sessionId, userId);
      const updatedSession = await runtimeService.getSession(sessionId, userId);
      return sendSuccess(res, {
        completedNodeId: requestedNodeId,
        nextNodeId: advResult.nextNodeId || String(updatedSession.current_node_id || ''),
        isFlowCompleted: !!advResult.sessionCompleted,
        idempotentReplay: false,
        reconciled: true,
        session: updatedSession,
      }, '节点已协调推进');
    }

    // ======== Case A: Running node with result (normal path) ========
    let nodeRun = runningRun;

    // If no RUNNING run, check if there's any run at all
    if (!nodeRun) {
      const node = (graph.nodes || []).find((n) => String(n.id) === requestedNodeId);
      if (!node) {
        // Case E: Node not in graph
        return sendSuccess(res, {
          success: false,
          code: 'NODE_NOT_IN_GRAPH',
          message: `节点 ${requestedNodeId} 不在运行时图中`,
          details: { sessionId, requestedNodeId, graphNodeIds: (graph.nodes || []).map(n => n.id) },
        });
      }

      const existingRun = (session.node_runs || []).find(
        (r) => String(r.node_id) === requestedNodeId
      );

      const maxIndex = (session.node_runs || []).reduce(
        (max, r) => Math.max(max, r.sequence_index || 0), 0
      );

      if (existingRun && existingRun.status !== 'SKIPPED') {
        nodeRun = await prisma.learningSessionNodeRun.update({
          where: { node_run_id: existingRun.node_run_id },
          data: {
            status: RUN_STATUS.RUNNING,
            started_at: existingRun.started_at || new Date(),
            node_type: toPrismaNodeType(node.type, { nodeId: requestedNodeId, sessionId }),
            sequence_index: existingRun.sequence_index || maxIndex + 1,
          },
        });
      } else {
        nodeRun = await prisma.learningSessionNodeRun.create({
          data: {
            session_id: Number(sessionId),
            node_id: requestedNodeId,
            node_type: toPrismaNodeType(node.type, { nodeId: requestedNodeId, sessionId }),
            status: RUN_STATUS.RUNNING,
            sequence_index: maxIndex + 1,
            started_at: new Date(),
          },
        });
      }
    }

    console.log(`[Next][clientActionId=${clientActionId}] case=A before nodeRunId=${nodeRun.node_run_id} status=${nodeRun.status}`);

    // Build output, merging existing data
    const existingOutput = (nodeRun.output_summary_json && typeof nodeRun.output_summary_json === 'object')
      ? nodeRun.output_summary_json
      : {};
    const outputData = { ...existingOutput };
    if (result) {
      outputData.result = result;
    }
    if (guide && guide.blocks && guide.blocks.length > 0) {
      outputData.guide = guide;
    }

    // ======== Transaction: complete node + advance ========
    let nextNodeId;
    let isFlowCompleted = false;

    await prisma.$transaction(async (tx) => {
      const latest = await tx.learningSession.findUnique({
        where: { session_id: Number(sessionId) },
        select: { current_node_id: true, current_node_run_id: true },
      });
      if (String(latest?.current_node_id || '') !== requestedNodeId
        || (expectedNodeExecutionId && Number(latest?.current_node_run_id) !== Number(expectedNodeExecutionId))) {
        throw createAgentError('STALE_NODE_EXECUTION', '节点已切换，不能写入旧结果', 409);
      }
      // 1. Mark node as COMPLETED
      const marked = await tx.learningSessionNodeRun.updateMany({
        where: { node_run_id: nodeRun.node_run_id, status: { in: ['PENDING', 'RUNNING'] } },
        data: {
          status: 'COMPLETED',
          completed_at: new Date(),
          ended_at: new Date(),
          output_summary_json: outputData,
          output_content: typeof result === 'string' ? result : (result ? JSON.stringify(result) : ''),
          agent_type: nodeRun.agent_type || 'EXPLAINER',
        },
      });
      if (!marked.count) throw createAgentError('STALE_NODE_EXECUTION', '节点已结束，不能写入旧结果', 409);

      // 2. Record completion event
      await tx.learningSessionEvent.create({
        data: {
          session_id: Number(sessionId),
          event_type: 'NODE_COMPLETED',
          node_id: requestedNodeId,
          title: `节点完成: ${nodeRun.node_type || ''}`,
          data_json: clientActionId ? { clientActionId } : null,
        },
      });

      // 3. Calculate next node
      const outgoingEdges = (graph.edges || []).filter((e) => String(e.source) === requestedNodeId);
      console.log(`[Next][clientActionId=${clientActionId}] outgoingEdges=${outgoingEdges.map(e => `${e.source}->${e.target}`).join(',')}`);

      const { getNextNodeIds } = require('./workflow-schema');
      const evalContext = {
        mastery: session.mastery_current || 0,
        consecutiveWrong: session.consecutive_wrong || 0,
        accuracy: session.total_correct + session.total_wrong > 0
          ? Math.round((session.total_correct / (session.total_correct + session.total_wrong)) * 100) : 0,
      };
      const nextNodeIds = getNextNodeIds(graph, requestedNodeId, evalContext);

      console.log(`[Next][clientActionId=${clientActionId}] calculatedNextNodeId=${nextNodeIds[0] || 'none'}`);

      if (nextNodeIds.length === 0) {
        // Flow complete
        await tx.learningSession.update({
          where: { session_id: Number(sessionId) },
          data: {
            status: 'COMPLETED',
            completed_at: new Date(),
            current_node_id: null,
            current_node_run_id: null,
          },
        });
        isFlowCompleted = true;
        nextNodeId = null;
      } else {
        nextNodeId = String(nextNodeIds[0]);
        // Update current_node_id and progress
        const totalNodes = (graph.nodes || []).length;
        const completedCount = ((session.node_runs || []).filter(
          r => r.status === 'COMPLETED' || r.status === 'SKIPPED'
        ).length) + 1; // +1 for the node we just completed
        const progress = totalNodes > 0 ? Math.min(100, Math.round((completedCount / totalNodes) * 10000) / 100) : 0;

        const nextRun = await tx.learningSessionNodeRun.create({
          data: {
            session_id: Number(sessionId),
            node_id: nextNodeId,
            node_type: toPrismaNodeType(
              (graph.nodes || []).find((node) => String(node.id) === nextNodeId)?.type,
              { nodeId: nextNodeId, sessionId },
            ),
            status: 'PENDING',
            sequence_index: Math.max(0, ...(session.node_runs || []).map((run) => run.sequence_index || 0)) + 1,
            execution_version: 1,
          },
        });
        await tx.learningSession.update({
          where: { session_id: Number(sessionId) },
          data: {
            current_node_id: nextNodeId,
            current_node_run_id: nextRun.node_run_id,
            execution_version: { increment: 1 },
            updated_at: new Date(),
          },
        });

        console.log(`[Next][clientActionId=${clientActionId}] transaction_committed nextNodeId=${nextNodeId}`);
      }
    });

    // Re-fetch after transaction
    const updatedSession = await runtimeService.getSession(sessionId, userId);
    console.log(`[Next][clientActionId=${clientActionId}] after currentNodeId=${updatedSession.current_node_id || 'flow_completed'}`);

    sendSuccess(res, {
      completedNodeId: requestedNodeId,
      nextNodeId: nextNodeId || String(updatedSession.current_node_id || ''),
      isFlowCompleted: isFlowCompleted || updatedSession.status === 'COMPLETED',
      idempotentReplay: false,
      reconciled: false,
      session: updatedSession,
    }, isFlowCompleted ? '学习流已完成' : '节点已完成');
  } catch (err) {
    console.error(`[completeNodeResult] error:`, err.message);
    sendError(res, err);
  }
}

// ========================
// 一键开始推荐
// ========================

async function recommendTemplate(req, res) {
  try {
    const userId = getUserId(req);
    const { courseId, knowledgePointId } = req.query;

    if (!knowledgePointId) {
      throw createAgentError('INVALID_INPUT', '需要指定知识点', 400);
    }

    const prisma = require('../../config/prisma');

    // 获取学生掌握度
    const mastery = await prisma.studentMasteryRecord.findUnique({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: Number(userId),
          course_id: Number(courseId),
          knowledge_point_id: Number(knowledgePointId),
        },
      },
    });

    // 获取错题统计
    const wrongCount = await prisma.wrongQuestion.count({
      where: {
        student_user_id: Number(userId),
        course_id: Number(courseId),
        knowledge_point_id: Number(knowledgePointId),
        status: 'UNRESOLVED',
      },
    });

    // 获取最近练习记录
    const recentAnswers = await prisma.answerRecord.findMany({
      where: {
        student_user_id: Number(userId),
        question: {
          course_id: Number(courseId),
          knowledge_point_id: Number(knowledgePointId),
        },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { is_correct: true },
    });

    const masteryScore = mastery?.mastery_score;
    const correctCount = recentAnswers.filter((a) => a.is_correct === true).length;
    const totalCount = recentAnswers.length;

    let templateKey = 'sys_standard';
    let reason = '根据你的学习情况，推荐标准学习流。';

    if (masteryScore != null && masteryScore < 40 && wrongCount > 3) {
      templateKey = 'sys_weakness_repair';
      reason = '根据你当前的掌握度和近期错题，推荐先进行薄弱修复。';
    } else if (totalCount >= 3 && correctCount / totalCount >= 0.6) {
      templateKey = 'sys_practice_driven';
      reason = '你已具备一定基础，推荐练习驱动流来强化应用能力。';
    } else if (totalCount === 0 || masteryScore == null) {
      templateKey = 'sys_socratic_inquiry';
      reason = '首次学习该知识点，推荐苏格拉底探究流帮助你深度理解。';
    } else if (wrongCount > 5) {
      templateKey = 'sys_weakness_repair';
      reason = '检测到较多未解决错题，推荐薄弱修复流。';
    }

    // 查找模板
    const template = await prisma.learningWorkflowTemplate.findFirst({
      where: { template_key: templateKey, source_type: 'SYSTEM', status: 'active' },
    });

    sendSuccess(res, {
      templateKey,
      template: template ? { id: template.template_id, title: template.title, templateKey: template.template_key } : null,
      reason,
      masteryScore,
      wrongCount,
    });
  } catch (err) { sendError(res, err); }
}

// ========================
// 仅保存引导数据（不修改正式结果）
// ========================

async function saveGuideOnly(req, res) {
  try {
    const userId = getUserId(req);
    const sessionId = req.params.id;
    const { nodeId, guide } = req.body;

    if (!nodeId) {
      throw createAgentError('INVALID_INPUT', '缺少 nodeId 参数', 400);
    }

    const session = await runtimeService.getSession(sessionId, userId);
    const prisma = require('../../config/prisma');

    const nodeRun = (session.node_runs || []).find(
      (r) => String(r.node_id) === String(nodeId)
    );

    if (!nodeRun) {
      throw createAgentError('NODE_RUN_NOT_FOUND', '节点运行记录不存在', 404);
    }

    // Merge: preserve existing data, only update guide
    const existingOutput = (nodeRun.output_summary_json && typeof nodeRun.output_summary_json === 'object')
      ? nodeRun.output_summary_json
      : {};
    const merged = { ...existingOutput, guide };

    await prisma.learningSessionNodeRun.update({
      where: { node_run_id: nodeRun.node_run_id },
      data: { output_summary_json: merged },
    });

    sendSuccess(res, { nodeId, saved: true }, '引导数据已保存');
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  batchDeleteTemplates,
  copyTemplate,
  listVersions,
  restoreVersion,
  publishTemplate,
  setDefaultTemplate,
  generateDraft,
  getGenerationStatus,
  createSession,
  getSession,
  startSession,
  pauseSession,
  executeCurrentNode,
  submitNodeAnswer,
  skipNode,
  insertNode,
  applyAdjustment,
  rejectAdjustment,
  completeSession,
  getSummary,
  assistantChat,
  quickStart,
  quickStartCheck,
  retryNode,
  getNodeStatus,
  recommendTemplate,
  streamLearningGuide,
  completeNodeResult,
  saveGuideOnly,
};
