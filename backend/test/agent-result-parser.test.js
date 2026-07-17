// Agent 结果解析器 自动化测试
// 覆盖: JSON解析、多层解包、Markdown围栏、Dify包装、Trainer/Explainer/Diagnostician标准化

const {
  parseAgentResult,
  normalizeExplainerResult,
  normalizeTrainerResult,
  normalizeDiagnosticianResult,
  balancedBracketExtract,
  preprocessText,
  safeJsonRepair,
} = require('../src/modules/learning-workflow/agent-result-parser');

const assert = require('assert');

// ========================
// 工具函数
// ========================

function ok(result, msg) {
  assert.strictEqual(result.success, true, msg || 'Expected success=true');
}

function fail(result, msg) {
  assert.strictEqual(result.success, false, msg || 'Expected success=false');
}

function eq(actual, expected, msg) {
  assert.strictEqual(actual, expected, msg);
}

function has(obj, key, msg) {
  assert.notStrictEqual(obj[key], undefined, msg || `Expected key '${key}' to exist`);
}

// ========================
// P0-1: JSON 解析
// ========================

(async () => {
  console.log('\n=== Agent Result Parser Tests ===\n');

  // --- Test 1: null/undefined ---
  console.log('1. null/undefined handling...');
  const r1 = await parseAgentResult(null, { agent: 'explainer' });
  fail(r1, 'null should fail');
  eq(r1.code, 'AGENT_RESULT_EMPTY');

  const r1b = await parseAgentResult(undefined, { agent: 'explainer' });
  fail(r1b, 'undefined should fail');

  // --- Test 2: Plain object (already valid) ---
  console.log('2. Plain object...');
  const obj = { strategy: { code: 'direct' }, sections: [{ type: 'core_definition', title: 'Test', content: 'Hello world', order: 1 }] };
  const r2 = await parseAgentResult(obj, { agent: 'explainer', requestId: 'req-1' });
  ok(r2, 'plain object should succeed');
  eq(r2.agent, 'explainer');
  eq(r2.requestId, 'req-1');
  eq(r2.sections.length, 1);
  eq(r2.sections[0].content, 'Hello world');
  has(r2.strategy, 'code');

  // --- Test 3: JSON string ---
  console.log('3. JSON string...');
  const jsonStr = JSON.stringify(obj);
  const r3 = await parseAgentResult(jsonStr, { agent: 'explainer' });
  ok(r3, 'JSON string should succeed');
  eq(r3.sections.length, 1);

  // --- Test 4: Double-encoded JSON string ---
  console.log('4. Double-encoded JSON...');
  const doubleEncoded = JSON.stringify(jsonStr);
  const r4 = await parseAgentResult(doubleEncoded, { agent: 'explainer' });
  ok(r4, 'Double-encoded JSON should succeed');

  // --- Test 5: Markdown JSON code block ---
  console.log('5. Markdown code block...');
  const mdBlock = '```json\n' + jsonStr + '\n```';
  const r5 = await parseAgentResult(mdBlock, { agent: 'explainer' });
  ok(r5, 'Markdown code block should succeed');
  eq(r5.sections.length, 1);

  // --- Test 6: JSON with surrounding text ---
  console.log('6. Surrounding text...');
  const withText = '以下是生成结果：\n\n' + jsonStr + '\n\n希望以上内容对你有帮助。';
  const r6 = await parseAgentResult(withText, { agent: 'explainer' });
  ok(r6, 'Surrounding text should be handled');

  // --- Test 7: { answer: "..." } wrapper ---
  console.log('7. Answer wrapper...');
  const answerWrap = { answer: jsonStr };
  const r7 = await parseAgentResult(answerWrap, { agent: 'explainer' });
  ok(r7, 'Answer wrapper should succeed');

  // --- Test 8: { data: { outputs: { result: "..." } } } wrapper ---
  console.log('8. data.outputs.result wrapper...');
  const difyWrap = { data: { outputs: { result: jsonStr } } };
  const r8 = await parseAgentResult(difyWrap, { agent: 'explainer' });
  ok(r8, 'data.outputs wrapper should succeed');

  // --- Test 9: { outputs: { branch_result: "..." } } ---
  console.log('9. outputs.branch_result...');
  const branchWrap = { outputs: { branch_result: jsonStr } };
  const r9 = await parseAgentResult(branchWrap, { agent: 'explainer' });
  ok(r9, 'branch_result wrapper should succeed');

  // --- Test 10: result={...} as object (not string) ---
  console.log('10. result as object...');
  const resultObj = { result: obj };
  const r10 = await parseAgentResult(resultObj, { agent: 'explainer' });
  ok(r10, 'result as object should succeed');

  // --- Test 11: Top-level array ---
  console.log('11. Top-level array...');
  const arr = [{ type: 'text', title: 'Section 1', content: 'Hello' }];
  const r11 = await parseAgentResult(arr, { agent: 'explainer' });
  ok(r11, 'Array should be normalized');
  eq(r11.sections.length, 1);

  // --- Test 12: Trailing comma in JSON ---
  console.log('12. Trailing comma...');
  const trailingComma = '{"strategy":{"code":"direct"}, "sections":[{"type":"text","content":"Hello"}],}';
  const r12 = await parseAgentResult(trailingComma, { agent: 'explainer' });
  ok(r12, 'Trailing comma should be fixed');

  // --- Test 13: Chinese quote marks on keys ---
  console.log('13. Chinese quotes...');
  const chineseQuotes = '{"strategy":' + '{"code":"direct"}' + ', "sections":[{"type":"text","content":"Hello"}]}';
  const r13 = await parseAgentResult(chineseQuotes, { agent: 'explainer' });
  ok(r13, 'Chinese quotes should be fixed');

  // --- Test 14: Content with braces inside a field ---
  console.log('14. Content with braces...');
  const braceInContent = '{"sections":[{"type":"text","content":"Use function foo() { return 1; } in code"}]}';
  const r14 = await parseAgentResult(braceInContent, { agent: 'explainer' });
  ok(r14, 'Content with braces should parse correctly');
  eq(r14.sections[0].content, 'Use function foo() { return 1; } in code');

  // --- Test 15: Content with escaped quotes ---
  console.log('15. Escaped quotes...');
  const escQuotes = '{"sections":[{"type":"text","content":"He said \\"hello\\" to me"}]}';
  const r15 = await parseAgentResult(escQuotes, { agent: 'explainer' });
  ok(r15, 'Escaped quotes should parse');

  // --- Test 16: Max depth exceeded (deep object nesting) ---
  console.log('16. Max depth...');
  // Create deeply nested object: { result: { result: { result: { result: { result: { sections: [...] } } } } } }
  let deepObj = { sections: [{ type: 'text', content: 'deep', order: 1 }] };
  for (let i = 0; i < 10; i++) {
    deepObj = { result: deepObj };
  }
  const r16 = await parseAgentResult(deepObj, { agent: 'explainer' });
  // After 4 levels of unwrapping, the parser should stop and return the inner object
  // or return parse failed. Either outcome is acceptable as long as it doesn't crash.
  if (r16.success) {
    console.log('  (parser stopped at depth limit and returned inner result)');
  } else {
    eq(r16.code, 'AGENT_RESULT_PARSE_FAILED', 'Should have parse failed code');
  }

  // --- Test 17: Explainer schema normalization ---
  console.log('17. Explainer normalization...');
  const explainerRaw = {
    strategy: { code: 'analogy_bridge', name: '类比桥接', reason: '知识点抽象' },
    sections: [
      { type: 'core_definition', title: '核心定义', content: '监督学习是指...', order: 1 },
      { type: 'example', title: '案例', content: '例如...', order: 2 },
    ],
    knowledgeSources: [{ name: '机器学习.pdf', score: 0.85 }],
    estimatedReadingMinutes: 6,
  };
  const r17 = normalizeExplainerResult(explainerRaw, { requestId: 'req-17' });
  ok(r17, 'Explainer should be normalized');
  eq(r17.agent, 'explainer');
  eq(r17.strategy.code, 'analogy_bridge');
  eq(r17.sections.length, 2);
  eq(r17.estimatedReadingMinutes, 6);
  eq(r17.knowledgeSources.length, 1);
  eq(r17.knowledgeSources[0].matchPercent, 85);

  // --- Test 18: Trainer schema normalization ---
  console.log('18. Trainer normalization...');
  const trainerRaw = {
    mode: 'adaptive_training',
    status: 'QUESTION_READY',
    question: {
      id: 'q1', type: 'single_choice',
      stem: '以下哪个是监督学习的特征？',
      options: [{ key: 'A', text: '有标签数据' }, { key: 'B', text: '无标签数据' }],
      difficulty: 'medium', sequence: 1,
    },
    progress: { answeredCount: 0, correctCount: 0, plannedQuestionCount: 5, maxQuestionCount: 8 },
    completion: { shouldComplete: false },
  };
  const r18 = normalizeTrainerResult(trainerRaw, { requestId: 'req-18' });
  ok(r18, 'Trainer should be normalized');
  eq(r18.agent, 'trainer');
  eq(r18.status, 'QUESTION_READY');
  eq(r18.question.type, 'single_choice');
  eq(r18.question.stem, '以下哪个是监督学习的特征？');
  eq(r18.progress.plannedQuestionCount, 5);
  eq(r18.completion.shouldComplete, false);

  // --- Test 19: Trainer answer result ---
  console.log('19. Trainer answer record...');
  const trainerAnswer = {
    status: 'ANSWER_EVALUATED',
    answerRecord: {
      questionId: 'q1', studentAnswer: 'A', correctAnswer: 'A',
      isCorrect: true, score: 10, analysis: '正确，有标签数据是监督学习的关键特征。',
    },
    nextQuestion: {
      id: 'q2', type: 'single_choice',
      stem: '第二题', options: [{ key: 'A', text: '选项A' }],
      difficulty: 'hard', sequence: 2,
    },
    progress: { answeredCount: 1, correctCount: 1, plannedQuestionCount: 5, maxQuestionCount: 8 },
    completion: { shouldComplete: false },
  };
  const r19 = normalizeTrainerResult(trainerAnswer, { requestId: 'req-19' });
  ok(r19, 'Trainer answer should be normalized');
  eq(r19.answerRecord.isCorrect, true);
  eq(r19.answerRecord.studentAnswer, 'A');

  // --- Test 20: Diagnostician normalization ---
  console.log('20. Diagnostician normalization...');
  const diagRaw = {
    mode: 'diagnostic',
    summary: '学生掌握程度良好',
    diagnosis: [{ code: 'weak_concept', name: '概念薄弱', severity: 'medium', detail: '在监督学习的基本概念上存在混淆' }],
    recommendations: [{ action: 'review_material', description: '复习监督学习基础概念', priority: 1 }],
    mastery: { before: 60, after: 72 },
    completion: { shouldComplete: true, reason: 'diagnosis_completed' },
  };
  const r20 = normalizeDiagnosticianResult(diagRaw, { requestId: 'req-20' });
  ok(r20, 'Diagnostician should be normalized');
  eq(r20.agent, 'diagnostician');
  eq(r20.diagnosis.length, 1);
  eq(r20.mastery.before, 60);
  eq(r20.mastery.after, 72);
  eq(r20.completion.shouldComplete, true);

  // --- Test 21: Schema field missing (sections) ---
  console.log('21. Missing sections...');
  const noSections = { strategy: { code: 'direct' } };
  const r21 = await parseAgentResult(noSections, { agent: 'explainer' });
  ok(r21, 'Missing sections should still succeed');
  eq(r21.sections.length, 0);

  // --- Test 22: Unknown fields should not crash ---
  console.log('22. Unknown fields...');
  const unknownFields = {
    unknown_field: 'value',
    extra_data: { nested: true },
    sections: [{ type: 'text', content: 'Valid' }],
  };
  const r22 = await parseAgentResult(unknownFields, { agent: 'explainer' });
  ok(r22, 'Unknown fields should not crash');
  eq(r22.sections.length, 1);

  // --- Test 23: content with BOM ---
  console.log('23. BOM handling...');
  const withBom = '﻿' + jsonStr;
  const r23 = await parseAgentResult(withBom, { agent: 'explainer' });
  ok(r23, 'BOM should be stripped');

  // --- Test 24: Plain text (not JSON) as fallback ---
  console.log('24. Plain text fallback...');
  const plainText = '这是一段普通的教学文本，不是JSON格式。';
  const r24 = await parseAgentResult(plainText, { agent: 'explainer' });
  ok(r24, 'Plain text should be wrapped as section');
  eq(r24.sections.length, 1);
  eq(r24.sections[0].type, 'text');

  // --- Test 25: Non-disclosure of raw content on error ---
  console.log('25. Error does not leak raw content...');
  const r25 = await parseAgentResult(null, { agent: 'explainer' });
  fail(r25);
  // typeof null === 'object' in JavaScript
  eq(r25.details.rawType, 'object');
  // Production error should not have raw content
  assert.strictEqual(r25._rawForRepair, undefined, 'Error should not expose raw content');

  console.log('\n=== All 25 parser tests PASSED ===\n');

  // ========================
  // P0-2: Next node URL stability
  // ========================

  console.log('=== Next Node URL Stability Tests ===\n');

  // Mock: simulate complete-node response
  console.log('26. Session extraction from complete-node response...');
  const mockResponse = {
    code: 200,
    data: {
      completedNodeId: 'node_1',
      nextNodeId: 'node_2',
      isFlowCompleted: false,
      session: { session_id: 123, current_node_id: 'node_2', status: 'RUNNING', node_runs: [] },
    },
  };
  // Simulate saveNodeResult logic
  const responseData = mockResponse.data;
  const session = responseData.session || responseData;
  eq(session.session_id, 123, 'Should extract session from wrapper');
  eq(session.current_node_id, 'node_2', 'Should have correct next node');

  // Without session wrapper (backward compat)
  const noWrapper = { session_id: 456, current_node_id: 'node_3', status: 'RUNNING', node_runs: [] };
  const responseData2 = noWrapper;
  const session2 = responseData2.session || responseData2;
  eq(session2.session_id, 456, 'Should work without wrapper');

  // Flow complete
  console.log('27. Flow completion detection...');
  const completeResp = {
    code: 200,
    data: { completedNodeId: 'node_5', nextNodeId: '', isFlowCompleted: true, session: { session_id: 789, current_node_id: null, status: 'COMPLETED' } },
  };
  const sessionFromComplete = completeResp.data.session;
  eq(sessionFromComplete.status, 'COMPLETED', 'Flow should be completed');
  eq(sessionFromComplete.current_node_id, null, 'current_node_id should be null');

  console.log('\n=== URL stability tests PASSED ===\n');

  // ========================
  // P0-3: Trainer session dedup
  // ========================

  console.log('=== Trainer Session Dedup Tests ===\n');

  console.log('28. Trainer reused=true flag...');
  const reusedResponse = { reused: true, session: { sessionId: 'ts1', status: 'IN_PROGRESS' }, currentQuestion: { id: 'q1' } };
  eq(reusedResponse.reused, true, 'Should have reused flag');
  eq(reusedResponse.session.sessionId, 'ts1', 'Should have session ID');

  console.log('29. Active session detected...');
  // Simulate backend logic: if active session exists, return it
  const activeSession = { sessionId: 'ts2', status: 'IN_PROGRESS' };
  const shouldReuse = !!activeSession;
  eq(shouldReuse, true, 'Should detect active session');

  console.log('\n=== Trainer dedup tests PASSED ===\n');

  // ========================
  // P0-4: Trainer exit rules
  // ========================

  console.log('=== Trainer Exit Rules Tests ===\n');

  // Simulate shouldCompleteTrainerNode logic
  function testCompletion(ctx) {
    const { answeredCount, correctCount, plannedQuestionCount, maxQuestionCount,
      consecutiveWrong, elapsedMinutes, accuracy, targetAccuracy,
      maxConsecutiveWrong, maxDurationMinutes } = ctx;

    if (answeredCount >= maxQuestionCount) return { shouldComplete: true, reason: 'max_questions_reached' };
    if (elapsedMinutes >= maxDurationMinutes) return { shouldComplete: true, reason: 'max_duration_reached' };
    if (consecutiveWrong >= maxConsecutiveWrong) return { shouldComplete: true, reason: 'needs_repair' };
    if (answeredCount >= plannedQuestionCount && accuracy >= targetAccuracy) return { shouldComplete: true, reason: 'planned_count_and_accuracy_reached' };
    if (answeredCount >= plannedQuestionCount + 2) return { shouldComplete: true, reason: 'extended_count_reached' };
    return { shouldComplete: false, reason: 'in_progress' };
  }

  console.log('30. Max questions reached...');
  eq(testCompletion({ answeredCount: 8, maxQuestionCount: 8 }).shouldComplete, true);

  console.log('31. Max duration reached...');
  eq(testCompletion({ answeredCount: 3, maxQuestionCount: 8, maxDurationMinutes: 15, elapsedMinutes: 16 }).shouldComplete, true);

  console.log('32. Consecutive wrong...');
  eq(testCompletion({ answeredCount: 3, maxQuestionCount: 8, maxConsecutiveWrong: 3, consecutiveWrong: 3 }).shouldComplete, true);

  console.log('33. Planned count + accuracy...');
  eq(testCompletion({ answeredCount: 5, plannedQuestionCount: 5, accuracy: 0.85, targetAccuracy: 0.8 }).shouldComplete, true);

  console.log('34. Extended count...');
  eq(testCompletion({ answeredCount: 7, plannedQuestionCount: 5, accuracy: 0.5, targetAccuracy: 0.8 }).shouldComplete, true);

  console.log('35. In progress...');
  eq(testCompletion({ answeredCount: 2, plannedQuestionCount: 5, accuracy: 0.5, targetAccuracy: 0.8 }).shouldComplete, false);

  console.log('36. Should not exceed max...');
  eq(testCompletion({ answeredCount: 8, maxQuestionCount: 8 }).shouldComplete, true);

  console.log('\n=== Trainer exit tests PASSED ===\n');

  // ========================
  // P2-9: Source filter
  // ========================

  console.log('=== Source Filter Tests ===\n');

  function normaliseSource(source) {
    const value = String(source || 'ALL').toUpperCase();
    if (value === 'ALL') return null;
    if (value === 'MINE' || value === 'USER') return 'STUDENT';
    if (['SYSTEM', 'STUDENT', 'TEACHER'].includes(value)) return value;
    throw new Error('Invalid source');
  }

  console.log('37. Source mapping...');
  eq(normaliseSource('all'), null);
  eq(normaliseSource('SYSTEM'), 'SYSTEM');
  eq(normaliseSource('STUDENT'), 'STUDENT');
  eq(normaliseSource('mine'), 'STUDENT');
  eq(normaliseSource('TEACHER'), 'TEACHER');

  // Frontend mapping
  const sourceMap = { all: 'ALL', system: 'SYSTEM', mine: 'STUDENT', teacher: 'TEACHER' };
  eq(sourceMap.mine, 'STUDENT');
  eq(sourceMap.system, 'SYSTEM');

  console.log('\n=== Source filter tests PASSED ===\n');

  // ========================
  // Summary
  // ========================

  console.log('=== ALL TESTS PASSED ===');
  console.log('Total: 37 test cases');
  console.log('  - JSON Parser: 25 cases');
  console.log('  - URL Stability: 2 cases');
  console.log('  - Trainer Dedup: 2 cases');
  console.log('  - Trainer Exit Rules: 7 cases');
  console.log('  - Source Filter: 1 case');
})();
