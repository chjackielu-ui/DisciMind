const test = require('node:test');
const assert = require('node:assert/strict');
const { Packer } = require('docx');
const JSZip = require('jszip');
const { buildAcceptanceDocument } = require('../scripts/generate-docx-acceptance-sample');

test('rich lesson-plan Document AST exports tables, images, native formulas, code, lists and page breaks', async () => {
  const { document, rich } = await buildAcceptanceDocument();
  const nodeTypes = rich.contentJson.content.map((node) => node.type);
  for (const expected of ['heading', 'paragraph', 'list', 'table', 'code_block', 'blockquote', 'page_break']) assert.ok(nodeTypes.includes(expected), `missing ${expected}`);
  assert.ok(rich.contentJson.content.some((node) => node.type === 'image' || node.content?.some((item) => item.type === 'image')));
  assert.ok(rich.contentJson.content.some((node) => node.content?.some((item) => item.type === 'formula')));

  const bytes = await Packer.toBuffer(document);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml').async('string');
  const relationships = await zip.file('word/_rels/document.xml.rels').async('string');
  assert.match(xml, /<w:tbl>/);
  assert.match(xml, /<w:tblHeader\/>/);
  assert.match(xml, /<w:tblGrid>/);
  assert.match(xml, /<w:drawing>/);
  assert.match(xml, /<m:oMath>/);
  assert.match(xml, /<m:f>/);
  assert.match(xml, /<m:sSub>/);
  assert.match(xml, /<m:sSup>/);
  assert.match(xml, /for epoch in range/);
  assert.match(xml, /gradient = X\.T/);
  assert.match(xml, /theta = theta - learning_rate/);
  assert.match(xml, /<w:br w:type="page"\/>/);
  assert.doesNotMatch(xml, /\\frac|\\sum|\$\$/);
  assert.match(relationships, /Target="media\//);
  assert.ok(Object.keys(zip.files).some((name) => /^word\/media\//.test(name)));
});
