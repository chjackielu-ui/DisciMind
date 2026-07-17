function normalizedAnswer(answer) { return Array.isArray(answer) ? answer.map(String) : [String(answer)]; }
function examIssues(content, expectedCount, requirements = {}) {
  const issues = []; const questions = content.questions || []; const ids = questions.map(item => item.id);
  if (questions.length !== expectedCount) issues.push(`题目数量应为 ${expectedCount}，实际为 ${questions.length}`);
  if (new Set(ids).size !== ids.length) issues.push('题号不唯一');
  if (questions.some(item => !String(item.stem || '').trim())) issues.push('存在空题干');
  if (questions.some(item => Number(item.score) < 0)) issues.push('存在负分值');
  if (questions.some(item => ['SINGLE_CHOICE','MULTIPLE_CHOICE'].includes(item.type) && (!item.options?.length || normalizedAnswer(item.answer).some(answer => !item.options.includes(answer) && !/^[A-J]$/.test(answer))))) issues.push('选择题选项与答案不一致');
  if (questions.some(item => ['SINGLE_CHOICE','MULTIPLE_CHOICE'].includes(item.type) && item.options.length < 4)) issues.push('选择题选项不完整');
  if (questions.some(item => item.type === 'TRUE_FALSE' && !['正确','错误','对','错','TRUE','FALSE'].includes(String(item.answer).toUpperCase()))) issues.push('判断题答案不合法');
  if (questions.some(item => item.type === 'PROGRAMMING' && !/(输入|输出|示例|要求|函数|程序)/.test(String(item.stem)))) issues.push('编程题格式不完整');
  const total = questions.reduce((sum, item) => sum + Number(item.score || 0), 0); if (Math.abs(total - Number(content.totalScore || 0)) > 0.001) issues.push('总分与题目分值之和不一致');
  if ((content.answers || []).length !== questions.length || new Set((content.answers || []).map(item => item.questionId)).size !== questions.length) issues.push('答案数量不匹配');
  if ((content.analysis || []).length !== questions.length || new Set((content.analysis || []).map(item => item.questionId)).size !== questions.length) issues.push('解析数量不匹配');
  const answerMap = new Map((content.answers || []).map(item => [item.questionId, normalizedAnswer(item.answer).map(value => value.trim()).sort().join('|')]));
  const analysisMap = new Map((content.analysis || []).map(item => [item.questionId, String(item.analysis || '').trim()]));
  if (questions.some(item => answerMap.get(item.id) !== normalizedAnswer(item.answer).map(value => value.trim()).sort().join('|'))) issues.push('答案汇总与题目正确答案不一致');
  if (questions.some(item => analysisMap.get(item.id) !== String(item.analysis || '').trim())) issues.push('解析汇总与题目解析不一致');
  if (questions.some((item, index) => item.id !== `Q${index + 1}`)) issues.push('题号必须从 Q1 起连续排列');
  const stems = questions.map(item => String(item.stem).trim().toLowerCase()); if (new Set(stems).size !== stems.length) issues.push('存在重复题目');
  if (!(content.sections || []).length) issues.push('缺少试卷章节');
  const sectionQuestionIds = (content.sections || []).flatMap(item => item.questionIds || []);
  if (sectionQuestionIds.length !== questions.length || new Set(sectionQuestionIds).size !== questions.length || sectionQuestionIds.some(id => !ids.includes(id))) issues.push('试卷章节未完整且唯一覆盖所有题目');
  if (requirements.questionTypes?.length) {
    for (const expected of requirements.questionTypes) {
      const actual = questions.filter(item => item.type === expected.type);
      if (actual.length !== Number(expected.count)) issues.push(`${expected.type} 题目数量不匹配`);
      if (actual.some(item => Math.abs(Number(item.score) - Number(expected.score)) > 0.001)) issues.push(`${expected.type} 单题分值不匹配`);
    }
  }
  return issues;
}
function handoutIssues(content, requirements = {}) {
  const required = { learningObjectives:'学习目标',sections:'章节',keyPoints:'重点',commonMistakes:'常见错误',principles:'公式或原理',references:'参考资料',summary:'总结' };
  if (requirements.includeExamples !== false) required.examples = '例子';
  if (requirements.includeExercises !== false) required.practice = '练习';
  const issues = []; for (const [field, label] of Object.entries(required)) if (!(content[field] || []).length) issues.push(`缺少${label}`); return issues;
}
function validateQuality(type, content, requirements = {}) { const issues = type === 'EXAM_PAPER' ? examIssues(content, requirements.questionCount, requirements) : handoutIssues(content, requirements); return { ok: issues.length === 0, issues }; }
module.exports = { examIssues, handoutIssues, validateQuality };
