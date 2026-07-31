# DisciMind 在线 C/Python 编译器完整开发提示词

下面的提示词可以直接复制给 AI，用于继续开发、部署和演示。它已经按当前仓库的实际技术栈改写，不要求把 React/Express 项目重构为 Vue/FastAPI。

```text
你是 DisciMind 智能教育平台的资深全栈工程师。请在现有项目内增量开发学生端“在线编译器”，禁止重构现有项目，禁止替换现有 React 19 + Vite、Express 5、Prisma 7、MySQL 技术栈。当前开发分支是 dev，完成后只提交代码和验证结果，不执行 dev 合并 main；最终部署由 main 分支执行。

一、任务目标
开发在线代码编辑、C/Python 编译运行、编译或语法错误展示、编程习题样例判题、编译历史和简易调试功能。优先保证大二学科竞赛演示稳定、低配阿里云 ECS Ubuntu 22.04 可部署。复杂 gdb 断点调试只标记二期，不实现远程断点；Java 在 2GB 服务器上不纳入一期。

二、不可违反的架构与安全约束
1. 浏览器只能请求 DisciMind Express 后端的 /api/compiler/*，禁止直接调用 Judge0。
2. 后端只能调用本机 Judge0：JUDGE0_BASE_URL=http://127.0.0.1:2358；禁止服务器直接执行 gcc、shell、exec 用户源码。
3. Judge0 端口只绑定 127.0.0.1，ECS 安全组和 UFW 禁止开放 2358，只开放 22、80、443。
4. 每次运行设置 CPU 1~3 秒、wall time 2~6 秒、内存不超过 128MB、最大进程/线程数 30、文件大小 1MB、关闭网络。
5. 所有接口使用现有 JWT auth.middleware，用户 id 必须来自 req.user.user_id，不信任 body.user_id。只允许 student 角色。
6. 编译和判题接口按用户限流，默认每分钟 12 次；源码最多 100000 字符，stdin 最多 32768 字符，测试样例最多 20 组。

三、前端实现
1. 在学生侧边栏增加一级“在线编译器”，路由为 #/student/compiler。
2. 课程详情和学习流页面提供进入在线编译器的快捷入口；编译器页面组件可被自由模式和习题模式复用。
3. 自由模式：切换 C/Python、编辑源码、填写自定义 stdin、编译运行、查看 stdout/stderr/错误、清空代码、载入带示例输入的模板、查看历史。
4. 习题模式：通过 ?topicId=xxx 加载 question_type=programming 的题目描述和 correct_answer.testCases；按钮变为“提交判题”，循环运行全部样例并展示每组通过/答案错误/超时/运行异常。
5. 编辑器使用本地 monaco-editor，只加载编辑核心、C/Python 语言贡献和专用 Web Worker，关闭 minimap，automaticLayout=true；运行时模块加载失败则保留 textarea 降级，不能让页面白屏。
6. 统一使用现有请求封装和 token，不在页面内硬编码 API host。历史点击后回填 source_code。
7. 保持 DisciMind 现有青绿色、浅色、紧凑工作台风格。代码区在左，控制台在下，历史和操作区在右；移动端改为上下布局。

四、后端接口
POST /api/compiler/run
请求：{ sourceCode, language:'c'|'python', stdin:'', topicId?:number }
逻辑：校验参数和可选题目权限，调用本机 Judge0，返回 status、statusCode、stdout、compileMessage、stderr、timeMs、memoryKb、recordId。

POST /api/compiler/judge
请求：{ sourceCode, language:'c'|'python', topicId:number }
逻辑：查询题目，要求 question_type=PROGRAMMING 且学生已选修该课程；从 correct_answer.testCases/test_cases/samples 读取 input 和 expectedOutput；逐组调用 Judge0；输出规范化后比较（统一换行、去除每行尾部空格、去除首尾空白）；返回每组 verdict 和总通过数。

GET /api/compiler/history?topicId=&page=1&pageSize=20
只返回当前用户记录，按 create_time desc、id desc；历史点击回填源码。

GET /api/compiler/topics/:topicId
只返回当前学生有权访问的 programming 题目、描述、难度和测试样例。

五、数据库
新增 compile_record：
id 自增主键；user_id 外键 users.user_id；topic_id 可空外键 questions.question_id；language VARCHAR(16) 默认 c；source_code LONGTEXT；compile_msg LONGTEXT；run_output LONGTEXT；status TINYINT（0 编译失败、1 正常、2 超时、3 运行异常）；create_time 默认当前时间。
为 user_id/create_time、user_id/topic_id/create_time 和 user_id/language/create_time 建索引。新增 Prisma model、migration 和可直接执行的 MySQL SQL。不要修改已有 ProgrammingSubmission 语义。

六、Judge0 部署
Ubuntu 22.04 安装 Docker、Compose、MySQL8、Nginx 和 Node.js。使用 Judge0 CE 1.13.1 compose，合并以下配置：server 端口 127.0.0.1:2358:2358、ENABLE_NETWORK=false、CPU_TIME_LIMIT=2、WALL_TIME_LIMIT=4、MEMORY_LIMIT=131072、MAX_PROCESSES_AND_OR_THREADS=30、MAX_FILE_SIZE=1024、COUNT=1。启动后 curl http://127.0.0.1:2358/languages 校验 C (GCC) 与 Python 3 的 language id，分别写入 JUDGE0_C_LANGUAGE_ID 和 JUDGE0_PYTHON_LANGUAGE_ID。

七、Express 与 Nginx
在 backend/src/modules/compiler 下放 schemas、judge0.service、compiler.service、controller、routes，并在 src/app.js 挂载 /api/compiler。复用现有 response.js、auth.middleware、rate-limit.middleware。Nginx 静态页面 try_files 到 index.html，/api/ 反代 127.0.0.1:3000；不要添加 Judge0 反代。

八、验收流程
1. Prisma validate、Prisma generate、migration status。
2. 后端单测：输出成功、编译错误、超时分类；判题标准化比较；越权题目拒绝；限流返回 42901。
3. 前端 lint/typecheck/build；产物包含 Monaco editor worker、C 与 Python 语言包，运行时加载失败时 textarea 降级可操作。
4. 分别运行正确 C/Python 程序、语法错误、死循环、段错误或 Python 异常；检查控制台信息以及 compile_record 的语言和状态持久化。
5. 习题配置两组样例，验证全通过、部分错误、超时、编译失败四种状态。
6. 部署验证：浏览器只能访问 /api/compiler，公网访问 2358 失败；Nginx HTTPS、Node 监听 127.0.0.1；最后才在主机上将 dev 合并 main 并发布。
```
