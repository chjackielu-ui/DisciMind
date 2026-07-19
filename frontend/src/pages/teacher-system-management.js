// 教师端 - 系统管理（班级管理 / 学生管理 / 课程管理 三合一 Tab 页）
// 顶部系统管理栏固定定位，三 Tab 切换复用各自原有增删改查业务逻辑

import { getMe } from '../api/auth.js'
import { getUser, setAuth, clearAuth, getUserDisplayName, getToken } from '../utils/auth.js'
import { renderDashboardLayout } from '../utils/dashboard.js'
import { TEACHER_MENU_ITEMS } from '../utils/teacher-menu.js'
import {
  getTeacherCourses, createTeacherCourse, updateTeacherCourse, deleteTeacherCourse,
  getTeacherStudents, createTeacherStudent, updateTeacherStudent, deleteTeacherStudent,
  getTeachingClasses, getAllTeachingClasses, createTeachingClass, updateTeachingClass, deleteTeachingClass,
  getClassStudents, addClassStudents, removeClassStudent,
  batchImportStudents, getAdministrativeClasses, getAdministrativeClassStudents, importAdministrativeClasses,
} from '../api/teacher.js'
import { iconSearch, iconRefresh } from '../utils/icons.js'
import { initAllAutoResize } from '../utils/auto-resize.js'
import { escapeHtml, formatDate } from '../utils/format.js'

const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

function formatTeachingSchedule(schedule) {
  if (!schedule) return '未设置上课时间'
  if (typeof schedule === 'string') {
    const value = schedule.trim()
    if (!value) return '未设置上课时间'
    if (value.startsWith('{') || value.startsWith('[')) {
      try { return formatTeachingSchedule(JSON.parse(value)) } catch { return value }
    }
    return value
  }
  if (Array.isArray(schedule)) return schedule.map(formatTeachingSchedule).filter(Boolean).join(' / ')
  if (typeof schedule === 'object') {
    const weekday = WEEKDAY_LABELS[Number(schedule.weekday)] || schedule.weekdayLabel || schedule.day || ''
    const periods = schedule.periods || schedule.period || schedule.time || ''
    const room = schedule.location || schedule.room || ''
    const label = [weekday, periods && `${periods} 节`, room].filter(Boolean).join(' ')
    return label || '未设置上课时间'
  }
  return String(schedule)
}

export async function renderTeacherSystemManagement(app) {
  let user = getUser()
  try {
    const result = await getMe()
    user = result.data.user
    setAuth(getUser() ? getToken() : '', user)
  } catch {
    if (!user) { clearAuth(); window.location.hash = '#/login'; return }
  }

  const SYSTAB_HEIGHT = 56

  const contentHTML = `
    <div class="dashboard-content" style="padding-top:0;">
      <!-- 固定顶部系统管理栏 -->
      <div id="systab-bar" style="position:fixed;top:0;left:128px;right:0;z-index:99;background:#fff;border-bottom:1px solid var(--border);padding:0 28px;display:flex;align-items:flex-end;gap:24px;height:${SYSTAB_HEIGHT}px;box-shadow:none;">
        <button class="systab-btn active" data-tab="classes" style="padding:0 0 10px;border:none;background:none;font-size:0.88rem;font-weight:600;cursor:pointer;color:#1F2937;border-bottom:2px solid #2563EB;height:auto;line-height:1;letter-spacing:0.02em;">班级管理</button>
        <button class="systab-btn" data-tab="students" style="padding:0 0 10px;border:none;background:none;font-size:0.88rem;font-weight:400;cursor:pointer;color:#64748B;border-bottom:2px solid transparent;height:auto;line-height:1;letter-spacing:0.02em;">学生管理</button>
        <button class="systab-btn" data-tab="courses" style="padding:0 0 10px;border:none;background:none;font-size:0.88rem;font-weight:400;cursor:pointer;color:#64748B;border-bottom:2px solid transparent;height:auto;line-height:1;letter-spacing:0.02em;">课程管理</button>
      </div>

      <!-- 内容区（预留顶部固定栏高度） -->
      <div id="systab-content" style="padding-top:${SYSTAB_HEIGHT + 16}px;min-height:60vh;">
        <!-- Tab1: 班级管理 -->
        <div id="tab-classes" class="systab-pane">
          <header class="teacher-class-list-head"><div><span>CLASS WORKSPACE</span><h2>我的班级</h2><p>先进入班级，再管理学生、资料、作业、题库、资源与评价。</p></div></header>
          <div class="class-domain-switch" role="tablist"><button class="active" data-class-domain="teaching">教学班</button><button data-class-domain="administrative">行政班</button><span>教学班用于授课与任务发布；行政班仅表示学生组织归属。</span></div>
          <div class="card" style="margin-bottom:20px;">
            <div class="filter-bar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
              <input type="text" id="cl-search-keyword" class="toolbar-search" placeholder="搜索班级名称..." style="width:180px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
              <select id="cl-filter-course" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;min-width:160px;"><option value="">全部课程</option></select>
              <select id="cl-filter-status" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;"><option value="">全部状态</option><option value="active">使用中</option><option value="archived">已归档</option></select>
              <button class="btn btn-primary" id="cl-btn-search" style="padding:6px 14px;font-size:0.85rem;">${iconSearch()} 搜索</button>
              <button class="btn" id="cl-btn-refresh" style="border:1px solid var(--border);padding:6px 10px;">${iconRefresh()}</button>
              <button class="btn btn-primary" id="cl-btn-create" style="margin-left:auto;padding:6px 14px;font-size:0.85rem;">新建教学班</button>
            </div>
          </div>
          <div id="cl-list-container"><div class="empty-hint">加载中...</div></div>
        </div>

        <!-- Tab2: 学生管理 -->
        <div id="tab-students" class="systab-pane" style="display:none;">
          <div class="card" style="margin-bottom:20px;">
            <div class="filter-bar" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <input type="text" id="stu-search-keyword" class="toolbar-search" placeholder="搜索姓名/学号..." style="width:140px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
              <input type="text" id="stu-search-no" class="toolbar-search" placeholder="学号..." style="width:100px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
              <input type="text" id="stu-search-class" class="toolbar-search" placeholder="班级..." style="width:100px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
              <button class="btn btn-primary" id="stu-btn-search" style="padding:6px 14px;font-size:0.85rem;">${iconSearch()}</button>
              <button class="btn" id="stu-btn-refresh" style="border:1px solid var(--border);padding:6px 10px;">${iconRefresh()}</button>
              <button class="btn" id="stu-btn-export" style="border:1px solid var(--border);padding:6px 10px;font-size:0.82rem;">模板</button>
              <button class="btn" id="stu-btn-import" style="border:1px solid var(--border);padding:6px 10px;font-size:0.82rem;">导入</button>
              <button class="btn btn-primary" id="stu-btn-add" style="margin-left:auto;padding:6px 14px;font-size:0.85rem;">＋ 添加学生</button>
            </div>
          </div>
          <div id="stu-list-container"><div class="empty-hint">加载中...</div></div>
          <div id="stu-pagination" style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:16px;">
            <button class="btn" id="stu-btn-prev" style="border:1px solid var(--border);padding:6px 16px;">上一页</button>
            <span id="stu-page-info" style="font-size:0.9rem;color:var(--text-secondary);">第 1 页</span>
            <button class="btn" id="stu-btn-next" style="border:1px solid var(--border);padding:6px 16px;">下一页</button>
          </div>
        </div>

        <!-- Tab3: 课程管理 -->
        <div id="tab-courses" class="systab-pane" style="display:none;">
          <div class="card" style="margin-bottom:20px;">
            <div class="filter-bar" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
              <input type="text" id="co-search-keyword" class="toolbar-search" placeholder="搜索课程名称..." style="flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
              <button class="btn btn-primary" id="co-btn-search" style="padding:6px 14px;font-size:0.85rem;">${iconSearch()}</button>
              <button class="btn" id="co-btn-refresh" style="border:1px solid var(--border);padding:6px 10px;">${iconRefresh()}</button>
              <button class="btn btn-primary" id="co-btn-create" style="margin-left:auto;padding:6px 14px;font-size:0.85rem;">＋ 新建课程</button>
            </div>
          </div>
          <div id="co-list-container"><div class="empty-hint">加载中...</div></div>
        </div>
      </div>
    </div>

    <!-- ========== 共用的弹窗 ========== -->
    <!-- 班级弹窗 -->
    <div id="cl-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:500px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 id="cl-modal-title" style="font-size:1.2rem;margin:0;">新建班级</h3>
          <button type="button" id="cl-modal-close" style="border:none;background:none;font-size:24px;color:#999;cursor:pointer;">×</button>
        </div>
        <form id="cl-form">
          <div class="form-group" style="margin-bottom:14px;">
            <label>所属课程 <span class="required">*</span></label>
            <select id="cl-form-course" required style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;"><option value="">请选择课程</option></select>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>班级名称 <span class="required">*</span></label>
            <input type="text" id="cl-form-name" required placeholder="例如：2024级计算机科学1班" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>学期</label>
            <input type="text" id="cl-form-semester" placeholder="例如：2024-2025学年第一学期" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <div class="form-group"><label>教学班编码</label><input type="text" id="cl-form-code" placeholder="例如：ML-2026-01" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>容量</label><input type="number" id="cl-form-capacity" min="1" placeholder="例如：60" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>上课时间</label><input type="text" id="cl-form-schedule" placeholder="周二 1-2 节" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>上课地点</label><input type="text" id="cl-form-location" placeholder="博学楼 A201" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label>班级描述</label>
            <textarea id="cl-form-desc" class="auto-resize-ta" rows="2" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></textarea>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="cl-modal-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
    <div id="cl-detail-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:640px;max-width:90vw;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px;">
          <div><h3 id="cl-detail-title" style="font-size:1.2rem;margin:0 0 4px;"></h3><p id="cl-detail-sub" style="color:var(--text-secondary);font-size:0.85rem;margin:0;"></p></div>
          <button class="btn" id="cl-detail-import" style="border:1px solid var(--border);font-size:0.85rem;">导入学生</button>
          <button class="btn" id="cl-detail-add" style="border:1px solid var(--border);font-size:0.85rem;">＋ 添加学生</button>
          <button class="btn" id="cl-detail-close" style="border:1px solid var(--border);font-size:0.85rem;">关闭</button>
        </div>
        <div id="cl-detail-list"><div class="empty-hint">加载中...</div></div>
        <div id="cl-detail-add-form" style="display:none;margin-top:16px;padding:16px;background:var(--bg);border-radius:8px;">
          <h4 style="font-size:0.95rem;margin:0 0 10px;">添加学生到本班级</h4>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input type="text" id="cl-add-search" placeholder="搜索学生..." style="flex:1;min-width:150px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">
            <button class="btn btn-primary" id="cl-add-search-btn" style="font-size:0.85rem;">搜索</button>
            <select id="cl-add-select" style="min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;"><option value="">请搜索选择学生</option></select>
            <button class="btn btn-primary" id="cl-add-confirm" disabled style="font-size:0.85rem;opacity:0.6;">确认添加</button>
          </div>
          <div id="cl-add-result" style="margin-top:8px;font-size:0.85rem;"></div>
        </div>
      </div>
    </div>
    <div id="cl-delete-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:380px;max-width:90vw;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="font-size:1.1rem;margin-bottom:8px;">确认删除</h3>
        <p id="cl-delete-text" style="color:var(--text-secondary);margin-bottom:20px;"></p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn" id="cl-del-cancel" style="border:1px solid var(--border);padding:8px 24px;">取消</button>
          <button class="btn" id="cl-del-confirm" style="background:#dc2626;color:#fff;border:none;padding:8px 24px;border-radius:8px;cursor:pointer;">确认删除</button>
        </div>
      </div>
    </div>

    <!-- 学生弹窗 -->
    <div id="stu-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 id="stu-modal-title" style="font-size:1.2rem;margin:0;">添加学生</h3>
          <button type="button" id="stu-modal-close" style="border:none;background:none;font-size:24px;color:#999;cursor:pointer;">×</button>
        </div>
        <form id="stu-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div class="form-group"><label>用户名 <span class="required">*</span></label><input type="text" id="stu-f-username" required style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>密码 <span class="required">*</span></label><input type="password" id="stu-f-password" required style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>真实姓名 <span class="required">*</span></label><input type="text" id="stu-f-realname" required style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>学号</label><input type="text" id="stu-f-no" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>学院</label><input type="text" id="stu-f-college" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>专业</label><input type="text" id="stu-f-major" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>年级</label><input type="text" id="stu-f-grade" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>手机号</label><input type="text" id="stu-f-phone" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>邮箱</label><input type="email" id="stu-f-email" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
            <div class="form-group"><label>性别</label><select id="stu-f-gender" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;"><option value="">未设置</option><option value="male">男</option><option value="female">女</option></select></div>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="stu-modal-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
    <div id="stu-delete-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:380px;max-width:90vw;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="font-size:1.1rem;margin-bottom:8px;">确认删除学生</h3>
        <p id="stu-delete-text" style="color:var(--text-secondary);margin-bottom:20px;"></p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="btn" id="stu-del-cancel" style="border:1px solid var(--border);padding:8px 24px;">取消</button>
          <button class="btn" id="stu-del-confirm" style="background:#dc2626;color:#fff;border:none;padding:8px 24px;border-radius:8px;cursor:pointer;">确认删除</button>
        </div>
      </div>
    </div>
    <div id="stu-import-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:560px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin-bottom:12px;font-size:1.2rem;">批量导入学生</h3>
        <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:16px;">下载模板，按模板填写后上传 CSV 文件。</p>
        <select id="stu-import-class" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;background:#fff;margin-bottom:12px;"><option value="">请选择要加入的教学班</option></select>
        <button class="btn" id="stu-import-dl" style="border:1px solid var(--border);margin-bottom:16px;">下载模板</button>
        <div style="border:2px dashed var(--border);border-radius:12px;padding:30px;text-align:center;background:var(--bg);margin-bottom:16px;" id="stu-dropzone">
          <div style="font-size:2rem;margin-bottom:8px;"></div>
          <p style="color:var(--text-secondary);margin-bottom:8px;">拖拽 CSV 文件到此处，或点击选择</p>
          <input type="file" id="stu-file-input" accept=".csv" style="display:none;">
          <button class="btn" id="stu-file-btn" style="border:1px solid var(--border);">选择文件</button>
          <div id="stu-file-info" style="margin-top:10px;font-size:0.9rem;color:var(--text-muted);display:none;"></div>
        </div>
        <div id="stu-import-preview" style="display:none;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;"></div>
        <div id="stu-import-result" style="display:none;margin-bottom:12px;"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="btn" id="stu-import-cancel" style="border:1px solid var(--border);">取消</button>
          <button class="btn btn-primary" id="stu-import-submit" disabled style="opacity:0.6;">导入</button>
        </div>
      </div>
    </div>

    <!-- 课程弹窗 -->
    <div id="co-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 id="co-modal-title" style="font-size:1.2rem;margin:0;">新建课程</h3>
          <button type="button" id="co-modal-close" style="border:none;background:none;font-size:24px;color:#999;cursor:pointer;">×</button>
        </div>
        <form id="co-form">
          <div class="form-group" style="margin-bottom:14px;"><label>课程名称 <span class="required">*</span></label><input type="text" id="co-f-name" required placeholder="例如：机器学习" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
          <div class="form-group" style="margin-bottom:14px;"><label>课程编码 <span class="required">*</span></label><input type="text" id="co-f-code" required placeholder="例如：ML001" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
          <div class="form-group" style="margin-bottom:14px;"><label>学科分类</label><input type="text" id="co-f-category" placeholder="计算机大类学科" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></div>
          <div class="form-group" style="margin-bottom:14px;"><label>课程描述</label><textarea id="co-f-desc" class="auto-resize-ta" rows="3" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;"></textarea></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" class="btn" id="co-modal-cancel" style="border:1px solid var(--border);">取消</button>
            <button type="submit" class="btn btn-primary">保存</button>
          </div>
        </form>
      </div>
    </div>
  `

  renderDashboardLayout(app, {
    title: '系统管理',
    menuItems: TEACHER_MENU_ITEMS,
    contentHTML,
    user,
  })

  // ============================
  // Tab 切换
  // ============================
  let currentTab = null  // 初始为 null，让 activateTab 不被 guard 拦截
  // 支持 URL query param 指定初始 tab（如 #/teacher/system?tab=courses）
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const initialTab = urlParams.get('tab')
  const targetTab = (initialTab && ['classes', 'students', 'courses'].includes(initialTab)) ? initialTab : 'classes'

  function activateTab(tab) {
    if (tab === currentTab) return
    currentTab = tab
    document.querySelectorAll('.systab-btn').forEach(b => {
      b.classList.remove('active')
      b.style.color = '#64748B'
      b.style.borderBottomColor = 'transparent'
      b.style.fontWeight = '400'
    })
    const activeBtn = document.querySelector('.systab-btn[data-tab="' + tab + '"]')
    if (activeBtn) {
      activeBtn.classList.add('active')
      activeBtn.style.color = '#1F2937'
      activeBtn.style.borderBottomColor = '#2563EB'
      activeBtn.style.fontWeight = '600'
    }
    document.querySelectorAll('.systab-pane').forEach(p => p.style.display = 'none')
    const pane = document.getElementById('tab-' + tab)
    if (pane) pane.style.display = 'block'
    if (tab === 'classes') loadClasses()
    else if (tab === 'students') loadStudents()
    else if (tab === 'courses') loadCourses()
  }

  document.querySelectorAll('.systab-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab))
  })

  // 激活初始 tab
  queueMicrotask(() => activateTab(targetTab))

  // ============================
  // 班级管理
  // ============================
  let allCourses = []
  let classesData = []
  let editingClassId = null
  let deleteTargetId = null
  let currentDetailClassId = null
  let detailStudents = []
  let availableStudents = []
  let selectedAddStudentId = null
  let classDomain = 'teaching'

  async function loadCourseSelects() {
    try {
      const res = await getTeacherCourses()
      allCourses = res.data.list || []
      ;['cl-filter-course', 'cl-form-course'].forEach(id => {
        const sel = document.getElementById(id)
        if (!sel) return
        sel.innerHTML = '<option value="">' + (id === 'cl-form-course' ? '请选择课程' : '全部课程') + '</option>'
        allCourses.forEach(c => {
          const opt = document.createElement('option')
          opt.value = c.course_id
          opt.textContent = c.course_name
          sel.appendChild(opt)
        })
      })
    } catch (e) { console.error(e) }
  }

  async function loadClasses() {
    const container = document.getElementById('cl-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const params = {}
      const kw = document.getElementById('cl-search-keyword')?.value
      const cid = document.getElementById('cl-filter-course')?.value
      const status = document.getElementById('cl-filter-status')?.value
      if (kw) params.keyword = kw
      if (cid) params.course_id = cid
      if (status) params.status = status
      const res = classDomain === 'teaching' ? await getAllTeachingClasses(params) : await getAdministrativeClasses(params)
      classesData = res.data.list || []
      if (!classesData.length) {
        container.innerHTML = `<div class="empty-hint" style="padding:60px 0;">暂无${classDomain === 'teaching' ? '教学班' : '行政班'}</div>`; return
      }
      if (classDomain === 'administrative') {
        container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
          ${classesData.map(item => `<div class="card" style="padding:18px;border-left:4px solid #9a744b;">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;"><h4 style="font-size:1rem;font-weight:600;margin:0;">${escapeHtml(item.name)}</h4><span style="background:var(--bg);padding:2px 10px;border-radius:12px;border:1px solid var(--border);font-size:.8rem;">${item.student_count || 0} 人</span></div>
            <div style="color:var(--text-secondary);font-size:.85rem;line-height:1.7;"><div>${escapeHtml(item.college || '未设置学院')} · ${escapeHtml(item.major || '未设置专业')}</div><div>${escapeHtml(item.grade || '未设置年级')} · 辅导员 ${escapeHtml(item.advisor_name || '未指定')}</div></div>
            <div style="display:flex;gap:8px;padding-top:10px;border-top:1px solid var(--border);margin-top:10px;"><button class="ad-view" data-id="${item.administrative_class_id}" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;">查看学生</button><button class="ad-import" data-id="${item.administrative_class_id}" style="flex:1;padding:6px;border:1px solid #d7b889;border-radius:6px;background:#fbf1e1;color:#805422;cursor:pointer;">加入教学班</button></div>
          </div>`).join('')}</div>`
        container.querySelectorAll('.ad-view').forEach(button => button.addEventListener('click', () => openAdministrativeClassDetail(Number(button.dataset.id))))
        container.querySelectorAll('.ad-import').forEach(button => button.addEventListener('click', () => openAdministrativeImport(Number(button.dataset.id))))
        return
      }
      container.innerHTML = `<div class="teacher-class-management-grid">
        ${classesData.map(tc => `<article class="teacher-class-management-card">
          <header><div><span>${escapeHtml(tc.course_name || '未知课程')}</span><h4>${escapeHtml(tc.teaching_class_name)}</h4></div><em>${tc.status === 'archived' ? '已归档' : '使用中'}</em></header>
          <p>${escapeHtml(tc.semester_name || tc.semester || '未设置学期')}${tc.code ? ` · ${escapeHtml(tc.code)}` : ''}<br>${escapeHtml(formatTeachingSchedule(tc.schedule))} · ${escapeHtml(tc.location || '未设置地点')}</p>
          <dl>
            <div><dt>学生</dt><dd>${tc.student_count || 0}<i>人</i></dd></div>
            <div><dt>近 30 天作业</dt><dd>${tc.recent_assignment_count || 0}<i>项</i></dd></div>
            <div><dt>学习进度</dt><dd>${tc.learning_progress || 0}<i>%</i></dd></div>
            <div class="risk"><dt>风险学生</dt><dd>${tc.risk_student_count || 0}<i>人</i></dd></div>
          </dl>
          <button class="cl-open" data-id="${tc.teaching_class_id}">进入班级工作区</button>
          <footer>
            <button class="cl-view" data-id="${tc.teaching_class_id}">学生名单</button>
            <button class="cl-edit" data-id="${tc.teaching_class_id}">编辑</button>
            <button class="cl-del" data-id="${tc.teaching_class_id}" data-name="${escapeHtml(tc.teaching_class_name)}">删除</button>
          </footer>
        </article>`).join('')}</div>`
      container.querySelectorAll('.cl-open').forEach(b => b.addEventListener('click', () => { window.location.hash = `#/teacher/classes/${b.dataset.id}` }))
      container.querySelectorAll('.cl-view').forEach(b => b.addEventListener('click', () => openClassDetail(parseInt(b.dataset.id))))
      container.querySelectorAll('.cl-edit').forEach(b => { const id = parseInt(b.dataset.id); const tc = classesData.find(c => c.teaching_class_id === id); b.addEventListener('click', () => openClassModal(tc)) })
      container.querySelectorAll('.cl-del').forEach(b => { const id = parseInt(b.dataset.id); const name = b.dataset.name; b.addEventListener('click', () => openClassDelete(id, name)) })
    } catch (err) { container.innerHTML = `<div class="error-state"><div class="error-message">${err.message}</div></div>` }
  }

  function openClassModal(cls) {
    editingClassId = cls?.teaching_class_id || null
    document.getElementById('cl-modal-title').textContent = cls ? '编辑班级' : '新建班级'
    document.getElementById('cl-form-course').value = cls?.course_id || ''
    document.getElementById('cl-form-name').value = cls?.teaching_class_name || ''
    document.getElementById('cl-form-semester').value = cls?.semester || ''
    document.getElementById('cl-form-code').value = cls?.code || ''
    document.getElementById('cl-form-capacity').value = cls?.capacity || ''
    document.getElementById('cl-form-schedule').value = cls?.schedule ? formatTeachingSchedule(cls.schedule) : ''
    document.getElementById('cl-form-location').value = cls?.location || ''
    document.getElementById('cl-form-desc').value = cls?.description || ''
    document.getElementById('cl-modal').style.display = 'flex'
  }

  function closeClassModal() { document.getElementById('cl-modal').style.display = 'none'; editingClassId = null }
  document.getElementById('cl-btn-create')?.addEventListener('click', () => openClassModal())
  ;['cl-modal-close', 'cl-modal-cancel'].forEach(id => document.getElementById(id)?.addEventListener('click', closeClassModal))
  document.getElementById('cl-modal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeClassModal() })

  document.getElementById('cl-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const cid = parseInt(document.getElementById('cl-form-course').value)
    const name = document.getElementById('cl-form-name').value.trim()
    if (!cid || !name) { alert('请选择课程并填写班级名称'); return }
    try {
      const classPayload = { teaching_class_name: name, semester: document.getElementById('cl-form-semester').value.trim() || undefined, code: document.getElementById('cl-form-code').value.trim() || undefined, schedule: document.getElementById('cl-form-schedule').value.trim() || undefined, location: document.getElementById('cl-form-location').value.trim() || undefined, capacity: Number(document.getElementById('cl-form-capacity').value) || undefined, description: document.getElementById('cl-form-desc').value.trim() || undefined }
      if (editingClassId) await updateTeachingClass(editingClassId, classPayload)
      else await createTeachingClass(cid, classPayload)
      closeClassModal(); loadClasses()
    } catch (err) { alert(err.message) }
  })
  document.getElementById('cl-btn-search')?.addEventListener('click', loadClasses)
  document.getElementById('cl-btn-refresh')?.addEventListener('click', loadClasses)
  document.getElementById('cl-search-keyword')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadClasses() })
  document.getElementById('cl-filter-course')?.addEventListener('change', loadClasses)
  document.getElementById('cl-filter-status')?.addEventListener('change', loadClasses)
  document.querySelectorAll('[data-class-domain]').forEach(button => button.addEventListener('click', () => {
    classDomain = button.dataset.classDomain
    document.querySelectorAll('[data-class-domain]').forEach(item => item.classList.toggle('active', item === button))
    document.getElementById('cl-filter-course').style.display = classDomain === 'teaching' ? '' : 'none'
    document.getElementById('cl-btn-create').style.display = classDomain === 'teaching' ? '' : 'none'
    loadClasses()
  }))

  async function openAdministrativeClassDetail(classId) {
    const item = classesData.find(row => row.administrative_class_id === classId) || {}
    currentDetailClassId = null
    document.getElementById('cl-detail-title').textContent = item.name || '行政班详情'
    document.getElementById('cl-detail-sub').textContent = `${item.college || ''} · ${item.major || ''} · ${item.student_count || 0} 名学生`
    document.getElementById('cl-detail-import').style.display = 'none'; document.getElementById('cl-detail-add').style.display = 'none'; document.getElementById('cl-detail-add-form').style.display = 'none'; document.getElementById('cl-detail-modal').style.display = 'flex'
    const container = document.getElementById('cl-detail-list'); container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try { const response = await getAdministrativeClassStudents(classId); const rows = response.data.list || []; container.innerHTML = rows.length ? `<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:8px;">姓名</th><th style="text-align:left;padding:8px;">学号</th><th style="text-align:left;padding:8px;">专业/年级</th></tr></thead><tbody>${rows.map(student => `<tr><td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(student.student_name || '-')}</td><td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(student.student_no || '-')}</td><td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(student.major || '-')} · ${escapeHtml(student.grade || '-')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-hint">该行政班暂无学生</div>' } catch (error) { container.innerHTML = `<div class="empty-hint">${escapeHtml(error.message)}</div>` }
  }

  async function openAdministrativeImport(adminClassId) {
    try {
      const response = await getAllTeachingClasses({ status: 'active' }); const classes = response.data.list || []
      if (!classes.length) return alert('当前没有可用教学班')
      const layer = document.createElement('div'); layer.className = 'class-import-layer'; layer.innerHTML = `<div><h3>将行政班加入教学班</h3><p>按稳定 ID 建立关系，并把行政班现有学生加入目标教学班。</p><select>${classes.map(item => `<option value="${item.teaching_class_id}">${escapeHtml(item.course_name || '')} / ${escapeHtml(item.teaching_class_name)}</option>`).join('')}</select><footer><button data-cancel>取消</button><button data-confirm>确认导入</button></footer></div>`; document.body.appendChild(layer)
      layer.querySelector('[data-cancel]').onclick = () => layer.remove()
      layer.querySelector('[data-confirm]').onclick = async () => { const target = Number(layer.querySelector('select').value); try { const result = await importAdministrativeClasses(target, { admin_class_ids: [adminClassId] }); layer.remove(); alert(`已导入 ${result.data.imported_count || 0} 名学生`) } catch (error) { alert(error.message) } }
    } catch (error) { alert(error.message) }
  }

  function openClassDelete(id, name) {
    deleteTargetId = id
    document.getElementById('cl-delete-text').textContent = `确定删除班级「${name}」吗？`
    document.getElementById('cl-delete-modal').style.display = 'flex'
  }
  document.getElementById('cl-del-cancel')?.addEventListener('click', () => { document.getElementById('cl-delete-modal').style.display = 'none'; deleteTargetId = null })
  document.getElementById('cl-del-confirm')?.addEventListener('click', async () => {
    if (!deleteTargetId) return
    try { await deleteTeachingClass(deleteTargetId); document.getElementById('cl-delete-modal').style.display = 'none'; deleteTargetId = null; loadClasses() }
    catch (err) { alert(err.message); document.getElementById('cl-delete-modal').style.display = 'none'; deleteTargetId = null }
  })

  async function openClassDetail(classId) {
    currentDetailClassId = classId
    document.getElementById('cl-detail-import').style.display = ''; document.getElementById('cl-detail-add').style.display = ''
    const tc = classesData.find(c => c.teaching_class_id === classId) || {}
    document.getElementById('cl-detail-title').textContent = tc.teaching_class_name || '班级详情'
    document.getElementById('cl-detail-sub').textContent = `${tc.course_name || ''} · ${tc.student_count || 0} 名学生`
    document.getElementById('cl-detail-modal').style.display = 'flex'
    document.getElementById('cl-detail-add-form').style.display = 'none'
    await loadDetailStudents(classId)
  }
  document.getElementById('cl-detail-close')?.addEventListener('click', () => document.getElementById('cl-detail-modal').style.display = 'none')

  async function loadDetailStudents(classId) {
    const container = document.getElementById('cl-detail-list')
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const res = await getClassStudents(classId)
      detailStudents = res.data.list || []
      if (!detailStudents.length) { container.innerHTML = '<div class="empty-hint" style="padding:30px 0;">暂无学生</div>'; return }
      container.innerHTML = detailStudents.map(s => `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);margin-bottom:6px;">
        <div style="width:34px;height:34px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:600;flex-shrink:0;">${(s.student_name || '?')[0]}</div>
        <div style="flex:1;"><div style="font-weight:600;color:var(--stu-dark);">${escapeHtml(s.student_name || '未知')}</div><div style="font-size:0.8rem;color:var(--text-muted);">学号：${escapeHtml(s.student_no || '-')}</div></div>
        <button class="cl-remove-stu" data-sid="${s.student_user_id}" style="padding:4px 10px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;">移除</button>
      </div>`).join('')
      container.querySelectorAll('.cl-remove-stu').forEach(b => b.addEventListener('click', async () => {
        const sid = parseInt(b.dataset.sid)
        if (!confirm('确定移出班级？')) return
        try { await removeClassStudent(currentDetailClassId, sid); loadDetailStudents(currentDetailClassId); loadClasses() }
        catch (err) { alert(err.message) }
      }))
    } catch (err) { container.innerHTML = `<div class="empty-hint">加载失败</div>` }
  }

  function prepareStudentImport(targetClassId = '') {
    const select = document.getElementById('stu-import-class')
    getAllTeachingClasses({ status: 'active' }).then(response => {
      const list = response.data.list || []
      select.innerHTML = '<option value="">请选择要加入的教学班</option>' + list.map(item => `<option value="${item.teaching_class_id}">${escapeHtml(item.course_name || '')} / ${escapeHtml(item.teaching_class_name)}</option>`).join('')
      if (targetClassId) select.value = String(targetClassId)
    }).catch(error => { select.innerHTML = `<option value="">${escapeHtml(error.message)}</option>` })
    document.getElementById('stu-import-modal').style.display = 'flex'
    document.getElementById('stu-file-input').value = ''
    document.getElementById('stu-file-info').style.display = 'none'
    document.getElementById('stu-import-preview').style.display = 'none'
    document.getElementById('stu-import-result').style.display = 'none'
    document.getElementById('stu-import-submit').disabled = true
    document.getElementById('stu-import-submit').style.opacity = '0.6'
  }

  // 班级详情 → 导入学生，显式携带目标教学班稳定 ID
  document.getElementById('cl-detail-import')?.addEventListener('click', () => {
    document.getElementById('cl-detail-modal').style.display = 'none'
    prepareStudentImport(currentDetailClassId)
  })

  document.getElementById('cl-detail-add')?.addEventListener('click', () => {
    const f = document.getElementById('cl-detail-add-form')
    f.style.display = f.style.display === 'none' ? 'block' : 'none'
    document.getElementById('cl-add-search').value = ''
    document.getElementById('cl-add-select').innerHTML = '<option value="">请搜索选择学生</option>'
    document.getElementById('cl-add-confirm').disabled = true; document.getElementById('cl-add-confirm').style.opacity = '0.6'
    selectedAddStudentId = null
  })
  document.getElementById('cl-add-search-btn')?.addEventListener('click', async () => {
    const kw = document.getElementById('cl-add-search').value.trim()
    if (!kw) { alert('请输入搜索关键词'); return }
    try {
      const res = await getTeacherStudents({ keyword: kw, page_size: 50 })
      const all = res.data.list || []
      const existing = new Set(detailStudents.map(s => s.student_user_id))
      availableStudents = all.filter(s => !existing.has(s.student_user_id ?? s.user_id))
      const sel = document.getElementById('cl-add-select')
      if (!availableStudents.length) { sel.innerHTML = '<option value="">未找到可添加的学生</option>'; return }
      sel.innerHTML = '<option value="">请选择学生</option>'
      availableStudents.forEach(s => { const opt = document.createElement('option'); opt.value = s.student_user_id ?? s.user_id; opt.textContent = `${s.student_name || s.real_name || s.username} (${s.student_no || '无学号'})`; sel.appendChild(opt) })
    } catch (err) { alert(err.message) }
  })
  document.getElementById('cl-add-select')?.addEventListener('change', e => {
    selectedAddStudentId = parseInt(e.target.value) || null
    document.getElementById('cl-add-confirm').disabled = !selectedAddStudentId
    document.getElementById('cl-add-confirm').style.opacity = selectedAddStudentId ? '1' : '0.6'
  })
  document.getElementById('cl-add-confirm')?.addEventListener('click', async () => {
    if (!selectedAddStudentId || !currentDetailClassId) return
    try { await addClassStudents(currentDetailClassId, { student_user_ids: [selectedAddStudentId] }); document.getElementById('cl-detail-add-form').style.display = 'none'; loadDetailStudents(currentDetailClassId); loadClasses() }
    catch (err) { document.getElementById('cl-add-result').innerHTML = `<span style="color:#dc2626;">❌ ${err.message}</span>` }
  })

  // ============================
  // 学生管理
  // ============================
  let studentsData = []
  let stuPage = 1, stuTotalPages = 1
  const stuPageSize = 20
  let stuDeleteId = null
  let stuImportData = []

  async function loadStudents() {
    const container = document.getElementById('stu-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const params = { page: stuPage, page_size: stuPageSize }
      const kw = document.getElementById('stu-search-keyword')?.value
      const no = document.getElementById('stu-search-no')?.value
      const cls = document.getElementById('stu-search-class')?.value
      if (kw) params.keyword = kw
      if (no) params.student_no = no
      if (cls) params.class_name = cls
      const res = await getTeacherStudents(params)
      const data = res.data || res
      studentsData = data.list || []
      stuPage = data.page || stuPage
      stuTotalPages = data.total_pages || Math.ceil((data.total || 0) / stuPageSize) || 1
      if (!studentsData.length) { container.innerHTML = '<div class="empty-hint" style="padding:60px 0;">暂无学生</div>'; updateStuPage(); return }
      container.innerHTML = `<div class="card" style="overflow:auto;padding:0;">
        <table style="width:100%;min-width:1200px;border-collapse:collapse;font-size:0.85rem;">
          <thead><tr style="background:#f8f9fa;border-bottom:2px solid var(--border);">
            <th style="padding:12px 16px;text-align:left;">姓名</th><th style="padding:12px 16px;text-align:left;">学号</th><th style="padding:12px 16px;text-align:left;">教学班</th><th style="padding:12px 16px;text-align:left;">学院/专业</th><th style="padding:12px 10px;text-align:center;">掌握度</th><th style="padding:12px 10px;text-align:center;">作业完成</th><th style="padding:12px 10px;text-align:center;">活跃度</th><th style="padding:12px 10px;text-align:center;">综合评分</th><th style="padding:12px 10px;text-align:center;">画像风险</th><th style="padding:12px 16px;text-align:center;">操作</th>
          </tr></thead><tbody>
          ${studentsData.map(s => {
            const name = s.student_name || s.real_name || s.username || '(未命名)'
            const classes = [...new Set((s.courses || []).map(c => c.class_name).filter(Boolean))]
            const metrics = s.metrics || {}
            const evaluation = s.evaluation || {}
            const comprehensiveScore = Math.round(Number(evaluation.comprehensive_score ?? metrics.comprehensive_score) || 0)
            const riskLevel = ['normal', 'attention', 'high'].includes(evaluation.risk_level || metrics.risk_level)
              ? (evaluation.risk_level || metrics.risk_level)
              : 'normal'
            const riskLabel = evaluation.risk_label || ({ normal: '正常', attention: '需要关注', high: '高风险' }[riskLevel])
            return `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:12px 16px;font-weight:500;"><div style="display:flex;align-items:center;gap:10px;"><div style="width:30px;height:30px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:600;">${name[0]}</div>${escapeHtml(name)}</div></td>
              <td style="padding:12px 16px;color:var(--text-secondary);">${s.student_no || '-'}</td>
              <td style="padding:12px 16px;color:var(--text-secondary);">${classes.join('、') || '-'}</td>
              <td style="padding:12px 16px;color:var(--text-secondary);font-size:0.82rem;">${s.college || ''}${s.major ? ' · ' + s.major : ''}</td>
              <td style="padding:12px 10px;text-align:center;">${metrics.mastery_score ?? 0}%</td>
              <td style="padding:12px 10px;text-align:center;">${metrics.homework_completion_rate ?? 0}%</td>
              <td style="padding:12px 10px;text-align:center;">${metrics.activity_count ?? 0}</td>
              <td style="padding:12px 10px;text-align:center;font-weight:600;">${comprehensiveScore} 分</td>
              <td style="padding:12px 10px;text-align:center;"><span class="tsp-risk-badge tsp-risk-${riskLevel}">${escapeHtml(riskLabel)}</span>${metrics.open_intervention_count ? `<small style="display:block;color:#b45309;margin-top:4px;">${metrics.open_intervention_count} 项干预</small>` : ''}</td>
              <td style="padding:12px 16px;text-align:center;white-space:nowrap;"><button class="stu-view" data-uid="${s.student_user_id ?? s.user_id}" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:0.8rem;">详情</button><button class="stu-edit" data-uid="${s.student_user_id ?? s.user_id}" style="padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:0.8rem;margin-left:4px;">编辑</button>
              <button class="stu-del" data-uid="${s.student_user_id ?? s.user_id}" data-name="${name}" style="padding:4px 10px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;margin-left:4px;">删除</button></td>
            </tr>`
          }).join('')}</tbody></table></div>`
      container.querySelectorAll('.stu-edit').forEach(b => { const uid = parseInt(b.dataset.uid); const s = studentsData.find(x => (x.student_user_id ?? x.user_id) === uid); b.addEventListener('click', () => openStuModal(s)) })
      container.querySelectorAll('.stu-view').forEach(b => b.addEventListener('click', () => { window.location.hash = `#/teacher/students/${b.dataset.uid}` }))
      container.querySelectorAll('.stu-del').forEach(b => { const uid = parseInt(b.dataset.uid); const name = b.dataset.name; b.addEventListener('click', () => openStuDelete(uid, name)) })
      updateStuPage()
    } catch (err) { container.innerHTML = `<div class="error-state"><div class="error-message">${err.message}</div></div>` }
  }

  function updateStuPage() {
    const pi = document.getElementById('stu-page-info')
    const prev = document.getElementById('stu-btn-prev')
    const next = document.getElementById('stu-btn-next')
    if (pi) pi.textContent = `第 ${stuPage} 页 / 共 ${stuTotalPages} 页`
    if (prev) prev.disabled = stuPage <= 1
    if (next) next.disabled = stuPage >= stuTotalPages
  }

  document.getElementById('stu-btn-search')?.addEventListener('click', () => { stuPage = 1; loadStudents() })
  document.getElementById('stu-btn-refresh')?.addEventListener('click', () => { stuPage = 1; loadStudents() })
  ;['stu-search-keyword', 'stu-search-no', 'stu-search-class'].forEach(id => document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') { stuPage = 1; loadStudents() } }))
  document.getElementById('stu-btn-prev')?.addEventListener('click', () => { if (stuPage > 1) { stuPage--; loadStudents() } })
  document.getElementById('stu-btn-next')?.addEventListener('click', () => { if (stuPage < stuTotalPages) { stuPage++; loadStudents() } })

  // 学生编辑弹窗
  function openStuModal(student) {
    const m = document.getElementById('stu-modal')
    const isEdit = !!student
    document.getElementById('stu-modal-title').textContent = isEdit ? '编辑学生' : '添加学生'
    document.getElementById('stu-f-username').value = student?.username || ''
    document.getElementById('stu-f-password').value = ''
    document.getElementById('stu-f-password').required = !isEdit
    document.getElementById('stu-f-realname').value = student?.student_name || student?.real_name || ''
    document.getElementById('stu-f-no').value = student?.student_no || ''
    document.getElementById('stu-f-college').value = student?.college || ''
    document.getElementById('stu-f-major').value = student?.major || ''
    document.getElementById('stu-f-grade').value = student?.grade || ''
    document.getElementById('stu-f-phone').value = student?.phone || ''
    document.getElementById('stu-f-email').value = student?.email || ''
    document.getElementById('stu-f-gender').value = (student?.gender || '').toLowerCase()
    m.dataset.editId = isEdit ? (student.student_user_id ?? student.user_id) : ''
    m.style.display = 'flex'
  }
  document.getElementById('stu-modal-close')?.addEventListener('click', () => document.getElementById('stu-modal').style.display = 'none')
  document.getElementById('stu-modal-cancel')?.addEventListener('click', () => document.getElementById('stu-modal').style.display = 'none')

  document.getElementById('stu-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const m = document.getElementById('stu-modal')
    const editId = m.dataset.editId
    const data = {
      real_name: document.getElementById('stu-f-realname').value.trim(),
      student_no: document.getElementById('stu-f-no').value.trim() || undefined,
      college: document.getElementById('stu-f-college').value.trim() || undefined,
      major: document.getElementById('stu-f-major').value.trim() || undefined,
      grade: document.getElementById('stu-f-grade').value.trim() || undefined,
      phone: document.getElementById('stu-f-phone').value.trim() || undefined,
      email: document.getElementById('stu-f-email').value.trim() || undefined,
      gender: document.getElementById('stu-f-gender').value || undefined,
    }
    if (!data.real_name) { alert('真实姓名不能为空'); return }
    try {
      if (editId) {
        await updateTeacherStudent(parseInt(editId), data)
      } else {
        const username = document.getElementById('stu-f-username').value.trim()
        const password = document.getElementById('stu-f-password').value.trim()
        if (!username || !password) { alert('用户名和密码为必填项'); return }
        await createTeacherStudent({ ...data, username, password })
      }
      m.style.display = 'none'
      loadStudents()
    } catch (err) { alert(err.message) }
  })

  document.getElementById('stu-btn-add')?.addEventListener('click', () => openStuModal(null))

  // 学生删除
  function openStuDelete(uid, name) {
    stuDeleteId = uid
    document.getElementById('stu-delete-text').textContent = `确定删除学生「${name}」吗？`
    document.getElementById('stu-delete-modal').style.display = 'flex'
  }
  document.getElementById('stu-del-cancel')?.addEventListener('click', () => { document.getElementById('stu-delete-modal').style.display = 'none'; stuDeleteId = null })
  document.getElementById('stu-del-confirm')?.addEventListener('click', async () => {
    if (!stuDeleteId) return
    try { await deleteTeacherStudent(stuDeleteId); document.getElementById('stu-delete-modal').style.display = 'none'; stuDeleteId = null; loadStudents() }
    catch (err) { alert(err.message); document.getElementById('stu-delete-modal').style.display = 'none'; stuDeleteId = null }
  })

  // 批量导入
  document.getElementById('stu-btn-import')?.addEventListener('click', () => {
    prepareStudentImport()
  })
  document.getElementById('stu-import-cancel')?.addEventListener('click', () => document.getElementById('stu-import-modal').style.display = 'none')

  function downloadCSVTemplate() {
    const BOM = '﻿'
    const headers = 'username,real_name,password,student_no,college,major,grade,gender,phone,email,class_name,course_name'
    const example = 'stu001,张三,123456,2024001,计算机与软件工程学院,软件工程,2024,male,13800000001,stu001@demo.com,软件2403班,机器学习'
    const blob = new Blob([BOM + headers + '\n' + example + '\n'], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'student_import_template.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }
  document.getElementById('stu-btn-export')?.addEventListener('click', downloadCSVTemplate)
  document.getElementById('stu-import-dl')?.addEventListener('click', downloadCSVTemplate)

  document.getElementById('stu-file-btn')?.addEventListener('click', () => document.getElementById('stu-file-input').click())
  document.getElementById('stu-dropzone')?.addEventListener('click', () => document.getElementById('stu-file-input').click())
  document.getElementById('stu-file-input')?.addEventListener('change', function() {
    if (!this.files.length) return
    const file = this.files[0]
    if (!file.name.endsWith('.csv')) { alert('请上传 CSV 文件'); return }
    document.getElementById('stu-file-info').style.display = 'block'
    document.getElementById('stu-file-info').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`
    const reader = new FileReader()
    reader.onload = (e) => {
      const lines = e.target.result.split('\n').filter(l => l.trim())
      if (lines.length < 2) { alert('需要表头和至少一行数据'); return }
      const hdrs = lines[0].replace(/^﻿/, '').split(',').map(h => h.trim().toLowerCase())
      if (!hdrs.includes('username') || !hdrs.includes('real_name')) { alert('模板缺少 username 或 real_name 字段'); return }
      const data = []
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim())
        const row = {}
        hdrs.forEach((h, idx) => { row[h] = vals[idx] || '' })
        if (row.username || row.real_name) data.push(row)
      }
      if (!data.length) { alert('无有效数据'); return }
      stuImportData = data
      document.getElementById('stu-import-submit').disabled = false
      document.getElementById('stu-import-submit').style.opacity = '1'
      document.getElementById('stu-import-submit').textContent = `导入（${data.length} 条）`
      document.getElementById('stu-import-preview').style.display = 'block'
      document.getElementById('stu-import-preview').innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
        <thead><tr style="background:#f8f9fa;"><th style="padding:4px 8px;">用户名</th><th style="padding:4px 8px;">姓名</th><th style="padding:4px 8px;">学号</th><th style="padding:4px 8px;">班级</th></tr></thead>
        <tbody>${data.slice(0, 15).map(r => `<tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);">${escapeHtml(r.username)}</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);">${escapeHtml(r.real_name)}</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);">${escapeHtml(r.student_no || '')}</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);">${escapeHtml(r.class_name || '')}</td></tr>`).join('')}
        ${data.length > 15 ? `<tr><td colspan="4" style="padding:8px;text-align:center;color:var(--text-muted);">... 还有 ${data.length - 15} 条</td></tr>` : ''}
        </tbody></table>`
    }
    reader.readAsText(file)
  })

  document.getElementById('stu-import-submit')?.addEventListener('click', async () => {
    if (!stuImportData.length) return
    const teachingClassId = Number(document.getElementById('stu-import-class').value)
    if (!teachingClassId) { alert('请选择目标教学班'); return }
    const btn = document.getElementById('stu-import-submit')
    btn.disabled = true; btn.textContent = '导入中...'
    try {
      const res = await batchImportStudents({ teaching_class_id: teachingClassId, students: stuImportData })
      const result = res.data || res
      const html = result.fail_count === 0
        ? `<div style="color:#065f46;background:#d1fae5;padding:12px;border-radius:8px;font-weight:500;">成功 ${result.success_count} 条${result.fail_count > 0 ? `，失败 ${result.fail_count} 条` : ''}</div>`
        : `<div style="color:#92400e;background:#fef3c7;padding:12px;border-radius:8px;margin-bottom:8px;">成功 ${result.success_count} 条，失败 ${result.fail_count} 条</div>`
        + `<div style="max-height:180px;overflow-y:auto;font-size:0.82rem;">${(result.results || []).filter(r => !r.success).map(r => `<div style="color:#dc2626;padding:4px 0;">第${r.row}行: ${r.reason}</div>`).join('')}</div>`
      document.getElementById('stu-import-result').innerHTML = html
      document.getElementById('stu-import-result').style.display = 'block'
      if (result.success_count > 0) { loadStudents(); loadClasses() }
    } catch (err) { document.getElementById('stu-import-result').innerHTML = `<div style="color:#dc2626;">${escapeHtml(err.message)}</div>`; document.getElementById('stu-import-result').style.display = 'block' }
    finally { btn.disabled = false; btn.textContent = `导入（${stuImportData.length} 条）` }
  })

  // ============================
  // 课程管理
  // ============================
  let coursesData = []
  let editingCourseId = null

  async function loadCourses() {
    const container = document.getElementById('co-list-container')
    if (!container) return
    container.innerHTML = '<div class="empty-hint">加载中...</div>'
    try {
      const kw = document.getElementById('co-search-keyword')?.value || ''
      const res = await getTeacherCourses({ keyword: kw })
      coursesData = res.data.list || []
      if (!coursesData.length) { container.innerHTML = '<div class="empty-hint" style="padding:60px 0;">暂无课程</div>'; return }
      container.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
        ${coursesData.map(c => `<div class="card" style="padding:18px;cursor:pointer;border-left:4px solid var(--primary);" data-cid="${c.course_id}">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
            <h4 style="font-size:1rem;font-weight:600;color:var(--stu-dark);margin:0;">${escapeHtml(c.course_name)}</h4>
            <span style="background:${c.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${c.status === 'active' ? '#065f46' : '#92400e'};padding:2px 10px;border-radius:12px;font-size:0.75rem;white-space:nowrap;">${c.status === 'active' ? '进行中' : '已归档'}</span>
          </div>
          <div style="color:var(--text-secondary);font-size:0.85rem;">
            <div>编码：${c.course_code || '-'}</div>
            <div>分类：${c.subject_category || '-'}</div>
            ${c.description ? `<div style="margin-top:4px;color:var(--text-muted);font-size:0.82rem;">${escapeHtml(c.description.substring(0, 60))}</div>` : ''}
          </div>
          <div style="display:flex;gap:16px;font-size:0.8rem;color:var(--text-muted);padding-top:10px;border-top:1px solid var(--border);margin-top:10px;">
            <span>${c.teaching_class_count || 0} 个班级</span><span>${c.student_count || 0} 名学生</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="co-edit" data-cid="${c.course_id}" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:0.85rem;">编辑</button>
            <button class="co-del" data-cid="${c.course_id}" style="flex:1;padding:6px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.85rem;">删除</button>
          </div>
        </div>`).join('')}</div>`
      container.querySelectorAll('.card[data-cid]').forEach(el => el.addEventListener('click', e => { if (e.target.closest('button')) return; window.location.hash = `#/teacher/courses/${el.dataset.cid}` }))
      container.querySelectorAll('.co-edit').forEach(b => { const cid = parseInt(b.dataset.cid); const c = coursesData.find(x => x.course_id === cid); b.addEventListener('click', e => { e.stopPropagation(); openCourseModal(c) }) })
      container.querySelectorAll('.co-del').forEach(b => { const cid = parseInt(b.dataset.cid); b.addEventListener('click', async e => { e.stopPropagation(); if (!confirm('确定删除？')) return; try { await deleteTeacherCourse(cid); loadCourses() } catch (err) { alert(err.message) } }) })
    } catch (err) { container.innerHTML = `<div class="error-state"><div class="error-message">${err.message}</div></div>` }
  }

  function openCourseModal(course) {
    editingCourseId = course?.course_id || null
    document.getElementById('co-modal-title').textContent = course ? '编辑课程' : '新建课程'
    document.getElementById('co-f-name').value = course?.course_name || ''
    document.getElementById('co-f-code').value = course?.course_code || ''
    document.getElementById('co-f-category').value = course?.subject_category || ''
    document.getElementById('co-f-desc').value = course?.description || ''
    document.getElementById('co-modal').style.display = 'flex'
  }
  document.getElementById('co-modal-close')?.addEventListener('click', () => document.getElementById('co-modal').style.display = 'none')
  document.getElementById('co-modal-cancel')?.addEventListener('click', () => document.getElementById('co-modal').style.display = 'none')
  document.getElementById('co-btn-create')?.addEventListener('click', () => openCourseModal())

  document.getElementById('co-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = { course_name: document.getElementById('co-f-name').value.trim(), course_code: document.getElementById('co-f-code').value.trim(), subject_category: document.getElementById('co-f-category').value.trim(), description: document.getElementById('co-f-desc').value.trim() }
    if (!data.course_name || !data.course_code) { alert('请填写课程名称和编码'); return }
    try {
      if (editingCourseId) await updateTeacherCourse(editingCourseId, data)
      else await createTeacherCourse(data)
      document.getElementById('co-modal').style.display = 'none'; loadCourses()
    } catch (err) { alert(err.message) }
  })
  document.getElementById('co-btn-search')?.addEventListener('click', loadCourses)
  document.getElementById('co-btn-refresh')?.addEventListener('click', loadCourses)
  document.getElementById('co-search-keyword')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadCourses() })

  // ============================
  // 侧边栏偏移适配
  // ============================
  function adjustFixedBar() {
    const bar = document.getElementById('systab-bar')
    if (!bar) return
    const sidebar = document.getElementById('student-sidebar')
    if (sidebar) {
      const w = sidebar.classList.contains('collapsed') ? 80 : 250
      bar.style.left = (w + 28) + 'px'
    }
  }
  adjustFixedBar()
  // 监听侧边栏状态变化
  const obs = new MutationObserver(adjustFixedBar)
  const sidebar = document.getElementById('student-sidebar')
  if (sidebar) obs.observe(sidebar, { attributes: true, attributeFilter: ['class'] })

  // ============================
  // 初始化
  // ============================
  initAllAutoResize()
  loadCourseSelects()
  loadClasses()
}
