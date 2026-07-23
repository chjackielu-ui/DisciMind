const subjectChatSource = require('../subject-chat/subject-chat-source.service');
const knowledgeProvider = require('../knowledge-base/knowledge-provider.service');

/**
 * 面向学生课程问答的授权检索入口。权限判断、向量检索和本地片段降级
 * 均由现有课程知识库服务完成，避免在兼容层另开一条绕过选课校验的路径。
 */
async function retrieveCourseSources(input) {
  const userId = Number(input?.userId);
  const courseId = Number(input?.courseId);
  if (!Number.isInteger(userId) || userId <= 0) throw Object.assign(new Error('缺少有效用户身份'), { code: 40101 });
  if (!Number.isInteger(courseId) || courseId <= 0) throw Object.assign(new Error('请选择有效课程'), { code: 40001 });
  const question = String(input?.question || '').trim();
  if (!question) throw Object.assign(new Error('检索问题不能为空'), { code: 40001 });
  return subjectChatSource.retrieve({
    userId,
    courseId,
    knowledgePointId: input?.knowledgePointId ? Number(input.knowledgePointId) : null,
    question: question.slice(0, 5000),
  });
}

module.exports = {
  retrieveCourseSources,
  retrieveFromDataset: knowledgeProvider.retrieveFromDataset,
  retrieveFromMultipleDatasets: knowledgeProvider.retrieveFromMultipleDatasets,
};
