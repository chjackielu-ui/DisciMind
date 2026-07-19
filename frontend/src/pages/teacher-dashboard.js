import * as echarts from 'echarts'
import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { getTeacherDashboard, getTeacherProfile, getAnalyticsWorkbench, getAllTeachingClasses, createTeacherReminder, updateTeacherReminder, deleteTeacherReminder } from '../api/teacher.js'
import { escapeHtml, formatRelativeTime } from '../utils/format.js'
import { normalizeWeakKnowledgePoints, normalizeKeywords } from '../utils/analytics-contract.js'
import { showToast } from '../utils/toast.js'

const charts = []
let dashboardLifecycle = null
const calendarState = { view: 'month', cursor: new Date() }
const WEEKDAYS = ['一','二','三','四','五','六','日']
function disposeCharts() { charts.splice(0).forEach(chart => { try { chart.dispose() } catch {} }) }

function metricCards(data) {
  const items = [
    ['负责课程', data.course_count, '门'], ['教学班', data.teaching_class_count, '个'], ['学生人数', data.student_count, '人'],
    ['平均掌握度', data.average_mastery_score, '%'], ['作业完成率', data.task_completion_rate, '%'], ['待处理事项', data.pending_count, '项'],
  ]
  return items.map(([label,value,unit]) => `<article><span>${label}</span><b data-count-value="${Number(value)||0}">${Number(value)||0}<i>${unit}</i></b></article>`).join('')
}

function quickEntries() {
  return [
    ['智慧备课','#/teacher/preparation'],['学情分析','#/teacher/analytics'],['发布作业','#/teacher/tasks/create?type=homework'],
    ['发布考试','#/teacher/tasks/create?type=exam'],['班级管理','#/teacher/system?tab=classes'],['教学资源','#/teacher/knowledge'],
  ].map(([label,hash]) => `<button data-teacher-nav="${hash}">${label}<span>→</span></button>`).join('')
}

function classWorkspaces(classes) {
  if (!classes.length) return '<div class="teacher-dashboard-classes-empty">暂无负责班级，可前往系统管理创建教学班。</div>'
  return classes.slice(0, 3).map((item) => `<button data-teacher-nav="#/teacher/classes/${item.teaching_class_id}">
    <span>${escapeHtml(item.course_name || '未关联课程')}</span><b>${escapeHtml(item.teaching_class_name)}</b>
    <dl><div><dt>学生</dt><dd>${item.student_count || 0} 人</dd></div><div><dt>近 30 天作业</dt><dd>${item.recent_assignment_count || 0} 项</dd></div><div><dt>进度</dt><dd>${Math.round(Number(item.learning_progress) || 0)}%</dd></div><div class="risk"><dt>风险</dt><dd>${item.risk_student_count || 0} 人</dd></div></dl>
  </button>`).join('')
}

function scheduleText(schedule) {
  if (!schedule) return '时间待安排'
  if (typeof schedule === 'string') return schedule
  if (Array.isArray(schedule)) return schedule.map(item => item.label || item.time || JSON.stringify(item)).join('、')
  return schedule.label || schedule.time || Object.values(schedule).filter(value => typeof value === 'string').join(' · ') || '时间待安排'
}

function profileCard(profile, dashboard) {
  const classes = dashboard.classes || []
  const courseGroups = [...classes.reduce((groups, item) => {
    const current = groups.get(item.course_id) || { ...item, names: new Set(), schedules: new Set(), locations: new Set() }
    current.names.add(item.name)
    current.schedules.add(scheduleText(item.schedule))
    if (item.location) current.locations.add(item.location)
    groups.set(item.course_id, current)
    return groups
  }, new Map()).values()]
  return `<aside class="teacher-summary-card">
    <div class="teacher-summary-person"><div>${escapeHtml((profile.name || '师').slice(0,1))}</div><span><b>${escapeHtml(profile.name || '教师')}</b><em>${escapeHtml([profile.college,profile.professional_title].filter(Boolean).join(' · ') || '教师工作台')}</em></span></div>
    <div class="teacher-summary-counts"><span><b>${profile.statistics?.course_count || 0}</b>课程</span><span><b>${profile.statistics?.teaching_class_count || 0}</b>教学班</span></div>
    <h3>本周教学安排</h3><div class="teacher-summary-schedule">${courseGroups.slice(0,4).map(item => {
      const classNames = [...item.names]
      const detail = [`${classNames.length} 个教学班`, classNames.join('、'), [...item.schedules].join(' / '), [...item.locations].join(' / ')].filter(Boolean).join(' · ')
      return `<button data-teacher-nav="#/teacher/courses/${item.course_id}"><b>${escapeHtml(item.course_name)}</b><span>${escapeHtml(detail)}</span></button>`
    }).join('') || '<p>暂无已配置课程安排</p>'}</div>
  </aside>`
}

function localDateKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '').slice(0,10)
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function eventsForDate(events, date) { const key=localDateKey(date);return events.filter(item=>localDateKey(item.start_at)===key) }
function mondayOf(value) { const date=new Date(value);date.setHours(0,0,0,0);const day=date.getDay()||7;date.setDate(date.getDate()-day+1);return date }
function addDays(value, amount) { const date=new Date(value);date.setDate(date.getDate()+amount);return date }
function eventTime(item) { if(item.all_day)return item.time_label||'全天';const date=new Date(item.start_at);return Number.isNaN(date.getTime())?'':date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) }
function calendarEvent(item, compact=false) { const reminderId=item.reminder?.id||String(item.id||'').replace('reminder-','');return `<button class="teacher-calendar-event ${escapeHtml(item.type||'event')}" ${item.type==='reminder'?`data-reminder-edit="${escapeHtml(reminderId)}"`:`data-calendar-nav="${escapeHtml(item.action_url||'#/teacher/dashboard')}"`} title="${escapeHtml([item.title,item.subtitle,item.location].filter(Boolean).join(' · '))}"><i></i><span>${compact?'':`<em>${escapeHtml(eventTime(item))}</em>`}${escapeHtml(item.title||'教学事项')}</span></button>` }

function monthCalendar(events) {
  const monthStart=new Date(calendarState.cursor.getFullYear(),calendarState.cursor.getMonth(),1)
  const gridStart=mondayOf(monthStart)
  const cells=Array.from({length:42},(_,index)=>addDays(gridStart,index))
  return `<div class="teacher-calendar-weekdays">${WEEKDAYS.map(day=>`<span>周${day}</span>`).join('')}</div><div class="teacher-calendar-month">${cells.map(date=>{const dayEvents=eventsForDate(events,date);const outside=date.getMonth()!==calendarState.cursor.getMonth();return `<div class="teacher-calendar-day ${outside?'outside':''} ${localDateKey(date)===localDateKey(new Date())?'today':''}"><button class="teacher-calendar-date" data-calendar-empty="${localDateKey(date)}">${date.getDate()}</button><div>${dayEvents.slice(0,3).map(item=>calendarEvent(item,true)).join('')}${dayEvents.length>3?`<button class="teacher-calendar-more" data-calendar-list-date="${localDateKey(date)}">另 ${dayEvents.length-3} 项</button>`:''}</div></div>`}).join('')}</div>`
}

function weekCalendar(events) {
  const start=mondayOf(calendarState.cursor)
  return `<div class="teacher-calendar-week">${Array.from({length:7},(_,index)=>{const date=addDays(start,index);const items=eventsForDate(events,date);return `<section class="${localDateKey(date)===localDateKey(new Date())?'today':''}"><header><span>周${WEEKDAYS[index]}</span><b>${date.getMonth()+1}/${date.getDate()}</b></header><div>${items.slice(0,5).map(item=>calendarEvent(item)).join('')||`<button class="teacher-calendar-empty" data-calendar-empty="${localDateKey(date)}">+ 安排教学事项</button>`}${items.length>5?`<button class="teacher-calendar-more" data-calendar-list-date="${localDateKey(date)}">另 ${items.length-5} 项</button>`:''}</div></section>`}).join('')}</div>`
}

function listCalendar(events) {
  const start=new Date(calendarState.cursor);start.setHours(0,0,0,0)
  const visible=events.filter(item=>new Date(item.start_at)>=addDays(start,-7)&&new Date(item.start_at)<=addDays(start,45))
  const groups=new Map();visible.forEach(item=>{const key=localDateKey(item.start_at);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item)})
  return `<div class="teacher-calendar-list">${[...groups.entries()].map(([date,items])=>`<section><header><b>${new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'})}</b><button data-calendar-empty="${date}">+ 新建</button></header><div>${items.map(item=>`<article>${calendarEvent(item)}<span>${escapeHtml(item.subtitle||item.source?.type||'真实教学事件')}</span></article>`).join('')}</div></section>`).join('')||'<div class="teacher-inline-empty">当前日期范围暂无教学事件，可点击“新建安排”。</div>'}</div>`
}

function calendarTitle() {
  if(calendarState.view==='week'){const start=mondayOf(calendarState.cursor);const end=addDays(start,6);return `${start.getFullYear()}年${start.getMonth()+1}月${start.getDate()}日 — ${end.getMonth()+1}月${end.getDate()}日`}
  if(calendarState.view==='list')return `${calendarState.cursor.getFullYear()}年${calendarState.cursor.getMonth()+1}月起的教学日程`
  return `${calendarState.cursor.getFullYear()}年 ${calendarState.cursor.getMonth()+1}月`
}

function renderCalendar(dashboard) {
  const node=document.getElementById('teacher-calendar-body');if(!node)return
  const events=dashboard.calendar_events||[]
  document.getElementById('teacher-calendar-title').textContent=calendarTitle()
  document.querySelectorAll('[data-calendar-view]').forEach(button=>button.classList.toggle('active',button.dataset.calendarView===calendarState.view))
  node.innerHTML=calendarState.view==='week'?weekCalendar(events):calendarState.view==='list'?listCalendar(events):monthCalendar(events)
}

function positionCalendarDialog(dialog, trigger) {
  const anchor=trigger.closest('.teacher-calendar-day,.teacher-calendar-week>section,.teacher-calendar-list>section')||trigger
  dialog.classList.add('is-anchored')
  if(!dialog.open)dialog.show()
  const gap=10,edge=12,anchorRect=anchor.getBoundingClientRect(),dialogRect=dialog.getBoundingClientRect()
  let left=anchorRect.right+gap
  if(left+dialogRect.width>window.innerWidth-edge)left=anchorRect.left-dialogRect.width-gap
  left=Math.max(edge,Math.min(left,window.innerWidth-dialogRect.width-edge))
  const top=Math.max(edge,Math.min(anchorRect.top,window.innerHeight-dialogRect.height-edge))
  dialog.style.left=`${Math.round(left)}px`
  dialog.style.top=`${Math.round(top)}px`
}

function localDateTime(value) { const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,16) }
function reminderCalendarEvent(row) { return { id:`reminder-${row.id}`,type:'reminder',title:row.title,subtitle:row.description||`提醒 · ${row.status}`,start_at:row.start_at,status:row.status,action_url:`#/teacher/dashboard?reminder_id=${row.id}`,course_id:row.course_id,teaching_class_id:row.teaching_class_id,reminder:{id:row.id,remind_at:row.remind_at,end_at:row.end_at,priority:row.priority,reminder_type:row.reminder_type,advance_minutes:row.advance_minutes,notes:row.notes,recurrence_rule:row.recurrence_rule} } }

function populateReminderContext(dashboard,courseId='',classId='') {
  const form=document.getElementById('teacher-reminder-form');if(!form)return
  const courses=[...new Map((dashboard.classes||[]).map(item=>[String(item.course_id),{id:item.course_id,name:item.course_name}])).values()]
  form.elements.course_id.innerHTML='<option value="">不关联课程</option>'+courses.map(item=>`<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')
  form.elements.course_id.value=courseId?String(courseId):''
  const classes=(dashboard.classes||[]).filter(item=>!courseId||String(item.course_id)===String(courseId))
  form.elements.teaching_class_id.innerHTML='<option value="">不关联教学班</option>'+classes.map(item=>`<option value="${item.teaching_class_id}">${escapeHtml(item.name)}</option>`).join('')
  form.elements.teaching_class_id.value=classId?String(classId):''
}

function openReminderDialog(dashboard, item=null, dateKey='') {
  const dialog=document.getElementById('teacher-reminder-dialog');const form=document.getElementById('teacher-reminder-form');if(!dialog||!form)return
  form.reset();form.elements.id.value=item?.reminder?.id||'';form.elements.title.value=item?.title||'';populateReminderContext(dashboard,item?.course_id,item?.teaching_class_id)
  const defaultStart=dateKey?`${dateKey}T09:00`:new Date(Date.now()+60*60000);const start=item?.start_at||defaultStart;form.elements.start_at.value=localDateTime(start);form.elements.remind_at.value=localDateTime(item?.reminder?.remind_at||new Date(new Date(start).getTime()-30*60000));form.elements.end_at.value=localDateTime(item?.reminder?.end_at||'');form.elements.description.value=item?.type==='reminder'&&!/^提醒 · /.test(item.subtitle||'')?item.subtitle:'';form.elements.notes.value=item?.reminder?.notes||'';form.elements.priority.value=item?.reminder?.priority||'normal';form.elements.reminder_type.value=item?.reminder?.reminder_type||'manual';form.elements.advance_minutes.value=String(item?.reminder?.advance_minutes??30);form.elements.recurrence.value=item?.reminder?.recurrence_rule?.frequency||'';document.getElementById('teacher-reminder-delete').hidden=!item;dialog.showModal()
}

function bindCalendar(dashboard) {
  const section=document.getElementById('teacher-calendar-section');if(!section)return
  const dialog=document.getElementById('teacher-calendar-create')
  section.addEventListener('click',event=>{
    if(event.target.closest('[data-calendar-reminder-new]')){openReminderDialog(dashboard);return}
    const view=event.target.closest('[data-calendar-view]');if(view){calendarState.view=view.dataset.calendarView;renderCalendar(dashboard);return}
    const move=event.target.closest('[data-calendar-move]');if(move){const direction=Number(move.dataset.calendarMove);calendarState.cursor=calendarState.view==='week'?addDays(calendarState.cursor,direction*7):new Date(calendarState.cursor.getFullYear(),calendarState.cursor.getMonth()+direction,1);renderCalendar(dashboard);return}
    if(event.target.closest('[data-calendar-today]')){calendarState.cursor=new Date();renderCalendar(dashboard);return}
    const reminder=event.target.closest('[data-reminder-edit]');if(reminder){const item=(dashboard.calendar_events||[]).find(row=>String(row.reminder?.id)===reminder.dataset.reminderEdit);openReminderDialog(dashboard,item);return}
    const nav=event.target.closest('[data-calendar-nav]');if(nav){window.location.hash=nav.dataset.calendarNav;return}
    const listDate=event.target.closest('[data-calendar-list-date]');if(listDate){calendarState.cursor=new Date(`${listDate.dataset.calendarListDate}T00:00:00`);calendarState.view='list';renderCalendar(dashboard);return}
    const empty=event.target.closest('[data-calendar-empty]');if(empty){dialog.dataset.date=empty.dataset.calendarEmpty;dialog.querySelector('strong').textContent=empty.dataset.calendarEmpty;positionCalendarDialog(dialog,empty)}
  })
  dialog.addEventListener('click',event=>{if(event.target.closest('[data-calendar-reminder]')){const date=dialog.dataset.date;dialog.close();openReminderDialog(dashboard,null,date);return}const action=event.target.closest('[data-calendar-create]');if(action){const date=dialog.dataset.date;window.location.hash=`${action.dataset.calendarCreate}${action.dataset.calendarCreate.includes('?')?'&':'?'}date=${date}`;dialog.close()}if(event.target.closest('[data-calendar-close]'))dialog.close()})
  document.addEventListener('pointerdown',event=>{if(dialog.open&&!dialog.contains(event.target)&&!event.target.closest('[data-calendar-empty]'))dialog.close()},{signal:dashboardLifecycle.signal})
  window.addEventListener('resize',()=>{if(dialog.open)dialog.close()},{signal:dashboardLifecycle.signal})
  window.addEventListener('scroll',()=>{if(dialog.open)dialog.close()},{capture:true,signal:dashboardLifecycle.signal})
  dialog.addEventListener('close',()=>{dialog.classList.remove('is-anchored');dialog.style.removeProperty('left');dialog.style.removeProperty('top')},{signal:dashboardLifecycle.signal})
  const reminderDialog=document.getElementById('teacher-reminder-dialog');const form=document.getElementById('teacher-reminder-form')
  form.elements.course_id.addEventListener('change',event=>populateReminderContext(dashboard,event.target.value,''),{signal:dashboardLifecycle.signal})
  form.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(form);const reminderId=data.get('id');const recurrence=data.get('recurrence');const payload={title:data.get('title'),description:data.get('description'),notes:data.get('notes'),start_at:new Date(data.get('start_at')).toISOString(),remind_at:new Date(data.get('remind_at')).toISOString(),end_at:data.get('end_at')?new Date(data.get('end_at')).toISOString():null,priority:data.get('priority'),reminder_type:data.get('reminder_type'),course_id:data.get('course_id')?Number(data.get('course_id')):null,teaching_class_id:data.get('teaching_class_id')?Number(data.get('teaching_class_id')):null,advance_minutes:Number(data.get('advance_minutes')||0),recurrence_rule:recurrence?{frequency:recurrence,interval:1}:null};try{const result=reminderId?await updateTeacherReminder(reminderId,payload):await createTeacherReminder(payload);dashboard.calendar_events=(dashboard.calendar_events||[]).filter(row=>String(row.reminder?.id)!==String(result.data.id));dashboard.calendar_events.push(reminderCalendarEvent(result.data));reminderDialog.close();renderCalendar(dashboard);showToast(reminderId?'提醒已更新':'提醒已创建','success')}catch(error){showToast(error.message||'提醒保存失败','error')}},{signal:dashboardLifecycle.signal})
  document.getElementById('teacher-reminder-delete').addEventListener('click',async()=>{const reminderId=form.elements.id.value;if(!reminderId||!confirm('确认取消这条提醒？'))return;try{await deleteTeacherReminder(reminderId);dashboard.calendar_events=(dashboard.calendar_events||[]).filter(row=>String(row.reminder?.id)!==String(reminderId));reminderDialog.close();renderCalendar(dashboard);showToast('提醒已取消','success')}catch(error){showToast(error.message||'提醒取消失败','error')}},{signal:dashboardLifecycle.signal})
  reminderDialog.querySelector('[data-reminder-close]').addEventListener('click',()=>reminderDialog.close(),{signal:dashboardLifecycle.signal})
  renderCalendar(dashboard)
}

function recentRows(data) {
  const rows = [
    ...(data.recent?.tasks || []).map(item => ({ label:item.type==='exam'?'考试':'作业',title:item.title,status:item.status,time:item.created_at,hash:`#/teacher/tasks/${item.task_id}` })),
    ...(data.recent?.lesson_plans || []).map(item => ({ label:'备课',title:item.topic,status:item.status,time:item.updated_at,hash:'#/teacher/preparation' })),
    ...(data.recent?.resources || []).map(item => ({ label:'资源',title:item.title,status:item.resource_kind||'文件',time:item.created_at,hash:'#/teacher/knowledge' })),
    ...(data.recent?.notifications || []).map(item => ({ label:'消息',title:item.title,status:item.is_read?'已读':'未读',time:item.created_at,hash:'#/teacher/dashboard' })),
  ].sort((a,b)=>new Date(b.time)-new Date(a.time))
  const seen = new Set()
  const groups = rows.filter(item => {
    const key = `${item.label}|${item.title}|${item.status}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0,8)
  return groups.map(item => `<button data-teacher-nav="${item.hash}"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.title)}</b><em>${escapeHtml(item.status)} · ${formatRelativeTime(item.time)}</em></button>`).join('') || '<div class="teacher-inline-empty">暂无近期教学动态</div>'
}

function content(user, dashboard, profile, classes) {
  const focus = dashboard.today_focus || {}
  return `<div class="teacher-dashboard-page">
    <section class="teacher-focus-card"><div><span>今日教学重点</span><h2>${escapeHtml(focus.title || '开始下一课次智慧备课')}</h2><p>${escapeHtml(focus.description || '系统将自动读取班级学情与高频问题')}</p></div><button data-teacher-nav="${escapeHtml(focus.action_url || '#/teacher/preparation')}">${escapeHtml(focus.action_label || '开始备课')}</button></section>
    <section class="teacher-dashboard-section compact teacher-dashboard-classes"><header><div><h3>我的班级</h3><p>以班级为单位管理学生、资料、作业、题库、资源与评价</p></div><a href="#/teacher/system?tab=classes">全部班级</a></header><div>${classWorkspaces(classes)}</div></section>
    <div class="teacher-dashboard-grid"><main>
      <section class="teacher-dashboard-section compact teacher-quick-section"><header><div><h3>快捷入口</h3><p>围绕教师日常流程的六个主要入口</p></div></header><div class="teacher-quick-grid">${quickEntries()}</div></section>
      <section class="teacher-metric-grid">${metricCards(dashboard)}</section>
      <section class="teacher-dashboard-section teacher-calendar-section" id="teacher-calendar-section"><header><div><h3>教学日历与课表</h3><p id="teacher-calendar-title"></p></div><div class="teacher-calendar-controls"><button class="primary" data-calendar-reminder-new>新建提醒</button><button data-calendar-move="-1" aria-label="上一时段">‹</button><button data-calendar-today>今天</button><button data-calendar-move="1" aria-label="下一时段">›</button><span><button data-calendar-view="month">月</button><button data-calendar-view="week">周</button><button data-calendar-view="list">列表</button></span></div></header><div id="teacher-calendar-body"></div></section>
      <section class="teacher-dashboard-section"><header><div><h3>教学数据概览</h3><p id="teacher-chart-scope">基于当前授权教学数据</p></div><a href="#/teacher/analytics">查看完整分析</a></header><div class="teacher-chart-grid"><article><b>本周学习活跃趋势</b><div id="teacher-chart-activity"></div></article><article><b>班级掌握度分布</b><div id="teacher-chart-mastery"></div></article><article><b>高频疑问 Top 5</b><div id="teacher-chart-keywords"></div></article><article><b>薄弱知识点 Top 5</b><div id="teacher-chart-weak"></div></article></div></section>
      <section class="teacher-dashboard-section compact"><header><div><h3>近期教学动态</h3><p>作业、考试、备课、资源与消息统一汇总</p></div></header><div class="teacher-recent-list">${recentRows(dashboard)}</div></section>
    </main>${profileCard(profile,dashboard)}</div>
    <dialog id="teacher-calendar-create" class="teacher-calendar-dialog" aria-label="日期快捷创建菜单"><form method="dialog"><header><div><span>安排日期</span><strong></strong></div><button type="button" data-calendar-close>×</button></header><p>选择要创建的真实教学事项，日期将自动带入下一页。</p><div><button type="button" data-calendar-reminder>新建提醒</button><button type="button" data-calendar-create="#/teacher/preparation">创建备课</button><button type="button" data-calendar-create="#/teacher/tasks/create">发布任务</button><button type="button" data-calendar-create="#/teacher/system?tab=courses">安排课程</button></div></form></dialog>
    <dialog id="teacher-reminder-dialog" class="teacher-dialog teacher-reminder-dialog"><form id="teacher-reminder-form"><input type="hidden" name="id"><header><h3>教师提醒</h3><button type="button" data-reminder-close>×</button></header><div class="teacher-form-grid"><label class="wide">标题<input name="title" maxlength="200" required></label><label>提醒类型<select name="reminder_type"><option value="manual">通用提醒</option><option value="lesson_preparation">备课提醒</option><option value="class">上课提醒</option><option value="review">课后复盘</option><option value="homework_release">作业发布</option><option value="exam">考试提醒</option></select></label><label>优先级<select name="priority"><option value="normal">普通</option><option value="high">重要</option><option value="urgent">紧急</option><option value="low">低</option></select></label><label>课程<select name="course_id"><option value="">不关联课程</option></select></label><label>教学班<select name="teaching_class_id"><option value="">不关联教学班</option></select></label><label>开始时间<input name="start_at" type="datetime-local" required></label><label>提醒时间<input name="remind_at" type="datetime-local" required></label><label>结束时间（可空）<input name="end_at" type="datetime-local"></label><label>提前提醒（分钟）<input name="advance_minutes" type="number" min="0" max="10080" value="30"></label><label>重复<select name="recurrence"><option value="">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><label class="wide">描述<textarea name="description" rows="2" maxlength="4000"></textarea></label><label class="wide">备注<textarea name="notes" rows="2" maxlength="4000"></textarea></label></div><footer><button type="button" id="teacher-reminder-delete">取消提醒</button><button class="teacher-btn primary" type="submit">保存提醒</button></footer></form></dialog>
  </div>`
}

function initChart(id, option) {
  const node = document.getElementById(id); if (!node) return
  const chart = echarts.init(node); chart.setOption({ animationDuration:500, color:['#b76d20','#6d8b71','#d2a350'], tooltip:{trigger:'axis'}, grid:{top:24,left:36,right:14,bottom:32,containLabel:true}, ...option }); charts.push(chart)
}

function emptyChart(title='暂无真实数据') { return { title:{text:title,left:'center',top:'middle',textStyle:{color:'#9b8b7c',fontSize:12,fontWeight:'normal'}}, xAxis:{show:false},yAxis:{show:false},series:[] } }

function renderCharts(dashboard, analytics) {
  disposeCharts()
  const trend = dashboard.weekly_activity_trend || []
  initChart('teacher-chart-activity', trend.length ? { xAxis:{type:'category',data:trend.map(item=>item.date.slice(5)),axisLabel:{color:'#806f5e'}},yAxis:{type:'value',splitLine:{lineStyle:{color:'#eee6da'}}},series:[{type:'line',smooth:true,areaStyle:{opacity:.1},symbolSize:5,data:trend.map(item=>item.study_minutes)}] } : emptyChart())
  const mastery = analytics?.mastery_distribution || []
  initChart('teacher-chart-mastery', mastery.length ? { xAxis:{type:'category',data:mastery.map(item=>item.label),axisLabel:{color:'#806f5e'}},yAxis:{type:'value',splitLine:{lineStyle:{color:'#eee6da'}}},series:[{type:'bar',barMaxWidth:30,itemStyle:{borderRadius:[5,5,0,0]},data:mastery.map(item=>item.count)}] } : emptyChart())
  const keywords = normalizeKeywords(analytics?.dialogue?.keywords).slice(0,5)
  initChart('teacher-chart-keywords', keywords.length ? { grid:{top:12,left:62,right:16,bottom:20,containLabel:true},xAxis:{type:'value',splitLine:{show:false}},yAxis:{type:'category',inverse:true,data:keywords.map(item=>item.text),axisLabel:{color:'#806f5e'}},series:[{type:'bar',barMaxWidth:16,itemStyle:{borderRadius:[0,5,5,0]},data:keywords.map(item=>item.value)}] } : emptyChart())
  const weak = normalizeWeakKnowledgePoints(analytics?.weak_knowledge_points).slice(0,5)
  initChart('teacher-chart-weak', weak.length ? { grid:{top:12,left:80,right:24,bottom:20,containLabel:true},xAxis:{type:'value',max:100,splitLine:{lineStyle:{color:'#eee6da'}}},yAxis:{type:'category',inverse:true,data:weak.map(item=>item.name),axisLabel:{color:'#806f5e',width:80,overflow:'truncate'}},series:[{type:'bar',barMaxWidth:16,itemStyle:{borderRadius:[0,5,5,0]},data:weak.map(item=>item.mastery)}] } : emptyChart())
}

function bindNavigation() { document.querySelectorAll('[data-teacher-nav]').forEach(button=>button.addEventListener('click',()=>{window.location.hash=button.dataset.teacherNav})) }

export async function renderTeacherDashboard(app) {
  dashboardLifecycle?.abort(); dashboardLifecycle = new AbortController()
  let user=getUser(); try { const result=await getMe(); user=result.data.user; setAuth(getToken(),user) } catch { if(!user){clearAuth();window.location.hash='#/login';return} }
  try {
    const [dashboardResult,profileResult,classResult]=await Promise.all([getTeacherDashboard(),getTeacherProfile(),getAllTeachingClasses({status:'active'})]); const dashboard=dashboardResult.data||{}; const profile=profileResult.data||{}; const classes=classResult.data?.list||[]
    renderDashboardLayout(app,{title:'教师工作台',menuItems:TEACHER_MENU_ITEMS,contentHTML:content(user,dashboard,profile,classes),user}); bindNavigation(); bindCalendar(dashboard)
    let analytics=null; const courseId=profile.default_course_id||dashboard.classes?.[0]?.course_id; const classId=dashboard.classes?.find(item=>item.course_id===courseId)?.teaching_class_id
    if(courseId){ try { const result=await getAnalyticsWorkbench({course_id:courseId,...(classId?{teaching_class_id:classId}:{}),range:'7d'});analytics=result.data; document.getElementById('teacher-chart-scope').textContent=`${analytics.filters?.course_name||'所选课程'} · 最近7天真实数据` } catch {} }
    renderCharts(dashboard,analytics)
    window.addEventListener('resize',()=>charts.forEach(chart=>chart.resize()),{passive:true,signal:dashboardLifecycle.signal})
    window.addEventListener('hashchange',()=>{if(!window.location.hash.startsWith('#/teacher/dashboard')){disposeCharts();dashboardLifecycle?.abort()}},{signal:dashboardLifecycle.signal})
  } catch(error) { renderDashboardLayout(app,{title:'教师工作台',menuItems:TEACHER_MENU_ITEMS,contentHTML:`<div class="teacher-dashboard-error"><b>教师工作台加载失败</b><p>${escapeHtml(error.message||'请稍后重试')}</p><button onclick="location.reload()">重新加载</button></div>`,user}) }
}
