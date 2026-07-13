/**
 * 教师端智能教案页面 — 学生高频提问词 Seed 兜底数据
 *
 * 用途：
 *   - 仅作为教师端教案页面关键词/词云区域的展示兜底
 *   - 当真实学生提问数据为空、不足或联调初期时使用
 *   - 绝不参与正式教案生成逻辑（后端不引用此文件）
 *
 * 数据结构与后端 /api/teacher/lesson-plan/keywords 返回结构兼容：
 *   { keyword, frequency, difficulty, category, score, student_count, related_kp }
 *
 * 使用规则：
 *   - 真实关键词数据存在时 → 优先使用真实数据
 *   - 真实关键词数据为空时 → 使用此 seed 数据作为展示兜底
 *   - seed 数据不发送给后端，不参与教案生成
 */

const SEED_KEYWORDS = [
  // ===== 核心概念类 =====
  { keyword: '函数定义', frequency: 28, difficulty: '高', category: '核心概念类', score: 8.5, student_count: 18, related_kp: '函数概念' },
  { keyword: '极限运算', frequency: 24, difficulty: '高', category: '核心概念类', score: 7.8, student_count: 15, related_kp: '极限' },
  { keyword: '导数应用', frequency: 22, difficulty: '高', category: '核心概念类', score: 7.5, student_count: 14, related_kp: '导数' },
  { keyword: '矩阵运算', frequency: 20, difficulty: '中', category: '核心概念类', score: 6.8, student_count: 12, related_kp: '矩阵' },
  { keyword: '概率分布', frequency: 18, difficulty: '中', category: '核心概念类', score: 6.2, student_count: 11, related_kp: '概率分布' },
  { keyword: '向量空间', frequency: 16, difficulty: '中', category: '核心概念类', score: 5.8, student_count: 10, related_kp: '向量空间' },
  { keyword: '微分方程', frequency: 14, difficulty: '中', category: '核心概念类', score: 5.2, student_count: 9, related_kp: '微分方程' },
  { keyword: '线性变换', frequency: 12, difficulty: '中', category: '核心概念类', score: 4.8, student_count: 8, related_kp: '线性变换' },
  { keyword: '条件概率', frequency: 10, difficulty: '低', category: '核心概念类', score: 4.2, student_count: 7, related_kp: '条件概率' },
  { keyword: '特征值', frequency: 9, difficulty: '低', category: '核心概念类', score: 3.8, student_count: 6, related_kp: '特征值与特征向量' },

  // ===== 易错理解类 =====
  { keyword: '极限与连续的区别', frequency: 26, difficulty: '高', category: '易错理解类', score: 8.2, student_count: 17, related_kp: '连续性与极限' },
  { keyword: '链式法则应用', frequency: 21, difficulty: '高', category: '易错理解类', score: 7.2, student_count: 13, related_kp: '链式法则' },
  { keyword: '不定积分与定积分混淆', frequency: 19, difficulty: '中', category: '易错理解类', score: 6.5, student_count: 12, related_kp: '积分' },
  { keyword: '矩阵乘法顺序', frequency: 17, difficulty: '中', category: '易错理解类', score: 5.8, student_count: 10, related_kp: '矩阵乘法' },
  { keyword: '正态分布标准化', frequency: 15, difficulty: '中', category: '易错理解类', score: 5.2, student_count: 9, related_kp: '正态分布' },
  { keyword: '偏导数与全微分混淆', frequency: 13, difficulty: '中', category: '易错理解类', score: 4.8, student_count: 8, related_kp: '偏导数' },
  { keyword: '级数收敛判断', frequency: 11, difficulty: '低', category: '易错理解类', score: 4.0, student_count: 7, related_kp: '级数' },

  // ===== 方法步骤类 =====
  { keyword: '求导步骤', frequency: 23, difficulty: '中', category: '方法步骤类', score: 6.8, student_count: 14, related_kp: '求导法则' },
  { keyword: '积分换元法', frequency: 20, difficulty: '中', category: '方法步骤类', score: 6.2, student_count: 13, related_kp: '换元积分法' },
  { keyword: '高斯消元法', frequency: 16, difficulty: '中', category: '方法步骤类', score: 5.5, student_count: 10, related_kp: '高斯消元' },
  { keyword: '特征值求解步骤', frequency: 14, difficulty: '低', category: '方法步骤类', score: 4.5, student_count: 8, related_kp: '特征值计算' },
  { keyword: '最小二乘法推导', frequency: 10, difficulty: '低', category: '方法步骤类', score: 3.5, student_count: 6, related_kp: '最小二乘法' },

  // ===== 情绪反馈类 =====
  { keyword: '太难了听不懂', frequency: 8, difficulty: '高', category: '情绪反馈类', score: 5.5, student_count: 8, related_kp: '' },
  { keyword: '很有趣想多学', frequency: 6, difficulty: '低', category: '情绪反馈类', score: 3.0, student_count: 5, related_kp: '' },
  { keyword: '考试会考吗', frequency: 5, difficulty: '低', category: '情绪反馈类', score: 2.5, student_count: 4, related_kp: '' },
];

/**
 * 获取 seed 兜底关键词数据
 * @returns {Array} 与后端 keywords 接口兼容的关键词数组
 */
export function getSeedKeywords() {
  return SEED_KEYWORDS;
}

/**
 * 判断是否需要使用 seed 兜底数据
 * @param {Array} realKeywords - 真实关键词数组
 * @returns {boolean}
 */
export function shouldUseSeed(realKeywords) {
  return !realKeywords || !Array.isArray(realKeywords) || realKeywords.length === 0;
}

export default SEED_KEYWORDS;
