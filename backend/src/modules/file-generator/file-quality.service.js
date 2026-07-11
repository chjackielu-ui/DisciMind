function normalizedAnswer(answer) { return Array.isArray(answer) ? answer.map(String) : [String(answer)]; }
function examIssues(content, expectedCount) {
  const issues = []; const questions = content.questions || []; const ids = questions.map(item => item.id);
  if (questions.length !== expectedCount) issues.push(`题目数量应为 ${expectedCount}，实际为 ${questions.length}`);
  if (new Set(ids).size !== ids.length) issues.push('题号不唯一');
  if (questions.some(item => !String(item.stem || '').trim())) issues.push('存在空题干');
  if (questions.some(item => Number(item.score) < 0)) issues.push('存在负分值');
  if (questions.some(item => ['SINGLE_CHOICE','MULTIPLE_CHOICE'].includes(item.type) && (!item.options?.length || normalizedAnswer(item.answer).some(answer => !item.options.includes(answer) && !/^[A-J]$/.test(answer))))) issues.push('选择题选项与答案不一致');
  const total = questions.reduce((sum, item) => sum + Number(item.score || 0), 0); if (Math.abs(total - Number(content.totalScore || 0)) > 0.001) issues.push('总分与题目分值之和不一致');
  if ((content.answers || []).length !== questions.length || new Set((content.answers || []).map(item => item.questionId)).size !== questions.length) issues.push('答案数量不匹配');
  if ((content.analysis || []).length !== questions.length || new Set((content.analysis || []).map(item => item.questionId)).size !== questions.length) issues.push('解析数量不匹配');
  const stems = questions.map(item => String(item.stem).trim().toLowerCase()); if (new Set(stems).size !== stems.length) issues.push('存在重复题目');
  if (!(content.sections || []).length) issues.push('缺少试卷章节'); return issues;
}
function handoutIssues(content) {
  const issues = []; for (const [field, label] of Object.entries({ learningObjectives:'学习目标',sections:'章节',examples:'例子',keyPoints:'重点',commonMistakes:'常见错误',practice:'练习',summary:'总结' })) if (!(content[field] || []).length) issues.push(`缺少${label}`); return issues;
}
function validateQuality(type, content, requirements = {}) { const issues = type === 'EXAM_PAPER' ? examIssues(content, requirements.questionCount) : handoutIssues(content); return { ok: issues.length === 0, issues }; }
module.exports = { examIssues, handoutIssues, validateQuality };
