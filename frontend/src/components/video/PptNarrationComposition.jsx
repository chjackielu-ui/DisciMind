import React from 'react'
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame } from 'remotion'
import { Audio } from '@remotion/media'
import { activeFocusCue } from './focus-timeline.js'

const palette = {
  ink: '#14324A', muted: '#607B8D', accent: '#2188A5', pale: '#E7F3F7', canvas: '#F8FBFC', white: '#FFFFFF',
}

function SlideFrame({ slide, courseTitle, fps }) {
  const frame = useCurrentFrame()
  const duration = Math.max(1, Number(slide.durationInFrames || 1))
  const enter = interpolate(frame, [0, Math.min(10, duration - 1)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const exitStart = Math.max(0, duration - 8)
  const exit = interpolate(frame, [exitStart, duration - 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const opacity = Math.min(enter, exit)
  const elapsedMs = frame / Math.max(1, Number(fps || 24)) * 1000
  const subtitle = (slide.subtitles || []).find((item) => elapsedMs >= item.startMs && elapsedMs < item.endMs)?.text
  const isCover = slide.type === 'cover' || Number(slide.page) === 1
  const focusCue = isCover ? null : activeFocusCue(slide, elapsedMs)
  const focusStrength = focusCue?.strength || 0
  const surroundingOpacity = 1 - focusStrength * .72

  return <AbsoluteFill style={{ background: palette.canvas, color: palette.ink, fontFamily: '"Microsoft YaHei", "Noto Sans SC", sans-serif', opacity }}>
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(33,136,165,.08), transparent 48%)' }} />
    {isCover ? <>
      <div style={{ position: 'absolute', left: 70, top: 82, width: 94, height: 8, borderRadius: 8, background: palette.accent }} />
      <div style={{ position: 'absolute', left: 72, top: 150, width: 820, fontSize: 55, fontWeight: 800, lineHeight: 1.18 }}>{slide.title}</div>
      <div style={{ position: 'absolute', left: 75, top: 305, width: 760, fontSize: 25, lineHeight: 1.5, color: palette.muted }}>{slide.subtitle || courseTitle}</div>
      <div style={{ position: 'absolute', right: 100, top: 130, width: 250, height: 250, borderRadius: '50%', border: `3px solid ${palette.accent}`, display: 'grid', placeItems: 'center', color: palette.accent, fontWeight: 800, fontSize: 42 }}>PPT</div>
    </> : <>
      <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 12, background: palette.accent }} />
      <div style={{ position: 'absolute', left: 58, top: 42, right: 58, fontSize: 34, fontWeight: 800, opacity: 1 - focusStrength * .34 }}>{slide.title}</div>
      {slide.subtitle && <div style={{ position: 'absolute', left: 60, top: 94, right: 60, fontSize: 18, color: palette.muted, opacity: 1 - focusStrength * .45 }}>{slide.subtitle}</div>}
      <div style={{ position: 'absolute', left: 46, top: 125, width: 724, bottom: 95, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
        {(slide.bullets || []).map((bullet, index) => {
          const itemOpacity = interpolate(frame, [8 + index * 6, 16 + index * 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          const isFocused = focusCue?.targetIndex === index
          const bulletOpacity = itemOpacity * (isFocused ? 1 : surroundingOpacity)
          return <div key={`${index}-${bullet}`} style={{ display: 'flex', gap: 18, padding: '12px 14px', borderRadius: 14, fontSize: 25, lineHeight: 1.45, opacity: bulletOpacity, background: isFocused ? `rgba(255,255,255,${.2 + focusStrength * .78})` : 'transparent', border: `1px solid rgba(33,136,165,${isFocused ? focusStrength * .34 : 0})`, boxShadow: isFocused ? `0 10px 28px rgba(25,76,99,${focusStrength * .18})` : 'none', transform: `translateX(${(1 - itemOpacity) * 22}px) scale(${isFocused ? 1 + focusStrength * .025 : 1})`, transformOrigin: 'left center' }}>
            <span style={{ color: palette.accent, fontWeight: 900 }}>•</span><span>{bullet}</span>
          </div>
        })}
      </div>
      <div style={{ position: 'absolute', right: 48, top: 135, width: 415, height: 430, borderRadius: 24, overflow: 'hidden', background: palette.pale, border: '1px solid rgba(33,136,165,.18)', display: 'grid', placeItems: 'center', opacity: 1 - focusStrength * .56, filter: `brightness(${1 - focusStrength * .18})` }}>
        {slide.imageUrl ? <Img src={slide.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1 + Math.min(.035, frame / duration * .035)})` }} />
          : <div style={{ padding: 36, textAlign: 'center', color: palette.muted, fontSize: 19, lineHeight: 1.5 }}>{slide.imagePrompt || '教学配图区域'}</div>}
      </div>
      <div style={{ position: 'absolute', left: 58, bottom: 35, color: palette.muted, fontSize: 15 }}>{courseTitle}</div>
      <div style={{ position: 'absolute', right: 58, bottom: 35, color: palette.accent, fontWeight: 800, fontSize: 16 }}>{slide.page}</div>
    </>}
    {subtitle && <div style={{ position: 'absolute', left: 140, right: 140, bottom: 34, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 920, borderRadius: 12, padding: '11px 20px', background: 'rgba(12,32,46,.82)', color: palette.white, fontSize: 22, lineHeight: 1.35, textAlign: 'center' }}>{subtitle}</div>
    </div>}
    {slide.audioUrl && <Audio src={slide.audioUrl} />}
  </AbsoluteFill>
}

export function PptNarrationComposition({ manifest }) {
  return <AbsoluteFill style={{ background: palette.canvas }}>
    {(manifest?.slides || []).map((slide, index) => <Sequence key={`${slide.page}-${index}`} from={Number(slide.startFrame || 0)} durationInFrames={Number(slide.durationInFrames || 1)} premountFor={24}>
      <SlideFrame slide={slide} courseTitle={manifest.title} fps={manifest.fps} />
    </Sequence>)}
  </AbsoluteFill>
}
