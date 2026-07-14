import {
  createTeacherAiConversation, getTeacherAiMessages, streamTeacherAiMessage, uploadTeacherAiAttachment,
  getNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead,
  checkTeacherRemindersDue, completeTeacherReminder, snoozeTeacherReminder, dismissTeacherReminder,
} from '../api/teacher.js'
import { listTasks } from '../api/tasks.js'
import { getUser, getToken } from '../utils/auth.js'
import { renderMarkdownToHtml, renderMathInMarkdownElements } from '../utils/markdown.js'
import { escapeHtml } from '../utils/format.js'
import { registerViewportOverlay, layoutViewportOverlays } from '../utils/viewport-overlay-manager.js'

const STATE_KEY = 'discimind.teacherAiFloatState'
const TASK_STATE_KEY = 'discimind.teacherTaskIslandState'
const CONVERSATION_KEY = 'discimind.teacherAiFloatConversation'
const ACTIVE_TASK_STATUSES = new Set(['QUEUED','PENDING','RUNNING','RETRYING','queued','pending','running','retrying'])
let cleanupCurrent = () => {}

function cleanupTeacherOverlayListeners() {
  cleanupCurrent()
  cleanupCurrent = () => {}
}

function onTeacherSurface() {
  const user = getUser()
  const path = window.location.hash.slice(1).split('?')[0]
  return Boolean(user && ['teacher', 'admin'].includes(user.role) && path.startsWith('/teacher/'))
}

export function renderTeacherGlobalOverlays({ fullAiPage = false } = {}) {
  return `<div id="teacher-assistant-root" class="teacher-assistant-root">
    <div class="teacher-task-island" id="teacher-task-island">
      <button class="teacher-task-island-main" id="teacher-task-island-toggle" aria-expanded="false"><span class="teacher-task-island-grip" title="拖动">⋮⋮</span><b id="teacher-task-island-count">0</b><span><strong id="teacher-task-island-title">任务与消息</strong><small id="teacher-task-island-summary">正在同步真实状态…</small></span></button>
      <section class="teacher-task-island-panel" id="teacher-task-island-panel" hidden><header><b>任务与消息</b><button id="teacher-notification-read-all">全部消息已读</button></header><div><h4>进行中的后台任务</h4><div id="teacher-task-island-tasks"><span>加载中</span></div><h4>最新消息</h4><div id="teacher-notification-list"><span>加载中</span></div></div></section>
    </div>
    ${fullAiPage ? '' : `<div class="teacher-ai-float" id="teacher-ai-float">
      <button class="teacher-ai-float-dock" id="teacher-ai-float-dock" hidden>AI</button>
      <div class="teacher-ai-float-main"><button class="teacher-ai-float-open" id="teacher-ai-float-open" aria-expanded="false"><b>AI</b><span>教学助手</span></button><button class="teacher-ai-float-hide" id="teacher-ai-float-hide" title="贴边隐藏">›</button></div>
      <section class="teacher-ai-float-panel" id="teacher-ai-float-panel" hidden>
        <header><div><b>教师 AI 助手</b><span id="teacher-ai-float-context">保留当前教学上下文</span></div><button id="teacher-ai-float-max" title="完整对话">放大</button><button id="teacher-ai-float-close">×</button></header>
        <div class="teacher-ai-float-skills">${[['analyze','分析当前班级'],['questions','生成课堂问题'],['exercise','生成练习'],['weak','查看薄弱知识点'],['prepare','生成备课建议'],['publish','发布教学任务']].map(([id,label]) => `<button data-teacher-ai-skill="${id}">${label}</button>`).join('')}</div>
        <div class="teacher-ai-float-messages" id="teacher-ai-float-messages"><div class="empty">可直接输入教学问题，也可携带文件或图片。</div></div>
        <div id="teacher-ai-float-files" class="teacher-ai-float-files"></div>
        <form id="teacher-ai-float-form"><textarea id="teacher-ai-float-input" maxlength="5000" rows="2" placeholder="输入教学问题…"></textarea><footer><div><label>附件<input id="teacher-ai-float-file" type="file" hidden multiple accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp"></label><button type="button" id="teacher-ai-float-voice">语音</button></div><button id="teacher-ai-float-send" type="submit">发送</button></footer></form>
      </section>
    </div>`}
    <aside class="teacher-reminder-alert" id="teacher-reminder-alert" hidden></aside>
  </div>`
}

function notificationTarget(item) {
  if (item.business_type === 'learning_task' || item.business_type === 'task_submission') return `#/teacher/tasks/${item.business_id}`
  if (item.business_type === 'knowledge_base_application') return '#/teacher/knowledge?tab=reviews'
  if (item.business_type === 'lesson_plan_artifact') return '#/teacher/preparation'
  if (item.business_type === 'teacher_intervention') return `#/teacher/students/${item.business_id}`
  return '#/teacher/dashboard'
}

function consumeLoginIntro() {
  const user=getUser();const token=getToken()||'';const key=`discimind.teacherTaskIntro:${user?.user_id||user?.id||'unknown'}:${token.slice(-12)}`
  try { if(sessionStorage.getItem(key)==='1')return false;sessionStorage.setItem(key,'1');return true } catch { return true }
}

function mountTaskIsland(signal, cleanups) {
  const root=document.getElementById('teacher-task-island');const toggle=document.getElementById('teacher-task-island-toggle');const panel=document.getElementById('teacher-task-island-panel')
  if(!root||!toggle||!panel)return
  let expanded=consumeLoginIntro();let collapseTimer=0;let y=16;let dragging=null;let moved=false;const reminderQueue=[]
  const renderReminder=()=>{const host=document.getElementById('teacher-reminder-alert');if(!host)return;const item=reminderQueue[0];host.hidden=!item;if(!item){host.innerHTML='';return}host.innerHTML=`<header><div><b>${escapeHtml(item.title)}</b><span>${reminderQueue.length>1?`还有 ${reminderQueue.length-1} 项提醒`:new Date(item.remind_at||item.start_at).toLocaleString('zh-CN')}</span></div><button data-reminder-dismiss="${item.id}">×</button></header><p>${escapeHtml(item.description||'教师提醒已到达')}</p><footer><button data-reminder-snooze="${item.id}" data-minutes="10">10 分钟后</button><button data-reminder-snooze="${item.id}" data-minutes="30">30 分钟后</button><button class="primary" data-reminder-complete="${item.id}">完成</button></footer>`}
  try { const saved=JSON.parse(localStorage.getItem(TASK_STATE_KEY)||'{}');if(Number.isFinite(Number(saved.y)))y=Number(saved.y) } catch {}
  const apply=()=>{root.style.top=`${Math.max(10,Math.min(window.innerHeight-root.offsetHeight-10,y))}px`;root.classList.toggle('is-expanded',expanded);toggle.setAttribute('aria-expanded',expanded?'true':'false');try{localStorage.setItem(TASK_STATE_KEY,JSON.stringify({y}))}catch{};layoutViewportOverlays()}
  const scheduleCollapse=()=>{clearTimeout(collapseTimer);collapseTimer=window.setTimeout(()=>{if(root.matches(':hover')||root.contains(document.activeElement))return scheduleCollapse();expanded=false;panel.hidden=true;apply()},2500)}
  const load=async()=>{
    const taskList=document.getElementById('teacher-task-island-tasks');const notificationList=document.getElementById('teacher-notification-list')
    try {
      const [dueResult,countResult,listResult,taskResult]=await Promise.all([checkTeacherRemindersDue(),getUnreadNotificationCount(),getNotifications({page:1,page_size:8}),listTasks({pageSize:30})])
      ;(dueResult.data?.triggered||[]).forEach(item=>{if(!reminderQueue.some(row=>row.id===item.id))reminderQueue.push(item)});renderReminder()
      const unread=Number(countResult.data?.unread_count??countResult.data?.count??0);const notifications=listResult.data?.list||[];const tasks=(taskResult.data?.list||[]).filter(task=>ACTIVE_TASK_STATUSES.has(task.status));const total=unread+tasks.length
      document.getElementById('teacher-task-island-count').textContent=total>99?'99+':String(total)
      document.getElementById('teacher-task-island-title').textContent=tasks[0]?.title||notifications[0]?.title||'任务与消息'
      document.getElementById('teacher-task-island-summary').textContent=`${tasks.length} 项进行中 · ${unread} 条未读`
      taskList.innerHTML=tasks.length?tasks.slice(0,6).map(task=>`<button data-task-target="${escapeHtml(task.resultUrl||'#/teacher/dashboard')}"><b>${escapeHtml(task.title||'后台任务')}</b><span>${escapeHtml(task.stage||task.status||'处理中')} · ${Number(task.progress)||0}%</span></button>`).join(''):'<span>暂无进行中的后台任务</span>'
      notificationList.innerHTML=notifications.length?notifications.map(item=>`<button data-notification-id="${item.notification_id}" data-notification-target="${notificationTarget(item)}" class="${item.is_read?'':'unread'}"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.content||'')}</span><em>${new Date(item.created_at).toLocaleString('zh-CN')}</em></button>`).join(''):'<span>暂无消息</span>'
    } catch(error){taskList.innerHTML='<span>任务状态暂时无法同步</span>';notificationList.innerHTML='<span>消息暂时无法同步</span>'}
  }
  toggle.addEventListener('click',()=>{if(moved){moved=false;return}panel.hidden=!panel.hidden;expanded=!panel.hidden;apply();if(expanded)void load()},{signal})
  root.addEventListener('mouseenter',()=>{expanded=true;apply()},{signal});root.addEventListener('mouseleave',()=>scheduleCollapse(),{signal})
  root.addEventListener('click',async event=>{const note=event.target.closest('[data-notification-id]');if(note){await markNotificationRead(Number(note.dataset.notificationId));window.location.hash=note.dataset.notificationTarget}const task=event.target.closest('[data-task-target]');if(task)window.location.hash=task.dataset.taskTarget},{signal})
  document.getElementById('teacher-notification-read-all')?.addEventListener('click',async()=>{await markAllNotificationsRead();await load()},{signal})
  document.getElementById('teacher-reminder-alert')?.addEventListener('click',async event=>{const complete=event.target.closest('[data-reminder-complete]');const snooze=event.target.closest('[data-reminder-snooze]');const dismiss=event.target.closest('[data-reminder-dismiss]');try{if(complete)await completeTeacherReminder(Number(complete.dataset.reminderComplete));else if(snooze)await snoozeTeacherReminder(Number(snooze.dataset.reminderSnooze),Number(snooze.dataset.minutes));else if(dismiss)await dismissTeacherReminder(Number(dismiss.dataset.reminderDismiss));else return;reminderQueue.shift();renderReminder();void load()}catch{}},{signal})
  toggle.addEventListener('pointerdown',event=>{if(!event.target.closest('.teacher-task-island-grip'))return;dragging={id:event.pointerId,startY:event.clientY,baseY:y};moved=false;root.setPointerCapture?.(event.pointerId)},{signal})
  root.addEventListener('pointermove',event=>{if(!dragging||event.pointerId!==dragging.id)return;const delta=event.clientY-dragging.startY;if(Math.abs(delta)>3)moved=true;y=dragging.baseY+delta;apply();event.preventDefault()},{signal})
  root.addEventListener('pointerup',()=>{dragging=null;apply()},{signal})
  const unregister=registerViewportOverlay('teacher-task-island',root,{priority:10,getY:()=>y,onMove:value=>{y=value}});cleanups.push(unregister,()=>clearTimeout(collapseTimer))
  void load();if(expanded){apply();scheduleCollapse()}else apply()
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},20000);cleanups.push(()=>clearInterval(timer))
}

function currentContext() { const explicit=window.__discimindTeacherContext||{};return {course_id:explicit.course_id||explicit.courseId||'',teaching_class_id:explicit.teaching_class_id||explicit.teachingClassId||'',range:explicit.range||'7d',page:window.location.hash.slice(1).split('?')[0]} }

function mountAssistant(signal, cleanups) {
  const widget=document.getElementById('teacher-ai-float');if(!widget)return
  const panel=document.getElementById('teacher-ai-float-panel');const messagesEl=document.getElementById('teacher-ai-float-messages');const input=document.getElementById('teacher-ai-float-input');const main=widget.querySelector('.teacher-ai-float-main');const dock=document.getElementById('teacher-ai-float-dock')
  let saved={};try{saved=JSON.parse(localStorage.getItem(STATE_KEY)||'{}')}catch{}
  let y=Math.max(90,Math.min(window.innerHeight-90,Number(saved.y)||window.innerHeight-120));let hidden=Boolean(saved.hidden);let dragging=null;let moved=false;let conversationId=Number(localStorage.getItem(CONVERSATION_KEY))||null;let messages=[];let files=[];let generating=false;let streamController=null;let autoFollow=true
  const apply=()=>{widget.style.top=`${Math.max(72,Math.min(window.innerHeight-78,y))}px`;widget.classList.toggle('docked',hidden);dock.hidden=!hidden;main.hidden=hidden;if(hidden)panel.hidden=true;try{localStorage.setItem(STATE_KEY,JSON.stringify({y,hidden}))}catch{};layoutViewportOverlays()}
  const open=value=>{panel.hidden=!value;document.getElementById('teacher-ai-float-open').setAttribute('aria-expanded',value?'true':'false');if(value)input.focus();layoutViewportOverlays()}
  const renderMessages=()=>{messagesEl.innerHTML=messages.length?messages.map(item=>`<div class="${item.role}"><div class="message-markdown">${item.content?renderMarkdownToHtml(item.content):'<span>正在生成…</span>'}</div></div>`).join(''):'<div class="empty">可直接输入教学问题，也可携带文件或图片。</div>';renderMathInMarkdownElements(messagesEl);if(autoFollow)messagesEl.scrollTop=messagesEl.scrollHeight}
  const renderFiles=()=>{document.getElementById('teacher-ai-float-files').innerHTML=files.map(item=>`<span>${escapeHtml(item.name)}<button type="button" data-remove-teacher-file="${item.id}">×</button></span>`).join('')}
  const ensureConversation=async()=>{if(conversationId)return conversationId;const result=await createTeacherAiConversation({mode:'general',title:'全局教学助手',context:currentContext()});conversationId=result.data.id;localStorage.setItem(CONVERSATION_KEY,String(conversationId));return conversationId}
  const restoreHistory=async()=>{if(!conversationId)return;try{const result=await getTeacherAiMessages(conversationId);const rows=result.data?.list||result.data?.messages||result.data||[];messages=(Array.isArray(rows)?rows:[]).map(item=>({role:String(item.role||'').toLowerCase(),content:item.content||''}));renderMessages()}catch{conversationId=null;localStorage.removeItem(CONVERSATION_KEY)}}
  const send=async text=>{if(generating){streamController?.abort();return}const content=String(text||'').trim();if(!content&&!files.length)return;const outgoing=[...files];files=[];renderFiles();input.value='';open(true);const assistant={role:'assistant',content:''};messages.push({role:'user',content:content||outgoing.map(item=>item.name).join('、')},assistant);generating=true;streamController=new AbortController();document.getElementById('teacher-ai-float-send').textContent='停止';renderMessages();try{const id=await ensureConversation();await streamTeacherAiMessage(id,{content,attachments:outgoing.map(item=>item.id),context:currentContext(),assistant_surface:'floating'},{signal:streamController.signal,onEvent(event,payload){if(event==='delta'){assistant.content+=payload.content||'';if(autoFollow)renderMessages()}if(event==='done')assistant.content=payload.assistant_message?.content||assistant.content;if(event==='error')assistant.content=assistant.content||payload.message||'生成失败'}})}catch(error){assistant.content=error.name==='AbortError'?'已停止生成。':(error.message||'AI 暂时不可用')}finally{generating=false;streamController=null;document.getElementById('teacher-ai-float-send').textContent='发送';renderMessages()}}
  const skillPrompts={analyze:'分析当前教学班最近7天学习情况，并标注数据来源。',questions:'根据当前课程和班级薄弱点生成5个课堂诊断问题。',exercise:'为当前课程生成基础、巩固、挑战三层练习建议。',weak:'列出当前教学班薄弱知识点和需要关注的学生。',prepare:'基于当前班级学情给出下节课备课建议。',publish:'请引导我进入统一教学任务发布器，并说明需要确认的字段。'}
  document.getElementById('teacher-ai-float-open').addEventListener('click',()=>{if(!moved)open(panel.hidden);moved=false},{signal});document.getElementById('teacher-ai-float-close').addEventListener('click',()=>open(false),{signal});document.getElementById('teacher-ai-float-hide').addEventListener('click',()=>{hidden=true;apply()},{signal});dock.addEventListener('click',()=>{hidden=false;apply();open(true)},{signal});document.getElementById('teacher-ai-float-max').addEventListener('click',()=>{window.location.hash=`#/teacher/ai${conversationId?`?conversationId=${conversationId}`:''}`},{signal})
  document.querySelectorAll('[data-teacher-ai-skill]').forEach(button=>button.addEventListener('click',()=>void send(skillPrompts[button.dataset.teacherAiSkill]),{signal}));document.getElementById('teacher-ai-float-form').addEventListener('submit',event=>{event.preventDefault();void send(input.value)},{signal});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send(input.value)}},{signal})
  document.getElementById('teacher-ai-float-file').addEventListener('change',async event=>{try{const id=await ensureConversation();for(const file of [...event.target.files].slice(0,8-files.length)){const result=await uploadTeacherAiAttachment(file,id);files.push(result.data)}renderFiles()}finally{event.target.value=''}},{signal});document.getElementById('teacher-ai-float-voice').addEventListener('click',()=>{const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition)return;const recognition=new Recognition();recognition.lang='zh-CN';recognition.onresult=event=>{input.value=[...event.results].map(item=>item[0].transcript).join('')};recognition.start()},{signal});messagesEl.addEventListener('scroll',()=>{autoFollow=messagesEl.scrollHeight-messagesEl.scrollTop-messagesEl.clientHeight<80},{signal,passive:true})
  document.getElementById('teacher-ai-float-files').addEventListener('click',event=>{const button=event.target.closest('[data-remove-teacher-file]');if(button){files=files.filter(item=>String(item.id)!==button.dataset.removeTeacherFile);renderFiles()}},{signal});main.addEventListener('pointerdown',event=>{if(event.target.closest('.teacher-ai-float-hide'))return;dragging={id:event.pointerId,startY:event.clientY,baseY:y};moved=false;widget.setPointerCapture?.(event.pointerId)},{signal});widget.addEventListener('pointermove',event=>{if(!dragging||event.pointerId!==dragging.id)return;const delta=event.clientY-dragging.startY;if(Math.abs(delta)>4)moved=true;y=dragging.baseY+delta;apply();event.preventDefault()},{signal});widget.addEventListener('pointerup',()=>{dragging=null;apply()},{signal})
  const unregister=registerViewportOverlay('teacher-ai-assistant',widget,{priority:20,getY:()=>y,onMove:value=>{y=value}});cleanups.push(unregister,()=>streamController?.abort());apply();renderMessages();void restoreHistory()
}

export function unmountTeacherGlobalOverlays() {
  cleanupTeacherOverlayListeners()
  document.querySelectorAll('#teacher-assistant-root').forEach(root => root.remove())
  const overlayRoot = document.getElementById('discimind-global-overlays')
  if (overlayRoot && !overlayRoot.children.length) overlayRoot.remove()
}

export function mountTeacherGlobalOverlays({ fullAiPage = false } = {}) {
  cleanupTeacherOverlayListeners()
  if (!onTeacherSurface() || !document.getElementById('teacher-assistant-root')) {
    unmountTeacherGlobalOverlays()
    return
  }
  const controller=new AbortController();const cleanups=[()=>controller.abort()]
  mountTaskIsland(controller.signal,cleanups)
  if(!fullAiPage)mountAssistant(controller.signal,cleanups)
  cleanupCurrent=()=>{cleanups.splice(0).reverse().forEach(cleanup=>{try{cleanup()}catch{}})}
}
