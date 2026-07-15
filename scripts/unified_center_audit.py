"""Read-only static audit for the implemented cross-portal work center."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def present(source: str, pattern: str) -> bool:
    return re.search(pattern, source, re.MULTILINE) is not None


def source_imports(symbol: str) -> list[str]:
    matches: list[str] = []
    for path in (ROOT / "frontend" / "src").rglob("*.js"):
        source = path.read_text(encoding="utf-8")
        if present(source, rf"(?:import|from)[^\n]*{re.escape(symbol)}"):
            matches.append(path.relative_to(ROOT).as_posix())
    return matches


def audit() -> dict:
    dashboard = read("frontend/src/utils/dashboard.js")
    router = read("frontend/src/utils/router.js")
    center = read("frontend/src/components/unified-task-message-center.js")
    center_api = read("frontend/src/api/work-center.js")
    center_service = read("backend/src/services/work-center.service.js")
    center_routes = read("backend/src/routes/work-center.routes.js")
    app = read("backend/src/app.js")
    old_task_imports = source_imports("components/task-center")
    old_message_imports = source_imports("components/student-notification-center")
    old_teacher_imports = source_imports("components/teacher-global-assistant")

    checks = {
        "single_shared_component": present(dashboard, r"renderUnifiedTaskMessageCenter")
        and present(dashboard, r"mountUnifiedTaskMessageCenter"),
        "all_three_roles_allowed": present(center, r"\['student', 'teacher', 'admin'\]"),
        "old_student_task_not_imported": not old_task_imports,
        "old_student_message_not_imported": not old_message_imports,
        "old_teacher_overlay_not_imported": not old_teacher_imports,
        "router_unmounts_shared_center": present(router, r"unmountUnifiedTaskMessageCenter"),
        "student_ai_role_guard": present(dashboard, r"user\.role === 'student'.*renderStudentAiFloat"),
        "student_ai_dynamic_dependencies": present(dashboard, r"loadStudentAiDependencies"),
        "polling_intervals": "30_000" in center and "15_000" in center,
        "hidden_page_pauses_polling": present(center, r"document\.hidden.*clearInterval"),
        "pointer_and_touch_drag": "pointerdown" in center and "touch-action:none" in read("frontend/src/styles/unified-work-center.css"),
        "position_scoped_by_user_and_role": present(center, r"user\.user_id.*user\.role"),
        "panel_local_full_message_list": present(center, r"expandedMessages = true") and present(center, r"unified-message-tools"),
        "message_detail_modal": present(center, r"unified-message-modal") and present(center, r"getWorkCenterMessage"),
        "backend_role_filter": present(center_service, r"receiver_user_id:\s*Number\(userId\)"),
        "backend_owner_task_filter": present(center_service, r"userId:\s*Number\(user\.user_id\)"),
        "backend_routes_mounted": present(app, r"app\.use\('/api/work-center'") and all(
            endpoint in center_routes
            for endpoint in ("/summary", "/feed", "/messages", "/tasks", "/messages/read-all")
        ),
        "frontend_uses_aggregate_api": all(
            endpoint in center_api
            for endpoint in ("/work-center/summary", "/work-center/messages")
        ),
    }
    return {
        "schema": "unified-center-static-audit.v2",
        "passed": all(checks.values()),
        "checks": checks,
        "active_mounts": {
            "student": "frontend/src/utils/dashboard.js -> UnifiedTaskMessageCenter + student AI assistant",
            "teacher": "frontend/src/utils/dashboard.js -> UnifiedTaskMessageCenter",
            "admin": "frontend/src/utils/dashboard.js -> UnifiedTaskMessageCenter",
        },
        "inactive_legacy_imports": {
            "task-center": old_task_imports,
            "student-notification-center": old_message_imports,
            "teacher-global-assistant": old_teacher_imports,
        },
        "endpoints": [
            "GET /api/work-center/summary",
            "GET /api/work-center/feed",
            "GET /api/work-center/messages",
            "GET /api/work-center/tasks",
            "GET /api/work-center/messages/:id",
            "POST /api/work-center/messages/:id/read",
            "POST /api/work-center/messages/read-all",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, help="Optional JSON output path")
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
