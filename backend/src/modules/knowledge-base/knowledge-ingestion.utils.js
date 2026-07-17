const DEFAULT_RATE_LIMIT_RETRY_BASE_MS = 60_000;
const DEFAULT_RATE_LIMIT_RETRY_MAX_MS = 15 * 60_000;

function normalizeUploadFileName(value) {
  const original = String(value || '').trim().normalize('NFC');
  if (!original) return original;
  const decoded = Buffer.from(original, 'latin1').toString('utf8');
  const canRoundTrip = !decoded.includes('\uFFFD')
    && Buffer.from(decoded, 'utf8').toString('latin1') === original;
  const suspiciousOriginal = (original.match(/[\u0080-\u009f]|Ã|Â|â|ð|锟斤拷/g) || []).length;
  const suspiciousDecoded = (decoded.match(/[\u0080-\u009f]|Ã|Â|â|ð|锟斤拷/g) || []).length;
  return (canRoundTrip && suspiciousDecoded < suspiciousOriginal ? decoded : original).normalize('NFKC');
}

function collectRemoteErrorText(value, output = [], depth = 0) {
  if (depth > 4 || value == null) return output;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return output;
    output.push(text);
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
      try { collectRemoteErrorText(JSON.parse(text), output, depth + 1); } catch {}
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item) => collectRemoteErrorText(item, output, depth + 1));
    return output;
  }
  if (typeof value === 'object') {
    for (const key of ['message', 'description', 'error', 'error_message', 'detail', 'args']) {
      if (value[key] !== undefined) collectRemoteErrorText(value[key], output, depth + 1);
    }
  }
  return output;
}

function classifyRemoteIndexingError(value) {
  const detail = collectRemoteErrorText(value).join(' | ').slice(0, 4000);
  const rateLimited = /(?:\b429\b|rate.?limit|ratequota|throttl|too many requests|请求频率|限流|配额)/i.test(detail);
  if (rateLimited) return {
    code: 'DIFY_EMBEDDING_RATE_LIMIT',
    automaticRetry: true,
    retryable: true,
    detail,
    userMessage: 'Embedding 服务请求过多，系统已自动退避并将在稍后重新索引。',
  };
  const transient = /(?:timeout|timed out|temporar|unavailable|connection|network|reset|\b5\d\d\b|服务繁忙|网络|超时|暂时不可用)/i.test(detail);
  if (transient) return {
    code: 'DIFY_INDEXING_TRANSIENT',
    automaticRetry: true,
    retryable: true,
    detail,
    userMessage: 'Dify 索引服务暂时不可用，系统将在稍后自动重试。',
  };
  return {
    code: 'DIFY_INDEXING_FAILED',
    automaticRetry: false,
    retryable: true,
    detail,
    userMessage: 'Dify 文档索引失败，可以重新处理。',
  };
}

function automaticIndexingRetryDelay(retryNumber, options = {}) {
  const baseMs = Math.max(1_000, Number(options.baseMs || process.env.KNOWLEDGE_DIFY_RETRY_BASE_MS || DEFAULT_RATE_LIMIT_RETRY_BASE_MS));
  const maxMs = Math.max(baseMs, Number(options.maxMs || process.env.KNOWLEDGE_DIFY_RETRY_MAX_MS || DEFAULT_RATE_LIMIT_RETRY_MAX_MS));
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, Number(retryNumber || 1) - 1)));
}

function maxAutomaticIndexingRetries() {
  return Math.max(1, Math.min(9, Number(process.env.KNOWLEDGE_DIFY_AUTO_RETRIES || 5)));
}

module.exports = {
  normalizeUploadFileName,
  collectRemoteErrorText,
  classifyRemoteIndexingError,
  automaticIndexingRetryDelay,
  maxAutomaticIndexingRetries,
};
