# 管理端静态 UI 回归结果

> 该文件由 `python scripts/admin_ui_regression_check.py` 确定性生成；不包含时间戳、随机值或运行时凭据。

## 结论

**WARN** — 9 项通过，2 项警告，0 项失败。

`FAIL` 是发布阻断项；`WARN` 仅记录尚未迁移的遗留标记，不会被误报为关键失败。该检查是静态回归门禁，不能替代真实登录、网络面板与多分辨率浏览器验收。

## 路由覆盖

发现 **25** 条管理端路由（24 条静态，1 条动态）。

| Route | Kind | Renderer | Module | Guard | Status |
|---|---|---|---|---|---|
| `/admin/agent-reviews` | static | `renderAdminAgentReviews` | `frontend/src/pages/admin-agent-reviews.js` | auth + admin | PASS |
| `/admin/agents` | static | `renderAdminAiConfig` | `frontend/src/pages/admin-ai-config.js` | auth + admin | PASS |
| `/admin/ai-config` | static | `renderAdminAiConfig` | `frontend/src/pages/admin-ai-config.js` | auth + admin | PASS |
| `/admin/assets` | static | `renderAdminAssets` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/classes` | static | `renderAdminClasses` | `frontend/src/pages/admin-classes.js` | auth + admin | PASS |
| `/admin/courses` | static | `renderAdminCourses` | `frontend/src/pages/admin-courses.js` | auth + admin | PASS |
| `/admin/courses/:course_id` | dynamic | `renderAdminCourseDetail` | `frontend/src/pages/admin-course-detail.js` | auth + admin | PASS |
| `/admin/dashboard` | static | `renderAdminDashboard` | `frontend/src/pages/admin-dashboard.js` | auth + admin | PASS |
| `/admin/digital-twin` | static | `renderAdminDigitalTwin` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/environment` | static | `renderAdminAiConfig` | `frontend/src/pages/admin-ai-config.js` | auth + admin | PASS |
| `/admin/evaluations` | static | `renderAdminEvaluations` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/experiments` | static | `renderAdminExperiments` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/knowledge` | static | `renderAdminKnowledge` | `frontend/src/pages/admin-knowledge.js` | auth + admin | PASS |
| `/admin/knowledge-health` | static | `renderAdminKnowledgeHealth` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/learning-flows` | static | `renderAdminLearningFlows` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/logs` | static | `renderAdminLogs` | `frontend/src/pages/admin-logs.js` | auth + admin | PASS |
| `/admin/notifications` | static | `renderAdminNotifications` | `frontend/src/pages/admin-notifications.js` | auth + admin | PASS |
| `/admin/permissions` | static | `renderAdminPermissions` | `frontend/src/pages/admin-permissions.js` | auth + admin | PASS |
| `/admin/profile` | static | `renderAdminProfile` | `frontend/src/pages/admin-profile.js` | auth + admin | PASS |
| `/admin/risks` | static | `renderAdminRisks` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/strategy-profiles` | static | `renderAdminStrategyProfiles` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/teaching-classes` | static | `renderAdminTeachingClasses` | `frontend/src/pages/admin-teaching-classes.js` | auth + admin | PASS |
| `/admin/teaching-issues` | static | `renderAdminTeachingIssues` | `frontend/src/pages/admin-governance.js` | auth + admin | PASS |
| `/admin/traces` | static | `renderAdminTraces` | `frontend/src/pages/admin-traces.js` | auth + admin | PASS |
| `/admin/users` | static | `renderAdminUsers` | `frontend/src/pages/admin-users.js` | auth + admin | PASS |

## 检查项

### PASS `inputs.required-files` — Required regression inputs

All required router, shell, page, API, and stylesheet sources exist.

### PASS `routes.discovery` — Admin route discovery

Every required static and dynamic admin route is discoverable.

- Discovered 24 static and 1 dynamic admin routes.

### PASS `routes.guards` — Admin route guards

All discovered admin routes require authentication and the admin role.

### PASS `routes.renderers` — Route renderer imports and exports

All 23 unique route renderers resolve to exported functions.

### PASS `shell.shared-layout` — Restored shared dashboard shell

Admin pages use the student/teacher shared dashboard structure with scoped purple tokens.

- `frontend/src/main.js` imports `admin.css` and has no active `admin-v2.css` import.
- Every routed admin page module calls `renderDashboardLayout` or `renderAdminPage`.
- The shared wrapper emits `student-dashboard-wrapper role-admin` for administrators.

### PASS `dashboard.contract-v1` — Dashboard v1 normalization and guard

Dashboard data is normalized at the API boundary and structurally guarded before use.

- Contract: `admin-dashboard.v1`.
- Required structures: `summary`, `system_status`, `service_health.services`, `module_errors`, and `recent_events`.
- Legacy responses are explicitly degraded instead of being presented as healthy.

### PASS `sources.no-silent-fakes` — Active admin source integrity

No native dialogs, random/mock data, or catch-to-empty fallbacks are present in active admin sources.

### PASS `styles.responsive-shell` — Responsive shared-shell invariants

Desktop, tablet, and mobile layout selectors prevent sidebar overlap and horizontal overflow.

- Desktop: 769px and wider uses a fixed overlay sidebar while main-content geometry stays invariant.
- Tablet: admin refinements are present at 900px.
- Mobile: the shared 768px bottom-navigation layout and content clearance remain active.

### PASS `pages.async-states` — Dashboard and notification async states

Dashboard and notifications expose loading, error, empty, and retry behavior.

- `dashboard`: loading, error, empty, retry.
- `notifications`: loading, error, empty, retry.

### WARN `markup.unclassed-controls` — Native controls without classes

95 legacy native control(s) lack a class; retained as migration warnings.

### WARN `markup.inline-styles` — Inline style attributes

239 inline style attribute(s) remain; retained as migration warnings.

## 遗留标记清单

### 无 class 的原生控件（WARN）

Total: **95**. Counts remain warnings and do not conceal critical failures.

| File | Count |
|---|---:|
| `frontend/src/pages/admin-ai-config.js` | 5 |
| `frontend/src/pages/admin-classes.js` | 1 |
| `frontend/src/pages/admin-course-detail.js` | 20 |
| `frontend/src/pages/admin-courses.js` | 11 |
| `frontend/src/pages/admin-dashboard.js` | 2 |
| `frontend/src/pages/admin-knowledge.js` | 7 |
| `frontend/src/pages/admin-logs.js` | 7 |
| `frontend/src/pages/admin-notifications.js` | 5 |
| `frontend/src/pages/admin-permissions.js` | 2 |
| `frontend/src/pages/admin-profile.js` | 1 |
| `frontend/src/pages/admin-teaching-classes.js` | 2 |
| `frontend/src/pages/admin-users.js` | 30 |
| `frontend/src/utils/admin-ui.js` | 2 |

First 20 deterministic findings:

- `frontend/src/pages/admin-ai-config.js:133` — unclassed <input>: `return `<div class="admin-form-grid"><div class="admin-field"><label>供应商类型 <span class="required">*</span></label><sele…`
- `frontend/src/pages/admin-ai-config.js:160` — unclassed <input>: `return `<div class="admin-form-grid"><div class="admin-field"><label>供应商 <span class="required">*</span></label><select…`
- `frontend/src/pages/admin-ai-config.js:160` — unclassed <input>: `return `<div class="admin-form-grid"><div class="admin-field"><label>供应商 <span class="required">*</span></label><select…`
- `frontend/src/pages/admin-ai-config.js:160` — unclassed <input>: `return `<div class="admin-form-grid"><div class="admin-field"><label>供应商 <span class="required">*</span></label><select…`
- `frontend/src/pages/admin-ai-config.js:171` — unclassed <input>: `return `<div class="admin-form-grid">${item.id ? '' : '<div class="admin-field"><label>Agent Key <span class="required"…`
- `frontend/src/pages/admin-classes.js:157` — unclassed <input>: `const candidateRows = candidates.length ? candidates.map((entry) => `<label class="admin-choice"><input type="checkbox"…`
- `frontend/src/pages/admin-course-detail.js:242` — unclassed <select>: `<select id="kp-chapter-filter" style="padding:6px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.85r…`
- `frontend/src/pages/admin-course-detail.js:286` — unclassed <form>: `<form id="course-edit-form">`
- `frontend/src/pages/admin-course-detail.js:289` — unclassed <input>: `<input type="text" id="edit-course-name" required value="${escapeHtml(course.course_name)}">`
- `frontend/src/pages/admin-course-detail.js:293` — unclassed <input>: `<input type="text" id="edit-course-code" required value="${escapeHtml(course.course_code)}">`
- `frontend/src/pages/admin-course-detail.js:297` — unclassed <input>: `<input type="text" id="edit-subject-category" value="${escapeHtml(course.subject_category \|\| '')}">`
- `frontend/src/pages/admin-course-detail.js:315` — unclassed <form>: `<form id="chapter-form">`
- `frontend/src/pages/admin-course-detail.js:318` — unclassed <input>: `<input type="text" id="form-chapter-name" required placeholder="例如：第一章 基础知识">`
- `frontend/src/pages/admin-course-detail.js:322` — unclassed <input>: `<input type="number" id="form-chapter-order" min="0" step="1" placeholder="例如：1">`
- `frontend/src/pages/admin-course-detail.js:340` — unclassed <form>: `<form id="kp-form">`
- `frontend/src/pages/admin-course-detail.js:343` — unclassed <select>: `<select id="form-kp-chapter" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8…`
- `frontend/src/pages/admin-course-detail.js:350` — unclassed <input>: `<input type="text" id="form-kp-name" required placeholder="例如：线性回归">`
- `frontend/src/pages/admin-course-detail.js:354` — unclassed <input>: `<input type="text" id="form-kp-code" required placeholder="例如：LR001">`
- `frontend/src/pages/admin-course-detail.js:358` — unclassed <select>: `<select id="form-kp-difficulty" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;fon…`
- `frontend/src/pages/admin-course-detail.js:370` — unclassed <input>: `<input type="text" id="form-kp-aliases" placeholder="例如：线性回归模型, LR">`
- … 75 additional finding(s) are represented in the per-file counts above.

### 内联 style 属性（WARN）

Total: **239**. Counts remain warnings and do not conceal critical failures.

| File | Count |
|---|---:|
| `frontend/src/pages/admin-course-detail.js` | 137 |
| `frontend/src/pages/admin-courses.js` | 13 |
| `frontend/src/pages/admin-dashboard.js` | 5 |
| `frontend/src/pages/admin-governance.js` | 1 |
| `frontend/src/pages/admin-knowledge.js` | 2 |
| `frontend/src/pages/admin-logs.js` | 3 |
| `frontend/src/pages/admin-profile.js` | 9 |
| `frontend/src/pages/admin-users.js` | 69 |

First 20 deterministic findings:

- `frontend/src/pages/admin-course-detail.js:89` — inline style: `<div style="margin-bottom:20px;">`
- `frontend/src/pages/admin-course-detail.js:171` — inline style: `<div style="margin-bottom:20px;">`
- `frontend/src/pages/admin-course-detail.js:178` — inline style: `<div class="card" style="margin-bottom:20px;padding:20px;">`
- `frontend/src/pages/admin-course-detail.js:179` — inline style: `<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">`
- `frontend/src/pages/admin-course-detail.js:180` — inline style: `<div style="flex:1;min-width:0;">`
- `frontend/src/pages/admin-course-detail.js:181` — inline style: `<h2 style="font-size:1.3rem;font-weight:700;color:var(--stu-dark);margin:0 0 6px;">`
- `frontend/src/pages/admin-course-detail.js:184` — inline style: `<div style="color:var(--text-secondary);font-size:0.85rem;">`
- `frontend/src/pages/admin-course-detail.js:186` — inline style: `<span style="margin:0 10px;">\|</span>`
- `frontend/src/pages/admin-course-detail.js:188` — inline style: `<span style="background:${course.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${course.status === 'active' ? '#06…`
- `frontend/src/pages/admin-course-detail.js:193` — inline style: `${course.description ? `<div style="color:var(--text-muted);font-size:0.85rem;margin-top:6px;">${escapeHtml(course.desc…`
- `frontend/src/pages/admin-course-detail.js:195` — inline style: `<div style="display:flex;gap:10px;flex-shrink:0;">`
- `frontend/src/pages/admin-course-detail.js:196` — inline style: `${canManage ? '<button class="btn btn-primary" id="btn-edit-course-info" style="font-size:0.85rem;padding:6px 14px;">编辑…`
- `frontend/src/pages/admin-course-detail.js:199` — inline style: `<div style="display:flex;gap:20px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:0.85rem…`
- `frontend/src/pages/admin-course-detail.js:208` — inline style: `<div class="tabs-nav" style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px;">`
- `frontend/src/pages/admin-course-detail.js:209` — inline style: `<button class="tab-btn active" data-tab="chapters" style="padding:10px 22px;border:none;background:none;font-size:0.95r…`
- `frontend/src/pages/admin-course-detail.js:212` — inline style: `<button class="tab-btn" data-tab="knowledge" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;fon…`
- `frontend/src/pages/admin-course-detail.js:215` — inline style: `<button class="tab-btn" data-tab="classes" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-…`
- `frontend/src/pages/admin-course-detail.js:218` — inline style: `<button class="tab-btn" data-tab="files" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-we…`
- `frontend/src/pages/admin-course-detail.js:221` — inline style: `<button class="tab-btn" data-tab="teachers" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font…`
- `frontend/src/pages/admin-course-detail.js:227` — inline style: `<div class="tab-content" id="tab-chapters" style="display:block;">`
- … 219 additional finding(s) are represented in the per-file counts above.

## 活跃源码扫描范围

禁止模式扫描覆盖全部路由实际引用的管理页面，以及管理端 API、菜单和 UI 辅助模块：

- `frontend/src/api/admin.js`
- `frontend/src/pages/admin-agent-reviews.js`
- `frontend/src/pages/admin-ai-config.js`
- `frontend/src/pages/admin-classes.js`
- `frontend/src/pages/admin-course-detail.js`
- `frontend/src/pages/admin-courses.js`
- `frontend/src/pages/admin-dashboard.js`
- `frontend/src/pages/admin-governance.js`
- `frontend/src/pages/admin-knowledge.js`
- `frontend/src/pages/admin-logs.js`
- `frontend/src/pages/admin-notifications.js`
- `frontend/src/pages/admin-permissions.js`
- `frontend/src/pages/admin-profile.js`
- `frontend/src/pages/admin-teaching-classes.js`
- `frontend/src/pages/admin-traces.js`
- `frontend/src/pages/admin-users.js`
- `frontend/src/utils/admin-menu.js`
- `frontend/src/utils/admin-ui.js`

## 复现

```powershell
python scripts/admin_ui_regression_check.py
python scripts/admin_ui_regression_check.py --check
```

默认命令重写本报告；`--check` 不写文件，并在报告过期时返回非零。任一关键检查失败时，两种模式都会返回非零。
