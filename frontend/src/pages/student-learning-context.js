import { renderDashboardLayout } from '../utils/dashboard.js'
import { STUDENT_MENU_ITEMS } from '../utils/student-menu.js'
import { getUser } from '../utils/auth.js'
import { escapeHtml } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { getStudentCourses, getStudentCourseKnowledgePoints } from '../api/student.js'
import { learningGoalApi } from '../api/learning-goals.js'
import { learningWorkflowApi } from '../api/learning-workflows.js'
import { studentLearningContextApi } from '../api/student-learning-context.js'

const dataOf = value => value?.data ?? value
let state = { courses: [], points: [], goals: [], templates: [], current: null }

function pageHtml() {
  return `<main class="learning-context-page"><header class="learning-context-hero"><div><span>学习控制台</span><h1>当前学习上下文</h1><p>课程、知识点、目标与工作流在这里一次设定，学习流、预加载和文件生成会自动复用。</p></div><span id="context-state" class="learning-context-state">正在读取…</span></header><form id="learning-context-form"><section class="learning-context-block"><div><b>01</b><h2>学习范围</h2></div><div class="learning-context-grid"><label>课程<select id="context-course" required></select></label><label>知识点<select id="context-point" required></select></label></div></section><section class="learning-context-block"><div><b>02</b><h2>目标与工作流</h2></div><div class="learning-context-grid"><label>学习目标<select id="context-goal" required></select></label><label>工作流模板<select id="context-template" required></select></label><label>目标掌握度<input id="context-mastery" type="number" min="1" max="100" value="80"></label><label>完成方式<select id="context-completion"><option value="MASTERY_TARGET">达到掌握度</option><option value="WORKFLOW_COMPLETE">完成全部节点</option><option value="TIME_BOXED">按时长完成</option></select></label></div></section><section class="learning-context-block"><div><b>03</b><h2>学习偏好</h2></div><div class="learning-context-grid"><label>讲解风格<select id="context-style"><option value="DETAILED">详细讲解</option><option value="CONCISE">简洁直达</option><option value="SOCRATIC">启发提问</option></select></label><label>练习强度<select id="context-intensity"><option value="STANDARD">标准</option><option value="LIGHT">轻量</option><option value="INTENSIVE">强化</option></select></label><label class="context-check"><input id="context-examples" type="checkbox" checked> 讲解中包含示例</label><label class="context-check"><input id="context-voice" type="checkbox"> 开启语音导学偏好</label></div></section><footer class="learning-context-actions"><button id="context-clear" type="button" class="complex-btn-ghost">清除当前上下文</button><button id="context-refresh" type="button" class="complex-btn-secondary">刷新学情快照</button><button type="submit" class="complex-btn">保存并设为当前</button></footer></form><section id="context-snapshot" class="learning-context-snapshot"></section></main>`
}

function options(items, valueKey, labelKey, selected, empty) {
  return `<option value="">${empty}</option>${items.map(item => `<option value="${item[valueKey]}" ${Number(item[valueKey]) === Number(selected) ? 'selected' : ''}>${escapeHtml(item[labelKey] || '')}</option>`).join('')}`
}

function renderSnapshot(context) {
  const root = document.getElementById('context-snapshot'); if (!root) return
  if (!context?.active) { root.innerHTML = '<h2>学情快照</h2><p>保存上下文后，这里会显示当前掌握度、未解决错题和已关联资料。</p>'; return }
  const snapshot = context.snapshot || {}
  root.innerHTML = `<h2>我的当前学习状态</h2><div class="learning-context-metrics"><div><strong>${Math.round(snapshot.mastery?.score || 0)}%</strong><span>当前掌握度</span></div><div><strong>${snapshot.currentLearningProgress || 0}%</strong><span>近期学习进度</span></div><div><strong>${snapshot.unresolvedWrongQuestions || 0}</strong><span>未解决错题</span></div><div><strong>${snapshot.linkedResourceCount || 0}</strong><span>已绑定课前资料</span></div></div><p><b>已掌握：</b>${escapeHtml((snapshot.masteredKnowledgePoints || []).map(item => item.name).join('、') || '暂无')}</p><p><b>薄弱点：</b>${escapeHtml((snapshot.weakKnowledgePoints || []).map(item => item.name).join('、') || context.knowledgePoint?.name || '暂无')}</p><p><b>最近错误：</b>${escapeHtml((snapshot.wrongReasonDistribution || []).map(item => `${item.reason} ${item.count} 次`).join('、') || '暂无')}</p><p><b>推荐方式：</b>${escapeHtml(snapshot.recommendedLearningMode || '按当前工作流继续学习')}</p><div class="learning-context-shortcuts"><a class="complex-btn" href="#/student/learning-flows?context=active">开始学习</a><a class="complex-btn-secondary" href="#/student/learning-flows?context=active">学习准备</a><a class="complex-btn-secondary" href="#/student/agents?agentType=FILE_GENERATOR&context=active">生成课前讲义</a><a class="complex-btn-secondary" href="#/student/learning-flows?context=active&resources=1">查看课前资料</a></div>`
}

async function loadScope(courseId, pointId) {
  if (!courseId) { state.points = []; state.goals = []; return }
  const [pointsResponse, goalsResponse] = await Promise.all([getStudentCourseKnowledgePoints(courseId), learningGoalApi.list({ courseId, pageSize: 100 })])
  state.points = dataOf(pointsResponse)?.list || []; state.goals = dataOf(goalsResponse)?.items || []
  const pointSelect = document.getElementById('context-point'); const goalSelect = document.getElementById('context-goal')
  pointSelect.innerHTML = options(state.points, 'knowledge_point_id', 'knowledge_point_name', pointId, '选择知识点')
  goalSelect.innerHTML = options(state.goals, 'goalId', 'normalizedTitle', state.current?.learningGoalId, '选择学习目标')
}

async function loadPage(refresh = false) {
  const [coursesResponse, templatesResponse, contextResponse] = await Promise.all([getStudentCourses(), learningWorkflowApi.listTemplates({ source: 'ALL', pageSize: 100 }), studentLearningContextApi.get(refresh)])
  state.courses = dataOf(coursesResponse)?.list || []; state.templates = dataOf(templatesResponse)?.items || []; state.current = dataOf(contextResponse)
  const current = state.current || {}; document.getElementById('context-course').innerHTML = options(state.courses, 'course_id', 'course_name', current.courseId, '选择课程')
  document.getElementById('context-template').innerHTML = options(state.templates, 'template_id', 'title', current.workflowTemplateId, '选择工作流模板')
  await loadScope(current.courseId || state.courses[0]?.course_id, current.knowledgePointId)
  if (!current.courseId && state.courses[0]) document.getElementById('context-course').value = state.courses[0].course_id
  document.getElementById('context-mastery').value = current.targetMastery || 80; document.getElementById('context-completion').value = current.completionMode || 'MASTERY_TARGET'
  document.getElementById('context-style').value = current.learningPreference?.explanationStyle || 'DETAILED'; document.getElementById('context-intensity').value = current.learningPreference?.practiceIntensity || 'STANDARD'
  document.getElementById('context-examples').checked = current.learningPreference?.includeExamples !== false; document.getElementById('context-voice').checked = Boolean(current.voiceConfig?.enabled)
  const badge = document.getElementById('context-state'); badge.textContent = current.active ? (current.valid ? '当前上下文有效' : `需要更新：${current.reason}`) : '尚未设置'; badge.classList.toggle('is-valid', Boolean(current.active && current.valid))
  renderSnapshot(current)
}

function bind() {
  document.getElementById('context-course').addEventListener('change', event => loadScope(Number(event.target.value), null).catch(error => showToast(error.message, 'error')))
  document.getElementById('learning-context-form').addEventListener('submit', async event => { event.preventDefault(); const payload = { courseId: Number(document.getElementById('context-course').value), knowledgePointId: Number(document.getElementById('context-point').value), learningGoalId: Number(document.getElementById('context-goal').value), workflowTemplateId: Number(document.getElementById('context-template').value), targetMastery: Number(document.getElementById('context-mastery').value), completionMode: document.getElementById('context-completion').value, learningPreference: { explanationStyle: document.getElementById('context-style').value, practiceIntensity: document.getElementById('context-intensity').value, includeExamples: document.getElementById('context-examples').checked }, voiceConfig: { enabled: document.getElementById('context-voice').checked } }; try { state.current = dataOf(await studentLearningContextApi.update(payload)); showToast('当前学习上下文已保存', 'success'); await loadPage() } catch (error) { showToast(error.message, 'error') } })
  document.getElementById('context-refresh').addEventListener('click', () => loadPage(true).then(() => showToast('学情快照已刷新', 'success')).catch(error => showToast(error.message, 'error')))
  document.getElementById('context-clear').addEventListener('click', async () => { if (!confirm('确定清除当前学习上下文吗？')) return; try { await studentLearningContextApi.clear(); await loadPage(); showToast('当前学习上下文已清除', 'success') } catch (error) { showToast(error.message, 'error') } })
}

export function renderStudentLearningContext(app) {
  renderDashboardLayout(app, { menuItems: STUDENT_MENU_ITEMS, user: getUser(), contentHTML: pageHtml() }); bind(); loadPage().catch(error => { document.getElementById('context-state').textContent = error.message; showToast(error.message, 'error') })
}
