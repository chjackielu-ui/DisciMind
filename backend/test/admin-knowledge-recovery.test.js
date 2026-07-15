const test = require('node:test');
const assert = require('node:assert/strict');

const knowledgeService = require('../src/services/admin-knowledge.service');

test('admin knowledge list excludes soft-deleted documents from rows and totals', async () => {
  const calls = [];
  const prismaClient = {
    knowledgeDocument: {
      async findMany(args) {
        calls.push({ method: 'findMany', args });
        return [];
      },
      async count(args) {
        calls.push({ method: 'count', args });
        return 0;
      },
    },
  };

  const result = await knowledgeService.getDocumentList({ page: 1, page_size: 20 }, prismaClient);

  assert.deepEqual(result, { list: [], total: 0, page: 1, page_size: 20, total_pages: 1 });
  assert.equal(calls.length, 2);
  for (const call of calls) assert.deepEqual(call.args.where, { deleted_at: null });
});

test('admin knowledge review treats a soft-deleted document as unavailable', async () => {
  let reviewWriteAttempted = false;
  const prismaClient = {
    knowledgeDocument: {
      async findFirst(args) {
        assert.deepEqual(args.where, { document_id: 7, deleted_at: null });
        return null;
      },
      async update() {
        reviewWriteAttempted = true;
      },
    },
    knowledgeDocumentReview: {
      async create() {
        reviewWriteAttempted = true;
      },
    },
  };

  await assert.rejects(
    knowledgeService.reviewDocument(7, 'approved', null, 1, prismaClient),
    /文档不存在/,
  );
  assert.equal(reviewWriteAttempted, false);
});
