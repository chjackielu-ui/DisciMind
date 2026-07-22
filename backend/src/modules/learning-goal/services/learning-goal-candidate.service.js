const prisma = require('../../../config/prisma');

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s·_\-/（）()，,。！？!?：:；;]/g, '');
}

function terms(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase();
  const latin = text.match(/[a-z][a-z0-9.+#-]{1,}/g) || [];
  const chinese = text.match(/[\u3400-\u9fff]{2,8}/g) || [];
  return [...new Set([...latin, ...chinese])];
}

function scoreKnowledgePoint(goalText, point, options = {}) {
  const goal = normalize(goalText);
  const name = normalize(point.knowledge_point_name);
  const aliases = (point.aliases || []).map((item) => normalize(item.alias_text));
  const chapter = normalize(point.chapter?.chapter_name);
  const parent = normalize(point.parent?.knowledge_point_name);
  const description = normalize(point.description);
  const selectedKnowledgePointId = Number(options.selectedKnowledgePointId) || null;
  let score = 0;
  const reasons = [];
  if (selectedKnowledgePointId && Number(point.knowledge_point_id) === selectedKnowledgePointId) { score += 120; reasons.push('selected'); }
  if (goal === name || aliases.includes(goal)) { score += 100; reasons.push('exact'); }
  if (name && goal.includes(name)) { score += 55; reasons.push('name'); }
  for (const alias of aliases) {
    if (alias && goal.includes(alias)) { score += 48; reasons.push('alias'); break; }
  }
  if (chapter && goal.includes(chapter)) { score += 20; reasons.push('chapter'); }
  if (parent && goal.includes(parent)) { score += 12; reasons.push('parent'); }
  const goalTerms = terms(goalText);
  const searchable = `${name} ${aliases.join(' ')} ${chapter} ${parent} ${description}`;
  const overlap = goalTerms.filter((term) => term.length >= 2 && searchable.includes(normalize(term))).length;
  if (overlap) { score += Math.min(30, overlap * 6); reasons.push('overlap'); }
  return { score, reasons };
}

async function buildCandidates({ courseId, goalText, selectedKnowledgePointId = null, limit = 10, db = prisma }) {
  const points = await db.knowledgePoint.findMany({
    where: { course_id: Number(courseId) },
    select: {
      knowledge_point_id: true, knowledge_point_name: true, knowledge_point_code: true,
      description: true, parent_id: true,
      aliases: { select: { alias_text: true } },
      chapter: { select: { chapter_id: true, chapter_name: true } },
      parent: { select: { knowledge_point_id: true, knowledge_point_name: true } },
    },
  });
  return points
    .map((point) => ({ point, ...scoreKnowledgePoint(goalText, point, { selectedKnowledgePointId }) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.point.knowledge_point_id - b.point.knowledge_point_id)
    .slice(0, Math.min(10, Math.max(1, limit)))
    .map((item, index) => ({
      candidateKey: `candidate_${index + 1}`,
      knowledgePointId: item.point.knowledge_point_id,
      name: item.point.knowledge_point_name,
      aliases: item.point.aliases.map((alias) => alias.alias_text).slice(0, 8),
      chapter: item.point.chapter?.chapter_name || null,
      chapterId: item.point.chapter?.chapter_id || null,
      parentKnowledgePointId: item.point.parent?.knowledge_point_id || null,
      parentName: item.point.parent?.knowledge_point_name || null,
      description: String(item.point.description || '').slice(0, 240),
      matchScore: item.score,
      matchReasons: item.reasons,
    }));
}

function publicCandidate(candidate) {
  return {
    candidateKey: candidate.candidateKey, name: candidate.name,
    aliases: candidate.aliases, chapter: candidate.chapter,
  };
}

module.exports = { buildCandidates, scoreKnowledgePoint, normalize, terms, publicCandidate };
