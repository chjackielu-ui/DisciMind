function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function safeUrl(value) {
  const text = String(value || '').trim();
  return /^https?:\/\//i.test(text) ? text.slice(0, 2000) : null;
}

function normalizeSource(source, index = 0) {
  const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  return {
    index: index + 1,
    sourceType: String(source?.sourceType || 'KNOWLEDGE').slice(0, 60),
    title: String(source?.title || `资料 ${index + 1}`).trim().slice(0, 300),
    excerpt: String(source?.summary || source?.content || '').trim().slice(0, 1200),
    documentId: source?.documentId == null ? null : String(source.documentId).slice(0, 120),
    pageNumber: positiveInteger(metadata.pageNumber ?? source?.pageNumber),
    chunkId: metadata.chunkId == null ? null : String(metadata.chunkId).slice(0, 120),
    relevanceScore: Number.isFinite(Number(source?.relevanceScore)) ? Number(source.relevanceScore) : null,
    url: safeUrl(source?.url || metadata.url),
  };
}

function buildSourceTrace(sources) {
  return (Array.isArray(sources) ? sources : [])
    .map(normalizeSource)
    .filter((item) => item.excerpt || item.documentId || item.url);
}

function buildContext(trace, maxChars = 7000) {
  const limit = Math.min(30000, Math.max(1000, Number(maxChars) || 7000));
  return buildSourceTrace(trace).map((item) => {
    const location = item.pageNumber ? `，第 ${item.pageNumber} 页` : '';
    return `[来源 ${item.index}：${item.title}${location}]\n${item.excerpt}`;
  }).join('\n\n').slice(0, limit);
}

module.exports = { normalizeSource, buildSourceTrace, buildContext };
