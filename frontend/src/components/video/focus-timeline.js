const FOCUS_TIMELINE_VERSION = 1

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function slideDurationMs(slide) {
  return Math.max(1, finiteNumber(slide?.durationMs, 1))
}

function explicitCue(rawCue, durationMs, bulletCount) {
  if (rawCue?.target && rawCue.target !== 'bullet') return null
  const targetIndex = Math.floor(finiteNumber(rawCue?.targetIndex ?? rawCue?.bulletIndex ?? rawCue?.index, -1))
  if (targetIndex < 0 || targetIndex >= bulletCount) return null

  const startMs = rawCue?.startRatio != null
    ? finiteNumber(rawCue.startRatio) * durationMs
    : finiteNumber(rawCue?.startMs)
  const endMs = rawCue?.endRatio != null
    ? finiteNumber(rawCue.endRatio) * durationMs
    : finiteNumber(rawCue?.endMs, durationMs)
  const start = clamp(startMs, 0, durationMs)
  const end = clamp(endMs, start, durationMs)
  if (end - start < 1) return null

  return {
    target: 'bullet',
    targetIndex,
    startMs: Math.round(start),
    endMs: Math.round(end),
    startRatio: start / durationMs,
    endRatio: end / durationMs,
    ...(rawCue?.label ? { label: String(rawCue.label) } : {}),
  }
}

/**
 * Produces the single canonical focus timeline consumed by the live preview and
 * Remotion export. API-provided cues win; older manifests get a deterministic
 * bullet-by-bullet fallback so refreshes never shift the focus order.
 */
export function buildSlideFocusTimeline(slide) {
  const bullets = Array.isArray(slide?.bullets) ? slide.bullets : []
  const durationMs = slideDurationMs(slide)
  const isCover = slide?.type === 'cover' || Number(slide?.page) === 1
  if (!bullets.length || isCover) return []

  const source = Array.isArray(slide?.focusCues)
    ? slide.focusCues
    : Array.isArray(slide?.focusTimeline)
      ? slide.focusTimeline
      : Array.isArray(slide?.focus_timeline) ? slide.focus_timeline : []
  const explicit = source
    .map(cue => explicitCue(cue, durationMs, bullets.length))
    .filter(Boolean)
    .sort((left, right) => left.startMs - right.startMs || left.targetIndex - right.targetIndex)
  if (explicit.length) return explicit

  // Ratios, rather than fixed milliseconds, keep the pre-video PPT preview
  // aligned with the final audio duration once the generated manifest arrives.
  const leadRatio = 0.08
  const tailRatio = 0.04
  const availableRatio = Math.max(0.5, 1 - leadRatio - tailRatio)
  return bullets.map((_, targetIndex) => {
    const startRatio = leadRatio + availableRatio * targetIndex / bullets.length
    const endRatio = leadRatio + availableRatio * (targetIndex + 1) / bullets.length
    return {
      target: 'bullet',
      targetIndex,
      startMs: Math.round(startRatio * durationMs),
      endMs: Math.round(endRatio * durationMs),
      startRatio,
      endRatio,
    }
  })
}

export function prepareFocusManifest(manifest) {
  if (!manifest) return manifest
  return {
    ...manifest,
    focusTimelineVersion: FOCUS_TIMELINE_VERSION,
    slides: (manifest.slides || []).map(slide => ({
      ...slide,
      focusTimeline: buildSlideFocusTimeline(slide),
    })),
  }
}

export function activeFocusCue(slide, elapsedMs) {
  const timeline = Array.isArray(slide?.focusTimeline)
    ? slide.focusTimeline
    : buildSlideFocusTimeline(slide)
  const durationMs = slideDurationMs(slide)
  const time = clamp(finiteNumber(elapsedMs), 0, durationMs)
  let cue = null
  timeline.forEach((item, index) => {
    if (time >= item.startMs && (time < item.endMs || (index === timeline.length - 1 && time === item.endMs))) cue = item
  })
  if (!cue) return null

  const cueDuration = Math.max(1, cue.endMs - cue.startMs)
  const fadeMs = Math.min(320, cueDuration / 3)
  const fadeIn = clamp((time - cue.startMs) / Math.max(1, fadeMs), 0, 1)
  const fadeOut = clamp((cue.endMs - time) / Math.max(1, fadeMs), 0, 1)
  return { ...cue, strength: Math.min(fadeIn, fadeOut) }
}

export function focusPreviewSlide(slide, durationMs = 12000) {
  if (!slide) return null
  const normalized = { ...slide, durationMs: Math.max(1, finiteNumber(slide.durationMs, durationMs)) }
  return { ...normalized, focusTimeline: buildSlideFocusTimeline(normalized) }
}
