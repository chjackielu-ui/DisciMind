// 统一 SVG 图标系统
// 学生端侧边栏导航图标，全部使用 inline SVG，保证大小统一、居中对齐
// 颜色通过 currentColor 继承

const ICON_SIZE = 22

function svgWrap(inner, vb = '0 0 24 24') {
  return `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}

// ========================
// 导航图标
// ========================

// 首页 — 房子
export function iconHome() {
  return svgWrap(`
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  `)
}

// 课程 — 书本
export function iconBook() {
  return svgWrap(`
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
    <line x1="8" y1="7" x2="16" y2="7"/>
    <line x1="8" y1="11" x2="14" y2="11"/>
  `)
}

// 错题 — 文件带叉号
export function iconAlert() {
  return svgWrap(`
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="9" y1="15" x2="15" y2="15"/>
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>
  `)
}

// 推荐 — 星星
export function iconStar() {
  return svgWrap(`
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  `)
}

// 画像 — 用户卡片
export function iconUser() {
  return svgWrap(`
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  `)
}

// AI 问答 — 消息气泡
export function iconMessage() {
  return svgWrap(`
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
  `)
}

// 图钉 — 固定
export function iconPin() {
  return svgWrap(`
    <line x1="12" y1="17" x2="12" y2="22"/>
    <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-.79 1.55l-1.78.9A2 2 0 005 15.24z"/>
  `)
}

// 图钉已固定
export function iconPinFilled() {
  return svgWrap(`
    <line x1="12" y1="17" x2="12" y2="22"/>
    <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-.79 1.55l-1.78.9A2 2 0 005 15.24z" fill="currentColor" stroke="none" opacity="0.3"/>
    <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-.79 1.55l-1.78.9A2 2 0 005 15.24z"/>
  `)
}

// 退出 — 门
export function iconLogout() {
  return svgWrap(`
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  `)
}

// 布局设置 — 栅格
export function iconLayout() {
  return svgWrap(`
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
  `)
}

// 拖拽手柄 — 六点
export function iconGrip() {
  return svgWrap(`
    <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/>
    <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
    <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/>
  `)
}

// 搜索
export function iconSearch() {
  return svgWrap(`
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  `)
}

// 刷新
export function iconRefresh() {
  return svgWrap(`
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
  `)
}

// 排序
export function iconSort() {
  return svgWrap(`
    <line x1="4" y1="6" x2="16" y2="6"/>
    <line x1="4" y1="12" x2="12" y2="12"/>
    <line x1="4" y1="18" x2="8" y2="18"/>
  `)
}

// ========================
// 导航图标映射
// ========================

export const NAV_ICONS = {
  home: iconHome,
  book: iconBook,
  alert: iconAlert,
  star: iconStar,
  user: iconUser,
  message: iconMessage,
  pin: iconPin,
  pinFilled: iconPinFilled,
  logout: iconLogout,
  layout: iconLayout,
  grip: iconGrip,
  search: iconSearch,
  refresh: iconRefresh,
  sort: iconSort,
}

/**
 * 获取导航图标 HTML 字符串
 * @param {string} name - 图标名
 * @returns {string} SVG HTML
 */
export function getIcon(name) {
  const fn = NAV_ICONS[name]
  return fn ? fn() : iconHome()
}
