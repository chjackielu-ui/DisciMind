// 自适应文本域 — 自动撑高、禁止拖拽、最大高度限幅
//
// 用法：
//   1. HTML 中给 textarea 加 class="auto-resize-ta"
//   2. 或在 JS 中调用：initAutoResize(document.getElementById('id'))
//
// CSS 变量（可写在 textarea 的 style 或 CSS 中）：
//   --ta-min-height: 80px;     最小高度
//   --ta-max-height: 300px;    最大高度

const STYLE_ID = 'auto-resize-ta-style'

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const css = document.createElement('style')
  css.id = STYLE_ID
  css.textContent = `
    textarea.auto-resize-ta,
    .auto-resize-ta {
      resize: none !important;
      overflow-y: hidden;
      min-height: var(--ta-min-height, 80px);
      max-height: var(--ta-max-height, 300px);
      box-sizing: border-box;
      transition: height 0.05s ease;
    }
    textarea.auto-resize-ta.overflow,
    .auto-resize-ta.overflow {
      overflow-y: auto !important;
    }
  `
  document.head.appendChild(css)
}

/**
 * 初始化单个 textarea 的自适应能力
 * @param {HTMLTextAreaElement} el
 */
export function initAutoResize(el) {
  if (!el || el.dataset.autoResizeInited) return
  injectStyles()

  el.classList.add('auto-resize-ta')
  el.dataset.autoResizeInited = 'true'

  function resize() {
    el.style.height = '0px'
    const sh = el.scrollHeight
    const maxH = parseInt(getComputedStyle(el).getPropertyValue('--ta-max-height')) || 300
    const minH = parseInt(getComputedStyle(el).getPropertyValue('--ta-min-height')) || 80

    if (sh > maxH) {
      el.style.height = maxH + 'px'
      el.classList.add('overflow')
    } else {
      el.style.height = Math.max(sh, minH) + 'px'
      el.classList.remove('overflow')
    }
  }

  el.addEventListener('input', resize)
  resize()
  return el
}

/**
 * 扫描并初始化页面中所有带 auto-resize-ta class 的 textarea
 */
export function initAllAutoResize() {
  injectStyles()
  document.querySelectorAll('textarea.auto-resize-ta:not([data-auto-resize-inited])').forEach(initAutoResize)
}
