import { renderMarkdownToHtml } from '../../utils/markdown.js'

const PROTECTED_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$(?!\$)[^$\n]+?\$|!?\[(?:[^\[\]\n]|\[[^\]\n]*\])*\]\([^\n)]*\))/g

function withProtectedSegments(value, transform) {
  const segments = []
  const protectedText = String(value || '').replace(PROTECTED_RE, match => { const token = `\uE000AI_PROTECTED_${segments.length}\uE001`; segments.push(match); return token })
  return transform(protectedText).replace(/\uE000AI_PROTECTED_(\d+)\uE001/g, (_, index) => segments[Number(index)] || '')
}

export function renderCitedMarkdown(markdown, sources = []) {
  const valid = new Set((sources || []).map(source => Number(source.index ?? source.metadata?.sourceIndex)).filter(Number.isInteger))
  const cited = new Set()
  const prepared = withProtectedSegments(markdown, text => text.replace(/\[(?:ref_)?(\d+)\]/gi, (match, raw) => {
    const index = Number(raw)
    if (!valid.has(index)) return match
    cited.add(index)
    return `DISCIMINDCITATION${index}TOKEN`
  }))
  let html = renderMarkdownToHtml(prepared)
  for (const index of cited) {
    html = html.replaceAll(`DISCIMINDCITATION${index}TOKEN`, `<sup class="ai-citation"><button type="button" data-citation-index="${index}" aria-label="查看来源 ${index}">${index}</button></sup>`)
  }
  return html
}

export function bindCitationClicks(root, handler) {
  root?.querySelectorAll?.('[data-citation-index]').forEach(button => button.addEventListener('click', () => handler?.(Number(button.dataset.citationIndex))))
}

export { withProtectedSegments }
