import test from 'node:test'
import assert from 'node:assert/strict'
import { activeFocusCue, buildSlideFocusTimeline, prepareFocusManifest } from './focus-timeline.js'

test('fallback focus timeline is deterministic and covers every bullet in order', () => {
  const slide = { durationMs: 10000, bullets: ['定义', '公式', '例子'] }
  const first = buildSlideFocusTimeline(slide)
  const second = buildSlideFocusTimeline(structuredClone(slide))
  assert.deepEqual(first, second)
  assert.deepEqual(first.map(item => item.targetIndex), [0, 1, 2])
  assert.ok(first.every(item => item.startMs < item.endMs))
  assert.deepEqual(first.map(item => [item.startRatio, item.endRatio]), buildSlideFocusTimeline({ ...slide, durationMs: 30000 }).map(item => [item.startRatio, item.endRatio]))
})

test('API focusCues are preferred, normalized and invalid targets are ignored', () => {
  const timeline = buildSlideFocusTimeline({
    durationMs: 8000,
    bullets: ['第一条', '第二条'],
    focusCues: [
      { target: 'bullet', index: 1, startRatio: 0.5, endRatio: 0.9, label: '第二条' },
      { target: 'image', index: 0, startMs: 0, endMs: 4000 },
      { target: 'bullet', index: 9, startMs: 0, endMs: 4000 },
    ],
    focusTimeline: [{ bulletIndex: 0, startMs: 0, endMs: 8000 }],
  })
  assert.equal(timeline.length, 1)
  assert.deepEqual(timeline[0], {
    target: 'bullet', targetIndex: 1, startMs: 4000, endMs: 7200, startRatio: 0.5, endRatio: 0.9, label: '第二条',
  })
})

test('preview and export share the exact prepared timeline', () => {
  const manifest = prepareFocusManifest({ slides: [{ page: 2, durationMs: 6000, bullets: ['概念一', '概念二'] }] })
  const slide = manifest.slides[0]
  assert.equal(activeFocusCue(slide, 2000).targetIndex, 0)
  assert.equal(activeFocusCue(slide, 4000).targetIndex, 1)
  assert.equal(manifest.focusTimelineVersion, 1)
})

test('cover slides remain unfocused in both preview and export', () => {
  assert.deepEqual(buildSlideFocusTimeline({ page: 1, type: 'cover', durationMs: 5000, bullets: ['封面说明'] }), [])
})
