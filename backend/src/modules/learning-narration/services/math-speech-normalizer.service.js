const GREEK = {
  alpha: '阿尔法', beta: '贝塔', gamma: '伽马', delta: '德尔塔', epsilon: '艾普西隆',
  theta: '西塔', lambda: '拉姆达', mu: '缪', sigma: '西格玛', phi: '斐', omega: '欧米伽',
  α: '阿尔法', β: '贝塔', γ: '伽马', δ: '德尔塔', ε: '艾普西隆', θ: '西塔',
  λ: '拉姆达', μ: '缪', σ: '西格玛', φ: '斐', ω: '欧米伽',
};

function cleanAtom(value) {
  return String(value || '').replace(/[{}]/g, '').replace(/\\mathrm|\\text/g, '').trim();
}

function normalizeMathExpression(input) {
  let value = String(input || '').trim();
  if (!value) return '';
  if (/\\(?:begin|end|left|right|operatorname|mathbf|mathbb|overbrace|underbrace)/.test(value)) {
    return '请查看屏幕中的公式。';
  }

  value = value
    .replace(/\\frac\{\\partial\s+([^{}]+)\}\{\\partial\s+([^{}]+)\}/g, (_, a, b) => `${cleanAtom(a)} 对 ${cleanAtom(b)} 的偏导数`)
    .replace(/\\frac\{d\s*([^{}]+)\}\{d\s*([^{}]+)\}/g, (_, a, b) => `${cleanAtom(a)} 对 ${cleanAtom(b)} 的导数`)
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, a, b) => `${cleanAtom(a)} 除以 ${cleanAtom(b)}`)
    .replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, (_, n, x) => `${cleanAtom(x)} 的 ${cleanAtom(n)} 次方根`)
    .replace(/\\sqrt\{([^{}]+)\}/g, (_, x) => `根号 ${cleanAtom(x)}`)
    .replace(/\\sum_\{([^=]+)=([^}]+)\}\^\{?([^}\s]+)\}?/g, (_, i, from, to) => `从 ${cleanAtom(i)} 等于 ${cleanAtom(from)} 到 ${cleanAtom(to)} 的求和`)
    .replace(/\\prod_\{([^=]+)=([^}]+)\}\^\{?([^}\s]+)\}?/g, (_, i, from, to) => `从 ${cleanAtom(i)} 等于 ${cleanAtom(from)} 到 ${cleanAtom(to)} 的连乘`)
    .replace(/\\lim_\{([^\\}]+)\\to\s*([^}]+)\}/g, (_, x, to) => `当 ${cleanAtom(x)} 趋近于 ${cleanAtom(to)} 时的极限`)
    .replace(/\\int_\{?([^}\s]+)\}?\^\{?([^}\s]+)\}?\s*([^]*?)\s*d\s*([a-zA-Z])/g, (_, a, b, fn, x) => `从 ${cleanAtom(a)} 到 ${cleanAtom(b)}，对 ${cleanAtom(fn).replace(/[()]/g, ' ')} 关于 ${x} 积分`)
    .replace(/P\s*\(\s*([^=|]+)=([^|]+)\|([^=]+)=([^\)]+)\)/gi, (_, y, yv, x, xv) => `在 ${cleanAtom(x)} 等于 ${cleanAtom(xv)} 的条件下，${cleanAtom(y)} 等于 ${cleanAtom(yv)} 的概率`)
    .replace(/([A-Za-z0-9α-ω]+)\^\{?2\}?/g, '$1 的平方')
    .replace(/([A-Za-z0-9α-ω]+)\^\{?3\}?/g, '$1 的立方')
    .replace(/([A-Za-z0-9α-ω]+)\^\{?([^}\s]+)\}?/g, '$1 的 $2 次方')
    .replace(/([A-Za-z0-9α-ω]+)_\{([^}]+)\}/g, (_, x, sub) => `${x} 下标 ${sub.replace(/,/g, ' 逗号 ')}`)
    .replace(/([A-Za-z0-9α-ω]+)_([A-Za-z0-9]+)/g, '$1 下标 $2')
    .replace(/([A-Za-z])\(([^()]+)\)/g, '$1 括号 $2')
    .replace(/\\times|×/g, ' 乘以 ')
    .replace(/÷/g, ' 除以 ')
    .replace(/±/g, ' 正负 ')
    .replace(/∞/g, ' 无穷大 ')
    .replace(/∉/g, ' 不属于 ')
    .replace(/∈/g, ' 属于 ')
    .replace(/⇒/g, ' 因此得到 ')
    .replace(/→|\\to/g, ' 趋近于 ')
    .replace(/∝/g, ' 正比于 ')
    .replace(/≈/g, ' 约等于 ')
    .replace(/≥|\\geq?/g, ' 大于等于 ')
    .replace(/≤|\\leq?/g, ' 小于等于 ')
    .replace(/≠|\\neq?/g, ' 不等于 ')
    .replace(/=/g, ' 等于 ')
    .replace(/>/g, ' 大于 ')
    .replace(/</g, ' 小于 ')
    .replace(/\+/g, ' 加 ')
    .replace(/(?<=^|[=（(,，\s])-\s*/g, '负 ')
    .replace(/-/g, ' 减 ');

  for (const [symbol, spoken] of Object.entries(GREEK)) {
    value = value.replace(new RegExp(symbol.startsWith('\\') ? symbol : `\\\\${symbol}|${symbol}`, 'g'), ` ${spoken} `);
  }
  value = value
    .replace(/\bAI\b/g, 'A I').replace(/\bAUC\b/g, 'A U C').replace(/\bROC\b/g, 'R O C')
    .replace(/\bCNN\b/g, 'C N N').replace(/\bRNN\b/g, 'R N N').replace(/\bSVM\b/g, 'S V M')
    .replace(/\bReLU\b/gi, '瑞路').replace(/\bPython\b/gi, '派森').replace(/log-odds/gi, '对数几率')
    .replace(/\\[a-zA-Z]+/g, '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
  return value && !/[{}\\]/.test(value) ? value : '请查看屏幕中的公式。';
}

function normalizeMathInText(input, metrics = {}) {
  let failed = 0;
  const convert = (_, expression) => {
    const result = normalizeMathExpression(expression);
    if (result === '请查看屏幕中的公式。') failed += 1;
    return ` ${result} `;
  };
  let text = String(input || '')
    .replace(/\$\$([\s\S]*?)\$\$/g, convert)
    .replace(/\\\[([\s\S]*?)\\\]/g, convert)
    .replace(/\\\(([\s\S]*?)\\\)/g, convert)
    .replace(/\$([^$\n]+)\$/g, convert);
  metrics.formulaConversionFailures = (metrics.formulaConversionFailures || 0) + failed;
  return text;
}

module.exports = { normalizeMathExpression, normalizeMathInText };
