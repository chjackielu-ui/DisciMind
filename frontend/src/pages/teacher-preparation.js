import DOMPurify from 'dompurify'
import {
  getTeacherCourses, getTeachingClasses, getChapters,
  getPreparationPlans, createPreparationPlan, getPreparationPlan, savePreparationPlan,
  getPreparationSyllabuses, createPreparationSyllabus, updatePreparationSyllabus, generateLessonPlanFromSyllabus,
  generateTeacherPpt, getTeacherPptTask,
  generatePreparationPlan, getPreparationStatus, streamPreparationEvents,
  getPreparationVersions, restorePreparationVersion, publishPreparationPlan, exportPreparationPlan,
  getAnalyticsWorkbench, getTeachingResources, uploadKnowledgeDocument, refinePreparationStage,
} from '../api/teacher.js'
import { downloadGeneratedArtifact } from '../api/marketplace.js'
import { getMe } from '../api/auth.js'
import { getUser, getToken, setAuth, clearAuth } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import { escapeHtml, formatRelativeTime } from '../utils/format.js'
import { showToast } from '../utils/toast.js'
import { normalizeWeakKnowledgePoints, normalizeKeywords, percent } from '../utils/analytics-contract.js'
import { renderMarkdownToHtml } from '../utils/markdown.js'
import { teacherCourseLabel } from '../utils/teacher-course.js'

const WORKBENCH_KEY = 'discimind.teacherPreparationWorkbench.v2'
const LESSON_TYPES = ['新授课', '复习课', '实验课', '研讨课', '项目式课程', '翻转课堂', '混合式教学', '任务驱动课', '概念课', '习题课']
const DEFAULT_STEPS = [
  ['classProfile', '教学背景'], ['studentAnalytics', '学情诊断'], ['teachingObjectives', '教学目标'],
  ['keyAndDifficultPoints', '教学重难点'], ['timeAllocation', '教学流程'], ['lessonIntroduction', '课堂引入'],
  ['activities', '教学活动'], ['questions', '提问设计'], ['exercises', '例题和练习'],
  ['differentiatedInstruction', '分层教学'], ['assessments', '课堂评价'], ['homework', '作业设计'],
  ['resources', '教学资源'], ['reviewResult', '质量检查'],
]
const STEP_LABELS = Object.fromEntries(DEFAULT_STEPS)
const FIELD_LABELS = {
  averageMastery: '平均掌握度', taskCompletionRate: '任务完成率', riskStudentCount: '风险学生',
  weakKnowledgePoints: '薄弱知识点', teachingObjectives: '教学目标', keyPoints: '教学重点',
  difficultPoints: '教学难点', teacherAction: '教师活动', studentAction: '学生活动',
  designIntent: '设计意图', minutes: '时间（分钟）', stage: '阶段', method: '方法', evidence: '学习证据',
  successCriteria: '达成标准', question: '问题', purpose: '设计目的', expectedEvidence: '预期表现',
  title: '标题', prompt: '任务内容', level: '层级', description: '说明', reason: '推荐理由',
}

function initialState() {
  return {
    courses: [], classes: [], plans: [], resources: [], syllabuses: [], courseId: '', classId: '', plan: null, syllabus: null,
    content: {}, locked: [], stepIndex: 0, analytics: null, generation: null, versions: [],
    flowStep: 0, pptResult: null,
    pendingGeneration: null, pendingRefinement: null, eventAbort: null,
    dirty: false, saving: false, refining: false, disposed: false,
  }
}

let state = initialState()

function activeSteps() {
  const keys = state.plan?.input?.templateStages
  return Array.isArray(keys) && keys.length ? keys.map(key => [key, STEP_LABELS[key] || key]) : DEFAULT_STEPS
}

function activeStepKey() { return activeSteps()[state.stepIndex]?.[0] || DEFAULT_STEPS[0][0] }
function activeStepLabel() { return activeSteps()[state.stepIndex]?.[1] || DEFAULT_STEPS[0][1] }
function activeLockKeys() { return activeStepKey() === 'keyAndDifficultPoints' ? ['keyPoints', 'difficultPoints'] : [activeStepKey()] }
function activeGenerationKeys() { return activeStepKey() === 'keyAndDifficultPoints' ? ['keyPoints', 'difficultPoints'] : activeStepKey() === 'differentiatedInstruction' ? ['exercises'] : [activeStepKey()] }
function allGenerationKeys() { return [...new Set(activeSteps().flatMap(([key]) => key === 'keyAndDifficultPoints' ? ['keyPoints', 'difficultPoints'] : key === 'differentiatedInstruction' ? ['exercises'] : [key]))] }

function naturalText(value) {
  if (value == null || value === '') return ''
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value)
  if (Array.isArray(value)) return value.map((item, index) => {
    if (!item || typeof item !== 'object') return `• ${naturalText(item)}`
    const title = item.title || item.stage || item.question || `第 ${index + 1} 项`
    const body = Object.entries(item).filter(([key]) => !['title', 'stage', 'question'].includes(key)).map(([key, child]) => `${FIELD_LABELS[key] || key}：${naturalText(child)}`).join('\n')
    return `${title}${body ? `\n${body}` : ''}`
  }).join('\n\n')
  return Object.entries(value).filter(([key]) => key !== 'teacherNarratives').map(([key, child]) => `${FIELD_LABELS[key] || STEP_LABELS[key] || key}\n${naturalText(child)}`).join('\n\n')
}

function activeStepValue() {
  if (activeStepKey() === 'keyAndDifficultPoints') return { keyPoints: state.content.keyPoints || [], difficultPoints: state.content.difficultPoints || [] }
  if (activeStepKey() === 'differentiatedInstruction') return state.content.differentiatedInstruction || { studentLayers: state.content.studentAnalytics?.student_layers || [], layeredExercises: state.content.exercises || [] }
  return state.content[activeStepKey()]
}

function readWorkspace() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(WORKBENCH_KEY) || '{}')
    state.courseId = String(stored.courseId || '')
    state.classId = String(stored.classId || '')
    state.stepIndex = Math.max(0, Number(stored.stepIndex) || 0)
    state.flowStep = Math.min(3, Math.max(0, Number(stored.flowStep) || 0))
    state.persistedSyllabusId = Number(stored.syllabusId) || null
    return Number(stored.planId) || null
  } catch { return null }
}

function persistWorkspace() {
  sessionStorage.setItem(WORKBENCH_KEY, JSON.stringify({
    courseId: state.courseId, classId: state.classId, planId: state.plan?.lesson_plan_id || null, syllabusId: state.syllabus?.syllabus_id || null, stepIndex: state.stepIndex, flowStep: state.flowStep,
  }))
}

function shell() {
  return `<div class="preparation-page preparation-workbench teacher-workbench">
    <header class="prep-workbench-head">
      <div><span>智慧备课工作台</span><h2 id="prep-workbench-title">选择备课方案</h2><p id="prep-workbench-subtitle">围绕学情完成多阶段教学设计</p></div>
      <div class="prep-workbench-head-actions">
        <span class="prep-save-indicator" id="prep-save-state">尚未打开方案</span>
        <button class="teacher-btn teacher-btn--ghost teacher-btn--sm prep-narrow-toggle" id="prep-toggle-left" aria-expanded="false">方案与资源</button>
        <button class="teacher-btn teacher-btn--ghost teacher-btn--sm prep-narrow-toggle" id="prep-toggle-right" aria-expanded="false">学情与操作</button>
        <button class="teacher-btn teacher-btn--secondary teacher-btn--sm" id="prep-new-plan">新建方案</button>
        <button class="teacher-btn teacher-btn--primary teacher-btn--sm" id="prep-enter-immersive" disabled>进入沉浸式备课</button>
      </div>
    </header>
    <nav class="prep-flow-rail" id="prep-flow" aria-label="流程式备课"></nav>
    <section class="prep-flow-summary" id="prep-flow-summary"></section>
    <nav class="prep-stage-rail" id="prep-steps" aria-label="备课阶段"></nav>
    <main class="prep-workbench-grid">
      <aside class="prep-workbench-left">
        <section class="prep-panel prep-selector-panel"><header><b>方案上下文</b></header>
          <label>课程<select id="prep-course"><option value="">选择课程</option></select></label>
          <label>教学班<select id="prep-class"><option value="">选择教学班</option></select></label>
        </section>
        <section class="prep-panel prep-syllabus-panel"><header><b>教学大纲</b><span id="prep-syllabus-count">0 份</span></header><div class="prep-syllabus-actions"><button class="teacher-btn teacher-btn--ghost teacher-btn--sm" id="prep-upload-syllabus">上传</button><button class="teacher-btn teacher-btn--secondary teacher-btn--sm" id="prep-new-syllabus">创建</button></div><div id="prep-syllabus-list" class="prep-syllabus-list"><p class="prep-muted">请先选择课程</p></div><input id="prep-syllabus-file" type="file" accept=".doc,.docx,.pdf,.md,.txt" hidden></section>
        <section class="prep-panel prep-plan-panel"><header><b>备课方案</b><span id="prep-plan-count">0 个</span></header><div id="prep-plan-list" class="prep-plan-list"><p class="prep-muted">请先选择课程</p></div></section>
        <section class="prep-panel prep-resource-panel"><header><b>关联资源</b><span id="prep-resource-count">0 项</span></header><div id="prep-resource-list" class="prep-resource-list"><p class="prep-muted">选择课程后加载真实资源</p></div></section>
      </aside>
      <section class="prep-workbench-center">
        <header class="prep-stage-head"><div><span id="prep-stage-number">阶段 —</span><h3 id="prep-stage-title">选择方案开始编辑</h3><p id="prep-stage-meta">阶段内容会保存为方案版本</p></div><div><button class="teacher-btn teacher-btn--secondary teacher-btn--sm" id="prep-lock" disabled>锁定阶段</button><button class="teacher-btn teacher-btn--primary teacher-btn--sm" id="prep-generate-stage" disabled>AI 生成本阶段</button></div></header>
        <div class="prep-center-scroll" id="prep-center-scroll">
          <section class="prep-natural-editor-card">
            <div class="prep-editor-label"><b>自然语言内容</b><span>可直接修改，支持 Markdown 结构</span></div>
            <div id="prep-stage-editor" class="prep-natural-editor" contenteditable="true" data-placeholder="选择方案后，在这里编辑当前阶段内容"></div>
          </section>
          <section class="prep-refine-card"><label for="prep-refine-instruction"><b>AI 局部优化</b><span>只优化当前阶段，不覆盖已锁定内容</span></label><div><textarea id="prep-refine-instruction" maxlength="1000" rows="2" placeholder="例如：结合薄弱知识点增加一个分层提问环节"></textarea><button class="teacher-btn teacher-btn--primary teacher-btn--sm" id="prep-refine-stage" disabled>生成优化稿</button></div></section>
          <section class="prep-preview-card"><header><b>实时预览</b><span id="prep-preview-state">尚无内容</span></header><article id="prep-stage-preview" class="prep-stage-preview"><p class="prep-muted">阶段内容将在此预览</p></article></section>
        </div>
        <footer class="prep-center-actions"><button class="teacher-btn teacher-btn--ghost teacher-btn--sm" id="prep-plan-versions" disabled>版本管理</button><button class="teacher-btn teacher-btn--secondary teacher-btn--sm" id="prep-generate-all" disabled>生成全部阶段</button><button class="teacher-btn teacher-btn--primary teacher-btn--sm" id="prep-save-stage" disabled>保存草稿</button></footer>
      </section>
      <aside class="prep-workbench-right">
        <section class="prep-panel"><header><b>学情摘要</b><span id="prep-analytics-range">最近 30 天</span></header><div id="prep-analytics-overview" class="prep-metric-grid"><p class="prep-muted">选择方案后加载</p></div></section>
        <section class="prep-panel"><header><b>薄弱知识点</b><span>真实掌握度</span></header><div id="prep-weak-list" class="prep-insight-list"><p class="prep-muted">暂无数据</p></div></section>
        <section class="prep-panel prep-questions-panel"><header><b>高频问题</b><span id="prep-question-count">0 项</span></header><div id="prep-question-list" class="prep-question-list"><p class="prep-muted">暂无数据</p></div></section>
        <details class="prep-panel prep-agent-panel"><summary><b>Agent 执行</b><span id="prep-progress">0%</span></summary><div class="prep-progress-bar"><i id="prep-progress-fill"></i></div><div id="prep-agents" class="prep-agent-list"><p class="prep-muted">尚未执行</p></div></details>
        <section class="prep-panel prep-plan-actions"><header><b>方案操作</b></header><div><button class="teacher-btn teacher-btn--secondary teacher-btn--sm" id="prep-publish" disabled>发布方案</button><button class="teacher-btn teacher-btn--secondary teacher-btn--sm" id="prep-handout" disabled>生成学生讲义</button><button class="teacher-btn teacher-btn--ghost teacher-btn--sm" id="prep-export-docx" disabled>导出 DOCX</button><button class="teacher-btn teacher-btn--ghost teacher-btn--sm" id="prep-export-pdf" disabled>导出 PDF</button></div></section>
      </aside>
    </main>
    ${dialogs()}
  </div>`
}

function dialogs() {
  return `<dialog id="prep-syllabus-dialog" class="teacher-dialog prep-syllabus-dialog"><form id="prep-syllabus-form"><header><div><h3 id="prep-syllabus-dialog-title">创建教学大纲</h3><p>大纲将作为教案、课件与资源匹配的流程起点</p></div><button type="button" data-syllabus-close>×</button></header><input type="hidden" name="syllabus_id"><div class="teacher-form-grid">
    <label>课程<select name="course_id" required></select></label><label>教学班<select name="teaching_class_id"><option value="">课程通用</option></select></label>
    <label class="wide">大纲标题<input name="title" required maxlength="200" placeholder="例如：数据结构课程教学大纲"></label>
    <label class="wide">教学目标<textarea name="objectives" rows="3" placeholder="每行一项目标"></textarea></label>
    <label class="wide">教学要求<textarea name="requirements" rows="2" placeholder="课程考核、先修基础与能力要求"></textarea></label>
    <label class="wide">核心知识点<textarea name="knowledge_points" rows="2" placeholder="每行一个知识点"></textarea></label>
    <label class="wide">章节结构<textarea name="chapters" rows="5" placeholder="每行格式：章节名称 | 知识点1、知识点2 | 本章目标"></textarea></label>
    <label class="wide">大纲正文<textarea name="content" rows="6" placeholder="可补充或编辑完整 Markdown 大纲正文"></textarea></label>
    </div><footer><button type="button" data-syllabus-close>取消</button><button class="primary" type="submit">保存大纲</button></footer></form></dialog>
    <dialog id="prep-create-dialog" class="teacher-dialog"><form id="prep-create-form"><header><h3>创建备课方案</h3><button type="button" data-create-close>×</button></header><div class="teacher-form-grid">
    <label>课程<select name="course_id" required></select></label><label>教学班<select name="teaching_class_id" required></select></label>
    <label class="wide">授课主题<input name="topic" required maxlength="240"></label><label>授课日期<input name="teaching_date" type="date"></label><label>课时（分钟）<input name="duration_minutes" type="number" min="15" max="240" value="45"></label>
    <label>章节<select name="chapter_id"><option value="">不指定</option></select></label><label>课型模板<select name="lesson_type">${LESSON_TYPES.map(type => `<option>${type}</option>`).join('')}</select></label>
    <label>教学地点<input name="location"></label><label>教材<input name="textbook"></label><label>学情范围<select name="analytics_range"><option value="7d">最近 7 天</option><option value="30d" selected>最近 30 天</option><option value="semester">本学期</option></select></label>
    <label class="wide">学生基础<input name="student_foundation"></label>
    <fieldset class="wide"><legend>教学偏好</legend><label><input type="checkbox" name="use_case" checked> 案例</label><label><input type="checkbox" name="project_based"> 项目式</label><label><input type="checkbox" name="discussion" checked> 讨论</label><label><input type="checkbox" name="in_class_practice" checked> 随堂练习</label><label><input type="checkbox" name="include_homework" checked> 课后作业</label></fieldset>
    </div><footer><button type="button" data-create-close>取消</button><button class="primary" type="submit">创建</button></footer></form></dialog>
    <dialog id="prep-version-dialog" class="teacher-dialog version-dialog"><header><h3>方案版本</h3><button data-plan-version-close>×</button></header><div id="prep-version-list"></div></dialog>
    <dialog id="prep-confirm-dialog" class="teacher-dialog prep-confirm-dialog"><header><h3>确认 Agent 生成范围</h3><button data-confirm-close>×</button></header><div id="prep-confirm-summary"></div><p>确认后读取授权范围内的实时学情并启动 Agent；已锁定阶段不会被覆盖。</p><footer><button data-confirm-close>返回</button><button class="primary" id="prep-confirm-generate">确认并开始</button></footer></dialog>
    <dialog id="prep-refine-dialog" class="teacher-dialog prep-refine-dialog"><header><div><h3>AI 优化稿</h3><span id="prep-refine-dialog-meta">等待教师确认</span></div><button type="button" data-refine-close>×</button></header><div class="prep-refine-compare"><section><h4>当前内容</h4><article id="prep-refine-before"></article></section><section><h4>AI 优化建议</h4><article id="prep-refine-after"></article></section></div><p>AI 只生成候选稿；点击“应用并保存”后才会修改当前阶段并创建新版本。</p><footer><button type="button" data-refine-close>保留原稿</button><button type="button" id="prep-refine-regenerate">重新生成</button><button type="button" class="primary" id="prep-refine-apply">应用并保存</button></footer></dialog>
    <dialog id="prep-ppt-dialog" class="teacher-dialog prep-ppt-dialog"><form id="prep-ppt-form"><header><div><h3>生成教学 PPT</h3><p>结构生成完成后将自动渲染为可下载的真实 PPTX</p></div><button type="button" data-ppt-close>×</button></header><div class="teacher-form-grid">
    <label>生成来源<select name="generationSource"><option value="syllabus">根据教学大纲</option><option value="lesson-plan">根据教案</option><option value="topic">根据课程主题</option><option value="knowledge-points">根据知识点</option><option value="text">根据正文内容</option></select></label>
    <label>课程名称<input name="courseName" maxlength="120" required></label><label class="wide">课程主题<input name="topic" maxlength="240" required></label>
    <label>PPT 页数<input name="pageCount" type="number" min="6" max="30" value="10"></label><label>PPT 风格<select name="style"><option value="教学型">教学型</option><option value="课堂讲授型">课堂讲授型</option><option value="竞赛展示型">竞赛展示型</option><option value="简洁型">简洁型</option><option value="学术型">学术型</option></select></label>
    <label class="wide">知识点<textarea name="knowledgePoints" rows="2" placeholder="每行一个知识点"></textarea></label><label class="wide">教学大纲、教案或资源正文<textarea name="sourceText" rows="6" placeholder="可直接粘贴课程正文；选择大纲或教案时会自动读取平台内容"></textarea></label>
    </div><div id="prep-ppt-generation-state" class="prep-ppt-generation-state"><p>填写生成参数后开始生成。</p></div><footer><button type="button" data-ppt-close>关闭</button><button class="primary" type="submit" id="prep-ppt-generate">生成 PPTX</button></footer></form></dialog>`
}

const FLOW_STEPS = [
  ['教学大纲', '导入或设计课程结构'],
  ['教案生成', '基于大纲生成并编辑'],
  ['课件生成', '进入 PPT 生成与任务状态'],
  ['资源匹配', '匹配资料、题目与学习任务'],
]

function flowStatuses() {
  const hasSyllabus = Boolean(state.syllabus)
  const hasSyllabusPlan = Boolean(state.syllabus?.lesson_plan_id || state.plan?.input?.syllabusId)
  const hasPresentation = state.resources.some(item => /ppt|presentation|课件/i.test(`${item.file_ext || ''} ${item.resource_kind || ''} ${item.resource_category || ''}`))
  const matchedResources = state.resources.filter(item => item.document_id !== state.syllabus?.syllabus_id && item.resource_kind !== 'syllabus')
  return [
    hasSyllabus ? '已完成' : '未开始',
    hasSyllabusPlan ? '已生成' : hasSyllabus ? '可生成' : '未开始',
    hasPresentation ? '已生成' : state.plan || hasSyllabus ? '可生成' : '未开始',
    matchedResources.length ? '已完成' : state.plan ? '可生成' : '未开始',
  ]
}

function renderWorkflow() {
  const statuses = flowStatuses()
  const rail = document.getElementById('prep-flow')
  rail.innerHTML = FLOW_STEPS.map(([title, description], index) => `<button data-flow-step="${index}" class="${state.flowStep === index ? 'active' : ''}" ${index && statuses[index] === '未开始' ? 'disabled' : ''}><i>${index + 1}</i><span><b>${title}</b><em>${description}</em></span><strong data-status="${statuses[index]}">${statuses[index]}</strong></button>`).join('')
  const syllabusTitle = state.syllabus?.title || '尚未选择教学大纲'
  const matchedResources = state.resources.filter(item => item.document_id !== state.syllabus?.syllabus_id && item.resource_kind !== 'syllabus')
  const panels = [
    `<div><span>流程起点</span><h3>${escapeHtml(syllabusTitle)}</h3><p>${state.syllabus ? `${state.syllabus.chapters?.length || 0} 个章节 · ${state.syllabus.knowledge_points?.length || 0} 个知识点 · ${state.syllabus.source_type === 'manual' ? '自主创建' : '文件导入'}` : '上传已有文件，或在系统中自主设计课程大纲。'}</p></div><div class="prep-flow-actions"><button class="teacher-btn teacher-btn--secondary teacher-btn--sm" data-flow-action="upload">上传大纲</button><button class="teacher-btn teacher-btn--primary teacher-btn--sm" data-flow-action="edit">${state.syllabus ? '查看并编辑' : '创建大纲'}</button></div>`,
    `<div><span>教案状态</span><h3>${state.syllabus?.lesson_plan_id || state.plan?.input?.syllabusId ? '结构化教案已生成' : '从大纲生成可编辑教案'}</h3><p>自动整理教学目标、重点难点、教学过程和作业安排；生成后继续使用现有分阶段编辑能力。</p></div><div class="prep-flow-actions">${state.syllabus?.lesson_plan_id ? '<button class="teacher-btn teacher-btn--secondary teacher-btn--sm" data-flow-action="lesson">重新生成</button><button class="teacher-btn teacher-btn--primary teacher-btn--sm" data-flow-action="open-lesson">打开已有教案</button>' : `<button class="teacher-btn teacher-btn--primary teacher-btn--sm" data-flow-action="lesson" ${state.syllabus ? '' : 'disabled'}>生成教案</button>`}</div>`,
    `<div><span>课件任务</span><h3>${statuses[2] === '已生成' ? '课程课件已就绪' : 'PPT 生成入口可用'}</h3><p>根据大纲、教案、主题、知识点或正文生成真实 PPTX，并登记到产物中心。</p></div><div class="prep-flow-actions"><button class="teacher-btn teacher-btn--primary teacher-btn--sm" data-flow-action="ppt" ${state.plan || state.syllabus ? '' : 'disabled'}>生成 PPT</button></div>`,
    `<div><span>资源匹配</span><h3>已匹配 ${matchedResources.length} 项课程资源</h3><p>根据当前课程汇集课程资料、题目、课件与学习任务，避免重复上传。</p></div><div class="prep-flow-actions"><button class="teacher-btn teacher-btn--secondary teacher-btn--sm" data-flow-action="resources" ${state.courseId ? '' : 'disabled'}>刷新匹配</button></div>`,
  ]
  document.getElementById('prep-flow-summary').innerHTML = panels[state.flowStep]
}

function renderSyllabuses() {
  document.getElementById('prep-syllabus-count').textContent = `${state.syllabuses.length} 份`
  document.getElementById('prep-syllabus-list').innerHTML = state.syllabuses.length ? state.syllabuses.map(item => `<button data-syllabus-id="${item.syllabus_id}" class="${state.syllabus?.syllabus_id === item.syllabus_id ? 'active' : ''}"><span><b>${escapeHtml(item.title)}</b><em>${item.chapters?.length || 0} 章 · ${item.knowledge_points?.length || 0} 个知识点</em></span><i>${item.lesson_plan_id ? '已生成教案' : '可生成'}</i></button>`).join('') : `<p class="prep-muted">${state.courseId ? '暂无大纲，可上传或手动创建' : '请先选择课程'}</p>`
  renderWorkflow()
}

function chapterLines(chapters = []) {
  return chapters.map(chapter => `${chapter.title || ''} | ${(chapter.knowledgePoints || []).join('、')} | ${chapter.objective || ''}`).join('\n')
}

function openSyllabusDialog(syllabus = null) {
  const form = document.getElementById('prep-syllabus-form')
  form.reset()
  form.elements.syllabus_id.value = syllabus?.syllabus_id || ''
  form.elements.course_id.value = syllabus?.course_id || state.courseId || ''
  form.elements.teaching_class_id.value = syllabus?.teaching_class_id || state.classId || ''
  form.elements.title.value = syllabus?.title || ''
  form.elements.objectives.value = (syllabus?.objectives || []).join('\n')
  form.elements.requirements.value = syllabus?.requirements || ''
  form.elements.knowledge_points.value = (syllabus?.knowledge_points || []).join('\n')
  form.elements.chapters.value = chapterLines(syllabus?.chapters)
  form.elements.content.value = syllabus?.content || ''
  form.elements.course_id.disabled = Boolean(syllabus)
  form.elements.teaching_class_id.disabled = Boolean(syllabus)
  document.getElementById('prep-syllabus-dialog-title').textContent = syllabus ? '编辑教学大纲' : '创建教学大纲'
  document.getElementById('prep-syllabus-dialog').showModal()
}

function selectSyllabus(id) {
  state.syllabus = state.syllabuses.find(item => item.syllabus_id === Number(id)) || null
  renderSyllabuses()
  persistWorkspace()
}

function renderStepRail() {
  const host = document.getElementById('prep-steps')
  if (!host) return
  host.innerHTML = activeSteps().map(([key, label], index) => {
    const locked = key === 'keyAndDifficultPoints' ? ['keyPoints', 'difficultPoints'].every(item => state.locked.includes(item)) : state.locked.includes(key)
    return `<button data-step-index="${index}" class="${index === state.stepIndex ? 'active' : ''}" ${state.plan ? '' : 'disabled'}><i>${index + 1}</i><span>${escapeHtml(label)}</span>${locked ? '<em>已锁定</em>' : ''}</button>`
  }).join('')
}

function syncStageEditor() {
  if (!state.plan) return
  const editor = document.getElementById('prep-stage-editor')
  state.content.teacherNarratives = { ...(state.content.teacherNarratives || {}), [activeStepKey()]: editor?.innerText.trim() || '' }
}

function updateSaveState(text, tone = '') {
  const host = document.getElementById('prep-save-state')
  if (!host) return
  host.textContent = text
  host.dataset.tone = tone
}

function renderStage() {
  renderStepRail()
  renderWorkflow()
  const enabled = Boolean(state.plan)
  document.getElementById('prep-stage-number').textContent = enabled ? `阶段 ${state.stepIndex + 1} / ${activeSteps().length}` : '阶段 —'
  document.getElementById('prep-stage-title').textContent = enabled ? activeStepLabel() : '选择方案开始编辑'
  document.getElementById('prep-stage-meta').textContent = enabled ? `${state.plan.topic} · V${state.plan.current_version || 0} · ${state.plan.status}` : '阶段内容会保存为方案版本'
  const editor = document.getElementById('prep-stage-editor')
  editor.setAttribute('contenteditable', enabled ? 'true' : 'false')
  editor.innerText = enabled ? (state.content.teacherNarratives?.[activeStepKey()] || naturalText(activeStepValue())) : ''
  document.getElementById('prep-lock').textContent = activeLockKeys().every(key => state.locked.includes(key)) ? '取消锁定' : '锁定阶段'
  ;['prep-lock', 'prep-generate-stage', 'prep-refine-stage', 'prep-plan-versions', 'prep-generate-all', 'prep-save-stage', 'prep-publish', 'prep-handout', 'prep-export-docx', 'prep-export-pdf'].forEach(id => { document.getElementById(id).disabled = !enabled })
  document.getElementById('prep-refine-stage').disabled = !enabled || state.refining || activeLockKeys().every(key => state.locked.includes(key))
  document.getElementById('prep-enter-immersive').disabled = !enabled
  renderPreview()
}

function renderPreview() {
  const text = document.getElementById('prep-stage-editor')?.innerText.trim() || ''
  document.getElementById('prep-preview-state').textContent = text ? `${text.length} 字` : '尚无内容'
  document.getElementById('prep-stage-preview').innerHTML = text ? DOMPurify.sanitize(renderMarkdownToHtml(text)) : '<p class="prep-muted">阶段内容将在此预览</p>'
}

function renderPlanList() {
  document.getElementById('prep-plan-count').textContent = `${state.plans.length} 个`
  document.getElementById('prep-plan-list').innerHTML = state.plans.length ? state.plans.map(plan => `<button data-plan-id="${plan.lesson_plan_id}" class="${state.plan?.lesson_plan_id === plan.lesson_plan_id ? 'active' : ''}"><span><b>${escapeHtml(plan.topic)}</b><em>${escapeHtml(plan.lesson_type || '教学方案')} · V${plan.current_version || 0}</em></span><i data-status="${escapeHtml(plan.status)}">${escapeHtml(plan.status)}</i></button>`).join('') : `<p class="prep-muted">${state.courseId ? '当前筛选下暂无方案，可新建方案' : '请先选择课程'}</p>`
}

function renderResources() {
  const list = state.resources.slice(0, 8)
  document.getElementById('prep-resource-count').textContent = `${state.resources.length} 项`
  document.getElementById('prep-resource-list').innerHTML = list.length ? list.map(item => `<article><i>${escapeHtml(String(item.file_ext || item.resource_type || 'FILE').toUpperCase())}</i><span><b>${escapeHtml(item.title || item.resource_name || item.file_name || '未命名资源')}</b><em>${escapeHtml(item.source || item.resource_kind || '课程资源')}</em></span></article>`).join('') : '<p class="prep-muted">当前课程暂无关联资源</p>'
}

function renderAnalytics(data) {
  state.analytics = data
  const overview = data?.overview || {}
  const weak = normalizeWeakKnowledgePoints(data?.weak_knowledge_points).slice(0, 6)
  const questions = normalizeKeywords(data?.dialogue?.keywords).slice(0, 8)
  document.getElementById('prep-analytics-range').textContent = state.plan?.input?.analyticsRange === '7d' ? '最近 7 天' : state.plan?.input?.analyticsRange === 'semester' ? '本学期' : '最近 30 天'
  document.getElementById('prep-analytics-overview').innerHTML = data ? `<div><b>${overview.student_count || 0}</b><span>学生</span></div><div><b>${percent(overview.average_mastery)}</b><span>掌握度</span></div><div><b>${percent(overview.task_completion_rate)}</b><span>完成率</span></div><div><b>${data.risk_students?.length || 0}</b><span>风险学生</span></div>` : '<p class="prep-muted">暂无学情数据</p>'
  document.getElementById('prep-weak-list').innerHTML = weak.length ? weak.map(item => `<p><span>${escapeHtml(item.name)}</span><i>${percent(item.mastery)}</i></p>`).join('') : '<p class="prep-muted">暂无薄弱知识点</p>'
  document.getElementById('prep-question-count').textContent = `${questions.length} 项`
  document.getElementById('prep-question-list').innerHTML = questions.length ? questions.map(item => `<article><span>${escapeHtml(item.text)}</span><i>${item.questionCount || 0} 次</i></article>`).join('') : '<p class="prep-muted">暂无高频问题</p>'
}

function renderGeneration(status) {
  state.generation = status
  const progress = Number(status?.progress || 0)
  document.getElementById('prep-progress').textContent = `${progress}%`
  document.getElementById('prep-progress-fill').style.width = `${progress}%`
  const labels = { running: '执行中', succeeded: '已完成', degraded: '降级完成', skipped: '已跳过', failed: '需重试', queued: '排队中' }
  document.getElementById('prep-agents').innerHTML = (status?.agents || []).map(item => `<div data-status="${escapeHtml(item.status)}"><i></i><span><b>${escapeHtml(item.agent)}</b><em>${escapeHtml(item.stage)}</em></span><strong>${labels[item.status] || item.status}</strong></div>`).join('') || '<p class="prep-muted">尚未执行</p>'
}

async function loadCourses() {
  const result = await getTeacherCourses({ page_size: 100 })
  state.courses = result.data?.list || []
  const html = '<option value="">选择课程</option>' + state.courses.map(item => `<option value="${item.course_id}">${escapeHtml(teacherCourseLabel(item))}</option>`).join('')
  document.getElementById('prep-course').innerHTML = html
  document.querySelector('#prep-create-form [name="course_id"]').innerHTML = html
  document.querySelector('#prep-syllabus-form [name="course_id"]').innerHTML = html
}

async function loadClasses(courseId) {
  state.classes = courseId ? ((await getTeachingClasses(courseId, { page_size: 100 })).data?.list || []) : []
  const html = '<option value="">全部教学班</option>' + state.classes.map(item => `<option value="${item.teaching_class_id}">${escapeHtml(item.teaching_class_name)}</option>`).join('')
  document.getElementById('prep-class').innerHTML = html
  document.querySelector('#prep-create-form [name="teaching_class_id"]').innerHTML = html.replace('全部教学班', '请选择教学班')
  document.querySelector('#prep-syllabus-form [name="teaching_class_id"]').innerHTML = html.replace('全部教学班', '课程通用')
}

async function loadSyllabuses() {
  state.syllabuses = state.courseId ? ((await getPreparationSyllabuses({ course_id: state.courseId, ...(state.classId ? { teaching_class_id: state.classId } : {}) })).data?.list || []) : []
  const preferredId = state.plan?.input?.syllabusId || state.persistedSyllabusId || state.syllabus?.syllabus_id
  state.syllabus = state.syllabuses.find(item => item.syllabus_id === Number(preferredId)) || state.syllabuses[0] || null
  state.persistedSyllabusId = null
  renderSyllabuses()
}

async function loadPlans() {
  state.plans = state.courseId ? ((await getPreparationPlans({ course_id: state.courseId, ...(state.classId ? { teaching_class_id: state.classId } : {}) })).data?.list || []) : []
  renderPlanList()
}

async function loadResources() {
  state.resources = state.courseId ? ((await getTeachingResources({ course_id: state.courseId, page_size: 100 })).data?.list || []) : []
  renderResources()
}

async function loadAnalytics() {
  if (!state.plan) return renderAnalytics(null)
  try { renderAnalytics((await getAnalyticsWorkbench({ course_id: state.plan.course_id, teaching_class_id: state.plan.teaching_class_id, range: state.plan.input?.analyticsRange || '30d' })).data) }
  catch { renderAnalytics(null) }
}

async function loadGeneration() {
  if (!state.plan) return renderGeneration(null)
  try { renderGeneration((await getPreparationStatus(state.plan.lesson_plan_id)).data) } catch { renderGeneration(null) }
}

function renderPlanHeader() {
  if (!state.plan) return
  document.getElementById('prep-workbench-title').textContent = state.plan.topic
  document.getElementById('prep-workbench-subtitle').textContent = `${state.plan.lesson_type || '教学方案'} · ${state.plan.status} · V${state.plan.current_version || 0}`
}

async function openPlan(id) {
  if (state.dirty && !(await saveStageDraft('切换方案前自动保存', true))) return
  const result = await getPreparationPlan(id)
  if (state.disposed) return
  state.plan = result.data
  state.content = state.plan.content || {}
  state.locked = state.plan.locked_blocks || []
  state.courseId = String(state.plan.course_id)
  state.classId = String(state.plan.teaching_class_id || '')
  state.stepIndex = Math.min(state.stepIndex, activeSteps().length - 1)
  document.getElementById('prep-course').value = state.courseId
  await loadClasses(state.courseId)
  document.getElementById('prep-class').value = state.classId
  await Promise.all([loadPlans(), loadResources(), loadSyllabuses(), loadAnalytics(), loadGeneration()])
  if (state.disposed) return
  renderPlanHeader()
  state.dirty = false
  updateSaveState('已保存', 'saved')
  renderStage()
  renderPlanList()
  persistWorkspace()
}

async function saveStageDraft(summary = '教师编辑保存', quiet = false) {
  if (!state.plan || state.saving) return !state.dirty
  syncStageEditor()
  state.saving = true
  updateSaveState('保存中…', 'saving')
  try {
    const result = await savePreparationPlan(state.plan.lesson_plan_id, { content: state.content, locked_blocks: state.locked, change_summary: summary })
    state.plan.current_version = result.data.version_number
    renderPlanHeader()
    state.dirty = false
    updateSaveState(`已保存 V${result.data.version_number}`, 'saved')
    if (!quiet) showToast('备课方案已保存', 'success')
    await loadPlans()
    renderStage()
    return true
  } catch (error) {
    updateSaveState('保存失败', 'error')
    if (!quiet) showToast(error.message || '保存失败', 'error')
    return false
  } finally { state.saving = false }
}

function showGenerationConfirmation(confirmation, targetSections) {
  state.pendingGeneration = { confirmation, targetSections }
  document.getElementById('prep-confirm-summary').innerHTML = `<dl><div><dt>课型模板</dt><dd>${escapeHtml(confirmation.summary?.lessonType || state.plan.lesson_type || '新授课')}</dd></div><div><dt>生成范围</dt><dd>${targetSections.map(key => STEP_LABELS[key] || key).join('、') || '全部阶段'}</dd></div><div><dt>已锁定</dt><dd>${(confirmation.summary?.lockedBlocks || []).map(key => STEP_LABELS[key] || key).join('、') || '无'}</dd></div></dl>`
  document.getElementById('prep-confirm-dialog').showModal()
}

async function monitorGeneration() {
  state.eventAbort?.abort()
  state.eventAbort = new AbortController()
  try {
    await streamPreparationEvents(state.plan.lesson_plan_id, { signal: state.eventAbort.signal, onEvent: async (event, payload) => {
      if (state.disposed) return
      if (event === 'snapshot') renderGeneration(payload)
      else if (event === 'progress' || event === 'agent') await loadGeneration()
      else if (event === 'complete') { showToast(payload.status === 'draft' ? payload.message || '生成中断，已保留草稿' : '智慧备课生成完成', payload.status === 'draft' ? 'warning' : 'success'); await openPlan(state.plan.lesson_plan_id) }
      else if (event === 'failed') { showToast(payload.message || '生成暂时中断，可重试', 'warning'); await loadGeneration() }
    } })
  } catch (error) { if (error.name !== 'AbortError' && !state.disposed) showToast(error.message || 'Agent 状态连接中断', 'warning') }
}

async function startGeneration(targetSections) {
  if (!state.plan || state.plan.status === 'generating') return
  await saveStageDraft('Agent 生成前保存', true)
  const response = await generatePreparationPlan(state.plan.lesson_plan_id, { sections: targetSections, locked_blocks: state.locked })
  if (response.data?.status === 'awaiting_confirmation') return showGenerationConfirmation(response.data.confirmation, targetSections)
  await monitorGeneration()
}

async function confirmGeneration() {
  if (!state.pendingGeneration) return
  const { confirmation, targetSections } = state.pendingGeneration
  const response = await generatePreparationPlan(state.plan.lesson_plan_id, { sections: targetSections, locked_blocks: state.locked, confirmation_token: confirmation.token })
  if (response.data?.status !== 'generating') throw new Error('确认状态已过期，请重新发起')
  document.getElementById('prep-confirm-dialog').close()
  state.pendingGeneration = null
  await monitorGeneration()
}

function closeRefinementPreview() {
  state.pendingRefinement = null
  document.getElementById('prep-refine-dialog').close()
  updateSaveState(state.plan ? `已保存 V${state.plan.current_version || 0}` : '尚未打开方案', state.plan ? 'saved' : '')
}

function showRefinementPreview(payload) {
  state.pendingRefinement = payload
  document.getElementById('prep-refine-dialog-meta').textContent = `${payload.stageLabel} · 基于 V${payload.baseVersion}`
  document.getElementById('prep-refine-before').innerHTML = payload.before
    ? DOMPurify.sanitize(renderMarkdownToHtml(payload.before))
    : '<p class="prep-muted">当前阶段暂无内容</p>'
  document.getElementById('prep-refine-after').innerHTML = DOMPurify.sanitize(renderMarkdownToHtml(payload.narrative))
  document.getElementById('prep-refine-dialog').showModal()
  updateSaveState('优化稿待确认', 'dirty')
}

async function refineCurrentStage(instructionOverride = '') {
  const input = document.getElementById('prep-refine-instruction')
  const instruction = String(instructionOverride || input.value).trim()
  if (!instruction) return showToast('请先输入本阶段优化要求', 'warning')
  if (state.refining || !state.plan) return
  if (state.dirty && !(await saveStageDraft('生成优化稿前保存', true))) throw new Error('当前阶段保存失败，未调用 AI')
  const planId = state.plan.lesson_plan_id
  const stageKey = activeStepKey()
  const stageLabel = activeStepLabel()
  const before = state.content.teacherNarratives?.[stageKey] || naturalText(activeStepValue())
  const button = document.getElementById('prep-refine-stage')
  state.refining = true
  button.disabled = true
  button.classList.add('is-loading')
  button.textContent = 'AI 生成中…'
  updateSaveState('正在生成优化稿…', 'saving')
  try {
    const result = await refinePreparationStage(planId, { stage_key: stageKey, instruction, preview_only: true })
    if (!result.data?.narrative) throw new Error('AI 未返回有效优化稿')
    if (!state.plan || state.plan.lesson_plan_id !== planId) return
    input.value = instruction
    showRefinementPreview({
      planId, stageKey, stageLabel, instruction, before,
      narrative: result.data.narrative,
      baseVersion: Number(result.data.base_version || state.plan.current_version || 0),
    })
  } finally {
    state.refining = false
    button.classList.remove('is-loading')
    button.textContent = '生成优化稿'
    renderStage()
  }
}

async function applyRefinementPreview() {
  const pending = state.pendingRefinement
  if (!pending || !state.plan || state.plan.lesson_plan_id !== pending.planId) throw new Error('优化稿对应的方案已变化，请重新生成')
  if (Number(state.plan.current_version || 0) !== Number(pending.baseVersion || 0)) throw new Error('当前方案版本已变化，请关闭后重新生成优化稿')
  const merged = {
    ...state.content,
    teacherNarratives: { ...(state.content.teacherNarratives || {}), [pending.stageKey]: pending.narrative },
  }
  const applyButton = document.getElementById('prep-refine-apply')
  applyButton.disabled = true
  applyButton.textContent = '应用中…'
  try {
    const result = await savePreparationPlan(state.plan.lesson_plan_id, {
      content: merged,
      locked_blocks: state.locked,
      change_summary: `AI 局部优化：${pending.stageLabel}`,
    })
    state.content = merged
    state.plan.current_version = result.data.version_number
    renderPlanHeader()
    state.dirty = false
    state.pendingRefinement = null
    document.getElementById('prep-refine-instruction').value = ''
    document.getElementById('prep-refine-dialog').close()
    renderStage()
    await loadPlans()
    updateSaveState(`已应用优化稿 V${result.data.version_number}`, 'saved')
    showToast('AI 优化稿已应用，并保存为新版本', 'success')
  } finally {
    applyButton.disabled = false
    applyButton.textContent = '应用并保存'
  }
}

async function showPlanVersions() {
  state.versions = (await getPreparationVersions(state.plan.lesson_plan_id)).data?.list || []
  document.getElementById('prep-version-list').innerHTML = state.versions.map(item => `<article><div><b>V${item.version_number}</b><span>${escapeHtml(item.change_summary || '无摘要')}</span><em>${escapeHtml(item.creator_name)} · ${formatRelativeTime(item.created_at)}</em></div><button data-restore-plan-version="${item.version_number}">恢复为新版本</button></article>`).join('') || '<p class="prep-muted">暂无版本</p>'
  document.getElementById('prep-version-dialog').showModal()
}

async function exportPlan(format, artifactType = 'TEACHER_LESSON_PLAN') {
  if (!state.plan) return
  if (state.dirty && !(await saveStageDraft('导出前保存', true))) return showToast('当前内容未保存，暂不能导出', 'warning')
  const result = await exportPreparationPlan(state.plan.lesson_plan_id, format, artifactType)
  showToast(`${artifactType === 'STUDENT_HANDOUT' ? '学生讲义' : format} 导出任务 ${result.data.task_id} 已进入任务中心`, 'success')
}

async function saveSyllabusForm(form) {
  const payload = Object.fromEntries(new FormData(form).entries())
  const syllabusId = Number(payload.syllabus_id)
  delete payload.syllabus_id
  const result = syllabusId ? await updatePreparationSyllabus(syllabusId, payload) : await createPreparationSyllabus(payload)
  document.getElementById('prep-syllabus-dialog').close()
  await loadSyllabuses()
  selectSyllabus(result.data.syllabus_id)
  state.flowStep = 0
  renderWorkflow()
  showToast(syllabusId ? '教学大纲已保存' : '教学大纲已创建，可以生成教案', 'success')
}

async function uploadSyllabus(file) {
  if (!file) return
  if (!state.courseId) return showToast('请先选择课程', 'warning')
  const data = new FormData()
  data.append('file', file)
  data.append('title', file.name.replace(/\.[^.]+$/, ''))
  data.append('course_id', state.courseId)
  if (state.classId) data.append('teaching_class_id', state.classId)
  data.append('scope_type', state.classId ? 'class' : 'course')
  data.append('visibility', state.classId ? 'class' : 'private')
  data.append('is_teaching_resource', 'true')
  data.append('resource_kind', 'syllabus')
  data.append('resource_category', '教学大纲')
  const result = await uploadKnowledgeDocument(data)
  await loadSyllabuses()
  selectSyllabus(result.data?.document_id)
  state.flowStep = 0
  renderWorkflow()
  showToast('教学大纲已上传，可继续编辑结构化信息', 'success')
}

async function generateFromSelectedSyllabus() {
  if (!state.syllabus) return showToast('请先选择或创建教学大纲', 'warning')
  const classId = Number(state.classId || state.syllabus.teaching_class_id || state.classes[0]?.teaching_class_id)
  if (!classId) return showToast('当前课程暂无教学班，暂不能生成教案', 'warning')
  state.classId = String(classId)
  document.getElementById('prep-class').value = state.classId
  const result = await generateLessonPlanFromSyllabus(state.syllabus.syllabus_id, { teaching_class_id: classId, lesson_type: '新授课', duration_minutes: 45 })
  state.flowStep = 1
  await openPlan(result.data.lesson_plan_id)
  showToast(result.data.message || '已根据大纲生成教案', 'success')
}

function renderPptResult(result = state.pptResult) {
  const host = document.getElementById('prep-ppt-generation-state')
  if (!host) return
  if (!result) { host.innerHTML = '<p>填写生成参数后开始生成。</p>'; return }
  if (['pending', 'queued', 'running', 'generating'].includes(result.status)) {
    host.innerHTML = `<div class="prep-ppt-progress"><span>正在生成 PPTX</span><b>${Number(result.progress || 0)}%</b><i><em style="width:${Number(result.progress || 0)}%"></em></i><p>${escapeHtml(result.stage || '正在组织课件结构与页面内容')}</p></div>`
    return
  }
  if (result.status === 'failed') {
    host.innerHTML = `<div class="prep-ppt-error"><b>PPTX 生成失败</b><p>${escapeHtml(result.errorMessage || '请检查输入内容后重试')}</p></div>`
    return
  }
  const slides = result.slides || []
  host.innerHTML = `<section class="prep-ppt-result"><header><div><small>${result.isDemo ? '演示模式 · 本地真实渲染' : escapeHtml(result.provider || 'PPT 生成服务')}</small><h4>${escapeHtml(result.title || '教学课件')}</h4><p>${slides.length} 页 · 已登记到产物中心</p></div><div><button type="button" class="teacher-btn teacher-btn--secondary teacher-btn--sm" data-ppt-download="${result.artifactId}">下载 PPTX</button><button type="button" class="teacher-btn teacher-btn--primary teacher-btn--sm" data-ppt-preview="${result.artifactId}">进入课件预览</button></div></header>${result.notice ? `<p class="prep-ppt-notice">${escapeHtml(result.notice)}</p>` : ''}<div class="prep-ppt-slide-grid">${slides.map(item => `<article><span>第 ${item.page || item.pageNumber} 页 · ${escapeHtml(item.type || 'content')}</span><h5>${escapeHtml(item.title)}</h5>${item.subtitle ? `<p>${escapeHtml(item.subtitle)}</p>` : ''}<ul>${(item.bullets || []).map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul><dl><dt>建议配图</dt><dd>${escapeHtml(item.imagePrompt || item.imageSuggestion || '教学配图区域')}</dd><dt>讲解备注</dt><dd>${escapeHtml(item.notes || item.speakerNotes || '')}</dd></dl></article>`).join('')}</div></section>`
}

function openPptGeneration() {
  const form = document.getElementById('prep-ppt-form')
  const course = state.courses.find(item => Number(item.course_id) === Number(state.courseId))
  const planId = state.plan?.lesson_plan_id || state.syllabus?.lesson_plan_id
  form.elements.generationSource.value = state.syllabus ? 'syllabus' : planId ? 'lesson-plan' : 'topic'
  form.elements.courseName.value = course?.course_name || state.syllabus?.course_name || ''
  form.elements.topic.value = state.plan?.topic || state.syllabus?.title || course?.course_name || ''
  form.elements.knowledgePoints.value = (state.syllabus?.knowledge_points || state.content?.keyPoints || []).join('\n')
  form.elements.sourceText.value = state.syllabus?.content || ''
  state.pptResult = null
  renderPptResult()
  document.getElementById('prep-ppt-dialog').showModal()
}

async function waitForPptTask(taskId) {
  for (let attempt = 0; attempt < 60 && !state.disposed; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1200))
    const task = (await getTeacherPptTask(taskId)).data
    state.pptResult = task
    renderPptResult(task)
    if (['completed', 'failed'].includes(task.status)) return task
  }
  throw new Error('PPT 生成仍在进行，可稍后在任务中心查看')
}

async function submitPptGeneration(form) {
  const fields = Object.fromEntries(new FormData(form).entries())
  const source = fields.generationSource
  const payload = {
    generationSource: source,
    courseName: fields.courseName,
    topic: fields.topic,
    pageCount: Number(fields.pageCount),
    style: fields.style,
    knowledgePoints: String(fields.knowledgePoints || '').split(/\r?\n|[，,；;]/).map(item => item.trim()).filter(Boolean),
    sourceText: fields.sourceText,
    ...(source === 'syllabus' && state.syllabus?.syllabus_id ? { syllabusId: state.syllabus.syllabus_id } : {}),
    ...(source === 'lesson-plan' && (state.plan?.lesson_plan_id || state.syllabus?.lesson_plan_id) ? { lessonPlanId: state.plan?.lesson_plan_id || state.syllabus?.lesson_plan_id } : {}),
  }
  const button = document.getElementById('prep-ppt-generate')
  button.disabled = true; button.textContent = '正在生成…'
  state.pptResult = { status: 'generating', progress: 12, stage: '正在读取课程内容' }
  renderPptResult()
  try {
    const response = await generateTeacherPpt(payload)
    state.pptResult = response.data
    renderPptResult()
    if (!['completed', 'failed'].includes(state.pptResult.status) && state.pptResult.taskId) await waitForPptTask(state.pptResult.taskId)
    if (state.pptResult.status === 'completed') { await loadResources(); renderWorkflow(); showToast('真实 PPTX 已生成并保存到产物中心', 'success') }
  } catch (error) {
    state.pptResult = { status: 'failed', errorMessage: error.message || 'PPTX 生成失败' }
    renderPptResult()
    throw error
  } finally {
    button.disabled = false; button.textContent = '生成 PPTX'
  }
}

function openGeneratedPptPreview(artifactId) {
  const planId = state.plan?.lesson_plan_id || state.syllabus?.lesson_plan_id || ''
  document.getElementById('prep-ppt-dialog').close()
  window.location.hash = `#/teacher/preparation/immersive?planId=${planId}&courseId=${state.plan?.course_id || state.syllabus?.course_id || state.courseId || ''}&teachingClassId=${state.plan?.teaching_class_id || state.syllabus?.teaching_class_id || state.classId || ''}&mode=ppt&generatedArtifactId=${artifactId}`
}

async function handleFlowAction(action) {
  if (action === 'upload') return document.getElementById('prep-syllabus-file').click()
  if (action === 'edit') return openSyllabusDialog(state.syllabus)
  if (action === 'lesson') return generateFromSelectedSyllabus()
  if (action === 'open-lesson') return openPlan(state.syllabus.lesson_plan_id)
  if (action === 'ppt') return openPptGeneration()
  if (action === 'resources') {
    await loadResources()
    state.flowStep = 3
    renderWorkflow()
    document.querySelector('.prep-resource-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    return showToast(`已匹配 ${state.resources.length} 项课程资源`, 'success')
  }
}

function switchStep(index) {
  if (!state.plan || index === state.stepIndex) return
  if (state.dirty) syncStageEditor()
  state.stepIndex = index
  renderStage()
  persistWorkspace()
}

function bindEvents() {
  document.getElementById('prep-course').addEventListener('change', async event => {
    if (state.dirty && !(await saveStageDraft('切换课程前自动保存', true))) { event.target.value = state.courseId; return }
    state.courseId = event.target.value; state.classId = ''; state.plan = null; state.syllabus = null; state.content = {}; state.locked = []
    await Promise.all([loadClasses(state.courseId), loadPlans(), loadResources(), loadSyllabuses()])
    renderAnalytics(null); renderGeneration(null); renderStage(); renderPlanList(); persistWorkspace()
  })
  document.getElementById('prep-class').addEventListener('change', async event => {
    if (state.dirty && !(await saveStageDraft('切换教学班前自动保存', true))) { event.target.value = state.classId; return }
    state.classId = event.target.value; state.plan = null; state.content = {}; state.locked = []
    await Promise.all([loadPlans(), loadSyllabuses()]); renderAnalytics(null); renderGeneration(null); renderStage(); persistWorkspace()
  })
  document.getElementById('prep-flow').addEventListener('click', event => { const button = event.target.closest('[data-flow-step]'); if (!button || button.disabled) return; state.flowStep = Number(button.dataset.flowStep); renderWorkflow(); persistWorkspace() })
  document.getElementById('prep-flow-summary').addEventListener('click', event => { const button = event.target.closest('[data-flow-action]'); if (button) void handleFlowAction(button.dataset.flowAction).catch(error => showToast(error.message || '备课流程操作失败', 'error')) })
  document.getElementById('prep-syllabus-list').addEventListener('click', event => { const button = event.target.closest('[data-syllabus-id]'); if (button) selectSyllabus(button.dataset.syllabusId) })
  document.getElementById('prep-new-syllabus').onclick = () => { if (!state.courseId) return showToast('请先选择课程', 'warning'); openSyllabusDialog() }
  document.getElementById('prep-upload-syllabus').onclick = () => { if (!state.courseId) return showToast('请先选择课程', 'warning'); document.getElementById('prep-syllabus-file').click() }
  document.getElementById('prep-syllabus-file').addEventListener('change', event => { const [file] = event.target.files || []; event.target.value = ''; void uploadSyllabus(file).catch(error => showToast(error.message || '教学大纲上传失败', 'error')) })
  document.querySelectorAll('[data-syllabus-close]').forEach(button => button.onclick = () => document.getElementById('prep-syllabus-dialog').close())
  document.getElementById('prep-syllabus-form').addEventListener('submit', event => { event.preventDefault(); void saveSyllabusForm(event.target).catch(error => showToast(error.message || '教学大纲保存失败', 'error')) })
  document.querySelectorAll('[data-ppt-close]').forEach(button => button.onclick = () => document.getElementById('prep-ppt-dialog').close())
  document.getElementById('prep-ppt-form').addEventListener('submit', event => { event.preventDefault(); void submitPptGeneration(event.target).catch(error => showToast(error.message || 'PPTX 生成失败', 'error')) })
  document.getElementById('prep-ppt-generation-state').addEventListener('click', event => {
    const download = event.target.closest('[data-ppt-download]')
    const preview = event.target.closest('[data-ppt-preview]')
    if (download) void downloadGeneratedArtifact(Number(download.dataset.pptDownload), `${state.pptResult?.title || '教学课件'}.pptx`).catch(error => showToast(error.message || 'PPTX 下载失败', 'error'))
    if (preview) openGeneratedPptPreview(Number(preview.dataset.pptPreview))
  })
  document.querySelector('#prep-syllabus-form [name="course_id"]').addEventListener('change', async event => {
    const classes = (await getTeachingClasses(event.target.value, { page_size: 100 })).data?.list || []
    document.querySelector('#prep-syllabus-form [name="teaching_class_id"]').innerHTML = '<option value="">课程通用</option>' + classes.map(item => `<option value="${item.teaching_class_id}">${escapeHtml(item.teaching_class_name)}</option>`).join('')
  })
  document.getElementById('prep-plan-list').addEventListener('click', event => { const button = event.target.closest('[data-plan-id]'); if (button) void openPlan(Number(button.dataset.planId)) })
  document.getElementById('prep-steps').addEventListener('click', event => { const button = event.target.closest('[data-step-index]'); if (button) switchStep(Number(button.dataset.stepIndex)) })
  document.getElementById('prep-stage-editor').addEventListener('input', () => { if (!state.plan) return; state.dirty = true; updateSaveState('有未保存修改', 'dirty'); renderPreview() })
  document.getElementById('prep-lock').onclick = () => { const keys = activeLockKeys(); const unlock = keys.every(key => state.locked.includes(key)); state.locked = unlock ? state.locked.filter(item => !keys.includes(item)) : [...new Set([...state.locked, ...keys])]; state.dirty = true; updateSaveState('锁定状态待保存', 'dirty'); renderStage() }
  document.getElementById('prep-save-stage').onclick = () => void saveStageDraft()
  document.getElementById('prep-generate-stage').onclick = () => void startGeneration(activeGenerationKeys())
  document.getElementById('prep-generate-all').onclick = () => void startGeneration(allGenerationKeys())
  document.getElementById('prep-refine-stage').onclick = () => void refineCurrentStage().catch(error => showToast(error.message || '局部优化失败', 'error'))
  document.getElementById('prep-plan-versions').onclick = () => void showPlanVersions()
  document.getElementById('prep-publish').onclick = async () => { if (state.dirty) await saveStageDraft('发布前保存', true); await publishPreparationPlan(state.plan.lesson_plan_id); showToast('备课方案已发布', 'success'); await openPlan(state.plan.lesson_plan_id) }
  document.getElementById('prep-handout').onclick = () => void exportPlan('DOCX', 'STUDENT_HANDOUT')
  document.getElementById('prep-export-docx').onclick = () => void exportPlan('DOCX')
  document.getElementById('prep-export-pdf').onclick = () => void exportPlan('PDF')
  document.getElementById('prep-enter-immersive').onclick = () => { if (state.plan) window.location.hash = `#/teacher/preparation/immersive?planId=${state.plan.lesson_plan_id}&courseId=${state.plan.course_id}&teachingClassId=${state.plan.teaching_class_id || ''}` }
  document.getElementById('prep-toggle-left').onclick = event => { const root = document.querySelector('.preparation-workbench'); const active = root.classList.toggle('show-left-drawer'); root.classList.remove('show-right-drawer'); event.currentTarget.setAttribute('aria-expanded', String(active)); document.getElementById('prep-toggle-right').setAttribute('aria-expanded', 'false') }
  document.getElementById('prep-toggle-right').onclick = event => { const root = document.querySelector('.preparation-workbench'); const active = root.classList.toggle('show-right-drawer'); root.classList.remove('show-left-drawer'); event.currentTarget.setAttribute('aria-expanded', String(active)); document.getElementById('prep-toggle-left').setAttribute('aria-expanded', 'false') }
  document.getElementById('prep-new-plan').onclick = () => document.getElementById('prep-create-dialog').showModal()
  document.querySelectorAll('[data-create-close]').forEach(button => button.onclick = () => document.getElementById('prep-create-dialog').close())
  document.getElementById('prep-create-form').addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target); const payload = Object.fromEntries(form.entries())
    ;['use_case', 'project_based', 'discussion', 'in_class_practice', 'include_homework'].forEach(key => { payload[key] = form.has(key) })
    const result = await createPreparationPlan(payload)
    document.getElementById('prep-create-dialog').close()
    await openPlan(result.data.lesson_plan_id)
    showToast('备课方案已创建', 'success')
  })
  document.querySelector('#prep-create-form [name="course_id"]').addEventListener('change', async event => {
    const [classes, chapters] = await Promise.all([getTeachingClasses(event.target.value, { page_size: 100 }), getChapters(event.target.value)])
    document.querySelector('#prep-create-form [name="teaching_class_id"]').innerHTML = '<option value="">请选择教学班</option>' + (classes.data?.list || []).map(item => `<option value="${item.teaching_class_id}">${escapeHtml(item.teaching_class_name)}</option>`).join('')
    document.querySelector('#prep-create-form [name="chapter_id"]').innerHTML = '<option value="">不指定</option>' + (chapters.data?.list || []).map(item => `<option value="${item.chapter_id}">${escapeHtml(item.chapter_name)}</option>`).join('')
  })
  document.querySelector('[data-plan-version-close]').onclick = () => document.getElementById('prep-version-dialog').close()
  document.getElementById('prep-version-list').onclick = async event => { const button = event.target.closest('[data-restore-plan-version]'); if (!button) return; await restorePreparationVersion(state.plan.lesson_plan_id, Number(button.dataset.restorePlanVersion)); document.getElementById('prep-version-dialog').close(); await openPlan(state.plan.lesson_plan_id); showToast('已从历史版本创建新的当前版本', 'success') }
  document.querySelectorAll('[data-confirm-close]').forEach(button => button.onclick = () => document.getElementById('prep-confirm-dialog').close())
  document.getElementById('prep-confirm-generate').onclick = () => void confirmGeneration().catch(error => showToast(error.message, 'error'))
  document.querySelectorAll('[data-refine-close]').forEach(button => button.onclick = closeRefinementPreview)
  document.getElementById('prep-refine-regenerate').onclick = () => {
    const instruction = state.pendingRefinement?.instruction || ''
    document.getElementById('prep-refine-dialog').close()
    state.pendingRefinement = null
    void refineCurrentStage(instruction).catch(error => showToast(error.message || '重新生成失败', 'error'))
  }
  document.getElementById('prep-refine-apply').onclick = () => void applyRefinementPreview().catch(error => showToast(error.message || '应用优化稿失败', 'error'))
}

export async function renderTeacherPreparation(app) {
  state = initialState()
  let user = getUser()
  try { const result = await getMe(); user = result.data.user; setAuth(getToken(), user) } catch { if (!user) { clearAuth(); window.location.hash = '#/login'; return } }
  const persistedPlanId = readWorkspace()
  renderDashboardLayout(app, { title: '智慧备课', menuItems: TEACHER_MENU_ITEMS, contentHTML: shell(), user })
  bindEvents()
  renderStepRail()
  renderWorkflow()
  try {
    await loadCourses()
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    const planId = Number(params.get('planId') || params.get('lesson_plan_id') || persistedPlanId)
    const routeCourseId = params.get('courseId') || params.get('course_id') || state.courseId
    const routeClassId = params.get('teachingClassId') || params.get('teaching_class_id') || state.classId
    if (planId) await openPlan(planId)
    else if (routeCourseId) {
      state.courseId = String(routeCourseId); document.getElementById('prep-course').value = state.courseId
      await loadClasses(state.courseId); state.classId = String(routeClassId || ''); document.getElementById('prep-class').value = state.classId
      await Promise.all([loadPlans(), loadResources(), loadSyllabuses()])
    }
  } catch (error) { showToast(error.message || '智慧备课数据加载失败', 'error') }
  return async () => {
    if (state.disposed) return
    if (state.dirty) await saveStageDraft('离开智慧备课自动保存', true)
    state.disposed = true
    state.eventAbort?.abort()
    persistWorkspace()
  }
}
