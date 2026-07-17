// 学习流前端唯一节点配置。字段与后端 workflow-schema.js 保持一一对应。
export const LEARNING_FLOW_NODE_TYPES = [
  { type: 'concept_explanation', label: '概念讲解', category: 'explain', description: '建立知识框架与核心定义', agent: 'Explainer', minutes: 6, short: '讲解' },
  { type: 'analogy_explanation', label: '类比讲解', category: 'explain', description: '用熟悉事物理解抽象概念', agent: 'Explainer', minutes: 4, short: '类比' },
  { type: 'worked_example_analysis', label: '例题分析', category: 'explain', description: '通过例题逐步推理分析', agent: 'Explainer', minutes: 5, short: '例题' },
  { type: 'socratic_questioning', label: '苏格拉底提问', category: 'explain', description: '通过提问引导深度思考', agent: 'Explainer', minutes: 6, short: '提问' },
  { type: 'misconception_repair', label: '误区修复', category: 'explain', description: '识别并纠正学生的错误理解', agent: 'Explainer', minutes: 5, short: '误区' },
  { type: 'multimodal_interaction', label: '多模态交互', category: 'explain', description: '支持图片+文字混合输入讲解', agent: 'Explainer', minutes: 6, short: '多模态' },
  { type: 'basic_practice', label: '基础练习', category: 'practice', description: '以基础题巩固关键知识', agent: 'Trainer', minutes: 6, short: '练习' },
  { type: 'adaptive_practice', label: '自适应练习', category: 'practice', description: '依学习表现动态调整难度', agent: 'Trainer', minutes: 8, short: '自适应' },
  { type: 'diagnostic_pre_test', label: '诊断前测', category: 'practice', description: '评估学生当前知识掌握水平', agent: 'Trainer', minutes: 5, short: '前测' },
  { type: 'deep_evaluation', label: '深度评估', category: 'practice', description: '开放题深度评估理解水平', agent: 'Trainer', minutes: 8, short: '深评' },
  { type: 'variant_question', label: '变式题', category: 'practice', description: '基于原题生成变式举一反三', agent: 'Trainer', minutes: 5, short: '变式' },
  { type: 'wrong_question_repair', label: '错题修复', category: 'repair', description: '定位错误原因并针对性修复', agent: 'Diagnostician', minutes: 5, short: '修复' },
  { type: 'mastery_gate', label: '掌握度判断', category: 'control', description: '按掌握度选择后续学习路径', agent: 'Diagnostician', minutes: 1, short: '判断' },
  { type: 'learning_summary', label: '学习总结', category: 'summary', description: '回顾学习成果并给出建议', agent: 'Diagnostician', minutes: 3, short: '总结' },
  { type: 'summary', label: '知识总结', category: 'summary', description: '对知识点进行系统性总结', agent: 'Explainer', minutes: 3, short: '总结' },
];

export const LEARNING_FLOW_CATEGORIES = {
  explain: { label: '讲解类', color: '#2f6690', background: 'rgba(47, 102, 144, .08)' },
  practice: { label: '训练类', color: '#177a5a', background: 'rgba(23, 122, 90, .08)' },
  repair: { label: '修复类', color: '#c65d2e', background: 'rgba(198, 93, 46, .08)' },
  control: { label: '判断类', color: '#7c4cc4', background: 'rgba(124, 76, 196, .08)' },
  summary: { label: '总结类', color: '#4b5fc0', background: 'rgba(75, 95, 192, .08)' },
};

export const FLOW_DRAFT_STORAGE_KEY = 'discimind.learning-flow.draft';
export const getNodeType = (type) => LEARNING_FLOW_NODE_TYPES.find((item) => item.type === type);
export const getNodeCategory = (type) => getNodeType(type)?.category || 'explain';
export const isSupportedGraph = (graph) => Array.isArray(graph?.nodes)
  && graph.nodes.length > 0
  && graph.nodes.every((node) => getNodeType(node.type));
