#!/usr/bin/env python3
"""Audit role-scoped floating components and browser proof."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def source(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def browser_checks(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("checks", [])


def run(browser_report: Path) -> dict:
    dashboard = source("frontend/src/utils/dashboard.js")
    router = source("frontend/src/utils/router.js")
    imports = "\n".join(path.read_text(encoding="utf-8") for path in (ROOT / "frontend" / "src").rglob("*.js"))
    runtime = browser_checks(browser_report)
    role_runtime = [
        item for item in runtime
        if item["id"].endswith(".ai_role") or item["id"].endswith(".ai.no_forbidden_requests")
    ]
    checks = {
        "shared_center_rendered_once": dashboard.count("renderUnifiedTaskMessageCenter(user)") == 1,
        "shared_center_unmounted_on_route_change": "unmountUnifiedTaskMessageCenter" in router,
        "student_ai_render_role_guard": bool(re.search(r"user\.role === 'student'.*renderStudentAiFloat", dashboard)),
        "student_ai_dependencies_lazy": "loadStudentAiDependencies" in dashboard and "import('../api/student.js')" in dashboard,
        "legacy_student_task_not_imported": "components/task-center" not in imports,
        "legacy_student_messages_not_imported": "components/student-notification-center" not in imports,
        "legacy_teacher_overlay_not_imported": "components/teacher-global-assistant" not in imports,
        "browser_role_dom_and_network": bool(role_runtime) and all(item["passed"] for item in role_runtime),
    }
    return {
        "schema": "role-floating-component-audit.v1",
        "passed": all(checks.values()),
        "checks": checks,
        "runtime_check_count": len(role_runtime),
        "policy": {
            "student": ["UnifiedTaskMessageCenter", "student AI learning assistant"],
            "teacher": ["UnifiedTaskMessageCenter"],
            "admin": ["UnifiedTaskMessageCenter"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--browser-report", type=Path, default=ROOT / "artifacts" / "cross-portal-rebuild" / "browser-acceptance.json")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "cross-portal-rebuild" / "role-floating-components.json")
    args = parser.parse_args()
    result = run(args.browser_report.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
