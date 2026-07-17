const { normalizeMathInText } = require('./math-speech-normalizer.service');

const SENSITIVE = /(?:api[_ -]?key|authorization|bearer|token|secret|password)\s*[:=]\s*\S+/gi;
const BASE64 = /(?:[A-Za-z0-9+/]{80,}={0,2})/g;

function tableToSpeech(block) {
  const rows = block.trim().split('\n').filter(Boolean).map((row) => row.split('|').map((cell) => cell.trim()).filter(Boolean));
  const useful = rows.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
  if (!useful.length) return '';
  if (useful.length > 4 || useful.some((row) => row.length > 4)) return '请查看屏幕中的表格。';
  const headers = useful[0];
  return useful.slice(1).map((row, index) => `第 ${index + 1} 行，${row.map((cell, i) => `${headers[i] || `第 ${i + 1} 列`}是${cell}`).join('，')}。`).join('');
}

function normalizeSpeechText(input, metrics = {}) {
  if (input == null) return '';
  let text = typeof input === 'string' ? input : JSON.stringify(input);
  const started = Date.now();
  text = normalizeMathInText(text, metrics)
    .replace(SENSITIVE, '敏感配置已省略')
    .replace(BASE64, '音频数据已省略')
    .replace(/^\s*[\[{].*[\]}]\s*$/gm, '')
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => {
      const compact = code.trim().replace(/\s+/g, ' ');
      return compact.length <= 80 ? `下面是一段简短代码，请查看页面。主要逻辑是 ${compact.replace(/[{}()[\];]/g, ' ')}。` : '下面是一段代码，请在页面中查看。';
    })
    .replace(/(?:^|\n)((?:\s*\|[^\n]*\|\s*(?:\n|$)){2,})/g, (_, block) => `\n${tableToSpeech(block)}`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '请查看屏幕中的图片。')
    .replace(/<img\b[^>]*>/gi, '请查看屏幕中的图片。')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]+\)/g, '$1。')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '第一，')
    .replace(/^\s*(\d+)[.)、]\s+/gm, (_, n) => `第${n}，`)
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[“”"]/g, '')
    .replace(/[{}\[\]]/g, ' ')
    .replace(/\b(?:sourceId|datasetId|documentId|segmentId|rawOutput|validationError|debug|correct_answer|correctAnswer|standardAnswer)\b\s*[:：]?/gi, '')
    .replace(/[:,]\s*(?=[A-Za-z_][\w-]*\s*:)/g, ' ')
    .replace(/\n{2,}/g, '。')
    .replace(/\s*\n\s*/g, '。')
    .replace(/。{2,}/g, '。')
    .replace(/\s+/g, ' ')
    .replace(/\s+([。！？；：，])/g, '$1')
    .trim();
  metrics.formulaNormalizeMs = (metrics.formulaNormalizeMs || 0) + (Date.now() - started);
  return /^[\p{P}\p{S}\s]+$/u.test(text) ? '' : text;
}

module.exports = { normalizeSpeechText, tableToSpeech };
