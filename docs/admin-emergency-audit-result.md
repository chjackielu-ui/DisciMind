# DisciMind 管理端紧急审计结果

> 由 `python scripts/admin_emergency_audit.py --output docs/admin-emergency-audit-result.md` 生成。
> 本报告是静态证据清单；接口 2xx、鉴权、数据库结果和浏览器渲染仍需真实运行验证。

## 摘要

| 项目 | 数量 |
| --- | --- |
| 管理端页面 | 15 |
| 前端管理端路由引用 | 25 |
| 前端 Admin API 方法 | 79 |
| 后端 `/api/admin` 路由 | 82 |
| 管理端样式文件 | 2 |
| 当前入口实际加载的管理端样式 | 1 |
| 管理端后端 Controller/Service/Route 文件 | 29 |
| 原生控件标签 | 236 |
| 无 class 控件风险 | 81 |
| 内联样式 | 226 |
| 静默空数据回退 | 0 |
| Mock/随机/开发中标记 | 0 |
| 硬编码统计展示候选 | 0 |
| 原生对话框调用 | 0 |
| Emoji | 0 |

## 管理端前端路由

| 路由/引用 | 渲染函数或来源 |
| --- | --- |
| /admin/agent-reviews | renderAdminAgentReviews |
| /admin/agents | renderAdminAiConfig |
| /admin/ai-config | renderAdminAiConfig |
| /admin/assets | renderAdminAssets |
| /admin/classes | renderAdminClasses |
| /admin/courses | renderAdminCourses |
| /admin/courses/:course_id | renderAdminCourseDetail |
| /admin/dashboard | renderAdminDashboard |
| /admin/digital-twin | renderAdminDigitalTwin |
| /admin/environment | renderAdminAiConfig |
| /admin/evaluations | renderAdminEvaluations |
| /admin/experiments | renderAdminExperiments |
| /admin/knowledge | renderAdminKnowledge |
| /admin/knowledge-health | renderAdminKnowledgeHealth |
| /admin/learning-flows | renderAdminLearningFlows |
| /admin/logs | renderAdminLogs |
| /admin/notifications | renderAdminNotifications |
| /admin/permissions | renderAdminPermissions |
| /admin/profile | renderAdminProfile |
| /admin/risks | renderAdminRisks |
| /admin/strategy-profiles | renderAdminStrategyProfiles |
| /admin/teaching-classes | renderAdminTeachingClasses |
| /admin/teaching-issues | renderAdminTeachingIssues |
| /admin/traces | renderAdminTraces |
| /admin/users | renderAdminUsers |

## 管理端页面

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

## 管理端前端 API 与后端字面路径匹配

| 前端方法 | HTTP | 前端路径 | 静态匹配 |
| --- | --- | --- | --- |
| addAdminClassStudents | POST | /admin/admin-classes/${classId}/students | 已匹配 |
| addTeachingClassStudents | POST | /admin/teaching-classes/${classId}/students | 已匹配 |
| bindCourseTeacher | POST | /admin/courses/${courseId}/teachers | 已匹配 |
| clearAiProviderSecret | POST | /admin/ai/providers/${id}/clear-secret | 已匹配 |
| createAdminAgent | POST | /admin/agents | 已匹配 |
| createAdminClass | POST | /admin/admin-classes | 已匹配 |
| createAdminCourse | POST | /admin/courses | 已匹配 |
| createAdminNotification | POST | /admin/notifications | 已匹配 |
| createAdminUser | POST | /admin/users | 已匹配 |
| createAiModel | POST | /admin/ai/models | 已匹配 |
| createAiModelConfig | POST | /admin/ai-model-configs | 已匹配 |
| createAiProvider | POST | /admin/ai/providers | 已匹配 |
| createChapter | POST | /admin/courses/${courseId}/chapters | 已匹配 |
| createKnowledgePoint | POST | /admin/knowledge-points | 已匹配 |
| createTeachingClass | POST | /admin/courses/${courseId}/teaching-classes | 已匹配 |
| deleteAdminClass | DELETE | /admin/admin-classes/${classId} | 已匹配 |
| deleteAdminCourse | DELETE | /admin/courses/${courseId} | 已匹配 |
| deleteChapter | DELETE | /admin/chapters/${chapterId} | 已匹配 |
| deleteKnowledgePoint | DELETE | /admin/knowledge-points/${kpId} | 已匹配 |
| deleteTeachingClass | DELETE | /admin/teaching-classes/${classId} | 已匹配 |
| deleteUser | DELETE | /admin/users/${userId} | 已匹配 |
| getAdminAccess | GET | /admin/rbac/me | 已匹配 |
| getAdminAgent | GET | /admin/agents/${id} | 已匹配 |
| getAdminAgents | GET | /admin/agents | 已匹配 |
| getAdminClassStudents | GET | /admin/admin-classes/${classId}/students | 已匹配 |
| getAdminClasses | GET | /admin/admin-classes | 已匹配 |
| getAdminCourseDetail | GET | /admin/courses/${courseId} | 已匹配 |
| getAdminCourses | GET | /admin/courses | 已匹配 |
| getAdminEnvironmentStatus | GET | /admin/system/environment-status | 已匹配 |
| getAdminKnowledgeDocuments | GET | /admin/knowledge-documents | 已匹配 |
| getAdminNotifications | GET | /admin/notifications | 已匹配 |
| getAdminRbacOverview | GET | /admin/rbac/overview | 已匹配 |
| getAdminTrace | GET | /admin/traces/${id} | 已匹配 |
| getAdminTraces | GET | /admin/traces | 已匹配 |
| getAdminUsers | GET | /admin/users | 已匹配 |
| getAiCallLogs | GET | /admin/ai-call-logs | 已匹配 |
| getAiModel | GET | /admin/ai/models/${id} | 已匹配 |
| getAiModelConfigs | GET | /admin/ai-model-configs | 已匹配 |
| getAiModels | GET | /admin/ai/models | 已匹配 |
| getAiProvider | GET | /admin/ai/providers/${id} | 已匹配 |
| getAiProviders | GET | /admin/ai/providers | 已匹配 |
| getCourseChapters | GET | /admin/courses/${courseId}/chapters | 已匹配 |
| getCourseKnowledgePoints | GET | /admin/courses/${courseId}/knowledge-points | 已匹配 |
| getGovernanceList | GET | /admin/governance/${module} | 已匹配 |
| getGovernanceOverview | GET | /admin/governance/${module}/overview | 已匹配 |
| getOperationLogs | GET | /admin/operation-logs | 已匹配 |
| getTeachingClassPage | GET | /admin/teaching-classes | 已匹配 |
| getTeachingClassStudents | GET | /admin/teaching-classes/${classId}/students | 已匹配 |
| getTeachingClasses | GET | /admin/courses/${courseId}/teaching-classes | 已匹配 |
| markAdminTraceRisk | POST | /admin/traces/${id}/mark-risk | 已匹配 |
| markAllNotificationsRead | PUT | /admin/notifications/read-all | 已匹配 |
| markNotificationRead | PUT | /admin/notifications/${notificationId}/read | 已匹配 |
| publishAdminAgent | POST | /admin/agents/${id}/publish | 已匹配 |
| removeAdminClassStudent | DELETE | /admin/admin-classes/${classId}/students/${studentUserId} | 已匹配 |
| removeTeachingClassStudent | DELETE | /admin/teaching-classes/${classId}/students/${studentUserId} | 已匹配 |
| replaceAiProviderSecret | POST | /admin/ai/providers/${id}/replace-secret | 已匹配 |
| resetUserPassword | PUT | /admin/users/${userId}/password | 已匹配 |
| reviewKnowledgeDocument | PUT | /admin/knowledge-documents/${documentId}/review | 已匹配 |
| rollbackAdminAgent | POST | /admin/agents/${id}/rollback | 已匹配 |
| runGovernanceAction | POST | /admin/governance/${module}/actions/${action} | 已匹配 |
| setAiModelEnabled | POST | /admin/ai/models/${id}/${enabled ? 'enable' : 'disable'} | 需人工核对 |
| setAiProviderEnabled | POST | /admin/ai/providers/${id}/${enabled ? 'enable' : 'disable'} | 需人工核对 |
| setDefaultAiModel | POST | /admin/ai/models/${id}/set-default | 已匹配 |
| testAdminAgent | POST | /admin/agents/${id}/test | 已匹配 |
| testAiModel | POST | /admin/ai/models/${id}/test | 已匹配 |
| testAiProvider | POST | /admin/ai/providers/${id}/test | 已匹配 |
| unbindCourseTeacher | DELETE | /admin/courses/${courseId}/teachers/${teacherUserId} | 已匹配 |
| updateAdminAgent | PUT | /admin/agents/${id} | 已匹配 |
| updateAdminClass | PUT | /admin/admin-classes/${classId} | 已匹配 |
| updateAdminCourse | PUT | /admin/courses/${courseId} | 已匹配 |
| updateAdminRolePermissions | PUT | /admin/rbac/roles/${roleCode}/permissions | 已匹配 |
| updateAdminUser | PUT | /admin/users/${userId} | 已匹配 |
| updateAdminUserRoles | PUT | /admin/rbac/users/${userId}/roles | 已匹配 |
| updateAiModel | PUT | /admin/ai/models/${id} | 已匹配 |
| updateAiProvider | PUT | /admin/ai/providers/${id} | 已匹配 |
| updateChapter | PUT | /admin/chapters/${chapterId} | 已匹配 |
| updateKnowledgePoint | PUT | /admin/knowledge-points/${kpId} | 已匹配 |
| updateTeachingClass | PUT | /admin/teaching-classes/${classId} | 已匹配 |
| updateUserStatus | PUT | /admin/users/${userId}/status | 已匹配 |

## 已挂载的后端管理路由

| HTTP | 完整路径 | 中间件/处理器 |
| --- | --- | --- |
| GET | /api/admin/dashboard | requireAdminPermission('admin.dashboard.view'), dashboardController.getDashboard |
| GET | /api/admin/users | requireAdminPermission('admin.users.view'), userController.getUserList |
| POST | /api/admin/users | requireAdminPermission('admin.users.manage'), userController.createUser |
| PUT | /api/admin/users/:user_id/status | requireAdminPermission('admin.users.manage'), userController.updateUserStatus |
| PUT | /api/admin/users/:user_id/password | requireAdminPermission('admin.users.manage'), userController.resetUserPassword |
| PUT | /api/admin/users/:user_id | requireAdminPermission('admin.users.manage'), userController.updateUser |
| DELETE | /api/admin/users/:user_id | requireAdminPermission('admin.users.manage'), userController.deleteUser |
| GET | /api/admin/courses | requireAdminPermission('admin.teaching.view'), courseController.getCourseList |
| POST | /api/admin/courses | requireAdminPermission('admin.teaching.manage'), courseController.createCourse |
| GET | /api/admin/courses/:course_id | requireAdminPermission('admin.teaching.view'), courseController.getCourseDetail |
| PUT | /api/admin/courses/:course_id | requireAdminPermission('admin.teaching.manage'), courseController.updateCourse |
| DELETE | /api/admin/courses/:course_id | requireAdminPermission('admin.teaching.manage'), courseController.deleteCourse |
| POST | /api/admin/courses/:course_id/teachers | requireAdminPermission('admin.teaching.manage'), courseController.bindTeacher |
| DELETE | /api/admin/courses/:course_id/teachers/:teacher_user_id | requireAdminPermission('admin.teaching.manage'), courseController.unbindTeacher |
| GET | /api/admin/courses/:course_id/chapters | requireAdminPermission('admin.teaching.view'), courseController.getChapterList |
| POST | /api/admin/courses/:course_id/chapters | requireAdminPermission('admin.teaching.manage'), courseController.createChapter |
| PUT | /api/admin/chapters/:chapter_id | requireAdminPermission('admin.teaching.manage'), courseController.updateChapter |
| DELETE | /api/admin/chapters/:chapter_id | requireAdminPermission('admin.teaching.manage'), courseController.deleteChapter |
| GET | /api/admin/courses/:course_id/knowledge-points | requireAdminPermission('admin.teaching.view'), courseController.getKnowledgePointList |
| POST | /api/admin/knowledge-points | requireAdminPermission('admin.teaching.manage'), courseController.createKnowledgePoint |
| PUT | /api/admin/knowledge-points/:knowledge_point_id | requireAdminPermission('admin.teaching.manage'), courseController.updateKnowledgePoint |
| DELETE | /api/admin/knowledge-points/:knowledge_point_id | requireAdminPermission('admin.teaching.manage'), courseController.deleteKnowledgePoint |
| GET | /api/admin/admin-classes | requireAdminPermission('admin.teaching.view'), classController.getAdminClassList |
| POST | /api/admin/admin-classes | requireAdminPermission('admin.teaching.manage'), classController.createAdminClass |
| PUT | /api/admin/admin-classes/:admin_class_id | requireAdminPermission('admin.teaching.manage'), classController.updateAdminClass |
| DELETE | /api/admin/admin-classes/:admin_class_id | requireAdminPermission('admin.teaching.manage'), classController.deleteAdminClass |
| GET | /api/admin/admin-classes/:admin_class_id/students | requireAdminPermission('admin.teaching.view'), classController.getAdminClassStudentList |
| POST | /api/admin/admin-classes/:admin_class_id/students | requireAdminPermission('admin.teaching.manage'), classController.addAdminClassStudents |
| DELETE | /api/admin/admin-classes/:admin_class_id/students/:student_user_id | requireAdminPermission('admin.teaching.manage'), classController.removeAdminClassStudent |
| GET | /api/admin/teaching-classes | requireAdminPermission('admin.teaching.view'), classController.getTeachingClassPage |
| GET | /api/admin/courses/:course_id/teaching-classes | requireAdminPermission('admin.teaching.view'), classController.getTeachingClassList |
| POST | /api/admin/courses/:course_id/teaching-classes | requireAdminPermission('admin.teaching.manage'), classController.createTeachingClass |
| PUT | /api/admin/teaching-classes/:teaching_class_id | requireAdminPermission('admin.teaching.manage'), classController.updateTeachingClass |
| DELETE | /api/admin/teaching-classes/:teaching_class_id | requireAdminPermission('admin.teaching.manage'), classController.deleteTeachingClass |
| GET | /api/admin/teaching-classes/:teaching_class_id/students | requireAdminPermission('admin.teaching.view'), classController.getClassStudentList |
| POST | /api/admin/teaching-classes/:teaching_class_id/students | requireAdminPermission('admin.teaching.manage'), classController.addClassStudents |
| DELETE | /api/admin/teaching-classes/:teaching_class_id/students/:student_user_id | requireAdminPermission('admin.teaching.manage'), classController.removeClassStudent |
| GET | /api/admin/knowledge-documents | requireAdminPermission('admin.knowledge.view'), knowledgeController.getDocumentList |
| PUT | /api/admin/knowledge-documents/:document_id/review | requireAdminPermission('admin.knowledge.manage'), knowledgeController.reviewDocument |
| GET | /api/admin/operation-logs | requireAdminPermission('admin.audit.view'), logController.getOperationLogs |
| GET | /api/admin/notifications | requireAdminPermission('admin.system.view'), notificationController.getNotificationList |
| POST | /api/admin/notifications | requireAdminPermission('admin.system.manage'), notificationController.createNotification |
| PUT | /api/admin/notifications/:notification_id/read | requireAdminPermission('admin.system.manage'), notificationController.markNotificationRead |
| PUT | /api/admin/notifications/read-all | requireAdminPermission('admin.system.manage'), notificationController.markAllNotificationsRead |
| GET | /api/admin/ai-model-configs | requireAdminPermission('admin.ai.models.view'), aiController.getAiModelConfigs |
| POST | /api/admin/ai-model-configs | requireAdminPermission('admin.ai.models.manage'), aiController.createAiModelConfig |
| GET | /api/admin/ai-call-logs | requireAdminPermission('admin.traces.view'), aiController.getAiCallLogs |
| GET | /api/admin/ai/providers | requireAdminPermission('admin.ai.providers.view'), aiController.getProviders |
| POST | /api/admin/ai/providers | requireAdminPermission('admin.ai.providers.manage'), aiController.createProvider |
| GET | /api/admin/ai/providers/:id | requireAdminPermission('admin.ai.providers.view'), aiController.getProvider |
| PUT | /api/admin/ai/providers/:id | requireAdminPermission('admin.ai.providers.manage'), aiController.updateProvider |
| POST | /api/admin/ai/providers/:id/test | requireAdminPermission('admin.ai.providers.manage'), aiController.testProvider |
| POST | /api/admin/ai/providers/:id/enable | requireAdminPermission('admin.ai.providers.manage'), aiController.enableProvider |
| POST | /api/admin/ai/providers/:id/disable | requireAdminPermission('admin.ai.providers.manage'), aiController.disableProvider |
| POST | /api/admin/ai/providers/:id/replace-secret | requireAdminPermission('admin.ai.secrets.manage'), aiController.replaceProviderSecret |
| POST | /api/admin/ai/providers/:id/clear-secret | requireAdminPermission('admin.ai.secrets.manage'), aiController.clearProviderSecret |
| GET | /api/admin/ai/models | requireAdminPermission('admin.ai.models.view'), aiController.getModels |
| POST | /api/admin/ai/models | requireAdminPermission('admin.ai.models.manage'), aiController.createModel |
| GET | /api/admin/ai/models/:id | requireAdminPermission('admin.ai.models.view'), aiController.getModel |
| PUT | /api/admin/ai/models/:id | requireAdminPermission('admin.ai.models.manage'), aiController.updateModel |
| POST | /api/admin/ai/models/:id/test | requireAdminPermission('admin.ai.models.manage'), aiController.testModel |
| POST | /api/admin/ai/models/:id/enable | requireAdminPermission('admin.ai.models.manage'), aiController.enableModel |
| POST | /api/admin/ai/models/:id/disable | requireAdminPermission('admin.ai.models.manage'), aiController.disableModel |
| POST | /api/admin/ai/models/:id/set-default | requireAdminPermission('admin.ai.models.manage'), aiController.setDefaultModel |
| GET | /api/admin/agents | requireAdminPermission('admin.agents.view'), aiController.getAgents |
| POST | /api/admin/agents | requireAdminPermission('admin.agents.manage'), aiController.createAgent |
| GET | /api/admin/agents/:id | requireAdminPermission('admin.agents.view'), aiController.getAgent |
| PUT | /api/admin/agents/:id | requireAdminPermission('admin.agents.manage'), aiController.updateAgent |
| POST | /api/admin/agents/:id/test | requireAdminPermission('admin.agents.manage'), aiController.testAgent |
| POST | /api/admin/agents/:id/publish | requireAdminPermission('admin.agents.publish'), aiController.publishAgent |
| POST | /api/admin/agents/:id/rollback | requireAdminPermission('admin.agents.publish'), aiController.rollbackAgent |
| GET | /api/admin/system/environment-status | requireAdminPermission('admin.system.view'), aiController.getEnvironmentStatus |
| GET | /api/admin/traces | requireAdminPermission('admin.traces.view'), traceController.getTraces |
| GET | /api/admin/traces/:id | requireAdminPermission('admin.traces.view'), traceController.getTrace |
| POST | /api/admin/traces/:id/mark-risk | requireAdminPermission('admin.risks.manage'), traceController.markTraceRisk |
| GET | /api/admin/governance/:module/overview | requireGovernancePermission('view'), governanceController.getOverview |
| GET | /api/admin/governance/:module | requireGovernancePermission('view'), governanceController.getList |
| POST | /api/admin/governance/:module/actions/:action | requireGovernancePermission('manage'), governanceController.runAction |
| GET | /api/admin/rbac/me | rbacController.getMyAccess |
| GET | /api/admin/rbac/overview | requireAdminPermission('admin.system.view'), rbacController.getOverview |
| PUT | /api/admin/rbac/users/:user_id/roles | requireAdminPermission('admin.system.manage'), rbacController.replaceUserRoles |
| PUT | /api/admin/rbac/roles/:role_code/permissions | requireAdminPermission('admin.system.manage'), rbacController.replaceRolePermissions |

### 主应用挂载证据

- `/api/admin` → `adminRoutes`
- `/api/admin` → `agentReviewRoutes`

## 管理端 CSS、主题与共享布局候选

### 管理端样式

- `frontend/src/styles/admin-v2.css` — 未被入口加载（保留文件）
- `frontend/src/styles/admin.css` — 入口已加载

### 学生端/教师端共享候选

- `frontend/src/api/learning-guide.js`
- `frontend/src/components/practice/practice-components.js`
- `frontend/src/pages/agent/agent-card-menu.js`
- `frontend/src/pages/student-dashboard.js`
- `frontend/src/pages/teacher-dashboard.js`
- `frontend/src/styles/dashboard.css`
- `frontend/src/utils/dashboard.js`
- `frontend/src/utils/student-menu.js`
- `frontend/src/utils/teacher-menu.js`

## `/admin/dashboard` 的 `overall` 契约证据

- `frontend/src/pages/admin-dashboard.js:205` — `<div><h3 class="card-title">系统与服务状态</h3><p>总状态：${statusTag(data.service_health.overall)} · 数据库：${statusTag(data.system_status.database)}</p></div>`
- `backend/src/services/admin-dashboard.service.js:313` — `const overall = services.slice(1).every((item) => item.status === 'available')`
- `backend/src/services/admin-dashboard.service.js:393` — `overall,`
- `backend/src/services/admin-dashboard.service.js:454` — `overall,`

### 前端响应解包证据

- `frontend/src/pages/admin-agent-reviews.js:64` — `const items = result.data.list || []`
- `frontend/src/pages/admin-ai-config.js:72` — `return result.data`
- `frontend/src/pages/admin-ai-config.js:120` — `if (!result?.data || typeof result.data !== 'object') throw new Error('环境状态接口未返回受支持的数据结构')`
- `frontend/src/pages/admin-ai-config.js:121` — `state.environment = result.data`
- `frontend/src/pages/admin-classes.js:112` — `const data = result.data || {}`
- `frontend/src/pages/admin-course-detail.js:62` — `user = result.data.user`
- `frontend/src/pages/admin-course-detail.js:119` — `course = res.data`
- `frontend/src/pages/admin-course-detail.js:1089` — `course = { ...course, teachers: res.data?.teachers || [] }`
- `frontend/src/pages/admin-courses.js:47` — `user = result.data.user`
- `frontend/src/pages/admin-courses.js:91` — `const data = result.data || {}`
- `frontend/src/pages/admin-dashboard.js:233` — `target.innerHTML = renderDashboard(result.data, user)`
- `frontend/src/pages/admin-governance.js:108` — `const result = await runGovernanceAction(module, resolvedAction, data); notifyAdmin(result.data?.data_status === 'insufficient_data' ? '样本不足，未生成确定性画像' : '操作已真实写入数据库'); await load(module); return true`
- `frontend/src/pages/admin-knowledge.js:16` — `user = result.data.user`
- `frontend/src/pages/admin-knowledge.js:39` — `state.list = result.data.list || []`
- `frontend/src/pages/admin-knowledge.js:40` — `state.total = result.data.total || 0`
- `frontend/src/pages/admin-logs.js:14` — `user = result.data.user`
- `frontend/src/pages/admin-logs.js:30` — `state.list = result.data.list || []`
- `frontend/src/pages/admin-logs.js:31` — `state.total = result.data.total || 0`
- `frontend/src/pages/admin-notifications.js:206` — `notifyAdmin('已更新 ${result.data.updated_count} 条通知')`
- `frontend/src/pages/admin-notifications.js:225` — `const data = result.data`
- `frontend/src/pages/admin-notifications.js:286` — `notifyAdmin('通知发送成功，已创建 ${result.data.count} 条记录')`
- `frontend/src/pages/admin-permissions.js:140` — `data = result.data || { roles: [], permissions: [], admins: [] }`
- `frontend/src/pages/admin-profile.js:16` — `user = result.data.user`
- `frontend/src/pages/admin-teaching-classes.js:65` — `const data = result.data || {}; state.list = data.list || []; state.total = Number(data.total || 0); state.totalPages = Number(data.total_pages || Math.max(1, Math.ceil(state.total / state.pageSize)))`
- `frontend/src/pages/admin-teaching-classes.js:117` — `document.querySelectorAll('[data-teaching-delete]').forEach((button) => button.addEventListener('click', async () => { const item = state.list.find((entry) => entry.teaching_class_id === Number(button.dataset.teachingDelete)); if (item.status === 'archived') return; const confirmed = await confirmAd`
- `frontend/src/pages/admin-traces.js:13` — `const result = await getAdminTrace(id); const trace = result.data`
- `frontend/src/pages/admin-users.js:291` — `user = result.data.user`
- `frontend/src/pages/admin-users.js:508` — `const data = res.data || {}`

## 原生控件和样式退化风险

### 未带 class 的控件

- `frontend/src/pages/admin-ai-config.js:133` — `return '<div class="admin-form-grid"><div class="admin-field"><label>供应商类型 <span class="required">*</span></label><select class="admin-select" name="provider_type" required>${Object.entries(providerTypeLabel).map(([value, label]) => '<option value="${value}" ${item.provider_type === value ? 'selecte`
- `frontend/src/pages/admin-ai-config.js:160` — `return '<div class="admin-form-grid"><div class="admin-field"><label>供应商 <span class="required">*</span></label><select class="admin-select" name="provider_id" required>${state.providers.map((p) => '<option value="${p.id}" ${item.provider_id === p.id ? 'selected' : ''}>${escapeHtml(p.display_name)}<`
- `frontend/src/pages/admin-ai-config.js:171` — `return '<div class="admin-form-grid">${item.id ? '' : '<div class="admin-field"><label>Agent Key <span class="required">*</span></label><input class="admin-input" name="agent_key" pattern="[a-z0-9][a-z0-9_-]*" required></div>'}<div class="admin-field"><label>名称 <span class="required">*</span></label`
- `frontend/src/pages/admin-classes.js:157` — `const candidateRows = candidates.length ? candidates.map((entry) => '<label class="admin-choice"><input type="checkbox" name="student_user_ids" value="${entry.user_id}"><span><strong>${escapeHtml(entry.real_name || entry.username)}</strong><small>${escapeHtml(entry.student_no || entry.username)}${en`
- `frontend/src/pages/admin-course-detail.js:238` — `<select id="kp-chapter-filter" style="padding:6px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;">`
- `frontend/src/pages/admin-course-detail.js:280` — `<input type="text" id="edit-course-name" required value="${escapeHtml(course.course_name)}">`
- `frontend/src/pages/admin-course-detail.js:284` — `<input type="text" id="edit-course-code" required value="${escapeHtml(course.course_code)}">`
- `frontend/src/pages/admin-course-detail.js:288` — `<input type="text" id="edit-subject-category" value="${escapeHtml(course.subject_category || '')}">`
- `frontend/src/pages/admin-course-detail.js:309` — `<input type="text" id="form-chapter-name" required placeholder="例如：第一章 基础知识">`
- `frontend/src/pages/admin-course-detail.js:313` — `<input type="number" id="form-chapter-order" min="0" step="1" placeholder="例如：1">`
- `frontend/src/pages/admin-course-detail.js:334` — `<select id="form-kp-chapter" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:341` — `<input type="text" id="form-kp-name" required placeholder="例如：线性回归">`
- `frontend/src/pages/admin-course-detail.js:345` — `<input type="text" id="form-kp-code" required placeholder="例如：LR001">`
- `frontend/src/pages/admin-course-detail.js:349` — `<select id="form-kp-difficulty" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:361` — `<input type="text" id="form-kp-aliases" placeholder="例如：线性回归模型, LR">`
- `frontend/src/pages/admin-course-detail.js:378` — `<input type="text" id="form-class-name" required placeholder="例如：2024级计算机科学1班">`
- `frontend/src/pages/admin-course-detail.js:382` — `<input type="text" id="form-class-semester" placeholder="例如：2024-2025学年第一学期">`
- `frontend/src/pages/admin-course-detail.js:403` — `<select id="form-teacher-user" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:414` — `<select id="form-teacher-role" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-courses.js:122` — `<input`
- `frontend/src/pages/admin-courses.js:128` — `<select id="status-filter">`
- `frontend/src/pages/admin-courses.js:248` — `pages.push('<button data-page="1">1</button>')`
- `frontend/src/pages/admin-courses.js:262` — `pages.push('<button data-page="${totalPages}">${totalPages}</button>')`
- `frontend/src/pages/admin-courses.js:267` — `<button data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>`
- `frontend/src/pages/admin-courses.js:270` — `<button data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>`
- `frontend/src/pages/admin-courses.js:282` — `<input type="text" id="field-course-name" placeholder="请输入课程名称" />`
- `frontend/src/pages/admin-courses.js:286` — `<input type="text" id="field-course-code" placeholder="例如：CS101" />`
- `frontend/src/pages/admin-courses.js:290` — `<input type="text" id="field-subject-category" placeholder="例如：计算机科学" />`
- `frontend/src/pages/admin-courses.js:294` — `<textarea id="field-description" placeholder="请输入课程描述（可选）"></textarea>`
- `frontend/src/pages/admin-courses.js:298` — `<input type="text" id="field-cover-url" placeholder="请输入封面图片链接（可选）" />`
- `frontend/src/pages/admin-dashboard.js:67` — `return '<div class="table-container"><table>`
- `frontend/src/pages/admin-knowledge.js:100` — `<button ${state.page <= 1 ? 'disabled' : ''} data-page="prev">上一页</button>`
- `frontend/src/pages/admin-knowledge.js:102` — `<button ${state.page >= totalPages ? 'disabled' : ''} data-page="next">下一页</button>`
- `frontend/src/pages/admin-knowledge.js:112` — `<input type="text" aria-label="搜索文档" placeholder="搜索文档标题或文件名..." value="${escapeHtml(filters.keyword)}" id="search-input" />`
- `frontend/src/pages/admin-knowledge.js:113` — `<select id="filter-scope" aria-label="知识范围">`
- `frontend/src/pages/admin-knowledge.js:120` — `<select id="filter-review" aria-label="审核状态">`
- `frontend/src/pages/admin-knowledge.js:126` — `<select id="filter-parse" aria-label="解析状态">`
- `frontend/src/pages/admin-knowledge.js:139` — `<table>`
- `frontend/src/pages/admin-logs.js:81` — `<button ${state.page <= 1 ? 'disabled' : ''} data-page="prev">上一页</button>`
- `frontend/src/pages/admin-logs.js:83` — `<button ${state.page >= totalPages ? 'disabled' : ''} data-page="next">下一页</button>`
- `frontend/src/pages/admin-logs.js:96` — `<input type="search" placeholder="搜索操作类型、描述、对象或操作人..." value="${escapeHtml(filters.keyword)}" id="search-input" />`
- `frontend/src/pages/admin-logs.js:97` — `<input type="date" id="filter-start" value="${filters.start_date}" title="开始日期" />`
- `frontend/src/pages/admin-logs.js:98` — `<input type="date" id="filter-end" value="${filters.end_date}" title="结束日期" />`
- `frontend/src/pages/admin-logs.js:105` — `<table>`
- `frontend/src/pages/admin-notifications.js:253` — `<div class="form-group"><label for="admin-notification-type">通知类型</label><select id="admin-notification-type" name="notification_type" required>${CREATE_TYPE_OPTIONS.map((value) => '<option value="${value}">${escapeHtml(typeLabel(value))}</option>').join('')}</select></div>`
- `frontend/src/pages/admin-notifications.js:254` — `<div class="form-group"><label for="admin-notification-target">发送对象</label><select id="admin-notification-target" name="target_role" required><option value="all">全体活跃用户</option><option value="teacher">仅教师</option><option value="student">仅学生</option><option value="admin">仅管理员</option></select></div>`
- `frontend/src/pages/admin-notifications.js:255` — `<div class="form-group"><label for="admin-notification-title">通知标题</label><input id="admin-notification-title" name="title" maxlength="200" required autocomplete="off"></div>`
- `frontend/src/pages/admin-notifications.js:256` — `<div class="form-group"><label for="admin-notification-content">通知内容</label><textarea id="admin-notification-content" name="content" maxlength="20000" rows="5"></textarea></div>`
- `frontend/src/pages/admin-permissions.js:63` — `return '<div class="admin-rbac-option-list">${roles.map((role) => '<label><input type="checkbox" name="role_codes" value="${escapeHtml(role.role_code)}" ${selected.has(role.role_code) ? 'checked' : ''}><span><strong>${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description || role.role_c`
- `frontend/src/pages/admin-permissions.js:73` — `return '<div class="admin-rbac-permission-groups">${[...groups.entries()].map(([module, items]) => '<fieldset><legend>${escapeHtml(MODULE_LABEL[module] || module)}</legend>${items.map((permission) => '<label><input type="checkbox" name="permission_keys" value="${escapeHtml(permission.permission_key)`
- `frontend/src/pages/admin-teaching-classes.js:36` — `return state.adminClasses.length ? state.adminClasses.map((item) => '<label class="admin-choice"><input type="checkbox" name="admin_class_ids" value="${item.admin_class_id}" ${set.has(item.admin_class_id) ? 'checked' : ''}><span><strong>${escapeHtml(item.class_name)}</strong><small>${escapeHtml(item`
- `frontend/src/pages/admin-teaching-classes.js:101` — `const candidatesHtml = candidates.length ? candidates.map((entry) => '<label class="admin-choice"><input type="checkbox" name="student_user_ids" value="${entry.user_id}"><span><strong>${escapeHtml(entry.real_name || entry.username)}</strong><small>${escapeHtml(entry.student_no || entry.username)}${e`
- `frontend/src/pages/admin-users.js:61` — `<input type="text" id="filter-real-name" placeholder="姓名" value="${escapeHtml(filters.real_name || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:62` — `<input type="text" id="filter-student-no" placeholder="学号" value="${escapeHtml(filters.student_no || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:63` — `<input type="text" id="filter-college" placeholder="学院" value="${escapeHtml(filters.college || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:64` — `<input type="text" id="filter-major" placeholder="专业" value="${escapeHtml(filters.major || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:65` — `<input type="text" id="filter-grade" placeholder="年级" value="${escapeHtml(filters.grade || '')}" style="width:70px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:66` — `<input type="text" id="filter-class-name" placeholder="班级" value="${escapeHtml(filters.class_name || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:70` — `<input type="text" id="filter-real-name" placeholder="姓名" value="${escapeHtml(filters.real_name || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:71` — `<input type="text" id="filter-teacher-no" placeholder="工号" value="${escapeHtml(filters.teacher_no || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:72` — `<input type="text" id="filter-college" placeholder="学院" value="${escapeHtml(filters.college || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:76` — `<input type="text" id="filter-real-name" placeholder="姓名" value="${escapeHtml(filters.real_name || '')}" style="width:100px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />`
- `frontend/src/pages/admin-users.js:84` — `<input type="text" id="input-keyword" placeholder="${keywordPlaceholder}" value="${escapeHtml(filters.keyword || '')}" />`
- `frontend/src/pages/admin-users.js:87` — `<select id="select-status" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:#fff;min-width:90px;">`
- `frontend/src/pages/admin-users.js:182` — `: '<div class="admin-rbac-option-list">${adminRoles.map((item) => '<label><input type="checkbox" name="admin_role_codes" value="${escapeHtml(item.role_code)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || item.role_code)}</small></span></label>').join('')}</d`
- `frontend/src/pages/admin-users.js:188` — `<button type="button" id="btn-modal-close" style="border:none;background:none;font-size:24px;color:#999;cursor:pointer;padding:0 4px;line-height:1;">×</button>`
- `frontend/src/pages/admin-users.js:194` — `<input type="text" id="form-username" required ${isEdit ? 'readonly style="background:#f5f5f5;"' : ''} value="${escapeHtml(u.username || '')}" placeholder="登录用户名" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />`
- `frontend/src/pages/admin-users.js:198` — `<select id="form-role" ${isEdit ? 'disabled' : ''} style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:${isEdit ? '#f5f5f5' : '#fff'};box-sizing:border-box;">`
- `frontend/src/pages/admin-users.js:205` — `<input type="password" id="form-password" required placeholder="至少6位" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />`
- `frontend/src/pages/admin-users.js:209` — `<input type="text" id="form-real-name" required value="${escapeHtml(u.real_name || '')}" placeholder="真实姓名" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />`
- `frontend/src/pages/admin-users.js:213` — `<input type="email" id="form-email" value="${escapeHtml(u.email || '')}" placeholder="email@example.com" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />`
- `frontend/src/pages/admin-users.js:217` — `<input type="text" id="form-phone" value="${escapeHtml(u.phone || '')}" placeholder="手机号" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />`
- `frontend/src/pages/admin-users.js:221` — `<input type="text" id="form-college" value="${escapeHtml(u.college || '')}" placeholder="学院" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" />`
- `frontend/src/pages/admin-users.js:225` — `<select id="form-gender" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box;">`
- `frontend/src/pages/admin-users.js:232` — `<div class="form-group"><label>学号</label><input type="text" id="form-student-no" value="${escapeHtml(u.student_no || '')}" placeholder="学号" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>`
- `frontend/src/pages/admin-users.js:233` — `<div class="form-group"><label>专业</label><input type="text" id="form-major" value="${escapeHtml(u.major || '')}" placeholder="专业" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>`
- `frontend/src/pages/admin-users.js:234` — `<div class="form-group"><label>年级</label><input type="text" id="form-grade" value="${escapeHtml(u.grade || '')}" placeholder="年级" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>`
- `frontend/src/pages/admin-users.js:235` — `<div class="form-group"><label>行政班级</label><select id="form-admin-class" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box;"><option value="">暂不分班</option>${classOptions}</select></div>`
- `frontend/src/pages/admin-users.js:238` — `<div class="form-group"><label>工号</label><input type="text" id="form-teacher-no" value="${escapeHtml(u.teacher_no || '')}" placeholder="工号" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>`
- `frontend/src/pages/admin-users.js:258` — `<div class="form-group" style="margin-bottom:14px;"><label>新密码</label><input type="password" id="input-new-pwd" placeholder="至少6位" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>`
- `frontend/src/pages/admin-users.js:259` — `<div class="form-group" style="margin-bottom:14px;"><label>确认密码</label><input type="password" id="input-confirm-pwd" placeholder="再次输入" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>`

### 所有原生控件标签（前 120 处）

- `frontend/src/pages/admin-agent-reviews.js:23` — `${canManage ? '<footer><button class="complex-btn" data-review-action="approve">审核通过</button><button class="complex-btn-danger" data-review-action="reject">驳回</button></footer>' : readonlyFooter()}</article>'`
- `frontend/src/pages/admin-agent-reviews.js:28` — `return '<article class="admin-review-card" data-review-id="${item.id}"><header><div><h3>${escapeHtml(kb.name)}</h3><p>${escapeHtml(kb.description || '')}</p></div><span>${escapeHtml(kb.owner.name || kb.owner.username)}</span></header><div class="admin-review-meta"><span>${kb.documents.length} 个文件</s`
- `frontend/src/pages/admin-agent-reviews.js:32` — `return '<article class="admin-review-card" data-report-id="${item.id}"><header><div><h3>${escapeHtml(item.agent.name)}</h3><p>${escapeHtml(item.reason)}：${escapeHtml(item.detail || '')}</p></div><span>举报人：${escapeHtml(item.reporter.name)}</span></header>${canManage ? '<footer><button class="complex-`
- `frontend/src/pages/admin-ai-config.js:28` — `<footer>${can('admin.ai.providers.manage') ? '<button class="admin-button is-secondary" data-action="edit-provider">编辑配置</button><button class="admin-button is-secondary" data-action="test-provider" ${item.enabled ? '' : 'disabled'}>测试连接</button><button class="admin-button is-ghost" data-action="tog`
- `frontend/src/pages/admin-ai-config.js:34` — `return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>模型</th><th>供应商</th><th>类型</th><th>能力</th><th>上下文</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.models.map((model) => {`
- `frontend/src/pages/admin-ai-config.js:37` — `return '<tr data-model-id="${model.id}"><td><strong>${escapeHtml(model.display_name)}</strong><br><small>${escapeHtml(model.model_code)}</small></td><td>${escapeHtml(provider?.display_name || model.provider)}</td><td>${escapeHtml(model.model_type)}</td><td>${escapeHtml(caps)}</td><td>${model.context`
- `frontend/src/pages/admin-ai-config.js:43` — `return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Agent</th><th>运行模式</th><th>供应商 / 模型</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.agents.map((agent) => {`
- `frontend/src/pages/admin-ai-config.js:45` — `return '<tr data-agent-id="${agent.id}"><td><strong>${escapeHtml(agent.name)}</strong><br><small>${escapeHtml(agent.agent_key || agent.agent_type)}</small></td><td>${escapeHtml(agent.runtime_type)}</td><td>${escapeHtml(provider?.display_name || '未绑定')}<br><small>${escapeHtml(model?.display_name || '`
- `frontend/src/pages/admin-ai-config.js:59` — `root.innerHTML = '<div class="admin-page-header"><div><h2>${heading}</h2><p>数据库启用配置优先于环境变量与安全默认值；密钥仅在后端使用 AES-256-GCM 保存，前端永不回显。</p></div><div class="admin-header-actions">${state.tab === 'providers' && can('admin.ai.providers.manage') ? '<button class="admin-button" id="add-provider">新增供应商</button>`
- `frontend/src/pages/admin-ai-config.js:60` — `${state.tab === 'models' && state.modelProviderId ? '<div class="admin-load-warning" role="status"><strong>已按供应商筛选模型</strong><button class="admin-button is-ghost" type="button" id="clear-model-provider">清除筛选</button></div>' : ''}`
- `frontend/src/pages/admin-ai-config.js:80` — `renderFrame('<div class="admin-error" role="alert"><div><strong>当前配置页加载失败</strong><p>${escapeHtml(error?.message || '请求失败，请稍后重试。')}</p><button class="admin-button is-secondary" id="retry-ai-load" type="button">重新加载</button></div></div>')`
- `frontend/src/pages/admin-ai-config.js:133` — `return '<div class="admin-form-grid"><div class="admin-field"><label>供应商类型 <span class="required">*</span></label><select class="admin-select" name="provider_type" required>${Object.entries(providerTypeLabel).map(([value, label]) => '<option value="${value}" ${item.provider_type === value ? 'selecte`
- `frontend/src/pages/admin-ai-config.js:148` — `return '<p class="admin-help">当前为 ${escapeHtml(item.display_name)} 替换密钥。所有输入默认空白，提交后仅显示配置状态和最后四位。</p><div class="admin-form-grid"><div class="admin-field is-wide"><label>API Key / Token</label><input class="admin-input" name="api_key" type="password" autocomplete="new-password" maxlength="10000" pla`
- `frontend/src/pages/admin-ai-config.js:160` — `return '<div class="admin-form-grid"><div class="admin-field"><label>供应商 <span class="required">*</span></label><select class="admin-select" name="provider_id" required>${state.providers.map((p) => '<option value="${p.id}" ${item.provider_id === p.id ? 'selected' : ''}>${escapeHtml(p.display_name)}<`
- `frontend/src/pages/admin-ai-config.js:171` — `return '<div class="admin-form-grid">${item.id ? '' : '<div class="admin-field"><label>Agent Key <span class="required">*</span></label><input class="admin-input" name="agent_key" pattern="[a-z0-9][a-z0-9_-]*" required></div>'}<div class="admin-field"><label>名称 <span class="required">*</span></label`
- `frontend/src/pages/admin-ai-config.js:184` — `openAdminDrawer({ title: '回滚 Agent 版本', submitLabel: '确认回滚', content: '<div class="admin-field"><label>目标版本记录</label><select class="admin-select" name="version_id" required>${detail.versions.map((version) => '<option value="${version.id}">v${version.version_number} · ${escapeHtml(version.status)} · `
- `frontend/src/pages/admin-classes.js:32` — `<div class="admin-field is-wide"><label for="class-name">班级名称</label><input class="admin-input" id="class-name" name="class_name" maxlength="100" required value="${escapeHtml(item.class_name || '')}" placeholder="例如：软件工程 2026 级 1 班"></div>`
- `frontend/src/pages/admin-classes.js:33` — `<div class="admin-field"><label for="class-college">学院</label><input class="admin-input" id="class-college" name="college" maxlength="100" value="${escapeHtml(item.college || '')}"></div>`
- `frontend/src/pages/admin-classes.js:34` — `<div class="admin-field"><label for="class-major">专业</label><input class="admin-input" id="class-major" name="major" maxlength="100" value="${escapeHtml(item.major || '')}"></div>`
- `frontend/src/pages/admin-classes.js:35` — `<div class="admin-field"><label for="class-grade">年级</label><input class="admin-input" id="class-grade" name="grade" maxlength="20" value="${escapeHtml(item.grade || '')}" placeholder="例如：2026"></div>`
- `frontend/src/pages/admin-classes.js:36` — `${item.admin_class_id ? '<div class="admin-field"><label for="class-status">状态</label><select class="admin-select" id="class-status" name="status"><option value="active" ${item.status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${item.status === 'disabled' ? 'selected' : ''}>`
- `frontend/src/pages/admin-classes.js:59` — `return '<div class="admin-pagination"><span>共 ${state.total} 个行政班 · 第 ${state.page}/${state.totalPages} 页</span><div class="admin-pagination-actions"><button class="admin-button is-secondary" id="class-prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><button class="admin-button is-secondary" i`
- `frontend/src/pages/admin-classes.js:71` — `<button class="admin-button is-secondary" data-members="${item.admin_class_id}">成员</button>`
- `frontend/src/pages/admin-classes.js:72` — `${canManage ? '<button class="admin-button is-secondary" data-edit="${item.admin_class_id}">编辑</button><button class="admin-button is-danger" data-delete="${item.admin_class_id}">删除</button>' : ''}`
- `frontend/src/pages/admin-classes.js:80` — `else if (state.error) body = '<div class="admin-error"><div>${getIcon('alert')}<strong>行政班加载失败</strong><p>${escapeHtml(state.error)}</p><button class="admin-button" id="class-retry">重新加载</button></div></div>'`
- `frontend/src/pages/admin-classes.js:82` — `else body = '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>班级</th><th>年级</th><th>辅导员</th><th>学生</th><th>关联教学班</th><th>状态</th><th>操作</th></tr></thead><tbody>${tableRows()}</tbody></table></div>${pagination()}'`
- `frontend/src/pages/admin-classes.js:88` — `<header class="admin-page-header"><div><h2>行政班管理</h2><p>维护学生行政归属、学院专业信息和教学班关联；有成员或教学关联时禁止直接删除。</p></div><div class="admin-header-actions">${canManage ? '<button class="admin-button" id="class-create">新建行政班</button>' : ''}</div></header>`
- `frontend/src/pages/admin-classes.js:90` — `<div class="admin-field is-search"><label for="class-keyword">关键词</label><input class="admin-input" id="class-keyword" value="${escapeHtml(state.keyword)}" placeholder="班级、学院或专业"></div>`
- `frontend/src/pages/admin-classes.js:91` — `<div class="admin-field"><label for="class-college-filter">学院</label><input class="admin-input" id="class-college-filter" value="${escapeHtml(state.college)}"></div>`
- `frontend/src/pages/admin-classes.js:92` — `<div class="admin-field"><label for="class-grade-filter">年级</label><input class="admin-input" id="class-grade-filter" value="${escapeHtml(state.grade)}"></div>`
- `frontend/src/pages/admin-classes.js:93` — `<div class="admin-field"><label for="class-status-filter">状态</label><select class="admin-select" id="class-status-filter"><option value="">全部</option><option value="active" ${state.status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${state.status === 'disabled' ? 'selected' :`
- `frontend/src/pages/admin-classes.js:94` — `<button class="admin-button is-secondary" id="class-search">查询</button><button class="admin-button is-ghost" id="class-reset">重置</button>`
- `frontend/src/pages/admin-classes.js:156` — `const memberRows = members.length ? members.map((entry) => '<tr><td><strong>${escapeHtml(entry.real_name || entry.username)}</strong><br><small>${escapeHtml(entry.student_no || entry.username)}</small></td><td>${statusBadge(entry.status === 'active' ? '正常' : '已停用')}</td><td>${canManage ? '<button cl`
- `frontend/src/pages/admin-classes.js:157` — `const candidateRows = candidates.length ? candidates.map((entry) => '<label class="admin-choice"><input type="checkbox" name="student_user_ids" value="${entry.user_id}"><span><strong>${escapeHtml(entry.real_name || entry.username)}</strong><small>${escapeHtml(entry.student_no || entry.username)}${en`
- `frontend/src/pages/admin-classes.js:161` — `content: '<section class="admin-card"><div class="admin-card-header"><div><h3>当前成员</h3><p>共 ${members.length} 名；转出不会删除学生账号。</p></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>学生</th><th>状态</th><th>操作</th></tr></thead><tbody>${memberRows}</tbody></table></div></sec`
- `frontend/src/pages/admin-classes.js:162` — `${canManage ? '<section class="admin-card"><div class="admin-card-header"><div><h3>加入学生</h3><p>若学生已有行政班，提交后将完成转班。</p></div></div><div class="admin-inline-actions"><input class="admin-input" id="member-candidate-keyword" value="${escapeHtml(candidateKeyword)}" placeholder="姓名、账号或学号"><button class="ad`
- `frontend/src/pages/admin-course-detail.js:89` — `<button class="btn-back" onclick="window.location.hash='#/admin/courses'">`
- `frontend/src/pages/admin-course-detail.js:168` — `${auxiliaryErrors.length ? '<div class="admin-inline-warning" role="alert"><div><strong>部分课程数据暂时不可用</strong><p>${auxiliaryErrors.map(escapeHtml).join('；')}</p></div><button type="button" class="btn-sm btn-secondary" id="btn-retry-course-sections">重新加载</button></div>' : ''}`
- `frontend/src/pages/admin-course-detail.js:171` — `<button class="btn-back" onclick="window.location.hash='#/admin/courses'">`
- `frontend/src/pages/admin-course-detail.js:195` — `${canManage ? '<button class="btn btn-primary" id="btn-edit-course-info" style="font-size:0.85rem;padding:6px 14px;">编辑课程</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:208` — `<button class="tab-btn active" data-tab="chapters" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">`
- `frontend/src/pages/admin-course-detail.js:211` — `<button class="tab-btn" data-tab="knowledge" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">`
- `frontend/src/pages/admin-course-detail.js:214` — `<button class="tab-btn" data-tab="classes" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">`
- `frontend/src/pages/admin-course-detail.js:217` — `<button class="tab-btn" data-tab="teachers" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">`
- `frontend/src/pages/admin-course-detail.js:226` — `${canManage && course.status === 'active' ? '<button class="btn btn-primary" id="btn-create-chapter" style="font-size:0.85rem;padding:6px 14px;">新建章节</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:238` — `<select id="kp-chapter-filter" style="padding:6px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;">`
- `frontend/src/pages/admin-course-detail.js:242` — `${canManage && course.status === 'active' ? '<button class="btn btn-primary" id="btn-create-kp" style="font-size:0.85rem;padding:6px 14px;">新建知识点</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:254` — `${canManage && course.status === 'active' ? '<button class="btn btn-primary" id="btn-create-class" style="font-size:0.85rem;padding:6px 14px;">新建教学班</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:265` — `${canManage && course.status === 'active' ? '<button class="btn btn-primary" id="btn-add-teacher" style="font-size:0.85rem;padding:6px 14px;">添加教师</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:280` — `<input type="text" id="edit-course-name" required value="${escapeHtml(course.course_name)}">`
- `frontend/src/pages/admin-course-detail.js:284` — `<input type="text" id="edit-course-code" required value="${escapeHtml(course.course_code)}">`
- `frontend/src/pages/admin-course-detail.js:288` — `<input type="text" id="edit-subject-category" value="${escapeHtml(course.subject_category || '')}">`
- `frontend/src/pages/admin-course-detail.js:292` — `<textarea id="edit-description" class="auto-resize-ta" rows="3">${escapeHtml(course.description || '')}</textarea>`
- `frontend/src/pages/admin-course-detail.js:295` — `<button type="button" class="btn" id="btn-edit-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:296` — `<button type="submit" class="btn btn-primary">保存</button>`
- `frontend/src/pages/admin-course-detail.js:309` — `<input type="text" id="form-chapter-name" required placeholder="例如：第一章 基础知识">`
- `frontend/src/pages/admin-course-detail.js:313` — `<input type="number" id="form-chapter-order" min="0" step="1" placeholder="例如：1">`
- `frontend/src/pages/admin-course-detail.js:317` — `<textarea id="form-chapter-desc" class="auto-resize-ta" rows="2" placeholder="可选描述..."></textarea>`
- `frontend/src/pages/admin-course-detail.js:320` — `<button type="button" class="btn" id="btn-chapter-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:321` — `<button type="submit" class="btn btn-primary">保存</button>`
- `frontend/src/pages/admin-course-detail.js:334` — `<select id="form-kp-chapter" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:341` — `<input type="text" id="form-kp-name" required placeholder="例如：线性回归">`
- `frontend/src/pages/admin-course-detail.js:345` — `<input type="text" id="form-kp-code" required placeholder="例如：LR001">`
- `frontend/src/pages/admin-course-detail.js:349` — `<select id="form-kp-difficulty" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:357` — `<textarea id="form-kp-desc" class="auto-resize-ta" rows="2" placeholder="可选描述..."></textarea>`
- `frontend/src/pages/admin-course-detail.js:361` — `<input type="text" id="form-kp-aliases" placeholder="例如：线性回归模型, LR">`
- `frontend/src/pages/admin-course-detail.js:364` — `<button type="button" class="btn" id="btn-kp-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:365` — `<button type="submit" class="btn btn-primary">保存</button>`
- `frontend/src/pages/admin-course-detail.js:378` — `<input type="text" id="form-class-name" required placeholder="例如：2024级计算机科学1班">`
- `frontend/src/pages/admin-course-detail.js:382` — `<input type="text" id="form-class-semester" placeholder="例如：2024-2025学年第一学期">`
- `frontend/src/pages/admin-course-detail.js:386` — `<textarea id="form-class-desc" class="auto-resize-ta" rows="2" placeholder="可选描述..."></textarea>`
- `frontend/src/pages/admin-course-detail.js:389` — `<button type="button" class="btn" id="btn-class-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:390` — `<button type="submit" class="btn btn-primary">保存</button>`
- `frontend/src/pages/admin-course-detail.js:403` — `<select id="form-teacher-user" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:414` — `<select id="form-teacher-role" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:421` — `<button type="button" class="btn" id="btn-teacher-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:422` — `<button type="submit" class="btn btn-primary">添加</button>`
- `frontend/src/pages/admin-course-detail.js:464` — `<button class="btn-back" onclick="window.location.hash='#/admin/courses'">返回课程列表</button>`
- `frontend/src/pages/admin-course-detail.js:469` — `<button class="btn-retry" onclick="window.location.reload()">重新加载</button>`
- `frontend/src/pages/admin-course-detail.js:497` — `${canManage && course.status === 'active' ? '<button class="btn-edit-chapter" data-chapter-id="${ch.chapter_id}" style="padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;font-size:0.8rem;">编辑</button><button class="btn-delete-chapter" data-chapter-`
- `frontend/src/pages/admin-course-detail.js:527` — `${canManage && course.status === 'active' ? '<div style="display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><button class="btn-edit-kp" data-kp-id="${kp.knowledge_point_id}" style="flex:1;padding:5px;border:1px solid var(--border);border-radius:6px;background:`
- `frontend/src/pages/admin-course-detail.js:552` — `${canManage && course.status === 'active' ? '<div style="display:flex;gap:8px;"><button class="btn-edit-class" data-class-id="${tc.teaching_class_id}" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;font-size:0.85rem;">编辑</button><button`
- `frontend/src/pages/admin-course-detail.js:577` — `${canManage && course.status === 'active' ? '<button class="btn-remove-teacher" data-teacher-user-id="${t.teacher_user_id || t.user_id}" style="padding:5px 12px;border:1px solid #fecaca;border-radius:6px;background:#fef2f2;color:#dc2626;cursor:pointer;font-size:0.8rem;flex-shrink:0;">移除</button>' : `
- `frontend/src/pages/admin-courses.js:122` — `<input`
- `frontend/src/pages/admin-courses.js:128` — `<select id="status-filter">`
- `frontend/src/pages/admin-courses.js:133` — `<button class="btn-sm btn-secondary" id="btn-search">搜索</button>`
- `frontend/src/pages/admin-courses.js:134` — `${canManage ? '<button class="btn-sm btn-primary" id="btn-create-course" style="margin-left:auto;">创建课程</button>' : ''}`
- `frontend/src/pages/admin-courses.js:162` — `<button class="btn-sm btn-primary" id="btn-retry" style="margin-top:12px;">重新加载</button>`
- `frontend/src/pages/admin-courses.js:181` — `${canManage && !(keyword || statusFilter !== 'all') ? '<button class="btn-sm btn-primary" id="btn-create-course-empty" style="margin-top:12px;">创建课程</button>' : ''}`
- `frontend/src/pages/admin-courses.js:211` — `${canManage && !isArchived ? '<button class="btn-sm btn-danger btn-archive" data-course-id="${courseId}">归档</button>' : ''}`
- `frontend/src/pages/admin-courses.js:248` — `pages.push('<button data-page="1">1</button>')`
- `frontend/src/pages/admin-courses.js:255` — `'<button data-page="${i}" class="${i === currentPage ? 'active' : ''}">${i}</button>'`
- `frontend/src/pages/admin-courses.js:262` — `pages.push('<button data-page="${totalPages}">${totalPages}</button>')`
- `frontend/src/pages/admin-courses.js:267` — `<button data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>`
- `frontend/src/pages/admin-courses.js:270` — `<button data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>`
- `frontend/src/pages/admin-courses.js:282` — `<input type="text" id="field-course-name" placeholder="请输入课程名称" />`
- `frontend/src/pages/admin-courses.js:286` — `<input type="text" id="field-course-code" placeholder="例如：CS101" />`
- `frontend/src/pages/admin-courses.js:290` — `<input type="text" id="field-subject-category" placeholder="例如：计算机科学" />`
- `frontend/src/pages/admin-courses.js:294` — `<textarea id="field-description" placeholder="请输入课程描述（可选）"></textarea>`
- `frontend/src/pages/admin-courses.js:298` — `<input type="text" id="field-cover-url" placeholder="请输入封面图片链接（可选）" />`
- `frontend/src/pages/admin-courses.js:301` — `<button class="btn-cancel" id="btn-cancel-create">取消</button>`
- `frontend/src/pages/admin-courses.js:302` — `<button class="btn-confirm" id="btn-confirm-create">确认创建</button>`
- `frontend/src/pages/admin-dashboard.js:67` — `return '<div class="table-container"><table>`
- `frontend/src/pages/admin-dashboard.js:164` — `<button type="button" class="btn btn-primary" id="admin-dashboard-refresh">${getIcon('refresh')} 刷新</button>`
- `frontend/src/pages/admin-dashboard.js:238` — `currentRoot.innerHTML = '<div class="error-state"><div class="error-icon">${getIcon('alert')}</div><div class="error-message">${escapeHtml(error.message || '驾驶舱数据加载失败，请稍后重试。')}</div><button type="button" class="btn-retry" id="admin-dashboard-retry">重新加载</button></div>'`
- `frontend/src/pages/admin-governance.js:54` — `return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>名称 / 标识</th><th>状态</th><th>范围 / 样本</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${list.map((item) => {`
- `frontend/src/pages/admin-governance.js:62` — `? actions.map((action) => '<button class="admin-button ${action.danger ? 'is-danger' : 'is-secondary'}" data-row-action="${action.key}">${action.label}</button>').join('')`
- `frontend/src/pages/admin-governance.js:71` — `'create-intervention': '<div class="admin-form-grid"><div class="admin-field is-wide"><label>干预标题</label><input class="admin-input" name="title" required></div><div class="admin-field"><label>干预类型</label><select class="admin-select" name="intervention_type"><option value="push_learning_flow">推送学习流</`
- `frontend/src/pages/admin-governance.js:72` — `create_evaluation: '<div class="admin-form-grid"><div class="admin-field"><label>评测集名称</label><input class="admin-input" name="name" required></div><div class="admin-field"><label>领域</label><input class="admin-input" name="domain"></div><div class="admin-field"><label>发布门槛</label><input class="admin`
- `frontend/src/pages/admin-governance.js:73` — `create_experiment: '<div class="admin-form-grid"><div class="admin-field is-wide"><label>实验名称</label><input class="admin-input" name="name" required></div><div class="admin-field"><label>目标类型</label><select class="admin-select" name="target_type"><option value="agent">Agent</option><option value="mo`
- `frontend/src/pages/admin-governance.js:74` — `calculate: '<div class="admin-form-grid"><div class="admin-field"><label>教学班 ID</label><input class="admin-input" type="number" name="teaching_class_id" required></div><div class="admin-field"><label>课程 ID</label><input class="admin-input" type="number" name="course_id" required></div></div>',`
- `frontend/src/pages/admin-governance.js:75` — `create_asset: '<div class="admin-form-grid"><div class="admin-field"><label>资产标题</label><input class="admin-input" name="title" required></div><div class="admin-field"><label>资产类型</label><select class="admin-select" name="asset_type"><option value="quality_answer">优质回答</option><option value="teachin`
- `frontend/src/pages/admin-governance.js:76` — `compute: '<div class="admin-form-grid"><div class="admin-field"><label>学生用户 ID</label><input class="admin-input" type="number" name="student_user_id" required></div><div class="admin-field"><label>课程 ID（可选）</label><input class="admin-input" type="number" name="course_id"></div></div>',`
- `frontend/src/pages/admin-governance.js:77` — `resolve: '<div class="admin-form-grid"><div class="admin-field"><label>处理结果</label><select class="admin-select" name="status"><option value="resolved">已处置</option><option value="confirmed">确认风险</option><option value="false_positive">误报</option></select></div><div class="admin-field is-wide"><label>处`
- `frontend/src/pages/admin-governance.js:78` — `knowledge_resolve: '<div class="admin-form-grid"><div class="admin-field"><label>处理结果</label><select class="admin-select" name="status"><option value="resolved">已解决</option><option value="ignored">忽略并记录</option></select></div><div class="admin-field is-wide"><label>处理意见</label><textarea class="admin`
- `frontend/src/pages/admin-governance.js:79` — `run: '<div class="admin-form-grid"><div class="admin-field"><label>Agent ID</label><input class="admin-input" type="number" name="agent_config_id" required></div><div class="admin-field"><label>模型 ID（可选）</label><input class="admin-input" type="number" name="model_config_id"></div><div class="admin-f`
- `frontend/src/pages/admin-governance.js:80` — `experiment_status: '<div class="admin-form-grid"><div class="admin-field"><label>目标状态</label><select class="admin-select" name="status"><option value="published">发布</option><option value="running">开始运行</option><option value="paused">暂停</option><option value="terminated">终止</option><option value="rol`
- `frontend/src/pages/admin-governance.js:81` — `simulate: '<div class="admin-form-grid"><div class="admin-field"><label>干预类型</label><select class="admin-select" name="intervention_type"><option value="targeted_learning_flow">定向学习流</option><option value="targeted_practice">专项练习</option><option value="teacher_support">教师辅导</option></select></div><d`
- `frontend/src/pages/admin-governance.js:82` — `asset_status: '<div class="admin-form-grid"><div class="admin-field"><label>审核动作</label><select class="admin-select" name="action"><option value="submit_review">提交审核</option><option value="approve">审核通过</option><option value="reject">审核拒绝</option><option value="publish">发布</option><option value="off`
- `frontend/src/pages/admin-governance.js:130` — `root.innerHTML = '<div class="admin-error" role="alert"><div><strong>治理模块保持恢复隔离</strong><p>${escapeHtml(error?.message || '请求失败，请稍后重试。')}</p><button class="admin-button is-secondary" id="retry-governance-load" type="button">重新加载</button></div></div>'`
- 其余 116 处匹配已省略；可直接运行脚本或使用 `rg` 复核。

### 内联样式（前 120 处）

- `frontend/src/pages/admin-course-detail.js:88` — `<div style="margin-bottom:20px;">`
- `frontend/src/pages/admin-course-detail.js:170` — `<div style="margin-bottom:20px;">`
- `frontend/src/pages/admin-course-detail.js:177` — `<div class="card" style="margin-bottom:20px;padding:20px;">`
- `frontend/src/pages/admin-course-detail.js:178` — `<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">`
- `frontend/src/pages/admin-course-detail.js:179` — `<div style="flex:1;min-width:0;">`
- `frontend/src/pages/admin-course-detail.js:180` — `<h2 style="font-size:1.3rem;font-weight:700;color:var(--stu-dark);margin:0 0 6px;">`
- `frontend/src/pages/admin-course-detail.js:183` — `<div style="color:var(--text-secondary);font-size:0.85rem;">`
- `frontend/src/pages/admin-course-detail.js:185` — `<span style="margin:0 10px;">|</span>`
- `frontend/src/pages/admin-course-detail.js:187` — `<span style="background:${course.status === 'active' ? '#d1fae5' : '#fef3c7'};color:${course.status === 'active' ? '#065f46' : '#92400e'};padding:2px 8px;border-radius:10px;font-size:0.75rem;">`
- `frontend/src/pages/admin-course-detail.js:192` — `${course.description ? '<div style="color:var(--text-muted);font-size:0.85rem;margin-top:6px;">${escapeHtml(course.description)}</div>' : ''}`
- `frontend/src/pages/admin-course-detail.js:194` — `<div style="display:flex;gap:10px;flex-shrink:0;">`
- `frontend/src/pages/admin-course-detail.js:195` — `${canManage ? '<button class="btn btn-primary" id="btn-edit-course-info" style="font-size:0.85rem;padding:6px 14px;">编辑课程</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:198` — `<div style="display:flex;gap:20px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:0.85rem;color:var(--text-muted);flex-wrap:wrap;">`
- `frontend/src/pages/admin-course-detail.js:207` — `<div class="tabs-nav" style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:20px;">`
- `frontend/src/pages/admin-course-detail.js:208` — `<button class="tab-btn active" data-tab="chapters" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">`
- `frontend/src/pages/admin-course-detail.js:211` — `<button class="tab-btn" data-tab="knowledge" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">`
- `frontend/src/pages/admin-course-detail.js:214` — `<button class="tab-btn" data-tab="classes" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">`
- `frontend/src/pages/admin-course-detail.js:217` — `<button class="tab-btn" data-tab="teachers" style="padding:10px 22px;border:none;background:none;font-size:0.95rem;font-weight:600;color:var(--text-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.2s;">`
- `frontend/src/pages/admin-course-detail.js:223` — `<div class="tab-content" id="tab-chapters" style="display:block;">`
- `frontend/src/pages/admin-course-detail.js:224` — `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">`
- `frontend/src/pages/admin-course-detail.js:225` — `<h3 id="course-chapter-heading" style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">章节列表（${chapters.length}）</h3>`
- `frontend/src/pages/admin-course-detail.js:226` — `${canManage && course.status === 'active' ? '<button class="btn btn-primary" id="btn-create-chapter" style="font-size:0.85rem;padding:6px 14px;">新建章节</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:234` — `<div class="tab-content" id="tab-knowledge" style="display:none;">`
- `frontend/src/pages/admin-course-detail.js:235` — `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">`
- `frontend/src/pages/admin-course-detail.js:236` — `<h3 id="course-point-heading" style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">知识点（${allKnowledgePoints.length}）</h3>`
- `frontend/src/pages/admin-course-detail.js:237` — `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">`
- `frontend/src/pages/admin-course-detail.js:238` — `<select id="kp-chapter-filter" style="padding:6px 12px;border:1px solid var(--border);border-radius:8px;font-size:0.85rem;">`
- `frontend/src/pages/admin-course-detail.js:242` — `${canManage && course.status === 'active' ? '<button class="btn btn-primary" id="btn-create-kp" style="font-size:0.85rem;padding:6px 14px;">新建知识点</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:251` — `<div class="tab-content" id="tab-classes" style="display:none;">`
- `frontend/src/pages/admin-course-detail.js:252` — `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">`
- `frontend/src/pages/admin-course-detail.js:253` — `<h3 id="course-class-heading" style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">教学班级（${teachingClasses.length}）</h3>`
- `frontend/src/pages/admin-course-detail.js:254` — `${canManage && course.status === 'active' ? '<button class="btn btn-primary" id="btn-create-class" style="font-size:0.85rem;padding:6px 14px;">新建教学班</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:262` — `<div class="tab-content" id="tab-teachers" style="display:none;">`
- `frontend/src/pages/admin-course-detail.js:263` — `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">`
- `frontend/src/pages/admin-course-detail.js:264` — `<h3 id="course-teacher-heading" style="font-size:1.1rem;font-weight:600;color:var(--stu-dark);margin:0;">授课教师（${teachers.length}）</h3>`
- `frontend/src/pages/admin-course-detail.js:265` — `${canManage && course.status === 'active' ? '<button class="btn btn-primary" id="btn-add-teacher" style="font-size:0.85rem;padding:6px 14px;">添加教师</button>' : ''}`
- `frontend/src/pages/admin-course-detail.js:274` — `<div class="modal-overlay" id="course-edit-modal" role="dialog" aria-modal="true" aria-labelledby="course-edit-modal-title" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">`
- `frontend/src/pages/admin-course-detail.js:275` — `<div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">`
- `frontend/src/pages/admin-course-detail.js:276` — `<h3 id="course-edit-modal-title" style="margin-bottom:20px;font-size:1.2rem;">编辑课程</h3>`
- `frontend/src/pages/admin-course-detail.js:278` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:282` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:286` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:290` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:294` — `<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">`
- `frontend/src/pages/admin-course-detail.js:295` — `<button type="button" class="btn" id="btn-edit-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:303` — `<div class="modal-overlay" id="chapter-modal" role="dialog" aria-modal="true" aria-labelledby="chapter-modal-title" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">`
- `frontend/src/pages/admin-course-detail.js:304` — `<div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">`
- `frontend/src/pages/admin-course-detail.js:305` — `<h3 id="chapter-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建章节</h3>`
- `frontend/src/pages/admin-course-detail.js:307` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:311` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:315` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:319` — `<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">`
- `frontend/src/pages/admin-course-detail.js:320` — `<button type="button" class="btn" id="btn-chapter-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:328` — `<div class="modal-overlay" id="kp-modal" role="dialog" aria-modal="true" aria-labelledby="kp-modal-title" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">`
- `frontend/src/pages/admin-course-detail.js:329` — `<div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:520px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">`
- `frontend/src/pages/admin-course-detail.js:330` — `<h3 id="kp-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建知识点</h3>`
- `frontend/src/pages/admin-course-detail.js:332` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:334` — `<select id="form-kp-chapter" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:339` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:343` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:347` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:349` — `<select id="form-kp-difficulty" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:355` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:359` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:363` — `<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">`
- `frontend/src/pages/admin-course-detail.js:364` — `<button type="button" class="btn" id="btn-kp-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:372` — `<div class="modal-overlay" id="class-modal" role="dialog" aria-modal="true" aria-labelledby="class-modal-title" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">`
- `frontend/src/pages/admin-course-detail.js:373` — `<div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">`
- `frontend/src/pages/admin-course-detail.js:374` — `<h3 id="class-modal-title" style="margin-bottom:20px;font-size:1.2rem;">新建教学班级</h3>`
- `frontend/src/pages/admin-course-detail.js:376` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:380` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:384` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:388` — `<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">`
- `frontend/src/pages/admin-course-detail.js:389` — `<button type="button" class="btn" id="btn-class-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:397` — `<div class="modal-overlay" id="teacher-modal" role="dialog" aria-modal="true" aria-labelledby="teacher-modal-title" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">`
- `frontend/src/pages/admin-course-detail.js:398` — `<div class="modal-content" style="background:#fff;border-radius:16px;padding:28px;width:480px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">`
- `frontend/src/pages/admin-course-detail.js:399` — `<h3 id="teacher-modal-title" style="margin-bottom:20px;font-size:1.2rem;">添加授课教师</h3>`
- `frontend/src/pages/admin-course-detail.js:401` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:403` — `<select id="form-teacher-user" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:410` — `${teacherUsers.filter(tu => !boundTeacherUserIds.has(tu.user_id)).length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem;margin-top:6px;">暂无可选教师（所有教师已添加）</p>' : ''}`
- `frontend/src/pages/admin-course-detail.js:412` — `<div class="form-group" style="margin-bottom:14px;">`
- `frontend/src/pages/admin-course-detail.js:414` — `<select id="form-teacher-role" required style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;">`
- `frontend/src/pages/admin-course-detail.js:420` — `<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">`
- `frontend/src/pages/admin-course-detail.js:421` — `<button type="button" class="btn" id="btn-teacher-modal-cancel" style="border:1px solid var(--border);">取消</button>`
- `frontend/src/pages/admin-course-detail.js:463` — `<div style="margin-bottom:20px;">`
- `frontend/src/pages/admin-course-detail.js:479` — `return '<div class="empty-hint" style="padding:40px 0;">暂无章节，点击上方"新建章节"开始创建</div>'`
- `frontend/src/pages/admin-course-detail.js:483` — `<div style="display:flex;flex-direction:column;gap:10px;">`
- `frontend/src/pages/admin-course-detail.js:485` — `<div class="card" style="padding:16px 18px;border-left:4px solid var(--stu-primary);">`
- `frontend/src/pages/admin-course-detail.js:486` — `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">`
- `frontend/src/pages/admin-course-detail.js:487` — `<div style="flex:1;min-width:0;">`
- `frontend/src/pages/admin-course-detail.js:488` — `<div style="display:flex;align-items:center;gap:10px;">`
- `frontend/src/pages/admin-course-detail.js:489` — `<span style="width:26px;height:26px;border-radius:50%;background:var(--stu-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;flex-shrink:0;">${idx + 1}</span>`
- `frontend/src/pages/admin-course-detail.js:490` — `<span style="font-weight:600;color:var(--stu-dark);font-size:1rem;">${escapeHtml(ch.chapter_name)}</span>`
- `frontend/src/pages/admin-course-detail.js:491` — `${ch.chapter_order != null ? '<span style="font-size:0.8rem;color:var(--text-muted);">（排序：${ch.chapter_order}）</span>' : ''}`
- `frontend/src/pages/admin-course-detail.js:493` — `${ch.description ? '<div style="margin-top:6px;margin-left:36px;color:var(--text-muted);font-size:0.85rem;">${escapeHtml(ch.description)}</div>' : ''}`
- `frontend/src/pages/admin-course-detail.js:495` — `<div style="display:flex;align-items:center;gap:14px;flex-shrink:0;">`
- `frontend/src/pages/admin-course-detail.js:496` — `<span style="font-size:0.85rem;color:var(--text-muted);">${ch.knowledge_point_count != null ? ch.knowledge_point_count : allKnowledgePoints.filter(kp => kp.chapter_id === ch.chapter_id).length} 个知识点</span>`
- `frontend/src/pages/admin-course-detail.js:497` — `${canManage && course.status === 'active' ? '<button class="btn-edit-chapter" data-chapter-id="${ch.chapter_id}" style="padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);cursor:pointer;font-size:0.8rem;">编辑</button><button class="btn-delete-chapter" data-chapter-`
- `frontend/src/pages/admin-course-detail.js:508` — `return '<div class="empty-hint" style="padding:40px 0;">暂无知识点，点击上方"新建知识点"开始创建</div>'`
- `frontend/src/pages/admin-course-detail.js:511` — `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px;">`
- `frontend/src/pages/admin-course-detail.js:516` — `<div class="card" style="padding:16px;">`
- `frontend/src/pages/admin-course-detail.js:517` — `<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">`
- `frontend/src/pages/admin-course-detail.js:518` — `<h4 style="font-size:0.95rem;font-weight:600;color:var(--stu-dark);margin:0;flex:1;">${escapeHtml(kp.knowledge_point_name)}</h4>`
- `frontend/src/pages/admin-course-detail.js:519` — `<span style="font-size:0.75rem;padding:2px 8px;border-radius:6px;${diffStyle}flex-shrink:0;">${DIFFICULTY_LABEL[kp.difficulty_level] || kp.difficulty_level || '未知'}</span>`
- `frontend/src/pages/admin-course-detail.js:521` — `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">`
- `frontend/src/pages/admin-course-detail.js:523` — `${chapter ? '<span style="margin-left:12px;">章节：${escapeHtml(chapter.chapter_name)}</span>' : ''}`
- `frontend/src/pages/admin-course-detail.js:525` — `${kp.aliases ? '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">别名：${escapeHtml(kp.aliases)}</div>' : ''}`
- `frontend/src/pages/admin-course-detail.js:526` — `${kp.description ? '<div style="font-size:0.8rem;color:var(--text-muted);">${escapeHtml(kp.description)}</div>' : ''}`
- `frontend/src/pages/admin-course-detail.js:527` — `${canManage && course.status === 'active' ? '<div style="display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><button class="btn-edit-kp" data-kp-id="${kp.knowledge_point_id}" style="flex:1;padding:5px;border:1px solid var(--border);border-radius:6px;background:`
- `frontend/src/pages/admin-course-detail.js:537` — `return '<div class="empty-hint" style="padding:40px 0;">暂无教学班级，点击上方"新建班级"开始创建</div>'`
- `frontend/src/pages/admin-course-detail.js:540` — `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">`
- `frontend/src/pages/admin-course-detail.js:542` — `<div class="card" style="padding:18px;border-left:4px solid var(--stu-primary);">`
- `frontend/src/pages/admin-course-detail.js:543` — `<h4 style="font-size:1rem;font-weight:600;color:var(--stu-dark);margin:0 0 8px;">${escapeHtml(tc.teaching_class_name)}</h4>`
- `frontend/src/pages/admin-course-detail.js:544` — `<div style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:12px;">`
- `frontend/src/pages/admin-course-detail.js:546` — `${tc.description ? '<div style="margin-top:4px;color:var(--text-muted);">${escapeHtml(tc.description)}</div>' : ''}`
- `frontend/src/pages/admin-course-detail.js:548` — `<div style="display:flex;gap:16px;font-size:0.8rem;color:var(--text-muted);padding-top:10px;border-top:1px solid var(--border);margin-bottom:12px;">`
- `frontend/src/pages/admin-course-detail.js:552` — `${canManage && course.status === 'active' ? '<div style="display:flex;gap:8px;"><button class="btn-edit-class" data-class-id="${tc.teaching_class_id}" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:pointer;font-size:0.85rem;">编辑</button><button`
- `frontend/src/pages/admin-course-detail.js:561` — `return '<div class="empty-hint" style="padding:40px 0;">暂无授课教师，点击上方"添加教师"开始添加</div>'`
- `frontend/src/pages/admin-course-detail.js:564` — `<div style="display:flex;flex-direction:column;gap:10px;">`
- `frontend/src/pages/admin-course-detail.js:566` — `<div class="card" style="padding:14px 18px;display:flex;align-items:center;gap:14px;">`
- 其余 106 处匹配已省略；可直接运行脚本或使用 `rg` 复核。

## 错误掩盖与硬编码风险

### 静默空数组/空对象回退

- 未发现匹配。

### Mock、随机或“开发中”标记

- 未发现匹配。

### 硬编码统计展示候选

- 未发现匹配。

### 原生 alert/confirm/prompt

- 未发现匹配。

### Emoji

- 未发现匹配。

### 全部 catch 位置（前 160 处，需人工区分正常处理与静默吞错）

- `frontend/src/pages/admin-agent-reviews.js:38` — `try { access = await loadAdminAccess(user.user_id) } catch (error) {`
- `frontend/src/pages/admin-agent-reviews.js:77` — `} catch (error) { notify(error.message, true); setButtonBusy(button, false) }`
- `frontend/src/pages/admin-agent-reviews.js:83` — `try { await resolveAdminAgentReport(button.closest('[data-report-id]').dataset.reportId, resolution, offline, operationId()); notify('举报已处理'); await load(tab) } catch (error) { notify(error.message, true); setButtonBusy(button, false) }`
- `frontend/src/pages/admin-agent-reviews.js:85` — `} catch (error) { root.innerHTML = '<div class="agent-market-empty is-error"><p>${escapeHtml(error.message)}</p></div>' }`
- `frontend/src/pages/admin-ai-config.js:96` — `try { state.providers = arrayData(providersResult.value, '供应商') } catch (error) { state.providers = []; state.warnings.push(warningFrom('供应商名称', error)) }`
- `frontend/src/pages/admin-ai-config.js:106` — `try { state.providers = arrayData(providersResult.value, '供应商') } catch (error) { state.providers = []; state.warnings.push(warningFrom('供应商绑定', error)) }`
- `frontend/src/pages/admin-ai-config.js:112` — `try { state.models = arrayData(modelsResult.value, '模型') } catch (error) { state.models = []; state.warnings.push(warningFrom('模型绑定', error)) }`
- `frontend/src/pages/admin-ai-config.js:125` — `} catch (error) {`
- `frontend/src/pages/admin-ai-config.js:199` — `try { await openRollback(agent) } catch (error) { notifyAdmin(error.message, true) } return`
- `frontend/src/pages/admin-ai-config.js:212` — `} catch (error) { notifyAdmin(error.message, true); setBusy(button, false) }`
- `frontend/src/pages/admin-classes.js:46` — `} catch (error) {`
- `frontend/src/pages/admin-classes.js:116` — `} catch (error) {`
- `frontend/src/pages/admin-classes.js:152` — `} catch (error) {`
- `frontend/src/pages/admin-classes.js:183` — `} catch (error) { notifyAdmin(error.message || '移出失败', true) }`
- `frontend/src/pages/admin-classes.js:207` — `try { await deleteAdminClass(item.admin_class_id); notifyAdmin('行政班已删除'); await load() } catch (error) { notifyAdmin(error.message || '删除失败', true) }`
- `frontend/src/pages/admin-course-detail.js:64` — `} catch {`
- `frontend/src/pages/admin-course-detail.js:76` — `} catch {`
- `frontend/src/pages/admin-course-detail.js:120` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:151` — `} catch (error) {`
- `frontend/src/pages/admin-course-detail.js:658` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:704` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:726` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:793` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:848` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:876` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:922` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:967` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:989` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:1021` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:1061` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:1074` — `} catch (err) {`
- `frontend/src/pages/admin-course-detail.js:1095` — `} catch (error) {`
- `frontend/src/pages/admin-course-detail.js:1108` — `} catch (err) {`
- `frontend/src/pages/admin-courses.js:49` — `} catch {`
- `frontend/src/pages/admin-courses.js:61` — `} catch {`
- `frontend/src/pages/admin-courses.js:99` — `} catch (err) {`
- `frontend/src/pages/admin-courses.js:378` — `} catch (err) {`
- `frontend/src/pages/admin-courses.js:398` — `} catch (err) {`
- `frontend/src/pages/admin-dashboard.js:235` — `} catch (error) {`
- `frontend/src/pages/admin-governance.js:128` — `root.querySelectorAll('[data-row-action]').forEach((button) => button.addEventListener('click', async () => { const id = button.closest('tr').dataset.id; if (['resolve','publish'].includes(button.dataset.rowAction) && !(await confirmAdmin({ title: '确认治理操作', message: '该操作会更新真实业务状态并写入操作审计。', confirmLa`
- `frontend/src/pages/admin-governance.js:129` — `} catch (error) {`
- `frontend/src/pages/admin-governance.js:143` — `document.getElementById('governance-refresh').addEventListener('click', () => load(module)); document.getElementById('governance-primary')?.addEventListener('click', async (event) => { const action = meta.primaryAction; if (['scan','detect'].includes(action)) { setBusy(event.currentTarget, true); tr`
- `frontend/src/pages/admin-knowledge.js:18` — `} catch {`
- `frontend/src/pages/admin-knowledge.js:24` — `try { access = await loadAdminAccess(user.user_id) } catch (error) {`
- `frontend/src/pages/admin-knowledge.js:41` — `} catch (err) {`
- `frontend/src/pages/admin-knowledge.js:188` — `} catch (err) {`
- `frontend/src/pages/admin-logs.js:16` — `} catch {`
- `frontend/src/pages/admin-logs.js:32` — `} catch (err) {`
- `frontend/src/pages/admin-notifications.js:192` — `} catch (error) {`
- `frontend/src/pages/admin-notifications.js:208` — `} catch (error) {`
- `frontend/src/pages/admin-notifications.js:234` — `} catch (error) {`
- `frontend/src/pages/admin-notifications.js:289` — `} catch (error) {`
- `frontend/src/pages/admin-permissions.js:143` — `} catch (error) {`
- `frontend/src/pages/admin-profile.js:18` — `} catch {`
- `frontend/src/pages/admin-profile.js:109` — `try { await resetUserPassword(user.user_id, password); notifyAdmin('密码修改成功') } catch (error) { notifyAdmin(error.message || '密码修改失败', true) }`
- `frontend/src/pages/admin-teaching-classes.js:25` — `try { access = await loadAdminAccess(user.user_id) } catch (error) {`
- `frontend/src/pages/admin-teaching-classes.js:66` — `} catch (error) { state.list = []; state.total = 0; state.totalPages = 1; state.error = error.message || '请求失败' }`
- `frontend/src/pages/admin-teaching-classes.js:99` — `} catch (error) { notifyAdmin(error.message || '成员数据加载失败', true); return }`
- `frontend/src/pages/admin-teaching-classes.js:105` — `drawer.root.querySelectorAll('[data-drop-student]').forEach((button) => button.addEventListener('click', async () => { const confirmed = await confirmAdmin({ title: '学生退班', message: '将保留选课历史，并把当前选课标记为已退班。', confirmLabel: '确认退班', danger: true }); if (!confirmed) return; try { await removeTeachingClas`
- `frontend/src/pages/admin-teaching-classes.js:117` — `document.querySelectorAll('[data-teaching-delete]').forEach((button) => button.addEventListener('click', async () => { const item = state.list.find((entry) => entry.teaching_class_id === Number(button.dataset.teachingDelete)); if (item.status === 'archived') return; const confirmed = await confirmAd`
- `frontend/src/pages/admin-teaching-classes.js:121` — `try { await loadAuxiliary() } catch (error) { notifyAdmin('部分选项加载失败：${error.message}', true) }`
- `frontend/src/pages/admin-traces.js:31` — `document.querySelectorAll('[data-trace-view]').forEach((button) => button.addEventListener('click', () => showTrace(button.closest('tr').dataset.traceId).catch((error) => notifyAdmin(error.message, true))))`
- `frontend/src/pages/admin-traces.js:48` — `} catch (error) {`
- `frontend/src/pages/admin-users.js:293` — `} catch {`
- `frontend/src/pages/admin-users.js:299` — `} catch (error) {`
- `frontend/src/pages/admin-users.js:524` — `} catch (err) {`
- `frontend/src/pages/admin-users.js:628` — `} catch (err) { showToast(err.message || '操作失败', 'error') }`
- `frontend/src/pages/admin-users.js:640` — `} catch (err) { showToast(err.message || '操作失败', 'error') }`
- `frontend/src/pages/admin-users.js:651` — `} catch (err) { showToast(err.message || '操作失败', 'error') }`
- `frontend/src/pages/admin-users.js:660` — `} catch (err) { showToast(err.message || '删除失败', 'error') }`
- `backend/src/controllers/admin-ai.controller.js:19` — `catch (error) { return fail(res, error.code || 50001, error.message); }`
- `backend/src/controllers/admin-class.controller.js:27` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:40` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:50` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:60` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:69` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:80` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:90` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:102` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:110` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:124` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:134` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:144` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:154` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:168` — `} catch (err) {`
- `backend/src/controllers/admin-class.controller.js:179` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:27` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:40` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:50` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:60` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:70` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:84` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:95` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:107` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:121` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:131` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:141` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:153` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:176` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:186` — `} catch (err) {`
- `backend/src/controllers/admin-course.controller.js:196` — `} catch (err) {`
- `backend/src/controllers/admin-dashboard.controller.js:10` — `} catch (err) {`
- `backend/src/controllers/admin-governance.controller.js:6` — `catch (error) { return fail(res, error.code || 50001, error.message); }`
- `backend/src/controllers/admin-governance.controller.js:11` — `catch (error) { return fail(res, error.code || 50001, error.message); }`
- `backend/src/controllers/admin-governance.controller.js:16` — `catch (error) { return fail(res, error.code || 50001, error.message); }`
- `backend/src/controllers/admin-knowledge.controller.js:10` — `} catch (err) {`
- `backend/src/controllers/admin-knowledge.controller.js:30` — `} catch (err) {`
- `backend/src/controllers/admin-log.controller.js:10` — `} catch (err) {`
- `backend/src/controllers/admin-notification.controller.js:10` — `} catch (err) {`
- `backend/src/controllers/admin-notification.controller.js:21` — `} catch (err) {`
- `backend/src/controllers/admin-notification.controller.js:35` — `} catch (err) {`
- `backend/src/controllers/admin-notification.controller.js:45` — `} catch (err) {`
- `backend/src/controllers/admin-rbac.controller.js:18` — `} catch (error) {`
- `backend/src/controllers/admin-trace.controller.js:9` — `catch (error) { return fail(res, error.code || 50001, error.message); }`
- `backend/src/controllers/admin-trace.controller.js:14` — `catch (error) { return fail(res, error.code || 50001, error.message); }`
- `backend/src/controllers/admin-trace.controller.js:38` — `} catch (error) { return fail(res, error.code || 50001, error.message); }`
- `backend/src/controllers/admin-user.controller.js:29` — `} catch (err) {`
- `backend/src/controllers/admin-user.controller.js:46` — `} catch (err) {`
- `backend/src/controllers/admin-user.controller.js:64` — `} catch (err) {`
- `backend/src/controllers/admin-user.controller.js:77` — `} catch (err) {`
- `backend/src/controllers/admin-user.controller.js:89` — `} catch (err) {`
- `backend/src/controllers/admin-user.controller.js:100` — `} catch (err) {`
- `backend/src/services/admin-ai-config.service.js:145` — `} catch (error) {`
- `backend/src/services/admin-audit.service.js:33` — `} catch (error) {`
- `backend/src/services/admin-class.service.js:144` — `} catch (error) {`
- `backend/src/services/admin-class.service.js:184` — `} catch (error) {`
- `backend/src/services/admin-class.service.js:215` — `} catch (error) {`
- `backend/src/services/admin-class.service.js:481` — `} catch (error) {`
- `backend/src/services/admin-class.service.js:536` — `} catch (error) {`
- `backend/src/services/admin-class.service.js:581` — `} catch (error) {`
- `backend/src/services/admin-course.service.js:138` — `} catch (error) {`
- `backend/src/services/admin-course.service.js:210` — `} catch (error) {`
- `backend/src/services/admin-course.service.js:282` — `} catch (error) {`
- `backend/src/services/admin-course.service.js:477` — `} catch (error) {`
- `backend/src/services/admin-course.service.js:509` — `} catch (error) {`
- `backend/src/services/admin-course.service.js:526` — `} catch (error) {`
- `backend/src/services/admin-dashboard.service.js:54` — `} catch (_error) {`
- `backend/src/services/admin-environment.service.js:20` — `} catch { return false; }`
- `backend/src/services/admin-environment.service.js:25` — `try { await fs.promises.access(path.resolve(value), fs.constants.R_OK); return true; } catch { return false; }`
- `backend/src/services/admin-environment.service.js:34` — `} catch { return false; }`
- `backend/src/services/admin-environment.service.js:39` — `try { await prisma.$queryRaw'SELECT 1'; databaseAvailable = true; } catch {}`
- `backend/src/services/admin-governance.service.js:179` — `try { validateGraphJson(version.graph_json); } catch (error) { valid = false; severity = 'high'; message = String(error.message).slice(0, 500); evidence = { code: error.code || 'WORKFLOW_STRUCTURE_INVALID' }; }`
- `backend/src/services/admin-governance.service.js:298` — `} catch (error) {`
- `backend/src/services/admin-permission.service.js:55` — `} catch (error) {`
- `backend/src/services/admin-secret.service.js:11` — `try { candidates.push(Buffer.from(raw, 'base64')); } catch {}`
- `backend/src/services/admin-user.service.js:252` — `} catch (error) {`
- `backend/src/services/admin-user.service.js:313` — `} catch (error) {`
- `backend/src/services/admin-user.service.js:375` — `} catch (error) {`
- `backend/src/services/admin-user.service.js:451` — `} catch (error) {`

## 可能访问未定义属性的位置（前 160 处）

- `frontend/src/pages/admin-agent-reviews.js:64` — `const items = result.data.list || []`
- `frontend/src/pages/admin-ai-config.js:14` — `const can = (permission) => hasAdminPermission(state.access, permission)`
- `frontend/src/pages/admin-ai-config.js:23` — `if (!state.providers.length) return emptyHTML('暂无供应商', '新增供应商后可配置真实模型与 Agent。')`
- `frontend/src/pages/admin-ai-config.js:24` — `return '<div class="admin-provider-grid">${state.providers.map((item) => '<article class="admin-provider-card" data-provider-id="${item.id}">`
- `frontend/src/pages/admin-ai-config.js:33` — `if (!state.models.length) return emptyHTML('暂无模型', '选择供应商并新增真实模型配置。')`
- `frontend/src/pages/admin-ai-config.js:34` — `return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>模型</th><th>供应商</th><th>类型</th><th>能力</th><th>上下文</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.models.map((model) => {`
- `frontend/src/pages/admin-ai-config.js:35` — `const provider = state.providers.find((item) => item.id === model.provider_id)`
- `frontend/src/pages/admin-ai-config.js:42` — `if (!state.agents.length) return emptyHTML('暂无 Agent 配置', '新增 Agent 并绑定真实供应商和模型。')`
- `frontend/src/pages/admin-ai-config.js:43` — `return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Agent</th><th>运行模式</th><th>供应商 / 模型</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.agents.map((agent) => {`
- `frontend/src/pages/admin-ai-config.js:44` — `const provider = state.providers.find((item) => item.id === agent.provider_id); const model = state.models.find((item) => item.id === agent.model_id)`
- `frontend/src/pages/admin-ai-config.js:50` — `if (!state.environment) return '<div class="admin-skeleton"></div>'`
- `frontend/src/pages/admin-ai-config.js:51` — `const entries = Object.entries(state.environment).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && 'configured' in value)`
- `frontend/src/pages/admin-ai-config.js:52` — `const providers = Object.entries(state.environment.providers || {}).filter(([, value]) => value && typeof value === 'object').map(([key, value]) => [providerTypeLabel[key] || key, value])`
- `frontend/src/pages/admin-ai-config.js:53` — `return '<div class="admin-grid-3">${[...entries, ...providers].map(([name, value]) => '<article class="admin-card admin-environment-item"><div>${getIcon(value.available === false ? 'alert' : 'settings')}</div><h3>${escapeHtml(name.replaceAll('_', ' '))}</h3><p>${value.configured ? '已配置' : '未配置'}${'a`
- `frontend/src/pages/admin-ai-config.js:58` — `const heading = state.tab === 'agents' ? '智能体运营与版本' : state.tab === 'environment' ? '密钥与环境' : state.tab === 'models' ? '模型管理' : '供应商配置'`
- `frontend/src/pages/admin-ai-config.js:59` — `root.innerHTML = '<div class="admin-page-header"><div><h2>${heading}</h2><p>数据库启用配置优先于环境变量与安全默认值；密钥仅在后端使用 AES-256-GCM 保存，前端永不回显。</p></div><div class="admin-header-actions">${state.tab === 'providers' && can('admin.ai.providers.manage') ? '<button class="admin-button" id="add-provider">新增供应商</button>`
- `frontend/src/pages/admin-ai-config.js:60` — `${state.tab === 'models' && state.modelProviderId ? '<div class="admin-load-warning" role="status"><strong>已按供应商筛选模型</strong><button class="admin-button is-ghost" type="button" id="clear-model-provider">清除筛选</button></div>' : ''}`
- `frontend/src/pages/admin-ai-config.js:61` — `${state.warnings.length ? '<div class="admin-load-warning" role="status"><strong>部分关联数据未加载</strong><ul>${state.warnings.map((warning) => '<li>${escapeHtml(warning)}</li>').join('')}</ul></div>' : ''}`
- `frontend/src/pages/admin-ai-config.js:67` — `renderFrame(state.tab === 'providers' ? providerCards() : state.tab === 'models' ? modelTable() : state.tab === 'agents' ? agentTable() : environmentPanel())`
- `frontend/src/pages/admin-ai-config.js:72` — `return result.data`
- `frontend/src/pages/admin-ai-config.js:87` — `state.warnings = []`
- `frontend/src/pages/admin-ai-config.js:89` — `if (state.tab === 'providers') {`
- `frontend/src/pages/admin-ai-config.js:90` — `state.providers = arrayData(await getAiProviders(), '供应商')`
- `frontend/src/pages/admin-ai-config.js:91` — `} else if (state.tab === 'models') {`
- `frontend/src/pages/admin-ai-config.js:92` — `const [modelsResult, providersResult] = await Promise.allSettled([getAiModels(state.modelProviderId ? { provider_id: state.modelProviderId } : undefined), getAiProviders()])`
- `frontend/src/pages/admin-ai-config.js:94` — `state.models = arrayData(modelsResult.value, '模型')`
- `frontend/src/pages/admin-ai-config.js:96` — `try { state.providers = arrayData(providersResult.value, '供应商') } catch (error) { state.providers = []; state.warnings.push(warningFrom('供应商名称', error)) }`
- `frontend/src/pages/admin-ai-config.js:98` — `state.providers = []`
- `frontend/src/pages/admin-ai-config.js:99` — `state.warnings.push(warningFrom('供应商名称', providersResult.reason))`
- `frontend/src/pages/admin-ai-config.js:101` — `} else if (state.tab === 'agents') {`
- `frontend/src/pages/admin-ai-config.js:104` — `state.agents = arrayData(agentsResult.value, 'Agent')`
- `frontend/src/pages/admin-ai-config.js:106` — `try { state.providers = arrayData(providersResult.value, '供应商') } catch (error) { state.providers = []; state.warnings.push(warningFrom('供应商绑定', error)) }`
- `frontend/src/pages/admin-ai-config.js:108` — `state.providers = []`
- `frontend/src/pages/admin-ai-config.js:109` — `state.warnings.push(warningFrom('供应商绑定', providersResult.reason))`
- `frontend/src/pages/admin-ai-config.js:112` — `try { state.models = arrayData(modelsResult.value, '模型') } catch (error) { state.models = []; state.warnings.push(warningFrom('模型绑定', error)) }`
- `frontend/src/pages/admin-ai-config.js:114` — `state.models = []`
- `frontend/src/pages/admin-ai-config.js:115` — `state.warnings.push(warningFrom('模型绑定', modelsResult.reason))`
- `frontend/src/pages/admin-ai-config.js:118` — `state.environment = null`
- `frontend/src/pages/admin-ai-config.js:120` — `if (!result?.data || typeof result.data !== 'object') throw new Error('环境状态接口未返回受支持的数据结构')`
- `frontend/src/pages/admin-ai-config.js:121` — `state.environment = result.data`
- `frontend/src/pages/admin-ai-config.js:138` — `const payload = Object.fromEntries(data.entries()); payload.enabled = data.has('enabled'); payload.timeout_ms = Number(payload.timeout_ms); payload.max_retries = Number(payload.max_retries); payload.extra_config_json = { headers: parseJsonField(payload.headers_json, '自定义请求头'), parameters: parseJsonF`
- `frontend/src/pages/admin-ai-config.js:153` — `const payload = Object.fromEntries([...data.entries()].filter(([, value]) => String(value).trim()).map(([key, value]) => [key, String(value).trim()]))`
- `frontend/src/pages/admin-ai-config.js:160` — `return '<div class="admin-form-grid"><div class="admin-field"><label>供应商 <span class="required">*</span></label><select class="admin-select" name="provider_id" required>${state.providers.map((p) => '<option value="${p.id}" ${item.provider_id === p.id ? 'selected' : ''}>${escapeHtml(p.display_name)}<`
- `frontend/src/pages/admin-ai-config.js:165` — `const payload = Object.fromEntries(data.entries()); payload.provider_id = Number(payload.provider_id); payload.parameters_json = parseJsonField(payload.parameters_json, '模型参数'); ['max_context_length','max_output_tokens'].forEach((key) => payload[key] = payload[key] ? Number(payload[key]) : null); ['`
- `frontend/src/pages/admin-ai-config.js:171` — `return '<div class="admin-form-grid">${item.id ? '' : '<div class="admin-field"><label>Agent Key <span class="required">*</span></label><input class="admin-input" name="agent_key" pattern="[a-z0-9][a-z0-9_-]*" required></div>'}<div class="admin-field"><label>名称 <span class="required">*</span></label`
- `frontend/src/pages/admin-ai-config.js:176` — `const payload = Object.fromEntries(data.entries()); payload.provider_id = payload.provider_id ? Number(payload.provider_id) : null; payload.model_config_id = payload.model_config_id ? Number(payload.model_config_id) : null; payload.timeout_ms = Number(payload.timeout_ms); payload.max_output_tokens =`
- `frontend/src/pages/admin-ai-config.js:184` — `openAdminDrawer({ title: '回滚 Agent 版本', submitLabel: '确认回滚', content: '<div class="admin-field"><label>目标版本记录</label><select class="admin-select" name="version_id" required>${detail.versions.map((version) => '<option value="${version.id}">v${version.version_number} · ${escapeHtml(version.status)} · `
- `frontend/src/pages/admin-ai-config.js:192` — `const provider = state.providers.find((item) => item.id === providerId); const model = state.models.find((item) => item.id === modelId); const agent = state.agents.find((item) => item.id === agentId)`
- `frontend/src/pages/admin-ai-config.js:218` — `state.access = await loadAdminAccess(user.user_id)`
- `frontend/src/pages/admin-ai-config.js:222` — `state.tab = hash.includes('/admin/agents') ? 'agents' : hash.includes('/admin/environment') ? 'environment' : ['providers', 'models'].includes(requestedTab) ? requestedTab : 'providers'`
- `frontend/src/pages/admin-ai-config.js:223` — `state.modelProviderId = state.tab === 'models' && Number(params.get('provider_id')) > 0 ? Number(params.get('provider_id')) : null`
- `frontend/src/pages/admin-ai-config.js:224` — `if (state.tab === 'providers' && !can('admin.ai.providers.view')) state.tab = can('admin.ai.models.view') ? 'models' : can('admin.agents.view') ? 'agents' : 'environment'`
- `frontend/src/pages/admin-ai-config.js:225` — `if (state.tab === 'models' && !can('admin.ai.models.view')) state.tab = can('admin.ai.providers.view') ? 'providers' : 'environment'`
- `frontend/src/pages/admin-ai-config.js:226` — `renderAdminPage(app, { user, title: state.tab === 'agents' ? '智能体运营' : state.tab === 'environment' ? '密钥与环境' : state.tab === 'models' ? '模型管理' : '供应商配置', contentHTML: '<div class="admin-page" id="admin-ai-root"><div class="admin-skeleton"></div></div>' })`
- `frontend/src/pages/admin-classes.js:58` — `if (!state.total) return ''`
- `frontend/src/pages/admin-classes.js:59` — `return '<div class="admin-pagination"><span>共 ${state.total} 个行政班 · 第 ${state.page}/${state.totalPages} 页</span><div class="admin-pagination-actions"><button class="admin-button is-secondary" id="class-prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><button class="admin-button is-secondary" i`
- `frontend/src/pages/admin-classes.js:63` — `return state.list.map((item) => '<tr>`
- `frontend/src/pages/admin-classes.js:79` — `if (state.loading) body = '<div class="admin-skeleton" aria-label="正在加载"></div>'`
- `frontend/src/pages/admin-classes.js:80` — `else if (state.error) body = '<div class="admin-error"><div>${getIcon('alert')}<strong>行政班加载失败</strong><p>${escapeHtml(state.error)}</p><button class="admin-button" id="class-retry">重新加载</button></div></div>'`
- `frontend/src/pages/admin-classes.js:81` — `else if (!state.list.length) body = emptyHTML('暂无行政班', state.keyword || state.college || state.grade || state.status ? '没有符合当前筛选条件的行政班。' : '创建行政班后，可维护学生归属并关联教学班。')`
- `frontend/src/pages/admin-classes.js:90` — `<div class="admin-field is-search"><label for="class-keyword">关键词</label><input class="admin-input" id="class-keyword" value="${escapeHtml(state.keyword)}" placeholder="班级、学院或专业"></div>`
- `frontend/src/pages/admin-classes.js:91` — `<div class="admin-field"><label for="class-college-filter">学院</label><input class="admin-input" id="class-college-filter" value="${escapeHtml(state.college)}"></div>`
- `frontend/src/pages/admin-classes.js:92` — `<div class="admin-field"><label for="class-grade-filter">年级</label><input class="admin-input" id="class-grade-filter" value="${escapeHtml(state.grade)}"></div>`
- `frontend/src/pages/admin-classes.js:93` — `<div class="admin-field"><label for="class-status-filter">状态</label><select class="admin-select" id="class-status-filter"><option value="">全部</option><option value="active" ${state.status === 'active' ? 'selected' : ''}>正常</option><option value="disabled" ${state.status === 'disabled' ? 'selected' :`
- `frontend/src/pages/admin-classes.js:96` — `<section class="admin-card"><div class="admin-card-header"><div><h3>行政班列表</h3><p>数据直接来自行政班与用户档案关系。</p></div><span class="admin-badge is-info">${state.total} 个</span></div>${body}</section>`
- `frontend/src/pages/admin-classes.js:103` — `state.loading = true; state.error = ''; render()`
- `frontend/src/pages/admin-classes.js:106` — `page: state.page, page_size: state.pageSize,`
- `frontend/src/pages/admin-classes.js:107` — `...(state.keyword ? { keyword: state.keyword } : {}),`
- `frontend/src/pages/admin-classes.js:108` — `...(state.college ? { college: state.college } : {}),`
- `frontend/src/pages/admin-classes.js:109` — `...(state.grade ? { grade: state.grade } : {}),`
- `frontend/src/pages/admin-classes.js:110` — `...(state.status ? { status: state.status } : {}),`
- `frontend/src/pages/admin-classes.js:112` — `const data = result.data || {}`
- `frontend/src/pages/admin-classes.js:113` — `state.list = data.list || []`
- `frontend/src/pages/admin-classes.js:114` — `state.total = Number(data.total || 0)`
- `frontend/src/pages/admin-classes.js:115` — `state.totalPages = Number(data.total_pages || Math.max(1, Math.ceil(state.total / state.pageSize)))`
- `frontend/src/pages/admin-classes.js:117` — `state.list = []; state.total = 0; state.totalPages = 1; state.error = error.message || '请求失败'`
- `frontend/src/pages/admin-classes.js:118` — `} finally { state.loading = false; render() }`
- `frontend/src/pages/admin-classes.js:191` — `state.keyword = document.getElementById('class-keyword')?.value.trim() || ''`
- `frontend/src/pages/admin-classes.js:192` — `state.college = document.getElementById('class-college-filter')?.value.trim() || ''`
- `frontend/src/pages/admin-classes.js:193` — `state.grade = document.getElementById('class-grade-filter')?.value.trim() || ''`
- `frontend/src/pages/admin-classes.js:194` — `state.status = document.getElementById('class-status-filter')?.value || ''`
- `frontend/src/pages/admin-classes.js:195` — `state.page = 1; load()`
- `frontend/src/pages/admin-classes.js:199` — `document.getElementById('class-prev')?.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; load() } })`
- `frontend/src/pages/admin-classes.js:200` — `document.getElementById('class-next')?.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; load() } })`
- `frontend/src/pages/admin-classes.js:201` — `document.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => openEditor(state.list.find((item) => item.admin_class_id === Number(button.dataset.edit)))))`
- `frontend/src/pages/admin-classes.js:202` — `document.querySelectorAll('[data-members]').forEach((button) => button.addEventListener('click', () => openMembers(state.list.find((item) => item.admin_class_id === Number(button.dataset.members)))))`
- `frontend/src/pages/admin-classes.js:204` — `const item = state.list.find((entry) => entry.admin_class_id === Number(button.dataset.delete))`
- `frontend/src/pages/admin-course-detail.js:62` — `user = result.data.user`
- `frontend/src/pages/admin-course-detail.js:145` — `if (result.status === 'rejected') {`
- `frontend/src/pages/admin-course-detail.js:146` — `auxiliaryErrors.push('${label}加载失败：${result.reason?.message || '未知错误'}')`
- `frontend/src/pages/admin-course-detail.js:150` — `assign(requireResponseList(result.value, label))`
- `frontend/src/pages/admin-course-detail.js:648` — `if (!data.course_name || !data.course_code) {`
- `frontend/src/pages/admin-courses.js:47` — `user = result.data.user`
- `frontend/src/pages/admin-courses.js:91` — `const data = result.data || {}`
- `frontend/src/pages/admin-courses.js:92` — `courses = data.courses || data.list || []`
- `frontend/src/pages/admin-courses.js:93` — `totalCount = data.total || 0`
- `frontend/src/pages/admin-courses.js:94` — `const pageSize = data.page_size || 12`
- `frontend/src/pages/admin-dashboard.js:40` — `if (!data.summary || typeof data.summary !== 'object') throw new Error('驾驶舱缺少 summary 数据结构。')`
- `frontend/src/pages/admin-dashboard.js:41` — `if (!data.system_status || typeof data.system_status !== 'object') throw new Error('驾驶舱缺少 system_status 数据结构。')`
- `frontend/src/pages/admin-dashboard.js:42` — `if (!data.service_health || typeof data.service_health !== 'object' || !Array.isArray(data.service_health.services)) {`
- `frontend/src/pages/admin-dashboard.js:45` — `if (!Array.isArray(data.module_errors) || !Array.isArray(data.recent_events)) {`
- `frontend/src/pages/admin-dashboard.js:51` — `const services = data.service_health.services`
- `frontend/src/pages/admin-dashboard.js:79` — `const rows = Array.isArray(data.trend) ? data.trend : []`
- `frontend/src/pages/admin-dashboard.js:115` — `${distributionBlock('用户角色', data.users)}`
- `frontend/src/pages/admin-dashboard.js:116` — `${distributionBlock('班级类型', data.classes)}`
- `frontend/src/pages/admin-dashboard.js:117` — `${distributionBlock('知识审核', data.knowledge_reviews)}`
- `frontend/src/pages/admin-dashboard.js:124` — `{ title: '知识文档', href: '#/admin/knowledge', values: data.knowledge_documents || {}, labels: { pending: '待审', approved: '通过', rejected: '驳回' } },`
- `frontend/src/pages/admin-dashboard.js:125` — `{ title: '智能体版本', href: '#/admin/agent-reviews', values: data.agent_versions || {}, labels: { pending: '待审', approved: '通过', rejected: '驳回' } },`
- `frontend/src/pages/admin-dashboard.js:126` — `{ title: '智能体举报', href: '#/admin/agent-reviews', values: data.reports || {}, labels: { pending: '待处理', resolved: '已处理' } },`
- `frontend/src/pages/admin-dashboard.js:147` — `const summary = data.summary`
- `frontend/src/pages/admin-dashboard.js:148` — `const isCurrentContract = data.contract_version === ADMIN_DASHBOARD_CONTRACT_VERSION`
- `frontend/src/pages/admin-dashboard.js:162` — `<p>接口契约：${escapeHtml(data.contract_version)}${isCurrentContract ? '' : '（兼容模式）'}${data.generated_at ? ' · 更新于 ${escapeHtml(formatDate(data.generated_at, 'short'))}' : ''}</p>`
- `frontend/src/pages/admin-dashboard.js:185` — `${renderModuleErrors(data.module_errors)}`
- `frontend/src/pages/admin-dashboard.js:195` — `${renderDistributions(data.distributions)}`
- `frontend/src/pages/admin-dashboard.js:199` — `${renderReviewFlow(data.review_flow)}`
- `frontend/src/pages/admin-dashboard.js:205` — `<div><h3 class="card-title">系统与服务状态</h3><p>总状态：${statusTag(data.service_health.overall)} · 数据库：${statusTag(data.system_status.database)}</p></div>`
- `frontend/src/pages/admin-dashboard.js:212` — `${renderRecentEvents(data.recent_events)}`
- `frontend/src/pages/admin-dashboard.js:233` — `target.innerHTML = renderDashboard(result.data, user)`
- `frontend/src/pages/admin-governance.js:96` — `if (module === 'evaluations' && action === 'create') { data.cases = [{ case_key: 'case_${Date.now()}', title: '首个评测案例', input_json: { prompt: data.case_prompt }, expected_json: { expected_text: data.expected_text } }]; delete data.case_prompt; delete data.expected_text }`
- `frontend/src/pages/admin-governance.js:97` — `if (module === 'experiments' && action === 'create') { data.success_metric_json = parseJsonField(data.success_metric_json, '成功指标'); data.variants = [{ variant_key: 'control', name: '对照组', is_control: true, allocation_bp: 5000, configuration_json: {} }, { variant_key: 'treatment', name: '实验组', alloca`
- `frontend/src/pages/admin-governance.js:98` — `if (module === 'assets' && action === 'create') data.content_json = parseJsonField(data.content_json, '资产内容')`
- `frontend/src/pages/admin-governance.js:99` — `if (action === 'simulate') { data.snapshot_id = Number(id); data.parameters_json = parseJsonField(data.parameters_json, '模拟参数') }`
- `frontend/src/pages/admin-governance.js:100` — `if (module === 'teaching-issues' && id) data.teaching_issue_id = Number(id)`
- `frontend/src/pages/admin-governance.js:101` — `if (module === 'knowledge-health' && action === 'resolve') data.issue_id = Number(id)`
- `frontend/src/pages/admin-governance.js:102` — `if (module === 'risks') data.event_id = Number(id)`
- `frontend/src/pages/admin-governance.js:103` — `if (module === 'evaluations' && action === 'run') data.evaluation_set_id = Number(id)`
- `frontend/src/pages/admin-governance.js:104` — `if (module === 'experiments' && action === 'status') data.experiment_id = Number(id)`
- `frontend/src/pages/admin-governance.js:105` — `if (module === 'assets' && action === 'status') data.asset_id = Number(id)`
- `frontend/src/pages/admin-governance.js:108` — `const result = await runGovernanceAction(module, resolvedAction, data); notifyAdmin(result.data?.data_status === 'insufficient_data' ? '样本不足，未生成确定性画像' : '操作已真实写入数据库'); await load(module); return true`
- `frontend/src/pages/admin-governance.js:119` — `if (!listResult?.data || !Array.isArray(listResult.data.list)) throw new Error('治理列表接口尚未返回受支持的数据结构，该模块保持恢复隔离')`
- `frontend/src/pages/admin-governance.js:120` — `const list = listResult.data.list`
- `frontend/src/pages/admin-governance.js:122` — `const metricsHTML = metrics.length`
- `frontend/src/pages/admin-governance.js:123` — `? '<div class="admin-metric-grid">${metrics.map(([key, value], index) => '<article class="admin-metric-card" style="--metric-color:${['#7C3AED','#2563EB','#0F9F8F','#D97706'][index % 4]}"><div class="admin-metric-label">${LABELS[key]}</div><div class="admin-metric-value">${formatMetric(value, metric`
- `frontend/src/pages/admin-governance.js:125` — `const totalValue = Number(listResult.data.total)`
- `frontend/src/pages/admin-knowledge.js:16` — `user = result.data.user`
- `frontend/src/pages/admin-knowledge.js:33` — `state.loading = true; state.error = null`
- `frontend/src/pages/admin-knowledge.js:36` — `const params = { page: state.page, page_size: state.pageSize, ...filters }`
- `frontend/src/pages/admin-knowledge.js:39` — `state.list = result.data.list || []`
- `frontend/src/pages/admin-knowledge.js:40` — `state.total = result.data.total || 0`
- `frontend/src/pages/admin-knowledge.js:42` — `state.error = err.message`
- `frontend/src/pages/admin-knowledge.js:43` — `state.list = []`
- `frontend/src/pages/admin-knowledge.js:45` — `state.loading = false`
- `frontend/src/pages/admin-knowledge.js:51` — `if (state.loading) {`
- `frontend/src/pages/admin-knowledge.js:54` — `if (state.error) {`
- `frontend/src/pages/admin-knowledge.js:55` — `return '<div class="error-state"><div class="error-icon"></div><div class="error-message">${escapeHtml(state.error)}</div><button class="btn-retry" id="admin-knowledge-retry">重试</button></div>'`
- `frontend/src/pages/admin-knowledge.js:58` — `const totalPages = Math.ceil(state.total / state.pageSize) || 1`
- `frontend/src/pages/admin-knowledge.js:75` — `if (state.list.length === 0) {`
- `frontend/src/pages/admin-knowledge.js:78` — `for (const doc of state.list) {`
- `frontend/src/pages/admin-knowledge.js:98` — `if (state.total > state.pageSize) {`
- `frontend/src/pages/admin-knowledge.js:100` — `<button ${state.page <= 1 ? 'disabled' : ''} data-page="prev">上一页</button>`
- `frontend/src/pages/admin-knowledge.js:101` — `<span class="page-info">第 ${state.page} / ${totalPages} 页，共 ${state.total} 条</span>`
- `frontend/src/pages/admin-knowledge.js:102` — `<button ${state.page >= totalPages ? 'disabled' : ''} data-page="next">下一页</button>`
- `frontend/src/pages/admin-knowledge.js:162` — `state.page = 1`
- `frontend/src/pages/admin-knowledge.js:169` — `if (action === 'prev' && state.page > 1) { state.page--; loadData() }`
- `frontend/src/pages/admin-knowledge.js:170` — `if (action === 'next') { const tp = Math.ceil(state.total / state.pageSize); if (state.page < tp) { state.page++; loadData() } }`
- `frontend/src/pages/admin-logs.js:14` — `user = result.data.user`
- `frontend/src/pages/admin-logs.js:24` — `state.loading = true; state.error = null`
- `frontend/src/pages/admin-logs.js:27` — `const params = { page: state.page, page_size: state.pageSize, ...filters }`
- `frontend/src/pages/admin-logs.js:30` — `state.list = result.data.list || []`
- `frontend/src/pages/admin-logs.js:31` — `state.total = result.data.total || 0`
- 其余 109 处匹配已省略；可直接运行脚本或使用 `rg` 复核。

## 审计边界

- 动态模板 URL、Controller 到 Service、Service 到 Prisma 表的完整映射由 `scripts/admin_route_api_matrix.py` 进一步生成并人工核对。
- 正确的 HTTP 状态码、JWT/管理员权限、真实数据库数据、按钮副作用与局部错误状态必须通过 API 和浏览器实测确认。
- 原生 HTML 标签本身不是缺陷；没有统一 class、计算样式为浏览器默认或绕过公共交互组件时才构成退化。

