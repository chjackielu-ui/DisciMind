"""Read-only audit of the course -> teaching class -> file implementation."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def has(source: str, pattern: str) -> bool:
    return re.search(pattern, source, re.MULTILINE) is not None


def audit() -> dict:
    schema = read("backend/prisma/schema.prisma")
    routes = read("backend/src/routes/course-file.routes.js")
    service = read("backend/src/services/course-file.service.js")
    controller = read("backend/src/controllers/course-file.controller.js")
    app = read("backend/src/app.js")
    panel = read("frontend/src/components/course-files-panel.js")
    teacher_page = read("frontend/src/pages/teacher-course-detail.js")
    student_page = read("frontend/src/pages/student-course-detail.js")
    admin_page = read("frontend/src/pages/admin-course-detail.js")
    reusable_models = [
        name
        for name in (
            "Course", "TeachingClass", "TeachingClassTeacherAuthorization",
            "StudentCourseEnrollment", "KnowledgeDocument", "ResourceDistribution",
            "ResourceRecipient", "Notification", "OperationLog",
        )
        if has(schema, rf"model {name}\s*\{{")
    ]
    checks = {
        "reuses_existing_models": len(reusable_models) == 9,
        "course_scoped_route": has(routes, r"/:courseId/teaching-classes/:classId/files"),
        "route_is_authenticated": has(routes, r"router\.use\(auth"),
        "student_mutations_rejected": has(routes, r"router\.post\('/:courseId/teaching-classes/:classId/files', roles\(\['teacher', 'admin'\]\)"),
        "teacher_access_before_multer": has(routes, r"controller\.authorizeUpload, uploadOne"),
        "course_class_relation_checked": has(service, r"teachingClass\.course_id !== positiveInt\(courseId"),
        "teacher_relation_checked": all(term in service for term in ("teacher_user_id", "teachingClassTeacherAuthorization", "courseTeacherRelation")),
        "student_enrollment_checked": has(service, r"studentCourseEnrollment\.findFirst") and has(service, r"enrollment_status: 'active'"),
        "extension_and_mime_whitelist": "const allowed = new Map" in routes and "file.mimetype" in routes,
        "size_limit_30mb": "30 * 1024 * 1024" in routes,
        "random_storage_key": has(service, r"randomBytes\(24\)"),
        "checksum_and_deduplication": "sha256" in service and "file_checksum: checksum" in service,
        "non_static_storage": "storage/course-files" in service and not has(app, r"course-files.*express\.static"),
        "controlled_download": has(routes, r"files/:fileId/download") and has(controller, r"authorizeDownload"),
        "chinese_filename_header": "filename*=UTF-8''" in controller,
        "publish_is_transactional": has(service, r"publishInTransaction") and has(service, r"prisma\.\$transaction"),
        "recipient_and_notification_created": "resourceRecipient.createMany" in service and "notification.createMany" in service,
        "notification_idempotent": "idempotency_key" in service and "skipDuplicates: true" in service,
        "operation_audit": "operationLog.create" in service and "target_type: 'course_file'" in service,
        "soft_delete": "deleted_at: now" in service,
        "shared_frontend_panel": "renderCourseFilesPanel" in panel and "mountCourseFilesPanel" in panel,
        "teacher_course_tab": "course-files" in teacher_page and "课程文件" in teacher_page,
        "student_course_entry": "course-files" in student_page and "课程文件" in student_page,
        "admin_course_tab": "course-files" in admin_page and "课程文件" in admin_page,
        "admin_permission_aware_ui": "role === 'admin' && permissionCanManage" in panel,
        "student_upload_dom_absent": "const canManage = role === 'teacher' || (role === 'admin' && permissionCanManage)" in panel
        and "course-file-upload-open" in panel and "${canManage ?" in panel,
    }
    return {
        "schema": "course-file-static-audit.v2",
        "passed": all(checks.values()),
        "checks": checks,
        "reused_models": reusable_models,
        "storage": "storage/course-files (never statically mounted)",
        "contract": "/api/courses/:courseId/teaching-classes/:classId/files",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit()
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
