import * as pdfjsLib from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker'
import { BASE_URL } from '../api/request.js'
import { getToken } from '../utils/auth.js'

if (!pdfjsLib.GlobalWorkerOptions.workerPort) {
  pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()
}

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const ZOOM_STEP = 0.1
const RENDER_RADIUS = 3
const RELEASE_RADIUS = 4

function safeName(value) {
  return String(value || '参考资料.pdf').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || '参考资料.pdf'
}

function clampScale(value, round = true) {
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(value || 1)))
  return round ? Math.round(clamped * 10) / 10 : clamped
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

async function assertPdfBlob(blob) {
  if (!blob?.size) throw new Error('PDF 文件为空')
  const header = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  if (String.fromCharCode(...header) !== '%PDF-') throw new Error('文件内容不是有效 PDF')
  return blob
}

export class LearningPdfViewer {
  constructor(root, { onStateChange } = {}) {
    this.root = root
    this.onStateChange = onStateChange
    this.document = null
    this.loadingTask = null
    this.objectUrl = null
    this.blob = null
    this.fileName = ''
    this.sourceType = ''
    this.pageNumber = 1
    this.pageCount = 0
    this.scale = 1
    this.fitWidth = true
    this.renderToken = 0
    this.pageMetrics = new Map()
    this.pageElements = new Map()
    this.renderTasks = new Map()
    this.renderedScales = new Map()
    this.renderQueue = new Set()
    this.visibilityRatios = new Map()
    this.idleHandle = null
    this.zoomHintTimer = null
    this.wheelFrame = 0
    this.pendingWheelZoom = null
    this.intersectionObserver = null
    this.resizeObserver = null
    this.resizeFrame = 0
    this.onWheel = this.handleWheel.bind(this)
  }

  get viewport() { return this.root?.querySelector('[data-pdf-viewport]') }
  get pagesRoot() { return this.root?.querySelector('[data-pdf-pages]') }

  emitState(extra = {}) {
    this.onStateChange?.({
      fileName: this.fileName,
      sourceType: this.sourceType,
      pageNumber: this.pageNumber,
      pageCount: this.pageCount,
      scale: this.scale,
      fitWidth: this.fitWidth,
      loaded: Boolean(this.document),
      continuous: true,
      ...extra,
    })
  }

  async fetchProtected(relativeUrl) {
    const url = /^https?:\/\//i.test(relativeUrl) ? relativeUrl : `${BASE_URL}${relativeUrl}`
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${getToken()}` },
      credentials: 'include',
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.message || `PDF 加载失败 (${response.status})`)
    }
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (contentType !== 'application/pdf') throw new Error('服务端返回的文件类型不是 PDF')
    return assertPdfBlob(await response.blob())
  }

  async load(source) {
    this.root?.classList.add('is-loading')
    this.emitState({ loading: true, error: '' })
    try {
      const blob = source.file instanceof Blob ? await assertPdfBlob(source.file) : await this.fetchProtected(source.url)
      await this.releaseDocument()
      this.blob = blob
      this.objectUrl = URL.createObjectURL(blob)
      this.fileName = safeName(source.name || source.file?.name)
      this.sourceType = source.type || (source.file ? 'local' : 'server')
      this.pageNumber = 1
      this.scale = 1
      this.fitWidth = true
      this.loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false })
      this.document = await this.loadingTask.promise
      this.pageCount = this.document.numPages
      const firstPage = await this.document.getPage(1)
      const firstViewport = firstPage.getViewport({ scale: 1 })
      this.defaultMetric = { width: firstViewport.width, height: firstViewport.height }
      this.pageMetrics.set(1, this.defaultMetric)
      this.createPagePlaceholders()
      await this.fit({ immediate: true, showHint: false })
      this.viewport.scrollTop = 0
      this.viewport.scrollLeft = 0
      this.updateVirtualWindow(1)
      this.emitState({ loading: false, error: '' })
    } catch (error) {
      await this.releaseDocument()
      this.emitState({ loading: false, error: error.message || 'PDF 加载失败' })
      throw error
    } finally {
      this.root?.classList.remove('is-loading')
    }
  }

  createPagePlaceholders() {
    const pagesRoot = this.pagesRoot
    const viewport = this.viewport
    if (!pagesRoot || !viewport || !this.document) return
    pagesRoot.innerHTML = ''
    this.pageElements.clear()
    this.visibilityRatios.clear()
    const fragment = document.createDocumentFragment()
    for (let page = 1; page <= this.pageCount; page += 1) {
      const wrapper = document.createElement('div')
      wrapper.className = 'pdf-page'
      wrapper.dataset.pageNumber = String(page)
      wrapper.setAttribute('aria-label', `第 ${page} 页`)
      const number = document.createElement('span')
      number.className = 'pdf-page-number'
      number.textContent = String(page)
      wrapper.appendChild(number)
      this.pageElements.set(page, wrapper)
      fragment.appendChild(wrapper)
    }
    pagesRoot.appendChild(fragment)
    this.updateAllPageMetrics()
    this.intersectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => this.visibilityRatios.set(Number(entry.target.dataset.pageNumber), entry.intersectionRatio))
      const visible = [...this.visibilityRatios.entries()].filter(([, ratio]) => ratio > 0)
      if (!visible.length) return
      visible.sort((a, b) => b[1] - a[1] || Math.abs(a[0] - this.pageNumber) - Math.abs(b[0] - this.pageNumber))
      this.setCurrentPage(visible[0][0])
    }, { root: viewport, threshold: [0, 0.05, 0.15, 0.3, 0.5, 0.75, 1] })
    this.pageElements.forEach(element => this.intersectionObserver.observe(element))
    viewport.addEventListener('wheel', this.onWheel, { passive: false })
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.fitWidth || !this.document || this.resizeFrame) return
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0
        this.fit({ showHint: false }).catch(() => {})
      })
    })
    this.resizeObserver.observe(viewport)
  }

  setCurrentPage(pageNumber) {
    const next = Math.max(1, Math.min(this.pageCount, Number(pageNumber) || 1))
    if (next === this.pageNumber) return
    this.pageNumber = next
    this.updateVirtualWindow(next)
    this.emitState()
  }

  updateVirtualWindow(center = this.pageNumber) {
    if (!this.document) return
    const keep = new Set()
    for (let distance = 0; distance <= RENDER_RADIUS; distance += 1) {
      ;[center - distance, center + distance].forEach(page => {
        if (page >= 1 && page <= this.pageCount) keep.add(page)
      })
    }
    this.renderQueue = new Set([...this.renderQueue].filter(page => keep.has(page)))
    ;[...keep].sort((a, b) => Math.abs(a - center) - Math.abs(b - center)).forEach(page => this.queueRender(page))
    this.pageElements.forEach((element, page) => {
      if (Math.abs(page - center) <= RELEASE_RADIUS) return
      this.cancelPageRender(page)
      element.querySelector('canvas')?.remove()
      element.classList.remove('is-rendered', 'is-rendering')
      this.renderedScales.delete(page)
    })
  }

  queueRender(pageNumber) {
    if (!this.document || this.renderedScales.get(pageNumber) === this.scale || this.renderTasks.has(pageNumber)) return
    this.renderQueue.add(pageNumber)
    this.scheduleQueuePump()
  }

  scheduleQueuePump() {
    if (this.idleHandle != null || !this.renderQueue.size) return
    const run = () => {
      this.idleHandle = null
      const next = [...this.renderQueue].sort((a, b) => Math.abs(a - this.pageNumber) - Math.abs(b - this.pageNumber))[0]
      if (!next) return
      this.renderQueue.delete(next)
      this.renderPage(next).catch(error => {
        if (error?.name !== 'RenderingCancelledException') this.emitState({ error: error.message || 'PDF 页面渲染失败' })
      }).finally(() => this.scheduleQueuePump())
    }
    if ('requestIdleCallback' in window) this.idleHandle = window.requestIdleCallback(run, { timeout: 160 })
    else this.idleHandle = window.setTimeout(run, 12)
  }

  async renderPage(pageNumber) {
    const element = this.pageElements.get(pageNumber)
    if (!element || !this.document) return
    const token = this.renderToken
    element.classList.add('is-rendering')
    const page = await this.document.getPage(pageNumber)
    if (token !== this.renderToken || !this.document) { element.classList.remove('is-rendering'); return }
    const base = page.getViewport({ scale: 1 })
    this.pageMetrics.set(pageNumber, { width: base.width, height: base.height })
    this.updatePageMetric(pageNumber)
    let canvas = element.querySelector('canvas')
    if (!canvas) {
      canvas = document.createElement('canvas')
      element.appendChild(canvas)
    }
    const viewport = page.getViewport({ scale: this.scale })
    const outputScale = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    const task = page.render({
      canvasContext: canvas.getContext('2d', { alpha: false }),
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
    })
    this.renderTasks.set(pageNumber, task)
    try {
      await task.promise
      if (token !== this.renderToken) return
      this.renderedScales.set(pageNumber, this.scale)
      element.classList.add('is-rendered')
    } finally {
      if (this.renderTasks.get(pageNumber) === task) this.renderTasks.delete(pageNumber)
      element.classList.remove('is-rendering')
    }
  }

  cancelPageRender(pageNumber) {
    try { this.renderTasks.get(pageNumber)?.cancel?.() } catch {}
    this.renderTasks.delete(pageNumber)
    this.renderQueue.delete(pageNumber)
  }

  updatePageMetric(pageNumber) {
    const element = this.pageElements.get(pageNumber)
    const metric = this.pageMetrics.get(pageNumber) || this.defaultMetric
    if (!element || !metric) return
    const width = Math.max(1, metric.width * this.scale)
    const height = Math.max(1, metric.height * this.scale)
    element.style.width = `${width}px`
    element.style.height = `${height}px`
    const canvas = element.querySelector('canvas')
    if (canvas) {
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
  }

  updateAllPageMetrics() {
    this.pageElements.forEach((_, page) => this.updatePageMetric(page))
  }

  getAnchor(pointer) {
    const viewport = this.viewport
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, pointer?.x ?? rect.width / 2))
    const y = Math.max(0, Math.min(rect.height, pointer?.y ?? rect.height / 2))
    const page = this.pageElements.get(this.pageNumber)
    return {
      page,
      x,
      y,
      pageOffsetX: page ? viewport.scrollLeft + x - page.offsetLeft : 0,
      pageOffsetY: page ? viewport.scrollTop + y - page.offsetTop : 0,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
  }

  restoreAnchor(anchor, ratio) {
    const viewport = this.viewport
    if (!viewport || !anchor) return
    if (anchor.page?.isConnected) {
      viewport.scrollLeft = anchor.page.offsetLeft + anchor.pageOffsetX * ratio - anchor.x
      viewport.scrollTop = anchor.page.offsetTop + anchor.pageOffsetY * ratio - anchor.y
    } else {
      viewport.scrollLeft = (anchor.scrollLeft + anchor.x) * ratio - anchor.x
      viewport.scrollTop = (anchor.scrollTop + anchor.y) * ratio - anchor.y
    }
  }

  async setScale(value, { pointer, fitWidth = false, showHint = true } = {}) {
    if (!this.document) return
    const next = clampScale(value, !fitWidth)
    if (next === this.scale && fitWidth === this.fitWidth) return
    const previous = this.scale
    const anchor = this.getAnchor(pointer)
    this.scale = next
    this.fitWidth = fitWidth
    this.renderToken += 1
    this.renderTasks.forEach(task => { try { task.cancel?.() } catch {} })
    this.renderTasks.clear()
    this.renderQueue.clear()
    this.renderedScales.clear()
    this.updateAllPageMetrics()
    this.restoreAnchor(anchor, next / previous)
    this.updateVirtualWindow(this.pageNumber)
    if (showHint) this.showZoomHint()
    this.emitState()
  }

  async zoomBy(delta, pointer) {
    await this.setScale(this.scale + Number(delta || 0), { pointer, fitWidth: false })
  }

  async zoom(factor) {
    const numeric = Number(factor || 1)
    await this.setScale(this.scale * numeric, { fitWidth: false })
  }

  calculateFitScale() {
    const viewport = this.viewport
    const metric = this.pageMetrics.get(this.pageNumber) || this.defaultMetric
    if (!viewport || !metric) return this.scale
    const style = getComputedStyle(viewport)
    const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    const availableWidth = Math.max(220, viewport.clientWidth - horizontalPadding - 2)
    return clampScale(availableWidth / metric.width, false)
  }

  async fit({ immediate = false, showHint = true } = {}) {
    if (!this.document) return
    const target = this.calculateFitScale()
    await this.setScale(target, { fitWidth: true, showHint })
    if (immediate) this.updateVirtualWindow(this.pageNumber)
  }

  async goTo(pageNumber) {
    if (!this.document) return
    const next = Math.max(1, Math.min(this.pageCount, Number(pageNumber) || 1))
    this.pageNumber = next
    this.updateVirtualWindow(next)
    this.pageElements.get(next)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start', inline: 'center' })
    this.emitState()
  }

  snapshotView() {
    return {
      pageNumber: this.pageNumber,
      scale: this.scale,
      fitWidth: this.fitWidth,
      scrollTop: this.viewport?.scrollTop || 0,
      scrollLeft: this.viewport?.scrollLeft || 0,
    }
  }

  async restoreView(state = {}) {
    if (!this.document || !state || !Object.keys(state).length) return
    if (state.fitWidth === false && Number.isFinite(Number(state.scale))) {
      await this.setScale(Number(state.scale), { fitWidth: false, showHint: false })
    } else if (state.fitWidth) {
      await this.fit({ immediate: true, showHint: false })
    }
    const page = Math.max(1, Math.min(this.pageCount, Number(state.pageNumber) || 1))
    this.pageNumber = page
    this.updateVirtualWindow(page)
    await new Promise(resolve => requestAnimationFrame(resolve))
    if (this.viewport) {
      this.viewport.scrollTop = Math.max(0, Number(state.scrollTop) || 0)
      this.viewport.scrollLeft = Math.max(0, Number(state.scrollLeft) || 0)
    }
    this.emitState()
  }

  handleWheel(event) {
    if (!event.ctrlKey || !this.document) return
    event.preventDefault()
    const rect = this.viewport.getBoundingClientRect()
    this.pendingWheelZoom = { delta: event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, pointer: { x: event.clientX - rect.left, y: event.clientY - rect.top } }
    if (this.wheelFrame) return
    this.wheelFrame = requestAnimationFrame(() => {
      this.wheelFrame = 0
      const pending = this.pendingWheelZoom
      this.pendingWheelZoom = null
      if (pending) this.zoomBy(pending.delta, pending.pointer).catch(() => {})
    })
  }

  showZoomHint() {
    const hint = this.root?.querySelector('[data-pdf-zoom-hint]')
    if (!hint) return
    hint.textContent = `${Math.round(this.scale * 100)}%`
    hint.classList.add('is-visible')
    clearTimeout(this.zoomHintTimer)
    this.zoomHintTimer = setTimeout(() => hint.classList.remove('is-visible'), 800)
  }

  download() {
    if (!this.objectUrl) return
    const anchor = document.createElement('a')
    anchor.href = this.objectUrl
    anchor.download = safeName(this.fileName)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  openWindow() {
    if (this.objectUrl) window.open(this.objectUrl, '_blank', 'noopener,noreferrer')
  }

  async releaseDocument() {
    this.renderToken += 1
    this.intersectionObserver?.disconnect()
    this.resizeObserver?.disconnect()
    this.viewport?.removeEventListener('wheel', this.onWheel)
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame)
    if (this.wheelFrame) cancelAnimationFrame(this.wheelFrame)
    this.wheelFrame = 0
    this.pendingWheelZoom = null
    if (this.idleHandle != null) {
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(this.idleHandle)
      else clearTimeout(this.idleHandle)
    }
    clearTimeout(this.zoomHintTimer)
    this.renderTasks.forEach(task => { try { task.cancel?.() } catch {} })
    this.renderTasks.clear()
    this.renderQueue.clear()
    this.renderedScales.clear()
    this.pageMetrics.clear()
    this.pageElements.clear()
    this.visibilityRatios.clear()
    if (this.pagesRoot) this.pagesRoot.innerHTML = ''
    try { await this.loadingTask?.destroy?.() } catch {}
    this.loadingTask = null
    this.document = null
    this.pageCount = 0
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
    this.blob = null
  }

  async destroy() {
    await this.releaseDocument()
    this.fileName = ''
    this.sourceType = ''
    this.pageNumber = 1
    this.emitState({ loaded: false })
  }
}
