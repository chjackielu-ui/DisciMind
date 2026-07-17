// Markdown 链接标签中可能本身含 [1] 这类文本，先把整个链接作为一个片段保护。
const PROTECTED_SEGMENT_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$|!?\[(?:[^\[\]\n]|\[[^\]\n]*\])*\]\([^\n)]*\))/g;

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeSources(input = [], defaults = {}) {
  const used = new Set();
  const sources = [];
  for (const item of Array.isArray(input) ? input : []) {
    let index = Number(item?.index ?? item?.sourceIndex);
    if (!Number.isInteger(index) || index < 1 || used.has(index)) {
      index = 1;
      while (used.has(index)) index += 1;
    }
    const url = safeHttpUrl(item?.url || item?.sourceUri || item?.externalUrl);
    const sourceType = String(item?.sourceType || defaults.sourceType || 'web').slice(0, 48);
    const internalKnowledge = sourceType.toLowerCase().includes('knowledge')
      && Boolean(item?.knowledgeBaseId || item?.knowledgeBaseName)
      && Boolean(item?.snippet || item?.summary);
    if (!url && !internalKnowledge) continue;
    used.add(index);
    sources.push({
      index,
      title: String(item?.title || item?.documentTitle || '未命名来源').trim().slice(0, 500),
      url,
      siteName: String(item?.siteName || item?.site_name || item?.knowledgeBaseName || '').trim().slice(0, 160) || (url ? new URL(url).hostname : '课程知识库'),
      icon: safeHttpUrl(item?.icon) || null,
      sourceType,
      retrievedAt: item?.retrievedAt || defaults.retrievedAt || new Date().toISOString(),
      searchStrategy: item?.searchStrategy || defaults.searchStrategy || null,
      requestId: item?.requestId || defaults.requestId || null,
      snippet: String(item?.snippet || item?.summary || '').slice(0, 2000) || null,
      knowledgeBaseId: item?.knowledgeBaseId || null,
      knowledgeBaseName: item?.knowledgeBaseName || null,
      documentId: item?.documentId || null,
      segmentId: item?.segmentId || null,
      pageNumber: item?.pageNumber || null,
      score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
    });
  }
  return sources.sort((a, b) => a.index - b.index);
}

function transformUnprotected(text, transform) {
  const segments = [];
  const protectedText = String(text || '').replace(PROTECTED_SEGMENT_RE, (match) => {
    const token = `\uE000DISCIMIND_PROTECTED_${segments.length}\uE001`;
    segments.push(match);
    return token;
  });
  const transformed = transform(protectedText);
  return transformed.replace(/\uE000DISCIMIND_PROTECTED_(\d+)\uE001/g, (_, index) => segments[Number(index)] || '');
}

function normalizeCitations(answer, sourceInput = []) {
  const sources = normalizeSources(sourceInput);
  const valid = new Set(sources.map(item => item.index));
  const cited = new Set();
  const missing = new Set();
  const normalizedText = transformUnprotected(answer, text => text.replace(/\[(?:ref_)?(\d+)\]/gi, (match, rawIndex) => {
    const index = Number(rawIndex);
    if (!valid.has(index)) {
      missing.add(index);
      return match;
    }
    cited.add(index);
    return `[ref_${index}]`;
  }));
  return {
    text: normalizedText,
    sources,
    citations: [...cited].sort((a, b) => a - b),
    missing: [...missing].sort((a, b) => a - b),
  };
}

module.exports = { PROTECTED_SEGMENT_RE, safeHttpUrl, normalizeSources, transformUnprotected, normalizeCitations };
