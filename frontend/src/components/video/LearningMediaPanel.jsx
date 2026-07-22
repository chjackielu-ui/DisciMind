import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Player } from '@remotion/player'
import { BASE_URL } from '../../api/request.js'
import {
  createStudentKnowledgeResourcePackage, createStudentVideoGenerationTask, downloadStudentPptArtifact, fetchStudentGeneratedMedia,
  generateStudentCoursePpt, getStudentKnowledgeResourcePackage, getStudentVideoGenerationTask, retryStudentKnowledgeResourcePackage,
  uploadStudentGeneratedVideo,
} from '../../api/student.js'
import { PptNarrationComposition } from './PptNarrationComposition.jsx'
import { activeFocusCue, focusPreviewSlide, prepareFocusManifest } from './focus-timeline.js'
import './focus-timeline.css'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const apiOrigin = BASE_URL.replace(/\/api\/?$/, '')
const remotionLicenseKey = String(import.meta.env.VITE_REMOTION_LICENSE_KEY || '').trim()
const MEDIA_STATE_VERSION = 1
const VIDEO_POLL_MAX_ATTEMPTS = 450

function mediaStateKey(userId, courseId) {
  return `discimind:learning-media:v${MEDIA_STATE_VERSION}:${String(userId || 'student')}:${String(courseId)}`
}

function readMediaState(userId, courseId) {
  try {
    const value = JSON.parse(sessionStorage.getItem(mediaStateKey(userId, courseId)) || '{}')
    return value && value.version === MEDIA_STATE_VERSION ? value : {}
  } catch { return {} }
}

function persistMediaState(userId, courseId, patch) {
  try {
    const current = readMediaState(userId, courseId)
    sessionStorage.setItem(mediaStateKey(userId, courseId), JSON.stringify({ ...current, ...patch, version: MEDIA_STATE_VERSION, updatedAt: Date.now() }))
  } catch {}
}

function resumableVideoTask(task) {
  if (!task?.videoTaskId) return null
  return {
    videoTaskId: task.videoTaskId,
    taskId: task.taskId || null,
    status: task.status || 'pending',
    stage: task.stage || '',
    progress: Number(task.progress || 0),
    resultUrl: task.resultUrl || null,
    errorMessage: task.errorMessage || null,
  }
}

function resumableResourcePackage(value) {
  if (!value?.packageTaskId) return null
  return {
    packageTaskId: value.packageTaskId,
    status: value.status || 'generating',
    stage: value.stage || '',
    progress: Number(value.progress || 0),
    courseId: value.courseId || null,
    knowledgePointId: value.knowledgePointId || null,
    knowledgePointName: value.knowledgePointName || '',
    readyCount: Number(value.readyCount || 0),
    failedCount: Number(value.failedCount || 0),
    resources: Array.isArray(value.resources) ? value.resources : [],
    ppt: value.ppt || null,
    videoTask: resumableVideoTask(value.videoTask),
  }
}

function packageTaskIdFromLocation() {
  const [, query = ''] = window.location.hash.split('?')
  const value = Number(new URLSearchParams(query).get('packageId'))
  return Number.isInteger(value) && value > 0 ? value : null
}

function markLearningMediaSection(packageTaskId = null) {
  const [path, query = ''] = window.location.hash.split('?')
  if (!path.startsWith('#/student/courses/')) return
  const params = new URLSearchParams(query)
  params.set('section', 'learning-media')
  if (Number(packageTaskId) > 0) params.set('packageId', String(packageTaskId))
  history.replaceState(history.state, '', `${path}?${params.toString()}`)
}

function absoluteAsset(url) {
  if (!url || /^(?:https?:|blob:|data:)/i.test(url)) return url
  return `${apiOrigin}${url.startsWith('/') ? '' : '/'}${url}`
}

async function hydrateManifest(source, objectUrls) {
  const slides = await Promise.all((source.slides || []).map(async slide => {
    let audioUrl = null
    if (slide.audioUrl) {
      const blob = await fetchStudentGeneratedMedia(slide.audioUrl)
      audioUrl = URL.createObjectURL(blob)
      objectUrls.current.push(audioUrl)
    }
    return { ...slide, imageUrl: absoluteAsset(slide.imageUrl), audioUrl }
  }))
  return prepareFocusManifest({ ...source, slides })
}

function statusText(status) {
  return ({ pending: '等待生成', generating: '正在准备视频素材', ready: '视频素材已就绪', success: '视频已生成', failed: '生成失败' })[status] || status
}

function packageStatusText(status) {
  return ({
    generating: '正在生成五类学习资料',
    video_ready: '资料已齐备，等待浏览器渲染视频',
    completed: '完整学习资源包已生成',
    partial: '资源包已部分完成',
    failed: '资源包生成失败',
  })[status] || status
}

function packageResourceStatusText(status) {
  return ({ pending: '等待中', generating: '生成中', ready: '已就绪', failed: '需重试', success: '已就绪' })[status] || status
}

function LearningMediaPanel({ course, knowledgePoints, userId }) {
  const restored = useMemo(() => readMediaState(userId, course.course_id), [course.course_id, userId])
  const linkedPackageTaskId = packageTaskIdFromLocation()
  const [topic, setTopic] = useState(() => restored.topic || course.course_name || '')
  const [knowledgePointId, setKnowledgePointId] = useState(() => String(restored.knowledgePointId || ''))
  const [pageCount, setPageCount] = useState(() => [6, 8, 10, 12].includes(Number(restored.pageCount)) ? Number(restored.pageCount) : 8)
  const [includeImages, setIncludeImages] = useState(() => restored.includeImages !== false)
  const [ppt, setPpt] = useState(() => restored.ppt?.artifactId ? restored.ppt : null)
  const [currentPage, setCurrentPage] = useState(() => Math.max(0, Number(restored.currentPage) || 0))
  const [pptBusy, setPptBusy] = useState(false)
  const [packageBusy, setPackageBusy] = useState(() => Boolean(linkedPackageTaskId) || restored.resourcePackage?.status === 'generating')
  const [resourcePackage, setResourcePackage] = useState(() => resumableResourcePackage(restored.resourcePackage))
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoTask, setVideoTask] = useState(() => resumableVideoTask(restored.videoTask))
  const [manifest, setManifest] = useState(null)
  const [playbackRate, setPlaybackRate] = useState(() => Number(restored.playbackRate) || 1)
  const [renderProgress, setRenderProgress] = useState(null)
  const [renderError, setRenderError] = useState('')
  const [savedVideo, setSavedVideo] = useState(null)
  const [focusPreviewPlaying, setFocusPreviewPlaying] = useState(false)
  const [focusPreviewMs, setFocusPreviewMs] = useState(0)
  const objectUrls = useRef([])
  const renderController = useRef(null)
  const focusAnimationFrame = useRef(null)
  const focusStartedAt = useRef(0)
  const mounted = useRef(true)
  const restoredVideoTaskId = useRef(restored.videoTask?.videoTaskId || null)
  const restoredPackageTaskId = useRef(linkedPackageTaskId || restored.resourcePackage?.packageTaskId || null)

  useEffect(() => () => {
    mounted.current = false
    objectUrls.current.forEach(url => URL.revokeObjectURL(url))
    renderController.current?.abort()
    cancelAnimationFrame(focusAnimationFrame.current)
  }, [])

  useEffect(() => {
    persistMediaState(userId, course.course_id, {
      topic, knowledgePointId, pageCount, includeImages, ppt, currentPage,
      videoTask: resumableVideoTask(videoTask), resourcePackage: resumableResourcePackage(resourcePackage), playbackRate,
    })
  }, [course.course_id, currentPage, includeImages, knowledgePointId, pageCount, playbackRate, ppt, resourcePackage, topic, userId, videoTask])

  useEffect(() => {
    if (restoredPackageTaskId.current) return undefined
    const taskId = restoredVideoTaskId.current
    if (!taskId) return undefined
    let cancelled = false
    const restore = async () => {
      setVideoBusy(['pending', 'generating'].includes(restored.videoTask?.status))
      try {
        let latest = restored.videoTask
        for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS && !cancelled; attempt += 1) {
          latest = (await getStudentVideoGenerationTask(taskId)).data
          if (cancelled) return
          setVideoTask(latest)
          persistMediaState(userId, course.course_id, { videoTask: resumableVideoTask(latest) })
          if (['ready', 'success', 'failed'].includes(latest.status)) break
          await wait(2000)
        }
        if (latest?.status === 'failed') throw new Error(latest.errorMessage || '视频素材生成失败')
        if (latest?.status === 'success' && latest.resultUrl && !cancelled) {
          setSavedVideo({
            resultUrl: latest.resultUrl,
            fileName: `${latest.manifest?.title || '学习讲解视频'}.mp4`,
          })
          setRenderProgress(100)
        }
        if (latest?.manifest && !cancelled) {
          objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current = []
          const hydrated = await hydrateManifest(latest.manifest, objectUrls)
          if (!cancelled) setManifest(hydrated)
        }
      } catch (error) {
        if (!cancelled) setRenderError(error.message || '视频任务恢复失败')
      } finally {
        if (!cancelled) setVideoBusy(false)
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const packageTaskId = restoredPackageTaskId.current
    if (!packageTaskId) return undefined
    let cancelled = false
    const restore = async () => {
      setPackageBusy(true)
      try {
        for (let attempt = 0; attempt < 900 && !cancelled; attempt += 1) {
          const latest = (await getStudentKnowledgeResourcePackage(packageTaskId)).data
          if (cancelled) return
          await applyResourcePackage(latest)
          if (['video_ready', 'completed', 'partial', 'failed'].includes(latest.status)) break
          await wait(Math.min(5000, 1500 + attempt * 20))
        }
      } catch (error) {
        if (!cancelled) setRenderError(error.message || '学习资源包任务恢复失败')
      } finally {
        if (!cancelled) setPackageBusy(false)
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [])

  const selectedPoint = useMemo(() => knowledgePoints.find(item => String(item.knowledge_point_id) === String(knowledgePointId)), [knowledgePoints, knowledgePointId])
  const slide = ppt?.slides?.[currentPage] || null
  const previewFocusSlide = useMemo(() => {
    if (!slide) return null
    const page = Number(slide.page || currentPage + 1)
    return (manifest?.slides || []).find(item => Number(item.page) === page) || focusPreviewSlide(slide)
  }, [currentPage, manifest, slide])
  const previewFocusCue = activeFocusCue(previewFocusSlide, focusPreviewMs)

  useEffect(() => {
    setFocusPreviewPlaying(false)
    setFocusPreviewMs(0)
  }, [currentPage, manifest?.videoTaskId, ppt?.artifactId])

  useEffect(() => {
    cancelAnimationFrame(focusAnimationFrame.current)
    if (!focusPreviewPlaying || !previewFocusSlide) return undefined
    const durationMs = Math.max(1, Number(previewFocusSlide.durationMs || 1))
    focusStartedAt.current = performance.now() - focusPreviewMs
    const tick = now => {
      const elapsed = Math.min(durationMs, now - focusStartedAt.current)
      setFocusPreviewMs(elapsed)
      if (elapsed >= durationMs) {
        setFocusPreviewPlaying(false)
        return
      }
      focusAnimationFrame.current = requestAnimationFrame(tick)
    }
    focusAnimationFrame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(focusAnimationFrame.current)
  }, [focusPreviewPlaying, previewFocusSlide])

  function toggleFocusPreview() {
    if (!previewFocusSlide) return
    const durationMs = Math.max(1, Number(previewFocusSlide.durationMs || 1))
    if (!focusPreviewPlaying && focusPreviewMs >= durationMs - 1) setFocusPreviewMs(0)
    setFocusPreviewPlaying(value => !value)
  }

  async function applyResourcePackage(latest) {
    if (!latest || !mounted.current) return
    markLearningMediaSection(latest.packageTaskId)
    setResourcePackage(latest)
    persistMediaState(userId, course.course_id, { resourcePackage: resumableResourcePackage(latest) })
    if (latest.ppt?.artifactId) {
      setPpt(latest.ppt)
      setCurrentPage(value => Math.min(value, Math.max(0, (latest.ppt.slides?.length || 1) - 1)))
    }
    if (latest.videoTask?.videoTaskId) {
      setVideoTask(latest.videoTask)
      persistMediaState(userId, course.course_id, { videoTask: resumableVideoTask(latest.videoTask) })
      if (latest.videoTask.status === 'success' && latest.videoTask.resultUrl) {
        setSavedVideo({ resultUrl: latest.videoTask.resultUrl, fileName: `${latest.ppt?.title || latest.knowledgePointName || '学习讲解视频'}.mp4` })
        setRenderProgress(100)
      }
      if (latest.videoTask.manifest && Number(manifest?.videoTaskId) !== Number(latest.videoTask.videoTaskId)) {
        objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current = []
        setManifest(await hydrateManifest(latest.videoTask.manifest, objectUrls))
      }
    }
  }

  async function pollResourcePackage(packageTaskId) {
    let latest = null
    for (let attempt = 0; attempt < 900; attempt += 1) {
      latest = (await getStudentKnowledgeResourcePackage(packageTaskId)).data
      await applyResourcePackage(latest)
      if (['video_ready', 'completed', 'partial', 'failed'].includes(latest.status)) return latest
      await wait(Math.min(5000, 1500 + attempt * 20))
    }
    throw new Error('资源包仍在后台生成；可从任务中心离开，稍后返回本页面继续')
  }

  async function generateResourcePackage() {
    if (!knowledgePointId) {
      setRenderError('请先选择一个知识点，再生成个性化单知识点学习资源包')
      return
    }
    markLearningMediaSection()
    setPackageBusy(true); setRenderError(''); setSavedVideo(null); setManifest(null); setVideoTask(null)
    try {
      const created = (await createStudentKnowledgeResourcePackage(course.course_id, knowledgePointId, {
        operationId: globalThis.crypto?.randomUUID?.() || `package_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        pageCount: Number(pageCount),
        includeImages,
      })).data
      markLearningMediaSection(created.packageTaskId)
      await applyResourcePackage(created)
      await pollResourcePackage(created.packageTaskId)
    } catch (error) {
      if (mounted.current) setRenderError(error.message || '个性化学习资源包生成失败')
    } finally {
      if (mounted.current) setPackageBusy(false)
    }
  }

  async function retryFailedPackageResources() {
    const packageTaskId = resourcePackage?.packageTaskId
    const failedResources = (resourcePackage?.resources || []).filter(resource => resource.status === 'failed').map(resource => resource.key)
    if (!packageTaskId || !failedResources.length) return
    setPackageBusy(true); setRenderError('')
    try {
      const retried = (await retryStudentKnowledgeResourcePackage(packageTaskId, { resources: failedResources })).data
      await applyResourcePackage(retried)
      await pollResourcePackage(packageTaskId)
    } catch (error) {
      if (mounted.current) setRenderError(error.message || '失败资源重新生成失败')
    } finally {
      if (mounted.current) setPackageBusy(false)
    }
  }

  async function generatePpt() {
    markLearningMediaSection()
    setPptBusy(true); setRenderError(''); setVideoTask(null); setManifest(null); setSavedVideo(null)
    persistMediaState(userId, course.course_id, { topic, knowledgePointId, pageCount, includeImages, videoTask: null })
    try {
      const response = await generateStudentCoursePpt(course.course_id, {
        topic: topic.trim() || selectedPoint?.knowledge_point_name || course.course_name,
        knowledgePointId: knowledgePointId || undefined,
        pageCount: Number(pageCount), style: 'teaching', includeImages,
      })
      persistMediaState(userId, course.course_id, { ppt: response.data, currentPage: 0, videoTask: null })
      if (mounted.current) { setPpt(response.data); setCurrentPage(0) }
    } catch (error) { if (mounted.current) setRenderError(error.message || 'PPT生成失败') }
    finally { if (mounted.current) setPptBusy(false) }
  }

  async function generateVideoAssets() {
    if (!ppt?.artifactId) return
    markLearningMediaSection()
    setVideoBusy(true); setRenderError(''); setSavedVideo(null)
    try {
      const created = (await createStudentVideoGenerationTask({
        pptArtifactId: ppt.artifactId, courseId: course.course_id,
        knowledgePointId: knowledgePointId || undefined, style: 'ppt-narration',
      })).data
      setVideoTask(created)
      persistMediaState(userId, course.course_id, { videoTask: resumableVideoTask(created) })
      let latest = created
      for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS; attempt += 1) {
        await wait(attempt === 0 ? 600 : 2000)
        latest = (await getStudentVideoGenerationTask(created.videoTaskId)).data
        persistMediaState(userId, course.course_id, { videoTask: resumableVideoTask(latest) })
        if (mounted.current) setVideoTask(latest)
        if (latest.status === 'ready' || latest.status === 'success') break
        if (latest.status === 'failed') throw new Error(latest.errorMessage || '视频素材生成失败')
      }
      if (!latest.manifest) throw new Error('视频素材准备超时，可以稍后重新进入本页面查看')
      if (!mounted.current) return
      objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current = []
      setManifest(await hydrateManifest(latest.manifest, objectUrls))
    } catch (error) { if (mounted.current) setRenderError(error.message || '视频素材生成失败') }
    finally { if (mounted.current) setVideoBusy(false) }
  }

  async function refreshResourcePackageAfterVideo() {
    if (!resourcePackage?.packageTaskId) return
    try {
      await applyResourcePackage((await getStudentKnowledgeResourcePackage(resourcePackage.packageTaskId)).data)
    } catch (error) {
      console.warn('[learning-media] resource package refresh failed', error)
    }
  }

  async function renderVideo() {
    if (!manifest) return
    setRenderError(''); setRenderProgress(0); setSavedVideo(null)
    const controller = new AbortController(); renderController.current = controller
    try {
      const { canRenderMediaOnWeb, renderMediaOnWeb } = await import('@remotion/web-renderer')
      const support = await canRenderMediaOnWeb({ width: manifest.width, height: manifest.height, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac' })
      if (!support.canRender) throw new Error(support.issues?.map(item => item.message).join('；') || '当前浏览器不支持MP4渲染，请使用最新版Chrome或Edge')
      const composition = {
        id: `learning-video-${manifest.videoTaskId}`,
        component: PptNarrationComposition,
        durationInFrames: manifest.totalDurationFrames,
        fps: manifest.fps,
        width: manifest.width,
        height: manifest.height,
      }
      const rendered = await renderMediaOnWeb({
        composition, inputProps: { manifest }, container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
        videoBitrate: 'medium', audioBitrate: 'medium', hardwareAcceleration: 'prefer-hardware', pageResponsiveness: 'high',
        mediaCacheSizeInBytes: 128 * 1024 * 1024,
        ...(remotionLicenseKey ? { licenseKey: remotionLicenseKey } : {}),
        outputTarget: support.resolvedOutputTarget, signal: controller.signal,
        onProgress: ({ progress }) => setRenderProgress(Math.max(0, Math.min(100, Math.round(progress * 100)))),
      })
      const blob = await rendered.getBlob()
      const fileName = `${manifest.title || '学习讲解视频'}.mp4`
      const localUrl = URL.createObjectURL(blob); objectUrls.current.push(localUrl)
      setRenderProgress(100)
      const localSavedVideo = { localUrl, fileName, blob, uploading: true, uploadFailed: false }
      setSavedVideo(localSavedVideo)
      try {
        const saved = (await uploadStudentGeneratedVideo(manifest.videoTaskId, blob, fileName)).data
        setSavedVideo({ ...localSavedVideo, ...saved, uploading: false })
        await refreshResourcePackageAfterVideo()
      } catch (uploadError) {
        setSavedVideo({ ...localSavedVideo, uploading: false, uploadFailed: true })
        setRenderError(`MP4已在本机生成，但上传服务器失败：${uploadError.message || '请稍后重新上传'}。你可以先下载本地MP4。`)
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setRenderError(error.message || '视频渲染失败')
      setRenderProgress(null)
    } finally { renderController.current = null }
  }

  async function retryRenderedVideoUpload() {
    if (!savedVideo?.blob || !manifest?.videoTaskId || savedVideo.uploading) return
    setRenderError('')
    setSavedVideo(value => ({ ...value, uploading: true }))
    try {
      const saved = (await uploadStudentGeneratedVideo(manifest.videoTaskId, savedVideo.blob, savedVideo.fileName)).data
      setSavedVideo(value => ({ ...value, ...saved, uploading: false, uploadFailed: false }))
      await refreshResourcePackageAfterVideo()
    } catch (error) {
      setSavedVideo(value => ({ ...value, uploading: false, uploadFailed: true }))
      setRenderError(`MP4重新上传失败：${error.message || '请检查网络后再试'}。本地文件仍可下载。`)
    }
  }

  async function downloadRenderedVideo() {
    if (!savedVideo) return
    setRenderError('')
    try {
      if (savedVideo.localUrl) {
        const anchor = document.createElement('a'); anchor.href = savedVideo.localUrl; anchor.download = savedVideo.fileName || '学习讲解视频.mp4'; anchor.click()
        return
      }
      if (!savedVideo.resultUrl) return
      const blob = await fetchStudentGeneratedMedia(savedVideo.resultUrl)
      downloadBlob(blob, savedVideo.fileName || '学习讲解视频.mp4')
    } catch (error) { setRenderError(error.message || 'MP4下载失败') }
  }

  async function downloadPackageResource(resource) {
    if (!resource?.downloadUrl) return
    setRenderError('')
    try {
      const blob = await fetchStudentGeneratedMedia(resource.downloadUrl)
      downloadBlob(blob, resource.fileName || `${resource.label}.${String(resource.fileFormat || 'file').toLowerCase()}`)
    } catch (error) {
      setRenderError(error.message || `${resource.label}下载失败`)
    }
  }

  function viewKnowledgeCards() {
    document.getElementById('lc-course-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName.replace(/[\\/:*?"<>|]/g, '_')
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function narrationText() {
    return (manifest?.slides || []).map(slideItem => `第 ${slideItem.page} 页｜${slideItem.title}\n${slideItem.narrationText || ''}`).join('\n\n')
  }

  function downloadNarration() {
    downloadBlob(new Blob([narrationText()], { type: 'text/plain;charset=utf-8' }), `${manifest.title || '学习讲解'}-演讲稿.txt`)
  }

  async function downloadAudioPackage() {
    setRenderError('')
    try {
      const { strToU8, zipSync } = await import('fflate')
      const files = { '演讲稿.txt': strToU8(narrationText()) }
      for (const slideItem of manifest.slides || []) {
        if (!slideItem.audioUrl) continue
        const response = await fetch(slideItem.audioUrl)
        files[`第${String(slideItem.page).padStart(2, '0')}页.wav`] = new Uint8Array(await response.arrayBuffer())
      }
      downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), `${manifest.title || '学习讲解'}-语音包.zip`)
    } catch (error) { setRenderError(error.message || '语音包下载失败') }
  }

  return <section className="learning-media-card">
    <header className="learning-media-head"><div><span>多模态学习资源生成</span><h3>个性化单知识点学习资源包</h3><p>一次生成讲义、PPT、知识点卡片、试卷和带逐条聚焦讲解的视频；五类资源共用同一课程与知识点上下文。</p></div></header>
    <div className="learning-media-form">
      <label><span>学习主题</span><input value={topic} onChange={event => setTopic(event.target.value)} maxLength={120} /></label>
      <label><span>知识点</span><select value={knowledgePointId} onChange={event => { setKnowledgePointId(event.target.value); const point = knowledgePoints.find(item => String(item.knowledge_point_id) === event.target.value); if (point) setTopic(point.knowledge_point_name) }}><option value="">课程整体</option>{knowledgePoints.map(item => <option key={item.knowledge_point_id} value={item.knowledge_point_id}>{item.knowledge_point_name}</option>)}</select></label>
      <label><span>页数</span><select value={pageCount} onChange={event => setPageCount(Number(event.target.value))}><option value="6">6页</option><option value="8">8页</option><option value="10">10页</option><option value="12">12页</option></select></label>
      <label className="learning-media-check"><input type="checkbox" checked={includeImages} onChange={event => setIncludeImages(event.target.checked)} /><span>生成教学配图</span></label>
      <button className="learning-media-primary" type="button" disabled={pptBusy || !topic.trim()} onClick={generatePpt}>{pptBusy ? '正在生成PPT…' : '生成 PPT'}</button>
      <button className="learning-package-primary" type="button" disabled={packageBusy || pptBusy || !knowledgePointId} onClick={generateResourcePackage}>{packageBusy ? '长任务生成中…' : '一键生成五类资源包'}</button>
    </div>
    {renderError && <div className="learning-media-error">{renderError}</div>}
    {resourcePackage && <div className="learning-package-result">
      <div className="learning-package-summary">
        <div><span>单知识点资源包</span><b>{resourcePackage.knowledgePointName || selectedPoint?.knowledge_point_name || topic}</b><small>{packageStatusText(resourcePackage.status)} · {resourcePackage.stage}</small></div>
        <div className="learning-package-progress"><strong>{Math.round(resourcePackage.progress || 0)}%</strong><progress max="100" value={resourcePackage.progress || 0} />{(resourcePackage.resources || []).some(resource => resource.status === 'failed') && <button type="button" disabled={packageBusy} onClick={retryFailedPackageResources}>{packageBusy ? '正在重试…' : '重试失败项'}</button>}</div>
      </div>
      <div className="learning-package-grid">
        {(resourcePackage.resources || []).map((resource, index) => <article className={`learning-package-item status-${resource.status}`} key={resource.key}>
          <div className="learning-package-index">{index + 1}</div>
          <div className="learning-package-copy"><b>{resource.label}</b><span>{resource.key === 'video' && resourcePackage.videoTask?.status === 'ready' ? '素材已就绪，待浏览器渲染MP4' : packageResourceStatusText(resource.status)}</span>{resource.warning && <small>{resource.warning}</small>}{resource.errorMessage && <small className="is-error">{resource.errorMessage}</small>}</div>
          <div className="learning-package-actions">
            {resource.downloadUrl && <button type="button" onClick={() => downloadPackageResource(resource)}>下载{resource.fileFormat || ''}</button>}
            {resource.key === 'cards' && resource.status === 'ready' && <button type="button" onClick={viewKnowledgeCards}>查看 {resource.cardCount || 5} 张</button>}
            {resource.key === 'video' && resourcePackage.videoTask?.status === 'ready' && <button type="button" onClick={() => document.querySelector('.learning-video-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>前往渲染</button>}
          </div>
        </article>)}
      </div>
      {resourcePackage.status === 'video_ready' && <div className="learning-package-notice">视频素材已由服务器准备完成{resourcePackage.failedCount ? `，当前 ${resourcePackage.readyCount || 0}/5 类资料可用，失败项可单独重试` : ''}。最终 MP4 在当前浏览器中渲染，不占用 2G 服务器的编码内存；可以从任务中心离开并通过当前任务链接恢复。</div>}
    </div>}
    {ppt && <div className="learning-ppt-result">
      <div className="learning-media-toolbar"><div><b>{ppt.title}</b><span>{ppt.slides?.length || 0}页 · {ppt.notice || 'PPTX已生成'}</span></div><div><button type="button" onClick={() => downloadStudentPptArtifact(ppt.artifactId, `${ppt.title}.pptx`)}>下载PPTX</button><button className="learning-media-primary" type="button" disabled={videoBusy} onClick={generateVideoAssets}>{videoBusy ? '正在准备视频…' : '生成视频讲解'}</button></div></div>
      {slide && <><div className={`learning-ppt-stage${previewFocusCue ? ' is-focusing' : ''}`} style={previewFocusCue ? { '--surrounding-opacity': 1 - previewFocusCue.strength * .72, '--context-opacity': 1 - previewFocusCue.strength * .45, '--image-opacity': 1 - previewFocusCue.strength * .56, '--image-brightness': 1 - previewFocusCue.strength * .18 } : undefined}><div className="learning-ppt-copy"><small>第 {slide.page || currentPage + 1} 页</small><h4>{slide.title}</h4>{slide.subtitle && <p>{slide.subtitle}</p>}<ul>{(slide.bullets || []).map((item, index) => <li className={previewFocusCue ? (previewFocusCue.targetIndex === index ? 'is-focused' : 'is-dimmed') : ''} style={previewFocusCue?.targetIndex === index ? { transform: `scale(${1 + previewFocusCue.strength * .025})`, background: `rgba(255,255,255,${.2 + previewFocusCue.strength * .78})`, borderColor: `rgba(33,136,165,${previewFocusCue.strength * .34})`, boxShadow: `0 10px 28px rgba(25,76,99,${previewFocusCue.strength * .18})` } : undefined} aria-current={previewFocusCue?.targetIndex === index ? 'true' : undefined} key={index}>{item}</li>)}</ul></div><div className="learning-ppt-image">{slide.imageUrl ? <img src={absoluteAsset(slide.imageUrl)} alt="教学配图" /> : <span>{slide.imagePrompt || '教学配图区域'}</span>}</div></div>
        {(previewFocusSlide?.focusTimeline || []).length > 0 && <div className="learning-ppt-focus-controls"><button type="button" onClick={toggleFocusPreview}>{focusPreviewPlaying ? '暂停聚焦预演' : focusPreviewMs > 0 ? '继续聚焦预演' : '聚焦预演'}</button><div><span>{previewFocusCue ? `正在讲解：${previewFocusCue.label || slide.bullets?.[previewFocusCue.targetIndex] || ''}` : '按讲解顺序逐条聚焦'}</span><progress max={previewFocusSlide.durationMs} value={focusPreviewMs} /></div></div>}</>}
      <div className="learning-ppt-nav"><button type="button" disabled={currentPage <= 0} onClick={() => setCurrentPage(value => value - 1)}>上一页</button><span>{currentPage + 1} / {ppt.slides?.length || 1}</span><button type="button" disabled={currentPage >= (ppt.slides?.length || 1) - 1} onClick={() => setCurrentPage(value => value + 1)}>下一页</button></div>
    </div>}
    {videoTask && <div className="learning-video-status"><b>{statusText(videoTask.status)}</b><span>{videoTask.stage}</span><progress max="100" value={videoTask.progress || 0} /></div>}
    {manifest && <div className="learning-video-result">
      {manifest.scriptWarning && <div className="learning-media-warning">详细讲解模型暂不可用，当前采用本地扩写讲稿；可稍后重新生成以获得更自然的知识讲解。</div>}
      {!manifest.ttsAvailable && <div className="learning-media-warning">当前TTS未配置或调用失败，已生成无配音视频模板；配置阿里TTS后重新生成即可加入语音。</div>}
      <div className="learning-video-player"><Player component={PptNarrationComposition} inputProps={{ manifest }} durationInFrames={manifest.totalDurationFrames} compositionWidth={manifest.width} compositionHeight={manifest.height} fps={manifest.fps} playbackRate={playbackRate} controls style={{ width: '100%', aspectRatio: '16 / 9' }} /></div>
      <div className="learning-media-toolbar"><div><b>视频预览已就绪</b><span>{Math.ceil(manifest.totalDurationMs / 1000)}秒 · 720P · 24FPS</span></div><div><label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#607b8d', fontSize: 13 }}><span>倍速</span><select style={{ minHeight: 38, padding: '7px 9px', border: '1px solid #bfd7e0', borderRadius: 10, background: '#fff', color: '#205a72' }} value={playbackRate} onChange={event => setPlaybackRate(Number(event.target.value))}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button type="button" onClick={downloadNarration}>下载演讲稿</button>{manifest.slides?.some(item => item.audioUrl) && <button type="button" onClick={downloadAudioPackage}>下载语音包</button>}{renderProgress != null && renderProgress < 100 && <button type="button" onClick={() => renderController.current?.abort()}>取消渲染</button>}<button className="learning-media-primary" type="button" disabled={renderProgress != null && renderProgress < 100} onClick={renderVideo}>{renderProgress == null ? '渲染并保存MP4' : renderProgress < 100 ? `正在渲染 ${renderProgress}%` : '重新渲染'}</button>{savedVideo?.uploadFailed && <button type="button" disabled={savedVideo.uploading} onClick={retryRenderedVideoUpload}>{savedVideo.uploading ? '正在上传…' : '重新上传'}</button>}{savedVideo && <button type="button" onClick={downloadRenderedVideo}>下载MP4</button>}</div></div>
    </div>}
  </section>
}

export function mountLearningMediaPanel(element, options) {
  if (!element) return () => {}
  const root = createRoot(element)
  root.render(<LearningMediaPanel {...options} />)
  return () => root.unmount()
}
