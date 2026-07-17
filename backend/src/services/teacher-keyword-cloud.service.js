// 教师端统一关键词云服务
// 被 teacher-dashboard.service.js（学情词云）和 teacher-lesson-plan.service.js（教案关键词）共同调用
// 确保两套业务输出同一数据源、同一算法

const prisma = require('../config/prisma');

// ======================== 停用词表 ========================
const STOP_WORDS = new Set([
  // ===== 寒暄/礼貌词 =====
  '你好', '谢谢', '感谢', '请问', '好的', '嗯', '哦', '啊', '哎', '哈哈',
  '嘿', '嗨', '拜拜', '再见', '早上好', '下午好', '晚上好', '不客气',
  // ===== 口语化无意义词 =====
  '这个', '那个', '就是', '然后', '感觉', '可以', '怎么', '如何',
  '为什么', '什么', '一个', '一下', '还有', '以及', '你说的',
  '是不是', '能不能', '不会', '我想', '帮我', '老师', '助手',
  '题目', '这道', '那道', '这些', '那些', '一些', '每个', '哪个',
  '的话', '对吧', '是吗', '行吗', '好不好', '怎么办', '怎么样',
  '不太', '有点', '比较', '非常', '真的', '确实', '好像', '大概',
  '也许', '可能吧', '不知道', '不清楚', '不明白', '不太懂',
  // ===== 泛化连接词 =====
  '因为', '所以', '如果', '虽然', '但是', '而且', '或者', '不过',
  '没有', '不是', '我们', '他们', '你们', '自己', '知道',
  '问题', '时候', '这样', '那样', '之后', '之前', '现在', '以后',
  // ===== 无学科意义的泛化动词/副词 =====
  '已经', '可以', '应该', '可能', '需要', '通过', '进行',
  '使用', '利用', '实现', '基于', '相关', '主要', '比较',
  '其中', '之一', '包括', '比如', '例如', '叫做', '称为',
  '所谓', '关于', '对于', '按照', '根据', '因此', '最终',
  '首先', '其次', '最后', '目前', '当前', '一般', '通常',
  '往往', '容易', '很难', '完全', '基本', '某种', '多种',
  '不同', '各种', '大量', '很多', '不少', '少数', '部分',
  '其他', '别的', '整个', '第一', '第二', '第三',
  // ===== 时间/频率词（无学科意义）=====
  '一会儿', '快速', '详细', '简单', '复杂', '直接', '间接',
  '不断', '持续', '正在', '一直', '还是', '或是', '只是',
  // ===== 转折/假设词 =====
  '但是', '可是', '然而', '那么', '既然', '假如', '即使',
  '虽然', '固然',
  // ===== 英文口语 =====
  'hello', 'hi', 'ok', 'okay', 'thanks', 'thank', 'please',
  'yes', 'no', 'sorry', 'well', 'um', 'uh', 'hmm',
  // ===== 学生常见非学科表述 =====
  '知道', '明白', '懂了', '理解', '不清楚', '不明白', '不懂',
  '太难了', '好难', '看不懂', '听不懂', '不会做', '做错了',
  '怎么办', '怎么做', '怎么算', '怎么理解', '什么意思',
  '帮我看看', '帮我看一下', '帮我看下', '看一下', '看下',
  '讲一下', '讲下', '解释下', '解释一下',
  // ===== 界面/系统相关 =====
  '提示', '错误', '成功', '失败', '加载', '提交', '保存',
  '取消', '确定', '返回', '首页', '登录', '注册', '退出',
  '页面', '按钮', '链接', '文件', '下载', '上传',
]);

// ======================== 同义归一化映射 ========================
const SYNONYM_MAP = {
  // ===== 机器学习/AI =====
  'loss函数': '损失函数', 'loss function': '损失函数', '损失函数': '损失函数',
  'lr': '学习率', 'learning rate': '学习率', '学习率': '学习率',
  'activation': '激活函数', '激活函数': '激活函数', '激活': '激活函数',
  'bp': '反向传播', 'back propagation': '反向传播', '反向传播': '反向传播',
  'cnn': '卷积神经网络', '卷积': '卷积神经网络',
  'rnn': '循环神经网络', 'lstm': '长短期记忆网络',
  'transformer': 'Transformer', '注意力': '注意力机制', 'attention': '注意力机制',
  'dropout': 'Dropout',
  // ===== 数学通用 =====
  '正则化': '正则化', '归一化': '归一化', '标准化': '标准化',
  '归一': '归一化', '标化': '标准化',
  '过拟合': '过拟合', '欠拟合': '欠拟合', '拟合': '拟合',
  'train': '训练集', 'test': '测试集', '验证': '验证集', '数据集': '数据集',
  '算法': '算法', '模型': '模型', '函数': '函数', '公式': '公式',
  '微分': '微分', '求导': '求导', '导数': '导数', '偏导': '偏导数',
  '偏导数': '偏导数', '梯度': '梯度', '梯度下降': '梯度下降',
  '极限': '极限', '连续性': '连续性', '连续': '连续性',
  '可导': '可导性', '可微': '可微性',
  // ===== 概率统计 =====
  '概率': '概率', '条件概率': '条件概率', '贝叶斯': '贝叶斯公式',
  'bayes': '贝叶斯公式', 'bayesian': '贝叶斯公式',
  '期望': '数学期望', '方差': '方差', '标准差': '标准差',
  '分布': '分布', '正态分布': '正态分布', '高斯分布': '正态分布',
  '大数定律': '大数定律', '中心极限': '中心极限定理',
  // ===== 线性代数 =====
  '矩阵': '矩阵', '向量': '向量', '特征值': '特征值', '特征向量': '特征向量',
  '行列式': '行列式', '逆矩阵': '逆矩阵', '秩': '矩阵的秩',
  '线性相关': '线性相关', '线性无关': '线性无关',
  // ===== 操作系统 =====
  '进程': '进程', '线程': '线程', '死锁': '死锁',
  '调度': '进程调度', 'pv操作': 'PV操作', '信号量': '信号量',
  '页面置换': '页面置换', '虚拟内存': '虚拟内存', '内存管理': '内存管理',
  '文件系统': '文件系统', 'inode': 'inode',
  // ===== 计算机网络 =====
  'tcp': 'TCP', 'udp': 'UDP', 'http': 'HTTP', 'https': 'HTTPS',
  'dns': 'DNS', 'ip': 'IP地址', '路由': '路由', '交换': '交换',
  '拥塞控制': '拥塞控制', '流量控制': '流量控制',
  '三次握手': '三次握手', '四次挥手': '四次挥手',
  // ===== 数据库 =====
  'sql': 'SQL', '索引': '索引', '事务': '事务', '范式': '范式',
  'acid': 'ACID', 'join': 'JOIN', '查询优化': '查询优化',
  'er图': 'ER图', 'er模型': 'ER模型',
  // ===== 软件工程 =====
  'uml': 'UML', '敏捷': '敏捷开发', '瀑布': '瀑布模型',
  '测试': '软件测试', '需求分析': '需求分析', '设计模式': '设计模式',
  // ===== Web 前端 =====
  'html': 'HTML', 'css': 'CSS', 'javascript': 'JavaScript', 'js': 'JavaScript',
  'dom': 'DOM', '事件冒泡': '事件冒泡', '事件捕获': '事件捕获',
  'flex': 'Flex布局', 'grid': 'Grid布局', '响应式': '响应式设计',
  '闭包': '闭包', '原型链': '原型链', '异步': '异步编程', 'promise': 'Promise',
};

// ======================== 工具函数 ========================

function cleanText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[，。！？、；：""''（）【】《》\s,\.!\?\?;:"'\(\)\[\]{}…—·～@#\$%\^&\*\+=\|\\<>\/\d]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKeyword(word) {
  if (!word) return '';
  const lower = word.toLowerCase().trim();
  if (SYNONYM_MAP[lower]) return SYNONYM_MAP[lower];
  if (/^[a-z]/.test(lower) && lower.length <= 20) return lower;
  return word.trim();
}

function isValidKeyword(word) {
  if (!word || word.length < 2 || word.length > 30) return false;
  const lower = word.toLowerCase().trim();
  // 停用词过滤
  if (STOP_WORDS.has(lower)) return false;
  // 纯数字/运算符/标点残片
  if (/^[\d+\-*/\\=<>\.:,;!?@#$%^&()\[\]{}|~`'"_\s]+$/.test(word)) return false;
  // 单字母或双字母英文缩写（无学科意义的）
  if (/^[a-zA-Z]{1,2}$/.test(word) && !/^[A-Z]{2}$/.test(word)) return false;
  // 纯数字+单位
  if (/^\d+[个次元角分秒年月日]$/.test(word)) return false;
  // 纯数字开头的无意义组合
  if (/^\d+[a-zA-Z]{1,3}$/.test(word)) return false;
  // URL片段
  if (/^(http|https|www|com|cn|org|net|html|php|jsp)$/i.test(word)) return false;
  // 编程语法残片
  if (/^(var|let|const|function|return|import|export|class|this|new|try|catch|if|else|for|while)$/i.test(word)) return false;
  return true;
}

function classifyKeyword(word) {
  const methodWords = ['步骤', '方法', '流程', '计算', '求解', '推导', '证明', '实现', '算法', '函数', '公式', '方程', '模型', '设计', '分析', '评估', '处理', '操作', '配置', '构建', '部署', '测试', '调试', '编译', '运行', '执行', '调用', '传递', '转换', '排序', '查找', '遍历', '递归', '迭代', '循环', '判断', '选择', '优化', '更新', '删除', '插入', '修改'];
  const mistakeWords = ['错误', '区别', '差异', '混淆', '理解', '概念', '定义', '原理', '本质', '特征', '特性', '属性', '关系', '联系', '对比', '异同', '难点', '关键', '陷阱', '注意', '容易', '常见', '误区', '误解', '搞混', '分不清', '记不住', '记错', '弄错', '写错', '算错', '判断', '区分', '辨别', '辨析'];
  const conceptWords = ['概念', '理论', '定理', '定律', '规则', '结构', '系统', '类型', '分类', '模式', '机制', '策略', '应用', '场景', '领域', '方向', '技术', '框架', '基础', '核心', '重点', '知识', '思想', '原理', '定义', '性质', '作用', '特点', '条件', '前提', '结论', '结果', '原因', '因素', '组成', '体系'];

  if (mistakeWords.some(w => word.includes(w))) return '易错理解类';
  if (methodWords.some(w => word.includes(w))) return '方法步骤类';
  if (conceptWords.some(w => word.includes(w))) return '核心概念类';
  if (['好', '难', '有用', '喜欢', '有趣', '满意', '困惑', '清楚', '明白', '谢谢', '感谢', '太难', '简单', '容易', '害怕', '紧张', '焦虑', '无聊', '有趣', '复杂'].some(w => word.includes(w))) return '情绪反馈类';
  return '核心概念类';
}

function getDifficulty(ratio) {
  if (ratio >= 0.7) return '高';
  if (ratio >= 0.4) return '中';
  return '低';
}

// ======================== 主入口 ========================

/**
 * 统一关键词云计算
 * @param {Object} options
 * @param {number} options.courseId - 课程ID
 * @param {number} [options.teachingClassId] - 班级ID
 * @param {number} [options.limit=50] - 返回关键词数量上限
 * @param {number[]} [options.courseIds] - 课程ID数组（学情接口使用）
 * @param {string[]} [options.sources] - 限定数据源，默认全部。
 *   可选值: 'ai_subject_conversation' | 'student_question' | 'confusion_tag' | 'wrong_question'
 *   不传或传空数组 = 全部数据源（兼容旧行为）
 * @param {number[]} [options.studentIds] - 已完成权限收敛的学生范围
 * @param {Date} [options.rangeStart] - 统计开始时间
 * @param {Date} [options.rangeEnd] - 统计结束时间
 * @returns {Promise<{word_cloud: Array, total_students: number, total_questions: number}>}
 */
async function computeKeywordCloud(options = {}) {
  const { courseId, teachingClassId, limit = 50, courseIds, sources, studentIds: scopedStudentIds, rangeStart, rangeEnd } = options;
  // sources 为空或未传时默认全部数据源（兼容 dashboard 旧调用）
  const useAllSources = !sources || sources.length === 0;
  const useSource = (name) => useAllSources || sources.includes(name);
  const effectiveCourseId = courseId || (courseIds && courseIds[0]);

  // ---- 1. 加载知识点（用于相关性匹配）----
  const whereKp = {};
  if (courseIds && courseIds.length > 0) {
    whereKp.course_id = { in: courseIds };
  } else if (effectiveCourseId) {
    whereKp.course_id = effectiveCourseId;
  }
  const knowledgePoints = await prisma.knowledgePoint.findMany({
    where: whereKp,
    include: { aliases: true },
  });

  const kpTermSet = new Set();
  const kpNameById = {};
  for (const kp of knowledgePoints) {
    if (kp.knowledge_point_name) {
      kpTermSet.add(kp.knowledge_point_name.toLowerCase());
      kpNameById[kp.knowledge_point_id] = kp.knowledge_point_name;
    }
    for (const alias of kp.aliases) {
      if (alias.alias_text) kpTermSet.add(alias.alias_text.toLowerCase());
    }
  }

  function isRelatedToKnowledgePoint(term) {
    if (!term || term.length < 2) return false;
    const lower = term.toLowerCase();
    if (kpTermSet.has(lower)) return true;
    for (const kpTerm of kpTermSet) {
      if (kpTerm.includes(lower) || lower.includes(kpTerm)) return true;
    }
    return false;
  }

  // ---- 2. 加载学生提问记录（仅在 source 包含 student_question 或全部源时）----
  let questions = [];
  if (useSource('student_question')) {
  const questionWhere = {};
  if (effectiveCourseId) questionWhere.course_id = effectiveCourseId;
  if (courseIds && courseIds.length > 0) {
    questionWhere.course_id = { in: courseIds };
  }
  if (Array.isArray(scopedStudentIds)) questionWhere.student_user_id = { in: scopedStudentIds };
  if (rangeStart || rangeEnd) questionWhere.created_at = { ...(rangeStart ? { gte: rangeStart } : {}), ...(rangeEnd ? { lte: rangeEnd } : {}) };

  questions = await prisma.studentQuestionRecord.findMany({
    where: {
      ...questionWhere,
      OR: [
        { conversation_id: null },
        { conversation: { agent_type: 'COURSE_QA' } },
      ],
    },
    include: {
      analysis_records: {
        include: { knowledge_point: true, keywords: true, confusion_tags: true },
        take: 1,
      },
    },
    orderBy: { created_at: 'desc' },
    take: 500,
  });
  } // end if useSource('student_question')

  // ---- 3. 加载错题数据（仅在 source 包含 wrong_question 或全部源时）----
  let wrongQuestions = [];
  if (useSource('wrong_question')) {
  const wrongQWhere = {};
  if (effectiveCourseId) wrongQWhere.course_id = effectiveCourseId;
  if (Array.isArray(scopedStudentIds)) wrongQWhere.student_user_id = { in: scopedStudentIds };
  if (rangeStart || rangeEnd) wrongQWhere.created_at = { ...(rangeStart ? { gte: rangeStart } : {}), ...(rangeEnd ? { lte: rangeEnd } : {}) };
  wrongQuestions = await prisma.wrongQuestion.findMany({
    where: { ...wrongQWhere, status: { not: 'REMOVED' } },
    include: { knowledge_point: true },
    take: 100,
  });
  } // end if useSource('wrong_question')

  // ---- 4. 加载混淆标签（仅在 source 包含 confusion_tag 或全部源时）----
  let confusionTags = [];
  if (useSource('confusion_tag')) {
  const confusionTagWhere = {};
  if (effectiveCourseId || Array.isArray(scopedStudentIds) || rangeStart || rangeEnd) confusionTagWhere.analysis = { student_question: {
    ...(effectiveCourseId ? { course_id: effectiveCourseId } : {}),
    ...(Array.isArray(scopedStudentIds) ? { student_user_id: { in: scopedStudentIds } } : {}),
    ...((rangeStart || rangeEnd) ? { created_at: { ...(rangeStart ? { gte: rangeStart } : {}), ...(rangeEnd ? { lte: rangeEnd } : {}) } } : {}),
  } };
  confusionTags = await prisma.questionConfusionTag.findMany({
    where: confusionTagWhere,
    take: 100,
  });
  } // end if useSource('confusion_tag')

  // ---- 4b. 加载学科专属助手对话（仅在 source 包含 ai_subject_conversation 或全部源时）----
  let aiConversationMessages = [];
  if (useSource('ai_subject_conversation')) {
  // 获取课程内学生列表
  const enrollmentWhere = {};
  if (effectiveCourseId) enrollmentWhere.course_id = effectiveCourseId;
  if (courseIds && courseIds.length > 0) enrollmentWhere.course_id = { in: courseIds };
  const enrolledStudents = Array.isArray(scopedStudentIds) ? [] : await prisma.studentCourseEnrollment.findMany({
    where: { ...enrollmentWhere, enrollment_status: 'active', ...(teachingClassId ? { teaching_class_id: teachingClassId } : {}) },
    select: { student_user_id: true },
    distinct: ['student_user_id'],
  });
  const studentIds = Array.isArray(scopedStudentIds) ? scopedStudentIds : enrolledStudents.map(e => e.student_user_id);

  // 读取这些学生的学科专属助手对话（mode=SUBJECT）
  if (studentIds.length > 0) {
    const aiConversations = await prisma.aiConversation.findMany({
      where: { userId: { in: studentIds }, mode: 'SUBJECT' },
      select: { id: true, userId: true, subject: true },
      take: 50,
      orderBy: { updatedAt: 'desc' },
    });
    if (aiConversations.length > 0) {
      const convIds = aiConversations.map(c => c.id);
      aiConversationMessages = await prisma.aiMessage.findMany({
        where: { conversationId: { in: convIds }, role: 'USER', ...((rangeStart || rangeEnd) ? { createdAt: { ...(rangeStart ? { gte: rangeStart } : {}), ...(rangeEnd ? { lte: rangeEnd } : {}) } } : {}) },
        select: { content: true, conversationId: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      // 建立 conversationId → userId + subject 映射，用于后续关联知识点
      const convMetaMap = {};
      for (const c of aiConversations) {
        convMetaMap[c.id] = { userId: c.userId, subject: c.subject };
      }
      // 将映射暂存以供后续聚合使用
      for (const msg of aiConversationMessages) {
        msg._meta = convMetaMap[msg.conversationId] || null;
      }
    }
  }
  } // end if useSource('ai_subject_conversation')

  // ---- 5. 关键词聚合 ----
  const globalMap = {};       // key: normalized lower word → aggregated data
  const studentQuestionMap = {}; // key: word → Set<student_user_id>
  const wrongCountMap = {};   // key: word → wrong_count

  // 5a. 错题统计
  wrongQuestions.forEach(wq => {
    const name = wq.knowledge_point?.knowledge_point_name;
    if (name) {
      const key = name.toLowerCase().trim();
      wrongCountMap[key] = (wrongCountMap[key] || 0) + 1;
    }
  });

  // 5b. 混淆标签
  confusionTags.forEach(t => {
    const tag = (t.tag || '').trim().toLowerCase();
    if (tag && tag.length > 1 && isValidKeyword(tag) && isRelatedToKnowledgePoint(tag)) {
      const norm = normalizeKeyword(tag);
      const nk = norm.toLowerCase();
      if (!globalMap[nk]) globalMap[nk] = { count: 0, students: new Set(), kpIds: new Set(), sources: [] };
      globalMap[nk].count += 1;
      globalMap[nk].sources.push('confusion_tag');
    }
  });

  // 5c. 遍历学生提问记录
  const totalStudentSet = new Set();
  for (const q of questions) {
    totalStudentSet.add(q.student_user_id);
    const analysis = q.analysis_records?.[0];

    // 收集该问题的关联知识点ID
    const relatedKpIds = new Set();
    if (analysis?.knowledge_point_id) relatedKpIds.add(analysis.knowledge_point_id);
    if (analysis?.knowledge_point?.knowledge_point_name) {
      relatedKpIds.add(analysis.knowledge_point_id);
    }

    // 收集该问题所有待提取的文本
    const rawTexts = [];

    // AI关键词
    if (analysis?.keywords) {
      analysis.keywords.forEach(kw => {
        const word = normalizeKeyword(kw.keyword);
        if (isValidKeyword(word) && isRelatedToKnowledgePoint(word)) {
          rawTexts.push(word);
        }
      });
    }

    // 知识点名称
    if (analysis?.knowledge_point?.knowledge_point_name) {
      rawTexts.push(analysis.knowledge_point.knowledge_point_name);
    }

    // 原始问题文本
    if (q.raw_question) {
      const cleaned = cleanText(q.raw_question);
      const words = [...new Set(cleaned.split(/\s+/).filter(w => isValidKeyword(w) && isRelatedToKnowledgePoint(w)))];
      words.forEach(w => rawTexts.push(normalizeKeyword(w)));
    }

    // ChatMessage 对话内容
    if (q.conversation_id) {
      try {
        const messages = await prisma.chatMessage.findMany({
          where: { conversation_id: q.conversation_id, role: { in: ['USER', 'user'] } },
          select: { content: true },
          orderBy: { message_id: 'asc' },
          take: 10,
        });
        messages.forEach(m => {
          if (m.content) {
            const cleaned = cleanText(m.content);
            const words = [...new Set(cleaned.split(/\s+/).filter(w => isValidKeyword(w) && isRelatedToKnowledgePoint(w)))];
            words.forEach(w => rawTexts.push(normalizeKeyword(w)));
          }
        });
      } catch (e) { /* ignore */ }
    }

    // 去重后聚合
    const uniqueTexts = [...new Set(rawTexts)];
    for (const word of uniqueTexts) {
      const nk = word.toLowerCase();
      if (!globalMap[nk]) {
        globalMap[nk] = { count: 0, students: new Set(), kpIds: new Set(), sources: [] };
      }
      globalMap[nk].count += 1;
      globalMap[nk].students.add(q.student_user_id);
      relatedKpIds.forEach(id => globalMap[nk].kpIds.add(id));
      globalMap[nk].sources.push('student_question');
    }
  }

  // 5d. 学科专属助手对话文本提取（AiConversation mode=SUBJECT）
  for (const msg of aiConversationMessages) {
    if (!msg.content) continue;
    const cleaned = cleanText(msg.content);
    const words = [...new Set(cleaned.split(/\s+/).filter(w => isValidKeyword(w) && isRelatedToKnowledgePoint(w)))];
    const studentId = msg._meta?.userId;
    for (const rawWord of words) {
      const word = normalizeKeyword(rawWord);
      const nk = word.toLowerCase();
      if (!globalMap[nk]) {
        globalMap[nk] = { count: 0, students: new Set(), kpIds: new Set(), sources: [] };
      }
      globalMap[nk].count += 1;
      if (studentId) {
        globalMap[nk].students.add(studentId);
        totalStudentSet.add(studentId);
      }
      globalMap[nk].sources.push('ai_subject_conversation');
    }
  }

  // ---- 6. 计算加权得分 ----
  const totalStudents = totalStudentSet.size || 1;
  const maxCount = Math.max(1, ...Object.values(globalMap).map(v => v.count));
  const maxWrong = Math.max(1, ...Object.values(wrongCountMap), 1);

  const scored = Object.entries(globalMap).map(([key, data]) => {
    const rawCount = data.count;
    const distinctStudents = data.students.size;
    const wrongCount = wrongCountMap[key] || 0;

    // 基础频次分 F (0-10)
    const F = Math.min(rawCount / maxCount, 1) * 10;

    // 学生覆盖分 S (0-10) — 核心指标
    const studentRatio = distinctStudents / totalStudents;
    const S = Math.min(studentRatio, 1) * 10;

    // 错题加权分 W (0-10)
    const W = Math.min(wrongCount / maxWrong, 1) * 10;

    // 知识点层级分 K (0-10)
    const kpBoost = data.kpIds.size > 0 ? Math.min(data.kpIds.size / 3, 1) * 10 : 0;
    const K = kpBoost;

    // 单人重复衰减：同一学生反复提问同一词，频次被压缩
    const avgRepeatPerStudent = distinctStudents > 0 ? rawCount / distinctStudents : 1;
    const decayFactor = avgRepeatPerStudent > 3 ? Math.log2(2 + avgRepeatPerStudent - 3) : 1;
    const effectiveCount = rawCount / decayFactor;

    // 综合得分 (0-10)
    const score = F * 0.30 + S * 0.35 + W * 0.20 + K * 0.15;

    // 低分过滤
    if (score < 2) return null;

    // 学生覆盖过滤
    if (studentRatio < 0.1 && distinctStudents < 2) return null;

    return {
      keyword: key,                        // 主字段：归一化后的关键词
      char_length: key.length,             // 字符长度（词云字体大小映射：越长得越大，但高频短词不受影响）
      frequency: Math.round(effectiveCount), // 衰减后的有效频次
      count: Math.round(effectiveCount),    // 频次（兼容字段）
      score: Math.round(score * 10) / 10,  // 综合加权得分 (0-10)
      student_count: distinctStudents,      // 提问学生人数（核心指标）
      difficulty: '低',                      // 暂定，排序后根据得分ratio重新计算
      category: classifyKeyword(key),       // 四类分类
      related_kp: data.kpIds.size > 0
        ? [...data.kpIds].map(id => kpNameById[id]).filter(Boolean).join('、')
        : '',
      related_kp_ids: [...data.kpIds],
      sources: [...new Set(data.sources)],   // 数据来源列表（去重）
      source_count: data.sources.length,     // 来源总次数（含重复）
      rank: 0,                              // 排序后设置
      teacher_note: '',                     // 排序后生成
    };
  }).filter(Boolean);

  // ---- 7. 排序 + 难度 + 排名 + 教师备注 ----
  scored.sort((a, b) => b.score - a.score);
  const maxScore = scored.length > 0 ? scored[0].score : 1;
  scored.forEach((item, i) => {
    const ratio = item.score / maxScore;
    item.difficulty = getDifficulty(ratio);
    item.rank = i + 1;

    // 生成教师备注（teacher_note）
    const diffLabel = item.difficulty === '高' ? '需重点讲解、优先复习' : item.difficulty === '中' ? '需关注、建议课堂提及' : '简要提及即可';
    const catLabel = item.category === '易错理解类' ? '建议设计对比案例或辨析练习'
      : item.category === '方法步骤类' ? '建议分步演示、增加实操练习'
      : item.category === '情绪反馈类' ? '建议关注学生学习体验、调整教学节奏'
      : '建议作为知识框架的核心节点';
    item.teacher_note = `${diffLabel}；${catLabel}。${item.student_count}名学生涉及，关联知识点：${item.related_kp || '待确认'}`;
  });

  const result = scored.slice(0, limit);

  return {
    word_cloud: result,
    total_students: totalStudentSet.size,
    total_questions: questions.length,
  };
}

module.exports = {
  computeKeywordCloud,
  // 工具函数导出供其他模块使用
  STOP_WORDS,
  SYNONYM_MAP,
  cleanText,
  normalizeKeyword,
  isValidKeyword,
  classifyKeyword,
};
