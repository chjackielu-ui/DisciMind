// Toast 轻提示工具
// 统一的消息通知组件，不使用 alert
// 自动排队、自动消失

let toastContainer = null
let toastTimer = null

const TOAST_TYPES = {
  success: { bg: '#4CAF84', icon: '✓' },
  error: { bg: '#E0576E', icon: '✕' },
  info: { bg: '#2F6690', icon: 'ℹ' },
  warning: { bg: '#E8913A', icon: '⚠' },
}

function ensureContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement('div')
    toastContainer.className = 'toast-container'
    toastContainer.innerHTML = '<div class="toast-stack" id="toast-stack"></div>'
    document.body.appendChild(toastContainer)
    injectToastStyles()
  }
  return toastContainer
}

let stylesInjected = false
function injectToastStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .toast-container {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 99999;
      pointer-events: none;
    }
    .toast-stack {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .toast-item {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      border-radius: 14px;
      color: #fff;
      font-size: 0.88rem;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      box-shadow: 0 8px 28px rgba(22,66,91,0.18);
      backdrop-filter: blur(10px);
      animation: toastIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
      max-width: 400px;
      line-height: 1.4;
    }
    .toast-item.removing {
      animation: toastOut 0.28s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
    .toast-icon {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
      background: rgba(255,255,255,0.25);
    }
    @keyframes toastIn {
      from { opacity: 0; transform: translateX(40px) scale(0.92); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes toastOut {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to { opacity: 0; transform: translateX(40px) scale(0.92); }
    }
    @media (max-width: 768px) {
      .toast-container {
        left: 16px;
        right: 16px;
        top: 16px;
      }
      .toast-item {
        width: 100%;
        max-width: calc(100vw - 32px);
        box-sizing: border-box;
        padding: 11px 14px;
        overflow-wrap: anywhere;
      }
    }
  `
  document.head.appendChild(style)
}

/**
 * 显示 Toast 消息
 * @param {string} message - 消息内容
 * @param {'success'|'error'|'info'|'warning'} type - 消息类型
 * @param {number} duration - 显示时长（毫秒），默认 2500
 */
export function showToast(message, type = 'info', duration = 2500) {
  const container = ensureContainer()
  const stack = container.querySelector('#toast-stack')
  if (!stack) return

  const cfg = TOAST_TYPES[type] || TOAST_TYPES.info

  const item = document.createElement('div')
  item.className = 'toast-item'
  item.style.background = cfg.bg
  item.innerHTML = `<span class="toast-icon">${cfg.icon}</span><span>${escapeHtml(message)}</span>`

  stack.appendChild(item)

  // 限制最多显示 3 个
  const items = stack.querySelectorAll('.toast-item')
  if (items.length > 3) {
    items[0].remove()
  }

  // 自动移除
  setTimeout(() => {
    item.classList.add('removing')
    setTimeout(() => {
      if (item.parentNode) item.remove()
    }, 300)
  }, duration)

  // 点击可立即关闭
  item.addEventListener('click', () => {
    item.classList.add('removing')
    setTimeout(() => {
      if (item.parentNode) item.remove()
    }, 300)
  })
}

function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}
