import { escapeHtml } from '../utils/format.js'

const GROUPS = [
  { match: ['/teacher/system','/teacher/classes','/teacher/students','/teacher/courses'], label: '教学组织', items: [
    ['班级管理','#/teacher/system?tab=classes'],['学生管理','#/teacher/system?tab=students'],['课程管理','#/teacher/system?tab=courses'],
  ] },
  { match: ['/teacher/tasks','/teacher/homework'], label: '教学任务', items: [
    ['任务总览','#/teacher/tasks'],['发布任务','#/teacher/tasks/create'],['作业管理','#/teacher/homework'],
  ] },
  { match: ['/teacher/questions'], label: '题库', items: [
    ['题库管理','#/teacher/questions'],['新建题目','#/teacher/questions/create'],['AI 智能出题','#/teacher/questions?mode=ai'],
  ] },
  { match: ['/teacher/preparation','/teacher/lesson-plan','/teacher/artifacts'], label: '教学设计', items: [
    ['智慧备课','#/teacher/preparation'],['沉浸式备课','#/teacher/preparation/immersive'],['教案管理','#/teacher/lesson-plan'],['产物中心','#/teacher/artifacts'],
  ] },
]

function currentPath() { return (window.location.hash.slice(1).split('?')[0] || '/teacher/dashboard').replace(/\/$/,'') }
function selectedGroup(path) { return GROUPS.find(group=>group.match.some(prefix=>path===prefix||path.startsWith(`${prefix}/`)))||null }
function itemActive(hash) {
  const [targetPath,targetQuery='']=hash.slice(1).split('?');const path=currentPath();const group=selectedGroup(path);const exactSibling=group?.items.some(([,itemHash])=>itemHash.slice(1).split('?')[0]===path);if(exactSibling&&path!==targetPath)return false;if(path!==targetPath&&!path.startsWith(`${targetPath}/`))return false
  if(!targetQuery)return true
  const target=new URLSearchParams(targetQuery);const current=new URLSearchParams(window.location.hash.split('?')[1]||'')
  return [...target.entries()].every(([key,value])=>current.get(key)===value)
}

export function renderTeacherSecondaryNav() {
  const group=selectedGroup(currentPath())
  if (!group || group.items.length < 2) return ''
  return `<nav class="teacher-secondary-nav" id="teacher-secondary-nav" aria-label="教师端次级导航"><strong>${escapeHtml(group.label)}</strong><div>${group.items.map(([label,hash])=>`<a href="${escapeHtml(hash)}" class="${itemActive(hash)?'active':''}">${escapeHtml(label)}</a>`).join('')}</div></nav>`
}
