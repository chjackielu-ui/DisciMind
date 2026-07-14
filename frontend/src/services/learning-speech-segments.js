const SENTENCE_END = /(?<=[。！？!?；;])\s*/u;

function readableMath(value) {
  return String(value || '')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1 除以 $2')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, '$1 的平方根')
    .replace(/([A-Za-z0-9\u4e00-\u9fff]+)\^\{?2\}?/g, '$1 的平方')
    .replace(/([A-Za-z0-9\u4e00-\u9fff]+)\^\{?3\}?/g, '$1 的立方')
    .replace(/\\times|\\cdot/g, '乘以')
    .replace(/\\div/g, '除以')
    .replace(/\\leq?/g, '小于等于')
    .replace(/\\geq?/g, '大于等于')
    .replace(/\\neq/g, '不等于')
    .replace(/\\approx/g, '约等于')
    .replace(/\\(?:left|right|begin|end|mathrm|mathbf|text)\b(?:\{[^{}]*\})?/g, ' ')
    .replace(/\\[A-Za-z]+(?:\{[^{}]*\})*/g, ' ')
    .replace(/[{}]/g, ' ');
}

export function normalizeSpeechText(value) {
  return readableMath(value)
    .replace(/```[\s\S]*?```/g, ' 代码示例已省略。 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSpeechText(value, maxLength = 180) {
  const clean = normalizeSpeechText(value);
  if (!clean) return [];
  const sentences = clean.split(SENTENCE_END).filter(Boolean);
  const result = [];
  let current = '';
  const flush = () => { if (current.trim()) result.push(current.trim()); current = ''; };
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      flush();
      const clauses = sentence.split(/(?<=[，,、：:])\s*/u).filter(Boolean);
      for (const clause of clauses) {
        if ((current + clause).length > maxLength) flush();
        if (clause.length <= maxLength) current += clause;
        else {
          for (let start = 0; start < clause.length; start += maxLength) result.push(clause.slice(start, start + maxLength));
        }
      }
      continue;
    }
    if ((current + sentence).length > maxLength) flush();
    current += sentence;
  }
  flush();
  return result;
}

export function collectNarrationSegments(roots = []) {
  const segments = [];
  let anchorSequence = 0;
  const seen = new Set();
  const selector = 'h1,h2,h3,h4,p,li,.lws-guide-bubble,.lws-section-title,.lws-section-body,.lws-question-stem,.lws-eval-analysis';
  for (const root of roots.filter(Boolean)) {
    const candidates = root.matches?.(selector) ? [root] : [...root.querySelectorAll(selector)];
    for (const element of candidates) {
      if (element.closest('[hidden], .lws-node-history') || element.offsetParent === null) continue;
      const text = normalizeSpeechText(element.textContent);
      if (text.length < 2 || seen.has(text)) continue;
      seen.add(text);
      const anchorId = element.dataset.narrationAnchor || `lws-narration-anchor-${++anchorSequence}`;
      element.dataset.narrationAnchor = anchorId;
      const title = element.matches('h1,h2,h3,h4,.lws-section-title') ? text.slice(0, 60) : `讲解第 ${segments.length + 1} 段`;
      splitSpeechText(text).forEach((part, index) => segments.push({
        id: `${anchorId}-${index + 1}`,
        title,
        text: part,
        anchorId,
      }));
    }
  }
  return segments;
}
