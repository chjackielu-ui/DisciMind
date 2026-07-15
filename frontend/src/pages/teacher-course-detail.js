// 教师端 — 课程详情页
// 支持三个标签页：教学班级 | 章节与知识点 | 课程信息

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import {
  getTeacherCourse, updateTeacherCourse,
  getTeachingClasses, createTeachingClass, deleteTeachingClass,
  getClassStudents,
  getChapters, createChapter, deleteChapter,
  getKnowledgePoints, createKnowledgePoint, deleteKnowledgePoint,
  getAcademicSemesters, getCourseOfferings, createCourseOffering,
} from '../api/teacher.js'
import { iconBook, iconSearch, iconRefresh, iconUser, iconStar } from '../utils/icons.js'
import { escapeHtml, formatDate } from '../utils/format.js'
import { initAllAutoResize } from '../utils/auto-resize.js'
import { renderCourseFilesPanel, mountCourseFilesPanel } from '../components/course-files-panel.js'

// ========================
// 主渲染函数
// ========================

export async function renderTeacherCourseDetail(app, params) {
  const courseId = params && parseInt(params.course_id, 10)
  if (!courseId) {
    window.location.hash = '#/teacher/system?tab=courses'
    return
  }

  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? getToken() : '', user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  const displayName = getUserDisplayName()

  // ---- 初始加载骨架 ----
  renderDashboardLayout(app, {
    title: '课程详情',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML: `
      <div class="dashboard-content">
        <div class="empty-hint" style="padding:60px 0;">正在加载课程详情...</div>
      </div>
    `,
    user,
  })

  // ---- 加载课程基础信息 ----
  let course = null
  let loadError = false

  try {
    const res = await getTeacherCourse(courseId)
    course = res.data
  } catch (err) {
    loadError = true
    renderError(err.message || '课程详情加载失败')
    return
  }

  if (!course) {
    loadError = true
    renderError('课程不存在')
    return
  }

  // ---- 加载附加数据（教学班级、章节） ----
  let classes = []
  let chapters = []
  let offerings = []
  let semesters = []
  let kpCache = {} // chapterId -> knowledgePoints[]

  try {
    const [classRes, chapterRes, offeringRes, semesterRes] = await Promise.all([
      getTeachingClasses(courseId),
      getChapters(courseId),
      getCourseOfferings(courseId),
      getAcademicSemesters({ status: 'active' }),
    ])
    classes = classRes.data?.list || []
    chapters = chapterRes.data?.list || []
    offerings = offeringRes.data?.list || []
    semesters = semesterRes.data?.list || []
  } catch (err) {
    // 非致命：仅显示空白
    classes = course.teaching_classes || []
    chapters = course.chapters || []
  }

  // ---- 渲染完整页面 ----
  function renderFullPage() {
    const teachers = (course.teacher_list || []).map(t => t.real_name).filter(Boolean).join('、')

    const contentHTML = `
      <div class="dashboard-content">
        <div style="margin-bottom:20px;"><button class="btn-back" onclick="window.location.hash='#/teacher/courses'">← 返回课程管理</button></div>
        <div class="course-hero-card"><div class="hero-inner"><div class="hero-info"><div class="hero-course-name">${escapeHtml(course.course_name)}</div><div class="hero-course-code">${escapeHtml(course.course_code)} · ${escapeHtml(course.subject_category || '')}</div><div class="hero-desc">${escapeHtml(course.description || '')}</div><div class="hero-meta-tags"><span class="hero-tag">👨‍🏫 ${escapeHtml(teachers || '未设置')}</span><span class="hero-tag">📖 ${course.chapters?.length || chapters.length || 0} 个章节</span><span class="hero-tag">🎯 ${course.knowledge_point_count || 0} 个知识点</span><span class="hero-tag">🏫 ${classes.length} 个班级</span><span class="hero-tag">👥 ${course.student_count || 0} 名学生</span><span class="hero-tag"><span style="background:${course.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${course.status === 'active' ? '#065f46' : '#92400e'};padding:2px 8px;border-radius:10px;font-size:0.75rem;">${course.status === 'active' ? '进行中' : '已归档'}</span></span></div></div><div class="hero-chart-area" style="display:flex;align-items:center;justify-content:flex-end;"><button class="btn btn-primary" id="btn-edit-course-info" style="font-size:0.85rem;padding:8px 18px;">编辑课程</button></div></div></div>

        <!-- 标签页导航 -->
        <div class="tabs-nav" style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px;">
          <button class="tab-btn active" data-tab="classes" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
            教学班级
          </button>
          <button class="tab-btn" data-tab="files" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
            课程文件
          </button>
          <button class="tab-btn" data-tab="chapters" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
            章节与知识点
          </button>
          <button class="tab-btn" data-tab="info" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
            课程信息
          </button>
        </div>

        <!-- 教学班级 Tab -->
        <div class="tab-content" id="tab-classes" style="display:block;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">教学班级（${classes.length}）</h3>
            <div style="display:flex;gap:8px;"><button class="btn" id="btn-create-offering" style="font-size:0.85rem;padding:6px 14px;border:1px solid var(--border);">创建课程开设</button><button class="btn btn-primary" id="btn-create-class" style="font-size:0.85rem;padding:6px 14px;">新建教学班</button></div>
          </div>
          <div class="course-offering-strip">${offerings.length ? offerings.map(item => `<article><b>${escapeHtml(item.semester_name)}</b><span>${escapeHtml(item.status)} · ${item.teaching_class_count || 0} 个教学班</span><small>${item.start_date ? formatDate(item.start_date, 'date') : '-'} 至 ${item.end_date ? formatDate(item.end_date, 'date') : '-'}</small></article>`).join('') : '<div class="empty-hint">尚未创建课程开设；教学班仍兼容旧学期字段。</div>'}</div>
          <div id="classes-list-container">
            ${renderClassesList(classes)}
          </div>
        </div>

        <div class="tab-content" id="tab-files" style="display:none;">
          ${renderCourseFilesPanel({ user, course, classes })}
        </div>

        <!-- 章节与知识点 Tab -->
        <div class="tab-content" id="tab-chapters" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">章节列表（${chapters.length}）</h3>
            <button class="btn btn-primary" id="btn-create-chapter" style="font-size:0.85rem;padding:6px 14px;">＋ 新建章节</button>
          </div>
          <div id="chapters-list-container">
            ${chapters.length === 0
              ? '<div class="empty-hint" style="padding:40px 0;">暂无章节，点击上方"新建章节"开始创建</div>'
              : chapters.map((ch, idx) => renderChapterItem(ch, idx)).join('')
            }
          </div>
        </div>

        <!-- 课程信息 Tab -->
        <div class="tab-content" id="tab-info" style="display:none;">
          <div class="card" style="padding:20px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0 0 16px;">基本信息</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
              <div><span style="color:var(--text-muted);font-size:0.85rem;">课程名称</span><div style="font-weight:600;margin-top:2px;">${escapeHtml(course.course_name)}</div></div>
              <div><span style="color:var(--text-muted);font-size:0.85rem;">课程编码</span><div style="font-weight:600;margin-top:2px;">${escapeHtml(course.course_code)}</div></div>
              <div><span style="color:var(--text-muted);font-size:0.85rem;">学科分类</span><div style="font-weight:600;margin-top:2px;">${escapeHtml(course.subject_category || '-')}</div></div>
              <div><span style="color:var(--text-muted);font-size:0.85rem;">状态</span><div style="font-weight:600;margin-top:2px;">
                <span style="background:${course.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${course.status === 'active' ? '#065f46' : '#92400e'};padding:2px 10px;border-radius:12px;font-size:0.8rem;">
                  ${course.status === 'active' ? '进行中' : '已归档'}
                </span>
              </div></div>
              <div><span style="color:var(--text-muted);font-size:0.85rem;">创建时间</span><div style="font-weight:600;margin-top:2px;">${formatDate(course.created_at)}</div></div>
              <div><span style="color:var(--text-muted);font-size:0.85rem;">学生总数</span><div style="font-weight:600;margin-top:2px;">${course.student_count || 0} 人</div></div>
            </div>
            ${course.description ? `
            <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
              <span style="color:var(--text-muted);font-size:0.85rem;">课程描述</span>
              <div style="margin-top:4px;color:var(--text-secondary);">${escapeHtml(course.description)}</div>
            </div>` : ''}
          </div>

          <!-- 授课教师列表 -->
          <div class="card" style="padding:20px;margin-top:16px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0 0 16px;">授课教师</h3>
            ${(course.teacher_list || []).length === 0
              ? '<div class="empty-hint" style="padding:20px 0;">暂无授课教师</div>'
              : `<div style="display:flex;flex-direction:column;gap:10px;">
                  ${course.teacher_list.map(t => `
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                      <div style="width:36px;height:36px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.9rem;font-weight:600;flex-shrink:0;">
                        ${(t.real_name || '?')[0]}
                      </div>
                      <div>
                        <div style="font-weight:600;color:var(--stu-dark);">${escapeHtml(t.real_name || '未知')}</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);">${t.teacher_role === 'main' ? '主讲教师' : '助教'}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>`
            }
          </div>

          <!-- 章节概览 -->
          <div class="card" style="padding:20px;margin-top:16px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0 0 16px;">章节概览</h3>
            ${chapters.length === 0
              ? '<div class="empty-hint" style="padding:20px 0;">暂无章节</div>'
              : `<div style="display:flex;flex-direction:column;gap:8px;">
                  ${chapters.map((ch, idx) => `
                    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                      <span style="width:24px;height:24px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;flex-shrink:0;">${idx + 1}</span>
                      <span style="font-weight:500;color:var(--stu-dark);flex:1;">${escapeHtml(ch.chapter_name)}</span>
                      <span style="font-size:0.8rem;color:var(--text-muted);">${ch.knowledge_point_count || 0} 个知识点</span>
                    </div>
                  `).join('')}
                </div>`
            }
          </div>
        </div>
      </div>

      <!-- 新建/编辑教学班级弹窗 -->
      <div class="modal-overlay" id="class-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
        <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 id="class-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建教学班级</h3>
          <form id="class-form">
            <div class="form-group" style="margin-bottom:14px;"><label>课程开设</label><select id="form-class-offering"><option value="">暂不绑定</option>${offerings.map(item => `<option value="${item.course_offering_id}">${escapeHtml(item.semester_name)}</option>`).join('')}</select></div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>班级名称 <span class="required">*</span></label>
              <input type="text" id="form-class-name" required placeholder="例如：2024级计算机科学1班">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;"><div class="form-group"><label>教学班编码</label><input id="form-class-code" placeholder="例如：ML-2026-01"></div><div class="form-group"><label>容量</label><input id="form-class-capacity" type="number" min="1"></div><div class="form-group"><label>上课时间</label><input id="form-class-schedule" placeholder="周二 1-2 节"></div><div class="form-group"><label>上课地点</label><input id="form-class-location" placeholder="博学楼 A201"></div></div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>学期</label>
              <input type="text" id="form-class-semester" placeholder="例如：2024-2025学年第一学期">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>班级描述</label>
              <textarea id="form-class-desc" class="auto-resize-ta" rows="2" placeholder="可选描述..."></textarea>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
              <button type="button" class="btn" id="btn-class-modal-cancel" style="border:1px solid var(--border);">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        </div>
      </div>

      <div class="modal-overlay" id="offering-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;"><div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;"><h3>创建课程开设</h3><form id="offering-form"><div class="form-group" style="margin-bottom:14px;"><label>学期 <span class="required">*</span></label><select id="offering-semester" required><option value="">请选择学期</option>${semesters.map(item => `<option value="${item.semester_id}">${escapeHtml(item.name)}</option>`).join('')}</select></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;"><div class="form-group"><label>开始日期</label><input id="offering-start" type="date"></div><div class="form-group"><label>结束日期</label><input id="offering-end" type="date"></div></div><div class="form-group" style="margin-top:14px;"><label>教学进度</label><textarea id="offering-progress" rows="3" placeholder="可填写进度说明或 JSON 结构"></textarea></div><footer style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;"><button type="button" class="btn" id="offering-cancel">取消</button><button class="btn btn-primary" type="submit">创建</button></footer></form></div></div>

      <!-- 编辑课程弹窗 -->
      <div class="modal-overlay" id="course-edit-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
        <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 style="margin-bottom:20px;font-size:1.2rem;">编辑课程</h3>
          <form id="course-edit-form">
            <div class="form-group" style="margin-bottom:14px;">
              <label>课程名称 <span class="required">*</span></label>
              <input type="text" id="edit-course-name" required value="${escapeHtml(course.course_name)}">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>课程编码 <span class="required">*</span></label>
              <input type="text" id="edit-course-code" required value="${escapeHtml(course.course_code)}">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>学科分类</label>
              <input type="text" id="edit-subject-category" value="${escapeHtml(course.subject_category || '')}">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>课程描述</label>
              <textarea id="edit-description" class="auto-resize-ta" rows="3">${escapeHtml(course.description || '')}</textarea>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
              <button type="button" class="btn" id="btn-edit-modal-cancel" style="border:1px solid var(--border);">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        </div>
      </div>

      <!-- 新建章节弹窗 -->
      <div class="modal-overlay" id="chapter-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
        <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 id="chapter-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建章节</h3>
          <form id="chapter-form">
            <div class="form-group" style="margin-bottom:14px;">
              <label>章节名称 <span class="required">*</span></label>
              <input type="text" id="form-chapter-name" required placeholder="例如：第一章 基础知识">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>章节序号</label>
              <input type="number" id="form-chapter-order" min="0" placeholder="例如：1">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>章节描述</label>
              <textarea id="form-chapter-desc" class="auto-resize-ta" rows="2" placeholder="可选描述..."></textarea>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
              <button type="button" class="btn" id="btn-chapter-modal-cancel" style="border:1px solid var(--border);">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        </div>
      </div>

      <!-- 新建知识点弹窗 -->
      <div class="modal-overlay" id="kp-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
        <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 id="kp-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建知识点</h3>
          <form id="kp-form">
            <div class="form-group" style="margin-bottom:14px;">
              <label>知识点名称 <span class="required">*</span></label>
              <input type="text" id="form-kp-name" required placeholder="例如：线性回归">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>知识点编码 <span class="required">*</span></label>
              <input type="text" id="form-kp-code" required placeholder="例如：LR001">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>难度等级</label>
              <select id="form-kp-difficulty" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
                <option value="basic">基础</option>
                <option value="medium" selected>中等</option>
                <option value="hard">较难</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>描述</label>
              <textarea id="form-kp-desc" class="auto-resize-ta" rows="2" placeholder="可选描述..."></textarea>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
              <button type="button" class="btn" id="btn-kp-modal-cancel" style="border:1px solid var(--border);">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        </div>
      </div>

      <!-- 学生列表弹窗 -->
      <div class="modal-overlay" id="students-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
        <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:560px;max-width:90vw;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 id="students-modal-title" style="margin-bottom:16px;font-size:1.2rem;">班级学生</h3>
          <div id="students-modal-body">
            <div class="loading-state"><p class="loading-text">正在加载学生列表...</p></div>
          </div>
          <div style="margin-top:16px;text-align:right;">
            <button type="button" class="btn" id="btn-students-modal-close" style="border:1px solid var(--border);">关闭</button>
          </div>
        </div>
      </div>
    `

    app.innerHTML = ''
    renderDashboardLayout(app, {
      title: '课程详情',
      menuItems: TEACHER_MENU_ITEMS,
      contentHTML,
      user,
    })

    // ---- 绑定事件 ----
    bindTabEvents()
    mountCourseFilesPanel({ user, course, classes })
    bindClassEvents()
    bindOfferingEvents()
    bindChapterEvents()
    bindCourseEditEvents()
  }

  renderFullPage()
  initAllAutoResize()

  // ========================
  // 工具函数
  // ========================

  function renderError(message) {
    app.innerHTML = ''
    renderDashboardLayout(app, {
      title: '课程详情',
      menuItems: TEACHER_MENU_ITEMS,
      contentHTML: `
        <div class="dashboard-content">
          <div class="error-state">
            <div class="error-icon"></div>
            <div class="error-message">${escapeHtml(message)}</div>
            <button class="btn-retry" onclick="window.location.reload()">重新加载</button>
          </div>
        </div>
      `,
      user,
    })
  }

  function renderClassesList(classList) {
    if (!classList || classList.length === 0) {
      return '<div class="empty-hint" style="padding:40px 0;">暂无教学班级，点击上方"新建班级"开始创建</div>'
    }

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
        ${classList.map(tc => `
          <div class="card" style="padding:18px;border-left:4px solid var(--stu-primary);">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
              <h4 style="font-size:1rem;font-weight:600;color:var(--stu-dark);margin:0;">${escapeHtml(tc.teaching_class_name)}</h4>
            </div>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">
              <div>学期：${escapeHtml(tc.semester || '-')}</div>
              ${tc.description ? `<div style="margin-top:4px;color:var(--text-muted);">${escapeHtml(tc.description)}</div>` : ''}
            </div>
            <div style="display:flex;gap:16px;font-size:0.8rem;color:var(--text-muted);padding-top:10px;border-top:1px solid var(--border);margin-bottom:12px;">
              <span>${tc.student_count || 0} 名学生</span>
              <span>${formatDate(tc.created_at, 'date')}</span>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn-view-students" data-class-id="${tc.teaching_class_id}" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;font-size:0.85rem;">查看学生</button>
              <button class="btn-delete-class" data-class-id="${tc.teaching_class_id}" style="flex:1;padding:6px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.85rem;">删除</button>
            </div>
          </div>
        `).join('')}
      </div>
    `
  }

  function renderChapterItem(ch, idx) {
    return `
      <div class="card chapter-card" data-chapter-id="${ch.chapter_id}" style="margin-bottom:12px;padding:0;overflow:hidden;">
        <div class="chapter-header" style="display:flex;align-items:center;gap:10px;padding:14px 18px;cursor:pointer;background:var(--bg);border-bottom:1px solid var(--border);transition:background 0.15s;">
          <span class="chapter-expand-icon" style="font-size:0.75rem;color:var(--text-muted);transition:transform 0.2s;">▶</span>
          <span style="width:24px;height:24px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;flex-shrink:0;">${idx + 1}</span>
          <span style="font-weight:600;color:var(--stu-dark);flex:1;">${escapeHtml(ch.chapter_name)}</span>
          <span style="font-size:0.8rem;color:var(--text-muted);">${ch.knowledge_point_count || 0} 个知识点</span>
          <button class="btn-add-kp" data-chapter-id="${ch.chapter_id}" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:0.8rem;">＋知识点</button>
          <button class="btn-delete-chapter" data-chapter-id="${ch.chapter_id}" style="padding:4px 10px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;">删除</button>
        </div>
        <div class="chapter-kps" style="display:none;padding:0 18px 14px;">
          <div class="kp-loading" style="padding:16px 0;text-align:center;color:var(--text-muted);font-size:0.85rem;">加载知识点...</div>
        </div>
      </div>
    `
  }

  function renderKnowledgePointsList(kps, chapterId) {
    if (!kps || kps.length === 0) {
      return `<div style="padding:12px 0;font-size:0.85rem;color:var(--text-muted);">暂无知识点，点击"+知识点"添加</div>`
    }

    return `
      <div style="padding:10px 0;display:flex;flex-direction:column;gap:8px;">
        ${kps.map(kp => `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#fff;border-radius:8px;border:1px solid var(--border);">
            <span style="width:8px;height:8px;border-radius:50%;background:${kp.difficulty_level === 'hard' ? '#ef4444' : kp.difficulty_level === 'medium' ? '#f59e0b' : '#10b981'};flex-shrink:0;"></span>
            <span style="font-weight:500;color:var(--stu-dark);flex:1;font-size:0.9rem;">${escapeHtml(kp.knowledge_point_name)}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(kp.knowledge_point_code)}</span>
            <span style="font-size:0.75rem;padding:2px 6px;border-radius:6px;background:${kp.difficulty_level === 'hard' ? '#fef2f2' : kp.difficulty_level === 'medium' ? '#fffbeb' : '#f0fdf4'};color:${kp.difficulty_level === 'hard' ? '#dc2626' : kp.difficulty_level === 'medium' ? '#d97706' : '#059669'};">
              ${kp.difficulty_level === 'hard' ? '较难' : kp.difficulty_level === 'medium' ? '中等' : '基础'}
            </span>
            <span style="font-size:0.8rem;color:var(--text-muted);">${kp.question_count || 0} 题</span>
            <button class="btn-delete-kp" data-kp-id="${kp.knowledge_point_id}" data-chapter-id="${chapterId}" style="padding:2px 8px;border:none;background:none;color:#dc2626;cursor:pointer;font-size:0.85rem;" title="删除知识点"></button>
          </div>
        `).join('')}
      </div>
    `
  }

  // ========================
  // Tab 切换
  // ========================

  function bindTabEvents() {
    const tabs = document.querySelectorAll('.tab-btn')
    const contents = {
      classes: document.getElementById('tab-classes'),
      files: document.getElementById('tab-files'),
      chapters: document.getElementById('tab-chapters'),
      info: document.getElementById('tab-info'),
    }

    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab
        tabs.forEach(t => {
          t.classList.remove('active')
          t.style.color = 'var(--text-secondary)'
          t.style.borderBottomColor = 'transparent'
        })
        btn.classList.add('active')
        btn.style.color = 'var(--stu-primary)'
        btn.style.borderBottomColor = 'var(--stu-primary)'

        Object.keys(contents).forEach(key => {
          contents[key].style.display = key === tab ? 'block' : 'none'
        })
      })
    })

    const requested = new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab')
    const initial = contents[requested] ? requested : 'classes'
    tabs.forEach((button) => {
      const active = button.dataset.tab === initial
      button.classList.toggle('active', active)
      button.style.color = active ? 'var(--stu-primary)' : 'var(--text-secondary)'
      button.style.borderBottomColor = active ? 'var(--stu-primary)' : 'transparent'
    })
    Object.entries(contents).forEach(([key, content]) => { if (content) content.style.display = key === initial ? 'block' : 'none' })
  }

  // ========================
  // 教学班级相关事件
  // ========================

  function bindClassEvents() {
    // 创建班级弹窗
    document.getElementById('btn-create-class')?.addEventListener('click', () => {
      openClassModal(null)
    })

    document.getElementById('btn-class-modal-cancel')?.addEventListener('click', closeClassModal)
    document.getElementById('class-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeClassModal()
    })

    // 提交班级表单
    document.getElementById('class-form')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const name = document.getElementById('form-class-name').value.trim()
      const semester = document.getElementById('form-class-semester').value.trim()
      const description = document.getElementById('form-class-desc').value.trim()

      if (!name) {
        alert('班级名称为必填项')
        return
      }

      try {
        await createTeachingClass(courseId, {
          teaching_class_name: name,
          course_offering_id: Number(document.getElementById('form-class-offering').value) || undefined,
          semester: semester || undefined,
          code: document.getElementById('form-class-code').value.trim() || undefined,
          capacity: Number(document.getElementById('form-class-capacity').value) || undefined,
          schedule: document.getElementById('form-class-schedule').value.trim() || undefined,
          location: document.getElementById('form-class-location').value.trim() || undefined,
          description: description || undefined,
        })
        closeClassModal()
        await refreshClasses()
      } catch (err) {
        alert(err.message || '创建班级失败')
      }
    })

    // 查看学生
    document.querySelectorAll('.btn-view-students').forEach(btn => {
      btn.addEventListener('click', async () => {
        const classId = parseInt(btn.dataset.classId, 10)
        await openStudentsModal(classId)
      })
    })

    // 删除班级
    document.querySelectorAll('.btn-delete-class').forEach(btn => {
      btn.addEventListener('click', async () => {
        const classId = parseInt(btn.dataset.classId, 10)
        if (!confirm('确定删除该教学班级吗？此操作不可撤销。')) return
        try {
          await deleteTeachingClass(classId)
          await refreshClasses()
        } catch (err) {
          alert(err.message || '删除班级失败')
        }
      })
    })
  }

  function openClassModal() {
    const modal = document.getElementById('class-modal')
    modal.style.display = 'flex'
    document.getElementById('class-modal-title').textContent = '新建教学班级'
    document.getElementById('form-class-name').value = ''
    document.getElementById('form-class-offering').value = ''
    document.getElementById('form-class-semester').value = ''
    document.getElementById('form-class-code').value = ''
    document.getElementById('form-class-capacity').value = ''
    document.getElementById('form-class-schedule').value = ''
    document.getElementById('form-class-location').value = ''
    document.getElementById('form-class-desc').value = ''
  }

  function closeClassModal() {
    document.getElementById('class-modal').style.display = 'none'
  }

  function bindOfferingEvents() {
    const modal = document.getElementById('offering-modal')
    document.getElementById('btn-create-offering')?.addEventListener('click', () => { modal.style.display = 'flex' })
    document.getElementById('offering-cancel')?.addEventListener('click', () => { modal.style.display = 'none' })
    modal?.addEventListener('click', event => { if (event.target === modal) modal.style.display = 'none' })
    document.getElementById('offering-form')?.addEventListener('submit', async event => {
      event.preventDefault()
      const semesterId = Number(document.getElementById('offering-semester').value)
      if (!semesterId) { alert('请选择学期'); return }
      try {
        await createCourseOffering(courseId, { semester_id: semesterId, start_date: document.getElementById('offering-start').value || undefined, end_date: document.getElementById('offering-end').value || undefined, teaching_progress: document.getElementById('offering-progress').value.trim() || undefined })
        const response = await getCourseOfferings(courseId)
        offerings = response.data.list || []
        modal.style.display = 'none'
        renderFullPage()
      } catch (error) { alert(error.message || '创建课程开设失败') }
    })
  }

  async function refreshClasses() {
    const container = document.getElementById('classes-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const res = await getTeachingClasses(courseId)
      classes = res.data?.list || []
      container.innerHTML = renderClassesList(classes)
      // Re-bind events for new DOM
      bindClassEvents()
    } catch (err) {
      container.innerHTML = '<div class="error-state"><div class="error-message">加载失败</div></div>'
    }
  }

  async function openStudentsModal(classId) {
    const modal = document.getElementById('students-modal')
    const body = document.getElementById('students-modal-body')
    modal.style.display = 'flex'
    body.innerHTML = '<div class="loading-state"><p class="loading-text">正在加载学生列表...</p></div>'

    // Find class name
    const tc = classes.find(c => c.teaching_class_id === classId)
    document.getElementById('students-modal-title').textContent = `班级学生 — ${escapeHtml(tc ? tc.teaching_class_name : '')}`

    try {
      const res = await getClassStudents(classId)
      const students = res.data?.list || []
      if (students.length === 0) {
        body.innerHTML = '<div class="empty-hint" style="padding:30px 0;">该班级暂无学生</div>'
      } else {
        body.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${students.map(s => {
              const name = s.student_name || s.student?.profile?.real_name || s.student?.username || '未知'
              const uname = s.student?.username || ''
              const initial = name !== '未知' ? name[0] : '?'
              return `
              <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                <div style="width:34px;height:34px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:600;flex-shrink:0;">
                  ${initial}
                </div>
                <div style="flex:1;">
                  <div style="font-weight:600;color:var(--stu-dark);">${escapeHtml(name)}</div>
                  <div style="font-size:0.8rem;color:var(--text-muted);">${uname ? `用户名：${escapeHtml(uname)}` : '学号：' + (s.student_no || '-')}</div>
                </div>
              </div>`
            }).join('')}
          </div>
        `
      }
    } catch (err) {
      body.innerHTML = `<div class="error-state"><div class="error-message">${escapeHtml(err.message || '加载学生列表失败')}</div></div>`
    }
  }

  document.getElementById('btn-students-modal-close')?.addEventListener('click', () => {
    document.getElementById('students-modal').style.display = 'none'
  })

  document.getElementById('students-modal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      document.getElementById('students-modal').style.display = 'none'
    }
  })

  // ========================
  // 章节相关事件
  // ========================

  let currentKpChapterId = null

  function bindChapterEvents() {
    // 创建章节弹窗
    document.getElementById('btn-create-chapter')?.addEventListener('click', () => {
      openChapterModal()
    })

    document.getElementById('btn-chapter-modal-cancel')?.addEventListener('click', closeChapterModal)
    document.getElementById('chapter-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeChapterModal()
    })

    // 提交章节表单
    document.getElementById('chapter-form')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const chapterName = document.getElementById('form-chapter-name').value.trim()
      const chapterOrder = document.getElementById('form-chapter-order').value.trim()
      const description = document.getElementById('form-chapter-desc').value.trim()

      if (!chapterName) {
        alert('章节名称为必填项')
        return
      }

      try {
        await createChapter(courseId, {
          chapter_name: chapterName,
          chapter_order: chapterOrder ? parseInt(chapterOrder, 10) : undefined,
          description: description || undefined,
        })
        closeChapterModal()
        await refreshChapters()
      } catch (err) {
        alert(err.message || '创建章节失败')
      }
    })

    // 折叠/展开章节知识点
    document.querySelectorAll('.chapter-header').forEach(header => {
      header.addEventListener('click', async (e) => {
        if (e.target.closest('button')) return
        const card = header.closest('.chapter-card')
        const kpContainer = card.querySelector('.chapter-kps')
        const icon = header.querySelector('.chapter-expand-icon')
        const isHidden = kpContainer.style.display === 'none'

        if (isHidden) {
          kpContainer.style.display = 'block'
          icon.style.transform = 'rotate(90deg)'
          // Load KPs if not loaded
          if (kpContainer.dataset.loaded !== 'true') {
            const chapterId = parseInt(card.dataset.chapterId, 10)
            try {
              const res = await getKnowledgePoints(courseId, { chapter_id: chapterId })
              const kps = res.data?.list || []
              kpCache[chapterId] = kps
              kpContainer.innerHTML = renderKnowledgePointsList(kps, chapterId)
              kpContainer.dataset.loaded = 'true'
              bindKpEvents()
            } catch (err) {
              kpContainer.innerHTML = `<div style="padding:12px 0;color:#dc2626;font-size:0.85rem;">加载失败：${escapeHtml(err.message)}</div>`
            }
          }
        } else {
          kpContainer.style.display = 'none'
          icon.style.transform = 'rotate(0deg)'
        }
      })
    })

    // 添加知识点
    document.querySelectorAll('.btn-add-kp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        currentKpChapterId = parseInt(btn.dataset.chapterId, 10)
        openKpModal(currentKpChapterId)
      })
    })

    // 删除章节
    document.querySelectorAll('.btn-delete-chapter').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const chapterId = parseInt(btn.dataset.chapterId, 10)
        if (!confirm('确定删除该章节吗？相关的知识点也会被删除。')) return
        try {
          await deleteChapter(chapterId)
          await refreshChapters()
        } catch (err) {
          alert(err.message || '删除章节失败')
        }
      })
    })
  }

  function openChapterModal() {
    document.getElementById('chapter-modal').style.display = 'flex'
    document.getElementById('chapter-modal-title').textContent = '新建章节'
    document.getElementById('form-chapter-name').value = ''
    document.getElementById('form-chapter-order').value = ''
    document.getElementById('form-chapter-desc').value = ''
  }

  function closeChapterModal() {
    document.getElementById('chapter-modal').style.display = 'none'
  }

  async function refreshChapters() {
    const container = document.getElementById('chapters-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const res = await getChapters(courseId)
      chapters = res.data?.list || []
      kpCache = {}
      if (chapters.length === 0) {
        container.innerHTML = '<div class="empty-hint" style="padding:40px 0;">暂无章节，点击上方"新建章节"开始创建</div>'
      } else {
        container.innerHTML = chapters.map((ch, idx) => renderChapterItem(ch, idx)).join('')
        bindChapterEvents()
      }
    } catch (err) {
      container.innerHTML = '<div class="error-state"><div class="error-message">加载失败</div></div>'
    }
  }

  // ========================
  // 知识点相关事件
  // ========================

  function bindKpEvents() {
    // 删除知识点
    document.querySelectorAll('.btn-delete-kp').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const kpId = parseInt(btn.dataset.kpId, 10)
        const chapterId = parseInt(btn.dataset.chapterId, 10)
        if (!confirm('确定删除该知识点吗？')) return
        try {
          await deleteKnowledgePoint(kpId)
          // Refresh just this chapter's KPs
          delete kpCache[chapterId]
          const kpContainer = document.querySelector(`.chapter-card[data-chapter-id="${chapterId}"] .chapter-kps`)
          if (kpContainer) {
            kpContainer.dataset.loaded = 'false'
            kpContainer.innerHTML = '<div class="kp-loading" style="padding:16px 0;text-align:center;color:var(--text-muted);font-size:0.85rem;">加载知识点...</div>'
            const res = await getKnowledgePoints(courseId, { chapter_id: chapterId })
            const kps = res.data?.list || []
            kpCache[chapterId] = kps
            kpContainer.innerHTML = renderKnowledgePointsList(kps, chapterId)
            kpContainer.dataset.loaded = 'true'
            bindKpEvents()
          }
        } catch (err) {
          alert(err.message || '删除知识点失败')
        }
      })
    })
  }

  // 知识点弹窗
  function openKpModal(chapterId) {
    const modal = document.getElementById('kp-modal')
    modal.style.display = 'flex'
    document.getElementById('kp-modal-title').textContent = '新建知识点'
    document.getElementById('form-kp-name').value = ''
    document.getElementById('form-kp-code').value = ''
    document.getElementById('form-kp-difficulty').value = 'medium'
    document.getElementById('form-kp-desc').value = ''
  }

  function closeKpModal() {
    document.getElementById('kp-modal').style.display = 'none'
    currentKpChapterId = null
  }

  document.getElementById('btn-kp-modal-cancel')?.addEventListener('click', closeKpModal)
  document.getElementById('kp-modal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeKpModal()
  })

  document.getElementById('kp-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!currentKpChapterId) {
      alert('请先选择章节')
      return
    }
    const name = document.getElementById('form-kp-name').value.trim()
    const code = document.getElementById('form-kp-code').value.trim()
    const difficulty = document.getElementById('form-kp-difficulty').value
    const desc = document.getElementById('form-kp-desc').value.trim()

    if (!name || !code) {
      alert('知识点名称和编码为必填项')
      return
    }

    try {
      await createKnowledgePoint(currentKpChapterId, {
        knowledge_point_name: name,
        knowledge_point_code: code,
        difficulty_level: difficulty,
        description: desc || undefined,
      })
      closeKpModal()
      // Refresh the chapter's KPs
      delete kpCache[currentKpChapterId]
      const kpContainer = document.querySelector(`.chapter-card[data-chapter-id="${currentKpChapterId}"] .chapter-kps`)
      if (kpContainer) {
        kpContainer.dataset.loaded = 'false'
        kpContainer.innerHTML = '<div class="kp-loading" style="padding:16px 0;text-align:center;color:var(--text-muted);font-size:0.85rem;">加载知识点...</div>'
        const res = await getKnowledgePoints(courseId, { chapter_id: currentKpChapterId })
        const kps = res.data?.list || []
        kpCache[currentKpChapterId] = kps
        kpContainer.innerHTML = renderKnowledgePointsList(kps, currentKpChapterId)
        kpContainer.dataset.loaded = 'true'
        bindKpEvents()
      }
    } catch (err) {
      alert(err.message || '创建知识点失败')
    }
  })

  // ========================
  // 编辑课程事件
  // ========================

  function bindCourseEditEvents() {
    document.getElementById('btn-edit-course-info')?.addEventListener('click', () => {
      openCourseEditModal()
    })

    document.getElementById('btn-edit-modal-cancel')?.addEventListener('click', closeCourseEditModal)
    document.getElementById('course-edit-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeCourseEditModal()
    })

    document.getElementById('course-edit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const data = {
        course_name: document.getElementById('edit-course-name').value.trim(),
        course_code: document.getElementById('edit-course-code').value.trim(),
        subject_category: document.getElementById('edit-subject-category').value.trim() || '计算机大类学科',
        description: document.getElementById('edit-description').value.trim(),
      }

      if (!data.course_name || !data.course_code) {
        alert('课程名称和编码为必填项')
        return
      }

      try {
        await updateTeacherCourse(courseId, data)
        closeCourseEditModal()
        // Update local course data and re-render full page
        Object.assign(course, data)
        renderFullPage()
        initAllAutoResize()
      } catch (err) {
        alert(err.message || '更新课程失败')
      }
    })
  }

  function openCourseEditModal() {
    document.getElementById('course-edit-modal').style.display = 'flex'
  }

  function closeCourseEditModal() {
    document.getElementById('course-edit-modal').style.display = 'none'
  }
}


