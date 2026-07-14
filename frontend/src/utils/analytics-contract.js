export function normalizeWeakKnowledgePoint(record = {}) {
  const rawMastery = record.mastery ?? record.average_mastery ?? record.average_score ?? record.mastery_score
  const rawCount = record.studentCount ?? record.student_count
  const mastery = Number(rawMastery)
  return {
    knowledgePointId: Number(record.knowledgePointId ?? record.knowledge_point_id) || null,
    name: String(record.name ?? record.knowledge_point_name ?? '未命名知识点'),
    mastery: Number.isFinite(mastery) ? Math.max(0, Math.min(100, mastery)) : 0,
    studentCount: Number.isFinite(Number(rawCount)) ? Math.max(0, Number(rawCount)) : 0,
    source: record.source || { type: 'unknown' },
  }
}

export function normalizeWeakKnowledgePoints(records) {
  return (Array.isArray(records) ? records : []).map(normalizeWeakKnowledgePoint)
}

export function percent(value, digits = 1) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0%'
  return `${Number(number.toFixed(digits))}%`
}

export function normalizeKeyword(record = {}) {
  const value = Number(record.value ?? record.score ?? record.count)
  return {
    text: String(record.text ?? record.keyword ?? ''),
    value: Number.isFinite(value) ? Math.max(0, value) : 0,
    knowledgePointId: Number(record.knowledgePointId ?? record.knowledge_point_id) || null,
    studentCount: Number(record.studentCount ?? record.student_count) || 0,
    questionCount: Number(record.questionCount ?? record.question_count ?? record.count) || 0,
    source: record.source || { type: 'unknown' },
  }
}

export function normalizeKeywords(records) { return (Array.isArray(records) ? records : []).map(normalizeKeyword).filter(item=>item.text) }
