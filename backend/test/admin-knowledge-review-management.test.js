const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const prisma = require('../src/config/prisma');
const knowledgeService = require('../src/services/admin-knowledge.service');

const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
const documentIds = [];
let req;
let owner;

async function createDocument(key, overrides = {}) {
  const document = await prisma.knowledgeDocument.create({
    data: {
      title: `知识审核-${key}-${suffix}`,
      original_filename: `knowledge-${key}-${suffix}.txt`,
      file_ext: 'txt',
      file_size_bytes: 1024,
      mime_type: 'text/plain',
      file_url: `/acceptance/${suffix}/${key}.txt`,
      scope_type: 'PLATFORM',
      visibility: 'PRIVATE',
      owner_user_id: owner.user_id,
      parse_status: 'EMBEDDED',
      review_status: 'PENDING',
      operation_id: `knowledge-review-${suffix}-${key}`,
      ...overrides,
    },
  });
  documentIds.push(document.document_id);
  return document;
}

test.before(async () => {
  const admin = await prisma.user.findFirst({
    where: {
      role: 'ADMIN',
      status: 'ACTIVE',
      admin_role_assignments: { some: { role: { role_code: 'super_admin', enabled: true } } },
    },
    select: { user_id: true, role: true },
  });
  owner = await prisma.user.findFirst({
    where: { status: 'ACTIVE', role: { in: ['TEACHER', 'STUDENT'] } },
    select: { user_id: true },
  });
  assert.ok(admin && owner, 'active administrator and document owner are required');
  req = { user: admin, id: `admin-knowledge-review-${suffix}`, ip: '127.0.0.1' };
});

test.after(async () => {
  await prisma.operationLog.deleteMany({ where: { request_id: req?.id } });
  if (documentIds.length) await prisma.knowledgeDocument.deleteMany({ where: { document_id: { in: documentIds } } });
  await prisma.$disconnect();
});

test('pending knowledge documents can be filtered, approved or rejected with history and audit', async () => {
  const approved = await createDocument('approve');
  const rejected = await createDocument('reject');
  await createDocument('deleted', { deleted_at: new Date() });

  const pending = await knowledgeService.getDocumentList({
    review_status: 'pending', keyword: suffix, page: 1, page_size: 10,
  });
  assert.equal(pending.total, 2);
  assert.deepEqual(pending.list.map((item) => item.document_id).sort(), [approved.document_id, rejected.document_id].sort());

  const byFilename = await knowledgeService.getDocumentList({ keyword: `knowledge-approve-${suffix}.txt` });
  assert.equal(byFilename.total, 1);
  assert.equal(byFilename.list[0].document_id, approved.document_id);

  const approvedResult = await knowledgeService.reviewDocument(
    approved.document_id, 'approved', '内容来源与范围核验通过。', req,
  );
  assert.equal(approvedResult.review_status, 'approved');
  const rejectedResult = await knowledgeService.reviewDocument(
    rejected.document_id, 'rejected', '来源说明不完整，请补充后重新提交。', req,
  );
  assert.equal(rejectedResult.review_status, 'rejected');

  await assert.rejects(
    () => knowledgeService.reviewDocument(approved.document_id, 'rejected', '重复审核', req),
    /已经审核/,
  );
  await assert.rejects(
    () => knowledgeService.reviewDocument(documentIds[2], 'approved', '软删除行不可审核', req),
    /文档不存在/,
  );

  const persisted = await prisma.knowledgeDocument.findMany({
    where: { document_id: { in: [approved.document_id, rejected.document_id] } },
    orderBy: { document_id: 'asc' },
  });
  assert.deepEqual(persisted.map((item) => item.review_status).sort(), ['APPROVED', 'REJECTED']);
  assert.equal(await prisma.knowledgeDocumentReview.count({
    where: { document_id: { in: [approved.document_id, rejected.document_id] } },
  }), 2);

  const audits = await prisma.operationLog.findMany({
    where: { request_id: req.id },
    select: { operation_type: true, before_summary_json: true, after_summary_json: true },
  });
  assert.deepEqual(audits.map((item) => item.operation_type).sort(), [
    'APPROVE_KNOWLEDGE_DOCUMENT', 'REJECT_KNOWLEDGE_DOCUMENT',
  ]);
  assert.ok(audits.every((item) => item.before_summary_json.review_status === 'PENDING'));
});

test('knowledge rejection requires an auditable reason', async () => {
  const document = await createDocument('reason-required');
  await assert.rejects(
    () => knowledgeService.reviewDocument(document.document_id, 'rejected', '   ', req),
    /必须填写审核意见/,
  );
  assert.equal((await prisma.knowledgeDocument.findUnique({ where: { document_id: document.document_id } })).review_status, 'PENDING');
});
