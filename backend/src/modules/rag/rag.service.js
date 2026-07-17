const retriever = require('./retriever.service');
const sourceTrace = require('./source-trace.service');

async function retrieve(input) {
  const result = await retriever.retrieveCourseSources(input);
  const sources = sourceTrace.buildSourceTrace(result.sources);
  return {
    ...result,
    sources,
    context: sourceTrace.buildContext(sources, input?.maxContextChars),
    evidenceStatus: sources.length ? 'SUFFICIENT' : 'INSUFFICIENT',
  };
}

async function buildGroundedPrompt(input) {
  const result = await retrieve(input);
  const instruction = result.sources.length
    ? '请仅依据下列课程资料回答；资料不足时明确说明不足，不得编造来源。'
    : '当前课程资料未检索到可用证据，请明确说明资料不足，并建议用户补充材料或换一种问法。';
  return {
    ...result,
    prompt: `${instruction}\n\n课程资料：\n${result.context || '（无可用资料）'}\n\n问题：${String(input.question).trim()}`,
  };
}

module.exports = { retrieve, buildGroundedPrompt };
