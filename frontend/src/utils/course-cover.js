// 课程封面工具模块 — 集中管理封面映射与加载容错

const COVER_BY_COURSE_NAME = {
  // 按课程名称关键词匹配（不区分大小写）
  '机器学习': '/pics/books/book_covers/xigua.jpg',
  'machine learning': '/pics/books/book_covers/xigua.jpg',
  'watermelon': '/pics/books/book_covers/xigua.jpg',
  '西瓜书': '/pics/books/book_covers/xigua.jpg',
  '操作系统': '/pics/books/book_covers/operating-systems.webp',
  '数据结构': '/pics/books/book_covers/data-structures.webp',
  '算法': '/pics/books/book_covers/data-structures.webp',
  '数据库': '/pics/books/book_covers/database.webp',
  '计算机组成': '/pics/books/book_covers/computer-science.webp',
  '计算机网络': '/pics/books/book_covers/computer-networks.webp',
  'python': '/pics/books/book_covers/python.webp',
  'web前端': '/pics/books/book_covers/computer-science.webp',
  'web 开发': '/pics/books/book_covers/computer-science.webp',
  'javascript': '/pics/books/book_covers/computer-science.webp',
  '软件工程': '/pics/books/book_covers/computer-science.webp',
  '人工智能': '/pics/books/book_covers/computer-science.webp',
  '概率论': '/pics/books/book_covers/probability.webp',
}

const COVER_BY_SUBJECT_CATEGORY = {
  // 按学科分类匹配默认封面
  '机器学习': '/pics/books/book_covers/xigua.jpg',
  '计算机': '/pics/books/book_covers/default.svg',
  '数学': '/pics/books/book_covers/default.svg',
  '物理': '/pics/books/book_covers/default.svg',
}

const DEFAULT_COVER = '/pics/books/book_covers/default.svg'

function isPlaceholderCover(url) {
  if (!url) return true
  const normalized = String(url).split(/[?#]/, 1)[0].replace(/\\/g, '/').toLowerCase()
  return normalized.endsWith('/pics/books/book_covers/default.svg')
}

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
 *   1. 课程数据自带的 cover_url
 *   2. course_name 关键词子串匹配
 *   3. subject_category 关键词子串匹配
 *   4. 默认封面
 *
 * @param {object} course - 来自 getStudentCourses() 的课程对象
 * @returns {string} 封面图片路径
 */
export function getCourseCoverUrl(course) {
  if (!course) return DEFAULT_COVER

  const explicitCover = course.cover_url || course.coverUrl
  if (!isPlaceholderCover(explicitCover)) return explicitCover

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

  return DEFAULT_COVER
}
