function safeCoverageSources(sources) {
  return (Array.isArray(sources) ? sources : []).slice(0, 12).map((source) => ({
    documentName: String(source.documentName || '课程资料').slice(0, 200),
    datasetLabel: String(source.datasetLabel || '课程知识库').slice(0, 80),
    relevanceScore: Math.max(0, Math.min(1, Number(source.relevanceScore) || 0)),
    ...(source.summary ? { summary: String(source.summary).replace(/\s+/g, ' ').slice(0, 120) } : {}),
  }));
}

module.exports = { safeCoverageSources };
