// DisciMind 种子数据脚本 v1.0
// 用途：为开发/演示环境插入初始数据
// 可重复运行：通过 findUnique/findFirst 检查是否已存在，避免重复插入报错
//
// 执行方式：
//   1. node backend/prisma/seed.js
//   2. npx prisma db seed（需先在 backend/package.json 中配置 "prisma": { "seed": "node prisma/seed.js" }）
//
// 种子内容：
//   - 3 个 Demo 账号（admin/teacher/student）
//   - 1 个行政班级（软件2403班）
//   - 1 门课程（机器学习 ML001）
//   - 1 个教学班（机器学习1班）
//   - 课程-教师关系
//   - 学生选课入班
//   - 3 个章节
//   - 10 个知识点
//   - 知识点别名
//   - 至少 5 道 PCA 相关题目（单选/多选/判断/填空/简答）
//   - 学习任务与提交
//   - 答题记录
//   - 错题记录
//   - 知识点掌握度
//   - 学生画像
//   - AI 会话与消息
//   - 推荐记录

require('dotenv/config')
const { PrismaClient } = require('@prisma/client')
const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
const bcrypt = require('bcryptjs')

const adapter = new PrismaMariaDb({
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT) || 3306,
  user: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'discimind',
  connectionLimit: 5,
})

const prisma = new PrismaClient({ adapter })

// ========================
// 工具函数
// ========================

const PASSWORD_HASH = bcrypt.hashSync('123456', 10)

function log(msg) {
  console.log(`[seed] ${msg}`)
}

// ========================
// 主流程
// ========================

async function main() {
  log('========== DisciMind 种子数据脚本开始 ==========')

  // --------------------------------------------------
  // 1. 创建三个 Demo 用户
  // --------------------------------------------------
  log('1/21 创建用户...')

  let adminUser = await prisma.user.findUnique({ where: { username: 'admin_demo' } })
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        username: 'admin_demo',
        password_hash: PASSWORD_HASH,
        role: 'ADMIN',
        status: 'ACTIVE',
        phone: '13800000001',
        email: 'admin@discimind.demo',
        last_login_at: new Date(),
      },
    })
    log('  已创建 admin_demo')
  } else {
    log('  admin_demo 已存在，跳过')
  }

  let teacherUser = await prisma.user.findUnique({ where: { username: 'teacher_demo' } })
  if (!teacherUser) {
    teacherUser = await prisma.user.create({
      data: {
        username: 'teacher_demo',
        password_hash: PASSWORD_HASH,
        role: 'TEACHER',
        status: 'ACTIVE',
        phone: '13800000002',
        email: 'teacher@discimind.demo',
        last_login_at: new Date(),
      },
    })
    log('  已创建 teacher_demo')
  } else {
    log('  teacher_demo 已存在，跳过')
  }

  let studentUser = await prisma.user.findUnique({ where: { username: 'student_demo' } })
  if (!studentUser) {
    studentUser = await prisma.user.create({
      data: {
        username: 'student_demo',
        password_hash: PASSWORD_HASH,
        role: 'STUDENT',
        status: 'ACTIVE',
        phone: '13800000003',
        email: 'student@discimind.demo',
        last_login_at: new Date(),
      },
    })
    log('  已创建 student_demo')
  } else {
    log('  student_demo 已存在，跳过')
  }

  // --------------------------------------------------
  // 2. 创建用户资料
  // --------------------------------------------------
  log('2/21 创建用户资料...')

  let adminProfile = await prisma.userProfile.findUnique({ where: { user_id: adminUser.user_id } })
  if (!adminProfile) {
    adminProfile = await prisma.userProfile.create({
      data: {
        user_id: adminUser.user_id,
        real_name: '管理员演示',
        gender: 'MALE',
        college: '计算机与软件工程学院',
      },
    })
    log('  已创建管理员资料')
  } else {
    log('  管理员资料已存在，跳过')
  }

  let teacherProfile = await prisma.userProfile.findUnique({ where: { user_id: teacherUser.user_id } })
  if (!teacherProfile) {
    teacherProfile = await prisma.userProfile.create({
      data: {
        user_id: teacherUser.user_id,
        real_name: '教师演示',
        gender: 'FEMALE',
        teacher_no: 'T2024001',
        college: '计算机与软件工程学院',
        major: '计算机科学与技术',
      },
    })
    log('  已创建教师资料')
  } else {
    log('  教师资料已存在，跳过')
  }

  let studentProfile = await prisma.userProfile.findUnique({ where: { user_id: studentUser.user_id } })
  if (!studentProfile) {
    studentProfile = await prisma.userProfile.create({
      data: {
        user_id: studentUser.user_id,
        real_name: '学生演示',
        gender: 'MALE',
        student_no: 'S2024001',
        college: '计算机与软件工程学院',
        major: '软件工程',
        grade: '2024',
      },
    })
    log('  已创建学生资料')
  } else {
    log('  学生资料已存在，跳过')
  }

  // --------------------------------------------------
  // 3. 创建行政班级：软件2403班
  // --------------------------------------------------
  log('3/21 创建行政班级...')

  let adminClass = await prisma.adminClass.findFirst({
    where: { class_name: '软件2403班', grade: '2024' },
  })
  if (!adminClass) {
    adminClass = await prisma.adminClass.create({
      data: {
        class_name: '软件2403班',
        college: '计算机与软件工程学院',
        major: '软件工程',
        grade: '2024',
      },
    })
    log('  已创建软件2403班')
  } else {
    log('  软件2403班已存在，跳过')
  }

  // 更新学生资料，绑定行政班级
  if (studentProfile.admin_class_id !== adminClass.admin_class_id) {
    await prisma.userProfile.update({
      where: { user_id: studentUser.user_id },
      data: { admin_class_id: adminClass.admin_class_id },
    })
    log('  已将 student_demo 绑定到软件2403班')
  }

  // --------------------------------------------------
  // 4. 创建课程：机器学习 ML001
  // --------------------------------------------------
  log('4/21 创建课程...')

  let course = await prisma.course.findUnique({ where: { course_code: 'ML001' } })
  if (!course) {
    course = await prisma.course.create({
      data: {
        course_name: '机器学习',
        course_code: 'ML001',
        subject_category: '计算机大类学科',
        description: '本课程系统介绍机器学习的基本概念、经典算法和实际应用，涵盖监督学习、无监督学习、模型评估等核心内容。适合计算机科学与技术、软件工程等相关专业本科生学习。',
        status: 'ACTIVE',
      },
    })
    log('  已创建机器学习课程')
  } else {
    log('  机器学习课程已存在，跳过')
  }

  // --------------------------------------------------
  // 5. 创建教学班级：机器学习1班
  // --------------------------------------------------
  log('5/21 创建教学班级...')

  let teachingClass = await prisma.teachingClass.findFirst({
    where: { course_id: course.course_id, teaching_class_name: '机器学习1班' },
  })
  if (!teachingClass) {
    teachingClass = await prisma.teachingClass.create({
      data: {
        course_id: course.course_id,
        teaching_class_name: '机器学习1班',
        semester: '2025-2026-2',
        description: '机器学习课程教学1班，面向软件工程专业2024级学生。',
      },
    })
    log('  已创建机器学习1班')
  } else {
    log('  机器学习1班已存在，跳过')
  }

  // --------------------------------------------------
  // 6. 创建课程-教师关系：teacher_demo 为主讲教师
  // --------------------------------------------------
  log('6/21 创建课程-教师关系...')

  let teacherRelation = await prisma.courseTeacherRelation.findUnique({
    where: {
      course_id_teacher_user_id: {
        course_id: course.course_id,
        teacher_user_id: teacherUser.user_id,
      },
    },
  })
  if (!teacherRelation) {
    teacherRelation = await prisma.courseTeacherRelation.create({
      data: {
        course_id: course.course_id,
        teacher_user_id: teacherUser.user_id,
        teacher_role: 'MAIN_TEACHER',
      },
    })
    log('  已绑定 teacher_demo 为机器学习课程主讲教师')
  } else {
    log('  课程-教师关系已存在，跳过')
  }

  // --------------------------------------------------
  // 7. 创建学生选课入班记录
  // --------------------------------------------------
  log('7/21 创建学生选课入班记录...')

  let enrollment = await prisma.studentCourseEnrollment.findFirst({
    where: {
      student_user_id: studentUser.user_id,
      course_id: course.course_id,
      teaching_class_id: teachingClass.teaching_class_id,
    },
  })
  if (!enrollment) {
    enrollment = await prisma.studentCourseEnrollment.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: course.course_id,
        teaching_class_id: teachingClass.teaching_class_id,
        enrollment_status: 'active',
      },
    })
    log('  已添加 student_demo 到机器学习1班')
  } else {
    log('  选课记录已存在，跳过')
  }

  // --------------------------------------------------
  // 8. 创建章节
  // --------------------------------------------------
  log('8/21 创建章节...')

  const chapterDefs = [
    { chapter_name: '机器学习概述', chapter_order: 1, description: '机器学习基本概念、发展历史、应用场景' },
    { chapter_name: '经典机器学习算法', chapter_order: 2, description: '监督学习与无监督学习的核心算法' },
    { chapter_name: '模型评估与优化', chapter_order: 3, description: '模型评估指标、过拟合与欠拟合、调参方法' },
  ]

  const chapters = {}
  for (const def of chapterDefs) {
    let chapter = await prisma.chapter.findFirst({
      where: { course_id: course.course_id, chapter_name: def.chapter_name },
    })
    if (!chapter) {
      chapter = await prisma.chapter.create({
        data: {
          course_id: course.course_id,
          chapter_name: def.chapter_name,
          chapter_order: def.chapter_order,
          description: def.description,
        },
      })
      log(`  已创建章节：${def.chapter_name}`)
    } else {
      log(`  章节 ${def.chapter_name} 已存在，跳过`)
    }
    chapters[def.chapter_name] = chapter
  }

  // --------------------------------------------------
  // 9. 创建 10 个知识点
  // --------------------------------------------------
  log('9/21 创建知识点...')

  const kpDefs = [
    {
      code: 'ML-KP-001', name: '监督学习',
      chapter: '机器学习概述', difficulty: 'BASIC', order: 1,
      desc: '监督学习是利用已标注数据训练模型的机器学习方法，包括分类和回归两大任务。',
    },
    {
      code: 'ML-KP-002', name: '无监督学习',
      chapter: '机器学习概述', difficulty: 'BASIC', order: 2,
      desc: '无监督学习在无标签数据中发现隐藏模式，包括聚类、降维、关联规则等。',
    },
    {
      code: 'ML-KP-003', name: '线性回归',
      chapter: '经典机器学习算法', difficulty: 'BASIC', order: 3,
      desc: '线性回归是最基础的回归算法，通过拟合线性函数预测连续值输出。',
    },
    {
      code: 'ML-KP-004', name: '逻辑回归',
      chapter: '经典机器学习算法', difficulty: 'BASIC', order: 4,
      desc: '逻辑回归是一种广泛应用于二分类问题的线性分类算法。',
    },
    {
      code: 'ML-KP-005', name: '决策树',
      chapter: '经典机器学习算法', difficulty: 'MEDIUM', order: 5,
      desc: '决策树通过树形结构进行决策，具有可解释性强的特点。',
    },
    {
      code: 'ML-KP-006', name: 'K-means 聚类',
      chapter: '经典机器学习算法', difficulty: 'MEDIUM', order: 6,
      desc: 'K-means 是最经典的基于距离的聚类算法，将数据划分为 K 个簇。',
    },
    {
      code: 'ML-KP-007', name: 'PCA 主成分分析',
      chapter: '经典机器学习算法', difficulty: 'MEDIUM', order: 7,
      desc: 'PCA 通过线性变换将高维数据投影到低维空间，保留最大方差方向，是最常用的降维方法之一。',
    },
    {
      code: 'ML-KP-008', name: 'SVM 支持向量机',
      chapter: '经典机器学习算法', difficulty: 'HARD', order: 8,
      desc: '支持向量机通过寻找最大间隔超平面实现分类，可使用核函数处理非线性问题。',
    },
    {
      code: 'ML-KP-009', name: '神经网络基础',
      chapter: '经典机器学习算法', difficulty: 'HARD', order: 9,
      desc: '介绍人工神经网络的基本结构、激活函数、前向传播与反向传播算法。',
    },
    {
      code: 'ML-KP-010', name: '模型评估指标',
      chapter: '模型评估与优化', difficulty: 'MEDIUM', order: 10,
      desc: '准确率、精确率、召回率、F1-Score、AUC-ROC 等常用模型评估指标。',
    },
  ]

  const knowledgePoints = {}
  for (const kp of kpDefs) {
    let kpRecord = await prisma.knowledgePoint.findFirst({
      where: { course_id: course.course_id, knowledge_point_code: kp.code },
    })
    if (!kpRecord) {
      kpRecord = await prisma.knowledgePoint.create({
        data: {
          course_id: course.course_id,
          chapter_id: chapters[kp.chapter].chapter_id,
          knowledge_point_name: kp.name,
          knowledge_point_code: kp.code,
          description: kp.desc,
          difficulty_level: kp.difficulty,
          sort_order: kp.order,
        },
      })
      log(`  已创建知识点：${kp.code} ${kp.name}`)
    } else {
      log(`  知识点 ${kp.code} 已存在，跳过`)
    }
    knowledgePoints[kp.code] = kpRecord
  }

  // --------------------------------------------------
  // 10. 创建知识点别名
  // --------------------------------------------------
  log('10/21 创建知识点别名...')

  const aliasMap = {
    'ML-KP-001': ['Supervised Learning', '有监督学习', '监督式学习', '有标签学习'],
    'ML-KP-002': ['Unsupervised Learning', '无监督式学习', '聚类分析', '无标签学习'],
    'ML-KP-003': ['Linear Regression', '线性拟合', '最小二乘法', 'OLS'],
    'ML-KP-004': ['Logistic Regression', '对数几率回归', 'Logit回归', '分类回归'],
    'ML-KP-005': ['Decision Tree', '判定树', '分类树', 'CART', 'C4.5', 'ID3'],
    'ML-KP-006': ['K-means', 'K均值', 'K-means 算法', 'K 均值聚类', 'K均值聚类'],
    'ML-KP-007': ['PCA', '主成分分析', 'Principal Component Analysis', '降维', '特征降维', 'KL变换', 'SVD降维'],
    'ML-KP-008': ['SVM', 'Support Vector Machine', '支持向量机', '最大间隔分类器', '核方法'],
    'ML-KP-009': ['Neural Network', 'ANN', '人工神经网络', '深度学习基础', 'BP算法', '反向传播'],
    'ML-KP-010': ['准确率', '精确率', '召回率', 'F1', 'AUC', 'ROC', '混淆矩阵', 'Accuracy', 'Precision', 'Recall'],
  }

  for (const [code, aliases] of Object.entries(aliasMap)) {
    const kp = knowledgePoints[code]
    for (const aliasText of aliases) {
      const exists = await prisma.knowledgePointAlias.findUnique({
        where: {
          knowledge_point_id_alias_text: {
            knowledge_point_id: kp.knowledge_point_id,
            alias_text: aliasText,
          },
        },
      })
      if (!exists) {
        await prisma.knowledgePointAlias.create({
          data: {
            knowledge_point_id: kp.knowledge_point_id,
            alias_text: aliasText,
            source: 'system',
          },
        })
      }
    }
  }
  log('  知识点别名创建完成')

  // --------------------------------------------------
  // 11. 创建题目（至少 5 道 PCA 相关题目）
  // --------------------------------------------------
  log('11/21 创建题目...')
  const pcaKp = knowledgePoints['ML-KP-007']

  // 辅助函数：检查题目是否已存在
  async function findOrCreateQuestion(uniqueTitle, data) {
    let q = await prisma.question.findFirst({
      where: { course_id: course.course_id, title: uniqueTitle },
    })
    if (!q) {
      q = await prisma.question.create({ data })
      log(`  已创建题目：${uniqueTitle}`)
    } else {
      log(`  题目已存在：${uniqueTitle}，跳过`)
    }
    return q
  }

  // 11.1 单选题
  const q1 = await findOrCreateQuestion('PCA的主要目的', {
    course_id: course.course_id,
    knowledge_point_id: pcaKp.knowledge_point_id,
    question_type: 'SINGLE_CHOICE',
    title: 'PCA的主要目的',
    content: 'PCA（主成分分析）的主要目的是什么？',
    correct_answer: { type: 'single', answer: 'B' },
    analysis: 'PCA的核心目标是对高维数据进行降维，通过线性变换将原始数据投影到低维空间，同时尽可能保留数据中的方差信息。',
    difficulty_level: 'BASIC',
    score: 5,
    is_ai_generated: false,
    created_by_user_id: teacherUser.user_id,
    status: 'active',
  })

  // 创建单选题选项
  const q1Options = [
    { key: 'A', content: '对数据进行分类', order: 1 },
    { key: 'B', content: '对数据进行降维', order: 2 },
    { key: 'C', content: '对数据进行聚类', order: 3 },
    { key: 'D', content: '对数据进行回归预测', order: 4 },
  ]
  for (const opt of q1Options) {
    await prisma.questionOption.upsert({
      where: { question_id_option_key: { question_id: q1.question_id, option_key: opt.key } },
      update: { option_content: opt.content, option_order: opt.order },
      create: { question_id: q1.question_id, option_key: opt.key, option_content: opt.content, option_order: opt.order },
    })
  }

  // 11.2 多选题
  const q2 = await findOrCreateQuestion('关于PCA说法正确的有', {
    course_id: course.course_id,
    knowledge_point_id: pcaKp.knowledge_point_id,
    question_type: 'MULTIPLE_CHOICE',
    title: '关于PCA说法正确的有',
    content: '关于PCA（主成分分析），以下说法正确的有哪些？',
    correct_answer: { type: 'multiple', answer: ['A', 'B', 'C', 'D'] },
    analysis: 'PCA是一种无监督学习的降维方法，通过线性变换实现，保留方差最大的方向（主成分），常用于高维数据的可视化。PCA对数据缩放敏感，需要先进行标准化处理。',
    difficulty_level: 'MEDIUM',
    score: 10,
    is_ai_generated: false,
    created_by_user_id: teacherUser.user_id,
    status: 'active',
  })

  const q2Options = [
    { key: 'A', content: 'PCA是一种无监督学习方法', order: 1 },
    { key: 'B', content: 'PCA通过线性变换实现降维', order: 2 },
    { key: 'C', content: 'PCA保留数据中方差最大的方向', order: 3 },
    { key: 'D', content: 'PCA可以用于高维数据可视化', order: 4 },
  ]
  for (const opt of q2Options) {
    await prisma.questionOption.upsert({
      where: { question_id_option_key: { question_id: q2.question_id, option_key: opt.key } },
      update: { option_content: opt.content, option_order: opt.order },
      create: { question_id: q2.question_id, option_key: opt.key, option_content: opt.content, option_order: opt.order },
    })
  }

  // 11.3 判断题
  const q3 = await findOrCreateQuestion('PCA第一主成分判断', {
    course_id: course.course_id,
    knowledge_point_id: pcaKp.knowledge_point_id,
    question_type: 'TRUE_FALSE',
    title: 'PCA第一主成分判断',
    content: '在PCA主成分分析中，第一主成分是数据方差最小的方向。',
    correct_answer: { type: 'true_false', answer: false },
    analysis: 'PCA的第一主成分是数据方差最大的方向，而非最小。各主成分按方差从大到小排序，第一主成分捕获数据中最多的变异信息。',
    difficulty_level: 'BASIC',
    score: 3,
    is_ai_generated: false,
    created_by_user_id: teacherUser.user_id,
    status: 'active',
  })

  // 11.4 填空题
  const q4 = await findOrCreateQuestion('PCA英文全称', {
    course_id: course.course_id,
    knowledge_point_id: pcaKp.knowledge_point_id,
    question_type: 'BLANK',
    title: 'PCA英文全称',
    content: 'PCA的英文全称是______，中文翻译为______。',
    correct_answer: { type: 'blank', answer: ['Principal Component Analysis', '主成分分析'] },
    answer_keywords: ['Principal Component Analysis', '主成分分析', 'PCA', '主成分'],
    analysis: 'PCA全称为Principal Component Analysis（主成分分析），由Karl Pearson于1901年提出，后由Harold Hotelling在1930年代进一步发展。',
    difficulty_level: 'BASIC',
    score: 4,
    is_ai_generated: false,
    created_by_user_id: teacherUser.user_id,
    status: 'active',
  })

  // 11.5 简答题
  const q5 = await findOrCreateQuestion('简述PCA基本步骤', {
    course_id: course.course_id,
    knowledge_point_id: pcaKp.knowledge_point_id,
    question_type: 'SHORT_ANSWER',
    title: '简述PCA基本步骤',
    content: '请简述PCA（主成分分析）算法的基本步骤，并说明每一步的作用。',
    correct_answer: {
      type: 'short_answer',
      steps: [
        '数据标准化：将各特征均值归零、方差归一，消除量纲影响',
        '计算协方差矩阵：反映各特征之间的相关性',
        '计算特征值和特征向量：对协方差矩阵进行特征分解',
        '选择主成分：按特征值从大到小排序，选取前k个特征向量',
        '投影变换：将原始数据投影到选取的k个主成分上，得到降维后的数据',
      ],
    },
    answer_keywords: ['标准化', '协方差矩阵', '特征值', '特征向量', '方差', '降维', '投影', '主成分', '排序', '归一化'],
    analysis: 'PCA的五个核心步骤：标准化消除量纲→协方差矩阵获取特征关系→特征分解→按方差大小选主成分→投影得到低维表示。关键在于保留方差最大的方向。',
    difficulty_level: 'MEDIUM',
    score: 15,
    is_ai_generated: false,
    created_by_user_id: teacherUser.user_id,
    status: 'active',
  })

  // 额外一道 PCA 单选题（让题目更丰富）
  const q6 = await findOrCreateQuestion('PCA数据预处理步骤', {
    course_id: course.course_id,
    knowledge_point_id: pcaKp.knowledge_point_id,
    question_type: 'SINGLE_CHOICE',
    title: 'PCA数据预处理步骤',
    content: '在使用PCA之前，通常需要对数据进行什么预处理？',
    correct_answer: { type: 'single', answer: 'C' },
    analysis: 'PCA对数据的尺度敏感，如果各特征的量纲不同（如身高cm和体重kg），方差大的特征会主导主成分方向。因此必须进行标准化（均值为0，方差为1）。',
    difficulty_level: 'BASIC',
    score: 5,
    is_ai_generated: false,
    created_by_user_id: teacherUser.user_id,
    status: 'active',
  })

  const q6Options = [
    { key: 'A', content: '不需要任何预处理', order: 1 },
    { key: 'B', content: '只需要去除缺失值', order: 2 },
    { key: 'C', content: '数据标准化（均值为0，方差为1）', order: 3 },
    { key: 'D', content: '将数据转换为整数', order: 4 },
  ]
  for (const opt of q6Options) {
    await prisma.questionOption.upsert({
      where: { question_id_option_key: { question_id: q6.question_id, option_key: opt.key } },
      update: { option_content: opt.content, option_order: opt.order },
      create: { question_id: q6.question_id, option_key: opt.key, option_content: opt.content, option_order: opt.order },
    })
  }

  const allQuestions = [q1, q2, q3, q4, q5, q6]
  log(`  共创建/确认 ${allQuestions.length} 道PCA相关题目`)

  // --------------------------------------------------
  // 12. 创建学习任务（PCA 单元测验）
  // --------------------------------------------------
  log('12/21 创建学习任务...')

  let task = await prisma.learningTask.findFirst({
    where: { course_id: course.course_id, title: 'PCA主成分分析单元测验' },
  })
  if (!task) {
    task = await prisma.learningTask.create({
      data: {
        course_id: course.course_id,
        teaching_class_id: teachingClass.teaching_class_id,
        created_by_user_id: teacherUser.user_id,
        task_type: 'QUIZ',
        title: 'PCA主成分分析单元测验',
        description: '本测验涵盖PCA主成分分析的核心概念、算法步骤和应用场景，共6道题，满分42分。',
        start_time: new Date('2026-04-01T08:00:00'),
        deadline: new Date('2026-04-07T23:59:59'),
        allow_late_submit: false,
        status: 'PUBLISHED',
      },
    })
    log('  已创建学习任务：PCA主成分分析单元测验')
  } else {
    log('  学习任务已存在，跳过')
  }

  // --------------------------------------------------
  // 13. 关联题目到任务
  // --------------------------------------------------
  log('13/21 关联题目到任务...')

  for (let i = 0; i < allQuestions.length; i++) {
    await prisma.taskQuestion.upsert({
      where: { task_id_question_id: { task_id: task.task_id, question_id: allQuestions[i].question_id } },
      update: { question_order: i + 1 },
      create: { task_id: task.task_id, question_id: allQuestions[i].question_id, question_order: i + 1 },
    })
  }
  log('  题目已关联到任务')

  // 关联知识点到任务
  await prisma.taskKnowledgePoint.upsert({
    where: { task_id_knowledge_point_id: { task_id: task.task_id, knowledge_point_id: pcaKp.knowledge_point_id } },
    update: {},
    create: { task_id: task.task_id, knowledge_point_id: pcaKp.knowledge_point_id },
  })

  // --------------------------------------------------
  // 14. 创建任务提交记录
  // --------------------------------------------------
  log('14/21 创建任务提交记录...')

  let submission = await prisma.taskSubmission.findFirst({
    where: { task_id: task.task_id, student_user_id: studentUser.user_id },
  })
  if (!submission) {
    submission = await prisma.taskSubmission.create({
      data: {
        task_id: task.task_id,
        student_user_id: studentUser.user_id,
        started_at: new Date('2026-04-03T10:00:00'),
        submitted_at: new Date('2026-04-03T10:35:00'),
        duration_seconds: 2100,
        is_late: false,
        total_score: 27,
        objective_score: 18,
        ai_score: 9,
        submission_status: 'SUBMITTED',
        grading_status: 'AI_GRADED',
      },
    })
    log('  已创建任务提交记录')
  } else {
    log('  任务提交记录已存在，跳过')
  }

  // --------------------------------------------------
  // 15. 创建答题记录
  // --------------------------------------------------
  log('15/21 创建答题记录...')

  // 辅助函数：检查答题记录是否存在
  async function findOrCreateAnswerRecord(studentUserId, questionId, taskId, attemptNo, data) {
    let record = await prisma.answerRecord.findFirst({
      where: {
        student_user_id: studentUserId,
        question_id: questionId,
        task_id: taskId,
        attempt_no: attemptNo,
      },
    })
    if (!record) {
      record = await prisma.answerRecord.create({ data })
    }
    return record
  }

  // student_demo 的答题情况：
  // q1 单选：答对 B
  const ar1 = await findOrCreateAnswerRecord(studentUser.user_id, q1.question_id, task.task_id, 1, {
    student_user_id: studentUser.user_id,
    question_id: q1.question_id,
    task_id: task.task_id,
    submission_id: submission.submission_id,
    answer_content: { answer: 'B' },
    started_at: new Date('2026-04-03T10:02:00'),
    submitted_at: new Date('2026-04-03T10:04:00'),
    duration_seconds: 120,
    viewed_analysis: true,
    attempt_no: 1,
    is_correct: true,
    score: 5,
    max_score: 5,
    grading_status: 'AUTO_GRADED',
    feedback: '回答正确！',
    auto_added_wrong_book: false,
  })

  // q2 多选：只选了 A C（漏选 B D，答错）
  const ar2 = await findOrCreateAnswerRecord(studentUser.user_id, q2.question_id, task.task_id, 1, {
    student_user_id: studentUser.user_id,
    question_id: q2.question_id,
    task_id: task.task_id,
    submission_id: submission.submission_id,
    answer_content: { answer: ['A', 'C'] },
    started_at: new Date('2026-04-03T10:05:00'),
    submitted_at: new Date('2026-04-03T10:08:00'),
    duration_seconds: 180,
    viewed_analysis: false,
    attempt_no: 1,
    is_correct: false,
    score: 5,
    max_score: 10,
    grading_status: 'AUTO_GRADED',
    feedback: '部分正确，正确选项为A、B、C、D。PCA是一种无监督学习方法，通过线性变换实现降维，保留方差最大的方向，并且可以用于高维数据可视化（通常降到2维或3维后绘图）。',
    auto_added_wrong_book: true,
  })

  // q3 判断：回答正确（false/错误）
  const ar3 = await findOrCreateAnswerRecord(studentUser.user_id, q3.question_id, task.task_id, 1, {
    student_user_id: studentUser.user_id,
    question_id: q3.question_id,
    task_id: task.task_id,
    submission_id: submission.submission_id,
    answer_content: { answer: false },
    started_at: new Date('2026-04-03T10:09:00'),
    submitted_at: new Date('2026-04-03T10:10:00'),
    duration_seconds: 60,
    viewed_analysis: true,
    attempt_no: 1,
    is_correct: true,
    score: 3,
    max_score: 3,
    grading_status: 'AUTO_GRADED',
    feedback: '回答正确！第一主成分是方差最大的方向。',
    auto_added_wrong_book: false,
  })

  // q4 填空：只写了 "主成分分析"（未写英文全称，部分正确）
  const ar4 = await findOrCreateAnswerRecord(studentUser.user_id, q4.question_id, task.task_id, 1, {
    student_user_id: studentUser.user_id,
    question_id: q4.question_id,
    task_id: task.task_id,
    submission_id: submission.submission_id,
    answer_content: { answer: ['', '主成分分析'] },
    started_at: new Date('2026-04-03T10:11:00'),
    submitted_at: new Date('2026-04-03T10:14:00'),
    duration_seconds: 180,
    viewed_analysis: false,
    attempt_no: 1,
    is_correct: false,
    score: 2,
    max_score: 4,
    grading_status: 'AUTO_GRADED',
    feedback: '中文部分正确。英文全称为 Principal Component Analysis。',
    auto_added_wrong_book: true,
  })

  // q5 简答：写了部分步骤
  const ar5 = await findOrCreateAnswerRecord(studentUser.user_id, q5.question_id, task.task_id, 1, {
    student_user_id: studentUser.user_id,
    question_id: q5.question_id,
    task_id: task.task_id,
    submission_id: submission.submission_id,
    answer_content: {
      answer: '1. 对数据进行标准化处理\n2. 计算协方差矩阵\n3. 求特征值和特征向量\n4. 选择主成分\n5. 将数据投影到主成分上',
    },
    started_at: new Date('2026-04-03T10:15:00'),
    submitted_at: new Date('2026-04-03T10:30:00'),
    duration_seconds: 900,
    viewed_analysis: false,
    attempt_no: 1,
    is_correct: null,
    score: 9,
    max_score: 15,
    grading_status: 'AI_GRADED',
    feedback: '基本步骤正确，但对每一步的作用解释不够充分。建议补充：标准化是为了消除量纲影响；特征值大小代表方差贡献；主成分选择依据累计方差贡献率（通常取85%以上）。',
    auto_added_wrong_book: true,
  })

  // q6 单选：答对 C
  const ar6 = await findOrCreateAnswerRecord(studentUser.user_id, q6.question_id, task.task_id, 1, {
    student_user_id: studentUser.user_id,
    question_id: q6.question_id,
    task_id: task.task_id,
    submission_id: submission.submission_id,
    answer_content: { answer: 'C' },
    started_at: new Date('2026-04-03T10:31:00'),
    submitted_at: new Date('2026-04-03T10:33:00'),
    duration_seconds: 120,
    viewed_analysis: true,
    attempt_no: 1,
    is_correct: true,
    score: 5,
    max_score: 5,
    grading_status: 'AUTO_GRADED',
    feedback: '回答正确！PCA对数据尺度敏感，必须进行标准化预处理。',
    auto_added_wrong_book: false,
  })

  const answerRecords = [ar1, ar2, ar3, ar4, ar5, ar6]
  log(`  已创建 ${answerRecords.length} 条答题记录（3对3错）`)

  // --------------------------------------------------
  // 16. AI 批改记录（针对简答题 q5）
  // --------------------------------------------------
  log('16/21 创建AI批改记录...')

  let aiGrading = await prisma.aiGradingRecord.findFirst({
    where: { answer_record_id: ar5.answer_record_id },
  })
  if (!aiGrading) {
    aiGrading = await prisma.aiGradingRecord.create({
      data: {
        answer_record_id: ar5.answer_record_id,
        score: 9,
        total_score: 15,
        comment: '学生列出了PCA的基本步骤框架，步骤顺序正确。但缺少对每步作用的说明，标准化目的、协方差矩阵含义、特征值选择标准等关键细节未体现。建议加强理论知识学习。',
        rubric_matched: ['标准化处理', '协方差矩阵', '特征值特征向量', '选择主成分', '投影'],
        rubric_missing: ['标准化消除量纲影响', '特征值排序依据方差贡献', '主成分选择标准（累计贡献率）'],
        is_ai_generated: true,
        ai_provider: 'deepseek',
        model_name: 'deepseek-chat',
      },
    })
    log('  已创建AI批改记录')
  } else {
    log('  AI批改记录已存在，跳过')
  }

  // --------------------------------------------------
  // 17. 创建错题记录
  // --------------------------------------------------
  log('17/21 创建错题记录...')

  // 错题来自：ar2(多选)、ar4(填空)、ar5(简答)
  const wrongAnswerRecords = [ar2, ar4, ar5]
  for (const ar of wrongAnswerRecords) {
    await prisma.wrongQuestion.upsert({
      where: {
        student_user_id_question_id: {
          student_user_id: studentUser.user_id,
          question_id: ar.question_id,
        },
      },
      update: {
        source_type: 'auto',
        status: 'UNRESOLVED',
      },
      create: {
        student_user_id: studentUser.user_id,
        question_id: ar.question_id,
        course_id: course.course_id,
        knowledge_point_id: pcaKp.knowledge_point_id,
        source_type: 'auto',
        status: 'UNRESOLVED',
      },
    })
  }
  log(`  已创建 ${wrongAnswerRecords.length} 条错题记录`)

  // --------------------------------------------------
  // 18. 创建学习行为记录
  // --------------------------------------------------
  log('18/21 创建学习行为记录...')

  let studyRecord = await prisma.studyRecord.findFirst({
    where: { student_user_id: studentUser.user_id, course_id: course.course_id, knowledge_point_id: pcaKp.knowledge_point_id },
  })
  if (!studyRecord) {
    await prisma.studyRecord.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: course.course_id,
        knowledge_point_id: pcaKp.knowledge_point_id,
        resource_type: 'knowledge_point',
        action_type: 'VIEW',
        started_at: new Date('2026-04-03T09:00:00'),
        finished_at: new Date('2026-04-03T09:45:00'),
        duration_seconds: 2700,
        progress_percent: 100,
      },
    })
    log('  已创建学习行为记录')
  } else {
    log('  学习行为记录已存在，跳过')
  }

  // --------------------------------------------------
  // 19. 创建知识点掌握度记录（所有10个知识点）
  // --------------------------------------------------
  log('19/21 创建知识点掌握度记录...')

  const masteryData = [
    { code: 'ML-KP-001', score: 82, level: 'GOOD' },
    { code: 'ML-KP-002', score: 78, level: 'GOOD' },
    { code: 'ML-KP-003', score: 70, level: 'GENERAL' },
    { code: 'ML-KP-004', score: 65, level: 'GENERAL' },
    { code: 'ML-KP-005', score: 75, level: 'GOOD' },
    { code: 'ML-KP-006', score: 55, level: 'WEAK' },
    { code: 'ML-KP-007', score: 60, level: 'GENERAL' },
    { code: 'ML-KP-008', score: 40, level: 'WEAK' },
    { code: 'ML-KP-009', score: 45, level: 'WEAK' },
    { code: 'ML-KP-010', score: 85, level: 'GOOD' },
  ]

  for (const m of masteryData) {
    const kp = knowledgePoints[m.code]
    await prisma.studentMasteryRecord.upsert({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: studentUser.user_id,
          course_id: course.course_id,
          knowledge_point_id: kp.knowledge_point_id,
        },
      },
      update: {
        mastery_score: m.score,
        mastery_level: m.level,
      },
      create: {
        student_user_id: studentUser.user_id,
        course_id: course.course_id,
        knowledge_point_id: kp.knowledge_point_id,
        mastery_score: m.score,
        mastery_level: m.level,
        quiz_score: Math.round(m.score * 0.6 * 100) / 100,
        question_score: Math.round(m.score * 0.2 * 100) / 100,
        study_progress_score: Math.round(m.score * 0.2 * 100) / 100,
      },
    })
    log(`  知识点 ${m.code} 掌握度：${m.score} (${m.level})`)
  }

  // --------------------------------------------------
  // 20. 创建学生画像
  // --------------------------------------------------
  log('20/21 创建学生画像...')

  let portrait = await prisma.studentPortrait.findUnique({
    where: {
      student_user_id_course_id: {
        student_user_id: studentUser.user_id,
        course_id: course.course_id,
      },
    },
  })
  if (!portrait) {
    portrait = await prisma.studentPortrait.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: course.course_id,
        learning_total_score: 65.5,
        progress_score: 70,
        mastery_score: 65.5,
        test_score: 64.3,
        wrong_question_score: 50,
        activity_score: 72,
        qa_score: 68,
        research_total_score: 0,
        competition_total_score: 0,
      },
    })
    log('  已创建学生画像')
  } else {
    log('  学生画像已存在，跳过')
  }

  // 画像快照
  let snapshot = await prisma.studentPortraitSnapshot.findFirst({
    where: {
      student_user_id: studentUser.user_id,
      course_id: course.course_id,
    },
  })
  if (!snapshot) {
    await prisma.studentPortraitSnapshot.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: course.course_id,
        snapshot_date: new Date('2026-06-30T00:00:00'),
        learning_scores: {
          learning_total_score: 65.5,
          progress_score: 70,
          mastery_score: 65.5,
          test_score: 64.3,
          wrong_question_score: 50,
          activity_score: 72,
          qa_score: 68,
        },
        mastery_summary: {
          weak: 3,
          general: 3,
          good: 4,
          excellent: 0,
          weak_points: ['K-means 聚类', 'SVM 支持向量机', '神经网络基础'],
        },
        activity_summary: {
          total_study_time_minutes: 315,
          total_questions_answered: 6,
          total_ai_questions: 3,
          correct_rate: 50,
        },
      },
    })
    log('  已创建画像快照')
  } else {
    log('  画像快照已存在，跳过')
  }

  // --------------------------------------------------
  // 21. 创建 AI 会话与问答记录
  // --------------------------------------------------
  log('21/21 创建AI会话与问答记录...')

  // 会话1：学生询问 PCA 概念
  let conversation = await prisma.chatConversation.findFirst({
    where: { user_id: studentUser.user_id, title: 'PCA主成分分析学习咨询' },
  })
  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: {
        user_id: studentUser.user_id,
        course_id: course.course_id,
        teaching_class_id: teachingClass.teaching_class_id,
        agent_type: 'COURSE_QA',
        title: 'PCA主成分分析学习咨询',
      },
    })
    log('  已创建AI会话')
  } else {
    log('  AI会话已存在，跳过')
  }

  // 消息1：用户提问
  let msg1 = await prisma.chatMessage.findFirst({
    where: { conversation_id: conversation.conversation_id, role: 'USER', content: { contains: '什么是PCA主成分分析' } },
  })
  if (!msg1) {
    msg1 = await prisma.chatMessage.create({
      data: {
        conversation_id: conversation.conversation_id,
        user_id: studentUser.user_id,
        role: 'USER',
        content: '什么是PCA主成分分析？它在机器学习中有什么作用？',
        is_ai_generated: false,
      },
    })
  }

  // 消息2：AI 回复
  let msg2 = await prisma.chatMessage.findFirst({
    where: { conversation_id: conversation.conversation_id, role: 'ASSISTANT', content: { contains: 'Principal Component Analysis' } },
  })
  if (!msg2) {
    msg2 = await prisma.chatMessage.create({
      data: {
        conversation_id: conversation.conversation_id,
        user_id: null,
        role: 'ASSISTANT',
        content: 'PCA（Principal Component Analysis，主成分分析）是一种经典的无监督学习降维算法。\n\n**核心思想：** 通过线性变换将高维数据映射到低维空间，同时尽可能保留原始数据的方差信息。\n\n**主要作用：**\n1. **降维**：减少特征数量，降低计算复杂度\n2. **去噪**：舍弃方差较小的成分，去除噪声\n3. **可视化**：将高维数据降到2-3维，便于绘图展示\n4. **特征提取**：生成互不相关的新特征（主成分）\n\n**基本步骤：**\n1. 数据标准化\n2. 计算协方差矩阵\n3. 求特征值和特征向量\n4. 按特征值排序，选取前k个主成分\n5. 将数据投影到选定的主成分上\n\n**注意事项：** PCA假设数据是线性可分的，对非线性数据效果有限；PCA对数据缩放敏感，必须进行标准化预处理。',
        is_ai_generated: true,
        ai_provider: 'deepseek',
        model_name: 'deepseek-chat',
        agent_type: 'COURSE_QA',
      },
    })
  }

  // 消息3：学生追问
  let msg3 = await prisma.chatMessage.findFirst({
    where: { conversation_id: conversation.conversation_id, role: 'USER', content: { contains: '如何选择主成分个数' } },
  })
  if (!msg3) {
    msg3 = await prisma.chatMessage.create({
      data: {
        conversation_id: conversation.conversation_id,
        user_id: studentUser.user_id,
        role: 'USER',
        content: '如何选择保留多少个主成分？有什么标准吗？',
        is_ai_generated: false,
      },
    })
  }

  // 消息4：AI 回复
  let msg4 = await prisma.chatMessage.findFirst({
    where: { conversation_id: conversation.conversation_id, role: 'ASSISTANT', content: { contains: '累计方差贡献率' } },
  })
  if (!msg4) {
    msg4 = await prisma.chatMessage.create({
      data: {
        conversation_id: conversation.conversation_id,
        user_id: null,
        role: 'ASSISTANT',
        content: '选择主成分个数k的常用方法：\n\n1. **累计方差贡献率**（最常用）：计算前k个主成分的方差贡献率之和，通常选择累计贡献率达到85%~95%时的k值。\n\n2. **碎石图（Scree Plot）**：绘制特征值从大到小的折线图，找到"拐点"（elbow point），拐点之前的主成分个数即为k。\n\n3. **Kaiser准则**：保留特征值大于1的主成分（适用于相关矩阵的PCA）。\n\n4. **交叉验证**：通过下游任务的性能来选择最优k值。\n\n5. **固定维度**：如果目标是可视化，直接取k=2或k=3。\n\n建议结合多种方法综合判断。',
        is_ai_generated: true,
        ai_provider: 'deepseek',
        model_name: 'deepseek-chat',
        agent_type: 'COURSE_QA',
      },
    })
  }

  // 学生提问记录（归一化分析用）
  let sqRecord = await prisma.studentQuestionRecord.findFirst({
    where: { student_user_id: studentUser.user_id, raw_question: { contains: '什么是PCA主成分分析' } },
  })
  if (!sqRecord) {
    sqRecord = await prisma.studentQuestionRecord.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: course.course_id,
        conversation_id: conversation.conversation_id,
        message_id: msg1.message_id,
        raw_question: '什么是PCA主成分分析？它在机器学习中有什么作用？',
      },
    })
  }

  // 问题归一化分析
  let analysisRecord = await prisma.questionAnalysisRecord.findFirst({
    where: { student_question_id: sqRecord.student_question_id },
  })
  if (!analysisRecord) {
    analysisRecord = await prisma.questionAnalysisRecord.create({
      data: {
        student_question_id: sqRecord.student_question_id,
        raw_question: '什么是PCA主成分分析？它在机器学习中有什么作用？',
        question_summary: '学生询问PCA主成分分析的定义和作用',
        knowledge_point_id: pcaKp.knowledge_point_id,
        normalized_question_type: '概念理解',
        confidence: 0.95,
        need_teacher_review: false,
      },
    })
    log('  已创建问题归一化分析记录')
  } else {
    log('  问题分析记录已存在，跳过')
  }

  // 消息引用来源（模拟）
  let msgSource = await prisma.messageSource.findFirst({
    where: { message_id: msg2.message_id },
  })
  if (!msgSource) {
    await prisma.messageSource.create({
      data: {
        message_id: msg2.message_id,
        document_title: '机器学习课程讲义 - 降维算法',
        chunk_text: 'PCA（主成分分析）是一种无监督降维方法，通过线性变换将数据投影到低维空间...',
        similarity: 0.92,
      },
    })
    log('  已创建消息引用来源')
  } else {
    log('  消息引用来源已存在，跳过')
  }

  log('  AI会话与问答记录创建完成')

  // --------------------------------------------------
  // 22. 创建推荐记录
  // --------------------------------------------------
  log('22/21 创建推荐记录...')

  let recRecord = await prisma.recommendationRecord.findFirst({
    where: { student_user_id: studentUser.user_id, course_id: course.course_id },
  })
  if (!recRecord) {
    recRecord = await prisma.recommendationRecord.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: course.course_id,
        recommend_type: 'ALL',
        reason_summary: '基于学生的答题情况和知识点掌握度分析，学生PCA相关概念基本掌握，但在SVM、神经网络、K-means聚类等知识点上较为薄弱，建议优先复习这些内容。',
      },
    })
    log('  已创建推荐记录')
  } else {
    log('  推荐记录已存在，跳过')
  }

  // 推荐项
  const recItems = [
    {
      item_type: 'knowledge_point',
      target_type: 'knowledge_point',
      target_id: knowledgePoints['ML-KP-008'].knowledge_point_id,
      title: 'SVM 支持向量机',
      content: { reason: '掌握度为薄弱(40分)，需加强学习' },
      reason: '学习进度落后，建议优先学习',
      rank: 1,
    },
    {
      item_type: 'knowledge_point',
      target_type: 'knowledge_point',
      target_id: knowledgePoints['ML-KP-009'].knowledge_point_id,
      title: '神经网络基础',
      content: { reason: '掌握度为薄弱(45分)，需加强学习' },
      reason: '学习进度落后，建议加强学习',
      rank: 2,
    },
    {
      item_type: 'knowledge_point',
      target_type: 'knowledge_point',
      target_id: knowledgePoints['ML-KP-006'].knowledge_point_id,
      title: 'K-means 聚类',
      content: { reason: '掌握度为薄弱(55分)，需巩固复习' },
      reason: '掌握程度较低，建议复习巩固',
      rank: 3,
    },
    {
      item_type: 'question',
      target_type: 'knowledge_point',
      target_id: knowledgePoints['ML-KP-007'].knowledge_point_id,
      title: 'PCA 进阶练习',
      content: { question_count: 5, difficulty: 'medium' },
      reason: 'PCA简答题得分较低(9/15)，建议加强练习',
      rank: 4,
    },
    {
      item_type: 'video',
      target_type: 'external',
      target_id: null,
      title: 'PCA主成分分析 - 视频讲解',
      content: { source: 'bilibili', keyword: 'PCA 主成分分析 机器学习' },
      reason: '通过视频学习加深理解',
      rank: 5,
    },
  ]

  for (const item of recItems) {
    const exists = await prisma.recommendationItem.findFirst({
      where: { recommendation_record_id: recRecord.recommendation_record_id, title: item.title },
    })
    if (!exists) {
      await prisma.recommendationItem.create({
        data: {
          recommendation_record_id: recRecord.recommendation_record_id,
          item_type: item.item_type,
          target_type: item.target_type,
          target_id: item.target_id,
          title: item.title,
          content: item.content,
          reason: item.reason,
          rank: item.rank,
        },
      })
    }
  }
  log('  推荐项创建完成')

  // ========================
  // 完成
  // ========================
  log('========== 种子数据脚本执行完毕 ==========')
  log('')
  log('种子数据摘要：')
  log(`  - 用户：3 个 (admin_demo / teacher_demo / student_demo)`)
  log(`  - 密码：均为 123456`)
  log(`  - 行政班级：软件2403班`)
  log(`  - 课程：机器学习 (ML001)`)
  log(`  - 教学班：机器学习1班`)
  log(`  - 章节：3 个`)
  log(`  - 知识点：10 个 + 别名若干`)
  log(`  - 题目：6 道 PCA 相关 (单选×2 / 多选×1 / 判断×1 / 填空×1 / 简答×1)`)
  log(`  - 学习任务：1 个 (PCA单元测验)`)
  log(`  - 答题记录：6 条 (3对3错)`)
  log(`  - 错题记录：3 条`)
  log(`  - 掌握度记录：10 条`)
  log(`  - 学生画像：1 条 + 快照 1 条`)
  log(`  - AI 会话：1 个 + 4 条消息 + 问题归一化分析`)
  log(`  - 推荐记录：1 条 + 5 个推荐项`)
  log('')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
