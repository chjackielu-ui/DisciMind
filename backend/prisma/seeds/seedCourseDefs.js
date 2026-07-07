// Seed: 课程与章节知识点扩充
// 可重复执行，使用 upsert 保证幂等
// 仅在数据库中尚不存在时创建新课程，不修改已有课程

const COURSE_DEFS = [
  {
    course_name: '数据结构与算法',
    course_code: 'DS001',
    subject_category: '计算机大类学科',
    description: '系统学习线性表、树、图等经典数据结构与排序、查找、动态规划等核心算法，培养算法设计与分析能力。',
    chapters: [
      { name: '绪论与算法分析', order: 1, desc: '数据结构基本概念、算法时间复杂度与空间复杂度分析。', kps: [
        { code: 'DS-KP-001', name: '数据结构基本概念', diff: 'BASIC', desc: '数据、数据元素、数据结构、数据类型等基本概念。' },
        { code: 'DS-KP-002', name: '算法与算法分析', diff: 'BASIC', desc: '算法定义、特性、时间复杂度与空间复杂度分析方法。' },
        { code: 'DS-KP-003', name: '大O表示法', diff: 'BASIC', desc: '渐进时间复杂度的大O表示法及其计算方法。' },
      ]},
      { name: '线性表', order: 2, desc: '线性表的顺序存储与链式存储实现，以及基本操作。', kps: [
        { code: 'DS-KP-004', name: '顺序表', diff: 'BASIC', desc: '顺序存储结构的定义、实现与基本操作。' },
        { code: 'DS-KP-005', name: '单链表', diff: 'BASIC', desc: '单链表的结点结构、创建、插入、删除与遍历。' },
        { code: 'DS-KP-006', name: '双向链表与循环链表', diff: 'MEDIUM', desc: '双向链表和循环链表的结构特点与应用场景。' },
      ]},
      { name: '栈与队列', order: 3, desc: '受限线性表——栈和队列的定义、实现与应用。', kps: [
        { code: 'DS-KP-007', name: '栈的定义与实现', diff: 'BASIC', desc: '栈的后进先出特性、顺序栈与链栈实现。' },
        { code: 'DS-KP-008', name: '队列的定义与实现', diff: 'BASIC', desc: '队列的先进先出特性、循环队列与链队列实现。' },
        { code: 'DS-KP-009', name: '栈与队列的应用', diff: 'MEDIUM', desc: '表达式求值、括号匹配、迷宫求解等典型应用。' },
      ]},
      { name: '树与二叉树', order: 4, desc: '树的定义、二叉树遍历、线索二叉树、哈夫曼树等。', kps: [
        { code: 'DS-KP-010', name: '二叉树基本概念', diff: 'BASIC', desc: '二叉树的定义、性质、存储结构。' },
        { code: 'DS-KP-011', name: '二叉树遍历', diff: 'MEDIUM', desc: '先序、中序、后序、层次遍历的递归与非递归实现。' },
        { code: 'DS-KP-012', name: '二叉搜索树', diff: 'MEDIUM', desc: 'BST的查找、插入、删除操作及平衡性分析。' },
        { code: 'DS-KP-013', name: '哈夫曼树与哈夫曼编码', diff: 'MEDIUM', desc: '哈夫曼树的构造及最优前缀编码应用。' },
      ]},
      { name: '图', order: 5, desc: '图的存储结构、遍历、最小生成树、最短路径与拓扑排序。', kps: [
        { code: 'DS-KP-014', name: '图的存储结构', diff: 'BASIC', desc: '邻接矩阵、邻接表等图的存储方式及特点。' },
        { code: 'DS-KP-015', name: '图的遍历', diff: 'MEDIUM', desc: '深度优先搜索（DFS）与广度优先搜索（BFS）算法。' },
        { code: 'DS-KP-016', name: '最小生成树', diff: 'HARD', desc: 'Prim算法与Kruskal算法求最小生成树。' },
      ]},
      { name: '查找与排序', order: 6, desc: '经典查找算法与排序算法及其性能分析。', kps: [
        { code: 'DS-KP-017', name: '顺序查找与二分查找', diff: 'BASIC', desc: '顺序查找、折半查找的原理与实现。' },
        { code: 'DS-KP-018', name: '快速排序与归并排序', diff: 'MEDIUM', desc: '快速排序的分治策略与归并排序的合并过程。' },
        { code: 'DS-KP-019', name: '散列表与哈希查找', diff: 'MEDIUM', desc: '哈希函数设计、冲突处理方法与查找性能分析。' },
      ]},
    ],
  },
  {
    course_name: 'JavaScript Web 开发',
    course_code: 'JS001',
    subject_category: '软件工程实践',
    description: '从零开始学习 JavaScript 语言核心特性、DOM 操作、事件处理、异步编程与前端工程化实践。',
    chapters: [
      { name: 'JavaScript 语言基础', order: 1, desc: 'JS语法、变量、数据类型、运算符与流程控制。', kps: [
        { code: 'JS-KP-001', name: '变量与数据类型', diff: 'BASIC', desc: 'var、let、const声明，基本类型与引用类型的区别。' },
        { code: 'JS-KP-002', name: '函数与作用域', diff: 'BASIC', desc: '函数声明与表达式、箭头函数、作用域链与闭包。' },
        { code: 'JS-KP-003', name: '原型与继承', diff: 'MEDIUM', desc: '原型链、构造函数继承、class语法糖。' },
      ]},
      { name: 'DOM 与事件', order: 2, desc: '文档对象模型操作、事件机制与表单处理。', kps: [
        { code: 'JS-KP-004', name: 'DOM 查询与操作', diff: 'BASIC', desc: 'getElementById、querySelector等方法与节点增删改操作。' },
        { code: 'JS-KP-005', name: '事件模型', diff: 'MEDIUM', desc: '事件冒泡与捕获、事件委托、自定义事件。' },
        { code: 'JS-KP-006', name: '表单验证', diff: 'BASIC', desc: '表单元素访问、输入校验与提交控制。' },
      ]},
      { name: '异步编程', order: 3, desc: 'Promise、async/await、事件循环与网络请求。', kps: [
        { code: 'JS-KP-007', name: 'Promise 与 async/await', diff: 'MEDIUM', desc: 'Promise状态与链式调用、async函数与错误处理。' },
        { code: 'JS-KP-008', name: '事件循环机制', diff: 'HARD', desc: '宏任务与微任务、调用栈与任务队列。' },
        { code: 'JS-KP-009', name: 'Fetch API 与 AJAX', diff: 'MEDIUM', desc: '使用fetch发送HTTP请求、处理响应与跨域问题。' },
      ]},
      { name: 'ES6+ 新特性', order: 4, desc: '解构赋值、模块化、迭代器与生成器等现代JS特性。', kps: [
        { code: 'JS-KP-010', name: '解构与展开运算符', diff: 'BASIC', desc: '数组与对象的解构赋值、rest/spread运算符。' },
        { code: 'JS-KP-011', name: 'ES Module', diff: 'MEDIUM', desc: 'import/export语法、默认导出与命名导出。' },
        { code: 'JS-KP-012', name: 'Map、Set 与 Symbol', diff: 'MEDIUM', desc: '新的数据结构Map/Set、Symbol类型与迭代器。' },
      ]},
      { name: '前端工程化基础', order: 5, desc: '模块打包、包管理、代码规范与构建工具入门。', kps: [
        { code: 'JS-KP-013', name: 'npm 与包管理', diff: 'BASIC', desc: 'package.json、依赖管理、脚本与发布。' },
        { code: 'JS-KP-014', name: 'Vite 构建工具', diff: 'MEDIUM', desc: 'Vite开发服务器、HMR、打包配置基础。' },
        { code: 'JS-KP-015', name: '代码规范与 ESLint', diff: 'BASIC', desc: '代码风格统一、静态检查工具配置。' },
      ]},
    ],
  },
  {
    course_name: '数据库系统原理',
    course_code: 'DB001',
    subject_category: '计算机大类学科',
    description: '系统学习关系数据库理论与应用，包括关系模型、SQL、规范化理论、事务管理与数据库设计方法。',
    chapters: [
      { name: '数据库系统概述', order: 1, desc: '数据库基本概念、数据模型与数据库系统结构。', kps: [
        { code: 'DB-KP-001', name: '数据库系统基本概念', diff: 'BASIC', desc: '数据、数据库、DBMS、数据库系统的定义与组成。' },
        { code: 'DB-KP-002', name: '数据模型', diff: 'BASIC', desc: '层次模型、网状模型、关系模型的概念与比较。' },
        { code: 'DB-KP-003', name: '数据库系统三级模式', diff: 'MEDIUM', desc: '外模式、概念模式、内模式及两级映像。' },
      ]},
      { name: '关系模型与关系代数', order: 2, desc: '关系数据结构、关系完整性约束与关系代数运算。', kps: [
        { code: 'DB-KP-004', name: '关系数据结构', diff: 'BASIC', desc: '关系、元组、属性、域、候选码、主码、外码。' },
        { code: 'DB-KP-005', name: '关系完整性约束', diff: 'BASIC', desc: '实体完整性、参照完整性、用户定义完整性。' },
        { code: 'DB-KP-006', name: '关系代数运算', diff: 'MEDIUM', desc: '选择、投影、连接、除等关系代数基本运算。' },
      ]},
      { name: 'SQL 语言', order: 3, desc: '数据定义、数据查询、数据更新与视图操作。', kps: [
        { code: 'DB-KP-007', name: '数据定义语言 DDL', diff: 'BASIC', desc: 'CREATE、ALTER、DROP 等定义数据库对象语句。' },
        { code: 'DB-KP-008', name: '数据查询语言 DQL', diff: 'MEDIUM', desc: 'SELECT查询、多表连接、子查询、聚合函数与分组。' },
        { code: 'DB-KP-009', name: '数据操纵语言 DML', diff: 'BASIC', desc: 'INSERT、UPDATE、DELETE 语句的使用。' },
      ]},
      { name: '关系数据库规范化', order: 4, desc: '函数依赖、范式理论与规范化设计方法。', kps: [
        { code: 'DB-KP-010', name: '函数依赖', diff: 'MEDIUM', desc: '平凡与非平凡函数依赖、完全与部分函数依赖、传递函数依赖。' },
        { code: 'DB-KP-011', name: '范式理论', diff: 'HARD', desc: '1NF到BCNF的判断与分解方法。' },
        { code: 'DB-KP-012', name: '模式分解', diff: 'HARD', desc: '无损连接分解与保持函数依赖分解。' },
      ]},
      { name: '事务管理与并发控制', order: 5, desc: '事务ACID特性、并发问题与锁机制。', kps: [
        { code: 'DB-KP-013', name: '事务与 ACID', diff: 'MEDIUM', desc: '原子性、一致性、隔离性、持久性的含义与实现。' },
        { code: 'DB-KP-014', name: '并发控制', diff: 'HARD', desc: '封锁协议、两段锁协议、死锁检测与处理。' },
        { code: 'DB-KP-015', name: '数据库恢复技术', diff: 'MEDIUM', desc: '故障分类、日志与检查点、恢复策略。' },
      ]},
    ],
  },
  {
    course_name: '计算机网络',
    course_code: 'NET001',
    subject_category: '计算机大类学科',
    description: '系统学习计算机网络体系结构、各层协议原理与典型网络应用，覆盖TCP/IP协议栈核心内容。',
    chapters: [
      { name: '计算机网络概述', order: 1, desc: '计算机网络定义、分类、性能指标与体系结构。', kps: [
        { code: 'NET-KP-001', name: '网络分类与拓扑结构', diff: 'BASIC', desc: 'LAN、WAN、MAN分类及星型、总线型、环型拓扑。' },
        { code: 'NET-KP-002', name: 'OSI 与 TCP/IP 模型', diff: 'BASIC', desc: '七层OSI模型与四层TCP/IP模型的层次与功能对比。' },
        { code: 'NET-KP-003', name: '网络性能指标', diff: 'BASIC', desc: '带宽、时延、吞吐量、丢包率等关键性能指标。' },
      ]},
      { name: '物理层', order: 2, desc: '数据通信基础、传输介质与物理层设备。', kps: [
        { code: 'NET-KP-004', name: '数据通信基础', diff: 'BASIC', desc: '模拟信号与数字信号、信道容量、奈奎斯特定理与香农定理。' },
        { code: 'NET-KP-005', name: '传输介质', diff: 'BASIC', desc: '双绞线、同轴电缆、光纤与无线传输介质特性。' },
      ]},
      { name: '数据链路层', order: 3, desc: '帧封装、差错检测、流量控制与局域网技术。', kps: [
        { code: 'NET-KP-006', name: '差错检测与纠正', diff: 'MEDIUM', desc: '奇偶校验、CRC循环冗余校验原理。' },
        { code: 'NET-KP-007', name: 'CSMA/CD 协议', diff: 'MEDIUM', desc: '以太网介质访问控制协议的工作原理。' },
        { code: 'NET-KP-008', name: 'MAC 地址与 ARP', diff: 'BASIC', desc: 'MAC地址格式、ARP协议的工作过程。' },
      ]},
      { name: '网络层', order: 4, desc: 'IP协议、路由算法与网络层设备。', kps: [
        { code: 'NET-KP-009', name: 'IP 协议与子网划分', diff: 'MEDIUM', desc: 'IPv4地址分类、子网掩码与CIDR无类域间路由。' },
        { code: 'NET-KP-010', name: '路由算法', diff: 'HARD', desc: '距离向量算法RIP与链路状态算法OSPF的原理与比较。' },
        { code: 'NET-KP-011', name: 'ICMP 与 NAT', diff: 'MEDIUM', desc: '互联网控制报文协议与网络地址转换技术。' },
      ]},
      { name: '传输层', order: 5, desc: 'UDP与TCP协议、流量控制与拥塞控制。', kps: [
        { code: 'NET-KP-012', name: 'UDP 协议', diff: 'BASIC', desc: '无连接传输、UDP报文格式与适用场景。' },
        { code: 'NET-KP-013', name: 'TCP 可靠传输', diff: 'HARD', desc: '三次握手、四次挥手、滑动窗口与超时重传机制。' },
        { code: 'NET-KP-014', name: 'TCP 拥塞控制', diff: 'HARD', desc: '慢启动、拥塞避免、快重传与快恢复算法。' },
      ]},
      { name: '应用层', order: 6, desc: 'DNS、HTTP、电子邮件等典型应用层协议。', kps: [
        { code: 'NET-KP-015', name: 'DNS 域名系统', diff: 'MEDIUM', desc: '域名解析过程、迭代查询与递归查询。' },
        { code: 'NET-KP-016', name: 'HTTP 协议', diff: 'MEDIUM', desc: 'HTTP请求响应模型、状态码、HTTPS与HTTP/2特性。' },
      ]},
    ],
  },
  {
    course_name: 'Python 程序设计',
    course_code: 'PY001',
    subject_category: '软件工程实践',
    description: '从Python基础语法到面向对象编程、文件操作、网络编程与数据分析，培养Python实际开发能力。',
    chapters: [
      { name: 'Python 基础语法', order: 1, desc: 'Python安装、变量、数据类型、运算符与流程控制。', kps: [
        { code: 'PY-KP-001', name: 'Python 环境搭建', diff: 'BASIC', desc: 'Python安装、解释器使用、IDE配置与虚拟环境。' },
        { code: 'PY-KP-002', name: '基本数据类型', diff: 'BASIC', desc: '数字、字符串、列表、元组、字典、集合的操作。' },
        { code: 'PY-KP-003', name: '流程控制', diff: 'BASIC', desc: 'if-elif-else条件分支、for/while循环与推导式。' },
      ]},
      { name: '函数与模块', order: 2, desc: '函数定义、参数传递、lambda表达式与模块导入。', kps: [
        { code: 'PY-KP-004', name: '函数定义与参数', diff: 'BASIC', desc: '位置参数、关键字参数、默认参数与可变参数。' },
        { code: 'PY-KP-005', name: '装饰器与闭包', diff: 'HARD', desc: '高阶函数、闭包原理与装饰器的编写与应用。' },
        { code: 'PY-KP-006', name: '模块与包管理', diff: 'BASIC', desc: 'import机制、标准库常用模块与pip包管理。' },
      ]},
      { name: '面向对象编程', order: 3, desc: '类与对象、继承、多态与特殊方法。', kps: [
        { code: 'PY-KP-007', name: '类与对象', diff: 'MEDIUM', desc: '类的定义、构造方法、实例属性与类属性。' },
        { code: 'PY-KP-008', name: '继承与多态', diff: 'MEDIUM', desc: '单继承与多继承、方法重写与super()调用。' },
        { code: 'PY-KP-009', name: '魔术方法', diff: 'HARD', desc: '__str__、__repr__、__len__等特殊方法的实现。' },
      ]},
      { name: '文件与异常处理', order: 4, desc: '文件读写操作、上下文管理器与异常处理机制。', kps: [
        { code: 'PY-KP-010', name: '文件操作', diff: 'BASIC', desc: '文本文件与二进制文件的读写、with语句与上下文管理。' },
        { code: 'PY-KP-011', name: '异常处理', diff: 'BASIC', desc: 'try-except-else-finally、自定义异常与异常链。' },
      ]},
      { name: '常用库与数据处理', order: 5, desc: 'NumPy、Pandas 基础与数据可视化入门。', kps: [
        { code: 'PY-KP-012', name: 'NumPy 基础', diff: 'MEDIUM', desc: 'ndarray数组创建、索引切片与广播机制。' },
        { code: 'PY-KP-013', name: 'Pandas 数据处理', diff: 'MEDIUM', desc: 'Series与DataFrame、数据清洗、分组与聚合。' },
        { code: 'PY-KP-014', name: 'Matplotlib 可视化', diff: 'MEDIUM', desc: '折线图、柱状图、散点图与子图绘制。' },
      ]},
    ],
  },
  {
    course_name: '软件工程',
    course_code: 'SE001',
    subject_category: '软件工程实践',
    description: '系统学习软件工程方法论，涵盖需求分析、系统设计、软件测试、项目管理与敏捷开发实践。',
    chapters: [
      { name: '软件工程概述', order: 1, desc: '软件危机、软件过程模型与软件工程基本原理。', kps: [
        { code: 'SE-KP-001', name: '软件生命周期', diff: 'BASIC', desc: '软件定义、开发与维护各阶段活动与产出。' },
        { code: 'SE-KP-002', name: '软件过程模型', diff: 'BASIC', desc: '瀑布模型、增量模型、螺旋模型的特点与适用场景。' },
        { code: 'SE-KP-003', name: '敏捷开发', diff: 'MEDIUM', desc: '敏捷宣言、Scrum框架、用户故事与迭代开发。' },
      ]},
      { name: '需求分析', order: 2, desc: '需求获取、分析与规格说明方法。', kps: [
        { code: 'SE-KP-004', name: '需求获取方法', diff: 'BASIC', desc: '访谈、问卷、用例分析与原型法。' },
        { code: 'SE-KP-005', name: 'UML 用例图', diff: 'MEDIUM', desc: '参与者、用例、关系建模与用例描述模板。' },
        { code: 'SE-KP-006', name: '需求规格说明书', diff: 'MEDIUM', desc: '功能需求、非功能需求文档编写规范。' },
      ]},
      { name: '软件设计', order: 3, desc: '体系结构设计、详细设计与设计模式基础。', kps: [
        { code: 'SE-KP-007', name: '软件体系结构', diff: 'MEDIUM', desc: '分层架构、MVC、微服务等架构风格。' },
        { code: 'SE-KP-008', name: 'UML 类图与顺序图', diff: 'MEDIUM', desc: '类关系建模、对象交互时序建模。' },
        { code: 'SE-KP-009', name: '设计模式基础', diff: 'HARD', desc: '单例、工厂、观察者等常用设计模式。' },
      ]},
      { name: '软件测试', order: 4, desc: '测试策略、测试方法与测试工具。', kps: [
        { code: 'SE-KP-010', name: '测试分类与策略', diff: 'BASIC', desc: '单元测试、集成测试、系统测试与验收测试。' },
        { code: 'SE-KP-011', name: '白盒与黑盒测试', diff: 'MEDIUM', desc: '语句覆盖、分支覆盖、等价类划分与边界值分析。' },
        { code: 'SE-KP-012', name: '自动化测试', diff: 'MEDIUM', desc: '测试框架使用、CI/CD中的自动化测试集成。' },
      ]},
      { name: '项目管理', order: 5, desc: '项目估算、进度管理、质量管理与配置管理。', kps: [
        { code: 'SE-KP-013', name: '项目估算与计划', diff: 'MEDIUM', desc: 'COCOMO模型、功能点分析与甘特图。' },
        { code: 'SE-KP-014', name: 'Git 版本控制', diff: 'BASIC', desc: '分支管理、合并策略、代码审查与协作工作流。' },
        { code: 'SE-KP-015', name: '质量管理', diff: 'MEDIUM', desc: '代码审查、持续集成与质量度量指标。' },
      ]},
    ],
  },
  {
    course_name: '机器学习基础',
    course_code: 'ML002',
    subject_category: '计算机大类学科',
    description: '系统介绍机器学习基本概念、经典算法、模型评估与实际应用，涵盖监督学习、无监督学习与深度学习入门。',
    chapters: [
      { name: '机器学习概述', order: 1, desc: '机器学习基本概念、任务类型与学习范式。', kps: [
        { code: 'ML2-KP-001', name: '机器学习定义与分类', diff: 'BASIC', desc: '监督学习、无监督学习、半监督学习与强化学习。' },
        { code: 'ML2-KP-002', name: '数据预处理', diff: 'BASIC', desc: '数据清洗、特征缩放、独热编码与数据集划分。' },
        { code: 'ML2-KP-003', name: '偏差与方差', diff: 'MEDIUM', desc: '偏差-方差权衡、过拟合与欠拟合的诊断。' },
      ]},
      { name: '线性模型', order: 2, desc: '线性回归、逻辑回归与正则化技术。', kps: [
        { code: 'ML2-KP-004', name: '线性回归', diff: 'BASIC', desc: '最小二乘法、梯度下降法与多元线性回归。' },
        { code: 'ML2-KP-005', name: '逻辑回归', diff: 'MEDIUM', desc: 'sigmoid函数、决策边界与多分类扩展。' },
        { code: 'ML2-KP-006', name: '正则化', diff: 'MEDIUM', desc: 'L1正则化（Lasso）与L2正则化（Ridge）原理。' },
      ]},
      { name: '树模型与集成学习', order: 3, desc: '决策树、随机森林与梯度提升方法。', kps: [
        { code: 'ML2-KP-007', name: '决策树', diff: 'MEDIUM', desc: '信息增益、基尼系数、剪枝策略与CART算法。' },
        { code: 'ML2-KP-008', name: '随机森林', diff: 'MEDIUM', desc: 'Bagging思想、特征随机选择与OOB误差估计。' },
        { code: 'ML2-KP-009', name: 'GBDT 与 XGBoost', diff: 'HARD', desc: '梯度提升原理、XGBoost的优化与调参。' },
      ]},
      { name: '聚类与降维', order: 4, desc: 'K-means、层次聚类与PCA降维方法。', kps: [
        { code: 'ML2-KP-010', name: 'K-means 聚类', diff: 'MEDIUM', desc: 'K-means算法步骤、K值选择与聚类评估。' },
        { code: 'ML2-KP-011', name: '层次聚类与 DBSCAN', diff: 'HARD', desc: '凝聚/分裂层次聚类、基于密度的聚类方法。' },
        { code: 'ML2-KP-012', name: 'PCA 降维', diff: 'MEDIUM', desc: '协方差矩阵、特征值分解与主成分选取。' },
      ]},
      { name: '模型评估与优化', order: 5, desc: '评估指标、交叉验证与超参数调优。', kps: [
        { code: 'ML2-KP-013', name: '评估指标', diff: 'MEDIUM', desc: '准确率、精确率、召回率、F1、AUC-ROC曲线。' },
        { code: 'ML2-KP-014', name: '交叉验证', diff: 'MEDIUM', desc: 'K折交叉验证、留一法与分层采样策略。' },
        { code: 'ML2-KP-015', name: '超参数调优', diff: 'HARD', desc: '网格搜索、随机搜索与贝叶斯优化方法。' },
      ]},
    ],
  },
  {
    course_name: '人工智能导论',
    course_code: 'AI001',
    subject_category: '计算机大类学科',
    description: '介绍人工智能的基本概念、发展历史、核心技术与应用领域，涵盖搜索、知识表示、推理、学习与伦理等主题。',
    chapters: [
      { name: '人工智能概述', order: 1, desc: 'AI定义、发展历史、主要流派与应用领域。', kps: [
        { code: 'AI-KP-001', name: '人工智能定义与图灵测试', diff: 'BASIC', desc: '弱AI与强AI、图灵测试的意义与局限。' },
        { code: 'AI-KP-002', name: 'AI 发展历史', diff: 'BASIC', desc: '推理期、知识期、机器学习期的关键事件与人物。' },
        { code: 'AI-KP-003', name: 'AI 应用领域', diff: 'BASIC', desc: '计算机视觉、自然语言处理、推荐系统等典型应用。' },
      ]},
      { name: '搜索与问题求解', order: 2, desc: '状态空间搜索、启发式搜索与对抗搜索。', kps: [
        { code: 'AI-KP-004', name: '无信息搜索', diff: 'MEDIUM', desc: 'BFS、DFS、迭代加深搜索策略与复杂度分析。' },
        { code: 'AI-KP-005', name: 'A* 启发式搜索', diff: 'HARD', desc: '启发函数设计、A*算法的最优性与完备性。' },
        { code: 'AI-KP-006', name: '博弈搜索', diff: 'HARD', desc: 'Minimax算法与Alpha-Beta剪枝优化。' },
      ]},
      { name: '知识表示与推理', order: 3, desc: '谓词逻辑、产生式系统与不确定性推理。', kps: [
        { code: 'AI-KP-007', name: '一阶谓词逻辑', diff: 'MEDIUM', desc: '谓词、量词、归结原理与逻辑推理。' },
        { code: 'AI-KP-008', name: '产生式系统', diff: 'MEDIUM', desc: '规则库、工作内存与推理机的设计与实现。' },
        { code: 'AI-KP-009', name: '贝叶斯推理', diff: 'HARD', desc: '贝叶斯定理、贝叶斯网络与概率推理。' },
      ]},
      { name: '机器学习基础', order: 4, desc: '监督学习与无监督学习的基本概念与方法。', kps: [
        { code: 'AI-KP-010', name: '监督学习概述', diff: 'BASIC', desc: '分类与回归任务、训练集与测试集划分。' },
        { code: 'AI-KP-011', name: '无监督学习概述', diff: 'BASIC', desc: '聚类与降维的基本概念与典型算法。' },
        { code: 'AI-KP-012', name: '神经网络基础', diff: 'MEDIUM', desc: '感知机、多层网络与反向传播算法。' },
      ]},
      { name: 'AI 伦理与未来', order: 5, desc: 'AI伦理问题、可解释性与未来发展趋势。', kps: [
        { code: 'AI-KP-013', name: 'AI 伦理问题', diff: 'BASIC', desc: '算法偏见、隐私保护、就业影响与责任归属。' },
        { code: 'AI-KP-014', name: '可解释 AI（XAI）', diff: 'MEDIUM', desc: '黑盒模型的可解释方法、LIME与SHAP简介。' },
        { code: 'AI-KP-015', name: '通用人工智能（AGI）', diff: 'MEDIUM', desc: 'AGI的定义、技术挑战与未来展望。' },
      ]},
    ],
  },
]

module.exports = { COURSE_DEFS }
