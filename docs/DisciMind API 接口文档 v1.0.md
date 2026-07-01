# DisciMind API 接口文档 v1.0

项目名称：学研智擎——面向一流学科建设的垂类大模型教学科研创新应用平台
英文名：DisciMind
接口版本：v1.0
后端技术栈：Node.js + Express + Prisma + MySQL + JWT + Multer
前端技术栈：Vite + HTML/CSS/JavaScript + Axios + ECharts
AI 工作流：Dify 预留，兼容 Dify Cloud 与自部署版
知识库方向：平台公共知识库、课程知识库、班级知识库、个人临时知识库
样板课程：机器学习
样板学科：计算机大类学科
接口风格：RESTful
数据格式：JSON
文件上传格式：multipart/form-data



------



# 1. 接口设计总原则

## 1.1 接口命名原则

接口统一使用 RESTful 风格：

GET   /api/courses
POST  /api/courses
GET   /api/courses/:course_id
PUT   /api/courses/:course_id
DELETE /api/courses/:course_id

路径统一使用小写英文和中划线，动态参数使用下划线命名：

/api/knowledge-points/:knowledge_point_id
/api/student-profiles/:student_id
/api/question-analysis/hot-topics

## 1.2 字段命名原则

为了方便后续数据库设计、Prisma 建模和接口联调，接口字段和数据库字段统一使用 snake_case。

示例：

{
 "user_id": 1,
 "student_no": "2403001",
 "class_id": 1,
 "course_id": 1,
 "created_at": "2026-06-30 10:00:00"
}

后续数据库表名也统一使用 snake_case，例如：

users
user_profiles
courses
knowledge_points
student_question_records

## 1.3 统一返回格式

普通接口返回：

{
 "code": 0,
 "message": "success",
 "data": {}
}

分页接口返回：

{
 "code": 0,
 "message": "success",
 "data": {
  "list": [],
  "total": 100,
  "page": 1,
  "page_size": 10
 }
}

失败返回：

{
 "code": 40001,
 "message": "参数错误",
 "data": **null**
}

## 1.4 通用请求头

除注册、登录、公开资源接口外，其余接口均需要携带 JWT。

Authorization: Bearer <token>
Content-Type: application/json

文件上传接口使用：

Authorization: Bearer <token>
Content-Type: multipart/form-data



------



# 2. 用户角色与权限

## 2.1 系统角色

第一版只设计三类身份：

| role    | 中文名称 | 权限说明                                                     |
| ------- | -------- | ------------------------------------------------------------ |
| admin   | 管理员   | 管理用户、课程、知识库、数据看板、AI 模型配置、日志、安全策略 |
| teacher | 教师     | 管理课程、教学班、知识库、作业测试、学习任务、学生画像、学情分析 |
| student | 学生     | 学习课程、AI 问答、在线答题、查看推荐、查看画像、上传个人资料 |

## 2.2 注册策略

所有人可以自由注册，并选择身份：

admin / teacher / student

同时系统保留三个 Demo 种子账号：

| 角色   | 账号         | 密码   | 用途         |
| ------ | ------------ | ------ | ------------ |
| 管理员 | admin_demo   | 123456 | 系统后台演示 |
| 教师   | teacher_demo | 123456 | 教师端演示   |
| 学生   | student_demo | 123456 | 学生端演示   |

正式部署时可以限制管理员注册，比赛 Demo 阶段保持开放。



------



# 3. 通用错误码

| code  | 含义           | 说明                       |
| ----- | -------------- | -------------------------- |
| 0     | success        | 请求成功                   |
| 40001 | 参数错误       | 请求参数缺失或格式错误     |
| 40002 | 数据不存在     | 查询的数据不存在           |
| 40003 | 数据已存在     | 用户名、邮箱、学号等重复   |
| 40101 | 未登录         | 未携带 token               |
| 40102 | 登录过期       | token 无效或过期           |
| 40301 | 权限不足       | 当前角色无权限访问         |
| 40401 | 接口不存在     | 路由不存在                 |
| 50001 | 服务器错误     | 后端运行异常               |
| 50002 | AI 服务异常    | Dify 或大模型服务调用失败  |
| 50003 | 知识库解析失败 | 文件解析、切片或向量化失败 |
| 50004 | 文件上传失败   | 文件格式或存储异常         |
| 50005 | 视频检索失败   | 外部视频检索失败           |



------



# 4. 认证与用户模块

## 4.1 用户注册

POST /api/auth/register

权限：公开

### 请求参数

{
 "username": "student001",
 "password": "123456",
 "role": "student",
 "phone": "13800000000",
 "email": "student001@example.com",
 "real_name": "张三",
 "gender": "male",
 "student_no": "2403001",
 "college": "计算机与软件工程学院",
 "major": "软件工程",
 "admin_class_id": 1,
 "avatar_url": ""
}

### 参数说明

| 字段           | 类型   | 必填     | 说明                      |
| -------------- | ------ | -------- | ------------------------- |
| username       | string | 是       | 登录账号                  |
| password       | string | 是       | 登录密码                  |
| role           | string | 是       | admin / teacher / student |
| phone          | string | 否       | 手机号                    |
| email          | string | 否       | 邮箱                      |
| real_name      | string | 是       | 真实姓名                  |
| gender         | string | 否       | male / female / unknown   |
| student_no     | string | 学生必填 | 学号                      |
| college        | string | 否       | 学院                      |
| major          | string | 否       | 专业                      |
| admin_class_id | number | 学生可填 | 行政班级 ID               |
| avatar_url     | string | 否       | 头像地址                  |

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "user_id": 1,
  "username": "student001",
  "role": "student",
  "token": "jwt_token_string"
 }
}

### 涉及数据表

users
user_profiles
admin_classes
operation_logs



------



## 4.2 用户登录

POST /api/auth/login

权限：公开

### 请求参数

账号可以是 username、phone 或 email。

{
 "account": "student001",
 "password": "123456"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "token": "jwt_token_string",
  "user": {
   "user_id": 1,
   "username": "student001",
   "role": "student",
   "real_name": "张三",
   "avatar_url": "/uploads/avatar/student001.png"
  }
 }
}

### 涉及数据表

users
user_profiles
login_logs



------



## 4.3 获取当前用户信息

GET /api/auth/me

权限：登录用户

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "user_id": 1,
  "username": "student001",
  "role": "student",
  "phone": "13800000000",
  "email": "student001@example.com",
  "profile": {
   "real_name": "张三",
   "gender": "male",
   "student_no": "2403001",
   "college": "计算机与软件工程学院",
   "major": "软件工程",
   "avatar_url": "/uploads/avatar/student001.png"
  }
 }
}



------



## 4.4 修改个人资料

PUT /api/users/profile

权限：登录用户

### 请求参数

{
 "real_name": "张三",
 "gender": "male",
 "phone": "13800000000",
 "email": "student001@example.com",
 "student_no": "2403001",
 "college": "计算机与软件工程学院",
 "major": "软件工程",
 "admin_class_id": 1
}



------



## 4.5 上传头像

POST /api/users/avatar

权限：登录用户
请求类型：multipart/form-data

### 请求参数

| 字段 | 类型 | 必填 | 说明     |
| ---- | ---- | ---- | -------- |
| file | file | 是   | 用户头像 |

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "avatar_url": "/uploads/avatar/user_1.png",
  "storage_type": "local"
 }
}

### 存储策略

开发阶段使用本地目录：

/uploads/avatar/

部署阶段预留阿里云 OSS：

storage_type: local / oss



------



# 5. 管理员用户管理模块

## 5.1 获取用户列表

GET /api/admin/users

权限：admin

### 查询参数

| 参数      | 类型   | 必填 | 说明                         |
| --------- | ------ | ---- | ---------------------------- |
| keyword   | string | 否   | 搜索用户名、姓名、学号、邮箱 |
| role      | string | 否   | admin / teacher / student    |
| status    | string | 否   | active / disabled            |
| page      | number | 否   | 页码                         |
| page_size | number | 否   | 每页数量                     |

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "list": [
   {
    "user_id": 1,
    "username": "student001",
    "role": "student",
    "real_name": "张三",
    "student_no": "2403001",
    "college": "计算机与软件工程学院",
    "status": "active",
    "created_at": "2026-06-30 10:00:00"
   }
  ],
  "total": 1,
  "page": 1,
  "page_size": 10
 }
}



------



## 5.2 修改用户状态

PUT /api/admin/users/:user_id/status

权限：admin

### 请求参数

{
 "status": "disabled"
}



------



## 5.3 重置用户密码

PUT /api/admin/users/:user_id/password

权限：admin

### 请求参数

{
 "new_password": "123456"
}



------



# 6. 班级与课程模块

系统中同时存在两类班级：

行政班级：admin_classes
教学班级：teaching_classes

行政班级用于学生基础身份管理，例如“软件2403班”。

教学班级挂在课程下面，例如“机器学习 1 班”。

## 6.1 行政班级列表

GET /api/admin-classes

权限：admin / teacher / student

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": [
  {
   "admin_class_id": 1,
   "class_name": "软件2403班",
   "college": "计算机与软件工程学院",
   "major": "软件工程",
   "grade": "2024"
  }
 ]
}



------



## 6.2 创建课程

POST /api/courses

权限：admin / teacher

### 请求参数

{
 "course_name": "机器学习",
 "course_code": "ML001",
 "subject_category": "计算机大类学科",
 "description": "以机器学习课程为样板，支撑学习画像、知识库问答和个性化推荐。",
 "cover_url": "/uploads/course/ml.png",
 "status": "active"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "course_id": 1,
  "course_name": "机器学习"
 }
}

### 涉及数据表

courses
operation_logs



------



## 6.3 获取课程列表

GET /api/courses

权限：登录用户

### 查询参数

| 参数             | 类型   | 说明              |
| ---------------- | ------ | ----------------- |
| keyword          | string | 搜索课程名称      |
| subject_category | string | 学科分类          |
| status           | string | active / archived |
| page             | number | 页码              |
| page_size        | number | 每页数量          |



------



## 6.4 获取课程详情

GET /api/courses/:course_id

权限：登录用户

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "course_id": 1,
  "course_name": "机器学习",
  "course_code": "ML001",
  "subject_category": "计算机大类学科",
  "description": "机器学习样板课程",
  "teacher_list": [
   {
    "user_id": 2,
    "real_name": "李老师",
    "teacher_role": "main_teacher"
   }
  ]
 }
}



------



## 6.5 绑定课程教师

POST /api/courses/:course_id/teachers

权限：admin / teacher

### 请求参数

{
 "teacher_user_id": 2,
 "teacher_role": "main_teacher"
}

### teacher_role 说明

| 值           | 含义       |
| ------------ | ---------- |
| main_teacher | 主讲教师   |
| assistant    | 助教       |
| manager      | 课程管理员 |

### 涉及数据表

course_teacher_relations



------



## 6.6 创建教学班级

POST /api/courses/:course_id/teaching-classes

权限：admin / teacher

### 请求参数

{
 "teaching_class_name": "机器学习1班",
 "semester": "2026春季学期",
 "description": "软件工程专业机器学习教学班"
}

### 涉及数据表

teaching_classes



------



## 6.7 学生加入教学班

POST /api/teaching-classes/:teaching_class_id/students

权限：admin / teacher

### 请求参数

{
 "student_user_ids": [1, 3, 4]
}

### 涉及数据表

student_course_enrollments



------



# 7. 章节与知识点模块

课程结构采用：

课程 course
 \- 章节 chapter
  \- 知识点 knowledge_point
   \- 资料 document
   \- 习题 question
   \- 学习记录 study_record

## 7.1 创建章节

POST /api/courses/:course_id/chapters

权限：admin / teacher

### 请求参数

{
 "chapter_name": "第1章 机器学习导论",
 "chapter_order": 1,
 "description": "介绍机器学习基本概念、任务类型和应用场景。"
}



------



## 7.2 获取课程章节

GET /api/courses/:course_id/chapters

权限：登录用户



------



## 7.3 创建知识点

POST /api/chapters/:chapter_id/knowledge-points

权限：admin / teacher

### 请求参数

{
 "knowledge_point_name": "监督学习",
 "knowledge_point_code": "ML-KP-001",
 "description": "通过带标签数据训练模型，使模型能够对未知样本进行预测。",
 "difficulty_level": "basic",
 "parent_id": **null**,
 "aliases": ["有监督学习", "supervised learning", "带标签学习"]
}

### 涉及数据表

knowledge_points
knowledge_point_aliases



------



## 7.4 获取知识点列表

GET /api/courses/:course_id/knowledge-points

权限：登录用户

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": [
  {
   "knowledge_point_id": 1,
   "knowledge_point_name": "监督学习",
   "difficulty_level": "basic",
   "mastery_score": 86,
   "mastery_level": "良好"
  }
 ]
}



------



## 7.5 样板课程预置知识点

机器学习课程第一版建议预置：

| knowledge_point_code | knowledge_point_name | aliases                         |
| -------------------- | -------------------- | ------------------------------- |
| ML-KP-001            | 监督学习             | 有监督学习, supervised learning |
| ML-KP-002            | 无监督学习           | unsupervised learning           |
| ML-KP-003            | 线性回归             | linear regression               |
| ML-KP-004            | 逻辑回归             | logistic regression             |
| ML-KP-005            | 决策树               | decision tree                   |
| ML-KP-006            | K-means 聚类         | K-means, 聚类算法               |
| ML-KP-007            | PCA 主成分分析       | PCA, 主成分分析, 降维           |
| ML-KP-008            | SVM 支持向量机       | SVM, 支持向量机                 |
| ML-KP-009            | 神经网络基础         | neural network                  |
| ML-KP-010            | 模型评估指标         | 准确率, 精确率, 召回率, F1      |



------



# 8. 知识库模块

## 8.1 知识库类型

系统支持四类知识库：

| scope_type | 中文名称       | 说明                                     |
| ---------- | -------------- | ---------------------------------------- |
| platform   | 平台公共知识库 | 全平台可用，由管理员维护                 |
| course     | 课程知识库     | 某门课程内可用                           |
| class      | 班级知识库     | 某个教学班内可用                         |
| personal   | 个人临时知识库 | 学生或教师个人使用，后续可构建个人智能体 |

## 8.2 文档处理状态

知识库文件上传后需要体现解析流程：

| parse_status   | 含义     |
| -------------- | -------- |
| uploaded       | 已上传   |
| parsing        | 解析中   |
| parsed         | 已解析   |
| chunking       | 切片中   |
| chunked        | 已切片   |
| embedding      | 向量化中 |
| embedded       | 已向量化 |
| failed         | 处理失败 |
| pending_review | 等待审核 |
| approved       | 审核通过 |
| rejected       | 审核拒绝 |



------



## 8.3 上传知识库文件

POST /api/knowledge-documents

权限：admin / teacher / student
请求类型：multipart/form-data

### 支持格式

第一版支持：

PDF、Word、TXT、Markdown

OCR 接口预留，不作为第一版强制完成。

### 请求参数

| 字段              | 类型   | 必填 | 说明                                 |
| ----------------- | ------ | ---- | ------------------------------------ |
| file              | file   | 是   | 上传文件                             |
| title             | string | 是   | 文档标题                             |
| scope_type        | string | 是   | platform / course / class / personal |
| course_id         | number | 否   | 课程知识库必填                       |
| teaching_class_id | number | 否   | 班级知识库必填                       |
| visibility        | string | 是   | private / class / college / school   |
| description       | string | 否   | 文档说明                             |

### 说明

学生可以上传资料，并选择可见范围：

| visibility | 含义                           |
| ---------- | ------------------------------ |
| private    | 仅自己可见                     |
| class      | 班级可见，需要教师审核         |
| college    | 学院可见，需要教师或管理员审核 |
| school     | 全校可见，需要管理员审核       |

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "document_id": 1,
  "title": "机器学习导论.pdf",
  "scope_type": "course",
  "visibility": "class",
  "parse_status": "uploaded",
  "review_status": "pending",
  "storage_type": "local",
  "file_url": "/uploads/knowledge/ml_intro.pdf"
 }
}

### 涉及数据表

knowledge_documents
knowledge_document_chunks
knowledge_document_reviews
knowledge_bases
operation_logs



------



## 8.4 获取知识库文档列表

GET /api/knowledge-documents

权限：登录用户

### 查询参数

| 参数              | 类型   | 说明                                 |
| ----------------- | ------ | ------------------------------------ |
| scope_type        | string | platform / course / class / personal |
| course_id         | number | 课程 ID                              |
| teaching_class_id | number | 教学班 ID                            |
| parse_status      | string | 解析状态                             |
| review_status     | string | 审核状态                             |
| keyword           | string | 搜索标题                             |
| page              | number | 页码                                 |
| page_size         | number | 每页数量                             |



------



## 8.5 查看文档解析状态

GET /api/knowledge-documents/:document_id/status

权限：admin / teacher / 文档拥有者

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "document_id": 1,
  "parse_status": "embedded",
  "review_status": "approved",
  "chunk_count": 38,
  "embedding_model": "text-embedding-v1",
  "error_message": **null**
 }
}



------



## 8.6 审核知识库文档

PUT /api/knowledge-documents/:document_id/review

权限：admin / teacher

### 请求参数

{
 "review_status": "approved",
 "review_comment": "资料内容符合课程要求，可以进入班级知识库。"
}



------



## 8.7 知识库检索

POST /api/knowledge-search

权限：登录用户

### 请求参数

{
 "query": "PCA 为什么可以降维？",
 "scope_type": "course",
 "course_id": 1,
 "teaching_class_id": 1,
 "top_k": 5
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "query": "PCA 为什么可以降维？",
  "results": [
   {
    "chunk_id": 12,
    "document_id": 1,
    "document_title": "机器学习导论.pdf",
    "chunk_text": "PCA 通过寻找方差最大的方向来保留数据主要信息……",
    "similarity": 0.89,
    "page_number": 15
   }
  ]
 }
}



------



# 9. AI 问答与多轮对话模块

## 9.1 新建会话

POST /api/chat/conversations

权限：登录用户

### 请求参数

{
 "course_id": 1,
 "teaching_class_id": 1,
 "agent_type": "course_qa",
 "title": "PCA 学习问题"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "conversation_id": 1,
  "title": "PCA 学习问题",
  "agent_type": "course_qa"
 }
}



------



## 9.2 获取会话列表

GET /api/chat/conversations

权限：登录用户

### 查询参数

| 参数       | 类型   | 说明       |
| ---------- | ------ | ---------- |
| course_id  | number | 课程 ID    |
| agent_type | string | 智能体类型 |
| page       | number | 页码       |
| page_size  | number | 每页数量   |



------



## 9.3 发送问题

POST /api/chat/conversations/:conversation_id/messages

权限：登录用户

### 请求参数

{
 "question": "PCA 为什么可以用较少的维度保留主要信息？",
 "course_id": 1,
 "use_knowledge_base": **true**,
 "scope_type": "course"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "message_id": 101,
  "conversation_id": 1,
  "answer": "PCA 的核心思想是寻找数据方差最大的方向……",
  "is_ai_generated": **true**,
  "ai_provider": "dify",
  "model_name": "spark-lite",
  "agent_type": "course_qa",
  "sources": [
   {
    "document_id": 1,
    "document_title": "机器学习导论.pdf",
    "page_number": 15,
    "chunk_text": "PCA 通过寻找方差最大的方向来保留数据主要信息……",
    "similarity": 0.89
   }
  ],
  "question_analysis": {
   "knowledge_point_id": 7,
   "knowledge_point_name": "PCA 主成分分析",
   "normalized_question_type": "原理理解",
   "keywords": ["PCA", "降维", "主成分", "方差"],
   "confusion_tags": ["原理不清", "数学含义不理解"],
   "confidence": 0.91
  }
 }
}

### 说明

该接口需要同时完成：

1. 保存学生原始提问
2. 调用知识库检索
3. 调用 Dify 课程问答智能体
4. 返回 AI 回答
5. 返回引用来源
6. 生成问题关键词摘要
7. 将问题归一化到标准知识点
8. 更新学生知识点掌握度
9. 写入教师端高频问题统计



------



## 9.4 获取会话历史消息

GET /api/chat/conversations/:conversation_id/messages

权限：登录用户



------



## 9.5 停止 AI 生成

POST /api/chat/messages/:message_id/stop

权限：消息所属用户

### 说明

用于前端“停止回答”按钮。



------



# 10. 学生提问分析与知识点归一化模块

该模块用于解决学生自然语言提问表达不统一的问题。

## 10.1 设计目标

学生可能用不同说法表达同一个知识点问题：

PCA 是怎么降维的？
主成分分析为什么能保留主要信息？
特征值和特征向量在 PCA 里有什么用？
那个降维算法我还是没看懂。

系统不能把它们当成四个完全不同的问题，而应该归一化为：

知识点：PCA 主成分分析
问题类型：原理理解
主要疑惑：降维机制、主成分含义、特征值作用

## 10.2 分析流程

学生原始问题
 ↓
文本清洗
 ↓
关键词抽取
 ↓
向量化表示
 ↓
匹配知识点别名库
 ↓
匹配知识点向量库
 ↓
AI 归纳问题摘要
 ↓
归一化到标准 knowledge_point_id
 ↓
生成 question_summary / keywords / confusion_tags
 ↓
更新画像与可视化

## 10.3 分析学生问题

POST /api/question-analysis/analyze

权限：登录用户 / 系统内部调用

### 请求参数

{
 "student_user_id": 1,
 "course_id": 1,
 "conversation_id": 1,
 "message_id": 101,
 "raw_question": "PCA 里面特征值和特征向量到底有什么用？"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "analysis_id": 1,
  "raw_question": "PCA 里面特征值和特征向量到底有什么用？",
  "question_summary": "学生对 PCA 中特征值和特征向量的作用存在疑惑。",
  "knowledge_point_id": 7,
  "knowledge_point_name": "PCA 主成分分析",
  "normalized_question_type": "概念理解",
  "keywords": ["PCA", "特征值", "特征向量", "降维"],
  "confusion_tags": ["数学含义不理解", "算法流程不清楚"],
  "confidence": 0.9,
  "need_teacher_review": **false**
 }
}

## 10.4 获取课程高频问题统计

GET /api/question-analysis/courses/:course_id/hot-topics

权限：admin / teacher

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": [
  {
   "knowledge_point_id": 7,
   "knowledge_point_name": "PCA 主成分分析",
   "question_count": 18,
   "student_count": 12,
   "top_keywords": ["PCA", "降维", "主成分", "特征值"],
   "top_confusion_tags": ["原理不清", "数学含义不理解"],
   "risk_level": "high"
  }
 ]
}

## 10.5 教师修正问题归一化结果

PUT /api/question-analysis/:analysis_id/review

权限：teacher / admin

### 请求参数

{
 "knowledge_point_id": 7,
 "normalized_question_type": "原理理解",
 "confusion_tags": ["降维原理不清", "特征值作用不理解"],
 "teacher_comment": "该问题应归入 PCA 主成分分析。"
}

### 说明

教师修正后，系统应将该修正记录写入别名库和映射表，用于后续提升归一化准确率。

### 涉及数据表

student_question_records
question_analysis_records
question_keywords
question_confusion_tags
question_knowledge_point_mappings
knowledge_point_aliases



------



# 11. 任务系统模块

教师发布的作业、测试、学习任务、复习计划统一设计为任务系统，通过 task_type 区分。

## 11.1 task_type 类型

| task_type   | 含义     |
| ----------- | -------- |
| homework    | 作业     |
| quiz        | 测试     |
| study_task  | 学习任务 |
| review_plan | 复习计划 |



------



## 11.2 创建任务

POST /api/tasks

权限：teacher / admin

### 请求参数

{
 "course_id": 1,
 "teaching_class_id": 1,
 "task_type": "homework",
 "title": "PCA 基础练习",
 "description": "完成 PCA 相关基础题目。",
 "start_time": "2026-07-01 08:00:00",
 "deadline": "2026-07-07 23:59:59",
 "question_ids": [1, 2, 3],
 "knowledge_point_ids": [7],
 "allow_late_submit": **false**,
 "status": "published"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "task_id": 1,
  "title": "PCA 基础练习",
  "task_type": "homework",
  "status": "published"
 }
}

### 涉及数据表

learning_tasks
task_questions
task_knowledge_points
notifications
operation_logs



------



## 11.3 获取任务列表

GET /api/tasks

权限：登录用户

### 查询参数

| 参数              | 类型   | 说明                                       |
| ----------------- | ------ | ------------------------------------------ |
| course_id         | number | 课程 ID                                    |
| teaching_class_id | number | 教学班 ID                                  |
| task_type         | string | homework / quiz / study_task / review_plan |
| status            | string | draft / published / closed                 |
| page              | number | 页码                                       |
| page_size         | number | 每页数量                                   |



------



## 11.4 学生提交任务

POST /api/tasks/:task_id/submit

权限：student

### 请求参数

{
 "answers": [
  {
   "question_id": 1,
   "answer_content": "A"
  },
  {
   "question_id": 2,
   "answer_content": ["A", "C"]
  },
  {
   "question_id": 3,
   "answer_content": "PCA 的核心是寻找方差最大的方向。"
  }
 ],
 "started_at": "2026-07-01 10:00:00",
 "submitted_at": "2026-07-01 10:35:00",
 "duration_seconds": 2100
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "submission_id": 1,
  "task_id": 1,
  "total_score": 88,
  "objective_score": 60,
  "ai_score": 28,
  "is_late": **false**,
  "grading_status": "graded"
 }
}



------



# 12. 题库与在线答题模块

## 12.1 题目类型

第一版实现：

| question_type   | 含义   | 批改方式               |
| --------------- | ------ | ---------------------- |
| single_choice   | 单选题 | 系统自动批改           |
| multiple_choice | 多选题 | 系统自动批改           |
| true_false      | 判断题 | 系统自动批改           |
| blank           | 填空题 | 系统自动批改 / AI 辅助 |
| short_answer    | 简答题 | AI 辅助批改            |

编程题预留：

| question_type | 含义   | 批改方式         |
| ------------- | ------ | ---------------- |
| programming   | 编程题 | 在线判题接口预留 |



------



## 12.2 创建题目

POST /api/questions

权限：teacher / admin

### 请求参数

{
 "course_id": 1,
 "knowledge_point_id": 7,
 "question_type": "single_choice",
 "title": "PCA 的主要作用是什么？",
 "content": "PCA 在机器学习中主要用于什么？",
 "options": [
  {
   "option_key": "A",
   "option_content": "降维"
  },
  {
   "option_key": "B",
   "option_content": "分类"
  },
  {
   "option_key": "C",
   "option_content": "回归"
  },
  {
   "option_key": "D",
   "option_content": "聚类"
  }
 ],
 "correct_answer": "A",
 "analysis": "PCA 是常见的降维方法。",
 "difficulty_level": "basic",
 "score": 5
}



------



## 12.3 获取题目列表

GET /api/questions

权限：登录用户

### 查询参数

| 参数               | 类型   | 说明                  |
| ------------------ | ------ | --------------------- |
| course_id          | number | 课程 ID               |
| knowledge_point_id | number | 知识点 ID             |
| question_type      | string | 题目类型              |
| difficulty_level   | string | basic / medium / hard |
| keyword            | string | 搜索题干              |
| page               | number | 页码                  |
| page_size          | number | 每页数量              |



------



## 12.4 学生提交单题答案

POST /api/questions/:question_id/answer

权限：student

### 请求参数

{
 "answer_content": "A",
 "started_at": "2026-07-01 10:00:00",
 "submitted_at": "2026-07-01 10:01:00",
 "duration_seconds": 60,
 "viewed_analysis": **false**,
 "attempt_no": 1
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "answer_record_id": 1,
  "question_id": 1,
  "is_correct": **true**,
  "score": 5,
  "correct_answer": "A",
  "analysis": "PCA 是常见的降维方法。",
  "auto_added_wrong_book": **false**
 }
}



------



## 12.5 AI 批改简答题

POST /api/questions/:question_id/ai-grade

权限：teacher / student / 系统内部调用

### 请求参数

{
 "student_user_id": 1,
 "answer_record_id": 10,
 "answer_content": "PCA 是通过寻找数据方差最大的方向，把原始特征映射到低维空间。",
 "rubric": [
  "说明 PCA 是降维方法",
  "说明保留主要信息",
  "说明与方差最大方向有关"
 ]
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "answer_record_id": 10,
  "score": 8,
  "total_score": 10,
  "comment": "回答基本正确，说明了 PCA 的降维作用和方差最大方向，但对主成分含义解释不够完整。",
  "rubric_matched": ["说明 PCA 是降维方法", "说明与方差最大方向有关"],
  "rubric_missing": ["说明保留主要信息"],
  "is_ai_generated": **true**,
  "ai_provider": "dify",
  "model_name": "grading-workflow"
 }
}



------



## 12.6 编程题在线判题预留接口

POST /api/programming-submissions

权限：student

### 请求参数

{
 "question_id": 100,
 "language": "cpp",
 "source_code": "#include <iostream>\nusing namespace std;\nint main(){return 0;}"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "programming_submission_id": 1,
  "judge_status": "pending"
 }
}

### judge_status

pending
judging
accepted
wrong_answer
compile_error
runtime_error
time_limit_exceeded
memory_limit_exceeded
system_error



------



# 13. 错题本模块

## 13.1 错题生成规则

学生答错题目后，系统自动加入错题本。

学生可以：

1. 查看错题
2. 手动收藏题目
3. 撤销错题
4. 标记已掌握
5. 再次练习

## 13.2 获取错题本

GET /api/wrong-questions

权限：student

### 查询参数

| 参数               | 类型   | 说明                            |
| ------------------ | ------ | ------------------------------- |
| course_id          | number | 课程 ID                         |
| knowledge_point_id | number | 知识点 ID                       |
| status             | string | unresolved / mastered / removed |
| page               | number | 页码                            |
| page_size          | number | 每页数量                        |



------



## 13.3 手动收藏错题

POST /api/wrong-questions

权限：student

### 请求参数

{
 "question_id": 1,
 "source_type": "manual"
}



------



## 13.4 撤销错题

PUT /api/wrong-questions/:wrong_question_id/remove

权限：student

### 请求参数

{
 "remove_reason": "已经掌握"
}



------



# 14. 学习记录模块

## 14.1 记录知识点学习行为

POST /api/study-records

权限：student

### 请求参数

{
 "course_id": 1,
 "knowledge_point_id": 7,
 "resource_type": "video",
 "resource_id": 1,
 "action_type": "finish",
 "started_at": "2026-07-01 10:00:00",
 "finished_at": "2026-07-01 10:20:00",
 "duration_seconds": 1200,
 "progress_percent": 100
}

### action_type

| 值     | 含义     |
| ------ | -------- |
| start  | 开始学习 |
| view   | 查看     |
| pause  | 暂停     |
| finish | 完成     |
| review | 复习     |



------



## 14.2 获取学生学习记录

GET /api/study-records

权限：student / teacher / admin

### 查询参数

| 参数               | 类型   | 说明      |
| ------------------ | ------ | --------- |
| student_user_id    | number | 学生 ID   |
| course_id          | number | 课程 ID   |
| knowledge_point_id | number | 知识点 ID |
| start_date         | string | 开始日期  |
| end_date           | string | 结束日期  |



------



# 15. 学生画像模块

## 15.1 画像结构

学生个人能力画像包括三个一级维度：

学习能力
科研能力
竞赛能力

其中学习能力第一版重点计算：

学习进度
知识点掌握度
测试成绩
错题情况
学习活跃度
AI 问答情况

科研能力和竞赛能力第一版不做复杂计算，采用预留字段、教师评价、标签维护的方式。



------



## 15.2 获取学生个人画像

GET /api/student-profiles/:student_user_id/portrait

权限：student 本人 / teacher / admin

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "student_user_id": 1,
  "course_id": 1,
  "learning_ability": {
   "total_score": 82,
   "progress_score": 85,
   "mastery_score": 80,
   "test_score": 88,
   "wrong_question_score": 76,
   "activity_score": 90,
   "qa_score": 78
  },
  "research_ability": {
   "total_score": 70,
   "tags": ["资料整理", "问题发现"],
   "teacher_comment": "具备初步科研意识。"
  },
  "competition_ability": {
   "total_score": 75,
   "tags": ["算法基础", "项目实践"],
   "teacher_comment": "适合参与课程项目竞赛。"
  },
  "mastered_knowledge_points": [
   {
    "knowledge_point_id": 1,
    "knowledge_point_name": "监督学习",
    "mastery_score": 90,
    "mastery_level": "优秀"
   }
  ],
  "weak_knowledge_points": [
   {
    "knowledge_point_id": 7,
    "knowledge_point_name": "PCA 主成分分析",
    "mastery_score": 58,
    "mastery_level": "薄弱"
   }
  ],
  "updated_at": "2026-07-01 23:59:59"
 }
}



------



## 15.3 更新学生画像

POST /api/student-profiles/:student_user_id/refresh

权限：系统内部调用 / teacher / admin

### 请求参数

{
 "course_id": 1,
 "refresh_type": "realtime",
 "trigger_event": "answer_submit"
}

### refresh_type

realtime
daily
manual

### 说明

画像更新策略：

1. 学生每次答题后实时更新
2. 学生每次提问后实时更新
3. 学生每次学习知识点后实时更新
4. 每天定时生成统计快照

### 涉及数据表

student_portraits
student_portrait_snapshots
student_mastery_records
student_research_profiles
student_competition_profiles



------



# 16. 知识点掌握度模块

## 16.1 掌握度来源

掌握度由以下数据共同判断：

做题结果
提问内容
是否看完知识点讲解
老师手动标记
系统综合评分

## 16.2 掌握等级

| mastery_score | mastery_level |
| ------------- | ------------- |
| 0-59          | 薄弱          |
| 60-74         | 一般          |
| 75-89         | 良好          |
| 90-100        | 优秀          |



------



## 16.3 获取学生知识点掌握情况

GET /api/students/:student_user_id/mastery

权限：student 本人 / teacher / admin

### 查询参数

| 参数      | 类型   | 说明    |
| --------- | ------ | ------- |
| course_id | number | 课程 ID |

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": [
  {
   "knowledge_point_id": 7,
   "knowledge_point_name": "PCA 主成分分析",
   "mastery_score": 58,
   "mastery_level": "薄弱",
   "source_scores": {
    "quiz_score": 55,
    "question_score": 50,
    "study_progress_score": 70,
    "teacher_mark_score": **null**,
    "system_score": 58
   },
   "updated_at": "2026-07-01 20:00:00"
  }
 ]
}



------



## 16.4 教师手动标记掌握度

PUT /api/students/:student_user_id/mastery/:knowledge_point_id

权限：teacher / admin

### 请求参数

{
 "teacher_mark_score": 80,
 "teacher_mark_level": "良好",
 "teacher_comment": "学生已基本理解 PCA，但需要加强计算题练习。"
}



------



# 17. 个性化推荐模块

## 17.1 推荐内容

第一版固定返回五类：

推荐知识点
推荐习题
学习路线
视频讲解
复习计划

## 17.2 生成个性化推荐

POST /api/recommendations/generate

权限：student / teacher / admin

### 请求参数

{
 "student_user_id": 1,
 "course_id": 1,
 "recommend_type": "all"
}

### recommend_type

all
knowledge_point
question
learning_path
video
review_plan

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "student_user_id": 1,
  "course_id": 1,
  "recommend_knowledge_points": [
   {
    "knowledge_point_id": 7,
    "knowledge_point_name": "PCA 主成分分析",
    "reason": "该知识点掌握度较低，且近期提问频率较高。"
   }
  ],
  "recommend_questions": [
   {
    "question_id": 15,
    "title": "PCA 基础选择题",
    "difficulty_level": "basic",
    "reason": "适合巩固 PCA 基本概念。"
   }
  ],
  "learning_path": [
   {
    "step": 1,
    "knowledge_point_id": 7,
    "title": "理解 PCA 的基本思想"
   },
   {
    "step": 2,
    "knowledge_point_id": 7,
    "title": "完成 PCA 基础习题"
   }
  ],
  "recommend_videos": [
   {
    "video_id": 1,
    "title": "PCA 主成分分析通俗讲解",
    "source": "bilibili",
    "bvid": "BVxxxxxxx",
    "embed_url": "https://player.bilibili.com/player.html?bvid=BVxxxxxxx",
    "reason": "适合补充理解 PCA 降维原理。"
   }
  ],
  "review_plan": {
   "plan_title": "PCA 三日复习计划",
   "items": [
    {
     "day": 1,
     "content": "复习 PCA 基本概念"
    },
    {
     "day": 2,
     "content": "完成 PCA 习题"
    },
    {
     "day": 3,
     "content": "总结错题并再次测试"
    }
   ]
  }
 }
}

### 涉及数据表

recommendation_records
recommendation_items
learning_paths
review_plans
video_resources



------



# 18. 视频讲解模块

## 18.1 视频来源策略

第一版以 B 站视频为主：

AI 根据知识点检索相关 B 站视频
后端保存视频标题、bvid、嵌入地址、推荐理由
前端使用 iframe 将视频直接投放到网页中
不强制跳转到 B 站平台

后续预留自研视频生成接口。



------



## 18.2 检索视频讲解

POST /api/videos/search

权限：student / teacher / admin

### 请求参数

{
 "course_id": 1,
 "knowledge_point_id": 7,
 "keyword": "PCA 主成分分析",
 "source": "bilibili",
 "limit": 5
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": [
  {
   "video_id": 1,
   "title": "PCA 主成分分析通俗讲解",
   "source": "bilibili",
   "bvid": "BVxxxxxxx",
   "cover_url": "https://example.com/cover.jpg",
   "embed_url": "https://player.bilibili.com/player.html?bvid=BVxxxxxxx",
   "original_url": "https://www.bilibili.com/video/BVxxxxxxx",
   "duration_seconds": 600,
   "recommend_reason": "适合初学者理解 PCA 降维原理。"
  }
 ]
}



------



## 18.3 保存课程视频资源

POST /api/videos

权限：teacher / admin

### 请求参数

{
 "course_id": 1,
 "knowledge_point_id": 7,
 "title": "PCA 主成分分析通俗讲解",
 "source": "bilibili",
 "bvid": "BVxxxxxxx",
 "embed_url": "https://player.bilibili.com/player.html?bvid=BVxxxxxxx",
 "original_url": "https://www.bilibili.com/video/BVxxxxxxx"
}



------



## 18.4 自研视频生成任务预留

POST /api/video-generation/tasks

权限：teacher / admin

### 请求参数

{
 "course_id": 1,
 "knowledge_point_id": 7,
 "script_prompt": "生成一个 3 分钟 PCA 主成分分析讲解视频脚本。",
 "style": "course_explanation",
 "voice_type": "male"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "video_generation_task_id": 1,
  "status": "pending"
 }
}



------



# 19. 智能体模块

## 19.1 智能体类型

第一版智能体包括：

| agent_type                  | 中文名称         | 实现方式      |
| --------------------------- | ---------------- | ------------- |
| course_qa                   | 课程问答智能体   | Dify Chatflow |
| learning_analysis           | 学情分析智能体   | Dify Workflow |
| personalized_recommendation | 个性化推荐智能体 | Dify Workflow |
| question_generation         | 试题生成智能体   | Dify Workflow |
| document_summary            | 资料总结智能体   | Dify Workflow |

视频讲解智能体后续研发视频功能时再加入。



------



## 19.2 统一运行智能体

POST /api/agents/:agent_type/run

权限：登录用户

### 请求参数

{
 "course_id": 1,
 "student_user_id": 1,
 "inputs": {
  "query": "请根据我的学习情况推荐 PCA 的复习计划。"
 },
 "response_mode": "blocking"
}

### response_mode

blocking
streaming

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "agent_run_id": 1,
  "agent_type": "personalized_recommendation",
  "result": {
   "summary": "建议优先复习 PCA 降维原理，并完成基础习题。"
  },
  "is_ai_generated": **true**,
  "ai_provider": "dify",
  "dify_workflow_run_id": "workflow_run_xxx"
 }
}



------



## 19.3 Dify 配置字段预留

涉及表：

ai_agent_configs
ai_model_configs

核心字段：

agent_config_id
agent_type
agent_name
dify_base_url
dify_api_key_encrypted
dify_app_id
dify_workflow_id
dify_dataset_id
response_mode
enabled
created_at
updated_at



------



# 20. 试题生成智能体模块

## 20.1 AI 生成试题

POST /api/question-generation/generate

权限：teacher / admin

### 请求参数

{
 "course_id": 1,
 "knowledge_point_id": 7,
 "question_type": "single_choice",
 "difficulty_level": "basic",
 "count": 5,
 "requirements": "围绕 PCA 基本概念生成选择题。"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "generated_questions": [
   {
    "title": "PCA 的主要作用是什么？",
    "question_type": "single_choice",
    "options": [
     {
      "option_key": "A",
      "option_content": "降维"
     }
    ],
    "correct_answer": "A",
    "analysis": "PCA 是常见的降维方法。"
   }
  ],
  "is_ai_generated": **true**,
  "ai_provider": "dify"
 }
}



------



## 20.2 保存 AI 生成题目

POST /api/question-generation/save

权限：teacher / admin

### 请求参数

{
 "course_id": 1,
 "knowledge_point_id": 7,
 "questions": []
}



------



# 21. 资料总结智能体模块

## 21.1 生成资料总结

POST /api/document-summary/generate

权限：teacher / admin / 文档拥有者

### 请求参数

{
 "document_id": 1,
 "summary_type": "outline"
}

### summary_type

outline
key_points
teaching_summary
student_version

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "document_id": 1,
  "summary_type": "outline",
  "summary": "本文档主要介绍机器学习基本概念、监督学习和无监督学习……",
  "is_ai_generated": **true**,
  "ai_provider": "dify"
 }
}



------



# 22. 教师端数据可视化接口

## 22.1 教师端总览看板

GET /api/teacher/dashboard

权限：teacher / admin

### 查询参数

| 参数              | 类型   | 说明      |
| ----------------- | ------ | --------- |
| course_id         | number | 课程 ID   |
| teaching_class_id | number | 教学班 ID |

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "student_count": 45,
  "average_progress": 72,
  "average_mastery_score": 76,
  "average_test_score": 81,
  "ai_question_count": 320,
  "weak_knowledge_point_count": 5
 }
}



------



## 22.2 班级学习进度统计

GET /api/teacher/analytics/progress

权限：teacher / admin



------



## 22.3 知识点掌握热力图

GET /api/teacher/analytics/knowledge-heatmap

权限：teacher / admin

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": [
  {
   "student_user_id": 1,
   "real_name": "张三",
   "knowledge_point_id": 7,
   "knowledge_point_name": "PCA 主成分分析",
   "mastery_score": 58
  }
 ]
}



------



## 22.4 成绩分布

GET /api/teacher/analytics/score-distribution

权限：teacher / admin



------



## 22.5 高频提问统计

GET /api/teacher/analytics/question-frequency

权限：teacher / admin



------



## 22.6 薄弱知识点排行

GET /api/teacher/analytics/weak-knowledge-points

权限：teacher / admin



------



## 22.7 学生能力画像雷达图

GET /api/teacher/analytics/student-radar/:student_user_id

权限：teacher / admin



------



# 23. 学生端数据可视化接口

## 23.1 学生学习总览

GET /api/student/dashboard

权限：student

### 查询参数

| 参数      | 类型   | 说明    |
| --------- | ------ | ------- |
| course_id | number | 课程 ID |

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "learning_progress": 68,
  "mastered_count": 12,
  "unmastered_count": 5,
  "wrong_question_count": 18,
  "this_week_study_duration": 3600,
  "this_week_question_count": 22,
  "ai_question_count": 15,
  "average_score": 82
 }
}



------



## 23.2 我的学习进度折线图

GET /api/student/analytics/progress-trend

权限：student



------



## 23.3 我的知识点掌握雷达图

GET /api/student/analytics/mastery-radar

权限：student



------



## 23.4 我的错题类型统计

GET /api/student/analytics/wrong-question-types

权限：student



------



## 23.5 我的推荐学习路线图

GET /api/student/analytics/learning-path

权限：student



------



## 23.6 已掌握与未掌握知识点统计

GET /api/student/analytics/mastery-summary

权限：student



------



## 23.7 本周学习时长统计

GET /api/student/analytics/weekly-duration

权限：student



------



# 24. 管理员数据看板模块

## 24.1 管理员总览

GET /api/admin/dashboard

权限：admin

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "user_count": 120,
  "student_count": 100,
  "teacher_count": 15,
  "course_count": 6,
  "knowledge_document_count": 80,
  "ai_call_count_today": 500,
  "pending_review_document_count": 8
 }
}



------



# 25. AI 模型配置模块

## 25.1 创建 AI 模型配置

POST /api/admin/ai-model-configs

权限：admin

### 请求参数

{
 "provider": "dify",
 "model_name": "spark-lite",
 "base_url": "https://api.dify.ai/v1",
 "api_key": "sk-xxxx",
 "max_context_length": 8000,
 "temperature": 0.7,
 "enabled": **true**,
 "usage_type": "qa",
 "daily_call_limit": 10000,
 "single_user_daily_limit": 100,
 "token_budget": 1000000
}

### usage_type

qa
summary
question_generation
grading
recommendation
embedding

### 说明

API Key 入库前必须加密，不允许明文存储。



------



## 25.2 获取 AI 模型配置列表

GET /api/admin/ai-model-configs

权限：admin



------



## 25.3 查看 AI 调用日志

GET /api/admin/ai-call-logs

权限：admin

### 查询参数

| 参数       | 类型   | 说明             |
| ---------- | ------ | ---------------- |
| user_id    | number | 用户 ID          |
| provider   | string | 模型供应商       |
| usage_type | string | 调用用途         |
| status     | string | success / failed |
| start_date | string | 开始日期         |
| end_date   | string | 结束日期         |

### 返回字段

{
 "ai_call_log_id": 1,
 "user_id": 1,
 "provider": "dify",
 "model_name": "course-qa-agent",
 "usage_type": "qa",
 "prompt_tokens": 500,
 "completion_tokens": 800,
 "total_tokens": 1300,
 "status": "success",
 "response_time_ms": 1500,
 "error_message": **null**,
 "created_at": "2026-07-01 10:00:00"
}



------



# 26. 消息通知模块

## 26.1 通知类型

| notification_type | 含义           |
| ----------------- | -------------- |
| task_published    | 教师发布任务   |
| task_deadline     | 任务即将截止   |
| document_review   | 知识库审核结果 |
| document_parsed   | 知识库解析完成 |
| ai_grading_done   | AI 批改完成    |
| system_notice     | 系统通知       |



------



## 26.2 获取我的消息

GET /api/notifications

权限：登录用户

### 查询参数

| 参数              | 类型    | 说明     |
| ----------------- | ------- | -------- |
| is_read           | boolean | 是否已读 |
| notification_type | string  | 消息类型 |
| page              | number  | 页码     |
| page_size         | number  | 每页数量 |



------



## 26.3 标记消息已读

PUT /api/notifications/:notification_id/read

权限：通知所属用户



------



## 26.4 批量已读

PUT /api/notifications/read-all

权限：登录用户



------



# 27. 操作日志模块

## 27.1 获取操作日志

GET /api/admin/operation-logs

权限：admin

### 记录范围

管理员修改用户
教师发布任务
教师上传知识库
教师审核知识库
学生提交答案
学生上传资料
AI 调用失败
用户反馈问题

### 返回字段

{
 "operation_log_id": 1,
 "user_id": 2,
 "role": "teacher",
 "operation_type": "task_create",
 "operation_desc": "教师发布作业：PCA 基础练习",
 "target_type": "task",
 "target_id": 1,
 "ip_address": "127.0.0.1",
 "created_at": "2026-07-01 10:00:00"
}



------



# 28. 安全合规模块

## 28.1 AI 内容安全检查

POST /api/safety/check

权限：系统内部调用

### 请求参数

{
 "content": "用户输入或 AI 输出内容",
 "check_type": "ai_answer"
}

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "safe": **true**,
  "risk_level": "low",
  "risk_tags": [],
  "suggestion": "pass"
 }
}



------



## 28.2 用户反馈 AI 回答

POST /api/feedback/ai-answer

权限：登录用户

### 请求参数

{
 "message_id": 101,
 "feedback_type": "incorrect",
 "content": "这个回答没有解释清楚 PCA 的特征值作用。"
}

### feedback_type

incorrect
unclear
no_source
unsafe
helpful
other



------



## 28.3 获取 AI 免责声明配置

GET /api/safety/disclaimer

权限：登录用户

### 返回示例

{
 "code": 0,
 "message": "success",
 "data": {
  "content": "本系统 AI 生成内容仅作为学习辅助，重要结论请结合课程资料和教师意见判断。",
  "enabled": **true**
 }
}



------



# 29. Demo 种子数据设计

## 29.1 种子账号

admin_demo / 123456 / admin
teacher_demo / 123456 / teacher
student_demo / 123456 / student

## 29.2 种子课程

课程：机器学习
学科：计算机大类学科
学院：计算机与软件工程学院
行政班级：软件2403班
教学班级：机器学习1班

## 29.3 种子知识点

监督学习
无监督学习
线性回归
逻辑回归
决策树
K-means 聚类
PCA 主成分分析
SVM 支持向量机
神经网络基础
模型评估指标

## 29.4 种子演示数据

若干课程资料
若干知识点讲解
若干选择题、判断题、填空题、简答题
若干学生答题记录
若干错题记录
若干 AI 问答记录
若干知识点掌握度记录
若干个性化推荐结果
若干教师端可视化统计数据



------



# 30. 数据库表设计总览

后续数据库设计应与本接口文档字段保持一致。

## 30.1 用户与权限

users
user_profiles
admin_classes
login_logs

## 30.2 课程与班级

courses
chapters
knowledge_points
knowledge_point_aliases
teaching_classes
course_teacher_relations
student_course_enrollments

## 30.3 知识库

knowledge_bases
knowledge_documents
knowledge_document_chunks
knowledge_document_reviews

## 30.4 AI 问答与分析

chat_conversations
chat_messages
message_sources
student_question_records
question_analysis_records
question_keywords
question_confusion_tags
question_knowledge_point_mappings

## 30.5 题库、任务、答题

questions
question_options
learning_tasks
task_questions
task_knowledge_points
task_submissions
answer_records
ai_grading_records
programming_submissions
wrong_questions

## 30.6 学习记录与画像

study_records
student_mastery_records
student_portraits
student_portrait_snapshots
student_research_profiles
student_competition_profiles

## 30.7 推荐与视频

recommendation_records
recommendation_items
learning_paths
review_plans
video_resources
video_generation_tasks

## 30.8 智能体与模型

ai_model_configs
ai_agent_configs
ai_call_logs
agent_run_records

## 30.9 系统管理

notifications
operation_logs
feedback_records
safety_check_records
system_configs



------



# 31. 开发优先级

## 31.1 P0 必须完成

用户注册登录
JWT 鉴权
用户资料与头像
课程管理
行政班级与教学班级
章节与知识点
知识库上传与状态展示
AI 多轮问答
引用来源返回
学生提问关键词归一化
题库管理
在线答题
自动批改
AI 批改简答题
错题本
学习记录
学生画像基础
知识点掌握度
个性化推荐基础
教师端基础看板
学生端基础看板
Demo 种子数据

## 31.2 P1 重要功能

任务系统完整发布与提交
复习计划
B 站视频检索与嵌入
知识库审核
消息通知
教师端完整可视化
学生端完整可视化
操作日志
AI 调用日志
安全合规反馈
Dify 智能体统一运行接口
资料总结智能体
试题生成智能体

## 31.3 P2 扩展功能

个人临时知识库构建个人智能体
OCR 文件解析
编程题在线判题
自研视频生成
多模态问答
模型微调
更复杂的权限系统
科研能力画像自动计算
竞赛能力画像自动计算
更完整的数据治理与审计



------



# 32. 前后端开发建议

## 32.1 前端目录建议

src/
 api/
  auth.js
  users.js
  courses.js
  knowledge.js
  chat.js
  questions.js
  tasks.js
  portrait.js
  recommendations.js
  analytics.js
  admin.js
 views/
  login/
  student/
  teacher/
  admin/
 components/
  charts/
  upload/
  question/
  chat/

## 32.2 后端目录建议

backend/
 src/
  routes/
  controllers/
  services/
  middlewares/
  prisma/
  utils/
  dify/
  jobs/

## 32.3 关键中间件

auth_middleware：JWT 鉴权
role_middleware：角色权限判断
upload_middleware：文件上传
error_middleware：统一错误处理
operation_log_middleware：操作日志
safety_middleware：安全检查



------



# 33. 接口文档后续维护规则

后续开发时必须遵守：

1. 新增接口必须同步更新接口文档
2. 修改字段名必须同步修改数据库设计
3. 接口字段、Prisma 字段、MySQL 字段尽量保持一致
4. AI 相关接口必须返回 is_ai_generated
5. RAG 问答接口必须尽量返回 sources
6. 教师端统计数据必须能追溯到学生行为记录
7. 学生画像不能只写死，要能由答题、提问、学习记录更新
8. Demo 数据必须服务于比赛演示