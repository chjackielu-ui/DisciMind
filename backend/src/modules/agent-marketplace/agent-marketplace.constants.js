const AGENT_STATUSES = Object.freeze(['DRAFT', 'PRIVATE', 'PUBLIC_PENDING', 'PUBLIC', 'REJECTED', 'OFFLINE', 'DELETED']);
const RESPONSE_MODES = Object.freeze(['DEFAULT', 'KNOWLEDGE_FIRST']);
const REVIEW_STATUSES = Object.freeze(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']);
const KNOWLEDGE_VISIBILITIES = Object.freeze(['PRIVATE', 'PUBLIC_PENDING', 'PUBLIC', 'REJECTED', 'OFFLINE']);
const KNOWLEDGE_STATUSES = Object.freeze(['DRAFT', 'EMPTY', 'WAITING_UPLOAD', 'UPLOADING', 'PARSING', 'INDEXING', 'READY', 'FAILED', 'PUBLIC_PENDING', 'PUBLIC', 'REJECTED', 'DISABLED', 'DELETING', 'DELETED']);

const CATEGORIES = Object.freeze([
  '课程学习', '学科答疑', '概念讲解', '题目解析', '考试复习', '学习规划', '科研辅助',
  '论文阅读', '写作表达', '编程学习', '职业与生涯规划', '校园服务', '综合工具', '其他',
]);

const TAG_GROUPS = Object.freeze({
  purpose: ['概念讲解', '学科答疑', '题目解析', '考试复习', '学习规划', '论文阅读', '写作辅导', '编程学习', '资料总结', '其他'],
  style: ['简洁直接', '耐心详细', '循序渐进', '苏格拉底式', '生活化类比', '严谨专业', '鼓励引导', '考试导向'],
  audience: ['初学者', '本科生', '考研学生', '竞赛学生', '教师', '科研人员', '通用用户'],
});

module.exports = {
  AGENT_STATUSES,
  RESPONSE_MODES,
  REVIEW_STATUSES,
  KNOWLEDGE_VISIBILITIES,
  KNOWLEDGE_STATUSES,
  CATEGORIES,
  TAG_GROUPS,
};
