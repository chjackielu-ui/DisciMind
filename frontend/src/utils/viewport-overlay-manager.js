const entries = new Map()
let frame = 0

function overlaps(left, right, gap = 10) {
  return left.left < right.right + gap && left.right > right.left - gap && left.top < right.bottom + gap && left.bottom > right.top - gap
}

function arrange() {
  frame = 0
  const viewportHeight = window.innerHeight
  const active = [...entries.values()].filter(entry => entry.element?.isConnected && !entry.element.hidden).sort((a,b)=>a.priority-b.priority)
  active.forEach(entry => {
    const rect = entry.element.getBoundingClientRect()
    const requested = Number(entry.getY?.() ?? rect.top)
    const top = Math.max(entry.margin, Math.min(viewportHeight - rect.height - entry.margin, requested))
    entry.element.style.top = `${top}px`
    entry.onMove?.(top)
  })
  for(let index=1;index<active.length;index+=1){
    const entry=active[index]
    for(let previous=0;previous<index;previous+=1){
      const earlier=active[previous]
      const currentRect=entry.element.getBoundingClientRect();const earlierRect=earlier.element.getBoundingClientRect()
      if(!overlaps(currentRect,earlierRect))continue
      let top=earlierRect.bottom+10
      if(top+currentRect.height>viewportHeight-entry.margin)top=Math.max(entry.margin,earlierRect.top-currentRect.height-10)
      entry.element.style.top=`${top}px`;entry.onMove?.(top)
    }
  }
}

export function layoutViewportOverlays() {
  if(frame)return
  frame=requestAnimationFrame(arrange)
}

export function registerViewportOverlay(id, element, options = {}) {
  entries.set(id,{ id, element, priority:Number(options.priority||50), margin:Number(options.margin||10), getY:options.getY, onMove:options.onMove })
  layoutViewportOverlays()
  return () => { entries.delete(id);layoutViewportOverlays() }
}

export function clearViewportOverlays() {
  entries.clear()
  if(frame)cancelAnimationFrame(frame)
  frame=0
}

window.addEventListener('resize',layoutViewportOverlays,{passive:true})
