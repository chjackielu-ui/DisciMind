const prisma = require('../../../config/prisma');
const tasks = require('../../async-task/async-task.service');
const generation = require('../file-generation.service');
const { WORD_MIME } = require('../document-export.service');
const { PDF_MIME } = require('../pdf-export.service');
const { planningPrompt } = require('./file-generator.prompts');

async function progress(taskId, value, stage) { if (taskId) await tasks.updateTask(taskId, { status: 'RUNNING', progress: value, stage }); }

async function resolveLearningContext(state) {
  const artifact = await prisma.generatedArtifact.findUnique({ where: { id: Number(state.artifactId) } });
  if (!artifact || artifact.deletedAt) throw Object.assign(new Error('Artifact 不存在'), { code: 'ARTIFACT_NOT_FOUND', permanent: true });
  const context = await prisma.studentLearningContext.findFirst({ where: { userId: artifact.ownerUserId, isActive: true } });
  await progress(state.taskId, 3, '正在解析学习上下文');
  return { artifact, userId: artifact.ownerUserId, agentId: artifact.agentId, conversationId: artifact.conversationId, artifactType: artifact.artifactType, learningContext: context?.contextSnapshotJson || null, stage: 'plan_artifact' };
}

async function planArtifact(state) {
  const requirements = state.artifact.requirementsJson || {};
  const requestedFormats = Array.isArray(requirements.outputFormats) && requirements.outputFormats.length ? [...new Set(requirements.outputFormats)] : ['DOCX'];
  planningPrompt({ artifactType: state.artifactType, requirements, learningContext: state.learningContext });
  await progress(state.taskId, 5, '正在规划文件任务');
  return { requirements, requestedFormats, stage: 'retrieve_knowledge' };
}

async function retrieveKnowledge(state) {
  await progress(state.taskId, 8, '正在匹配真实知识库');
  const retrieval = await generation.retrieveSafeContext(state.artifact);
  return { knowledgeSources: retrieval.records || [], stage: 'build_outline' };
}

async function buildOutline(state) {
  await progress(state.taskId, 10, '正在规划文件结构');
  const outline = state.artifactType === 'EXAM_PAPER'
    ? ['试卷说明', '题目区', '答案区', '解析区', '知识点覆盖']
    : ['学习目标', '前置知识', '章节内容', '概念解释', '例题', '常见错误', '练习', '总结'];
  return { outline, stage: 'generate_sections' };
}

async function generateSections(state, config = {}) {
  const generated = await generation.generateArtifact(state.artifactId, {
    taskId: state.taskId, queueDefaultExport: false, signal: config.signal,
  });
  return { generated, generatedSections: generated.contentSchemaJson?.sections || [], stage: 'validate_schema' };
}

async function validateSchema(state) {
  const artifact = await prisma.generatedArtifact.findUnique({ where: { id: Number(state.artifactId) } });
  if (!artifact?.contentSchemaJson) throw Object.assign(new Error('结构化内容校验失败'), { code: 'CONTENT_SCHEMA_INVALID', permanent: true });
  return { generated: artifact, validatedContent: artifact.contentSchemaJson, qualityIssues: [], stage: 'repair_content' };
}

async function repairContent(state) {
  // file-generation.service 已在一次模型调用后执行确定性修复和最多一次受控质量修复；此节点明确记录修复边界。
  return { validatedContent: state.validatedContent, stage: 'quality_check' };
}

async function qualityCheck(state) {
  const content = state.validatedContent || {};
  const issues = [];
  if (state.artifactType === 'STUDY_HANDOUT' && !(content.sections?.length || content.keyPoints?.length)) issues.push('讲义缺少正文结构');
  if (state.artifactType === 'EXAM_PAPER' && !(content.questions?.length || content.sections?.length)) issues.push('试卷缺少题目结构');
  if (issues.length) throw Object.assign(new Error(issues.join('；')), { code: 'CONTENT_QUALITY_FAILED', permanent: true });
  return { qualityIssues: [], stage: 'build_preview' };
}

async function buildPreview(state) {
  if (!state.generated?.previewHtml) throw Object.assign(new Error('安全预览未生成'), { code: 'PREVIEW_NOT_READY', permanent: true });
  return { previewHtml: state.generated.previewHtml, stage: 'persist_artifact' };
}

async function persistArtifact(state) {
  const artifact = await prisma.generatedArtifact.update({ where: { id: Number(state.artifactId) }, data: { errorCode: null } });
  const prefill = artifact.requirementsJson?.learningFlowPrefill;
  if (prefill?.learningPlanId) {
    await require('../../learning-flow-resource/learning-flow-resource.service').createLink(
      { user_id: artifact.ownerUserId }, artifact.id,
      {
        learningPlanId: prefill.learningPlanId, courseId: prefill.courseId, knowledgePointId: prefill.knowledgePointId,
        learningGoalId: prefill.learningGoalId, workflowTemplateId: prefill.workflowTemplateId,
        learningSessionId: prefill.learningSessionId, resourceRole: 'PRE_CLASS_HANDOUT',
      },
    );
  }
  return { stage: 'export_docx' };
}

async function queueFormat(state, format) {
  if (!state.requestedFormats.includes(format)) return { exportResults: state.exportResults };
  const root = state.generated; const mimeType = format === 'PDF' ? PDF_MIME : WORD_MIME;
  const variants = await prisma.generatedArtifact.findMany({ where: { parentArtifactId: root.id, deletedAt: null }, orderBy: { id: 'asc' } });
  const results = [...state.exportResults];
  for (const artifact of [root, ...variants]) {
    const record = await prisma.generatedArtifactExport.upsert({
      where: { artifactId_format: { artifactId: artifact.id, format } },
      create: { artifactId: artifact.id, ownerUserId: artifact.ownerUserId, format, status: 'QUEUED', mimeType },
      update: { status: 'QUEUED', errorCode: null, errorMessage: null, deletedAt: null },
    });
    const task = await tasks.createTask(artifact.ownerUserId, {
      operationId: `artifact-auto-export-${artifact.id}-${format.toLowerCase()}`,
      taskType: 'DOCUMENT_EXPORT', title: `导出 ${artifact.title}（${format}）`, description: `从同一份结构化内容生成 ${format}`,
      status: 'QUEUED', stage: `等待导出 ${format}`, progressMode: 'DETERMINATE', progress: 0,
      relatedResourceType: 'GENERATED_ARTIFACT', relatedResourceId: artifact.id,
      resultType: 'ARTIFACT', resultId: artifact.id, resultUrl: `#/student/artifacts/${artifact.id}?format=${format}`,
      cancellable: true, metadataJson: { artifactId: artifact.id, format },
      requestPayload: artifact.requirementsJson, agentId: artifact.agentId, conversationId: artifact.conversationId,
    });
    results.push({ artifactId: artifact.id, artifactRole: artifact.artifactRole, format, exportId: record.id, taskId: task.id, status: record.status });
  }
  return { exportResults: results };
}

async function exportDocx(state) { return { ...(await queueFormat(state, 'DOCX')), stage: 'export_pdf' }; }
async function exportPdf(state) { return { ...(await queueFormat(state, 'PDF')), stage: 'finalize' }; }
async function finalize(state) {
  if (state.taskId) await tasks.updateTask(state.taskId, { status: 'SUCCEEDED', progress: 100, stage: '内容生成完成，格式导出已排队', resultType: 'ARTIFACT', resultId: state.artifactId, resultUrl: `#/student/artifacts/${state.artifactId}` });
  return { stage: 'completed' };
}

module.exports = { resolveLearningContext, planArtifact, retrieveKnowledge, buildOutline, generateSections, validateSchema, repairContent, qualityCheck, buildPreview, persistArtifact, exportDocx, exportPdf, finalize };
