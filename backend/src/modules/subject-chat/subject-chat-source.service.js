const prisma = require('../../config/prisma');
const knowledgeProvider = require('../knowledge-base/knowledge-provider.service');

function pageNumber(metadata) {
  const value = metadata?.page_number ?? metadata?.page ?? null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function queryTerms(question, knowledgePointName) {
  const terms = [];
  if (knowledgePointName) terms.push(String(knowledgePointName).trim());
  String(question || '')
    .split(/[\s，。！？、；：,.!?;:()（）\[\]{}]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 40)
    .slice(0, 8)
    .forEach((item) => terms.push(item));
  return [...new Set(terms)].slice(0, 8);
}

async function retrieve({ userId, courseId, knowledgePointId, question }) {
  if (!courseId) return { sources: [], provider: 'none', degraded: false, message: '未识别到已选课程，跳过课程知识库检索' };
  const enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: { student_user_id: userId, course_id: courseId, enrollment_status: 'active' },
  });
  if (!enrollment) return { sources: [], provider: 'none', degraded: false, message: '当前课程选课记录无效，未检索课程知识库' };

  const knowledgeBases = await prisma.knowledgeBase.findMany({
    where: {
      deleted_at: null,
      status: 'active',
      OR: [
        { course_id: courseId },
        { teaching_class_id: enrollment.teaching_class_id },
      ],
    },
    include: { documents: { where: { deleted_at: null } } },
  });
  const usableKnowledgeBases = knowledgeBases.filter((item) => item.documents.some(
    (doc) => doc.parse_status === 'EMBEDDED' && doc.marketplace_status === 'READY',
  ));
  let degraded = false;

  if (usableKnowledgeBases.length) {
    try {
      const result = await knowledgeProvider.retrieveFromMultipleDatasets(
        usableKnowledgeBases.map((item) => item.knowledge_base_id),
        question,
        { topK: 4, scoreThreshold: 0.2, maxContextChars: 7000 },
      );
      const byDataset = new Map(usableKnowledgeBases.map((item) => [String(item.knowledge_base_id), item]));
      const sources = result.records.map((record) => {
        const kb = byDataset.get(record.datasetId);
        const document = kb?.documents.find((item) => String(item.document_id) === String(record.documentId) || item.original_filename === record.documentName);
        return {
          sourceType: 'COURSE_KNOWLEDGE',
          title: record.documentName || document?.title || document?.original_filename || kb?.name || '课程知识库资料',
          summary: String(record.content || '').slice(0, 1200),
          documentId: document?.document_id || record.documentId || null,
          datasetId: record.datasetId,
          relevanceScore: record.score,
          metadata: {
            provider: kb?.provider || knowledgeProvider.config().provider,
            knowledgeBaseId: kb?.knowledge_base_id || null,
            knowledgeBaseName: kb?.name || null,
            segmentId: record.segmentId || null,
            pageNumber: pageNumber(record.metadata),
          },
        };
      }).filter((item) => item.summary);
      if (sources.length) return { sources, provider: 'knowledge-provider', degraded: false, message: `从课程知识库检索到 ${sources.length} 条真实资料` };
    } catch (error) {
      degraded = true;
      console.warn('[subject-chat] 知识库向量检索降级:', error.message);
    }
  }

  const point = knowledgePointId ? await prisma.knowledgePoint.findUnique({ where: { knowledge_point_id: knowledgePointId } }) : null;
  const terms = queryTerms(question, point?.knowledge_point_name);
  if (!terms.length) return { sources: [], provider: 'local', degraded, message: '已完成知识库检索，未找到可展示的匹配资料' };
  const chunks = await prisma.knowledgeDocumentChunk.findMany({
    where: {
      OR: terms.map((term) => ({ chunk_text: { contains: term } })),
      document: {
        deleted_at: null,
        parse_status: { in: ['PARSED', 'CHUNKED', 'EMBEDDED'] },
        OR: [
          { course_id: courseId },
          { teaching_class_id: enrollment.teaching_class_id },
        ],
      },
    },
    include: { document: { include: { knowledge_base: true } } },
    take: 6,
    orderBy: { created_at: 'desc' },
  });
  const sources = chunks.map((chunk) => ({
    sourceType: 'COURSE_KNOWLEDGE',
    title: chunk.document.title || chunk.document.original_filename,
    summary: String(chunk.chunk_text || '').slice(0, 1200),
    documentId: chunk.document_id,
    datasetId: chunk.document.knowledge_base_id ? String(chunk.document.knowledge_base_id) : null,
    relevanceScore: null,
    metadata: {
      provider: 'local',
      knowledgeBaseId: chunk.document.knowledge_base_id,
      knowledgeBaseName: chunk.document.knowledge_base?.name || null,
      chunkId: chunk.chunk_id,
      pageNumber: chunk.page_number,
    },
  }));
  return {
    sources,
    provider: 'local',
    degraded,
    message: sources.length ? `从本地课程资料检索到 ${sources.length} 条真实片段` : '已完成知识库检索，未找到可展示的匹配资料',
  };
}

module.exports = { retrieve, queryTerms, pageNumber };
