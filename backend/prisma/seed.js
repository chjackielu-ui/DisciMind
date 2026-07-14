// DisciMind seed data
// 可重复运行：通过 upsert/findFirst + update/create 避免重复插入。

const { PrismaClient } = require('@prisma/client')
const { PrismaMariaDb } = require('@prisma/adapter-mariadb')
const bcrypt = require('bcryptjs')
const { loadEnv } = require('../src/config/env')
const { getDatabaseConfig } = require('../src/config/database')
const { seedAgentMarketplace } = require('./seeds/seedAgentMarketplace')

loadEnv()

const adapter = new PrismaMariaDb(getDatabaseConfig())

const prisma = new PrismaClient({ adapter })
const PASSWORD_HASH = bcrypt.hashSync('123456', 10)

function log(message) {
  console.log(`[seed] ${message}`)
}

async function upsertUser(username, data) {
  return prisma.user.upsert({
    where: { username },
    update: {
      role: data.role,
      status: data.status || 'ACTIVE',
      phone: data.phone,
      email: data.email,
    },
    create: {
      username,
      password_hash: PASSWORD_HASH,
      role: data.role,
      status: data.status || 'ACTIVE',
      phone: data.phone,
      email: data.email,
      last_login_at: new Date(),
    },
  })
}

async function upsertProfile(userId, data) {
  return prisma.userProfile.upsert({
    where: { user_id: userId },
    update: data,
    create: { user_id: userId, ...data },
  })
}

async function upsertAdminClass(data) {
  return prisma.adminClass.upsert({
    where: {
      class_name_grade: {
        class_name: data.class_name,
        grade: data.grade,
      },
    },
    update: {
      college: data.college,
      major: data.major,
      grade: data.grade,
    },
    create: data,
  })
}

async function upsertCourse(data) {
  return prisma.course.upsert({
    where: { course_code: data.course_code },
    update: {
      course_name: data.course_name,
      subject_category: data.subject_category,
      description: data.description,
      status: 'ACTIVE',
    },
    create: {
      ...data,
      status: 'ACTIVE',
    },
  })
}

async function upsertTeachingClass(course, adminClass, teacherUserId, courseOfferingId) {
  return prisma.teachingClass.upsert({
    where: {
      course_id_teaching_class_name: {
        course_id: course.course_id,
        teaching_class_name: adminClass.class_name,
      },
    },
    update: {
      course_offering_id: courseOfferingId,
      teacher_user_id: teacherUserId,
      code: `${course.course_code}-${adminClass.class_name}`.replace(/[^A-Za-z0-9\u4e00-\u9fa5-]/g, '-'),
      semester: '2025-2026-2',
      schedule: { weekday: adminClass.class_name === '软件2403班' ? 2 : 4, periods: '1-2' },
      location: adminClass.class_name === '软件2403班' ? '博学楼 A201' : '博学楼 A203',
      capacity: 60,
      status: 'active',
      description: `${course.course_name}课程教学班，面向${adminClass.major || '相关专业'}${adminClass.grade || ''}级${adminClass.class_name}学生。`,
    },
    create: {
      course_id: course.course_id,
      course_offering_id: courseOfferingId,
      teacher_user_id: teacherUserId,
      teaching_class_name: adminClass.class_name,
      code: `${course.course_code}-${adminClass.class_name}`.replace(/[^A-Za-z0-9\u4e00-\u9fa5-]/g, '-'),
      semester: '2025-2026-2',
      schedule: { weekday: adminClass.class_name === '软件2403班' ? 2 : 4, periods: '1-2' },
      location: adminClass.class_name === '软件2403班' ? '博学楼 A201' : '博学楼 A203',
      capacity: 60,
      status: 'active',
      description: `${course.course_name}课程教学班，面向${adminClass.major || '相关专业'}${adminClass.grade || ''}级${adminClass.class_name}学生。`,
    },
  })
}

async function findOrCreateAnswerRecord(studentId, questionId, taskId, attemptNo, data) {
  const existing = await prisma.answerRecord.findFirst({
    where: {
      student_user_id: studentId,
      question_id: questionId,
      task_id: taskId,
      attempt_no: attemptNo,
    },
  })

  if (existing) {
    return prisma.answerRecord.update({
      where: { answer_record_id: existing.answer_record_id },
      data,
    })
  }

  return prisma.answerRecord.create({ data })
}

async function main() {
  log('========== DisciMind 智能答题系统种子数据开始 ==========')

  log('1/15 创建 demo 用户与资料')
  const adminUser = await upsertUser('admin_demo', {
    role: 'ADMIN',
    phone: '13800000001',
    email: 'admin@discimind.demo',
  })
  const teacherUser = await upsertUser('teacher_demo', {
    role: 'TEACHER',
    phone: '13800000002',
    email: 'teacher@discimind.demo',
  })
  const studentUser = await upsertUser('student_demo', {
    role: 'STUDENT',
    phone: '13800000003',
    email: 'student@discimind.demo',
  })

  await upsertProfile(adminUser.user_id, {
    real_name: '管理员演示',
    gender: 'MALE',
    college: '计算机与软件工程学院',
  })
  await upsertProfile(teacherUser.user_id, {
    real_name: '教师演示',
    gender: 'FEMALE',
    teacher_no: 'T2024001',
    college: '计算机与软件工程学院',
    major: '计算机科学与技术',
    professional_title: '副教授',
    teacher_preferences: { message_notifications: true, ai_style: 'structured', analytics_range: '30d' },
  })

  log('2/15 创建行政班级')
  const adminClassDefs = [
    {
      class_name: '软件2403班',
      college: '计算机与软件工程学院',
      major: '软件工程',
      grade: '2024',
    },
    {
      class_name: '软件2404班',
      college: '计算机与软件工程学院',
      major: '软件工程',
      grade: '2024',
    },
  ]

  const adminClasses = {}
  for (const def of adminClassDefs) {
    adminClasses[def.class_name] = await upsertAdminClass(def)
    await prisma.adminClass.update({ where: { admin_class_id: adminClasses[def.class_name].admin_class_id }, data: { advisor_user_id: teacherUser.user_id, status: 'active' } })
  }

  await upsertProfile(studentUser.user_id, {
    real_name: '学生演示',
    gender: 'MALE',
    student_no: 'S2024001',
    college: '计算机与软件工程学院',
    major: '软件工程',
    grade: '2024',
    admin_class_id: adminClasses['软件2403班'].admin_class_id,
  })

  log('3/15 创建科目/课程与教学班')
  const courseDefs = [
    {
      course_name: '机器学习',
      course_code: 'ML001',
      subject_category: '计算机大类学科',
      description: '系统介绍机器学习的基本概念、经典算法、模型评估与实际应用。',
    },
    {
      course_name: '操作系统',
      course_code: 'OS001',
      subject_category: '计算机大类学科',
      description: '覆盖进程管理、内存管理、文件系统、I/O 与并发控制等核心内容。',
    },
    {
      course_name: 'Web前端',
      course_code: 'WEB001',
      subject_category: '软件工程实践',
      description: '覆盖 HTML、CSS、JavaScript、组件化开发与工程化实践。',
    },
    {
      course_name: '概率论',
      course_code: 'PROB001',
      subject_category: '数学基础课程',
      description: '介绍随机事件、随机变量、常见分布、期望方差与大数定律等内容。',
    },
  ]

  const courses = {}
  const teachingClasses = {}
  const semester = await prisma.academicSemester.upsert({
    where: { code: '2025-2026-2' },
    update: { name: '2025-2026 学年第二学期', start_date: new Date('2026-02-23T00:00:00+08:00'), end_date: new Date('2026-07-19T23:59:59+08:00'), status: 'active' },
    create: { code: '2025-2026-2', name: '2025-2026 学年第二学期', start_date: new Date('2026-02-23T00:00:00+08:00'), end_date: new Date('2026-07-19T23:59:59+08:00'), status: 'active' },
  })
  for (const def of courseDefs) {
    const course = await upsertCourse(def)
    courses[def.course_code] = course

    await prisma.courseTeacherRelation.upsert({
      where: {
        course_id_teacher_user_id: {
          course_id: course.course_id,
          teacher_user_id: teacherUser.user_id,
        },
      },
      update: { teacher_role: 'MAIN_TEACHER' },
      create: {
        course_id: course.course_id,
        teacher_user_id: teacherUser.user_id,
        teacher_role: 'MAIN_TEACHER',
      },
    })

    const offering = await prisma.courseOffering.upsert({
      where: { course_id_semester_id: { course_id: course.course_id, semester_id: semester.semester_id } },
      update: { start_date: semester.start_date, end_date: semester.end_date, status: 'active', teaching_progress: { week: 20, topic: '课程总结与综合实践', completion: 0.86 } },
      create: { course_id: course.course_id, semester_id: semester.semester_id, start_date: semester.start_date, end_date: semester.end_date, status: 'active', teaching_progress: { week: 20, topic: '课程总结与综合实践', completion: 0.86 } },
    })

    teachingClasses[def.course_code] = {}
    for (const adminClass of Object.values(adminClasses)) {
      const teachingClass = await upsertTeachingClass(course, adminClass, teacherUser.user_id, offering.course_offering_id)
      teachingClasses[def.course_code][adminClass.class_name] = teachingClass
      await prisma.teachingClassTeacherAuthorization.upsert({
        where: { teaching_class_id_teacher_user_id: { teaching_class_id: teachingClass.teaching_class_id, teacher_user_id: teacherUser.user_id } },
        update: { role: 'owner', status: 'active' },
        create: { teaching_class_id: teachingClass.teaching_class_id, teacher_user_id: teacherUser.user_id, role: 'owner', status: 'active', granted_by_user_id: adminUser.user_id },
      })
      await prisma.teachingClassAdminClass.upsert({
        where: { teaching_class_id_admin_class_id: { teaching_class_id: teachingClass.teaching_class_id, admin_class_id: adminClass.admin_class_id } },
        update: {},
        create: { teaching_class_id: teachingClass.teaching_class_id, admin_class_id: adminClass.admin_class_id },
      })
    }
  }

  const mlCourse = courses.ML001
  await prisma.userProfile.update({ where: { user_id: teacherUser.user_id }, data: { default_course_id: mlCourse.course_id } })
  const mlClass2403 = teachingClasses.ML001['软件2403班']
  const mlClass2404 = teachingClasses.ML001['软件2404班']

  await prisma.studentCourseEnrollment.upsert({
    where: {
      student_user_id_course_id_teaching_class_id: {
        student_user_id: studentUser.user_id,
        course_id: mlCourse.course_id,
        teaching_class_id: mlClass2403.teaching_class_id,
      },
    },
    update: {
      enrollment_status: 'active',
    },
    create: {
      student_user_id: studentUser.user_id,
      course_id: mlCourse.course_id,
      teaching_class_id: mlClass2403.teaching_class_id,
      enrollment_status: 'active',
    },
  })

  const analyticsStudents = [studentUser]
  const analyticsStudentDefs = [
    ['student_240302', '林晓雨', 'S2024002', '软件2403班'],
    ['student_240303', '周明远', 'S2024003', '软件2403班'],
    ['student_240304', '陈思琪', 'S2024004', '软件2403班'],
    ['student_240305', '王子涵', 'S2024005', '软件2403班'],
    ['student_240306', '赵一凡', 'S2024006', '软件2403班'],
    ['student_240401', '孙嘉宁', 'S2024007', '软件2404班'],
    ['student_240402', '何宇航', 'S2024008', '软件2404班'],
  ]
  for (let index = 0; index < analyticsStudentDefs.length; index += 1) {
    const [username, realName, studentNo, className] = analyticsStudentDefs[index]
    const demoStudent = await upsertUser(username, { role: 'STUDENT', email: `${username}@discimind.demo`, phone: `138000001${String(index + 1).padStart(2, '0')}` })
    const adminClass = adminClasses[className]
    await upsertProfile(demoStudent.user_id, { real_name: realName, student_no: studentNo, college: '计算机与软件工程学院', major: '软件工程', grade: '2024', admin_class_id: adminClass.admin_class_id })
    const targetClass = className === '软件2403班' ? mlClass2403 : mlClass2404
    await prisma.studentCourseEnrollment.upsert({
      where: { student_user_id_course_id_teaching_class_id: { student_user_id: demoStudent.user_id, course_id: mlCourse.course_id, teaching_class_id: targetClass.teaching_class_id } },
      update: { enrollment_status: 'active' },
      create: { student_user_id: demoStudent.user_id, course_id: mlCourse.course_id, teaching_class_id: targetClass.teaching_class_id, enrollment_status: 'active' },
    })
    if (index < 3) {
      const dbCourse = courses.OS001
      const dbClass = teachingClasses.OS001[className]
      await prisma.studentCourseEnrollment.upsert({
        where: { student_user_id_course_id_teaching_class_id: { student_user_id: demoStudent.user_id, course_id: dbCourse.course_id, teaching_class_id: dbClass.teaching_class_id } },
        update: { enrollment_status: 'active' },
        create: { student_user_id: demoStudent.user_id, course_id: dbCourse.course_id, teaching_class_id: dbClass.teaching_class_id, enrollment_status: 'active' },
      })
    }
    analyticsStudents.push(demoStudent)
  }

  log('4/15 创建机器学习章节与知识点')
  const chapterDefs = [
    { chapter_name: '机器学习概述', chapter_order: 1, description: '机器学习基本概念、任务类型与学习范式。' },
    { chapter_name: '经典机器学习算法', chapter_order: 2, description: '监督学习、无监督学习与经典算法。' },
    { chapter_name: '模型评估与优化', chapter_order: 3, description: '模型评估指标、过拟合与模型选择。' },
  ]

  const chapters = {}
  for (const def of chapterDefs) {
    let chapter = await prisma.chapter.findFirst({
      where: { course_id: mlCourse.course_id, chapter_name: def.chapter_name },
    })
    if (chapter) {
      chapter = await prisma.chapter.update({
        where: { chapter_id: chapter.chapter_id },
        data: {
          chapter_order: def.chapter_order,
          description: def.description,
        },
      })
    } else {
      chapter = await prisma.chapter.create({
        data: {
          course_id: mlCourse.course_id,
          ...def,
        },
      })
    }
    chapters[def.chapter_name] = chapter
  }

  const kpDefs = [
    { code: 'ML-KP-001', name: '监督学习', chapter: '机器学习概述', difficulty: 'BASIC', order: 1, desc: '利用带标签数据训练模型，包括分类和回归任务。' },
    { code: 'ML-KP-002', name: '无监督学习', chapter: '机器学习概述', difficulty: 'BASIC', order: 2, desc: '在无标签数据中发现隐藏结构，如聚类和降维。' },
    { code: 'ML-KP-003', name: '线性回归', chapter: '经典机器学习算法', difficulty: 'BASIC', order: 3, desc: '通过拟合线性函数预测连续值输出。' },
    { code: 'ML-KP-004', name: '逻辑回归', chapter: '经典机器学习算法', difficulty: 'BASIC', order: 4, desc: '用于二分类问题的线性分类模型，输出可解释为概率。' },
    { code: 'ML-KP-005', name: '决策树', chapter: '经典机器学习算法', difficulty: 'MEDIUM', order: 5, desc: '通过树形结构递归划分特征空间，可解释性较强。' },
    { code: 'ML-KP-006', name: 'K-means 聚类', chapter: '经典机器学习算法', difficulty: 'MEDIUM', order: 6, desc: '基于距离的聚类算法，将样本划分为 K 个簇。' },
    { code: 'ML-KP-007', name: 'PCA 主成分分析', chapter: '经典机器学习算法', difficulty: 'MEDIUM', order: 7, desc: '通过线性变换降维，尽可能保留数据方差信息。' },
    { code: 'ML-KP-008', name: 'SVM 支持向量机', chapter: '经典机器学习算法', difficulty: 'HARD', order: 8, desc: '通过最大间隔超平面分类，可结合核函数处理非线性问题。' },
    { code: 'ML-KP-009', name: '神经网络基础', chapter: '经典机器学习算法', difficulty: 'HARD', order: 9, desc: '介绍神经元、激活函数、损失函数、前向传播与反向传播。' },
    { code: 'ML-KP-010', name: '模型评估指标', chapter: '模型评估与优化', difficulty: 'MEDIUM', order: 10, desc: '准确率、精确率、召回率、F1、AUC、MSE 等评估指标。' },
  ]

  const knowledgePoints = {}
  for (const kp of kpDefs) {
    const record = await prisma.knowledgePoint.upsert({
      where: {
        course_id_knowledge_point_code: {
          course_id: mlCourse.course_id,
          knowledge_point_code: kp.code,
        },
      },
      update: {
        chapter_id: chapters[kp.chapter].chapter_id,
        knowledge_point_name: kp.name,
        description: kp.desc,
        difficulty_level: kp.difficulty,
        sort_order: kp.order,
      },
      create: {
        course_id: mlCourse.course_id,
        chapter_id: chapters[kp.chapter].chapter_id,
        knowledge_point_name: kp.name,
        knowledge_point_code: kp.code,
        description: kp.desc,
        difficulty_level: kp.difficulty,
        sort_order: kp.order,
      },
    })
    knowledgePoints[kp.code] = record
  }

  const aliasMap = {
    'ML-KP-001': ['Supervised Learning', '有监督学习', '有标签学习'],
    'ML-KP-002': ['Unsupervised Learning', '无标签学习', '聚类分析'],
    'ML-KP-003': ['Linear Regression', '最小二乘法', 'OLS'],
    'ML-KP-004': ['Logistic Regression', 'Logit回归', '二分类模型'],
    'ML-KP-005': ['Decision Tree', 'CART', 'ID3', 'C4.5'],
    'ML-KP-006': ['K-means', 'K均值', 'K均值聚类'],
    'ML-KP-007': ['PCA', 'Principal Component Analysis', '主成分分析', '降维'],
    'ML-KP-008': ['SVM', 'Support Vector Machine', '最大间隔分类器', '核方法'],
    'ML-KP-009': ['Neural Network', 'ANN', '人工神经网络', '反向传播'],
    'ML-KP-010': ['Accuracy', 'Precision', 'Recall', 'F1', 'AUC', '混淆矩阵'],
  }

  for (const [code, aliases] of Object.entries(aliasMap)) {
    for (const aliasText of aliases) {
      await prisma.knowledgePointAlias.upsert({
        where: {
          knowledge_point_id_alias_text: {
            knowledge_point_id: knowledgePoints[code].knowledge_point_id,
            alias_text: aliasText,
          },
        },
        update: { source: 'system' },
        create: {
          knowledge_point_id: knowledgePoints[code].knowledge_point_id,
          alias_text: aliasText,
          source: 'system',
        },
      })
    }
  }

  log('5/15 创建机器学习智能答题题库')
  const questionBank = await prisma.questionBank.upsert({
    where: {
      course_id_name: {
        course_id: mlCourse.course_id,
        name: '机器学习智能答题题库',
      },
    },
    update: {
      description: '覆盖机器学习核心知识点的智能答题种子题库，包含单选、多选、填空、判断和简答题。',
      scope_type: 'CLASS',
      created_by_user_id: teacherUser.user_id,
      status: 'active',
    },
    create: {
      course_id: mlCourse.course_id,
      name: '机器学习智能答题题库',
      description: '覆盖机器学习核心知识点的智能答题种子题库，包含单选、多选、填空、判断和简答题。',
      scope_type: 'CLASS',
      created_by_user_id: teacherUser.user_id,
      status: 'active',
    },
  })

  for (const teachingClass of [mlClass2403, mlClass2404]) {
    await prisma.questionBankTeachingClass.upsert({
      where: {
        question_bank_id_teaching_class_id: {
          question_bank_id: questionBank.question_bank_id,
          teaching_class_id: teachingClass.teaching_class_id,
        },
      },
      update: {},
      create: {
        question_bank_id: questionBank.question_bank_id,
        teaching_class_id: teachingClass.teaching_class_id,
      },
    })
  }

  for (const kp of Object.values(knowledgePoints)) {
    await prisma.questionBankKnowledgePoint.upsert({
      where: {
        question_bank_id_knowledge_point_id: {
          question_bank_id: questionBank.question_bank_id,
          knowledge_point_id: kp.knowledge_point_id,
        },
      },
      update: {},
      create: {
        question_bank_id: questionBank.question_bank_id,
        knowledge_point_id: kp.knowledge_point_id,
      },
    })
  }

  log('6/15 创建机器学习 20 道题目')
  const questionDefs = [
    {
      title: '监督学习的数据特征',
      type: 'SINGLE_CHOICE',
      kpCode: 'ML-KP-001',
      difficulty: 'BASIC',
      score: 5,
      content: '监督学习训练数据最典型的特征是什么？',
      correctAnswer: { type: 'single_choice', answer: 'B' },
      analysis: '监督学习依赖带标签样本，模型通过输入特征与目标标签之间的对应关系学习预测函数。',
      options: [
        { key: 'A', content: '样本没有任何特征', isCorrect: false },
        { key: 'B', content: '每个样本通常带有目标标签', isCorrect: true },
        { key: 'C', content: '只能处理文本数据', isCorrect: false },
        { key: 'D', content: '不能进行泛化预测', isCorrect: false },
      ],
    },
    {
      title: '逻辑回归输出含义',
      type: 'SINGLE_CHOICE',
      kpCode: 'ML-KP-004',
      difficulty: 'BASIC',
      score: 5,
      content: '二分类逻辑回归经过 sigmoid 函数后的输出通常可以解释为什么？',
      correctAnswer: { type: 'single_choice', answer: 'C' },
      analysis: 'sigmoid 将线性模型输出映射到 0 到 1，可解释为样本属于正类的概率。',
      options: [
        { key: 'A', content: '样本的聚类编号', isCorrect: false },
        { key: 'B', content: '模型参数个数', isCorrect: false },
        { key: 'C', content: '样本属于正类的概率', isCorrect: true },
        { key: 'D', content: '特征的方差贡献率', isCorrect: false },
      ],
    },
    {
      title: 'K-means 中 K 的含义',
      type: 'SINGLE_CHOICE',
      kpCode: 'ML-KP-006',
      difficulty: 'BASIC',
      score: 5,
      content: 'K-means 聚类算法中的 K 表示什么？',
      correctAnswer: { type: 'single_choice', answer: 'A' },
      analysis: 'K 是预先指定的簇数量，算法会把样本划分到 K 个簇中。',
      options: [
        { key: 'A', content: '簇的数量', isCorrect: true },
        { key: 'B', content: '特征的数量', isCorrect: false },
        { key: 'C', content: '训练轮数的固定上限', isCorrect: false },
        { key: 'D', content: '标签类别的真实数量', isCorrect: false },
      ],
    },
    {
      title: 'SVM 最大间隔目标',
      type: 'SINGLE_CHOICE',
      kpCode: 'ML-KP-008',
      difficulty: 'MEDIUM',
      score: 6,
      content: '支持向量机在可分情况下寻找分类超平面的核心目标是什么？',
      correctAnswer: { type: 'single_choice', answer: 'D' },
      analysis: 'SVM 通过最大化分类间隔提升泛化能力，支持向量是决定间隔边界的关键样本。',
      options: [
        { key: 'A', content: '最小化样本数量', isCorrect: false },
        { key: 'B', content: '最大化训练误差', isCorrect: false },
        { key: 'C', content: '让所有特征方差相同', isCorrect: false },
        { key: 'D', content: '最大化两类样本到分隔超平面的间隔', isCorrect: true },
      ],
    },
    {
      title: 'PCA 的主要目的',
      type: 'SINGLE_CHOICE',
      kpCode: 'ML-KP-007',
      difficulty: 'BASIC',
      score: 5,
      content: 'PCA（主成分分析）的主要目的是什么？',
      correctAnswer: { type: 'single_choice', answer: 'B' },
      analysis: 'PCA 通过线性变换把高维数据投影到低维空间，同时尽可能保留原始数据的主要方差信息。',
      options: [
        { key: 'A', content: '直接生成分类标签', isCorrect: false },
        { key: 'B', content: '对数据进行降维', isCorrect: true },
        { key: 'C', content: '替代所有监督学习算法', isCorrect: false },
        { key: 'D', content: '保证模型不会过拟合', isCorrect: false },
      ],
    },
    {
      title: '过拟合的典型表现',
      type: 'SINGLE_CHOICE',
      kpCode: 'ML-KP-010',
      difficulty: 'BASIC',
      score: 5,
      content: '下列哪种现象最符合过拟合的表现？',
      correctAnswer: { type: 'single_choice', answer: 'C' },
      analysis: '过拟合通常表现为训练集效果很好，但测试集或验证集效果明显变差。',
      options: [
        { key: 'A', content: '训练集和测试集效果都很差', isCorrect: false },
        { key: 'B', content: '模型没有任何参数', isCorrect: false },
        { key: 'C', content: '训练集效果很好，测试集效果较差', isCorrect: true },
        { key: 'D', content: '测试集效果永远优于训练集', isCorrect: false },
      ],
    },
    {
      title: 'F1 值适用场景',
      type: 'SINGLE_CHOICE',
      kpCode: 'ML-KP-010',
      difficulty: 'MEDIUM',
      score: 6,
      content: '在类别分布不均衡的分类任务中，为什么常关注 F1 值？',
      correctAnswer: { type: 'single_choice', answer: 'A' },
      analysis: 'F1 综合考虑精确率和召回率，比单纯准确率更能反映不均衡分类任务中的模型表现。',
      options: [
        { key: 'A', content: '它综合考虑精确率和召回率', isCorrect: true },
        { key: 'B', content: '它只统计模型参数数量', isCorrect: false },
        { key: 'C', content: '它只适用于回归任务', isCorrect: false },
        { key: 'D', content: '它与混淆矩阵无关', isCorrect: false },
      ],
    },
    {
      title: '常见监督学习任务',
      type: 'MULTIPLE_CHOICE',
      kpCode: 'ML-KP-001',
      difficulty: 'BASIC',
      score: 8,
      content: '以下哪些属于常见的监督学习任务？',
      correctAnswer: { type: 'multiple_choice', answer: ['A', 'B'] },
      analysis: '监督学习常见任务包括分类和回归；聚类与降维通常属于无监督学习范畴。',
      options: [
        { key: 'A', content: '分类', isCorrect: true },
        { key: 'B', content: '回归', isCorrect: true },
        { key: 'C', content: '聚类', isCorrect: false },
        { key: 'D', content: 'PCA 降维', isCorrect: false },
      ],
    },
    {
      title: '模型评估指标识别',
      type: 'MULTIPLE_CHOICE',
      kpCode: 'ML-KP-010',
      difficulty: 'BASIC',
      score: 8,
      content: '以下哪些可以作为机器学习模型评估指标？',
      correctAnswer: { type: 'multiple_choice', answer: ['A', 'B', 'C', 'D'] },
      analysis: '准确率、召回率、F1 常用于分类任务，均方误差常用于回归任务。',
      options: [
        { key: 'A', content: '准确率', isCorrect: true },
        { key: 'B', content: '召回率', isCorrect: true },
        { key: 'C', content: 'F1 值', isCorrect: true },
        { key: 'D', content: '均方误差', isCorrect: true },
      ],
    },
    {
      title: '决策树的特点',
      type: 'MULTIPLE_CHOICE',
      kpCode: 'ML-KP-005',
      difficulty: 'MEDIUM',
      score: 8,
      content: '关于决策树，下列说法正确的有哪些？',
      correctAnswer: { type: 'multiple_choice', answer: ['A', 'B', 'C'] },
      analysis: '决策树可解释性强，可处理非线性决策边界，也能处理离散或连续特征；但深树容易过拟合。',
      options: [
        { key: 'A', content: '结构直观，可解释性较强', isCorrect: true },
        { key: 'B', content: '可以表达非线性决策边界', isCorrect: true },
        { key: 'C', content: '可以处理离散或连续特征', isCorrect: true },
        { key: 'D', content: '树越深一定越不会过拟合', isCorrect: false },
      ],
    },
    {
      title: '神经网络训练要素',
      type: 'MULTIPLE_CHOICE',
      kpCode: 'ML-KP-009',
      difficulty: 'MEDIUM',
      score: 8,
      content: '训练神经网络时通常需要考虑哪些要素？',
      correctAnswer: { type: 'multiple_choice', answer: ['A', 'B', 'C'] },
      analysis: '神经网络训练通常需要损失函数、优化器和激活函数；神经网络既可用于监督学习，也可用于其他学习范式。',
      options: [
        { key: 'A', content: '损失函数', isCorrect: true },
        { key: 'B', content: '优化器', isCorrect: true },
        { key: 'C', content: '激活函数', isCorrect: true },
        { key: 'D', content: '必须完全不使用标签', isCorrect: false },
      ],
    },
    {
      title: '线性回归损失函数填空',
      type: 'FILL_BLANK',
      kpCode: 'ML-KP-003',
      difficulty: 'BASIC',
      score: 4,
      content: '线性回归常用______作为损失函数，英文缩写通常写作______。',
      correctAnswer: { type: 'fill_blank', answer: ['均方误差', 'MSE'] },
      answerKeywords: ['均方误差', 'MSE', 'Mean Squared Error'],
      analysis: '线性回归常用均方误差衡量预测值与真实值之间的平均平方差，英文为 Mean Squared Error，缩写为 MSE。',
    },
    {
      title: 'PCA 英文全称填空',
      type: 'FILL_BLANK',
      kpCode: 'ML-KP-007',
      difficulty: 'BASIC',
      score: 4,
      content: 'PCA 的英文全称是______，中文通常译为______。',
      correctAnswer: { type: 'fill_blank', answer: ['Principal Component Analysis', '主成分分析'] },
      answerKeywords: ['Principal Component Analysis', '主成分分析', 'PCA'],
      analysis: 'PCA 全称为 Principal Component Analysis，中文译为主成分分析，是经典的线性降维方法。',
    },
    {
      title: '混淆矩阵元素填空',
      type: 'FILL_BLANK',
      kpCode: 'ML-KP-010',
      difficulty: 'MEDIUM',
      score: 5,
      content: '二分类混淆矩阵常包含 TP、FP、TN、______ 四个基本元素。',
      correctAnswer: { type: 'fill_blank', answer: ['FN'] },
      answerKeywords: ['FN', 'False Negative', '假负例'],
      analysis: '混淆矩阵四个元素为 TP、FP、TN、FN，其中 FN 表示实际为正类但预测为负类的样本。',
    },
    {
      title: '无监督学习标签判断',
      type: 'TRUE_FALSE',
      kpCode: 'ML-KP-002',
      difficulty: 'BASIC',
      score: 3,
      content: '无监督学习通常依赖人工标注的目标标签来训练模型。',
      correctAnswer: { type: 'true_false', answer: false },
      analysis: '无监督学习的典型特点是训练数据没有目标标签，算法需要从数据自身结构中发现模式。',
    },
    {
      title: '决策树深度判断',
      type: 'TRUE_FALSE',
      kpCode: 'ML-KP-005',
      difficulty: 'BASIC',
      score: 3,
      content: '决策树深度越大，模型泛化能力一定越好。',
      correctAnswer: { type: 'true_false', answer: false },
      analysis: '树过深可能记住训练集噪声，导致过拟合；通常需要剪枝、限制深度等方式控制复杂度。',
    },
    {
      title: '类别不均衡准确率判断',
      type: 'TRUE_FALSE',
      kpCode: 'ML-KP-010',
      difficulty: 'MEDIUM',
      score: 3,
      content: '在类别极不均衡的数据集中，单独使用准确率可能会产生误导。',
      correctAnswer: { type: 'true_false', answer: true },
      analysis: '当多数类占比很高时，模型即使总是预测多数类也可能得到高准确率，因此还应关注召回率、精确率、F1 等指标。',
    },
    {
      title: '训练集测试集划分原因简答',
      type: 'SHORT_ANSWER',
      kpCode: 'ML-KP-010',
      difficulty: 'MEDIUM',
      score: 12,
      content: '为什么机器学习中通常要划分训练集、验证集或测试集？请简要说明。',
      correctAnswer: {
        type: 'short_answer',
        reference: '训练集用于拟合模型参数，验证集用于模型选择和调参，测试集用于估计模型在未见数据上的泛化能力，避免只根据训练表现判断模型好坏。',
      },
      answerKeywords: ['训练集', '验证集', '测试集', '泛化能力', '调参', '未见数据', '过拟合'],
      analysis: '数据划分的核心目的是评估泛化能力并降低过拟合风险，不能只用训练集表现判断模型质量。',
    },
    {
      title: 'K-means 基本步骤简答',
      type: 'SHORT_ANSWER',
      kpCode: 'ML-KP-006',
      difficulty: 'MEDIUM',
      score: 12,
      content: '请简述 K-means 聚类算法的基本步骤。',
      correctAnswer: {
        type: 'short_answer',
        reference: '先指定 K 并初始化 K 个质心；然后按距离将样本分配到最近质心；再根据簇内样本均值更新质心；重复分配与更新，直到质心变化很小或达到停止条件。',
      },
      answerKeywords: ['指定K', '初始化质心', '距离', '最近质心', '更新质心', '迭代', '收敛'],
      analysis: 'K-means 是“分配样本”和“更新质心”交替迭代的算法，停止条件通常是质心稳定或达到最大迭代次数。',
      isAiGenerated: true,
    },
    {
      title: '过拟合及缓解方法简答',
      type: 'SHORT_ANSWER',
      kpCode: 'ML-KP-010',
      difficulty: 'MEDIUM',
      score: 12,
      content: '请解释什么是过拟合，并列举至少两种常见缓解方法。',
      correctAnswer: {
        type: 'short_answer',
        reference: '过拟合是模型在训练集表现很好但在未见数据上表现较差。常见缓解方法包括增加数据、正则化、交叉验证、剪枝、早停、降低模型复杂度、数据增强等。',
      },
      answerKeywords: ['训练集', '测试集', '泛化', '正则化', '交叉验证', '剪枝', '早停', '增加数据', '降低模型复杂度'],
      analysis: '过拟合说明模型过度贴合训练数据和噪声，需要通过数据、正则化、模型复杂度控制或验证策略来提升泛化能力。',
      isAiGenerated: true,
    },
  ]

  const allQuestions = []
  const questionsByTitle = {}
  for (const def of questionDefs) {
    const kp = knowledgePoints[def.kpCode]
    const questionData = {
      course_id: mlCourse.course_id,
      knowledge_point_id: kp.knowledge_point_id,
      question_type: def.type,
      title: def.title,
      content: def.content,
      correct_answer: def.correctAnswer,
      analysis: def.analysis,
      difficulty_level: def.difficulty,
      score: def.score,
      is_ai_generated: Boolean(def.isAiGenerated),
      created_by_user_id: teacherUser.user_id,
      status: 'active',
    }
    if (def.answerKeywords) {
      questionData.answer_keywords = def.answerKeywords
    }

    let question = await prisma.question.findFirst({
      where: {
        course_id: mlCourse.course_id,
        title: def.title,
      },
    })

    if (question) {
      question = await prisma.question.update({
        where: { question_id: question.question_id },
        data: questionData,
      })
    } else {
      question = await prisma.question.create({ data: questionData })
    }

    for (let i = 0; i < (def.options || []).length; i += 1) {
      const option = def.options[i]
      await prisma.questionOption.upsert({
        where: {
          question_id_option_key: {
            question_id: question.question_id,
            option_key: option.key,
          },
        },
        update: {
          option_content: option.content,
          option_order: i + 1,
          is_correct: Boolean(option.isCorrect),
        },
        create: {
          question_id: question.question_id,
          option_key: option.key,
          option_content: option.content,
          option_order: i + 1,
          is_correct: Boolean(option.isCorrect),
        },
      })
    }

    allQuestions.push(question)
    questionsByTitle[question.title] = question
  }

  for (let i = 0; i < allQuestions.length; i += 1) {
    const sourceType = allQuestions[i].is_ai_generated ? 'ai_generated' : 'manual'
    await prisma.questionBankQuestion.upsert({
      where: {
        question_bank_id_question_id: {
          question_bank_id: questionBank.question_bank_id,
          question_id: allQuestions[i].question_id,
        },
      },
      update: {
        question_order: i + 1,
        source_type: sourceType,
      },
      create: {
        question_bank_id: questionBank.question_bank_id,
        question_id: allQuestions[i].question_id,
        question_order: i + 1,
        source_type: sourceType,
      },
    })
  }
  log(`  已创建/更新机器学习题目 ${allQuestions.length} 道`)

  log('7/15 创建 AI 补题日志')
  const generatedQuestions = [
    questionsByTitle['K-means 基本步骤简答'],
    questionsByTitle['过拟合及缓解方法简答'],
  ].filter(Boolean)

  let generationLog = await prisma.aiQuestionGenerationLog.findFirst({
    where: {
      question_bank_id: questionBank.question_bank_id,
      ai_provider: 'seed',
      model_name: 'seed-question-generator',
    },
  })

  const generationLogData = {
    course_id: mlCourse.course_id,
    teaching_class_id: mlClass2403.teaching_class_id,
    question_bank_id: questionBank.question_bank_id,
    knowledge_point_id: knowledgePoints['ML-KP-010'].knowledge_point_id,
    created_by_user_id: teacherUser.user_id,
    prompt_json: {
      goal: '根据薄弱知识点为机器学习题库补充简答题',
      knowledge_points: ['K-means 聚类', '模型评估指标', '过拟合'],
      question_types: ['SHORT_ANSWER'],
    },
    request_params: {
      count: generatedQuestions.length,
      difficulty_level: 'MEDIUM',
    },
    response_json: {
      accepted_titles: generatedQuestions.map((q) => q.title),
    },
    status: 'SUCCESS',
    generated_question_count: generatedQuestions.length,
    accepted_question_count: generatedQuestions.length,
    ai_provider: 'seed',
    model_name: 'seed-question-generator',
    error_message: null,
  }

  if (generationLog) {
    generationLog = await prisma.aiQuestionGenerationLog.update({
      where: { ai_question_generation_log_id: generationLog.ai_question_generation_log_id },
      data: generationLogData,
    })
  } else {
    generationLog = await prisma.aiQuestionGenerationLog.create({ data: generationLogData })
  }

  for (const question of generatedQuestions) {
    await prisma.aiQuestionGenerationQuestion.upsert({
      where: {
        ai_question_generation_log_id_question_id: {
          ai_question_generation_log_id: generationLog.ai_question_generation_log_id,
          question_id: question.question_id,
        },
      },
      update: { action_status: 'accepted' },
      create: {
        ai_question_generation_log_id: generationLog.ai_question_generation_log_id,
        question_id: question.question_id,
        action_status: 'accepted',
      },
    })
  }

  log('8/15 创建智能答题学习任务')
  let task = await prisma.learningTask.findFirst({
    where: {
      course_id: mlCourse.course_id,
      teaching_class_id: mlClass2403.teaching_class_id,
      title: '机器学习智能答题综合练习',
    },
  })

  const taskData = {
    course_id: mlCourse.course_id,
    teaching_class_id: mlClass2403.teaching_class_id,
    created_by_user_id: teacherUser.user_id,
    task_type: 'QUIZ',
    title: '机器学习智能答题综合练习',
    description: '覆盖机器学习核心知识点的综合练习，共20道题，包含单选、多选、填空、判断和简答题。',
    start_time: new Date('2026-04-01T08:00:00'),
    deadline: new Date('2026-04-15T23:59:59'),
    allow_late_submit: false,
    status: 'PUBLISHED',
  }

  if (task) {
    task = await prisma.learningTask.update({
      where: { task_id: task.task_id },
      data: taskData,
    })
  } else {
    task = await prisma.learningTask.create({ data: taskData })
  }

  for (let i = 0; i < allQuestions.length; i += 1) {
    await prisma.taskQuestion.upsert({
      where: {
        task_id_question_id: {
          task_id: task.task_id,
          question_id: allQuestions[i].question_id,
        },
      },
      update: { question_order: i + 1 },
      create: {
        task_id: task.task_id,
        question_id: allQuestions[i].question_id,
        question_order: i + 1,
      },
    })
  }

  for (const kp of Object.values(knowledgePoints)) {
    await prisma.taskKnowledgePoint.upsert({
      where: {
        task_id_knowledge_point_id: {
          task_id: task.task_id,
          knowledge_point_id: kp.knowledge_point_id,
        },
      },
      update: {},
      create: {
        task_id: task.task_id,
        knowledge_point_id: kp.knowledge_point_id,
      },
    })
  }

  log('9/15 创建学生提交、学生答案与答题记录')
  let submission = await prisma.taskSubmission.findFirst({
    where: {
      task_id: task.task_id,
      student_user_id: studentUser.user_id,
    },
  })

  const submissionData = {
    task_id: task.task_id,
    student_user_id: studentUser.user_id,
    started_at: new Date('2026-04-10T09:00:00'),
    submitted_at: new Date('2026-04-10T09:38:00'),
    duration_seconds: 2280,
    is_late: false,
    total_score: 36,
    objective_score: 24,
    ai_score: 12,
    submission_status: 'GRADED',
    grading_status: 'AI_GRADED',
  }

  if (submission) {
    submission = await prisma.taskSubmission.update({
      where: { submission_id: submission.submission_id },
      data: submissionData,
    })
  } else {
    submission = await prisma.taskSubmission.create({ data: submissionData })
  }

  const answerSeed = [
    {
      title: '监督学习的数据特征',
      answer: { answer: 'B' },
      isCorrect: true,
      score: 5,
      maxScore: 5,
      status: 'AUTO_GRADED',
      feedback: '回答正确，监督学习的训练样本通常带有标签。',
      wrong: false,
    },
    {
      title: '逻辑回归输出含义',
      answer: { answer: 'B' },
      isCorrect: false,
      score: 0,
      maxScore: 5,
      status: 'AUTO_GRADED',
      feedback: '正确答案是 C。逻辑回归输出可解释为正类概率。',
      wrong: true,
    },
    {
      title: '常见监督学习任务',
      answer: { answer: ['A', 'B'] },
      isCorrect: true,
      score: 8,
      maxScore: 8,
      status: 'AUTO_GRADED',
      feedback: '回答正确，分类和回归都属于监督学习任务。',
      wrong: false,
    },
    {
      title: '线性回归损失函数填空',
      answer: { answer: '平方误差; loss' },
      isCorrect: false,
      score: 2,
      maxScore: 4,
      status: 'AUTO_GRADED',
      feedback: '部分正确。标准答案参考：均方误差 / MSE。',
      wrong: true,
    },
    {
      title: '无监督学习标签判断',
      answer: { answer: '错误' },
      isCorrect: true,
      score: 3,
      maxScore: 3,
      status: 'AUTO_GRADED',
      feedback: '回答正确，无监督学习通常不依赖目标标签。',
      wrong: false,
    },
    {
      title: '训练集测试集划分原因简答',
      answer: { answer: '训练集用于训练模型，测试集用来看模型在新数据上的表现，避免只看训练集导致过拟合。' },
      isCorrect: true,
      score: 10,
      maxScore: 12,
      status: 'AI_GRADED',
      feedback: '回答抓住了训练与泛化评估的核心，可进一步补充验证集用于模型选择和调参。',
      wrong: false,
      aiGrading: {
        score: 10,
        total_score: 12,
        comment: '学生能说明训练集和测试集的用途，并提到泛化和过拟合。缺少验证集用于调参的说明。',
        rubric_matched: ['训练集', '测试集', '泛化能力', '过拟合'],
        rubric_missing: ['验证集', '模型选择', '调参'],
      },
    },
  ]

  const answerRecords = []
  for (let i = 0; i < answerSeed.length; i += 1) {
    const seed = answerSeed[i]
    const question = questionsByTitle[seed.title]
    const answerRecord = await findOrCreateAnswerRecord(studentUser.user_id, question.question_id, task.task_id, 1, {
      student_user_id: studentUser.user_id,
      question_id: question.question_id,
      task_id: task.task_id,
      submission_id: submission.submission_id,
      answer_content: seed.answer,
      started_at: new Date(`2026-04-10T09:${String(i * 4).padStart(2, '0')}:00`),
      submitted_at: new Date(`2026-04-10T09:${String(i * 4 + 3).padStart(2, '0')}:00`),
      duration_seconds: 180,
      viewed_analysis: seed.isCorrect,
      attempt_no: 1,
      is_correct: seed.isCorrect,
      score: seed.score,
      max_score: seed.maxScore,
      grading_status: seed.status,
      feedback: seed.feedback,
      auto_added_wrong_book: seed.wrong,
    })

    if (seed.aiGrading) {
      const existingAiGrading = await prisma.aiGradingRecord.findFirst({
        where: { answer_record_id: answerRecord.answer_record_id },
      })
      const aiGradingData = {
        answer_record_id: answerRecord.answer_record_id,
        score: seed.aiGrading.score,
        total_score: seed.aiGrading.total_score,
        comment: seed.aiGrading.comment,
        rubric_matched: seed.aiGrading.rubric_matched,
        rubric_missing: seed.aiGrading.rubric_missing,
        is_ai_generated: true,
        ai_provider: 'seed',
        model_name: 'seed-grader',
      }
      if (existingAiGrading) {
        await prisma.aiGradingRecord.update({
          where: { ai_grading_record_id: existingAiGrading.ai_grading_record_id },
          data: aiGradingData,
        })
      } else {
        await prisma.aiGradingRecord.create({ data: aiGradingData })
      }
    }

    answerRecords.push({ ...answerRecord, seed, question })
  }

  log('10/15 创建错题记录')
  for (const item of answerRecords.filter((record) => record.seed.wrong)) {
    await prisma.wrongQuestion.upsert({
      where: {
        student_user_id_question_id: {
          student_user_id: studentUser.user_id,
          question_id: item.question.question_id,
        },
      },
      update: {
        course_id: mlCourse.course_id,
        knowledge_point_id: item.question.knowledge_point_id,
        source_type: 'auto',
        status: 'UNRESOLVED',
      },
      create: {
        student_user_id: studentUser.user_id,
        question_id: item.question.question_id,
        course_id: mlCourse.course_id,
        knowledge_point_id: item.question.knowledge_point_id,
        source_type: 'auto',
        status: 'UNRESOLVED',
      },
    })
  }

  log('11/15 创建知识点掌握度')
  const masteryData = [
    { code: 'ML-KP-001', score: 84, level: 'GOOD' },
    { code: 'ML-KP-002', score: 76, level: 'GOOD' },
    { code: 'ML-KP-003', score: 62, level: 'GENERAL' },
    { code: 'ML-KP-004', score: 58, level: 'GENERAL' },
    { code: 'ML-KP-005', score: 72, level: 'GOOD' },
    { code: 'ML-KP-006', score: 55, level: 'WEAK' },
    { code: 'ML-KP-007', score: 68, level: 'GENERAL' },
    { code: 'ML-KP-008', score: 46, level: 'WEAK' },
    { code: 'ML-KP-009', score: 48, level: 'WEAK' },
    { code: 'ML-KP-010', score: 79, level: 'GOOD' },
  ]

  for (const item of masteryData) {
    const kp = knowledgePoints[item.code]
    await prisma.studentMasteryRecord.upsert({
      where: {
        student_user_id_course_id_knowledge_point_id: {
          student_user_id: studentUser.user_id,
          course_id: mlCourse.course_id,
          knowledge_point_id: kp.knowledge_point_id,
        },
      },
      update: {
        mastery_score: item.score,
        mastery_level: item.level,
        quiz_score: Math.round(item.score * 0.6 * 100) / 100,
        question_score: Math.round(item.score * 0.25 * 100) / 100,
        study_progress_score: Math.round(item.score * 0.15 * 100) / 100,
      },
      create: {
        student_user_id: studentUser.user_id,
        course_id: mlCourse.course_id,
        knowledge_point_id: kp.knowledge_point_id,
        mastery_score: item.score,
        mastery_level: item.level,
        quiz_score: Math.round(item.score * 0.6 * 100) / 100,
        question_score: Math.round(item.score * 0.25 * 100) / 100,
        study_progress_score: Math.round(item.score * 0.15 * 100) / 100,
      },
    })
  }

  log('12/15 创建学习记录与画像')
  let studyRecord = await prisma.studyRecord.findFirst({
    where: {
      student_user_id: studentUser.user_id,
      course_id: mlCourse.course_id,
      knowledge_point_id: knowledgePoints['ML-KP-010'].knowledge_point_id,
      resource_type: 'question_bank',
      resource_id: questionBank.question_bank_id,
    },
  })
  if (!studyRecord) {
    await prisma.studyRecord.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: mlCourse.course_id,
        knowledge_point_id: knowledgePoints['ML-KP-010'].knowledge_point_id,
        resource_type: 'question_bank',
        resource_id: questionBank.question_bank_id,
        action_type: 'FINISH',
        started_at: new Date('2026-04-10T09:00:00'),
        finished_at: new Date('2026-04-10T09:38:00'),
        duration_seconds: 2280,
        progress_percent: 100,
      },
    })
  }

  await prisma.studentPortrait.upsert({
    where: {
      student_user_id_course_id: {
        student_user_id: studentUser.user_id,
        course_id: mlCourse.course_id,
      },
    },
    update: {
      learning_total_score: 68,
      progress_score: 72,
      mastery_score: 64.8,
      test_score: 66,
      wrong_question_score: 58,
      activity_score: 75,
      qa_score: 70,
    },
    create: {
      student_user_id: studentUser.user_id,
      course_id: mlCourse.course_id,
      learning_total_score: 68,
      progress_score: 72,
      mastery_score: 64.8,
      test_score: 66,
      wrong_question_score: 58,
      activity_score: 75,
      qa_score: 70,
      research_total_score: 0,
      competition_total_score: 0,
    },
  })

  const snapshotDate = new Date('2026-06-30T00:00:00')
  await prisma.studentPortraitSnapshot.upsert({
    where: {
      student_user_id_course_id_snapshot_date: {
        student_user_id: studentUser.user_id,
        course_id: mlCourse.course_id,
        snapshot_date: snapshotDate,
      },
    },
    update: {
      learning_scores: {
        learning_total_score: 68,
        progress_score: 72,
        mastery_score: 64.8,
        test_score: 66,
        wrong_question_score: 58,
        activity_score: 75,
        qa_score: 70,
      },
      mastery_summary: {
        weak: 3,
        general: 3,
        good: 4,
        excellent: 0,
        weak_points: ['K-means 聚类', 'SVM 支持向量机', '神经网络基础'],
      },
      activity_summary: {
        total_study_time_minutes: 38,
        total_questions_answered: answerRecords.length,
        total_ai_questions: generatedQuestions.length,
        correct_rate: 67,
      },
    },
    create: {
      student_user_id: studentUser.user_id,
      course_id: mlCourse.course_id,
      snapshot_date: snapshotDate,
      learning_scores: {
        learning_total_score: 68,
        progress_score: 72,
        mastery_score: 64.8,
        test_score: 66,
        wrong_question_score: 58,
        activity_score: 75,
        qa_score: 70,
      },
      mastery_summary: {
        weak: 3,
        general: 3,
        good: 4,
        excellent: 0,
        weak_points: ['K-means 聚类', 'SVM 支持向量机', '神经网络基础'],
      },
      activity_summary: {
        total_study_time_minutes: 38,
        total_questions_answered: answerRecords.length,
        total_ai_questions: generatedQuestions.length,
        correct_rate: 67,
      },
    },
  })

  log('13/15 创建 AI 问答与问题分析记录')
  let conversation = await prisma.chatConversation.findFirst({
    where: {
      user_id: studentUser.user_id,
      course_id: mlCourse.course_id,
      title: '机器学习智能答题学习咨询',
    },
  })
  if (!conversation) {
    conversation = await prisma.chatConversation.create({
      data: {
        user_id: studentUser.user_id,
        course_id: mlCourse.course_id,
        teaching_class_id: mlClass2403.teaching_class_id,
        agent_type: 'COURSE_QA',
        title: '机器学习智能答题学习咨询',
      },
    })
  }

  let userMessage = await prisma.chatMessage.findFirst({
    where: {
      conversation_id: conversation.conversation_id,
      role: 'USER',
      content: { contains: '过拟合' },
    },
  })
  if (!userMessage) {
    userMessage = await prisma.chatMessage.create({
      data: {
        conversation_id: conversation.conversation_id,
        user_id: studentUser.user_id,
        role: 'USER',
        content: '我在智能答题里总是把过拟合和欠拟合混淆，应该怎么区分？',
        is_ai_generated: false,
      },
    })
  }

  let assistantMessage = await prisma.chatMessage.findFirst({
    where: {
      conversation_id: conversation.conversation_id,
      role: 'ASSISTANT',
      content: { contains: '训练集表现' },
    },
  })
  if (!assistantMessage) {
    assistantMessage = await prisma.chatMessage.create({
      data: {
        conversation_id: conversation.conversation_id,
        user_id: null,
        role: 'ASSISTANT',
        content: '可以用训练集和测试集表现来区分：过拟合通常是训练集表现很好、测试集表现较差；欠拟合则是训练集和测试集表现都不理想。复习时可以结合正则化、剪枝、早停和增加数据等方法理解。',
        is_ai_generated: true,
        ai_provider: 'seed',
        model_name: 'seed-chat',
        agent_type: 'COURSE_QA',
      },
    })
  }

  let studentQuestion = await prisma.studentQuestionRecord.findFirst({
    where: {
      student_user_id: studentUser.user_id,
      message_id: userMessage.message_id,
    },
  })
  if (!studentQuestion) {
    studentQuestion = await prisma.studentQuestionRecord.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: mlCourse.course_id,
        conversation_id: conversation.conversation_id,
        message_id: userMessage.message_id,
        raw_question: userMessage.content,
      },
    })
  }

  let analysisRecord = await prisma.questionAnalysisRecord.findFirst({
    where: { student_question_id: studentQuestion.student_question_id },
  })
  if (analysisRecord) {
    analysisRecord = await prisma.questionAnalysisRecord.update({
      where: { analysis_id: analysisRecord.analysis_id },
      data: {
        raw_question: userMessage.content,
        question_summary: '学生混淆过拟合与欠拟合的判断标准',
        knowledge_point_id: knowledgePoints['ML-KP-010'].knowledge_point_id,
        normalized_question_type: 'concept_discrimination',
        confidence: 0.92,
        need_teacher_review: false,
      },
    })
  } else {
    analysisRecord = await prisma.questionAnalysisRecord.create({
      data: {
        student_question_id: studentQuestion.student_question_id,
        raw_question: userMessage.content,
        question_summary: '学生混淆过拟合与欠拟合的判断标准',
        knowledge_point_id: knowledgePoints['ML-KP-010'].knowledge_point_id,
        normalized_question_type: 'concept_discrimination',
        confidence: 0.92,
        need_teacher_review: false,
      },
    })
  }

  const existingMapping = await prisma.questionKnowledgePointMapping.findFirst({
    where: {
      analysis_id: analysisRecord.analysis_id,
      knowledge_point_id: knowledgePoints['ML-KP-010'].knowledge_point_id,
    },
  })
  const mappingData = {
    analysis_id: analysisRecord.analysis_id,
    knowledge_point_id: knowledgePoints['ML-KP-010'].knowledge_point_id,
    similarity: 0.92,
    source: 'seed',
    is_final: true,
  }
  if (existingMapping) {
    await prisma.questionKnowledgePointMapping.update({
      where: { mapping_id: existingMapping.mapping_id },
      data: {
        similarity: 0.92,
        source: 'seed',
        is_final: true,
      },
    })
  } else {
    await prisma.questionKnowledgePointMapping.create({
      data: mappingData,
    })
  }

  log('14/15 创建推荐记录')
  let recommendation = await prisma.recommendationRecord.findFirst({
    where: {
      student_user_id: studentUser.user_id,
      course_id: mlCourse.course_id,
    },
  })
  if (recommendation) {
    recommendation = await prisma.recommendationRecord.update({
      where: { recommendation_record_id: recommendation.recommendation_record_id },
      data: {
        recommend_type: 'ALL',
        reason_summary: '基于智能答题结果，学生在逻辑回归、线性回归损失函数、SVM 和神经网络等知识点仍需巩固。',
      },
    })
  } else {
    recommendation = await prisma.recommendationRecord.create({
      data: {
        student_user_id: studentUser.user_id,
        course_id: mlCourse.course_id,
        recommend_type: 'ALL',
        reason_summary: '基于智能答题结果，学生在逻辑回归、线性回归损失函数、SVM 和神经网络等知识点仍需巩固。',
      },
    })
  }

  const recommendationItems = [
    { title: '复习逻辑回归输出与概率解释', targetId: knowledgePoints['ML-KP-004'].knowledge_point_id, rank: 1 },
    { title: '巩固线性回归损失函数', targetId: knowledgePoints['ML-KP-003'].knowledge_point_id, rank: 2 },
    { title: '补做 SVM 最大间隔练习', targetId: knowledgePoints['ML-KP-008'].knowledge_point_id, rank: 3 },
  ]

  for (const item of recommendationItems) {
    const existing = await prisma.recommendationItem.findFirst({
      where: {
        recommendation_record_id: recommendation.recommendation_record_id,
        title: item.title,
      },
    })
    const itemData = {
      recommendation_record_id: recommendation.recommendation_record_id,
      item_type: 'knowledge_point',
      target_type: 'knowledge_point',
      target_id: item.targetId,
      title: item.title,
      content: { source: 'smart_answering_seed' },
      reason: '由智能答题记录和知识点掌握度生成',
      rank: item.rank,
    }
    if (existing) {
      await prisma.recommendationItem.update({
        where: { recommendation_item_id: existing.recommendation_item_id },
        data: itemData,
      })
    } else {
      await prisma.recommendationItem.create({ data: itemData })
    }
  }

  log('15/16 创建教师端闭环演示数据')
  const now = new Date()
  const ago = (days, hours = 0) => new Date(now.getTime() - (days * 24 + hours) * 60 * 60 * 1000)
  const later = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  const class2403Students = analyticsStudents.slice(0, 6)

  for (let studentIndex = 0; studentIndex < analyticsStudents.length; studentIndex += 1) {
    const demoStudent = analyticsStudents[studentIndex]
    for (let kpIndex = 0; kpIndex < Math.min(8, Object.keys(knowledgePoints).length); kpIndex += 1) {
      const kp = knowledgePoints[`ML-KP-${String(kpIndex + 1).padStart(3, '0')}`]
      if (!kp) continue
      const score = Math.max(32, Math.min(96, 91 - studentIndex * 7 - ((kpIndex * 9 + studentIndex * 3) % 26)))
      const level = score >= 85 ? 'EXCELLENT' : score >= 70 ? 'GOOD' : score >= 55 ? 'GENERAL' : 'WEAK'
      await prisma.studentMasteryRecord.upsert({
        where: { student_user_id_course_id_knowledge_point_id: { student_user_id: demoStudent.user_id, course_id: mlCourse.course_id, knowledge_point_id: kp.knowledge_point_id } },
        update: { mastery_score: score, mastery_level: level, quiz_score: score * 0.6, question_score: score * 0.25, study_progress_score: score * 0.15 },
        create: { student_user_id: demoStudent.user_id, course_id: mlCourse.course_id, knowledge_point_id: kp.knowledge_point_id, mastery_score: score, mastery_level: level, quiz_score: score * 0.6, question_score: score * 0.25, study_progress_score: score * 0.15 },
      })
    }
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const startedAt = ago(dayOffset, 2 + studentIndex)
      const existingStudy = await prisma.studyRecord.findFirst({ where: { student_user_id: demoStudent.user_id, course_id: mlCourse.course_id, resource_type: 'teacher_analytics_seed', resource_id: dayOffset + 1 } })
      const studyData = { knowledge_point_id: knowledgePoints[`ML-KP-${String((dayOffset % 8) + 1).padStart(3, '0')}`]?.knowledge_point_id, action_type: 'FINISH', started_at: startedAt, finished_at: new Date(startedAt.getTime() + (18 + studentIndex * 3 + dayOffset) * 60 * 1000), duration_seconds: (18 + studentIndex * 3 + dayOffset) * 60, progress_percent: 100, created_at: startedAt }
      if (existingStudy) await prisma.studyRecord.update({ where: { study_record_id: existingStudy.study_record_id }, data: studyData })
      else await prisma.studyRecord.create({ data: { student_user_id: demoStudent.user_id, course_id: mlCourse.course_id, resource_type: 'teacher_analytics_seed', resource_id: dayOffset + 1, ...studyData } })
    }
    const questionTexts = [
      '决策树剪枝为什么能缓解过拟合？', '逻辑回归输出是概率还是分类标签？', '交叉验证和测试集有什么区别？',
      '支持向量机的最大间隔应该怎样理解？', '训练集准确率很高为什么测试效果仍然差？', 'PCA 降维后特征还能解释吗？',
    ]
    const rawQuestion = questionTexts[studentIndex % questionTexts.length]
    let questionRecord = await prisma.studentQuestionRecord.findFirst({ where: { student_user_id: demoStudent.user_id, course_id: mlCourse.course_id, raw_question: rawQuestion } })
    if (!questionRecord) questionRecord = await prisma.studentQuestionRecord.create({ data: { student_user_id: demoStudent.user_id, course_id: mlCourse.course_id, raw_question: rawQuestion, created_at: ago(studentIndex % 6) } })
    else questionRecord = await prisma.studentQuestionRecord.update({ where: { student_question_id: questionRecord.student_question_id }, data: { created_at: ago(studentIndex % 6) } })
    let analysis = await prisma.questionAnalysisRecord.findFirst({ where: { student_question_id: questionRecord.student_question_id } })
    if (!analysis) analysis = await prisma.questionAnalysisRecord.create({ data: { student_question_id: questionRecord.student_question_id, raw_question: rawQuestion, question_summary: rawQuestion, knowledge_point_id: knowledgePoints[`ML-KP-${String((studentIndex % 8) + 1).padStart(3, '0')}`]?.knowledge_point_id, normalized_question_type: 'concept_understanding', confidence: 0.88, need_teacher_review: studentIndex % 3 === 0 } })
    const keyword = ['过拟合', '逻辑回归', '交叉验证', '最大间隔', '泛化能力', 'PCA'][studentIndex % 6]
    if (!await prisma.questionKeyword.findFirst({ where: { analysis_id: analysis.analysis_id, keyword } })) await prisma.questionKeyword.create({ data: { analysis_id: analysis.analysis_id, keyword, weight: 0.9 } })
    if (studentIndex % 3 === 0 && !await prisma.questionConfusionTag.findFirst({ where: { analysis_id: analysis.analysis_id, tag: '概念边界混淆' } })) await prisma.questionConfusionTag.create({ data: { analysis_id: analysis.analysis_id, tag: '概念边界混淆' } })
  }

  async function upsertTeachingTask(title, taskType, startTime, deadline, questionSlice, settings = {}) {
    const totalScore = questionSlice.reduce((sum, item) => sum + Number(item.score || 0), 0)
    const data = { course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, created_by_user_id: teacherUser.user_id, task_type: taskType, title, description: settings.description, start_time: startTime, deadline, allow_late_submit: !!settings.allowLate, duration_minutes: settings.duration || null, allowed_attempts: settings.attempts || 1, randomize_questions: !!settings.randomize, randomize_options: !!settings.randomize, auto_grade: true, ai_grade_subjective: true, full_screen_mode: taskType === 'EXAM', source_mode: 'mixed', total_score: totalScore, pass_score: totalScore * 0.6, instructions: settings.instructions || '请在规定时间内完成并提交。', rules: taskType === 'EXAM' ? '独立作答，离开全屏时系统将提示。' : null, configuration_json: { question_bank_ratio: 0.7, ai_ratio: 0.3, seed: 'teacher-platform-v1' }, status: 'PUBLISHED', published_at: startTime, score_release_at: deadline, analysis_release_at: deadline }
    let row = await prisma.learningTask.findFirst({ where: { teaching_class_id: mlClass2403.teaching_class_id, title } })
    row = row ? await prisma.learningTask.update({ where: { task_id: row.task_id }, data }) : await prisma.learningTask.create({ data })
    for (let index = 0; index < questionSlice.length; index += 1) await prisma.taskQuestion.upsert({ where: { task_id_question_id: { task_id: row.task_id, question_id: questionSlice[index].question_id } }, update: { question_order: index + 1, score: questionSlice[index].score }, create: { task_id: row.task_id, question_id: questionSlice[index].question_id, question_order: index + 1, score: questionSlice[index].score } })
    await prisma.learningTaskRecipient.createMany({ data: class2403Students.map(student => ({ task_id: row.task_id, student_user_id: student.user_id, teaching_class_id: mlClass2403.teaching_class_id, delivery_status: 'delivered' })), skipDuplicates: true })
    for (const student of class2403Students) await prisma.notification.upsert({ where: { idempotency_key: `seed:task:${row.task_id}:student:${student.user_id}` }, update: { title: `${taskType === 'EXAM' ? '考试' : '作业'}：${title}`, content: settings.description, deleted_at: null }, create: { receiver_user_id: student.user_id, sender_user_id: teacherUser.user_id, notification_type: 'TASK_PUBLISHED', title: `${taskType === 'EXAM' ? '考试' : '作业'}：${title}`, content: settings.description, target_type: 'learning_task', target_id: row.task_id, business_type: taskType === 'EXAM' ? 'exam' : 'homework', business_id: row.task_id, idempotency_key: `seed:task:${row.task_id}:student:${student.user_id}` } })
    return row
  }

  const recentHomework = await upsertTeachingTask('模型评估与过拟合巩固作业', 'HOMEWORK', ago(3), later(4), allQuestions.slice(0, 8), { description: '围绕交叉验证、过拟合与泛化能力完成分层练习。', allowLate: true, attempts: 2 })
  const upcomingExam = await upsertTeachingTask('机器学习期末综合测验', 'EXAM', later(6), later(6.08), allQuestions.slice(5, 15), { description: '覆盖监督学习、无监督学习与模型评估。', duration: 120, randomize: true })
  for (let index = 0; index < 4; index += 1) {
    const demoStudent = class2403Students[index]
    const submissionData = { started_at: ago(1, index), submitted_at: ago(1, index - 1), duration_seconds: 2100 + index * 180, is_late: false, total_score: Math.max(45, 92 - index * 11), objective_score: Math.max(30, 67 - index * 8), ai_score: Math.max(10, 25 - index * 3), submission_status: 'GRADED', grading_status: 'AI_GRADED' }
    let recentSubmission = await prisma.taskSubmission.findFirst({ where: { task_id: recentHomework.task_id, student_user_id: demoStudent.user_id } })
    recentSubmission = recentSubmission ? await prisma.taskSubmission.update({ where: { submission_id: recentSubmission.submission_id }, data: submissionData }) : await prisma.taskSubmission.create({ data: { task_id: recentHomework.task_id, student_user_id: demoStudent.user_id, ...submissionData } })
    const answerQuestion = allQuestions[index % allQuestions.length]
    await findOrCreateAnswerRecord(demoStudent.user_id, answerQuestion.question_id, recentHomework.task_id, 1, { student_user_id: demoStudent.user_id, question_id: answerQuestion.question_id, task_id: recentHomework.task_id, submission_id: recentSubmission.submission_id, answer_content: { answer: index % 2 ? '错误示例答案' : '正确示例答案' }, started_at: ago(1, index), submitted_at: ago(1, index - 1), duration_seconds: 240, attempt_no: 1, is_correct: index % 2 === 0, score: index % 2 === 0 ? answerQuestion.score : 0, max_score: answerQuestion.score, grading_status: 'AUTO_GRADED', feedback: index % 2 === 0 ? '回答正确' : '需要重新理解该知识点', auto_added_wrong_book: index % 2 !== 0 })
    if (index % 2 !== 0) await prisma.wrongQuestion.upsert({ where: { student_user_id_question_id: { student_user_id: demoStudent.user_id, question_id: answerQuestion.question_id } }, update: { status: 'UNRESOLVED', last_wrong_at: ago(1), knowledge_point_id: answerQuestion.knowledge_point_id, course_id: mlCourse.course_id }, create: { student_user_id: demoStudent.user_id, question_id: answerQuestion.question_id, course_id: mlCourse.course_id, knowledge_point_id: answerQuestion.knowledge_point_id, status: 'UNRESOLVED', last_wrong_at: ago(1) } })
    await prisma.notification.upsert({ where: { idempotency_key: `seed:submission:${recentHomework.task_id}:${demoStudent.user_id}:teacher` }, update: { read_at: null, is_read: false }, create: { receiver_user_id: teacherUser.user_id, sender_user_id: demoStudent.user_id, notification_type: 'TASK_SUBMITTED', title: `${demoStudent.username} 已提交作业`, content: recentHomework.title, target_type: 'learning_task', target_id: recentHomework.task_id, business_type: 'homework_submission', business_id: recentSubmission.submission_id, idempotency_key: `seed:submission:${recentHomework.task_id}:${demoStudent.user_id}:teacher` } })
  }

  const publicKb = await prisma.knowledgeBase.upsert({
    where: { operation_id: 'seed-teacher-kb-public-review' },
    update: { name: '机器学习错题共建知识库', course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, owner_user_id: studentUser.user_id, marketplace_visibility: 'PUBLIC_PENDING', marketplace_status: 'PENDING_REVIEW', deleted_at: null },
    create: { name: '机器学习错题共建知识库', scope_type: 'CLASS', course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, owner_user_id: studentUser.user_id, description: '学生整理的模型评估错题、辨析笔记与复习提示，申请在课程范围公开。', provider: 'LOCAL', ownership_mode: 'LOCAL_MANAGED', marketplace_visibility: 'PUBLIC_PENDING', marketplace_status: 'PENDING_REVIEW', operation_id: 'seed-teacher-kb-public-review' },
  })
  await prisma.knowledgeBaseReviewRecord.upsert({ where: { operationId: 'seed-kb-submit-ml-wrong' }, update: { action: 'SUBMITTED', reason: '希望与教学班同学共享模型评估错题总结。', reviewerUserId: null }, create: { knowledgeBaseId: publicKb.knowledge_base_id, action: 'SUBMITTED', reason: '希望与教学班同学共享模型评估错题总结。', operationId: 'seed-kb-submit-ml-wrong' } })
  await prisma.knowledgeDocument.upsert({ where: { operation_id: 'seed-kb-doc-ml-wrong' }, update: { knowledge_base_id: publicKb.knowledge_base_id, deleted_at: null }, create: { knowledge_base_id: publicKb.knowledge_base_id, title: '模型评估错题总结', original_filename: '模型评估错题总结.md', file_ext: 'md', file_size_bytes: 2048, mime_type: 'text/markdown', file_url: '/seed/knowledge/model-evaluation-errors.md', scope_type: 'CLASS', visibility: 'CLASS', course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, owner_user_id: studentUser.user_id, parse_status: 'PARSED', review_status: 'PENDING', marketplace_status: 'READY', operation_id: 'seed-kb-doc-ml-wrong', cleaned_text: '交叉验证用于模型选择；测试集用于最终泛化评估。过拟合表现为训练集指标显著高于验证集与测试集。' } })
  const teachingResource = await prisma.knowledgeDocument.upsert({
    where: { operation_id: 'seed-teaching-resource-model-eval' },
    update: { deleted_at: null, course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, resource_group_id: 'seed-resource-model-eval', resource_version: 1, version_source: 'TEACHER_EDIT', resource_status: 'ACTIVE' },
    create: { title: '模型评估课堂补充材料', original_filename: '模型评估课堂补充材料.md', file_ext: 'md', file_size_bytes: 4096, mime_type: 'text/markdown', file_url: '/seed/resources/model-evaluation.md', scope_type: 'CLASS', visibility: 'CLASS', course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, owner_user_id: teacherUser.user_id, is_teaching_resource: true, resource_kind: 'MARKDOWN', resource_category: '课堂讲义', metadata_json: { tags: ['模型评估', '交叉验证', '过拟合'] }, resource_group_id: 'seed-resource-model-eval', resource_version: 1, version_source: 'TEACHER_EDIT', folder_path: '机器学习/模型评估', tags_json: ['模型评估', '交叉验证', '过拟合'], resource_status: 'ACTIVE', parse_status: 'PARSED', review_status: 'APPROVED', marketplace_status: 'READY', operation_id: 'seed-teaching-resource-model-eval', cleaned_text: '本材料包含交叉验证、偏差方差分解、过拟合诊断和正则化的课堂示例。' },
  })
  const resourceDistribution = await prisma.resourceDistribution.upsert({
    where: { operation_id: 'seed-resource-distribution-model-eval' },
    update: { resource_id: teachingResource.document_id, title: teachingResource.title, status: 'PUBLISHED', publish_at: ago(2), due_at: later(5) },
    create: { resource_id: teachingResource.document_id, sender_user_id: teacherUser.user_id, course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, title: teachingResource.title, description: '课前阅读模型评估案例，课堂将结合学习曲线进行诊断。', distribution_type: 'pre_class_material', resource_version: 1, publish_at: ago(2), due_at: later(5), status: 'PUBLISHED', operation_id: 'seed-resource-distribution-model-eval' },
  })
  await prisma.resourceRecipient.createMany({ data: class2403Students.map(student => ({ distribution_id: resourceDistribution.distribution_id, student_user_id: student.user_id })), skipDuplicates: true })
  for (let index = 0; index < class2403Students.length; index += 1) {
    const demoStudent = class2403Students[index]
    const readAt = index < 4 ? ago(1, index) : null
    const downloadedAt = index < 2 ? ago(1, index - 1) : null
    const completedAt = index === 0 ? ago(0, 6) : null
    await prisma.resourceRecipient.update({ where: { distribution_id_student_user_id: { distribution_id: resourceDistribution.distribution_id, student_user_id: demoStudent.user_id } }, data: { read_at: readAt, downloaded_at: downloadedAt, completed_at: completedAt, status: completedAt ? 'COMPLETED' : downloadedAt ? 'DOWNLOADED' : readAt ? 'READ' : 'UNREAD' } })
    await prisma.notification.upsert({ where: { idempotency_key: `resource-distribution:${resourceDistribution.distribution_id}:student:${demoStudent.user_id}` }, update: { deleted_at: null, is_read: Boolean(readAt), read_at: readAt }, create: { receiver_user_id: demoStudent.user_id, sender_user_id: teacherUser.user_id, notification_type: 'RESOURCE_SHARED', title: `教学资源：${teachingResource.title}`, content: resourceDistribution.description, target_type: 'resource_distribution', target_id: resourceDistribution.distribution_id, business_type: 'resource_distribution', business_id: resourceDistribution.distribution_id, idempotency_key: `resource-distribution:${resourceDistribution.distribution_id}:student:${demoStudent.user_id}`, is_read: Boolean(readAt), read_at: readAt } })
  }

  let lessonPlan = await prisma.lessonPlan.findFirst({ where: { teacher_user_id: teacherUser.user_id, teaching_class_id: mlClass2403.teaching_class_id, topic: '模型评估与过拟合诊断' } })
  const seededVersionMaximum = lessonPlan
    ? await prisma.lessonPlanVersion.aggregate({ where: { lesson_plan_id: lessonPlan.lesson_plan_id }, _max: { version_number: true } })
    : { _max: { version_number: null } }
  const lessonPlanData = { course_id: mlCourse.course_id, course_offering_id: mlClass2403.course_offering_id, teaching_class_id: mlClass2403.teaching_class_id, chapter_id: chapters['模型评估与优化']?.chapter_id, teaching_date: later(2), duration_minutes: 90, lesson_type: '新授课', location: '博学楼 A201', textbook: '机器学习（周志华）', input_json: { use_case: true, discussion: true, in_class_practice: true, include_homework: true, analytics_range: '30d' }, source_snapshot_json: { student_count: class2403Students.length, average_mastery: 64.2, weak_knowledge_points: ['交叉验证', '过拟合与欠拟合'] }, status: 'READY', current_version: Math.max(1, lessonPlan?.current_version || 0, seededVersionMaximum._max.version_number || 0), progress: 100 }
  lessonPlan = lessonPlan ? await prisma.lessonPlan.update({ where: { lesson_plan_id: lessonPlan.lesson_plan_id }, data: lessonPlanData }) : await prisma.lessonPlan.create({ data: { teacher_user_id: teacherUser.user_id, topic: '模型评估与过拟合诊断', ...lessonPlanData } })
  const lessonContent = { classProfile: '软件2403班共 6 名演示学生，平均掌握度存在明显分层。', studentAnalytics: '交叉验证、过拟合诊断与泛化能力是当前薄弱点。', teachingObjectives: ['能区分训练集、验证集与测试集', '能用学习曲线判断过拟合与欠拟合'], keyPoints: ['交叉验证', '模型泛化'], difficultPoints: ['偏差与方差权衡'], lessonIntroduction: '从训练准确率 99% 但线上效果差的真实情境引入。', activities: [{ minutes: 15, teacher: '展示案例并提问', student: '观察指标差异' }, { minutes: 45, teacher: '讲解并演示学习曲线', student: '分组诊断模型' }, { minutes: 20, teacher: '组织分层练习', student: '完成诊断题' }], questions: ['训练准确率高是否一定意味着模型好？', '验证集可以替代测试集吗？'], exercises: ['识别三条学习曲线对应的问题', '为过拟合模型选择改进策略'], assessments: ['随堂投票', '出口卡'], homework: '完成模型评估巩固作业并订正错题。', resources: ['模型评估课堂补充材料'], reviewResult: { alignment: 92, time_reasonable: true, complete: true } }
  await prisma.lessonPlanVersion.upsert({ where: { lesson_plan_id_version_number: { lesson_plan_id: lessonPlan.lesson_plan_id, version_number: 1 } }, update: { merged_content_json: lessonContent, teacher_content_json: lessonContent, change_summary: '教师端演示基线版本' }, create: { lesson_plan_id: lessonPlan.lesson_plan_id, version_number: 1, created_by_user_id: teacherUser.user_id, change_summary: '教师端演示基线版本', ai_content_json: lessonContent, teacher_content_json: lessonContent, merged_content_json: lessonContent, locked_blocks_json: ['teachingObjectives'], data_range_json: { range: '30d' }, agents_json: ['StudentAnalyticsAgent', 'CurriculumPlannerAgent', 'LessonQualityReviewAgent'], data_sources_json: ['mastery', 'tasks', 'dialogue', 'wrong_questions'] } })
  await prisma.teacherStudentIntervention.upsert({ where: { intervention_id: (await prisma.teacherStudentIntervention.findFirst({ where: { teacher_user_id: teacherUser.user_id, student_user_id: analyticsStudents[4].user_id, course_id: mlCourse.course_id, status: 'open' }, select: { intervention_id: true } }))?.intervention_id || -1 }, update: { content: '连续两次作业完成度偏低，建议本周完成交叉验证专项练习。', follow_up_at: later(3) }, create: { teacher_user_id: teacherUser.user_id, student_user_id: analyticsStudents[4].user_id, course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, intervention_type: 'learning_risk', content: '连续两次作业完成度偏低，建议本周完成交叉验证专项练习。', status: 'open', follow_up_at: later(3) } })
  await prisma.teacherAnalyticsSnapshot.upsert({ where: { cache_key: 'seed:teacher:ml:2403:30d' }, update: { result_json: { overview: { student_count: class2403Students.length, average_mastery: 64.2, task_completion_rate: 66.7 }, weak_knowledge_points: ['交叉验证', '过拟合与欠拟合'] }, data_sources_json: { models: ['StudentMasteryRecord', 'TaskSubmission', 'StudyRecord', 'StudentQuestionRecord'], seed: true }, generated_at: now, expires_at: later(1) }, create: { teacher_user_id: teacherUser.user_id, course_id: mlCourse.course_id, teaching_class_id: mlClass2403.teaching_class_id, analysis_type: 'workbench', filter_json: { range: '30d' }, result_json: { overview: { student_count: class2403Students.length, average_mastery: 64.2, task_completion_rate: 66.7 }, weak_knowledge_points: ['交叉验证', '过拟合与欠拟合'] }, data_sources_json: { models: ['StudentMasteryRecord', 'TaskSubmission', 'StudyRecord', 'StudentQuestionRecord'], seed: true }, cache_key: 'seed:teacher:ml:2403:30d', generated_at: now, expires_at: later(1) } })
  const artifactPayload = { lessonPlanId: lessonPlan.lesson_plan_id, artifactType: 'LESSON_PLAN', title: '模型评估与过拟合诊断教案', description: '智慧备课演示产物', courseId: mlCourse.course_id, requirementsJson: { lesson_plan_id: lessonPlan.lesson_plan_id }, previewHtml: '<h1>模型评估与过拟合诊断</h1><p>教师端智慧备课演示产物，可在备课工作台重新导出 DOCX/PDF。</p>', fileFormat: 'DOCX', status: 'DRAFT', deletedAt: null }
  const existingArtifact = await prisma.generatedArtifact.findFirst({ where: { ownerUserId: teacherUser.user_id, operationId: 'seed-lesson-plan-artifact' } })
  if (existingArtifact) await prisma.generatedArtifact.update({ where: { id: existingArtifact.id }, data: artifactPayload })
  else await prisma.generatedArtifact.create({ data: { ownerUserId: teacherUser.user_id, operationId: 'seed-lesson-plan-artifact', ...artifactPayload } })
  const reminderSeeds = [
    { businessId: 9101, title: '课前检查：模型评估与过拟合诊断', description: '检查课件转换状态、教案版本和课堂任务单。', startAt: later(1), remindAt: new Date(later(1).getTime() - 30 * 60000), priority: 'high', reminderType: 'lesson_preparation', recurrenceRule: null },
    { businessId: 9102, title: '批改机器学习阶段作业', description: '优先处理高风险学生和待回复疑问。', startAt: later(2), remindAt: new Date(later(2).getTime() - 60 * 60000), priority: 'normal', reminderType: 'homework_review', recurrenceRule: null },
    { businessId: 9103, title: '每周教学复盘', description: '结合学情分析词云、薄弱知识点和任务完成率调整下一周教学。', startAt: later(3), remindAt: new Date(later(3).getTime() - 15 * 60000), priority: 'normal', reminderType: 'weekly_review', recurrenceRule: { frequency: 'weekly', interval: 1 } },
  ]
  for (const reminder of reminderSeeds) {
    const existing = await prisma.teacherReminder.findFirst({ where: { teacherUserId: teacherUser.user_id, businessType: 'seed_teacher_reminder', businessId: reminder.businessId } })
    const data = { ...reminder, teacherUserId: teacherUser.user_id, courseId: mlCourse.course_id, teachingClassId: mlClass2403.teaching_class_id, businessType: 'seed_teacher_reminder', status: 'pending', advanceMinutes: Math.max(0, Math.round((reminder.startAt.getTime() - reminder.remindAt.getTime()) / 60000)), snoozedUntil: null, completedAt: null, dismissedAt: null }
    if (existing) await prisma.teacherReminder.update({ where: { id: existing.id }, data })
    else await prisma.teacherReminder.create({ data })
  }
  await prisma.notification.upsert({ where: { idempotency_key: 'seed:teacher:kb-review-pending' }, update: { is_read: false, read_at: null, deleted_at: null }, create: { receiver_user_id: teacherUser.user_id, sender_user_id: studentUser.user_id, notification_type: 'KNOWLEDGE_APPLICATION', title: '新的知识库公开申请', content: '机器学习错题共建知识库等待审核。', target_type: 'knowledge_base_review', target_id: (await prisma.knowledgeBaseReviewRecord.findUnique({ where: { operationId: 'seed-kb-submit-ml-wrong' } })).id, business_type: 'knowledge_base_review', business_id: publicKb.knowledge_base_id, idempotency_key: 'seed:teacher:kb-review-pending' } })
  void upcomingExam

  log('16/16 种子数据摘要')
  const questionTypeStats = await prisma.question.groupBy({
    by: ['question_type'],
    where: { course_id: mlCourse.course_id },
    _count: { question_id: true },
  })
  const bankQuestionCount = await prisma.questionBankQuestion.count({
    where: { question_bank_id: questionBank.question_bank_id },
  })

  log('========== DisciMind 智能答题系统种子数据完成 ==========')
  log(`  - Demo 用户：admin_demo / teacher_demo / student_demo，密码均为 123456`)
  log(`  - 科目：${courseDefs.map((item) => item.course_name).join('、')}`)
  log(`  - 班级：${adminClassDefs.map((item) => item.class_name).join('、')}`)
  log(`  - 机器学习知识点：${Object.keys(knowledgePoints).length} 个`)
  log(`  - 题库：${questionBank.name}，关联题目 ${bankQuestionCount} 道`)
  for (const stat of questionTypeStats) {
    log(`  - ${stat.question_type}: ${stat._count.question_id} 道`)
  }
  log(`  - 答题记录：${answerRecords.length} 条`)
  log(`  - 错题记录：${answerRecords.filter((record) => record.seed.wrong).length} 条`)
  log(`  - AI 补题日志：1 条，采纳题目 ${generatedQuestions.length} 道`)

  // -------- 学习流系统模板种子数据 --------

  log('\n--- 学习流系统模板 ---')

  const SYS_TEMPLATES = [
    {
      key: 'sys_standard',
      title: '标准学习流',
      description: '学习前状态分析 → 概念讲解 → 例题分析 → 基础练习 → 掌握度判断 → 学习总结。掌握不足时通过类比讲解和巩固练习进行补救。',
      graph: {
        entryNodeId: 'node_1',
        nodes: [
          { id: 'node_1', type: 'concept_explanation', title: '概念讲解', config: { estimatedMinutes: 6, strategy: 'direct_instruction' }, position: { x: 120, y: 40 } },
          { id: 'node_2', type: 'worked_example_analysis', title: '例题分析', config: { estimatedMinutes: 5 }, position: { x: 120, y: 130 } },
          { id: 'node_3', type: 'basic_practice', title: '基础练习', config: { estimatedMinutes: 6, questionCount: 3 }, position: { x: 120, y: 220 } },
          { id: 'node_4', type: 'mastery_gate', title: '掌握度判断', config: {}, position: { x: 120, y: 310 } },
          { id: 'node_5', type: 'analogy_explanation', title: '类比讲解', config: { estimatedMinutes: 4, strategy: 'analogy_bridge' }, position: { x: 340, y: 130 } },
          { id: 'node_6', type: 'basic_practice', title: '巩固练习', config: { estimatedMinutes: 4, questionCount: 2 }, position: { x: 340, y: 220 } },
          { id: 'node_7', type: 'mastery_gate', title: '再次判断', config: {}, position: { x: 340, y: 310 } },
          { id: 'node_8', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 400 } },
        ],
        edges: [
          { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
          { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'always', params: {} } },
          { id: 'e3', source: 'node_3', target: 'node_4', condition: { type: 'always', params: {} } },
          { id: 'e4', source: 'node_4', target: 'node_8', condition: { type: 'mastery_gte', params: { threshold: 80 } }, label: '掌握度 ≥ 80' },
          { id: 'e5', source: 'node_4', target: 'node_5', condition: { type: 'mastery_lt', params: { threshold: 80 } }, label: '掌握度 < 80' },
          { id: 'e6', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
          { id: 'e7', source: 'node_6', target: 'node_7', condition: { type: 'always', params: {} } },
          { id: 'e8', source: 'node_7', target: 'node_8', condition: { type: 'always', params: {} } },
        ],
      },
      settings: { completion_mode: 'flow_complete', target_mastery: 80, adjustment_mode: 'auto_adjust', estimated_minutes: 25 },
    },
    {
      key: 'sys_practice_driven',
      title: '练习驱动流',
      description: '快速练习 → 自适应练习 → 错误分析 → 针对性概念讲解 → 变式练习 → 学习总结。以练习为核心驱动学习。',
      graph: {
        entryNodeId: 'node_1',
        nodes: [
          { id: 'node_1', type: 'basic_practice', title: '快速练习', config: { estimatedMinutes: 4, questionCount: 2 }, position: { x: 120, y: 40 } },
          { id: 'node_2', type: 'adaptive_practice', title: '自适应练习', config: { estimatedMinutes: 8, questionCount: 5 }, position: { x: 120, y: 130 } },
          { id: 'node_3', type: 'wrong_question_repair', title: '错误分析', config: { estimatedMinutes: 5 }, position: { x: 120, y: 220 } },
          { id: 'node_4', type: 'concept_explanation', title: '针对性概念讲解', config: { estimatedMinutes: 4, strategy: 'misconception_confrontation' }, position: { x: 120, y: 310 } },
          { id: 'node_5', type: 'adaptive_practice', title: '变式练习', config: { estimatedMinutes: 5, questionCount: 3 }, position: { x: 120, y: 400 } },
          { id: 'node_6', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 490 } },
        ],
        edges: [
          { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
          { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'consecutive_wrong_gte', params: { threshold: 2 } }, label: '连续错误 ≥ 2' },
          { id: 'e3', source: 'node_2', target: 'node_5', condition: { type: 'accuracy_gte', params: { threshold: 70 } }, label: '准确率 ≥ 70%' },
          { id: 'e4', source: 'node_2', target: 'node_4', condition: { type: 'accuracy_lt', params: { threshold: 70 } }, label: '准确率 < 70%' },
          { id: 'e5', source: 'node_3', target: 'node_4', condition: { type: 'always', params: {} } },
          { id: 'e6', source: 'node_4', target: 'node_5', condition: { type: 'always', params: {} } },
          { id: 'e7', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
        ],
      },
      settings: { completion_mode: 'flow_complete', target_mastery: 80, adjustment_mode: 'auto_adjust', estimated_minutes: 25 },
    },
    {
      key: 'sys_weakness_repair',
      title: '薄弱修复流',
      description: '错题分析 → 概念对比 → 类比讲解 → 基础练习 → 原题或同类题重做 → 掌握度判断 → 学习总结。专门针对薄弱环节进行修复。',
      graph: {
        entryNodeId: 'node_1',
        nodes: [
          { id: 'node_1', type: 'wrong_question_repair', title: '错题分析', config: { estimatedMinutes: 5 }, position: { x: 120, y: 40 } },
          { id: 'node_2', type: 'concept_explanation', title: '概念对比', config: { estimatedMinutes: 4, strategy: 'misconception_confrontation' }, position: { x: 120, y: 130 } },
          { id: 'node_3', type: 'analogy_explanation', title: '类比讲解', config: { estimatedMinutes: 4, strategy: 'analogy_bridge' }, position: { x: 120, y: 220 } },
          { id: 'node_4', type: 'basic_practice', title: '基础练习', config: { estimatedMinutes: 5, questionCount: 3 }, position: { x: 120, y: 310 } },
          { id: 'node_5', type: 'adaptive_practice', title: '原题或同类题重做', config: { estimatedMinutes: 5, questionCount: 3 }, position: { x: 120, y: 400 } },
          { id: 'node_6', type: 'mastery_gate', title: '掌握度判断', config: {}, position: { x: 120, y: 490 } },
          { id: 'node_7', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 580 } },
          { id: 'node_8', type: 'concept_explanation', title: '薄弱点复盘', config: { estimatedMinutes: 4, strategy: 'misconception_confrontation' }, position: { x: 340, y: 490 } },
        ],
        edges: [
          { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
          { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'always', params: {} } },
          { id: 'e3', source: 'node_3', target: 'node_4', condition: { type: 'always', params: {} } },
          { id: 'e4', source: 'node_4', target: 'node_5', condition: { type: 'always', params: {} } },
          { id: 'e5', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
          { id: 'e6', source: 'node_6', target: 'node_7', condition: { type: 'mastery_gte', params: { threshold: 75 } }, label: '掌握度 ≥ 75' },
          { id: 'e7', source: 'node_6', target: 'node_8', condition: { type: 'mastery_lt', params: { threshold: 75 } }, label: '掌握度 < 75' },
          { id: 'e8', source: 'node_8', target: 'node_7', condition: { type: 'always', params: {} } },
        ],
      },
      settings: { completion_mode: 'mastery_target', target_mastery: 75, adjustment_mode: 'auto_adjust', estimated_minutes: 20 },
    },
    {
      key: 'sys_socratic_inquiry',
      title: '苏格拉底探究流',
      description: '问题引入 → 苏格拉底提问 → 概念讲解 → 应用练习 → 掌握度判断 → 学习总结。通过苏格拉底式提问引导深度理解。',
      graph: {
        entryNodeId: 'node_1',
        nodes: [
          { id: 'node_1', type: 'socratic_questioning', title: '问题引入', config: { estimatedMinutes: 5, strategy: 'socratic_dialogue' }, position: { x: 120, y: 40 } },
          { id: 'node_2', type: 'socratic_questioning', title: '苏格拉底提问', config: { estimatedMinutes: 6, strategy: 'socratic_dialogue' }, position: { x: 120, y: 130 } },
          { id: 'node_3', type: 'concept_explanation', title: '概念讲解', config: { estimatedMinutes: 5, strategy: 'direct_instruction' }, position: { x: 120, y: 220 } },
          { id: 'node_4', type: 'adaptive_practice', title: '应用练习', config: { estimatedMinutes: 7, questionCount: 4 }, position: { x: 120, y: 310 } },
          { id: 'node_5', type: 'mastery_gate', title: '掌握度判断', config: {}, position: { x: 120, y: 400 } },
          { id: 'node_6', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 490 } },
          { id: 'node_7', type: 'concept_explanation', title: '关键概念复盘', config: { estimatedMinutes: 4, strategy: 'socratic_dialogue' }, position: { x: 340, y: 400 } },
        ],
        edges: [
          { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
          { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'always', params: {} } },
          { id: 'e3', source: 'node_3', target: 'node_4', condition: { type: 'always', params: {} } },
          { id: 'e4', source: 'node_4', target: 'node_5', condition: { type: 'always', params: {} } },
          { id: 'e5', source: 'node_5', target: 'node_6', condition: { type: 'mastery_gte', params: { threshold: 80 } }, label: '掌握度 ≥ 80' },
          { id: 'e6', source: 'node_5', target: 'node_7', condition: { type: 'mastery_lt', params: { threshold: 80 } }, label: '掌握度 < 80' },
          { id: 'e7', source: 'node_7', target: 'node_6', condition: { type: 'always', params: {} } },
        ],
      },
      settings: { completion_mode: 'mastery_target', target_mastery: 80, adjustment_mode: 'ask_before_adjust', estimated_minutes: 30 },
    },
    {
      key: 'sys_exam_sprint',
      title: '考试冲刺流',
      description: '知识重点扫描 → 高频基础练习 → 自适应练习 → 错题修复 → 限时检测 → 学习总结。高效冲刺备考。',
      graph: {
        entryNodeId: 'node_1',
        nodes: [
          { id: 'node_1', type: 'concept_explanation', title: '知识重点扫描', config: { estimatedMinutes: 5, strategy: 'direct_instruction', depth: 'brief' }, position: { x: 120, y: 40 } },
          { id: 'node_2', type: 'basic_practice', title: '高频基础练习', config: { estimatedMinutes: 6, questionCount: 4 }, position: { x: 120, y: 130 } },
          { id: 'node_3', type: 'adaptive_practice', title: '自适应练习', config: { estimatedMinutes: 8, questionCount: 5 }, position: { x: 120, y: 220 } },
          { id: 'node_4', type: 'wrong_question_repair', title: '错题修复', config: { estimatedMinutes: 6 }, position: { x: 120, y: 310 } },
          { id: 'node_5', type: 'adaptive_practice', title: '限时检测', config: { estimatedMinutes: 7, questionCount: 5 }, position: { x: 120, y: 400 } },
          { id: 'node_6', type: 'learning_summary', title: '学习总结', config: { estimatedMinutes: 3 }, position: { x: 120, y: 490 } },
        ],
        edges: [
          { id: 'e1', source: 'node_1', target: 'node_2', condition: { type: 'always', params: {} } },
          { id: 'e2', source: 'node_2', target: 'node_3', condition: { type: 'always', params: {} } },
          { id: 'e3', source: 'node_3', target: 'node_4', condition: { type: 'consecutive_wrong_gte', params: { threshold: 2 } }, label: '连续错误 ≥ 2' },
          { id: 'e4', source: 'node_3', target: 'node_5', condition: { type: 'accuracy_gte', params: { threshold: 70 } }, label: '准确率 ≥ 70%' },
          { id: 'e5', source: 'node_4', target: 'node_5', condition: { type: 'always', params: {} } },
          { id: 'e6', source: 'node_5', target: 'node_6', condition: { type: 'always', params: {} } },
        ],
      },
      settings: { completion_mode: 'mastery_target', target_mastery: 85, adjustment_mode: 'auto_adjust', estimated_minutes: 35 },
    },
  ];

  // 统一把种子图排成横向层级，避免编辑器初始打开时节点挤成一条竖线。
  const layoutTemplateGraph = (graph) => {
    const copy = JSON.parse(JSON.stringify(graph))
    const levels = new Map()
    const queue = [copy.entryNodeId]
    levels.set(copy.entryNodeId, 0)
    while (queue.length) {
      const current = queue.shift()
      const level = levels.get(current) || 0
      for (const edge of copy.edges.filter((item) => item.source === current)) {
        if (!levels.has(edge.target)) {
          levels.set(edge.target, level + 1)
          queue.push(edge.target)
        }
      }
    }
    const rows = new Map()
    copy.nodes.forEach((node) => {
      const level = levels.get(node.id) ?? 0
      const row = rows.get(level) || 0
      node.position = { x: 80 + level * 260, y: 90 + row * 150 }
      rows.set(level, row + 1)
    })
    return copy
  }

  for (const tmpl of SYS_TEMPLATES) {
    const graph = layoutTemplateGraph(tmpl.graph)
    const existing = await prisma.learningWorkflowTemplate.findUnique({
      where: { template_key: tmpl.key },
    });

    let template;
    if (existing) {
      template = existing;
      // 更新基本信息
      await prisma.learningWorkflowTemplate.update({
        where: { template_id: existing.template_id },
        data: {
          title: tmpl.title,
          description: tmpl.description,
          updated_at: new Date(),
        },
      });
    } else {
      template = await prisma.learningWorkflowTemplate.create({
        data: {
          template_key: tmpl.key,
          title: tmpl.title,
          description: tmpl.description,
          owner_type: 'SYSTEM',
          source_type: 'SYSTEM',
          is_published: true,
          is_default: tmpl.key === 'sys_standard',
          course_id: mlCourse?.course_id,
          status: 'active',
        },
      });
    }

    // 始终同步系统模板的单个基线版本；重复 seed 不会新增模板或版本。
    const latestVersion = await prisma.learningWorkflowVersion.findFirst({
      where: { template_id: template.template_id },
      orderBy: { version_number: 'desc' },
    })
    if (!latestVersion) {
      await prisma.learningWorkflowVersion.create({
        data: {
          template_id: template.template_id,
          version_number: 1,
          graph_json: graph,
          settings_json: tmpl.settings,
          change_summary: '系统内置初始版本',
        },
      });
    } else {
      await prisma.learningWorkflowVersion.update({
        where: { version_id: latestVersion.version_id },
        data: { graph_json: graph, settings_json: tmpl.settings, change_summary: '系统内置基线版本' },
      })
    }

    log(`  学习流模板: ${tmpl.title} (${tmpl.key})`);
  }

  // 系统模板只保留这五套稳定标识，其它历史实验模板不再面向学生展示。
  await prisma.learningWorkflowTemplate.updateMany({
    where: { source_type: 'SYSTEM', template_key: { notIn: SYS_TEMPLATES.map((item) => item.key) } },
    data: { status: 'archived' },
  })

  log(`学习流系统模板种子数据完成 (共 ${SYS_TEMPLATES.length} 套)`);

  await seedAgentMarketplace({ prisma, upsertUser, upsertProfile, adminUser, studentUser, log })
  const systemFileAgents = await require('../src/modules/file-generator/system-file-agents.service').ensureSystemFileAgents({ prisma, creatorUserId: adminUser.user_id })
  log(`系统文件智能体初始化完成 (${systemFileAgents.length} 个；真实知识库绑定数 ${systemFileAgents[0]?.boundKnowledgeBaseIds.length || 0})`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
