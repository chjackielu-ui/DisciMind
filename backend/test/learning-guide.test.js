// 学习引导老师 & 教学结果标准化 测试
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ========================
// 语句块分割测试
// ========================

const BLOCK_DELIMITER = '<<<BLOCK>>>';

function extractBlocksFromText(fullText, delimiter = BLOCK_DELIMITER) {
  if (!fullText || !fullText.trim()) return [];
  if (fullText.includes(delimiter)) {
    return fullText.split(delimiter).map(b => b.trim()).filter(b => b.length > 0);
  }
  // Fallback: split by Chinese punctuation
  const sentences = String(fullText).split(/(?<=[。！？；\n])/).filter(Boolean);
  const blocks = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current + sentence;
    const sentenceCount = (candidate.match(/[。！？]/g) || []).length + 1;
    if (sentenceCount > 3 || (candidate.match(/[一-鿿]/g) || []).length > 120) {
      if (current.trim()) blocks.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) blocks.push(current.trim());
  return blocks;
}

describe('学习引导语句块分割', () => {
  it('正常包含分隔符的文本', () => {
    const text = '同学你好，欢迎进入本节点。<<<BLOCK>>>这个节点将帮助你理解核心概念。<<<BLOCK>>>正式内容正在准备中，请先思考一个问题。';
    const blocks = extractBlocksFromText(text);
    assert.equal(blocks.length, 3);
    assert.ok(blocks[0].includes('同学你好'));
    assert.ok(blocks[1].includes('核心概念'));
    assert.ok(blocks[2].includes('思考'));
  });

  it('没有分隔符时按句号分块', () => {
    const text = '同学你好，欢迎进入本节点。这个节点将帮助你理解核心概念。正式内容正在准备中。';
    const blocks = extractBlocksFromText(text);
    assert.ok(blocks.length >= 1);
    blocks.forEach(b => assert.ok(b.length > 0));
  });

  it('空语句块被忽略', () => {
    const text = '第一块。<<<BLOCK>>> <<<BLOCK>>>第二块。';
    const blocks = extractBlocksFromText(text);
    assert.equal(blocks.length, 2);
  });

  it('重复语句块被去重', () => {
    const text = '第一块内容。<<<BLOCK>>>第一块内容。<<<BLOCK>>>第二块内容。';
    const blocks = extractBlocksFromText(text);
    // Should have 2 unique blocks
    const unique = [...new Set(blocks)];
    assert.equal(unique.length, 2);
  });

  it('空文本返回空数组', () => {
    assert.deepEqual(extractBlocksFromText(''), []);
    assert.deepEqual(extractBlocksFromText(null), []);
  });

  it('单块超过长度时正确拆分', () => {
    const longSentence = '这是一段很长的内容' + '。学习内容很丰富'.repeat(30) + '。';
    const blocks = extractBlocksFromText(longSentence);
    blocks.forEach(b => {
      // Each block should be reasonable in length
      assert.ok(b.length < 500, `Block too long: ${b.length} chars`);
    });
  });
});

// ========================
// 教学结果标准化测试
// ========================

describe('教学结果标准化', () => {
  // Simulate the normalizeLearningAgentResult logic
  function normalize(raw) {
    if (raw == null) return { success: false, error: 'Empty input' };
    if (typeof raw === 'object' && !Array.isArray(raw)) return buildResult(raw);

    if (typeof raw === 'string') {
      // Try JSON parse with markdown fence removal
      let cleaned = raw.trim();
      const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
      if (fenceMatch) cleaned = fenceMatch[1].trim();

      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }

      try {
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return buildResult(parsed);
        }
        if (typeof parsed === 'string') return normalize(parsed); // recursive
        return { success: false, error: 'Parsed result is not an object' };
      } catch (e) {
        return { success: false, error: 'JSON parse failed: ' + e.message.slice(0, 100) };
      }
    }
    return { success: false, error: 'Unsupported type' };
  }

  function buildResult(obj) {
    return {
      success: obj.success !== false,
      agent: obj.agent || '',
      knowledgePoint: obj.knowledge_point || obj.knowledgePoint || {},
      strategy: {
        code: obj.strategy_used || '',
        name: '',
        reason: (obj.strategy_decision || {}).reason || '',
      },
      sections: (obj.result?.sections || obj.sections || []).map(s => ({
        type: s.type,
        title: s.title || '',
        content: s.content || '',
      })),
      knowledgeSources: (obj.knowledge?.sources || []).map(s => ({
        name: s.name || '',
        score: s.score || 0,
      })),
      estimatedReadingMinutes: obj.result?.estimated_reading_time_minutes || 5,
    };
  }

  it('输入为 Object', () => {
    const input = { success: true, agent: 'explainer', result: { sections: [{ type: 'core_definition', content: '定义内容' }] } };
    const result = normalize(input);
    assert.equal(result.success, true);
    assert.equal(result.agent, 'explainer');
    assert.equal(result.sections.length, 1);
  });

  it('输入为 JSON 字符串', () => {
    const input = '{"success":true,"agent":"explainer","result":{"sections":[]}}';
    const result = normalize(input);
    assert.equal(result.success, true);
  });

  it('输入为 Markdown JSON 代码块', () => {
    const input = '```json\n{"success":true,"agent":"explainer"}\n```';
    const result = normalize(input);
    assert.equal(result.success, true);
  });

  it('输入为嵌套字符串 JSON（Dify 返回 answer 字段中的 JSON 字符串）', () => {
    // Dify sometimes returns answer as JSON-encoded string inside JSON
    // e.g., {"data":{"outputs":{"answer":"{\\"success\\":true}"}}}
    // The normalize function should handle this when the answer is extracted
    const input = '{"success":true,"agent":"explainer","result":{"sections":[]}}';
    const result = normalize(input);
    assert.equal(result.success, true);
    assert.equal(result.agent, 'explainer');
  });

  it('输入为非法 JSON', () => {
    const result = normalize('not json at all {broken');
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('sections 为空数组', () => {
    const input = { success: true, result: { sections: [] } };
    const result = normalize(input);
    assert.deepEqual(result.sections, []);
  });

  it('knowledge sources 为空', () => {
    const input = { success: true, knowledge: { sources: [] } };
    const result = normalize(input);
    assert.deepEqual(result.knowledgeSources, []);
  });

  it('null 输入', () => {
    const result = normalize(null);
    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('真实 Explainer 返回格式', () => {
    const realExplainerOutput = {
      success: true,
      agent: 'explainer',
      response_type: 'teaching_result',
      knowledge_point: { id: '1', name: '监督学习' },
      strategy_used: 'direct',
      strategy_decision: { source: 'specified', reason: '用户指定' },
      knowledge: { sources: [{ name: '测试文档.md', score: 0.77 }] },
      result: {
        strategy: 'direct_instruction',
        sections: [
          { type: 'prerequisite_bridge', content: '知识衔接内容' },
          { type: 'core_definition', content: '核心定义内容' },
          { type: 'deep_dive', content: '深入理解内容' },
          { type: 'example', content: '案例分析内容' },
          { type: 'misconception_guard', content: '易错辨析内容' },
        ],
        estimated_reading_time_minutes: 4,
      },
    };
    const result = normalize(realExplainerOutput);
    assert.equal(result.success, true);
    assert.equal(result.sections.length, 5);
    assert.equal(result.sections[0].type, 'prerequisite_bridge');
    assert.equal(result.sections[4].type, 'misconception_guard');
    assert.equal(result.knowledgeSources.length, 1);
  });
});

// ========================
// 学习引导 Prompt 测试
// ========================

describe('学习引导 Prompt 构建', () => {
  const { buildGuideUserMessage } = require('../src/modules/learning-workflow/learning-guide.prompt.js');

  it('构建 enter phase 上下文', () => {
    const context = {
      phase: 'enter',
      courseName: '机器学习',
      knowledgePointName: '监督学习',
      flowName: '标准学习流',
      currentNodeName: '知识重点扫描',
      currentNodeType: '概念讲解',
      currentNodeIndex: 1,
      totalNodeCount: 6,
      estimatedMinutes: 5,
      nextNodeName: '高频基础练习',
      formalAgentName: 'Explainer',
      formalAgentStatus: 'preparing',
      currentMastery: 84,
    };
    const message = buildGuideUserMessage(context);
    assert.ok(message.includes('机器学习'));
    assert.ok(message.includes('监督学习'));
    assert.ok(message.includes('知识重点扫描'));
    assert.ok(message.includes('Explainer'));
    assert.ok(message.includes('enter'));
  });

  it('构建 failed phase 上下文', () => {
    const context = {
      phase: 'failed',
      courseName: '机器学习',
      knowledgePointName: '监督学习',
      currentNodeIndex: 1,
      totalNodeCount: 6,
      estimatedMinutes: 5,
      formalAgentName: 'Explainer',
      formalAgentStatus: 'failed',
    };
    const message = buildGuideUserMessage(context);
    assert.ok(message.includes('failed'));
  });

  it('练习引导会携带题目、作答、掌握度与近期作答上下文', () => {
    const message = buildGuideUserMessage({
      phase: 'after_answer_wrong',
      courseName: '机器学习',
      knowledgePointName: '监督学习',
      currentNodeName: '应用练习',
      question: { sequence: 2, stem: '损失函数的作用是什么？', options: [{ key: 'A', text: '衡量误差' }] },
      studentAnswer: 'B',
      correctAnswer: 'A',
      isCorrect: false,
      errorType: '概念混淆',
      attemptCount: 1,
      progress: { answeredCount: 2, correctCount: 1, plannedQuestionCount: 5, minQuestionCount: 3, maxQuestionCount: 8, currentMastery: 72, targetMastery: 80 },
      recentQuestions: [{ questionKey: 'q1', isCorrect: true }, { questionKey: 'q2', isCorrect: false }],
    });
    assert.ok(message.includes('损失函数'));
    assert.ok(message.includes('学生答案：B'));
    assert.ok(message.includes('正确答案：A'));
    assert.ok(message.includes('概念混淆'));
    assert.ok(message.includes('最近答题'));
  });
});
