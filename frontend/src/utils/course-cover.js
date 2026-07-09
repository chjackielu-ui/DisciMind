// 课程封面工具模块 — 集中管理封面映射与加载容错

const COVER_BY_COURSE_ID = {
  // 按 course_id 精确匹配（最优先）
}

const COVER_BY_COURSE_NAME = {
  // 按课程名称关键词匹配（不区分大小写）
  '机器学习': '/pics/books/book_covers/xigua.jpg',
  'machine learning': '/pics/books/book_covers/xigua.jpg',
  'watermelon': '/pics/books/book_covers/xigua.jpg',
  '西瓜书': '/pics/books/book_covers/xigua.jpg',
}

const COVER_BY_SUBJECT_CATEGORY = {
  // 按学科分类匹配默认封面
  '机器学习': '/pics/books/book_covers/xigua.jpg',
  '计算机': '/pics/books/book_covers/default.svg',
  '数学': '/pics/books/book_covers/default.svg',
  '物理': '/pics/books/book_covers/default.svg',
}

const DEFAULT_COVER = '/pics/books/book_covers/default.svg'

/**
 * 课程数据结构中可能包含这些名称变体
 * 统一查找课程名称
 */
function getCourseName(course) {
  return course?.course_name || course?.courseName || course?.name || ''
}

function getSubjectCategory(course) {
  return course?.subject_category || course?.subjectCategory || ''
}

/**
 * 获取课程封面图片 URL
 *
 * 匹配优先级：
 *   1. course_id 精确匹配
 *   2. course_name 关键词子串匹配
 *   3. subject_category 关键词子串匹配
 *   4. 返回 null（调用方应显示默认占位封面）
 *
 * @param {object} course - 来自 getStudentCourses() 的课程对象
 * @returns {string|null} 封面图片路径，或 null
 */
export function getCourseCoverUrl(course) {
  if (!course) return null

  // 1. 按 course_id 精确匹配
  const cid = String(course.course_id || course.id || '')
  if (cid && COVER_BY_COURSE_ID[cid]) {
    return COVER_BY_COURSE_ID[cid]
  }

  // 2. 按课程名称关键词匹配
  const name = getCourseName(course).toLowerCase()
  for (const [keyword, url] of Object.entries(COVER_BY_COURSE_NAME)) {
    if (name.includes(keyword.toLowerCase())) {
      return url
    }
  }

  // 3. 按学科分类关键词匹配
  const cat = getSubjectCategory(course).toLowerCase()
  for (const [keyword, url] of Object.entries(COVER_BY_SUBJECT_CATEGORY)) {
    if (cat.includes(keyword.toLowerCase())) {
      return url
    }
  }

  // 4. 无匹配 — 返回 null
  return null
}

/**
 * 获取默认封面 URL（始终返回）
 */
export function getDefaultCoverUrl() {
  return DEFAULT_COVER
}

/**
 * 安全的 HTML 转义
 */
function escapeHtml(str) {
  if (str == null) return ''
  const div = document.createElement('div')
  div.textContent = String(str)
  return div.innerHTML
}

/**
 * 渲染课程封面 HTML（带图片加载失败回退）
 *
 * @param {string|null} url - 来自 getCourseCoverUrl() 的封面 URL
 * @param {string} courseName - 课程名称，用于 alt 属性和首字母占位
 * @param {object} options - 可选配置
 * @param {string} options.className - img 元素的额外 CSS 类
 * @param {string} options.placeholderClass - 占位 div 的 CSS 类
 * @returns {string} HTML 字符串
 */
export function renderCourseCoverHTML(url, courseName, options = {}) {
  const safeName = escapeHtml(courseName || '课程')
  const alt = `${courseName || '课程'}封面`
  const imgClass = options.className || 'course-cover-img'
  const placeholderClass = options.placeholderClass || 'course-cover-placeholder'
  const fallbackUrl = getDefaultCoverUrl()

  if (!url) {
    // 无封面：显示默认封面图片
    return `<img class="${imgClass}" src="${escapeHtml(fallbackUrl)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="${placeholderClass}" style="display:none;" aria-hidden="true"><span>${safeName.slice(0, 1)}</span></div>`
  }

  // 有封面：显示指定封面，出错时回退到默认封面图片
  return `<img class="${imgClass}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.onerror=null;this.src='${escapeHtml(fallbackUrl)}';" />`
}
