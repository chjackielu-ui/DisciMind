// 学生端课程体验种子：六门主课程、开放教材引用、细粒度知识图谱与学习进度。
// 可重复执行；不依赖外部下载，封面均使用 frontend/public 中已记录来源的本地资源。

const CURRICULUM = [
  {
    code: 'ML001',
    name: '机器学习',
    category: '计算机大类学科',
    coverUrl: '/pics/books/book_covers/xigua.jpg',
    progress: 62,
    description: '从数据、模型到评估建立机器学习的完整学习路径，涵盖经典算法、神经网络基础与负责任应用。',
    references: [
      { title: 'The Shallow and the Deep', url: 'https://open.umn.edu/opentextbooks/textbooks/the-shallow-and-the-deep-a-biased-introduction-to-neural-networks-and-old-school-machine-learning', license: 'CC BY-NC-SA' },
      { title: 'scikit-learn User Guide', url: 'https://scikit-learn.org/stable/user_guide.html', license: 'BSD 3-Clause' },
    ],
    chapters: [
      { name: '机器学习概述', order: 1, description: '明确学习任务、数据形态与从问题到模型的基本流程。', points: [
        ['ML-KP-011', '学习任务与数据集', 'BASIC', '识别输入、输出、样本、特征、标签以及训练/验证/测试集的职责。'],
        ['ML-KP-001', '监督学习', 'BASIC', '使用带标签样本完成分类与回归，并理解经验风险最小化。', 'ML-KP-011'],
        ['ML-KP-002', '无监督学习', 'BASIC', '在无标签数据中发现群组、低维结构与异常模式。', 'ML-KP-011'],
        ['ML-KP-012', '数据预处理', 'BASIC', '完成缺失值处理、编码、标准化、数据划分与数据泄漏检查。', 'ML-KP-011'],
        ['ML-KP-013', '特征工程', 'MEDIUM', '围绕业务问题构造、选择和解释有效特征。', 'ML-KP-011'],
      ] },
      { name: '经典机器学习算法', order: 2, description: '掌握线性模型、树模型、距离模型和核方法的基本假设。', points: [
        ['ML-KP-014', '线性模型', 'BASIC', '以线性假设建立可解释的回归与分类模型。'],
        ['ML-KP-003', '线性回归', 'BASIC', '通过线性函数预测连续值，理解参数意义和残差。', 'ML-KP-014'],
        ['ML-KP-015', '最小二乘与损失函数', 'MEDIUM', '用平方误差刻画拟合偏差，并比较常见损失函数。', 'ML-KP-003'],
        ['ML-KP-016', '梯度下降', 'MEDIUM', '理解学习率、批量/随机梯度和收敛诊断。', 'ML-KP-003'],
        ['ML-KP-004', '逻辑回归', 'BASIC', '用 sigmoid 输出概率，建立二分类决策边界。', 'ML-KP-014'],
        ['ML-KP-017', '树模型与集成学习', 'MEDIUM', '利用递归划分和集成策略处理非线性关系。'],
        ['ML-KP-005', '决策树', 'MEDIUM', '使用特征划分构造可解释分类或回归规则。', 'ML-KP-017'],
        ['ML-KP-018', '信息增益与基尼系数', 'MEDIUM', '比较熵、信息增益和基尼系数在结点划分中的作用。', 'ML-KP-005'],
        ['ML-KP-019', '剪枝与泛化', 'HARD', '通过预剪枝和后剪枝控制树模型复杂度。', 'ML-KP-005'],
        ['ML-KP-020', '随机森林', 'MEDIUM', '理解 bagging、随机子空间和袋外误差。', 'ML-KP-017'],
        ['ML-KP-021', '距离模型与聚类', 'MEDIUM', '根据距离度量发现样本的局部相似性与群组。'],
        ['ML-KP-006', 'K-means 聚类', 'MEDIUM', '迭代更新簇中心，理解初始化和 K 值选择。', 'ML-KP-021'],
        ['ML-KP-022', '聚类评估', 'MEDIUM', '使用轮廓系数、类内/类间距离评估聚类结果。', 'ML-KP-006'],
        ['ML-KP-023', '降维与表示学习', 'MEDIUM', '在保留主要信息的前提下压缩特征空间。'],
        ['ML-KP-007', 'PCA 主成分分析', 'MEDIUM', '通过方差最大化寻找正交主成分。', 'ML-KP-023'],
        ['ML-KP-024', '方差解释率', 'MEDIUM', '根据累计解释方差选择合理的主成分数量。', 'ML-KP-007'],
        ['ML-KP-025', '最大间隔分类', 'HARD', '以间隔最大化建立稳健的分类边界。'],
        ['ML-KP-008', 'SVM 支持向量机', 'HARD', '理解支持向量、软间隔和核函数处理非线性问题。', 'ML-KP-025'],
      ] },
      { name: '模型评估与优化', order: 3, description: '建立可靠的实验设计，识别过拟合并选择优化方向。', points: [
        ['ML-KP-029', '评估与泛化', 'MEDIUM', '用独立数据检验模型在未知样本上的表现。'],
        ['ML-KP-010', '模型评估指标', 'MEDIUM', '针对分类和回归任务选择准确率、召回率、F1、AUC、MSE 等指标。', 'ML-KP-029'],
        ['ML-KP-030', '混淆矩阵', 'BASIC', '从 TP、FP、TN、FN 推导精确率、召回率与特异度。', 'ML-KP-010'],
        ['ML-KP-031', '交叉验证', 'MEDIUM', '利用 K 折和分层采样稳定地比较模型与超参数。', 'ML-KP-029'],
        ['ML-KP-032', '过拟合与偏差方差', 'HARD', '通过学习曲线诊断欠拟合、过拟合和方差问题。', 'ML-KP-029'],
        ['ML-KP-033', '正则化与超参数搜索', 'HARD', '用 L1/L2、网格搜索和随机搜索控制复杂度。', 'ML-KP-032'],
      ] },
      { name: '神经网络与优化', order: 4, description: '理解从感知机到多层网络的表示、训练与诊断机制。', points: [
        ['ML-KP-026', '神经网络基础', 'HARD', '理解网络层、参数、损失函数与端到端训练。'],
        ['ML-KP-009', '感知机与多层网络', 'HARD', '从线性可分到隐藏层表示，理解模型容量。', 'ML-KP-026'],
        ['ML-KP-027', '激活函数', 'MEDIUM', '比较 sigmoid、tanh、ReLU 的性质与适用场景。', 'ML-KP-026'],
        ['ML-KP-028', '反向传播', 'HARD', '通过链式法则计算梯度并更新网络参数。', 'ML-KP-026'],
      ] },
      { name: '应用实践与负责任 AI', order: 5, description: '把建模流程落到真实任务，并关注解释、公平和复现。', points: [
        ['ML-KP-034', '端到端建模流程', 'MEDIUM', '完成问题定义、数据审计、基线、实验记录和部署监控。'],
        ['ML-KP-035', '可解释性与公平性', 'MEDIUM', '认识特征重要性、偏差来源和模型使用边界。', 'ML-KP-034'],
      ] },
    ],
  },
  {
    code: 'DS001', name: '数据结构与算法', category: '计算机专业基础', coverUrl: '/pics/books/book_covers/data-structures.webp', progress: 55,
    description: '从复杂度分析到线性结构、树图和排序查找，建立可实现、可分析的算法基础。',
    references: [
      { title: 'An Open Guide to Data Structures and Algorithms', url: 'https://open.umn.edu/opentextbooks/textbooks/1017', license: 'CC BY 4.0' },
      { title: 'Open Data Structures', url: 'https://open.umn.edu/opentextbooks/textbooks/171', license: 'Open textbook' },
    ],
    chapters: [
      { name: '算法分析基础', order: 1, description: '用复杂度和递归建立算法效率意识。', points: [
        ['DS-KP-001', '抽象数据类型', 'BASIC', '区分逻辑结构、存储结构与操作接口。'], ['DS-KP-002', '时间与空间复杂度', 'BASIC', '使用 Big-O 比较增长阶。', 'DS-KP-001'], ['DS-KP-003', '递归与分治', 'MEDIUM', '掌握递归边界、递推关系和分治策略。', 'DS-KP-001'],
      ] },
      { name: '线性结构', order: 2, description: '实现表、栈、队列并分析典型应用。', points: [
        ['DS-KP-004', '线性表', 'BASIC', '理解顺序表和链表的适用场景。'], ['DS-KP-005', '链表操作', 'MEDIUM', '完成插入、删除、反转与边界处理。', 'DS-KP-004'], ['DS-KP-006', '栈与队列', 'MEDIUM', '处理括号匹配、表达式求值和 BFS 队列。', 'DS-KP-004'],
      ] },
      { name: '树与堆', order: 3, description: '建立层次结构、遍历与优先队列思维。', points: [
        ['DS-KP-007', '二叉树基础', 'BASIC', '理解树的性质和顺序/链式存储。'], ['DS-KP-008', '二叉树遍历', 'MEDIUM', '掌握前中后序与层序遍历。', 'DS-KP-007'], ['DS-KP-009', '堆与优先队列', 'MEDIUM', '用堆维护动态最值并实现堆排序。', 'DS-KP-007'],
      ] },
      { name: '图与查找', order: 4, description: '用图模型表示关系，并完成遍历与路径问题。', points: [
        ['DS-KP-010', '图的存储', 'BASIC', '比较邻接矩阵和邻接表。'], ['DS-KP-011', '图的遍历', 'MEDIUM', '用 DFS/BFS 完成连通性和层次搜索。', 'DS-KP-010'], ['DS-KP-012', '哈希与查找', 'MEDIUM', '理解散列函数、冲突处理和查找性能。', 'DS-KP-010'],
      ] },
      { name: '排序与综合实践', order: 5, description: '比较常用排序算法并根据数据特征选择方案。', points: [
        ['DS-KP-013', '排序算法比较', 'MEDIUM', '从稳定性、复杂度和空间开销比较排序。'], ['DS-KP-014', '快速排序', 'HARD', '理解划分、递归和最坏情况规避。', 'DS-KP-013'], ['DS-KP-015', '算法设计复盘', 'MEDIUM', '通过测试用例验证边界和性能。', 'DS-KP-013'],
      ] },
    ],
  },
  {
    code: 'OS001', name: '操作系统', category: '计算机专业基础', coverUrl: '/pics/books/book_covers/operating-systems.webp', progress: 48,
    description: '围绕进程、内存、文件和 I/O 理解操作系统如何安全高效地管理资源。',
    references: [
      { title: 'Operating Systems and Middleware', url: 'https://open.umn.edu/opentextbooks/textbooks/161', license: 'CC BY-SA' },
      { title: 'xv6: a simple Unix-like teaching operating system', url: 'https://pdos.csail.mit.edu/6.828/2024/xv6.html', license: 'MIT course material' },
    ],
    chapters: [
      { name: '操作系统概览', order: 1, description: '认识系统调用、特权级和资源管理目标。', points: [
        ['OS-KP-001', '操作系统职责', 'BASIC', '理解资源管理、抽象和保护机制。'], ['OS-KP-002', '系统调用', 'BASIC', '区分用户态和内核态的服务边界。', 'OS-KP-001'], ['OS-KP-003', '中断与异常', 'MEDIUM', '理解硬件事件如何进入内核处理流程。', 'OS-KP-001'],
      ] },
      { name: '进程与并发', order: 2, description: '用状态、调度和同步机制组织并发程序。', points: [
        ['OS-KP-004', '进程与线程', 'BASIC', '区分地址空间、执行流和上下文切换。'], ['OS-KP-005', '处理机调度', 'MEDIUM', '比较 FCFS、SJF、RR 与优先级调度。', 'OS-KP-004'], ['OS-KP-006', '同步与互斥', 'HARD', '用信号量和管程解决临界区问题。', 'OS-KP-004'],
      ] },
      { name: '内存管理', order: 3, description: '理解地址空间、分页和虚拟内存的协作。', points: [
        ['OS-KP-007', '地址空间', 'BASIC', '区分逻辑地址、物理地址和重定位。'], ['OS-KP-008', '分页与页表', 'MEDIUM', '理解多级页表、TLB 和地址转换。', 'OS-KP-007'], ['OS-KP-009', '页面置换', 'HARD', '比较 FIFO、LRU、Clock 与缺页率。', 'OS-KP-008'],
      ] },
      { name: '文件与设备管理', order: 4, description: '掌握持久化数据和设备访问的基本组织。', points: [
        ['OS-KP-010', '文件系统结构', 'BASIC', '理解目录、文件控制块和文件操作。'], ['OS-KP-011', '磁盘与块分配', 'MEDIUM', '比较连续、链接和索引分配。', 'OS-KP-010'], ['OS-KP-012', 'I/O 控制方式', 'MEDIUM', '比较轮询、中断和 DMA。', 'OS-KP-010'],
      ] },
      { name: '安全与综合实验', order: 5, description: '把并发、内存和文件知识用于系统观察与调试。', points: [
        ['OS-KP-013', '死锁处理', 'HARD', '分析必要条件并选择预防、避免或检测策略。'], ['OS-KP-014', '访问控制', 'MEDIUM', '理解保护域、权限和最小特权原则。'], ['OS-KP-015', '系统观测实验', 'MEDIUM', '用命令和日志验证资源使用行为。', 'OS-KP-014'],
      ] },
    ],
  },
  {
    code: 'DB001', name: '数据库系统', category: '计算机专业基础', coverUrl: '/pics/books/book_covers/database.webp', progress: 44,
    description: '从数据建模、关系代数到 SQL、事务和索引，建立可维护的数据系统设计能力。',
    references: [
      { title: 'Database Design - 2nd Edition', url: 'https://open.umn.edu/opentextbooks/textbooks/354', license: 'CC BY' },
      { title: 'PostgreSQL Documentation', url: 'https://www.postgresql.org/docs/current/', license: 'PostgreSQL License' },
    ],
    chapters: [
      { name: '数据库基础', order: 1, description: '理解 DBMS、数据模型与模式层次。', points: [
        ['DB-KP-001', 'DBMS 与数据模型', 'BASIC', '理解数据库系统的角色、模式与实例。'], ['DB-KP-002', '关系模型', 'BASIC', '理解关系、元组、属性和键。', 'DB-KP-001'], ['DB-KP-003', '关系代数', 'MEDIUM', '使用选择、投影、连接表达查询语义。', 'DB-KP-002'],
      ] },
      { name: '概念与逻辑设计', order: 2, description: '把业务需求转化为可实现的关系模式。', points: [
        ['DB-KP-004', 'ER 建模', 'BASIC', '识别实体、联系、属性和基数。'], ['DB-KP-005', '键与完整性约束', 'MEDIUM', '建立主键、外键与实体/参照完整性。', 'DB-KP-004'], ['DB-KP-006', '规范化', 'HARD', '用函数依赖完成 1NF、2NF、3NF/BCNF 分解。', 'DB-KP-004'],
      ] },
      { name: 'SQL 查询与编程', order: 3, description: '编写准确、高可读的 DDL、DML 和查询。', points: [
        ['DB-KP-007', 'SQL DDL', 'BASIC', '创建表、约束和视图。'], ['DB-KP-008', 'SQL 查询', 'MEDIUM', '组合筛选、分组、连接和子查询。', 'DB-KP-007'], ['DB-KP-009', '聚合与窗口函数', 'HARD', '进行分组分析、排序窗口和报表计算。', 'DB-KP-008'],
      ] },
      { name: '存储与索引', order: 4, description: '理解数据页、索引和查询优化的联系。', points: [
        ['DB-KP-010', '磁盘存储结构', 'MEDIUM', '理解页、记录和缓冲区管理。'], ['DB-KP-011', 'B+ 树索引', 'HARD', '理解索引查找、范围扫描和维护代价。', 'DB-KP-010'], ['DB-KP-012', '查询优化', 'HARD', '比较连接顺序、访问路径和执行计划。', 'DB-KP-011'],
      ] },
      { name: '事务与恢复', order: 5, description: '保证并发环境下数据的一致性和可恢复性。', points: [
        ['DB-KP-013', 'ACID 事务', 'MEDIUM', '理解原子性、一致性、隔离性和持久性。'], ['DB-KP-014', '并发控制', 'HARD', '比较锁、两阶段锁和 MVCC。', 'DB-KP-013'], ['DB-KP-015', '日志与恢复', 'HARD', '利用 WAL、检查点和撤销/重做恢复数据。', 'DB-KP-013'],
      ] },
    ],
  },
  {
    code: 'NET001', name: '计算机网络', category: '计算机专业基础', coverUrl: '/pics/books/book_covers/computer-networks.webp', progress: 51,
    description: '以 TCP/IP 协议栈为主线理解从链路、路由到可靠传输和应用服务的通信过程。',
    references: [
      { title: 'An Introduction to Computer Networks', url: 'https://open.umn.edu/opentextbooks/textbooks/353', license: 'Open textbook' },
      { title: 'RFC 9293: Transmission Control Protocol', url: 'https://www.rfc-editor.org/rfc/rfc9293', license: 'IETF RFC' },
    ],
    chapters: [
      { name: '网络体系结构', order: 1, description: '理解分层思想、封装过程和性能指标。', points: [
        ['NET-KP-001', 'OSI 与 TCP/IP', 'BASIC', '识别各层职责与数据单元。'], ['NET-KP-002', '封装与解封装', 'BASIC', '追踪数据从应用到链路的封装过程。', 'NET-KP-001'], ['NET-KP-003', '时延与吞吐量', 'MEDIUM', '计算发送、传播、排队和处理时延。', 'NET-KP-001'],
      ] },
      { name: '数据链路层', order: 2, description: '学习局域网帧、寻址与可靠传输基础。', points: [
        ['NET-KP-004', '以太网帧与 MAC', 'BASIC', '理解 MAC 地址和以太网帧字段。'], ['NET-KP-005', '差错检测 CRC', 'MEDIUM', '使用模 2 运算理解 CRC 检错。', 'NET-KP-004'], ['NET-KP-006', '交换与 VLAN', 'MEDIUM', '理解交换表学习和二层隔离。', 'NET-KP-004'],
      ] },
      { name: '网络层', order: 3, description: '掌握 IP 寻址、转发与路由选择。', points: [
        ['NET-KP-007', 'IPv4 与 CIDR', 'MEDIUM', '完成地址、子网掩码和路由聚合计算。'], ['NET-KP-008', 'IP 转发', 'MEDIUM', '依据最长前缀匹配选择下一跳。', 'NET-KP-007'], ['NET-KP-009', '路由协议', 'HARD', '比较距离向量、链路状态和域间路由。', 'NET-KP-007'],
      ] },
      { name: '传输层', order: 4, description: '理解端到端复用、可靠性和拥塞控制。', points: [
        ['NET-KP-010', 'UDP 与端口', 'BASIC', '理解无连接传输与端口复用。'], ['NET-KP-011', 'TCP 可靠传输', 'HARD', '使用序号、确认、滑动窗口和重传保证可靠性。', 'NET-KP-010'], ['NET-KP-012', 'TCP 拥塞控制', 'HARD', '理解慢启动、拥塞避免与快速恢复。', 'NET-KP-011'],
      ] },
      { name: '应用层与安全', order: 5, description: '用 DNS、HTTP 和 TLS 理解真实网络服务。', points: [
        ['NET-KP-013', 'DNS 解析', 'MEDIUM', '追踪递归查询、迭代查询和缓存。'], ['NET-KP-014', 'HTTP 协议', 'MEDIUM', '理解请求响应、状态码和缓存控制。'], ['NET-KP-015', 'HTTPS 与 TLS', 'HARD', '理解证书、握手和机密性保护。', 'NET-KP-014'],
      ] },
    ],
  },
  {
    code: 'PY001', name: 'Python 程序设计', category: '程序设计基础', coverUrl: '/pics/books/book_covers/python.webp', progress: 68,
    description: '以问题分解、函数、数据结构、文件和面向对象为主线培养 Python 编程与调试能力。',
    references: [
      { title: 'Think Python: How to Think Like a Computer Scientist', url: 'https://open.umn.edu/opentextbooks/textbooks/think-python-how-to-think-like-a-computer-scientist', license: 'CC BY-NC' },
      { title: 'The Python Tutorial', url: 'https://docs.python.org/3/tutorial/', license: 'PSF License' },
    ],
    chapters: [
      { name: 'Python 基础语法', order: 1, description: '掌握表达式、变量、类型和基本控制流。', points: [
        ['PY-KP-001', '变量与数据类型', 'BASIC', '理解对象、引用和基本内置类型。'], ['PY-KP-002', '表达式与运算符', 'BASIC', '正确使用算术、比较、逻辑和成员运算。', 'PY-KP-001'], ['PY-KP-003', '条件与循环', 'BASIC', '用分支和迭代控制程序流程。', 'PY-KP-001'],
      ] },
      { name: '函数与模块', order: 2, description: '通过抽象和复用组织可维护代码。', points: [
        ['PY-KP-004', '函数定义', 'BASIC', '处理参数、返回值、作用域和文档字符串。'], ['PY-KP-005', '递归函数', 'MEDIUM', '识别递归边界并避免无限递归。', 'PY-KP-004'], ['PY-KP-006', '模块与包', 'MEDIUM', '组织 import、命名空间和可复用代码。', 'PY-KP-004'],
      ] },
      { name: '内置数据结构', order: 3, description: '选择合适的容器表示和处理数据。', points: [
        ['PY-KP-007', '列表与元组', 'BASIC', '完成索引、切片、迭代和推导式。'], ['PY-KP-008', '字典与集合', 'MEDIUM', '使用映射和去重结构解决查找问题。', 'PY-KP-007'], ['PY-KP-009', '字符串处理', 'MEDIUM', '处理编码、格式化和常见文本操作。', 'PY-KP-007'],
      ] },
      { name: '文件与异常', order: 4, description: '编写可恢复、可诊断的数据处理程序。', points: [
        ['PY-KP-010', '文件读写', 'BASIC', '使用上下文管理器读写文本和结构化数据。'], ['PY-KP-011', '异常处理', 'MEDIUM', '使用 try/except/finally 建立错误边界。', 'PY-KP-010'], ['PY-KP-012', '调试与测试', 'MEDIUM', '用断点、断言和单元测试定位问题。', 'PY-KP-010'],
      ] },
      { name: '面向对象与实践', order: 5, description: '用类、协作对象和小型项目整合所学能力。', points: [
        ['PY-KP-013', '类与对象', 'MEDIUM', '定义状态、行为和构造过程。'], ['PY-KP-014', '继承与多态', 'HARD', '在适当场景复用接口与实现。', 'PY-KP-013'], ['PY-KP-015', '项目结构与代码规范', 'MEDIUM', '组织目录、依赖、日志和 README。', 'PY-KP-013'],
      ] },
    ],
  },
];

function masteryLevel(score) {
  if (score >= 85) return 'EXCELLENT';
  if (score >= 70) return 'GOOD';
  if (score >= 55) return 'GENERAL';
  return 'WEAK';
}

function toSafeClassCode(courseCode, className) {
  return `${courseCode}-${className}`.replace(/[^A-Za-z0-9\u4e00-\u9fa5-]/g, '-').slice(0, 80);
}

async function upsertChapter(prisma, courseId, definition) {
  const existing = await prisma.chapter.findFirst({ where: { course_id: courseId, chapter_name: definition.name } });
  const data = { chapter_order: definition.order, description: definition.description };
  return existing
    ? prisma.chapter.update({ where: { chapter_id: existing.chapter_id }, data })
    : prisma.chapter.create({ data: { course_id: courseId, chapter_name: definition.name, ...data } });
}

async function seedCourseKnowledge(prisma, course, definition) {
  const chapters = new Map();
  for (const chapterDef of definition.chapters) chapters.set(chapterDef.name, await upsertChapter(prisma, course.course_id, chapterDef));

  const pointsByCode = new Map();
  for (const chapterDef of definition.chapters) {
    const chapter = chapters.get(chapterDef.name);
    for (let index = 0; index < chapterDef.points.length; index += 1) {
      const [code, name, difficulty, description] = chapterDef.points[index];
      const point = await prisma.knowledgePoint.upsert({
        where: { course_id_knowledge_point_code: { course_id: course.course_id, knowledge_point_code: code } },
        update: { chapter_id: chapter.chapter_id, parent_id: null, knowledge_point_name: name, description, difficulty_level: difficulty, sort_order: chapterDef.order * 100 + index + 1 },
        create: { course_id: course.course_id, chapter_id: chapter.chapter_id, knowledge_point_code: code, knowledge_point_name: name, description, difficulty_level: difficulty, sort_order: chapterDef.order * 100 + index + 1 },
      });
      pointsByCode.set(code, point);
    }
  }

  for (const chapterDef of definition.chapters) {
    for (const [code, , , , parentCode] of chapterDef.points) {
      if (!parentCode) continue;
      const point = pointsByCode.get(code);
      const parent = pointsByCode.get(parentCode);
      if (point && parent) await prisma.knowledgePoint.update({ where: { knowledge_point_id: point.knowledge_point_id }, data: { parent_id: parent.knowledge_point_id } });
    }
  }
  return [...pointsByCode.values()];
}

async function ensureCourseContext(prisma, definition, teacherUserId, adminClass, semester) {
  const course = await prisma.course.upsert({
    where: { course_code: definition.code },
    update: { course_name: definition.name, subject_category: definition.category, description: definition.description, cover_url: definition.coverUrl, status: 'ACTIVE' },
    create: { course_code: definition.code, course_name: definition.name, subject_category: definition.category, description: definition.description, cover_url: definition.coverUrl, status: 'ACTIVE' },
  });
  await prisma.courseTeacherRelation.upsert({
    where: { course_id_teacher_user_id: { course_id: course.course_id, teacher_user_id: teacherUserId } },
    update: { teacher_role: 'MAIN_TEACHER' }, create: { course_id: course.course_id, teacher_user_id: teacherUserId, teacher_role: 'MAIN_TEACHER' },
  });
  const offering = await prisma.courseOffering.upsert({
    where: { course_id_semester_id: { course_id: course.course_id, semester_id: semester.semester_id } },
    update: { status: 'active', teaching_progress: { week: 12, topic: definition.chapters[2]?.name || '课程学习', completion: definition.progress / 100 } },
    create: { course_id: course.course_id, semester_id: semester.semester_id, start_date: semester.start_date, end_date: semester.end_date, status: 'active', teaching_progress: { week: 12, topic: definition.chapters[2]?.name || '课程学习', completion: definition.progress / 100 } },
  });
  const teachingClass = await prisma.teachingClass.upsert({
    where: { course_id_teaching_class_name: { course_id: course.course_id, teaching_class_name: adminClass.class_name } },
    update: { course_offering_id: offering.course_offering_id, teacher_user_id: teacherUserId, code: toSafeClassCode(definition.code, adminClass.class_name), semester: semester.code, schedule: { weekday: 2, periods: '3-4' }, location: '博学楼 A201', capacity: 60, status: 'active', description: `${definition.name}学生端课程体验教学班，含章节图谱、开放教材和学习进度。` },
    create: { course_id: course.course_id, course_offering_id: offering.course_offering_id, teacher_user_id: teacherUserId, teaching_class_name: adminClass.class_name, code: toSafeClassCode(definition.code, adminClass.class_name), semester: semester.code, schedule: { weekday: 2, periods: '3-4' }, location: '博学楼 A201', capacity: 60, status: 'active', description: `${definition.name}学生端课程体验教学班，含章节图谱、开放教材和学习进度。` },
  });
  await prisma.teachingClassAdminClass.upsert({
    where: { teaching_class_id_admin_class_id: { teaching_class_id: teachingClass.teaching_class_id, admin_class_id: adminClass.admin_class_id } },
    update: {}, create: { teaching_class_id: teachingClass.teaching_class_id, admin_class_id: adminClass.admin_class_id },
  });
  return { course, teachingClass };
}

async function seedStudentProgress(prisma, studentUserId, course, teachingClass, points, progress, courseIndex) {
  await prisma.studentCourseEnrollment.upsert({
    where: { student_user_id_course_id_teaching_class_id: { student_user_id: studentUserId, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id } },
    update: { enrollment_status: 'active' }, create: { student_user_id: studentUserId, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id, enrollment_status: 'active' },
  });
  const completedCount = Math.max(1, Math.round(points.length * progress / 100));
  let totalScore = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const score = Math.min(94, Math.max(42, 48 + ((courseIndex * 13 + index * 9) % 46)));
    totalScore += score;
    await prisma.studentMasteryRecord.upsert({
      where: { student_user_id_course_id_knowledge_point_id: { student_user_id: studentUserId, course_id: course.course_id, knowledge_point_id: point.knowledge_point_id } },
      update: { mastery_score: score, mastery_level: masteryLevel(score), quiz_score: Math.round(score * 0.55), question_score: Math.round(score * 0.25), study_progress_score: Math.round(score * 0.2), system_score: score, teacher_comment: score < 60 ? '建议先学习图谱中的前置节点，再完成基础练习。' : '已形成阶段性基础，可用综合题巩固。' },
      create: { student_user_id: studentUserId, course_id: course.course_id, knowledge_point_id: point.knowledge_point_id, mastery_score: score, mastery_level: masteryLevel(score), quiz_score: Math.round(score * 0.55), question_score: Math.round(score * 0.25), study_progress_score: Math.round(score * 0.2), system_score: score, teacher_comment: score < 60 ? '建议先学习图谱中的前置节点，再完成基础练习。' : '已形成阶段性基础，可用综合题巩固。' },
    });
    const existingStudy = await prisma.studyRecord.findFirst({ where: { student_user_id: studentUserId, course_id: course.course_id, knowledge_point_id: point.knowledge_point_id, resource_type: 'seed_curriculum' } });
    const startedAt = new Date(Date.now() - (points.length - index + courseIndex) * 86_400_000);
    const data = index < completedCount
      ? { action_type: 'FINISH', started_at: startedAt, finished_at: new Date(startedAt.getTime() + 25 * 60_000), duration_seconds: 25 * 60, progress_percent: 100 }
      : { action_type: 'VIEW', started_at: startedAt, finished_at: null, duration_seconds: 8 * 60, progress_percent: Math.min(80, 20 + (index % 4) * 15) };
    if (existingStudy) await prisma.studyRecord.update({ where: { study_record_id: existingStudy.study_record_id }, data });
    else await prisma.studyRecord.create({ data: { student_user_id: studentUserId, course_id: course.course_id, knowledge_point_id: point.knowledge_point_id, resource_type: 'seed_curriculum', resource_id: point.knowledge_point_id, ...data } });
  }
  await prisma.studentPortrait.upsert({
    where: { student_user_id_course_id: { student_user_id: studentUserId, course_id: course.course_id } },
    update: { learning_total_score: Math.round(totalScore / points.length), progress_score: progress, mastery_score: Math.round(totalScore / points.length), test_score: Math.max(45, Math.round(totalScore / points.length) - 4), wrong_question_score: Math.max(40, Math.round(totalScore / points.length) - 8), activity_score: Math.min(92, progress + 12), qa_score: Math.max(45, Math.round(totalScore / points.length) - 2) },
    create: { student_user_id: studentUserId, course_id: course.course_id, learning_total_score: Math.round(totalScore / points.length), progress_score: progress, mastery_score: Math.round(totalScore / points.length), test_score: Math.max(45, Math.round(totalScore / points.length) - 4), wrong_question_score: Math.max(40, Math.round(totalScore / points.length) - 8), activity_score: Math.min(92, progress + 12), qa_score: Math.max(45, Math.round(totalScore / points.length) - 2) },
  });
}

async function seedReferencesAndCards(prisma, definition, course, teachingClass, teacherUserId, studentUserId, points) {
  for (let index = 0; index < definition.references.length; index += 1) {
    const reference = definition.references[index];
    const operationId = `seed-curated-source-${definition.code}-${index + 1}`;
    await prisma.knowledgeDocument.upsert({
      where: { operation_id: operationId },
      update: { title: reference.title, external_url: reference.url, metadata_json: { source: 'Open educational resource', license: reference.license, courseCode: definition.code }, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id, owner_user_id: teacherUserId, deleted_at: null, is_teaching_resource: true, resource_kind: 'EXTERNAL_REFERENCE', resource_category: '开放教材', review_status: 'APPROVED', marketplace_status: 'READY' },
      create: { knowledge_base_id: null, title: reference.title, original_filename: `${definition.code}-reference-${index + 1}.md`, file_ext: 'md', file_size_bytes: 0, mime_type: 'text/markdown', file_url: `/seed/external/${definition.code}-reference-${index + 1}.md`, scope_type: 'CLASS', visibility: 'CLASS', course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id, owner_user_id: teacherUserId, is_teaching_resource: true, resource_kind: 'EXTERNAL_REFERENCE', resource_category: '开放教材', external_url: reference.url, metadata_json: { source: 'Open educational resource', license: reference.license, courseCode: definition.code }, tags_json: [definition.name, '开放教材'], resource_status: 'ACTIVE', parse_status: 'PARSED', review_status: 'APPROVED', marketplace_status: 'READY', processing_state: 'available', cleaned_text: `${reference.title}\n${reference.url}\n许可：${reference.license}`, operation_id: operationId },
    });
  }
  for (let index = 0; index < Math.min(3, points.length); index += 1) {
    const point = points[index * Math.max(1, Math.floor(points.length / 3))];
    const id = `seed-curated-card-${studentUserId}-${definition.code}-${point.knowledge_point_id}`;
    await prisma.learningCard.upsert({
      where: { id },
      update: { title: `${point.knowledge_point_name} 学习卡`, summary: `${definition.name} · ${point.description}`, sourceRefsJson: definition.references, teacherRecommended: true, status: 'READY' },
      create: { id, ownerUserId: studentUserId, scope: 'PERSONAL', cardType: 'CONCEPT', courseId: course.course_id, knowledgePointId: point.knowledge_point_id, title: `${point.knowledge_point_name} 学习卡`, summary: `${definition.name} · ${point.description}`, contentJson: { sections: [{ type: 'text', title: '核心概念', body: point.description }, { type: 'text', title: '学习动作', body: '先检查图谱中的前置节点，再完成一道基础练习并记录错因。' }] }, sourceRefsJson: definition.references, generatorJson: { provider: 'seed', version: 'student-learning-experience-v1' }, cacheKey: `seed-curated-${definition.code}-${point.knowledge_point_id}`, status: 'READY', teacherRecommended: true },
    });
  }
}

async function seedSyllabus(prisma, definition, course, teachingClass, teacherUserId) {
  const operationId = `seed-syllabus-${definition.code}`;
  const syllabus = {
    title: `${definition.name}教学大纲`,
    overview: definition.description,
    objectives: [
      `建立${definition.name}的核心概念框架与术语体系。`,
      '能够依据章节目标完成从基础概念到典型问题的递进学习。',
      '能够结合课程资源、练习和学习流完成一次可追踪的复盘。',
    ],
    requirements: '建议按章节顺序学习。每完成一个知识点，先在图谱中检查前置关系，再使用学习流中的资料、讲义与练习巩固。系统推荐内容将以此大纲为依据。',
    chapters: definition.chapters.map((chapter) => ({
      title: chapter.name,
      description: chapter.description,
      knowledgePoints: chapter.points.map((point) => point[1]),
    })),
  };
  const cleanedText = [syllabus.title, syllabus.overview, ...syllabus.objectives, ...syllabus.chapters.map((chapter, index) => `${index + 1}. ${chapter.title}\n${chapter.description}\n${chapter.knowledgePoints.join('、')}`)].join('\n\n');
  await prisma.knowledgeDocument.upsert({
    where: { operation_id: operationId },
    update: {
      title: syllabus.title, original_filename: `${definition.code}-syllabus.md`, course_id: course.course_id, teaching_class_id: teachingClass.teaching_class_id,
      owner_user_id: teacherUserId, metadata_json: { syllabus, source: 'seed_student_learning_experience', courseCode: definition.code },
      cleaned_text: cleanedText, deleted_at: null, is_teaching_resource: true, resource_kind: 'syllabus', resource_category: '教学大纲',
      parse_status: 'PARSED', review_status: 'APPROVED', marketplace_status: 'READY', processing_state: 'available',
    },
    create: {
      knowledge_base_id: null, title: syllabus.title, original_filename: `${definition.code}-syllabus.md`, file_ext: 'md', file_size_bytes: Buffer.byteLength(cleanedText), mime_type: 'text/markdown',
      storage_type: 'LOCAL', file_url: `/seed/syllabuses/${definition.code}.md`, scope_type: 'CLASS', visibility: 'CLASS', course_id: course.course_id,
      teaching_class_id: teachingClass.teaching_class_id, owner_user_id: teacherUserId, is_teaching_resource: true, resource_kind: 'syllabus', resource_category: '教学大纲',
      metadata_json: { syllabus, source: 'seed_student_learning_experience', courseCode: definition.code }, tags_json: [definition.name, '教学大纲', '课程起点'], resource_status: 'ACTIVE',
      parse_status: 'PARSED', review_status: 'APPROVED', marketplace_status: 'READY', processing_state: 'available', cleaned_text: cleanedText, operation_id: operationId,
    },
  });
}

async function seedStudentLearningExperience({ prisma, teacherUser, studentUser, adminClass, semester, log = () => {} }) {
  if (!teacherUser || !studentUser || !adminClass || !semester) throw new Error('学生课程种子缺少必要的用户、班级或学期信息');
  log('--- 注入学生端六门课程、知识图谱与学习进度 ---');
  const summary = [];
  for (let index = 0; index < CURRICULUM.length; index += 1) {
    const definition = CURRICULUM[index];
    const { course, teachingClass } = await ensureCourseContext(prisma, definition, teacherUser.user_id, adminClass, semester);
    const points = await seedCourseKnowledge(prisma, course, definition);
    await seedStudentProgress(prisma, studentUser.user_id, course, teachingClass, points, definition.progress, index);
    await seedSyllabus(prisma, definition, course, teachingClass, teacherUser.user_id);
    await seedReferencesAndCards(prisma, definition, course, teachingClass, teacherUser.user_id, studentUser.user_id, points);
    summary.push({ code: definition.code, chapters: definition.chapters.length, points: points.length, progress: definition.progress });
  }
  log(`  已注入 ${summary.length} 门课程、${summary.reduce((sum, item) => sum + item.chapters, 0)} 个章节、${summary.reduce((sum, item) => sum + item.points, 0)} 个知识点。`);
  return summary;
}

module.exports = { CURRICULUM, seedStudentLearningExperience };
