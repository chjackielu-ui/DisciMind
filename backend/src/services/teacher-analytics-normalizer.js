function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeWeakKnowledgePoint(record = {}, source = 'StudentMasteryRecord') {
  const mastery = finite(
    record.mastery
      ?? record.average_mastery
      ?? record.average_score
      ?? record.mastery_score,
  );
  return {
    knowledgePointId: Number(record.knowledgePointId ?? record.knowledge_point_id) || null,
    name: String(record.name ?? record.knowledge_point_name ?? '未命名知识点'),
    mastery: Math.max(0, Math.min(100, Math.round(mastery * 10) / 10)),
    studentCount: Math.max(0, Math.round(finite(record.studentCount ?? record.student_count))),
    source: typeof source === 'string' ? { type: source } : source,
  };
}

function normalizeWeakKnowledgePoints(records, source) {
  return (Array.isArray(records) ? records : [])
    .map((record) => normalizeWeakKnowledgePoint(record, source))
    .sort((left, right) => left.mastery - right.mastery);
}

module.exports = { normalizeWeakKnowledgePoint, normalizeWeakKnowledgePoints };
