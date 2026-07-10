// 学习流可视化编辑器 — DisciMind 专业版
import { learningWorkflowApi } from '../api/learning-workflows.js';
import { navigateTo } from '../utils/router.js';
import { FLOW_DRAFT_STORAGE_KEY, LEARNING_FLOW_NODE_TYPES } from '../config/learning-flow.js';

// ============================================================
// SVG icons
// ============================================================
const IC = {
  explain:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
  practice:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h4v18H5V3zm7 6h7v2h-7V9zm0-4h5v2h-5V5zm0 8h7v2h-7v-2z"/></svg>',
  repair:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.66 3.34L22 7.68l-14.5 14.5-6.16-1.28L3 20.66l14.66-17.32zM1 22l2-7 5 5-7 2z"/></svg>',
  control:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 22h20L12 2zm-1 8h2v4h-2v-4zm0 6h2v2h-2v-2z"/></svg>',
  summary:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h7l2 2h7v14H4V4zm3 10h10v1H7v-1zm0-3h10v1H7v-1z"/></svg>',
  undo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.5 18A9 9 0 102 12.5"/></svg>',
  redo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.5 18A9 9 0 1122 12.5"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  save:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  play:'<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>',
  layout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  zoomFit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  target:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  history:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  more:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
  arrowRight:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
};
function icon(n,s=16){return `<span class="lw-icon" style="width:${s}px;height:${s}px">${IC[n]||''}</span>`;}

// ============================================================
// Constants
// ============================================================
const NODE_TYPES = LEARNING_FLOW_NODE_TYPES.map((node) => ({
  ...node, cat: node.category, desc: node.description, mins: node.minutes, icon: node.category,
}));
const CAT_COLORS = {
  explain:{bar:'#3b82f6',bg:'#eff6ff',text:'#1d4ed8',border:'#bfdbfe',light:'#dbeafe'},
  practice:{bar:'#22c55e',bg:'#f0fdf4',text:'#15803d',border:'#bbf7d0',light:'#dcfce7'},
  repair:{bar:'#f97316',bg:'#fff7ed',text:'#c2410c',border:'#fed7aa',light:'#ffedd5'},
  control:{bar:'#a855f7',bg:'#faf5ff',text:'#7e22ce',border:'#e9d5ff',light:'#f3e8ff'},
  summary:{bar:'#6366f1',bg:'#eef2ff',text:'#4338ca',border:'#c7d2fe',light:'#e0e7ff'},
};
const CONDITION_TYPES = [
  { type:'always', label:'无条件' },
  { type:'answer_correct', label:'回答正确' },
  { type:'answer_incorrect', label:'回答错误' },
  { type:'mastery_gte', label:'掌握度 >= 阈值' },
  { type:'mastery_lt', label:'掌握度 < 阈值' },
  { type:'consecutive_wrong_gte', label:'连续错误 >= N次' },
  { type:'accuracy_gte', label:'准确率 >= 阈值' },
  { type:'accuracy_lt', label:'准确率 < 阈值' },
];
function catOf(t){const m={concept_explanation:'explain',analogy_explanation:'explain',worked_example_analysis:'explain',socratic_questioning:'explain',basic_practice:'practice',adaptive_practice:'practice',wrong_question_repair:'repair',mastery_gate:'control',learning_summary:'summary'};return m[t]||'explain';}
function ntInfo(t){return NODE_TYPES.find(n=>n.type===t);}

// ============================================================
// Editor state
// ============================================================
const N_W=200,N_H=100;
const SNAP=20;
const ES={
  templateId:null,template:null,
  courseId:null,knowledgePointId:null,description:'',
  graph:{entryNodeId:'',nodes:[],edges:[]},
  settings:{completion_mode:'flow_complete',target_mastery:80,adjustment_mode:'auto_adjust',estimated_minutes:25},
  title:'',
  selNodeId:null,selEdgeId:null,
  panX:0,panY:0,scale:1,
  connecting:null,dragging:null,panning:null,
  undoStack:[],redoStack:[],
  dirty:false,saveStatus:'', // ''|saving|saved|error
  clipboard:null,
  autoSaveTimer:null,
  eventAbort:null,
};

// ============================================================
// Main render
// ============================================================
export async function renderStudentLearningFlowEditor(app,params={}) {
  ES.eventAbort?.abort();
  if (ES.autoSaveTimer) clearTimeout(ES.autoSaveTimer);
  ES.eventAbort = new AbortController();
  const tId=params.workflowId;
  app.innerHTML=`
<div class="lw-editor-shell">
  <div class="lw-editor-toolbar">
    <div class="lw-editor-toolbar-left">
      <button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-back">${icon('back',14)} 返回</button>
      <input class="lw-editor-title-input" id="lwe-title" placeholder="未命名学习流" maxlength="200">
      <span class="lw-editor-save-status" id="lwe-save-status"></span>
    </div>
    <div class="lw-editor-toolbar-center">
      <button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-undo" disabled title="撤销 Ctrl+Z">${icon('undo',14)}</button>
      <button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-redo" disabled title="重做 Ctrl+Y">${icon('redo',14)}</button>
      <span style="color:#e2e8f0">|</span>
      <button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-auto-layout" title="自动布局">${icon('layout',14)} 布局</button>
      <button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-fit" title="适应画布">${icon('zoomFit',14)}</button>
      <button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-validate" title="校验流程">${icon('check',14)} 校验</button>
    </div>
    <div class="lw-editor-toolbar-right">
      <button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-save">${icon('save',14)} 保存</button>
      <button class="lw-btn lw-btn-sm lw-btn-accent" id="lwe-start">${icon('play',14)} 开始学习</button>
    </div>
  </div>

  <div class="lw-editor-body">
    <div class="lw-editor-palette" id="lwe-palette">
      <div class="lw-palette-header">学习行为节点</div>
      <div class="lw-palette-search"><input type="text" id="lwe-palette-search" placeholder="搜索节点..."></div>
      <div id="lwe-palette-list"></div>
    </div>

    <div class="lw-editor-canvas-wrap" id="lwe-canvas-wrap">
      <svg class="lw-editor-svg" id="lwe-svg"></svg>
      <div class="lw-editor-canvas" id="lwe-canvas"></div>
      <div class="lw-canvas-empty" id="lwe-empty">
        <div class="lw-canvas-empty-inner">
          <p>从左侧拖入学习节点，或选择快速开始结构</p>
          <div class="lw-canvas-quick-structs">
            <button id="lwe-quick-explain-practice">讲解+练习</button>
            <button id="lwe-quick-practice-first">先练后学</button>
            <button id="lwe-quick-repair">薄弱修复</button>
          </div>
        </div>
      </div>
      <div class="lw-editor-minimap" id="lwe-minimap"><canvas id="lwe-minimap-canvas" width="160" height="100"></canvas></div>
    </div>

    <div class="lw-editor-panel" id="lwe-panel">
      <div id="lwe-panel-empty" class="lw-panel-empty">选择一个节点或连线以编辑</div>
      <div id="lwe-panel-settings" style="display:none"></div>
      <div id="lwe-panel-node" style="display:none"></div>
      <div id="lwe-panel-edge" style="display:none"></div>
    </div>
  </div>
</div>`;

  if(tId&&tId!=='new'){await loadTemplate(tId);}else{initEmpty();}
  renderPalette();
  bindAll();
  renderCanvas();
  renderSettingsPanel();
}

// ============================================================
// Data
// ============================================================
async function loadTemplate(id){
  try{
    const r=await learningWorkflowApi.getTemplate(id);
    ES.template=r.data||r;ES.templateId=id;
    const v=ES.template.latestVersion;
    ES.graph=v?.graph_json||{entryNodeId:'',nodes:[],edges:[]};
    ES.settings=v?.settings_json||ES.settings;
    ES.title=ES.template.title||'';
    ES.description=ES.template.description||'';
    ES.courseId=ES.template.course_id||null;
    ES.knowledgePointId=ES.template.knowledge_point_id||null;
    setVal('lwe-title',ES.title);
    pushUndo();renderCanvas();renderSettingsPanel();
  }catch(e){showToast('加载失败: '+(e.message||''),'error');initEmpty();}
}
function initEmpty(){
  ES.templateId=null;ES.template=null;
  ES.graph={entryNodeId:'',nodes:[],edges:[]};
  ES.description='';ES.courseId=null;ES.knowledgePointId=null;
  const draft=readDraft();
  ES.title=draft?.title||'';ES.description=draft?.description||'';
  ES.courseId=draft?.courseId||null;ES.knowledgePointId=draft?.knowledgePointId||null;
  ES.settings={...ES.settings,...(draft?.settings||{})};
  setVal('lwe-title',ES.title);
  pushUndo();renderCanvas();renderSettingsPanel();
}

// ============================================================
// Palette
// ============================================================
function renderPalette(filter=''){
  const list=document.getElementById('lwe-palette-list');
  if(!list)return;
  const cats={explain:[],practice:[],repair:[],control:[],summary:[]};
  for(const nt of NODE_TYPES){
    if(filter&&!nt.label.includes(filter)&&!nt.type.includes(filter)&&!nt.agent.includes(filter))continue;
    cats[nt.cat].push(nt);
  }
  const catLabels={explain:'讲解类',practice:'训练类',repair:'修复类',control:'判断类',summary:'总结类'};
  let html='';
  for(const [cat,items] of Object.entries(cats)){
    if(items.length===0)continue;
    html+=`<div class="lw-palette-cat">${catLabels[cat]||cat}</div>`;
    for(const nt of items){
      const c=CAT_COLORS[cat];
      html+=`<div class="lw-palette-item" data-type="${nt.type}" draggable="true">
        <div class="lw-palette-item-icon" style="background:${c.bg};color:${c.text}">${icon(nt.icon,16)}</div>
        <div class="lw-palette-item-info">
          <div class="lw-palette-item-name">${nt.label}</div>
          <div class="lw-palette-item-meta">${nt.agent} | ${nt.mins}分钟</div>
        </div>
      </div>`;
    }
  }
  list.innerHTML=html;
  bindPaletteDrag();
  bindPaletteClick();
}
function bindPaletteDrag(){
  document.querySelectorAll('.lw-palette-item').forEach(el=>{
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('nodeType',el.dataset.type);
      e.dataTransfer.effectAllowed='copy';
    });
  });
}
function bindPaletteClick(){
  document.querySelectorAll('.lw-palette-item').forEach(el=>{
    el.addEventListener('click',()=>{
      const wrap=document.getElementById('lwe-canvas-wrap');
      const r=wrap.getBoundingClientRect();
      const cx=r.width/2,cY=r.height/2;
      const x=snap((cx-ES.panX)/ES.scale-N_W/2);
      const y=snap((cY-ES.panY)/ES.scale-N_H/2);
      addNode(el.dataset.type,x,y);
    });
  });
}

// ============================================================
// Canvas rendering
// ============================================================
function renderCanvas(){
  const wrap=document.getElementById('lwe-canvas-wrap');
  const canvas=document.getElementById('lwe-canvas');
  const svg=document.getElementById('lwe-svg');
  const empty=document.getElementById('lwe-empty');
  if(!canvas||!svg)return;

  const g=ES.graph;
  const hasNodes=g.nodes.length>0;
  if(empty)empty.style.display=hasNodes?'none':'flex';

  // SVG edges
  svg.innerHTML='';
  svg.setAttribute('width','100%');svg.setAttribute('height','100%');
  // Arrow marker
  const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML=`<marker id="lwe-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#94a3b8"/></marker>
  <marker id="lwe-arrow-sel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#6366f1"/></marker>
  <marker id="lwe-arrow-cond" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#f59e0b"/></marker>`;
  svg.appendChild(defs);

  for(const edge of g.edges||[]){
    const sn=g.nodes.find(n=>n.id===edge.source);
    const tn=g.nodes.find(n=>n.id===edge.target);
    if(!sn||!tn)continue;
    const sx=(sn.position?.x||0)+N_W/2,sy=(sn.position?.y||0)+N_H;
    const tx=(tn.position?.x||0)+N_W/2,ty=(tn.position?.y||0);
    const isSel=ES.selEdgeId===edge.id;
    const isCond=edge.condition&&edge.condition.type!=='always';
    const midY=(sy+ty)/2;
    const d=`M${sx} ${sy} C${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;

    // Hit area (wider invisible)
    const hit=document.createElementNS('http://www.w3.org/2000/svg','path');
    hit.setAttribute('d',d);hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width','16');
    hit.setAttribute('fill','none');hit.classList.add('lw-edge-hit');
    hit.dataset.edgeId=edge.id;
    hit.addEventListener('click',e=>{e.stopPropagation();selectEdge(edge.id);});
    svg.appendChild(hit);

    // Visible path
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',d);
    path.setAttribute('stroke',isSel?'#6366f1':isCond?'#f59e0b':'#94a3b8');
    path.setAttribute('stroke-width',isSel?'3':'2');path.setAttribute('fill','none');
    path.setAttribute('marker-end',isSel?'url(#lwe-arrow-sel)':isCond?'url(#lwe-arrow-cond)':'url(#lwe-arrow)');
    path.style.pointerEvents='none';
    svg.appendChild(path);

    // Condition label
    if(isCond){
      const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');
      lbl.setAttribute('x',(sx+tx)/2);lbl.setAttribute('y',midY-6);
      lbl.setAttribute('text-anchor','middle');lbl.setAttribute('font-size','10');lbl.setAttribute('fill','#f59e0b');
      lbl.textContent=edge.label||getConditionLabel(edge.condition);
      svg.appendChild(lbl);
    }
  }

  // HTML nodes
  canvas.innerHTML='';
  for(const node of g.nodes||[]){
    const cat=catOf(node.type);const c=CAT_COLORS[cat];
    const isSel=ES.selNodeId===node.id;
    const el=document.createElement('div');
    el.className='lw-canvas-node'+(isSel?' selected':'');
    el.style.cssText=`left:${node.position?.x||0}px;top:${node.position?.y||0}px;width:${N_W}px;`;
    el.dataset.nodeId=node.id;
    const mins=node.config?.estimatedMinutes||ntInfo(node.type)?.mins||5;
    el.innerHTML=`
    <div class="lw-canvas-node-body">
      <div class="lw-canvas-node-head">
        <div class="lw-canvas-node-icon" style="background:${c.bg};color:${c.text}">${icon(ntInfo(node.type)?.icon||'explain',14)}</div>
        <div class="lw-canvas-node-type" style="color:${c.text}">${ntInfo(node.type)?.label||node.type}</div>
      </div>
      <div class="lw-canvas-node-title">${esc(node.title||ntInfo(node.type)?.label||'')}</div>
      <div class="lw-canvas-node-meta">
        <span>${icon('clock',10)} ${mins}分钟</span>
        <span style="color:${c.text}">${ntInfo(node.type)?.agent||''}</span>
      </div>
    </div>
    <div class="lw-canvas-node-port in-port" data-port="in" data-node="${node.id}"></div>
    <div class="lw-canvas-node-port out-port" data-port="out" data-node="${node.id}"></div>`;

    // Events
    el.addEventListener('mousedown',e=>{if(e.button===0&&!e.ctrlKey){e.stopPropagation();startDragNode(e,node.id);}});
    el.addEventListener('click',e=>{e.stopPropagation();if(!ES.dragging)selectNode(node.id);});
    el.addEventListener('dblclick',e=>{e.stopPropagation();ES.graph.entryNodeId=node.id;pushUndo();renderCanvas();});
    canvas.appendChild(el);
  }

  // Port events
  canvas.querySelectorAll('.lw-canvas-node-port').forEach(port=>{
    port.addEventListener('mousedown',e=>{
      e.stopPropagation();e.preventDefault();
      const nodeId=port.dataset.node;
      if(port.dataset.port==='out')startConnection(nodeId,e);
    });
    port.addEventListener('mouseup',e=>{
      e.stopPropagation();
      if(ES.connecting&&port.dataset.port==='in')finishConnection(port.dataset.node);
    });
  });

  updateUndoRedo();
  renderMinimap();
}

function renderMinimap(){
  const canvas=document.getElementById('lwe-minimap-canvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const cw=160,ch=100;
  ctx.clearRect(0,0,cw,ch);
  const g=ES.graph;if(g.nodes.length===0)return;
  const xs=g.nodes.map(n=>n.position?.x||0),ys=g.nodes.map(n=>n.position?.y||0);
  const minX=Math.min(...xs),maxX=Math.max(...xs)+N_W,minY=Math.min(...ys),maxY=Math.max(...ys)+N_H;
  const gw=maxX-minX||1,gh=maxY-minY||1;
  const sc=Math.min(cw/gw,ch/gh,1);
  ctx.fillStyle='#e2e8f0';ctx.fillRect(0,0,cw,ch);
  for(const n of g.nodes){
    const nx=(n.position?.x-minX)*sc,ny=(n.position?.y-minY)*sc,nw=N_W*sc,nh=Math.min(N_H*sc,gh*sc);
    ctx.fillStyle=CAT_COLORS[catOf(n.type)]?.bar||'#3b82f6';ctx.fillRect(nx,ny,nw,nh);
  }
  // Viewport rect
  const wrap=document.getElementById('lwe-canvas-wrap');
  if(!wrap)return;
  const vx=(-ES.panX-minX*ES.scale)/(ES.scale||1)*sc;
  const vy=(-ES.panY-minY*ES.scale)/(ES.scale||1)*sc;
  const vw=(wrap.clientWidth)/(ES.scale||1)*sc,vh=(wrap.clientHeight)/(ES.scale||1)*sc;
  ctx.strokeStyle='#6366f1';ctx.lineWidth=1;ctx.strokeRect(vx,vy,vw,vh);
}

// ============================================================
// Node operations
// ============================================================
function addNode(type,x,y){
  const info=ntInfo(type);if(!info)return;
  const node={
    id:'n'+Date.now()+Math.random().toString(36).slice(2,5),
    type,title:info.label,
    config:{estimatedMinutes:info.mins},
    position:{x:snap(x||200),y:snap(y||200)},
  };
  pushUndo();ES.graph.nodes.push(node);
  if(!ES.graph.entryNodeId)ES.graph.entryNodeId=node.id;
  renderCanvas();selectNode(node.id);markDirty();
}
function startDragNode(e,nodeId){
  ES.dragging={nodeId,startX:e.clientX,startY:e.clientY,
    origX:ES.graph.nodes.find(n=>n.id===nodeId)?.position?.x||0,
    origY:ES.graph.nodes.find(n=>n.id===nodeId)?.position?.y||0};
}
function selectNode(nodeId){
  ES.selNodeId=nodeId;ES.selEdgeId=null;
  renderCanvas();renderNodePanel();
}
function deleteSelectedNode(){
  if(!ES.selNodeId)return;
  pushUndo();
  const id=ES.selNodeId;
  ES.graph.nodes=ES.graph.nodes.filter(n=>n.id!==id);
  ES.graph.edges=ES.graph.edges.filter(e=>e.source!==id&&e.target!==id);
  if(ES.graph.entryNodeId===id)ES.graph.entryNodeId=ES.graph.nodes[0]?.id||'';
  ES.selNodeId=null;
  renderCanvas();showPanelEmpty();markDirty();
}
function copySelectedNode(){
  if(!ES.selNodeId)return;
  const src=ES.graph.nodes.find(n=>n.id===ES.selNodeId);
  if(!src)return;
  ES.clipboard={type:src.type,title:src.title,config:{...src.config}};
  showToast('节点已复制','info');
}
function pasteNode(){
  if(!ES.clipboard)return;
  const wrap=document.getElementById('lwe-canvas-wrap');const r=wrap.getBoundingClientRect();
  const x=snap((r.width/2-ES.panX)/ES.scale),y=snap((r.height/2-ES.panY)/ES.scale);
  addNode(ES.clipboard.type,x,y);
  const n=ES.graph.nodes[ES.graph.nodes.length-1];
  if(n){n.title=ES.clipboard.title;n.config={...ES.clipboard.config};}
  renderCanvas();markDirty();
}

// ============================================================
// Connection
// ============================================================
function startConnection(nodeId,e){
  ES.connecting={sourceNodeId:nodeId,startX:e.clientX,startY:e.clientY};
  // Draw preview
  const overlay=document.createElement('div');overlay.className='lw-connecting-line';overlay.id='lwe-connect-overlay';
  overlay.innerHTML=`<svg><path id="lwe-connect-path" d=""/></svg>`;
  document.body.appendChild(overlay);
  const signal=ES.eventAbort?.signal;
  document.addEventListener('mousemove',updateConnectionPreview,{signal});
  document.addEventListener('mouseup',endConnectionDrag,{signal});
}
function updateConnectionPreview(e){
  if(!ES.connecting)return;
  const srcNode=ES.graph.nodes.find(n=>n.id===ES.connecting.sourceNodeId);
  if(!srcNode)return;
  const wrap=document.getElementById('lwe-canvas-wrap');const wr=wrap.getBoundingClientRect();
  const sx=(srcNode.position?.x||0)+N_W/2,sY=(srcNode.position?.y||0)+N_H;
  const fsx=sx*ES.scale+ES.panX+wr.left,fsy=sY*ES.scale+ES.panY+wr.top;
  const midY=(fsy+e.clientY)/2;
  const path=document.getElementById('lwe-connect-path');
  if(path)path.setAttribute('d',`M${fsx} ${fsy} C${fsx} ${midY}, ${e.clientX} ${midY}, ${e.clientX} ${e.clientY}`);
}
function endConnectionDrag(e){
  document.removeEventListener('mousemove',updateConnectionPreview);
  document.removeEventListener('mouseup',endConnectionDrag);
  const overlay=document.getElementById('lwe-connect-overlay');
  if(overlay)overlay.remove();
  ES.connecting=null;
}
function finishConnection(targetNodeId){
  if(!ES.connecting)return;
  const src=ES.connecting.sourceNodeId;
  if(src===targetNodeId){ES.connecting=null;return;}
  const dup=ES.graph.edges.some(e=>e.source===src&&e.target===targetNodeId);
  if(dup){ES.connecting=null;return;}
  if (wouldCreateCycle(src, targetNodeId)) { ES.connecting=null;showToast('该连线会形成循环，已阻止','warn');return; }
  pushUndo();
  ES.graph.edges.push({id:'e'+Date.now(),source:src,target:targetNodeId,condition:{type:'always',params:{}},label:''});
  ES.connecting=null;
  renderCanvas();markDirty();
}
function wouldCreateCycle(source,target){
  const seen=new Set([target]);const queue=[target];
  while(queue.length){const current=queue.shift();if(current===source)return true;for(const edge of ES.graph.edges){if(edge.source===current&&!seen.has(edge.target)){seen.add(edge.target);queue.push(edge.target);}}}
  return false;
}

// ============================================================
// Edge selection
// ============================================================
function selectEdge(edgeId){
  ES.selEdgeId=edgeId;ES.selNodeId=null;
  renderCanvas();renderEdgePanel();
}
function deleteSelectedEdge(){
  if(!ES.selEdgeId)return;
  pushUndo();ES.graph.edges=ES.graph.edges.filter(e=>e.id!==ES.selEdgeId);
  ES.selEdgeId=null;renderCanvas();showPanelEmpty();markDirty();
}

// ============================================================
// Panel rendering
// ============================================================
function showPanelEmpty(){
  document.getElementById('lwe-panel-empty').style.display='';
  document.getElementById('lwe-panel-settings').style.display='none';
  document.getElementById('lwe-panel-node').style.display='none';
  document.getElementById('lwe-panel-edge').style.display='none';
}
function renderSettingsPanel(){
  const s=ES.settings;
  document.getElementById('lwe-panel-empty').style.display='none';
  document.getElementById('lwe-panel-settings').style.display='';
  document.getElementById('lwe-panel-node').style.display='none';
  document.getElementById('lwe-panel-edge').style.display='none';
  document.getElementById('lwe-panel-settings').innerHTML=`
  <div class="lw-panel-section"><h4>流程设置</h4>
    <div class="lw-form-group"><label>流程名称</label><input class="lw-form-input" id="lwe-s-title" value="${esc(ES.title)}" maxlength="200"></div>
    <div class="lw-form-group"><label>流程简介</label><textarea class="lw-form-input" id="lwe-s-desc" rows="3" maxlength="1000">${esc(ES.description)}</textarea></div>
    <div class="lw-form-group"><label>学习范围</label><div style="font-size:12px;color:#627d98;line-height:1.5">${ES.courseId?`课程 #${ES.courseId} · 知识点 #${ES.knowledgePointId||'未选择'}`:'尚未绑定课程与知识点；开始学习时将先引导选择。'}</div></div>
    <div class="lw-form-group"><label>完成方式</label><select class="lw-form-select" id="lwe-s-completion">${opt('flow_complete','按流程完成',s.completion_mode)}${opt('mastery_target','达到目标掌握度',s.completion_mode)}</select></div>
    <div class="lw-form-group"><label>目标掌握度 (%)</label><input class="lw-form-input" id="lwe-s-mastery" type="number" min="60" max="100" value="${s.target_mastery||80}"></div>
    <div class="lw-form-group"><label>诊断师调整</label><select class="lw-form-select" id="lwe-s-adjust">${opt('auto_adjust','自动调整',s.adjustment_mode)}${opt('ask_before_adjust','询问后调整',s.adjustment_mode)}${opt('strict_original','严格原流程',s.adjustment_mode)}</select></div>
    <div class="lw-form-group"><label>预计时长 (分钟)</label><input class="lw-form-input" id="lwe-s-mins" type="number" min="1" max="120" value="${s.estimated_minutes||25}"></div>
  </div>
  <div class="lw-panel-section"><h4>版本</h4>
    <div style="font-size:12px;color:#94a3b8">${ES.template?`当前版本: ${ES.template.latestVersion?.version_number||1} | ${new Date(ES.template.updated_at).toLocaleString()}`:'新模板'}</div>
    ${ES.templateId?`<button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-versions" style="margin-top:8px">${icon('history',14)} 查看历史版本</button>`:''}
  </div>`;
  bindSettingsEvents();
}
function renderNodePanel(){
  const node=ES.graph.nodes.find(n=>n.id===ES.selNodeId);
  if(!node){showPanelEmpty();return;}
  document.getElementById('lwe-panel-empty').style.display='none';
  document.getElementById('lwe-panel-settings').style.display='none';
  document.getElementById('lwe-panel-node').style.display='';
  document.getElementById('lwe-panel-edge').style.display='none';
  const info=ntInfo(node.type);
  document.getElementById('lwe-panel-node').innerHTML=`
  <div class="lw-panel-section"><h4>节点配置: ${info?.label||node.type}</h4>
    <div class="lw-form-group"><label>节点标题</label><input class="lw-form-input" id="lwe-n-title" value="${esc(node.title||'')}" maxlength="100"></div>
    <div class="lw-form-group"><label>类型</label><select class="lw-form-select" id="lwe-n-type">${NODE_TYPES.map(t=>`<option value="${t.type}" ${node.type===t.type?'selected':''}>${t.label} (${t.agent})</option>`).join('')}</select></div>
    <div class="lw-form-row"><div class="lw-form-group"><label>时长(分钟)</label><input class="lw-form-input" id="lwe-n-mins" type="number" min="1" max="60" value="${node.config?.estimatedMinutes||info?.mins||5}"></div>
    ${node.type.includes('practice')?`<div class="lw-form-group"><label>题量</label><input class="lw-form-input" id="lwe-n-qcount" type="number" min="1" max="20" value="${node.config?.questionCount||3}"></div>`:''}</div>
    ${info?.cat==='explain'?`<div class="lw-form-group"><label>讲解策略</label><select class="lw-form-select" id="lwe-n-strategy"><option value="">自动选择</option><option value="direct_instruction" ${node.config?.strategy==='direct_instruction'?'selected':''}>直接讲授</option><option value="socratic_dialogue" ${node.config?.strategy==='socratic_dialogue'?'selected':''}>苏格拉底对话</option><option value="analogy_bridge" ${node.config?.strategy==='analogy_bridge'?'selected':''}>类比桥接</option><option value="misconception_confrontation" ${node.config?.strategy==='misconception_confrontation'?'selected':''}>误解对质</option></select></div>`:''}
  </div>
  <div class="lw-panel-section"><h4>操作</h4>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-n-copy">${icon('copy',14)} 复制</button>
      ${ES.graph.entryNodeId!==node.id?`<button class="lw-btn lw-btn-sm lw-btn-outline" id="lwe-n-set-entry">设为入口</button>`:''}
      <button class="lw-btn lw-btn-sm lw-btn-danger" id="lwe-n-delete">${icon('trash',14)} 删除</button>
    </div>
  </div>`;
  bindNodePanelEvents(node);
}
function renderEdgePanel(){
  const edge=ES.graph.edges.find(e=>e.id===ES.selEdgeId);
  if(!edge){showPanelEmpty();return;}
  document.getElementById('lwe-panel-empty').style.display='none';
  document.getElementById('lwe-panel-settings').style.display='none';
  document.getElementById('lwe-panel-node').style.display='none';
  document.getElementById('lwe-panel-edge').style.display='';
  document.getElementById('lwe-panel-edge').innerHTML=`
  <div class="lw-panel-section"><h4>连线配置</h4>
    <div class="lw-form-group"><label>条件类型</label><select class="lw-form-select" id="lwe-e-condition">${CONDITION_TYPES.map(c=>`<option value="${c.type}" ${(edge.condition?.type||'always')===c.type?'selected':''}>${c.label}</option>`).join('')}</select></div>
    <div class="lw-form-group"><label>阈值</label><input class="lw-form-input" id="lwe-e-threshold" type="number" min="0" max="100" value="${edge.condition?.params?.threshold||80}"></div>
    <div class="lw-form-group"><label>标签</label><input class="lw-form-input" id="lwe-e-label" value="${esc(edge.label||'')}" maxlength="100"></div>
  </div>
  <div class="lw-panel-section"><button class="lw-btn lw-btn-sm lw-btn-danger" id="lwe-e-delete">${icon('trash',14)} 删除连线</button></div>`;
  bindEdgePanelEvents(edge);
}
function opt(v,l,cur){return `<option value="${v}" ${cur===v?'selected':''}>${l}</option>`;}

function bindSettingsEvents(){
  document.getElementById('lwe-s-title')?.addEventListener('input',()=>{ES.title=getVal('lwe-s-title');setVal('lwe-title',ES.title);markDirty();});
  document.getElementById('lwe-s-desc')?.addEventListener('input',()=>{ES.description=getVal('lwe-s-desc');markDirty();});
  document.getElementById('lwe-s-completion')?.addEventListener('change',()=>{ES.settings.completion_mode=getVal('lwe-s-completion');markDirty();});
  document.getElementById('lwe-s-mastery')?.addEventListener('change',()=>{ES.settings.target_mastery=parseInt(getVal('lwe-s-mastery'))||80;markDirty();});
  document.getElementById('lwe-s-adjust')?.addEventListener('change',()=>{ES.settings.adjustment_mode=getVal('lwe-s-adjust');markDirty();});
  document.getElementById('lwe-s-mins')?.addEventListener('change',()=>{ES.settings.estimated_minutes=parseInt(getVal('lwe-s-mins'))||25;markDirty();});
  document.getElementById('lwe-versions')?.addEventListener('click',showVersions);
}
function bindNodePanelEvents(node){
  document.getElementById('lwe-n-title')?.addEventListener('input',()=>{node.title=getVal('lwe-n-title');renderCanvas();markDirty();});
  document.getElementById('lwe-n-type')?.addEventListener('change',()=>{node.type=getVal('lwe-n-type');node.title=ntInfo(node.type)?.label||node.type;pushUndo();renderCanvas();renderNodePanel();markDirty();});
  document.getElementById('lwe-n-mins')?.addEventListener('change',()=>{if(!node.config)node.config={};node.config.estimatedMinutes=parseInt(getVal('lwe-n-mins'))||5;renderCanvas();markDirty();});
  const qc=document.getElementById('lwe-n-qcount');if(qc)qc.addEventListener('change',()=>{if(!node.config)node.config={};node.config.questionCount=parseInt(getVal('lwe-n-qcount'))||3;markDirty();});
  const st=document.getElementById('lwe-n-strategy');if(st)st.addEventListener('change',()=>{if(!node.config)node.config={};node.config.strategy=getVal('lwe-n-strategy')||undefined;markDirty();});
  document.getElementById('lwe-n-copy')?.addEventListener('click',copySelectedNode);
  document.getElementById('lwe-n-set-entry')?.addEventListener('click',()=>{ES.graph.entryNodeId=node.id;pushUndo();renderCanvas();});
  document.getElementById('lwe-n-delete')?.addEventListener('click',deleteSelectedNode);
}
function bindEdgePanelEvents(edge){
  document.getElementById('lwe-e-condition')?.addEventListener('change',()=>{edge.condition=edge.condition||{type:'always',params:{}};edge.condition.type=getVal('lwe-e-condition');pushUndo();renderCanvas();markDirty();});
  document.getElementById('lwe-e-threshold')?.addEventListener('change',()=>{edge.condition=edge.condition||{type:'always',params:{}};edge.condition.params=edge.condition.params||{};edge.condition.params.threshold=parseInt(getVal('lwe-e-threshold'))||80;markDirty();});
  document.getElementById('lwe-e-label')?.addEventListener('input',()=>{edge.label=getVal('lwe-e-label');renderCanvas();markDirty();});
  document.getElementById('lwe-e-delete')?.addEventListener('click',deleteSelectedEdge);
}

async function showVersions(){
  if(!ES.templateId)return;
  try{
    const r=await learningWorkflowApi.getVersions(ES.templateId);
    const versions=r.data||r;
    const overlay=document.createElement('div');overlay.className='lw-overlay';
    overlay.innerHTML=`<div class="lw-dialog"><div class="lw-dialog-head"><h2>历史版本</h2><button class="lw-dialog-close">${icon('close',20)}</button></div>
    <div class="lw-dialog-body">${(!versions||versions.length===0)?'<p>暂无历史版本</p>':versions.map((v,i)=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9">
        <div><strong>v${v.version_number}</strong> <span style="font-size:12px;color:#94a3b8">${v.change_summary||''}</span><br><span style="font-size:11px;color:#94a3b8">${new Date(v.created_at).toLocaleString()}</span></div>
        ${i>0?`<button class="lw-btn lw-btn-sm lw-btn-outline restore-ver" data-vid="${v.version_id}">${icon('history',14)} 恢复</button>`:'<span style="font-size:11px;color:#94a3b8">当前</span>'}
      </div>`).join('')}</div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.lw-dialog-close')?.addEventListener('click',()=>overlay.remove());
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
    overlay.querySelectorAll('.restore-ver').forEach(b=>b.addEventListener('click',async()=>{
      try{await learningWorkflowApi.restoreVersion(ES.templateId,b.dataset.vid);overlay.remove();await loadTemplate(ES.templateId);showToast('版本已恢复','info');}
      catch(e){showToast('恢复失败: '+(e.message||''),'error');}
    }));
  }catch(e){showToast('加载版本失败: '+(e.message||''),'error');}
}

// ============================================================
// Validation
// ============================================================
function validateGraph(){
  const g=ES.graph;const errors=[];const warns=[];
  if(!g.entryNodeId)errors.push({msg:'缺少入口节点（双击节点设为入口）',node:null});
  if(g.nodes.length===0)errors.push({msg:'至少需要一个节点',node:null});
  if(g.nodes.length>30)errors.push({msg:'节点数不能超过30',node:null});

  // Entry exists
  if(g.entryNodeId&&!g.nodes.find(n=>n.id===g.entryNodeId))errors.push({msg:'入口节点不存在于流程中',node:null});

  // Reachable & orphans
  if(g.nodes.length>0&&g.entryNodeId){
    const reachable=new Set();const q=[g.entryNodeId];
    while(q.length){const c=q.shift();if(reachable.has(c))continue;reachable.add(c);for(const e of g.edges){if(e.source===c&&!reachable.has(e.target))q.push(e.target);}}
    for(const n of g.nodes){if(!reachable.has(n.id))warns.push({msg:`孤立节点: ${n.title||n.type}`,node:n.id});}
    const hasEnd=[...reachable].some(id=>!g.edges.some(e=>e.source===id));
    if(!hasEnd)errors.push({msg:'没有可达的结束节点',node:null});
  }

  // Duplicate edges
  const edgeMap={};
  for(const e of g.edges){const k=`${e.source}->${e.target}`;edgeMap[k]=(edgeMap[k]||0)+1;if(edgeMap[k]>1)warns.push({msg:'重复连线',node:null});}

  // Mastery gate branches
  for(const n of g.nodes){
    if(n.type==='mastery_gate'){
      const outs=g.edges.filter(e=>e.source===n.id);
      if(outs.length<2)warns.push({msg:`"${n.title||'掌握度判断'}"建议至少配置两个条件出口`,node:n.id});
    }
  }

  // Unknown node types
  for(const n of g.nodes){if(!NODE_TYPES.find(t=>t.type===n.type))errors.push({msg:`未知节点类型: ${n.type}`,node:n.id});}
  // Unknown condition types
  for(const e of g.edges){if(e.condition&&!CONDITION_TYPES.find(c=>c.type===e.condition.type))errors.push({msg:`未知条件类型: ${e.condition.type}`,node:e.source});}
  // Eval detection
  for(const e of g.edges){if(e.condition&&(e.condition.expression||e.condition.code||e.condition.eval))errors.push({msg:'禁止使用自定义代码表达式',node:e.source});}

  // Cycle detection
  const cycles=detectCycle();
  if(cycles.length>0)errors.push({msg:`检测到循环: ${cycles.join(' -> ')}`,node:null});

  return{errors,warns,valid:errors.length===0};
}
function detectCycle(){
  const ids=new Set(ES.graph.nodes.map(n=>n.id));
  const adj={};for(const id of ids){adj[id]=[];}
  for(const e of ES.graph.edges){if(ids.has(e.source)&&ids.has(e.target))adj[e.source].push(e.target);}
  const indeg={};for(const id of ids)indeg[id]=0;
  for(const e of ES.graph.edges){if(ids.has(e.source)&&ids.has(e.target))indeg[e.target]=(indeg[e.target]||0)+1;}
  const q=[];for(const[id,d]of Object.entries(indeg)){if(d===0)q.push(id);}
  const sorted=[];while(q.length){const c=q.shift();sorted.push(c);for(const n of adj[c]){indeg[n]--;if(indeg[n]===0)q.push(n);}}
  if(sorted.length===ids.size)return[];
  const rem=new Set(ids);for(const id of sorted)rem.delete(id);
  const vis=new Set();const path=[];const cycle=[];
  function dfs(u){if(vis.has(u)){const i=path.indexOf(u);if(i>=0){cycle.push(...path.slice(i),u);return true;}return false;}vis.add(u);path.push(u);for(const v of adj[u]){if(rem.has(v)&&dfs(v))return true;}path.pop();return false;}
  for(const n of rem){if(dfs(n))break;}
  return cycle;
}
function showValidation(){
  const v=validateGraph();
  const toast=document.createElement('div');toast.className='lw-validation-toast';
  const items=[...v.errors.map(e=>({...e,level:'error'})),...v.warns.map(e=>({...e,level:'warn'}))];
  if(items.length===0){items.push({msg:'流程校验通过',node:null,level:'info'});}
  toast.innerHTML=items.map((it,i)=>`<div class="lw-validation-item ${it.level}" ${it.node?`data-node="${it.node}"`:''} style="animation-delay:${i*0.05}s">${it.level==='error'?'!':it.level==='warn'?'?':'i'} ${it.msg}</div>`).join('');
  document.body.appendChild(toast);
  toast.querySelectorAll('.lw-validation-item[data-node]').forEach(el=>{el.addEventListener('click',()=>{const nid=el.dataset.node;selectNode(nid);const n=ES.graph.nodes.find(x=>x.id===nid);if(n){ES.panX=-(n.position?.x||0)+200;ES.panY=-(n.position?.y||0)+200;applyTransform();renderCanvas();}});});
  setTimeout(()=>toast.remove(),8000);
}

// ============================================================
// Auto layout
// ============================================================
function autoLayout(){
  if(ES.graph.nodes.length===0)return;
  pushUndo();
  const g=ES.graph;const nids=new Set(g.nodes.map(n=>n.id));
  const adj={};for(const id of nids)adj[id]=[];
  for(const e of g.edges){if(nids.has(e.source)&&nids.has(e.target))adj[e.source].push(e.target);}
  const indeg={};for(const id of nids)indeg[id]=0;
  for(const id of nids){for(const t of adj[id])indeg[t]=(indeg[t]||0)+1;}
  const layers=[];const remaining=new Set(nids);const col=new Map();
  while(remaining.size>0){
    const layer=[];
    for(const id of remaining){if((indeg[id]||0)===0)layer.push(id);}
    if(layer.length===0){for(const id of remaining){layer.push(id);break;}}
    layers.push(layer);
    for(const id of layer){remaining.delete(id);for(const t of adj[id])indeg[t]=Math.max(0,(indeg[t]||0)-1);}
  }
  const SPACING_X=250,SPACING_Y=130,START_X=60,START_Y=40;
  for(let li=0;li<layers.length;li++){
    const l=layers[li];
    for(let ni=0;ni<l.length;ni++){
      const n=g.nodes.find(x=>x.id===l[ni]);if(!n)continue;
      n.position={x:START_X+li*SPACING_X,y:START_Y+ni*SPACING_Y};
    }
  }
  renderCanvas();markDirty();
  showToast('自动布局完成','info');
}

// ============================================================
// Canvas interaction
// ============================================================
function setupCanvas(){
  const wrap=document.getElementById('lwe-canvas-wrap');if(!wrap)return;

  // Drop from palette
  wrap.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
  wrap.addEventListener('drop',e=>{
    e.preventDefault();
    const type=e.dataTransfer.getData('nodeType');
    if(!type)return;
    const r=wrap.getBoundingClientRect();
    const x=snap((e.clientX-r.left-ES.panX)/ES.scale-N_W/2);
    const y=snap((e.clientY-r.top-ES.panY)/ES.scale-N_H/2);
    addNode(type,x,y);
  });

  // Pan (middle mouse / Space+drag / Ctrl+drag)
  wrap.addEventListener('mousedown',e=>{
    if(e.target!==wrap&&e.target.id!=='lwe-canvas'&&e.target.id!=='lwe-svg')return;
    if(e.button===1||(e.button===0&&e.ctrlKey)||(e.button===0&&ES.spaceDown)){
      e.preventDefault();
      ES.panning={x:e.clientX-ES.panX,y:e.clientY-ES.panY};
    }
    if(e.button===0&&!e.ctrlKey&&!ES.spaceDown){selectNode(null);selectEdge(null);renderCanvas();showPanelEmpty();}
  });

  window.addEventListener('mousemove',e=>{
    if(ES.panning){ES.panX=e.clientX-ES.panning.x;ES.panY=e.clientY-ES.panning.y;applyTransform();renderMinimap();}
    if(ES.dragging){
      const node=ES.graph.nodes.find(n=>n.id===ES.dragging.nodeId);if(!node)return;
      node.position={x:snap(ES.dragging.origX+(e.clientX-ES.dragging.startX)/ES.scale),y:snap(ES.dragging.origY+(e.clientY-ES.dragging.startY)/ES.scale)};
      renderCanvas();
    }
  },{signal:ES.eventAbort?.signal});
  window.addEventListener('mouseup',()=>{
    if(ES.dragging){pushUndo();ES.dragging=null;markDirty();}
    ES.panning=null;
  },{signal:ES.eventAbort?.signal});

  // Zoom
  wrap.addEventListener('wheel',e=>{
    e.preventDefault();const d=e.deltaY>0?-0.08:0.08;
    ES.scale=Math.max(0.25,Math.min(2.5,ES.scale+d));
    applyTransform();renderMinimap();
  });
}
function applyTransform(){
  const canvas=document.getElementById('lwe-canvas');
  const svg=document.getElementById('lwe-svg');
  const t=`translate(${ES.panX}px,${ES.panY}px) scale(${ES.scale})`;
  if(canvas)canvas.style.transform=t;
  if(svg)svg.style.transform=t;
}
function fitCanvas(){
  const g=ES.graph;if(g.nodes.length===0)return;
  const xs=g.nodes.map(n=>n.position?.x||0),ys=g.nodes.map(n=>n.position?.y||0);
  const wrap=document.getElementById('lwe-canvas-wrap');const w=wrap.clientWidth,h=wrap.clientHeight;
  ES.panX=(w/2)-((Math.min(...xs)+Math.max(...xs))/2+N_W/2);ES.panY=(h/2)-((Math.min(...ys)+Math.max(...ys))/2+N_H/2);
  ES.scale=1;applyTransform();renderCanvas();
}
function snap(v){return Math.round(v/SNAP)*SNAP;}

// ============================================================
// Undo/Redo
// ============================================================
function pushUndo(){
  ES.undoStack.push(JSON.parse(JSON.stringify({graph:ES.graph,settings:ES.settings})));
  if(ES.undoStack.length>60)ES.undoStack.shift();
  ES.redoStack=[];
}
function undo(){if(ES.undoStack.length===0)return;ES.redoStack.push(JSON.parse(JSON.stringify({graph:ES.graph,settings:ES.settings})));const s=ES.undoStack.pop();ES.graph=s.graph;ES.settings=s.settings;ES.selNodeId=null;ES.selEdgeId=null;renderCanvas();renderSettingsPanel();markDirty();}
function redo(){if(ES.redoStack.length===0)return;ES.undoStack.push(JSON.parse(JSON.stringify({graph:ES.graph,settings:ES.settings})));const s=ES.redoStack.pop();ES.graph=s.graph;ES.settings=s.settings;renderCanvas();renderSettingsPanel();markDirty();}
function updateUndoRedo(){document.getElementById('lwe-undo').disabled=ES.undoStack.length===0;document.getElementById('lwe-redo').disabled=ES.redoStack.length===0;}

// ============================================================
// Auto-save
// ============================================================
function markDirty(){ES.dirty=true;updateSaveStatus('');if(ES.templateId)scheduleAutoSave();}
function scheduleAutoSave(){
  if(ES.autoSaveTimer)clearTimeout(ES.autoSaveTimer);
  ES.autoSaveTimer=setTimeout(()=>doSave(true),1200);
}
function updateSaveStatus(st){
  ES.saveStatus=st;
  const el=document.getElementById('lwe-save-status');
  if(!el)return;
  el.className='lw-editor-save-status '+st;
  if(st==='saving')el.textContent='正在保存...';
  else if(st==='saved')el.textContent='已保存';
  else if(st==='error')el.textContent='保存失败';
  else if(ES.dirty)el.textContent='未保存';
  else el.textContent='';
}
async function doSave(auto=false){
  if(!ES.dirty&&auto)return true;
  if(auto&&!ES.templateId)return false;
  updateSaveStatus('saving');
  // Update settings
  ES.settings.completion_mode=getVal('lwe-s-completion')||ES.settings.completion_mode;
  ES.settings.target_mastery=parseInt(getVal('lwe-s-mastery'))||ES.settings.target_mastery;
  ES.settings.adjustment_mode=getVal('lwe-s-adjust')||ES.settings.adjustment_mode;
  ES.settings.estimated_minutes=parseInt(getVal('lwe-s-mins'))||ES.settings.estimated_minutes;
  ES.title=(getVal('lwe-title')||ES.title).trim();
  if(!ES.title){updateSaveStatus('error');showToast('请先填写学习流名称','warn');return false;}
  const validation=validateGraph();
  if(!validation.valid){updateSaveStatus('error');if(!auto)showValidation();return false;}

  const data={title:ES.title,description:ES.description||'',course_id:ES.courseId,knowledge_point_id:ES.knowledgePointId,graph_json:ES.graph,settings_json:ES.settings,change_summary:auto?'自动保存':'手动保存'};
  try{
    if(ES.templateId){await learningWorkflowApi.updateTemplate(ES.templateId,data);}
    else{const r=await learningWorkflowApi.createTemplate(data);ES.templateId=(r.data||r).template_id;ES.template=r.data||r;sessionStorage.removeItem(FLOW_DRAFT_STORAGE_KEY);}
    ES.dirty=false;updateSaveStatus('saved');
    return true;
  }catch(e){updateSaveStatus('error');showToast(e.message||'保存失败','error');return false;}
}

// ============================================================
// Toast
// ============================================================
function showToast(msg,level='info'){
  const t=document.createElement('div');t.className='lw-validation-item '+level;t.textContent=msg;t.style.position='fixed';t.style.bottom='24px';t.style.right='24px';t.style.zIndex='600';
  document.body.appendChild(t);setTimeout(()=>t.remove(),3000);
}

// ============================================================
// Quick structures
// ============================================================
function addQuickStruct(type){
  const baseX=120,baseY=80;
  if(type==='explain-practice'){
    ES.graph={entryNodeId:'n1',nodes:[{id:'n1',type:'concept_explanation',title:'概念讲解',config:{estimatedMinutes:6},position:{x:baseX,y:baseY}},{id:'n2',type:'basic_practice',title:'基础练习',config:{estimatedMinutes:6,questionCount:3},position:{x:baseX,y:baseY+140}},{id:'n3',type:'learning_summary',title:'学习总结',config:{estimatedMinutes:3},position:{x:baseX,y:baseY+280}}],edges:[{id:'e1',source:'n1',target:'n2',condition:{type:'always',params:{}}},{id:'e2',source:'n2',target:'n3',condition:{type:'always',params:{}}}]};
  }else if(type==='practice-first'){
    ES.graph={entryNodeId:'n1',nodes:[{id:'n1',type:'basic_practice',title:'快速练习',config:{estimatedMinutes:4,questionCount:2},position:{x:baseX,y:baseY}},{id:'n2',type:'concept_explanation',title:'针对性讲解',config:{estimatedMinutes:5,strategy:'misconception_confrontation'},position:{x:baseX,y:baseY+140}},{id:'n3',type:'adaptive_practice',title:'巩固练习',config:{estimatedMinutes:5,questionCount:3},position:{x:baseX,y:baseY+280}},{id:'n4',type:'learning_summary',title:'学习总结',config:{estimatedMinutes:3},position:{x:baseX,y:baseY+420}}],edges:[{id:'e1',source:'n1',target:'n2',condition:{type:'always',params:{}}},{id:'e2',source:'n2',target:'n3',condition:{type:'always',params:{}}},{id:'e3',source:'n3',target:'n4',condition:{type:'always',params:{}}}]};
  }else if(type==='repair'){
    ES.graph={entryNodeId:'n1',nodes:[{id:'n1',type:'wrong_question_repair',title:'错题分析',config:{estimatedMinutes:5},position:{x:baseX,y:baseY}},{id:'n2',type:'analogy_explanation',title:'类比讲解',config:{estimatedMinutes:4,strategy:'analogy_bridge'},position:{x:baseX,y:baseY+140}},{id:'n3',type:'basic_practice',title:'基础练习',config:{estimatedMinutes:5,questionCount:3},position:{x:baseX,y:baseY+280}},{id:'n4',type:'mastery_gate',title:'掌握度判断',config:{},position:{x:baseX,y:baseY+420}},{id:'n5',type:'learning_summary',title:'学习总结',config:{estimatedMinutes:3},position:{x:baseX,y:baseY+560}},{id:'n6',type:'concept_explanation',title:'薄弱点复盘',config:{estimatedMinutes:4,strategy:'misconception_confrontation'},position:{x:baseX+300,y:baseY+420}}],edges:[{id:'e1',source:'n1',target:'n2',condition:{type:'always',params:{}}},{id:'e2',source:'n2',target:'n3',condition:{type:'always',params:{}}},{id:'e3',source:'n3',target:'n4',condition:{type:'always',params:{}}},{id:'e4',source:'n4',target:'n5',condition:{type:'mastery_gte',params:{threshold:75}},label:'掌握度 >= 75'},{id:'e5',source:'n4',target:'n6',condition:{type:'mastery_lt',params:{threshold:75}},label:'掌握度 < 75'},{id:'e6',source:'n6',target:'n5',condition:{type:'always',params:{}}}]};
  }
  ES.selNodeId=null;ES.selEdgeId=null;pushUndo();renderCanvas();renderSettingsPanel();markDirty();
  fitCanvas();
}

// ============================================================
// Event binding
// ============================================================
function bindAll(){
  setupCanvas();

  const signal=ES.eventAbort.signal;
  document.getElementById('lwe-back')?.addEventListener('click',()=>window.history.back(),{signal});
  document.getElementById('lwe-undo')?.addEventListener('click',undo);
  document.getElementById('lwe-redo')?.addEventListener('click',redo);
  document.getElementById('lwe-auto-layout')?.addEventListener('click',autoLayout);
  document.getElementById('lwe-fit')?.addEventListener('click',fitCanvas);
  document.getElementById('lwe-validate')?.addEventListener('click',showValidation);
  document.getElementById('lwe-save')?.addEventListener('click',()=>doSave(false));
  document.getElementById('lwe-start')?.addEventListener('click',startLearning);
  document.getElementById('lwe-palette-search')?.addEventListener('input',e=>renderPalette(e.target.value),{signal});
  document.getElementById('lwe-title')?.addEventListener('input',()=>{ES.title=getVal('lwe-title');const panelTitle=document.getElementById('lwe-s-title');if(panelTitle)panelTitle.value=ES.title;markDirty();},{signal});

  // Quick structs
  document.getElementById('lwe-quick-explain-practice')?.addEventListener('click',()=>addQuickStruct('explain-practice'));
  document.getElementById('lwe-quick-practice-first')?.addEventListener('click',()=>addQuickStruct('practice-first'));
  document.getElementById('lwe-quick-repair')?.addEventListener('click',()=>addQuickStruct('repair'));

  // Keyboard
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
    if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo();}
    if(e.ctrlKey&&e.key==='y'){e.preventDefault();redo();}
    if(e.ctrlKey&&e.key==='Z'){e.preventDefault();redo();}
    if(e.ctrlKey&&e.key==='c'){copySelectedNode();}
    if(e.ctrlKey&&e.key==='v'){pasteNode();}
    if(e.ctrlKey&&e.key==='s'){e.preventDefault();doSave(false);}
    if(e.key==='Delete'||e.key==='Backspace'){if(ES.selNodeId)deleteSelectedNode();else if(ES.selEdgeId)deleteSelectedEdge();}
    if(e.code==='Space'){ES.spaceDown=true;e.preventDefault();}
  },{signal});
  document.addEventListener('keyup',e=>{if(e.code==='Space')ES.spaceDown=false;},{signal});
  window.addEventListener('beforeunload',e=>{if(ES.dirty){e.preventDefault();e.returnValue='学习流尚未保存，确定离开吗？';}},{signal});
}

async function startLearning(){
  // Validate first
  const v=validateGraph();
  if(!v.valid){showValidation();return;}
  // Save then start
  if(ES.dirty&&!await doSave(false))return;
  if(!ES.templateId){showToast('请先保存学习流','warn');return;}
  if(!ES.courseId||!ES.knowledgePointId){showToast('请先从学习流中心选择课程和知识点','warn');navigateTo(`#/student/learning-flows?flowId=${ES.templateId}`);return;}
  try{const r=await learningWorkflowApi.quickStart({templateId:ES.templateId,courseId:ES.courseId,knowledgePointId:ES.knowledgePointId});const s=(r.data||r)?.session;if(s)navigateTo(`#/student/learning/session/${s.session_id}`);}
  catch(e){showToast(e.message||'启动学习失败','error');}
}

function getConditionLabel(c){if(!c||c.type==='always')return'';const m={mastery_gte:'>=',mastery_lt:'<',consecutive_wrong_gte:'>=',accuracy_gte:'>=',accuracy_lt:'<'};const t=c.params?.threshold||80;const labels={answer_correct:'正确',answer_incorrect:'错误',mastery_gte:`掌握度 >= ${t}%`,mastery_lt:`掌握度 < ${t}%`,consecutive_wrong_gte:`连续错误 >= ${t}`,accuracy_gte:`准确率 >= ${t}%`,accuracy_lt:`准确率 < ${t}%`};return labels[c.type]||c.type;}
function getVal(id){return document.getElementById(id)?.value||'';}
function setVal(id,v){const e=document.getElementById(id);if(e)e.value=v||'';}
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}
function readDraft(){try{return JSON.parse(sessionStorage.getItem(FLOW_DRAFT_STORAGE_KEY)||'null');}catch{return null;}}
