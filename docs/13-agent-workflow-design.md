# 自定义学习工作流 Agent 协作系统 - 完整设计文档

> 本文档为落地开发级别的详细设计，不考虑开发周期，只追求最佳效果。
> 所有设计基于现有代码基础，不做无意义的从零重构。

---

## 1. 设计理念

### 1.1 核心洞察

传统 AI 学习助手的根本问题：一个模型回答所有问题，缺乏教学深度。

本系统的核心差异化：

- **不是让 AI 回答你的问题，而是让 AI 理解你的思维。**
- **不是单个 AI 在教，而是三个 AI 专家在协作教学。**

### 1.2 设计哲学：三个"教学人格"

每个 Agent 是一个拥有教育理念和多重策略的"数字专家"，而不仅仅是一个功能接口。

| Agent | 一句话定位 | 核心超能力 | 内部策略数 |
|-------|-----------|-----------|-----------|
| 讲解者 (The Explainer) | 不止讲解，而是择法而教 | 根据学生认知状态自动切换教学策略 | 4 种教法 |
| 训练师 (The Trainer) | 不止出题，而是以题读心 | 通过题目作为探测器，识别思维裂缝 | 3 种模式 |
| 诊断师 (The Diagnostician) | 不止分析，而是暗中调度 | 构建心智模型，协调其他 Agent 的协作策略 | 3 种能力 |

### 1.3 与现有系统的关系

本设计在以下现有基础上构建：

- DeepSeek AI 对话服务 (`backend/src/services/ai-chat.service.js`)：已支持多模式对话，可直接复用为 Agent 的 LLM 调用基础
- 学生画像 (`StudentPortrait`) 和掌握度 (`StudentMasteryRecord`)：诊断师的数据来源
- 题库 (`QuestionBank`, `Question`) 和练习会话 (`PracticeSession`)：训练师的操作对象
- 知识库管道 (`KnowledgeBase`, `KnowledgeDocument`, `KnowledgeDocumentChunk`)：讲解者的知识来源
- Dify 模块骨架 (`backend/src/modules/dify/`)：在此之上实现 Dify API 封装
- Agent 模块骨架 (`backend/src/modules/agent/`)：在此之上实现 Agent 调度引擎
- 前端 Agent 页面 (`AgentMarketPage`, `AgentDetailPage`, `MyAgentsPage`)：可改造为工作流管理页面
- 前端组件 (`AgentCard`, `AgentTag`, `AgentTypeBadge`)：复用为工作流阶段展示组件
- LearningPath 和 LearningPathStep 数据模型：扩展为工作流配置存储

---

## 2. Agent 详细设计

### 2.1 讲解者 (The Explainer)

**定位**：负责所有"输入型学习"——把知识讲清楚、演示明白、总结到位。

**Dify 实现形式**：Chatflow（需要流式对话能力，支持上下文记忆）

**四种教学策略**：

#### 策略 1：直授式 (Direct Instruction)

- **触发条件**：学生对该知识点完全陌生，诊断师标记 `exposure_level = "new"`
- **执行流程**：
  1. 前置知识激活：简要回顾与本知识点相关的前置知识
  2. 概念定义：用精炼语言定义核心概念
  3. 原理展开：逐步深入原理层面
  4. 典型例子：给出 1-2 个标准示例
  5. 边界澄清：指出常见误解和概念边界
  6. 关键要点总结：3-5 条核心 takeaways
- **输出格式**：
```json
{
  "strategy": "direct_instruction",
  "sections": [
    {"type": "prerequisite_bridge", "content": "..."},
    {"type": "core_definition", "content": "..."},
    {"type": "deep_dive", "content": "..."},
    {"type": "example", "content": "..."},
    {"type": "misconception_guard", "content": "..."},
    {"type": "key_takeaways", "content": ["...", "...", "..."]}
  ],
  "estimated_reading_time_minutes": 5
}
```

#### 策略 2：苏格拉底式 (Socratic Dialogue)

- **触发条件**：学生有一定基础但理解不深，诊断师标记 `understanding_depth = "shallow"`
- **执行流程**：
  1. 抛出引导性问题，让学生先给出自己的理解
  2. 针对学生回答中的漏洞追问
  3. 通过连续追问引导学生自己发现正确答案
  4. 最终揭示完整概念，并指出"这就是你刚才推导出来的"
- **关键约束**：每次只问一个问题，等待学生回答后再追问，最多追问 3 轮
- **输出格式**：
```json
{
  "strategy": "socratic_dialogue",
  "rounds": [
    {"round": 1, "question": "...", "target_hole": "..."},
    {"round": 2, "question": "...", "target_hole": "..."},
    {"round": 3, "question": "...", "target_hole": "..."}
  ],
  "final_revelation": "..."
}
```

#### 策略 3：类比式 (Analogy Bridge)

- **触发条件**：概念高度抽象，或诊断师标记 `learning_style = "visual"` / 学生对此类概念有前科困难
- **执行流程**：
  1. 选择学生熟悉的领域作为类比源（优先使用学生画像中的兴趣标签）
  2. 建立类比映射表：源概念 -> 目标概念
  3. 用类比解释核心原理
  4. 明确指出类比的边界（哪些地方类比不适用，防止过度推广）
  5. 从类比过渡到正式概念
- **输出格式**：
```json
{
  "strategy": "analogy_bridge",
  "source_domain": "...",
  "mapping": [
    {"source": "...", "target": "...", "explanation": "..."}
  ],
  "boundary_warning": "...",
  "formal_definition": "..."
}
```

#### 策略 4：纠错式 (Misconception Confrontation)

- **触发条件**：诊断师检测到学生存在典型误解，标记 `detected_misconceptions = [...]`
- **执行流程**：
  1. 展示一个包含典型错误的推理过程（不告诉学生这是错的）
  2. 询问学生"你觉得这个推理有问题吗？"
  3. 如果学生没发现，揭示矛盾点
  4. 解释错误根因
  5. 给出正确模型，对比错误模型
- **输出格式**：
```json
{
  "strategy": "misconception_confrontation",
  "trap_scenario": "...",
  "hidden_contradiction": "...",
  "root_cause": "...",
  "correct_model": "...",
  "contrast_table": [
    {"wrong_view": "...", "correct_view": "..."}
  ]
}
```

#### 讲解者的 Dify Chatflow 结构

```
[用户输入] 
    │
    ▼
[上下文装配节点]
  - 接收：知识点 ID、学生画像摘要、诊断师策略建议
  - 输出：装配完成的上下文对象
    │
    ▼
[策略路由节点]
  - 根据 strategy_hint 字段选择分支
  - 分支：direct | socratic | analogy | misconception
    │
    ├──> [直授式 Prompt 模板] ──> [LLM 节点] ──┐
    ├──> [苏格拉底式 Prompt 模板] ──> [LLM 节点] ──┤
    ├──> [类比式 Prompt 模板] ──> [LLM 节点] ─────┤
    └──> [纠错式 Prompt 模板] ──> [LLM 节点] ──────┘
                                                    │
                                                    ▼
                                            [格式化输出节点]
                                              - 统一输出 JSON 结构
                                              - 附加 strategy_used 字段
```

#### 复用场景

| 场景 | 调用方式 | 策略偏好 |
|------|---------|---------|
| AI 对话页 - 学生主动提问 | Chatflow 流式对话 | 自动判断 |
| 课程详情页 - 知识点讲解 | API 调用，一次性返回 | 优先直授式 |
| 工作流 - 概念学习阶段 | Workflow 模式调用 | 由诊断师指定 |
| 错题本 - 同类题演示 | API 调用 | 纠错式 |
| 学习总结 | API 调用 | 直授式（总结模板） |

---

### 2.2 训练师 (The Trainer)

**定位**：负责所有"输出型学习"——出题、批改、诊断错因。通过题目作为探测器，识别学生的思维裂缝。

**Dify 实现形式**：Workflow（需要结构化输入输出，不需要流式对话）

**三种工作模式**：

#### 模式 1：诊断性前测 (Diagnostic Pre-test)

- **触发时机**：学生开始学习一个新知识点时
- **核心逻辑**：不随机出题，而是为知识点的每个典型易错点分别生成一道"探测题"。每道题的设计目标是：如果学生做错，就能精确定位到对应的思维问题。
- **输入**：
```json
{
  "mode": "diagnostic_pre_test",
  "knowledge_point": {
    "id": "kp_xxx",
    "name": "二叉树中序遍历",
    "parent_kp": "二叉树遍历",
    "common_pitfalls": [
      {"id": "pitfall_1", "description": "混淆递归调用顺序", "difficulty": "medium"},
      {"id": "pitfall_2", "description": "忘记根节点访问时机", "difficulty": "basic"},
      {"id": "pitfall_3", "description": "无法处理空子树情况", "difficulty": "medium"}
    ]
  },
  "student_level": "intermediate",
  "question_count": 3
}
```
- **输出**：
```json
{
  "mode": "diagnostic_pre_test",
  "questions": [
    {
      "id": "q_001",
      "type": "single_choice",
      "stem": "给定二叉树 [A,B,C,D,null,E,F,null,null,null,G]，中序遍历的结果是？",
      "options": [
        {"key": "A", "content": "D-B-G-E-A-F-C", "is_correct": true},
        {"key": "B", "content": "A-B-D-E-G-C-F", "is_correct": false},
        {"key": "C", "content": "D-B-E-G-F-C-A", "is_correct": false},
        {"key": "D", "content": "D-E-G-B-F-C-A", "is_correct": false}
      ],
      "target_pitfall": "pitfall_1",
      "distractor_analysis": {
        "B": "先序遍历的结果，学生混淆了遍历顺序",
        "C": "后序遍历的结果，学生完全搞反了",
        "D": "左子树内部顺序混乱，学生对递归嵌套理解不足"
      },
      "difficulty": "medium",
      "estimated_time_seconds": 120
    }
  ],
  "coverage_report": {
    "total_pitfalls": 3,
    "covered_pitfalls": 3,
    "uncovered_pitfalls": []
  }
}
```

#### 模式 2：自适应训练 (Adaptive Training)

- **触发时机**：学生进入练习阶段，已完成诊断性前测（或跳过）
- **核心逻辑**：根据学生在上一题的表现（正误 + 耗时 + 信心指数），动态决定下一题的难度和方向。这不是简单的"做对升级做错降级"，而是"做错了要深挖同一易错点的变式题，做对了要确认是否真正理解"。
- **自适应规则**：
  - 答对 + 耗时短 + 信心高：跳过同类题，提升难度
  - 答对 + 耗时长 + 信心低：出一道变式题确认是否真正掌握
  - 答错 + 错因明确：出同一易错点的变式题，降低表述复杂度
  - 答错 + 错因不明：回溯到更基础的知识点，出诊断题
- **输入**：
```json
{
  "mode": "adaptive_training",
  "current_question": {...},
  "student_answer": {
    "selected_option": "B",
    "time_spent_seconds": 45,
    "confidence_level": "high"
  },
  "evaluation_result": {
    "is_correct": false,
    "error_type": "concept_confusion",
    "misconception_id": "pitfall_1"
  },
  "session_history": [...]
}
```
- **输出**：
```json
{
  "mode": "adaptive_training",
  "decision": {
    "action": "variant_pursuit",
    "reason": "学生答错且错因明确(pitfall_1)，出一道变式题确认理解"
  },
  "next_question": {...},
  "session_progress": {
    "completed": 3,
    "correct": 1,
    "current_difficulty": "basic"
  }
}
```

#### 模式 3：深度批改 (Deep Evaluation)

- **触发时机**：学生提交答案后
- **核心逻辑**：不只判对错，而是从学生的错误答案中逆向推断其思维过程，给出诊断性反馈
- **错误类型分类体系**：

| 错误类型 | 代码 | 说明 | 典型表现 |
|---------|------|------|---------|
| 概念混淆 | concept_confusion | 把 A 概念和 B 概念搞混 | 答案符合另一个概念的逻辑 |
| 规则遗忘 | rule_forgetting | 忘记或记错关键规则 | 缺少关键步骤 |
| 递归断裂 | recursion_break | 多层嵌套中某层丢失规则 | 部分正确但深层错误 |
| 计算失误 | calculation_error | 知道怎么做但算错了 | 思路对结果错 |
| 审题偏差 | misreading | 没注意到题目的关键条件 | 忽略约束条件 |
| 思路正确但卡住 | stuck | 知道方向但推不下去 | 空白或中途放弃 |

- **输入**：
```json
{
  "mode": "deep_evaluation",
  "question": {...},
  "student_answer": {...},
  "standard_answer": {...}
}
```
- **输出**：
```json
{
  "mode": "deep_evaluation",
  "verdict": "incorrect",
  "error_type": "recursion_break",
  "error_analysis": {
    "what_student_did": "你先把左子树所有节点排了序(B在E前)，然后处理根节点，最后处理右子树",
    "what_should_happen": "中序遍历要求对每个子树都递归应用'左-根-右'规则。你的左子树内部(B的左右孩子D和E)也应该按'左-根-右'处理",
    "root_cause": "不是不理解中序遍历，而是在递归嵌套时'规则丢失'——你把B的左孩子D和右孩子E拆开来在不同层级处理了",
    "mental_model_gap": "对'递归'的理解停留在'先处理左边再处理右边'的直觉层面，没有建立'每层独立应用相同规则'的心智模型"
  },
  "remediation": {
    "immediate_action": "做一个更简单的嵌套练习验证递归理解",
    "explainer_hint": "建议讲解者用'俄罗斯套娃'类比重新解释递归调用栈",
    "follow_up_question_id": "q_004"
  }
}
```

#### 训练师的 Dify Workflow 结构

```
[输入: mode + 参数]
    │
    ▼
[模式路由]
    │
    ├──> mode == "diagnostic_pre_test"
    │      │
    │      ▼
    │    [易错点分析 LLM] ──> 提取知识点的 3-5 个典型易错点
    │      │
    │      ▼
    │    [探测题生成 LLM] ──> 为每个易错点生成 1 道探测题（附干扰项分析）
    │      │
    │      ▼
    │    [格式化代码节点] ──> 组装为统一输出 JSON
    │
    ├──> mode == "adaptive_training"
    │      │
    │      ▼
    │    [自适应决策代码节点]
    │      - 根据学生表现执行自适应规则
    │      - 输出：action + target_pitfall + difficulty
    │      │
    │      ▼
    │    [题目生成 LLM] ──> 根据决策结果生成下一题
    │      │
    │      ▼
    │    [格式化代码节点]
    │
    └──> mode == "deep_evaluation"
           │
           ▼
         [诊断 LLM]
           - 对比学生答案、标准答案、题目结构
           - 输出：错误类型、根因分析、补救建议
           │
           ▼
         [格式化代码节点]

[最终输出] ──> 统一 JSON 结构，附加 mode 和 timestamp
```

#### 复用场景

| 场景 | 模式 | 调用方式 |
|------|------|---------|
| 学习中心 - AI 生成练习 | diagnostic_pre_test / adaptive_training | 独立 API 调用 |
| 学习中心 - 提交批改 | deep_evaluation | 独立 API 调用 |
| 工作流 - 诊断前测阶段 | diagnostic_pre_test | 通过编排引擎调用 |
| 工作流 - 练习阶段 | adaptive_training | 通过编排引擎循环调用 |
| 工作流 - 批改阶段 | deep_evaluation | 通过编排引擎调用 |
| 错题本 - 同类题巩固 | adaptive_training (target_pitfall 模式) | 独立 API 调用 |

---

### 2.3 诊断师 (The Diagnostician)

**定位**：系统的"元认知层"——构建学生的心智模型，协调讲解者和训练师的协作策略。学生看不见它，但能感受到它的存在。

**Dify 实现形式**：Workflow + 后端代码节点（需要后端做数据聚合，Dify 做语义分析和策略生成）

**三种核心能力**：

#### 能力 1：心智建模 (Mental Model Construction)

- **触发时机**：每次学习活动后异步更新，关键节点（工作流阶段切换时）同步查询
- **建模维度**：

| 维度 | 字段 | 数据来源 | 更新频率 |
|------|------|---------|---------|
| 知识点掌握度 | mastery_map: {kp_id: 0-100} | StudentMasteryRecord | 每次作答后 |
| 学习风格偏好 | learning_style: string | 行为模式分析 | 每周更新 |
| 典型易错模式 | error_patterns: [...] | 训练师批改记录聚合 | 每次批改后 |
| 认知速度 | cognitive_speed: {fast/medium/slow} | 作答耗时统计 | 每周更新 |
| 信心校准 | confidence_calibration: {over/under/accurate} | 自评信心 vs 实际正确率 | 每周更新 |
| 注意力特征 | attention_profile: {sustained/declining/volatile} | 练习会话中的表现趋势 | 每次会话后 |
| 类比响应度 | analogy_responsiveness: 0-1 | 类比式教学后的掌握度提升幅度 | 每次类比教学后 |
| 知识依赖图状态 | dependency_graph_status: {kp_id: {prerequisite_status, downstream_impact}} | 知识点间的前置依赖关系 | 实时 |

- **输出（心智模型摘要）**：
```json
{
  "student_id": "stu_xxx",
  "knowledge_point_id": "kp_binary_tree_inorder",
  "mental_model_summary": {
    "mastery_level": 45,
    "confidence_level": "overconfident",
    "exposure_level": "familiar_but_shallow",
    "detected_misconceptions": [
      {"id": "miscon_1", "description": "将递归理解为'先左后右'的直觉而非'每层独立应用规则'", "severity": "critical"}
    ],
    "learning_style_indicators": {
      "preferred_modality": "visual",
      "analogy_responsive": true,
      "socratic_tolerance": "low"
    },
    "cognitive_load_estimate": "moderate",
    "recommended_strategies": [
      {"agent": "explainer", "strategy": "analogy_bridge", "priority": 1},
      {"agent": "explainer", "strategy": "misconception_confrontation", "priority": 2}
    ]
  }
}
```

#### 能力 2：策略干预 (Strategy Intervention)

- **触发时机**：工作流阶段切换时、训练师检测到连续错误时、学生主动请求帮助时
- **核心逻辑**：诊断师不直接面向学生，而是向讲解者和训练师发送"策略指令"
- **干预类型**：

| 干预类型 | 触发条件 | 发出的指令 |
|---------|---------|-----------|
| 切换教法 | 当前教法下学生连续 2 次回答错误 | 告知讲解者切换到备选策略 |
| 降低难度 | 学生连续 3 题答错 | 告知训练师降级到基础难度，聚焦单一易错点 |
| 插入诊断 | 学生作答模式异常（全对但耗时极长/全错但信心极高） | 告知训练师插入诊断性题目 |
| 强制休息 | 注意力曲线持续下降 | 建议前端弹出休息提示 |
| 推荐跳过 | 学生明显已掌握当前知识点 | 建议跳过剩余练习，进入下一阶段 |

- **策略指令格式**：
```json
{
  "intervention_id": "int_xxx",
  "timestamp": "2026-07-07T10:30:00Z",
  "trigger": "连续 3 次 recursion_break 类型错误",
  "target_agent": "trainer",
  "instruction": {
    "action": "reduce_difficulty_and_focus",
    "params": {
      "difficulty": "basic",
      "focus_pitfall": "pitfall_1",
      "max_questions": 3
    }
  },
  "parallel_instruction_to_explainer": {
    "action": "switch_strategy",
    "params": {
      "strategy": "analogy_bridge",
      "analogy_topic": "俄罗斯套娃与函数调用栈"
    }
  },
  "reasoning": "学生不是不理解中序遍历规则，而是无法追踪多层递归调用。需要先修复'递归心智模型'，再回来做遍历题。"
}
```

#### 能力 3：成长追踪 (Growth Tracking)

- **触发时机**：每次学习工作流结束后
- **核心逻辑**：不只记录分数变化，而是生成有叙事感的成长报告
- **追踪维度**：
  - 知识点掌握度的时序变化曲线
  - 错误类型的演化（从 concept_confusion 到 calculation_error 意味着理解在加深）
  - 学习策略的有效性评分（哪种教法对学生最有效）
  - 跨知识点的迁移能力（学完 A 后对相关知识点 B 的掌握速度是否变快）

- **输出（成长报告）**：
```json
{
  "student_id": "stu_xxx",
  "report_period": {"from": "2026-07-01", "to": "2026-07-07"},
  "knowledge_growth": [
    {"kp": "二叉树遍历", "before": 32, "after": 78, "delta": 46}
  ],
  "error_evolution": {
    "previously_dominant": "concept_confusion",
    "currently_dominant": "calculation_error",
    "interpretation": "学生正在从'不理解概念'向'理解概念但执行不熟练'阶段过渡，这是正常的学习进展。"
  },
  "effective_strategies": [
    {"strategy": "analogy_bridge", "effectiveness_score": 0.85, "sample_size": 3}
  ],
  "transfer_indicators": {
    "prerequisite_gain_boosted_downstream": true,
    "detail": "掌握二叉树遍历后，二叉搜索树的学习速度比预期快40%"
  },
  "narrative_summary": "本周你从'不理解递归'到'能用递归正确遍历二叉树'，进步显著。你的学习风格偏向于先从直观类比建立感觉，再深入形式化定义——后续建议继续保持这个节奏。"
}
```

#### 诊断师的 Dify Workflow 结构

诊断师的特殊性：它的很多计算逻辑需要访问数据库（掌握度表、作答记录表等），因此分为"后端预处理 + Dify 语义分析"两层。

```
[后端预处理层] (在 DisciMind 后端的 diagnostician.service.js 中)
    │
    ├── 从 StudentMasteryRecord 聚合掌握度数据
    ├── 从 AnswerRecord 聚合作答历史
    ├── 从 PracticeSession 聚合练习会话行为数据
    ├── 计算统计指标（正确率趋势、耗时分布、错误类型分布）
    └── 输出：预处理数据包
         │
         ▼
[Dify Workflow 层]
    │
    ├── [心智建模 LLM]
    │     - 输入：预处理数据包
    │     - 输出：心智模型摘要（JSON 结构化）
    │
    ├── [策略判断代码节点]
    │     - 输入：心智模型 + 当前状态
    │     - 根据预设规则生成策略指令
    │     - 输出：干预指令列表
    │
    └── [成长报告 LLM]
          - 输入：历史数据对比 + 心智模型
          - 输出：叙事性成长报告
```

#### 与其他 Agent 的通信机制

诊断师通过后端数据库的 `AgentRunRecord` 表与其他 Agent 通信，而非直接调用：

```
训练师完成批改
    │
    ▼
后端写入 AgentRunRecord:
  { agent: "trainer", mode: "deep_evaluation", result: {...}, anomaly_flag: "recursion_break_consecutive_3" }
    │
    ▼
编排引擎检测到 anomaly_flag
    │
    ▼
编排引擎调用诊断师:
  POST /internal/diagnostician/intervene
  { student_id, session_id, anomaly_flag }
    │
    ▼
诊断师返回策略指令:
  { target: "explainer", action: "switch_to_analogy", params: {...} }
    │
    ▼
编排引擎在下一阶段调用讲解者时，附加策略指令作为输入参数
```

---

## 3. Agent 协作架构

### 3.1 协作全景图

```
                        +------------------+
                        |   诊断师          |
                        |   (后台大脑)       |
                        |   心智建模        |
                        |   策略干预        |
                        |   成长追踪        |
                        +--------+---------+
                                 |
                    策略指令      |      策略指令
                   (择法而教)     |     (自适应方向)
                                 |
              +------------------+------------------+
              |                  |                  |
              v                  |                  v
    +-------------+              |        +-------------+
    |   讲解者     |<---- 信息共享 ---->|   训练师     |
    |   (前台)    |              |        |   (前台)    |
    |   直授式     |              |        |   诊断性前测  |
    |   苏格拉底式 |              |        |   自适应训练  |
    |   类比式     |              |        |   深度批改    |
    |   纠错式     |              |        |             |
    +------+------+              |        +------+------+
           |                     |               |
           |                     |               |
           v                     v               v
    +--------------------------------------------------+
    |              学生交互界面                          |
    |  (AI 对话页 / 学习中心 / 课程详情 / 工作流执行器)     |
    +--------------------------------------------------+
```

### 3.2 协作流程示例

以下是一个完整的"以练带学"工作流中，三个 Agent 如何协作：

```
Step 1: 学生发起学习
  编排引擎 -> 诊断师: "学生 stu_xxx 开始学习二叉树遍历，请提供心智模型"
  诊断师 -> 编排引擎: { mastery: 32, misconceptions: [...], recommended: "先诊断前测" }

Step 2: 诊断性前测
  编排引擎 -> 训练师(mode=diagnostic_pre_test): { knowledge_point, pitfalls }
  训练师 -> 编排引擎: [3 道探测题]
  编排引擎 -> 前端: 展示题目
  (学生作答)

Step 3: 深度批改
  编排引擎 -> 训练师(mode=deep_evaluation): { questions, student_answers }
  训练师 -> 编排引擎: { 第1题正确, 第2题错误(recursion_break), 第3题错误(recursion_break) }
  编排引擎 -> 诊断师: "检测到连续 recursion_break，请求策略干预"

Step 4: 策略干预
  诊断师 -> 编排引擎: {
    给训练师: "降低难度，聚焦 recursion 基本概念验证",
    给讲解者: "切换到类比式教学，用俄罗斯套娃解释递归调用栈"
  }

Step 5: 概念补救（讲解者按诊断师指令执行）
  编排引擎 -> 讲解者(strategy=analogy_bridge): { topic: "递归调用栈", analogy: "俄罗斯套娃" }
  讲解者 -> 编排引擎 -> 前端: (类比式教学内容)

Step 6: 变式验证
  编排引擎 -> 训练师(mode=adaptive_training, target_pitfall=recursion): ...
  训练师 -> 编排引擎: [新的验证题]
  (学生作答，这次正确)

Step 7: 知识诊断更新
  编排引擎 -> 诊断师(mode=update_model): { 新一轮作答结果 }
  诊断师 -> 编排引擎: { mastery 更新为 68, misconception 从 critical 降为 minor }

Step 8: 学习总结
  编排引擎 -> 讲解者(strategy=direct_instruction, mode=summary): { 本轮全部交互记录 }
  讲解者 -> 编排引擎 -> 前端: (结构化学习报告)
```

---

## 4. 自定义学习工作流系统

### 4.1 工作流概念模型

学生通过组合"阶段积木块"来定义自己的学习路径。每个积木块对应一个 Agent 的某种模式。

```
阶段积木块（6 种）：

来自讲解者:
  [概念学习]    - 讲解者用指定策略讲解知识点
  [例题演示]    - 讲解者逐步演示解题思维链
  [学习总结]    - 讲解者生成本轮学习的结构化总结

来自训练师:
  [诊断前测]    - 训练师生成探测性题目，定位薄弱点
  [自适应训练]  - 训练师根据表现动态调整题目
  [深度批改]    - 训练师对作答进行诊断性分析

来自诊断师:
  [策略诊断]    - 诊断师分析当前状态，输出策略建议
                （通常不是学生手动拖入的，而是编排引擎自动插入）
```

### 4.2 预设工作流模板

系统提供三套精心设计的预设模板：

**模板 A：先学后练 (Learn-First)**

```
概念学习 -> 例题演示 -> 诊断前测 -> 自适应训练 -> 深度批改 -> 策略诊断 -> 学习总结
(讲解者)   (讲解者)   (训练师)   (训练师)     (训练师)   (诊断师)   (讲解者)
```

- 适合：系统型学习者，喜欢先建立知识框架
- 特点：稳扎稳打，覆盖完整学习闭环
- 策略诊断阶段为可选，若训练师未检测到异常则自动跳过

**模板 B：以练带学 (Practice-First)**

```
诊断前测 -> 深度批改 -> 概念学习(针对错题) -> 自适应训练 -> 策略诊断 -> 学习总结
(训练师)   (训练师)   (讲解者, 纠错模式)    (训练师)    (诊断师)   (讲解者)
```

- 适合：实践型学习者，喜欢从问题出发
- 特点：精准打击薄弱点，避免在已掌握内容上浪费时间
- 概念学习阶段自动使用纠错策略，聚焦错题涉及的知识点

**模板 C：精准突破 (Targeted)**

```
策略诊断 -> 概念学习(仅薄弱点) -> 自适应训练(聚焦模式) -> 深度批改 -> 学习总结
(诊断师)   (讲解者)              (训练师)              (训练师)   (讲解者)
```

- 适合：高效型学习者，复习/查漏补缺场景
- 特点：诊断先行，只学不会的，最短路径达成目标
- 依赖诊断师有足够的历史数据来精准定位薄弱点

### 4.3 工作流配置数据结构

```json
{
  "workflow_id": "wf_custom_001",
  "workflow_name": "我的数据结构学习流",
  "is_preset_template": false,
  "based_on_template": "learn_first",
  "student_id": "stu_xxx",
  "stages": [
    {
      "order": 1,
      "stage_type": "concept_learning",
      "agent": "explainer",
      "config": {
        "strategy_preference": "auto",
        "depth": "moderate",
        "include_prerequisites": true,
        "max_duration_minutes": 10
      },
      "input_mapping": {
        "knowledge_point_id": "$context.current_knowledge_point_id"
      },
      "output_key": "concept_learning_result"
    },
    {
      "order": 2,
      "stage_type": "diagnostic_pre_test",
      "agent": "trainer",
      "config": {
        "mode": "diagnostic_pre_test",
        "question_count": 3,
        "difficulty": "adaptive"
      },
      "input_mapping": {
        "knowledge_point": "$stage.concept_learning_result.knowledge_point",
        "student_level": "$context.student_profile.level"
      },
      "output_key": "pre_test_result"
    },
    {
      "order": 3,
      "stage_type": "adaptive_training",
      "agent": "trainer",
      "config": {
        "mode": "adaptive_training",
        "max_questions": 10,
        "exit_criteria": {
          "type": "mastery_threshold",
          "threshold": 80,
          "consecutive_correct": 3
        }
      },
      "input_mapping": {
        "knowledge_point": "$stage.concept_learning_result.knowledge_point",
        "diagnostic_result": "$stage.pre_test_result"
      },
      "output_key": "training_result",
      "loop": {
        "max_iterations": 10,
        "iteration_stage": "deep_evaluation",
        "condition": "$stage.training_result.exit_criteria_met != true"
      }
    },
    {
      "order": 4,
      "stage_type": "strategy_diagnosis",
      "agent": "diagnostician",
      "config": {
        "auto_intervene": true,
        "intervention_threshold": "consecutive_errors >= 2"
      },
      "input_mapping": {
        "session_data": "$context.all_stages"
      },
      "output_key": "diagnosis_result",
      "trigger_condition": "$stage.training_result.has_anomalies == true"
    },
    {
      "order": 5,
      "stage_type": "learning_summary",
      "agent": "explainer",
      "config": {
        "mode": "summary",
        "include_mindmap": true,
        "include_wrong_question_book": true
      },
      "input_mapping": {
        "session_data": "$context.all_stages",
        "diagnosis": "$stage.diagnosis_result"
      },
      "output_key": "summary_result"
    }
  ]
}
```

### 4.4 工作流执行引擎

执行引擎在后端实现 (`backend/src/modules/agent/orchestrator.js`)，核心逻辑：

```
class LearningOrchestrator:

  async execute(workflowConfig, studentContext):
    // 1. 初始化执行上下文
    context = {
      workflow_id: generateId(),
      student_id: studentContext.studentId,
      knowledge_point_id: studentContext.knowledgePointId,
      student_profile: await fetchStudentProfile(studentContext.studentId),
      stage_outputs: {},
      start_time: now()
    }

    // 2. 逐阶段执行
    for stage in workflowConfig.stages:
      // 2.1 检查触发条件
      if stage.trigger_condition and not evaluate(stage.trigger_condition, context):
        continue

      // 2.2 装配输入
      stageInput = assembleInput(stage.input_mapping, context)

      // 2.3 检查是否需要策略干预
      if stage.agent != "diagnostician":
        intervention = await checkIntervention(context)
        if intervention:
          stageInput.strategy_hint = intervention

      // 2.4 调用 Agent
      stageOutput = await callAgent(stage.agent, stage.stage_type, stageInput, stage.config)

      // 2.5 存入上下文
      context.stage_outputs[stage.output_key] = stageOutput

      // 2.6 SSE 推送进度
      ssePush({ stage: stage.order, agent: stage.agent, status: "completed", summary: stageOutput.summary })

      // 2.7 处理循环阶段
      if stage.loop:
        while not exitConditionMet(stage, context) and iterations < stage.loop.max_iterations:
          loopOutput = await callAgent(...)
          context.stage_outputs[stage.output_key] = mergeLoopOutput(loopOutput)
          iterations++
          ssePush(...)

      // 2.8 异常时触发诊断师
      if detectAnomaly(stageOutput):
        diagnosisResult = await callAgent("diagnostician", "strategy_intervention", context)
        context.pending_intervention = diagnosisResult

    // 3. 生成最终报告
    finalReport = await generateFinalReport(context)

    // 4. 持久化
    await saveSessionRecord(context, finalReport)

    return { context, finalReport }
```

### 4.5 SSE 实时进度推送

工作流执行期间，前端通过 SSE 接收实时进度：

```
event: stage_start
data: {"stage": 1, "agent": "explainer", "stage_type": "concept_learning", "timestamp": "..."}

event: agent_thinking
data: {"agent": "explainer", "thought": "学生对该知识点完全陌生，选择直授式教学策略..."}

event: stage_progress
data: {"stage": 1, "progress": 0.5, "message": "正在生成教学内容..."}

event: stage_complete
data: {"stage": 1, "agent": "explainer", "output_key": "concept_learning_result", "summary": "已完成二叉树遍历的概念讲解", "duration_seconds": 15}

event: intervention
data: {"agent": "diagnostician", "instruction": "检测到连续错误，已通知训练师降低难度"}

event: workflow_complete
data: {"workflow_id": "wf_xxx", "total_duration_seconds": 480, "report": {...}}
```

---

## 5. 数据模型扩展

### 5.1 基于现有模型的扩展方案

现有模型已具备良好基础，以下列出需要扩展的字段和需要新增的表。

**扩展 LearningPathStep（已有字段保持不变，新增以下字段）**：

```prisma
model LearningPathStep {
  // === 已有字段保持不变 ===
  id              String   @id @default(uuid())
  learningPathId  String
  stepOrder       Int
  knowledgePointId String?
  // ...其他已有字段

  // === 新增字段 ===
  agentType       String?   // Agent 类型: "explainer" | "trainer" | "diagnostician"
  stageType       String?   // 阶段类型: "concept_learning" | "example_demo" | "diagnostic_pre_test" | "adaptive_training" | "deep_evaluation" | "strategy_diagnosis" | "learning_summary"
  agentConfig     Json?     // 阶段配置参数 JSON
  inputMapping    Json?     // 输入映射: { "field": "$context.path" }
  outputKey       String?   // 输出键名，用于存入上下文
  triggerCondition String?  // 触发条件表达式
  loopConfig      Json?     // 循环配置: { maxIterations, iterationStage, exitCondition }
}
```

**新增 AgentSession 表**：

```prisma
model AgentSession {
  id              String    @id @default(uuid())
  studentId       String
  workflowId      String?   // 关联的 LearningPath
  knowledgePointId String?
  status          AgentSessionStatus @default(pending)
  context         Json?     // 执行上下文快照
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  // 关联
  student         User      @relation(fields: [studentId], references: [id])
  workflow        LearningPath? @relation(fields: [workflowId], references: [id])
  stages          AgentStageExecution[]
}

enum AgentSessionStatus {
  pending
  running
  paused
  completed
  failed
}
```

**新增 AgentStageExecution 表（记录每个阶段的执行详情）**：

```prisma
model AgentStageExecution {
  id              String    @id @default(uuid())
  sessionId       String
  stageOrder      Int
  agentType       String    // "explainer" | "trainer" | "diagnostician"
  stageType       String
  status          StageExecutionStatus @default(pending)
  input           Json?
  output          Json?
  agentConfig     Json?
  strategyUsed    String?   // 实际使用的策略（讲解者: direct/socratic/analogy/misconception | 训练师: pre_test/adaptive/deep_eval）
  anomalyFlags    Json?     // 检测到的异常标记
  interventionApplied Boolean @default(false)
  interventionDetail Json?
  startedAt       DateTime?
  completedAt     DateTime?
  durationMs      Int?
  createdAt       DateTime  @default(now())

  session         AgentSession @relation(fields: [sessionId], references: [id])
}

enum StageExecutionStatus {
  pending
  running
  completed
  skipped
  failed
}
```

**新增 AgentIntervention 表（记录诊断师的策略干预）**：

```prisma
model AgentIntervention {
  id              String    @id @default(uuid())
  sessionId       String
  triggeredByStageId String  // 触发干预的阶段执行 ID
  triggerReason   String    // 触发原因
  targetAgent     String    // 目标 Agent: "explainer" | "trainer"
  instruction     Json      // 策略指令详情
  appliedAt       DateTime? // 指令被应用的时间
  effectNotes     String?   // 干预效果备注
  createdAt       DateTime  @default(now())

  session         AgentSession @relation(fields: [sessionId], references: [id])
}
```

**扩展 AiAgentConfig 表（已有，新增策略相关字段）**：

```prisma
model AiAgentConfig {
  // === 已有字段保持不变 ===

  // === 新增字段 ===
  supportedStrategies Json?   // 支持的策略列表: ["direct", "socratic", "analogy", "misconception"]
  supportedModes      Json?   // 支持的模式列表: ["diagnostic_pre_test", "adaptive_training", "deep_evaluation"]
  defaultStrategy     String? // 默认策略
  strategySwitchRules Json?   // 策略切换规则配置
}
```

### 5.2 数据模型关系图

```
User (已有)
  │
  ├── LearningPath (已有) ──< LearningPathStep (扩展)
  │
  ├── AgentSession (新增)
  │     │
  │     └── AgentStageExecution (新增)
  │           │
  │           └── AgentIntervention (新增)
  │
  ├── AiAgentConfig (已有，扩展)
  ├── AgentRunRecord (已有)
  ├── StudentMasteryRecord (已有) ──> 诊断师的数据源
  ├── StudentPortrait (已有) ──> 诊断师的数据源
  └── PracticeSession (已有) ──> 训练师的操作对象
```

---

## 6. Dify 集成架构

### 6.1 整体架构

```
+----------------------------------------------------------+
|                   DisciMind 后端                           |
|                                                          |
|  +-----------------------------+  +-------------------+  |
|  | LearningOrchestrator        |  | DifyClientService  |  |
|  | (backend/src/modules/agent/ |  | (backend/src/      |  |
|  |  orchestrator.js)          |  |  modules/dify/     |  |
|  |                             |  |  dify.service.js) |  |
|  | - 加载工作流配置             |  |                    |  |
|  | - 逐阶段执行                |  | - 封装 Dify API    |  |
|  | - 上下文管理                |  | - 流式响应转发     |  |
|  | - 条件判断与分支            |  | - 超时与重试       |  |
|  | - 循环控制                  |  | - 错误处理         |  |
|  | - SSE 进度推送              |  | - 响应缓存         |  |
|  | - 策略干预协调              |  |                    |  |
|  +------+----------------------+  +--------+----------+  |
|         |                                  |             |
+---------+----------------------------------+-------------+
          |                                  |
          | 内部调用                 HTTP API 调用
          |                                  |
          v                                  v
+---------------------+        +----------------------------+
| DiagnosticianService |        |        Dify 平台             |
| (backend/src/modules/|        |                            |
|  agent/diagnostician |        |  +----------------------+  |
|  .service.js)       |        |  | 讲解者 Chatflow        |  |
|                      |        |  | - 4 种策略 Prompt 模板  |  |
| - 数据聚合           |        |  | - 知识库检索节点       |  |
| - 心智模型计算       |        |  | - 流式对话支持         |  |
| - 策略规则引擎       |        |  +----------------------+  |
+---------------------+        |                            |
                               |  +----------------------+  |
                               |  | 训练师 Workflow        |  |
                               |  | - 诊断性前测分支       |  |
                               |  | - 自适应训练分支       |  |
                               |  | - 深度批改分支         |  |
                               |  +----------------------+  |
                               |                            |
                               |  +----------------------+  |
                               |  | 诊断师 Workflow        |  |
                               |  | - 心智建模 LLM         |  |
                               |  | - 策略判断节点         |  |
                               |  | - 成长报告生成         |  |
                               |  +----------------------+  |
                               |                            |
                               |  共享资源：                 |
                               |  +----------------------+  |
                               |  | 知识库（课程资料）      |  |
                               |  | 系统提示词模板          |  |
                               |  | 环境变量（API Key）     |  |
                               |  +----------------------+  |
                               +----------------------------+
```

### 6.2 DifyClientService 接口设计

```javascript
// backend/src/modules/dify/dify.service.js

class DifyClientService {

  // 调用讲解者 Chatflow（流式对话）
  async chatWithExplainer({ studentId, knowledgePointId, strategyHint, conversationHistory, streamCallback }) {
    // POST /v1/chat-messages (Dify Chatflow API)
    // 流式响应通过 streamCallback 逐块推送给前端
  }

  // 调用训练师 Workflow（非流式，结构化输入输出）
  async runTrainerWorkflow({ mode, params }) {
    // POST /v1/workflows/run (Dify Workflow API)
    // mode: "diagnostic_pre_test" | "adaptive_training" | "deep_evaluation"
    // 返回结构化 JSON
  }

  // 调用诊断师 Workflow（非流式，需要后端预处理数据）
  async runDiagnosticianWorkflow({ mode, preprocessedData }) {
    // POST /v1/workflows/run
    // mode: "mental_model" | "strategy_intervention" | "growth_report"
    // 返回结构化 JSON
  }
}
```

### 6.3 每个 Agent 在 Dify 中的 Prompt 模板设计

**讲解者 - 直授式 Prompt 模板**（示例）：

```
你是一位资深学科教学专家，你的名字叫"讲解者"。

你的任务是对以下知识点进行结构化讲解。

## 学生信息
- 当前掌握度：{{mastery_level}}%
- 学习风格：{{learning_style}}
- 已知前置知识：{{prerequisites_mastered}}
- 已知薄弱点：{{known_weaknesses}}

## 讲解要求
- 知识点：{{knowledge_point_name}}
- 讲解深度：{{depth}}
- 教学策略：直授式 (Direct Instruction)

## 输出结构
请严格按照以下结构输出：

1. **前置知识桥接**：用2-3句话回顾与本知识点相关的前置知识
2. **核心定义**：用精炼的语言定义核心概念
3. **原理深入**：逐步展开原理层面
4. **典型示例**：给出1-2个标准示例（附带步骤说明）
5. **边界澄清**：指出1-2个常见误解，并解释为什么这些理解是错误的
6. **关键要点**：列出3-5条核心takeaway

## 约束
- 语言风格：清晰、准确、不过度学术化
- 如果学生掌握度低于30%，增加更多生活化类比
- 如果学生掌握度高于60%，可以引入更深入的原理探讨
- 如果学生有已知薄弱点，在讲解中有意识地强化相关概念
```

**训练师 - 深度批改 Prompt 模板**（示例）：

```
你是一位资深学习诊断专家，你的名字叫"训练师"。

你的任务是对学生的作答进行诊断性批改。你的目标不是简单地判对错，而是从错误中推断出学生的思维模式。

## 题目信息
{{question_json}}

## 标准答案与解析
{{standard_answer_json}}

## 学生作答
{{student_answer_json}}

## 学生历史
- 该生在此知识点的掌握度：{{mastery_level}}%
- 历史典型错误类型：{{historical_error_patterns}}
- 学习风格：{{learning_style}}

## 分析要求
请从以下维度进行分析：

1. **对错判定**：正确/部分正确/错误
2. **错误类型**：从以下分类中选择最匹配的：
   - concept_confusion: 概念混淆（把A概念和B概念搞混）
   - rule_forgetting: 规则遗忘（忘记或记错关键规则）
   - recursion_break: 递归断裂（多层嵌套中某层丢失规则）
   - calculation_error: 计算失误（知道怎么做但算错了）
   - misreading: 审题偏差（没注意到关键条件）
   - stuck: 思路正确但推不下去

3. **思维过程推断**：学生的答案暗示了怎样的思维路径？他大概率是怎么想的？

4. **根因分析**：导致这个错误的深层原因是什么？（不是"他选错了"，而是"他为什么会这样选"）

5. **补救建议**：
   - 针对此错误的即时纠正策略
   - 对讲解者的教学策略调整建议
   - 是否需要回溯到更基础的知识点

## 约束
- 不要使用"你答错了，正确答案是..."这种表述
- 改用"你的答案揭示了这样一个思维模式..."的表述
- 不要只描述表面现象，要深入到思维层面
- 语言风格：专业但不冷漠，像一位有经验的老师在分析学生的作业
```

---

## 7. 前端设计

### 7.1 页面规划

| 页面 | 路由 | 说明 | 基于现有页面 |
|------|------|------|-------------|
| 工作流模板市场 | `/student/workflows` | 浏览和选择预设/社区工作流模板 | 改造 AgentMarketPage |
| 工作流编辑器 | `/student/workflows/editor` | 拖拽式自定义工作流编辑器 | 新建 |
| 工作流执行器 | `/student/workflows/run/:id` | 工作流执行界面（Agent 协作可视化） | 新建 |
| 学习报告 | `/student/workflows/report/:sessionId` | 工作流完成后的学习报告 | 新建 |
| 学习中心（增强） | `/student/practice` | 集成训练师的三种模式 | 改造 student-practice-center |

### 7.2 工作流编辑器设计

```
+-----------------------------------------------------------------------------------+
|  自定义学习工作流编辑器                    [模板库] [导入] [保存] [预览] [发布]        |
+--------+--------------------------------------------------------------------------+
|        |                                                                          |
| 阶段   |                       画布区域                                           |
| 积木   |                                                                          |
| 块列   |   +---------------+        +---------------+        +---------------+   |
| 表     |   | 1. 概念学习    |------->| 2. 诊断前测    |------->| 3. 自适应训练  |   |
|        |   | Agent: 讲解者  |        | Agent: 训练师  |        | Agent: 训练师  |   |
| +----+ |   | 策略: 自动     |        | 题量: 3        |        | 上限: 10 题    |   |
| |概念| |   | 深度: 中等     |        | 难度: 自适应   |        | 退出: 正确率80%|   |
| |学习| |   +---------------+        +---------------+        +-------+-------+   |
| +----+ |                                                            |           |
| +----+ |                                                            v           |
| |例题| |                                                   +---------------+   |
| |演示| |                                                   | 4. 深度批改    |   |
| +----+ |                                                   | Agent: 训练师  |   |
| +----+ |                                                   +-------+-------+   |
| |诊断| |                                                           |           |
| |前测| |                                                           v           |
| +----+ |                                                   +---------------+   |
| +----+ |                                                   | 5. 策略诊断    |   |
| |自适| |                                                   | Agent: 诊断师  |   |
| |应训| |                                                   | 条件: 有异常   |   |
| |练  | |                                                   +-------+-------+   |
| +----+ |                                                           |           |
| +----+ |                                                           v           |
| |深度| |                                                   +---------------+   |
| |批改| |                                                   | 6. 学习总结    |   |
| +----+ |                                                   | Agent: 讲解者  |   |
| +----+ |                                                   +---------------+   |
| |策略| |                                                                       |
| |诊断| |                                                                       |
| +----+ |                                                                       |
| +----+ |                                                                       |
| |学习| |                                                                       |
| |总结| |                                                                       |
| +----+ |                                                                       |
|        |                                                                       |
+--------+-----------------------------------------------------------------------+
|  属性面板（选中某个积木块时显示）                                                   |
|                                                                                |
|  阶段名称: [概念学习________]                                                     |
|  调用 Agent: [讲解者 v]                                                          |
|  教学策略: [自动 v] [直授式] [苏格拉底式] [类比式] [纠错式]                          |
|  讲解深度: [────────●────] 中等                                                   |
|  [x] 包含前置知识回顾                                                            |
|  预计时长: [10] 分钟                                                             |
|  失败处理: [跳过并继续 v]                                                         |
+-----------------------------------------------------------------------------------+
```

### 7.3 工作流执行器设计

执行器是比赛展示的核心界面，需要体现 Agent 协作的"智能感"。

```
+-----------------------------------------------------------------------------------+
|  正在执行：以练带学 - 二叉树遍历                        进度: 3/6 阶段   已用: 4:30   |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  +------------------+     +------------------+     +------------------+           |
|  |  1. 诊断前测      |     |  2. 深度批改      |     |  3. 概念学习      |           |
|  |  Agent: 训练师    |     |  Agent: 训练师    |     |  Agent: 讲解者    |           |
|  |  [已完成]         |     |  [已完成]         |     |  [执行中...]      |           |
|  |  用时: 1:20       |     |  用时: 0:45       |     |  策略: 类比式     |           |
|  |  产出: 3 道探测题  |     |  检测到:           |     |                  |           |
|  +------------------+     |  recursion_break   |     |  +------------+  |           |
|          |                +------------------+     |  | 正在生成    |  |           |
|          v                       |                  |  | 俄罗斯套娃   |  |           |
|  +------------------+            v                  |  | 类比讲解... |  |           |
|  | 学生作答区       |     +------------------+     |  +------------+  |           |
|  |                  |     | 诊断师介入        |     |                  |           |
|  | Q1: 中序遍历结果? |     | [策略指令]        |     +------------------+           |
|  | 学生答: A        |     | 讲解者->类比式     |              |                     |
|  | 正确 | 用时:30s   |     | 训练师->降难度     |              v                     |
|  |                  |     +------------------+     +------------------+           |
|  | Q2: 递归实现判断? |              |               | 学生正在学习     |           |
|  | 学生答: C        |              v               |                  |           |
|  | 错误 | 用时:45s   |     +------------------+     | "哦！原来每层    |           |
|  |                  |     | 训练师重新出题     |     |  都要独立应用    |           |
|  | Q3: 遍历顺序分析? |     | [降级为基础难度]   |     |  规则..."       |           |
|  | 学生答: D        |     +------------------+     +------------------+           |
|  | 错误 | 用时:50s   |                                                            |
|  +------------------+                                                            |
|                                                                                   |
+-----------------------------------------------------------------------------------+
|  Agent 思考日志（实时滚动）                                                          |
|                                                                                   |
|  [10:30:15] 训练师: 完成 3 道探测题的批改。Q2和Q3均出现 recursion_break 模式。         |
|  [10:30:16] 诊断师: 检测到连续 recursion_break，这不是知识缺失，是心智模型问题。         |
|  [10:30:16] 诊断师: 建议讲解者切换到"类比式"教学，用"俄罗斯套娃"解释递归调用栈。          |
|  [10:30:17] 诊断师: 建议训练者降低难度，先出 1 道基础递归概念验证题。                    |
|  [10:30:18] 讲解者: 收到策略指令，准备类比式教学内容...                                |
|  [10:30:20] 讲解者: 正在生成"俄罗斯套娃"类比讲解，关联到二叉树递归遍历...                 |
+-----------------------------------------------------------------------------------+
|  [暂停] [跳过当前阶段] [查看中间报告]                                                  |
+-----------------------------------------------------------------------------------+
```

### 7.4 Agent 协作可视化设计

在工作流执行器中，Agent 之间的通信用动态连线表示：

- **数据流**（阶段产出传递给下一阶段）：实线箭头，数据传输时带流动光效
- **策略指令流**（诊断师 -> 讲解者/训练师）：虚线箭头，带脉冲动画，强调"暗中调度"的感觉
- **Agent 状态指示**：
  - 灰色 + 静态：等待中
  - 蓝色 + 脉冲动画：正在执行
  - 绿色 + 对勾：已完成
  - 橙色 + 感叹号：策略干预中
  - 红色 + 叉号：执行失败

---

## 8. 后端 API 设计

### 8.1 Agent 调用接口

```
POST /api/agent/explainer/chat
  描述: 调用讲解者 Chatflow（流式 SSE）
  请求体: {
    knowledgePointId: string,
    strategyHint?: "direct" | "socratic" | "analogy" | "misconception" | "auto",
    conversationHistory?: [...],
    studentContext?: { masteryLevel, learningStyle, knownWeaknesses }
  }
  响应: SSE 流 (text/event-stream)

POST /api/agent/trainer/run
  描述: 调用训练师 Workflow
  请求体: {
    mode: "diagnostic_pre_test" | "adaptive_training" | "deep_evaluation",
    params: { ... } // 根据 mode 不同而不同
  }
  响应: { code: 200, data: { mode, result: {...} } }

POST /api/agent/diagnostician/analyze
  描述: 调用诊断师 Workflow（心智建模或策略干预）
  请求体: {
    mode: "mental_model" | "strategy_intervention" | "growth_report",
    studentId: string,
    params: { ... }
  }
  响应: { code: 200, data: { mode, result: {...} } }
```

### 8.2 工作流管理接口

```
GET /api/workflows/templates
  描述: 获取预设工作流模板列表
  响应: { code: 200, data: [WorkflowTemplate, ...] }

GET /api/workflows/my
  描述: 获取当前学生的自定义工作流列表
  响应: { code: 200, data: [WorkflowConfig, ...] }

GET /api/workflows/:id
  描述: 获取工作流详情（含阶段配置）
  响应: { code: 200, data: WorkflowConfig }

POST /api/workflows
  描述: 创建自定义工作流
  请求体: WorkflowConfig
  响应: { code: 200, data: { id, ... } }

PUT /api/workflows/:id
  描述: 更新工作流配置
  请求体: WorkflowConfig (部分更新)
  响应: { code: 200, data: { id, ... } }

DELETE /api/workflows/:id
  描述: 删除自定义工作流
  响应: { code: 200, message: "ok" }

POST /api/workflows/:id/execute
  描述: 执行工作流
  请求体: { knowledgePointId, studentContext }
  响应: SSE 流 (text/event-stream)
```

### 8.3 学习报告接口

```
GET /api/workflows/sessions/:sessionId/report
  描述: 获取工作流执行报告
  响应: { code: 200, data: SessionReport }

GET /api/workflows/sessions
  描述: 获取学生的历史执行记录
  查询参数: ?page=1&limit=10&knowledgePointId=xxx
  响应: { code: 200, data: { list: [SessionSummary], total, page, limit } }
```

---

## 9. 实施路线图

以下按功能模块划分，每个模块可独立开发和测试。

### 阶段 1：单 Agent 跑通

**目标**：证明 Dify-Agent-后端-前端的完整链路可通。

**任务**：

1. **Dify 端**：搭建训练师 Workflow，先实现"诊断性前测"一个分支
   - LLM 节点 1：分析知识点，输出 3-5 个典型易错点
   - LLM 节点 2：为每个易错点生成 1 道选择题（含干扰项分析）
   - 代码节点：格式化为标准 JSON

2. **后端**：实现 `DifyClientService` 基础版本
   - 封装 Dify Workflow API 调用
   - 超时处理、错误重试
   - 在 `backend/src/modules/dify/dify.service.js` 中实现

3. **后端**：创建 `/api/agent/trainer/run` 接口
   - 路由：`backend/src/routes/agent.routes.js`
   - 控制器：`backend/src/controllers/agent.controller.js`
   - 调用 DifyClientService

4. **前端**：在学习中心页面添加"AI 生成练习"入口
   - 改造 `student-practice-center.js`
   - 调用后端接口，展示生成的题目

**可验证效果**：学生选择一个知识点，点击"AI 生成练习"，获得 3-5 道带有干扰项分析的选择题。

### 阶段 2：训练师完整实现

**目标**：训练师的三种模式全部可用。

**任务**：

1. **Dify 端**：完善训练师 Workflow，增加"自适应训练"和"深度批改"分支
2. **后端**：实现训练师的完整调用逻辑
   - 自适应训练的循环控制（出题 -> 批改 -> 决定下一题 -> 出题）
   - 错误类型的结构化存储
3. **前端**：学习中心集成训练师的三种模式
   - AI 生成练习 -> 诊断性前测
   - 练习作答 -> 深度批改
   - 错题强化 -> 自适应训练

**可验证效果**：学生在学习中心体验到完整的"AI 出题 -> 作答 -> 诊断性批改 -> 自适应出下一题"循环。

### 阶段 3：讲解者实现

**目标**：讲解者具备四种教学策略，可与现有 AI 对话页集成。

**任务**：

1. **Dify 端**：搭建讲解者 Chatflow
   - 四种策略的 Prompt 模板
   - 策略路由节点
   - 知识库检索节点（连接 Dify 知识库）
   - 流式对话支持

2. **后端**：实现讲解者调用逻辑
   - SSE 流式响应转发
   - 对话历史管理
   - 策略选择逻辑（手动指定 / 自动判断）

3. **前端**：增强 AI 对话页
   - 展示当前使用的教学策略标签
   - 策略切换器（学生可手动切换教法）
   - 讲解内容的结构化渲染

**可验证效果**：学生在 AI 对话页学习一个知识点，系统根据学生画像自动选择教学策略，学生可看到策略标签并手动切换。

### 阶段 4：诊断师实现

**目标**：诊断师能构建心智模型、发出策略干预指令、生成成长报告。

**任务**：

1. **后端**：实现 `DiagnosticianService`
   - 数据聚合逻辑（从 StudentMasteryRecord、AnswerRecord、PracticeSession 拉数据）
   - 心智模型计算（掌握度分析、错误模式聚合、学习风格推断）
   - 策略规则引擎（异常检测 + 规则匹配 + 指令生成）

2. **Dify 端**：搭建诊断师 Workflow
   - 心智建模 LLM（输入：预处理数据 -> 输出：心智模型摘要）
   - 成长报告生成 LLM

3. **前端**：学习分析页展示诊断师产出
   - 心智模型可视化（掌握度热力图、错误模式分布、学习风格标签）
   - 成长报告页面
   - Before/After 知识图谱对比

**可验证效果**：学习分析页展示学生的心智模型（不只是一堆数字，而是有叙事感的分析），学习结束后生成成长报告。

### 阶段 5：工作流编排系统

**目标**：实现完整的自定义工作流编辑器、执行引擎和协作可视化。

**任务**：

1. **后端**：实现 LearningOrchestrator
   - 工作流配置加载与解析
   - 逐阶段执行与上下文管理
   - 条件判断与分支
   - 循环阶段支持
   - SSE 实时进度推送
   - 策略干预协调（执行中检测异常 -> 调用诊断师 -> 注入下一阶段）

2. **数据库**：执行 Prisma 迁移
   - 扩展 LearningPathStep
   - 新增 AgentSession、AgentStageExecution、AgentIntervention

3. **后端 API**：实现工作流 CRUD 和执行接口

4. **前端 - 工作流模板市场**：
   - 改造 AgentMarketPage 为工作流模板市场
   - 展示三套预设模板卡片
   - 模板详情预览

5. **前端 - 工作流编辑器**：
   - 拖拽式阶段编排
   - 阶段连线
   - 属性配置面板
   - 模板导入/自定义保存

6. **前端 - 工作流执行器**：
   - 阶段进度展示
   - Agent 协作可视化（状态指示 + 动态连线）
   - 实时思考日志
   - 策略干预提示

**可验证效果**：学生可在编辑器中选择"以练带学"模板，修改配置后保存，选择知识点执行，看到完整的 6 阶段 Agent 协作过程，中间出现策略干预，最终生成学习报告。

### 阶段 6：比赛展示打磨

**目标**：确保演示效果流畅、有冲击力、有记忆点。

**任务**：

1. **预设模板精调**：三套模板的阶段配置经过充分的 Prompt 工程优化
2. **演示数据准备**：准备一套完整的"二叉树遍历"演示数据，覆盖正常和异常场景
3. **协作动效优化**：Agent 状态切换动画、连线流动效果、思考日志打字机效果
4. **Before/After 对比**：知识图谱从红到绿的渐变过渡动画
5. **学习报告**：精美的报告排版，支持导出 PDF
6. **演示脚本编写**：90 秒完整叙事，覆盖全部关键展示点
7. **异常场景处理**：演示中策略干预的触发和展示（让评委看到"系统发现了学生自己都没意识到的问题"）

**可验证效果**：按演示脚本执行一遍，90 秒内完整展示三 Agent 协作教学的全过程，评委能清晰理解差异化价值。

---

## 10. 关键边界条件与约束

### 10.1 Agent 间通信原则

- Agent 之间不直接通信，统一通过编排引擎中转
- 策略指令以数据形式存储在上下文中，而非实时 API 调用
- 每个 Agent 是无状态的，所有状态由编排引擎维护

### 10.2 错误处理

- 单个 Agent 调用失败时，编排引擎重试 1 次
- 重试仍然失败时，跳过该阶段（如果配置允许）或暂停工作流
- 所有 Agent 调用记录写入 AgentRunRecord，便于排查

### 10.3 性能约束

- 讲解者 Chatflow 的首次响应时间应 < 3 秒
- 训练师 Workflow 的完整执行时间应 < 15 秒（含题目生成）
- 诊断师 Workflow 的完整执行时间应 < 10 秒
- SSE 推送间隔不超过 2 秒（保证前端体验流畅）

### 10.4 安全约束

- 所有 Dify API Key 从环境变量读取，不硬编码
- 前端不直接调用 Dify API，必须通过后端转发
- 学生只能查看自己的心智模型数据
- 策略指令的内容对前端透明（不暴露敏感的诊断逻辑细节）
