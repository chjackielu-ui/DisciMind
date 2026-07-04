// 管理端 — 课程详情页
// 支持四个标签页：章节管理 | 知识点管理 | 教学班级 | 授课教师

import { getMe } from '../api/auth.js'
import {
  getAdminCourseDetail, updateAdminCourse, bindCourseTeacher, unbindCourseTeacher,
  getCourseChapters, createChapter, updateChapter, deleteChapter,
  getCourseKnowledgePoints, createKnowledgePoint, updateKnowledgePoint, deleteKnowledgePoint,
  getTeachingClasses, createTeachingClass, updateTeachingClass, deleteTeachingClass,
  getAdminUsers,
} from '../api/admin.js'
import { getUser, setAuth, clearAuth, getUserDisplayName } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { escapeHtml, formatDate } from '../utils/format.js'
import { initAllAutoResize } from '../utils/auto-resize.js'

// ========================
// 常量映射
// ========================

const ROLE_LABEL = {
  main_teacher: '主讲教师',
  assistant: '助教',
  manager: '管理教师',
}

const DIFFICULTY_LABEL = {
  basic: '基础',
  medium: '中等',
  hard: '较难',
}

const DIFFICULTY_STYLE = {
  basic: 'background:#f0fdf4;color:#059669;',
  medium: 'background:#fffbeb;color:#d97706;',
  hard: 'background:#fef2f2;color:#dc2626;',
}

const STATUS_LABEL = {
  active: '进行中',
  archived: '已归档',
}

// ========================
// 主渲染函数
// ========================

export async function renderAdminCourseDetail(app, params) {
  const courseId = params && parseInt(params.course_id, 10)
  if (!courseId) {
    window.location.hash = '#/admin/courses'
    return
  }

  let user = getUser()

  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? localStorage.getItem('token') : '', user)
  } catch {
    if (!user) {
      clearAuth()
      window.location.hash = '#/login'
      return
    }
  }

  const displayName = getUserDisplayName()
  const menuItems = [
    { label: '首页', icon: 'home', hash: '#/admin/dashboard' },
    { label: '用户管理', icon: 'user', hash: '#/admin/users' },
    { label: '课程管理', icon: 'book', hash: '#/admin/courses' },
    { label: '班级管理', icon: 'star', hash: '#/admin/classes' },
    { label: '知识库管理', icon: 'book', hash: '#/admin/knowledge' },
    { label: '操作日志', icon: 'alert', hash: '#/admin/logs' },
    { label: '通知管理', icon: 'message', hash: '#/admin/notifications' },
    { label: 'AI 配置', icon: 'message', hash: '#/admin/ai-config' },
  ]

  // ---- 初始骨架 ----
  renderDashboardLayout(app, {
    title: '课程详情',
    menuItems,
    contentHTML: `
      <div class="dashboard-content">
        <div style="margin-bottom:20px;">
          <button class="btn-back" onclick="window.location.hash='#/admin/courses'">
            ← 返回课程列表
          </button>
        </div>
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p class="loading-text">正在加载课程详情...</p>
        </div>
      </div>
    `,
    user,
  })

  // ---- 加载课程信息 ----
  let course = null
  let chapters = []
  let allKnowledgePoints = []
  let teachingClasses = []
  let teacherUsers = []

  try {
    const res = await getAdminCourseDetail(courseId)
    course = res.data
  } catch (err) {
    renderError(err.message || '课程详情加载失败')
    return
  }

  if (!course) {
    renderError('课程不存在')
    return
  }

  // ---- 加载附加数据 ----
  try {
    const [chapterRes, kpRes, classRes, teacherUserRes] = await Promise.all([
      getCourseChapters(courseId),
      getCourseKnowledgePoints(courseId),
      getTeachingClasses(courseId),
      getAdminUsers({ role: 'teacher', page_size: 100 }).catch(() => ({ data: { list: [] } })),
    ])
    chapters = chapterRes.data?.list || []
    allKnowledgePoints = kpRes.data?.list || []
    teachingClasses = classRes.data?.list || []
    teacherUsers = teacherUserRes.data?.list || []
  } catch (err) {
    console.warn('[admin-course-detail] 加载附加数据失败:', err.message)
  }

  // ---- 筛选已绑定教师的用户 ID 集合 ----
  const boundTeacherUserIds = new Set(
    (course.teachers || []).map(t => t.teacher_user_id || t.user_id).filter(Boolean)
  )

  // ---- 渲染完整页面 ----
  function renderFullPage() {
    const teachers = course.teachers || []

    // 课程编辑弹窗内嵌在 contentHTML 中
    const contentHTML = `
      <div class="dashboard-content">
        <!-- 返回按钮 -->
        <div style="margin-bottom:20px;">
          <button class="btn-back" onclick="window.location.hash='#/admin/courses'">
            ← 返回课程列表
          </button>
        </div>

        <!-- 课程信息头部 -->
        <div class="card" style="margin-bottom:20px;padding:20px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div style="flex:1;min-width:0;">
              <h2 style="font-size:1.3rem;font-weight:700;color:var(--stu-dark);margin:0 0 6px;">
                ${escapeHtml(course.course_name)}
              </h2>
              <div style="color:var(--text-secondary);font-size:0.85rem;">
                <span>编码：${escapeHtml(course.course_code)}</span>
                <span style="margin:0 10px;">|</span>
                <span>状态：
                  <span style="background:${course.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${course.status === 'active' ? '#065f46' : '#92400e'};padding:2px 8px;border-radius:10px;font-size:0.75rem;">
                    ${STATUS_LABEL[course.status] || course.status || '未知'}
                  </span>
                </span>
              </div>
              ${course.description ? `<div style="color:var(--text-muted);font-size:0.85rem;margin-top:6px;">${escapeHtml(course.description)}</div>` : ''}
            </div>
            <div style="display:flex;gap:10px;flex-shrink:0;">
              <button class="btn btn-primary" id="btn-edit-course-info" style="font-size:0.85rem;padding:6px 14px;">编辑课程</button>
            </div>
          </div>
          <div style="display:flex;gap:20px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:0.85rem;color:var(--text-muted);flex-wrap:wrap;">
            <span>📚 ${chapters.length} 个章节</span>
            <span>🎯 ${allKnowledgePoints.length} 个知识点</span>
            <span>🏫 ${teachingClasses.length} 个教学班级</span>
            <span>👨‍🏫 ${teachers.length} 位教师</span>
          </div>
        </div>

        <!-- 标签页导航 -->
        <div class="tabs-nav" style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px;">
          <button class="tab-btn active" data-tab="chapters" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
            📖 章节管理
          </button>
          <button class="tab-btn" data-tab="knowledge" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
            🎯 知识点管理
          </button>
          <button class="tab-btn" data-tab="classes" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
            🏫 教学班级
          </button>
          <button class="tab-btn" data-tab="teachers" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">
            👨‍🏫 授课教师
          </button>
        </div>

        <!-- ====== 章节管理 Tab ====== -->
        <div class="tab-content" id="tab-chapters" style="display:block;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">章节列表（${chapters.length}）</h3>
            <button class="btn btn-primary" id="btn-create-chapter" style="font-size:0.85rem;padding:6px 14px;">＋ 新建章节</button>
          </div>
          <div id="chapters-list-container">
            ${renderChapterList(chapters)}
          </div>
        </div>

        <!-- ====== 知识点管理 Tab ====== -->
        <div class="tab-content" id="tab-knowledge" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">知识点（${allKnowledgePoints.length}）</h3>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <select id="kp-chapter-filter" style="padding:6px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;">
                <option value="">全部章节</option>
                ${chapters.map(ch => `<option value="${ch.chapter_id}">${escapeHtml(ch.chapter_name)}</option>`).join('')}
              </select>
              <button class="btn btn-primary" id="btn-create-kp" style="font-size:0.85rem;padding:6px 14px;">＋ 新建知识点</button>
            </div>
          </div>
          <div id="kp-list-container">
            ${renderKnowledgePointList(allKnowledgePoints)}
          </div>
        </div>

        <!-- ====== 教学班级 Tab ====== -->
        <div class="tab-content" id="tab-classes" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">教学班级（${teachingClasses.length}）</h3>
            <button class="btn btn-primary" id="btn-create-class" style="font-size:0.85rem;padding:6px 14px;">＋ 新建班级</button>
          </div>
          <div id="classes-list-container">
            ${renderClassList(teachingClasses)}
          </div>
        </div>

        <!-- ====== 授课教师 Tab ====== -->
        <div class="tab-content" id="tab-teachers" style="display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">授课教师（${teachers.length}）</h3>
            <button class="btn btn-primary" id="btn-add-teacher" style="font-size:0.85rem;padding:6px 14px;">＋ 添加教师</button>
          </div>
          <div id="teachers-list-container">
            ${renderTeacherList(teachers)}
          </div>
        </div>
      </div>

      <!-- ====== 编辑课程弹窗 ====== -->
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

      <!-- ====== 章节弹窗（新建/编辑） ====== -->
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
              <input type="number" id="form-chapter-order" min="0" step="1" placeholder="例如：1">
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

      <!-- ====== 知识点弹窗（新建/编辑） ====== -->
      <div class="modal-overlay" id="kp-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
        <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 id="kp-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建知识点</h3>
          <form id="kp-form">
            <div class="form-group" style="margin-bottom:14px;">
              <label>所属章节 <span class="required">*</span></label>
              <select id="form-kp-chapter" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
                <option value="">请选择章节</option>
                ${chapters.map(ch => `<option value="${ch.chapter_id}">${escapeHtml(ch.chapter_name)}</option>`).join('')}
              </select>
            </div>
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
            <div class="form-group" style="margin-bottom:14px;">
              <label>别名（逗号分隔）</label>
              <input type="text" id="form-kp-aliases" placeholder="例如：线性回归模型, LR">
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
              <button type="button" class="btn" id="btn-kp-modal-cancel" style="border:1px solid var(--border);">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </form>
        </div>
      </div>

      <!-- ====== 教学班级弹窗（新建/编辑） ====== -->
      <div class="modal-overlay" id="class-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
        <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 id="class-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建教学班级</h3>
          <form id="class-form">
            <div class="form-group" style="margin-bottom:14px;">
              <label>班级名称 <span class="required">*</span></label>
              <input type="text" id="form-class-name" required placeholder="例如：2024级计算机科学1班">
            </div>
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

      <!-- ====== 添加教师弹窗 ====== -->
      <div class="modal-overlay" id="teacher-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
        <div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 style="margin-bottom:20px;font-size:1.2rem;">添加授课教师</h3>
          <form id="teacher-form">
            <div class="form-group" style="margin-bottom:14px;">
              <label>选择教师 <span class="required">*</span></label>
              <select id="form-teacher-user" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
                <option value="">请选择教师</option>
                ${teacherUsers
                  .filter(tu => !boundTeacherUserIds.has(tu.user_id))
                  .map(tu => `<option value="${tu.user_id}">${escapeHtml(tu.profile?.real_name || tu.username)}（${escapeHtml(tu.username)}）</option>`)
                  .join('')}
              </select>
              ${teacherUsers.filter(tu => !boundTeacherUserIds.has(tu.user_id)).length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem;margin-top:6px;">暂无可选教师（所有教师已添加）</p>' : ''}
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label>教师角色 <span class="required">*</span></label>
              <select id="form-teacher-role" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
                <option value="main_teacher">主讲教师</option>
                <option value="assistant">助教</option>
                <option value="manager">管理教师</option>
              </select>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
              <button type="button" class="btn" id="btn-teacher-modal-cancel" style="border:1px solid var(--border);">取消</button>
              <button type="submit" class="btn btn-primary">添加</button>
            </div>
          </form>
        </div>
      </div>
    `

    app.innerHTML = ''
    renderDashboardLayout(app, {
      title: '课程详情',
      menuItems,
      contentHTML,
      user,
    })

    // ---- 绑定事件 ----
    bindTabEvents()
    bindCourseEditEvents()
    bindChapterEvents()
    bindKnowledgePointEvents()
    bindTeachingClassEvents()
    bindTeacherEvents()
  }

  renderFullPage()
  initAllAutoResize()

  // ========================
  // 渲染辅助函数
  // ========================

  function renderError(message) {
    app.innerHTML = ''
    renderDashboardLayout(app, {
      title: '课程详情',
      menuItems,
      contentHTML: `
        <div class="dashboard-content">
          <div style="margin-bottom:20px;">
            <button class="btn-back" onclick="window.location.hash='#/admin/courses'">← 返回课程列表</button>
          </div>
          <div class="error-state">
            <div class="error-icon">⚠️</div>
            <div class="error-message">${escapeHtml(message)}</div>
            <button class="btn-retry" onclick="window.location.reload()">重新加载</button>
          </div>
        </div>
      `,
      user,
    })
  }

  function renderChapterList(list) {
    if (!list || list.length === 0) {
      return '<div class="empty-hint" style="padding:40px 0;">暂无章节，点击上方"新建章节"开始创建</div>'
    }
    const sorted = [...list].sort((a, b) => (a.chapter_order || 999) - (b.chapter_order || 999))
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${sorted.map((ch, idx) => `
          <div class="card" style="padding:16px 18px;border-left:4px solid var(--stu-primary);">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="width:26px;height:26px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;flex-shrink:0;">${idx + 1}</span>
                  <span style="font-weight:600;color:var(--stu-dark);font-size:1rem;">${escapeHtml(ch.chapter_name)}</span>
                  ${ch.chapter_order != null ? `<span style="font-size:0.8rem;color:var(--text-muted);">（排序：${ch.chapter_order}）</span>` : ''}
                </div>
                ${ch.description ? `<div style="margin-top:6px;margin-left:36px;color:var(--text-muted);font-size:0.85rem;">${escapeHtml(ch.description)}</div>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:14px;flex-shrink:0;">
                <span style="font-size:0.85rem;color:var(--text-muted);">${ch.knowledge_point_count != null ? ch.knowledge_point_count : allKnowledgePoints.filter(kp => kp.chapter_id === ch.chapter_id).length} 个知识点</span>
                <button class="btn-edit-chapter" data-chapter-id="${ch.chapter_id}" style="padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;font-size:0.8rem;">编辑</button>
                <button class="btn-delete-chapter" data-chapter-id="${ch.chapter_id}" style="padding:4px 12px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;">删除</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `
  }

  function renderKnowledgePointList(kps) {
    if (!kps || kps.length === 0) {
      return '<div class="empty-hint" style="padding:40px 0;">暂无知识点，点击上方"新建知识点"开始创建</div>'
    }
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px;">
        ${kps.map(kp => {
          const diffStyle = DIFFICULTY_STYLE[kp.difficulty_level] || 'background:#f3f4f6;color:#6b7280;'
          const chapter = chapters.find(ch => ch.chapter_id === kp.chapter_id)
          return `
            <div class="card" style="padding:16px;">
              <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
                <h4 style="font-size:0.95rem;font-weight:600;color:var(--stu-dark);margin:0;flex:1;">${escapeHtml(kp.knowledge_point_name)}</h4>
                <span style="font-size:0.75rem;padding:2px 8px;border-radius:6px;${diffStyle}flex-shrink:0;">${DIFFICULTY_LABEL[kp.difficulty_level] || kp.difficulty_level || '未知'}</span>
              </div>
              <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">
                <span>编码：${escapeHtml(kp.knowledge_point_code)}</span>
                ${chapter ? `<span style="margin-left:12px;">章节：${escapeHtml(chapter.chapter_name)}</span>` : ''}
              </div>
              ${kp.aliases ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">别名：${escapeHtml(kp.aliases)}</div>` : ''}
              ${kp.description ? `<div style="font-size:0.8rem;color:var(--text-muted);">${escapeHtml(kp.description)}</div>` : ''}
              <div style="display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
                <button class="btn-edit-kp" data-kp-id="${kp.knowledge_point_id}" style="flex:1;padding:5px;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;font-size:0.8rem;">编辑</button>
                <button class="btn-delete-kp" data-kp-id="${kp.knowledge_point_id}" style="flex:1;padding:5px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;">删除</button>
              </div>
            </div>
          `
        }).join('')}
      </div>
    `
  }

  function renderClassList(list) {
    if (!list || list.length === 0) {
      return '<div class="empty-hint" style="padding:40px 0;">暂无教学班级，点击上方"新建班级"开始创建</div>'
    }
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
        ${list.map(tc => `
          <div class="card" style="padding:18px;border-left:4px solid var(--stu-primary);">
            <h4 style="font-size:1rem;font-weight:600;color:var(--stu-dark);margin:0 0 8px;">${escapeHtml(tc.teaching_class_name)}</h4>
            <div style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">
              <div>学期：${escapeHtml(tc.semester || '-')}</div>
              ${tc.description ? `<div style="margin-top:4px;color:var(--text-muted);">${escapeHtml(tc.description)}</div>` : ''}
            </div>
            <div style="display:flex;gap:16px;font-size:0.8rem;color:var(--text-muted);padding-top:10px;border-top:1px solid var(--border);margin-bottom:12px;">
              <span>👨‍🎓 ${tc.student_count || 0} 名学生</span>
              <span>📅 ${formatDate(tc.created_at, 'date')}</span>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn-edit-class" data-class-id="${tc.teaching_class_id}" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;font-size:0.85rem;">编辑</button>
              <button class="btn-delete-class" data-class-id="${tc.teaching_class_id}" style="flex:1;padding:6px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.85rem;">删除</button>
            </div>
          </div>
        `).join('')}
      </div>
    `
  }

  function renderTeacherList(list) {
    if (!list || list.length === 0) {
      return '<div class="empty-hint" style="padding:40px 0;">暂无授课教师，点击上方"添加教师"开始添加</div>'
    }
    return `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${list.map(t => `
          <div class="card" style="padding:14px 18px;display:flex;align-items:center;gap:14px;">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:600;flex-shrink:0;">
              ${(t.real_name || t.username || '?')[0]}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;color:var(--stu-dark);">${escapeHtml(t.real_name || t.username || '未知')}</div>
              <div style="font-size:0.8rem;color:var(--text-muted);">${t.username ? `用户名：${escapeHtml(t.username)}` : ''}</div>
            </div>
            <span style="font-size:0.85rem;padding:3px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--border);flex-shrink:0;">
              ${ROLE_LABEL[t.teacher_role] || t.teacher_role || '未知'}
            </span>
            <button class="btn-remove-teacher" data-teacher-user-id="${t.teacher_user_id || t.user_id}" style="padding:5px 12px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;flex-shrink:0;">移除</button>
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
      chapters: document.getElementById('tab-chapters'),
      knowledge: document.getElementById('tab-knowledge'),
      classes: document.getElementById('tab-classes'),
      teachers: document.getElementById('tab-teachers'),
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
          if (contents[key]) {
            contents[key].style.display = key === tab ? 'block' : 'none'
          }
        })
      })
    })

    // Activate first tab
    if (tabs.length > 0) {
      tabs[0].style.color = 'var(--stu-primary)'
      tabs[0].style.borderBottomColor = 'var(--stu-primary)'
    }
  }

  // ========================
  // 课程编辑事件
  // ========================

  function bindCourseEditEvents() {
    document.getElementById('btn-edit-course-info')?.addEventListener('click', () => {
      document.getElementById('course-edit-modal').style.display = 'flex'
    })
    document.getElementById('btn-edit-modal-cancel')?.addEventListener('click', () => {
      document.getElementById('course-edit-modal').style.display = 'none'
    })
    document.getElementById('course-edit-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        document.getElementById('course-edit-modal').style.display = 'none'
      }
    })
    document.getElementById('course-edit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const data = {
        course_name: document.getElementById('edit-course-name').value.trim(),
        course_code: document.getElementById('edit-course-code').value.trim(),
        subject_category: document.getElementById('edit-subject-category').value.trim() || undefined,
        description: document.getElementById('edit-description').value.trim() || undefined,
      }
      if (!data.course_name || !data.course_code) {
        alert('课程名称和编码为必填项')
        return
      }
      try {
        await updateAdminCourse(courseId, data)
        document.getElementById('course-edit-modal').style.display = 'none'
        Object.assign(course, data)
        renderFullPage()
        initAllAutoResize()
      } catch (err) {
        alert(err.message || '更新课程失败')
      }
    })
  }

  // ========================
  // 章节管理事件
  // ========================

  let editingChapterId = null

  function bindChapterEvents() {
    document.getElementById('btn-create-chapter')?.addEventListener('click', () => openChapterModal())
    document.getElementById('btn-chapter-modal-cancel')?.addEventListener('click', closeChapterModal)
    document.getElementById('chapter-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeChapterModal()
    })

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
        if (editingChapterId) {
          await updateChapter(editingChapterId, {
            chapter_name: chapterName,
            chapter_order: chapterOrder ? parseInt(chapterOrder, 10) : undefined,
            description: description || undefined,
          })
        } else {
          await createChapter(courseId, {
            chapter_name: chapterName,
            chapter_order: chapterOrder ? parseInt(chapterOrder, 10) : undefined,
            description: description || undefined,
          })
        }
        closeChapterModal()
        await refreshChapters()
      } catch (err) {
        alert(err.message || '保存章节失败')
      }
    })

    // Edit chapter buttons (delegated)
    document.querySelectorAll('.btn-edit-chapter').forEach(btn => {
      btn.addEventListener('click', () => {
        const chapterId = parseInt(btn.dataset.chapterId, 10)
        const chapter = chapters.find(ch => ch.chapter_id === chapterId)
        if (chapter) openChapterModal(chapter)
      })
    })

    // Delete chapter buttons (delegated)
    document.querySelectorAll('.btn-delete-chapter').forEach(btn => {
      btn.addEventListener('click', async () => {
        const chapterId = parseInt(btn.dataset.chapterId, 10)
        if (!confirm('确定删除该章节吗？关联的知识点也将被删除。')) return
        try {
          await deleteChapter(chapterId)
          await refreshChapters()
        } catch (err) {
          alert(err.message || '删除章节失败')
        }
      })
    })
  }

  function openChapterModal(chapter) {
    const modal = document.getElementById('chapter-modal')
    modal.style.display = 'flex'
    document.getElementById('chapter-modal-title').textContent = chapter ? '编辑章节' : '新建章节'
    document.getElementById('form-chapter-name').value = chapter?.chapter_name || ''
    document.getElementById('form-chapter-order').value = chapter?.chapter_order != null ? chapter.chapter_order : ''
    document.getElementById('form-chapter-desc').value = chapter?.description || ''
    editingChapterId = chapter?.chapter_id || null
  }

  function closeChapterModal() {
    document.getElementById('chapter-modal').style.display = 'none'
    editingChapterId = null
  }

  async function refreshChapters() {
    const container = document.getElementById('chapters-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint" style="padding:40px 0;">加载中...</div>'
    try {
      const res = await getCourseChapters(courseId)
      chapters = res.data?.list || []
      container.innerHTML = renderChapterList(chapters)
      bindChapterEvents()
    } catch (err) {
      container.innerHTML = '<div class="error-state"><div class="error-message">加载章节失败</div></div>'
    }
  }

  // ========================
  // 知识点管理事件
  // ========================

  let editingKpId = null

  function bindKnowledgePointEvents() {
    document.getElementById('btn-create-kp')?.addEventListener('click', () => openKpModal())
    document.getElementById('btn-kp-modal-cancel')?.addEventListener('click', closeKpModal)
    document.getElementById('kp-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeKpModal()
    })

    document.getElementById('kp-form')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const chapterId = document.getElementById('form-kp-chapter').value
      const name = document.getElementById('form-kp-name').value.trim()
      const code = document.getElementById('form-kp-code').value.trim()
      const difficulty = document.getElementById('form-kp-difficulty').value
      const desc = document.getElementById('form-kp-desc').value.trim()
      const aliases = document.getElementById('form-kp-aliases').value.trim()

      if (!chapterId) {
        alert('请选择所属章节')
        return
      }
      if (!name || !code) {
        alert('知识点名称和编码为必填项')
        return
      }

      const data = {
        course_id: courseId,
        chapter_id: parseInt(chapterId, 10),
        knowledge_point_name: name,
        knowledge_point_code: code,
        difficulty_level: difficulty,
        description: desc || undefined,
        aliases: aliases || undefined,
      }

      try {
        if (editingKpId) {
          await updateKnowledgePoint(editingKpId, data)
        } else {
          await createKnowledgePoint(data)
        }
        closeKpModal()
        await refreshKnowledgePoints()
      } catch (err) {
        alert(err.message || '保存知识点失败')
      }
    })

    // Chapter filter change
    document.getElementById('kp-chapter-filter')?.addEventListener('change', () => {
      applyKpFilter()
    })

    // Edit KP buttons
    document.querySelectorAll('.btn-edit-kp').forEach(btn => {
      btn.addEventListener('click', () => {
        const kpId = parseInt(btn.dataset.kpId, 10)
        const kp = allKnowledgePoints.find(k => k.knowledge_point_id === kpId)
        if (kp) openKpModal(kp)
      })
    })

    // Delete KP buttons
    document.querySelectorAll('.btn-delete-kp').forEach(btn => {
      btn.addEventListener('click', async () => {
        const kpId = parseInt(btn.dataset.kpId, 10)
        if (!confirm('确定删除该知识点吗？')) return
        try {
          await deleteKnowledgePoint(kpId)
          await refreshKnowledgePoints()
        } catch (err) {
          alert(err.message || '删除知识点失败')
        }
      })
    })
  }

  function openKpModal(kp) {
    const modal = document.getElementById('kp-modal')
    modal.style.display = 'flex'
    document.getElementById('kp-modal-title').textContent = kp ? '编辑知识点' : '新建知识点'
    document.getElementById('form-kp-chapter').value = kp?.chapter_id || ''
    document.getElementById('form-kp-name').value = kp?.knowledge_point_name || ''
    document.getElementById('form-kp-code').value = kp?.knowledge_point_code || ''
    document.getElementById('form-kp-difficulty').value = kp?.difficulty_level || 'medium'
    document.getElementById('form-kp-desc').value = kp?.description || ''
    document.getElementById('form-kp-aliases').value = kp?.aliases || ''
    editingKpId = kp?.knowledge_point_id || null
  }

  function closeKpModal() {
    document.getElementById('kp-modal').style.display = 'none'
    editingKpId = null
  }

  function applyKpFilter() {
    const filterChapterId = document.getElementById('kp-chapter-filter')?.value
    const filtered = filterChapterId
      ? allKnowledgePoints.filter(kp => String(kp.chapter_id) === filterChapterId)
      : allKnowledgePoints
    const container = document.getElementById('kp-list-container')
    if (container) {
      container.innerHTML = renderKnowledgePointList(filtered)
      bindKnowledgePointEvents()
    }
  }

  async function refreshKnowledgePoints() {
    const container = document.getElementById('kp-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint" style="padding:40px 0;">加载中...</div>'
    try {
      const res = await getCourseKnowledgePoints(courseId)
      allKnowledgePoints = res.data?.list || []
      applyKpFilter()
    } catch (err) {
      container.innerHTML = '<div class="error-state"><div class="error-message">加载知识点失败</div></div>'
    }
  }

  // ========================
  // 教学班级事件
  // ========================

  let editingClassId = null

  function bindTeachingClassEvents() {
    document.getElementById('btn-create-class')?.addEventListener('click', () => openClassModal())
    document.getElementById('btn-class-modal-cancel')?.addEventListener('click', closeClassModal)
    document.getElementById('class-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) closeClassModal()
    })

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
        if (editingClassId) {
          await updateTeachingClass(editingClassId, {
            teaching_class_name: name,
            semester: semester || undefined,
            description: description || undefined,
          })
        } else {
          await createTeachingClass(courseId, {
            teaching_class_name: name,
            semester: semester || undefined,
            description: description || undefined,
          })
        }
        closeClassModal()
        await refreshTeachingClasses()
      } catch (err) {
        alert(err.message || '保存班级失败')
      }
    })

    // Edit class buttons
    document.querySelectorAll('.btn-edit-class').forEach(btn => {
      btn.addEventListener('click', () => {
        const classId = parseInt(btn.dataset.classId, 10)
        const tc = teachingClasses.find(c => c.teaching_class_id === classId)
        if (tc) openClassModal(tc)
      })
    })

    // Delete class buttons
    document.querySelectorAll('.btn-delete-class').forEach(btn => {
      btn.addEventListener('click', async () => {
        const classId = parseInt(btn.dataset.classId, 10)
        if (!confirm('确定删除该教学班级吗？此操作不可撤销。')) return
        try {
          await deleteTeachingClass(classId)
          await refreshTeachingClasses()
        } catch (err) {
          alert(err.message || '删除班级失败')
        }
      })
    })
  }

  function openClassModal(tc) {
    const modal = document.getElementById('class-modal')
    modal.style.display = 'flex'
    document.getElementById('class-modal-title').textContent = tc ? '编辑教学班级' : '新建教学班级'
    document.getElementById('form-class-name').value = tc?.teaching_class_name || ''
    document.getElementById('form-class-semester').value = tc?.semester || ''
    document.getElementById('form-class-desc').value = tc?.description || ''
    editingClassId = tc?.teaching_class_id || null
  }

  function closeClassModal() {
    document.getElementById('class-modal').style.display = 'none'
    editingClassId = null
  }

  async function refreshTeachingClasses() {
    const container = document.getElementById('classes-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint" style="padding:40px 0;">加载中...</div>'
    try {
      const res = await getTeachingClasses(courseId)
      teachingClasses = res.data?.list || []
      container.innerHTML = renderClassList(teachingClasses)
      bindTeachingClassEvents()
    } catch (err) {
      container.innerHTML = '<div class="error-state"><div class="error-message">加载班级失败</div></div>'
    }
  }

  // ========================
  // 授课教师事件
  // ========================

  function bindTeacherEvents() {
    document.getElementById('btn-add-teacher')?.addEventListener('click', () => {
      document.getElementById('teacher-modal').style.display = 'flex'
    })
    document.getElementById('btn-teacher-modal-cancel')?.addEventListener('click', () => {
      document.getElementById('teacher-modal').style.display = 'none'
    })
    document.getElementById('teacher-modal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        document.getElementById('teacher-modal').style.display = 'none'
      }
    })

    document.getElementById('teacher-form')?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const teacherUserId = document.getElementById('form-teacher-user').value
      const teacherRole = document.getElementById('form-teacher-role').value

      if (!teacherUserId) {
        alert('请选择教师')
        return
      }
      if (!teacherRole) {
        alert('请选择教师角色')
        return
      }

      try {
        await bindCourseTeacher(courseId, parseInt(teacherUserId, 10), teacherRole)
        document.getElementById('teacher-modal').style.display = 'none'
        await refreshTeachers()
      } catch (err) {
        alert(err.message || '添加教师失败')
      }
    })

    // Remove teacher buttons
    document.querySelectorAll('.btn-remove-teacher').forEach(btn => {
      btn.addEventListener('click', async () => {
        const teacherUserId = parseInt(btn.dataset.teacherUserId, 10)
        if (!confirm('确定移除该教师吗？')) return
        try {
          await unbindCourseTeacher(courseId, teacherUserId)
          await refreshTeachers()
        } catch (err) {
          alert(err.message || '移除教师失败')
        }
      })
    })
  }

  async function refreshTeachers() {
    const container = document.getElementById('teachers-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint" style="padding:40px 0;">加载中...</div>'

    try {
      // Reload course detail to get updated teacher_list
      const res = await getAdminCourseDetail(courseId)
      course = { ...course, teachers: res.data?.teachers || [] }

      // Also reload teacher users for the add dropdown
      try {
        const teacherUserRes = await getAdminUsers({ role: 'teacher', page_size: 100 })
        teacherUsers = teacherUserRes.data?.list || []
      } catch {
        // non-fatal
      }

      const teachers = course.teachers || []
      const newBoundIds = new Set(teachers.map(t => t.teacher_user_id || t.user_id).filter(Boolean))

      container.innerHTML = renderTeacherList(teachers)
      bindTeacherEvents()

      // Update the teacher modal dropdown options
      updateTeacherDropdown(newBoundIds)
    } catch (err) {
      container.innerHTML = '<div class="error-state"><div class="error-message">加载教师数据失败</div></div>'
    }
  }

  function updateTeacherDropdown(boundIds) {
    const select = document.getElementById('form-teacher-user')
    if (!select) return
    const currentValue = select.value
    const available = teacherUsers.filter(tu => !boundIds.has(tu.user_id))
    select.innerHTML = `
      <option value="">请选择教师</option>
      ${available.map(tu => `<option value="${tu.user_id}">${escapeHtml(tu.profile?.real_name || tu.username)}（${escapeHtml(tu.username)}）</option>`).join('')}
    `
    // Show hint if no available teachers
    const hint = select.parentElement.querySelector('.teacher-availability-hint')
    if (hint) hint.remove()
    if (available.length === 0) {
      const p = document.createElement('p')
      p.className = 'teacher-availability-hint'
      p.style.cssText = 'color:var(--text-muted);font-size:0.85rem;margin-top:6px;'
      p.textContent = '暂无可选教师（所有教师已添加）'
      select.parentElement.appendChild(p)
    }
    // Restore value if still valid
    if (currentValue && [...select.options].some(opt => opt.value === currentValue)) {
      select.value = currentValue
    }
  }
}
