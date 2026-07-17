import { Marked, Renderer } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'

const CODE_SEGMENT_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g
const MATH_PLACEHOLDER = 'DISCIMIND_MATH_PLACEHOLDER_'

function escapeHtmlString(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value) {
  return escapeHtmlString(value).replace(/`/g, '&#96;')
}

function withCodeSegmentsProtected(markdown, transform) {
  const segments = []
  const protectedMarkdown = markdown.replace(CODE_SEGMENT_RE, (match) => {
    const index = segments.length
    segments.push(match)
    return `\uE000CODE_${index}\uE001`
  })

  const transformed = transform(protectedMarkdown)
  return transformed.replace(/\uE000CODE_(\d+)\uE001/g, (_, index) => segments[Number(index)] || '')
}

export function normalizeMathMarkdown(markdown) {
  const text = String(markdown ?? '').replace(/\r\n?/g, '\n')

  return withCodeSegmentsProtected(text, (raw) => raw
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression) => `\n\n$$\n${String(expression).trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression) => `$${String(expression).trim()}$`)
    .replace(/\n{3,}/g, '\n\n'))
}

function protectMathSegments(markdown) {
  const mathSegments = []

  const addMath = (display, expression) => {
    const index = mathSegments.length
    mathSegments.push({
      display,
      expression: String(expression ?? '').trim(),
    })
    return `${MATH_PLACEHOLDER}${index}`
  }

  const protectedMarkdown = withCodeSegmentsProtected(markdown, (raw) => raw
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, expression) => addMath(true, expression))
    .replace(/\$(?!\$)([^\n$]+?)\$/g, (_, expression) => addMath(false, expression)))

  return { markdown: protectedMarkdown, mathSegments }
}

function restoreMathPlaceholders(html, mathSegments) {
  return mathSegments.reduce((current, item, index) => {
    let source = ''
    try {
      source = katex.renderToString(item.expression, {
        displayMode: item.display,
        throwOnError: false,
        trust: false,
      })
    } catch {
      const expression = escapeHtmlString(item.expression)
      source = item.display ? `$$\n${expression}\n$$` : `$${expression}$`
    }
    return current.replaceAll(`${MATH_PLACEHOLDER}${index}`, source)
  }, html)
}

const renderer = new Renderer()

renderer.code = ({ text, lang }) => {
  const language = String(lang || 'code').trim().split(/\s+/)[0] || 'code'
  const code = String(text ?? '').replace(/\n$/, '')
  const encodedCode = encodeURIComponent(code)

  return `<div class="markdown-code-block">
    <div class="markdown-code-head">
      <span>${escapeHtmlString(language)}</span>
      <button class="code-copy-btn" type="button" data-copy-code="${escapeAttribute(encodedCode)}">复制</button>
    </div>
    <pre><code class="language-${escapeAttribute(language)}">${escapeHtmlString(code)}</code></pre>
  </div>`
}

renderer.table = function table(token) {
  return `<div class="markdown-table-wrap">${Renderer.prototype.table.call(this, token)}</div>`
}

renderer.link = function link({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens)
  const safeHref = escapeAttribute(href || '')
  const titleAttr = title ? ` title="${escapeAttribute(title)}"` : ''

  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${label}</a>`
}

const markdownParser = new Marked({
  async: false,
  breaks: true,
  gfm: true,
  renderer,
})

const sanitizeOptions = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel', 'data-copy-code', 'align', 'class'],
}

const mathRenderOptions = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
  ],
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
  ignoredClasses: ['katex', 'no-math'],
  throwOnError: false,
  trust: false,
}

export function renderMarkdownToHtml(rawMarkdown) {
  const normalized = normalizeMathMarkdown(rawMarkdown)
  const { markdown, mathSegments } = protectMathSegments(normalized)
  const dirtyHtml = markdownParser.parse(markdown || '')
  const cleanHtml = DOMPurify.sanitize(dirtyHtml, sanitizeOptions)
  return restoreMathPlaceholders(cleanHtml || '<p></p>', mathSegments)
}

export function renderMathInMarkdownElement(element) {
  if (!element) return
  try {
    renderMathInElement(element, mathRenderOptions)
  } catch (err) {
    console.warn('[markdown] math render failed:', err)
  }
}

export function renderMathInMarkdownElements(root = document) {
  if (!root) return
  const elements = root.matches?.('.message-markdown')
    ? [root]
    : Array.from(root.querySelectorAll?.('.message-markdown') || [])

  elements.forEach(renderMathInMarkdownElement)
}
