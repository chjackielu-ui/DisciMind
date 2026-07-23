// 比赛演示种子数据
// 由 prisma/seed.js 调用；可重复执行，不删除现有种子数据。

const COURSE_408_DEFS = [
  {
    course_name: '408 数据结构',
    course_code: 'CS408-DS',
    subject_category: '408 计算机学科专业基础',
    description: '围绕线性结构、树、图、查找与排序建立可视化知识图谱，适合 408 备考与课堂演示。',
    cover_url: '/pics/books/book_covers/data-structures.webp',
    chapters: [
      { name: '线性结构', order: 1, desc: '线性表、栈、队列及其典型应用。', kps: [
        { code: 'DS408-KP-001', name: '线性表抽象模型', diff: 'BASIC', desc: '线性结构的逻辑特征、顺序存储与链式存储选择。' },
        { code: 'DS408-KP-002', name: '顺序表插入删除', diff: 'BASIC', desc: '顺序表按位插入、删除、移动次数与复杂度分析。', parent: 'DS408-KP-001' },
        { code: 'DS408-KP-003', name: '单链表基本操作', diff: 'BASIC', desc: '单链表建表、查找、插入、删除和边界指针处理。', parent: 'DS408-KP-001' },
        { code: 'DS408-KP-004', name: '栈和队列', diff: 'MEDIUM', desc: '栈、循环队列、链队列及括号匹配、表达式求值应用。', parent: 'DS408-KP-001' },
      ] },
      { name: '树与图', order: 2, desc: '二叉树、图的遍历、最短路径与最小生成树。', kps: [
        { code: 'DS408-KP-005', name: '二叉树性质', diff: 'BASIC', desc: '二叉树高度、结点数关系、满二叉树与完全二叉树。' },
        { code: 'DS408-KP-006', name: '二叉树遍历', diff: 'MEDIUM', desc: '先序、中序、后序、层序遍历及由遍历序列还原二叉树。', parent: 'DS408-KP-005' },
        { code: 'DS408-KP-007', name: '哈夫曼树', diff: 'MEDIUM', desc: '带权路径长度、哈夫曼编码构造与最优前缀码。', parent: 'DS408-KP-005' },
        { code: 'DS408-KP-008', name: '图的存储与遍历', diff: 'MEDIUM', desc: '邻接矩阵、邻接表、DFS、BFS 及连通性判断。' },
        { code: 'DS408-KP-009', name: '最短路径与最小生成树', diff: 'HARD', desc: 'Dijkstra、Floyd、Prim、Kruskal 的适用条件与复杂度。', parent: 'DS408-KP-008' },
      ] },
      { name: '查找与排序', order: 3, desc: '查找结构、内部排序算法与性能比较。', kps: [
        { code: 'DS408-KP-010', name: '二分查找与判定树', diff: 'MEDIUM', desc: '折半查找条件、平均查找长度与判定树分析。' },
        { code: 'DS408-KP-011', name: '散列表', diff: 'MEDIUM', desc: '哈希函数、冲突处理、装填因子与查找性能。', parent: 'DS408-KP-010' },
        { code: 'DS408-KP-012', name: '快速排序与堆排序', diff: 'HARD', desc: '分治、堆结构、时间复杂度、稳定性与适用场景比较。' },
      ] },
    ],
  },
  {
    course_name: '408 计算机组成原理',
    course_code: 'CS408-CO',
    subject_category: '408 计算机学科专业基础',
    description: '覆盖数据表示、运算器、存储系统、指令系统、CPU 与 I/O，形成硬件系统全链路认知。',
    cover_url: '/pics/books/book_covers/computer-science.webp',
    chapters: [
      { name: '数据表示与运算', order: 1, desc: '数制、补码、浮点数和算术逻辑运算。', kps: [
        { code: 'CO408-KP-001', name: '定点数与补码', diff: 'BASIC', desc: '原码、反码、补码表示范围及溢出判断。' },
        { code: 'CO408-KP-002', name: '浮点数表示', diff: 'MEDIUM', desc: 'IEEE 754 格式、规格化、阶码与尾数。', parent: 'CO408-KP-001' },
        { code: 'CO408-KP-003', name: '加减乘除运算器', diff: 'MEDIUM', desc: '加法器、移位乘法、恢复余数除法与标志位。', parent: 'CO408-KP-001' },
      ] },
      { name: '存储系统', order: 2, desc: 'Cache、主存、虚拟存储与层次结构。', kps: [
        { code: 'CO408-KP-004', name: '存储层次结构', diff: 'BASIC', desc: '局部性原理、访问时间、容量与成本权衡。' },
        { code: 'CO408-KP-005', name: 'Cache 映射方式', diff: 'MEDIUM', desc: '直接映射、全相联、组相联及地址字段划分。', parent: 'CO408-KP-004' },
        { code: 'CO408-KP-006', name: 'Cache 替换与写策略', diff: 'MEDIUM', desc: 'LRU、FIFO、随机替换、写回与写直达。', parent: 'CO408-KP-004' },
        { code: 'CO408-KP-007', name: '虚拟存储基础', diff: 'HARD', desc: '页式虚拟存储、地址变换、TLB 与缺页处理。', parent: 'CO408-KP-004' },
      ] },
      { name: '指令、CPU 与 I/O', order: 3, desc: '指令格式、控制器、流水线与输入输出系统。', kps: [
        { code: 'CO408-KP-008', name: '指令格式与寻址方式', diff: 'BASIC', desc: '操作码、地址码、立即寻址、寄存器寻址与间接寻址。' },
        { code: 'CO408-KP-009', name: '控制器与微程序', diff: 'MEDIUM', desc: '硬布线控制、微程序控制及控制信号生成。', parent: 'CO408-KP-008' },
        { code: 'CO408-KP-010', name: '指令流水线', diff: 'HARD', desc: '流水线性能、结构冒险、数据冒险与控制冒险。', parent: 'CO408-KP-008' },
        { code: 'CO408-KP-011', name: '中断与 DMA', diff: 'MEDIUM', desc: '程序查询、中断、DMA 传送方式和适用场景。' },
        { code: 'CO408-KP-012', name: '总线与 I/O 接口', diff: 'BASIC', desc: '总线周期、同步/异步通信、接口寄存器。', parent: 'CO408-KP-011' },
      ] },
    ],
  },
  {
    course_name: '408 操作系统',
    course_code: 'CS408-OS',
    subject_category: '408 计算机学科专业基础',
    description: '以进程线程、内存管理、文件系统、I/O 与死锁为主线，适配课程教学与 408 演示。',
    cover_url: '/pics/books/book_covers/operating-systems.webp',
    chapters: [
      { name: '进程与线程', order: 1, desc: '进程状态、调度、同步互斥与死锁。', kps: [
        { code: 'OS408-KP-001', name: '进程状态转换', diff: 'BASIC', desc: '创建、就绪、运行、阻塞、终止及状态转换条件。' },
        { code: 'OS408-KP-002', name: '处理机调度算法', diff: 'MEDIUM', desc: 'FCFS、SJF、优先级、时间片轮转、多级反馈队列。', parent: 'OS408-KP-001' },
        { code: 'OS408-KP-003', name: '进程同步与互斥', diff: 'MEDIUM', desc: '临界区、信号量、管程和经典同步问题。', parent: 'OS408-KP-001' },
        { code: 'OS408-KP-004', name: '死锁条件与处理', diff: 'HARD', desc: '死锁必要条件、预防、避免、检测与解除。', parent: 'OS408-KP-003' },
      ] },
      { name: '内存管理', order: 2, desc: '分页、分段、虚拟内存和页面置换。', kps: [
        { code: 'OS408-KP-005', name: '连续与非连续分配', diff: 'BASIC', desc: '固定分区、动态分区、分页和分段的核心差异。' },
        { code: 'OS408-KP-006', name: '页表与地址变换', diff: 'MEDIUM', desc: '逻辑地址、物理地址、页表项、快表 TLB。', parent: 'OS408-KP-005' },
        { code: 'OS408-KP-007', name: '页面置换算法', diff: 'HARD', desc: 'OPT、FIFO、LRU、Clock 算法与缺页率分析。', parent: 'OS408-KP-006' },
        { code: 'OS408-KP-008', name: '工作集与抖动', diff: 'MEDIUM', desc: '局部性、驻留集、工作集模型与抖动原因。', parent: 'OS408-KP-007' },
      ] },
      { name: '文件与 I/O', order: 3, desc: '文件组织、磁盘调度和设备管理。', kps: [
        { code: 'OS408-KP-009', name: '文件逻辑结构', diff: 'BASIC', desc: '顺序文件、索引文件和目录结构。' },
        { code: 'OS408-KP-010', name: '外存分配方式', diff: 'MEDIUM', desc: '连续分配、链接分配、索引分配及 FAT/inode。', parent: 'OS408-KP-009' },
        { code: 'OS408-KP-011', name: '磁盘调度算法', diff: 'MEDIUM', desc: 'FCFS、SSTF、SCAN、C-SCAN 的移动臂性能。' },
        { code: 'OS408-KP-012', name: 'I/O 控制方式', diff: 'BASIC', desc: '程序查询、中断驱动、DMA 与通道方式。', parent: 'OS408-KP-011' },
      ] },
    ],
  },
  {
    course_name: '408 计算机网络',
    course_code: 'CS408-NET',
    subject_category: '408 计算机学科专业基础',
    description: '围绕 TCP/IP 体系结构、网络层、传输层和应用层协议组织演示数据。',
    cover_url: '/pics/books/book_covers/computer-networks.webp',
    chapters: [
      { name: '体系结构与链路层', order: 1, desc: '网络体系结构、物理层指标、数据链路层协议。', kps: [
        { code: 'NET408-KP-001', name: 'OSI 与 TCP/IP 模型', diff: 'BASIC', desc: '七层模型、四层模型及各层核心功能。' },
        { code: 'NET408-KP-002', name: '时延与吞吐量', diff: 'BASIC', desc: '发送时延、传播时延、排队时延和吞吐量计算。', parent: 'NET408-KP-001' },
        { code: 'NET408-KP-003', name: '差错检测 CRC', diff: 'MEDIUM', desc: '循环冗余校验的模 2 除法与检错能力。', parent: 'NET408-KP-001' },
        { code: 'NET408-KP-004', name: '以太网与 ARP', diff: 'MEDIUM', desc: 'MAC 帧、CSMA/CD、ARP 地址解析过程。', parent: 'NET408-KP-001' },
      ] },
      { name: '网络层', order: 2, desc: 'IP 地址、路由协议与网络层控制协议。', kps: [
        { code: 'NET408-KP-005', name: 'IPv4 与 CIDR', diff: 'MEDIUM', desc: 'IP 地址分类、子网掩码、CIDR 与路由聚合。' },
        { code: 'NET408-KP-006', name: '路由算法', diff: 'HARD', desc: '距离向量、链路状态、RIP、OSPF 与 BGP 对比。', parent: 'NET408-KP-005' },
        { code: 'NET408-KP-007', name: 'ICMP 与 NAT', diff: 'MEDIUM', desc: 'ICMP 报文、ping/traceroute、网络地址转换。', parent: 'NET408-KP-005' },
      ] },
      { name: '传输层与应用层', order: 3, desc: 'UDP、TCP、DNS、HTTP 与安全基础。', kps: [
        { code: 'NET408-KP-008', name: 'UDP 协议', diff: 'BASIC', desc: '无连接传输、首部字段和典型应用。' },
        { code: 'NET408-KP-009', name: 'TCP 可靠传输', diff: 'HARD', desc: '序号、确认、重传、滑动窗口与流量控制。', parent: 'NET408-KP-008' },
        { code: 'NET408-KP-010', name: 'TCP 拥塞控制', diff: 'HARD', desc: '慢启动、拥塞避免、快重传、快恢复。', parent: 'NET408-KP-009' },
        { code: 'NET408-KP-011', name: 'DNS 解析过程', diff: 'MEDIUM', desc: '递归查询、迭代查询和域名缓存。' },
        { code: 'NET408-KP-012', name: 'HTTP 与 HTTPS', diff: 'MEDIUM', desc: 'HTTP 请求响应、状态码、持久连接与 TLS 基础。', parent: 'NET408-KP-011' },
      ] },
    ],
  },
]

const DEMO_CLASS_DEFS = [
  { class_name: '软件2403班', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
  { class_name: '软件2404班', college: '计算机与软件工程学院', major: '软件工程', grade: '2024' },
  { class_name: '计科2401班', college: '计算机与软件工程学院', major: '计算机科学与技术', grade: '2024' },
]

const DEMO_STUDENT_DEFS = [
  ['student_40801', '许知远', 'S4082401', '软件2403班'],
  ['student_40802', '沈亦舟', 'S4082402', '软件2403班'],
  ['student_40803', '梁雨桐', 'S4082403', '软件2404班'],
  ['student_40804', '顾嘉禾', 'S4082404', '软件2404班'],
  ['student_40805', '唐星野', 'S4082405', '计科2401班'],
  ['student_40806', '罗清越', 'S4082406', '计科2401班'],
]

function fixedDate(value) {
  return new Date(`${value}T00:00:00+08:00`)
}

function daysAgo(days, hour = 9) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(hour, 0, 0, 0)
  return date
}

function daysFromNow(days, hour = 18) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hour, 0, 0, 0)
  return date
}

function levelFromScore(score) {
  if (score >= 85) return 'EXCELLENT'
  if (score >= 70) return 'GOOD'
  if (score >= 55) return 'GENERAL'
  return 'WEAK'
}

function safeClassCode(courseCode, className) {
  return `${courseCode}-${className}`.replace(/[^A-Za-z0-9\u4e00-\u9fa5-]/g, '-').slice(0, 80)
}

function flattenKps(courseDef) {
  return courseDef.chapters.flatMap(chapter => chapter.kps.map(kp => ({ ...kp, chapterName: chapter.name })))
}

async function upsertAdminClass(prisma, data, advisorUserId) {
  const row = await prisma.adminClass.upsert({
    where: { class_name_grade: { class_name: data.class_name, grade: data.grade } },
    update: { college: data.college, major: data.major, grade: data.grade, advisor_user_id: advisorUserId, status: 'active' },
    create: { ...data, advisor_user_id: advisorUserId, status: 'active' },
  })
  return row
}

async function upsertCourse(prisma, def) {
  return prisma.course.upsert({
    where: { course_code: def.course_code },
    update: {
      course_name: def.course_name,
      subject_category: def.subject_category,
      description: def.description,
      cover_url: def.cover_url,
      status: 'ACTIVE',
    },
    create: {
      course_name: def.course_name,
      course_code: def.course_code,
      subject_category: def.subject_category,
      description: def.description,
      cover_url: def.cover_url,
      status: 'ACTIVE',
    },
  })
}

async function upsertTeachingClass(prisma, course, offering, adminClass, primaryTeacherId, assistantTeacherId, adminUserId, index) {
  const data = {
    course_offering_id: offering.course_offering_id,
    teacher_user_id: primaryTeacherId,
    code: safeClassCode(course.course_code, adminClass.class_name),
    semester: '2025-2026-2',
    description: `${course.course_name} ${adminClass.class_name} 演示教学班，包含 408 备考知识图谱、作业、资料与学情画像。`,
    schedule: { weekday: (index % 5) + 1, periods: index % 2 === 0 ? '3-4' : '7-8', weeks: '1-18' },
    location: ['博学楼 B302', '博学楼 B304', '知新楼 C210'][index % 3],
    capacity: 60,
    status: 'active',
  }
  const teachingClass = await prisma.teachingClass.upsert({
    where: { course_id_teaching_class_name: { course_id: course.course_id, teaching_class_name: adminClass.class_name } },
    update: data,
    create: { course_id: course.course_id, teaching_class_name: adminClass.class_name, ...data },
  })
  await prisma.teachingClassAdminClass.upsert({
    where: { teaching_class_id_admin_class_id: { teaching_class_id: teachingClass.teaching_class_id, admin_class_id: adminClass.admin_class_id } },
    update: {},
    create: { teaching_class_id: teachingClass.teaching_class_id, admin_class_id: adminClass.admin_class_id },
  })
  for (const [teacherId, role] of [[primaryTeacherId, 'owner'], [assistantTeacherId, 'assistant']]) {
    if (!teacherId) continue
    await prisma.teachingClassTeacherAuthorization.upsert({
      where: { teaching_class_id_teacher_user_id: { teaching_class_id: teachingClass.teaching_class_id, teacher_user_id: teacherId } },
      update: { role, status: 'active' },
      create: { teaching_class_id: teachingClass.teaching_class_id, teacher_user_id: teacherId, role, status: 'active', granted_by_user_id: adminUserId },
    })
  }
  return teachingClass
}

async function seedCourseKnowledge(prisma, course, courseDef) {
  const chapters = {}
  for (const chapterDef of courseDef.chapters) {
    let chapter = await prisma.chapter.findFirst({ where: { course_id: course.course_id, chapter_name: chapterDef.name } })
    const data = { chapter_order: chapterDef.order, description: chapterDef.desc }
    chapter = chapter
      ? await prisma.chapter.update({ where: { chapter_id: chapter.chapter_id }, data })
      : await prisma.chapter.create({ data: { course_id: course.course_id, chapter_name: chapterDef.name, ...data } })
    chapters[chapterDef.name] = chapter
  }

  const kpByCode = {}
  for (const chapterDef of courseDef.chapters) {
    for (let index = 0; index < chapterDef.kps.length; index += 1) {
      const kp = chapterDef.kps[index]
      kpByCode[kp.code] = await prisma.knowledgePoint.upsert({
        where: { course_id_knowledge_point_code: { course_id: course.course_id, knowledge_point_code: kp.code } },
        update: {
          chapter_id: chapters[chapterDef.name].chapter_id,
          knowledge_point_name: kp.name,
          description: kp.desc,
          difficulty_level: kp.diff,
          sort_order: chapterDef.order * 100 + index + 1,
        },
        create: {
          course_id: course.course_id,
          chapter_id: chapters[chapterDef.name].chapter_id,
          knowledge_point_name: kp.name,
          knowledge_point_code: kp.code,
          description: kp.desc,
          difficulty_level: kp.diff,
          sort_order: chapterDef.order * 100 + index + 1,
        },
      })
    }
  }

  for (const kp of flattenKps(courseDef)) {
    if (!kp.parent || !kpByCode[kp.parent]) continue
    await prisma.knowledgePoint.update({
      where: { knowledge_point_id: kpByCode[kp.code].knowledge_point_id },
      data: { parent_id: kpByCode[kp.parent].knowledge_point_id },
    })
  }

  return { chapters, kpByCode, kps: Object.values(kpByCode) }
}

async function upsertQuestion(prisma, course, teacherId, kp, def, order) {
  const base = {
    course_id: course.course_id,
    knowledge_point_id: kp.knowledge_point_id,
    question_type: def.type,
    title: def.title,
    content: def.content,
    correct_answer: def.answer,
    analysis: def.analysis,
    difficulty_level: def.difficulty,
    score: def.score,
    is_ai_generated: def.ai || false,
    generated_by_user_id: def.ai ? teacherId : null,
    created_by_user_id: teacherId,
    status: 'active',
    content_hash: `seed-408-${course.course_code}-${order}`,
  }
  let question = await prisma.question.findFirst({ where: { course_id: course.course_id, title: def.title } })
  question = question
    ? await prisma.question.update({ where: { question_id: question.question_id }, data: base })
    : await prisma.question.create({ data: base })

  if (def.options) {
    for (let index = 0; index < def.options.length; index += 1) {
      const option = def.options[index]
      await prisma.questionOption.upsert({
        where: { question_id_option_key: { question_id: question.question_id, option_key: option.key } },
        update: { option_content: option.content, option_order: index + 1, is_correct: option.correct },
        create: { question_id: question.question_id, option_key: option.key, option_content: option.content, option_order: index + 1, is_correct: option.correct },
      })
    }
  }
  return question
}

async function seedQuestionBank(prisma, course, courseDef, teachingClasses, teacherId) {
  const bank = await prisma.questionBank.upsert({
    where: { course_id_name: { course_id: course.course_id, name: `${course.course_name} 408 演示题库` } },
    update: { description: `${course.course_name}核心知识点演示题库，覆盖选择题、判断题和简答题。`, scope_type: 'CLASS', created_by_user_id: teacherId, status: 'active' },
    create: { course_id: course.course_id, name: `${course.course_name} 408 演示题库`, description: `${course.course_name}核心知识点演示题库，覆盖选择题、判断题和简答题。`, scope_type: 'CLASS', created_by_user_id: teacherId, status: 'active' },
  })
  for (const teachingClass of teachingClasses) {
    await prisma.questionBankTeachingClass.upsert({
      where: { question_bank_id_teaching_class_id: { question_bank_id: bank.question_bank_id, teaching_class_id: teachingClass.teaching_class_id } },
      update: {},
      create: { question_bank_id: bank.question_bank_id, teaching_class_id: teachingClass.teaching_class_id },
    })
  }

  const kps = await prisma.knowledgePoint.findMany({ where: { course_id: course.course_id }, orderBy: { sort_order: 'asc' } })
  for (const kp of kps) {
    await prisma.questionBankKnowledgePoint.upsert({
      where: { question_bank_id_knowledge_point_id: { question_bank_id: bank.question_bank_id, knowledge_point_id: kp.knowledge_point_id } },
      update: {},
      create: { question_bank_id: bank.question_bank_id, knowledge_point_id: kp.knowledge_point_id },
    })
  }

  const questionDefs = [
    {
      type: 'SINGLE_CHOICE',
      title: `${course.course_name}核心概念识别`,
      content: `学习 ${course.course_name} 时，最适合先建立的基础认知是什么？`,
      answer: { type: 'single_choice', answer: 'B' },
      analysis: '先建立概念边界和结构化关系，再进入典型题型，能降低知识迁移成本。',
      difficulty: 'BASIC',
      score: 5,
      options: [
        { key: 'A', content: '只背最终结论，不关注适用条件', correct: false },
        { key: 'B', content: '明确概念、条件、过程和复杂度/性能指标', correct: true },
        { key: 'C', content: '跳过基础，直接做综合压轴题', correct: false },
        { key: 'D', content: '只看视频，不做任何练习', correct: false },
      ],
    },
    {
      type: 'SINGLE_CHOICE',
      title: `${course.course_name}易错条件判断`,
      content: `关于 ${kps[1]?.knowledge_point_name || course.course_name}，下面哪种学习方式更可靠？`,
      answer: { type: 'single_choice', answer: 'C' },
      analysis: '408 类课程常在边界条件、适用前提和复杂度处设问，必须结合反例训练。',
      difficulty: 'MEDIUM',
      score: 6,
      options: [
        { key: 'A', content: '只记名称，不理解推导', correct: false },
        { key: 'B', content: '忽略边界条件', correct: false },
        { key: 'C', content: '用例题和反例验证适用条件', correct: true },
        { key: 'D', content: '把所有算法/协议都看成同一种模型', correct: false },
      ],
    },
    {
      type: 'TRUE_FALSE',
      title: `${course.course_name}知识迁移判断`,
      content: `掌握 ${course.course_name} 的知识图谱关系，有助于定位薄弱知识点和安排复习路径。`,
      answer: { type: 'true_false', answer: true },
      analysis: '知识图谱能把章节、知识点、前置关系和掌握度放在同一视图中，适合课堂演示。',
      difficulty: 'BASIC',
      score: 3,
    },
    {
      type: 'SHORT_ANSWER',
      title: `${course.course_name}学习路径说明`,
      content: `请结合 ${kps[0]?.knowledge_point_name || '基础概念'} 和 ${kps[3]?.knowledge_point_name || '重点知识'}，说明如何安排一轮复习。`,
      answer: { type: 'short_answer', reference: '先复盘基础概念和前置条件，再做典型题定位薄弱点，最后用错题和变式题巩固。' },
      analysis: '合理路径应体现先基础、再应用、再诊断、再巩固。',
      difficulty: 'MEDIUM',
      score: 10,
      ai: true,
    },
    {
      type: 'SINGLE_CHOICE',
      title: `${course.course_name}综合题切入点`,
      content: `遇到 ${course.course_name} 综合题时，第一步通常应做什么？`,
      answer: { type: 'single_choice', answer: 'A' },
      analysis: '先抽取题目条件并定位所属知识点，能避免套错模型。',
      difficulty: 'MEDIUM',
      score: 6,
      options: [
        { key: 'A', content: '识别题目条件和对应知识点', correct: true },
        { key: 'B', content: '直接套最近背过的公式', correct: false },
        { key: 'C', content: '忽略输入规模或协议状态', correct: false },
        { key: 'D', content: '只写结论不写过程', correct: false },
      ],
    },
    {
      type: 'SHORT_ANSWER',
      title: `${course.course_name}薄弱点修复策略`,
      content: `如果学生在 ${kps[2]?.knowledge_point_name || '核心知识点'} 上掌握度偏低，教师可以如何干预？`,
      answer: { type: 'short_answer', reference: '教师可先用诊断题定位误区，再下发微课、例题和变式练习，并在下一次作业中追踪掌握度变化。' },
      analysis: '有效干预需要诊断、资源、练习和追踪闭环。',
      difficulty: 'MEDIUM',
      score: 10,
      ai: true,
    },
  ]

  const questions = []
  for (let index = 0; index < questionDefs.length; index += 1) {
    const kp = kps[index % kps.length]
    const question = await upsertQuestion(prisma, course, teacherId, kp, questionDefs[index], index + 1)
    questions.push(question)
    await prisma.questionBankQuestion.upsert({
      where: { question_bank_id_question_id: { question_bank_id: bank.question_bank_id, question_id: question.question_id } },
      update: { question_order: index + 1, source_type: questionDefs[index].ai ? 'ai' : 'manual' },
      create: { question_bank_id: bank.question_bank_id, question_id: question.question_id, question_order: index + 1, source_type: questionDefs[index].ai ? 'ai' : 'manual' },
    })
  }

  let logRow = await prisma.aiQuestionGenerationLog.findFirst({
    where: { course_id: course.course_id, question_bank_id: bank.question_bank_id, ai_provider: 'seed-demo', model_name: 'competition-demo-generator' },
  })
  const logData = {
    course_id: course.course_id,
    teaching_class_id: teachingClasses[0]?.teaching_class_id || null,
    question_bank_id: bank.question_bank_id,
    knowledge_point_id: kps[0]?.knowledge_point_id || null,
    created_by_user_id: teacherId,
    prompt_json: { task: '为 408 课程生成演示题', course: course.course_name },
    request_params: { difficulty: 'mixed', count: 6 },
    response_json: { accepted_titles: questions.map(item => item.title) },
    status: 'SUCCESS',
    generated_question_count: questions.length,
    accepted_question_count: questions.length,
    ai_provider: 'seed-demo',
    model_name: 'competition-demo-generator',
    error_message: null,
  }
  logRow = logRow
    ? await prisma.aiQuestionGenerationLog.update({ where: { ai_question_generation_log_id: logRow.ai_question_generation_log_id }, data: logData })
    : await prisma.aiQuestionGenerationLog.create({ data: logData })
  for (const question of questions) {
    await prisma.aiQuestionGenerationQuestion.upsert({
      where: { ai_question_generation_log_id_question_id: { ai_question_generation_log_id: logRow.ai_question_generation_log_id, question_id: question.question_id } },
      update: { action_status: 'accepted' },
      create: { ai_question_generation_log_id: logRow.ai_question_generation_log_id, question_id: question.question_id, action_status: 'accepted' },
    })
  }

  return { bank, questions, kps }
}

async function seedMasteryAndPortraits(prisma, course, courseDef, teachingClassesByClass, studentsByClass) {
  const kps = await prisma.knowledgePoint.findMany({ where: { course_id: course.course_id }, orderBy: { sort_order: 'asc' } })
  const enrolledStudents = []
  for (const className of Object.keys(teachingClassesByClass)) {
    const teachingClass = teachingClassesByClass[className]
    const students = studentsByClass[className] || []
    for (const student of students) {
      await prisma.studentCourseEnrollment.upsert({
        where: { student_user_id_course_id_teaching_class_id: { student_user_id: student.user_id, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id } },
        update: { enrollment_status: 'active' },
        create: { student_user_id: student.user_id, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id, enrollment_status: 'active' },
      })
      enrolledStudents.push({ ...student, teachingClass })
    }
  }

  for (let studentIndex = 0; studentIndex < enrolledStudents.length; studentIndex += 1) {
    const student = enrolledStudents[studentIndex]
    const scores = []
    for (let kpIndex = 0; kpIndex < kps.length; kpIndex += 1) {
      const base = 48 + ((studentIndex * 11 + kpIndex * 7 + course.course_id) % 47)
      const score = Math.max(38, Math.min(96, base))
      const level = levelFromScore(score)
      scores.push(score)
      await prisma.studentMasteryRecord.upsert({
        where: { student_user_id_course_id_knowledge_point_id: { student_user_id: student.user_id, course_id: course.course_id, knowledge_point_id: kps[kpIndex].knowledge_point_id } },
        update: {
          mastery_score: score,
          mastery_level: level,
          quiz_score: Math.round(score * 0.55),
          question_score: Math.round(score * 0.25),
          study_progress_score: Math.round(score * 0.20),
          system_score: score,
          teacher_comment: level === 'WEAK' ? '建议完成教师下发的薄弱点修复任务。' : '保持当前复习节奏。',
        },
        create: {
          student_user_id: student.user_id,
          course_id: course.course_id,
          knowledge_point_id: kps[kpIndex].knowledge_point_id,
          mastery_score: score,
          mastery_level: level,
          quiz_score: Math.round(score * 0.55),
          question_score: Math.round(score * 0.25),
          study_progress_score: Math.round(score * 0.20),
          system_score: score,
          teacher_comment: level === 'WEAK' ? '建议完成教师下发的薄弱点修复任务。' : '保持当前复习节奏。',
        },
      })

      if (kpIndex < 6) {
        const startedAt = daysAgo((kpIndex + studentIndex) % 12 + 1, 8 + (kpIndex % 5))
        const studyData = {
          action_type: kpIndex % 3 === 0 ? 'REVIEW' : 'FINISH',
          started_at: startedAt,
          finished_at: new Date(startedAt.getTime() + (18 + kpIndex * 4) * 60000),
          duration_seconds: (18 + kpIndex * 4) * 60,
          progress_percent: Math.min(100, 56 + kpIndex * 8),
          created_at: startedAt,
        }
        const existing = await prisma.studyRecord.findFirst({
          where: {
            student_user_id: student.user_id,
            course_id: course.course_id,
            knowledge_point_id: kps[kpIndex].knowledge_point_id,
            resource_type: 'competition_demo',
            resource_id: kpIndex + 1,
          },
        })
        if (existing) await prisma.studyRecord.update({ where: { study_record_id: existing.study_record_id }, data: studyData })
        else await prisma.studyRecord.create({ data: { student_user_id: student.user_id, course_id: course.course_id, knowledge_point_id: kps[kpIndex].knowledge_point_id, resource_type: 'competition_demo', resource_id: kpIndex + 1, ...studyData } })
      }
    }

    const avg = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    const weakKps = kps.filter((_, index) => scores[index] < 55).slice(0, 4).map(item => item.knowledge_point_name)
    const completionRate = Math.max(55, Math.min(96, avg + 8 - (studentIndex % 3) * 7))
    const activityScore = Math.max(50, Math.min(95, 68 + ((studentIndex * 9 + course.course_id) % 24)))
    const riskLevel = avg < 58 || completionRate < 60 ? 'high' : avg < 70 ? 'medium' : 'low'
    const dimensions = [
      { key: 'knowledgeUnderstanding', label: '知识理解', score: avg },
      { key: 'practicePerformance', label: '练习表现', score: completionRate },
      { key: 'problemAnalysis', label: '问题分析', score: Math.max(45, avg - 4 + (studentIndex % 4) * 3) },
      { key: 'learningEngagement', label: '学习投入', score: activityScore },
      { key: 'learningPlanning', label: '学习规划', score: Math.max(48, Math.min(96, completionRate - 3)) },
      { key: 'reflectionImprovement', label: '反思改进', score: Math.max(45, Math.min(94, avg + 2)) },
    ]
    const sortedDims = [...dimensions].sort((a, b) => b.score - a.score)
    await prisma.studentPortrait.upsert({
      where: { student_user_id_course_id: { student_user_id: student.user_id, course_id: course.course_id } },
      update: {
        learning_total_score: avg,
        progress_score: completionRate,
        mastery_score: avg,
        test_score: completionRate,
        wrong_question_score: dimensions[5].score,
        activity_score: activityScore,
        qa_score: dimensions[2].score,
        research_total_score: Math.max(50, avg - 5),
        competition_total_score: Math.max(52, avg + 3),
      },
      create: {
        student_user_id: student.user_id,
        course_id: course.course_id,
        learning_total_score: avg,
        progress_score: completionRate,
        mastery_score: avg,
        test_score: completionRate,
        wrong_question_score: dimensions[5].score,
        activity_score: activityScore,
        qa_score: dimensions[2].score,
        research_total_score: Math.max(50, avg - 5),
        competition_total_score: Math.max(52, avg + 3),
      },
    })
    const snapshotDate = fixedDate('2026-07-17')
    await prisma.studentPortraitSnapshot.upsert({
      where: { student_user_id_course_id_snapshot_date: { student_user_id: student.user_id, course_id: course.course_id, snapshot_date: snapshotDate } },
      update: {
        learning_scores: {
          overallScore: avg,
          level: avg >= 85 ? '优秀' : avg >= 70 ? '良好' : avg >= 55 ? '一般' : '待提升',
          riskLevel,
          completionRate,
          homeworkCompletionRate: completionRate,
          activeDays: 8 + (studentIndex % 7),
          weakKnowledgePoints: weakKps,
          comprehensiveScore: avg,
          dimensions,
          strengths: sortedDims.slice(0, 2).map(item => item.label),
          improvements: sortedDims.slice(-2).map(item => item.label),
        },
        mastery_summary: {
          total: kps.length,
          mastered: scores.filter(score => score >= 70).length,
          weak: weakKps.length,
          average: avg,
          graphStatus: kps.map((kp, index) => ({ id: kp.knowledge_point_id, name: kp.knowledge_point_name, mastery: scores[index], status: scores[index] >= 70 ? 'mastered' : scores[index] >= 55 ? 'learning' : 'weak' })),
        },
        activity_summary: {
          total_study_hours: 14 + studentIndex * 1.5,
          tasks_completed: Math.floor(completionRate / 18),
          average_score: avg,
          last_active_at: daysAgo(studentIndex % 3).toISOString(),
        },
      },
      create: {
        student_user_id: student.user_id,
        course_id: course.course_id,
        snapshot_date: snapshotDate,
        learning_scores: {
          overallScore: avg,
          level: avg >= 85 ? '优秀' : avg >= 70 ? '良好' : avg >= 55 ? '一般' : '待提升',
          riskLevel,
          completionRate,
          homeworkCompletionRate: completionRate,
          activeDays: 8 + (studentIndex % 7),
          weakKnowledgePoints: weakKps,
          comprehensiveScore: avg,
          dimensions,
          strengths: sortedDims.slice(0, 2).map(item => item.label),
          improvements: sortedDims.slice(-2).map(item => item.label),
        },
        mastery_summary: { total: kps.length, mastered: scores.filter(score => score >= 70).length, weak: weakKps.length, average: avg },
        activity_summary: { total_study_hours: 14 + studentIndex * 1.5, tasks_completed: Math.floor(completionRate / 18), average_score: avg },
      },
    })

    const strategyWindow = { start: fixedDate('2026-07-01'), end: fixedDate('2026-07-18') }
    const strategy = await prisma.studentStrategyProfile.findFirst({
      where: { student_user_id: student.user_id, course_id: course.course_id, profile_type: 'competition_demo', profile_version: 1, range_start: strategyWindow.start, range_end: strategyWindow.end },
    })
    const strategyData = {
      confidence: 0.86,
      sample_size: 24,
      metrics_json: { masteryAverage: avg, homeworkCompletionRate: completionRate, activityScore, weakKnowledgePoints: weakKps, riskLevel, comprehensiveScore: avg },
      recommendation_json: {
        nextActions: weakKps.length ? weakKps.map(name => `完成 ${name} 专项修复`) : ['保持综合题训练频率'],
        teacherIntervention: riskLevel !== 'low',
      },
      calculation_method: 'seeded_competition_demo_v1',
    }
    if (strategy) await prisma.studentStrategyProfile.update({ where: { id: strategy.id }, data: strategyData })
    else await prisma.studentStrategyProfile.create({ data: { student_user_id: student.user_id, course_id: course.course_id, profile_type: 'competition_demo', profile_version: 1, range_start: strategyWindow.start, range_end: strategyWindow.end, ...strategyData } })
  }

  return enrolledStudents
}

async function seedTasks(prisma, course, teachingClassesByClass, questions, teacherId) {
  const tasks = []
  for (const [classIndex, teachingClass] of Object.values(teachingClassesByClass).entries()) {
    const taskTitle = `${course.course_name} 第${classIndex + 1}轮知识图谱巩固作业`
    const taskData = {
      course_id: course.course_id,
      teaching_class_id: teachingClass.teaching_class_id,
      created_by_user_id: teacherId,
      task_type: classIndex === 1 ? 'QUIZ' : 'HOMEWORK',
      title: taskTitle,
      description: `结合 ${course.course_name} 知识图谱完成基础诊断、错因标注和变式训练。`,
      start_time: daysAgo(4 - classIndex, 9),
      deadline: daysFromNow(3 + classIndex, 22),
      allow_late_submit: true,
      allowed_attempts: 2,
      randomize_questions: classIndex === 1,
      randomize_options: classIndex === 1,
      auto_grade: true,
      ai_grade_subjective: true,
      full_screen_mode: false,
      source_mode: 'mixed',
      total_score: questions.reduce((sum, item) => sum + Number(item.score || 0), 0),
      pass_score: 24,
      instructions: '先完成客观题，再用简答题说明解题依据。系统会根据薄弱点生成复习建议。',
      configuration_json: { seed: 'competition-demo', graph_assisted: true },
      status: 'PUBLISHED',
      published_at: daysAgo(4 - classIndex, 9),
      score_release_at: daysFromNow(3 + classIndex, 22),
      analysis_release_at: daysFromNow(3 + classIndex, 22),
    }
    let task = await prisma.learningTask.findFirst({ where: { teaching_class_id: teachingClass.teaching_class_id, title: taskTitle } })
    task = task
      ? await prisma.learningTask.update({ where: { task_id: task.task_id }, data: taskData })
      : await prisma.learningTask.create({ data: taskData })
    tasks.push(task)

    for (let index = 0; index < questions.length; index += 1) {
      await prisma.taskQuestion.upsert({
        where: { task_id_question_id: { task_id: task.task_id, question_id: questions[index].question_id } },
        update: { question_order: index + 1, score: questions[index].score },
        create: { task_id: task.task_id, question_id: questions[index].question_id, question_order: index + 1, score: questions[index].score },
      })
    }

    const kps = await prisma.knowledgePoint.findMany({ where: { course_id: course.course_id }, orderBy: { sort_order: 'asc' }, take: 6 })
    for (const kp of kps) {
      await prisma.taskKnowledgePoint.upsert({
        where: { task_id_knowledge_point_id: { task_id: task.task_id, knowledge_point_id: kp.knowledge_point_id } },
        update: {},
        create: { task_id: task.task_id, knowledge_point_id: kp.knowledge_point_id },
      })
    }

    const enrollments = await prisma.studentCourseEnrollment.findMany({ where: { teaching_class_id: teachingClass.teaching_class_id, enrollment_status: 'active' }, include: { student: true } })
    await prisma.learningTaskRecipient.createMany({
      data: enrollments.map(item => ({ task_id: task.task_id, student_user_id: item.student_user_id, teaching_class_id: teachingClass.teaching_class_id, delivery_status: 'delivered', viewed_at: daysAgo(2, 20) })),
      skipDuplicates: true,
    })

    for (let index = 0; index < Math.min(3, enrollments.length); index += 1) {
      const enrollment = enrollments[index]
      const score = Math.max(58, 92 - index * 13 - classIndex * 4)
      let submission = await prisma.taskSubmission.findFirst({ where: { task_id: task.task_id, student_user_id: enrollment.student_user_id } })
      const submissionData = {
        started_at: daysAgo(2, 19 + index),
        submitted_at: daysAgo(1, 10 + index),
        duration_seconds: 1800 + index * 420,
        is_late: false,
        total_score: score,
        objective_score: Math.round(score * 0.65),
        ai_score: Math.round(score * 0.35),
        submission_status: 'GRADED',
        grading_status: 'AI_GRADED',
      }
      submission = submission
        ? await prisma.taskSubmission.update({ where: { submission_id: submission.submission_id }, data: submissionData })
        : await prisma.taskSubmission.create({ data: { task_id: task.task_id, student_user_id: enrollment.student_user_id, ...submissionData } })

      const question = questions[index % questions.length]
      const answerData = {
        student_user_id: enrollment.student_user_id,
        question_id: question.question_id,
        task_id: task.task_id,
        submission_id: submission.submission_id,
        answer_content: { answer: index % 2 === 0 ? 'B' : '需要结合知识图谱重新梳理。' },
        started_at: submissionData.started_at,
        submitted_at: submissionData.submitted_at,
        duration_seconds: 240 + index * 30,
        attempt_no: 1,
        viewed_analysis: true,
        is_correct: index % 2 === 0,
        score: index % 2 === 0 ? Number(question.score || 0) : Math.round(Number(question.score || 0) * 0.4),
        max_score: Number(question.score || 0),
        grading_status: 'AI_GRADED',
        feedback: index % 2 === 0 ? '回答正确，能定位核心概念。' : '概念边界仍需通过例题巩固。',
        auto_added_wrong_book: index % 2 !== 0,
      }
      const existingAnswer = await prisma.answerRecord.findFirst({ where: { student_user_id: enrollment.student_user_id, question_id: question.question_id, task_id: task.task_id, attempt_no: 1 } })
      if (existingAnswer) await prisma.answerRecord.update({ where: { answer_record_id: existingAnswer.answer_record_id }, data: answerData })
      else await prisma.answerRecord.create({ data: answerData })
    }
  }
  return tasks
}

async function upsertDocument(prisma, data) {
  return prisma.knowledgeDocument.upsert({
    where: { operation_id: data.operation_id },
    update: { ...data, deleted_at: null },
    create: data,
  })
}

async function seedClassWorkspaceResource(prisma, course, teachingClass, teacherId) {
  const operationId = `seed-${course.course_code}-class-${teachingClass.teaching_class_id}-guide`
  return upsertDocument(prisma, {
    title: `${teachingClass.teaching_class_name} ${course.course_name} 学习指南`,
    original_filename: `${teachingClass.teaching_class_name}-${course.course_name}-学习指南.md`,
    file_ext: 'md',
    file_size_bytes: 4096,
    mime_type: 'text/markdown',
    file_url: `/seed/408/${course.course_code}/class-${teachingClass.teaching_class_id}-guide.md`,
    scope_type: 'CLASS',
    visibility: 'CLASS',
    course_id: course.course_id,
    teaching_class_id: teachingClass.teaching_class_id,
    owner_user_id: teacherId,
    is_teaching_resource: true,
    resource_kind: 'class_guide',
    resource_category: '班级学习指南',
    resource_group_id: operationId,
    resource_version: 1,
    version_source: 'TEACHER_EDIT',
    folder_path: `408/${course.course_name}/${teachingClass.teaching_class_name}`,
    tags_json: ['408', course.course_name, teachingClass.teaching_class_name, '班级管理'],
    parse_status: 'PARSED',
    review_status: 'APPROVED',
    marketplace_status: 'READY',
    processing_state: 'ready',
    cleaned_text: `${teachingClass.teaching_class_name} 的 ${course.course_name} 学习指南，包含周学习目标、课前诊断、课堂任务、作业要求和薄弱点复习建议。`,
    operation_id: operationId,
  })
}

async function seedResourcesAndLessonPlans(prisma, course, courseDef, teachingClass, teacherId) {
  const syllabusStructure = {
    objectives: [
      `建立${course.course_name}核心概念与前置关系的完整知识框架`,
      '能够解释典型算法或机制，并完成复杂度与适用场景分析',
      '能够结合 408 真题定位薄弱知识点并制定复习策略',
    ],
    requirements: '采用讲授、案例拆解、知识图谱诊断和分层练习相结合的方式；每章安排形成性评价，课程结束完成综合应用任务。',
    chapters: courseDef.chapters.map(chapter => ({ title: chapter.name, objective: chapter.desc, knowledgePoints: chapter.kps.map(item => item.name) })),
    knowledgePoints: flattenKps(courseDef).map(item => item.name),
    sourceType: 'upload',
  }
  const syllabusMarkdown = [
    `# ${course.course_name} 408 教学大纲`,
    `## 教学目标\n${syllabusStructure.objectives.map(item => `- ${item}`).join('\n')}`,
    `## 教学要求\n${syllabusStructure.requirements}`,
    ...syllabusStructure.chapters.map((chapter, index) => `## ${index + 1}. ${chapter.title}\n${chapter.objective}\n\n知识点：${chapter.knowledgePoints.join('、')}`),
  ].join('\n\n')
  const syllabus = await upsertDocument(prisma, {
    title: `${course.course_name} 408 教学大纲`,
    original_filename: `${course.course_name}-408-教学大纲.md`,
    file_ext: 'md',
    file_size_bytes: 6144,
    mime_type: 'text/markdown',
    file_url: `/seed/408/${course.course_code}/syllabus.md`,
    scope_type: 'CLASS',
    visibility: 'CLASS',
    course_id: course.course_id,
    teaching_class_id: teachingClass.teaching_class_id,
    owner_user_id: teacherId,
    is_teaching_resource: true,
    resource_kind: 'syllabus',
    resource_category: '教学大纲',
    metadata_json: { syllabus: syllabusStructure },
    resource_group_id: `seed-${course.course_code}-syllabus`,
    resource_version: 1,
    version_source: 'LOCAL_IMPORT',
    folder_path: `408/${course.course_name}`,
    tags_json: ['408', course.course_name, '教学大纲'],
    parse_status: 'PARSED',
    review_status: 'APPROVED',
    marketplace_status: 'READY',
    processing_state: 'ready',
    cleaned_text: syllabusMarkdown,
    operation_id: `seed-${course.course_code}-syllabus`,
  })
  const courseware = await upsertDocument(prisma, {
    title: `${course.course_name} 知识图谱课件`,
    original_filename: `${course.course_name}-知识图谱课件.pptx`,
    file_ext: 'pptx',
    file_size_bytes: 32768,
    mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    file_url: `/seed/408/${course.course_code}/knowledge-graph.pptx`,
    scope_type: 'CLASS',
    visibility: 'CLASS',
    course_id: course.course_id,
    teaching_class_id: teachingClass.teaching_class_id,
    owner_user_id: teacherId,
    is_teaching_resource: true,
    resource_kind: 'courseware',
    resource_category: '课件',
    metadata_json: { graphNodes: flattenKps(courseDef).length, scene: 'competition_demo' },
    resource_group_id: `seed-${course.course_code}-courseware`,
    resource_version: 1,
    version_source: 'AI_GENERATED',
    folder_path: `408/${course.course_name}`,
    tags_json: ['知识图谱', 'PPT', course.course_name],
    parse_status: 'PARSED',
    review_status: 'APPROVED',
    marketplace_status: 'READY',
    processing_state: 'ready',
    cleaned_text: `${course.course_name} 知识图谱课件：节点、边、掌握度热力图与课堂诊断活动。`,
    operation_id: `seed-${course.course_code}-ppt-doc`,
  })
  const material = await upsertDocument(prisma, {
    title: `${course.course_name} 薄弱点修复任务单`,
    original_filename: `${course.course_name}-薄弱点修复任务单.md`,
    file_ext: 'md',
    file_size_bytes: 8192,
    mime_type: 'text/markdown',
    file_url: `/seed/408/${course.course_code}/weakness-repair.md`,
    scope_type: 'CLASS',
    visibility: 'CLASS',
    course_id: course.course_id,
    teaching_class_id: teachingClass.teaching_class_id,
    owner_user_id: teacherId,
    is_teaching_resource: true,
    resource_kind: 'worksheet',
    resource_category: '教学资源',
    resource_group_id: `seed-${course.course_code}-worksheet`,
    resource_version: 1,
    version_source: 'TEACHER_EDIT',
    folder_path: `408/${course.course_name}`,
    tags_json: ['薄弱点', '任务单', course.course_name],
    parse_status: 'PARSED',
    review_status: 'APPROVED',
    marketplace_status: 'READY',
    processing_state: 'ready',
    cleaned_text: `本任务单用于 ${course.course_name} 薄弱知识点诊断、错因分类和变式练习。`,
    operation_id: `seed-${course.course_code}-worksheet`,
  })

  const firstChapter = await prisma.chapter.findFirst({ where: { course_id: course.course_id }, orderBy: { chapter_order: 'asc' } })
  let lessonPlan = await prisma.lessonPlan.findFirst({ where: { teacher_user_id: teacherId, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id, topic: `${course.course_name} 知识图谱诊断课` } })
  const lessonData = {
    course_id: course.course_id,
    course_offering_id: teachingClass.course_offering_id,
    teaching_class_id: teachingClass.teaching_class_id,
    chapter_id: firstChapter?.chapter_id || null,
    teaching_date: daysFromNow(2, 10),
    duration_minutes: 90,
    lesson_type: '复习诊断课',
    location: teachingClass.location,
    textbook: '408 计算机学科专业基础综合复习讲义',
    input_json: { course: course.course_name, syllabusId: syllabus.document_id, syllabusTitle: syllabus.title, generationMode: 'seed_demo', useKnowledgeGraph: true, includeWeaknessRepair: true },
    source_snapshot_json: { graphNodes: flattenKps(courseDef).length, weakFocus: flattenKps(courseDef).slice(1, 4).map(item => item.name) },
    status: 'READY',
    current_version: 1,
    progress: 100,
  }
  lessonPlan = lessonPlan
    ? await prisma.lessonPlan.update({ where: { lesson_plan_id: lessonPlan.lesson_plan_id }, data: lessonData })
    : await prisma.lessonPlan.create({ data: { teacher_user_id: teacherId, topic: `${course.course_name} 知识图谱诊断课`, ...lessonData } })
  const lessonContent = {
    title: `${course.course_name} 知识图谱诊断课`,
    teachingObjectives: ['能按知识图谱说明前置关系', '能定位薄弱知识点并选择修复任务', '能完成一组 408 风格综合题'],
    keyPoints: flattenKps(courseDef).slice(0, 5).map(item => item.name),
    difficultPoints: flattenKps(courseDef).filter(item => item.diff === 'HARD').map(item => item.name),
    activities: [
      { minutes: 15, teacher: '展示班级掌握度热力图', student: '标注自己薄弱节点' },
      { minutes: 35, teacher: '讲解前置关系和典型题', student: '完成分层练习' },
      { minutes: 25, teacher: '组织错因归类', student: '提交修复任务单' },
    ],
    resources: [syllabus.title, courseware.title, material.title],
  }
  await prisma.lessonPlanVersion.upsert({
    where: { lesson_plan_id_version_number: { lesson_plan_id: lessonPlan.lesson_plan_id, version_number: 1 } },
    update: { merged_content_json: lessonContent, teacher_content_json: lessonContent, change_summary: '比赛演示教案版本' },
    create: { lesson_plan_id: lessonPlan.lesson_plan_id, version_number: 1, created_by_user_id: teacherId, change_summary: '比赛演示教案版本', ai_content_json: lessonContent, teacher_content_json: lessonContent, merged_content_json: lessonContent, locked_blocks_json: ['teachingObjectives'], data_range_json: { range: '30d' }, agents_json: ['StudentAnalyticsAgent', 'KnowledgeGraphAgent'], data_sources_json: ['mastery', 'tasks', 'resources'] },
  })
  await prisma.knowledgeDocument.update({
    where: { document_id: syllabus.document_id },
    data: { lesson_plan_id: lessonPlan.lesson_plan_id, metadata_json: { syllabus: syllabusStructure, lessonPlanId: lessonPlan.lesson_plan_id } },
  })

  let editable = await prisma.editableTeachingDocument.findFirst({ where: { owner_user_id: teacherId, lesson_plan_id: lessonPlan.lesson_plan_id, title: `${course.course_name} 知识图谱诊断教案` } })
  editable = editable
    ? await prisma.editableTeachingDocument.update({ where: { id: editable.id }, data: { course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id, status: 'DRAFT', deleted_at: null } })
    : await prisma.editableTeachingDocument.create({ data: { owner_user_id: teacherId, lesson_plan_id: lessonPlan.lesson_plan_id, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id, title: `${course.course_name} 知识图谱诊断教案`, document_type: 'LESSON_PLAN', source_type: 'AI_GENERATED', status: 'DRAFT' } })
  const html = `<h1>${course.course_name} 知识图谱诊断教案</h1><p>围绕知识点掌握度、前置关系和作业表现进行课堂诊断。</p>`
  const version = await prisma.editableTeachingDocumentVersion.upsert({
    where: { document_id_version_number: { document_id: editable.id, version_number: 1 } },
    update: { title: editable.title, content_json: lessonContent, sanitized_html: html, plain_text: `${course.course_name} 知识图谱诊断教案`, outline_json: lessonContent.teachingObjectives, source_type: 'AI_GENERATED', change_summary: '比赛演示初始化' },
    create: { document_id: editable.id, version_number: 1, title: editable.title, content_json: lessonContent, sanitized_html: html, plain_text: `${course.course_name} 知识图谱诊断教案`, outline_json: lessonContent.teachingObjectives, source_type: 'AI_GENERATED', change_summary: '比赛演示初始化', created_by_user_id: teacherId },
  })
  await prisma.editableTeachingDocument.update({ where: { id: editable.id }, data: { current_version_id: version.id, revision: 1 } })
  return { syllabus, courseware, material, lessonPlan }
}

async function upsertGeneratedArtifact(prisma, ownerUserId, course, lessonPlan, def) {
  const task = await prisma.asyncTask.upsert({
    where: { userId_operationId: { userId: ownerUserId, operationId: def.operationId } },
    update: {
      title: def.title,
      description: def.description,
      status: 'SUCCEEDED',
      stage: '已生成',
      progress: 100,
      progressMode: 'DETERMINATE',
      relatedResourceType: def.artifactType,
      relatedResourceId: String(course.course_id),
      resultType: 'ARTIFACT',
      completedAt: daysAgo(1, 16),
      metadataJson: { seed: 'competition-demo', artifactType: def.artifactType },
    },
    create: {
      userId: ownerUserId,
      operationId: def.operationId,
      taskType: 'FILE_GENERATION',
      title: def.title,
      description: def.description,
      status: 'SUCCEEDED',
      stage: '已生成',
      progress: 100,
      progressMode: 'DETERMINATE',
      relatedResourceType: def.artifactType,
      relatedResourceId: String(course.course_id),
      resultType: 'ARTIFACT',
      completedAt: daysAgo(1, 16),
      metadataJson: { seed: 'competition-demo', artifactType: def.artifactType },
    },
  })
  const payload = {
    taskId: task.id,
    lessonPlanId: lessonPlan?.lesson_plan_id || null,
    artifactType: def.artifactType,
    title: def.title,
    description: def.description,
    courseId: course.course_id,
    requirementsJson: { seed: 'competition-demo', courseCode: course.course_code, prompt: def.prompt },
    contentSchemaJson: { type: def.artifactType, version: 'demo-v1' },
    previewHtml: def.previewHtml,
    fileFormat: def.format,
    fileName: def.fileName,
    mimeType: def.mimeType,
    fileSizeBytes: BigInt(def.size),
    storagePath: def.storagePath,
    checksum: def.checksum,
    status: 'READY',
    generator: 'seed-competition-demo',
    metadataJson: { prompt: def.prompt, simulated: true },
    deletedAt: null,
  }
  let artifact = await prisma.generatedArtifact.findFirst({ where: { ownerUserId, operationId: def.operationId } })
  artifact = artifact
    ? await prisma.generatedArtifact.update({ where: { id: artifact.id }, data: payload })
    : await prisma.generatedArtifact.create({ data: { ownerUserId, operationId: def.operationId, ...payload } })
  await prisma.asyncTask.update({ where: { id: task.id }, data: { resultId: String(artifact.id), resultUrl: `#/teacher/artifacts/generated_artifact/${artifact.id}` } })
  if (def.exportFormat) {
    await prisma.generatedArtifactExport.upsert({
      where: { artifactId_format: { artifactId: artifact.id, format: def.exportFormat } },
      update: { ownerUserId, status: 'READY', storagePath: def.storagePath, fileSizeBytes: BigInt(def.size), mimeType: def.mimeType, checksum: def.checksum, deletedAt: null },
      create: { artifactId: artifact.id, ownerUserId, format: def.exportFormat, status: 'READY', storagePath: def.storagePath, fileSizeBytes: BigInt(def.size), mimeType: def.mimeType, checksum: def.checksum },
    })
  }
  return artifact
}

async function seedMultimodalRecords(prisma, course, lessonPlan, teacherId) {
  await upsertGeneratedArtifact(prisma, teacherId, course, lessonPlan, {
    operationId: `seed-${course.course_code}-ppt-artifact`,
    artifactType: 'PPT',
    title: `${course.course_name} 知识图谱演示 PPT`,
    description: '根据课程知识图谱和班级掌握度生成的课堂演示课件。',
    prompt: `生成 ${course.course_name} 408 知识图谱演示 PPT`,
    previewHtml: `<h1>${course.course_name} 知识图谱演示 PPT</h1><p>包含节点、边、薄弱点热力图和课堂提问。</p>`,
    format: 'PPTX',
    exportFormat: 'PDF',
    fileName: `${course.course_name}-知识图谱演示.pdf`,
    mimeType: 'application/pdf',
    size: 245760,
    storagePath: `seed/408/${course.course_code}/knowledge-graph-demo.pdf`,
    checksum: `seed${course.course_code.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}ppt`.padEnd(64, '0').slice(0, 64),
  })
  await upsertGeneratedArtifact(prisma, teacherId, course, lessonPlan, {
    operationId: `seed-${course.course_code}-image-artifact`,
    artifactType: 'IMAGE',
    title: `${course.course_name} 知识图谱海报`,
    description: '用于比赛演示大屏的课程知识图谱海报。',
    prompt: `生成 ${course.course_name} 知识图谱节点边关系海报`,
    previewHtml: `<h1>${course.course_name} 知识图谱海报</h1><p>节点大小表示知识权重，颜色表示班级平均掌握度。</p>`,
    format: 'PNG',
    fileName: `${course.course_name}-知识图谱海报.png`,
    mimeType: 'image/png',
    size: 186420,
    storagePath: `seed/408/${course.course_code}/knowledge-graph-poster.png`,
    checksum: `seed${course.course_code.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}img`.padEnd(64, '1').slice(0, 64),
  })

  const kps = await prisma.knowledgePoint.findMany({ where: { course_id: course.course_id }, orderBy: { sort_order: 'asc' }, take: 2 })
  for (let index = 0; index < 2; index += 1) {
    const title = `${course.course_name} ${index === 0 ? '三分钟导学视频' : '薄弱点微课'}`
    const existingVideo = await prisma.videoResource.findFirst({ where: { course_id: course.course_id, title } })
    if (!existingVideo) {
      await prisma.videoResource.create({
        data: {
          course_id: course.course_id,
          knowledge_point_id: kps[index]?.knowledge_point_id || null,
          title,
          source: 'SELF_GENERATED',
          cover_url: `/seed/408/${course.course_code}/video-cover-${index + 1}.png`,
          embed_url: `https://example.com/discimind/seed/${course.course_code}/video-${index + 1}`,
          original_url: `https://example.com/discimind/seed/${course.course_code}/video-${index + 1}`,
          duration_seconds: index === 0 ? 180 : 260,
          recommend_reason: '比赛演示模拟视频资源，用于学生端视频推荐页面展示。',
          created_by_user_id: teacherId,
        },
      })
    }
    const prompt = `为 ${course.course_name} 生成 ${title} 脚本，突出知识图谱和薄弱点修复。`
    let task = await prisma.videoGenerationTask.findFirst({ where: { course_id: course.course_id, created_by_user_id: teacherId, script_prompt: prompt } })
    const taskData = {
      knowledge_point_id: kps[index]?.knowledge_point_id || null,
      style: index === 0 ? '知识图谱导学' : '微课讲解',
      voice_type: 'teacher_female_clear',
      status: index === 0 ? 'SUCCESS' : 'GENERATING',
      result_url: index === 0 ? `/seed/408/${course.course_code}/video-${index + 1}.mp4` : null,
      error_message: null,
    }
    task = task
      ? await prisma.videoGenerationTask.update({ where: { video_generation_task_id: task.video_generation_task_id }, data: taskData })
      : await prisma.videoGenerationTask.create({ data: { course_id: course.course_id, created_by_user_id: teacherId, script_prompt: prompt, ...taskData } })
    void task
  }
}

async function seedKnowledgeGraphSnapshot(prisma, course, teachingClass) {
  const kps = await prisma.knowledgePoint.findMany({ where: { course_id: course.course_id }, orderBy: { sort_order: 'asc' } })
  const mastery = await prisma.studentMasteryRecord.groupBy({
    by: ['knowledge_point_id'],
    where: { course_id: course.course_id, student_user_id: { in: (await prisma.studentCourseEnrollment.findMany({ where: { teaching_class_id: teachingClass.teaching_class_id, enrollment_status: 'active' }, select: { student_user_id: true } })).map(item => item.student_user_id) } },
    _avg: { mastery_score: true },
    _count: { mastery_record_id: true },
  })
  const masteryByKp = new Map(mastery.map(item => [item.knowledge_point_id, item]))
  const nodes = kps.map(item => {
    const avg = Math.round(masteryByKp.get(item.knowledge_point_id)?._avg.mastery_score || 0)
    return {
      id: item.knowledge_point_id,
      code: item.knowledge_point_code,
      name: item.knowledge_point_name,
      mastery: avg,
      status: avg >= 75 ? 'mastered' : avg >= 60 ? 'learning' : 'weak',
      parentId: item.parent_id,
      difficulty: item.difficulty_level,
    }
  })
  const edges = kps.filter(item => item.parent_id).map(item => ({ source: item.parent_id, target: item.knowledge_point_id, type: 'parent_child' }))
  for (let index = 1; index < kps.length; index += 1) {
    if (index % 3 === 0) edges.push({ source: kps[index - 1].knowledge_point_id, target: kps[index].knowledge_point_id, type: 'prerequisite' })
  }
  const rangeStart = fixedDate('2026-07-01')
  const rangeEnd = fixedDate('2026-07-18')
  const existing = await prisma.digitalTwinSnapshot.findFirst({
    where: { teaching_class_id: teachingClass.teaching_class_id, course_id: course.course_id, range_start: rangeStart, range_end: rangeEnd, calculation_method: 'seeded_competition_demo_v1' },
  })
  const data = {
    sample_size: await prisma.studentCourseEnrollment.count({ where: { teaching_class_id: teachingClass.teaching_class_id, enrollment_status: 'active' } }),
    confidence: 0.88,
    knowledge_graph_json: { nodes, edges, legend: { mastered: '已掌握', learning: '学习中', weak: '薄弱' } },
    mastery_matrix_json: { rows: nodes.map(item => ({ knowledgePointId: item.id, name: item.name, averageMastery: item.mastery, status: item.status })) },
    learning_path_json: { recommendedPath: nodes.filter(item => item.status !== 'mastered').slice(0, 5).map(item => item.name) },
    risk_distribution_json: { high: nodes.filter(item => item.status === 'weak').length, medium: nodes.filter(item => item.status === 'learning').length, low: nodes.filter(item => item.status === 'mastered').length },
    data_quality_json: { source: 'seed', complete: true, nodeCount: nodes.length, edgeCount: edges.length },
  }
  if (existing) await prisma.digitalTwinSnapshot.update({ where: { id: existing.id }, data })
  else await prisma.digitalTwinSnapshot.create({ data: { teaching_class_id: teachingClass.teaching_class_id, course_id: course.course_id, range_start: rangeStart, range_end: rangeEnd, calculation_method: 'seeded_competition_demo_v1', ...data } })
}

async function seedLearningCards(prisma, course, studentUserId) {
  const kps = await prisma.knowledgePoint.findMany({ where: { course_id: course.course_id }, orderBy: { sort_order: 'asc' }, take: 3 })
  for (const kp of kps) {
    await prisma.learningCard.upsert({
      where: { id: `seed-408-card-${studentUserId}-${kp.knowledge_point_id}` },
      update: {
        title: `${kp.knowledge_point_name} 速记卡`,
        summary: `${course.course_name} 高频知识点卡片，含概念、易错点和例题切入方式。`,
        status: 'READY',
        teacherRecommended: true,
      },
      create: {
        id: `seed-408-card-${studentUserId}-${kp.knowledge_point_id}`,
        ownerUserId: studentUserId,
        scope: 'PERSONAL',
        cardType: 'CONCEPT',
        courseId: course.course_id,
        knowledgePointId: kp.knowledge_point_id,
        title: `${kp.knowledge_point_name} 速记卡`,
        summary: `${course.course_name} 高频知识点卡片，含概念、易错点和例题切入方式。`,
        contentJson: { sections: [{ title: '核心概念', body: kp.description }, { title: '演示提示', body: '先看前置关系，再做一道诊断题。' }] },
        sourceRefsJson: [{ type: 'seed', courseCode: course.course_code }],
        generatorJson: { provider: 'seed', model: 'competition-demo', generatedAt: new Date().toISOString() },
        cacheKey: `seed-408-${studentUserId}-${kp.knowledge_point_id}`,
        status: 'READY',
        teacherRecommended: true,
      },
    })
    await prisma.userLearningCardState.upsert({
      where: { userId_cardId: { userId: studentUserId, cardId: `seed-408-card-${studentUserId}-${kp.knowledge_point_id}` } },
      update: { viewCount: 1, viewedAt: daysAgo(1, 21) },
      create: { userId: studentUserId, cardId: `seed-408-card-${studentUserId}-${kp.knowledge_point_id}`, viewCount: 1, viewedAt: daysAgo(1, 21) },
    })
  }
}

async function seedRecommendations(prisma, course, studentUserId) {
  const kps = await prisma.knowledgePoint.findMany({ where: { course_id: course.course_id }, orderBy: { sort_order: 'asc' }, take: 4 })
  let record = await prisma.recommendationRecord.findFirst({ where: { student_user_id: studentUserId, course_id: course.course_id, reason_summary: '比赛演示推荐：根据知识图谱和掌握度生成。' } })
  record = record
    ? record
    : await prisma.recommendationRecord.create({ data: { student_user_id: studentUserId, course_id: course.course_id, recommend_type: 'ALL', reason_summary: '比赛演示推荐：根据知识图谱和掌握度生成。' } })
  for (let index = 0; index < kps.length; index += 1) {
    const title = `复习 ${kps[index].knowledge_point_name}`
    const existing = await prisma.recommendationItem.findFirst({ where: { recommendation_record_id: record.recommendation_record_id, title } })
    const data = { item_type: 'knowledge_point', target_type: 'knowledge_point', target_id: kps[index].knowledge_point_id, title, content: { course: course.course_name, action: 'review' }, reason: '该知识点位于当前课程知识图谱关键路径，建议优先巩固。', rank: index + 1 }
    if (existing) await prisma.recommendationItem.update({ where: { recommendation_item_id: existing.recommendation_item_id }, data })
    else await prisma.recommendationItem.create({ data: { recommendation_record_id: record.recommendation_record_id, ...data } })
  }
}

async function seedCompetitionDemo({ prisma, upsertUser, upsertProfile, adminUser, teacherUser, studentUser, log }) {
  log('15.5/16 补充比赛演示数据：408课程、班级、画像、教师资源与多模态记录')

  const demoTeacher = await upsertUser('teacher_408', {
    role: 'TEACHER',
    phone: '13800000408',
    email: 'teacher408@discimind.demo',
  })
  await upsertProfile(demoTeacher.user_id, {
    real_name: '408教研教师',
    gender: 'FEMALE',
    teacher_no: 'T4080001',
    college: '计算机与软件工程学院',
    major: '计算机科学与技术',
    professional_title: '讲师',
    teacher_preferences: { message_notifications: true, ai_style: 'competition_demo', analytics_range: '30d' },
  })

  const adminClasses = {}
  for (const classDef of DEMO_CLASS_DEFS) {
    adminClasses[classDef.class_name] = await upsertAdminClass(prisma, classDef, demoTeacher.user_id)
  }

  for (let index = 0; index < DEMO_STUDENT_DEFS.length; index += 1) {
    const [username, realName, studentNo, className] = DEMO_STUDENT_DEFS[index]
    const demoStudent = await upsertUser(username, { role: 'STUDENT', phone: `138000024${String(index + 1).padStart(2, '0')}`, email: `${username}@discimind.demo` })
    await upsertProfile(demoStudent.user_id, {
      real_name: realName,
      gender: index % 2 === 0 ? 'MALE' : 'FEMALE',
      student_no: studentNo,
      college: '计算机与软件工程学院',
      major: className.startsWith('计科') ? '计算机科学与技术' : '软件工程',
      grade: '2024',
      admin_class_id: adminClasses[className].admin_class_id,
    })
  }

  const allStudents = await prisma.user.findMany({ where: { role: 'STUDENT', status: 'ACTIVE' }, include: { profile: true } })
  const studentsByClass = {}
  for (const classDef of DEMO_CLASS_DEFS) {
    studentsByClass[classDef.class_name] = allStudents.filter(student => student.profile?.admin_class_id === adminClasses[classDef.class_name].admin_class_id)
  }

  const semester = await prisma.academicSemester.upsert({
    where: { code: '2025-2026-2' },
    update: { name: '2025-2026 学年第二学期', start_date: new Date('2026-02-23T00:00:00+08:00'), end_date: new Date('2026-07-19T23:59:59+08:00'), status: 'active' },
    create: { code: '2025-2026-2', name: '2025-2026 学年第二学期', start_date: new Date('2026-02-23T00:00:00+08:00'), end_date: new Date('2026-07-19T23:59:59+08:00'), status: 'active' },
  })

  let courseCount = 0
  let kpCount = 0
  let taskCount = 0
  for (const courseDef of COURSE_408_DEFS) {
    const course = await upsertCourse(prisma, courseDef)
    courseCount += 1
    await prisma.courseTeacherRelation.upsert({
      where: { course_id_teacher_user_id: { course_id: course.course_id, teacher_user_id: demoTeacher.user_id } },
      update: { teacher_role: 'MAIN_TEACHER' },
      create: { course_id: course.course_id, teacher_user_id: demoTeacher.user_id, teacher_role: 'MAIN_TEACHER' },
    })
    await prisma.courseTeacherRelation.upsert({
      where: { course_id_teacher_user_id: { course_id: course.course_id, teacher_user_id: teacherUser.user_id } },
      update: { teacher_role: 'ASSISTANT' },
      create: { course_id: course.course_id, teacher_user_id: teacherUser.user_id, teacher_role: 'ASSISTANT' },
    })
    const offering = await prisma.courseOffering.upsert({
      where: { course_id_semester_id: { course_id: course.course_id, semester_id: semester.semester_id } },
      update: { start_date: semester.start_date, end_date: semester.end_date, status: 'active', teaching_progress: { week: 18, topic: '408 综合复习与演示', completion: 0.78 } },
      create: { course_id: course.course_id, semester_id: semester.semester_id, start_date: semester.start_date, end_date: semester.end_date, status: 'active', teaching_progress: { week: 18, topic: '408 综合复习与演示', completion: 0.78 } },
    })
    const teachingClassesByClass = {}
    let classIndex = 0
    for (const classDef of DEMO_CLASS_DEFS) {
      teachingClassesByClass[classDef.class_name] = await upsertTeachingClass(prisma, course, offering, adminClasses[classDef.class_name], demoTeacher.user_id, teacherUser.user_id, adminUser.user_id, classIndex)
      classIndex += 1
    }

    const knowledge = await seedCourseKnowledge(prisma, course, courseDef)
    kpCount += knowledge.kps.length
    await seedMasteryAndPortraits(prisma, course, courseDef, teachingClassesByClass, studentsByClass)
    const { questions } = await seedQuestionBank(prisma, course, courseDef, Object.values(teachingClassesByClass), demoTeacher.user_id)
    const tasks = await seedTasks(prisma, course, teachingClassesByClass, questions, demoTeacher.user_id)
    taskCount += tasks.length
    for (const teachingClass of Object.values(teachingClassesByClass)) {
      await seedClassWorkspaceResource(prisma, course, teachingClass, demoTeacher.user_id)
    }
    const primaryClass = teachingClassesByClass['软件2403班'] || Object.values(teachingClassesByClass)[0]
    const resources = await seedResourcesAndLessonPlans(prisma, course, courseDef, primaryClass, demoTeacher.user_id)
    await seedMultimodalRecords(prisma, course, resources.lessonPlan, demoTeacher.user_id)
    await seedKnowledgeGraphSnapshot(prisma, course, primaryClass)
    await seedLearningCards(prisma, course, studentUser.user_id)
    await seedRecommendations(prisma, course, studentUser.user_id)
  }

  await prisma.userProfile.update({ where: { user_id: demoTeacher.user_id }, data: { default_course_id: (await prisma.course.findUnique({ where: { course_code: 'CS408-DS' } }))?.course_id || null } })
  log(`  比赛演示补数完成：${courseCount} 门408课程，${kpCount} 个知识点，${taskCount} 个教学任务。`)
  log('  新增账号：teacher_408 / student_40801-06，密码均为 123456；原 demo 账号保持不变。')
}

module.exports = { seedCompetitionDemo }
