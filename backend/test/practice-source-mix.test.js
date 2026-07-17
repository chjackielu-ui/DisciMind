'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const practiceService = require('../src/services/practice.service');

test('practice source mix validates totals, bounds and backward-compatible defaults', () => {
  const { normalizeSourceMix, MAX_AI_QUESTIONS_PER_PRACTICE } = practiceService.__test;

  assert.deepEqual(normalizeSourceMix({}, 10), {
    explicit: false,
    bankQuestionCount: 10,
    aiQuestionCount: 0,
  });
  assert.deepEqual(normalizeSourceMix({ sourceMix: { bankQuestionCount: 7, aiQuestionCount: 3 } }, 10), {
    explicit: true,
    bankQuestionCount: 7,
    aiQuestionCount: 3,
  });
  assert.deepEqual(normalizeSourceMix({ source_mix: { bank_question_count: 0, ai_question_count: 10 } }, 10), {
    explicit: true,
    bankQuestionCount: 0,
    aiQuestionCount: 10,
  });
  assert.throws(
    () => normalizeSourceMix({ sourceMix: { bankQuestionCount: 6, aiQuestionCount: 3 } }, 10),
    /之和必须等于总题数/,
  );
  assert.throws(
    () => normalizeSourceMix({ sourceMix: { bankQuestionCount: 11, aiQuestionCount: -1 } }, 10),
    /非负整数/,
  );
  assert.throws(
    () => normalizeSourceMix({ sourceMix: { bankQuestionCount: 0, aiQuestionCount: MAX_AI_QUESTIONS_PER_PRACTICE + 1 } }, MAX_AI_QUESTIONS_PER_PRACTICE + 1),
    /AI 题数量不能超过/,
  );
});

test('practice UI and backend carry an accessible source mix contract end to end', () => {
  const frontend = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/student-practice-center.js'), 'utf8');
  const backend = fs.readFileSync(path.resolve(__dirname, '../src/services/practice.service.js'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/student-complex.css'), 'utf8');

  assert.match(frontend, /type="range"/);
  assert.match(frontend, /aria-valuetext=/);
  assert.match(frontend, /sourceMix:\s*\{ bankQuestionCount, aiQuestionCount \}/);
  assert.match(backend, /sourceMix:\s*sourceMixAudit/);
  assert.match(backend, /actualBankQuestionCount/);
  assert.match(backend, /includeAiGenerated:\s*false/);
  assert.match(css, /\.source-mix-range:focus-visible/);
  assert.doesNotMatch(frontend, /📝|📋|⏱️|⏳/);
});

test('file generator orchestration prefill does not read an out-of-scope pointEntry', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/file-generator/file-requirement.service.js'), 'utf8');
  const orchestrationPrefill = source.slice(source.indexOf('async function prefillFromOrchestration'), source.indexOf('async function patchRequirements'));

  assert.ok(orchestrationPrefill.length > 0);
  assert.doesNotMatch(orchestrationPrefill, /pointEntry/);
  assert.match(orchestrationPrefill, /pointEntries\[0\]\[1\]\.knowledge_point_name/);
});
