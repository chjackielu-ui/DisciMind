const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/config/prisma');
const service = require('../src/modules/file-generator/system-file-agents.service');

test('system file agents bind only real approved public local knowledge bases', async () => {
  await service.ensureSystemFileAgents({ prisma });
  const realKnowledgeBases = await service.findRealPublicKnowledgeBases(prisma);
  const agents = await prisma.userAgent.findMany({
    where: { systemKey: { in: ['system_study_handout_generator', 'system_exam_paper_generator'] } },
    include: {
      currentPublicVersion: {
        include: {
          knowledgeBases: {
            include: {
              knowledgeBase: {
                include: {
                  documents: {
                    where: { deleted_at: null, parse_status: 'EMBEDDED', marketplace_status: 'READY', review_status: 'APPROVED' },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  assert.equal(agents.length, 2);
  for (const agent of agents) {
    assert.equal(agent.agentType, 'FILE_GENERATOR');
    assert.equal(agent.status, 'PUBLIC');
    assert.equal(agent.visibility, 'PUBLIC');
    assert.equal(agent.currentPublicVersion.reviewStatus, 'APPROVED');
    assert.equal(agent.currentPublicVersion.knowledgeBases.length, realKnowledgeBases.length ? Math.min(3, realKnowledgeBases.length) : 0);
    assert.ok(agent.currentPublicVersion.knowledgeBases.every((item) => (
      item.knowledgeBase.marketplace_visibility === 'PUBLIC'
      && item.knowledgeBase.marketplace_status === 'PUBLIC'
      && item.knowledgeBase.documents.length > 0
    )));
  }
});

test.after(() => prisma.$disconnect());
