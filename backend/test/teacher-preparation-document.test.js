const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/teacher-preparation-document.service');

test('editable teaching document sanitizer strips active content and preserves structured formatting', () => {
  const rich = service.normalizeRichDocument({
    title: '格式保真测试',
    html: '<h1>格式保真测试</h1><p><strong>粗体</strong><em>斜体</em><u>下划线</u><s>删除线</s><img src="data:image/png;base64,iVBORw0KGgo=" alt="示意图"></p><script>alert(1)</script>',
  });
  assert.equal(/<script|alert\(/i.test(rich.sanitizedHtml), false);
  const paragraph = rich.contentJson.content.find((node) => node.type === 'paragraph');
  assert.ok(paragraph);
  assert.equal(paragraph.content.some((node) => node.marks?.bold), true);
  assert.equal(paragraph.content.some((node) => node.marks?.italic), true);
  assert.equal(paragraph.content.some((node) => node.marks?.underline), true);
  assert.equal(paragraph.content.some((node) => node.marks?.strike), true);
  assert.equal(paragraph.content.some((node) => node.type === 'image'), true);
  assert.deepEqual(rich.outline.map((item) => item.title), ['格式保真测试']);
});

test('workspace upload validation rejects unsafe names, macro files and forged signatures', () => {
  assert.throws(() => service.validateUpload({
    originalname: '../bad.docx', mimetype: 'application/octet-stream', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  }), (error) => error.code === 40001);
  assert.throws(() => service.validateUpload({
    originalname: 'macro.docm', mimetype: 'application/octet-stream', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  }), (error) => error.code === 40001);
  assert.throws(() => service.validateUpload({
    originalname: 'forged.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf'),
  }), (error) => error.code === 40001);
  assert.equal(service.validateUpload({
    originalname: 'lesson.pptx', mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml ppt/presentation.xml')]),
  }).extension, '.pptx');
  assert.equal(service.validateUpload({
    originalname: 'legacy.ppt', mimetype: 'application/vnd.ms-powerpoint', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]),
  }).extension, '.ppt');
  assert.throws(() => service.validateUpload({
    originalname: 'forged.pptx', mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('not a pptx'),
  }), (error) => error.code === 40001);
});

test('student material filtering removes teacher-only sections unless answers are explicitly retained', () => {
  const source = '<h1>课堂任务单</h1><h2>学习任务</h2><p>完成练习。</p><h2>参考答案</h2><p>答案 A。</p><h2>教学反思</h2><p>教师内部内容。</p>';
  const filtered = service.studentSafeHtml(source, { include_answers: false });
  assert.match(filtered, /完成练习/);
  assert.equal(filtered.includes('答案 A'), false);
  assert.equal(filtered.includes('教师内部内容'), false);
  assert.match(service.studentSafeHtml(source, { include_answers: true }), /答案 A/);
});
