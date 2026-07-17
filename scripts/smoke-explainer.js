#!/usr/bin/env node

const baseUrl = process.env.DISCIMIND_API_BASE_URL || 'http://localhost:3000/api';
const token = process.env.DISCIMIND_ACCESS_TOKEN;
const enabled = process.env.RUN_DIFY_SMOKE === 'true';
const knowledgePointId = process.env.SMOKE_KNOWLEDGE_POINT_ID;

async function main() {
  if (!enabled) {
    console.log('Skip: set RUN_DIFY_SMOKE=true to call the real Explainer endpoint.');
    return;
  }
  if (!token || !knowledgePointId) {
    throw new Error('DISCIMIND_ACCESS_TOKEN and SMOKE_KNOWLEDGE_POINT_ID are required.');
  }

  const response = await fetch(`${baseUrl}/agent/explainer/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      knowledgePointId: Number(knowledgePointId),
      message: process.env.SMOKE_EXPLAINER_MESSAGE || '请用简短方式解释这个知识点的核心概念。',
      strategyHint: process.env.SMOKE_EXPLAINER_STRATEGY || 'auto',
      learningSessionId: `smoke_${Date.now()}`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Explainer smoke failed: HTTP ${response.status} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sawDelta = false;
  let sawDone = false;
  while (!sawDone) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    process.stdout.write(chunk);
    if (chunk.includes('event: delta')) sawDelta = true;
    if (chunk.includes('event: done')) sawDone = true;
  }
  if (!sawDelta || !sawDone) {
    throw new Error(`Explainer smoke did not receive expected SSE events: delta=${sawDelta}, done=${sawDone}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
