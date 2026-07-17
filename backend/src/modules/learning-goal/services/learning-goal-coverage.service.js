const { buildRetrievalRequest, resolveDatasets } = require('../../learning-agent/services/knowledge-router.service');
const { getLearningGoalConfig } = require('../constants/learning-goal.constants');
const { safeCoverageSources } = require('../schemas/learning-goal-response.schema');

function uniqueRecords(records) {
  const map = new Map();
  for (const record of records || []) {
    const key = record.segmentId || `${record.documentName}:${String(record.content || '').slice(0, 80)}`;
    const existing = map.get(key);
    if (!existing || Number(record.score || 0) > Number(existing.score || 0)) map.set(key, record);
  }
  return [...map.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function calculateCoverage({ queryResults, subGoalCount, hasExerciseDataset, thresholds = getLearningGoalConfig() }) {
  const availableResults = queryResults.filter((item) => item.available !== false && item.degraded !== true);
  if (!availableResults.length) return { status: 'unavailable', score: 0, coveredSubGoalCount: 0, totalSubGoalCount: subGoalCount };
  const main = queryResults.find((item) => item.kind === 'main');
  const subGoals = queryResults.filter((item) => item.kind === 'subGoal');
  const mainBest = Math.max(0, ...(main?.records || []).map((record) => Number(record.score || 0)));
  const coveredSubGoalCount = subGoals.filter((item) => (item.records || []).some((record) => Number(record.score || 0) >= 0.35)).length;
  const all = uniqueRecords(queryResults.flatMap((item) => item.records || []));
  const avg = all.length ? all.reduce((sum, record) => sum + Number(record.score || 0), 0) / all.length : 0;
  const documentCount = new Set(all.map((record) => record.documentName).filter(Boolean)).size;
  const subGoalRatio = subGoalCount ? coveredSubGoalCount / subGoalCount : 0;
  const score = Math.max(0, Math.min(1,
    (Math.min(1, mainBest) * 0.35)
    + (subGoalRatio * 0.40)
    + (Math.min(1, avg) * 0.15)
    + (Math.min(1, documentCount / 3) * 0.05)
    + (hasExerciseDataset ? 0.05 : 0),
  ));
  const rounded = Math.round(score * 1000) / 1000;
  const status = rounded >= thresholds.coverageSufficientThreshold ? 'sufficient'
    : rounded >= thresholds.coveragePartialThreshold ? 'partial' : 'insufficient';
  return { status, score: rounded, coveredSubGoalCount, totalSubGoalCount: subGoalCount };
}

async function checkCoverage({ courseId, knowledgePointId, knowledgePointName, normalizedTitle, focusQuestion, subGoals = [], prerequisites = [], retrieve = buildRetrievalRequest }) {
  const config = getLearningGoalConfig();
  const queryDefs = [
    { kind: 'main', query: [normalizedTitle, focusQuestion].filter(Boolean).join(' ') },
    ...subGoals.map((item) => ({ kind: 'subGoal', id: item.id, query: item.title })),
    ...prerequisites.filter((item) => item.required).map((item) => ({ kind: 'prerequisite', query: item.title })),
  ].filter((item) => item.query);
  const queryResults = await Promise.all(queryDefs.map(async (item) => {
    try {
      const result = await retrieve({
        courseId: Number(courseId), knowledgePointId: Number(knowledgePointId), nodeType: item.kind === 'subGoal' && /练习|计算|题/.test(item.query) ? 'basic_practice' : 'concept_explanation',
        intent: 'learning_goal_coverage', query: item.query, knowledgePointName, topK: 3,
      });
      return { ...item, ...result, records: uniqueRecords(result.records || []) };
    } catch (error) {
      return { ...item, records: [], available: false, degraded: true, degradationReason: error.code || 'retrieval_failed' };
    }
  }));
  const datasetPlan = resolveDatasets({ courseId: Number(courseId), knowledgePointId: Number(knowledgePointId), nodeType: 'learning_summary', intent: 'learning_goal_coverage' });
  const calculated = calculateCoverage({ queryResults, subGoalCount: subGoals.length, hasExerciseDataset: datasetPlan.datasets.some((item) => item.type === 'exercise'), thresholds: config });
  const allRecords = uniqueRecords(queryResults.flatMap((item) => item.records || []));
  const sources = safeCoverageSources(allRecords.map((record) => ({
    documentName: record.documentName, datasetLabel: '课程知识库', relevanceScore: record.score,
    summary: record.content ? String(record.content).replace(/\s+/g, ' ').slice(0, 100) : undefined,
  })));
  return {
    ...calculated, sources,
    retrievalDatasetCount: datasetPlan.datasets.length,
    retrievedChunkCount: allRecords.length,
    queryCoverage: queryResults.map((item) => ({ kind: item.kind, id: item.id || null, covered: (item.records || []).some((record) => Number(record.score || 0) >= 0.35), bestScore: Math.max(0, ...(item.records || []).map((record) => Number(record.score || 0))) })),
  };
}

module.exports = { checkCoverage, calculateCoverage, uniqueRecords };
